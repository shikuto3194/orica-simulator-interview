import { joinActiveAttackAsAction } from "../battle/battle-system";
import { moveLifeCoreByEffect } from "../core/core-system";
import { queuePendingLeave } from "../state-based-actions";
import type {
  ConditionalCostCanExecuteCheck,
  ConditionalResultSuccessCheck,
  EffectActionContext,
  HandWrittenEffectResolver,
} from "./effect-resolution";
import type {
  CardColor,
  ContinuousEffect,
  ContinuousEffectTag,
  Duration,
  EffectForceLevel,
  LeaveFieldCoreDestinationOverride,
  LifeCoreKind,
  LifeCoreMoveEffectKind,
  PendingLeaveKind,
} from "../model";
import type { GameState } from "../model";
import { getForceBlockReasonForTag } from "../legal/legal-actions-shared";

let continuousEffectSequence = 1;

function nextContinuousEffectId(modifierTag: string): string {
  const sequence = continuousEffectSequence;
  continuousEffectSequence += 1;
  return `ce-${modifierTag}-${sequence}`;
}

function getTargetInstanceIdOrThrow(
  context: EffectActionContext,
  targetIndex: number
): string {
  const targetInstanceId = context.targetInstanceIds[targetIndex];

  if (!targetInstanceId) {
    throw new Error(
      `Expected a target card at index ${targetIndex}: cardNo=${context.sourceDefinition.cardNo}`
    );
  }

  return targetInstanceId;
}

export interface LifeToTargetCardResolverOptions {
  effectKind?: LifeCoreMoveEffectKind;
  chosenCoreKind?: LifeCoreKind | null;
  targetIndex?: number;
}

export interface LifeToSourceCardResolverOptions {
  effectKind?: LifeCoreMoveEffectKind;
  chosenCoreKind?: LifeCoreKind | null;
}

export interface TargetCardPendingLeaveResolverOptions {
  pendingLeaveKind?: PendingLeaveKind;
  targetIndex?: number;
  deferZoneMoveUntilChainEnd?: boolean;
  leaveFieldCoreDestinationOverride?: LeaveFieldCoreDestinationOverride | null;
}

export interface JoinActiveAttackResolverOptions {
  targetIndex?: number;
}

export function resolveActingPlayerLifeCoreToTargetCard(
  state: GameState,
  context: EffectActionContext,
  options: LifeToTargetCardResolverOptions = {}
): GameState {
  const targetInstanceId = getTargetInstanceIdOrThrow(
    context,
    options.targetIndex ?? 0
  );
  const effectKind = options.effectKind ?? "generic";
  const currentState = moveLifeCoreByEffect({
    state,
    playerId: context.actingPlayerId,
    destination: {
      kind: "card",
      instanceId: targetInstanceId,
    },
    effectKind,
    chosenCoreKind:
      options.chosenCoreKind ?? context.chosenLifeCoreKind ?? null,
    getCardDefinitionById: context.getCardDefinitionById,
  });

  return {
    ...currentState,
    log: [
      ...currentState.log,
      `magic:effect:${context.chainId}:life-core-to-card:${targetInstanceId}:${effectKind}:${options.chosenCoreKind ?? context.chosenLifeCoreKind ?? "auto"}`,
    ],
  };
}

export function createActingPlayerLifeCoreToTargetCardResolver(
  options: LifeToTargetCardResolverOptions = {}
): HandWrittenEffectResolver {
  return (state, context) =>
    resolveActingPlayerLifeCoreToTargetCard(state, context, options);
}

export function resolveActingPlayerLifeCoreToSourceCard(
  state: GameState,
  context: EffectActionContext,
  options: LifeToSourceCardResolverOptions = {}
): GameState {
  const effectKind = options.effectKind ?? "generic";
  const currentState = moveLifeCoreByEffect({
    state,
    playerId: context.actingPlayerId,
    destination: {
      kind: "card",
      instanceId: context.sourceCard.instanceId,
    },
    effectKind,
    chosenCoreKind:
      options.chosenCoreKind ?? context.chosenLifeCoreKind ?? null,
    getCardDefinitionById: context.getCardDefinitionById,
  });

  return {
    ...currentState,
    log: [
      ...currentState.log,
      `magic:effect:${context.chainId}:life-core-to-source-card:${context.sourceCard.instanceId}:${effectKind}:${options.chosenCoreKind ?? context.chosenLifeCoreKind ?? "auto"}`,
    ],
  };
}

export function createActingPlayerLifeCoreToSourceCardResolver(
  options: LifeToSourceCardResolverOptions = {}
): HandWrittenEffectResolver {
  return (state, context) =>
    resolveActingPlayerLifeCoreToSourceCard(state, context, options);
}

export function resolveTargetCardPendingLeave(
  state: GameState,
  context: EffectActionContext,
  options: TargetCardPendingLeaveResolverOptions = {}
): GameState {
  const targetInstanceId = getTargetInstanceIdOrThrow(
    context,
    options.targetIndex ?? 0
  );
  const pendingLeaveKind = options.pendingLeaveKind ?? "destroy";
  const currentState = queuePendingLeave({
    state,
    instanceId: targetInstanceId,
    kind: pendingLeaveKind,
    cause: "effect_resolution",
    causePlayerId: context.actingPlayerId,
    chainId: context.chainId,
    deferZoneMoveUntilChainEnd: options.deferZoneMoveUntilChainEnd ?? false,
    leaveFieldCoreDestinationOverride:
      options.leaveFieldCoreDestinationOverride ?? null,
    causedByEffectSourceInstanceId:
      context.effectSourceInstanceId ?? context.sourceCard.instanceId,
  });

  return {
    ...currentState,
    log: [
      ...currentState.log,
      `effect:resolver:${context.chainId}:pending-leave:${targetInstanceId}:${pendingLeaveKind}`,
    ],
  };
}

export function createTargetCardPendingLeaveResolver(
  options: TargetCardPendingLeaveResolverOptions = {}
): HandWrittenEffectResolver {
  return (state, context) =>
    resolveTargetCardPendingLeave(state, context, options);
}

export function resolveTargetCardJoinActiveAttack(
  state: GameState,
  context: EffectActionContext,
  options: JoinActiveAttackResolverOptions = {}
): GameState {
  const targetInstanceId = getTargetInstanceIdOrThrow(
    context,
    options.targetIndex ?? 0
  );
  const joinedState = joinActiveAttackAsAction({
    state,
    actingPlayerId: context.actingPlayerId,
    sourceInstanceId: targetInstanceId,
    getCardDefinitionById: context.getCardDefinitionById,
    ...(context.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            context.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  }).state;

  return {
    ...joinedState,
    log: [
      ...joinedState.log,
      `effect:resolver:${context.chainId}:join-active-attack:${targetInstanceId}`,
    ],
  };
}

export function createTargetCardJoinActiveAttackResolver(
  options: JoinActiveAttackResolverOptions = {}
): HandWrittenEffectResolver {
  return (state, context) =>
    resolveTargetCardJoinActiveAttack(state, context, options);
}

// ── ContinuousEffect 生成 resolver ──────────────────────────

export interface ContinuousEffectResolverOptions {
  /** 効果の中身を表すタグ。 */
  modifierTag: ContinuousEffectTag;
  /** 持続期間。省略時は { scope: "turn" }。 */
  duration?: Duration;
  /** 修飾量 (BP 増減など)。効果によっては不要。 */
  modifierAmount?: number;
  /**
   * 追加シンボル色 (symbol_addition 用)。
   * - 単色: 配列に1要素 (例: ["red"])
   * - dual-color: 複数要素 (例: ["red", "purple"])
   */
  modifierSymbol?: CardColor[];
  /** ターゲット index (context.targetInstanceIds 内)。省略時は 0。 */
  targetIndex?: number;
  /** 効果の優先度。省略時は context.forceLevel ?? "normal"。 */
  forceLevel?: EffectForceLevel;
}

/**
 * ターゲットカードに ContinuousEffect を登録する resolver。
 * defense_immune / defense_suppress / bp_modifier 等を生成する汎用経路。
 */
export function resolveContinuousEffectOnTarget(
  state: GameState,
  context: EffectActionContext,
  options: ContinuousEffectResolverOptions
): GameState {
  const targetInstanceId = getTargetInstanceIdOrThrow(
    context,
    options.targetIndex ?? 0
  );
  const effectForceLevel = options.forceLevel ?? context.forceLevel ?? "normal";

  // forceLevel 競合チェック: 対象に同タグの より高い forceLevel の CE があればブロック
  const blockReason = getForceBlockReasonForTag(
    state,
    targetInstanceId,
    options.modifierTag,
    effectForceLevel
  );
  if (blockReason !== null) {
    state.log.push(
      `continuous-effect:blocked:${options.modifierTag}:${targetInstanceId}:${blockReason}`
    );
    return {
      ...state,
    };
  }

  const duration: Duration = options.duration ?? { scope: "turn" };
  const effectId = nextContinuousEffectId(options.modifierTag);

  const newEffect: ContinuousEffect = {
    effectId,
    sourceInstanceId: context.sourceCard.instanceId,
    sourceDefinitionId: context.sourceDefinition.cardNo,
    actingPlayerId: context.actingPlayerId,
    duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: options.modifierTag,
    ...(options.modifierAmount !== undefined
      ? { modifierAmount: options.modifierAmount }
      : {}),
    ...(options.modifierSymbol !== undefined
      ? { modifierSymbol: options.modifierSymbol }
      : {}),
    targetInstanceId,
    ...(effectForceLevel !== "normal" ? { forceLevel: effectForceLevel } : {}),
  };

  state.log.push(
    `continuous-effect:registered:${effectId}:${options.modifierTag}:${targetInstanceId}:${duration}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function createContinuousEffectOnTargetResolver(
  options: ContinuousEffectResolverOptions
): HandWrittenEffectResolver {
  return (state, context) =>
    resolveContinuousEffectOnTarget(state, context, options);
}

// ── Simultaneous composition resolver ─────────────────────────

/**
 * 複数の resolver を「さらに」(simultaneous) として結合し、
 * 1 つの atomic な resolver として返す。
 *
 * すべてのステップは SBA や誘発収集を挟まずに連続実行される。
 * SBA / 誘発収集は呼び出し元 (runActionMainResolution 等) が
 * 結合 resolver の実行後にまとめて行う。
 */
export function createSimultaneousCompositionResolver(
  resolvers: readonly HandWrittenEffectResolver[]
): HandWrittenEffectResolver {
  return (state, context) => {
    let currentState = state;
    for (const resolver of resolvers) {
      currentState = resolver(currentState, context);
    }
    return currentState;
  };
}

// ── Conditional-cost composition resolver ─────────────────────

/**
 * 「○○することで△△する」(ことで構文) の双方向チェック付き resolver。
 *
 * 実行フロー:
 * 1. canExecuteCost チェック — コスト (step 0) が現在の state で払えるか
 * 2. costResolver を試行実行 — コスト支払い後の state を取得
 * 3. canExecuteResult チェック — 結果 (step 1) がコスト支払い後の state で実行可能か
 * 4. 両方パスした場合のみ resultResolver を実行して最終 state を返す
 * 5. いずれかが不可なら元の state をそのまま返す (部分実行しない)
 *
 * canExecute チェックが未提供のステップは常に実行可能と見なす。
 */
export function createConditionalCostCompositionResolver(
  costResolver: HandWrittenEffectResolver,
  resultResolver: HandWrittenEffectResolver,
  canExecuteCost?: ConditionalCostCanExecuteCheck,
  canExecuteResult?: ConditionalCostCanExecuteCheck
): HandWrittenEffectResolver {
  return (state, context) => {
    // Step 0 pre-check: can cost be paid?
    if (canExecuteCost && !canExecuteCost(state, context)) {
      return state;
    }

    // Trial-execute cost to get post-cost state
    const postCostState = costResolver(state, context);

    // Step 1 pre-check: can result execute in post-cost state?
    if (canExecuteResult && !canExecuteResult(postCostState, context)) {
      return state; // Rollback — return original state
    }

    // Both checks passed — commit
    return resultResolver(postCostState, context);
  };
}

/**
 * 「○○できる。そうしたとき、△△する」(conditional_result 構文) の resolver。
 *
 * 実行フロー:
 * 1. actionResolver (step 0) を実行する — ○○ の部分
 * 2. successCheck で step 0 が「成功した」か判定する (pre/post state を比較)
 * 3. 成功した場合のみ resultResolver (step 1) を実行して最終 state を返す
 * 4. 失敗した場合は step 0 の結果 state をそのまま返す (step 0 はロールバックしない)
 *
 * successCheck が未提供の場合は常に成功と見なし step 1 も実行する。
 */
export function createConditionalResultCompositionResolver(
  actionResolver: HandWrittenEffectResolver,
  resultResolver: HandWrittenEffectResolver,
  successCheck?: ConditionalResultSuccessCheck
): HandWrittenEffectResolver {
  return (state, context) => {
    // Execute step 0 (the action — always runs)
    const postActionState = actionResolver(state, context);

    // Check if the action succeeded
    if (successCheck && !successCheck(state, postActionState, context)) {
      return postActionState; // Action ran but didn't succeed — no follow-up
    }

    // Action succeeded — execute result
    return resultResolver(postActionState, context);
  };
}
