// P2-14 inc8: effect-interpreter god-file 分解。step condition 評価・connector セマンティクス
// (evaluateStepCondition / handleConnector / attachPostResolutionOracleToNewPending) を兄弟へ抽出。
// 親ローカル関数を逆参照しない leaf のため一方向 import。barrel/振る舞い不変。

import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  getAdditionalCosts,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  getEffectiveColors,
  getEffectiveTribes,
  getEffectiveCost,
  recomputeContinuousEffects,
} from "../legal/legal-actions-shared";
import { runStateBasedActions } from "../state-based-actions";
import { getStepResult } from "../step-execution-context";
import { flushPendingLeavesAndQueueReactions } from "../zone/pending-leave-flush";
import { recomputeAndRebuildContinuousEffects } from "./continuous-effect-rebuild";
import { executeSuppressPendingLeaveEffects } from "./native-move-core-handlers";
import { collectEstablishedLeaveOutcomes } from "./leave-outcome";
import { canExecuteRebirthNow } from "./structured-card-replacement";
import { canExecuteSummonSelfNow } from "./structured-summon";
import { collectAndQueueTriggerReactions } from "./trigger-system";
import type { Connector, EffectStep, StepCondition } from "../dsl-types";
import type {
  CardDefinition,
  GameState,
  PendingLeaveKind,
  PendingTriggeredEffect,
  PostResolutionOracleTrigger,
} from "../model";
import type { StepExecutionContext } from "../step-execution-context";

function resolvedSourceKeysContain(
  resolvedKeys: Set<string>,
  sourceKey: string
): boolean {
  if (resolvedKeys.has(sourceKey)) return true;
  const sourceInstanceId = sourceKey.split("#", 1)[0];
  return sourceInstanceId !== undefined && resolvedKeys.has(sourceInstanceId);
}

function hasUnresolvedLeaveFieldReplacementSourceKey(
  pending: PendingTriggeredEffect
): boolean {
  const sourceKeys = pending.registeredLeaveFieldStayOnFieldSourceKeys;
  if (!sourceKeys || sourceKeys.length === 0) return false;
  const resolvedKeys = new Set(pending.resolvedSourceRegistrationKeys ?? []);
  return sourceKeys.some(
    (sourceKey) => !resolvedSourceKeysContain(resolvedKeys, sourceKey)
  );
}

function isPendingEffectRelatedToInstance(
  pending: PendingTriggeredEffect,
  instanceId: string
): boolean {
  if (pending.relatedInstanceId === instanceId) return true;
  if (pending.relatedInstanceIds?.includes(instanceId)) return true;
  if (pending.relatedInstanceIdsBySourceRegistrationKey !== undefined) {
    return Object.values(
      pending.relatedInstanceIdsBySourceRegistrationKey
    ).some((ids) => ids.includes(instanceId));
  }
  return false;
}

function hasPendingLeaveFieldReplacementReaction(
  state: GameState,
  instanceId: string,
  leaveKind: PendingLeaveKind
): boolean {
  return state.pendingTriggeredEffects.some(
    (pending) =>
      pending.eventKind === leaveKind &&
      isPendingEffectRelatedToInstance(pending, instanceId) &&
      hasUnresolvedLeaveFieldReplacementSourceKey(pending)
  );
}

function getInlineSuppressPendingLeaveTargetIds(
  currentStep: EffectStep,
  stepCtx: StepExecutionContext,
  state: GameState,
  sourceInstanceId: string
): string[] | null {
  const action = currentStep.action;
  if (action.kind !== "suppress_pending_leave_effects") return null;
  const target = action.target;
  if (target.kind === "ref") {
    const result = getStepResult(stepCtx, target.stepId);
    return result?.affectedCardInstanceIds ?? [];
  }
  if (target.kind === "pending_leave_caused_by_effect_source") {
    return state.pendingLeaveEntities
      .filter(
        (pendingLeave) =>
          pendingLeave.causedByEffectSourceInstanceId === sourceInstanceId &&
          pendingLeave.blockedByResistance !== true
      )
      .map((pendingLeave) => pendingLeave.instanceId);
  }
  return null;
}

function annotateStepResultLeaveKinds(
  stepCtx: StepExecutionContext,
  state: GameState,
  beforeState: GameState,
  stepId: string
): void {
  const result = getStepResult(stepCtx, stepId);
  if (!result) return;
  result.establishedLeaveKindsByCardId = {
    ...result.establishedLeaveKindsByCardId,
    ...collectEstablishedLeaveOutcomes(beforeState, state),
  };

  const previousPendingKindById = new Map<string, PendingLeaveKind>();
  for (const card of beforeState.cardInstances) {
    if (card.pendingLeaveKind !== null) {
      previousPendingKindById.set(card.instanceId, card.pendingLeaveKind);
    }
  }
  for (const pendingLeave of beforeState.pendingLeaveEntities) {
    if (pendingLeave.blockedByResistance === true) continue;
    previousPendingKindById.set(pendingLeave.instanceId, pendingLeave.kind);
  }

  const kindById = new Map<string, PendingLeaveKind>();
  for (const card of state.cardInstances) {
    if (
      card.pendingLeaveKind !== null &&
      previousPendingKindById.get(card.instanceId) !== card.pendingLeaveKind
    ) {
      kindById.set(card.instanceId, card.pendingLeaveKind);
    }
  }
  for (const pendingLeave of state.pendingLeaveEntities) {
    if (pendingLeave.blockedByResistance === true) continue;
    if (
      previousPendingKindById.get(pendingLeave.instanceId) !== pendingLeave.kind
    ) {
      kindById.set(pendingLeave.instanceId, pendingLeave.kind);
    }
  }

  if (kindById.size === 0) return;
  let nextKinds = result.leftFieldKindsByCardId;
  for (const id of result.affectedCardInstanceIds) {
    const kind = kindById.get(id);
    if (kind === undefined) continue;
    nextKinds = { ...(nextKinds ?? {}), [id]: kind };
  }
  if (nextKinds) {
    result.leftFieldKindsByCardId = nextKinds;
  }
}

export function attachPostResolutionOracleToNewPending(
  state: GameState,
  beforeState: GameState,
  postResolutionOracle: PostResolutionOracleTrigger
): GameState {
  let next = state;
  if (
    next.pendingDeckReveal !== null &&
    beforeState.pendingDeckReveal === null &&
    next.pendingDeckReveal.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingDeckReveal: { ...next.pendingDeckReveal, postResolutionOracle },
    };
  }
  if (
    next.pendingCoreShootSelection !== null &&
    beforeState.pendingCoreShootSelection === null &&
    next.pendingCoreShootSelection.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingCoreShootSelection: {
        ...next.pendingCoreShootSelection,
        postResolutionOracle,
      },
    };
  }
  if (
    next.pendingCoreSplitSelection !== null &&
    beforeState.pendingCoreSplitSelection === null &&
    next.pendingCoreSplitSelection.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingCoreSplitSelection: {
        ...next.pendingCoreSplitSelection,
        postResolutionOracle,
      },
    };
  }
  if (
    next.pendingCoreCountSelection !== null &&
    beforeState.pendingCoreCountSelection === null &&
    next.pendingCoreCountSelection.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingCoreCountSelection: {
        ...next.pendingCoreCountSelection,
        postResolutionOracle,
      },
    };
  }
  if (
    next.pendingCountSelection !== null &&
    beforeState.pendingCountSelection === null &&
    next.pendingCountSelection.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingCountSelection: {
        ...next.pendingCountSelection,
        postResolutionOracle,
      },
    };
  }
  if (
    next.pendingEnterFieldPlacement !== null &&
    beforeState.pendingEnterFieldPlacement === null &&
    next.pendingEnterFieldPlacement.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingEnterFieldPlacement: {
        ...next.pendingEnterFieldPlacement,
        ...(next.pendingEnterFieldPlacement.deferredStack
          ? {
              deferredStack: {
                ...next.pendingEnterFieldPlacement.deferredStack,
                postResolutionOracle,
              },
            }
          : {}),
        postResolutionOracle,
      },
    };
  }
  if (
    next.pendingBraveCombineChoice !== null &&
    beforeState.pendingBraveCombineChoice === null &&
    next.pendingBraveCombineChoice.postResolutionOracle === undefined
  ) {
    next = {
      ...next,
      pendingBraveCombineChoice: {
        ...next.pendingBraveCombineChoice,
        ...(next.pendingBraveCombineChoice.deferredStack
          ? {
              deferredStack: {
                ...next.pendingBraveCombineChoice.deferredStack,
                postResolutionOracle,
              },
            }
          : {}),
        postResolutionOracle,
      },
    };
  }
  return next;
}

// ============================================================
// Applicability 評価
// ============================================================

export function evaluateStepCondition(
  condition: StepCondition,
  stepCtx: StepExecutionContext,
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const raw = evaluateStepConditionRaw(
    condition,
    stepCtx,
    state,
    getCardDefinitionById
  );
  return condition.not ? !raw : raw;
}

function evaluateStepConditionRaw(
  condition: StepCondition,
  stepCtx: StepExecutionContext,
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  switch (condition.kind) {
    case "ref_cost_pattern": {
      const ids = new Set(
        condition.stepIds.flatMap((id) => {
          const result = getStepResult(stepCtx, id);
          return (
            result?.revealedCardInstanceIds ??
            result?.affectedCardInstanceIds ??
            []
          );
        })
      );
      const costs = [...ids].flatMap((id) => {
        const card = state.cardInstances.find(
          (entry) => entry.instanceId === id
        );
        const def = card && getCardDefinitionById(card.definitionId);
        return def && card
          ? [getEffectiveCost(state, card, def, getCardDefinitionById)]
          : [];
      });
      const counts = new Map<number, number>();
      for (const cost of costs) counts.set(cost, (counts.get(cost) ?? 0) + 1);
      const multiplicities = [...counts.values()].sort((a, b) => b - a);
      const sorted = [...counts.keys()].sort((a, b) => a - b);
      let matched = -1;
      condition.patterns.forEach((pattern, index) => {
        const matches =
          "groups" in pattern
            ? [...pattern.groups]
                .sort((a, b) => b - a)
                .every((n, i) => (multiplicities[i] ?? 0) >= n)
            : costs.length === pattern.consecutive &&
              sorted.length === pattern.consecutive &&
              sorted.every((cost, i) => i === 0 || cost === sorted[i - 1]! + 1);
        if (matches) matched = index;
      });
      return matched === condition.matchIndex;
    }
    case "all":
      return condition.conditions.every((child) =>
        evaluateStepCondition(child, stepCtx, state, getCardDefinitionById)
      );

    case "ref_succeeded": {
      const result = getStepResult(stepCtx, condition.stepId);
      return result ? result.succeeded : false;
    }

    case "ref_executed": {
      const result = getStepResult(stepCtx, condition.stepId);
      return result ? result.executed === true : false;
    }

    case "ref_blocked_by_opponent_effect": {
      const result = getStepResult(stepCtx, condition.stepId);
      return result ? result.blockedByOpponentEffect === true : false;
    }

    case "ref_count": {
      const result = getStepResult(stepCtx, condition.stepId);
      const count = result
        ? condition.result === "bp_became_zero"
          ? (result.bpBecameZeroCardInstanceIds?.length ?? 0)
          : condition.result === "hand_added"
            ? (result.handAddedCardInstanceIds?.length ?? 0)
            : condition.result === "numeric_amount"
              ? (result.numericAmount ?? 0)
              : result.affectedCardInstanceIds.length
        : 0;
      const min = condition.min ?? 1;
      if (count < min) return false;
      if (condition.max !== undefined && count > condition.max) return false;
      return true;
    }

    case "ref_has_color": {
      const result = getStepResult(stepCtx, condition.stepId);
      if (!result) return false;
      const matchedCount = result.affectedCardInstanceIds.reduce((acc, id) => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        if (!card) return acc;
        const def = getCardDefinitionById(card.definitionId);
        if (!def) return acc;
        const effColors = getEffectiveColors(state, card, def);
        return condition.colors.some((col) => effColors.includes(col))
          ? acc + 1
          : acc;
      }, 0);
      const min = condition.minCount ?? 1;
      if (matchedCount < min) return false;
      if (condition.maxCount !== undefined && matchedCount > condition.maxCount)
        return false;
      return true;
    }

    case "ref_has_match": {
      const result = getStepResult(stepCtx, condition.stepId);
      if (!result) return false;
      // `ownerRelation` は CardFilter に軸が無い「解決後の所有者」判定のため、
      // 効果発動元カード (`sourceInstanceId`) の ownerPlayerId を基準に別途評価する。
      // 発動元が解決不能 (継続修飾等) なら fail-closed で全件非マッチにする
      // (tribesMatchRef 等と同じ番兵方針、誤って全対象にマッチしないようにする)。
      const sourceOwnerPlayerId = stepCtx.sourceInstanceId
        ? state.cardInstances.find(
            (c) => c.instanceId === stepCtx.sourceInstanceId
          )?.ownerPlayerId
        : undefined;
      const refCandidateIds =
        condition.result === "revealed"
          ? (result.revealedCardInstanceIds ?? [])
          : result.affectedCardInstanceIds;
      const matchedCount = refCandidateIds.reduce((acc, id) => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        if (!card) return acc;
        if (condition.ownerRelation) {
          if (!sourceOwnerPlayerId) return acc;
          const isSelfOwned = card.ownerPlayerId === sourceOwnerPlayerId;
          if (condition.ownerRelation === "self" && !isSelfOwned) return acc;
          if (condition.ownerRelation === "opponent" && isSelfOwned) return acc;
        }
        if (condition.controllerRelation) {
          const sourceController = state.cardInstances.find(
            (c) => c.instanceId === stepCtx.sourceInstanceId
          )?.controllerPlayerId;
          if (!sourceController) return acc;
          const selfControlled = card.controllerPlayerId === sourceController;
          if (selfControlled !== (condition.controllerRelation === "self"))
            return acc;
        }
        const def = getCardDefinitionById(card.definitionId);
        if (!def) return acc;
        const ok = matchesCardReferenceFilter(card, def, condition.filter, {
          additionalCosts: getAdditionalCosts(state, card.instanceId),
          effectiveColors: getEffectiveColors(state, card, def),
          effectiveTribes: getEffectiveTribes(
            state,
            card,
            def,
            getCardDefinitionById
          ),
          effectiveBp:
            card.zone === "field"
              ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
              : undefined,
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(state, card.instanceId)
              : undefined,
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(state, card, def, getCardDefinitionById)
              : undefined,
          effectiveSymbolCount:
            card.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  card,
                  def,
                  getCardDefinitionById
                )
              : undefined,
          state,
          stepContext: stepCtx,
          getCardDefinitionById,
        });
        return ok ? acc + 1 : acc;
      }, 0);
      const min = condition.minCount ?? 1;
      if (matchedCount < min) return false;
      if (condition.maxCount !== undefined && matchedCount > condition.maxCount)
        return false;
      return true;
    }

    case "ref_choice": {
      const result = getStepResult(stepCtx, condition.stepId);
      if (!result) return false;
      // chosenChoiceIndex 未記録 = 参照先が choice ステップでない / 未実行 → false
      if (result.chosenChoiceIndex === undefined) return false;
      return result.chosenChoiceIndex === condition.choiceIndex;
    }

    case "ref_leave_established": {
      const result = getStepResult(stepCtx, condition.stepId);
      if (!result) return false;
      const ids =
        condition.subject === "source"
          ? [stepCtx.sourceInstanceId ?? ""]
          : result.affectedCardInstanceIds;
      return ids.some(
        (id) =>
          result.establishedLeaveKindsByCardId?.[id] === condition.leaveKind
      );
    }

    case "ref_left_field": {
      // 参照先ステップで影響を受けたカードのうち、1 枚以上が現在フィールドを
      // 離れている（消滅・破壊・バウンス等で zone !== "field"）かを判定する。
      // leaveKind 指定時は after_triggers が記録した pending leave 種別で絞る。
      // 転醒/stay_on_field などの離脱置換が未解決なら、初回 pending だけでは
      // 「この効果で消滅した」と確定しないため成立させない。
      // コア不足消滅は after_triggers 連結の flushPendingLeaves で実移動するため、
      // この条件を持つステップは connector: "after_triggers" と併用する。
      const result = getStepResult(stepCtx, condition.stepId);
      if (!result) return false;
      return result.affectedCardInstanceIds.some((id) => {
        if (
          condition.leaveKind !== undefined &&
          result.leftFieldKindsByCardId?.[id] !== condition.leaveKind
        ) {
          return false;
        }
        const card = state.cardInstances.find((c) => c.instanceId === id);
        const isMatchingPendingLeave =
          condition.leaveKind !== undefined &&
          card?.pendingLeaveKind === condition.leaveKind;
        if (
          condition.leaveKind !== undefined &&
          isMatchingPendingLeave &&
          hasPendingLeaveFieldReplacementReaction(
            state,
            id,
            condition.leaveKind
          )
        ) {
          return false;
        }
        return !card || card.zone !== "field" || isMatchingPendingLeave;
      });
    }

    case "activation_zone": {
      const zone = stepCtx.activationZone;
      if (zone === undefined) return false;
      return condition.zones.includes(zone);
    }

    case "summon_precheck": {
      const sourceInstanceId = stepCtx.sourceInstanceId;
      if (!sourceInstanceId) return false;
      return canExecuteSummonSelfNow({
        state,
        sourceInstanceId,
        summonCause: "effect",
        ...(stepCtx.activationZone
          ? { activationZone: stepCtx.activationZone }
          : {}),
        getCardDefinitionById,
        ...(condition.target !== undefined ? { target: condition.target } : {}),
        ...(condition.costModifier !== undefined
          ? { costModifier: condition.costModifier }
          : {}),
        ...(condition.ignoreSummonCondition !== undefined
          ? { ignoreSummonCondition: condition.ignoreSummonCondition }
          : {}),
      });
    }

    case "rebirth_precheck": {
      const sourceInstanceId = stepCtx.sourceInstanceId;
      if (!sourceInstanceId) return false;
      const sourceCard = state.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      const actingPlayerId = sourceCard?.controllerPlayerId;
      if (!actingPlayerId) return false;
      return canExecuteRebirthNow(
        state,
        actingPlayerId,
        {
          maxCount: condition.maxCount ?? Number.POSITIVE_INFINITY,
          ...(condition.forceTriggerCondition
            ? { forceTriggerCondition: true }
            : {}),
        },
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx.rebirthTimingWindowId
      );
    }
  }
}

// ============================================================
// Connector ハンドリング
// ============================================================

interface ConnectorResult {
  skip: boolean;
  rollbackState?: GameState;
  mutatedState?: GameState;
  afterTriggersChainId?: string;
}

export function handleConnector(
  connector: Connector,
  stepIndex: number,
  steps: readonly EffectStep[],
  stepCtx: StepExecutionContext,
  currentState: GameState,
  previousStepPreState: GameState | null,
  previousStepId: string | null,
  sourceInstanceId: string,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined,
  parentChainId: string | null,
  currentStep: EffectStep
): ConnectorResult {
  switch (connector) {
    case "simultaneous":
    case "sequential":
      // 実行を続行（トリガーフラッシュなし）
      return { skip: false };

    case "after_state_check":
    case "after_triggers": {
      // 前ステップ実行の結果に基づく SBA + CE 再計算 + 誘発効果キュー化 + pending leave flush を挟む。
      // 実際の誘発効果解決は外側のチェーン解決パイプライン（runActionMainResolution 等）に委ねる。
      // previousStepPreState が無い場合（= 初回 or 全 step がスキップ）は sequential と同じ動作。
      if (!previousStepPreState) return { skip: false };
      let nextState = currentState;
      // ENGINE-soul-drive-departure-prevention-immunity (BSLH01-C07): 直前ステップで実際に
      // 総コア数が減った相手カードだけを preventStayOnField 適用候補にする
      // (adversarial verifier round2: sourceInstanceId 一致だけだと同じ SBA パスに偶然
      // 混入した無関係な相手カードまで誤って対象になる gap を refute)。
      const stayOnFieldPreventionEligibleInstanceIds =
        currentState.cardInstances
          .filter((card) => {
            if (card.controllerPlayerId === actingPlayerId) return false;
            const before = previousStepPreState.cardInstances.find(
              (c) => c.instanceId === card.instanceId
            );
            if (!before) return false;
            return (
              getTotalCoresOnCardById(currentState, card.instanceId) <
              getTotalCoresOnCardById(previousStepPreState, before.instanceId)
            );
          })
          .map((card) => card.instanceId);
      // P3-68 ギャップ 2: コア不足消滅の causePlayerId を解決中効果のコントローラに帰属。
      // P3-84 注: ここで owningChainId を渡して消滅を束縛してはならない。「この効果発揮後」
      // (after_triggers) より前に、消滅したカードは自分の leave サブチェーンが閉じた時点で
      // 実移動する (04_state-based-rules.md 例2 step4 < step5)。束縛すると発揮後まで過剰に待つ。
      nextState = runStateBasedActions(
        nextState,
        getCardDefinitionById,
        actingPlayerId,
        sourceInstanceId,
        stayOnFieldPreventionEligibleInstanceIds
      ).state;
      const prevStepId =
        previousStepId ?? steps[stepIndex - 1]?.id ?? `__step_${stepIndex - 1}`;
      annotateStepResultLeaveKinds(
        stepCtx,
        nextState,
        previousStepPreState,
        prevStepId
      );
      // P3-20 ギャップ B: continuous 効果の condition / applicability を動的再評価。
      // ステップ間で condition が変化しうる効果 (例: フィールド差分依存) に追従する。
      nextState = getCardDefinitionById
        ? recomputeAndRebuildContinuousEffects(nextState, getCardDefinitionById)
        : recomputeContinuousEffects(nextState);
      // 同一効果の結果条件はSBAだけを確認する。誘発・残留・魂状態選択は割り込ませない。
      if (connector === "after_state_check") {
        return { skip: false, mutatedState: nextState };
      }
      const chainId = parentChainId
        ? `${parentChainId}:after_triggers:${stepIndex}`
        : `after_triggers:${sourceInstanceId}:${stepIndex}`;
      nextState = collectAndQueueTriggerReactions({
        // 直前の 1 step だけでは、先行するカウント/ドロー等の派生誘発を取りこぼす。
        beforeState:
          stepCtx.resolutionSegmentBeforeState ?? previousStepPreState,
        afterState: nextState,
        source: "action_resolution",
        chainId,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        causedByPlayerId: actingPlayerId,
        // 創界石の解封（手札増加系）: 原因効果の発揮元カードを thread する
        causedBySourceInstanceId: sourceInstanceId,
        enterFieldCausedByPlayerId: actingPlayerId,
      });
      const suppressTargetIds = getInlineSuppressPendingLeaveTargetIds(
        currentStep,
        stepCtx,
        nextState,
        sourceInstanceId
      );
      if (suppressTargetIds !== null) {
        nextState = executeSuppressPendingLeaveEffects(
          nextState,
          suppressTargetIds,
          currentStep.action.kind === "suppress_pending_leave_effects"
            ? currentStep.action.suppressDestroyedEffects
            : "destroyed_only",
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions
        );
      }
      nextState = flushPendingLeavesAndQueueReactions({
        beforeFlushState: nextState,
        chainId,
        causedByPlayerId: actingPlayerId,
        causedBySourceInstanceId: sourceInstanceId,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        queueRegisteredPreFlush: true,
      });
      nextState = {
        ...nextState,
        log: [...nextState.log, `effect:after_triggers:flushed:${chainId}`],
      };
      return {
        skip: false,
        mutatedState: nextState,
        afterTriggersChainId: chainId,
      };
    }

    case "conditional_cost": {
      // 前ステップが conditional_cost のコストステップ。
      // 前ステップの結果を確認し、失敗ならロールバック。
      // step.id が省略されていても synthetic ID で結果を解決する。
      const prevStepId = steps[stepIndex - 1]?.id ?? `__step_${stepIndex - 1}`;
      const prevResult = getStepResult(stepCtx, prevStepId);
      if (!prevResult || !prevResult.succeeded) {
        // コスト支払い失敗 → 全体をロールバック
        return { skip: true, rollbackState: stepCtx.originalState };
      }
      return { skip: false };
    }

    case "conditional_result": {
      // 前ステップが成功していなければスキップ。
      // ただし step.stepCondition が明示されている場合は後段で評価するので、ここでは
      // 暗黙の succeeded ゲートを適用しない (例: ref_executed で「比べた事実」=
      // BP比べ破壊耐性で破壊不発でも連動を発火させたいケース)。
      if (currentStep.stepCondition) {
        return { skip: false };
      }
      const prevStepId = steps[stepIndex - 1]?.id ?? `__step_${stepIndex - 1}`;
      const prevResult = getStepResult(stepCtx, prevStepId);
      if (!prevResult || !prevResult.succeeded) {
        return { skip: true };
      }
      return { skip: false };
    }

    case "unless_previous_succeeded": {
      // 「相手が支払わなければ、その効果を受けない」型。
      // 前ステップが成功した場合だけ後続を抑止し、失敗/decline なら後続を実行する。
      const prevStepId = steps[stepIndex - 1]?.id ?? `__step_${stepIndex - 1}`;
      const prevResult = getStepResult(stepCtx, prevStepId);
      if (prevResult?.succeeded) {
        return { skip: true };
      }
      return { skip: false };
    }
  }
}
