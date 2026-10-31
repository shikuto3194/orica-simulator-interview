// ============================================================
// effect-borrowing.ts — 効果借用 (borrow_magic_effect) 実行エンジン
// ============================================================
//
// BSAZ03-M01「雨の断章」effects[2,3]（他マジックの効果を1つ借りて発揮する）が初出の
// カード横断効果借用 primitive。対象カードの選択は既存 TargetSpec/CardFilter
// (`hasActivatedEffectMode`, card-filter.ts) にすべて委譲し、本ファイルは
// 「借用元 effects[] から一致エントリを探し、`executeEffect` に橋渡しする」ことだけを担う。
//
// retrigger-system.ts (`executeMatchingRetriggers`) と同型: 他カードの定義から Effect
// を取り出し、`executeEffect` へ直接渡して実行する。循環 import を避けるため、
// `executeEffect` は値としては import せず、呼び出し元 (effect-interpreter.ts の
// `executeNativeAction`) から関数として注入する。

import { requireCardZone } from "../model";
import type {
  ActiveStack,
  CardInstance,
  CardDefinition,
  CardEventType,
  EffectPreventionLevel,
  EffectUsageLimit,
  GameState,
  PendingBorrowedEffectTargetSelection,
  PendingStackNegateRequest,
  RecordedEffectUsage,
  Zone,
} from "../model";
import type { DSL, Effect, EffectTargetFilter } from "../dsl-types";
import type { ExecuteEffectOptions } from "./effect-interpreter";
import {
  collectAndQueueTriggerReactions,
  queueEffectActivationTriggers,
  type BurstActionRegistrationLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "./trigger-system";
import { getCardById } from "../card/card-lookup";
import { resolveGrantedEffectSourceDefinition } from "./granted-effect-source";
import { moveCardZone } from "../core/core-system";
import { putCardOnField } from "../card/put-card-on-field";
import { didEffectActivationFail } from "./effect-activation-observer";
import { evaluateApplicability } from "./effect-applicability";
import { evaluateCondition } from "./structured-condition-eval";
import { recomputeAndRebuildContinuousEffects } from "./continuous-effect-rebuild";
import { matchesTribes } from "../card/card-filter";
import { effectMatchesCardEventLabel } from "./effect-label-utils";
import { deriveSuppressionEffectDescriptor } from "./structured-effect-registrations";
import { isCEActiveForScope } from "../card/ce-lookup";
import type { TargetLockBypassProfile } from "./target-affect-gate";
import type { SerializedStepContext } from "../step-execution-context";
import {
  canUseEffectByUsageLimit,
  getStableEffectLabel,
  recordEffectUsageIfLimited,
  runReevaluationAtTiming,
} from "../legal/legal-actions-shared";
import { hasOutstandingEffectResolutionContinuation } from "../state-based-actions";
import { appendCardRevealDisclosure } from "../public-disclosure";

/**
 * `action.borrowModes` に一致する借用先カードの起動効果を探す。
 * `effect.stub` / `steps.length` は見ない（対象選択フィルタ `hasActivatedEffectMode` と
 * 同じ「印字属性・実装状態非依存」原則。実装未了の借用先効果は steps:[] のまま
 * `executeEffect` に渡され、安全な no-op として解決する）。
 */
function findBorrowableEffect(
  targetDef: CardDefinition,
  borrowModes: readonly ("main" | "flash" | "stack")[]
): Effect | undefined {
  return (targetDef.effects ?? []).find(
    (e) =>
      e.timing.kind === "activated" &&
      e.timing.mode !== "any" &&
      borrowModes.includes(e.timing.mode)
  );
}

export interface BorrowableCardEventEffectCandidate {
  effectIndex: number;
  textRef?: readonly number[];
  grantedEffectCeId?: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
}

interface BorrowableCardEventEffectSource {
  sourceCard: CardInstance;
  effectDefinition: CardDefinition;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
}

function borrowedCardEventEffectLabel(effectIndex: number): string {
  return getStableEffectLabel("borrow_card_event_effect", effectIndex, {
    effectIndex,
  });
}

function borrowedEffectUsageLimit(
  effect: Effect
): EffectUsageLimit | EffectUsageLimit[] | undefined {
  return effect.usageLimit as EffectUsageLimit | EffectUsageLimit[] | undefined;
}

function withBorrowedInteractiveTargetSelection(effect: Effect): Effect {
  return {
    ...effect,
    steps: effect.steps.map((step) => {
      const actionWithTarget = step.action as {
        target?: { kind?: string; count?: unknown };
      };
      if (
        step.targetSelectionTiming === undefined &&
        actionWithTarget.target?.kind === "filter" &&
        actionWithTarget.target.count !== "all"
      ) {
        return { ...step, targetSelectionTiming: "on_step" };
      }
      return step;
    }),
  };
}

function canUseBorrowedEffectUsageLimit(args: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  borrowedEffectIndex: number;
  borrowedEffect: Effect;
}): boolean {
  const usageLimit = borrowedEffectUsageLimit(args.borrowedEffect);
  if (!usageLimit) return true;
  return canUseEffectByUsageLimit({
    sourceEffect: args.borrowedEffect,
    state: args.state,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: args.sourceDefinitionId,
    getCardDefinitionById: args.getCardDefinitionById,
    effectLabel: borrowedCardEventEffectLabel(args.borrowedEffectIndex),
    usageLimit,
  });
}

/**
 * `borrow_magic_effect` は借用先マジックの発揮そのものなので、通常の magic 宣言と
 * 同じ usage record を照合する。これにより「〔ターンに1回:同名〕」を持つマジックを
 * 同名カードから借用しても、借用経路だけが制限を回避することはない。
 */
function canUseBorrowedMagicEffectUsageLimit(args: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  borrowedEffect: Effect;
}): boolean {
  const usageLimit = borrowedEffectUsageLimit(args.borrowedEffect);
  if (!usageLimit) return true;
  return canUseEffectByUsageLimit({
    sourceEffect: args.borrowedEffect,
    state: args.state,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: args.sourceDefinitionId,
    getCardDefinitionById: args.getCardDefinitionById,
    effectLabel: "magic",
    usageLimit,
    ...(args.borrowedEffect.limitGroupId
      ? { groupId: args.borrowedEffect.limitGroupId }
      : {}),
  });
}

function cardEventMatches(
  effect: Effect,
  targetDef: CardDefinition,
  borrowEvents: readonly CardEventType[]
): boolean {
  return cardEventMatchesTextLines(effect, targetDef.textLines, borrowEvents);
}

function cardEventMatchesTextLines(
  effect: Effect,
  textLines: readonly string[],
  borrowEvents: readonly CardEventType[]
): boolean {
  if (effect.stub !== undefined || effect.steps.length === 0) return false;
  return effectMatchesCardEventLabel(effect, textLines, borrowEvents, {
    requireSelfReference: true,
  });
}

/**
 * `ignoreLevelCondition` 用: `condition` から `min_level` 節を除いた配列を返す
 * （「Lvを無視して発揮する」型、BSLH01-R01[3,4]）。`min_level` 以外の節は通常どおり残す。
 */
function conditionForBorrowEvaluation(
  condition: Effect["condition"],
  ignoreLevelCondition: boolean | undefined
): Effect["condition"] {
  if (!ignoreLevelCondition || !condition) return condition;
  return condition.filter((clause) => clause.kind !== "min_level");
}

function requiresResponseStackBinding(
  action: DSL.BorrowCardEventEffectAction
): boolean {
  return action.suppressBorrowedEffect === true;
}

function getCurrentResponseStackTarget(
  state: GameState,
  explicit: ActiveStack | null | undefined
): ActiveStack | null {
  return (
    explicit ??
    state.pendingStackCascade?.remainingStacks[0] ??
    state.stackWindow?.pendingStackAction ??
    state.preDeclarationStackWindow?.pendingStackAction ??
    state.activeAttack?.flashWindowState?.pendingStackAction ??
    null
  );
}

function listBorrowableCardEventEffectSources(
  state: GameState,
  targetCard: CardInstance,
  targetDef: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): BorrowableCardEventEffectSource[] {
  // 合体ユニットでは host + attached brave の双方が「このスピリット」の効果源になりうる。
  // battle-immediate-effect-system.ts の member 巡回と同じ物理 attached/imagin 2経路を使う。
  const sources: BorrowableCardEventEffectSource[] = [
    { sourceCard: targetCard, effectDefinition: targetDef },
  ];
  const pushAttached = (attachedId: string) => {
    if (sources.some((entry) => entry.sourceCard.instanceId === attachedId)) {
      return;
    }
    const attached = getCardById(state, attachedId);
    if (!attached) return;
    if (attached.zone === "field" && attached.faceDown) return;
    const attachedDef = getCardDefinitionById(attached.definitionId);
    if (!attachedDef) return;
    sources.push({
      sourceCard: attached,
      effectDefinition: attachedDef,
      effectSourceInstanceId: attached.instanceId,
      effectSourceDefinitionId: attachedDef.cardNo,
    });
  };
  for (const attachedId of targetCard.attachedChildrenIds) {
    pushAttached(attachedId);
  }
  for (const candidate of state.cardInstances) {
    if (candidate.imaginRightCombinedWith !== targetCard.instanceId) continue;
    pushAttached(candidate.instanceId);
  }
  return sources;
}

function getResponseStackBorrowCandidate(args: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  targetId: string;
  targetDef: CardDefinition;
  borrowEvents: readonly CardEventType[];
  responseTargetStack: ActiveStack | null | undefined;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}): BorrowableCardEventEffectCandidate | undefined {
  const stack = args.responseTargetStack;
  if (
    !stack ||
    stack.actionKind !== "triggered_effect" ||
    stack.actingPlayerId === args.actingPlayerId ||
    stack.cardInstanceId !== args.targetId
  ) {
    return undefined;
  }
  const effectIndex =
    stack.suppressionEffectDescriptor?.effectIndex ??
    (stack.triggeredSourceCardNo !== undefined &&
    stack.triggeredRegistrationIndex !== undefined
      ? args.getRegisteredTriggeredEffectActions(stack.triggeredSourceCardNo)?.[
          stack.triggeredRegistrationIndex
        ]?.effectIndex
      : undefined);
  if (effectIndex === undefined) return undefined;
  const effect = args.targetDef.effects?.[effectIndex];
  if (!effect || !cardEventMatches(effect, args.targetDef, args.borrowEvents)) {
    return undefined;
  }
  const targetCard = getCardById(args.state, args.targetId);
  if (!targetCard) return undefined;
  if (
    !canUseBorrowedEffectUsageLimit({
      state: args.state,
      sourceInstanceId: args.sourceInstanceId,
      sourceDefinitionId: args.sourceDefinitionId,
      getCardDefinitionById: args.getCardDefinitionById,
      borrowedEffectIndex: effectIndex,
      borrowedEffect: effect,
    })
  ) {
    return undefined;
  }
  if (
    effect.condition &&
    effect.condition.length > 0 &&
    !evaluateCondition(
      args.state,
      effect.condition,
      targetCard.instanceId,
      targetCard.controllerPlayerId,
      args.getCardDefinitionById
    )
  ) {
    return undefined;
  }
  if (
    effect.applicability &&
    !evaluateApplicability(
      args.state,
      effect.applicability,
      targetCard.instanceId,
      args.getCardDefinitionById
    )
  ) {
    return undefined;
  }
  return {
    effectIndex,
    ...(effect.textRef !== undefined ? { textRef: effect.textRef } : {}),
  };
}

function appendBorrowedResponseStackSuppressionRequest(args: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetDef: CardDefinition;
  borrowedEffectIndex: number;
  borrowEvents: readonly CardEventType[];
  responseTargetStack: ActiveStack | null | undefined;
}): GameState {
  const stack = args.responseTargetStack;
  if (!stack || stack.actionKind !== "triggered_effect") return args.state;
  const descriptor = stack.suppressionEffectDescriptor;
  const eventAction: string | string[] =
    args.borrowEvents.length === 1
      ? args.borrowEvents[0]!
      : [...args.borrowEvents];
  const targetEffectFilter: EffectTargetFilter = {
    sourceDefinitionId: args.targetDef.cardNo,
    effectIndex: args.borrowedEffectIndex,
    timingKind: "card_event",
    eventAction,
    ...(descriptor?.effectLabels !== undefined
      ? { effectLabels: [...descriptor.effectLabels] }
      : {}),
  };
  const request: PendingStackNegateRequest = {
    requestId: `borrow-card-event-stack-suppress:${args.sourceInstanceId}:${stack.stackId}:${args.state.log.length}`,
    actingPlayerId: args.actingPlayerId,
    sourceInstanceId: args.sourceInstanceId,
    negateTarget: "effect",
    targetController: "opponent",
    targetEffectFilter,
    createdAtStep: args.state.step,
    createdAtTurn: args.state.turnNumber,
  };
  return {
    ...args.state,
    pendingStackNegateRequests: [
      ...args.state.pendingStackNegateRequests,
      request,
    ],
    log: [
      ...args.state.log,
      `borrow_card_event_effect:suppress_pending_stack:${stack.stackId}:${args.targetDef.cardNo}:${args.borrowedEffectIndex}`,
    ],
  };
}

function appendResponseStackDeferralObservation(args: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  responseTargetStack: ActiveStack | null | undefined;
}): GameState {
  const stack = getCurrentResponseStackTarget(
    args.state,
    args.responseTargetStack
  );
  if (!stack || stack.actingPlayerId === args.actingPlayerId) {
    return args.state;
  }
  return {
    ...args.state,
    log: [
      ...args.state.log,
      `borrow_card_event_effect:defer_response_stack:${stack.stackId}:${stack.cardDefinitionId}`,
    ],
  };
}

export function listBorrowableCardEventEffectCandidates(
  state: GameState,
  sourceInstanceId: string,
  sourceDefinitionId: string,
  targetId: string,
  targetDef: CardDefinition,
  borrowEvents: readonly CardEventType[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  ignoreLevelCondition?: boolean
): BorrowableCardEventEffectCandidate[] {
  const targetCard = getCardById(state, targetId);
  if (!targetCard) return [];
  const printedCandidates = listBorrowableCardEventEffectSources(
    state,
    targetCard,
    targetDef,
    getCardDefinitionById
  ).flatMap((source) =>
    (source.effectDefinition.effects ?? []).flatMap((effect, effectIndex) => {
      if (
        !cardEventMatchesTextLines(
          effect,
          source.effectDefinition.textLines,
          borrowEvents
        )
      ) {
        return [];
      }
      if (
        !canUseBorrowedEffectUsageLimit({
          state,
          sourceInstanceId,
          sourceDefinitionId,
          getCardDefinitionById,
          borrowedEffectIndex: effectIndex,
          borrowedEffect: effect,
        })
      ) {
        return [];
      }
      const evaluableCondition = conditionForBorrowEvaluation(
        effect.condition,
        ignoreLevelCondition
      );
      if (
        evaluableCondition &&
        evaluableCondition.length > 0 &&
        !evaluateCondition(
          state,
          evaluableCondition,
          source.sourceCard.instanceId,
          source.sourceCard.controllerPlayerId,
          getCardDefinitionById
        )
      ) {
        return [];
      }
      if (
        effect.applicability &&
        !evaluateApplicability(
          state,
          effect.applicability,
          source.sourceCard.instanceId,
          getCardDefinitionById
        )
      ) {
        return [];
      }
      return [
        {
          effectIndex,
          ...(effect.textRef !== undefined ? { textRef: effect.textRef } : {}),
          ...(source.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: source.effectSourceInstanceId }
            : {}),
          ...(source.effectSourceDefinitionId !== undefined
            ? { effectSourceDefinitionId: source.effectSourceDefinitionId }
            : {}),
        },
      ];
    })
  );

  const grantedCandidates: BorrowableCardEventEffectCandidate[] = [];
  let grantedOrdinal = 0;
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "granted_effect") continue;
    if (ce.targetInstanceId !== targetId) continue;
    if (!isCEActiveForScope(ce, state.step, state.activePlayerId)) continue;
    const grantedEffect = ce.metadata?.grantedEffect as Effect | undefined;
    if (!grantedEffect) continue;
    const sourceDef = resolveGrantedEffectSourceDefinition(
      state,
      ce,
      getCardDefinitionById
    );
    const textLines = sourceDef?.textLines ?? targetDef.textLines;
    const effectIndex = -(grantedOrdinal + 1);
    grantedOrdinal++;
    if (!cardEventMatchesTextLines(grantedEffect, textLines, borrowEvents)) {
      continue;
    }
    if (
      !canUseBorrowedEffectUsageLimit({
        state,
        sourceInstanceId,
        sourceDefinitionId,
        getCardDefinitionById,
        borrowedEffectIndex: effectIndex,
        borrowedEffect: grantedEffect,
      })
    ) {
      continue;
    }
    const evaluableCondition = conditionForBorrowEvaluation(
      grantedEffect.condition,
      ignoreLevelCondition
    );
    if (
      evaluableCondition &&
      evaluableCondition.length > 0 &&
      !evaluateCondition(
        state,
        evaluableCondition,
        targetCard.instanceId,
        targetCard.controllerPlayerId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    if (
      grantedEffect.applicability &&
      !evaluateApplicability(
        state,
        grantedEffect.applicability,
        targetCard.instanceId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    grantedCandidates.push({
      effectIndex,
      grantedEffectCeId: ce.effectId,
      ...(grantedEffect.textRef !== undefined
        ? { textRef: grantedEffect.textRef }
        : {}),
    });
  }

  return [...printedCandidates, ...grantedCandidates];
}

function recordBorrowedEffectUsage(args: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  borrowedEffectIndex: number;
  borrowedEffect: Effect;
}): {
  state: GameState;
  recordedUsage?: RecordedEffectUsage;
} {
  const usageLimit = borrowedEffectUsageLimit(args.borrowedEffect);
  if (!usageLimit) return { state: args.state };
  const effectLabel = borrowedCardEventEffectLabel(args.borrowedEffectIndex);
  const state = recordEffectUsageIfLimited({
    state: args.state,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: args.sourceDefinitionId,
    effectLabel,
    usageLimit,
  });
  return {
    state,
    recordedUsage: {
      sourceInstanceId: args.sourceInstanceId,
      effectLabel,
      usageLimit,
    },
  };
}

function recordBorrowedMagicEffectUsage(args: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  borrowedEffect: Effect;
}): {
  state: GameState;
  recordedUsage?: RecordedEffectUsage;
} {
  const usageLimit = borrowedEffectUsageLimit(args.borrowedEffect);
  if (!usageLimit) return { state: args.state };
  const state = recordEffectUsageIfLimited({
    state: args.state,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: args.sourceDefinitionId,
    effectLabel: "magic",
    usageLimit,
    ...(args.borrowedEffect.limitGroupId
      ? { groupId: args.borrowedEffect.limitGroupId }
      : {}),
  });
  return {
    state,
    recordedUsage: {
      sourceInstanceId: args.sourceInstanceId,
      effectLabel: "magic",
      usageLimit,
      ...(args.borrowedEffect.limitGroupId
        ? { groupId: args.borrowedEffect.limitGroupId }
        : {}),
    },
  };
}

function buildBorrowedEffectTargetSelectionFromPending(args: {
  state: GameState;
  pending: import("../model").PendingStepOptionalTargetSelection;
  stepIndex: number;
  stepContext: SerializedStepContext;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetId: string;
  targetDef: CardDefinition;
  borrowedEffectIndex: number;
  grantedEffectCeId?: string;
  recordedUsage?: RecordedEffectUsage;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  attributeToBorrowedCard?: boolean;
  battleEndDeferralAttackId?: string;
}): PendingBorrowedEffectTargetSelection {
  return {
    pendingId: `borrow-card-event-target:${args.sourceInstanceId}:${args.targetId}:${args.borrowedEffectIndex}:${args.state.log.length}`,
    chainId: args.pending.continuation.chainId,
    actingPlayerId: args.actingPlayerId,
    choosingPlayerId: args.pending.choosingPlayerId,
    sourceInstanceId: args.sourceInstanceId,
    targetInstanceId: args.targetId,
    targetDefinitionId: args.targetDef.cardNo,
    borrowedEffectIndex: args.borrowedEffectIndex,
    ...(args.grantedEffectCeId !== undefined
      ? { grantedEffectCeId: args.grantedEffectCeId }
      : {}),
    requiredTargetCount: args.pending.requiredTargetCount,
    maxTargetCount: args.pending.maxTargetCount,
    ...(args.pending.bpBudgetAmount !== undefined
      ? { bpBudgetAmount: args.pending.bpBudgetAmount }
      : {}),
    ...(args.pending.costBudgetAmount !== undefined
      ? { costBudgetAmount: args.pending.costBudgetAmount }
      : {}),
    ...(args.pending.symbolBudgetAmount !== undefined
      ? { symbolBudgetAmount: args.pending.symbolBudgetAmount }
      : {}),
    candidateInstanceIds: [...args.pending.candidateInstanceIds],
    targetStepId: args.pending.targetStepId,
    targetStepIndex: args.stepIndex,
    stepContext: args.stepContext,
    ...(args.recordedUsage !== undefined
      ? { recordedUsage: args.recordedUsage }
      : {}),
    ...(args.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: args.effectSourceInstanceId }
      : {}),
    ...(args.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: args.effectSourceDefinitionId }
      : {}),
    ...(args.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: args.sourcePreventionLevel }
      : {}),
    ...(args.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: args.sourcePreventionBypass }
      : {}),
    ...(args.attributeToBorrowedCard ? { attributeToBorrowedCard: true } : {}),
    ...(args.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: args.battleEndDeferralAttackId }
      : {}),
  };
}

function getGrantedBorrowedCardEventEffect(args: {
  state: GameState;
  targetId: string;
  grantedEffectCeId: string | undefined;
}): Effect | undefined {
  if (args.grantedEffectCeId === undefined) return undefined;
  const ce = args.state.activeContinuousEffects.find(
    (candidate) => candidate.effectId === args.grantedEffectCeId
  );
  if (
    !ce ||
    ce.modifierTag !== "granted_effect" ||
    ce.targetInstanceId !== args.targetId ||
    !isCEActiveForScope(ce, args.state.step, args.state.activePlayerId)
  ) {
    return undefined;
  }
  return ce.metadata?.grantedEffect as Effect | undefined;
}

export function executeBorrowMagicEffect(
  state: GameState,
  parentChainId: string,
  actingPlayerId: string,
  action: DSL.BorrowMagicEffectAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds: string[] | undefined,
  executeEffectFn: (options: ExecuteEffectOptions) => GameState,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup,
  // BSRK01-X02[5]「この効果で発揮するメイン/フラッシュ/スタック効果は、相手の効果を受けない」:
  // 借用元カードの preventionLevel ではなく、借用する側 (this effect) の preventionLevel を
  // 借用先効果の実行に引き継ぐ。borrow_card_event_effect と同じ委譲パターン
  // (effectMeta.sourcePreventionLevel はホスト effect の `preventionLevel` から自動導出済み、
  // effect-interpreter.ts:541 derivePreventionLevel)。
  sourcePreventionLevel?: EffectPreventionLevel,
  sourcePreventionBypass?: TargetLockBypassProfile,
  /**
   * `treatAsMagicUse` のカード移動・使用誘発・反応窓を、通常のマジック宣言経路で
   * 実行するための注入口。effect-borrowing は effect-interpreter からも参照される
   * ため、循環 import を避けて native registry が実装を供給する。
   */
  declareAsMagicUse?: (options: {
    state: GameState;
    sourceInstanceId: string;
    effect: Effect;
    effectIndex: number;
    recordedUsage?: RecordedEffectUsage;
    sourcePreventionLevel?: EffectPreventionLevel;
    sourcePreventionBypass?: TargetLockBypassProfile;
  }) => GameState
): GameState {
  // A deferred cleanup is still a card move. Reject its destination before
  // disclosure, usage recording or the borrowed body can change the state.
  if (action.beforeMove) requireCardZone(action.beforeMove.zone);
  if (action.thenMove) requireCardZone(action.thenMove.zone);
  const targetId = resolvedTargetIds?.[0];
  if (!targetId) return state;
  const targetCard = getCardById(state, targetId);
  if (!targetCard) return state;
  const targetDef = getCardDefinitionById(targetCard.definitionId);
  if (!targetDef) return state;
  // 借用は借用先マジックの「使用」なので、手札/手元/トラッシュから効果を発揮した
  // ことを nested effect にも伝える。これを落とすと、BSTH02.7-C05 のような
  // activation_zone 条件の「手元から使用後は除外」が false になり、外側 thenMove が
  // 誤ってトラッシュへ移してしまう。
  const activationZone =
    action.treatAsMagicUse === true &&
    (targetCard.zone === "hand" ||
      targetCard.zone === "set_aside" ||
      targetCard.zone === "trash")
      ? targetCard.zone
      : undefined;

  const borrowedEffect = findBorrowableEffect(targetDef, action.borrowModes);
  if (!borrowedEffect) {
    // 対象選択フィルタ (hasActivatedEffectMode) が正しく絞っていれば到達しないはずの
    // 防御分岐。「借用先効果は発揮されなかった」ため thenMove も行わない。
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_magic_effect:no_eligible_effect:${targetDef.cardNo}`,
      ],
    };
  }

  const logStart = state.log.length;
  const chainId = action.thenMove?.afterTriggers
    ? `${parentChainId}:after_triggers:borrow:${logStart}`
    : parentChainId;
  const postResolutionActivation = {
    chainId,
    triggerCardInstanceId: targetId,
    triggerKind: "effect_activated" as const,
    activatorPlayerId: actingPlayerId,
    effectActivationLogStart: logStart,
  };
  const borrowedEffectIndex = targetDef.effects?.indexOf(borrowedEffect) ?? -1;
  if (
    !canUseBorrowedMagicEffectUsageLimit({
      state,
      sourceInstanceId: targetId,
      sourceDefinitionId: targetDef.cardNo,
      getCardDefinitionById,
      borrowedEffect,
    })
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_magic_effect:usage_limit_exhausted:${targetDef.cardNo}:${borrowedEffectIndex}`,
      ],
    };
  }
  const preReeval = runReevaluationAtTiming({
    state,
    registration: {
      reevaluationPoints: [
        {
          timing: "before_each_step",
          checks: ["effect_suppression"],
          failurePolicy: "abort_remaining",
        },
      ],
    },
    timing: "before_each_step",
    sourceInstanceId: targetId,
    targetInstanceIds: [],
    getCardDefinitionById,
    suppressionEffectDescriptor: deriveSuppressionEffectDescriptor(
      borrowedEffect,
      {
        sourceDefinitionId: targetDef.cardNo,
        sourceKind: "magic",
        ...(borrowedEffectIndex >= 0
          ? { effectIndex: borrowedEffectIndex }
          : {}),
        sourceTextLines: targetDef.textLines,
      }
    ),
  });
  if (!preReeval.passed) {
    return {
      ...state,
      log: [
        ...state.log,
        `reevaluation:before_each_step:failed:${preReeval.failedChecks.join(",")}:${preReeval.failurePolicy}:source=${targetId}`,
      ],
    };
  }
  if (action.treatAsMagicUse === true && declareAsMagicUse !== undefined) {
    // 「効果を発揮する」だけの通常 borrow と異なり、ここでは借用元カード自身を
    // マジックとして使用する。in_use 遷移、flash_used 誘発、使用前反応窓、解決後の
    // 標準 cleanup は callback 側の通常マジック dispatch が SSOT として担当する。
    // この経路では `thenMove` を重ねない。通常 cleanup が手札/手元→trash を行い、
    // C05 のように効果自身が除外へ移した場合も上書きしないためである。
    return declareAsMagicUse({
      // 通常のマジック宣言と同じ registration gate を通過してから使用回数を
      // 記録する。ここで先に record すると、condition / choice / 必須コストで
      // 宣言不能だった場合にも usage が消費されてしまう。
      state,
      sourceInstanceId: targetId,
      effect: borrowedEffect,
      effectIndex: borrowedEffectIndex,
      ...(sourcePreventionLevel !== undefined ? { sourcePreventionLevel } : {}),
      ...(sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass }
        : {}),
    });
  }
  if (action.beforeMove) {
    const fromZones =
      action.beforeMove.fromZone === undefined
        ? undefined
        : Array.isArray(action.beforeMove.fromZone)
          ? action.beforeMove.fromZone
          : [action.beforeMove.fromZone];
    if (fromZones === undefined || fromZones.includes(targetCard.zone)) {
      state =
        action.beforeMove.zone === "field"
          ? putCardOnField(
              state,
              targetId,
              getCardDefinitionById,
              actingPlayerId
            )
          : moveCardZone(state, targetId, action.beforeMove.zone);
      state = recomputeAndRebuildContinuousEffects(
        state,
        getCardDefinitionById
      );
    }
  }
  // 手札の候補全体は非公開のまま。借用を確定した発揮元だけを、
  // 通常使用/フィールド移動で公開されない経路でも効果発揮前に見せる。
  if (getCardById(state, targetId)?.zone === "hand") {
    state = appendCardRevealDisclosure({
      state,
      actorPlayerId: actingPlayerId,
      cardInstanceIds: [targetId],
      audience: "both",
      open: false,
      sourceInstanceId: targetId,
    });
  }
  const usageRecord = recordBorrowedMagicEffectUsage({
    state,
    sourceInstanceId: targetId,
    sourceDefinitionId: targetDef.cardNo,
    borrowedEffect,
  });
  let result = executeEffectFn({
    chainId,
    state: usageRecord.state,
    effect: borrowedEffect,
    sourceInstanceId: targetId,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    ...(activationZone !== undefined ? { activationZone } : {}),
    ...(getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions }
      : {}),
    ...(sourcePreventionLevel !== undefined ? { sourcePreventionLevel } : {}),
    ...(sourcePreventionBypass !== undefined ? { sourcePreventionBypass } : {}),
    postResolutionOracle: postResolutionActivation,
    ...(usageRecord.recordedUsage !== undefined
      ? { recordedUsage: usageRecord.recordedUsage }
      : {}),
    // pendingEffectTargetSelection を経由しない直接再実行のため、範囲ターゲット
    // ({min,max}) の自動解決は静的 min (=常に0選択の無音no-op) ではなく静的 max を
    // 採用する (ENGINE-retrigger-range-count-target-fallback)。
    rangeAutoResolveStrategy: "max",
    stepTargetSelectionBypassesPreventionGate: false,
  });
  // 借用先本文の「できる」は、借用を選んだ後も独立した任意選択として残す。
  if (didEffectActivationFail(result.log.slice(logStart), targetId)) {
    return result;
  }
  const isPaused = hasOutstandingEffectResolutionContinuation(result);
  if (action.thenMove?.afterTriggers) {
    result = collectAndQueueTriggerReactions({
      beforeState: usageRecord.state,
      afterState: result,
      source: "action_resolution",
      chainId,
      causedByPlayerId: actingPlayerId,
      causedBySourceInstanceId: targetId,
      enterFieldCausedByPlayerId: actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
  }
  result = {
    ...result,
    log: [...result.log, `borrow_magic_effect:executed:${targetDef.cardNo}`],
  };
  if (!isPaused) {
    // borrow_magic_effect は executeEffect 直呼びのため、通常の stack/magic 解決 hook を通らない。
    // 借用元カード自身の「効果発揮後」観測はここで source attribution する。
    result = queueEffectActivationTriggers({
      chainId,
      state: result,
      activatorPlayerId: actingPlayerId,
      relatedInstanceId: targetId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
  }

  if (action.thenMove) {
    const stillTracked = getCardById(result, targetId);
    // 借用効果解決中に対象がさらに移動 (例: 借用先自身の効果でトラッシュを離れる) した
    // 場合は上書きしない。fromZone 省略時は trash（BSAZ03-M01 後方互換）。
    const fromZones: readonly Zone[] = action.thenMove.fromZone
      ? Array.isArray(action.thenMove.fromZone)
        ? action.thenMove.fromZone
        : [action.thenMove.fromZone]
      : ["trash"];
    if (isPaused || action.thenMove.afterTriggers) {
      const continuationId = `borrow-cleanup:${targetId}:${borrowedEffectIndex}:${result.log.length}`;
      const waitChainId = action.thenMove.afterTriggers
        ? chainId!
        : continuationId;
      return {
        ...result,
        pendingAfterTriggersContinuations: [
          ...result.pendingAfterTriggersContinuations,
          {
            continuationId,
            waitChainId,
            chainId: parentChainId,
            sourceDefinitionId: targetDef.cardNo,
            effectIndex: borrowedEffectIndex,
            sourceInstanceId: targetId,
            actingPlayerId,
            resumeStepIndex: 0,
            stepContext: { results: {} },
            resumeEffectOverride: {
              timing: borrowedEffect.timing,
              steps: [
                {
                  action: {
                    kind: "move_card",
                    from: { zone: [...fromZones], player: "self" },
                    to: { zone: action.thenMove.zone },
                    target: { kind: "self" },
                    count: 1,
                  },
                },
              ],
            },
          },
        ],
      };
    }
    if (stillTracked && fromZones.includes(stillTracked.zone)) {
      result =
        action.thenMove.zone === "field"
          ? putCardOnField(
              result,
              targetId,
              getCardDefinitionById,
              actingPlayerId
            )
          : moveCardZone(result, targetId, action.thenMove.zone);
    }
  }

  return result;
}

export function executeBorrowCardEventEffect(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  sourceInstanceId: string,
  action: DSL.BorrowCardEventEffectAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds: string[] | undefined,
  executeEffectFn: (options: ExecuteEffectOptions) => GameState,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile,
  responseTargetStack?: ActiveStack | null,
  battleEndDeferralAttackId?: string,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  const targetId = resolvedTargetIds?.[0];
  if (!targetId) return state;
  const targetCard = getCardById(state, targetId);
  if (!targetCard) return state;
  const targetDef = getCardDefinitionById(targetCard.definitionId);
  if (!targetDef) return state;
  if (
    action.requiredTribes &&
    action.requiredTribes.length > 0 &&
    // requiredTribes は「いずれかを持つ」= OR（`matchesTribes` の tribes 既定挙動）。
    !matchesTribes(targetDef.tribe, { tribes: [...action.requiredTribes] })
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_card_event_effect:tribe_mismatch:${targetDef.cardNo}`,
      ],
    };
  }
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinitionId = sourceCard?.definitionId ?? sourceInstanceId;

  let candidates = listBorrowableCardEventEffectCandidates(
    state,
    sourceInstanceId,
    sourceDefinitionId,
    targetId,
    targetDef,
    action.borrowEvents,
    getCardDefinitionById,
    action.ignoreLevelCondition
  );
  const responseStackCandidate = requiresResponseStackBinding(action)
    ? getResponseStackBorrowCandidate({
        state,
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId,
        targetId,
        targetDef,
        borrowEvents: action.borrowEvents,
        responseTargetStack,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      })
    : undefined;
  if (requiresResponseStackBinding(action)) {
    if (responseStackCandidate === undefined) {
      candidates = [];
    } else {
      candidates = candidates.filter(
        (candidate) =>
          candidate.effectIndex === responseStackCandidate.effectIndex
      );
    }
  }
  if (candidates.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_card_event_effect:no_eligible_effect:${targetDef.cardNo}`,
      ],
    };
  }
  if (candidates.length > 1) {
    return {
      ...state,
      pendingBorrowedEffectChoice: {
        chainId,
        pendingId: `borrow-card-event:${sourceInstanceId}:${targetId}:${state.log.length}`,
        actingPlayerId,
        sourceInstanceId,
        targetInstanceId: targetId,
        targetDefinitionId: targetDef.cardNo,
        borrowEvents: [...action.borrowEvents],
        candidates,
        ...(action.suppressBorrowedEffect
          ? { suppressBorrowedEffect: true }
          : {}),
        ...(action.suppressResponseStack
          ? { suppressResponseStack: true }
          : {}),
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        ...(action.ignoreLevelCondition ? { ignoreLevelCondition: true } : {}),
        ...(action.attributeToBorrowedCard
          ? { attributeToBorrowedCard: true }
          : {}),
        ...(battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId }
          : {}),
      },
    };
  }
  const candidate = candidates[0]!;

  return executeSelectedBorrowedCardEventEffect(
    state,
    chainId,
    actingPlayerId,
    sourceInstanceId,
    targetId,
    candidate.effectIndex,
    getCardDefinitionById,
    executeEffectFn,
    getRegisteredTriggeredEffectActions,
    undefined,
    undefined,
    undefined,
    action.suppressBorrowedEffect,
    sourcePreventionLevel,
    sourcePreventionBypass,
    responseStackCandidate !== undefined ? responseTargetStack : undefined,
    candidate.grantedEffectCeId === undefined
      ? candidate.effectSourceInstanceId
      : undefined,
    candidate.grantedEffectCeId === undefined
      ? candidate.effectSourceDefinitionId
      : undefined,
    action.ignoreLevelCondition,
    action.attributeToBorrowedCard,
    battleEndDeferralAttackId,
    action.suppressResponseStack,
    candidate.grantedEffectCeId,
    getRegisteredBurstActions
  );
}

export function executeSelectedBorrowedCardEventEffect(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  sourceInstanceId: string,
  targetId: string,
  borrowedEffectIndex: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  executeEffectFn: (options: ExecuteEffectOptions) => GameState,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  selectedTargetInstanceIds?: string[],
  selectedTargetStepId?: string,
  resume?: {
    startFromStepIndex: number;
    restoredStepContext: SerializedStepContext;
    recordedUsage?: RecordedEffectUsage;
  },
  suppressBorrowedEffect?: boolean,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile,
  responseTargetStack?: ActiveStack | null,
  effectSourceInstanceIdOverride?: string,
  effectSourceDefinitionIdOverride?: string,
  ignoreLevelCondition?: boolean,
  attributeToBorrowedCard?: boolean,
  battleEndDeferralAttackId?: string,
  suppressResponseStack?: boolean,
  grantedEffectCeId?: string,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  const targetCard = getCardById(state, targetId);
  if (!targetCard) return state;
  const targetDef = getCardDefinitionById(targetCard.definitionId);
  if (!targetDef) return state;
  const grantedBorrowedEffect = getGrantedBorrowedCardEventEffect({
    state,
    targetId,
    grantedEffectCeId,
  });
  const borrowedEffectDefinition =
    grantedBorrowedEffect !== undefined
      ? targetDef
      : effectSourceDefinitionIdOverride !== undefined
        ? (getCardDefinitionById(effectSourceDefinitionIdOverride) ?? targetDef)
        : targetDef;
  const borrowedEffect =
    grantedBorrowedEffect ??
    borrowedEffectDefinition.effects?.[borrowedEffectIndex];
  if (!borrowedEffect) return state;
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinitionId = sourceCard?.definitionId ?? sourceInstanceId;
  const effectSourceInstanceId =
    effectSourceInstanceIdOverride ?? targetCard.instanceId;
  const effectSourceDefinitionId =
    effectSourceDefinitionIdOverride ?? targetDef.cardNo;
  const evaluationCard =
    getCardById(state, effectSourceInstanceId) ?? targetCard;
  // attributeToBorrowedCard: 借用先効果内の self/source_card 参照を host ではなく
  // 借用元カード自身に解決する（BSLH01-R01「セットしたCBカードの効果を発揮する」型）。
  // usage-limit 記録・ログの実行主体 (sourceInstanceId) はここでは変えない。
  const executingInstanceId = attributeToBorrowedCard
    ? targetCard.instanceId
    : sourceInstanceId;
  const isResume = resume !== undefined;
  if (
    !isResume &&
    !canUseBorrowedEffectUsageLimit({
      state,
      sourceInstanceId,
      sourceDefinitionId,
      getCardDefinitionById,
      borrowedEffectIndex,
      borrowedEffect,
    })
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_card_event_effect:usage_limit_exhausted:${targetDef.cardNo}:${borrowedEffectIndex}`,
      ],
    };
  }
  const evaluableBorrowedCondition = conditionForBorrowEvaluation(
    borrowedEffect.condition,
    ignoreLevelCondition
  );
  if (
    !isResume &&
    evaluableBorrowedCondition &&
    evaluableBorrowedCondition.length > 0 &&
    !evaluateCondition(
      state,
      evaluableBorrowedCondition,
      evaluationCard.instanceId,
      evaluationCard.controllerPlayerId,
      getCardDefinitionById
    )
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_card_event_effect:condition_unmet:${targetDef.cardNo}:${borrowedEffectIndex}`,
      ],
    };
  }
  if (
    !isResume &&
    borrowedEffect.applicability &&
    !evaluateApplicability(
      state,
      borrowedEffect.applicability,
      evaluationCard.instanceId,
      getCardDefinitionById
    )
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `borrow_card_event_effect:applicability_unmet:${targetDef.cardNo}:${borrowedEffectIndex}`,
      ],
    };
  }
  const {
    condition: _borrowedCondition,
    applicability: _borrowedApplicability,
    ...executableEffect
  } = borrowedEffect;
  const borrowedExecutableEffect =
    withBorrowedInteractiveTargetSelection(executableEffect);
  // 「発揮させず、かわりに」は応答中の効果だけを置換する。
  // 借用元の将来の発揮を止める継続効果は作らない。
  const stateWithResponseStackSuppression =
    !isResume && suppressBorrowedEffect
      ? appendBorrowedResponseStackSuppressionRequest({
          state,
          actingPlayerId,
          sourceInstanceId,
          targetDef,
          borrowedEffectIndex,
          borrowEvents:
            borrowedEffect.timing.kind === "card_event"
              ? Array.isArray(borrowedEffect.timing.event)
                ? borrowedEffect.timing.event
                : [borrowedEffect.timing.event]
              : [],
          responseTargetStack,
        })
      : state;
  const stateWithPendingStackSuppression =
    !isResume && suppressResponseStack
      ? appendResponseStackDeferralObservation({
          state: stateWithResponseStackSuppression,
          actingPlayerId,
          sourceInstanceId,
          responseTargetStack,
        })
      : stateWithResponseStackSuppression;
  const usageRecord =
    resume !== undefined
      ? {
          state: stateWithPendingStackSuppression,
          recordedUsage: resume.recordedUsage,
        }
      : recordBorrowedEffectUsage({
          state: stateWithPendingStackSuppression,
          sourceInstanceId,
          sourceDefinitionId,
          borrowedEffectIndex,
          borrowedEffect: borrowedExecutableEffect,
        });
  const result = executeEffectFn({
    state: usageRecord.state,
    effect: borrowedExecutableEffect,
    chainId,
    ...(getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions }
      : {}),
    effectIndex: borrowedEffectIndex,
    optionalStepResumeEffectOverride: borrowedExecutableEffect,
    sourceInstanceId: executingInstanceId,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    sourcePreventionLevel,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    ...(sourcePreventionBypass !== undefined ? { sourcePreventionBypass } : {}),
    ...(usageRecord.recordedUsage !== undefined
      ? { recordedUsage: usageRecord.recordedUsage }
      : {}),
    ...(selectedTargetInstanceIds !== undefined
      ? {
          targetInstanceIds: selectedTargetInstanceIds,
          targetSelectionResolved: true,
        }
      : {}),
    ...(selectedTargetStepId !== undefined
      ? { targetStepId: selectedTargetStepId }
      : {}),
    ...(resume !== undefined
      ? {
          startFromStepIndex: resume.startFromStepIndex,
          restoredStepContext: resume.restoredStepContext,
        }
      : {}),
    ...(battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId }
      : {}),
    ...(selectedTargetInstanceIds === undefined
      ? {
          onStepTargetSelection: ({
            state: pendingState,
            pending,
            stepIndex,
            stepContext,
          }) => ({
            ...pendingState,
            pendingBorrowedEffectTargetSelection:
              buildBorrowedEffectTargetSelectionFromPending({
                state: pendingState,
                pending,
                stepIndex,
                stepContext,
                actingPlayerId,
                sourceInstanceId,
                targetId,
                targetDef,
                borrowedEffectIndex,
                ...(grantedEffectCeId !== undefined
                  ? { grantedEffectCeId }
                  : {}),
                ...(usageRecord.recordedUsage !== undefined
                  ? { recordedUsage: usageRecord.recordedUsage }
                  : {}),
                effectSourceInstanceId,
                effectSourceDefinitionId,
                ...(sourcePreventionLevel !== undefined
                  ? { sourcePreventionLevel }
                  : {}),
                ...(sourcePreventionBypass !== undefined
                  ? { sourcePreventionBypass }
                  : {}),
                ...(attributeToBorrowedCard ? { attributeToBorrowedCard } : {}),
                ...(battleEndDeferralAttackId !== undefined
                  ? { battleEndDeferralAttackId }
                  : {}),
              }),
            log: [
              ...pendingState.log,
              `borrow_card_event_effect:target_pending:${targetDef.cardNo}:${borrowedEffectIndex}:step=${stepIndex}:candidates=${pending.candidateInstanceIds.length}`,
            ],
          }),
        }
      : {}),
    rangeAutoResolveStrategy: "max",
    stepTargetSelectionBypassesPreventionGate: false,
  });
  return {
    ...result,
    log: [
      ...result.log,
      `borrow_card_event_effect:executed:${effectSourceDefinitionId}:${borrowedEffectIndex}:as:${sourceInstanceId}`,
    ],
  };
}
