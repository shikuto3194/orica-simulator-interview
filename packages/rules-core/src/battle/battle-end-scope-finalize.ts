import type { CardDefinition, GameState } from "../model";
import { removeExpiredContinuousEffects } from "../legal/legal-actions-shared";
import { collectExpiredEffectSuppressionSourceIds } from "../effect/expired-effect-suppression";
import { recomputeAndRebuildBattleStateContinuousEffects } from "../effect/continuous-effect-rebuild";
import { stabilizeSourcesReleasedByEffectSuppressionExpiry } from "../effect/effect-suppression-expiry-stabilization";
import { recomputeBattleEntityBp } from "./battle-shared";
import { hasPendingBattleEndFinalizeBlockers } from "./battle-end-finalize-blockers";
export {
  getBattleEndDeferralChainId,
  getBattleEndFinalizeAttackIdForActiveStack,
  getBattleEndFinalizeAttackIdForPending,
  hasPendingBattleEndFinalizeBlockers,
  isBattleEndDeferralChainForAttack,
} from "./battle-end-finalize-blockers";

/**
 * バトル終了時 deferred 解決後に呼ぶ scope:"battle" CE 失効と battle-state CE 再評価。
 *
 * ルール正源: 10_rules/02 L167「バトル終了時に誘発する効果を先に解決し、
 * バトル中のみ有効な効果が失効してからバトル終了。」
 *
 * battle-actions.ts (executeBattleResolution) と trigger-system.ts 経由の
 * pendingTriggeredEffects drain (`maybeFinalizeBattleEndScopeExpirations`) の両方から
 * 呼べるよう、battle-actions.ts / trigger-system.ts のどちらにも依存しない中立モジュールに
 * 配置する (circular import 回避。両モジュールとも本ファイルの依存先である
 * legal-actions-shared.ts / continuous-effect-rebuild.ts / battle-shared.ts より上位)。
 */
export function finalizeBattleEndScopeExpirations(
  state: GameState,
  attackId: string,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): GameState {
  const finalizingState: GameState = {
    ...state,
    pendingBattleEndFinalizeAttackIds:
      state.pendingBattleEndFinalizeAttackIds.filter((id) => id !== attackId),
  };
  let result: GameState = {
    ...finalizingState,
    activeContinuousEffects: removeExpiredContinuousEffects(
      finalizingState,
      { kind: "battle_end", attackId },
      getCardDefinitionById ? { getCardDefinitionById } : undefined
    ),
  };
  const expiredEffectSuppressionTargetIds = getCardDefinitionById
    ? collectExpiredEffectSuppressionSourceIds(
        finalizingState,
        result.activeContinuousEffects,
        getCardDefinitionById
      )
    : new Set<string>();

  if (getCardDefinitionById) {
    result = recomputeAndRebuildBattleStateContinuousEffects(
      result,
      getCardDefinitionById
    );
    // scope:"battle" の effect_suppression が失効したカードは、それまで除去されていた
    // 通常の継続効果を直ちに再評価する。dynamic filter 型は CardFilter/対象 player/zone
    // の現在一致に加え、抑止中に実際に一致した source 履歴も収集する。battle-state 専用の
    // 再評価だけでは、状態依存しない常時効果 (BSFT01-TR08(A) の key brave 効果など) が
    // 未登録のまま残る。
    if (expiredEffectSuppressionTargetIds.size > 0) {
      result = stabilizeSourcesReleasedByEffectSuppressionExpiry(
        result,
        getCardDefinitionById,
        expiredEffectSuppressionTargetIds
      );
    } else {
      result = recomputeBattleEntityBp(result, getCardDefinitionById);
    }
  }

  return result;
}

/**
 * ENGINE-battle-end-pending-triggered-vs-scope-battle-ce:
 * `queueBattleEndTriggers` で積んだ battle_end 由来 `pendingTriggeredEffects` (player choice
 * 解決待ち。deferred 効果と異なり同一 executeBattleResolution 呼び出し内では完結しない) が
 * 残っている間、`finalizeBattleEndScopeExpirations` は `state.pendingBattleEndFinalizeAttackIds`
 * に予約されて遅延する。当該 attackId の pendingTriggeredEffects が尽きた時点で本関数が発火する。
 *
 * ENGINE-battle-end-deferred-yield-finalize: 同様に、battle_end deferred 効果が
 * `pendingStepOptionalChoice` (executionMode:"optional" の未解決 execute/decline) や、
 * その execute 後の `pendingStepOptionalTargetSelection` で中断した場合も、その
 * continuation に付与された `battleEndDeferralAttackId` が一致する間は
 * 「まだ尽きていない」とみなす。deck/zone 選択 pending で中断した battle_end deferred
 * 効果も同じ attackId を保持し、選択完了まで失効を遅延する。さらに、finalize 前の
 * pendingLeave flush が同じ battle-end deferral chain で private declaration / burst check
 * を積んだ場合も、解決完了まで scope:"battle" CE 失効を待つ。
 *
 * 呼び出し箇所: `pendingTriggeredEffects` から要素が抜けるすべての経路
 * (trigger-system.ts `useResolvePendingTriggeredEffectAsAction` の解決/辞退、
 * legal-actions-apply.ts の `resolve_pending_triggered_effect` 辞退経路)、および
 * `pendingStepOptionalChoice` の execute/decline 解決経路
 * (legal-actions-apply.ts `resumeStepOptional`)。
 */
export function maybeFinalizeBattleEndScopeExpirations(
  state: GameState,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  options?: {
    flushBeforeFinalize?: (state: GameState, attackId: string) => GameState;
  }
): GameState {
  if (state.pendingBattleEndFinalizeAttackIds.length === 0) return state;

  let currentState = state;
  const remaining: string[] = [];
  for (const attackId of currentState.pendingBattleEndFinalizeAttackIds) {
    if (hasPendingBattleEndFinalizeBlockers(currentState, attackId)) {
      remaining.push(attackId);
      continue;
    }
    currentState =
      options?.flushBeforeFinalize?.(currentState, attackId) ?? currentState;
    if (hasPendingBattleEndFinalizeBlockers(currentState, attackId)) {
      remaining.push(attackId);
      continue;
    }
    currentState = finalizeBattleEndScopeExpirations(
      currentState,
      attackId,
      getCardDefinitionById
    );
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        `battle:end-scope-finalize:drained:${attackId}`,
      ],
    };
  }

  if (
    remaining.length === currentState.pendingBattleEndFinalizeAttackIds.length
  ) {
    return currentState;
  }

  return { ...currentState, pendingBattleEndFinalizeAttackIds: remaining };
}
