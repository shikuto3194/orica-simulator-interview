// ============================================================
// retrigger-system.ts — 条件付き再発火効果の実行エンジン
// ============================================================
//
// フラッシュ等で登録された retrigger 効果を、
// 指定イベント（アタック等）発生時にマッチ・実行する。
//
// P3-15 問題6 対応 (2026-04-17): retrigger は ContinuousEffect に統合され、
// state.activeContinuousEffects 内で `modifierTag === "retrigger"` の CE として管理される。
// 本モジュールはその CE サブセットに対する event-driven 処理を提供する。

import { cloneStateForTriggerDelta } from "./native-effect-front-helpers";
import type {
  CardDefinition,
  CardEventType,
  CardInstance,
  ContinuousEffect,
  GameState,
  PendingRetriggerContinuation,
  RetriggerEffect,
  RetriggerTriggerFilter,
} from "../model";
import { executeEffect } from "./effect-interpreter";
import { updateCommittedContinuousEffects } from "./pending-resolution-policy";
import { collectAndQueueTriggerReactions } from "./trigger-system";
import type {
  TriggeredEffectActionRegistrationLookup,
  BurstActionRegistrationLookup,
} from "./trigger-system";
import {
  getCombinedUnitBp,
  getEffectiveColors,
  getEffectiveTribes,
  isDurationActiveAtTurn,
} from "../legal/legal-actions-shared";
import { autoResumePendingOptionalSteps } from "./optional-step-auto-resume";
import {
  getAdditionalCosts,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";

// ============================================================
// Public API
// ============================================================

export interface ExecuteRetriggersOptions {
  state: GameState;
  event: CardEventType;
  /** イベントを起こしたカード（例: アタックしたスピリット） */
  triggerCard: CardInstance;
  /** イベントを起こしたカードの定義 */
  triggerCardDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions?:
    | TriggeredEffectActionRegistrationLookup
    | undefined;
  getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
}

interface ExecuteRetriggerListOptions extends ExecuteRetriggersOptions {
  retriggers: readonly RetriggerEffect[];
}

/** CE が retrigger バリアントか判定する型ガード。 */
export function isRetriggerCE(ce: ContinuousEffect): ce is RetriggerEffect {
  return ce.modifierTag === "retrigger";
}

/**
 * 条件付き再発火効果を検索・実行する。
 *
 * イベント発生時に activeContinuousEffects 内の retrigger CE からマッチするものを探し、
 * 各効果のアクションを実行して retriggerFireCount をインクリメントする。
 * retriggerMaxCount に達した効果は除去する。
 */
export function executeMatchingRetriggers(
  options: ExecuteRetriggersOptions
): GameState {
  const currentState = options.state;
  const { event, triggerCard, triggerCardDefinition, getCardDefinitionById } =
    options;
  if (hasBlockingRetriggerPending(currentState)) return currentState;

  const retriggerCEs =
    currentState.activeContinuousEffects.filter(isRetriggerCE);
  const matchingRetriggers = retriggerCEs.filter((rt) =>
    isRetriggerMatch(
      rt,
      event,
      triggerCard,
      triggerCardDefinition,
      currentState,
      getCardDefinitionById
    )
  );
  const orderedMatchingRetriggers = [...matchingRetriggers].sort(
    (a, b) =>
      Number(isPotentiallyBlockingRetrigger(a)) -
      Number(isPotentiallyBlockingRetrigger(b))
  );

  if (orderedMatchingRetriggers.length === 0) return currentState;

  return executeRetriggerList({
    ...options,
    state: currentState,
    event,
    triggerCard,
    triggerCardDefinition,
    getCardDefinitionById,
    retriggers: orderedMatchingRetriggers,
  });
}

export function resumePendingRetriggerContinuations(options: {
  state: GameState;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions?:
    | TriggeredEffectActionRegistrationLookup
    | undefined;
  getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
}): GameState {
  let currentState = options.state;
  if (hasBlockingRetriggerPending(currentState)) return currentState;

  while (
    currentState.pendingRetriggerContinuations.length > 0 &&
    !hasBlockingRetriggerPending(currentState)
  ) {
    const [continuation, ...rest] = currentState.pendingRetriggerContinuations;
    if (!continuation) break;

    currentState = {
      ...currentState,
      pendingRetriggerContinuations: rest,
    };

    const triggerDef =
      options.getCardDefinitionById(continuation.triggerCardDefinitionId) ??
      options.getCardDefinitionById(continuation.triggerCard.definitionId);
    if (!triggerDef) {
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `retrigger:continuation-skipped:${continuation.continuationId}:missing-trigger-def`,
        ],
      };
      continue;
    }

    const remainingOrder = new Map(
      continuation.remainingEffectIds.map((effectId, index) => [
        effectId,
        index,
      ])
    );
    const retriggers = currentState.activeContinuousEffects
      .filter(isRetriggerCE)
      .filter((rt) => remainingOrder.has(rt.effectId))
      .sort(
        (a, b) =>
          remainingOrder.get(a.effectId)! - remainingOrder.get(b.effectId)!
      );

    if (retriggers.length === 0) {
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `retrigger:continuation-skipped:${continuation.continuationId}:empty`,
        ],
      };
      continue;
    }

    currentState = executeRetriggerList({
      ...options,
      state: currentState,
      event: continuation.event,
      triggerCard: continuation.triggerCard,
      triggerCardDefinition: triggerDef,
      getCardDefinitionById: options.getCardDefinitionById,
      retriggers,
    });
  }

  return currentState;
}

function executeRetriggerList(options: ExecuteRetriggerListOptions): GameState {
  let currentState = options.state;
  const { event, triggerCard, triggerCardDefinition, getCardDefinitionById } =
    options;

  for (let index = 0; index < options.retriggers.length; index += 1) {
    const rt = options.retriggers[index]!;
    // maxCount は isRetriggerMatch で検査済み（matchingRetriggers スナップショット内で同一 rt の fireCount は増えないため再チェック不要）

    // ソースカードの定義を取得して effects からステップを取得
    const sourceDef = getCardDefinitionById(rt.sourceDefinitionId);
    if (!sourceDef?.effects) continue;

    const sourceEffect = sourceDef.effects[rt.retriggerEffectIndex];
    if (!sourceEffect) continue;

    const step = sourceEffect.steps[rt.retriggerStepIndex];
    if (!step) continue;

    // 再発火用の一時 Effect を構築（元の timing は retrigger 元のまま、steps はこのステップだけ）。
    // retrigger は再帰防止、stepCondition/connector は登録時ゲートなので発火時は除去する。
    const {
      retrigger: _removed,
      stepCondition: _registrationStepCondition,
      connector: _registrationConnector,
      ...stepWithoutRetrigger
    } = step;
    const stepForFire =
      rt.retriggerFireExecutionMode !== undefined
        ? {
            ...stepWithoutRetrigger,
            executionMode: rt.retriggerFireExecutionMode,
          }
        : stepWithoutRetrigger;
    const {
      condition: _registrationCondition,
      applicability: _registrationApplicability,
      usageLimit: _registrationUsageLimit,
      ...sourceEffectForFire
    } = sourceEffect;
    const retriggerEffect = {
      ...sourceEffectForFire,
      steps: [stepForFire],
    };

    currentState.log.push(
      `retrigger:fire:${rt.effectId}:count=${rt.retriggerFireCount + 1}/${rt.retriggerMaxCount ?? "unlimited"}`
    );

    const beforeRetrigger = cloneStateForTriggerDelta(currentState);
    const chainId = `retrigger:${rt.effectId}:${rt.retriggerFireCount + 1}`;
    currentState = executeEffect({
      chainId,
      state: currentState,
      effect: retriggerEffect,
      effectIndex: rt.retriggerEffectIndex,
      sourceInstanceId: rt.sourceInstanceId,
      actingPlayerId: rt.actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
      ...(options.getRegisteredBurstActions
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      // pendingEffectTargetSelection を経由しない直接再実行のため、範囲ターゲット
      // ({min,max}) の自動解決は静的 min (=常に0選択の無音no-op) ではなく静的 max を
      // 採用する (ENGINE-retrigger-range-count-target-fallback)。
      rangeAutoResolveStrategy: "max",
      triggerRelatedInstanceId: triggerCard.instanceId,
      triggerRelatedInstanceIds: [triggerCard.instanceId],
      optionalStepResumeEffectOverride: retriggerEffect,
    });
    if (rt.retriggerAutoResolveOptional !== false) {
      // 再発火先 step が executionMode:"optional" だと executeEffect は
      // pendingStepOptionalChoice を積んで中断する。既定では従来どおり execute 側を
      // 自動 resume する (ENGINE-borrow-retrigger-optional-step-no-resume)。
      currentState = autoResumePendingOptionalSteps({
        state: currentState,
        effect: retriggerEffect,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions ?? (() => []),
        executeEffectFn: executeEffect,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
      });
    }

    // retriggerFireCount をインクリメント
    currentState = updateCommittedContinuousEffects(currentState, (effects) =>
      effects.map((existing) =>
        isRetriggerCE(existing) && existing.effectId === rt.effectId
          ? {
              ...existing,
              retriggerFireCount: existing.retriggerFireCount + 1,
            }
          : existing
      )
    );
    currentState = collectAndQueueTriggerReactions({
      afterState: currentState,
      beforeState: beforeRetrigger,
      chainId,
      source: "action_resolution",
      causedByPlayerId: rt.actingPlayerId,
      causedBySourceInstanceId: rt.sourceInstanceId,
      enterFieldCausedByPlayerId: rt.actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    if (hasBlockingRetriggerPending(currentState)) {
      const remainingEffectIds = options.retriggers
        .slice(index + 1)
        .map((remaining) => remaining.effectId);
      if (remainingEffectIds.length > 0) {
        const continuation = buildPendingRetriggerContinuation({
          state: currentState,
          event,
          triggerCard,
          triggerCardDefinition,
          remainingEffectIds,
        });
        currentState = {
          ...currentState,
          pendingRetriggerContinuations: [
            ...currentState.pendingRetriggerContinuations,
            continuation,
          ],
          log: [
            ...currentState.log,
            `retrigger:continuation-pending:${continuation.continuationId}:remaining=${remainingEffectIds.length}`,
          ],
        };
      }
      break;
    }
  }

  // maxCount に達した retrigger CE を除去
  const exhaustedIds: string[] = [];
  const isExhausted = (ce: ContinuousEffect): boolean =>
    isRetriggerCE(ce) &&
    ce.retriggerMaxCount !== undefined &&
    ce.retriggerFireCount >= ce.retriggerMaxCount;
  for (const ce of currentState.activeContinuousEffects) {
    if (isExhausted(ce)) exhaustedIds.push(ce.effectId);
  }
  currentState = updateCommittedContinuousEffects(currentState, (effects) =>
    effects.filter((ce) => !isExhausted(ce))
  );

  if (exhaustedIds.length > 0) {
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        ...exhaustedIds.map((id) => `retrigger:exhausted:${id}`),
      ],
    };
  }

  return currentState;
}

function buildPendingRetriggerContinuation(args: {
  state: GameState;
  event: CardEventType;
  triggerCard: CardInstance;
  triggerCardDefinition: CardDefinition;
  remainingEffectIds: readonly string[];
}): PendingRetriggerContinuation {
  return {
    continuationId: `rtc:${args.event}:${args.triggerCard.instanceId}:${args.state.turnNumber}:${args.state.pendingRetriggerContinuations.length}`,
    event: args.event,
    triggerCard: { ...args.triggerCard },
    triggerCardDefinitionId: args.triggerCardDefinition.cardNo,
    remainingEffectIds: [...args.remainingEffectIds],
  };
}

function isPotentiallyBlockingRetrigger(rt: RetriggerEffect): boolean {
  return rt.retriggerAutoResolveOptional === false;
}

function hasBlockingRetriggerPending(state: GameState): boolean {
  return (
    state.pendingDeckReveal !== null ||
    state.pendingZoneSelection !== null ||
    state.pendingStepOptionalChoice !== null ||
    state.pendingStepChoice !== null ||
    state.pendingStepOptionalTargetSelection !== null ||
    state.pendingCoreShootSelection !== null ||
    state.pendingAsIfSoulCoreChoice !== null ||
    state.pendingEffectOptionalRepeatChoice !== null ||
    state.pendingEffectOptionalRepeatCountSelection !== null ||
    state.pendingBorrowedEffectChoice !== null ||
    state.pendingBorrowedEffectTargetSelection !== null ||
    state.pendingCoreSplitSelection !== null ||
    state.pendingSplitSummonChoice !== null ||
    state.pendingTargetRedirects.length > 0 ||
    state.pendingCoreDistribution !== null ||
    state.pendingChangeCleanupChoice !== null ||
    state.pendingCoreSourceAllocation !== null ||
    state.pendingLinkAidCostSourceChoice !== null ||
    state.pendingEffectSummonCostPayment !== null ||
    state.pendingLifeCoreSelection !== null ||
    state.pendingLifeDamageDiscardChoice !== null ||
    state.pendingLifeGainReplacementChoice !== null ||
    state.pendingEnterFieldPlacement !== null ||
    state.pendingBraveCombineChoice !== null ||
    state.pendingMultiPlacement !== null ||
    state.pendingSetAsideExitReplacementChoice !== null
  );
}

// ============================================================
// Internal — マッチング
// ============================================================

function isRetriggerMatch(
  rt: RetriggerEffect,
  event: CardEventType,
  triggerCard: CardInstance,
  triggerCardDef: CardDefinition,
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  // イベント種別チェック
  if (rt.retriggerEvent !== event) return false;

  // プレイヤーチェック
  const triggerPlayerResolved = resolveTriggerPlayer(
    rt.retriggerPlayer,
    rt.actingPlayerId,
    state
  );
  if (
    triggerPlayerResolved !== null &&
    triggerCard.controllerPlayerId !== triggerPlayerResolved
  )
    return false;

  // フィルタチェック
  if (rt.retriggerFilter) {
    if (
      !matchesTriggerFilter(
        triggerCard,
        triggerCardDef,
        rt.retriggerFilter,
        state,
        getCardDefinitionById
      )
    )
      return false;
  }

  // duration チェック（turn スコープの場合、turns/next を加味した有効ウィンドウ内か）
  // P3-15 問題5 対応: `isDurationActiveAtTurn` に判定集約。
  if (!isDurationActiveAtTurn(rt.duration, rt.createdAtTurn, state.turnNumber))
    return false;

  // maxCount チェック
  if (
    rt.retriggerMaxCount !== undefined &&
    rt.retriggerFireCount >= rt.retriggerMaxCount
  )
    return false;

  return true;
}

function resolveTriggerPlayer(
  playerRef: "self" | "opponent" | "either",
  actingPlayerId: string,
  state: GameState
): string | null {
  if (playerRef === "either") return null; // any player matches
  if (playerRef === "self") return actingPlayerId;
  const opponent = state.players.find((p) => p.id !== actingPlayerId);
  return opponent?.id ?? actingPlayerId;
}

function matchesTriggerFilter(
  card: CardInstance,
  cardDef: CardDefinition,
  filter: RetriggerTriggerFilter,
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const effectiveBp =
    filter.minBp !== undefined || filter.maxBp !== undefined
      ? getTriggerFilterEffectiveBp(state, card, cardDef, getCardDefinitionById)
      : undefined;
  return matchesCardReferenceFilter(card, cardDef, filter, {
    state,
    effectiveColors: getEffectiveColors(state, card, cardDef),
    effectiveTribes: getEffectiveTribes(
      state,
      card,
      cardDef,
      getCardDefinitionById
    ),
    additionalCosts: getAdditionalCosts(state, card.instanceId),
    coreCount:
      card.zone === "field"
        ? getTotalCoresOnCardById(state, card.instanceId)
        : undefined,
    effectiveLevel:
      card.zone === "field"
        ? getEffectiveLevel(state, card, cardDef, getCardDefinitionById)
        : undefined,
    effectiveSymbolCount:
      card.zone === "field"
        ? getCombinedUnitSymbolCount(
            state,
            card,
            cardDef,
            getCardDefinitionById
          )
        : undefined,
    ...(effectiveBp !== undefined ? { effectiveBp } : {}),
  });
}

function getTriggerFilterEffectiveBp(
  state: GameState,
  card: CardInstance,
  cardDef: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  const battleEntity = state.battleEntities.find((entity) =>
    entity.memberInstanceIds.includes(card.instanceId)
  );
  if (battleEntity) return battleEntity.resolvedBp;

  return getCombinedUnitBp(state, card, cardDef, getCardDefinitionById);
}
