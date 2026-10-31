import { isChainAtOrUnder, pendingResolutionContexts } from "../chain-id";
import type { ActiveStack, GameState, TriggerEventKind } from "../model";

export function getBattleEndDeferralChainId(attackId: string): string {
  return `battle-end-deferral:${encodeURIComponent(attackId)}`;
}

export function isBattleEndDeferralChainForAttack(
  chainId: string | null | undefined,
  attackId: string
): boolean {
  if (chainId === null || chainId === undefined) return false;
  const rootChainId = getBattleEndDeferralChainId(attackId);
  return isChainAtOrUnder(chainId, rootChainId);
}

function isBattleEndFinalizePendingEventKind(eventKind: unknown): boolean {
  return (
    eventKind === "battle_end" || eventKind === "battle_destroy_opponent_only"
  );
}

export function getBattleEndFinalizeAttackIdForPending(pending: {
  eventKind: TriggerEventKind;
  chainId: string | null;
  attackId: string | null;
}): string | undefined {
  if (pending.attackId === null) return undefined;
  if (isBattleEndFinalizePendingEventKind(pending.eventKind)) {
    return pending.attackId;
  }
  return isBattleEndDeferralChainForAttack(pending.chainId, pending.attackId)
    ? pending.attackId
    : undefined;
}

export function getBattleEndFinalizeAttackIdForActiveStack(
  stack: ActiveStack
): string | undefined {
  if (stack.triggeredPendingSnapshot !== undefined) {
    const pendingAttackId = getBattleEndFinalizeAttackIdForPending(
      stack.triggeredPendingSnapshot
    );
    if (pendingAttackId !== undefined) return pendingAttackId;
  }
  const battleImmediateAttackId = stack.battleImmediatePromptSnapshot?.attackId;
  if (
    battleImmediateAttackId !== undefined &&
    isBattleEndDeferralChainForAttack(stack.chainId, battleImmediateAttackId)
  ) {
    return battleImmediateAttackId;
  }
  return undefined;
}

/** 保存済みの原因文脈を辿る正源を共有し、pending 種別の追加漏れを防ぐ。 */
export function hasPendingBattleEndFinalizeBlockers(
  state: GameState,
  attackId: string
): boolean {
  if (
    state.pendingImmediateBattleEnds.some((p) => p.attackId === attackId) ||
    state.pendingBattleEndDeferrals.some((p) => p.attackId === attackId)
  )
    return true;
  return pendingResolutionContexts(state).some(({ context, path }) => {
    // 呼出元は解決したスタックを窓から取り除く前にも寿命を確定する。
    // 窓の履歴自体は待機効果ではなく、未完了なら pending 側に継続がある。
    if (
      path.startsWith("activeAttack.") ||
      path.startsWith("stackWindow.") ||
      path.startsWith("pendingStackCascadeFlushGuardStacks[") ||
      // 離脱flushとステップ退出はこの待機判定の後で行う。自分自身を待たない。
      path.startsWith("pendingLeaveEntities[") ||
      path.startsWith("pendingAttackStepEndFinalizations[")
    )
      return false;
    if (context.battleEndDeferralAttackId === attackId) return true;
    if (
      context.attackId === attackId &&
      isBattleEndFinalizePendingEventKind(context.eventKind)
    )
      return true;
    return [
      context.chainId,
      context.waitChainId,
      context.effectSummonChainId,
    ].some(
      (chainId) =>
        typeof chainId === "string" &&
        isBattleEndDeferralChainForAttack(chainId, attackId)
    );
  });
}
