import { canExecuteChoiceConditionalCostPayload } from "./conditional-cost-choice-preview";
import { replaceCardInstances } from "../zone/card-instance-state";
import {
  getQuartzPlacements,
  getQuartzName,
  canPayQuartzCountCost,
} from "../mechanics/quartz-system";
import { getMultiPlacementTargets } from "../pending-state-guards";
import { hasPendingEffectResolution } from "./pending-resolution-policy";
import { withCoreMoveDestinationChoices } from "./core-move-destination-replacement";
import { requireTriggerChainId } from "../chain-id";
import { getCardById } from "../card/card-lookup";
import { applyTriggerConditionResults } from "./trigger-condition-observation";
import { collectNonLifeNormalCoreSources } from "../core/core-movability";
import { expandTurnFaceDown } from "./turn-face-down";
import { withRequiredEffectCost } from "./card-access-rules";
import { canPayRequiredEffectCosts } from "../legal/required-effect-cost-gate";
import {
  getCoreMoveChangedCardIds,
  getCoreMoveChangedCoreAmount,
} from "../core/core-move-result";
import { runPendingDeckRevealBoundary } from "./deck-reveal-boundary";
// ============================================================
// DSL インタプリタ — EffectStep ベースの効果実行エンジン
// ============================================================
//
// Effect { steps: EffectStep[] } を処理し、Connector セマンティクスと
// クロスステップ参照をサポートする。
//
// 全アクションは executeNativeAction で実行される（V1→Native 実行パス統合済み、
// P3-15 Phase 1〜15 完了）。

import type {
  CardDefinition,
  CardInstance,
  GameState,
  ActiveStack,
  EffectActivationTiming,
  ContinuousEffect,
  RetriggerEffect,
  RetriggerTriggerFilter,
  PendingTargetRedirect,
  RedirectActionContinuation,
  PostResolutionOracleTrigger,
  PendingEffectTargetGroup,
  EffectResolutionActionKind,
  PendingCoreDistribution,
  Zone,
  EffectActivationSourceZone,
  PendingAfterTriggersContinuation,
  LifeCoreSelectionContinuation,
  EffectStepRepeatResume,
  PendingAttackStepEndBlockedRetry,
} from "../model";
import { collectUnderCardScopeIds } from "../model";
import { resolveCountBound } from "./target-resolution";
import type {
  Effect,
  EffectStep,
  Action,
  Amount,
  Count,
  CardFilter,
  StepCondition,
  TargetSpec,
} from "../dsl-types";
import { findApplicableDeckRevealCountBoostBonus } from "./deck-reveal-count-boost";
import {} from "./native-star-garment-handlers";
import {} from "./native-action-shared";
import {
  allocateGroupedTargetsByStep,
  dedupePreserveOrder,
  detectAffectedCards,
  detectBpBecameZeroTransitions,
  getExplicitTargetCountForAction,
  getActionTargetSpec,
  hasInvalidConditionalCostExplicitTargets,
  isConditionalCostTargetShortage,
  resolveNegateStepAffectedCardIds,
  resolveTargetCandidateIds,
  resolveTargets,
  selectSequentialActionTargets,
} from "./native-target-resolution";
import {} from "./native-ce-registration-handlers";
import {} from "./native-move-core-handlers";
import {
  evaluateCondition,
  resolvePlayerRef,
} from "./structured-effect-interpreter";
import type { ConditionSourceContext } from "./structured-condition-eval";
import { evaluateApplicability } from "./effect-applicability";
import {
  definitionEffectPath,
  resolveDefinitionEffect,
} from "./definition-effect-reference";
import {
  createStepExecutionContext,
  getStepResult,
  recordStepResult,
  deserializeStepContext,
  serializeStepContext,
} from "../step-execution-context";
import type {
  StepExecutionContext,
  SerializedStepContext,
  StepResult,
} from "../step-execution-context";
import { findApplicableTargetRedirects } from "./redirect-effect-target";
import {} from "./effect-param-override";
import {} from "../battle/battle-shared";
import {
  hasOutstandingEffectResolutionContinuation,
  hasPendingLeaveResolutionChoice,
  isChainAtOrUnder,
  queuePendingLeave,
} from "../state-based-actions";
import { queuePendingReactionsFromTriggerEvents } from "./trigger-system";
import {
  refundEffectUsageIfRecorded,
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
  derivePreventionLevel,
  derivePreventionProfile,
  getEffectClassSourcePreventionBypass,
  getEffectSourceTribePreventionBypass,
  getSoulDriveDeparturePreventionBypass,
  getStepUsageLabel,
  getBraveSelfReferenceRewriteStatus,
  resolveDynamicStackNegatePreventionLevel,
  hasActiveOpponentEndRestriction,
  type EndRestrictionTag,
} from "../legal/legal-actions-shared";
import {
  getEffectStepChoiceOptions,
  shouldDeferConditionalStepChoice,
} from "./structured-effect-registrations";
import {
  buildPendingStepPrompt,
  buildStepChoicePrompt,
  stepPromptForChoosingPlayer,
  stepChoicesForChoosingPlayer,
} from "./effect-step-prompt";
import type {} from "../legal/legal-actions-types";
import {} from "../mechanics/act-as-spirit";
import {} from "../stack/stack-negate";
import {} from "../core/payment-system";
import {
  applyLifeZeroDefeat,
  getPlayerLifeCoreCount,
  getPlayerReserveCoreCount,
  getPlayerTrashCoreCount,
  getTotalCoresOnCardById,
} from "../core/core-system";
import { executeNativeAction } from "./native-action-registry";
import {
  getMinimumAdditionalCoresForFieldTargets,
  getMoveCardMirageSetSources,
} from "./native-move-core-handlers";
import {
  planMirageSetReplacements,
  getMirageReplacementChoiceLabel,
  getPlayerMirageSetStates,
} from "../mechanics/mirage-system";
import { resolveCardImmunityAffect } from "./effect-affect-adapter";
import {
  isCardCombinedWithHostAsBraveEffectSource,
  isCombinedBraveEffectSource,
  resolveAffectSourceIdentity,
} from "./effect-source-identity";
import { getCoreMinimumProtectedByResistance } from "./effect-resistance-check";
import { nextPendingSelectionId } from "./structured-effect-sequences";
import { withRevealedSelectionCards } from "./zone-selection-visibility";
import { computeCoreMoveAmountBonus } from "./structured-modifiers";
import { mergeTargetLockBypassProfiles } from "./target-affect-gate";
import {
  appendPublicDisclosure,
  appendPublicDisclosuresForEffectStepTransition,
  isCardIdentityPublicForDisclosure,
  publicDisclosureActionLabelForAction,
} from "../public-disclosure";
import {
  attachPostResolutionOracleToNewPending,
  evaluateStepCondition,
  handleConnector,
} from "./native-condition-connector";
import { collectEstablishedLeaveOutcomes } from "./leave-outcome";
import {
  didNonCardActionChangeState,
  didCountDecreasePayFullAmount,
  queueTargetedDisclosureForStep,
  refundAllRecordedUsage,
  shouldRefundRecordedUsageForConditionalCostRollback,
  canExecuteOptionalStep,
  tryBuildStepTargetSelection,
  cloneStateForTriggerDelta,
} from "./native-effect-front-helpers";

// ============================================================
// Non-card-moving action state change detection
// ============================================================
// Actions like count_decrease, core_move, life_damage modify game state
// (counters, cores, life) without changing card zones. detectAffectedCards
// only tracks zone changes, so these actions would incorrectly report
// succeeded=false, causing conditional_cost rollback to misfire.
// This helper detects actual state changes for such actions.

function resolvedTargetsAreConcreteEffectTargets(
  action: Action,
  resolvedTargetIds: readonly string[] | undefined
): boolean {
  // mode="player_choice" の core_distribute は `to` が候補プールで、実際の
  // 配分先は pendingCoreDistribution 解決時まで未確定。ここで targeted
  // disclosure / redirect に流すと、未選択の候補まで「対象になった」扱いになる。
  if (action.kind === "core_distribute" && action.mode === "player_choice") {
    return false;
  }
  // core_move の field_card 行き配分も、候補が複数ある場合は player が実配置先を
  // pendingCoreDistribution で確定するまで対象未確定。
  if (
    action.kind === "core_move" &&
    action.to?.kind === "field_card" &&
    (resolvedTargetIds?.length ?? 0) > 1
  ) {
    return false;
  }
  return true;
}

function didSelfSummonActionSucceed(
  action: Action,
  preState: GameState,
  currentState: GameState,
  sourceInstanceId: string
): boolean | null {
  if (action.kind !== "summon" || action.target.kind !== "self") return null;

  const before = preState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const after = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!before || !after) return false;

  const beforeUnderCards = collectUnderCardScopeIds(preState);
  const afterUnderCards = collectUnderCardScopeIds(currentState);
  const wasUnderCard =
    beforeUnderCards.adventSource.has(sourceInstanceId) ||
    beforeUnderCards.textRole.has(sourceInstanceId);
  const isStillUnderCard =
    afterUnderCards.adventSource.has(sourceInstanceId) ||
    afterUnderCards.textRole.has(sourceInstanceId);
  const wasAlreadyIndependentField = before.zone === "field" && !wasUnderCard;

  return (
    !wasAlreadyIndependentField && after.zone === "field" && !isStillUnderCard
  );
}

function detectRebirthAffectedCardIds(
  action: Action,
  preState: GameState,
  postState: GameState,
  sourceInstanceId: string,
  resolvedTargetIds: readonly string[] | undefined
): string[] | null {
  if (action.kind !== "rebirth") return null;
  const candidateIds =
    action.target !== undefined && resolvedTargetIds !== undefined
      ? resolvedTargetIds
      : [sourceInstanceId];
  return candidateIds.filter((instanceId) => {
    const before = preState.cardInstances.find(
      (card) => card.instanceId === instanceId
    );
    const after = postState.cardInstances.find(
      (card) => card.instanceId === instanceId
    );
    return (
      before !== undefined &&
      after !== undefined &&
      before.definitionId !== after.definitionId
    );
  });
}

function didRebirthChangeAnyTargetDefinition(
  preState: GameState,
  postState: GameState,
  targetIds: readonly string[]
): boolean {
  return targetIds.some((instanceId) => {
    const before = preState.cardInstances.find(
      (card) => card.instanceId === instanceId
    );
    const after = postState.cardInstances.find(
      (card) => card.instanceId === instanceId
    );
    return (
      before !== undefined &&
      after !== undefined &&
      before.definitionId !== after.definitionId
    );
  });
}

function detectCoreDistributePlacementResult(
  pre: GameState,
  post: GameState,
  candidateIds: readonly string[] | undefined
): { affectedCardInstanceIds: string[]; numericAmount: number } {
  const candidates = candidateIds ?? [];
  const affected: string[] = [];
  let numericAmount = 0;
  for (const id of candidates) {
    const preNormal =
      pre.cardInstances.find((card) => card.instanceId === id)
        ?.normalCoreCount ?? 0;
    const postNormal =
      post.cardInstances.find((card) => card.instanceId === id)
        ?.normalCoreCount ?? 0;
    const normalDelta = Math.max(0, postNormal - preNormal);
    const preSoulCount = pre.players.filter(
      (player) =>
        player.soulCoreLocation?.kind === "card" &&
        player.soulCoreLocation.instanceId === id
    ).length;
    const postSoulCount = post.players.filter(
      (player) =>
        player.soulCoreLocation?.kind === "card" &&
        player.soulCoreLocation.instanceId === id
    ).length;
    const soulDelta = Math.max(0, postSoulCount - preSoulCount);
    const placed = normalDelta + soulDelta;
    if (placed > 0) {
      affected.push(id);
      numericAmount += placed;
    }
  }
  return { affectedCardInstanceIds: affected, numericAmount };
}

function getPlayerZoneCoreCount(
  player: GameState["players"][number],
  zone: "reserve" | "trash" | "life" | "void"
): number {
  switch (zone) {
    case "reserve":
      return getPlayerReserveCoreCount(player);
    case "trash":
      return getPlayerTrashCoreCount(player);
    case "life":
      return getPlayerLifeCoreCount(player);
    case "void":
      return player.voidNormalCoreCount;
  }
}

function detectPlayerZoneCoreDecrease(
  pre: GameState,
  post: GameState,
  playerId: string,
  zone: "reserve" | "trash" | "life" | "void"
): number | undefined {
  const before = pre.players.find((p) => p.id === playerId);
  const after = post.players.find((p) => p.id === playerId);
  if (!before || !after) return undefined;
  return Math.max(
    0,
    getPlayerZoneCoreCount(before, zone) - getPlayerZoneCoreCount(after, zone)
  );
}

function detectCardCoreDecrease(
  pre: GameState,
  post: GameState,
  instanceIds: readonly string[] | undefined
): number | undefined {
  if (instanceIds === undefined) return undefined;
  return instanceIds.reduce(
    (sum, id) =>
      sum +
      Math.max(
        0,
        getTotalCoresOnCardById(pre, id) - getTotalCoresOnCardById(post, id)
      ),
    0
  );
}

function detectCoreMoveNumericAmount(
  pre: GameState,
  post: GameState,
  action: Extract<Action, { kind: "core_move" }>,
  sourceInstanceId: string,
  actingPlayerId: string,
  resolvedTargetIds: readonly string[] | undefined
): number | undefined {
  switch (action.from.kind) {
    case "union":
      return getCoreMoveChangedCoreAmount(pre, post);
    case "reserve":
    case "trash":
    case "life":
    case "void":
      return detectPlayerZoneCoreDecrease(
        pre,
        post,
        resolvePlayerRef(actingPlayerId, action.from.player, pre),
        action.from.kind
      );
    case "field":
    case "field_card":
      return detectCardCoreDecrease(pre, post, resolvedTargetIds);
    case "this_card":
      return detectCardCoreDecrease(pre, post, [sourceInstanceId]);
    case "target_card":
      return detectCardCoreDecrease(pre, post, resolvedTargetIds);
    case "card_instance":
      return detectCardCoreDecrease(pre, post, [action.from.instanceId]);
    case "outside_game":
    case "removed_from_game":
    case "count_area":
    case "ref":
    case "any_movable_self":
    case "non_life_normal_self":
    case "field_and_reserve_self":
    case "field_reserve_and_trash_self":
      return undefined;
  }
}

function getCoreDistributionTargetSpec(action: Action): TargetSpec | undefined {
  const targetSpec = getActionTargetSpec(action);
  if (targetSpec !== undefined) return targetSpec;
  if (action.kind === "core_move" && action.to?.kind === "field_card") {
    return {
      kind: "filter",
      player: action.to.player,
      filter: action.to.filter,
      count: "all",
    };
  }
  return undefined;
}

// ============================================================
// Public API
// ============================================================

export interface ExecuteEffectOptions {
  state: GameState;
  effect: Effect;
  sourceInstanceId: string;
  actingPlayerId: string;
  /** 外側の効果解決 chain。after_triggers の二重収集 dedupe と同一性に使う。 */
  chainId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  /**
   * P3-37 follow-up + P3-39: after_triggers connector 経由で発生する `collectAndQueueTriggerReactions`
   * 呼び出しに渡し、リスナー無し event (after_draw / increase_hand 等) が空 pending として
   * 残らないようにする。 P3-39 で必須化（呼び出し元から必ず forward する）。
   * after_triggers を踏まないパス (continuous-effect-rebuild など) でも空 lookup `() => []` を渡す。
   */
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  /** targeted disclosure で burst reaction も同じ lookup 解決に通す。 */
  getRegisteredBurstActions?: import("./trigger-system").BurstActionRegistrationLookup;
  /**
   * ENGINE-conditional-free-magic-use-target-selection: use_magic_without_cost
   * (条件付き無償マジック使用) の native action が対象選択を要する場合に、本物の
   * pendingEffectTargetSelection を生成するための窓口。legal-actions-apply.ts の
   * resolveDeferredStackAction を options 束縛したもの (SSOT: 対象選択延期ロジックの
   * 重複実装を避ける)。未指定時は use_magic_without_cost は従来通り同期解決する。
   */
  resolveDeferredStackForFreeMagicUse?: (
    state: GameState,
    stack: import("../model").ActiveStack
  ) => GameState;
  /**
   * ENGINE-free-magic-use-target-selection-nonfield-candidate-zones:
   * use_magic_without_cost が synthetic ActiveStack の candidateTargetZones を
   * 発揮効果の登録情報から引き継ぐための窓口 (resolveDeferredStackForFreeMagicUse と
   * 同型の SSOT plumbing)。
   */
  getRegisteredMagicActions?: import("../legal/legal-actions-types").MagicActionRegistrationLookup;
  coreShootDistribution?: Record<string, number>;
  coreShootSoulCoreInstanceId?: string;
  coreDistributionAllocations?: Record<string, number>;
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  coreDistributionSoulCoreInstanceId?: string;
  /**
   * field_card ソースのコアコスト支払い配分 (instanceId → 取るコア数)。
   * `resolve_core_source_allocation` 解決後の再実行 (コストステップ再実行) で
   * 供給され、executeCoreMove の field_card 分岐が消費する。
   */
  coreSourceAllocations?: Record<string, number>;
  resolvedCoreMoveAmounts?: import("../model").ResolvedCoreMoveAmounts;
  /** field_card ソースの generic コア移動でソウルコアを取る候補カード。 */
  coreSourceSoulCoreInstanceId?: string;
  targetInstanceIds?: string[];
  /** targetInstanceIds を注入する DSL step id。未指定時は従来通り最初の対象 step で消費する。 */
  targetStepId?: string;
  /**
   * targetInstanceIds が空配列でも「プレイヤーが 0 体で確定済み」として扱う。
   * 未指定の空配列は従来どおり auto target 解決へフォールバックする。
   */
  targetSelectionResolved?: boolean;
  /**
   * 宣言済み TargetRef の deferred 再開。対象取得 gate は再実行せず、各 action の
   * affect gate だけを適用する。対象 zone からの離脱は caller の presence 再検査で除外済み。
   */
  preservePreSelectedTargetRefs?: boolean;
  /**
   * 複数の target-bearing step に targetInstanceIds を順に割り当てる。
   * 通常経路は従来どおり最初の対象 step へ全件を渡す。
   */
  sequentialTargetConsumption?: boolean;
  /** grouped target legal action で選ばれた ID を DSL step ごとに復元する。 */
  targetGroups?: readonly PendingEffectTargetGroup[];
  /** pending 解決後の再開用 */
  startFromStepIndex?: number;
  /**
   * retrigger / borrowed effect など、通常の pendingStepOptionalTargetSelection ではなく
   * 呼び出し元専用 pending として対象選択を保持したい再実行経路向け。
   */
  onStepTargetSelection?: (args: {
    state: GameState;
    pending: import("../model").PendingStepOptionalTargetSelection;
    stepIndex: number;
    stepContext: SerializedStepContext;
  }) => GameState;
  stepTargetSelectionBypassesPreventionGate?: boolean;
  /** 効果全体の finalization で delta 収集に使う、元効果開始時 state。 */
  effectResolutionBeforeState?: GameState;
  /** pending 再開時の復元済みステップコンテキスト */
  restoredStepContext?: SerializedStepContext;
  /**
   * 外側の正規 pipeline で処理済みの先行 step 結果。
   * 召喚許可 action では play-card pipeline が先頭 summon を担当し、
   * DSL 側は後続 ref_succeeded step から再開する。
   */
  initialStepResults?: readonly StepResult[];
  /** 選択 pending で中断した同一 step repeat の再開位置。 */
  repeatResume?: EffectStepRepeatResume;
  /**
   * on_step の任意反復で、窓前に確定した基礎+追加の発揮回数。
   * 対象 instanceId はこの値で先取りせず、各反復で個別に選択する。
   */
  optionalRepeatTargetCount?: number;
  /**
   * targeted disclosure continuation の再開時、入口 step で同じ開示 pending を再発行しない。
   * 別 step の対象指定では false のままなので、PC03 Q17625 どおり再度発揮できる。
   */
  skipTargetedDisclosureAtStartStep?: boolean;
  /** 再開時に targeted disclosure を抑止する step id。対象指定の復元先とは独立。 */
  skipTargetedDisclosureStepId?: string;
  /** 再開時に targeted disclosure を抑止する target slice の開始 index。 */
  skipTargetedDisclosureTargetStartAtStartStep?: number;
  /** 再開時に targeted disclosure を抑止する target slice の件数。 */
  skipTargetedDisclosureTargetCountAtStartStep?: number;
  /** P3-76 targeted disclosure event に載せる発揮元 action kind。 */
  effectActionKind?: EffectResolutionActionKind;
  /** バースト自身をセットしなかった場合の実効移動先。pending中も固定する。 */
  burstPostResolutionDestination?: "burst" | "trash";
  /** 実際の発揮イベント。複合見出しの他タイミングへ対価を波及させない。 */
  effectEventAction?: string;
  /** P3-75/P3-76 targeted disclosure event に載せる発揮タイミング。 */
  effectActivationTiming?: EffectActivationTiming;
  /**
   * この効果 (マジック/フラッシュ) が宣言時に発動されたゾーン (手札/手元/トラッシュ)。
   * `StepCondition.kind === "activation_zone"` の解決元 (ENGINE-magic-activation-source-zone-condition)。
   */
  activationZone?: EffectActivationSourceZone;
  /** source が in_use の初回 applicability 判定だけに使う仮想ゾーン。 */
  applicabilityEvaluationZone?: EffectActivationSourceZone;
  /** under-card など、場の source card と効果テキスト提供元が異なる場合の効果側 instanceId。 */
  effectSourceInstanceId?: string;
  /** under-card など、場の source card と効果テキスト提供元が異なる場合の効果側 definitionId。 */
  effectSourceDefinitionId?: string;
  /**
   * `source_card` 参照だけを sourceInstanceId から差し替える明示 override。
   * effectSourceInstanceId は耐性/対象ロック identity にも使うため、ここでは分離して運ぶ。
   */
  sourceCardReferenceInstanceId?: string;
  /**
   * targeted disclosure 後に再開する効果定義。
   * P3-76 event の発揮元 identity とは分離する（星霊衣: event source=host、resume=under-card text）。
   */
  targetedDisclosureSourceDefinitionId?: string;
  /**
   * pending が step 実行後に中断し、次 step の connector から resume する場合の
   * 直前 step 実行前スナップショット。after_triggers connector が startFromStepIndex
   * 入口でも前 step 差分を収集できるようにする。
   */
  resumePreviousStepPreState?: GameState;
  /** choice ステップの選択肢インデックス。0=デフォルト action、1+=choice[N-1]。 */
  choiceIndex?: number;
  /**
   * true の場合、EffectStep.choice に choiceIndex 未指定で到達したときデフォルト action へ
   * 自動フォールバックせず、pendingStepChoice を立ててプレイヤー入力を待つ。
   */
  promptUnresolvedChoice?: boolean;
  /**
   * 解決中の pending triggered effect の同時誘発グループ ID。
   * stay_on_field アクションが同グループ内の関連 pending を撤回する際に使用。
   */
  pendingEffectSimultaneousGroupId?: string;
  /**
   * P3-129: 解決中の pending triggered effect 自身の pendingId。
   * `correlate_pending_trigger` action が相手側誘発との相関記録に使う。
   */
  pendingEffectPendingId?: string;
  /**
   * 「転醒は同時に使えない」の同一タイミング窓 ID。
   * battle immediate / pending triggered の同時解決群で legal action boundary より広い
   * 窓を使うために渡す。
   */
  rebirthTimingWindowId?: string;
  /**
   * カード定義 effects[] 配列内のインデックス。
   * 生成される ContinuousEffect の provenance に格納され、
   * リビルダ (rebuildContinuousEffectsFromField) が重複登録を防ぐために参照する。
   * 未指定時は findEffectIndex で逆引きする。
   */
  effectIndex?: number;
  /**
   * 正規の効果解決 pipeline が finalizeEffectResolution で誘発 queue まで処理する場合、
   * duration.scope="current_effect" の CE は queue 時点まで見える必要がある。
   * 未指定時は従来どおり executeEffect の完了時に即 cleanup する。
   */
  deferCurrentEffectCleanup?: boolean;
  /**
   * 指定時、`effectIndex` は発揮元カードの `grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]` を指す (神技/導技等)。deck_reveal/zone_selection/count_selection が中断した
   * 場合の continuation (`ZoneSelectionContinuation.divineSkillIndex`) に転写され、
   * 解決側が top-level `effects[]` ではなく divineSkills 側から再開効果を探せるようにする
   * (ENGINE-divine-skill-nested-effect-continuation)。resolveDeferredDivineSkillStack が
   * skill 実行時に渡す。未指定時 = 従来通り top-level `effects[]`。
   */
  divineSkillIndex?: number;
  /**
   * 指定時、`effectIndex` は発揮元カードの `accelData.effects[]` を指す
   * (top-level `effects[]` ではない)。step 対象選択が中断した場合の continuation
   * (`StepOptionalContinuation.isAccelData`) に転写され、解決側が top-level `effects[]`
   * ではなく accelData 側から再開効果を探せるようにする
   * (ENGINE-move-card-actual-count-amount、divineSkillIndex と同型パターン)。
   * runActionMainResolution が accel 解決時に渡す。未指定時 = 従来通り top-level `effects[]`。
   */
  isAccelData?: boolean;
  /**
   * 指定時、`effectIndex` は発揮元カードの `changeData.effects[]` を指す
   * (top-level `effects[]` ではない)。コントラクトチェンジ等の効果中断後、
   * pending 解決側が changeData 側から再開効果を探せるようにする。
   */
  isChangeData?: boolean;
  /**
   * `pay_cost` cost step が消費する支払いソース。
   * summon / magic と同じく、プレイヤーが事前に選択した
   * `CardCostPaymentSource[]` (リザーブ / フィールド上カード混在可) を渡す。
   * 未指定の非対話実行も、通常の合法支払い元から決定的に支払う。
   */
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /**
   * ことで構文 (`conditional_cost`) の `pay_cost` コア源選択を解決時(窓後)へ遅延させる。
   * true かつ事前ソース未指定かつ配分曖昧 (リザーブ+フィールド等) なら、`pay_cost` ハンドラが
   * `pendingCoreSourceAllocation` を生成して中断する。インタラクティブ deferred 解決経路でのみ
   * 設定し、直接 executeEffect (テスト/AI) は未設定=同じ合法候補から自動支払い。
   */
  allowPendingPayCostSourceAllocation?: boolean;
  /**
   * retrigger-system.ts / effect-borrowing.ts のように、対話的な
   * `pendingEffectTargetSelection` を経由せず executeEffect を直接呼ぶ再実行経路向け。
   * 範囲ターゲット (`{min,max}`) の preSelectedIds 無し自動解決時、既定の静的 min
   * ではなく静的 max を採用させる (ENGINE-retrigger-range-count-target-fallback)。
   * 未指定時は従来通り min（通常の executeEffect 呼び出しは変更なし）。
   */
  rangeAutoResolveStrategy?: "min" | "max";
  /**
   * P3-34 B: 効果起点 summon (summon_self / from_zone) のコスト支払い元。
   * 通常召喚と同じ `CardCostPaymentSource[]` 形式。対話経路では未指定なら支払元を選ぶ。
   */
  summonPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /** 支払い待ちから再開する召喚stepが、支払い前に配置済みの合体先。 */
  summonPreCostCombineHostInstanceId?: string;
  /**
   * P3-34 B: 効果起点 summon のフィールド進入時コア配置。
   * 通常召喚と同じ `EnterFieldCorePlacement[]` 形式。Lv2/Lv3 を狙う多コア配置や
   * 配置 policy 検証 (`天渡` 等) を効果召喚にも適用する。未指定時は最小要求のみ自動。
   */
  summonEnterFieldCorePlacements?: readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[];
  /**
   * この効果の使用コストとして実際に支払われたコア数。
   * アクセル / マジック / チェンジ等の reduction.finalCost を伝播させ、
   * DynamicCount.cost_paid_this_effect から参照される。
   */
  costPaidThisEffect?: number;
  /** pending 選択が閉じた後にキューする神託後処理。 */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * スタック効果として解決中の negate が無効化対象にしている直下 stack。
   * ActiveStack.previousPendingStackAction 由来で、negate step の StepResult に
   * 対象発生源を記録し、後続 TargetSpec.ref へ接続する。
   */
  pendingStackNegateCandidate?: ActiveStack | null;
  /**
   * P3-131層2: この executeEffect 呼び出しを駆動している元 ActiveStack のスナップショット
   * (resolveDeferredMagicStack 等、宣言時 activeStack を持つ呼び出し元のみ設定)。
   * queueTargetedDisclosureForStep が生成する continuation へそのまま転写し、negate 応答の
   * 照合 (stackMatchesNegateAction) にのみ使う。再開 (resumeStepIndex) には関与しない。
   */
  targetedDisclosureNegateIdentity?: ActiveStack;
  /**
   * P3-14 C-5: 誘発イベントの量 (pendingEffect.amount)。
   * stepCtx.eventAmount に転写され DynamicCount.event_amount の解決元になる
   * (BSTH01-R02「このバトルで破壊した相手のスピリット/アルティメット1体につき」等)。
   */
  eventAmount?: number;
  /**
   * 解決中の誘発 pending の `relatedInstanceId` (主語 Y)。
   * `TargetSpec.kind === "trigger_related_instance"` の解決元になる
   * (BSTH05-X02『風神/アシハラ…バトル終了時…回復できる』等)。
   * pending 由来でない直接 executeEffect (テスト/AI) 経路では未設定。
   */
  triggerRelatedInstanceId?: string;
  triggerRelatedCombinedHostInstanceId?: string;
  triggerRelatedInstanceIds?: readonly string[];
  /**
   * 離脱トリガーが保持する煌臨元 instanceId スナップショット。
   * `SummonAction.from_zone.restrictToTriggerLeaveAdventSource` の解決元になる
   * (BSSG01-C08 Lv2、engine-advent-source-leave-summon)。
   */
  triggerAdventSourceInstanceIds?: readonly string[];
  /**
   * optional step が pending 化した場合、解決時にカード定義上の effect ではなく
   * この一時合成 Effect を再開する。retrigger 発火時の単一 step 実行などで使う。
   */
  optionalStepResumeEffectOverride?: Effect;
  /**
   * P3-43: 攻撃側効果の防止レベル (`registration.preventionLevel` 由来)。
   * `"unpreventable"` のとき `cannot_be_destroyed` 等の効果耐性を貫通する。
   * EffectActionContext.sourcePreventionLevel から伝搬され、
   * executeNativeAction → executeDestroy / executeBounce / executeVanish /
   * executeSendToDeck / executeRemoveFromGame に渡される。
   * 省略時は "none" 扱い (現状維持)。
   */
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  /**
   * pending triggered effect の発生元ゾーン。
   * `trigger_from_zone` 条件を解決時にも再評価するために使う。
   */
  triggerFromZone?: Zone;
  /** 誘発効果のroot条件だけに使う収集時のイベント述語。子効果へは伝搬しない。 */
  triggeredRootConditionResults?: Readonly<Record<string, boolean>>;
  triggerCause?: import("../model").TriggerEventCause;
  /**
   * ENGINE-targeted-disclosure-offfield-source: pending triggered effect の
   * relatedInstanceId (対象化/観測対象カード) の現在ゾーン。
   * `trigger_related_instance_off_field` 条件を解決時にも再評価するために使う
   * (BSLH01-T14「フィールド以外で発揮中の…」)。宣言時 listing 段階
   * (trigger-system.ts の TriggerContext.relatedInstanceZone) と同じ導出だが、
   * こちらは解決時再評価専用の受け渡し経路 (triggerFromZone と同型)。
   */
  triggerRelatedInstanceZone?: Zone;
  /**
   * engine-effect-tribe-tag-life-increase-trigger: pending triggered effect の原因カード
   * (`relatedInstanceId`) の実効系統 (`getEffectiveTribes` + `Effect.effectTribes` union)。
   * `trigger_tribes`/`trigger_source_match` 条件を解決時に評価するために使う
   * (BSTH03-X02「自分の系統：「蓬莱」を持つ効果で、自分のライフが増えたとき」)。
   */
  triggerSourceTribes?: readonly string[];
  /**
   * engine-effect-tribe-tag-life-increase-trigger: pending triggered effect の原因カード
   * (`relatedInstanceId`) のコントローラー。`trigger_source_player` 条件を解決時に
   * 評価するために使う（BSTH03-X02「自分の」限定。系統一致だけでは相手由来の発生源も
   * 通ってしまう）。
   */
  triggerSourcePlayerId?: string;
  /**
   * pending triggered effect の原因カード (`relatedInstanceId`) の instanceId。
   * `trigger_tribes.excludeSelfSource` 条件を解決時に評価するために使う
   * (BSTH07-転醒R01(A)「このネクサス以外の」限定)。
   */
  triggerSourceInstanceId?: string;
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  /**
   * P3-47 F-4 Step 3b: redirect 解決後の再起動で、resumeStepIndex における同じ
   * redirect_effect_target CE による二重 redirect を抑止するためのスキップリスト。
   * applyTargetRedirectAction が pending.redirectEffectId を 1 件含めて渡す。
   * 当該ステップでのみ機能し、以降のステップは通常通り redirect 検出する。
   */
  skipRedirectEffectIdsAtStartStep?: readonly string[];
  /** skipRedirectEffectIdsAtStartStep を適用する target slice の開始位置。 */
  skipRedirectTargetStartAtStartStep?: number;
  /** skipRedirectEffectIdsAtStartStep を適用する target slice の件数。 */
  skipRedirectTargetCountAtStartStep?: number;
  /**
   * redirect confirm などで解決済み対象集合が実際に置換された場合、全体継続効果でも
   * dynamic targetFilter へ戻さず、その明示集合だけへ snapshot CE を登録する。
   * decline は skipRedirectEffectIdsAtStartStep だけを使い、このフラグは立てない。
   */
  forceSnapshotContinuousTargets?: boolean;
  /**
   * P3-62: 発揮できない (condition unmet / conditional_cost rollback) と判定された
   * 際に usageLimit を払い戻すために必要な情報。caller (legal-actions-apply の
   * use_magic / use_field_card_effect 等) が recordEffectUsageIfLimited 呼び出しと
   * 対になる effectLabel / usageLimit を渡す。choice 変種別ラベルとの併存は
   * extraRecords で表現し、払い戻しは全エントリへ対称に適用する。
   */
  recordedUsage?: import("../model").RecordedEffectUsage;
  /**
   * `timing.deferredTo === "battle_end"` 効果のバトル終了時 再起動パスであることを示す。
   * true のとき deferredTo インターセプトをスキップして steps を実行する
   * (二重予約防止)。`fireBattleEndDeferrals` からのみ true で渡される。
   */
  firingBattleEndDeferral?: boolean;
  /**
   * `firingBattleEndDeferral:true` と併用し、発火元の attackId を運ぶ。
   * `resetBattleEntitiesAfterResolution` が `state.activeAttack` を発火前に
   * null 化するため、`currentState.activeAttack` から attackId を復元できない
   * (fireBattleEndDeferrals 呼び出し時点で必ず失われている)。pendingStepOptionalChoice
   * の継続 (`StepOptionalContinuation.battleEndDeferralAttackId`) へ引き継ぎ、
   * battle_end deferred 効果が step 単位で中断した場合の scope:"battle" CE 失効遅延判定に使う。
   * 正源: needs-dsl.audit ENGINE-battle-end-deferred-yield-finalize。
   */
  battleEndDeferralAttackId?: string;
  /**
   * `firingBattleEndDeferral:true` と併用し、直前に終了したバトルがブロックされていたかを運ぶ。
   * `ConditionClause.kind:"battle_was_blocked"` (BSFT01-X01「ブロックされたバトルの終了時」型) の
   * 評価用。`fireBattleEndDeferrals` が battleResolutionGroup (reset 前のローカル変数) から算出し、
   * 継続 (pendingStepOptionalChoice 等) へは引き継がない — effect.condition は resume 時
   * (isResume) は再評価しないため、初回発火の一回限りの寿命で足りる。
   */
  battleEndDeferralWasBlocked?: boolean;
  /**
   * `firingBattleEndDeferral:true` と併用し、直前に終了したバトルで対象プレイヤーの
   * ライフが実際に減ったかを運ぶ。`ConditionClause.kind:"battle_life_reduced"`
   * (BSTH05-X04「このスピリットのアタックで相手のライフが減っていないとき」型) の評価用。
   * `fireBattleEndDeferrals` が executeBattleResolution 側で算出した適用済み
   * ライフ減少量から導出する。battleEndDeferralWasBlocked と同様、継続へは引き継がない。
   */
  battleEndDeferralLifeReduced?: boolean;
  /**
   * `pendingStepOptionalChoice` の execute 解決後の再起動で、当該 step の
   * optional チェックを bypass する step index。一致した step のみ optional
   * pending を再生成せず実行する。次以降の step で別の optional があれば通常通り検出する。
   */
  optionalExecuteResumeStepIndex?: number;
  /** コア入力待ちより前に記録済みのステップ使用回数を、同じステップの再開時に重ねない。 */
  skipStepUsageAtResume?: boolean;
  /**
   * `pendingStepOptionalChoice` の decline 解決後の再起動で、当該 step の
   * 失敗 stepResult を記録して次 step へ進む step index。conditional_result
   * 連結の後続 step が「前段が成功しなかったので skip」を正しく評価できるよう、
   * 当該 step は native action を実行せず stepResult.succeeded=false を記録するだけ。
   */
  declinedOptionalStepIndex?: number;
  /**
   * optionalQuantity 解決後の再起動で、当該 step の実行量だけを選択値へ上書きする。
   * 現スコープは core_move.amount / draw.count。
   */
  optionalStepQuantityOverride?: {
    stepIndex: number;
    amount: number;
  };
  /**
   * `pendingDeckRevealCountBoostChoice` の apply/decline 解決後の再起動で、当該 step の
   * `deck_reveal` revealCount への bonusAmount 加算可否を伝える。一致した step のみ
   * boost pending を再生成せず、appliedBonus (0=decline) を revealCount に加算して実行する。
   */
  resolvedDeckRevealCountBoost?: {
    stepIndex: number;
    appliedBonus: number;
  };
}

function getApplicabilityEvaluationState(
  state: GameState,
  effect: Effect,
  sourceInstanceId: string,
  activationZone: ExecuteEffectOptions["activationZone"]
): GameState {
  if (
    activationZone !== "hand" &&
    activationZone !== "set_aside" &&
    activationZone !== "trash"
  ) {
    return state;
  }

  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  if (sourceCard?.zone !== "in_use") return state;

  const zoneSpec = effect.applicability?.zone;
  if (zoneSpec === undefined) return state;
  const applicableZones = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  if (!applicableZones.includes(activationZone)) return state;

  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((card) =>
      card.instanceId === sourceInstanceId
        ? { ...card, zone: activationZone }
        : card
    )
  );
}

/**
 * 作戦マジックが field で「使用」された後の、使用時だけ必要な applicability 判定。
 * 通常の activationZone 仮想化とは分け、解決完了後に source が trash へ移った
 * battle-end deferred effect でも宣言時の field 条件を再現する。
 */
function getOperationMagicFieldApplicabilityEvaluationState(
  state: GameState,
  effect: Effect,
  sourceInstanceId: string
): GameState {
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  if (!sourceCard) return state;

  const zoneSpec = effect.applicability?.zone;
  if (zoneSpec === undefined) return state;
  const applicableZones = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  if (!applicableZones.includes("field")) return state;

  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((card) =>
      card.instanceId === sourceInstanceId ? { ...card, zone: "field" } : card
    )
  );
}

function getBattleEndDeferralActivationZone(
  sourceCard: CardInstance,
  activationZone: ExecuteEffectOptions["activationZone"]
): EffectActivationSourceZone | undefined {
  const zone = activationZone ?? sourceCard.zone;
  switch (zone) {
    case "hand":
    case "set_aside":
    case "trash":
    case "mirage":
    case "advent_source":
    case "soul_state":
      return zone;
    case "field":
    default:
      return undefined;
  }
}

function isBattleEndDeferralSourceOnFieldRequired(
  sourceCard: CardInstance,
  activationZone: ExecuteEffectOptions["activationZone"]
): boolean {
  return (activationZone ?? sourceCard.zone) === "field";
}

function isBattleEndDeferralEffectSourceOnFieldRequired(options: {
  state: GameState;
  sourceInstanceId: string;
  sourceOnFieldRequired: boolean;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  if (!options.sourceOnFieldRequired) return false;
  const effectSourceInstanceId = options.effectSourceInstanceId;
  if (
    effectSourceInstanceId === undefined ||
    effectSourceInstanceId === options.sourceInstanceId
  ) {
    return false;
  }
  return isCombinedBraveEffectSource({
    state: options.state,
    sourceInstanceId: options.sourceInstanceId,
    effectSourceInstanceId,
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

function isSourceCardTargetSpec(target: unknown): boolean {
  return (
    typeof target === "object" &&
    target !== null &&
    (target as { kind?: unknown }).kind === "source_card"
  );
}

function stepDirectlyTargetsSourceCard(step: EffectStep | undefined): boolean {
  const action = step?.action;
  return (
    action !== undefined &&
    "target" in action &&
    isSourceCardTargetSpec((action as { target?: unknown }).target)
  );
}

function deferredStepsDirectlyTargetOnlySourceCard(
  steps: readonly EffectStep[] | undefined,
  startStepIndex: number
): boolean {
  if (!steps || startStepIndex < 0 || startStepIndex >= steps.length) {
    return false;
  }
  return steps
    .slice(startStepIndex)
    .every((step) => stepDirectlyTargetsSourceCard(step));
}

function isBattleEndDeferralEffectSourceAttachmentRequired(options: {
  effectSourceOnFieldRequired: boolean;
  steps: readonly EffectStep[] | undefined;
  startStepIndex: number;
}): boolean {
  if (!options.effectSourceOnFieldRequired) return false;
  return !deferredStepsDirectlyTargetOnlySourceCard(
    options.steps,
    options.startStepIndex
  );
}

/**
 * Effect を実行する。
 *
 * 1. Applicability 評価
 * 2. Condition 評価
 * 3. steps[] をイテレート（Connector セマンティクスに従う）
 * 4. 各ステップの action を executeNativeAction に委譲
 */
/**
 * 効果ソースの防止レベルを SSOT 導出する（明示 option 最優先 → Effect DSL の
 * `derivePreventionLevel`）。`preventionLevelCondition`（「自分のカウントN以上のとき…相手の
 * 効果では防げない」BSDB01-X02 / BSTS01-X02 型）が解決時に不成立なら防止レベルを無効化し、
 * 通常効果（防止可能）として解決させる。評価は evaluateCondition 一本に委譲（SSOT）。
 */
function resolveEffectSourcePreventionLevel(
  options: ExecuteEffectOptions,
  currentState: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): {
  level: import("../model").EffectPreventionLevel | undefined;
  /**
   * `grant_effect_source_prevention_immunity` (soulDriveDeparture scope) が実際に
   * level を昇格させたときのみセットされる。呼び出し側 (`executeEffect`) が
   * `recordEffectUsageIfLimited` で消費を記録する（BSLH01-C07「ターンの最初の1回」）。
   */
  soulDriveConsumption?: {
    sourceInstanceId: string;
    sourceDefinitionId: string;
    usageLimit: import("../model").EffectUsageLimit | undefined;
  };
} {
  const { effect, sourceInstanceId, actingPlayerId } = options;
  const dynamicPreventionSourceInstanceId = resolveAffectSourceIdentity({
    state: currentState,
    sourceInstanceId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  }).instanceId;
  let level = options.sourcePreventionLevel ?? derivePreventionLevel(effect);
  const shouldCheckEffectPreventionCondition = level !== undefined;
  const dynamicPreventionBypass = getEffectSourceTribePreventionBypass(
    currentState,
    dynamicPreventionSourceInstanceId,
    actingPlayerId,
    getCardDefinitionById
  );
  if (level === undefined && dynamicPreventionBypass?.kind === "all_effects") {
    level = "unpreventable";
  }
  if (level === undefined) {
    const effectClassBypass = getEffectClassSourcePreventionBypass(
      currentState,
      effect,
      dynamicPreventionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById
    );
    if (effectClassBypass?.kind === "all_effects") {
      level = "unpreventable";
    }
  }
  let soulDriveConsumption:
    | {
        sourceInstanceId: string;
        sourceDefinitionId: string;
        usageLimit: import("../model").EffectUsageLimit | undefined;
      }
    | undefined;
  if (level === undefined) {
    const soulDriveBypass = getSoulDriveDeparturePreventionBypass(
      currentState,
      effect,
      actingPlayerId,
      getCardDefinitionById
    );
    if (soulDriveBypass) {
      level = "unpreventable";
      const ceMetadata = soulDriveBypass.ce.metadata as
        | { usageLimit?: import("../model").EffectUsageLimit }
        | undefined;
      soulDriveConsumption = {
        sourceInstanceId: soulDriveBypass.ce.sourceInstanceId,
        sourceDefinitionId: soulDriveBypass.ce.sourceDefinitionId,
        usageLimit: ceMetadata?.usageLimit,
      };
    }
  }
  if (
    shouldCheckEffectPreventionCondition &&
    effect.preventionLevelCondition &&
    effect.preventionLevelCondition.length > 0 &&
    level &&
    level !== "none"
  ) {
    const preventionCondMet = evaluateCondition(
      currentState,
      effect.preventionLevelCondition,
      dynamicPreventionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById
    );
    if (!preventionCondMet) {
      level = undefined;
    }
  }
  return { level, ...(soulDriveConsumption ? { soulDriveConsumption } : {}) };
}

function collectPositiveRefSucceededStepIds(
  condition: StepCondition | undefined
): string[] {
  if (!condition || condition.not === true) return [];
  if (condition.kind === "ref_succeeded") return [condition.stepId];
  if (condition.kind === "all") {
    return condition.conditions.flatMap((child) =>
      collectPositiveRefSucceededStepIds(child)
    );
  }
  return [];
}

function findPostRebirthCoreCompanionResumeIndex(
  steps: readonly EffectStep[],
  rebirthStepIndex: number,
  rebirthStepId: string
): number {
  for (let j = rebirthStepIndex + 1; j < steps.length; j++) {
    const candidate = steps[j];
    if (!candidate) continue;
    if (
      candidate.action.kind === "core_distribute" &&
      candidate.action.to.kind === "source_card" &&
      collectPositiveRefSucceededStepIds(candidate.stepCondition).includes(
        rebirthStepId
      )
    ) {
      return j + 1;
    }
  }
  return rebirthStepIndex + 1;
}

function buildRebirthMinimumCoreRollbackPatch(params: {
  chainId: string | null | undefined;
  action: EffectStep["action"];
  step: EffectStep;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  distributionTargets: readonly string[];
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): Pick<
  PendingCoreDistribution,
  "priorStateSnapshot" | "rollbackIfBelowMinTotal" | "rebirthCompletion"
> | null {
  const {
    action,
    step,
    stepCtx,
    currentState,
    distributionTargets,
    actingPlayerId,
    getCardDefinitionById,
  } = params;
  if (
    action.kind !== "core_distribute" ||
    (action.from.kind !== "field_and_reserve_self" &&
      action.from.kind !== "field_reserve_and_trash_self") ||
    action.to.kind !== "source_card"
  ) {
    return null;
  }
  const minimumAdditionalCores = getMinimumAdditionalCoresForFieldTargets(
    currentState,
    distributionTargets,
    getCardDefinitionById
  );
  if (minimumAdditionalCores <= 0) return null;

  const buildPatchFromRebirthResult = (
    result: StepResult
  ): Pick<
    PendingCoreDistribution,
    "priorStateSnapshot" | "rollbackIfBelowMinTotal" | "rebirthCompletion"
  > | null => {
    if (!result.stateSnapshot) return null;
    if (
      !(
        result.succeeded ||
        didRebirthChangeAnyTargetDefinition(
          result.stateSnapshot,
          currentState,
          distributionTargets
        )
      )
    ) {
      return null;
    }
    const patch: Pick<
      PendingCoreDistribution,
      "priorStateSnapshot" | "rollbackIfBelowMinTotal" | "rebirthCompletion"
    > = {
      priorStateSnapshot: result.stateSnapshot,
      rollbackIfBelowMinTotal: {
        minTotal: minimumAdditionalCores,
        reason: "rebirth_minimum_core",
      },
    };
    const rebirthSourceInstanceId = distributionTargets[0];
    if (result.rebirthDefersCompletion === true && rebirthSourceInstanceId) {
      patch.rebirthCompletion = {
        chainId: requireTriggerChainId(params.chainId),
        sourceInstanceId: rebirthSourceInstanceId,
        actingPlayerId,
        ...(result.rebirthCountBonusMode !== undefined
          ? { countBonusMode: result.rebirthCountBonusMode }
          : {}),
      };
    }
    return patch;
  };

  for (const stepId of collectPositiveRefSucceededStepIds(step.stepCondition)) {
    const result = getStepResult(stepCtx, stepId);
    if (result) {
      const patch = buildPatchFromRebirthResult(result);
      if (patch) return patch;
    }
  }
  for (const result of [...stepCtx.results.values()].reverse()) {
    if (result.rebirthDefersCompletion !== true) continue;
    const patch = buildPatchFromRebirthResult(result);
    if (patch) {
      return patch;
    }
  }
  return null;
}

/**
 * `deferredTo:"battle_end"` 効果（「このバトル終了時、…」）の予約インターセプト。
 * 初回解決（resume/再起動でない）かつ未完了のバトル終了コンテキストがある場合のみ当該バトル終了時へ予約し、
 * 予約した/不発の GameState を返す。インターセプト対象でなければ null（＝通常解決へ進む）。
 * ルール正源: 10_rules/02「バトル終了時 に誘発する効果を先に解決し」。条件は発火時に再評価するため
 * applicability/condition より前に処理する。
 */
function getOpenBattleEndDeferralAttackId(state: GameState): string | null {
  if (state.activeAttack !== null) return state.activeAttack.attackId;
  if (
    state.step === "attack" &&
    state.pendingImmediateBattleEnds.length === 1
  ) {
    return state.pendingImmediateBattleEnds[0]!.attackId;
  }
  return null;
}

function hasBattleEndDeferredStep(
  steps: readonly EffectStep[],
  startIndex: number
): boolean {
  for (let j = startIndex; j < steps.length; j += 1) {
    if (steps[j]?.deferTo === "battle_end") return true;
  }
  return false;
}

function getBattleEndDeferralAttackIdForContinuation(args: {
  options: ExecuteEffectOptions;
  currentState: GameState;
  stepCtx: StepExecutionContext;
  steps: readonly EffectStep[];
  startIndex: number;
}): string | undefined {
  if (args.options.battleEndDeferralAttackId !== undefined) {
    return args.options.battleEndDeferralAttackId;
  }
  if (!hasBattleEndDeferredStep(args.steps, args.startIndex)) {
    return undefined;
  }
  return (
    getOpenBattleEndDeferralAttackId(args.currentState) ??
    getOpenBattleEndDeferralAttackId(args.stepCtx.originalState) ??
    undefined
  );
}

function interceptBattleEndDeferral(
  options: ExecuteEffectOptions,
  currentState: GameState,
  effectIndex: number
): GameState | null {
  const { effect, sourceInstanceId, actingPlayerId, getCardDefinitionById } =
    options;
  if (
    !(
      "deferredTo" in effect.timing &&
      effect.timing.deferredTo === "battle_end" &&
      !options.firingBattleEndDeferral &&
      (options.startFromStepIndex ?? 0) === 0
    )
  ) {
    return null;
  }
  const attackId = getOpenBattleEndDeferralAttackId(currentState);
  if (attackId === null) {
    // バトル終了時誘発から生じた予約は、現在の終了処理内で解決する。
    if (options.battleEndDeferralAttackId !== undefined) return null;
    currentState.log.push(
      `effect:deferred-battle-end-no-battle:${sourceInstanceId}:${effectIndex}`
    );
    return currentState;
  }
  const sourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (sourceCard === undefined) {
    // 定義 ID が引けない (= 再起動に必要な参照が作れない) 場合は予約を諦め不発。
    currentState.log.push(
      `effect:deferred-battle-end-no-source:${sourceInstanceId}:${effectIndex}`
    );
    return currentState;
  }
  const sourceDefinitionId = sourceCard.definitionId;
  const sourceDefinition = getCardDefinitionById(sourceDefinitionId);
  const activationZone = getBattleEndDeferralActivationZone(
    sourceCard,
    options.activationZone
  );
  const sourceOnFieldRequired = isBattleEndDeferralSourceOnFieldRequired(
    sourceCard,
    options.activationZone
  );
  const effectSourceOnFieldRequired =
    isBattleEndDeferralEffectSourceOnFieldRequired({
      state: currentState,
      sourceInstanceId,
      sourceOnFieldRequired,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });
  const effectSourceAttachmentRequired =
    isBattleEndDeferralEffectSourceAttachmentRequired({
      effectSourceOnFieldRequired,
      steps: effect.steps,
      startStepIndex: 0,
    });
  const sourceCardReferenceInstanceId = resolveSourceCardReferenceInstanceId({
    state: currentState,
    sourceInstanceId,
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  // ENGINE-battle-end-deferral-target-carry: 宣言時点 (battle-immediate legal action の
  // targetInstanceIds 経由) で対象選択が既に解決済みなら、fireBattleEndDeferrals 再発火時に
  // 同じ対象を再利用できるよう deferral へ運ぶ。未解決 (対象選択不要な効果) なら従来通り
  // effectIndex のみ保持する。
  const deferral: import("../model").PendingBattleEndDeferral = {
    deferralId: `bed:${attackId}:${sourceInstanceId}:${effectIndex}:${currentState.pendingBattleEndDeferrals.length}`,
    attackId,
    actingPlayerId,
    sourceInstanceId,
    sourceDefinitionId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId }
      : {}),
    ...(activationZone !== undefined ? { activationZone } : {}),
    ...(options.applicabilityEvaluationZone !== undefined
      ? { applicabilityEvaluationZone: options.applicabilityEvaluationZone }
      : {}),
    ...(sourceOnFieldRequired ? {} : { sourceOnFieldRequired }),
    ...(effectSourceOnFieldRequired ? { effectSourceOnFieldRequired } : {}),
    ...(effectSourceAttachmentRequired
      ? { effectSourceAttachmentRequired }
      : {}),
    effectIndex,
    ...(sourceDefinition?.effects?.[effectIndex] === effect
      ? {}
      : { resumeEffectOverride: options.effect }),
    ...(options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(options.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
  };
  currentState.log.push(
    `effect:deferred-to-battle-end:${sourceInstanceId}:${effectIndex}:${attackId}`
  );
  return {
    ...currentState,
    pendingBattleEndDeferrals: [
      ...currentState.pendingBattleEndDeferrals,
      deferral,
    ],
  };
}

/**
 * continuous timing の `no_duplicate` 重複登録スキップ判定（P3-20 ギャップ A）。
 * 同名カードの同 effectIndex CE が既に**同一コントローラー**で登録済（または self 登録済）なら
 * true。10_rules/03c〔重複不可〕: dedup は「同じコントローラー」単位。
 */
function isContinuousNoDuplicateSkip(
  options: ExecuteEffectOptions,
  currentState: GameState,
  effectIndex: number
): boolean {
  const { effect, sourceInstanceId } = options;
  if (effect.timing.kind !== "continuous" || !effect.usageLimit) return false;
  const limits = Array.isArray(effect.usageLimit)
    ? effect.usageLimit
    : [effect.usageLimit];
  if (!limits.some((u) => u.kind === "no_duplicate")) return false;
  const sourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!sourceCard) return false;
  const dedupeDefinitionId =
    options.effectSourceDefinitionId ?? sourceCard.definitionId;
  return currentState.activeContinuousEffects.some((ce) => {
    const ceDedupeDefinitionId =
      ce.provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId;
    if (ceDedupeDefinitionId !== dedupeDefinitionId) return false;
    if (ce.provenance?.effectIndex !== effectIndex) return false;
    // self の登録済 CE は idempotency でスキップ。
    if (ce.sourceInstanceId === sourceInstanceId) return true;
    // 別インスタンスは同一コントローラーのときだけ重複扱い。
    const ceSource = currentState.cardInstances.find(
      (c) => c.instanceId === ce.sourceInstanceId
    );
    return ceSource?.controllerPlayerId === sourceCard.controllerPlayerId;
  });
}

/** executeEffect の options から StepExecutionContext へ実行時パラメータを転写する。 */
function applyExecuteOptionsToStepContext(
  stepCtx: StepExecutionContext,
  options: ExecuteEffectOptions
): void {
  if (options.promptUnresolvedChoice === true)
    stepCtx.promptUnresolvedChoice = true;
  if (options.burstPostResolutionDestination !== undefined)
    stepCtx.burstPostResolutionDestination =
      options.burstPostResolutionDestination;
  // 発動元盤面に依存する DynamicCountSource (braves_on_source 等) 用に発動元 id を保持。
  stepCtx.sourceInstanceId = options.sourceInstanceId;
  if (options.effectActivationTiming !== undefined) {
    stepCtx.effectActivationTiming = options.effectActivationTiming;
  }
  if (options.activationZone !== undefined) {
    stepCtx.activationZone = options.activationZone;
  }
  if (options.targetInstanceIds !== undefined) {
    stepCtx.selectedTargetInstanceIds = options.targetInstanceIds;
  }
  if (options.targetStepId !== undefined) {
    stepCtx.selectedTargetStepId = options.targetStepId;
  }
  if (options.costPaidThisEffect !== undefined) {
    stepCtx.costPaidThisEffect = options.costPaidThisEffect;
  }
  if (options.eventAmount !== undefined) {
    stepCtx.eventAmount = options.eventAmount;
  }
  if (options.triggerRelatedInstanceId !== undefined) {
    stepCtx.triggerRelatedInstanceId = options.triggerRelatedInstanceId;
  }
  if (options.triggerRelatedCombinedHostInstanceId !== undefined) {
    stepCtx.triggerRelatedCombinedHostInstanceId =
      options.triggerRelatedCombinedHostInstanceId;
  }
  if (options.triggerRelatedInstanceIds !== undefined) {
    stepCtx.triggerRelatedInstanceIds = [...options.triggerRelatedInstanceIds];
  }
  if (options.triggerAdventSourceInstanceIds !== undefined) {
    stepCtx.triggerAdventSourceInstanceIds = [
      ...options.triggerAdventSourceInstanceIds,
    ];
  }
  if (options.rebirthTimingWindowId !== undefined) {
    stepCtx.rebirthTimingWindowId = options.rebirthTimingWindowId;
  }
  if (options.allowPendingPayCostSourceAllocation === true) {
    stepCtx.allowPendingPayCostSourceAllocation = true;
  }
}

/**
 * step ループの各周回冒頭で「未解決の選択 pending がある＝プレイヤー入力待ち」を判定する。
 * いずれか true なら step ループを中断（break）してプレイヤー応答を待つ。
 */
function hasBlockingPendingSelection(state: GameState): boolean {
  return hasPendingEffectResolution(state, "body");
}

function resolveEffectConditionSourceInstanceId(options: {
  state: GameState;
  sourceInstanceId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): string {
  const effectSourceInstanceId =
    options.effectSourceInstanceId ?? options.sourceInstanceId;
  if (effectSourceInstanceId === options.sourceInstanceId) {
    return options.sourceInstanceId;
  }
  const effectSourceCard = options.state.cardInstances.find(
    (card) => card.instanceId === effectSourceInstanceId
  );
  const effectSourceDefinition =
    options.getCardDefinitionById(
      options.effectSourceDefinitionId ?? effectSourceCard?.definitionId ?? ""
    ) ?? undefined;
  const sourceCard = options.state.cardInstances.find(
    (card) => card.instanceId === options.sourceInstanceId
  );
  return sourceCard &&
    effectSourceCard &&
    isCardCombinedWithHostAsBraveEffectSource({
      hostCard: sourceCard,
      effectSourceCard,
    }) &&
    effectSourceDefinition?.printedCategory === "brave"
    ? effectSourceInstanceId
    : options.sourceInstanceId;
}

function resolveEffectConditionSourceContext(options: {
  state: GameState;
  sourceInstanceId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): ConditionSourceContext | undefined {
  if (
    !isCombinedBraveEffectSource({
      state: options.state,
      sourceInstanceId: options.sourceInstanceId,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    return undefined;
  }
  return { combinedBraveHostSourceInstanceId: options.sourceInstanceId };
}

function resolveEffectApplicabilitySourceInstanceId(options: {
  state: GameState;
  sourceInstanceId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): string {
  if (
    isCombinedBraveEffectSource({
      state: options.state,
      sourceInstanceId: options.sourceInstanceId,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    }) &&
    options.effectSourceInstanceId !== undefined
  ) {
    return options.effectSourceInstanceId;
  }
  return options.sourceInstanceId;
}

function resolveEffectConditionSourceEvaluation(options: {
  state: GameState;
  sourceInstanceId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): {
  conditionSourceInstanceId: string;
  conditionSourceContext?: ConditionSourceContext;
} {
  const conditionSourceInstanceId = resolveEffectConditionSourceInstanceId({
    state: options.state,
    sourceInstanceId: options.sourceInstanceId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const conditionSourceContext = resolveEffectConditionSourceContext({
    state: options.state,
    sourceInstanceId: options.sourceInstanceId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return {
    conditionSourceInstanceId,
    ...(conditionSourceContext !== undefined ? { conditionSourceContext } : {}),
  };
}

function resolveSourceCardReferenceInstanceId(options: {
  state: GameState;
  sourceInstanceId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): string | undefined {
  if (options.sourceCardReferenceInstanceId !== undefined) {
    return options.sourceCardReferenceInstanceId;
  }
  const effectSourceInstanceId = options.effectSourceInstanceId;
  if (
    effectSourceInstanceId === undefined ||
    effectSourceInstanceId === options.sourceInstanceId
  ) {
    return undefined;
  }
  return isCombinedBraveEffectSource(options)
    ? effectSourceInstanceId
    : undefined;
}

/**
 * step 単位 `deferTo:"battle_end"`（「召喚する。その後、このバトル終了時、…」M13 大妖精）の
 * 予約インターセプト。当該 step 以降をバトル終了時へ遅延する。予約/不発いずれも当該 step で
 * ループ中断すべきなので、非 null（更新後 state）を返したら orchestrator は break する。
 * 対象外（deferTo でない/発火再開パス）なら null。
 */
function interceptStepBattleEndDeferral(
  step: EffectStep,
  options: ExecuteEffectOptions,
  currentState: GameState,
  stepCtx: StepExecutionContext,
  effectIndex: number,
  stepIndex: number,
  battleEndDeferralActivationZone: EffectActivationSourceZone | undefined,
  battleEndDeferralSourceOnFieldRequired: boolean,
  battleEndDeferralEffectSourceOnFieldRequired: boolean
): GameState | null {
  if (!(step.deferTo === "battle_end" && !options.firingBattleEndDeferral)) {
    return null;
  }
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  const { conditionSourceInstanceId, conditionSourceContext } =
    resolveEffectConditionSourceEvaluation({
      state: currentState,
      sourceInstanceId,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });
  // step.condition / stepCondition は予約前に判定する。stepCondition は transient stepCtx
  // 依存なので、予約成立時は serialized context を deferral に保持し、battle_end 再開時に
  // 同じ前段結果で再評価できるようにする。
  if (
    step.condition &&
    step.condition.length > 0 &&
    !evaluateCondition(
      currentState,
      step.condition,
      conditionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
      undefined,
      conditionSourceContext
    )
  ) {
    return null;
  }
  if (
    step.stepCondition &&
    !evaluateStepCondition(
      step.stepCondition,
      stepCtx,
      currentState,
      getCardDefinitionById
    )
  ) {
    return null;
  }
  const attackId = getOpenBattleEndDeferralAttackId(currentState);
  if (attackId === null) {
    if (options.battleEndDeferralAttackId !== undefined) {
      currentState.log.push(
        `effect:step-deferred-battle-end-late:${sourceInstanceId}:${effectIndex}:${stepIndex}:${options.battleEndDeferralAttackId}`
      );
      return null;
    }
    // バトル外: 「このバトル」不在 → 当該 step 以降は不発。
    currentState.log.push(
      `effect:step-deferred-battle-end-no-battle:${sourceInstanceId}:${effectIndex}:${stepIndex}`
    );
    return currentState;
  }
  const sourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (sourceCard === undefined) {
    currentState.log.push(
      `effect:step-deferred-battle-end-no-source:${sourceInstanceId}:${effectIndex}:${stepIndex}`
    );
    return currentState;
  }
  const sourceDefinitionId = sourceCard.definitionId;
  const sourceDefinition = getCardDefinitionById(sourceDefinitionId);
  const sourceCardReferenceInstanceId = resolveSourceCardReferenceInstanceId({
    state: currentState,
    sourceInstanceId,
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  // Registering a valid deferred result fulfills its enclosing alternative-result
  // cost now; the later battle-end execution is a separate scheduled resolution.
  const pendingCost = stepCtx.pendingConditionalCostRollback;
  if (pendingCost?.alternativeStepIds.includes(getStepId(step, stepIndex))) {
    delete stepCtx.pendingConditionalCostRollback;
  }
  // ENGINE-battle-end-deferral-target-carry (step-level defer 分): 同上、宣言時に
  // options.targetInstanceIds が解決済みなら deferral へ運ぶ。
  const deferral: import("../model").PendingBattleEndDeferral = {
    deferralId: `bed:${attackId}:${sourceInstanceId}:${effectIndex}:step${stepIndex}:${currentState.pendingBattleEndDeferrals.length}`,
    attackId,
    actingPlayerId,
    sourceInstanceId,
    sourceDefinitionId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId }
      : {}),
    ...(battleEndDeferralActivationZone !== undefined
      ? { activationZone: battleEndDeferralActivationZone }
      : {}),
    ...(options.applicabilityEvaluationZone !== undefined
      ? { applicabilityEvaluationZone: options.applicabilityEvaluationZone }
      : {}),
    ...(battleEndDeferralSourceOnFieldRequired
      ? {}
      : { sourceOnFieldRequired: battleEndDeferralSourceOnFieldRequired }),
    ...(battleEndDeferralEffectSourceOnFieldRequired
      ? { effectSourceOnFieldRequired: true }
      : {}),
    ...(isBattleEndDeferralEffectSourceAttachmentRequired({
      effectSourceOnFieldRequired: battleEndDeferralEffectSourceOnFieldRequired,
      steps: options.effect.steps,
      startStepIndex: stepIndex,
    })
      ? { effectSourceAttachmentRequired: true }
      : {}),
    effectIndex,
    ...(sourceDefinition?.effects?.[effectIndex] === options.effect
      ? {}
      : { resumeEffectOverride: options.effect }),
    resumeFromStepIndex: stepIndex,
    restoredStepContext: serializeStepContext(stepCtx),
    ...(options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(options.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
  };
  currentState.log.push(
    `effect:step-deferred-to-battle-end:${sourceInstanceId}:${effectIndex}:${stepIndex}:${attackId}`
  );
  return {
    ...currentState,
    pendingBattleEndDeferrals: [
      ...currentState.pendingBattleEndDeferrals,
      deferral,
    ],
  };
}

/**
 * `conditional_cost` 連結 step で、stepCondition / condition が解決時に不成立なら
 * その step は「選ばれなかった分岐」なのでスキップ（前 step の成否で rollback/refund しない）。
 */
function shouldSkipConditionalCostStep(
  step: EffectStep,
  stepCtx: StepExecutionContext,
  currentState: GameState,
  options: ExecuteEffectOptions
): boolean {
  if (step.connector !== "conditional_cost") return false;
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  const { conditionSourceInstanceId, conditionSourceContext } =
    resolveEffectConditionSourceEvaluation({
      state: currentState,
      sourceInstanceId,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });
  if (
    step.stepCondition &&
    !evaluateStepCondition(
      step.stepCondition,
      stepCtx,
      currentState,
      getCardDefinitionById
    )
  ) {
    return true;
  }
  if (
    step.condition?.length &&
    !evaluateCondition(
      currentState,
      step.condition,
      conditionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
      undefined,
      conditionSourceContext
    )
  ) {
    return true;
  }
  return false;
}

function getStepId(step: EffectStep, stepIndex: number): string {
  return step.id ?? `__step_${stepIndex}`;
}

function getConditionalCostAlternativeStepIds(step: EffectStep): string[] {
  const ids = step.conditionalCostAlternativeStepIds ?? [];
  return ids.filter((id, index) => id.length > 0 && ids.indexOf(id) === index);
}

function maybeDeferConditionalCostRollback(args: {
  step: EffectStep;
  stepCtx: StepExecutionContext;
  sourceInstanceId: string;
  failureLogEntries: readonly string[];
}): boolean {
  const alternativeStepIds = getConditionalCostAlternativeStepIds(args.step);
  if (alternativeStepIds.length === 0) return false;
  args.stepCtx.pendingConditionalCostRollback = {
    originalState: args.stepCtx.originalState,
    sourceInstanceId: args.sourceInstanceId,
    alternativeStepIds,
    failureLogEntries: [...args.failureLogEntries],
  };
  return true;
}

function clearPendingConditionalCostRollbackIfAlternativeSucceeded(
  stepCtx: StepExecutionContext,
  step: EffectStep,
  stepIndex: number
): void {
  const pending = stepCtx.pendingConditionalCostRollback;
  if (!pending) return;
  const stepId = getStepId(step, stepIndex);
  if (!pending.alternativeStepIds.includes(stepId)) return;
  const result = getStepResult(stepCtx, stepId);
  if (result?.succeeded) {
    delete stepCtx.pendingConditionalCostRollback;
  }
}

function finalizePendingConditionalCostRollback(args: {
  currentState: GameState;
  stepCtx: StepExecutionContext;
  options: ExecuteEffectOptions;
}): GameState {
  const pending = args.stepCtx.pendingConditionalCostRollback;
  if (!pending) return args.currentState;
  const alternativeSucceeded = pending.alternativeStepIds.some(
    (stepId) => getStepResult(args.stepCtx, stepId)?.succeeded === true
  );
  if (alternativeSucceeded) {
    delete args.stepCtx.pendingConditionalCostRollback;
    return args.currentState;
  }

  let rollbackState = pending.originalState;
  if (
    args.options.recordedUsage &&
    shouldRefundRecordedUsageForConditionalCostRollback(args.stepCtx)
  ) {
    rollbackState = refundAllRecordedUsage(
      rollbackState,
      pending.sourceInstanceId,
      args.options.recordedUsage
    );
  }
  rollbackState = {
    ...rollbackState,
    log: [...rollbackState.log, ...pending.failureLogEntries],
  };
  delete args.stepCtx.pendingConditionalCostRollback;
  return rollbackState;
}

/**
 * step ループ内フェーズの制御シグナル。orchestrator が break/continue/return を解釈する。
 * - proceed: 当該フェーズは非適用/通過。次フェーズへ（state は呼び出し側の値を継続）。
 * - continue: 当該 step を打ち切り次 step へ（`for` の continue）。
 * - return: 効果解決を中断し state を返す（`executeEffect` の return）。
 */
type StepPhaseOutcome =
  | { kind: "proceed"; state: GameState }
  | { kind: "continue"; state: GameState }
  | { kind: "break"; state: GameState }
  | { kind: "return"; state: GameState };

function getDefinitionEffectForContinuation(args: {
  definition: CardDefinition | undefined;
  options: ExecuteEffectOptions;
  effectIndex: number;
}): Effect | undefined {
  const { definition, options, effectIndex } = args;
  return resolveDefinitionEffect(
    definition,
    effectIndex,
    definitionEffectPath(options)
  );
}

function resolveStepChoicePlayerId(
  state: GameState,
  actingPlayerId: string,
  chooser: import("../dsl-types").PlayerRef | undefined
): string {
  if (chooser === "opponent") {
    return (
      state.playerOrder.find((id) => id !== actingPlayerId) ?? actingPlayerId
    );
  }
  return actingPlayerId;
}

function handleStepChoiceSelection(args: {
  effect: Effect;
  step: EffectStep;
  stepIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  targetIdsConsumed: boolean;
  effectIndex: number;
  conditionSourceInstanceId: string;
  conditionSourceContext: Parameters<typeof evaluateCondition>[6];
  triggerContext: Parameters<typeof evaluateCondition>[5];
  effectSourceTargetLockBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourcePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
}): StepPhaseOutcome {
  const {
    effect,
    step,
    stepIndex: i,
    options,
    stepCtx,
    targetIdsConsumed,
    effectIndex,
    conditionSourceInstanceId,
    conditionSourceContext,
    triggerContext,
    effectSourceTargetLockBypass,
    effectSourcePreventionLevel,
    effectSourcePreventionBypass,
  } = args;
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  const currentState = args.currentState;
  if (
    (options.promptUnresolvedChoice !== true &&
      !(
        shouldDeferConditionalStepChoice(effect, i) &&
        options.effectActionKind !== undefined
      )) ||
    options.choiceIndex !== undefined ||
    !step.choice ||
    step.choice.length === 0
  ) {
    return { kind: "proceed", state: currentState };
  }

  let choices = getEffectStepChoiceOptions(effect, i);
  if (choices.length === 0) {
    return { kind: "proceed", state: currentState };
  }
  const sourceCard = currentState.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  const sourceDefinitionId = sourceCard?.definitionId ?? "";
  const sourceDefinition = getCardDefinitionById(sourceDefinitionId);
  const effectDefinitionId =
    options.effectSourceDefinitionId ?? sourceDefinitionId;
  const effectDefinition = getCardDefinitionById(effectDefinitionId);
  const definitionEffect = getDefinitionEffectForContinuation({
    definition: effectDefinition,
    options,
    effectIndex,
  });
  const battleEndDeferralAttackId = getBattleEndDeferralAttackIdForContinuation(
    {
      options,
      currentState,
      stepCtx,
      steps: effect.steps,
      startIndex: i,
    }
  );
  const continuation: import("../model").StepOptionalContinuation = {
    sourceDefinitionId: effectDefinitionId,
    effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    sourceInstanceId,
    actingPlayerId,
    stepIndex: i,
    ...(definitionEffect !== effect ? { resumeEffectOverride: effect } : {}),
    stepContext: serializeStepContext(stepCtx),
    ...(options.effectActionKind !== undefined
      ? { effectActionKind: options.effectActionKind }
      : {}),
    ...(effectSourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: effectSourcePreventionLevel }
      : {}),
    ...(effectSourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: effectSourcePreventionBypass }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    chainId: options.chainId,
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...((!targetIdsConsumed || options.targetGroups?.length) &&
    options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(!targetIdsConsumed && options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...((!targetIdsConsumed || options.targetGroups?.length) &&
    options.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(currentState.pendingTargetedDisclosureContinuation !== null
      ? {
          targetedDisclosureContinuation:
            currentState.pendingTargetedDisclosureContinuation,
        }
      : {}),
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.eventAmount !== undefined
      ? { eventAmount: options.eventAmount }
      : {}),
    ...(options.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            options.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(options.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: options.pendingEffectPendingId }
      : {}),
    ...(battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId }
      : {}),
  };
  // A noop choice is a decline, including after resuming an earlier optional
  // step. Apply the same accepted-effect contract as the optional-step prompt.
  if (
    [step, ...step.choice].some((branch) => branch.action.kind === "noop") &&
    !canDeclineOptionalStepAfterEffectLevelFire({
      effect,
      activeAction: { kind: "noop" },
      stepIndex: i,
      stepCtx,
      optionalQuantity: undefined,
      isDerivedEffectOverride: isDerivedOptionalEffectOverride(
        options,
        definitionEffect
      ),
    })
  ) {
    choices = choices.filter((choice) => {
      const { choiceIndex } = choice;
      const branch = choiceIndex === 0 ? step : step.choice![choiceIndex - 1]!;
      if (
        branch.condition?.length &&
        !evaluateCondition(
          currentState,
          branch.condition,
          conditionSourceInstanceId,
          actingPlayerId,
          getCardDefinitionById,
          triggerContext,
          conditionSourceContext
        )
      )
        return false;
      if (
        step.stepCondition &&
        !evaluateStepCondition(
          step.stepCondition,
          stepCtx,
          currentState,
          getCardDefinitionById
        )
      )
        return false;
      if (
        !canPayRequiredEffectCosts(
          currentState,
          actingPlayerId,
          choice,
          getCardDefinitionById,
          [],
          {},
          {
            sourceInstanceId,
            sourceDefinitionId,
            effectIndex,
            continuation,
          }
        )
      )
        return false;
      const availability = {
        effect,
        effectIndex,
        targetStepId: step.id ?? `__step_${i}`,
        action: branch.action,
        state: currentState,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx,
        ...(sourceDefinition ? { sourceDefinition } : {}),
        ...(effectDefinition
          ? {
              effectSourceDefinition: effectDefinition,
            }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(options.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: options.effectSourceInstanceId }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(effectSourceTargetLockBypass !== undefined
          ? { sourceTargetLockBypass: effectSourceTargetLockBypass }
          : {}),
        ...(options.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                options.sourceCardReferenceInstanceId,
            }
          : {}),
        allowPartialTargetCount:
          effect.steps[i + 1]?.connector !== "conditional_cost",
        allowEmptyTargets:
          isActionZeroSelectionAllowed(branch.action) ||
          (branch.action.kind === "destroy" &&
            effect.steps[i + 1]?.connector !== "conditional_cost"),
      };
      return (
        (branch.action.kind !== "noop" ||
          isActionZeroSelectionAllowed(branch.action)) &&
        canExecuteOptionalStep(availability) &&
        canExecuteChoiceConditionalCostPayload({
          ...availability,
          effect,
          stepIndex: i,
          choiceIndex,
          conditionSourceInstanceId,
          conditionSourceContext,
          triggerContext,
        })
      );
    });
    if (choices.length === 0) {
      // A lost target/payment opportunity fizzles; it must not strand a pending
      // choice with no legal input or offer an intentional empty activation.
      recordStepResult(stepCtx, {
        stepId: step.id ?? `__step_${i}`,
        affectedCardInstanceIds: [],
        succeeded: false,
        executed: false,
      });
      return { kind: "continue", state: currentState };
    }
  }
  const sharedVariantChooser = choices.every(
    (choice) => choice.chooser === choices[0]!.chooser
  )
    ? choices[0]!.chooser
    : undefined;
  const choosingPlayerId = resolveStepChoicePlayerId(
    currentState,
    actingPlayerId,
    step.chooser ?? sharedVariantChooser
  );
  const pendingId = `psc:${sourceInstanceId}:${effectIndex}:${i}`;
  return {
    kind: "return",
    state: {
      ...currentState,
      pendingStepChoice: {
        pendingId,
        actingPlayerId,
        choosingPlayerId,
        sourceInstanceId,
        sourceDefinitionId,
        effectIndex,
        stepIndex: i,
        stepLabel: step.id ?? `__step_${i}`,
        prompt: stepPromptForChoosingPlayer(
          buildStepChoicePrompt(step),
          actingPlayerId,
          choosingPlayerId,
          { textLines: effectDefinition?.textLines, textRef: effect.textRef }
        ),
        choices: stepChoicesForChoosingPlayer(
          choices,
          actingPlayerId,
          choosingPlayerId
        ),
        continuation,
      },
      log: [
        ...currentState.log,
        `effect:step-choice-pending:${pendingId}:step=${i}`,
      ],
    },
  };
}

function resolveCardsFromRefOptionalStepQuantity(args: {
  action: EffectStep["action"];
  state: GameState;
  actingPlayerId: string;
  stepCtx: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): { kind: "core_move" | "draw" | "discard"; max: number } | undefined {
  const { action, state, actingPlayerId, stepCtx, getCardDefinitionById } =
    args;
  if (
    action.kind !== "core_move" &&
    action.kind !== "draw" &&
    action.kind !== "discard"
  ) {
    return undefined;
  }
  const rawAmount = action.kind === "core_move" ? action.amount : action.count;
  if (
    rawAmount === "all" ||
    typeof rawAmount !== "object" ||
    rawAmount === null ||
    "min" in rawAmount
  ) {
    return undefined;
  }
  if (rawAmount.source.kind !== "cards_from_ref") {
    return undefined;
  }
  const resolved = Math.floor(
    resolveCountBound(
      rawAmount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    )
  );
  if (!Number.isFinite(resolved)) {
    return undefined;
  }
  return { kind: action.kind, max: resolved };
}

function resolveOptionalStepQuantity(args: {
  action: EffectStep["action"];
  state: GameState;
  actingPlayerId: string;
  stepCtx: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): import("../model").PendingStepOptionalChoice["optionalQuantity"] {
  const resolved = resolveCardsFromRefOptionalStepQuantity(args);
  if (resolved === undefined || resolved.max <= 1) {
    return undefined;
  }
  return {
    kind: resolved.kind,
    min: 0,
    max: resolved.max,
  };
}

function applyOptionalStepQuantityOverride(
  action: EffectStep["action"],
  override: ExecuteEffectOptions["optionalStepQuantityOverride"] | undefined,
  stepIndex: number
): EffectStep["action"] {
  if (!override || override.stepIndex !== stepIndex) return action;
  if (action.kind === "core_move") {
    return { ...action, amount: override.amount };
  }
  if (action.kind === "draw" || action.kind === "discard") {
    return { ...action, count: override.amount };
  }
  return action;
}

/**
 * `discard` action (`fromZone` に "deck" を含む＝デッキ破棄/ミル経路) のうち、
 * `grant_optional_deck_reveal_count_boost` CE の +1 適用対象になり得るかを判定する。
 * `count` が "all" または範囲 `{min,max}` のときは加算の意味が定まらないため対象外
 * (該当カードは現状 number/DynamicCount のみ使用)。
 */
function isBoostableDeckDiscardAction(
  action: EffectStep["action"] | null | undefined
): action is Extract<EffectStep["action"], { kind: "discard" }> {
  if (!action || action.kind !== "discard") return false;
  const zones = action.fromZone
    ? Array.isArray(action.fromZone)
      ? action.fromZone
      : [action.fromZone]
    : [];
  if (!zones.includes("deck")) return false;
  const count = action.count;
  return (
    typeof count === "number" ||
    (typeof count === "object" && count !== null && !("min" in count))
  );
}

/**
 * 練刃の「デッキをオープン」対象は公開 reveal のみ。
 * `revealTo:self/opponent` は「内容を見る」型の peek なので +1 しない。
 */
function isBoostableDeckRevealAction(
  action: EffectStep["action"] | null | undefined
): action is Extract<EffectStep["action"], { kind: "deck_reveal" }> {
  if (!action || action.kind !== "deck_reveal") return false;
  return action.revealTo === undefined || action.revealTo === "both";
}

/**
 * `pendingDeckRevealCountBoostChoice` の apply 解決後の再起動で、当該 step の
 * revealCount (`deck_reveal`) または count (`discard`, fromZone:deck) へ appliedBonus を
 * 加算する (decline=0 は加算なしで通過)。
 */
function applyDeckRevealCountBoostResumeBonus(
  action: EffectStep["action"],
  resolution: ExecuteEffectOptions["resolvedDeckRevealCountBoost"] | undefined,
  stepIndex: number
): EffectStep["action"] {
  if (
    !action ||
    !resolution ||
    resolution.stepIndex !== stepIndex ||
    resolution.appliedBonus === 0
  ) {
    return action;
  }
  if (isBoostableDeckRevealAction(action)) {
    const base = action.revealCount;
    const boosted: Amount =
      typeof base === "number"
        ? base + resolution.appliedBonus
        : { ...base, offset: (base.offset ?? 0) + resolution.appliedBonus };
    return { ...action, revealCount: boosted };
  }
  if (isBoostableDeckDiscardAction(action)) {
    const base = action.count;
    if (typeof base === "number") {
      return { ...action, count: base + resolution.appliedBonus };
    }
    if (typeof base === "object" && base !== null && !("min" in base)) {
      const boosted: Count = {
        ...base,
        offset: (base.offset ?? 0) + resolution.appliedBonus,
      };
      return { ...action, count: boosted };
    }
  }
  return action;
}

function detectActuallyDestroyedTargetIds(
  before: GameState,
  state: GameState,
  resolvedTargetIds: readonly string[] | undefined
): string[] | null {
  const outcomes = collectEstablishedLeaveOutcomes(before, state);
  const selected = new Set(resolvedTargetIds ?? Object.keys(outcomes));
  const destroyed = new Set<string>();
  for (const pendingLeave of state.pendingLeaveEntities) {
    if (
      pendingLeave.kind === "destroy" &&
      outcomes[pendingLeave.instanceId] === "destroy" &&
      selected.has(pendingLeave.instanceId)
    ) {
      destroyed.add(pendingLeave.instanceId);
    }
  }
  for (const card of state.cardInstances) {
    if (
      selected.has(card.instanceId) &&
      outcomes[card.instanceId] === "destroy"
    ) {
      destroyed.add(card.instanceId);
    }
  }
  return [...selected].filter((id) => destroyed.has(id));
}

function hasPendingAfterTriggersChain(
  state: GameState,
  chainId: string
): boolean {
  const matches = (candidate: string | null | undefined): boolean =>
    typeof candidate === "string" && isChainAtOrUnder(candidate, chainId);
  return (
    state.pendingTriggeredEffects.some((pending) => matches(pending.chainId)) ||
    state.pendingDeferredTriggeredEffects.some((pending) =>
      matches(pending.chainId)
    ) ||
    state.pendingPrivateDeclarations.some((pending) =>
      matches(pending.chainId)
    ) ||
    // バースト宣言を収集した区間も一旦外側へ返し、差分の再収集を防ぐ。
    // 再開時の待機判定には通常バーストを含めず、発揮後を先に解決する。
    state.pendingBurstChecks.some((pending) => matches(pending.chainId)) ||
    (state.pendingEffectCompletions ?? []).some((p) => matches(p.chainId)) ||
    state.pendingAfterTriggersContinuations.some(
      (p) => p.waitChainId !== chainId && matches(p.waitChainId)
    )
  );
}

function hasRuleBraveSeparationChoice(state: GameState): boolean {
  return (
    state.pendingZoneSelection?.braveCapacityHostInstanceId !== undefined ||
    state.pendingCoreDistribution?.stateBasedBraveSeparation !== undefined
  );
}

function withRuleBraveSeparationContinuation(
  state: GameState,
  continuation: LifeCoreSelectionContinuation
): GameState {
  if (state.pendingCoreDistribution?.stateBasedBraveSeparation)
    return {
      ...state,
      pendingCoreDistribution: {
        ...state.pendingCoreDistribution,
        continuation,
      },
    };
  return {
    ...state,
    pendingZoneSelection: {
      ...state.pendingZoneSelection!,
      continuation: { ...continuation, recordStepId: "__rule_cleanup" },
    },
  };
}

function hasAfterTriggersResumeWork(
  state: GameState,
  chainId: string
): boolean {
  return (
    hasPendingAfterTriggersChain(state, chainId) ||
    hasRuleBraveSeparationChoice(state) ||
    hasPendingLeaveResolutionChoice(state)
  );
}

function buildAfterTriggersContinuation(args: {
  state: GameState;
  effect: Effect;
  effectIndex: number;
  stepIndex: number;
  waitChainId: string;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  targetIdsConsumed: boolean;
  effectResolutionBeforeState: GameState;
}): PendingAfterTriggersContinuation {
  const {
    state,
    effect,
    effectIndex,
    stepIndex,
    waitChainId,
    options,
    stepCtx,
    targetIdsConsumed,
    effectResolutionBeforeState,
  } = args;
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === options.sourceInstanceId
  );
  const sourceDefinitionId = sourceCard?.definitionId ?? "";
  const effectDefinitionId =
    options.effectSourceDefinitionId ?? sourceDefinitionId;
  const definitionEffect =
    options.getCardDefinitionById(effectDefinitionId)?.effects?.[effectIndex];
  return {
    continuationId: `after-triggers:${waitChainId}:${state.pendingAfterTriggersContinuations.length}`,
    waitChainId,
    sourceDefinitionId: effectDefinitionId,
    effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    sourceInstanceId: options.sourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    resumeStepIndex: stepIndex,
    stepContext: serializeStepContext(stepCtx),
    effectResolutionBeforeState,
    ...(definitionEffect !== effect ? { resumeEffectOverride: effect } : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(options.triggerFromZone !== undefined
      ? { triggerFromZone: options.triggerFromZone }
      : {}),
    ...(options.triggerCause !== undefined
      ? { triggerCause: options.triggerCause }
      : {}),
    ...(options.triggerRelatedInstanceZone !== undefined
      ? { triggerRelatedInstanceZone: options.triggerRelatedInstanceZone }
      : {}),
    ...(options.activationZone !== undefined
      ? { activationZone: options.activationZone }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    chainId: options.chainId,
    ...(!targetIdsConsumed && options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(!targetIdsConsumed && options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...(options.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.eventAmount !== undefined
      ? { eventAmount: options.eventAmount }
      : {}),
    ...(options.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            options.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(options.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: options.pendingEffectPendingId }
      : {}),
    ...(options.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
      : {}),
    ...(options.rangeAutoResolveStrategy !== undefined
      ? { rangeAutoResolveStrategy: options.rangeAutoResolveStrategy }
      : {}),
  };
}

function buildEffectBodyContinuation(args: {
  state: GameState;
  effect: Effect;
  effectIndex: number;
  stepIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  targetIdsConsumed: boolean;
  effectSourceDefinitionId: string;
  repeatResume?: NonNullable<LifeCoreSelectionContinuation["repeatResume"]>;
  initialStepResults?: readonly StepResult[];
  resumePreviousStepPreState?: GameState;
}): LifeCoreSelectionContinuation {
  const {
    state,
    effect,
    effectIndex,
    stepIndex,
    options,
    stepCtx,
    targetIdsConsumed,
    effectSourceDefinitionId,
    repeatResume,
    initialStepResults,
    resumePreviousStepPreState,
  } = args;
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === options.sourceInstanceId
  );
  const sourceDefinitionId = sourceCard?.definitionId ?? "";
  const definitionEffect = options.getCardDefinitionById(
    effectSourceDefinitionId
  )?.effects?.[effectIndex];
  return {
    ...(state.pendingTargetedDisclosureContinuation !== null
      ? {
          targetedDisclosureContinuation:
            state.pendingTargetedDisclosureContinuation,
        }
      : {}),
    chainId: options.chainId,
    sourceDefinitionId: effectSourceDefinitionId,
    effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    sourceInstanceId: options.sourceInstanceId,
    ...(definitionEffect !== effect ? { resumeEffectOverride: effect } : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : sourceDefinitionId !== effectSourceDefinitionId
        ? { effectSourceDefinitionId }
        : {}),
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    actingPlayerId: options.actingPlayerId,
    resumeStepIndex: stepIndex,
    stepContext: serializeStepContext(stepCtx),
    ...(repeatResume !== undefined ? { repeatResume } : {}),
    ...(initialStepResults !== undefined ? { initialStepResults } : {}),
    ...(resumePreviousStepPreState !== undefined
      ? { resumePreviousStepPreState }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourceTargetLockBypass !== undefined
      ? { sourceTargetLockBypass: options.sourceTargetLockBypass }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(options.triggerFromZone !== undefined
      ? { triggerFromZone: options.triggerFromZone }
      : {}),
    ...(options.triggerCause !== undefined
      ? { triggerCause: options.triggerCause }
      : {}),
    ...(options.triggerRelatedInstanceZone !== undefined
      ? { triggerRelatedInstanceZone: options.triggerRelatedInstanceZone }
      : {}),
    ...(options.activationZone !== undefined
      ? { activationZone: options.activationZone }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    ...(!targetIdsConsumed && options.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...options.targetInstanceIds] }
      : {}),
    ...(!targetIdsConsumed && options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...(options.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.eventAmount !== undefined
      ? { eventAmount: options.eventAmount }
      : {}),
    ...(options.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            options.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(options.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: options.pendingEffectPendingId }
      : {}),
    ...(options.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
      : {}),
    ...(options.rangeAutoResolveStrategy !== undefined
      ? { rangeAutoResolveStrategy: options.rangeAutoResolveStrategy }
      : {}),
    ...(options.effectActionKind !== undefined
      ? { effectActionKind: options.effectActionKind }
      : {}),
  };
}

/** 基本発揮・追加発揮のどちらでも同じ保存処理を使う。 */
function saveNewSwapChoice(
  previousState: GameState,
  args: Parameters<typeof buildEffectBodyContinuation>[0],
  stepResultId: string
): GameState | undefined {
  for (const key of [
    "pendingHandTrashSwapChoice",
    "pendingFieldHandSwapChoice",
  ] as const) {
    const pending = args.state[key];
    if (pending && !previousState[key]) {
      return {
        ...args.state,
        [key]: {
          ...pending,
          continuation: buildEffectBodyContinuation(args),
          stepResultId,
        },
      };
    }
  }
  return undefined;
}

function buildLifeCoreSelectionStepResult(args: {
  action: Action;
  pending: NonNullable<GameState["pendingLifeCoreSelection"]>;
  step: EffectStep;
  stepIndex: number;
  resolvedTargetIds: readonly string[] | undefined;
}): StepResult | undefined {
  const { action, pending, step, stepIndex, resolvedTargetIds } = args;
  if (action.kind !== "core_move") {
    return undefined;
  }
  const instanceId =
    pending.fromLocation.kind === "card_instance"
      ? pending.fromLocation.instanceId
      : undefined;
  if (
    action.from.kind === "target_card" &&
    instanceId !== undefined &&
    resolvedTargetIds !== undefined &&
    !resolvedTargetIds.includes(instanceId)
  ) {
    return undefined;
  }
  return {
    stepId: step.id ?? `__step_${stepIndex}`,
    affectedCardInstanceIds: instanceId ? [instanceId] : [],
    succeeded: pending.totalAmount > 0,
    executed: true,
    numericAmount: pending.totalAmount,
  };
}

function isCoreMoveGroupBonusDestination(
  to: Extract<Action, { kind: "core_move" }>["to"]
): to is Extract<
  NonNullable<Extract<Action, { kind: "core_move" }>["to"]>,
  { kind: "void" | "reserve" | "trash" | "life" }
> {
  return (
    to?.kind === "void" ||
    to?.kind === "reserve" ||
    to?.kind === "trash" ||
    to?.kind === "life"
  );
}

function targetCardCoreMoveCandidate(args: {
  state: GameState;
  card: CardInstance;
  toKind: "void" | "reserve" | "trash" | "life";
  toPlayerId: string;
  actingPlayerId: string;
  sourcePreventionLevel: import("../model").EffectPreventionLevel | undefined;
  sourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourceCard: CardInstance | undefined;
  effectSourceDefinition: CardDefinition | undefined;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): {
  instanceId: string;
  definitionId: string;
  availableCores: number;
} | null {
  const {
    state,
    card,
    toKind,
    toPlayerId,
    actingPlayerId,
    sourcePreventionLevel,
    sourcePreventionBypass,
    effectSourceCard,
    effectSourceDefinition,
    getCardDefinitionById,
  } = args;
  if (
    resolveCardImmunityAffect(
      state,
      card,
      actingPlayerId,
      sourcePreventionLevel,
      {
        ...(effectSourceCard ? { instance: effectSourceCard } : {}),
        ...(effectSourceDefinition
          ? { definition: effectSourceDefinition }
          : {}),
      },
      getCardDefinitionById,
      sourcePreventionBypass
    ).kind !== "allowed"
  ) {
    return null;
  }
  const soulOwner = state.players.find((p) => p.id === card.ownerPlayerId);
  const soulOnCard =
    soulOwner?.soulCoreLocation?.kind === "card" &&
    soulOwner.soulCoreLocation.instanceId === card.instanceId;
  const soulCanMove =
    soulOnCard && toKind !== "void" && card.ownerPlayerId === toPlayerId;
  const protectedMinRemaining = getCoreMinimumProtectedByResistance(
    state,
    card,
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel ?? "none",
    sourcePreventionBypass
  );
  const totalCoresOnSource = card.normalCoreCount + (soulOnCard ? 1 : 0);
  const maxMovableTotal = Math.max(
    0,
    totalCoresOnSource - protectedMinRemaining
  );
  const availableCores = Math.min(
    card.normalCoreCount + (soulCanMove ? 1 : 0),
    maxMovableTotal
  );
  if (availableCores <= 0) return null;
  return {
    instanceId: card.instanceId,
    definitionId: card.definitionId,
    availableCores,
  };
}

function maybeBuildDistinctRepeatCoreMoveBonusPending(args: {
  state: GameState;
  action: Action;
  step: EffectStep;
  stepIndex: number;
  effect: Effect;
  effectIndex: number;
  resolvedTargetIds: string[] | undefined;
  repeatExplicitTargetCount: number | null;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  sourceDefinition: CardDefinition | undefined;
  effectSourceInstanceId: string;
  effectSourceDefinition: CardDefinition | undefined;
  effectSourcePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourceTargetLockBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  sourceCardReferenceInstanceId: string | undefined;
  currentStepId: string;
  forceSnapshotContinuousTargets: boolean;
}): GameState | null {
  const {
    state,
    action,
    step,
    stepIndex,
    effect,
    effectIndex,
    resolvedTargetIds,
    repeatExplicitTargetCount,
    options,
    stepCtx,
    sourceDefinition,
    effectSourceInstanceId,
    effectSourceDefinition,
    effectSourcePreventionLevel,
    effectSourceTargetLockBypass,
    effectSourcePreventionBypass,
    sourceCardReferenceInstanceId,
    currentStepId,
    forceSnapshotContinuousTargets,
  } = args;
  if (
    action.kind !== "core_move" ||
    action.from.kind !== "target_card" ||
    !isCoreMoveGroupBonusDestination(action.to) ||
    typeof action.amount !== "number" ||
    action.amount !== 1 ||
    step.repeat?.allowDuplicateTargets !== false ||
    step.repeat.optional === true ||
    step.repeat.executionAdditional !== undefined ||
    step.repeat.condition !== undefined ||
    typeof step.repeat.additional !== "number" ||
    repeatExplicitTargetCount !== 1 ||
    resolvedTargetIds === undefined ||
    resolvedTargetIds.length !== 1 ||
    stepIndex + 1 < effect.steps.length ||
    options.postResolutionOracle !== undefined ||
    state.pendingCoreShootSelection !== null ||
    state.pendingAsIfSoulCoreChoice !== null
  ) {
    return null;
  }
  const bonus = computeCoreMoveAmountBonus(
    state,
    options.actingPlayerId,
    options.sourceInstanceId,
    options.getCardDefinitionById,
    options.effectSourceInstanceId
  );
  if (bonus <= 0) return null;

  const targetIds = [...resolvedTargetIds];
  const additional = Math.max(0, Math.floor(step.repeat.additional));
  for (let r = 0; r < additional; r++) {
    const explicitRepeatTargetIds =
      options.targetInstanceIds !== undefined
        ? options.targetInstanceIds.slice(r + 1, r + 2)
        : undefined;
    const repeatTargetIds = resolveTargets(
      action,
      state,
      options.actingPlayerId,
      options.sourceInstanceId,
      options.getCardDefinitionById,
      stepCtx,
      explicitRepeatTargetIds && explicitRepeatTargetIds.length > 0
        ? explicitRepeatTargetIds
        : undefined,
      sourceDefinition,
      effectSourcePreventionLevel,
      effectSourceTargetLockBypass,
      effectSourcePreventionBypass,
      undefined,
      effectIndex,
      currentStepId,
      options.rangeAutoResolveStrategy,
      effectSourceInstanceId,
      effectSourceDefinition,
      forceSnapshotContinuousTargets,
      targetIds,
      undefined,
      sourceCardReferenceInstanceId
    );
    if (!repeatTargetIds || repeatTargetIds.length !== 1) return null;
    targetIds.push(...repeatTargetIds);
  }
  if (targetIds.length <= 1) return null;

  const targetCards = targetIds
    .map((id) => state.cardInstances.find((card) => card.instanceId === id))
    .filter((card): card is CardInstance => card !== undefined);
  if (targetCards.length !== targetIds.length) return null;
  const fromPlayerId = targetCards[0]!.ownerPlayerId;
  if (targetCards.some((card) => card.ownerPlayerId !== fromPlayerId)) {
    return null;
  }
  if (fromPlayerId === options.actingPlayerId) return null;

  const to = action.to;
  const toPlayerId = resolvePlayerRef(options.actingPlayerId, to.player, state);
  const effectSourceCard = state.cardInstances.find(
    (card) => card.instanceId === effectSourceInstanceId
  );
  const candidates = targetCards
    .map((card) =>
      targetCardCoreMoveCandidate({
        state,
        card,
        toKind: to.kind,
        toPlayerId,
        actingPlayerId: options.actingPlayerId,
        sourcePreventionLevel: effectSourcePreventionLevel,
        sourcePreventionBypass: effectSourcePreventionBypass,
        effectSourceCard,
        effectSourceDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    )
    .filter(
      (
        candidate
      ): candidate is {
        instanceId: string;
        definitionId: string;
        availableCores: number;
      } => candidate !== null
    );
  if (candidates.length !== targetIds.length) return null;
  const baseTotal = targetIds.length;
  const totalAvailable = candidates.reduce(
    (sum, candidate) => sum + candidate.availableCores,
    0
  );
  const totalAmount = Math.min(baseTotal + bonus, totalAvailable);
  if (totalAmount < baseTotal) return null;

  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === options.sourceInstanceId
  );
  return {
    ...state,
    pendingCoreShootSelection: {
      pendingId: nextPendingSelectionId("cs"),
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      candidates,
      mandatoryTargetInstanceIds: targetIds,
      totalAmount,
      toKind: to.kind,
      toPlayerId,
      fromPlayerId,
      remainingActions: [],
      effectTiming: effect.timing,
      ...(options.battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
        : {}),
    },
    log: [
      ...state.log,
      `effect:core_move_amount_modifier:applied:${options.actingPlayerId}:+${bonus}:base=${baseTotal}:target_group`,
      `effect:core_move:target_card_group:${fromPlayerId}->${to.kind}:${toPlayerId}:pending:${candidates.length}candidates:total=${totalAmount}`,
    ],
  };
}

function isActionZeroSelectionAllowed(action: EffectStep["action"]): boolean {
  if ("optionalUpTo" in action && action.optionalUpTo === true) return true;
  const hasMinZeroRange = (value: unknown): boolean => {
    if (value === null || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if (record.min === 0 && record.max !== undefined) return true;
    return Object.values(record).some(hasMinZeroRange);
  };
  return hasMinZeroRange(action);
}

function stepResultCountsAsExecutedPayload(result: StepResult): boolean {
  if (result.executed === true) return true;
  return result.executed === undefined && result.succeeded === true;
}

function hasPriorExecutedPayload(stepCtx: StepExecutionContext): boolean {
  return Array.from(stepCtx.results.values()).some(
    stepResultCountsAsExecutedPayload
  );
}

function isDerivedOptionalEffectOverride(
  options: ExecuteEffectOptions,
  definitionEffect: Effect | undefined
): boolean {
  return (
    options.optionalStepResumeEffectOverride !== undefined &&
    JSON.stringify(options.optionalStepResumeEffectOverride.steps) !==
      JSON.stringify(definitionEffect?.steps)
  );
}

function isLaterPayloadOpportunityStep(step: EffectStep): boolean {
  if (
    step.connector === "conditional_result" ||
    step.connector === "conditional_cost" ||
    step.connector === "after_triggers" ||
    step.connector === "unless_previous_succeeded"
  ) {
    return false;
  }
  return true;
}

function hasLaterPayloadOpportunityStep(
  steps: readonly EffectStep[],
  currentStepIndex: number
): boolean {
  return steps
    .slice(currentStepIndex + 1)
    .some((step) => isLaterPayloadOpportunityStep(step));
}

function canDeclineOptionalStepAfterEffectLevelFire(args: {
  effect: Effect;
  activeAction: EffectStep["action"];
  stepIndex: number;
  stepCtx: StepExecutionContext;
  optionalQuantity: import("../model").PendingStepOptionalChoice["optionalQuantity"];
  isDerivedEffectOverride: boolean;
}): boolean {
  const {
    effect,
    activeAction,
    stepIndex,
    stepCtx,
    optionalQuantity,
    isDerivedEffectOverride,
  } = args;
  if (isDerivedEffectOverride) return true;
  if (effect.executionMode !== "optional") return true;
  if (optionalQuantity !== undefined && optionalQuantity.min === 0) return true;
  if (isActionZeroSelectionAllowed(activeAction)) return true;
  if (hasPriorExecutedPayload(stepCtx)) return true;
  return hasLaterPayloadOpportunityStep(effect.steps, stepIndex);
}

/**
 * Step-level optional execution mode の処理。「前段は強制実行、後段は任意」effect
 * (BSGE01-M03 step1 / BSGE01-C06 step2 / BSFT01-TR10(B) step1 等) を表現する。
 * activeCondition / stepCondition を通過した step だけが対象。正源:
 * memory project_kuwaerareru_optional + dsl-types.ts §EffectStep.executionMode。
 * 戻り値: proceed=通常実行へ / continue=辞退 resume で次 step / return=execute/decline 選択待ち。
 */
function handleStepOptionalExecution(args: {
  effect: Effect;
  step: EffectStep;
  stepIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  activeAction: EffectStep["action"];
  activeChooser: import("../dsl-types").PlayerRef | undefined;
  targetIdsConsumed: boolean;
  effectIndex: number;
  effectSourcePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourceTargetLockBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  sourceCardReferenceInstanceId: string | undefined;
}): StepPhaseOutcome {
  const {
    effect,
    step,
    stepIndex: i,
    options,
    stepCtx,
    activeAction,
    activeChooser,
    targetIdsConsumed,
    effectIndex,
    effectSourcePreventionLevel,
    effectSourceTargetLockBypass,
    effectSourcePreventionBypass,
    sourceCardReferenceInstanceId,
  } = args;
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  let currentState = args.currentState;
  if (
    !(
      step.executionMode === "optional" &&
      options.optionalExecuteResumeStepIndex !== i
    )
  ) {
    return { kind: "proceed", state: currentState };
  }
  if (options.declinedOptionalStepIndex === i) {
    // 辞退 resume: 当該 step を実行せず succeeded=false の stepResult を記録して次へ。
    recordStepResult(stepCtx, {
      stepId: step.id ?? `__step_${i}`,
      affectedCardInstanceIds: [],
      succeeded: false,
      executed: false,
    });
    currentState.log.push(
      `effect:step-optional-declined:${sourceInstanceId}:${effectIndex}:${i}`
    );
    return { kind: "continue", state: currentState };
  }
  const sourceCardForOptional = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const sourceDefinitionIdForOptional =
    sourceCardForOptional?.definitionId ?? "";
  const effectDefinitionIdForOptional =
    options.effectSourceDefinitionId ?? sourceDefinitionIdForOptional;
  const sourceDefinitionForOptional = getCardDefinitionById(
    sourceDefinitionIdForOptional
  );
  const effectSourceInstanceIdForOptional =
    options.effectSourceInstanceId ?? sourceInstanceId;
  const effectSourceCardForOptional = currentState.cardInstances.find(
    (c) => c.instanceId === effectSourceInstanceIdForOptional
  );
  const effectSourceDefinitionForOptional = getCardDefinitionById(
    options.effectSourceDefinitionId ??
      effectSourceCardForOptional?.definitionId ??
      effectDefinitionIdForOptional
  );
  if (
    step.usageLimit &&
    !(
      step.usageGroupId &&
      stepCtx.consumedUsageGroups?.includes(step.usageGroupId)
    )
  ) {
    const usageSource = getStepUsageSourceIdentity(currentState, options);
    const stepUsageLabel = getStepUsageLabel(
      usageSource.sourceDefinitionId,
      effectIndex,
      i,
      step.usageGroupId
    );
    const canUseStep = canUseEffectByUsageLimit({
      sourceEffect: effect,
      state: currentState,
      ...usageSource,
      getCardDefinitionById,
      playerId: actingPlayerId,
      effectLabel: stepUsageLabel,
      usageLimit: step.usageLimit,
    });
    if (!canUseStep) {
      currentState.log.push(
        `effect:step-usage-exhausted:${usageSource.sourceInstanceId}:${effectIndex}:${i}`
      );
      return { kind: "continue", state: currentState };
    }
  }
  const optionalQuantity = resolveOptionalStepQuantity({
    action: activeAction,
    state: currentState,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById,
  });
  const canDecline = canDeclineOptionalStepAfterEffectLevelFire({
    effect,
    activeAction,
    stepIndex: i,
    stepCtx,
    optionalQuantity,
    isDerivedEffectOverride: isDerivedOptionalEffectOverride(
      options,
      getDefinitionEffectForContinuation({
        definition: effectSourceDefinitionForOptional,
        options,
        effectIndex,
      })
    ),
  });
  const optionalCanExecute = canExecuteOptionalStep({
    effect,
    effectIndex,
    targetStepId: step.id ?? `__step_${i}`,
    allowEmptyTargets: canDecline,
    allowPartialTargetCount:
      effect.steps[i + 1]?.connector !== "conditional_cost",
    action: activeAction,
    state: currentState,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepCtx,
    ...(sourceDefinitionForOptional
      ? { sourceDefinition: sourceDefinitionForOptional }
      : {}),
    ...(effectSourceInstanceIdForOptional !== undefined
      ? { effectSourceInstanceId: effectSourceInstanceIdForOptional }
      : {}),
    ...(effectSourceDefinitionForOptional !== undefined
      ? { effectSourceDefinition: effectSourceDefinitionForOptional }
      : {}),
    ...(effectSourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: effectSourcePreventionLevel }
      : {}),
    ...(effectSourceTargetLockBypass !== undefined
      ? { sourceTargetLockBypass: effectSourceTargetLockBypass }
      : {}),
    ...(effectSourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: effectSourcePreventionBypass }
      : {}),
    ...(options.effectActionKind !== undefined
      ? { effectActionKind: options.effectActionKind }
      : {}),
    ...(sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId }
      : {}),
  });
  const stepLabel = step.id ?? `__step_${i}`;
  const cardsFromRefQuantity = resolveCardsFromRefOptionalStepQuantity({
    action: activeAction,
    state: currentState,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById,
  });
  if (cardsFromRefQuantity !== undefined && cardsFromRefQuantity.max <= 0) {
    recordStepResult(stepCtx, {
      stepId: stepLabel,
      affectedCardInstanceIds: [],
      succeeded: false,
      executed: false,
    });
    currentState.log.push(
      `effect:step-optional-zero-quantity-skipped:${sourceInstanceId}:${effectIndex}:${i}`
    );
    return { kind: "continue", state: currentState };
  }
  const battleEndDeferralAttackId = getBattleEndDeferralAttackIdForContinuation(
    {
      options,
      currentState,
      stepCtx,
      steps: effect.steps,
      startIndex: i,
    }
  );
  const continuation: import("../model").StepOptionalContinuation = {
    sourceDefinitionId: effectDefinitionIdForOptional,
    effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    sourceInstanceId,
    actingPlayerId,
    stepIndex: i,
    ...(options.optionalStepResumeEffectOverride !== undefined
      ? { resumeEffectOverride: options.optionalStepResumeEffectOverride }
      : { resumeEffectOverride: options.effect }),
    stepContext: serializeStepContext(stepCtx),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.effectActionKind !== undefined
      ? { effectActionKind: options.effectActionKind }
      : {}),
    ...(effectSourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: effectSourcePreventionLevel }
      : {}),
    ...(effectSourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: effectSourcePreventionBypass }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    chainId: options.chainId,
    ...(battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId }
      : {}),
    // 宣言時の target をそのまま resume 時に伝播 (まだ消費されていない後続 target step が
    // 失われないようにする)。group指定では、先行group消費後も後続の割付を保持する。
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...((!targetIdsConsumed || options.targetGroups?.length) &&
    options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(!targetIdsConsumed && options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...((!targetIdsConsumed || options.targetGroups?.length) &&
    options.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(currentState.pendingTargetedDisclosureContinuation !== null
      ? {
          targetedDisclosureContinuation:
            currentState.pendingTargetedDisclosureContinuation,
        }
      : {}),
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.eventAmount !== undefined
      ? { eventAmount: options.eventAmount }
      : {}),
    ...(options.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            options.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(options.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: options.pendingEffectPendingId }
      : {}),
  };
  const pendingId = `pso:${sourceInstanceId}:${effectIndex}:${i}`;
  // chooser 解決: step.chooser (variant 上書き反映済 activeChooser) を effect owner 基準で
  // 実プレイヤー ID に変換する (tryBuildStepOptionalTargetSelection と同 SSOT)。
  // - "self" / undefined → actingPlayerId
  // - "opponent" → 相手プレイヤー (state.playerOrder から派生)
  // - "either" → 現状 actingPlayerId にフォールバック (両者選択は別 mechanism、未スコープ)
  let choosingPlayerId = actingPlayerId;
  if (activeChooser === "opponent") {
    const opponentId = currentState.playerOrder.find(
      (id) => id !== actingPlayerId
    );
    if (opponentId) {
      choosingPlayerId = opponentId;
    }
  }
  if (optionalCanExecute === false && !canDecline) {
    if (
      activeAction.kind === "destroy" &&
      effect.steps[i + 1]?.connector !== "conditional_cost"
    ) {
      stepCtx.resolvedActionKinds = [
        ...new Set([...(stepCtx.resolvedActionKinds ?? []), activeAction.kind]),
      ];
    }
    recordStepResult(stepCtx, {
      stepId: stepLabel,
      affectedCardInstanceIds: [],
      succeeded: false,
      executed: true,
      ...(options.choiceIndex !== undefined
        ? { chosenChoiceIndex: options.choiceIndex }
        : {}),
    });
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        `effect:step-optional-fizzled:${sourceInstanceId}:${effectIndex}:${i}`,
      ],
    };
    return { kind: "continue", state: currentState };
  }
  currentState = {
    ...currentState,
    pendingStepOptionalChoice: {
      pendingId,
      actingPlayerId,
      choosingPlayerId,
      sourceInstanceId,
      sourceDefinitionId: sourceDefinitionIdForOptional,
      effectIndex,
      stepIndex: i,
      stepLabel,
      prompt: stepPromptForChoosingPlayer(
        buildPendingStepPrompt({
          action: activeAction,
          prompt:
            (options.choiceIndex !== undefined && options.choiceIndex > 0
              ? step.choice?.[options.choiceIndex - 1]?.prompt
              : undefined) ?? step.prompt,
        }),
        actingPlayerId,
        choosingPlayerId,
        {
          textLines: effectSourceDefinitionForOptional?.textLines,
          textRef: effect.textRef,
        }
      ),
      canExecute: optionalCanExecute,
      canDecline,
      ...(optionalQuantity !== undefined ? { optionalQuantity } : {}),
      continuation,
    },
    log: [
      ...currentState.log,
      `effect:step-optional-pending:${pendingId}:step=${i}`,
    ],
  };
  return { kind: "return", state: currentState };
}

/**
 * `deck_reveal` action、または `discard` action (fromZone:deck、原文「デッキを破棄する」側)
 * の step に到達したとき、実行者が `grant_optional_deck_reveal_count_boost` CE
 * (BSLH01-X09) を保持していれば +1 適用可否の pending を立てて中断する。resume pass
 * (`options.resolvedDeckRevealCountBoost.stepIndex === i`) では再検知せず素通りする
 * (bonus 加算は `applyDeckRevealCountBoostResumeBonus` が activeAction に反映済み)。
 */
function handleDeckRevealCountBoostChoice(args: {
  step: EffectStep;
  stepIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  activeAction: EffectStep["action"];
  targetIdsConsumed: boolean;
  effectIndex: number;
  effectSourcePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
}): StepPhaseOutcome {
  const {
    stepIndex: i,
    options,
    stepCtx,
    activeAction,
    targetIdsConsumed,
    effectIndex,
    effectSourcePreventionLevel,
    effectSourcePreventionBypass,
  } = args;
  const currentState = args.currentState;
  if (
    !activeAction ||
    (!isBoostableDeckRevealAction(activeAction) &&
      !isBoostableDeckDiscardAction(activeAction)) ||
    options.resolvedDeckRevealCountBoost?.stepIndex === i
  ) {
    return { kind: "proceed", state: currentState };
  }
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  const bonusAmount = findApplicableDeckRevealCountBoostBonus(
    currentState,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById
  );
  if (bonusAmount === undefined) {
    return { kind: "proceed", state: currentState };
  }
  const sourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const sourceDefinitionId = sourceCard?.definitionId ?? "";
  const continuation: import("../model").StepOptionalContinuation = {
    sourceDefinitionId,
    effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    sourceInstanceId,
    actingPlayerId,
    stepIndex: i,
    ...(options.optionalStepResumeEffectOverride !== undefined
      ? { resumeEffectOverride: options.optionalStepResumeEffectOverride }
      : { resumeEffectOverride: options.effect }),
    stepContext: serializeStepContext(stepCtx),
    ...(effectSourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: effectSourcePreventionLevel }
      : {}),
    ...(effectSourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: effectSourcePreventionBypass }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    chainId: options.chainId,
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...((!targetIdsConsumed || options.targetGroups?.length) &&
    options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(!targetIdsConsumed && options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...((!targetIdsConsumed || options.targetGroups?.length) &&
    options.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(currentState.pendingTargetedDisclosureContinuation !== null
      ? {
          targetedDisclosureContinuation:
            currentState.pendingTargetedDisclosureContinuation,
        }
      : {}),
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.eventAmount !== undefined
      ? { eventAmount: options.eventAmount }
      : {}),
    ...(options.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            options.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(options.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: options.pendingEffectPendingId }
      : {}),
    ...(options.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
      : {}),
  };
  const pendingId = `drcb:${sourceInstanceId}:${effectIndex}:${i}`;
  const nextState: GameState = {
    ...currentState,
    pendingDeckRevealCountBoostChoice: {
      pendingId,
      actingPlayerId,
      sourceInstanceId,
      sourceDefinitionId,
      effectIndex,
      stepIndex: i,
      bonusAmount,
      ...(options.battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
        : {}),
      continuation,
    },
    log: [
      ...currentState.log,
      `effect:deck-reveal-count-boost-pending:${pendingId}:step=${i}`,
    ],
  };
  return { kind: "return", state: nextState };
}

/**
 * Step-level usageLimit（効果途中ステップの〔ターンに1回〕等）の gate/record。
 * choice ステップは effect レベルへ昇格済のため対象外。resume 入口ステップは二重カウント防止。
 * 回数超過なら continue（当該 step skip）、それ以外は proceed（消費後 state を継続）。
 */
function getStepUsageSourceIdentity(
  state: GameState,
  options: ExecuteEffectOptions
): { sourceInstanceId: string; sourceDefinitionId: string } {
  const sourceInstanceId =
    options.effectSourceInstanceId ?? options.sourceInstanceId;
  const sourceDefinitionId =
    options.effectSourceDefinitionId ??
    state.cardInstances.find((card) => card.instanceId === sourceInstanceId)
      ?.definitionId ??
    "";
  return { sourceInstanceId, sourceDefinitionId };
}

function handleStepUsageLimit(args: {
  effect: Effect;
  stepCtx: StepExecutionContext;
  step: EffectStep;
  stepIndex: number;
  options: ExecuteEffectOptions;
  currentState: GameState;
  effectIndex: number;
}): StepPhaseOutcome {
  const { step, stepIndex: i, options, effectIndex } = args;
  const { actingPlayerId } = options;
  let currentState = args.currentState;
  if (
    step.usageGroupId &&
    args.stepCtx.consumedUsageGroups?.includes(step.usageGroupId)
  ) {
    return { kind: "proceed", state: currentState };
  }
  const stepLimit = step.usageLimit;
  const isChoiceStep = !!(step.choice && step.choice.length > 0);
  // optional execute 再起動は startFromStepIndex===i だが usageLimit を未消費で中断したため、
  // 通常の resume-entry suppression を適用せず再度 gate/record する。
  const isResumeEntryStep =
    options.startFromStepIndex !== undefined &&
    i === options.startFromStepIndex &&
    (options.optionalExecuteResumeStepIndex !== i ||
      options.skipStepUsageAtResume === true);
  if (stepLimit && !isChoiceStep && !isResumeEntryStep) {
    // battle-immediate の host 継承効果は sourceInstanceId が host を指す一方、
    // queue 時の declarationStepUsage は効果テキスト提供元（合体ブレイヴ／
    // text_role under）の identity で事前判定する。同じ identity で記録しなければ、
    // 同一 step の二回目が queue 前に除外されず空 prompt になる。
    const { sourceInstanceId: usageSourceInstanceId, sourceDefinitionId } =
      getStepUsageSourceIdentity(currentState, options);
    const stepUsageLabel = getStepUsageLabel(
      sourceDefinitionId,
      effectIndex,
      i,
      step.usageGroupId
    );
    const canUseStep = canUseEffectByUsageLimit({
      sourceEffect: args.effect,
      state: currentState,
      sourceInstanceId: usageSourceInstanceId,
      sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
      playerId: actingPlayerId,
      effectLabel: stepUsageLabel,
      usageLimit: stepLimit,
    });
    if (!canUseStep) {
      currentState.log.push(
        `effect:step-usage-exhausted:${usageSourceInstanceId}:${effectIndex}:${i}`
      );
      return { kind: "continue", state: currentState };
    }
    currentState = recordEffectUsageIfLimited({
      state: currentState,
      sourceInstanceId: usageSourceInstanceId,
      sourceDefinitionId,
      playerId: actingPlayerId,
      effectLabel: stepUsageLabel,
      usageLimit: stepLimit,
    });
    if (step.usageGroupId) {
      args.stepCtx.consumedUsageGroups = [
        ...(args.stepCtx.consumedUsageGroups ?? []),
        step.usageGroupId,
      ];
    }
  }
  return { kind: "proceed", state: currentState };
}

/**
 * Step の retrigger（再発火）を ContinuousEffect (modifierTag="retrigger") として登録する
 * (P3-15 問題6)。登録した step は succeeded の stepResult を記録して continue（次 step）。
 * step.retrigger が無ければ proceed。
 */
function handleStepRetrigger(args: {
  step: EffectStep;
  stepIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  effectIndex: number;
}): StepPhaseOutcome {
  const { step, stepIndex: i, options, stepCtx, effectIndex } = args;
  const { sourceInstanceId, actingPlayerId } = options;
  let currentState = args.currentState;
  if (!step.retrigger) return { kind: "proceed", state: currentState };
  const rt = step.retrigger;
  const sourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const retriggerEffect: RetriggerEffect = {
    effectId: `retrigger:${sourceInstanceId}:${i}:${currentState.turnNumber}`,
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "",
    actingPlayerId,
    modifierTag: "retrigger",
    duration: rt.duration ?? { scope: "turn" },
    createdAtTurn: currentState.turnNumber,
    createdAtAttackId: currentState.activeAttack?.attackId ?? null,
    provenance: {
      effectIndex,
      stepIndex: i,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
    },
    retriggerEvent: rt.event,
    retriggerPlayer: rt.triggerPlayer ?? "self",
    retriggerEffectIndex: effectIndex,
    retriggerStepIndex: i,
    retriggerFireCount: 0,
    ...(rt.fireExecutionMode !== undefined
      ? { retriggerFireExecutionMode: rt.fireExecutionMode }
      : {}),
    ...(rt.autoResolveOptional !== undefined
      ? { retriggerAutoResolveOptional: rt.autoResolveOptional }
      : {}),
    ...(rt.triggerFilter
      ? {
          retriggerFilter: convertCardFilterToTriggerFilter(rt.triggerFilter),
        }
      : {}),
    ...(rt.maxCount !== undefined ? { retriggerMaxCount: rt.maxCount } : {}),
  };
  currentState = {
    ...currentState,
    activeContinuousEffects: [
      ...currentState.activeContinuousEffects,
      retriggerEffect,
    ],
    log: [
      ...currentState.log,
      `retrigger:registered:${retriggerEffect.effectId}:event=${rt.event}:max=${rt.maxCount ?? "unlimited"}`,
    ],
  };
  recordStepResult(stepCtx, {
    stepId: step.id ?? `__step_${i}`,
    affectedCardInstanceIds: [],
    succeeded: true,
  });
  return { kind: "continue", state: currentState };
}

/**
 * `targetSelectionTiming:"on_step"` の step で、解決時対象選択 pending を構築する。
 * pending が立てば break（プレイヤー応答待ちで step ループ中断）、立たなければ proceed。
 */
function handleStepOnStepTargetSelection(args: {
  step: EffectStep;
  stepIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  effect: Effect;
  activeAction: EffectStep["action"];
  activeChooser: import("../dsl-types").PlayerRef | undefined;
  targetIdsConsumed: boolean;
  effectIndex: number;
  effectSourcePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourceTargetLockBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
}): StepPhaseOutcome {
  const {
    step,
    stepIndex: i,
    options,
    stepCtx,
    effect,
    activeAction,
    activeChooser,
    targetIdsConsumed,
    effectIndex,
    effectSourcePreventionLevel,
    effectSourceTargetLockBypass,
    effectSourcePreventionBypass,
  } = args;
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  let currentState = args.currentState;
  if (step.targetSelectionTiming !== "on_step") {
    return { kind: "proceed", state: currentState };
  }
  const sourceCardForStepTarget = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const sourceDefinitionIdForStepTarget =
    sourceCardForStepTarget?.definitionId ?? "";
  const effectDefinitionIdForStepTarget =
    options.effectSourceDefinitionId ?? sourceDefinitionIdForStepTarget;
  const sourceDefinitionForStepTarget = getCardDefinitionById(
    sourceDefinitionIdForStepTarget
  );
  const targetPending = tryBuildStepTargetSelection({
    state: currentState,
    effect,
    step,
    stepIndex: i,
    activeAction,
    ...(activeChooser !== undefined ? { activeChooser } : {}),
    sourceInstanceId,
    sourceDefinitionId: effectDefinitionIdForStepTarget,
    ...(sourceDefinitionForStepTarget
      ? { sourceDefinition: sourceDefinitionForStepTarget }
      : {}),
    effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    actingPlayerId,
    stepCtx,
    getCardDefinitionById,
    targetIdsConsumed,
    ...(options.targetInstanceIds !== undefined
      ? { targetInstanceIds: options.targetInstanceIds }
      : {}),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetSelectionResolved !== undefined
      ? { targetSelectionResolved: options.targetSelectionResolved }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.effectActionKind !== undefined
      ? { effectActionKind: options.effectActionKind }
      : {}),
    ...(effectSourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: effectSourcePreventionLevel }
      : {}),
    ...(effectSourceTargetLockBypass !== undefined
      ? { sourceTargetLockBypass: effectSourceTargetLockBypass }
      : {}),
    ...(effectSourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: effectSourcePreventionBypass }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    chainId: options.chainId,
    ...(options.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
      : {}),
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.eventAmount !== undefined
      ? { eventAmount: options.eventAmount }
      : {}),
    ...(options.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            options.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(options.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: options.pendingEffectPendingId }
      : {}),
    ...(options.repeatResume !== undefined
      ? { repeatResume: options.repeatResume }
      : {}),
    ...(options.stepTargetSelectionBypassesPreventionGate !== undefined
      ? {
          targetSelectionBypassesPreventionGate:
            options.stepTargetSelectionBypassesPreventionGate,
        }
      : {}),
  });
  if (targetPending) {
    targetPending.continuation = {
      ...targetPending.continuation,
      resumeEffectOverride: options.optionalStepResumeEffectOverride ?? effect,
    };
    if (options.onStepTargetSelection) {
      return {
        kind: "break",
        state: options.onStepTargetSelection({
          state: currentState,
          pending: targetPending,
          stepIndex: i,
          stepContext: serializeStepContext(stepCtx),
        }),
      };
    }
    currentState = {
      ...currentState,
      pendingStepOptionalTargetSelection: targetPending,
      log: [
        ...currentState.log,
        `effect:step-target-pending:${targetPending.pendingId}:step=${i}:candidates=${targetPending.candidateInstanceIds.length}`,
      ],
    };
    return { kind: "break", state: currentState };
  }
  return { kind: "proceed", state: currentState };
}

function isEndRestrictionBlockLog(entry: string): boolean {
  return (
    entry.startsWith("effect:end_attack_step:blocked-by-restriction:") ||
    entry.startsWith("effect:end_battle:blocked-by-restriction:") ||
    entry.startsWith("effect:end_single_battle:blocked-by-restriction:") ||
    entry.startsWith("effect:end_turn:blocked-by-restriction:")
  );
}

function getEndRestrictionCheckForAction(action: Action): {
  tags: readonly EndRestrictionTag[];
  unaffectedByRestriction?: boolean;
} | null {
  switch (action.kind) {
    case "end_attack_step":
      return {
        tags: ["restrict_end_attack_step", "restrict_end_step"],
        ...(action.unaffectedByRestriction !== undefined
          ? { unaffectedByRestriction: action.unaffectedByRestriction }
          : {}),
      };
    case "end_battle":
    case "end_single_battle":
      return {
        tags: ["restrict_end_battle"],
        ...(action.unaffectedByRestriction !== undefined
          ? { unaffectedByRestriction: action.unaffectedByRestriction }
          : {}),
      };
    case "end_turn":
      return {
        tags: ["restrict_end_turn"],
        ...(action.unaffectedByRestriction !== undefined
          ? { unaffectedByRestriction: action.unaffectedByRestriction }
          : {}),
      };
    default:
      return null;
  }
}

function hasPositiveRefBlockedByOpponentEffectCondition(
  condition: StepCondition | undefined,
  stepId: string
): boolean {
  if (!condition || condition.not === true) return false;
  switch (condition.kind) {
    case "all":
      return condition.conditions.some((child) =>
        hasPositiveRefBlockedByOpponentEffectCondition(child, stepId)
      );
    case "ref_blocked_by_opponent_effect":
      return condition.stepId === stepId;
    default:
      return false;
  }
}

/**
 * `EffectStep.repeat` の追加発揮数を評価する。
 *
 * 選択 pending をまたぐ repeat は、最初の発揮時の値を continuation に保存して
 * 再開時に同じ値を使う。これにより、1巡目の配置などで動的数量の参照元が変わっても
 * 「発揮開始時に N 回」という本文上の回数が変動しない。
 */
function resolveRepeatAdditionalCount(args: {
  repeat: NonNullable<EffectStep["repeat"]>;
  state: GameState;
  conditionSourceInstanceId: string;
  conditionSourceContext: Parameters<typeof evaluateCondition>[6];
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepCtx: StepExecutionContext;
  choiceIndex: number | undefined;
}): number {
  const {
    repeat,
    state,
    conditionSourceInstanceId,
    conditionSourceContext,
    actingPlayerId,
    getCardDefinitionById,
    stepCtx,
    choiceIndex,
  } = args;
  const repeatGateMet =
    !repeat.condition || repeat.condition.length === 0
      ? true
      : evaluateCondition(
          state,
          repeat.condition,
          conditionSourceInstanceId,
          actingPlayerId,
          getCardDefinitionById,
          undefined,
          conditionSourceContext
        );
  const optionalRepeatChosen =
    repeat.optional !== true || (choiceIndex ?? 0) > 0;
  if (!repeatGateMet || !optionalRepeatChosen) return 0;
  return Math.max(
    0,
    resolveCountBound(
      repeat.executionAdditional ?? repeat.additional,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    )
  );
}

/**
 * 1 step の DSL action を native path で実行する統合フェーズ (P2-13 inc6)。
 * TargetSpec 解決 → 対象取得ゲート → action dispatch → redirect/repeat →
 * conditional_cost rollback → 未対応 fallback までを担う。executeEffect の step
 * ループ本体末尾 (~1,138 行) を、周回横断 cursor (参照渡し) と StepPhaseOutcome
 * シグナル (proceed/continue/break/return) 経由で orchestrator から切り離す。
 * ループ制御は orchestrator が解釈する (helper 内では return シグナルへ変換)。
 */
function executeStepNativeAction(args: {
  step: EffectStep;
  stepIndex: number;
  startIndex: number;
  options: ExecuteEffectOptions;
  stepCtx: StepExecutionContext;
  currentState: GameState;
  effect: Effect;
  activeAction: EffectStep["action"];
  activeChooser: import("../dsl-types").PlayerRef | undefined;
  effectIndex: number;
  effectSourcePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourceNegatePreventionLevel:
    | import("../model").EffectPreventionLevel
    | undefined;
  effectSourceTargetLockBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourcePreventionBypass:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  effectSourceDefinitionIdAtStart: string;
  effectResolutionBeforeState: GameState;
  cursors: {
    targetIdsConsumed: boolean;
    targetIdsCursor: number;
    sequentialTargetIndexesConsumed: Set<number>;
    previousStepPreState: GameState | null;
    previousStepId: string | null;
  };
  groupedTargetIdsByStepId: Map<string, string[]> | null;
  groupedTargetIndexesByStepId: Map<string, number[]> | null;
}): StepPhaseOutcome {
  const {
    step,
    stepIndex: i,
    startIndex,
    options,
    stepCtx,
    effect,
    activeAction,
    activeChooser,
    effectIndex,
    effectSourcePreventionLevel,
    effectSourceNegatePreventionLevel,
    effectSourceTargetLockBypass,
    effectSourcePreventionBypass,
    effectResolutionBeforeState,
    cursors,
    groupedTargetIdsByStepId,
    groupedTargetIndexesByStepId,
  } = args;
  let nativeAction = activeAction;
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  const steps = effect.steps;
  let currentState = args.currentState;
  // --- TargetSpec 解決 ---
  const currentStepId = step.id ?? `__step_${i}`;
  const repeatResume =
    options.repeatResume?.stepIndex === i ? options.repeatResume : undefined;
  const skipInitialActionForRepeatResume =
    repeatResume?.skipBaseAction === true;
  const repeatStartIndex = repeatResume?.nextAdditionalIndex ?? 0;
  const canConsumePassedTargets =
    options.targetStepId === undefined ||
    options.targetStepId === currentStepId;
  const explicitTargetCountForAction = getExplicitTargetCountForAction(
    activeAction,
    currentState,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  const repeatExplicitTargetCount =
    step.repeat &&
    explicitTargetCountForAction !== null &&
    (step.repeat.optional !== true || (options.choiceIndex ?? 0) > 0)
      ? explicitTargetCountForAction
      : null;
  const shouldConsumeTargetsSequentially =
    options.sequentialTargetConsumption === true &&
    options.targetStepId === undefined &&
    explicitTargetCountForAction !== null;
  let sequentialTargetSelection: { ids: string[]; indexes: number[] } | null =
    null;
  const groupedActionTargetIds =
    canConsumePassedTargets && groupedTargetIdsByStepId?.has(currentStepId)
      ? groupedTargetIdsByStepId.get(currentStepId)!
      : undefined;
  const groupedActionTargetIndexes =
    canConsumePassedTargets && groupedTargetIndexesByStepId?.has(currentStepId)
      ? groupedTargetIndexesByStepId.get(currentStepId)!
      : undefined;
  const hasProvidedTargetsForAction =
    canConsumePassedTargets &&
    options.targetInstanceIds !== undefined &&
    (options.targetInstanceIds.length > 0 ||
      options.targetSelectionResolved === true);
  const actionTargetIds =
    groupedActionTargetIds !== undefined
      ? groupedActionTargetIds
      : hasProvidedTargetsForAction
        ? repeatExplicitTargetCount !== null
          ? options.targetInstanceIds!.slice(0, repeatExplicitTargetCount)
          : shouldConsumeTargetsSequentially
            ? (() => {
                sequentialTargetSelection = selectSequentialActionTargets(
                  options.targetInstanceIds!,
                  cursors.sequentialTargetIndexesConsumed,
                  explicitTargetCountForAction,
                  activeAction,
                  currentState,
                  actingPlayerId,
                  sourceInstanceId,
                  getCardDefinitionById,
                  stepCtx,
                  cursors.targetIdsCursor,
                  effectSourceTargetLockBypass
                );
                return sequentialTargetSelection.ids;
              })()
            : !cursors.targetIdsConsumed
              ? options.targetInstanceIds
              : undefined
        : undefined;
  const shouldValidateOnStepPreSelectedTargets =
    step.targetSelectionTiming === "on_step" && actionTargetIds !== undefined;
  const forceSnapshotContinuousTargets =
    actionTargetIds !== undefined &&
    i === startIndex &&
    options.forceSnapshotContinuousTargets === true;

  // --- after_triggers 用: action 実行直前の pre-state を記録
  // skip 判定（condition/stepCondition unmet, pending 等）通過後 = 実際に action が実行される step でのみ更新
  cursors.previousStepPreState = cloneStateForTriggerDelta(currentState);
  cursors.previousStepId = currentStepId;

  // --- DSL Action を native path で実行 ---
  const sourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const sourceDef = getCardDefinitionById(sourceCard?.definitionId ?? "");
  const effectSourceInstanceId =
    options.effectSourceInstanceId ?? sourceInstanceId;
  const effectSourceDefinitionId =
    options.effectSourceDefinitionId ?? args.effectSourceDefinitionIdAtStart;
  const { conditionSourceInstanceId, conditionSourceContext } =
    resolveEffectConditionSourceEvaluation({
      state: currentState,
      sourceInstanceId,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });
  const sourceCardReferenceInstanceId = resolveSourceCardReferenceInstanceId({
    state: currentState,
    sourceInstanceId,
    ...(options.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: options.sourceCardReferenceInstanceId }
      : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  const effectSourceCard = currentState.cardInstances.find(
    (c) => c.instanceId === effectSourceInstanceId
  );
  const effectSourceDefinition =
    getCardDefinitionById(
      options.effectSourceDefinitionId ??
        effectSourceCard?.definitionId ??
        effectSourceDefinitionId
    ) ?? sourceDef;
  const redirectEffectSourceIdentity = resolveAffectSourceIdentity({
    state: currentState,
    sourceInstanceId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });

  const resolvedTargetIds = skipInitialActionForRepeatResume
    ? [...(repeatResume.excludedTargetInstanceIds ?? [])]
    : resolveTargets(
        activeAction,
        currentState,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx,
        actionTargetIds,
        sourceDef,
        effectSourcePreventionLevel,
        effectSourceTargetLockBypass,
        effectSourcePreventionBypass,
        options.targetSelectionResolved === true &&
          actionTargetIds !== undefined,
        effectIndex,
        currentStepId,
        options.rangeAutoResolveStrategy,
        effectSourceInstanceId,
        effectSourceDefinition,
        forceSnapshotContinuousTargets,
        undefined,
        shouldValidateOnStepPreSelectedTargets,
        sourceCardReferenceInstanceId,
        options.preservePreSelectedTargetRefs === true
      );

  if (
    step.connector === "conditional_cost" &&
    (isConditionalCostTargetShortage(
      activeAction,
      resolvedTargetIds,
      currentState,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    ) ||
      hasInvalidConditionalCostExplicitTargets(
        activeAction,
        currentState,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx,
        actionTargetIds,
        sourceDef,
        effectSourceTargetLockBypass
      ))
  ) {
    recordStepResult(stepCtx, {
      stepId: step.id ?? `__step_${i}`,
      affectedCardInstanceIds: [],
      succeeded: false,
    });
    if (
      maybeDeferConditionalCostRollback({
        step,
        stepCtx,
        sourceInstanceId,
        failureLogEntries: [
          `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
          `effect:conditional-cost-target-shortage:${sourceInstanceId}`,
        ],
      })
    ) {
      return { kind: "continue", state: currentState };
    }
    currentState = stepCtx.originalState;
    if (
      options.recordedUsage &&
      shouldRefundRecordedUsageForConditionalCostRollback(stepCtx)
    ) {
      currentState = refundAllRecordedUsage(
        currentState,
        sourceInstanceId,
        options.recordedUsage
      );
    }
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
        `effect:conditional-cost-target-shortage:${sourceInstanceId}`,
      ],
    };
    return { kind: "continue", state: currentState };
  }

  const canUseResolvedTargetsForTargetInterruption =
    resolvedTargetsAreConcreteEffectTargets(activeAction, resolvedTargetIds);
  const targetedDisclosureSlices: Array<{ start: number; ids: string[] }> = [];
  if (
    canUseResolvedTargetsForTargetInterruption &&
    !skipInitialActionForRepeatResume &&
    resolvedTargetIds &&
    resolvedTargetIds.length > 0
  ) {
    targetedDisclosureSlices.push({ start: 0, ids: resolvedTargetIds });
  }
  if (
    canUseResolvedTargetsForTargetInterruption &&
    repeatExplicitTargetCount !== null &&
    repeatExplicitTargetCount > 0 &&
    options.targetInstanceIds
  ) {
    const repeatSliceCount = Math.max(
      0,
      Math.floor(options.targetInstanceIds.length / repeatExplicitTargetCount) -
        1
    );
    const repeatDisclosureSeenTargetIds = [
      ...(skipInitialActionForRepeatResume
        ? (repeatResume.excludedTargetInstanceIds ?? [])
        : (resolvedTargetIds ?? [])),
    ];
    for (let r = repeatStartIndex; r < repeatSliceCount; r++) {
      const start = repeatExplicitTargetCount * (r + 1);
      const explicitRepeatTargetIds = options.targetInstanceIds.slice(
        start,
        start + repeatExplicitTargetCount
      );
      if (explicitRepeatTargetIds.length === 0) continue;
      const repeatTargetIds = resolveTargets(
        activeAction,
        currentState,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx,
        explicitRepeatTargetIds,
        sourceDef,
        effectSourcePreventionLevel,
        effectSourceTargetLockBypass,
        effectSourcePreventionBypass,
        undefined,
        effectIndex,
        currentStepId,
        undefined,
        effectSourceInstanceId,
        effectSourceDefinition,
        forceSnapshotContinuousTargets,
        step.repeat?.allowDuplicateTargets === false
          ? repeatDisclosureSeenTargetIds
          : undefined,
        step.targetSelectionTiming === "on_step" &&
          explicitRepeatTargetIds.length > 0,
        sourceCardReferenceInstanceId
      );
      if (repeatTargetIds && repeatTargetIds.length > 0) {
        targetedDisclosureSlices.push({ start, ids: repeatTargetIds });
        repeatDisclosureSeenTargetIds.push(...repeatTargetIds);
      }
    }
  }
  const shouldSkipTargetedDisclosureSlice = (slice: {
    start: number;
    ids: string[];
  }) => {
    // 対象 step の前にカウント等の支払い step がある場合でも、対象開示後の
    // 再開では同じ宣言済み TargetRef を二重に公開しない。`startIndex` は 0 のまま
    // 支払いを再実行するため、従来の i === startIndex 限定では on_step target を
    // もう一度 disclosure して continuation を自己再発行してしまう。
    if (
      options.preservePreSelectedTargetRefs === true &&
      (options.targetStepId === undefined ||
        options.targetStepId === currentStepId)
    ) {
      return true;
    }
    if (i !== startIndex) {
      return false;
    }
    // targeted disclosure 後の stack 再開は、同じ宣言済み TargetRef を本体へ渡す。
    // ここで再度 disclosure を積むと、応答後に新たに得た target lock を再取得と
    // 誤認して continuation が自己再発行される。対象 zone の存在確認は呼出側で済む。
    if (options.skipTargetedDisclosureAtStartStep !== true) return false;
    const hasExplicitTargetSlice =
      options.skipTargetedDisclosureTargetStartAtStartStep !== undefined ||
      options.skipTargetedDisclosureTargetCountAtStartStep !== undefined;
    const stepMatches =
      (options.skipTargetedDisclosureStepId ?? options.targetStepId) ===
      currentStepId;
    if (options.targetSelectionResolved === true) {
      return true;
    }
    if (!stepMatches && !hasExplicitTargetSlice) return false;
    return (
      (options.skipTargetedDisclosureTargetStartAtStartStep === undefined ||
        options.skipTargetedDisclosureTargetStartAtStartStep === slice.start) &&
      (options.skipTargetedDisclosureTargetCountAtStartStep === undefined ||
        options.skipTargetedDisclosureTargetCountAtStartStep ===
          slice.ids.length)
    );
  };
  const targetedDisclosureRemainingSlices = targetedDisclosureSlices.filter(
    (slice) => !shouldSkipTargetedDisclosureSlice(slice)
  );
  const targetedDisclosureTargetIds = targetedDisclosureRemainingSlices.flatMap(
    (slice) => slice.ids
  );
  // 対象候補ではなく、耐性・対象ロックを通過して実際に確定した対象だけを
  // 公開情報として emit する。手札/デッキなど、現時点で素性が非公開のカードは
  // instanceId を含めず、後続の公開移動があった場合だけ state 差分側で記録する。
  const definitionPath = definitionEffectPath(options);
  const definitionEffect = getDefinitionEffectForContinuation({
    definition: getCardDefinitionById(
      options.effectSourceDefinitionId ??
        currentState.cardInstances.find(
          (card) => card.instanceId === sourceInstanceId
        )?.definitionId ??
        ""
    ),
    options,
    effectIndex,
  });
  const provenance: NonNullable<ContinuousEffect["provenance"]> = {
    effectIndex,
    stepIndex: i,
    // 元定義に存在しない合成効果を effects[0] と誤認しない。
    ...(options.effectIndex === undefined && definitionEffect !== effect
      ? { definitionPath: null }
      : definitionPath.length > 1
        ? { definitionPath }
        : {}),
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
  };
  const publicTargetIds = dedupePreserveOrder(
    targetedDisclosureTargetIds
  ).filter((instanceId) =>
    isCardIdentityPublicForDisclosure(currentState, instanceId)
  );
  if (publicTargetIds.length > 0) {
    const actionLabel =
      publicDisclosureActionLabelForAction(activeAction) ?? "action_execute";
    currentState = appendPublicDisclosure(currentState, {
      turnNumber: currentState.turnNumber,
      step: currentState.step,
      actorPlayerId: actingPlayerId,
      audience: "both",
      source: {
        instanceId: effectSourceInstanceId,
        ...(typeof effectIndex === "number" ? { effectIndex } : {}),
        ...(provenance.definitionPath !== undefined
          ? { definitionPath: provenance.definitionPath }
          : {}),
      },
      kind: "target_declared",
      targets: publicTargetIds.map((instanceId) => ({
        kind: "card" as const,
        instanceId,
        actionLabel,
        ...(actionLabel === "action_execute"
          ? { actionKind: activeAction.kind }
          : {}),
      })),
      results: [],
    });
  }
  if (
    targetedDisclosureTargetIds.length > 0 &&
    typeof effectIndex === "number"
  ) {
    const disclosureSourceDefinitionId =
      options.targetedDisclosureSourceDefinitionId ?? effectSourceDefinitionId;
    if (disclosureSourceDefinitionId) {
      const targetCandidateInstanceIds =
        resolveTargetCandidateIds(
          activeAction,
          currentState,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepCtx,
          sourceDef,
          effectSourcePreventionLevel,
          effectSourceTargetLockBypass,
          effectSourcePreventionBypass,
          effectSourceInstanceId,
          effectSourceDefinition
        ) ?? [];
      const disclosureStart = targetedDisclosureRemainingSlices[0]?.start ?? 0;
      const disclosureEnd = targetedDisclosureRemainingSlices.reduce(
        (max, slice) => Math.max(max, slice.start + slice.ids.length),
        disclosureStart
      );
      const disclosed = queueTargetedDisclosureForStep({
        state: currentState,
        selectedTargetInstanceIds: targetedDisclosureTargetIds,
        // The resume injection belongs only to the declared target step.
        // A later ref-target step must recompute from its StepResult rather
        // than inheriting the last on_step choice through its disclosure
        // continuation (ENGINE-c08-on-step-repeat-targeted-disclosure).
        ...(canConsumePassedTargets && options.targetInstanceIds !== undefined
          ? { resumeTargetInstanceIds: options.targetInstanceIds }
          : {}),
        ...(canConsumePassedTargets && options.targetGroups !== undefined
          ? { resumeTargetGroups: options.targetGroups }
          : {}),
        ...(canConsumePassedTargets &&
        options.sequentialTargetConsumption === true
          ? { resumeSequentialTargetConsumption: true }
          : {}),
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: disclosureSourceDefinitionId,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        ...(sourceCardReferenceInstanceId !== undefined
          ? { sourceCardReferenceInstanceId }
          : {}),
        targetedEventSourceInstanceId: effectSourceInstanceId,
        targetedEventSourceDefinitionId: effectSourceDefinitionId,
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(options.effectActivationTiming !== undefined
          ? { effectActivationTiming: options.effectActivationTiming }
          : {}),
        ...(options.chainId !== undefined ? { chainId: options.chainId } : {}),
        effectIndex,
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
        resumeStepIndex: i,
        ...(options.optionalExecuteResumeStepIndex !== undefined
          ? {
              optionalExecuteResumeStepIndex:
                options.optionalExecuteResumeStepIndex,
            }
          : {}),
        targetStepId: currentStepId,
        stepContext: serializeStepContext(stepCtx),
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
        effectResolutionBeforeState,
        disclosureTargetStart: disclosureStart,
        disclosureTargetCount: disclosureEnd - disclosureStart,
        targetCandidateInstanceIds,
        ...(options.targetedDisclosureNegateIdentity !== undefined
          ? { negateIdentitySnapshot: options.targetedDisclosureNegateIdentity }
          : {}),
      });
      if (disclosed.queued) {
        return { kind: "return", state: disclosed.state };
      }
    }
  }

  // --- P3-47 F-4 Step 3b: 効果対象リダイレクト検出 ---
  // resolveTargets が解決した対象集合に redirect_effect_target CE の保護対象が
  // 含まれていれば、本ステップを中断し pendingTargetRedirects に push する。
  // confirm/decline 後に applyTargetRedirectAction が executeEffect を
  // startFromStepIndex=i で再起動し、redirect 先 ID を targetInstanceIds として渡す。
  //
  // 制約:
  // - 既に actionTargetIds (= 再起動済み) で進入してきた場合は再 redirect しない
  //   (= cursors.targetIdsConsumed=false でも、redirect 後再入は targetInstanceIds として
  //    流れるためここでも match しないが、保険として skip)。
  // - resolvedTargetIds が空ならそもそも保護対象は含まれない → skip。
  if (
    canUseResolvedTargetsForTargetInterruption &&
    !skipInitialActionForRepeatResume &&
    resolvedTargetIds &&
    resolvedTargetIds.length > 0
  ) {
    const redirectTargetSlices: Array<{
      start: number;
      ids: string[];
      indexes?: number[];
    }> = [
      {
        start: groupedActionTargetIndexes?.[0] ?? 0,
        ids: resolvedTargetIds,
        ...(groupedActionTargetIndexes !== undefined
          ? { indexes: groupedActionTargetIndexes }
          : {}),
      },
    ];
    if (
      repeatExplicitTargetCount !== null &&
      repeatExplicitTargetCount > 0 &&
      options.targetInstanceIds
    ) {
      const repeatSliceCount = Math.max(
        0,
        Math.floor(
          options.targetInstanceIds.length / repeatExplicitTargetCount
        ) - 1
      );
      const repeatRedirectSeenTargetIds = [...resolvedTargetIds];
      for (let r = repeatStartIndex; r < repeatSliceCount; r++) {
        const start = repeatExplicitTargetCount * (r + 1);
        const explicitRepeatTargetIds = options.targetInstanceIds.slice(
          start,
          start + repeatExplicitTargetCount
        );
        if (explicitRepeatTargetIds.length === 0) continue;
        const repeatTargetIds = resolveTargets(
          activeAction,
          currentState,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepCtx,
          explicitRepeatTargetIds,
          sourceDef,
          effectSourcePreventionLevel,
          effectSourceTargetLockBypass,
          effectSourcePreventionBypass,
          undefined,
          effectIndex,
          currentStepId,
          undefined,
          effectSourceInstanceId,
          effectSourceDefinition,
          undefined,
          step.repeat?.allowDuplicateTargets === false
            ? repeatRedirectSeenTargetIds
            : undefined,
          undefined,
          sourceCardReferenceInstanceId
        );
        if (repeatTargetIds && repeatTargetIds.length > 0) {
          redirectTargetSlices.push({
            start,
            ids: repeatTargetIds,
            indexes: Array.from(
              { length: repeatTargetIds.length },
              (_, index) => start + index
            ),
          });
          repeatRedirectSeenTargetIds.push(...repeatTargetIds);
        }
      }
    }
    const skipSet =
      i === startIndex &&
      options.skipRedirectEffectIdsAtStartStep &&
      options.skipRedirectEffectIdsAtStartStep.length > 0
        ? new Set(options.skipRedirectEffectIdsAtStartStep)
        : null;
    const originalTargetSpec = getActionTargetSpec(activeAction);
    let redirectMatch:
      | ReturnType<typeof findApplicableTargetRedirects>[number]
      | undefined;
    let redirectTargetStart = 0;
    let redirectTargetIds = resolvedTargetIds;
    let redirectTargetIndexes: number[] | undefined;
    for (const slice of redirectTargetSlices) {
      let redirectMatches = findApplicableTargetRedirects(
        currentState,
        slice.ids,
        actingPlayerId,
        effectSourcePreventionLevel,
        {
          instance: redirectEffectSourceIdentity.instance,
          definition: redirectEffectSourceIdentity.definition,
        },
        getCardDefinitionById,
        effectSourcePreventionBypass,
        originalTargetSpec
          ? {
              targetSpec: originalTargetSpec,
              sourceInstanceId: redirectEffectSourceIdentity.instanceId,
              stepContext: stepCtx,
            }
          : undefined
      );
      // 再起動時の resume ステップでは、直前 confirm/decline で消費した CE を
      // その target slice だけ除外する。optional repeat の後続 slice に同じ対象が
      // 残る場合は別発揮なので再度 redirect 確認を出す。
      const skipAppliesToSlice =
        skipSet &&
        (options.skipRedirectTargetStartAtStartStep === undefined ||
          options.skipRedirectTargetStartAtStartStep === slice.start) &&
        (options.skipRedirectTargetCountAtStartStep === undefined ||
          options.skipRedirectTargetCountAtStartStep === slice.ids.length);
      if (skipAppliesToSlice) {
        redirectMatches = redirectMatches.filter(
          (m) => !skipSet.has(m.redirectEffectId)
        );
      }
      if (redirectMatches.length > 0) {
        redirectMatch = redirectMatches[0]!;
        redirectTargetStart = slice.start;
        redirectTargetIds = slice.ids;
        redirectTargetIndexes = slice.indexes;
        break;
      }
    }
    if (redirectMatch) {
      const match = redirectMatch;
      const resumeSourceDefinitionId =
        options.targetedDisclosureSourceDefinitionId ??
        effectSourceDefinitionId;
      const redirectContinuationTargets =
        ((options.targetGroups !== undefined &&
          options.targetInstanceIds !== undefined) ||
          repeatExplicitTargetCount !== null) &&
        options.targetInstanceIds
          ? [...options.targetInstanceIds]
          : [...redirectTargetIds];
      const continuation: RedirectActionContinuation = {
        chainId: options.chainId,
        sourceDefinitionId: resumeSourceDefinitionId,
        effectIndex,
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
        sourceInstanceId,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        ...(sourceCardReferenceInstanceId !== undefined
          ? { sourceCardReferenceInstanceId }
          : {}),
        actingPlayerId,
        resumeStepIndex: i,
        stepContext: serializeStepContext(stepCtx),
        targetInstanceIds: redirectContinuationTargets,
        redirectTargetStart,
        redirectTargetCount: redirectTargetIds.length,
        ...(redirectTargetIndexes !== undefined
          ? { redirectTargetIndexes: [...redirectTargetIndexes] }
          : {}),
        ...(options.targetStepId !== undefined
          ? { targetStepId: options.targetStepId }
          : {}),
        ...(options.targetGroups !== undefined
          ? { targetGroups: options.targetGroups }
          : {}),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
      };
      const pending: PendingTargetRedirect = {
        pendingId: `redirect:${match.redirectEffectId}:${currentState.turnNumber}:${i}:${currentState.pendingTargetRedirects.length}`,
        redirectEffectId: match.redirectEffectId,
        promptedPlayerId: match.promptedPlayerId,
        candidateChooserPlayerId: match.candidateChooserPlayerId,
        sourceEffectInstanceId: effectSourceInstanceId,
        sourceEffectDefinitionId: effectSourceDefinitionId,
        originalResolvedInstanceIds: [...redirectTargetIds],
        redirectableInstanceId: match.protectedInstanceId,
        redirectableInstanceIds: [...match.redirectableInstanceIds],
        replacementMode: match.replacementMode,
        candidateTokenInstanceIds: [...match.candidateTokenInstanceIds],
        continuation,
      };
      currentState = {
        ...currentState,
        pendingTargetRedirects: [
          ...currentState.pendingTargetRedirects,
          pending,
        ],
        log: [
          ...currentState.log,
          `effect:redirect-pending:${pending.pendingId}:protected=${match.protectedInstanceIds.join(",")}:redirectable=${match.redirectableInstanceIds.join(",")}:candidates=${match.candidateTokenInstanceIds.join(",")}`,
        ],
      };
      return { kind: "return", state: currentState };
    }
  }

  const distinctRepeatCoreMoveBonusPending =
    maybeBuildDistinctRepeatCoreMoveBonusPending({
      state: currentState,
      action: activeAction,
      step,
      stepIndex: i,
      effect,
      effectIndex,
      resolvedTargetIds,
      repeatExplicitTargetCount,
      options,
      stepCtx,
      sourceDefinition: sourceDef,
      effectSourceInstanceId,
      effectSourceDefinition,
      effectSourcePreventionLevel,
      effectSourceTargetLockBypass,
      effectSourcePreventionBypass,
      sourceCardReferenceInstanceId,
      currentStepId,
      forceSnapshotContinuousTargets,
    });
  if (distinctRepeatCoreMoveBonusPending !== null) {
    return {
      kind: "return",
      state: {
        ...distinctRepeatCoreMoveBonusPending,
        pendingCoreShootSelection: {
          ...distinctRepeatCoreMoveBonusPending.pendingCoreShootSelection!,
          continuation: buildEffectBodyContinuation({
            state: distinctRepeatCoreMoveBonusPending,
            effect,
            effectIndex,
            stepIndex: i + 1,
            options,
            stepCtx,
            targetIdsConsumed: cursors.targetIdsConsumed,
            effectSourceDefinitionId,
            resumePreviousStepPreState: currentState,
          }),
          stepResultId: currentStepId,
        },
      },
    };
  }

  // --- native 実行パス ---
  const preSet = new Set(
    currentState.cardInstances.map((c) => `${c.instanceId}:${c.zone}`)
  );
  const preStateRef = currentState;
  // ref_executed 判定用: action body 内で log 配列を直接 mutate する経路 (耐性 immunity log 等)
  // があるため、native 実行直前の log 長を数値で snapshot しておく。
  const preLogLength = currentState.log.length;
  const nextStep = steps[i + 1];
  const nextStepCondition = nextStep?.stepCondition;
  let endAttackStepBlockedRetry: PendingAttackStepEndBlockedRetry | undefined;
  if (
    activeAction.kind === "end_attack_step" &&
    nextStep?.executionMode === "optional" &&
    nextStepCondition !== undefined &&
    hasPositiveRefBlockedByOpponentEffectCondition(
      nextStepCondition,
      currentStepId
    )
  ) {
    let choosingPlayerId = actingPlayerId;
    if (nextStep.chooser === "opponent") {
      const opponentId = currentState.playerOrder.find(
        (id) => id !== actingPlayerId
      );
      if (opponentId) choosingPlayerId = opponentId;
    }
    const definitionEffect = sourceDef?.effects?.[effectIndex];
    const retrySourceCardReferenceInstanceId =
      sourceCardReferenceInstanceId ??
      (options.effectSourceInstanceId !== undefined &&
      options.effectSourceInstanceId !== sourceInstanceId &&
      isCombinedBraveEffectSource({
        state: currentState,
        sourceInstanceId,
        effectSourceInstanceId: options.effectSourceInstanceId,
        ...(options.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
          : {}),
        getCardDefinitionById,
      })
        ? options.effectSourceInstanceId
        : undefined);
    endAttackStepBlockedRetry = {
      blockedStepId: currentStepId,
      stepCondition: nextStepCondition,
      choosingPlayerId,
      ...(nextStep.id !== undefined ? { stepLabel: nextStep.id } : {}),
      continuation: {
        sourceDefinitionId: effectSourceDefinitionId,
        effectIndex,
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
        sourceInstanceId,
        actingPlayerId,
        stepIndex: i + 1,
        ...(options.optionalStepResumeEffectOverride !== undefined
          ? { resumeEffectOverride: options.optionalStepResumeEffectOverride }
          : definitionEffect !== effect
            ? { resumeEffectOverride: effect }
            : {}),
        stepContext: serializeStepContext(stepCtx),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: options.effectSourceInstanceId }
          : {}),
        ...(options.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
          : {}),
        ...(retrySourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId: retrySourceCardReferenceInstanceId,
            }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        chainId: options.chainId,
        ...(!cursors.targetIdsConsumed &&
        options.targetInstanceIds !== undefined
          ? { targetInstanceIds: options.targetInstanceIds }
          : {}),
        ...(!cursors.targetIdsConsumed && options.targetStepId !== undefined
          ? { targetStepId: options.targetStepId }
          : {}),
        ...(currentState.pendingTargetedDisclosureContinuation !== null
          ? {
              targetedDisclosureContinuation:
                currentState.pendingTargetedDisclosureContinuation,
            }
          : {}),
        ...(options.recordedUsage !== undefined
          ? { recordedUsage: options.recordedUsage }
          : {}),
        ...(options.eventAmount !== undefined
          ? { eventAmount: options.eventAmount }
          : {}),
        ...(options.pendingEffectSimultaneousGroupId !== undefined
          ? {
              pendingEffectSimultaneousGroupId:
                options.pendingEffectSimultaneousGroupId,
            }
          : {}),
        ...(options.pendingEffectPendingId !== undefined
          ? { pendingEffectPendingId: options.pendingEffectPendingId }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
      },
    };
  }

  // qa-029: セットするカードの選択後、位置・交換先を共通step choiceで選ぶ。
  if (
    activeAction.kind === "quartz_set" &&
    !activeAction.placement &&
    options.promptUnresolvedChoice === true
  ) {
    const quartzId =
      activeAction.target.kind === "self" ||
      activeAction.target.kind === "source_card"
        ? sourceInstanceId
        : resolvedTargetIds?.[0];
    const quartzCard = currentState.cardInstances.find(
      (c) => c.instanceId === quartzId
    );
    const cost = quartzCard
      ? (getCardDefinitionById(quartzCard.definitionId)?.quartzData
          ?.countCost ?? 0)
      : 0;
    const placements =
      quartzId &&
      (activeAction.free ||
        canPayQuartzCountCost(currentState, actingPlayerId, cost))
        ? getQuartzPlacements(
            currentState,
            actingPlayerId,
            quartzId,
            getCardDefinitionById
          )
        : [];
    if (placements.length > 1) {
      const variants: EffectStep[] = placements.map((placement) => ({
        action: { ...activeAction, placement },
        prompt: {
          label:
            placement.replacedQuartzInstanceId === undefined
              ? `クォーツセット(${{ left: "左", center: "中央", right: "右" }[placement.slot]})`
              : `クォーツ入れ替え(${getQuartzName(currentState, placement.replacedQuartzInstanceId, getCardDefinitionById)})`,
        },
      }));
      const expandedEffect: Effect = {
        ...effect,
        steps: effect.steps.map((s, index) =>
          index === i
            ? {
                ...s,
                ...variants[0]!,
                choice: variants.slice(1),
                executionMode: "mandatory",
              }
            : s
        ),
      };
      const resumed = {
        ...options,
        state: currentState,
        effect: expandedEffect,
        optionalStepResumeEffectOverride: expandedEffect,
        startFromStepIndex: i,
        restoredStepContext: serializeStepContext(stepCtx),
        promptUnresolvedChoice: true,
        targetInstanceIds: quartzId ? [quartzId] : [],
        targetStepId: currentStepId,
      };
      delete resumed.choiceIndex;
      delete resumed.targetGroups;
      return {
        kind: "return",
        state: executeEffect({
          ...resumed,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          ...(options.getRegisteredBurstActions
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
        }),
      };
    }
  }

  // 効果セットも通常セットと同じ追加/個別交換を選ぶ。現在stepだけを既存choiceへ展開し、
  // 支払い/先行step/対象決定を繰り返さず、同じ継続とconditional_cost結果へ戻す。
  if (
    activeAction.kind === "set_self_as_mirage" ||
    (activeAction.kind === "move_card" && activeAction.to.zone === "mirage")
  ) {
    let miragePlayerId = actingPlayerId;
    let mirageSourceIds: string[] = [];
    let selectedMirages:
      | Readonly<Record<string, readonly string[]>>
      | undefined;
    if (activeAction.kind === "set_self_as_mirage") {
      const id =
        activeAction.target !== undefined
          ? resolvedTargetIds?.[0]
          : sourceInstanceId;
      const source = id ? getCardById(currentState, id) : undefined;
      if (
        source?.controllerPlayerId === actingPlayerId &&
        getCardDefinitionById(source.definitionId)?.mirageData &&
        !(
          activeAction.onlyIfNoMirage &&
          getPlayerMirageSetStates(currentState, actingPlayerId).length > 0
        )
      ) {
        mirageSourceIds = [source.instanceId];
        selectedMirages =
          activeAction.replacedMirageInstanceIds !== undefined
            ? { [source.instanceId]: activeAction.replacedMirageInstanceIds }
            : undefined;
      }
    } else {
      const planned = getMoveCardMirageSetSources({
        action: activeAction,
        state: currentState,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx,
        ...(resolvedTargetIds !== undefined ? { resolvedTargetIds } : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
      });
      miragePlayerId = planned.playerId;
      mirageSourceIds = planned.sourceInstanceIds;
      selectedMirages = activeAction.mirageReplacementsByInstanceId;
    }
    const plan = planMirageSetReplacements({
      state: currentState,
      actingPlayerId: miragePlayerId,
      sourceInstanceIds: mirageSourceIds,
      getCardDefinitionById,
      ...(selectedMirages !== undefined
        ? { replacementsByInstanceId: selectedMirages }
        : {}),
    });
    if (plan.unresolved) {
      const {
        sourceInstanceId: mirageId,
        choices,
        state: preview,
      } = plan.unresolved;
      const variants: EffectStep[] = choices.map((choice) => ({
        action:
          activeAction.kind === "set_self_as_mirage"
            ? { ...activeAction, replacedMirageInstanceIds: choice }
            : {
                ...activeAction,
                mirageSourceInstanceIds: mirageSourceIds,
                mirageReplacementsByInstanceId: {
                  ...plan.replacementsByInstanceId,
                  [mirageId]: choice,
                },
              },
        prompt: {
          label: getMirageReplacementChoiceLabel(
            preview,
            miragePlayerId,
            choice,
            getCardDefinitionById
          ),
        },
      }));
      const expandedEffect: Effect = {
        ...effect,
        steps: effect.steps.map((s, index) =>
          index === i
            ? {
                ...s,
                ...variants[0]!,
                choice: variants.slice(1),
                executionMode: "mandatory",
                prompt: {
                  ...variants[0]!.prompt,
                  question:
                    "ミラージュの追加、または入れ替えるカードを選んでください",
                },
              }
            : s
        ),
      };
      const resumed = {
        ...options,
        state: currentState,
        effect: expandedEffect,
        optionalStepResumeEffectOverride: expandedEffect,
        startFromStepIndex: i,
        restoredStepContext: serializeStepContext(stepCtx),
        promptUnresolvedChoice: true,
      };
      delete resumed.choiceIndex;
      return {
        kind: "return",
        state: executeEffect({
          ...resumed,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          ...(options.getRegisteredBurstActions !== undefined
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
        }),
      };
    }
    // 一意の選択と、unseenを含む決定済み移動元もnativeへ同じ値を渡す。
    if (activeAction.kind === "move_card")
      nativeAction = {
        ...activeAction,
        mirageSourceInstanceIds: mirageSourceIds,
        mirageReplacementsByInstanceId: plan.replacementsByInstanceId,
      };
  }

  if (activeAction.kind === "turn_face_down" && !activeAction.resolution) {
    const expanded = expandTurnFaceDown(
      currentState,
      resolvedTargetIds ?? [],
      actingPlayerId,
      effectSourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effectSourcePreventionLevel,
      effectSourcePreventionBypass
    );
    const expandedEffect: Effect = {
      ...effect,
      steps: [
        ...effect.steps.slice(0, i),
        ...expanded,
        ...effect.steps.slice(i + 1),
      ],
    };
    const resumed = {
      ...options,
      state: currentState,
      effect: expandedEffect,
      optionalStepResumeEffectOverride: expandedEffect,
      startFromStepIndex: i,
      restoredStepContext: serializeStepContext(stepCtx),
      promptUnresolvedChoice: true,
    };
    delete resumed.targetInstanceIds;
    delete resumed.targetStepId;
    delete resumed.targetGroups;
    delete resumed.choiceIndex;
    delete resumed.optionalExecuteResumeStepIndex;
    delete resumed.declinedOptionalStepIndex;
    return {
      kind: "return",
      state: executeEffect({
        ...resumed,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
      }),
    };
  }
  // 同型の公式Q&Aでは「この効果を追加で発揮」する BP- は、各発揮で対象を
  // 独立に選ぶ一方、全対象が確定してから同時に BP- し、BP0 も同時に処理する。
  // on_step の mandatory repeat は pending をまたいで各対象を受け取るため、基礎
  // 発揮を含む対象群を continuation に保持し、最終巡でまとめて native action を実行する。
  const stageBpModifiersAcrossOnStepRepeats =
    activeAction.kind === "bp_modify" &&
    step.targetSelectionTiming === "on_step" &&
    step.repeat !== undefined &&
    step.repeat.optional !== true &&
    (repeatResume?.additionalCount ??
      resolveRepeatAdditionalCount({
        repeat: step.repeat,
        state: currentState,
        conditionSourceInstanceId,
        conditionSourceContext,
        actingPlayerId,
        getCardDefinitionById,
        stepCtx,
        choiceIndex: options.choiceIndex,
      })) > 0;
  const nativeResult =
    skipInitialActionForRepeatResume || stageBpModifiersAcrossOnStepRepeats
      ? currentState
      : executeNativeAction(
          nativeAction,
          currentState,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepCtx,
          effect,
          options.chainId,
          resolvedTargetIds,
          options.pendingEffectSimultaneousGroupId,
          options.coreShootDistribution,
          options.coreShootSoulCoreInstanceId,
          provenance,
          options.payCostPaymentSources,
          options.coreDistributionAllocations,
          options.coreDistributionSoulCoreInstanceId,
          options.coreDistributionSoulCoreAllocations,
          options.summonPaymentSources,
          options.summonEnterFieldCorePlacements,
          step,
          options.choiceIndex,
          effectSourcePreventionLevel,
          effectSourceNegatePreventionLevel,
          effectSourceTargetLockBypass,
          i === (options.startFromStepIndex ?? 0)
            ? options.coreSourceAllocations
            : undefined,
          i === (options.startFromStepIndex ?? 0)
            ? options.coreSourceSoulCoreInstanceId
            : undefined,
          options.getRegisteredTriggeredEffectActions,
          options.getRegisteredBurstActions,
          forceSnapshotContinuousTargets,
          options.battleEndDeferralAttackId,
          options.resolveDeferredStackForFreeMagicUse,
          options.getRegisteredMagicActions,
          effectSourcePreventionBypass,
          options.pendingStackNegateCandidate,
          options.effectActionKind,
          undefined,
          options.recordedUsage,
          endAttackStepBlockedRetry,
          options.pendingEffectPendingId,
          sourceCardReferenceInstanceId,
          options.preservePreSelectedTargetRefs === true,
          {
            resolvedCoreMoveAmounts: options.resolvedCoreMoveAmounts,
            summonPreCostCombineHostInstanceId:
              i === (options.startFromStepIndex ?? 0)
                ? options.summonPreCostCombineHostInstanceId
                : undefined,
            divineSkillIndex: options.divineSkillIndex,
            isAccelData: options.isAccelData,
            isChangeData: options.isChangeData,
            triggerFromZone: options.triggerFromZone,
            triggerCause: options.triggerCause,
            triggerRelatedInstanceZone: options.triggerRelatedInstanceZone,
            activationZone: options.activationZone,
            costPaidThisEffect: options.costPaidThisEffect,
            postResolutionOracle: options.postResolutionOracle,
            // `targetInstanceIds` is scoped to `targetStepId`.  Native actions
            // also receive this continuation metadata for targeted-disclosure
            // bookkeeping, so forwarding it to a later step would turn an
            // on_step selection into an accidental preselection for a
            // `target.kind:"ref"` action (C08's final destroy step).
            targetInstanceIds:
              canConsumePassedTargets && !cursors.targetIdsConsumed
                ? options.targetInstanceIds
                : undefined,
            targetStepId:
              canConsumePassedTargets && !cursors.targetIdsConsumed
                ? options.targetStepId
                : undefined,
            targetSelectionResolved: options.targetSelectionResolved,
            targetGroups: options.targetGroups,
            sequentialTargetConsumption: options.sequentialTargetConsumption,
            eventAmount: options.eventAmount,
            rangeAutoResolveStrategy: options.rangeAutoResolveStrategy,
          }
        );
  if (nativeResult !== null) {
    currentState = nativeResult;
    if (options.postResolutionOracle !== undefined) {
      currentState = attachPostResolutionOracleToNewPending(
        currentState,
        preStateRef,
        options.postResolutionOracle
      );
    }
    if (
      currentState.pendingCoreShootSelection !== null &&
      preStateRef.pendingCoreShootSelection === null
    ) {
      const hasRepeatWork = step.repeat !== undefined;
      return {
        kind: "return",
        state: {
          ...currentState,
          pendingCoreShootSelection: {
            ...currentState.pendingCoreShootSelection,
            continuation: buildEffectBodyContinuation({
              state: currentState,
              effect,
              effectIndex,
              stepIndex: hasRepeatWork ? i : i + 1,
              options,
              stepCtx,
              targetIdsConsumed: cursors.targetIdsConsumed,
              effectSourceDefinitionId,
              resumePreviousStepPreState: preStateRef,
              ...(hasRepeatWork
                ? {
                    repeatResume: {
                      stepIndex: i,
                      nextAdditionalIndex: 0,
                      skipBaseAction: true,
                      excludedTargetInstanceIds: resolvedTargetIds ?? [],
                    },
                  }
                : {}),
            }),
            stepResultId: currentStepId,
          },
        },
      };
    }
    const postSet = new Set(
      currentState.cardInstances.map((c) => `${c.instanceId}:${c.zone}`)
    );
    let affected = detectAffectedCards(
      preSet,
      postSet,
      currentState,
      resolvedTargetIds
    );
    if (activeAction.kind === "quartz_set") {
      // 後続の「セットしたカード」は、交換で手札へ戻ったカードを含まない。
      affected = currentState.quartzSetStates
        .filter(
          (q) =>
            !preStateRef.quartzSetStates.some(
              (old) => old.quartzInstanceId === q.quartzInstanceId
            )
        )
        .map((q) => q.quartzInstanceId);
    }
    if (activeAction.kind === "destroy") {
      affected =
        detectActuallyDestroyedTargetIds(
          preStateRef,
          currentState,
          resolvedTargetIds
        ) ?? affected;
    }
    if (
      activeAction.kind === "vanish" ||
      activeAction.kind === "bounce" ||
      activeAction.kind === "send_to_deck"
    ) {
      const outcomes = collectEstablishedLeaveOutcomes(
        preStateRef,
        currentState
      );
      const expectedKind = activeAction.kind === "vanish" ? "vanish" : "bounce";
      affected = [...new Set([...affected, ...Object.keys(outcomes)])].filter(
        (id) => {
          if (outcomes[id] === expectedKind) return true;
          const before = preStateRef.cardInstances.find(
            (card) => card.instanceId === id
          );
          const after = currentState.cardInstances.find(
            (card) => card.instanceId === id
          );
          return before !== undefined && before.zone !== after?.zone;
        }
      );
    }
    if (activeAction.kind === "negate") {
      const negateAffected = resolveNegateStepAffectedCardIds({
        action: activeAction,
        state: currentState,
        candidate: options.pendingStackNegateCandidate,
        actingPlayerId,
        getCardDefinitionById,
        sourceCard,
        sourceDefinition: sourceDef,
      });
      if (negateAffected.length > 0) {
        affected = negateAffected;
      }
    }
    const rebirthAffected = detectRebirthAffectedCardIds(
      activeAction,
      preStateRef,
      currentState,
      sourceInstanceId,
      resolvedTargetIds
    );
    if (rebirthAffected !== null) {
      affected = rebirthAffected;
    }
    let bpBecameZeroIds =
      activeAction.kind === "bp_modify"
        ? detectBpBecameZeroTransitions(
            preStateRef,
            currentState,
            resolvedTargetIds,
            getCardDefinitionById
          )
        : [];
    // For non-card-moving actions (count/life), detect success from actual state change.
    // Zone-changing actions (draw, move_card, etc.) fall back to "always succeeded".
    let nonCardResult = didNonCardActionChangeState(
      activeAction.kind,
      preStateRef,
      currentState,
      activeAction.kind === "noop" && activeAction.target !== undefined
    );
    if (activeAction.kind === "count_decrease") {
      nonCardResult = didCountDecreasePayFullAmount(
        activeAction,
        preStateRef,
        currentState,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
    }
    const selfSummonResult = didSelfSummonActionSucceed(
      activeAction,
      preStateRef,
      currentState,
      sourceInstanceId
    );
    if (selfSummonResult !== null) {
      nonCardResult = selfSummonResult;
    }
    if (skipInitialActionForRepeatResume && nonCardResult === false) {
      nonCardResult = null;
    }
    const recordedChoiceIndex =
      step.choice && step.choice.length > 0 && options.choiceIndex !== undefined
        ? options.choiceIndex
        : undefined;
    // field_card コスト支払い配分 (core_move) が pendingCoreSourceAllocation を
    // 生成した場合: コストは未払い (state 不変) のまま中断されたため、step result を
    // 記録せず「同ステップ再実行」用の continuation を注入して即 return する
    // (redirect の resumeStepIndex=i と同型)。解決時は coreSourceAllocations 供給で
    // 当該コストステップから executeEffect が再実行され、conditional_cost の
    // スナップショット (stepCtx.originalState) も再実行イテレーションで取り直される
    // (= コスト支払い前 state) ため「ことで」双方向ロールバックが機能する。
    const newCoreSourceAllocationPending =
      currentState.pendingCoreSourceAllocation !== null &&
      preStateRef.pendingCoreSourceAllocation === null &&
      currentState.pendingCoreSourceAllocation.continuation === undefined;
    if (newCoreSourceAllocationPending) {
      const sourceCard = currentState.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      const continuation: import("../model").CoreSourceAllocationContinuation =
        {
          chainId: options.chainId,
          sourceDefinitionId: sourceCard?.definitionId ?? "",
          resumeEffectOverride: effect,
          effectIndex,
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
          sourceInstanceId,
          ...(options.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: options.effectSourceInstanceId }
            : {}),
          ...(options.effectSourceDefinitionId !== undefined
            ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
            : {}),
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          actingPlayerId,
          resumeStepIndex: i,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(options.activationZone !== undefined
            ? { activationZone: options.activationZone }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(actionTargetIds !== undefined && resolvedTargetIds !== undefined
            ? {
                targetInstanceIds: [...resolvedTargetIds],
                targetStepId: currentStepId,
              }
            : options.targetInstanceIds && !cursors.targetIdsConsumed
              ? {
                  targetInstanceIds: [...options.targetInstanceIds],
                  ...(options.targetStepId
                    ? { targetStepId: options.targetStepId }
                    : {}),
                }
              : {}),
          ...(options.recordedUsage !== undefined
            ? { recordedUsage: options.recordedUsage }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
        };
      currentState = {
        ...currentState,
        pendingCoreSourceAllocation: {
          ...currentState.pendingCoreSourceAllocation!,
          continuation,
        },
        log: [
          ...currentState.log,
          `effect:core-source-allocation-pending:${currentState.pendingCoreSourceAllocation!.pendingId}:resume-at=${i}`,
        ],
      };
      return { kind: "return", state: currentState };
    }
    // 効果文内 summon がコスト支払い元選択を要求した場合: summon 自体はまだ
    // 未実行なので step result を記録せず、同じ summon step から再実行する。
    const saveNewSummonCostPayment = (
      beforeState: GameState,
      targetIds: readonly string[] | undefined,
      paymentRepeatResume?: EffectStepRepeatResume
    ): GameState | null => {
      const newEffectSummonCostPaymentPending =
        (activeAction.kind === "summon" ||
          activeAction.kind === "put" ||
          activeAction.kind === "place") &&
        currentState.pendingEffectSummonCostPayment !== null &&
        beforeState.pendingEffectSummonCostPayment === null &&
        currentState.pendingEffectSummonCostPayment.continuation === undefined;
      if (!newEffectSummonCostPaymentPending) return null;
      {
        const sourceCard = currentState.cardInstances.find(
          (c) => c.instanceId === sourceInstanceId
        );
        const continuation: import("../model").EffectSummonCostPaymentContinuation =
          {
            chainId: options.chainId,
            sourceDefinitionId: sourceCard?.definitionId ?? "",
            resumeEffectOverride: effect,
            effectIndex,
            ...(options.divineSkillIndex !== undefined
              ? { divineSkillIndex: options.divineSkillIndex }
              : {}),
            ...(options.isAccelData !== undefined
              ? { isAccelData: options.isAccelData }
              : {}),
            ...(options.isChangeData !== undefined
              ? { isChangeData: options.isChangeData }
              : {}),
            sourceInstanceId,
            ...(options.effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId: options.effectSourceInstanceId }
              : {}),
            ...(options.effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
              : {}),
            ...(sourceCardReferenceInstanceId !== undefined
              ? { sourceCardReferenceInstanceId }
              : {}),
            actingPlayerId,
            resumeStepIndex: i,
            ...(paymentRepeatResume
              ? {
                  repeatResume: paymentRepeatResume,
                  optionalExecuteResumeStepIndex: i,
                }
              : {}),
            ...(options.optionalExecuteResumeStepIndex !== undefined
              ? {
                  optionalExecuteResumeStepIndex:
                    options.optionalExecuteResumeStepIndex,
                }
              : {}),
            stepContext: serializeStepContext(stepCtx),
            ...(options.choiceIndex !== undefined
              ? { choiceIndex: options.choiceIndex }
              : {}),
            ...(options.activationZone !== undefined
              ? { activationZone: options.activationZone }
              : {}),
            ...(effectSourcePreventionLevel !== undefined
              ? { sourcePreventionLevel: effectSourcePreventionLevel }
              : {}),
            ...(effectSourcePreventionBypass !== undefined
              ? { sourcePreventionBypass: effectSourcePreventionBypass }
              : {}),
            ...(options.costPaidThisEffect !== undefined
              ? { costPaidThisEffect: options.costPaidThisEffect }
              : {}),
            ...(targetIds !== undefined
              ? {
                  targetInstanceIds: [...targetIds],
                  targetStepId: step.id ?? `__step_${i}`,
                  targetSelectionResolved: true,
                }
              : options.targetInstanceIds && !cursors.targetIdsConsumed
                ? { targetInstanceIds: [...options.targetInstanceIds] }
                : {}),
            ...(options.effectActionKind !== undefined
              ? { effectActionKind: options.effectActionKind }
              : {}),
            ...(options.recordedUsage !== undefined
              ? { recordedUsage: options.recordedUsage }
              : {}),
            ...(options.postResolutionOracle !== undefined
              ? { postResolutionOracle: options.postResolutionOracle }
              : {}),
            ...(options.battleEndDeferralAttackId !== undefined
              ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
              : {}),
          };
        currentState = {
          ...currentState,
          pendingEffectSummonCostPayment: {
            ...currentState.pendingEffectSummonCostPayment!,
            continuation,
          },
          log: [
            ...currentState.log,
            `effect:summon-cost-payment-pending:${currentState.pendingEffectSummonCostPayment!.pendingId}:resume-at=${i}`,
          ],
        };
        return currentState;
      }
    };
    const summonCostState = saveNewSummonCostPayment(
      preStateRef,
      resolvedTargetIds
    );
    if (summonCostState) return { kind: "return", state: summonCostState };
    // P3-47 Phase 2-2: core_distribute が mode="player_choice" で
    // pendingCoreDistribution を生成した場合、配分対象 (= resolvedTargetIds) を
    // step result に記録した上で、後続ステップ再実行用の continuation を
    // pending に注入して即 return する。次の executeEffect 呼び出し時 (resume)
    // は continuation.resumeStepIndex (= i + 1) から再開される。
    // 後続ステップが無い場合 (= 単一 core_distribute step の effect) は
    // continuation 不要のため即 return のみ (apply 後は何もしない)。
    // core_move (trash/void → field/field_card で配分対象が複数) も
    // pendingCoreDistribution を生成し得る。core_distribute と同様に「配分待ちは
    // 遅延成功」として扱い、conditional_cost ロールバックの誤発動を防ぐ。
    const newCoreDistributionPending =
      (activeAction.kind === "core_distribute" ||
        activeAction.kind === "core_move" ||
        activeAction.kind === "advent" ||
        (activeAction.kind === "rebirth" &&
          currentState.pendingCoreDistribution?.rebirthCompletion
            ?.deferredAction !== undefined)) &&
      currentState.pendingCoreDistribution !== null &&
      currentState.pendingCoreDistribution.stateBasedBraveSeparation ===
        undefined &&
      preStateRef.pendingCoreDistribution === null &&
      currentState.pendingCoreDistribution.continuation === undefined;
    if (newCoreDistributionPending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      const distributionTargets =
        resolvedTargetIds && resolvedTargetIds.length > 0
          ? resolvedTargetIds
          : currentState.pendingCoreDistribution!.candidates.map(
              (c) => c.instanceId
            );
      const rebirthRollbackPatch =
        activeAction.kind === "rebirth"
          ? null
          : buildRebirthMinimumCoreRollbackPatch({
              chainId: options.chainId,
              action: activeAction,
              step,
              stepCtx,
              currentState,
              distributionTargets,
              actingPlayerId,
              getCardDefinitionById,
            });
      recordStepResult(stepCtx, {
        stepId: step.id ?? `__step_${i}`,
        affectedCardInstanceIds: distributionTargets,
        succeeded: true,
        executed: true,
        ...(recordedChoiceIndex !== undefined
          ? { chosenChoiceIndex: recordedChoiceIndex }
          : {}),
      });
      let pendingCoreDistribution = currentState.pendingCoreDistribution!;
      const resumeStepIndex =
        activeAction.kind === "rebirth"
          ? findPostRebirthCoreCompanionResumeIndex(
              steps,
              i,
              step.id ?? `__step_${i}`
            )
          : i + 1;
      const battleEndDeferralAttackId =
        hasRemainingSteps || options.battleEndDeferralAttackId !== undefined
          ? getBattleEndDeferralAttackIdForContinuation({
              options,
              currentState,
              stepCtx,
              steps,
              startIndex: resumeStepIndex,
            })
          : undefined;
      if (battleEndDeferralAttackId !== undefined) {
        pendingCoreDistribution = {
          ...pendingCoreDistribution,
          battleEndDeferralAttackId,
        };
      }
      if (
        (activeAction.kind === "core_distribute" &&
          activeAction.mode === "player_choice") ||
        activeAction.kind === "core_move"
      ) {
        const targetInterruptionSourceDefinitionId =
          options.targetedDisclosureSourceDefinitionId ??
          effectSourceDefinitionId;
        const coreDistributionOriginalTargetSpec =
          getCoreDistributionTargetSpec(activeAction);
        pendingCoreDistribution = {
          ...pendingCoreDistribution,
          targetInterruption: {
            sourceDefinitionId: targetInterruptionSourceDefinitionId,
            effectIndex,
            ...(options.divineSkillIndex !== undefined
              ? { divineSkillIndex: options.divineSkillIndex }
              : {}),
            ...(options.isAccelData !== undefined
              ? { isAccelData: options.isAccelData }
              : {}),
            ...(options.isChangeData !== undefined
              ? { isChangeData: options.isChangeData }
              : {}),
            sourceInstanceId,
            effectSourceInstanceId,
            effectSourceDefinitionId,
            ...(sourceCardReferenceInstanceId !== undefined
              ? { sourceCardReferenceInstanceId }
              : {}),
            ...(options.effectActionKind !== undefined
              ? { effectActionKind: options.effectActionKind }
              : {}),
            ...(options.effectActivationTiming !== undefined
              ? { effectActivationTiming: options.effectActivationTiming }
              : {}),
            actingPlayerId,
            stepIndex: i,
            stepContext: serializeStepContext(stepCtx),
            ...(coreDistributionOriginalTargetSpec !== undefined
              ? { targetSpec: coreDistributionOriginalTargetSpec }
              : {}),
            targetStepId: currentStepId,
            ...(options.choiceIndex !== undefined
              ? { choiceIndex: options.choiceIndex }
              : {}),
            ...(effectSourcePreventionLevel !== undefined
              ? { sourcePreventionLevel: effectSourcePreventionLevel }
              : {}),
            ...(effectSourcePreventionBypass !== undefined
              ? { sourcePreventionBypass: effectSourcePreventionBypass }
              : {}),
            ...(options.costPaidThisEffect !== undefined
              ? { costPaidThisEffect: options.costPaidThisEffect }
              : {}),
            ...(options.postResolutionOracle !== undefined
              ? { postResolutionOracle: options.postResolutionOracle }
              : {}),
            chainId: options.chainId,
            effectResolutionBeforeState,
            targetedDisclosureResolved: shouldSkipTargetedDisclosureSlice({
              start: 0,
              ids: distributionTargets,
            }),
          },
        };
      }
      if (rebirthRollbackPatch) {
        pendingCoreDistribution = {
          ...pendingCoreDistribution,
          ...rebirthRollbackPatch,
        };
      }
      const pendingCoreDistributionChanged =
        pendingCoreDistribution !== currentState.pendingCoreDistribution;
      if (hasRemainingSteps) {
        const continuation: import("../model").CoreDistributionContinuation = {
          chainId: requireTriggerChainId(options.chainId),
          sourceDefinitionId: effectSourceDefinitionId,
          resumeEffectOverride: effect,
          effectIndex,
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
          sourceInstanceId,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          ...(options.effectActionKind !== undefined
            ? { effectActionKind: options.effectActionKind }
            : {}),
          actingPlayerId,
          resumeStepIndex,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        };
        pendingCoreDistribution = {
          ...pendingCoreDistribution,
          continuation,
        };
        currentState = {
          ...currentState,
          pendingCoreDistribution,
          log: [
            ...currentState.log,
            `effect:core-distribute-pending:${currentState.pendingCoreDistribution!.pendingId}:resume-at=${resumeStepIndex}`,
          ],
        };
      } else if (pendingCoreDistributionChanged) {
        currentState = {
          ...currentState,
          pendingCoreDistribution,
        };
      }
      return { kind: "return", state: currentState };
    }
    const newCoreSplitPending =
      // core_move の splitDestinations (小悪魔アクセル型) に加え、vanish の
      // coreDestinationChoice (BSTH02-X02 界放型 「相手がリザーブ/トラッシュに置く」) も
      // 同じ pendingCoreSplitSelection を生成する。後続ステップ (「さらに」独立副節等) を
      // 選択解決後に再開できるよう、生成元の action kind を問わず continuation を付与する。
      (activeAction.kind === "core_move" || activeAction.kind === "vanish") &&
      currentState.pendingCoreSplitSelection !== null &&
      preStateRef.pendingCoreSplitSelection === null &&
      currentState.pendingCoreSplitSelection.continuation === undefined;
    if (newCoreSplitPending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      recordStepResult(stepCtx, {
        stepId: step.id ?? `__step_${i}`,
        affectedCardInstanceIds: [sourceInstanceId],
        succeeded: true,
        ...(recordedChoiceIndex !== undefined
          ? { chosenChoiceIndex: recordedChoiceIndex }
          : {}),
      });
      let pendingCoreSplitSelection = currentState.pendingCoreSplitSelection!;
      if (options.battleEndDeferralAttackId !== undefined) {
        pendingCoreSplitSelection = {
          ...pendingCoreSplitSelection,
          battleEndDeferralAttackId: options.battleEndDeferralAttackId,
        };
      }
      if (hasRemainingSteps) {
        const continuation: import("../model").CoreDistributionContinuation = {
          chainId: requireTriggerChainId(options.chainId),
          sourceDefinitionId: effectSourceDefinitionId,
          resumeEffectOverride: effect,
          effectIndex,
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
          sourceInstanceId,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          ...(options.effectActionKind !== undefined
            ? { effectActionKind: options.effectActionKind }
            : {}),
          actingPlayerId,
          resumeStepIndex: i + 1,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
        };
        pendingCoreSplitSelection = {
          ...pendingCoreSplitSelection,
          continuation,
        };
      }
      if (
        pendingCoreSplitSelection !== currentState.pendingCoreSplitSelection
      ) {
        currentState = {
          ...currentState,
          pendingCoreSplitSelection,
          log: hasRemainingSteps
            ? [
                ...currentState.log,
                `effect:core-split-pending:${currentState.pendingCoreSplitSelection!.pendingId}:resume-at=${i + 1}`,
              ]
            : currentState.log,
        };
      }
      return { kind: "return", state: currentState };
    }
    // 最終stepも、入力が終わるまで原因と発揮後処理を保持する。
    const swapState = saveNewSwapChoice(
      preStateRef,
      {
        state: currentState,
        effect,
        effectIndex,
        stepIndex: step.repeat ? i : i + 1,
        options,
        stepCtx,
        targetIdsConsumed: cursors.targetIdsConsumed,
        effectSourceDefinitionId,
        resumePreviousStepPreState: preStateRef,
        ...(step.repeat
          ? {
              repeatResume: {
                stepIndex: i,
                nextAdditionalIndex: 0,
                skipBaseAction: true,
                excludedTargetInstanceIds: resolvedTargetIds ?? [],
              },
            }
          : {}),
      },
      step.id ?? `__step_${i}`
    );
    if (swapState) return { kind: "return", state: swapState };
    // split_field_entry_choice の入力待ちにも後続本文の継続を保存する。
    const newSplitSummonChoicePending =
      activeAction.kind === "split_field_entry_choice" &&
      currentState.pendingSplitSummonChoice !== null &&
      preStateRef.pendingSplitSummonChoice === null &&
      currentState.pendingSplitSummonChoice.continuation === undefined;
    if (newSplitSummonChoicePending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      recordStepResult(stepCtx, {
        stepId: step.id ?? `__step_${i}`,
        affectedCardInstanceIds: [sourceInstanceId],
        succeeded: true,
        ...(recordedChoiceIndex !== undefined
          ? { chosenChoiceIndex: recordedChoiceIndex }
          : {}),
      });
      let pendingSplitSummonChoice = currentState.pendingSplitSummonChoice!;
      if (options.battleEndDeferralAttackId !== undefined) {
        pendingSplitSummonChoice = {
          ...pendingSplitSummonChoice,
          battleEndDeferralAttackId: options.battleEndDeferralAttackId,
        };
      }
      if (hasRemainingSteps) {
        const continuation: import("../model").CoreDistributionContinuation = {
          chainId: requireTriggerChainId(options.chainId),
          sourceDefinitionId: effectSourceDefinitionId,
          resumeEffectOverride: effect,
          effectIndex,
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
          sourceInstanceId,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          ...(options.effectActionKind !== undefined
            ? { effectActionKind: options.effectActionKind }
            : {}),
          actingPlayerId,
          resumeStepIndex: i + 1,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
        };
        pendingSplitSummonChoice = {
          ...pendingSplitSummonChoice,
          stepResultId: step.id ?? `__step_${i}`,
          continuation,
        };
      }
      if (pendingSplitSummonChoice !== currentState.pendingSplitSummonChoice) {
        currentState = {
          ...currentState,
          pendingSplitSummonChoice,
          log: hasRemainingSteps
            ? [
                ...currentState.log,
                `effect:split-summon-choice-pending:${currentState.pendingSplitSummonChoice!.pendingId}:resume-at=${i + 1}`,
              ]
            : currentState.log,
        };
      }
      return { kind: "return", state: currentState };
    }
    // 維持コア選択中は元効果・反復位置・各巡の結果を保持して中断する。
    const saveNewMultiPlacement = (
      beforeState: GameState,
      repeatOverride?: EffectStepRepeatResume
    ): GameState | null => {
      const newMultiPlacementPending =
        currentState.pendingMultiPlacement !== null &&
        beforeState.pendingMultiPlacement === null &&
        currentState.pendingMultiPlacement.continuation === undefined;
      if (!newMultiPlacementPending) return null;
      {
        const resumeSummonStep =
          currentState.pendingMultiPlacement!.resumeEffectSummon !== undefined;
        const additionalCount = step.repeat
          ? resolveRepeatAdditionalCount({
              repeat: step.repeat,
              state: beforeState,
              conditionSourceInstanceId,
              conditionSourceContext,
              actingPlayerId,
              getCardDefinitionById,
              stepCtx,
              choiceIndex: options.choiceIndex,
            })
          : 0;
        const placementRepeatResume = resumeSummonStep
          ? undefined
          : (repeatOverride ??
            (additionalCount > 0
              ? {
                  stepIndex: i,
                  nextAdditionalIndex: 0,
                  skipBaseAction: true,
                  excludedTargetInstanceIds: resolvedTargetIds ?? [],
                  additionalCount,
                }
              : undefined));
        const placementTargets = currentState.pendingMultiPlacement!
          .combineAfterPlacement
          ? [
              currentState.pendingMultiPlacement!.combineAfterPlacement!
                .braveInstanceId,
            ]
          : getMultiPlacementTargets(currentState.pendingMultiPlacement).map(
              (target) => target.instanceId
            );
        if (!resumeSummonStep)
          recordStepResult(stepCtx, {
            stepId: step.id ?? `__step_${i}`,
            affectedCardInstanceIds: placementTargets,
            succeeded: true,
            ...(recordedChoiceIndex !== undefined
              ? { chosenChoiceIndex: recordedChoiceIndex }
              : {}),
          });
        {
          const sourceCard = currentState.cardInstances.find(
            (c) => c.instanceId === sourceInstanceId
          );
          const sourceDefId = sourceCard?.definitionId ?? "";
          const continuation: import("../model").MultiPlacementContinuation = {
            chainId: options.chainId,
            ...(options.recordedUsage !== undefined
              ? { recordedUsage: options.recordedUsage }
              : {}),
            ...(resumeSummonStep && resolvedTargetIds !== undefined
              ? {
                  targetInstanceIds: [...resolvedTargetIds],
                  targetStepId: step.id ?? `__step_${i}`,
                  targetSelectionResolved: true,
                }
              : !cursors.targetIdsConsumed && options.targetInstanceIds
                ? {
                    targetInstanceIds: options.targetInstanceIds.filter(
                      (id) => !placementTargets.includes(id)
                    ),
                    ...(options.targetStepId !== undefined
                      ? { targetStepId: options.targetStepId }
                      : {}),
                    ...(options.targetSelectionResolved !== undefined
                      ? {
                          targetSelectionResolved:
                            options.targetSelectionResolved,
                        }
                      : {}),
                  }
                : {}),
            ...(options.triggerRelatedInstanceId !== undefined
              ? { triggerRelatedInstanceId: options.triggerRelatedInstanceId }
              : {}),
            ...(resumeSummonStep && options.summonPaymentSources !== undefined
              ? { summonPaymentSources: options.summonPaymentSources }
              : {}),
            ...(resumeSummonStep &&
            options.summonEnterFieldCorePlacements !== undefined
              ? {
                  summonEnterFieldCorePlacements:
                    options.summonEnterFieldCorePlacements,
                }
              : {}),
            ...(options.activationZone !== undefined
              ? { activationZone: options.activationZone }
              : {}),
            ...(resumeSummonStep || placementRepeatResume
              ? { optionalExecuteResumeStepIndex: i }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
            ...((currentState.pendingTargetedDisclosureContinuation ??
              beforeState.pendingTargetedDisclosureContinuation) !== null
              ? {
                  targetedDisclosureContinuation:
                    (currentState.pendingTargetedDisclosureContinuation ??
                      beforeState.pendingTargetedDisclosureContinuation)!,
                }
              : {}),
            sourceDefinitionId: sourceDefId,
            resumeEffectOverride: effect,
            effectIndex,
            ...(options.divineSkillIndex !== undefined
              ? { divineSkillIndex: options.divineSkillIndex }
              : {}),
            ...(options.isAccelData !== undefined
              ? { isAccelData: options.isAccelData }
              : {}),
            ...(options.isChangeData !== undefined
              ? { isChangeData: options.isChangeData }
              : {}),
            sourceInstanceId,
            ...(sourceCardReferenceInstanceId !== undefined
              ? { sourceCardReferenceInstanceId }
              : {}),
            ...(options.effectActionKind !== undefined
              ? { effectActionKind: options.effectActionKind }
              : {}),
            actingPlayerId,
            resumeStepIndex:
              resumeSummonStep || placementRepeatResume ? i : i + 1,
            ...(placementRepeatResume
              ? { repeatResume: placementRepeatResume }
              : {}),
            stepContext: serializeStepContext(stepCtx),
            ...(options.choiceIndex !== undefined
              ? { choiceIndex: options.choiceIndex }
              : {}),
            ...(effectSourcePreventionLevel !== undefined
              ? { sourcePreventionLevel: effectSourcePreventionLevel }
              : {}),
            ...(effectSourcePreventionBypass !== undefined
              ? { sourcePreventionBypass: effectSourcePreventionBypass }
              : {}),
            ...(options.costPaidThisEffect !== undefined
              ? { costPaidThisEffect: options.costPaidThisEffect }
              : {}),
            ...(options.postResolutionOracle !== undefined
              ? { postResolutionOracle: options.postResolutionOracle }
              : {}),
            ...(options.battleEndDeferralAttackId !== undefined
              ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
              : {}),
          };
          currentState = {
            ...currentState,
            pendingMultiPlacement: {
              ...currentState.pendingMultiPlacement!,
              ...(resumeSummonStep
                ? {}
                : {
                    sourceInstanceId,
                    sourceDefinitionId: sourceDefId,
                    sourceEffectIndex: effectIndex,
                  }),
              priorStateSnapshot:
                currentState.pendingMultiPlacement!.priorStateSnapshot ??
                beforeState,
              continuation,
              ...(options.battleEndDeferralAttackId !== undefined
                ? {
                    battleEndDeferralAttackId:
                      options.battleEndDeferralAttackId,
                  }
                : {}),
            },
            log: [
              ...currentState.log,
              `effect:multi-placement-pending:${currentState.pendingMultiPlacement!.pendingId}:resume-at=${i + 1}`,
            ],
          };
        }
        return currentState;
      }
    };
    const placementState = saveNewMultiPlacement(preStateRef);
    if (placementState) return { kind: "return", state: placementState };
    // 逆転醒 pattern2（裏返して配置/召喚）が支払い・維持コア配置 pending を生成した場合は、
    // 新しい A 面 instance の確定後にだけ同一 effect の後続 step を再開する。pending を
    // 成功した action として記録し、解決側で置換後 instanceId を同じ StepResult に加える。
    const reverseRebirthSummonPending =
      currentState.pendingReverseRebirthSummon;
    const newReverseRebirthSummonPending =
      activeAction.kind === "reverse_rebirth" &&
      activeAction.mode === "summon" &&
      reverseRebirthSummonPending !== null &&
      preStateRef.pendingReverseRebirthSummon === null &&
      reverseRebirthSummonPending.continuation === undefined;
    if (newReverseRebirthSummonPending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      if (hasRemainingSteps) {
        const continuation: import("../model").ReverseRebirthSummonContinuation =
          {
            chainId: options.chainId,
            // 継承/付与効果では sourceInstanceId と effectSource が別物になり得る。
            // resumeEffectOverride だけでなく effect-source metadata も保持して、解決後に
            // 裏面 B が置換された場合だけ新しい A 面 instance へ対応付ける。
            sourceDefinitionId: effectSourceDefinitionId,
            resumeEffectOverride: effect,
            effectIndex,
            ...(options.divineSkillIndex !== undefined
              ? { divineSkillIndex: options.divineSkillIndex }
              : {}),
            ...(options.isAccelData !== undefined
              ? { isAccelData: options.isAccelData }
              : {}),
            ...(options.isChangeData !== undefined
              ? { isChangeData: options.isChangeData }
              : {}),
            sourceInstanceId,
            ...(options.effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId: options.effectSourceInstanceId }
              : {}),
            ...(options.effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
              : {}),
            ...(sourceCardReferenceInstanceId !== undefined
              ? { sourceCardReferenceInstanceId }
              : {}),
            ...(options.effectActionKind !== undefined
              ? { effectActionKind: options.effectActionKind }
              : {}),
            actingPlayerId,
            resumeStepIndex: i + 1,
            stepResultId: step.id ?? `__step_${i}`,
            stepContext: serializeStepContext(stepCtx),
            ...(options.choiceIndex !== undefined
              ? { choiceIndex: options.choiceIndex }
              : {}),
            ...(effectSourcePreventionLevel !== undefined
              ? { sourcePreventionLevel: effectSourcePreventionLevel }
              : {}),
            ...(effectSourcePreventionBypass !== undefined
              ? { sourcePreventionBypass: effectSourcePreventionBypass }
              : {}),
            ...(options.costPaidThisEffect !== undefined
              ? { costPaidThisEffect: options.costPaidThisEffect }
              : {}),
            ...(options.postResolutionOracle !== undefined
              ? { postResolutionOracle: options.postResolutionOracle }
              : {}),
            ...(options.battleEndDeferralAttackId !== undefined
              ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
              : {}),
          };
        currentState = {
          ...currentState,
          pendingReverseRebirthSummon: {
            ...reverseRebirthSummonPending,
            continuation,
          },
          log: [
            ...currentState.log,
            `effect:reverse-rebirth-summon-pending:${reverseRebirthSummonPending.pendingId}:resume-at=${i + 1}`,
          ],
        };
      }
      return { kind: "return", state: currentState };
    }
    // ENGINE-brave-combine-multistep-continuation: 効果召喚したブレイヴが
    // maybeOpenEffectSummonedBraveCombineChoice で pendingBraveCombineChoice(effectSummon) を
    // 生成した場合、後続ステップ再実行用の continuation を pending に注入して即 return する
    // (pendingMultiPlacement と同型パターン)。BSTH01-X02 等、同一 effect 内で複数体を
    // 順に効果召喚するカードで、1 体目がブレイヴのとき 2 体目以降の summon step が
    // 実行されずに解決が終わってしまう欠落への対応。
    const newEffectSummonBraveCombinePending =
      activeAction.kind === "summon" &&
      currentState.pendingBraveCombineChoice !== null &&
      preStateRef.pendingBraveCombineChoice === null &&
      currentState.pendingBraveCombineChoice.effectSummon !== undefined &&
      currentState.pendingBraveCombineChoice.effectSummon.continuation ===
        undefined;
    if (newEffectSummonBraveCombinePending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      const pendingBrave = currentState.pendingBraveCombineChoice!;
      recordStepResult(stepCtx, {
        stepId: step.id ?? `__step_${i}`,
        affectedCardInstanceIds: [pendingBrave.braveInstanceId],
        succeeded: true,
        ...(recordedChoiceIndex !== undefined
          ? { chosenChoiceIndex: recordedChoiceIndex }
          : {}),
      });
      if (hasRemainingSteps) {
        const continuation: import("../model").MultiPlacementContinuation = {
          chainId: options.chainId,
          sourceDefinitionId: pendingBrave.effectSummon!.sourceDefinitionId,
          resumeEffectOverride: effect,
          effectIndex,
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
          sourceInstanceId,
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          actingPlayerId,
          resumeStepIndex: i + 1,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
        };
        currentState = {
          ...currentState,
          pendingBraveCombineChoice: {
            ...pendingBrave,
            effectSummon: {
              ...pendingBrave.effectSummon!,
              continuation,
            },
          },
          log: [
            ...currentState.log,
            `effect:brave-combine-effect-summon-pending:${pendingBrave.pendingId}:resume-at=${i + 1}`,
          ],
        };
      }
      return { kind: "return", state: currentState };
    }
    const newBraveCombineAsSummonPlacementPending =
      activeAction.kind === "brave_combine_effect" &&
      currentState.pendingEnterFieldPlacement !== null &&
      preStateRef.pendingEnterFieldPlacement === null &&
      currentState.pendingEnterFieldPlacement.effectBraveCombineAsSummon !==
        undefined &&
      currentState.pendingEnterFieldPlacement.effectBraveCombineAsSummon
        .continuation === undefined;
    if (newBraveCombineAsSummonPlacementPending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      const pendingPlacement = currentState.pendingEnterFieldPlacement!;
      const pendingCombine = pendingPlacement.effectBraveCombineAsSummon!;
      if (hasRemainingSteps) {
        const continuation: import("../model").MultiPlacementContinuation = {
          chainId: options.chainId,
          sourceDefinitionId: pendingCombine.effectSourceDefinitionId,
          resumeEffectOverride: effect,
          effectIndex,
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
          sourceInstanceId,
          effectSourceInstanceId: pendingCombine.effectSourceInstanceId,
          effectSourceDefinitionId: pendingCombine.effectSourceDefinitionId,
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          actingPlayerId,
          resumeStepIndex: i + 1,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
          ...(currentState.pendingTargetedDisclosureContinuation !== null
            ? {
                targetedDisclosureContinuation:
                  currentState.pendingTargetedDisclosureContinuation,
              }
            : {}),
        };
        currentState = {
          ...currentState,
          pendingEnterFieldPlacement: {
            ...pendingPlacement,
            effectBraveCombineAsSummon: {
              ...pendingCombine,
              continuation,
            },
          },
          log: [
            ...currentState.log,
            `effect:brave-combine-as-summon-placement-pending:${pendingPlacement.pendingId}:resume-at=${i + 1}`,
          ],
        };
      }
      return { kind: "return", state: currentState };
    }
    // 非フィールドの自己除外置換も、結果が確定するまで本文を中断する。
    if (
      currentState.pendingSetAsideExitReplacementChoice &&
      !preStateRef.pendingSetAsideExitReplacementChoice &&
      !currentState.pendingSetAsideExitReplacementChoice.continuation
    ) {
      const hasRepeatWork = step.repeat !== undefined;
      const continuation = buildEffectBodyContinuation({
        state: currentState,
        effect,
        effectIndex,
        stepIndex: hasRepeatWork ? i : i + 1,
        options,
        stepCtx,
        targetIdsConsumed: cursors.targetIdsConsumed,
        effectSourceDefinitionId,
        resumePreviousStepPreState: preStateRef,
        ...(hasRepeatWork
          ? {
              repeatResume: {
                stepIndex: i,
                nextAdditionalIndex: 0,
                skipBaseAction: true,
                excludedTargetInstanceIds: resolvedTargetIds ?? [],
              },
            }
          : {}),
      });
      return {
        kind: "return",
        state: {
          ...currentState,
          pendingSetAsideExitReplacementChoice: {
            ...currentState.pendingSetAsideExitReplacementChoice,
            continuation,
            stepResultId: step.id ?? `__step_${i}`,
          },
        },
      };
    }
    // ゾーン選択 pending (discard「N枚まで」/ search 等) が新規生成され、かつ後続
    // ステップまたは解決後 hook がある場合: 選択結果 (= 移動枚数) は解決時まで
    // 未確定のため step result はここでは記録せず、解決時に recordStepId で記録する
    // continuation を注入して中断する。
    // 「手札N枚まで破棄→破棄1枚につき2枚ドロー」(BSSL01-C01) 等の後続 cards_from_ref を成立させる。
    const newZoneSelectionPending =
      currentState.pendingZoneSelection !== null &&
      currentState.pendingZoneSelection.braveCapacityHostInstanceId ===
        undefined &&
      preStateRef.pendingZoneSelection === null &&
      currentState.pendingZoneSelection.continuation === undefined;
    if (newZoneSelectionPending) {
      currentState = {
        ...currentState,
        pendingZoneSelection: withRevealedSelectionCards(
          currentState,
          currentState.pendingZoneSelection!,
          stepCtx.disclosureStartSequence ?? Number.POSITIVE_INFINITY
        ),
      };
    }
    if (
      newZoneSelectionPending &&
      (i + 1 < steps.length ||
        currentState.pendingZoneSelection?.destination === "field" ||
        options.postResolutionOracle ||
        options.battleEndDeferralAttackId !== undefined)
    ) {
      const resumeSourceDefinitionId =
        options.targetedDisclosureSourceDefinitionId ??
        effectSourceDefinitionId;
      const continuation: import("../model").ZoneSelectionContinuation = {
        chainId: options.chainId,
        sourceDefinitionId: resumeSourceDefinitionId,
        resumeEffectOverride: effect,
        effectIndex,
        sourceInstanceId,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        ...(sourceCardReferenceInstanceId !== undefined
          ? { sourceCardReferenceInstanceId }
          : {}),
        actingPlayerId,
        resumeStepIndex: i + 1,
        recordStepId: step.id ?? `__step_${i}`,
        stepContext: serializeStepContext(stepCtx),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
        ...(currentState.pendingTargetedDisclosureContinuation !== null
          ? {
              targetedDisclosureContinuation:
                currentState.pendingTargetedDisclosureContinuation,
            }
          : {}),
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
      };
      currentState = {
        ...currentState,
        pendingZoneSelection: {
          ...currentState.pendingZoneSelection!,
          continuation,
        },
        log: [
          ...currentState.log,
          `effect:zone-selection-pending:${currentState.pendingZoneSelection!.pendingId}:resume-at=${i + 1}`,
        ],
      };
      return { kind: "return", state: currentState };
    }
    // deck_reveal が pendingDeckReveal を新規生成し、かつ後続ステップがある場合:
    // 実際に手札へ加わったカード (= pick 結果) は解決時まで未確定のため、ここでは
    // step result を記録せず、解決時に recordStepId で記録する continuation を注入して
    // 中断する。「手札に加えなかったとき、トラッシュから...戻せる」型
    // (BSTH02.7-C03 初出、ENGINE-deck-reveal-hand-added-tracking) の後続
    // `ref_count(result:"hand_added")` を成立させる。
    const buildDeckRevealContinuation = (args: {
      resumeStepIndex: number;
      repeatResume?: EffectStepRepeatResume;
    }): import("../model").ZoneSelectionContinuation => {
      const resumeSourceDefinitionId =
        options.targetedDisclosureSourceDefinitionId ??
        effectSourceDefinitionId;
      return {
        chainId: options.chainId,
        sourceDefinitionId: resumeSourceDefinitionId,
        resumeEffectOverride: effect,
        effectIndex,
        sourceInstanceId,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        ...(sourceCardReferenceInstanceId !== undefined
          ? { sourceCardReferenceInstanceId }
          : {}),
        actingPlayerId,
        resumeStepIndex: args.resumeStepIndex,
        recordStepId: step.id ?? `__step_${i}`,
        stepContext: serializeStepContext(stepCtx),
        ...(args.repeatResume !== undefined
          ? { repeatResume: args.repeatResume }
          : {}),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
        ...(currentState.pendingTargetedDisclosureContinuation !== null
          ? {
              targetedDisclosureContinuation:
                currentState.pendingTargetedDisclosureContinuation,
            }
          : {}),
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
      };
    };
    const newDeckRevealPending =
      currentState.pendingDeckReveal !== null &&
      preStateRef.pendingDeckReveal === null &&
      currentState.pendingDeckReveal.continuation === undefined;
    const repeatAdditionalCountAtActivation = step.repeat
      ? resolveRepeatAdditionalCount({
          repeat: step.repeat,
          state: preStateRef,
          conditionSourceInstanceId,
          conditionSourceContext,
          actingPlayerId,
          getCardDefinitionById,
          stepCtx,
          choiceIndex: options.choiceIndex,
        })
      : 0;
    const hasPendingRepeatWork = repeatAdditionalCountAtActivation > 0;
    if (
      newDeckRevealPending &&
      (hasPendingRepeatWork ||
        i + 1 < steps.length ||
        currentState.pendingDeckReveal!.beforePickSteps ||
        currentState.pendingDeckReveal!.beforeMoveSteps ||
        options.postResolutionOracle ||
        options.battleEndDeferralAttackId !== undefined)
    ) {
      const continuation = buildDeckRevealContinuation({
        resumeStepIndex: hasPendingRepeatWork ? i : i + 1,
        ...(hasPendingRepeatWork
          ? {
              repeatResume: {
                stepIndex: i,
                nextAdditionalIndex: 0,
                skipBaseAction: true,
                excludedTargetInstanceIds: resolvedTargetIds ?? [],
                additionalCount: repeatAdditionalCountAtActivation,
              },
            }
          : {}),
      });
      const pendingDeckReveal = { ...currentState.pendingDeckReveal! };
      delete pendingDeckReveal.postResolutionOracle;
      currentState = {
        ...currentState,
        pendingDeckReveal: {
          ...pendingDeckReveal,
          continuation,
        },
        log: [
          ...currentState.log,
          `effect:deck-reveal-pending:${currentState.pendingDeckReveal!.pendingId}:resume-at=${hasPendingRepeatWork ? i : i + 1}`,
        ],
      };
      return {
        kind: "return",
        state:
          currentState.pendingDeckReveal?.beforePickSteps?.length ||
          currentState.pendingDeckReveal?.beforeMoveSteps?.length
            ? runPendingDeckRevealBoundary(currentState, options, executeEffect)
            : currentState,
      };
    }
    // ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: count_decrease が
    // amount {min,max}（「好きなだけ減らせる」型）で pendingCountSelection を生成した場合、
    // ゾーン選択 pending と同じく選択結果 (= 実際に減らした数) が解決時まで未確定のため、
    // ここでは step result を記録せず、解決時に recordStepId で記録する continuation を
    // 注入して中断する (「そうしたとき」の後続 cost_modify 等が numericAmount を参照する)。
    const newCountSelectionPending =
      currentState.pendingCountSelection !== null &&
      preStateRef.pendingCountSelection === null &&
      currentState.pendingCountSelection.continuation === undefined;
    if (
      newCountSelectionPending &&
      (i + 1 < steps.length ||
        options.postResolutionOracle ||
        currentState.pendingCountSelection?.selectionAction)
    ) {
      const continuation: import("../model").ZoneSelectionContinuation = {
        chainId: options.chainId,
        sourceDefinitionId: effectSourceDefinitionId,
        resumeEffectOverride: effect,
        effectIndex,
        sourceInstanceId,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        ...(sourceCardReferenceInstanceId !== undefined
          ? { sourceCardReferenceInstanceId }
          : {}),
        actingPlayerId,
        resumeStepIndex: i + 1,
        recordStepId: step.id ?? `__step_${i}`,
        stepContext: serializeStepContext(stepCtx),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        ...(currentState.pendingTargetedDisclosureContinuation !== null
          ? {
              targetedDisclosureContinuation:
                currentState.pendingTargetedDisclosureContinuation,
            }
          : {}),
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
      };
      currentState = {
        ...currentState,
        pendingCountSelection: {
          ...currentState.pendingCountSelection!,
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
          continuation,
        },
        log: [
          ...currentState.log,
          `effect:count-selection-pending:${currentState.pendingCountSelection!.pendingId}:resume-at=${i + 1}`,
        ],
      };
      return { kind: "return", state: currentState };
    }
    if (newCountSelectionPending) {
      return { kind: "return", state: currentState };
    }
    // ENGINE-composite-heterogeneous-removal-budget: discard_set_burst が count
    // {min,max}（範囲、Q4185 非識別のため枚数のみ選択）で pendingDiscardSetBurstCountSelection
    // を生成した場合も、count_decrease と同じく選択結果 (= 実際に破棄した枚数) が解決時まで
    // 未確定のため、continuation を注入して中断する。
    const newDiscardSetBurstCountSelectionPending =
      activeAction.kind === "discard_set_burst" &&
      currentState.pendingDiscardSetBurstCountSelection !== null &&
      preStateRef.pendingDiscardSetBurstCountSelection === null &&
      currentState.pendingDiscardSetBurstCountSelection.continuation ===
        undefined;
    if (
      newDiscardSetBurstCountSelectionPending &&
      (i + 1 < steps.length || options.postResolutionOracle)
    ) {
      const continuation: import("../model").ZoneSelectionContinuation = {
        chainId: options.chainId,
        sourceDefinitionId: effectSourceDefinitionId,
        resumeEffectOverride: effect,
        effectIndex,
        sourceInstanceId,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        ...(sourceCardReferenceInstanceId !== undefined
          ? { sourceCardReferenceInstanceId }
          : {}),
        actingPlayerId,
        resumeStepIndex: i + 1,
        recordStepId: step.id ?? `__step_${i}`,
        stepContext: serializeStepContext(stepCtx),
        ...(options.choiceIndex !== undefined
          ? { choiceIndex: options.choiceIndex }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
        ...(effectSourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectSourcePreventionLevel }
          : {}),
        ...(effectSourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectSourcePreventionBypass }
          : {}),
        ...(options.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: options.costPaidThisEffect }
          : {}),
        ...(options.postResolutionOracle !== undefined
          ? { postResolutionOracle: options.postResolutionOracle }
          : {}),
        ...(currentState.pendingTargetedDisclosureContinuation !== null
          ? {
              targetedDisclosureContinuation:
                currentState.pendingTargetedDisclosureContinuation,
            }
          : {}),
        ...(options.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.divineSkillIndex }
          : {}),
        ...(options.isAccelData !== undefined
          ? { isAccelData: options.isAccelData }
          : {}),
        ...(options.isChangeData !== undefined
          ? { isChangeData: options.isChangeData }
          : {}),
        ...(options.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
          : {}),
      };
      currentState = {
        ...currentState,
        pendingDiscardSetBurstCountSelection: {
          ...currentState.pendingDiscardSetBurstCountSelection!,
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
          continuation,
        },
        log: [
          ...currentState.log,
          `effect:discard-set-burst-count-selection-pending:${currentState.pendingDiscardSetBurstCountSelection!.pendingId}:resume-at=${i + 1}`,
        ],
      };
      return { kind: "return", state: currentState };
    }
    if (newDiscardSetBurstCountSelectionPending) {
      return { kind: "return", state: currentState };
    }
    const newCoreCountSelectionPending =
      activeAction.kind === "core_move" &&
      currentState.pendingCoreCountSelection !== null &&
      preStateRef.pendingCoreCountSelection === null;
    if (newCoreCountSelectionPending) {
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      let pendingCoreCountSelection = currentState.pendingCoreCountSelection!;
      if (options.battleEndDeferralAttackId !== undefined) {
        pendingCoreCountSelection = {
          ...pendingCoreCountSelection,
          battleEndDeferralAttackId: options.battleEndDeferralAttackId,
        };
      }
      if (hasRemainingSteps) {
        const continuation: import("../model").ZoneSelectionContinuation = {
          chainId: options.chainId,
          sourceDefinitionId: effectSourceDefinitionId,
          resumeEffectOverride: effect,
          effectIndex,
          sourceInstanceId,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          ...(sourceCardReferenceInstanceId !== undefined
            ? { sourceCardReferenceInstanceId }
            : {}),
          actingPlayerId,
          resumeStepIndex: i + 1,
          recordStepId: step.id ?? `__step_${i}`,
          stepContext: serializeStepContext(stepCtx),
          ...(options.choiceIndex !== undefined
            ? { choiceIndex: options.choiceIndex }
            : {}),
          ...(options.effectActionKind !== undefined
            ? { effectActionKind: options.effectActionKind }
            : {}),
          ...(effectSourcePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectSourcePreventionLevel }
            : {}),
          ...(effectSourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectSourcePreventionBypass }
            : {}),
          ...(options.costPaidThisEffect !== undefined
            ? { costPaidThisEffect: options.costPaidThisEffect }
            : {}),
          ...(options.postResolutionOracle !== undefined
            ? { postResolutionOracle: options.postResolutionOracle }
            : {}),
          ...(options.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
            : {}),
          ...(currentState.pendingTargetedDisclosureContinuation !== null
            ? {
                targetedDisclosureContinuation:
                  currentState.pendingTargetedDisclosureContinuation,
              }
            : {}),
          ...(options.divineSkillIndex !== undefined
            ? { divineSkillIndex: options.divineSkillIndex }
            : {}),
          ...(options.isAccelData !== undefined
            ? { isAccelData: options.isAccelData }
            : {}),
          ...(options.isChangeData !== undefined
            ? { isChangeData: options.isChangeData }
            : {}),
        };
        pendingCoreCountSelection = {
          ...pendingCoreCountSelection,
          continuation,
        };
      }
      currentState = {
        ...currentState,
        pendingCoreCountSelection,
        log: hasRemainingSteps
          ? [
              ...currentState.log,
              `effect:core-count-pending:${pendingCoreCountSelection.pendingId}:resume-at=${i + 1}`,
            ]
          : currentState.log,
      };
      return { kind: "return", state: currentState };
    }
    if (
      activeAction.kind === "core_move" &&
      currentState.pendingLifeGainReplacementChoice !== null &&
      preStateRef.pendingLifeGainReplacementChoice === null
    ) {
      const pending = currentState.pendingLifeGainReplacementChoice;
      const hasRepeatWork = step.repeat !== undefined;
      const continuation = buildEffectBodyContinuation({
        state: currentState,
        effect,
        effectIndex,
        stepIndex: hasRepeatWork ? i : i + 1,
        options,
        stepCtx,
        targetIdsConsumed: cursors.targetIdsConsumed,
        effectSourceDefinitionId,
        resumePreviousStepPreState: preStateRef,
        ...(hasRepeatWork
          ? {
              repeatResume: {
                stepIndex: i,
                nextAdditionalIndex: 0,
                skipBaseAction: true,
                excludedTargetInstanceIds: resolvedTargetIds ?? [],
              },
            }
          : {}),
      });
      return {
        kind: "return",
        state: {
          ...currentState,
          pendingLifeGainReplacementChoice: {
            ...pending,
            continuation,
            stepResultId: step.id ?? `__step_${i}`,
          },
        },
      };
    }
    const newLifeCoreSelectionPending =
      activeAction.kind === "core_move" &&
      currentState.pendingLifeCoreSelection !== null &&
      preStateRef.pendingLifeCoreSelection === null &&
      currentState.pendingLifeCoreSelection.continuation === undefined;
    if (newLifeCoreSelectionPending) {
      const hasRepeatWork = step.repeat !== undefined;
      let pendingLifeCoreSelection = currentState.pendingLifeCoreSelection!;
      if (options.battleEndDeferralAttackId !== undefined) {
        pendingLifeCoreSelection = {
          ...pendingLifeCoreSelection,
          battleEndDeferralAttackId: options.battleEndDeferralAttackId,
        };
      }
      // 最後のstepでも、選択完了時の誘発収集まで原因・発揮元を保持する。
      // 後続本文がなくても完了位置へのcontinuationを作る。
      {
        const resumeAtStep = hasRepeatWork ? i : i + 1;
        const initialStepResult = buildLifeCoreSelectionStepResult({
          action: activeAction,
          pending: pendingLifeCoreSelection,
          step,
          stepIndex: i,
          resolvedTargetIds,
        });
        const continuation = buildEffectBodyContinuation({
          state: currentState,
          effect,
          effectIndex,
          stepIndex: resumeAtStep,
          options,
          stepCtx,
          targetIdsConsumed: cursors.targetIdsConsumed,
          effectSourceDefinitionId,
          ...(initialStepResult !== undefined
            ? {
                initialStepResults: [initialStepResult],
                resumePreviousStepPreState: preStateRef,
              }
            : {}),
          ...(hasRepeatWork
            ? {
                repeatResume: {
                  stepIndex: i,
                  nextAdditionalIndex: 0,
                  skipBaseAction: true,
                  excludedTargetInstanceIds: resolvedTargetIds ?? [],
                },
              }
            : {}),
        });
        pendingLifeCoreSelection = {
          ...pendingLifeCoreSelection,
          continuation,
        };
        currentState = {
          ...currentState,
          pendingLifeCoreSelection,
          log: [
            ...currentState.log,
            `effect:life-core-selection-pending:${pendingLifeCoreSelection.pendingId}:resume-at=${resumeAtStep}`,
          ],
        };
      }
      return { kind: "return", state: currentState };
    }
    const newLifeDamageDiscardPending =
      activeAction.kind === "core_move" &&
      currentState.pendingLifeDamageDiscardChoice !== null &&
      preStateRef.pendingLifeDamageDiscardChoice === null &&
      currentState.pendingLifeDamageDiscardChoice.continuation === undefined;
    if (newLifeDamageDiscardPending) {
      const hasRepeatWork = step.repeat !== undefined;
      const hasRemainingSteps =
        i + 1 < steps.length || options.postResolutionOracle !== undefined;
      if (hasRepeatWork || hasRemainingSteps) {
        const resumeAtStep = hasRepeatWork ? i : i + 1;
        const continuation = buildEffectBodyContinuation({
          state: currentState,
          effect,
          effectIndex,
          stepIndex: resumeAtStep,
          options,
          stepCtx,
          targetIdsConsumed: cursors.targetIdsConsumed,
          effectSourceDefinitionId,
          ...(hasRepeatWork
            ? {
                repeatResume: {
                  stepIndex: i,
                  nextAdditionalIndex: 0,
                  skipBaseAction: true,
                  excludedTargetInstanceIds: resolvedTargetIds ?? [],
                },
              }
            : {}),
        });
        const pendingLifeDamageDiscardChoice =
          currentState.pendingLifeDamageDiscardChoice!;
        currentState = {
          ...currentState,
          pendingLifeDamageDiscardChoice: {
            ...pendingLifeDamageDiscardChoice,
            continuation,
            stepResultId: step.id ?? `__step_${i}`,
          },
          log: [
            ...currentState.log,
            `effect:life-damage-discard-pending:${pendingLifeDamageDiscardChoice.pendingId}:resume-at=${resumeAtStep}`,
          ],
        };
      }
      return { kind: "return", state: currentState };
    }
    // --- 反復発揮 (step.repeat): 「この効果を○○につき追加で発揮する」 ---
    // 基本 1 回の native 実行が完了した後、未実行の additional 回を同じ native path で
    // 再実行する。deck_reveal のように pending を作る action は上の継続情報へ次の反復
    // index と固定済み回数を保存し、選択・残札配置の完了後にこのループへ戻る。
    const repeatResolvedTargetIds: string[] = [];
    let ruleSeparationRepeatResume: LifeCoreSelectionContinuation["repeatResume"];
    if (step.repeat) {
      const maxAdditional =
        repeatResume?.additionalCount ??
        resolveRepeatAdditionalCount({
          repeat: step.repeat,
          state: currentState,
          conditionSourceInstanceId,
          conditionSourceContext,
          actingPlayerId,
          getCardDefinitionById,
          stepCtx,
          choiceIndex: options.choiceIndex,
        });
      const explicitAdditional =
        step.targetSelectionTiming !== "on_step" &&
        repeatExplicitTargetCount !== null &&
        repeatExplicitTargetCount > 0 &&
        options.targetInstanceIds
          ? Math.max(
              0,
              Math.floor(
                options.targetInstanceIds.length / repeatExplicitTargetCount
              ) - 1
            )
          : null;
      const selectedPerRepeatAdditional =
        step.targetSelectionTiming === "on_step" &&
        step.repeat.optional === true &&
        options.optionalRepeatTargetCount !== undefined &&
        repeatExplicitTargetCount !== null &&
        repeatExplicitTargetCount > 0
          ? Math.max(
              0,
              Math.floor(
                options.optionalRepeatTargetCount / repeatExplicitTargetCount
              ) - 1
            )
          : undefined;
      const additional =
        explicitAdditional !== null
          ? Math.min(maxAdditional, explicitAdditional)
          : (selectedPerRepeatAdditional ?? maxAdditional);
      if (
        hasRuleBraveSeparationChoice(currentState) &&
        (repeatResume?.nextAdditionalIndex ?? 0) < additional
      ) {
        ruleSeparationRepeatResume = {
          stepIndex: i,
          skipBaseAction: true,
          nextAdditionalIndex: repeatResume?.nextAdditionalIndex ?? 0,
          additionalCount: additional,
          excludedTargetInstanceIds: resolvedTargetIds ?? [],
        };
      }
      const stagedBpTargetInstanceIdsByActivation: string[][] =
        stageBpModifiersAcrossOnStepRepeats
          ? repeatResume?.stagedBpTargetInstanceIdsByActivation
            ? repeatResume.stagedBpTargetInstanceIdsByActivation.map((ids) => [
                ...ids,
              ])
            : [[...(resolvedTargetIds ?? [])]]
          : [];
      const queueNextOnStepRepeatTargetSelection = (
        nextAdditionalIndex: number
      ): boolean => {
        if (step.targetSelectionTiming !== "on_step") return false;
        const repeatSelectionOptions: ExecuteEffectOptions = {
          ...options,
          repeatResume: {
            stepIndex: i,
            nextAdditionalIndex,
            skipBaseAction: true,
            excludedTargetInstanceIds: [
              ...(resolvedTargetIds ?? []),
              ...repeatResolvedTargetIds,
            ],
            additionalCount: repeatResume?.additionalCount ?? additional,
            ...(stageBpModifiersAcrossOnStepRepeats
              ? { stagedBpTargetInstanceIdsByActivation }
              : {}),
            ...(activeAction.kind === "bp_modify"
              ? {
                  bpBecameZeroCardInstanceIds: dedupePreserveOrder([
                    ...(repeatResume?.bpBecameZeroCardInstanceIds ?? []),
                    ...bpBecameZeroIds,
                  ]),
                }
              : {}),
          },
        };
        // この pending は次の 1 回分の対象を現在盤面から選ぶ。前回の選択を
        // executeEffect へ流用すると tryBuildStepTargetSelection が pending を省略する。
        delete repeatSelectionOptions.targetInstanceIds;
        delete repeatSelectionOptions.targetStepId;
        delete repeatSelectionOptions.targetSelectionResolved;
        const targetOutcome = handleStepOnStepTargetSelection({
          step,
          stepIndex: i,
          options: repeatSelectionOptions,
          stepCtx,
          currentState,
          effect,
          activeAction,
          activeChooser,
          targetIdsConsumed: true,
          effectIndex,
          effectSourcePreventionLevel,
          effectSourceTargetLockBypass,
          effectSourcePreventionBypass,
        });
        currentState = targetOutcome.state;
        return targetOutcome.kind === "break";
      };
      // 基礎発揮後、追加発揮の最初の対象をこの時点の盤面から選ぶ。
      if (
        step.targetSelectionTiming === "on_step" &&
        !ruleSeparationRepeatResume &&
        repeatResume === undefined &&
        additional > 0 &&
        queueNextOnStepRepeatTargetSelection(0)
      ) {
        return { kind: "return", state: currentState };
      }
      for (
        let r = repeatStartIndex;
        r < additional && !ruleSeparationRepeatResume;
        r++
      ) {
        // 各反復は対象を独立に再解決する (毎回新しい候補集合から選び直す)。
        const selectedOnStepRepeatTargetIds =
          step.targetSelectionTiming === "on_step" &&
          repeatResume !== undefined &&
          canConsumePassedTargets &&
          options.targetInstanceIds !== undefined &&
          (options.targetInstanceIds.length > 0 ||
            options.targetSelectionResolved === true)
            ? options.targetInstanceIds
            : undefined;
        const explicitRepeatTargetIds =
          selectedOnStepRepeatTargetIds ??
          (repeatResume &&
          r === repeatStartIndex &&
          options.summonPaymentSources !== undefined
            ? options.targetInstanceIds
            : undefined) ??
          (repeatExplicitTargetCount !== null && options.targetInstanceIds
            ? options.targetInstanceIds.slice(
                repeatExplicitTargetCount * (r + 1),
                repeatExplicitTargetCount * (r + 2)
              )
            : undefined);
        const excludedRepeatTargetIds =
          step.repeat.allowDuplicateTargets === false
            ? [...(resolvedTargetIds ?? []), ...repeatResolvedTargetIds]
            : undefined;
        const repeatTargetIds = resolveTargets(
          activeAction,
          currentState,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepCtx,
          explicitRepeatTargetIds && explicitRepeatTargetIds.length > 0
            ? explicitRepeatTargetIds
            : undefined,
          sourceDef,
          effectSourcePreventionLevel,
          effectSourceTargetLockBypass,
          effectSourcePreventionBypass,
          undefined,
          undefined,
          undefined,
          options.rangeAutoResolveStrategy,
          effectSourceInstanceId,
          effectSourceDefinition,
          undefined,
          excludedRepeatTargetIds,
          step.targetSelectionTiming === "on_step" &&
            explicitRepeatTargetIds !== undefined &&
            explicitRepeatTargetIds.length > 0,
          sourceCardReferenceInstanceId
        );
        // P3-76: on_step の追加巡も、対象を選んだ直後・action 実行前に
        // 「対象になるとき」の開示/応答を挟む。通常の target disclosure slice は
        // repeatResume で基礎対象だけを保持するため、この巡の対象を別 continuation
        // として保存し、応答後に同じ r の action から再開する。
        if (
          selectedOnStepRepeatTargetIds !== undefined &&
          repeatTargetIds !== undefined &&
          repeatTargetIds.length > 0 &&
          options.skipTargetedDisclosureAtStartStep !== true
        ) {
          const disclosureSourceDefinitionId =
            options.targetedDisclosureSourceDefinitionId ??
            effectSourceDefinitionId;
          if (disclosureSourceDefinitionId) {
            const targetCandidateInstanceIds =
              resolveTargetCandidateIds(
                activeAction,
                currentState,
                actingPlayerId,
                sourceInstanceId,
                getCardDefinitionById,
                stepCtx,
                sourceDef,
                effectSourcePreventionLevel,
                effectSourceTargetLockBypass,
                effectSourcePreventionBypass,
                effectSourceInstanceId,
                effectSourceDefinition
              ) ?? [];
            const disclosed = queueTargetedDisclosureForStep({
              state: currentState,
              selectedTargetInstanceIds: repeatTargetIds,
              resumeTargetInstanceIds: repeatTargetIds,
              actingPlayerId,
              sourceInstanceId,
              sourceDefinitionId: disclosureSourceDefinitionId,
              effectSourceInstanceId,
              effectSourceDefinitionId,
              ...(sourceCardReferenceInstanceId !== undefined
                ? { sourceCardReferenceInstanceId }
                : {}),
              targetedEventSourceInstanceId: effectSourceInstanceId,
              targetedEventSourceDefinitionId: effectSourceDefinitionId,
              ...(options.effectActionKind !== undefined
                ? { effectActionKind: options.effectActionKind }
                : {}),
              ...(options.effectActivationTiming !== undefined
                ? { effectActivationTiming: options.effectActivationTiming }
                : {}),
              ...(options.chainId !== undefined
                ? { chainId: options.chainId }
                : {}),
              effectIndex,
              ...(options.divineSkillIndex !== undefined
                ? { divineSkillIndex: options.divineSkillIndex }
                : {}),
              ...(options.isAccelData !== undefined
                ? { isAccelData: options.isAccelData }
                : {}),
              ...(options.isChangeData !== undefined
                ? { isChangeData: options.isChangeData }
                : {}),
              resumeStepIndex: i,
              targetStepId: currentStepId,
              stepContext: serializeStepContext(stepCtx),
              repeatResume: {
                stepIndex: i,
                nextAdditionalIndex: r,
                skipBaseAction: true,
                excludedTargetInstanceIds: [
                  ...(resolvedTargetIds ?? []),
                  ...repeatResolvedTargetIds,
                ],
                additionalCount: repeatResume?.additionalCount ?? additional,
                ...(stageBpModifiersAcrossOnStepRepeats
                  ? { stagedBpTargetInstanceIdsByActivation }
                  : {}),
                ...(activeAction.kind === "bp_modify"
                  ? {
                      bpBecameZeroCardInstanceIds: dedupePreserveOrder([
                        ...(repeatResume?.bpBecameZeroCardInstanceIds ?? []),
                        ...bpBecameZeroIds,
                      ]),
                    }
                  : {}),
              },
              getCardDefinitionById,
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
              ...(options.getRegisteredBurstActions !== undefined
                ? {
                    getRegisteredBurstActions:
                      options.getRegisteredBurstActions,
                  }
                : {}),
              ...(options.choiceIndex !== undefined
                ? { choiceIndex: options.choiceIndex }
                : {}),
              ...(effectSourcePreventionLevel !== undefined
                ? { sourcePreventionLevel: effectSourcePreventionLevel }
                : {}),
              ...(effectSourcePreventionBypass !== undefined
                ? { sourcePreventionBypass: effectSourcePreventionBypass }
                : {}),
              ...(options.costPaidThisEffect !== undefined
                ? { costPaidThisEffect: options.costPaidThisEffect }
                : {}),
              ...(options.postResolutionOracle !== undefined
                ? { postResolutionOracle: options.postResolutionOracle }
                : {}),
              ...(options.battleEndDeferralAttackId !== undefined
                ? {
                    battleEndDeferralAttackId:
                      options.battleEndDeferralAttackId,
                  }
                : {}),
              effectResolutionBeforeState,
              disclosureTargetStart: r,
              disclosureTargetCount: repeatTargetIds.length,
              targetCandidateInstanceIds,
              ...(options.targetedDisclosureNegateIdentity !== undefined
                ? {
                    negateIdentitySnapshot:
                      options.targetedDisclosureNegateIdentity,
                  }
                : {}),
            });
            if (disclosed.queued) {
              return { kind: "return", state: disclosed.state };
            }
          }
        }
        if (repeatTargetIds) {
          repeatResolvedTargetIds.push(...repeatTargetIds);
        }
        const repeatCoreMoveAmountBonusOverride =
          activeAction.kind === "core_move" &&
          step.repeat.allowDuplicateTargets === false
            ? 0
            : undefined;
        const repeatPreState = cloneStateForTriggerDelta(currentState);
        const repeatActionTargetGroups: Array<string[] | undefined> =
          stageBpModifiersAcrossOnStepRepeats
            ? (() => {
                stagedBpTargetInstanceIdsByActivation.push([
                  ...(repeatTargetIds ?? []),
                ]);
                return r + 1 < additional
                  ? []
                  : stagedBpTargetInstanceIdsByActivation;
              })()
            : [repeatTargetIds];
        let repeatResult: GameState | null = currentState;
        for (const repeatActionTargetIds of repeatActionTargetGroups) {
          repeatResult = executeNativeAction(
            activeAction,
            currentState,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            stepCtx,
            effect,
            options.chainId,
            repeatActionTargetIds,
            options.pendingEffectSimultaneousGroupId,
            options.coreShootDistribution,
            options.coreShootSoulCoreInstanceId,
            {
              effectIndex,
              stepIndex: i,
              ...(options.effectSourceInstanceId !== undefined
                ? { effectSourceInstanceId: options.effectSourceInstanceId }
                : {}),
              ...(options.effectSourceDefinitionId !== undefined
                ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
                : {}),
            },
            options.payCostPaymentSources,
            options.coreDistributionAllocations,
            options.coreDistributionSoulCoreInstanceId,
            options.coreDistributionSoulCoreAllocations,
            repeatResume && r === repeatStartIndex
              ? options.summonPaymentSources
              : undefined,
            options.summonEnterFieldCorePlacements,
            step,
            options.choiceIndex,
            effectSourcePreventionLevel,
            effectSourceNegatePreventionLevel,
            effectSourceTargetLockBypass,
            options.coreSourceAllocations,
            options.coreSourceSoulCoreInstanceId,
            options.getRegisteredTriggeredEffectActions,
            options.getRegisteredBurstActions,
            forceSnapshotContinuousTargets,
            options.battleEndDeferralAttackId,
            options.resolveDeferredStackForFreeMagicUse,
            options.getRegisteredMagicActions,
            effectSourcePreventionBypass,
            options.pendingStackNegateCandidate,
            options.effectActionKind,
            repeatCoreMoveAmountBonusOverride,
            options.recordedUsage,
            undefined,
            options.pendingEffectPendingId,
            sourceCardReferenceInstanceId,
            options.preservePreSelectedTargetRefs === true,
            {
              divineSkillIndex: options.divineSkillIndex,
              isAccelData: options.isAccelData,
              isChangeData: options.isChangeData,
              triggerFromZone: options.triggerFromZone,
              triggerCause: options.triggerCause,
              triggerRelatedInstanceZone: options.triggerRelatedInstanceZone,
              activationZone: options.activationZone,
              costPaidThisEffect: options.costPaidThisEffect,
              postResolutionOracle: options.postResolutionOracle,
              targetInstanceIds: !cursors.targetIdsConsumed
                ? options.targetInstanceIds
                : undefined,
              targetStepId: !cursors.targetIdsConsumed
                ? options.targetStepId
                : undefined,
              targetSelectionResolved: options.targetSelectionResolved,
              targetGroups: options.targetGroups,
              sequentialTargetConsumption: options.sequentialTargetConsumption,
              eventAmount: options.eventAmount,
              rangeAutoResolveStrategy: options.rangeAutoResolveStrategy,
            }
          );
          if (repeatResult === null) break;
          currentState = repeatResult;
        }
        if (repeatResult === null) break;
        const repeatCostState = saveNewSummonCostPayment(
          repeatPreState,
          repeatTargetIds,
          {
            stepIndex: i,
            nextAdditionalIndex: r,
            skipBaseAction: true,
            additionalCount: repeatResume?.additionalCount ?? additional,
            excludedTargetInstanceIds: [
              ...(resolvedTargetIds ?? []),
              ...repeatResolvedTargetIds.slice(
                0,
                repeatResolvedTargetIds.length - (repeatTargetIds?.length ?? 0)
              ),
            ],
          }
        );
        if (repeatCostState) return { kind: "return", state: repeatCostState };
        const repeatPlacementState = saveNewMultiPlacement(repeatPreState, {
          stepIndex: i,
          nextAdditionalIndex: r + 1,
          skipBaseAction: true,
          additionalCount: repeatResume?.additionalCount ?? additional,
          excludedTargetInstanceIds: [
            ...(resolvedTargetIds ?? []),
            ...repeatResolvedTargetIds,
          ],
        });
        if (repeatPlacementState)
          return { kind: "return", state: repeatPlacementState };
        const swapRepeatState = saveNewSwapChoice(
          repeatPreState,
          {
            state: currentState,
            effect,
            effectIndex,
            stepIndex: i,
            options,
            stepCtx,
            targetIdsConsumed: cursors.targetIdsConsumed,
            effectSourceDefinitionId,
            resumePreviousStepPreState: repeatPreState,
            repeatResume: {
              stepIndex: i,
              nextAdditionalIndex: r + 1,
              skipBaseAction: true,
              additionalCount: repeatResume?.additionalCount ?? additional,
              excludedTargetInstanceIds: [
                ...(resolvedTargetIds ?? []),
                ...repeatResolvedTargetIds,
              ],
            },
          },
          step.id ?? `__step_${i}`
        );
        if (swapRepeatState) return { kind: "return", state: swapRepeatState };

        if (
          currentState.pendingCoreShootSelection &&
          !repeatPreState.pendingCoreShootSelection
        ) {
          return {
            kind: "return",
            state: {
              ...currentState,
              pendingCoreShootSelection: {
                ...currentState.pendingCoreShootSelection,
                continuation: buildEffectBodyContinuation({
                  state: currentState,
                  effect,
                  effectIndex,
                  stepIndex: i,
                  options,
                  stepCtx,
                  targetIdsConsumed: cursors.targetIdsConsumed,
                  effectSourceDefinitionId,
                  resumePreviousStepPreState: repeatPreState,
                  repeatResume: {
                    stepIndex: i,
                    nextAdditionalIndex: r + 1,
                    skipBaseAction: true,
                    additionalCount:
                      repeatResume?.additionalCount ?? additional,
                    excludedTargetInstanceIds: [
                      ...(resolvedTargetIds ?? []),
                      ...repeatResolvedTargetIds,
                    ],
                  },
                }),
                stepResultId: step.id ?? `__step_${i}`,
              },
            },
          };
        }
        if (activeAction.kind === "bp_modify") {
          // on_step の反復は pending ごとに executeEffect を中断・再開する。
          // 最終再開の pre-state だけでは途中の BP0 遷移を観測できないため、
          // 各反復の直前 state との差分を continuation に積み上げる。
          bpBecameZeroIds = dedupePreserveOrder([
            ...bpBecameZeroIds,
            ...detectBpBecameZeroTransitions(
              repeatPreState,
              currentState,
              repeatTargetIds,
              getCardDefinitionById
            ),
          ]);
        }
        const newRepeatDeckRevealPending =
          activeAction.kind === "deck_reveal" &&
          currentState.pendingDeckReveal !== null &&
          preStateRef.pendingDeckReveal === null &&
          currentState.pendingDeckReveal.continuation === undefined;
        if (newRepeatDeckRevealPending) {
          const continuation = buildDeckRevealContinuation({
            resumeStepIndex: i,
            repeatResume: {
              stepIndex: i,
              nextAdditionalIndex: r + 1,
              skipBaseAction: true,
              excludedTargetInstanceIds: [
                ...(resolvedTargetIds ?? []),
                ...repeatResolvedTargetIds,
              ],
              additionalCount: repeatResume?.additionalCount ?? additional,
            },
          });
          const pendingDeckReveal = { ...currentState.pendingDeckReveal! };
          delete pendingDeckReveal.postResolutionOracle;
          currentState = {
            ...currentState,
            pendingDeckReveal: {
              ...pendingDeckReveal,
              continuation,
            },
            log: [
              ...currentState.log,
              `effect:deck-reveal-pending:${pendingDeckReveal.pendingId}:resume-repeat=${r + 1}`,
            ],
          };
          return {
            kind: "return",
            state:
              currentState.pendingDeckReveal?.beforePickSteps?.length ||
              currentState.pendingDeckReveal?.beforeMoveSteps?.length
                ? runPendingDeckRevealBoundary(
                    currentState,
                    options,
                    executeEffect
                  )
                : currentState,
          };
        }
        if (
          activeAction.kind === "core_move" &&
          currentState.pendingLifeGainReplacementChoice !== null &&
          preStateRef.pendingLifeGainReplacementChoice === null
        ) {
          const pending = currentState.pendingLifeGainReplacementChoice;
          const continuation = buildEffectBodyContinuation({
            state: currentState,
            effect,
            effectIndex,
            stepIndex: i,
            options,
            stepCtx,
            targetIdsConsumed: cursors.targetIdsConsumed,
            effectSourceDefinitionId,
            resumePreviousStepPreState: preStateRef,
            repeatResume: {
              stepIndex: i,
              nextAdditionalIndex: r + 1,
              skipBaseAction: true,
              excludedTargetInstanceIds: [
                ...(resolvedTargetIds ?? []),
                ...repeatResolvedTargetIds,
              ],
            },
          });
          return {
            kind: "return",
            state: {
              ...currentState,
              pendingLifeGainReplacementChoice: {
                ...pending,
                continuation,
                stepResultId: step.id ?? `__step_${i}`,
              },
            },
          };
        }
        const newRepeatLifeDamageDiscardPending =
          activeAction.kind === "core_move" &&
          currentState.pendingLifeDamageDiscardChoice !== null &&
          preStateRef.pendingLifeDamageDiscardChoice === null &&
          currentState.pendingLifeDamageDiscardChoice.continuation ===
            undefined;
        if (newRepeatLifeDamageDiscardPending) {
          const continuation = buildEffectBodyContinuation({
            state: currentState,
            effect,
            effectIndex,
            stepIndex: i,
            options,
            stepCtx,
            targetIdsConsumed: cursors.targetIdsConsumed,
            effectSourceDefinitionId,
            repeatResume: {
              stepIndex: i,
              nextAdditionalIndex: r + 1,
              skipBaseAction: true,
              excludedTargetInstanceIds: [
                ...(resolvedTargetIds ?? []),
                ...repeatResolvedTargetIds,
              ],
            },
          });
          const pendingLifeDamageDiscardChoice =
            currentState.pendingLifeDamageDiscardChoice!;
          currentState = {
            ...currentState,
            pendingLifeDamageDiscardChoice: {
              ...pendingLifeDamageDiscardChoice,
              continuation,
              stepResultId: step.id ?? `__step_${i}`,
            },
            log: [
              ...currentState.log,
              `effect:life-damage-discard-pending:${pendingLifeDamageDiscardChoice.pendingId}:resume-repeat=${r + 1}`,
            ],
          };
          return { kind: "return", state: currentState };
        }
        const newRepeatLifeCoreSelectionPending =
          activeAction.kind === "core_move" &&
          currentState.pendingLifeCoreSelection !== null &&
          preStateRef.pendingLifeCoreSelection === null &&
          currentState.pendingLifeCoreSelection.continuation === undefined;
        if (newRepeatLifeCoreSelectionPending) {
          const continuation = buildEffectBodyContinuation({
            state: currentState,
            effect,
            effectIndex,
            stepIndex: i,
            options,
            stepCtx,
            targetIdsConsumed: cursors.targetIdsConsumed,
            effectSourceDefinitionId,
            repeatResume: {
              stepIndex: i,
              nextAdditionalIndex: r + 1,
              skipBaseAction: true,
              excludedTargetInstanceIds: [
                ...(resolvedTargetIds ?? []),
                ...repeatResolvedTargetIds,
              ],
            },
          });
          const pendingLifeCoreSelection =
            currentState.pendingLifeCoreSelection!;
          currentState = {
            ...currentState,
            pendingLifeCoreSelection: {
              ...pendingLifeCoreSelection,
              ...(options.battleEndDeferralAttackId !== undefined
                ? {
                    battleEndDeferralAttackId:
                      options.battleEndDeferralAttackId,
                  }
                : {}),
              continuation,
            },
            log: [
              ...currentState.log,
              `effect:life-core-selection-pending:${pendingLifeCoreSelection.pendingId}:resume-repeat=${r + 1}`,
            ],
          };
          return { kind: "return", state: currentState };
        }
        currentState.log.push(
          `effect:repeat-activation:${sourceInstanceId}:${effectIndex}:${i}:iter=${r + 1}/${additional}`
        );
        if (hasRuleBraveSeparationChoice(currentState)) {
          if (r + 1 < additional) {
            ruleSeparationRepeatResume = {
              stepIndex: i,
              skipBaseAction: true,
              nextAdditionalIndex: r + 1,
              additionalCount: additional,
              excludedTargetInstanceIds: [
                ...(resolvedTargetIds ?? []),
                ...repeatResolvedTargetIds,
              ],
            };
          }
          break;
        }
        if (
          step.targetSelectionTiming === "on_step" &&
          r + 1 < additional &&
          queueNextOnStepRepeatTargetSelection(r + 1)
        ) {
          return { kind: "return", state: currentState };
        }
      }
      if (activeAction.kind === "bp_modify" && additional > 0) {
        // 「この効果を追加で発揮」した BP- は対象選択こそ各発揮で独立だが、
        // 公式裁定では選ばれた対象すべてへ同時に BP- する。BP0 遷移も
        // 基本発揮前から全 CE 登録後への 1 差分で集計する。
        bpBecameZeroIds = detectBpBecameZeroTransitions(
          preStateRef,
          currentState,
          [...(resolvedTargetIds ?? []), ...repeatResolvedTargetIds],
          getCardDefinitionById
        );
      }
      if (
        activeAction.kind === "bp_modify" &&
        repeatResume?.bpBecameZeroCardInstanceIds !== undefined
      ) {
        bpBecameZeroIds = dedupePreserveOrder([
          ...repeatResume.bpBecameZeroCardInstanceIds,
          ...bpBecameZeroIds,
        ]);
      }
    }
    if (repeatResolvedTargetIds.length > 0) {
      const repeatPostSet = new Set(
        currentState.cardInstances.map((c) => `${c.instanceId}:${c.zone}`)
      );
      affected = detectAffectedCards(preSet, repeatPostSet, currentState, [
        ...(resolvedTargetIds ?? []),
        ...repeatResolvedTargetIds,
      ]);
      if (nonCardResult !== null) {
        nonCardResult = didNonCardActionChangeState(
          activeAction.kind,
          preStateRef,
          currentState,
          activeAction.kind === "noop" && activeAction.target !== undefined
        );
      }
    }
    if (
      activeAction.kind === "move_card" &&
      activeAction.requireFullCount === true
    ) {
      const movedByZoneChange = detectAffectedCards(
        preSet,
        new Set(
          currentState.cardInstances.map((c) => `${c.instanceId}:${c.zone}`)
        ),
        currentState
      );
      if (movedByZoneChange.length === 0) {
        affected = [];
        if (nonCardResult !== true) {
          nonCardResult = false;
        }
      }
    }
    let coreDistributeNumericAmount: number | undefined;
    if (activeAction.kind === "core_distribute") {
      const placementResult = detectCoreDistributePlacementResult(
        preStateRef,
        currentState,
        resolvedTargetIds
      );
      affected = placementResult.affectedCardInstanceIds;
      coreDistributeNumericAmount = placementResult.numericAmount;
      nonCardResult = placementResult.numericAmount > 0;
      if (
        activeAction.from.kind === "non_life_normal_self" &&
        activeAction.amount === "all"
      ) {
        // 移動禁止コアは要求数から除かない。可能な分を置いたまま、全数未達なら
        // 「そうしたとき」だけ不発にする。独自管理コアと配置先自身は対象外。
        const required = collectNonLifeNormalCoreSources(
          preStateRef,
          actingPlayerId,
          resolvedTargetIds ?? [],
          getCardDefinitionById
        ).reduce((sum, source) => sum + source.remaining, 0);
        nonCardResult =
          nonCardResult && placementResult.numericAmount >= required;
      }
    }
    // コア選択はカード対象選択を経ない。実際にコアが増減したカードも step の結果へ
    // 記録し、after_triggers の消滅判定・cards_from_ref が同じ履歴を参照できるようにする。
    if (activeAction.kind === "core_move") {
      affected = [
        ...new Set([
          ...affected,
          ...getCoreMoveChangedCardIds(preStateRef, currentState),
        ]),
      ];
    }
    const coreMoveNumericAmount =
      activeAction.kind === "core_move"
        ? detectCoreMoveNumericAmount(
            preStateRef,
            currentState,
            activeAction,
            sourceInstanceId,
            actingPlayerId,
            resolvedTargetIds
          )
        : undefined;
    // borrow_magic_effect の「借用先マジックを通常使用として宣言できない」は、対象カード
    // 自体は選択済みでも payload を一切実行していない。一般の target action は選択済み
    // target を affected として返すが、ここを成功扱いすると `○○することで使用する`
    // の外側 conditional_cost が固定コストだけを支払ってしまう。借用側が残す宣言不能
    // reason を effect payload の失敗として扱い、既存の conditional_cost rollback に
    // 合流させる。
    const borrowMagicDeclarationFailed =
      activeAction.kind === "borrow_magic_effect" &&
      currentState.log
        .slice(preLogLength)
        .some((entry) =>
          /^(borrow_magic_effect:(?:no_eligible_effect|usage_limit_exhausted|magic_(?:use_restricted|flash_restricted|timing_scope_unmet|usage_limit_reached|registration_condition_unmet|source_zone_unavailable|declaration_unavailable))|reevaluation:before_each_step:failed:)/.test(
            entry
          )
        );
    const handGainPreventionBlocked = currentState.log
      .slice(preLogLength)
      .some((entry) =>
        /^effect:[^:]+:blocked-by-hand-gain-(?:prevention|cost):/.test(entry)
      );
    // 支払拒否では選択済み対象も移動していない。後続の「そうしたとき」や
    // cards_from_ref に回収成功を伝えない。
    if (handGainPreventionBlocked) affected = [];
    const stepSucceeded =
      borrowMagicDeclarationFailed || handGainPreventionBlocked
        ? false
        : nonCardResult !== null
          ? nonCardResult === true
          : affected.length > 0;
    if (
      activeAction.kind === "core_distribute" &&
      !stepSucceeded &&
      currentState.pendingCoreDistribution === null
    ) {
      const rebirthRollbackPatch = buildRebirthMinimumCoreRollbackPatch({
        chainId: options.chainId,
        action: activeAction,
        step,
        stepCtx,
        currentState,
        distributionTargets:
          resolvedTargetIds && resolvedTargetIds.length > 0
            ? resolvedTargetIds
            : [sourceInstanceId],
        actingPlayerId,
        getCardDefinitionById,
      });
      if (
        rebirthRollbackPatch?.priorStateSnapshot &&
        rebirthRollbackPatch.rollbackIfBelowMinTotal
      ) {
        if (rebirthRollbackPatch.rebirthCompletion) {
          const completion = rebirthRollbackPatch.rebirthCompletion;
          currentState = queuePendingLeave({
            state: {
              ...currentState,
              log: [
                ...currentState.log,
                `effect:core_distribute:rebirth-minimum-failed:no-pending:reason=${rebirthRollbackPatch.rollbackIfBelowMinTotal.reason}:placed=0<${rebirthRollbackPatch.rollbackIfBelowMinTotal.minTotal}`,
              ],
            },
            instanceId: completion.sourceInstanceId,
            kind: "vanish",
            cause: "effect_resolution",
            chainId: `effect:rebirth:${completion.sourceInstanceId}:lv-deficit`,
            causePlayerId: completion.actingPlayerId,
            deferZoneMoveUntilChainEnd: false,
            causedByEffectSourceInstanceId: completion.sourceInstanceId,
            resolvedSourceRegistrationKeys: [completion.sourceInstanceId],
          });
        } else {
          const restored = rebirthRollbackPatch.priorStateSnapshot;
          currentState = {
            ...restored,
            log: [
              ...restored.log,
              `effect:core_distribute:rollback:no-pending:reason=${rebirthRollbackPatch.rollbackIfBelowMinTotal.reason}:placed=0<${rebirthRollbackPatch.rollbackIfBelowMinTotal.minTotal}`,
            ],
          };
        }
        affected = [];
      }
    }
    // executed: action body が実際に走った事実を表す。succeeded が「破壊/影響を与えた」のに対し
    // executed は「対象選択・前提検査を抜けて action body が log/state 変化を残した」。
    // 「BP比べ破壊耐性」で破壊不発でも比較自体は走っていれば true。
    // 「効果を受けない」耐性で対象を選べず fail-closed return した場合は false。
    const stepExecuted =
      !handGainPreventionBlocked &&
      (stepSucceeded || currentState.log.length > preLogLength);
    const blockedByRestriction = currentState.log
      .slice(preLogLength)
      .some(isEndRestrictionBlockLog);
    const endRestrictionCheck = getEndRestrictionCheckForAction(activeAction);
    const blockedByOpponentEffect =
      blockedByRestriction &&
      endRestrictionCheck !== null &&
      hasActiveOpponentEndRestriction(
        preStateRef,
        actingPlayerId,
        endRestrictionCheck.tags,
        endRestrictionCheck.unaffectedByRestriction
      );
    currentState = appendPublicDisclosuresForEffectStepTransition({
      before: preStateRef,
      after: currentState,
      actorPlayerId: actingPlayerId,
      action: activeAction,
      sourceInstanceId: effectSourceInstanceId,
      effectIndex,
      ...(provenance.definitionPath !== undefined
        ? { definitionPath: provenance.definitionPath }
        : {}),
      targetInstanceIds: publicTargetIds,
    });
    recordStepResult(stepCtx, {
      stepId: step.id ?? `__step_${i}`,
      affectedCardInstanceIds: affected,
      establishedLeaveKindsByCardId: collectEstablishedLeaveOutcomes(
        preStateRef,
        currentState
      ),
      ...(activeAction.kind === "bp_modify"
        ? {
            bpBecameZeroCardInstanceIds: dedupePreserveOrder(bpBecameZeroIds),
          }
        : {}),
      // deck_reveal が pending を経ずに同期完了した場合 (revealed 0枚 / pick 無し等) の
      // 「実際に手札へ加わったカード」記録。非同期 pending 経路は継続注入ブロックが
      // 別途 recordStepId で事後設定する (ENGINE-deck-reveal-hand-added-tracking)。
      ...(activeAction.kind === "deck_reveal"
        ? {
            handAddedCardInstanceIds: affected.filter((id) => {
              const inst = currentState.cardInstances.find(
                (c) => c.instanceId === id
              );
              return inst?.zone === "hand";
            }),
          }
        : {}),
      // 状態変化を厳密に検出できるアクションは nonCardResult を唯一の指標にする。
      // (resolvedTargetIds が選択されていても、実際に state が変わらなければ失敗扱い。
      //  conditional_cost ロールバックを正しく発動させるために必須。)
      // それ以外（zone 変化が主なアクション）は affected.length > 0 をフォールバック判定。
      succeeded: stepSucceeded,
      executed: stepExecuted,
      ...(blockedByOpponentEffect ? { blockedByOpponentEffect } : {}),
      // DynamicCountSource.step_numeric_amount から後続 step が参照する実際の変動量
      // (ENGINE-cost-modify-additional-cost-value-dynamic-amount)。要求量
      // (action.amount 解決値) ではなく countValue の実差分を使う。保護カウント/床値
      // (0未満不可) による clamp 後の「実際に減った/増えた量」を正しく反映するため。
      ...(activeAction.kind === "count_decrease" ||
      activeAction.kind === "count_increase"
        ? {
            numericAmount: Math.abs(
              preStateRef.players.reduce((sum, p) => {
                const post = currentState.players.find((pp) => pp.id === p.id);
                return (
                  sum + ((post?.countValue ?? p.countValue) - p.countValue)
                );
              }, 0)
            ),
          }
        : {}),
      // destroy: 「この効果で破壊した対象N体につき」型 (BSSG01-X04) のスケール源。
      // affected は上で detectActuallyDestroyedTargetIds に既に絞り込み済み
      // (耐性/防止で不発だった対象を含まない実際の破壊数)。
      ...(activeAction.kind === "destroy"
        ? { numericAmount: affected.length }
        : {}),
      // move_card: 「手元に置いたカード1枚につき」型 (BSTH08.5-R12) のスケール源。
      // 「好きなだけ」選択で実際に移動した枚数 (affected は zone 変化検出済み) を
      // 後続 draw 等が step_numeric_amount で参照する (ENGINE-move-card-actual-count-amount)。
      ...(activeAction.kind === "move_card"
        ? { numericAmount: affected.length }
        : {}),
      ...(coreDistributeNumericAmount !== undefined
        ? { numericAmount: coreDistributeNumericAmount }
        : {}),
      ...(coreMoveNumericAmount !== undefined
        ? { numericAmount: coreMoveNumericAmount }
        : {}),
      ...(activeAction.kind === "rebirth"
        ? {
            stateSnapshot: preStateRef,
            ...(activeAction.allowPostRebirthCorePlacementForLvDeficit === true
              ? { rebirthDefersCompletion: true }
              : {}),
            ...(activeAction.countBonusMode !== undefined
              ? { rebirthCountBonusMode: activeAction.countBonusMode }
              : {}),
          }
        : {}),
      ...(recordedChoiceIndex !== undefined
        ? { chosenChoiceIndex: recordedChoiceIndex }
        : {}),
    });
    clearPendingConditionalCostRollbackIfAlternativeSucceeded(stepCtx, step, i);
    if (
      (actionTargetIds && resolvedTargetIds && resolvedTargetIds.length > 0) ||
      (options.targetSelectionResolved === true &&
        actionTargetIds !== undefined &&
        resolvedTargetIds !== undefined)
    ) {
      if (shouldConsumeTargetsSequentially) {
        for (const targetIndex of sequentialTargetSelection?.indexes ?? []) {
          cursors.sequentialTargetIndexesConsumed.add(targetIndex);
        }
        cursors.targetIdsCursor += actionTargetIds.length;
        cursors.targetIdsConsumed =
          cursors.sequentialTargetIndexesConsumed.size >=
          (options.targetInstanceIds?.length ?? 0);
      } else {
        cursors.targetIdsConsumed = true;
      }
    }
    // P3-62 ケース 4: conditional_cost の効果側 (△△) 失敗 → 全体ロールバック
    //   公式 Q5「○○することで△△する」: △△できないとき○○も発揮できない。
    //   stepCtx.originalState は cost step (前ステップ) 直前のスナップショット。
    if (step.connector === "conditional_cost" && !stepSucceeded) {
      // rollback は状態だけを支払い前へ戻す。ここで効果側が残した宣言不能理由まで
      // 捨てると、通常マジックの gate（usage / restrict / timingScope 等）がなぜ
      // 不成立だったか追跡できない。対象アクションの実行中に増えたログだけを退避し、
      // rollback 後の診断として残す。
      const conditionalCostFailureEntries =
        currentState.log.slice(preLogLength);
      if (
        !maybeDeferConditionalCostRollback({
          step,
          stepCtx,
          sourceInstanceId,
          failureLogEntries: [
            `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
          ],
        })
      ) {
        currentState = stepCtx.originalState;
        if (
          options.recordedUsage &&
          shouldRefundRecordedUsageForConditionalCostRollback(stepCtx)
        ) {
          currentState = refundAllRecordedUsage(
            currentState,
            sourceInstanceId,
            options.recordedUsage
          );
        }
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            ...conditionalCostFailureEntries,
            `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
          ],
        };
      }
    }
    if (hasRuleBraveSeparationChoice(currentState)) {
      const continuationOptions = { ...options };
      if (
        ruleSeparationRepeatResume &&
        step.targetSelectionTiming === "on_step"
      ) {
        // The completed activation's targets must not satisfy the next
        // activation's on-step choice after the rule cleanup has drained.
        delete continuationOptions.targetInstanceIds;
        delete continuationOptions.targetStepId;
        delete continuationOptions.targetSelectionResolved;
      }
      const continuation = buildEffectBodyContinuation({
        state: currentState,
        effect,
        effectIndex,
        stepIndex: ruleSeparationRepeatResume ? i : i + 1,
        options: continuationOptions,
        stepCtx,
        targetIdsConsumed: cursors.targetIdsConsumed,
        effectSourceDefinitionId,
        resumePreviousStepPreState: preStateRef,
        ...(ruleSeparationRepeatResume
          ? { repeatResume: ruleSeparationRepeatResume }
          : {}),
      });
      return {
        kind: "return",
        state: withRuleBraveSeparationContinuation(currentState, continuation),
      };
    }
    return { kind: "continue", state: currentState };
  }
  // 未対応アクションをスキップし、succeeded=false として記録
  currentState.log.push(`effect:unsupported-action:${step.action.kind}`);
  recordStepResult(stepCtx, {
    stepId: step.id ?? `__step_${i}`,
    affectedCardInstanceIds: [],
    succeeded: false,
  });
  // P3-62 ケース 4: 未対応 action でも conditional_cost effect step なら rollback
  if (step.connector === "conditional_cost") {
    if (
      !maybeDeferConditionalCostRollback({
        step,
        stepCtx,
        sourceInstanceId,
        failureLogEntries: [
          `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
        ],
      })
    ) {
      currentState = stepCtx.originalState;
      if (
        options.recordedUsage &&
        shouldRefundRecordedUsageForConditionalCostRollback(stepCtx)
      ) {
        currentState = refundAllRecordedUsage(
          currentState,
          sourceInstanceId,
          options.recordedUsage
        );
      }
    }
  }
  return { kind: "proceed", state: currentState };
}

/** CardFilter → RetriggerTriggerFilter 変換 */
function convertCardFilterToTriggerFilter(
  filter: CardFilter
): RetriggerTriggerFilter {
  return { ...filter };
}

/** Effect の effects 配列内インデックスを逆引き */
function findEffectIndex(
  effect: Effect,
  sourceInstanceId: string,
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  const card = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!card) return 0;
  const def = getCardDefinitionById(card.definitionId);
  if (!def?.effects) return 0;
  const idx = def.effects.indexOf(effect);
  return idx >= 0 ? idx : 0;
}

export function expireCurrentEffectContinuousEffects(
  state: GameState,
  sourceInstanceId: string,
  effectIndex?: number
): GameState {
  const activeContinuousEffects = state.activeContinuousEffects.filter((ce) => {
    if (ce.duration.scope !== "current_effect") return true;
    if (ce.sourceInstanceId !== sourceInstanceId) return true;
    if (effectIndex === undefined) return false;
    return ce.provenance?.effectIndex !== undefined
      ? ce.provenance.effectIndex !== effectIndex
      : false;
  });
  if (activeContinuousEffects.length === state.activeContinuousEffects.length) {
    return state;
  }
  return applyLifeZeroDefeat({
    ...state,
    activeContinuousEffects,
  });
}

/**
 * ENGINE-soul-drive-departure-prevention-immunity: `executeEffectInner` が
 * `pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds` へ自分の
 * `sourceInstanceId` を追加した場合、この呼び出しが**中断を挟まず完全に解決し終えた**時点で
 * 自分自身の instanceId だけを取り除く。`after_triggers` 連鎖中に対象自身の
 * (mandatory な) leave_field 反応が絡むと、実際の誘発解決は外側のチェーン解決パイプライン
 * (`runActionMainResolution` 等) に委ねられ、`executeEffectInner` は
 * `pendingAfterTriggersContinuations` を残して一旦 return し、後で `executeEffect` が
 * 同じ sourceInstanceId で resume 呼び出しされる (adversarial verifier 2026-07-21 で実測、
 * X09 相当の複数対象効果で2体目以降が stay_on_field を貫通できない実バグとして発覚)。
 * `hasOutstandingEffectResolutionContinuation` が true の間 (= まだ resume が続く) は
 * クリアせず、真に完了した resume 呼び出しの return でだけ取り除く。
 * early return を含む全ての `executeEffectInner` の return path を個別に修正せず、
 * 公開 API 側で一括して後始末する。
 */
export function executeEffect(options: ExecuteEffectOptions): GameState {
  requireTriggerChainId(options.chainId);
  if (options.state.gameResult !== null) return options.state;
  // All input continuations share the same interaction policy, including
  // choices after optional steps, target selection and nested stack resolution.
  if (options.restoredStepContext?.promptUnresolvedChoice === true)
    options = { ...options, promptUnresolvedChoice: true };
  const effectIndex =
    options.effectIndex ??
    findEffectIndex(
      options.effect,
      options.sourceInstanceId,
      options.state,
      options.getCardDefinitionById
    );
  let result = executeEffectInner(options);
  const effectComplete = !hasOutstandingEffectResolutionContinuation(result);
  if (
    result.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds?.includes(
      options.sourceInstanceId
    ) &&
    effectComplete
  ) {
    result = {
      ...result,
      pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds:
        result.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds.filter(
          (id) => id !== options.sourceInstanceId
        ),
    };
  }
  if (effectComplete && options.deferCurrentEffectCleanup !== true) {
    result = expireCurrentEffectContinuousEffects(
      result,
      options.sourceInstanceId,
      effectIndex
    );
  }
  return result;
}

function executeEffectInner(options: ExecuteEffectOptions): GameState {
  const { triggeredRootConditionResults, ...childOptions } = options;
  options = childOptions;
  let currentState: GameState = {
    ...options.state,
    log: [...options.state.log],
  };
  const { sourceInstanceId, actingPlayerId, getCardDefinitionById } = options;
  const baseEffect = withCoreMoveDestinationChoices(
    options.effect,
    currentState,
    resolveAffectSourceIdentity({ ...options, state: currentState }).instanceId,
    actingPlayerId
  );
  const effect =
    options.startFromStepIndex !== undefined ||
    options.restoredStepContext !== undefined
      ? baseEffect
      : withRequiredEffectCost(
          currentState,
          baseEffect,
          currentState.cardInstances.find(
            (c) => c.instanceId === sourceInstanceId
          ),
          actingPlayerId,
          getCardDefinitionById,
          options.effectEventAction
        );
  if (effect !== options.effect)
    options = { ...options, effect, promptUnresolvedChoice: true };
  const initialSourceCard = currentState.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  const initialSourceDefinition = getCardDefinitionById(
    initialSourceCard?.definitionId ?? ""
  );
  const rewriteSourceCard = options.effectSourceInstanceId
    ? getCardById(currentState, options.effectSourceInstanceId)
    : initialSourceCard;
  const rewriteSourceDefinition = getCardDefinitionById(
    options.effectSourceDefinitionId ?? rewriteSourceCard?.definitionId ?? ""
  );
  if (initialSourceCard && initialSourceDefinition && rewriteSourceDefinition) {
    const rewriteStatus = getBraveSelfReferenceRewriteStatus({
      state: currentState,
      sourceCard: initialSourceCard,
      sourceDefinition: initialSourceDefinition,
      sourceEffectDefinition: rewriteSourceDefinition,
      ...(options.effectSourceInstanceId !== undefined
        ? { sourceEffectInstanceId: options.effectSourceInstanceId }
        : {}),
      effect,
      getCardDefinitionById,
    });
    if (
      rewriteStatus === "blocked" ||
      (effect.timing.kind === "continuous" &&
        rewriteStatus === "allowed_optional")
    ) {
      return currentState;
    }
  }
  const effectSourceDefinitionIdAtStart =
    options.effectSourceDefinitionId ??
    initialSourceDefinition?.cardNo ??
    initialSourceCard?.definitionId ??
    "";
  const effectResolutionBeforeState =
    options.effectResolutionBeforeState ??
    cloneStateForTriggerDelta(currentState);

  // P3-43 producer: 攻撃側の防止レベルは明示 option 最優先 → 効果 DSL から SSOT 導出。
  // preventionLevelCondition の解決時不成立で無効化する分岐まで helper に集約。
  const resolvedPreventionLevel = resolveEffectSourcePreventionLevel(
    options,
    currentState,
    getCardDefinitionById
  );
  const effectSourcePreventionLevel = resolvedPreventionLevel.level;
  // BSLH01-C07「ターンの最初の1回」: soulDriveDeparture bypass が実際に level を
  // 昇格させたときだけ、grant 元 CE (quartz) の usageLimit を消費する
  // (recordEffectUsageIfLimited、effectLabel 固定 "grant_effect_source_prevention_immunity"。
  // getSoulDriveDeparturePreventionBypass 自体は読み取り専用のため消費はここで行う)。
  if (resolvedPreventionLevel.soulDriveConsumption) {
    const {
      sourceInstanceId: grantSourceInstanceId,
      sourceDefinitionId,
      usageLimit: soulDriveUsageLimit,
    } = resolvedPreventionLevel.soulDriveConsumption;
    currentState = recordEffectUsageIfLimited({
      state: currentState,
      sourceInstanceId: grantSourceInstanceId,
      sourceDefinitionId,
      effectLabel: "grant_effect_source_prevention_immunity",
      usageLimit: soulDriveUsageLimit,
    });
    // destroy 以外 (core_move→trash によるコア不足消滅 SBA、X09型) の stay_on_field 貫通は
    // runStateBasedActions 側で sourceInstanceId 一致を条件に反映する (model.ts 参照)。
    // クリアは末尾の executeEffect wrapper が自分の sourceInstanceId だけ取り除く。
    if (
      !currentState.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds?.includes(
        sourceInstanceId
      )
    ) {
      currentState = {
        ...currentState,
        pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: [
          ...(currentState.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds ??
            []),
          sourceInstanceId,
        ],
      };
    }
  }
  const dynamicPreventionSourceInstanceId = resolveAffectSourceIdentity({
    state: currentState,
    sourceInstanceId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  }).instanceId;
  const { conditionSourceInstanceId, conditionSourceContext } =
    resolveEffectConditionSourceEvaluation({
      state: currentState,
      sourceInstanceId,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });
  const effectSourceNegatePreventionLevel =
    resolveDynamicStackNegatePreventionLevel({
      state: currentState,
      sourceInstanceId: dynamicPreventionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
    });
  const effectPreventionProfile = derivePreventionProfile(effect);
  const effectPreventionRestrictionBypass =
    effectPreventionProfile?.targetLockBypass;
  const dynamicEffectSourcePreventionBypass =
    getEffectSourceTribePreventionBypass(
      currentState,
      dynamicPreventionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById
    );
  const dynamicEffectClassSourcePreventionBypass =
    getEffectClassSourcePreventionBypass(
      currentState,
      effect,
      dynamicPreventionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById
    );
  const effectSourcePreventionBypass = mergeTargetLockBypassProfiles(
    mergeTargetLockBypassProfiles(
      mergeTargetLockBypassProfiles(
        effectPreventionRestrictionBypass,
        dynamicEffectSourcePreventionBypass
      ),
      dynamicEffectClassSourcePreventionBypass
    ),
    options.sourcePreventionBypass
  );
  // P3-150: grant_effect_source_prevention_immunity / tribe grant 由来の
  // 動的 bypass は affect immunity 軸 (effectSourcePreventionBypass) にのみ
  // merge されており、target lock 軸には届いていなかった (BSTH05.5-M01 の
  // 「一切の効果で防げない」が cost_destroy の explicit target acquisition を
  // 貫通しない wiring gap)。preventionBypass 省略時のデフォルト
  // {kind:"all_effects"} は両軸貫通を意図するため、affect immunity 軸と
  // 同型の merge をここにも適用する。
  const effectSourceTargetLockBypass = mergeTargetLockBypassProfiles(
    mergeTargetLockBypassProfiles(
      mergeTargetLockBypassProfiles(
        effectPreventionRestrictionBypass,
        dynamicEffectSourcePreventionBypass
      ),
      dynamicEffectClassSourcePreventionBypass
    ),
    options.sourceTargetLockBypass
  );

  // 生成される CE の provenance に格納する effectIndex。
  // options で明示されていればそれを使い、なければカード定義から逆引きする。
  const effectIndex =
    options.effectIndex ??
    findEffectIndex(
      effect,
      sourceInstanceId,
      currentState,
      getCardDefinitionById
    );

  // --- deferredTo: "battle_end" の予約インターセプト ---
  const battleEndDeferral = interceptBattleEndDeferral(
    options,
    currentState,
    effectIndex
  );
  if (battleEndDeferral) return battleEndDeferral;

  const battleEndDeferralSourceAtEffectStart = currentState.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  const stepBattleEndDeferralActivationZone =
    battleEndDeferralSourceAtEffectStart !== undefined
      ? getBattleEndDeferralActivationZone(
          battleEndDeferralSourceAtEffectStart,
          options.activationZone
        )
      : undefined;
  const stepBattleEndDeferralSourceOnFieldRequired =
    battleEndDeferralSourceAtEffectStart !== undefined
      ? isBattleEndDeferralSourceOnFieldRequired(
          battleEndDeferralSourceAtEffectStart,
          options.activationZone
        )
      : true;
  const stepBattleEndDeferralEffectSourceOnFieldRequired =
    isBattleEndDeferralEffectSourceOnFieldRequired({
      state: currentState,
      sourceInstanceId,
      sourceOnFieldRequired: stepBattleEndDeferralSourceOnFieldRequired,
      ...(options.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: options.effectSourceInstanceId }
        : {}),
      ...(options.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });

  // --- Applicability 評価 ---
  // 先頭ステップの選択も含め、保存済み解決コンテキストからの resume は再評価しない。
  // pending 解決経由の再呼び出しでは初回の applicability チェックで gate 済みであり、
  // 中間ステップで Lv / zone が変わっても resume を中断すべきではない (例: P3-47 フランドール
  // step1 で deck → field に 3 枚移動 → effect.condition の `field_has zone=deck minCount=3` が
  // 後発的に unmet になる)。
  const isResume =
    options.startFromStepIndex !== undefined &&
    (options.startFromStepIndex > 0 ||
      options.restoredStepContext !== undefined);
  if (effect.applicability && !isResume) {
    const applicabilityState =
      options.applicabilityEvaluationZone === "field"
        ? getOperationMagicFieldApplicabilityEvaluationState(
            currentState,
            effect,
            sourceInstanceId
          )
        : getApplicabilityEvaluationState(
            currentState,
            effect,
            sourceInstanceId,
            options.activationZone
          );
    const applicabilitySourceInstanceId =
      resolveEffectApplicabilitySourceInstanceId({
        state: applicabilityState,
        sourceInstanceId,
        ...(options.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: options.effectSourceInstanceId }
          : {}),
        ...(options.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
          : {}),
        getCardDefinitionById,
      });
    if (
      !evaluateApplicability(
        applicabilityState,
        effect.applicability,
        applicabilitySourceInstanceId,
        getCardDefinitionById
      )
    ) {
      currentState.log.push(`effect:applicability-unmet:${sourceInstanceId}`);
      return currentState;
    }
  }

  // 効果全体と途中再開した各stepで同じイベント文脈を評価する。
  const triggerContext =
    options.battleEndDeferralWasBlocked !== undefined ||
    options.battleEndDeferralLifeReduced !== undefined ||
    options.triggerCause !== undefined ||
    options.triggerFromZone !== undefined ||
    options.triggerRelatedInstanceZone !== undefined ||
    options.triggerSourceTribes !== undefined ||
    options.triggerSourcePlayerId !== undefined ||
    options.triggerSourceInstanceId !== undefined
      ? {
          ...(options.triggerCause !== undefined
            ? { cause: options.triggerCause }
            : {}),
          ...(options.battleEndDeferralWasBlocked !== undefined
            ? { battleWasBlocked: options.battleEndDeferralWasBlocked }
            : {}),
          ...(options.battleEndDeferralLifeReduced !== undefined
            ? { battleLifeReduced: options.battleEndDeferralLifeReduced }
            : {}),
          ...(options.triggerFromZone !== undefined
            ? { fromZone: options.triggerFromZone }
            : {}),
          ...(options.triggerRelatedInstanceZone !== undefined
            ? { relatedInstanceZone: options.triggerRelatedInstanceZone }
            : {}),
          ...(options.triggerSourceTribes !== undefined
            ? { sourceTribes: options.triggerSourceTribes }
            : {}),
          ...(options.triggerSourcePlayerId !== undefined
            ? { sourcePlayerId: options.triggerSourcePlayerId }
            : {}),
          ...(options.triggerSourceInstanceId !== undefined
            ? { sourceInstanceId: options.triggerSourceInstanceId }
            : {}),
        }
      : options.restoredStepContext?.triggerContext;
  // --- Condition 評価 ---
  if (effect.condition && effect.condition.length > 0 && !isResume) {
    const condMet = evaluateCondition(
      currentState,
      applyTriggerConditionResults(
        effect.condition,
        triggeredRootConditionResults
      ),
      conditionSourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
      triggerContext,
      conditionSourceContext
    );
    if (!condMet) {
      currentState.log.push(`effect:condition-unmet:${sourceInstanceId}`);
      // P3-62 ケース 2: 「のとき」条件が解決時に false 化 → 発揮できません
      //   → 宣言時に記録した usageLimit を払い戻す (page14 一般則)。
      if (options.recordedUsage) {
        currentState = refundAllRecordedUsage(
          currentState,
          sourceInstanceId,
          options.recordedUsage
        );
      }
      return currentState;
    }
  }

  // --- 継続効果 no_duplicate チェック (P3-20 ギャップ A) ---
  if (isContinuousNoDuplicateSkip(options, currentState, effectIndex)) {
    currentState.log.push(
      `effect:no-duplicate-skipped:${sourceInstanceId}:${effectIndex}`
    );
    return currentState;
  }

  // --- StepExecutionContext ---
  const stepCtx = options.restoredStepContext
    ? deserializeStepContext(options.restoredStepContext, currentState)
    : createStepExecutionContext(currentState);
  stepCtx.disclosureStartSequence ??=
    currentState.publicDisclosures?.at(-1)?.sequence ?? 0;
  applyExecuteOptionsToStepContext(stepCtx, options);
  if (triggerContext) stepCtx.triggerContext = triggerContext;
  for (const result of options.initialStepResults ?? []) {
    recordStepResult(stepCtx, result);
  }
  const steps = effect.steps;
  // optional repeat の選択回数は、前段の「対象数ぶんカウントを減らす」コストだけが
  // 件数として参照する。対象 ID を複製して先取りすると反復ごとの再選択を失うため、
  // StepExecutionContext には件数 override だけを残す。
  if (options.optionalRepeatTargetCount !== undefined) {
    const repeatStepCandidates = steps.flatMap((step, stepIndex) => {
      const stepId = step.id ?? `__step_${stepIndex}`;
      return step.targetSelectionTiming === "on_step" &&
        step.repeat?.optional === true &&
        (options.targetStepId === undefined || stepId === options.targetStepId)
        ? [{ stepId }]
        : [];
    });
    // targetStepId を持つ経路を優先する。旧い battle-immediate registration のように
    // 同一 effect に対象選択 step が 1 つだけのときは、その一意な step へ件数を
    // 紐付けて targeted-disclosure 等の中断をまたいでも保持する。
    if (repeatStepCandidates.length === 1) {
      stepCtx.selectedTargetCountOverrides = {
        ...(stepCtx.selectedTargetCountOverrides ?? {}),
        [repeatStepCandidates[0]!.stepId]: options.optionalRepeatTargetCount,
      };
    }
  }
  const startIndex = options.startFromStepIndex ?? 0;
  // 「効果発揮後」の派生解決境界か本文末で、発揮した処理種別を通知する。
  // 同じ本文の複数破壊stepやpending再開でも、破壊発揮の通知は一度だけ。
  const queueResolvedActions = (
    state: GameState,
    chainId: string | null
  ): GameState => {
    const kinds = (stepCtx.resolvedActionKinds ?? []).filter(
      (kind) => !stepCtx.reportedActionKinds?.includes(kind)
    );
    if (
      !kinds.length ||
      effect.timing.kind === "continuous" ||
      typeof options.getRegisteredTriggeredEffectActions !== "function"
    )
      return state;
    stepCtx.reportedActionKinds = [
      ...(stepCtx.reportedActionKinds ?? []),
      ...kinds,
    ];
    return queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          eventKind: "effect_steps_resolved",
          actingPlayerId,
          relatedPlayerId: actingPlayerId,
          relatedInstanceId: options.effectSourceInstanceId ?? sourceInstanceId,
          source: "action_resolution",
          chainId,
          attackId: state.activeAttack?.attackId ?? null,
          amount: null,
          resolvedActionKinds: kinds,
        },
      ],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }
    );
  };
  if (
    stepCtx.resolutionSegmentBeforeState === undefined &&
    steps.some((step) => step.connector === "after_triggers")
  ) {
    stepCtx.resolutionSegmentBeforeState =
      cloneStateForTriggerDelta(currentState);
  }
  // step ループ横断の可変 cursor。helper へ参照渡しして in-place 更新する（P2-13 inc5）。
  const cursors: {
    targetIdsConsumed: boolean;
    targetIdsCursor: number;
    sequentialTargetIndexesConsumed: Set<number>;
    previousStepPreState: GameState | null;
    previousStepId: string | null;
  } = {
    targetIdsConsumed: false,
    targetIdsCursor: 0,
    sequentialTargetIndexesConsumed: new Set<number>(),
    // after_triggers コネクタ用: 直前に action を実行した step の pre-state スナップショット
    previousStepPreState:
      options.resumePreviousStepPreState !== undefined
        ? cloneStateForTriggerDelta(options.resumePreviousStepPreState)
        : null,
    previousStepId: null,
  };
  const groupedTargetAllocation =
    options.targetInstanceIds !== undefined &&
    options.targetGroups !== undefined &&
    options.targetGroups.length > 0
      ? allocateGroupedTargetsByStep({
          targetInstanceIds: options.targetInstanceIds,
          targetGroups: options.targetGroups,
        })
      : null;
  const groupedTargetIdsByStepId = groupedTargetAllocation?.idsByStepId ?? null;
  const groupedTargetIndexesByStepId =
    groupedTargetAllocation?.indexesByStepId ?? null;
  if (groupedTargetIdsByStepId !== null) {
    const byStepId: Record<string, string[]> = {};
    for (const [stepId, ids] of groupedTargetIdsByStepId) {
      byStepId[stepId] = [...ids];
    }
    stepCtx.selectedTargetInstanceIdsByStepId = byStepId;
  } else if (options.targetInstanceIds !== undefined) {
    delete stepCtx.selectedTargetInstanceIdsByStepId;
  }

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i]!;
    // pending チェック: 未解決の選択があればプレイヤー応答待ちで step ループを中断
    if (hasBlockingPendingSelection(currentState)) break;

    // Capture even when the cost will be skipped (for example, an optional
    // selection had no candidate). Rolling back that unattempted tail must not
    // undo the independent prefix. Consecutive conditional results share the
    // first cost's snapshot, including across serialized input continuations.
    // A connector on the first step has no predecessor; it still starts a cost.
    if (
      steps[i + 1]?.connector === "conditional_cost" &&
      (i === 0 || step.connector !== "conditional_cost")
    ) {
      stepCtx.originalState = { ...currentState, log: [...currentState.log] };
      stepCtx.conditionalCostSnapshotHadPriorSuccess = Array.from(
        stepCtx.results.values()
      ).some((result) => result.succeeded);
    }

    // --- step 単位 deferTo: "battle_end" の予約インターセプト ---
    const stepBattleEndDeferral = interceptStepBattleEndDeferral(
      step,
      options,
      currentState,
      stepCtx,
      effectIndex,
      i,
      stepBattleEndDeferralActivationZone,
      stepBattleEndDeferralSourceOnFieldRequired,
      stepBattleEndDeferralEffectSourceOnFieldRequired
    );
    if (stepBattleEndDeferral) {
      currentState = stepBattleEndDeferral;
      break;
    }

    // conditional_cost の分岐が解決時に不成立ならスキップ（前 step 成否で rollback しない）。
    if (shouldSkipConditionalCostStep(step, stepCtx, currentState, options)) {
      // An unselected first tier does not release a paid outer cost. Wait for
      // another declared result tier, then refund if none actually succeeds.
      maybeDeferConditionalCostRollback({
        step,
        stepCtx,
        sourceInstanceId,
        failureLogEntries: [
          `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
        ],
      });
      continue;
    }

    // --- Connector セマンティクス ---
    if (
      step.connector &&
      (i > startIndex || cursors.previousStepPreState !== null)
    ) {
      const connectorResult = handleConnector(
        step.connector,
        i,
        steps,
        stepCtx,
        currentState,
        cursors.previousStepPreState,
        cursors.previousStepId,
        sourceInstanceId,
        actingPlayerId,
        getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions ?? (() => []),
        options.chainId ?? null,
        step
      );
      // rollbackState は skip より先に処理する。conditional_cost コスト失敗時に
      // 連結ハンドラは {skip: true, rollbackState} を返すため、ここで rollback +
      // usageLimit refund を必ず適用する (P3-62 ケース 4 コスト側)。
      if (connectorResult.rollbackState) {
        // conditional_cost: 前ステップのスナップショットに戻す
        currentState = connectorResult.rollbackState;
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:conditional-cost-effect-failed:${sourceInstanceId}`,
          ],
        };
        // P3-62 ケース 4: コスト支払い失敗で rollback 発火 → 「○○することで△△する」の
        //   ○○ が完遂しなかったため発揮できません。usageLimit も払い戻す。
        if (
          options.recordedUsage &&
          shouldRefundRecordedUsageForConditionalCostRollback(stepCtx)
        ) {
          currentState = refundAllRecordedUsage(
            currentState,
            sourceInstanceId,
            options.recordedUsage
          );
        }
      }
      if (connectorResult.skip) continue;
      if (connectorResult.mutatedState) {
        // after_triggers: SBA + CE 再計算 + 誘発キュー化 + pending leave flush を反映
        currentState = connectorResult.mutatedState;
      }
      if (connectorResult.afterTriggersChainId !== undefined) {
        currentState = queueResolvedActions(
          currentState,
          connectorResult.afterTriggersChainId ?? null
        );
        // この区間の誘発は収集済み。継続を保存する前に消費し、反応解決後から次区間を始める。
        delete stepCtx.resolutionSegmentBeforeState;
        if (
          typeof options.getRegisteredTriggeredEffectActions === "function" &&
          connectorResult.afterTriggersChainId !== undefined &&
          hasAfterTriggersResumeWork(
            currentState,
            connectorResult.afterTriggersChainId
          )
        ) {
          const continuation = buildAfterTriggersContinuation({
            state: currentState,
            effect,
            effectIndex,
            stepIndex: i,
            waitChainId: connectorResult.afterTriggersChainId,
            options,
            stepCtx,
            targetIdsConsumed: cursors.targetIdsConsumed,
            effectResolutionBeforeState,
          });
          currentState = {
            ...currentState,
            pendingAfterTriggersContinuations: [
              ...currentState.pendingAfterTriggersContinuations,
              continuation,
            ],
            log: [
              ...currentState.log,
              `effect:after_triggers:continuation-pending:${continuation.continuationId}`,
            ],
          };
          return currentState;
        }
        stepCtx.resolutionSegmentBeforeState =
          cloneStateForTriggerDelta(currentState);
      }
    }

    if (hasRuleBraveSeparationChoice(currentState)) {
      return withRuleBraveSeparationContinuation(
        currentState,
        buildEffectBodyContinuation({
          state: currentState,
          effect,
          effectIndex,
          stepIndex: i,
          options,
          stepCtx,
          targetIdsConsumed: cursors.targetIdsConsumed,
          effectSourceDefinitionId: effectSourceDefinitionIdAtStart,
        })
      );
    }

    const stepChoiceOutcome = handleStepChoiceSelection({
      effect,
      step,
      stepIndex: i,
      options,
      stepCtx,
      currentState,
      targetIdsConsumed: cursors.targetIdsConsumed,
      effectIndex,
      conditionSourceInstanceId,
      conditionSourceContext,
      triggerContext,
      effectSourceTargetLockBypass,
      effectSourcePreventionLevel,
      effectSourcePreventionBypass,
    });
    currentState = stepChoiceOutcome.state;
    if (stepChoiceOutcome.kind === "return") return currentState;
    if (stepChoiceOutcome.kind === "continue") continue;

    // --- Choice 解決: step.choice がある場合、choiceIndex に基づいてアクティブなステップを選択 ---
    let activeAction = step.action;
    let activeCondition = step.condition;
    let activeChooser: import("../dsl-types").PlayerRef | undefined =
      step.chooser;
    if (
      step.choice &&
      step.choice.length > 0 &&
      options.choiceIndex !== undefined
    ) {
      if (
        options.choiceIndex > 0 &&
        options.choiceIndex <= step.choice.length
      ) {
        const chosenStep = step.choice[options.choiceIndex - 1]!;
        activeAction = chosenStep.action;
        activeCondition = chosenStep.condition ?? undefined;
        // choice variant の chooser は variant 単位で上書き可
        // (tryBuildStepOptionalTargetSelection §8537 と同 SSOT)。
        if (chosenStep.chooser !== undefined) {
          activeChooser = chosenStep.chooser;
        }
      }
      // choiceIndex === 0: デフォルト action を使用（activeAction はそのまま）
    }
    activeAction = applyOptionalStepQuantityOverride(
      activeAction,
      options.optionalStepQuantityOverride,
      i
    );
    activeAction = applyDeckRevealCountBoostResumeBonus(
      activeAction,
      options.resolvedDeckRevealCountBoost,
      i
    );

    // --- ステップレベル条件 ---
    if (activeCondition && activeCondition.length > 0) {
      const condMet = evaluateCondition(
        currentState,
        activeCondition,
        conditionSourceInstanceId,
        actingPlayerId,
        getCardDefinitionById,
        triggerContext,
        conditionSourceContext
      );
      if (!condMet) {
        // P3-62 ケース2 と同型: この時点でまだどの step も成功していなければ
        // （宣言時に選んだ choice variant の条件が解決時に false 化した等）、
        // 発揮できなかった扱いとして宣言時記録済み usageLimit を払い戻す。
        // 既に他 step が成功済みなら「効果は活性化した」ので払い戻さない
        // (BSTH01.ts choice[0] 等、既存 usageLimit+condition 併用 variant と同型ギャップ)。
        if (
          options.recordedUsage &&
          !Array.from(stepCtx.results.values()).some(
            (result) => result.succeeded
          )
        ) {
          currentState = refundAllRecordedUsage(
            currentState,
            sourceInstanceId,
            options.recordedUsage
          );
        }
        continue;
      }
    }

    // --- StepCondition ---
    if (step.stepCondition) {
      if (
        !evaluateStepCondition(
          step.stepCondition,
          stepCtx,
          currentState,
          getCardDefinitionById
        )
      ) {
        continue;
      }
    }

    // --- Step-level optional execution mode: pause for player execute/decline choice ---
    const optionalSourceCardReferenceInstanceId =
      resolveSourceCardReferenceInstanceId({
        state: currentState,
        sourceInstanceId,
        ...(options.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                options.sourceCardReferenceInstanceId,
            }
          : {}),
        ...(options.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: options.effectSourceInstanceId }
          : {}),
        ...(options.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
          : {}),
        getCardDefinitionById,
      });
    const optionalOutcome = handleStepOptionalExecution({
      effect,
      step,
      stepIndex: i,
      options,
      stepCtx,
      currentState,
      activeAction,
      activeChooser,
      targetIdsConsumed: cursors.targetIdsConsumed,
      effectIndex,
      effectSourcePreventionLevel,
      effectSourceTargetLockBypass,
      effectSourcePreventionBypass,
      sourceCardReferenceInstanceId: optionalSourceCardReferenceInstanceId,
    });
    currentState = optionalOutcome.state;
    if (optionalOutcome.kind === "continue") continue;
    if (optionalOutcome.kind === "return") return currentState;

    // --- deck_reveal 枚数+1 選択 (grant_optional_deck_reveal_count_boost CE 検知) ---
    const deckRevealBoostOutcome = handleDeckRevealCountBoostChoice({
      step,
      stepIndex: i,
      options,
      stepCtx,
      currentState,
      activeAction,
      targetIdsConsumed: cursors.targetIdsConsumed,
      effectIndex,
      effectSourcePreventionLevel,
      effectSourcePreventionBypass,
    });
    currentState = deckRevealBoostOutcome.state;
    if (deckRevealBoostOutcome.kind === "return") return currentState;

    // --- Step-level usageLimit (〔ターンに1回〕等をステップ単位で強制) ---
    const usageOutcome = handleStepUsageLimit({
      stepCtx,
      effect,
      step,
      stepIndex: i,
      options,
      currentState,
      effectIndex,
    });
    currentState = usageOutcome.state;
    if (usageOutcome.kind === "continue") continue;

    // --- Retrigger: 再発火登録 ---
    const retriggerOutcome = handleStepRetrigger({
      step,
      stepIndex: i,
      options,
      stepCtx,
      currentState,
      effectIndex,
    });
    currentState = retriggerOutcome.state;
    if (retriggerOutcome.kind === "continue") continue;

    // --- on_step 対象選択 ---
    const onStepTargetOutcome = handleStepOnStepTargetSelection({
      step,
      stepIndex: i,
      options,
      stepCtx,
      currentState,
      effect,
      activeAction,
      activeChooser,
      targetIdsConsumed: cursors.targetIdsConsumed,
      effectIndex,
      effectSourcePreventionLevel,
      effectSourceTargetLockBypass,
      effectSourcePreventionBypass,
    });
    currentState = onStepTargetOutcome.state;
    if (onStepTargetOutcome.kind === "break") break;

    // native action が pending に継続文脈を保存する前に記録する。
    // 任意ステップの辞退・使用制限は既に通過しており、対象0体の破壊も発揮に含む。
    // ただし、手札増加禁止で native handler が完全 no-op にした action は、実行結果を
    // 見てから取り消す。action kind ごとの事前判定にしないことで search_zone/search_deck
    // など新旧の手札取得経路も同じ規則で Q29310 の「発揮していない」を守る。
    const hadResolvedActionKindBefore =
      stepCtx.resolvedActionKinds?.includes(activeAction.kind) ?? false;
    const preNativeLogLength = currentState.log.length;
    stepCtx.resolvedActionKinds = [
      ...new Set([...(stepCtx.resolvedActionKinds ?? []), activeAction.kind]),
    ];
    const nativeOutcome = executeStepNativeAction({
      step,
      stepIndex: i,
      startIndex,
      options,
      stepCtx,
      currentState,
      effect,
      activeAction,
      activeChooser,
      effectIndex,
      effectSourcePreventionLevel,
      effectSourceNegatePreventionLevel,
      effectSourceTargetLockBypass,
      effectSourcePreventionBypass,
      effectSourceDefinitionIdAtStart,
      effectResolutionBeforeState,
      cursors,
      groupedTargetIdsByStepId,
      groupedTargetIndexesByStepId,
    });
    currentState = nativeOutcome.state;
    const nativeActionWasFullyBlockedByHandGainPrevention =
      currentState.log
        .slice(preNativeLogLength)
        .some((entry) =>
          /^effect:[^:]+:blocked-by-hand-gain-(?:prevention|cost):/.test(entry)
        ) &&
      getStepResult(stepCtx, step.id ?? `__step_${i}`)?.succeeded === false;
    if (
      nativeActionWasFullyBlockedByHandGainPrevention &&
      !hadResolvedActionKindBefore
    ) {
      stepCtx.resolvedActionKinds = stepCtx.resolvedActionKinds.filter(
        (kind) => kind !== activeAction.kind
      );
    }
    if (currentState.gameResult !== null) return currentState;
    // ENGINE-target-count-expand-modifier Step3: expand_effect_target_count CE の
    // usageLimit 消費記録。native action が実際に実行された (= auto-resolve 経路の
    // resolveTargetSpec が真に走った) 直後にのみ drain する。stepCtx は同一 effect
    // 解決内で使い回されるため、次 step 以降の gate 判定にも反映される
    // (「ターンに1回」の複数 step 越しの重複適用を防ぐ)。
    if (
      stepCtx.pendingExpandTargetCountUsage &&
      stepCtx.pendingExpandTargetCountUsage.length > 0
    ) {
      for (const usage of stepCtx.pendingExpandTargetCountUsage) {
        currentState = recordEffectUsageIfLimited({
          state: currentState,
          sourceInstanceId: usage.sourceInstanceId,
          sourceDefinitionId: usage.sourceDefinitionId,
          effectLabel: "expand_effect_target_count",
          usageLimit: usage.usageLimit,
        });
      }
      stepCtx.pendingExpandTargetCountUsage = [];
    }
    if (
      (activeAction.kind === "borrow_magic_effect" ||
        activeAction.kind === "borrow_card_event_effect") &&
      hasBlockingPendingSelection(currentState) &&
      i + 1 < steps.length
    ) {
      const continuation = buildAfterTriggersContinuation({
        state: currentState,
        effect,
        effectIndex,
        stepIndex: i + 1,
        waitChainId:
          options.chainId ?? `borrow:${sourceInstanceId}:${effectIndex}:${i}`,
        options,
        stepCtx,
        targetIdsConsumed: cursors.targetIdsConsumed,
        effectResolutionBeforeState,
      });
      return {
        ...currentState,
        pendingAfterTriggersContinuations: [
          ...currentState.pendingAfterTriggersContinuations,
          continuation,
        ],
      };
    }
    if (nativeOutcome.kind === "continue") continue;
    if (nativeOutcome.kind === "break") break;
    if (nativeOutcome.kind === "return") return currentState;
  }

  if (!hasBlockingPendingSelection(currentState)) {
    currentState = finalizePendingConditionalCostRollback({
      currentState,
      stepCtx,
      options,
    });
  }

  // P3-14 C-2 (effect_resisted): usageLimit.unlessAffectedByOpponent
  // (「相手の効果を受けなかったとき、ゲーム中に1回ずつしか使えない」BSTH01-C21)。
  // 解決中に相手効果の妨害マーカー (restrict_end_* による
  // 終了効果の no-op) が出ていた場合、使用記録を払い戻して制限を消費しない。
  // recordedUsage は複数記録 (共有ラベル + choice 変種別ラベル) を持ち得るため、
  // unlessAffectedByOpponent を持つエントリだけを払い戻す。
  if (options.recordedUsage) {
    const recordedEntries: readonly import("../model").RecordedEffectUsageEntry[] =
      [options.recordedUsage, ...(options.recordedUsage.extraRecords ?? [])];
    const refundableEntries = recordedEntries.filter((entry) => {
      const usageLimits = Array.isArray(entry.usageLimit)
        ? entry.usageLimit
        : [entry.usageLimit];
      return usageLimits.some(
        (limit) =>
          (limit as import("../model").EffectUsageLimit)
            .unlessAffectedByOpponent === true
      );
    });
    if (refundableEntries.length > 0) {
      const affectedByOpponent = [...stepCtx.results.values()].some(
        (result) => result.blockedByOpponentEffect === true
      );
      if (affectedByOpponent) {
        for (const entry of refundableEntries) {
          currentState = refundEffectUsageIfRecorded({
            state: currentState,
            sourceInstanceId,
            effectLabel: entry.effectLabel,
            usageLimit: entry.usageLimit as
              | import("../model").EffectUsageLimit
              | import("../model").EffectUsageLimit[],
            ...(entry.groupId ? { groupId: entry.groupId } : {}),
          });
        }
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:usage-refund:affected-by-opponent:${sourceInstanceId}`,
          ],
        };
      }
    }
  }

  if (!hasBlockingPendingSelection(currentState)) {
    currentState = queueResolvedActions(currentState, options.chainId ?? null);
  }
  return currentState;
}

export { evaluateApplicability } from "./effect-applicability";

// ============================================================
// StepCondition 評価
// ============================================================
