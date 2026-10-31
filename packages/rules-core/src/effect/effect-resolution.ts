import { replaceCardInstances } from "../zone/card-instance-state";
import { getMultiPlacementTargets } from "../pending-state-guards";
import { requireTriggerChainId } from "../chain-id";
import { hasPendingBattleEndEntryReactions } from "../battle/battle-end-entry-blockers";
import {
  cloneStateForTriggerDelta,
  getEffectPayCostAmount,
} from "./native-effect-front-helpers";
import { getCardById } from "../card/card-lookup";
import {
  isCardDefinitionToken,
  isMagicLikeCardForm,
} from "../card/card-filter";
import { isInstanceInOpenResponseWindowOrPendingCascade } from "../stack/stack-window-shared";
import { moveCardZone, resolveCardLeavesFieldCores } from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import {
  createChainResolveEffectQueueEntry,
  setEffectQueueEntries,
} from "./effect-queue";
import type { flushPendingLeaves } from "../state-based-actions";
import {
  hasOutstandingEffectResolutionContinuation,
  runStateBasedActions,
} from "../state-based-actions";
import {
  getEffectiveColors,
  runReevaluationAtTiming,
} from "../legal/legal-actions-shared";
import {
  recomputeAndRebuildContinuousEffects,
  recomputeAndRebuildContinuousEffectsForSources,
} from "./continuous-effect-rebuild";
import {
  finalizePendingEndFinalizations,
  type TurnTransitionLookups,
} from "./structured-state-grants";
import { evaluateAttackStepEndBlockedRetryCondition } from "./attack-step-end-blocked-retry";
import type { ReevaluationConfig } from "../legal/legal-actions-shared";
import { recomputeBattleEntityBp } from "../battle/battle-shared";
import { canFireBattleEndDeferral } from "../battle/battle-end-deferral-gate";
import {
  executeEffect,
  expireCurrentEffectContinuousEffects,
} from "./effect-interpreter";
import { processMovedToTrashEffects } from "./structured-trash-ops";
import type {
  ActiveStack,
  EffectActivationSourceZone,
  EffectActivationTiming,
  PendingImmediateBattleEnd,
  Timing,
} from "../model";
import type { StepResult } from "../step-execution-context";
import { isStubRebirthEffect } from "../dsl-types";
import type { Effect } from "../dsl-types";
import { isTextRoleUnderTextEffect } from "../mechanics/star-garment-utils";
import {
  checkAndQueueOracleChoicesForTriggerBatch,
  checkAndQueuePlacementOracle,
} from "../mechanics/oracle-system";
import { isGrandwalkerOrGuidedNexus } from "../model";
import { snapshotTargetedDisclosureTargetZones } from "./targeted-disclosure-target-snapshot";
import { hasPendingEffectResolution } from "./pending-resolution-policy";

/**
 * timingFilter（レガシー文字列 "main"/"flash"/"stack" 等）と Timing オブジェクトを比較。
 */
export function matchesTimingFilter(timing: Timing, filter: string): boolean {
  if (timing.kind === "activated") return timing.mode === filter;
  return false;
}

function isFlashEffectActivation(effect: Effect): boolean {
  return (
    effect.timing.kind === "activated" &&
    effect.timing.mode === "flash" &&
    (effect.activationLabel ?? effect.timing.mode) === "flash"
  );
}

function expireFinalizedCurrentEffectContinuousEffects(options: {
  state: GameState;
  sourceInstanceId?: string | null;
  sourceEffectIndex?: number;
}): GameState {
  if (
    !options.sourceInstanceId ||
    hasOutstandingEffectResolutionContinuation(options.state)
  ) {
    return options.state;
  }
  return expireCurrentEffectContinuousEffects(
    options.state,
    options.sourceInstanceId,
    options.sourceEffectIndex
  );
}

function finishStableEffectResolution(
  options: TurnTransitionLookups & {
    state: GameState;
    sourceInstanceId?: string | null;
    sourceEffectIndex?: number;
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  }
): GameState {
  const expired = expireFinalizedCurrentEffectContinuousEffects({
    state: options.state,
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
  });
  return finalizePendingEndFinalizations(
    expired,
    options.getCardDefinitionById,
    (args) =>
      evaluateAttackStepEndBlockedRetryCondition({
        ...args,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
    options
  );
}

function tryExecuteStructuredEffects<Context>(
  state: GameState,
  context: Context
): GameState {
  const ctx = context as Record<string, unknown> | undefined;
  const sourceCard = ctx?.sourceCard as
    | { instanceId?: string; definitionId?: string }
    | undefined;
  const sourceId =
    sourceCard?.instanceId ?? (ctx?.sourceInstanceId as string | undefined);
  if (!sourceId || !ctx?.getCardDefinitionById) return state;

  const getDef = ctx.getCardDefinitionById as (
    id: string
  ) => CardDefinition | undefined;
  const actingPlayerId = (ctx.actingPlayerId as string) ?? state.activePlayerId;
  const card = getCardById(state, sourceId);
  if (!card) return state;

  // overridden definition（アクセル/チェンジの effects 差し替え）を優先
  const def =
    (ctx.effectSourceDefinition as CardDefinition | undefined) ??
    (ctx.sourceDefinition as CardDefinition | undefined) ??
    (ctx.magicDefinition as CardDefinition | undefined) ??
    getDef(card.definitionId);
  if (!def) return state;

  // effects が存在すればインタプリタで実行
  if (def.effects && def.effects.length > 0) {
    return tryExecuteEffects(
      state,
      def.effects,
      sourceId,
      actingPlayerId,
      getDef,
      ctx
    );
  }

  return state;
}

/**
 * effects (Effect[]) をインタプリタで実行する。
 * tryExecuteStructuredEffects から effects が存在する場合に呼ばれる。
 */
function tryExecuteEffects(
  state: GameState,
  effects: readonly Effect[],
  sourceInstanceId: string,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  ctx: Record<string, unknown>
): GameState {
  const timingFilter = ctx?.effectTimingFilter as string | undefined;
  const explicitEffectActivationTiming = ctx?.effectActivationTiming as
    | EffectActivationTiming
    | undefined;
  const effectActivationTiming =
    explicitEffectActivationTiming ??
    (timingFilter === "main" ||
    timingFilter === "flash" ||
    timingFilter === "stack"
      ? timingFilter
      : undefined);
  const activationZone = ctx?.activationZone as
    | EffectActivationSourceZone
    | undefined;
  const applicabilityEvaluationZone = ctx?.applicabilityEvaluationZone as
    | EffectActivationSourceZone
    | undefined;
  const resolutionKind = ctx?.resolutionKind as string | undefined;
  const effectActionKind =
    (ctx?.effectActionKind as
      | import("../model").EffectResolutionActionKind
      | undefined) ??
    (resolutionKind === "magic_action"
      ? "magic"
      : resolutionKind === "field_card_effect_action"
        ? "field_card_effect"
        : resolutionKind === "play_card_action"
          ? undefined
          : resolutionKind === "battle_immediate_effect"
            ? "battle_immediate_effect"
            : resolutionKind === "pending_triggered_effect"
              ? "triggered_effect"
              : resolutionKind === "pending_burst_check"
                ? "burst_activation"
                : undefined);
  const chainId = ctx?.chainId as string | null | undefined;
  const isPlayCardAction = resolutionKind === "play_card_action";
  // P3-51: dispatch 経路 (battle-immediate / triggered) が自身の registration に
  // 対応する effectIndex のみを実行できるように、ctx.targetEffectIndex を尊重する。
  const targetEffectIndex = ctx?.targetEffectIndex as number | undefined;
  const sourceEffectIndex = ctx?.sourceEffectIndex as number | undefined;
  const effectSourceDefinition = ctx?.effectSourceDefinition as
    | CardDefinition
    | undefined;
  const effectSourceInstanceId = ctx?.effectSourceInstanceId as
    | string
    | undefined;
  const effectSourceDefinitionId =
    (ctx?.effectSourceDefinitionId as string | undefined) ??
    effectSourceDefinition?.cardNo;
  const coreShootDistribution = ctx?.coreShootDistribution as
    | Record<string, number>
    | undefined;
  const coreShootSoulCoreInstanceId = ctx?.coreShootSoulCoreInstanceId as
    | string
    | undefined;
  // field_card ソースのコスト支払い配分 (resolve_core_source_allocation 再実行用)。
  const coreSourceAllocations = ctx?.coreSourceAllocations as
    | Record<string, number>
    | undefined;
  const coreSourceSoulCoreInstanceId = ctx?.coreSourceSoulCoreInstanceId as
    | string
    | undefined;
  const targetInstanceIds = ctx?.targetInstanceIds as string[] | undefined;
  const targetStepId = ctx?.targetStepId as string | undefined;
  const targetSelectionResolved = ctx?.targetSelectionResolved as
    | boolean
    | undefined;
  const optionalRepeatTargetCount = ctx?.optionalRepeatTargetCount as
    | number
    | undefined;
  const preservePreSelectedTargetRefs = ctx?.preservePreSelectedTargetRefs as
    | boolean
    | undefined;
  const skipTargetedDisclosureAtStartStep =
    ctx?.skipTargetedDisclosureAtStartStep as boolean | undefined;
  const skipTargetedDisclosureStepId = ctx?.skipTargetedDisclosureStepId as
    | string
    | undefined;
  const skipTargetedDisclosureTargetStartAtStartStep =
    ctx?.skipTargetedDisclosureTargetStartAtStartStep as number | undefined;
  const skipTargetedDisclosureTargetCountAtStartStep =
    ctx?.skipTargetedDisclosureTargetCountAtStartStep as number | undefined;
  const targetGroups = ctx?.targetGroups as
    | readonly import("../model").PendingEffectTargetGroup[]
    | undefined;
  const sequentialTargetConsumption = ctx?.sequentialTargetConsumption as
    | boolean
    | undefined;
  const choiceIndex = ctx?.choiceIndex as number | undefined;
  // Legal-action resolution is interactive even when a deferred stack caller
  // supplies only its declaration context. Headless executeEffect callers keep
  // their explicit choices; action continuations must never auto-pick a branch.
  const promptUnresolvedChoice =
    (ctx?.promptUnresolvedChoice as boolean | undefined) ??
    resolutionKind !== undefined;
  const burstPostResolutionDestination = ctx?.burstPostResolutionDestination as
    | "burst"
    | "trash"
    | undefined;
  const pendingEffectSimultaneousGroupId =
    ctx?.pendingEffectSimultaneousGroupId as string | undefined;
  const pendingEffectPendingId = ctx?.pendingEffectPendingId as
    | string
    | undefined;
  const rebirthTimingWindowId =
    (ctx?.rebirthTimingWindowId as string | undefined) ??
    (pendingEffectSimultaneousGroupId !== undefined
      ? `pending_triggered:${pendingEffectSimultaneousGroupId}`
      : undefined);
  const payCostPaymentSources = ctx?.payCostPaymentSources as
    | readonly import("../core/payment-system").CardCostPaymentSource[]
    | undefined;
  const allowPendingPayCostSourceAllocation =
    ctx?.allowPendingPayCostSourceAllocation as boolean | undefined;
  const summonPaymentSources = ctx?.summonPaymentSources as
    | readonly import("../core/payment-system").CardCostPaymentSource[]
    | undefined;
  const summonEnterFieldCorePlacements = ctx?.summonEnterFieldCorePlacements as
    | readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[]
    | undefined;
  // P3-43: registration.preventionLevel 由来の sourcePreventionLevel を executeEffect に伝播。
  // 離脱系 action (destroy/bounce/...) で `cannot_*` 効果耐性を貫通するかの判定に使う。
  const sourcePreventionLevel = ctx?.sourcePreventionLevel as
    | import("../model").EffectPreventionLevel
    | undefined;
  const sourcePreventionBypass = ctx?.sourcePreventionBypass as
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  const triggerCause = ctx?.triggerCause as
    | import("../model").TriggerEventCause
    | undefined;
  const triggerFromZone = ctx?.triggerFromZone as
    | import("../model").Zone
    | undefined;
  const triggeredRootConditionResults = ctx?.triggeredRootConditionResults as
    | Readonly<Record<string, boolean>>
    | undefined;
  const triggerRelatedInstanceZone = ctx?.triggerRelatedInstanceZone as
    | import("../model").Zone
    | undefined;
  const triggerSourceTribes = ctx?.triggerSourceTribes as
    | readonly string[]
    | undefined;
  const triggerSourcePlayerId = ctx?.triggerSourcePlayerId as
    | string
    | undefined;
  const triggerSourceInstanceId = ctx?.triggerSourceInstanceId as
    | string
    | undefined;
  // P3-37 follow-up + P3-39: after_triggers connector がリスナー無し event を空 pending として
  // 残さないよう、 EffectActionContext から triggered effect lookup を引き出して executeEffect に渡す。
  // 2026-07-19 (ENGINE-exhaust-third-party-opt-in-gap): 他フィールドと違い `| undefined` を
  // 落とした cast だったため、ctx に lookup が無い呼び出し (flash/join 系テスト等) で
  // `undefined` が「型上は関数」として下流 (queuePendingReactionsFromTriggerEvents) まで伝播し、
  // raw push フォールバック (listener 有無を無視して無条件 push) を踏んでいた。P3-39 が防ごうと
  // した「型で必須化したはずが cast で穴が空く」パターンそのものだったため、他の ctx フィールド
  // と同じく `| undefined` を保持し、既存 (effect-resolution.ts 内) 同型 fallback と揃えて
  // その場で `() => []` にフォールバックする。
  const getRegisteredTriggeredEffectActions =
    (ctx.getRegisteredTriggeredEffectActions as
      | import("./trigger-system").TriggeredEffectActionRegistrationLookup
      | undefined) ?? (() => []);
  // ENGINE-move-card-actual-count-amount: アクセル解決 (accelData.effects を effects として
  // 渡す合成 magicDefinition 経由) であることを示す。on_step 対象選択 pending の継続情報
  // (StepOptionalContinuation.isAccelData) へ転写し、resolveContinuationEffect が
  // top-level `effects[]` ではなく `accelData.effects[]` から再開効果を探すようにする
  // (`ExecuteEffectOptions.isAccelData` と同義、divineSkillIndex と同型パターン)。
  const isAccelData = ctx.isAccelData as boolean | undefined;
  const isChangeData = ctx.isChangeData as boolean | undefined;
  // アクセル / マジック / チェンジ等の reduction.finalCost を effect 解決へ伝播。
  // DynamicCount.cost_paid_this_effect の解決元になる。
  const reduction = ctx.reduction as { finalCost?: number } | undefined;
  const costPaidThisEffect =
    typeof reduction?.finalCost === "number" ? reduction.finalCost : undefined;
  // P3-62: 発揮不能時 (condition unmet / conditional_cost rollback) の usageLimit 払い戻し情報。
  const recordedUsage = ctx.recordedUsage as
    | import("../model").RecordedEffectUsage
    | undefined;
  const postResolutionOracle = ctx.postResolutionOracle as
    | import("../model").PostResolutionOracleTrigger
    | undefined;
  const pendingStackNegateCandidate = ctx.pendingStackNegateCandidate as
    | ActiveStack
    | null
    | undefined;
  // P3-131層2: queueTargetedDisclosureForStep が negate 照合用 identity として使う
  // 元 ActiveStack スナップショット (resolveDeferredMagicStack 由来)。
  const targetedDisclosureNegateIdentity =
    ctx.targetedDisclosureNegateIdentity as ActiveStack | undefined;
  const battleEndDeferralAttackId = ctx.battleEndDeferralAttackId as
    | string
    | undefined;
  // P3-14 C-5: 誘発イベントの量 (pendingEffect.amount) を DynamicCount.event_amount へ伝播。
  const eventAmount = ctx.eventAmount as number | undefined;
  // 三者観測 game_event の主語 Y を TargetSpec.trigger_related_instance に注入する。
  const triggerRelatedInstanceId = ctx.triggerRelatedInstanceId as
    | string
    | undefined;
  const triggerRelatedCombinedHostInstanceId =
    ctx.triggerRelatedCombinedHostInstanceId as string | undefined;
  const triggerRelatedInstanceIds = ctx.triggerRelatedInstanceIds as
    | readonly string[]
    | undefined;
  // engine-advent-source-leave-summon (BSSG01-C08 Lv2): 離脱トリガーが保持する
  // 煌臨元 instanceId スナップショットを StepExecutionContext へ注入する。
  const triggerAdventSourceInstanceIds = ctx.triggerAdventSourceInstanceIds as
    | readonly string[]
    | undefined;
  const getRegisteredBurstActions = ctx.getRegisteredBurstActions as
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
  // ENGINE-conditional-free-magic-use-target-selection: use_magic_without_cost の
  // 同期解決経路が対象選択を要する場合に本物の pendingEffectTargetSelection を
  // 生成するための窓口 (legal-actions-apply.ts の resolveDeferredStackAction 束縛)。
  const resolveDeferredStackForFreeMagicUse =
    ctx.resolveDeferredStackForFreeMagicUse as
      | ((state: GameState, stack: import("../model").ActiveStack) => GameState)
      | undefined;
  // ENGINE-free-magic-use-target-selection-nonfield-candidate-zones:
  // use_magic_without_cost の synthetic ActiveStack へ candidateTargetZones を
  // 引き継ぐための窓口 (resolveDeferredStackForFreeMagicUse と同型 plumbing)。
  const getRegisteredMagicActions = ctx.getRegisteredMagicActions as
    | import("../legal/legal-actions-types").MagicActionRegistrationLookup
    | undefined;
  const sourceCardForResume = getCardById(state, sourceInstanceId);
  const sourceDefinitionForResume = sourceCardForResume
    ? getCardDefinitionById(sourceCardForResume.definitionId)
    : undefined;
  const executionSourceDefinition =
    (ctx.effectSourceDefinition as CardDefinition | undefined) ??
    (ctx.sourceDefinition as CardDefinition | undefined) ??
    (ctx.magicDefinition as CardDefinition | undefined) ??
    sourceDefinitionForResume;

  let current = state;
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    const effect = effects[effectIndex]!;
    // P3-51: targetEffectIndex 指定時は対象 effect のみ実行する。
    // play_card_action は continuous 全部回すので targetEffectIndex を尊重しない。
    if (
      !isPlayCardAction &&
      targetEffectIndex !== undefined &&
      effectIndex !== targetEffectIndex
    ) {
      continue;
    }
    const isSummonPermissionFollowUp =
      isPlayCardAction &&
      sourceEffectIndex !== undefined &&
      effectIndex === sourceEffectIndex &&
      effect.timing.kind === "activated" &&
      effect.steps[0]?.action.kind === "summon" &&
      effect.steps[0].action.target.kind === "self";
    // play_card_action 中: 通常は continuous のみ。召喚許可由来の action だけ、
    // play-card pipeline で処理済みの先頭 summon を飛ばして後続を解決する。
    if (isPlayCardAction) {
      if (effect.timing.kind !== "continuous" && !isSummonPermissionFollowUp)
        continue;
      // 転醒トリガー未表現の stub (timing:continuous + rebirth ステップ) は
      // 配置時に自動実行するとカウントゲートだけで強制発火し、配置直後に
      // 裏返ってしまう。CE 登録 (continuous-effect-rebuild) と同じく skip する。
      if (isStubRebirthEffect(effect)) continue;
      if (
        effect.timing.kind === "continuous" &&
        executionSourceDefinition !== undefined &&
        isTextRoleUnderTextEffect(executionSourceDefinition, effect)
      ) {
        continue;
      }
    } else if (
      timingFilter &&
      !matchesTimingFilter(effect.timing, timingFilter)
    ) {
      continue;
    }

    // P3-63: pending_burst_check 解決中は burst timing 効果のみを実行する。
    // BSTH02-M01 のように同一カードに card_event 効果 (除外する) と burst 効果が
    // 共存する場合、targetEffectIndex 未指定でも非 burst 効果を誤起動しないよう
    // resolutionKind でガードする。
    //
    // scope justification (P3-63 残留懸念 #2 調査結果):
    //   - magic_action: effectTimingFilter (main / flash) で activated effects のみ通る。
    //   - field_card_effect_action / battle_immediate_effect / pending_triggered_effect:
    //     applyLegalAction が registrationIndex 経由で targetEffectIndex を必ず設定するため、
    //     当該 registration index 以外の effects は line 142 のガードで弾かれる。
    //   - play_card_action: line 149 で continuous 以外を skip。
    //   - pending_burst_check は source-backed registration があれば targetEffectIndex を
    //     受け取る。no-source fallback / 旧 state では未指定のことがあるため、本ガードで
    //     burst timing 以外の誤起動を防ぐ。
    if (
      resolutionKind === "pending_burst_check" &&
      effect.timing.kind !== "burst"
    ) {
      continue;
    }

    // pending チェック
    if (current.pendingDeckReveal !== null) break;
    if (current.pendingZoneSelection !== null) break;
    // step.executionMode='optional' の execute/decline 選択中は後続 effect を実行しない
    if (current.pendingStepOptionalChoice !== null) break;
    // EffectStep.choice の分岐選択中も同様に後続 effect を実行しない
    if (current.pendingStepChoice !== null) break;
    // optional step の対象選択待ち中も同様に後続 effect を実行しない
    if (current.pendingStepOptionalTargetSelection !== null) break;
    if (current.pendingAsIfSoulCoreChoice !== null) break;
    // optional repeat の追加発揮/追加カウント選択中も後続 effect を実行しない
    if (current.pendingEffectOptionalRepeatChoice !== null) break;
    if (current.pendingEffectOptionalRepeatCountSelection !== null) break;
    // count_decrease amount {min,max} の減少数選択中も同様に後続 effect を実行しない
    if (current.pendingCountSelection !== null) break;
    // discard_set_burst count {min,max} の破棄枚数選択中も同様に後続 effect を実行しない
    if (current.pendingDiscardSetBurstCountSelection !== null) break;
    // core_move amount {min,max} の移動数選択中も同様に後続 effect を実行しない
    if (current.pendingCoreCountSelection !== null) break;
    // field_card コスト支払い配分の選択待ち中は後続 effect を実行しない
    if (current.pendingCoreSourceAllocation !== null) break;
    // 【リンクエイド】の効果文内コスト支払い元選択待ち中も後続 effect を実行しない
    if (current.pendingLinkAidCostSourceChoice !== null) break;
    // 効果文内 summon コスト支払い元選択待ち中も後続 effect を実行しない
    if (current.pendingEffectSummonCostPayment !== null) break;
    // ライフ→任意先の通常/ソウル混在持ち主選択待ち中も同様に後続 effect を実行しない
    // (ENGINE-core-move-from-life-owner-soul-choice)。
    if (current.pendingLifeCoreSelection !== null) break;

    // P3-14 C-1: フラッシュ効果発揮ログ push（step 実行開始時点）。
    // activated flash 効果のみ追跡（裁定 2026-04-16）。
    // 打ち消し/無効化されても履歴に残す。
    if (!isSummonPermissionFollowUp && isFlashEffectActivation(effect)) {
      const sourceCard = getCardById(current, sourceInstanceId);
      const sourceDef = sourceCard
        ? ((ctx.sourceDefinition as CardDefinition | undefined) ??
          (ctx.magicDefinition as CardDefinition | undefined) ??
          getCardDefinitionById(sourceCard.definitionId))
        : undefined;
      const sourceDefinitionId =
        sourceDef?.cardNo ?? sourceCard?.definitionId ?? "unknown";
      current = {
        ...current,
        flashEffectActivationLog: [
          ...current.flashEffectActivationLog,
          {
            playerId: actingPlayerId,
            sourceInstanceId,
            sourceDefinitionId,
            effectIndex,
            turnNumber: current.turnNumber,
            step: current.step,
            attackId: current.activeAttack?.attackId ?? null,
          },
        ],
        log: [
          ...current.log,
          `flash:effect_activated:${actingPlayerId}:${sourceInstanceId}:${sourceDefinitionId}:${effectIndex}`,
        ],
      };
    }

    current = executeEffect({
      state: current,
      effect,
      effectIndex,
      deferCurrentEffectCleanup: true,
      ...(typeof ctx.effectEventAction === "string"
        ? { effectEventAction: ctx.effectEventAction }
        : {}),
      sourceInstanceId,
      actingPlayerId,
      chainId: requireTriggerChainId(chainId),
      ...(isSummonPermissionFollowUp
        ? {
            startFromStepIndex: 1,
            initialStepResults: [
              {
                stepId: effect.steps[0]!.id ?? "__step_0",
                affectedCardInstanceIds: [sourceInstanceId],
                succeeded: true,
                executed: true,
              } satisfies StepResult,
            ],
          }
        : {}),
      effectResolutionBeforeState:
        (ctx.triggerBeforeState as GameState | undefined) ?? state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...(getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions }
        : {}),
      ...(resolveDeferredStackForFreeMagicUse !== undefined
        ? { resolveDeferredStackForFreeMagicUse }
        : {}),
      ...(getRegisteredMagicActions !== undefined
        ? { getRegisteredMagicActions }
        : {}),
      ...(targetInstanceIds ? { targetInstanceIds } : {}),
      ...(targetStepId !== undefined ? { targetStepId } : {}),
      ...(targetSelectionResolved === true ? { targetSelectionResolved } : {}),
      ...(optionalRepeatTargetCount !== undefined
        ? { optionalRepeatTargetCount }
        : {}),
      ...(preservePreSelectedTargetRefs === true
        ? { preservePreSelectedTargetRefs }
        : {}),
      ...(skipTargetedDisclosureAtStartStep === true
        ? { skipTargetedDisclosureAtStartStep }
        : {}),
      ...(skipTargetedDisclosureStepId !== undefined
        ? { skipTargetedDisclosureStepId }
        : {}),
      ...(skipTargetedDisclosureTargetStartAtStartStep !== undefined
        ? { skipTargetedDisclosureTargetStartAtStartStep }
        : {}),
      ...(skipTargetedDisclosureTargetCountAtStartStep !== undefined
        ? { skipTargetedDisclosureTargetCountAtStartStep }
        : {}),
      ...(targetGroups !== undefined ? { targetGroups } : {}),
      ...(sequentialTargetConsumption === true
        ? { sequentialTargetConsumption }
        : {}),
      ...(coreShootDistribution ? { coreShootDistribution } : {}),
      ...(coreShootSoulCoreInstanceId ? { coreShootSoulCoreInstanceId } : {}),
      ...(coreSourceAllocations ? { coreSourceAllocations } : {}),
      ...(coreSourceSoulCoreInstanceId ? { coreSourceSoulCoreInstanceId } : {}),
      ...(choiceIndex !== undefined ? { choiceIndex } : {}),
      ...(promptUnresolvedChoice === true ? { promptUnresolvedChoice } : {}),
      ...(burstPostResolutionDestination !== undefined
        ? { burstPostResolutionDestination }
        : {}),
      ...(pendingEffectSimultaneousGroupId !== undefined
        ? { pendingEffectSimultaneousGroupId }
        : {}),
      ...(pendingEffectPendingId !== undefined
        ? { pendingEffectPendingId }
        : {}),
      ...(rebirthTimingWindowId !== undefined ? { rebirthTimingWindowId } : {}),
      ...(payCostPaymentSources !== undefined ? { payCostPaymentSources } : {}),
      // 効果文のpay_costは、クライアントのopt-inなしで窓後に支払い元を選ぶ。
      ...(allowPendingPayCostSourceAllocation === true ||
      getEffectPayCostAmount(effect, choiceIndex) > 0
        ? { allowPendingPayCostSourceAllocation: true }
        : {}),
      ...(summonPaymentSources !== undefined ? { summonPaymentSources } : {}),
      ...(summonEnterFieldCorePlacements !== undefined
        ? { summonEnterFieldCorePlacements }
        : {}),
      ...(costPaidThisEffect !== undefined ? { costPaidThisEffect } : {}),
      ...(isAccelData !== undefined ? { isAccelData } : {}),
      ...(isChangeData !== undefined ? { isChangeData } : {}),
      ...(sourcePreventionLevel !== undefined ? { sourcePreventionLevel } : {}),
      ...(sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass }
        : {}),
      ...(triggerFromZone !== undefined ? { triggerFromZone } : {}),
      ...(triggeredRootConditionResults !== undefined
        ? { triggeredRootConditionResults }
        : {}),
      ...(triggerCause !== undefined ? { triggerCause } : {}),
      ...(triggerRelatedInstanceZone !== undefined
        ? { triggerRelatedInstanceZone }
        : {}),
      ...(triggerSourceTribes !== undefined ? { triggerSourceTribes } : {}),
      ...(triggerSourcePlayerId !== undefined ? { triggerSourcePlayerId } : {}),
      ...(triggerSourceInstanceId !== undefined
        ? { triggerSourceInstanceId }
        : {}),
      ...(recordedUsage !== undefined ? { recordedUsage } : {}),
      ...(effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId }
        : {}),
      ...(effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId }
        : {}),
      ...(effectSourceDefinition !== undefined
        ? {
            targetedDisclosureSourceDefinitionId: effectSourceDefinition.cardNo,
          }
        : {}),
      ...(eventAmount !== undefined ? { eventAmount } : {}),
      ...(triggerRelatedInstanceId !== undefined
        ? { triggerRelatedInstanceId }
        : {}),
      ...(triggerRelatedCombinedHostInstanceId !== undefined
        ? { triggerRelatedCombinedHostInstanceId }
        : {}),
      ...(triggerRelatedInstanceIds !== undefined
        ? { triggerRelatedInstanceIds }
        : {}),
      ...(triggerAdventSourceInstanceIds !== undefined
        ? { triggerAdventSourceInstanceIds }
        : {}),
      ...(postResolutionOracle !== undefined ? { postResolutionOracle } : {}),
      ...(pendingStackNegateCandidate !== undefined
        ? { pendingStackNegateCandidate }
        : {}),
      ...(targetedDisclosureNegateIdentity !== undefined
        ? { targetedDisclosureNegateIdentity }
        : {}),
      ...(effectActionKind !== undefined ? { effectActionKind } : {}),
      ...(effectActivationTiming !== undefined
        ? { effectActivationTiming }
        : {}),
      ...(activationZone !== undefined ? { activationZone } : {}),
      ...(applicabilityEvaluationZone !== undefined
        ? { applicabilityEvaluationZone }
        : {}),
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
      ...(sourceDefinitionForResume?.effects?.[effectIndex] !== effect
        ? { optionalStepResumeEffectOverride: effect }
        : {}),
    });
  }
  return current;
}
import type { EffectSourceKind } from "../source-kinds";
import {
  collectTriggerEventsFromStateDelta,
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
  pruneIllegalPendingTriggeredEffects,
  queueBattleEndTriggers,
  queuePendingReactionsFromTriggerEvents,
} from "./trigger-system";
import {
  finalizeBattleEndScopeExpirations,
  getBattleEndDeferralChainId,
  hasPendingBattleEndFinalizeBlockers,
  maybeFinalizeBattleEndScopeExpirations,
} from "../battle/battle-end-scope-finalize";
import { flushPendingLeavesAndQueueReactions } from "../zone/pending-leave-flush";
import type {
  CollectedTriggerEvent,
  TriggeredEffectActionRegistrationLookup,
} from "./trigger-system";
import type { BattleImmediateEffectActionRegistrationLookup } from "../battle/battle-immediate-effect-system";
import type {
  CardDefinition,
  CardInstance,
  EffectComposition,
  EffectForceLevel,
  GameState,
  LifeCoreKind,
  PendingBattleEndDeferral,
  PendingTriggeredEffect,
  SupplementalTriggerEvent,
  TargetedDisclosureContinuation,
} from "../model";
import { executeSuppressPendingLeaveEffects } from "./native-move-core-handlers";
import {
  createConditionalCostCompositionResolver,
  createConditionalResultCompositionResolver,
  createSimultaneousCompositionResolver,
} from "./hand-written-effect-resolvers";
export type { EffectSourceKind } from "../source-kinds";

export interface EffectActionContext {
  effectEventAction?: string;
  chainId: string;
  resolutionKind:
    | "magic_action"
    | "field_card_effect_action"
    | "play_card_action"
    | "battle_immediate_effect"
    | "pending_triggered_effect"
    | "pending_burst_check";
  actingPlayerId: string;
  sourceKind: EffectSourceKind;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  /**
   * under-card など、場の source card と効果テキスト提供元が異なる場合の効果定義。
   * sourceDefinition は affect/source identity 用に実カード側を保持する。
   */
  effectSourceDefinition?: CardDefinition;
  /** P3-76/redirect 等へ渡す効果発揮元 instance。未指定時は sourceCard と同一。 */
  effectSourceInstanceId?: string;
  /** P3-76/redirect 等へ渡す効果発揮元 definition。未指定時は sourceDefinition と同一。 */
  effectSourceDefinitionId?: string;
  /**
   * 神技/導技 (`grandwalkerData.divineSkills[divineSkillIndex]`) 経由の解決であることを示す。
   * `queueHandWrittenTargetedDisclosureForResolver` が生成する `TargetedDisclosureContinuation`
   * へ転写し、top-level `effects[]` ではなく divineSkills 側への誤解決を防ぐ
   * (ENGINE-divine-skill-nested-effect-continuation、effect-interpreter.ts の
   * `ExecuteEffectOptions.divineSkillIndex` と同義)。
   */
  divineSkillIndex?: number;
  /** 指定時、`targetEffectIndex` は `sourceDefinition.accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`targetEffectIndex` は `sourceDefinition.changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  targetInstanceIds: string[];
  targetStepId?: string;
  targetSelectionResolved?: boolean;
  /** optional repeat で先に確定した基礎+追加の発揮回数。対象は各反復で選ぶ。 */
  optionalRepeatTargetCount?: number;
  /**
   * 対象開示後の再開では、宣言済み TargetRef を再取得しない。存在／対象 zone は
   * caller 側で確認済みであり、効果を受けるかは各 action の affect gate に委ねる。
   */
  preservePreSelectedTargetRefs?: boolean;
  skipTargetedDisclosureAtStartStep?: boolean;
  skipTargetedDisclosureStepId?: string;
  skipTargetedDisclosureTargetStartAtStartStep?: number;
  skipTargetedDisclosureTargetCountAtStartStep?: number;
  targetGroups?: readonly import("../model").PendingEffectTargetGroup[];
  sequentialTargetConsumption?: boolean;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /**
   * P3-37 follow-up + P3-39: action_resolution 経路で `collectAndQueueTriggerReactions`
   * にこの lookup を渡すために context に運ぶ (必須)。 未指定だとリスナー無し event
   * (after_draw / increase_hand 等) が空 pending として残留する不具合があった。
   * 通常は applyLegalAction の options.getRegisteredTriggeredEffectActions と同一参照。
   */
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /**
   * ENGINE-conditional-free-magic-use-target-selection: resolutionKind ===
   * "pending_triggered_effect" の use_magic_without_cost が対象選択を要する場合に
   * 本物の pendingEffectTargetSelection を生成するための窓口。
   */
  resolveDeferredStackForFreeMagicUse?: (
    state: GameState,
    stack: import("../model").ActiveStack
  ) => GameState;
  /**
   * ENGINE-free-magic-use-target-selection-nonfield-candidate-zones:
   * use_magic_without_cost の synthetic ActiveStack へ candidateTargetZones を
   * 引き継ぐための窓口 (resolveDeferredStackForFreeMagicUse と同型 plumbing)。
   */
  getRegisteredMagicActions?: import("../legal/legal-actions-types").MagicActionRegistrationLookup;
  chosenLifeCoreKind?: LifeCoreKind | null;
  forceLevel?: EffectForceLevel;
  choiceIndex?: number;
  /**
   * 解決中の pending triggered effect の同時誘発グループ ID。
   * stay_on_field アクションが同グループ内の関連 pending を撤回する際に使用。
   * resolutionKind === "pending_triggered_effect" の時のみ設定される。
   */
  pendingEffectSimultaneousGroupId?: string;
  /**
   * P3-129: 解決中の pending triggered effect 自身の pendingId。
   * resolutionKind === "pending_triggered_effect" の時のみ設定される。
   */
  pendingEffectPendingId?: string;
  /**
   * 「転醒は同時に使えない」の同一タイミング窓 ID。
   * battle immediate は prompt の attack/timing、pending triggered は simultaneousGroupId を使う。
   */
  rebirthTimingWindowId?: string;
  /**
   * P3-14 C-5: 解決中の誘発イベントの量 (pendingEffect.amount)。
   * `DynamicCount.event_amount` の解決元として executeEffect → stepCtx.eventAmount へ伝播する
   * (BSTH01-R02「このバトルで破壊した相手のスピリット/アルティメット1体につき」等)。
   */
  eventAmount?: number;
  /**
   * 解決中の誘発 pending の `relatedInstanceId` (主語 Y)。
   * `TargetSpec.kind === "trigger_related_instance"` の解決元として
   * executeEffect → stepCtx.triggerRelatedInstanceId へ伝播する
   * (BSTH05-X02『風神/アシハラ…バトル終了時…回復できる』等)。
   */
  triggerRelatedInstanceId?: string;
  triggerRelatedCombinedHostInstanceId?: string;
  triggerRelatedInstanceIds?: readonly string[];
  /**
   * 離脱トリガーが保持する煌臨元 instanceId スナップショット。
   * `SummonAction.from_zone.restrictToTriggerLeaveAdventSource` の解決元として
   * executeEffect → stepCtx.triggerAdventSourceInstanceIds へ伝播する
   * (BSSG01-C08 Lv2、engine-advent-source-leave-summon)。
   */
  triggerAdventSourceInstanceIds?: readonly string[];
  /**
   * 効果解決由来の without-cost 場入りが play-card pipeline を通る場合の source label。
   * この指定がある play_card_action は source 自身も effect enter-field cause 対象にする。
   */
  effectFieldEntrySource?: "burst_follow_up";
  /** play-card permission 由来 enter_field event の原因効果 index。 */
  sourceEffectIndex?: number;
  /**
   * DSL effects のタイミングフィルタ ("main" / "flash" / "stack")。
   * 省略時は全 effects が実行されるため、活性効果以外 (continuous / triggered) が
   * メイン/フラッシュ効果発揮で誤発動する可能性がある。tryExecuteEffects がこれを
   * 読んで activated effects のみを通すフィルタを適用する。
   */
  effectTimingFilter?: "main" | "flash" | "stack";
  /**
   * P3-30: 効果内 `pay_cost` step の支払いソース。
   * applyLegalAction → context → tryExecuteEffects → executeEffect へ伝播し、
   * effect-interpreter の pay_cost ハンドラが consume する。
   */
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  allowPendingPayCostSourceAllocation?: boolean;
  /**
   * P3-34 B: 効果起点 summon (summon_self / from_zone) のコスト支払い元。
   * 通常召喚 (playSummonAsAction) と同じ CardCostPaymentSource[] 形式で受け取り、
   * structured-effect-interpreter の executeSummonSelf / executeSummonOther が consume する。
   * 未指定時はリザーブ自動支払い fallback で動作。
   */
  summonPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /**
   * P3-34 B: 効果起点 summon のフィールド進入時コア配置。
   * 通常召喚と同じ EnterFieldCorePlacement[] 形式で受け取り、Lv2/Lv3 を狙う配置や
   * `天渡` 等 placement policy 検証を効果召喚にも適用する。
   * 未指定時は最小要求コアを reserve から自動配置する fallback。
   */
  summonEnterFieldCorePlacements?: readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[];
  /**
   * P3-43: 攻撃側効果の防止レベル (`registration.preventionLevel` 由来)。
   * `"unpreventable"` のとき `cannot_be_destroyed` 等の効果耐性 (cannot_*) を貫通する。
   * tryExecuteEffects → executeEffect → executeNativeAction → 離脱系 executor の
   * 経路で伝搬される。magic-system / card-effect-system / battle-immediate-effect-system /
   * play-card-resolution / legal-actions-apply (triggered) で registration から inject。
   */
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  /**
   * pending triggered effect の event source zone。
   * `trigger_from_zone` 条件を tryExecuteEffects → executeEffect の解決時再評価へ渡す。
   */
  triggerFromZone?: import("../model").Zone;
  triggeredRootConditionResults?: Readonly<Record<string, boolean>> | undefined;
  triggerCause?: import("../model").TriggerEventCause;
  /**
   * ENGINE-targeted-disclosure-offfield-source: pending triggered effect の
   * relatedInstanceId (対象化/観測対象カード) の現在ゾーン。
   * `trigger_related_instance_off_field` 条件を tryExecuteEffects → executeEffect の
   * 解決時再評価へ渡す (BSLH01-T14「フィールド以外で発揮中の…」)。
   */
  triggerRelatedInstanceZone?: import("../model").Zone;
  /**
   * engine-effect-tribe-tag-life-increase-trigger: pending triggered effect の原因カード
   * (`relatedInstanceId`) の実効系統 (`getEffectiveTribes` + `Effect.effectTribes` union)。
   * `trigger_tribes`/`trigger_source_match` 条件を tryExecuteEffects → executeEffect の
   * 解決時評価へ渡す (BSTH03-X02)。
   */
  triggerSourceTribes?: readonly string[];
  /**
   * engine-effect-tribe-tag-life-increase-trigger: pending triggered effect の原因カード
   * (`relatedInstanceId`) のコントローラー。`trigger_source_player` 条件を
   * tryExecuteEffects → executeEffect の解決時評価へ渡す (BSTH03-X02「自分の」限定)。
   */
  triggerSourcePlayerId?: string;
  /**
   * pending triggered effect の原因カード (`relatedInstanceId`) の instanceId。
   * `trigger_tribes.excludeSelfSource` 条件を tryExecuteEffects → executeEffect の
   * 解決時評価へ渡す (BSTH07-転醒R01(A)「このネクサス以外の」限定)。
   */
  triggerSourceInstanceId?: string;
  /**
   * P3-51: 解決対象とする `effects[]` の index。指定されると tryExecuteEffects は
   * その effect のみを実行し、同一 timing を持つ他の effect の重複発動を防ぐ。
   * battle-immediate / triggered prompt の dispatch 経路で
   * `registration.effectIndex` から inject する。
   * 未指定時は従来どおり timingFilter のみで絞り込む。
   */
  targetEffectIndex?: number;
  /**
   * P3-76 targeted disclosure event に載せる発揮元 action kind。
   * 未指定時は resolutionKind から復元する。
   */
  effectActionKind?: import("../model").EffectResolutionActionKind;
  /** バースト本体と交換処理が共有する、実効後処理ポリシーの移動先。 */
  burstPostResolutionDestination?: "burst" | "trash";
  /**
   * P3-75/P3-76 targeted disclosure event に載せる発揮タイミング。
   * "その効果がスタック効果のとき" 型の targeted responder が参照する。
   */
  effectActivationTiming?: EffectActivationTiming;
  /**
   * この効果 (マジック/フラッシュ) が宣言時に発動されたゾーン (手札/手元/トラッシュ)。
   * `StepCondition.kind === "activation_zone"` の解決元 (ENGINE-magic-activation-source-zone-condition)。
   * tryExecuteEffects 経由で executeEffect の options.activationZone へ転写される。
   */
  activationZone?: EffectActivationSourceZone;
  /**
   * source を in_use に移した後の初回 applicability 判定だけで使う元ゾーン。
   * 発動ゾーンそのものではないため、step condition / battle-end defer には使わない。
   */
  applicabilityEvaluationZone?: EffectActivationSourceZone;
  /**
   * P3-62: 「発揮できない」(condition unmet / conditional_cost rollback) と判定された
   * 際に usageLimit を払い戻すために必要な情報。caller は recordEffectUsageIfLimited
   * 呼び出しと対になる effectLabel / usageLimit を入れる。tryExecuteEffects 経由で
   * executeEffect に伝搬される。
   */
  recordedUsage?: import("../model").RecordedEffectUsage;
  /**
   * マジック使用時の神託など、元アクションの全 pending が閉じた後に発火する oracle hook。
   * hand-written resolver / MagicEffectResolver が executeEffect で pending を生成する場合に
   * この値を渡すことで、元効果の解決完了まで神託を遅延させる。
   */
  postResolutionOracle?: import("../model").PostResolutionOracleTrigger;
  /**
   * stack 解決中の negate が対象にする直下 stack。structured effect fallback で
   * negate step の StepResult に対象発生源を記録するために伝搬する。
   */
  pendingStackNegateCandidate?: import("../model").ActiveStack | null;
  /**
   * P3-131層2: この解決を駆動している元 ActiveStack のスナップショット。
   * queueTargetedDisclosureForStep が生成する continuation へ転写し、negate 応答照合にのみ使う。
   */
  targetedDisclosureNegateIdentity?: import("../model").ActiveStack;
  /**
   * Battle-sourced pending effects can resolve after activeAttack has been cleared.
   * Preserve the originating attack id for battle-end deferred steps and CE scope.
   */
  battleEndDeferralAttackId?: string;
}

export type HandWrittenEffectResolver = (
  state: GameState,
  context: EffectActionContext
) => GameState;

export type HandWrittenEffectResolverLookup = (
  cardNo: string
) => HandWrittenEffectResolver | undefined;

/**
 * conditional_cost composition の双方向チェック用述語。
 * 指定ステップが現在の state / context で実行可能かを返す。
 */
export type ConditionalCostCanExecuteCheck = (
  state: GameState,
  context: EffectActionContext
) => boolean;

/**
 * conditional_result composition の成功判定述語。
 * step 0 の実行前後の state を比較し、アクションが「成功した」かを返す。
 */
export type ConditionalResultSuccessCheck = (
  preState: GameState,
  postState: GameState,
  context: EffectActionContext
) => boolean;

export function executeHandWrittenEffectResolver(options: {
  state: GameState;
  context: EffectActionContext;
  getResolver: HandWrittenEffectResolverLookup;
}): GameState {
  const resolver = options.getResolver(
    options.context.effectSourceDefinition?.cardNo ??
      options.context.sourceDefinition.cardNo
  );

  if (resolver) {
    return resolver(options.state, options.context);
  }
  // hand-written resolver なし → StructuredEffect fallback
  return tryExecuteStructuredEffects(options.state, options.context);
}

/**
 * ステップリゾルバの型安全アクセサ。
 * (cardNo, stepIndex) のタプルで検索する。文字列キー不要。
 */
export type StepResolverAccessor = (
  cardNo: string,
  stepIndex: number
) => HandWrittenEffectResolver | undefined;

/**
 * canExecute チェックの型安全アクセサ。
 */
export type CanExecuteCheckAccessor = (
  cardNo: string,
  stepIndex: number
) => ConditionalCostCanExecuteCheck | undefined;

/**
 * successCheck の型安全アクセサ。
 */
export type SuccessCheckAccessor = (
  cardNo: string,
  stepIndex: number
) => ConditionalResultSuccessCheck | undefined;

/**
 * 登録 action の composition メタデータから、ステップ別 resolver を
 * 結合した HandWrittenEffectResolver を構築する。
 *
 * ステップ別 resolver は `${cardNo}:step:${index}` キーで lookup される。
 * canExecuteCheck / successCheck は (cardNo, stepIndex) タプルで検索。
 *
 * 対応する resolver が見つからない場合は undefined を返す。
 */
export function buildComposedResolverFromComposition(
  getResolver: HandWrittenEffectResolverLookup,
  cardNo: string,
  composition: EffectComposition,
  getCanExecuteCheck?: CanExecuteCheckAccessor,
  getSuccessCheck?: SuccessCheckAccessor
): HandWrittenEffectResolver | undefined {
  return buildComposedResolverTyped(
    (cn, step) => getResolver(`${cn}:step:${step}`),
    cardNo,
    composition,
    getCanExecuteCheck,
    getSuccessCheck
  );
}

/**
 * 型安全版: (cardNo, stepIndex) タプルでステップリゾルバを検索する。
 * 文字列キーの構築を排除し、登録漏れをコンパイル時に検出しやすくする。
 */
export function buildComposedResolverTyped(
  getStepResolver: StepResolverAccessor,
  cardNo: string,
  composition: EffectComposition,
  getCanExecuteCheck?: CanExecuteCheckAccessor,
  getSuccessCheck?: SuccessCheckAccessor
): HandWrittenEffectResolver | undefined {
  if (composition.kind === "simultaneous") {
    const stepResolvers: HandWrittenEffectResolver[] = [];
    for (let i = 0; i < composition.steps.length; i++) {
      const resolver = getStepResolver(cardNo, i);
      if (!resolver) {
        // simultaneous composition is atomic — all steps must have resolvers.
        return undefined;
      }
      stepResolvers.push(resolver);
    }

    if (stepResolvers.length === 0) {
      return undefined;
    }

    return stepResolvers.length === 1
      ? stepResolvers[0]
      : createSimultaneousCompositionResolver(stepResolvers);
  }

  if (composition.kind === "conditional_cost") {
    // conditional_cost requires exactly 2 steps: cost (step 0) + result (step 1).
    if (composition.steps.length < 2) {
      return undefined;
    }

    const costResolver = getStepResolver(cardNo, 0);
    const resultResolver = getStepResolver(cardNo, 1);

    if (!costResolver || !resultResolver) {
      return undefined;
    }

    const canExecuteCost = getCanExecuteCheck?.(cardNo, 0);
    const canExecuteResult = getCanExecuteCheck?.(cardNo, 1);

    return createConditionalCostCompositionResolver(
      costResolver,
      resultResolver,
      canExecuteCost,
      canExecuteResult
    );
  }

  if (composition.kind === "conditional_result") {
    // conditional_result requires exactly 2 steps: action (step 0) + result (step 1).
    if (composition.steps.length < 2) {
      return undefined;
    }

    const actionResolver = getStepResolver(cardNo, 0);
    const resultResolver = getStepResolver(cardNo, 1);

    if (!actionResolver || !resultResolver) {
      return undefined;
    }

    const successCheck = getSuccessCheck?.(cardNo, 0);

    return createConditionalResultCompositionResolver(
      actionResolver,
      resultResolver,
      successCheck
    );
  }

  return undefined;
}

export type ActionMainResolutionOptions<Context> = {
  state: GameState;
  chainId: string;
  startLogs: readonly string[];
  endLogs: readonly string[];
  context: Context;
  triggerBeforeState?: GameState;
  resolveEffect?: (state: GameState, context: Context) => GameState;
  reevaluation?: ReevaluationConfig;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
};
export function runActionMainResolution<Context>(
  options: ActionMainResolutionOptions<Context>
): GameState;
export function runActionMainResolution<
  Context extends EffectActionContext,
>(options: {
  state: GameState;
  chainId: string;
  startLogs: readonly string[];
  endLogs: readonly string[];
  context: Context;
  triggerBeforeState?: GameState;
  getHandWrittenEffectResolver: HandWrittenEffectResolverLookup;
  resolveEffect?: never;
  reevaluation?: ReevaluationConfig;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
}): GameState;
export function runActionMainResolution<Context>(options: {
  state: GameState;
  chainId: string;
  startLogs: readonly string[];
  endLogs: readonly string[];
  context: Context;
  triggerBeforeState?: GameState;
  resolveEffect?: (state: GameState, context: Context) => GameState;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  reevaluation?: ReevaluationConfig;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
}): GameState {
  if (options.state.gameResult !== null) return options.state;
  const stateBeforeResolution = options.state;
  let currentState = setEffectQueueEntries(
    {
      ...options.state,
      log: [...options.state.log, ...options.startLogs],
    },
    [createChainResolveEffectQueueEntry(options.chainId)]
  );

  // P3-75/effect_suppression: 「発揮させない」は効果本体の実行前に判定する。
  // ここで失敗した場合、draw 等の本体ステップは走らせず、SBA/後処理だけ通常経路へ流す。
  const sbaActingPlayerId = (
    options.context as Pick<EffectActionContext, "actingPlayerId">
  ).actingPlayerId;
  const ctxRequired = options.context as Pick<
    EffectActionContext,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >;
  const contextWithSrc = options.context as
    | {
        sourceDefinition?: CardDefinition;
        sourceCard?: CardInstance;
        sourceInstanceId?: string;
        resolutionKind?: EffectActionContext["resolutionKind"];
        effectFieldEntrySource?: "burst_follow_up";
        sourceEffectIndex?: number;
        sourcePreventionLevel?: EffectActionContext["sourcePreventionLevel"];
        sourcePreventionBypass?: EffectActionContext["sourcePreventionBypass"];
        battleEndDeferralAttackId?: string;
      }
    | undefined;
  // enter-field cause is consumed only for instances with effect enter-field
  // logs. During normal play, exclude the played source itself so the source
  // summon/place remains cause-less, while any nested effect summon/place in the
  // same resolution still keeps its effect cause.
  const enterFieldCausedByPlayerId = sbaActingPlayerId ?? null;
  const playCardSourceInstanceId =
    contextWithSrc?.resolutionKind === "play_card_action" &&
    contextWithSrc.effectFieldEntrySource === undefined
      ? (contextWithSrc.sourceCard?.instanceId ??
        contextWithSrc.sourceInstanceId ??
        null)
      : null;
  const enterFieldCauseExcludedInstanceIds =
    playCardSourceInstanceId !== null ? [playCardSourceInstanceId] : undefined;

  if (options.reevaluation) {
    const preReeval = runReevaluationAtTiming({
      state: currentState,
      registration: options.reevaluation.registration,
      timing: "before_each_step",
      sourceInstanceId: options.reevaluation.sourceInstanceId,
      targetInstanceIds: options.reevaluation.targetInstanceIds,
      getCardDefinitionById: ctxRequired.getCardDefinitionById,
      ...(contextWithSrc?.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: contextWithSrc.sourcePreventionLevel }
        : {}),
      ...(contextWithSrc?.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: contextWithSrc.sourcePreventionBypass }
        : {}),
      ...(options.reevaluation.suppressionEffectDescriptor !== undefined
        ? {
            suppressionEffectDescriptor:
              options.reevaluation.suppressionEffectDescriptor,
          }
        : {}),
    });
    if (!preReeval.passed) {
      const failedSourceInstanceId =
        contextWithSrc?.sourceCard?.instanceId ??
        contextWithSrc?.sourceInstanceId ??
        "unknown";
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `reevaluation:before_each_step:failed:${preReeval.failedChecks.join(",")}:${preReeval.failurePolicy}:source=${failedSourceInstanceId}`,
        ],
      };
      return finalizeEffectResolution({
        state: currentState,
        beforeState: options.triggerBeforeState ?? stateBeforeResolution,
        chainId: options.chainId,
        endLogs: options.endLogs,
        actingPlayerId: sbaActingPlayerId,
        getCardDefinitionById: ctxRequired.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          ctxRequired.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: ctxRequired.getRegisteredBurstActions,
        sourceColors: getEffectiveColors(
          currentState,
          contextWithSrc?.sourceCard,
          contextWithSrc?.sourceDefinition
        ),
        sourceCategory: contextWithSrc?.sourceDefinition?.printedCategory,
        causedBySourceInstanceId:
          contextWithSrc?.sourceCard?.instanceId ??
          contextWithSrc?.sourceInstanceId ??
          null,
        ...(enterFieldCausedByPlayerId !== undefined
          ? { enterFieldCausedByPlayerId }
          : {}),
        ...(enterFieldCauseExcludedInstanceIds !== undefined
          ? { enterFieldCauseExcludedInstanceIds }
          : {}),
        ...(contextWithSrc?.sourceEffectIndex !== undefined
          ? { sourceEffectIndex: contextWithSrc.sourceEffectIndex }
          : {}),
        ...(contextWithSrc?.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: contextWithSrc.sourcePreventionLevel }
          : {}),
        ...(contextWithSrc?.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: contextWithSrc.sourcePreventionBypass }
          : {}),
        ...(contextWithSrc?.battleEndDeferralAttackId !== undefined
          ? {
              battleEndDeferralAttackId:
                contextWithSrc.battleEndDeferralAttackId,
            }
          : {}),
        ...(options.supplementalTriggerEvents !== undefined
          ? { supplementalTriggerEvents: options.supplementalTriggerEvents }
          : {}),
        ...(options.suppressCausedLeaveEffectsForSourceInstanceId !== undefined
          ? {
              suppressCausedLeaveEffectsForSourceInstanceId:
                options.suppressCausedLeaveEffectsForSourceInstanceId,
            }
          : {}),
      });
    }
  }

  if (options.getHandWrittenEffectResolver) {
    const ctx = options.context as EffectActionContext;
    const resolver = options.getHandWrittenEffectResolver(
      ctx.effectSourceDefinition?.cardNo ?? ctx.sourceDefinition.cardNo
    );
    if (resolver) {
      const disclosure = queueHandWrittenTargetedDisclosureForResolver({
        state: currentState,
        context: ctx,
        chainId: options.chainId,
        endLogs: options.endLogs,
        effectResolutionBeforeState:
          options.triggerBeforeState ?? stateBeforeResolution,
      });
      if (disclosure.queued) {
        return disclosure.state;
      }
    }
  }

  if (options.resolveEffect) {
    currentState = options.resolveEffect(currentState, options.context);
  } else if (options.getHandWrittenEffectResolver) {
    const resolverLookup = options.getHandWrittenEffectResolver;
    const ctx = options.context as EffectActionContext;
    const resolver = resolverLookup(
      ctx.effectSourceDefinition?.cardNo ?? ctx.sourceDefinition.cardNo
    );
    if (resolver) {
      currentState = resolver(currentState, ctx);
    } else {
      // 手書き resolver なし → StructuredEffect fallback
      currentState = tryExecuteStructuredEffects(currentState, options.context);
    }
  } else {
    // resolveEffect も getHandWrittenEffectResolver もなし → StructuredEffect fallback
    currentState = tryExecuteStructuredEffects(currentState, options.context);
  }
  // P3-108 Item3 (Stage 3, endLog 早期化の最小対処): resolveEffect が mid-effect 継続で
  // プレイヤー入力待ちに中断した場合、この finalize は効果未完の盤面で走る。endLogs
  // (`<kind>:resolve-main:end` 等) をここで出すと GUI ログが「効果終了」を早期表示する。
  // よって中断時は endLogs を出さず pendingResolutionEndLogs に退避し、効果が真に閉じた
  // 時点 (applyLegalAction の drain) で log へ流す。誘発収集/神託のタイミングは不変。
  const paused = hasOutstandingEffectResolutionContinuation(currentState);
  const triggerBeforeState =
    options.triggerBeforeState ?? stateBeforeResolution;
  // 維持コア配置待ちのカードは、まだ召喚/配置の完了境界に到達していない。
  // 外側の action resolution が中断盤面を finalize すると zone delta だけで場入り誘発を
  // 先に積み、pendingMultiPlacement 解決時の正式な場入りイベントと二重になるため、
  // この中間 finalize に限って対象カードを before 側にも現在値で写して差分から隠す。
  // 配置解決側は priorStateSnapshot を beforeState にして一度だけ誘発を収集する。
  const pendingPlacementTargetIds = new Set(
    getMultiPlacementTargets(currentState.pendingMultiPlacement).map(
      (target) => target.instanceId
    ) ?? []
  );
  const finalizationBeforeState =
    paused && pendingPlacementTargetIds.size > 0
      ? replaceCardInstances(
          {
            ...triggerBeforeState,
          },
          [
            ...triggerBeforeState.cardInstances.map((beforeCard) =>
              pendingPlacementTargetIds.has(beforeCard.instanceId)
                ? (currentState.cardInstances.find(
                    (currentCard) =>
                      currentCard.instanceId === beforeCard.instanceId
                  ) ?? beforeCard)
                : beforeCard
            ),
            // 手札/トラッシュ等から新たに場へ出たカードは before 側に存在しない。
            // 置換だけでは隠せないため、中断中の現在値を before snapshot に補う。
            ...currentState.cardInstances.filter(
              (currentCard) =>
                pendingPlacementTargetIds.has(currentCard.instanceId) &&
                !triggerBeforeState.cardInstances.some(
                  (beforeCard) =>
                    beforeCard.instanceId === currentCard.instanceId
                )
            ),
          ]
        )
      : triggerBeforeState;
  // P3-68 ギャップ 2: コア不足消滅の causePlayerId を解決中効果のコントローラに帰属させ、
  // 相手のコア奪取由来の消滅を「相手によって離れた」と判定可能にする。
  // P3-39 で context.getCardDefinitionById / lookup 群は必須化済み。
  const finalized = finalizeEffectResolution({
    state: currentState,
    beforeState: finalizationBeforeState,
    chainId: options.chainId,
    endLogs: paused ? [] : options.endLogs,
    actingPlayerId: sbaActingPlayerId,
    getCardDefinitionById: ctxRequired.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      ctxRequired.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: ctxRequired.getRegisteredBurstActions,
    sourceColors: getEffectiveColors(
      currentState,
      contextWithSrc?.sourceCard,
      contextWithSrc?.sourceDefinition
    ),
    sourceCategory: contextWithSrc?.sourceDefinition?.printedCategory,
    causedBySourceInstanceId:
      contextWithSrc?.sourceCard?.instanceId ??
      contextWithSrc?.sourceInstanceId ??
      null,
    ...(enterFieldCausedByPlayerId !== undefined
      ? { enterFieldCausedByPlayerId }
      : {}),
    ...(enterFieldCauseExcludedInstanceIds !== undefined
      ? { enterFieldCauseExcludedInstanceIds }
      : {}),
    ...(contextWithSrc?.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: contextWithSrc.sourceEffectIndex }
      : {}),
    ...(contextWithSrc?.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: contextWithSrc.sourcePreventionLevel }
      : {}),
    ...(contextWithSrc?.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: contextWithSrc.sourcePreventionBypass }
      : {}),
    ...(contextWithSrc?.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: contextWithSrc.battleEndDeferralAttackId }
      : {}),
    ...(options.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: options.supplementalTriggerEvents }
      : {}),
    ...(options.suppressCausedLeaveEffectsForSourceInstanceId !== undefined
      ? {
          suppressCausedLeaveEffectsForSourceInstanceId:
            options.suppressCausedLeaveEffectsForSourceInstanceId,
        }
      : {}),
    ...(options.reevaluation ? { reevaluation: options.reevaluation } : {}),
  });
  if (paused && options.endLogs.length > 0) {
    return {
      ...finalized,
      pendingResolutionEndLogs: [
        ...(finalized.pendingResolutionEndLogs ?? []),
        ...options.endLogs,
      ],
    };
  }
  return finalized;
}

function hasImplementedTargetedResponderForResolution(options: {
  state: GameState;
  event: CollectedTriggerEvent;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}): boolean {
  const pendingEffect: PendingTriggeredEffect = {
    pendingId: `targeted-probe:${options.event.chainId ?? "none"}:${options.event.relatedInstanceId ?? "none"}`,
    actingPlayerId: options.event.actingPlayerId,
    eventKind: "targeted",
    event: {
      family: "targeting",
      ...(options.event.cause !== undefined
        ? { cause: options.event.cause }
        : {}),
      ...(options.event.effectActivationTiming !== undefined
        ? { effectActivationTiming: options.event.effectActivationTiming }
        : {}),
      validationMode: "require_related_instance_on_field",
    },
    source: options.event.source,
    chainId: requireTriggerChainId(options.event.chainId),
    attackId: options.event.attackId,
    relatedPlayerId: options.event.relatedPlayerId,
    relatedInstanceId: options.event.relatedInstanceId,
    ...(options.event.cause !== undefined
      ? { cause: options.event.cause }
      : {}),
    amount: options.event.amount,
    step: options.state.step,
    window: options.state.window,
    resolvedSourceInstanceIds: [],
    ...(options.event.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.event.effectSourceInstanceId }
      : {}),
    ...(options.event.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.event.effectSourceDefinitionId }
      : {}),
    ...(options.event.effectActionKind !== undefined
      ? { effectActionKind: options.event.effectActionKind }
      : {}),
    ...(options.event.effectActivationTiming !== undefined
      ? { effectActivationTiming: options.event.effectActivationTiming }
      : {}),
  };
  const choices = getAvailableTriggeredEffectSourceChoices({
    state: options.state,
    pendingEffect,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
  return choices.some((choice) => {
    const effectIndex = choice.actionRegistration.effectIndex;
    const effect =
      effectIndex !== undefined
        ? choice.sourceEffectDefinition.effects?.[effectIndex]
        : undefined;
    if (!effect) return false;
    return !(effect.stub && effect.steps.length === 0);
  });
}

function queueHandWrittenTargetedDisclosureForResolver(options: {
  state: GameState;
  context: EffectActionContext;
  chainId: string;
  endLogs: readonly string[];
  effectResolutionBeforeState: GameState;
}): { state: GameState; queued: boolean } {
  const targetInstanceIds = options.context.targetInstanceIds;
  if (targetInstanceIds.length === 0) {
    return { state: options.state, queued: false };
  }

  const uniqueTargetInstanceIds: string[] = [];
  const seen = new Set<string>();
  for (const targetInstanceId of targetInstanceIds) {
    if (seen.has(targetInstanceId)) continue;
    seen.add(targetInstanceId);
    uniqueTargetInstanceIds.push(targetInstanceId);
  }

  const events: CollectedTriggerEvent[] = [];
  for (const [
    targetIndex,
    targetInstanceId,
  ] of uniqueTargetInstanceIds.entries()) {
    // ENGINE-targeted-disclosure-offfield-source: フィールド外で自身の効果が
    // 発揮中 (= 開いている応答窓の保留 ActiveStack 鎖に自身の instanceId が乗って
    // いる) の対象も disclosure に含める (BSLH01-T14 型)。他の disclosure call
    // site (effect-target-handlers.ts / native-effect-front-helpers.ts) と同じ
    // isInstanceInOpenResponseWindowOrPendingCascade を使う (SSOT)。
    const target = options.state.cardInstances.find(
      (card) =>
        card.instanceId === targetInstanceId &&
        (card.zone === "field" ||
          isInstanceInOpenResponseWindowOrPendingCascade(
            options.state,
            targetInstanceId
          ))
    );
    if (!target) continue;
    const cause =
      target.controllerPlayerId === options.context.actingPlayerId
        ? "self_effect"
        : "opponent_effect";
    events.push({
      actingPlayerId: target.controllerPlayerId,
      eventKind: "targeted",
      source: "action_resolution",
      chainId: `${options.chainId}:target:${targetIndex}`,
      attackId: options.state.activeAttack?.attackId ?? null,
      relatedPlayerId: target.controllerPlayerId,
      relatedInstanceId: target.instanceId,
      cause,
      amount: 1,
      effectSourceInstanceId:
        options.context.effectSourceInstanceId ??
        options.context.sourceCard.instanceId,
      effectSourceDefinitionId:
        options.context.effectSourceDefinitionId ??
        options.context.effectSourceDefinition?.cardNo ??
        options.context.sourceDefinition.cardNo,
      ...(options.context.effectActionKind !== undefined
        ? { effectActionKind: options.context.effectActionKind }
        : {}),
      ...(options.context.effectActivationTiming !== undefined
        ? { effectActivationTiming: options.context.effectActivationTiming }
        : {}),
    });
  }

  const implementedEvents = events.filter((event) =>
    hasImplementedTargetedResponderForResolution({
      state: options.state,
      event,
      getCardDefinitionById: options.context.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.context.getRegisteredTriggeredEffectActions,
    })
  );
  if (implementedEvents.length === 0) {
    return { state: options.state, queued: false };
  }

  const beforePendingCount =
    options.state.pendingTriggeredEffects.length +
    options.state.pendingPrivateDeclarations.length +
    options.state.pendingBurstChecks.length;
  const queuedState = queuePendingReactionsFromTriggerEvents(
    options.state,
    implementedEvents,
    undefined,
    {
      getCardDefinitionById: options.context.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.context.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.context.getRegisteredBurstActions,
    }
  );
  const afterPendingCount =
    queuedState.pendingTriggeredEffects.length +
    queuedState.pendingPrivateDeclarations.length +
    queuedState.pendingBurstChecks.length;
  if (afterPendingCount <= beforePendingCount) {
    return { state: queuedState, queued: false };
  }

  const previousContinuation =
    options.state.pendingTargetedDisclosureContinuation;
  const targetStepId = options.context.targetStepId ?? "__hand_written__";
  const pendingId = `targeted-disclosure:${options.chainId}:hand-written:${queuedState.pendingTriggeredEffects.length}`;
  const continuation: TargetedDisclosureContinuation = {
    pendingId,
    chainId: requireTriggerChainId(options.chainId),
    sourceDefinitionId:
      options.context.effectSourceDefinition?.cardNo ??
      options.context.sourceDefinition.cardNo,
    effectIndex: options.context.targetEffectIndex ?? 0,
    sourceInstanceId: options.context.sourceCard.instanceId,
    ...(options.context.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.context.effectSourceInstanceId }
      : {}),
    ...(options.context.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.context.effectSourceDefinitionId }
      : {}),
    ...(options.context.effectActionKind !== undefined
      ? { effectActionKind: options.context.effectActionKind }
      : {}),
    ...(options.context.effectActivationTiming !== undefined
      ? { effectActivationTiming: options.context.effectActivationTiming }
      : {}),
    actingPlayerId: options.context.actingPlayerId,
    resumeStepIndex: 0,
    stepContext: { results: {} },
    targetInstanceIds: [...targetInstanceIds],
    targetZonesByInstanceId: snapshotTargetedDisclosureTargetZones(
      queuedState,
      targetInstanceIds
    ),
    ...(options.context.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.context.divineSkillIndex }
      : {}),
    ...(options.context.isAccelData !== undefined
      ? { isAccelData: options.context.isAccelData }
      : {}),
    ...(options.context.isChangeData !== undefined
      ? { isChangeData: options.context.isChangeData }
      : {}),
    ...(options.context.targetGroups !== undefined
      ? { targetGroups: [...options.context.targetGroups] }
      : {}),
    ...(options.context.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    targetStepId,
    remainingStacks: [],
    effectResolutionBeforeState: options.effectResolutionBeforeState,
    ...(options.context.choiceIndex !== undefined
      ? { choiceIndex: options.context.choiceIndex }
      : {}),
    ...(options.context.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: options.context.sourcePreventionLevel }
      : {}),
    ...(options.context.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.context.sourcePreventionBypass }
      : {}),
    ...(options.context.triggerFromZone !== undefined
      ? { triggerFromZone: options.context.triggerFromZone }
      : {}),
    ...(options.context.triggerCause !== undefined
      ? { triggerCause: options.context.triggerCause }
      : {}),
    ...(options.context.triggerRelatedInstanceZone !== undefined
      ? {
          triggerRelatedInstanceZone:
            options.context.triggerRelatedInstanceZone,
        }
      : {}),
    ...(options.context.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: options.context.battleEndDeferralAttackId }
      : {}),
    ...(options.context.targetedDisclosureNegateIdentity !== undefined
      ? {
          negateIdentitySnapshot:
            options.context.targetedDisclosureNegateIdentity,
        }
      : {}),
    handWrittenResolution: {
      chainId: options.chainId,
      resolutionKind: options.context.resolutionKind,
      sourceKind: options.context.sourceKind,
      sourceCard: options.context.sourceCard,
      targetInstanceIds: [...targetInstanceIds],
      ...(options.context.targetStepId !== undefined
        ? { targetStepId: options.context.targetStepId }
        : {}),
      ...(options.context.targetGroups !== undefined
        ? { targetGroups: [...options.context.targetGroups] }
        : {}),
      ...(options.context.sequentialTargetConsumption === true
        ? { sequentialTargetConsumption: true }
        : {}),
      endLogs: [...options.endLogs],
      ...(options.context.choiceIndex !== undefined
        ? { choiceIndex: options.context.choiceIndex }
        : {}),
      ...(options.context.effectActionKind !== undefined
        ? { effectActionKind: options.context.effectActionKind }
        : {}),
      ...(options.context.effectActivationTiming !== undefined
        ? { effectActivationTiming: options.context.effectActivationTiming }
        : {}),
      ...(options.context.forceLevel !== undefined
        ? { forceLevel: options.context.forceLevel }
        : {}),
      ...(options.context.pendingEffectSimultaneousGroupId !== undefined
        ? {
            pendingEffectSimultaneousGroupId:
              options.context.pendingEffectSimultaneousGroupId,
          }
        : {}),
      ...(options.context.pendingEffectPendingId !== undefined
        ? {
            pendingEffectPendingId: options.context.pendingEffectPendingId,
          }
        : {}),
      ...(options.context.eventAmount !== undefined
        ? { eventAmount: options.context.eventAmount }
        : {}),
      ...(options.context.effectFieldEntrySource !== undefined
        ? { effectFieldEntrySource: options.context.effectFieldEntrySource }
        : {}),
      ...(options.context.effectTimingFilter !== undefined
        ? { effectTimingFilter: options.context.effectTimingFilter }
        : {}),
      ...(options.context.effectEventAction !== undefined
        ? { effectEventAction: options.context.effectEventAction }
        : {}),
      ...(options.context.divineSkillIndex !== undefined
        ? { divineSkillIndex: options.context.divineSkillIndex }
        : {}),
      ...(options.context.isAccelData !== undefined
        ? { isAccelData: options.context.isAccelData }
        : {}),
      ...(options.context.isChangeData !== undefined
        ? { isChangeData: options.context.isChangeData }
        : {}),
      ...(options.context.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: options.context.sourcePreventionLevel }
        : {}),
      ...(options.context.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: options.context.sourcePreventionBypass }
        : {}),
      ...(options.context.triggerFromZone !== undefined
        ? { triggerFromZone: options.context.triggerFromZone }
        : {}),
      ...(options.context.triggerCause !== undefined
        ? { triggerCause: options.context.triggerCause }
        : {}),
      ...(options.context.triggerRelatedInstanceZone !== undefined
        ? {
            triggerRelatedInstanceZone:
              options.context.triggerRelatedInstanceZone,
          }
        : {}),
      ...(options.context.triggerRelatedCombinedHostInstanceId !== undefined
        ? {
            triggerRelatedCombinedHostInstanceId:
              options.context.triggerRelatedCombinedHostInstanceId,
          }
        : {}),
      ...(options.context.payCostPaymentSources !== undefined
        ? { payCostPaymentSources: options.context.payCostPaymentSources }
        : {}),
      ...(options.context.allowPendingPayCostSourceAllocation === true
        ? { allowPendingPayCostSourceAllocation: true }
        : {}),
      ...(options.context.summonPaymentSources !== undefined
        ? { summonPaymentSources: options.context.summonPaymentSources }
        : {}),
      ...(options.context.summonEnterFieldCorePlacements !== undefined
        ? {
            summonEnterFieldCorePlacements:
              options.context.summonEnterFieldCorePlacements,
          }
        : {}),
    },
    ...(previousContinuation !== null
      ? { previousTargetedDisclosureContinuation: previousContinuation }
      : {}),
  };

  return {
    state: {
      ...queuedState,
      pendingTargetedDisclosureContinuation: continuation,
      log: [
        ...queuedState.log,
        `effect:target-disclosure:queued:${options.chainId}:${targetInstanceIds.join(",")}`,
      ],
    },
    queued: true,
  };
}

/**
 * P3-47 F-6: 効果解決の finalization を共有する。
 *
 * `runActionMainResolution` の resolve 後処理 (SBA → CE 再計算 → BP 反映 →
 * after_sba reevaluation → endLogs/queue クリア → トリガー収集 → 神託 →
 * pending-leave flush) を切り出したもの。
 *
 * コア配分 / 複数体配置の continuation resume 経路
 * (`applyPendingCoreDistributionAction` / `applyPendingMultiPlacementAction`) は
 * resume 後に `executeEffect` を呼んだだけで finalization を一切通していなかった。
 * その結果、resume したステップで act_as_spirit (分身) CE が付与され 0 コアになった
 * 疑似スピリットが、コア不足消滅 SBA を経由せず場に残っていた
 * (フランドール【フォーオブアカインド】のコア配分後)。継続経路からも本関数を呼んで
 * 通常解決と同じ finalization を通す。
 */
export function finalizeEffectResolution(options: {
  /** resolve / resume 済みの現在 state。 */
  state: GameState;
  /** トリガー収集・神託判定の before-state (= resolve / resume 開始前)。 */
  beforeState: GameState;
  chainId: string;
  endLogs: readonly string[];
  /** SBA / トリガーの cause 帰属プレイヤー (= 効果コントローラ)。 */
  actingPlayerId?: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
  /** flushPendingLeaves に渡す source カードの色 (leave トリガー文脈)。 */
  sourceColors?: Parameters<typeof flushPendingLeaves>[2];
  /** flushPendingLeaves に渡す source カードの印字カテゴリ (leave トリガー文脈)。 */
  sourceCategory?: Parameters<typeof flushPendingLeaves>[3];
  /**
   * この効果解決の発揮元カード。state delta 由来の二次イベントへ転写し、
   * 「特定カード/系統を持つ効果で増えた・減った」系の判定に使う。
   * 検証用など発揮元を持たない呼び出しは null を明示する。
   */
  causedBySourceInstanceId: string | null;
  /** 効果解決由来の per-instance 場入りログにだけ cause を付ける actor。 */
  enterFieldCausedByPlayerId?: string | null;
  /** 同じ diff 内でも cause を付けない場入り instance。 */
  enterFieldCauseExcludedInstanceIds?: readonly string[];
  /** play-card permission 由来 enter_field event の原因効果 index。 */
  sourceEffectIndex?: number;
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  battleEndDeferralAttackId?: string;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
  reevaluation?: ReevaluationConfig;
}): GameState {
  if (options.state.gameResult !== null) return options.state;
  const sbaActingPlayerId = options.actingPlayerId;
  // P3-47 F-2: getCardDefinitionById を渡さないと act_as_spirit 付与の裏向きトークンが
  // SBA の faceDown スキップに落ち、コア不足消滅 (実効最低コアは override levelDefs 由来) を
  // 取りこぼす。
  let currentState = runStateBasedActions(
    options.state,
    options.getCardDefinitionById,
    sbaActingPlayerId,
    options.causedBySourceInstanceId ?? null
  ).state;
  // P3-20 ギャップ B: continuous 効果の condition / applicability を動的再評価して
  // 不成立になった CE を除去し、新たに条件を満たした CE を再登録する。
  currentState = recomputeAndRebuildContinuousEffects(
    currentState,
    options.getCardDefinitionById
  );

  // bp_modifier CE を BattleEntity.resolvedBp に反映
  currentState = recomputeBattleEntityBp(
    currentState,
    options.getCardDefinitionById
  );

  // after_sba 再評価ポイント
  if (options.reevaluation) {
    const reeval = runReevaluationAtTiming({
      state: currentState,
      registration: options.reevaluation.registration,
      timing: "after_sba",
      sourceInstanceId: options.reevaluation.sourceInstanceId,
      targetInstanceIds: options.reevaluation.targetInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: options.sourcePreventionLevel }
        : {}),
      ...(options.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: options.sourcePreventionBypass }
        : {}),
      ...(options.reevaluation.suppressionEffectDescriptor !== undefined
        ? {
            suppressionEffectDescriptor:
              options.reevaluation.suppressionEffectDescriptor,
          }
        : {}),
    });
    if (!reeval.passed) {
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `reevaluation:after_sba:failed:${reeval.failedChecks.join(",")}:${reeval.failurePolicy}`,
        ],
      };
      // failurePolicy に基づく runtime 動作:
      // abort_remaining / skip_step: 本体解決後の誘発収集をスキップして早期 return。
      // ただし pending leave の実移動で発生する leave_field は、flush 差分から通常通り収集する。
      // remove_target: 単ステップでは abort 同等 (将来の多段解決で対象除外に拡張)
      // pending leave の flush は行う (SBA でフィールドを離れたカードを正しく処理)。
      const stateBeforeFlush = pruneIllegalPendingTriggeredEffects({
        state: setEffectQueueEntries(
          {
            ...currentState,
            log: [...currentState.log, ...options.endLogs],
          },
          []
        ),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
      });
      const flushed = flushPendingLeavesAndQueueReactions({
        beforeFlushState: stateBeforeFlush,
        chainId: options.chainId,
        causedByPlayerId: sbaActingPlayerId ?? null,
        causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        sourceColors: options.sourceColors,
        sourceCategory: options.sourceCategory,
        attackId: options.battleEndDeferralAttackId ?? null,
      });
      return finishStableEffectResolution({
        ...options,
        state: flushed,
        sourceInstanceId: options.causedBySourceInstanceId ?? null,
        getCardDefinitionById: options.getCardDefinitionById,
        ...(options.sourceEffectIndex !== undefined
          ? { sourceEffectIndex: options.sourceEffectIndex }
          : {}),
      });
    }
  }

  currentState = setEffectQueueEntries(
    {
      ...currentState,
      log: [...currentState.log, ...options.endLogs],
    },
    []
  );
  // Capture the operation facts before the common funnel writes delivery receipts.
  // Oracle and ordinary reactions consume the same batch, including pending/resume.
  const resolutionTriggerEvents = collectTriggerEventsFromStateDelta({
    beforeState: options.beforeState,
    afterState: currentState,
    source: "action_resolution",
    getCardDefinitionById: options.getCardDefinitionById,
  });
  currentState = collectAndQueueTriggerReactions({
    beforeState: options.beforeState,
    afterState: currentState,
    source: "action_resolution",
    chainId: options.chainId,
    attackId: options.battleEndDeferralAttackId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: sbaActingPlayerId ?? null,
    causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
    ...(options.enterFieldCausedByPlayerId !== undefined
      ? { enterFieldCausedByPlayerId: options.enterFieldCausedByPlayerId }
      : {}),
    ...(options.enterFieldCauseExcludedInstanceIds !== undefined
      ? {
          enterFieldCauseExcludedInstanceIds:
            options.enterFieldCauseExcludedInstanceIds,
        }
      : {}),
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
    ...(options.supplementalTriggerEvents !== undefined
      ? { supplementalEvents: options.supplementalTriggerEvents }
      : {}),
  });

  if (options.suppressCausedLeaveEffectsForSourceInstanceId) {
    const suppressSourceInstanceId =
      options.suppressCausedLeaveEffectsForSourceInstanceId;
    const suppressTargetIds = currentState.pendingLeaveEntities
      .filter(
        (pendingLeave) =>
          pendingLeave.causedByEffectSourceInstanceId ===
            suppressSourceInstanceId &&
          pendingLeave.blockedByResistance !== true
      )
      .map((pendingLeave) => pendingLeave.instanceId);
    currentState = executeSuppressPendingLeaveEffects(
      currentState,
      suppressTargetIds,
      "destroyed_only",
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions
    );
  }

  // 神託チェック: フィールドに入ったカード（召喚/配置/煌臨）に対してオラクルトリガーを判定
  {
    const getDefById = options.getCardDefinitionById;
    // 通常誘発と神託で同じ場入りイベントを使う。下カード追加や「出す」を
    // zoneRoleName から召喚に再分類しない。
    const entryEvents = resolutionTriggerEvents;
    const oracleTriggers: Array<{
      triggerCardInstanceId: string;
      triggerKind: "summon" | "place" | "advent";
    }> = [];
    const placementOracleInstanceIds: string[] = [];

    for (const event of entryEvents) {
      const triggerKind = event.eventKind;
      // The common semantic funnel has already dispatched these once.
      if (event.semanticEventId !== undefined && triggerKind === "summon")
        continue;
      if (
        triggerKind !== "summon" &&
        triggerKind !== "place" &&
        triggerKind !== "advent"
      )
        continue;
      const afterCard = currentState.cardInstances.find(
        (card) => card.instanceId === event.relatedInstanceId
      );
      if (!afterCard) continue;

      // oraclePlacementSuppressed (BSAZ02-C17 SummonAction.suppressPlacementOracle) は
      // このカードが新規にフィールドへ入ったことを検出する本 diff パス (=唯一の choke
      // point) で読み取ると同時に即座に false へ消費する。move_card / executeSummonSelf /
      // トークンを出す等、suppressPlacementOracle を経由しない他の場入り経路では元々 false
      // (createCardInstance 既定) のため影響しない。この即時消費により、この1回の配置
      // だけを不発にする単発フラグとして、将来の無関係な再配置へ persist しないことを
      // ここ1箇所で保証する (verifier round1 指摘: 消費し忘れると move_card 等での再配置時に
      // 導託が無音で不発になり得た)。
      const wasOraclePlacementSuppressed = afterCard.oraclePlacementSuppressed;
      if (wasOraclePlacementSuppressed) {
        currentState = replaceCardInstances(
          {
            ...currentState,
          },
          currentState.cardInstances.map((c) =>
            c.instanceId === afterCard.instanceId
              ? { ...c, oraclePlacementSuppressed: false }
              : c
          )
        );
      }

      {
        oracleTriggers.push({
          triggerCardInstanceId: afterCard.instanceId,
          triggerKind,
        });

        // 配置時神託（創界神自身が配置されたとき）= 誘発任意効果としてキューに積む
        // ただし oraclePlacementSuppressed (BSAZ02-C17 型「配置した〜の【導託】は
        // 発揮されない」) が立っている配置はこの単発の配置時神託だけを不発にする。
        if (triggerKind === "place" && !wasOraclePlacementSuppressed) {
          const def = getDefById(afterCard.definitionId);
          if (def && isGrandwalkerOrGuidedNexus(def)) {
            placementOracleInstanceIds.push(afterCard.instanceId);
          }
        }
      }
    }

    currentState = checkAndQueueOracleChoicesForTriggerBatch(
      currentState,
      oracleTriggers,
      getDefById,
      options.chainId
    );
    for (const instanceId of placementOracleInstanceIds) {
      currentState = checkAndQueuePlacementOracle(
        currentState,
        instanceId,
        getDefById,
        options.chainId
      );
    }
  }

  // 親効果と終了予約の効果を別々の原因・差分として一度ずつ収集する。
  currentState = processPendingImmediateBattleEnds({
    state: currentState,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  currentState = pruneIllegalPendingTriggeredEffects({
    state: currentState,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
  const flushed = flushPendingLeavesAndQueueReactions({
    beforeFlushState: currentState,
    chainId: options.chainId,
    causedByPlayerId: sbaActingPlayerId ?? null,
    causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: options.sourceColors,
    sourceCategory: options.sourceCategory,
    attackId: options.battleEndDeferralAttackId ?? null,
  });
  return finishStableEffectResolution({
    ...options,
    state: flushed,
    sourceInstanceId: options.causedBySourceInstanceId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: options.sourceEffectIndex }
      : {}),
  });
}

function retainDeferredBurstActivationCascade(
  state: GameState
): GameState["pendingStackCascade"] {
  const cascade = state.pendingStackCascade;
  if (!cascade) return null;

  const remainingStacks = cascade.remainingStacks.filter(
    (stack) => stack.actionKind === "burst_activation"
  );
  return remainingStacks.length > 0 ? { ...cascade, remainingStacks } : null;
}

export function processPendingImmediateBattleEnds(options: {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
}): GameState {
  if (options.state.pendingImmediateBattleEnds.length === 0) {
    return options.state;
  }

  let currentState: GameState = {
    ...options.state,
    pendingImmediateBattleEnds: [],
    // バーストは同一タイミングの他の効果をすべて解決した後に発揮する
    // (10_rules/04b_burst-rules.md:8-20)。battle-end deferral を再評価する間も、
    // 先行する誘発解決の後に開く deferred burst activation を保持する。
    // 通常 stack は従来どおりこの再評価へ持ち込まない。
    pendingStackCascade: retainDeferredBurstActivationCascade(options.state),
  };
  const remainingImmediateBattleEnds: PendingImmediateBattleEnd[] = [];
  for (const pending of options.state.pendingImmediateBattleEnds) {
    if (
      hasPendingBattleEndEntryReactions(
        currentState,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      )
    ) {
      remainingImmediateBattleEnds.push(pending);
      continue;
    }
    if (pending.battleEndEntryStarted !== true) {
      currentState = {
        ...currentState,
        pendingBattleEndFinalizeAttackIds:
          currentState.pendingBattleEndFinalizeAttackIds.includes(
            pending.attackId
          )
            ? currentState.pendingBattleEndFinalizeAttackIds
            : [
                ...currentState.pendingBattleEndFinalizeAttackIds,
                pending.attackId,
              ],
      };
      currentState = queueBattleEndTriggers({
        state: currentState,
        participantInstanceIds: [...pending.participantInstanceIds],
        attackId: pending.attackId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions ?? (() => []),
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        blockSideInstanceIds: [...pending.blockSideInstanceIds],
        ...(pending.destroyedRecords
          ? { destroyedRecords: pending.destroyedRecords }
          : {}),
      });
    }
    if (
      hasOutstandingEffectResolutionContinuation({
        ...currentState,
        pendingImmediateBattleEnds: [],
        pendingStackCascade: null,
      })
    ) {
      remainingImmediateBattleEnds.push({
        ...pending,
        battleEndEntryStarted: true,
      });
      continue;
    }
    currentState = fireImmediateBattleEndDeferrals({
      state: currentState,
      attackId: pending.attackId,
      participantSnapshots: pending.participantSnapshots,
      appliedLifeDamage: pending.appliedLifeDamage ?? 0,
      participantOwnSymbols: new Map(
        (pending.participantOwnSymbols ?? []).map((entry) => [
          entry.entityId,
          entry.ownSymbols,
        ])
      ),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    if (
      hasOutstandingEffectResolutionContinuation({
        ...currentState,
        pendingImmediateBattleEnds: [],
        pendingStackCascade: null,
      })
    ) {
      remainingImmediateBattleEnds.push({
        ...pending,
        battleEndEntryStarted: true,
      });
      continue;
    }
    if (hasPendingBattleEndFinalizeBlockers(currentState, pending.attackId)) {
      currentState = {
        ...currentState,
        pendingBattleEndFinalizeAttackIds:
          currentState.pendingBattleEndFinalizeAttackIds.includes(
            pending.attackId
          )
            ? currentState.pendingBattleEndFinalizeAttackIds
            : [
                ...currentState.pendingBattleEndFinalizeAttackIds,
                pending.attackId,
              ],
        log: [
          ...currentState.log,
          `battle:end-scope-finalize:deferred:${pending.attackId}`,
        ],
      };
    } else {
      currentState = flushPendingLeavesAndQueueReactions({
        beforeFlushState: currentState,
        chainId: getBattleEndDeferralChainId(pending.attackId),
        attackId: pending.attackId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions ?? (() => []),
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        queueRegisteredPreFlush: true,
      });
      if (hasPendingBattleEndFinalizeBlockers(currentState, pending.attackId)) {
        currentState = {
          ...currentState,
          pendingBattleEndFinalizeAttackIds:
            currentState.pendingBattleEndFinalizeAttackIds.includes(
              pending.attackId
            )
              ? currentState.pendingBattleEndFinalizeAttackIds
              : [
                  ...currentState.pendingBattleEndFinalizeAttackIds,
                  pending.attackId,
                ],
          log: [
            ...currentState.log,
            `battle:end-scope-finalize:deferred:${pending.attackId}`,
          ],
        };
      } else {
        currentState = finalizeBattleEndScopeExpirations(
          {
            ...currentState,
            pendingBattleEndFinalizeAttackIds:
              currentState.pendingBattleEndFinalizeAttackIds.filter(
                (attackId) => attackId !== pending.attackId
              ),
          },
          pending.attackId,
          options.getCardDefinitionById
        );
      }
    }
  }
  if (remainingImmediateBattleEnds.length > 0) {
    currentState = {
      ...currentState,
      pendingImmediateBattleEnds: remainingImmediateBattleEnds,
    };
  }
  return maybeFinalizeBattleEndScopeExpirations(
    currentState,
    options.getCardDefinitionById,
    {
      flushBeforeFinalize: (state, attackId) =>
        flushPendingLeavesAndQueueReactions({
          beforeFlushState: state,
          chainId: getBattleEndDeferralChainId(attackId),
          attackId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions ?? (() => []),
          getRegisteredBurstActions: options.getRegisteredBurstActions,
          queueRegisteredPreFlush: true,
        }),
    }
  );
}

function fireImmediateBattleEndDeferrals(options: {
  state: GameState;
  attackId: string;
  participantSnapshots: readonly import("../model").BattleResolutionParticipantSnapshot[];
  appliedLifeDamage: number;
  participantOwnSymbols: ReadonlyMap<string, number>;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
}): GameState {
  const matching = options.state.pendingBattleEndDeferrals.filter(
    (deferral) => deferral.attackId === options.attackId
  );
  if (matching.length === 0) return options.state;

  let currentState: GameState = {
    ...options.state,
    pendingBattleEndDeferrals: options.state.pendingBattleEndDeferrals.filter(
      (deferral) => deferral.attackId !== options.attackId
    ),
  };
  for (let index = 0; index < matching.length; index += 1) {
    const deferral = matching[index]!;
    const ownSnapshot = options.participantSnapshots.find((snapshot) =>
      snapshot.memberInstanceIds.includes(deferral.sourceInstanceId)
    );
    const wasBlocked =
      deferral.battleEndDeferralWasBlocked ??
      (ownSnapshot ? ownSnapshot.blockedBy.length > 0 : false);
    const isSoleParticipant = options.participantSnapshots.length <= 1;
    const ownContributed =
      isSoleParticipant ||
      (ownSnapshot
        ? (options.participantOwnSymbols.get(ownSnapshot.entityId) ?? 0) > 0
        : false);
    const battleLifeReduced =
      deferral.battleEndDeferralLifeReduced ??
      (!wasBlocked && ownContributed && options.appliedLifeDamage > 0);
    if (
      !canFireBattleEndDeferral({
        state: currentState,
        deferral,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    ) {
      currentState.log.push(
        `battle:end-deferral:skip-source-left:${options.attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`
      );
      continue;
    }
    currentState.log.push(
      `battle:end-deferral:fire:${options.attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`
    );
    currentState = resolveBattleEndDeferral({
      state: currentState,
      deferral,
      wasBlocked,
      battleLifeReduced,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    if (hasOutstandingEffectResolutionContinuation(currentState)) {
      const enrichRemaining = (
        remaining: PendingBattleEndDeferral
      ): PendingBattleEndDeferral => {
        const remainingSnapshot = options.participantSnapshots.find(
          (snapshot) =>
            snapshot.memberInstanceIds.includes(remaining.sourceInstanceId)
        );
        const remainingWasBlocked =
          remaining.battleEndDeferralWasBlocked ??
          (remainingSnapshot ? remainingSnapshot.blockedBy.length > 0 : false);
        const remainingOwnContributed =
          isSoleParticipant ||
          (remainingSnapshot
            ? (options.participantOwnSymbols.get(remainingSnapshot.entityId) ??
                0) > 0
            : false);
        return {
          ...remaining,
          battleEndDeferralWasBlocked: remainingWasBlocked,
          battleEndDeferralLifeReduced:
            remaining.battleEndDeferralLifeReduced ??
            (!remainingWasBlocked &&
              remainingOwnContributed &&
              options.appliedLifeDamage > 0),
        };
      };
      return {
        ...currentState,
        pendingBattleEndDeferrals: [
          ...currentState.pendingBattleEndDeferrals,
          ...matching.slice(index + 1).map(enrichRemaining),
        ],
        log: [
          ...currentState.log,
          `battle:end-deferral:paused:${options.attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`,
        ],
      };
    }
  }
  return currentState;
}

export function resolveBattleEndDeferral(options: {
  state: GameState;
  deferral: PendingBattleEndDeferral;
  wasBlocked: boolean;
  battleLifeReduced: boolean;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
}): GameState {
  const definition = options.getCardDefinitionById(
    options.deferral.sourceDefinitionId
  );
  const effect =
    options.deferral.resumeEffectOverride ??
    definition?.effects?.[options.deferral.effectIndex];
  if (!effect) return options.state;
  const beforeState = cloneStateForTriggerDelta(options.state);
  const resolved = executeEffect({
    state: options.state,
    effect,
    sourceInstanceId: options.deferral.sourceInstanceId,
    actingPlayerId: options.deferral.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    effectIndex: options.deferral.effectIndex,
    ...(options.deferral.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.deferral.effectSourceInstanceId }
      : {}),
    ...(options.deferral.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.deferral.effectSourceDefinitionId }
      : {}),
    ...(options.deferral.sourceCardReferenceInstanceId !== undefined
      ? {
          sourceCardReferenceInstanceId:
            options.deferral.sourceCardReferenceInstanceId,
        }
      : {}),
    ...(options.deferral.activationZone !== undefined
      ? { activationZone: options.deferral.activationZone }
      : {}),
    ...(options.deferral.applicabilityEvaluationZone !== undefined
      ? {
          applicabilityEvaluationZone:
            options.deferral.applicabilityEvaluationZone,
        }
      : {}),
    chainId: getBattleEndDeferralChainId(options.deferral.attackId),
    firingBattleEndDeferral: true,
    battleEndDeferralAttackId: options.deferral.attackId,
    battleEndDeferralWasBlocked:
      options.deferral.battleEndDeferralWasBlocked ?? options.wasBlocked,
    battleEndDeferralLifeReduced:
      options.deferral.battleEndDeferralLifeReduced ??
      options.battleLifeReduced,
    ...(options.deferral.resumeFromStepIndex !== undefined
      ? { startFromStepIndex: options.deferral.resumeFromStepIndex }
      : {}),
    ...(options.deferral.restoredStepContext !== undefined
      ? { restoredStepContext: options.deferral.restoredStepContext }
      : {}),
    ...(options.deferral.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...options.deferral.targetInstanceIds] }
      : {}),
    ...(options.deferral.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(options.deferral.targetStepId !== undefined
      ? { targetStepId: options.deferral.targetStepId }
      : {}),
    optionalStepResumeEffectOverride: effect,
  });
  const collected = collectAndQueueTriggerReactions({
    beforeState,
    afterState: resolved,
    source: "action_resolution",
    chainId: getBattleEndDeferralChainId(options.deferral.attackId),
    attackId: options.deferral.attackId,
    causedByPlayerId: options.deferral.actingPlayerId,
    causedBySourceInstanceId:
      options.deferral.effectSourceInstanceId ??
      options.deferral.sourceInstanceId,
    enterFieldCausedByPlayerId: options.deferral.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return cleanupCompletedBattleEndDeferralMagicSourceIfReady({
    state: collected,
    deferral: options.deferral,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * P3-131層2傍証: 「解決が中断され、別経路で resume された magic」共通の後始末。
 * resume 後もなお pending 継続 (ネストした disclosure 等) が無ければ、in_use のまま残っている
 * magic-like カードをトラッシュへ送る (通常の resolveMagicMainAndMoveToTrash 経路は、
 * 中断で呼び出しフレームごと unwind するため素通りしてしまう)。battle-end deferral resume
 * (cleanupCompletedBattleEndDeferralMagicSourceIfReady) と targeted-disclosure step-continuation
 * resume (resumeTargetedDisclosureIfReady) の両方が同じ穴を持つため、判定ロジックを SSOT 化する。
 */
export function moveCompletedInUseMagicCardToTrashIfReady(options: {
  state: GameState;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  logLabel: string;
}): GameState {
  // 残りスタックの退避は別効果の待機。当該マジック自身の本文・継続だけを待つ。
  if (hasPendingEffectResolution(options.state, "effect")) {
    return options.state;
  }
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  if (!sourceCard || sourceCard.zone !== "in_use") return options.state;
  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );
  if (!sourceDefinition || !isMagicLikeCardForm(sourceCard, sourceDefinition)) {
    return options.state;
  }
  const afterCoreRelease = resolveCardLeavesFieldCores(
    options.state,
    sourceCard.instanceId,
    null,
    options.getCardDefinitionById
  );
  const returnsToTokenPool = isCardDefinitionToken(sourceDefinition);
  const destinationZone = returnsToTokenPool ? "removed_from_game" : "trash";
  const moved = moveCardZone(
    afterCoreRelease,
    sourceCard.instanceId,
    destinationZone,
    getDefaultZoneRoleName(sourceDefinition, destinationZone)
  );
  const logged = {
    ...moved,
    log: [
      ...moved.log,
      `${returnsToTokenPool ? "magic:token-pool" : "magic:trash"}:${options.logLabel}:${sourceCard.instanceId}`,
    ],
  };
  // 中断からの resume でも通常使用と同じく moved_to_trash の自己置換を処理する。
  const afterMovedToTrashEffects =
    destinationZone === "trash"
      ? processMovedToTrashEffects(
          logged,
          [sourceCard.instanceId],
          options.getCardDefinitionById,
          { fromZone: "in_use" }
        )
      : logged;
  return recomputeAndRebuildContinuousEffectsForSources(
    afterMovedToTrashEffects,
    options.getCardDefinitionById,
    [sourceCard.instanceId]
  );
}
function cleanupCompletedBattleEndDeferralMagicSourceIfReady(options: {
  state: GameState;
  deferral: PendingBattleEndDeferral;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  return moveCompletedInUseMagicCardToTrashIfReady({
    state: options.state,
    sourceInstanceId: options.deferral.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    logLabel: options.deferral.deferralId,
  });
}
