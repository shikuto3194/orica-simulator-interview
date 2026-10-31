import { getTriggerEventChainKey, isChainAtOrUnder } from "../chain-id";
import { scopeBattleImmediateDerivedReactions } from "../battle/battle-timing-reevaluation";
import type { GameState } from "../model";

/**
 * Q6645 / Q6163: 内側の同時誘発群が空になるまで外側へ戻らない。
 * 合法手・操作権の判定用ビュー。実状態の待機効果は削除しない。
 * 共通のchain包含判定を使い、既存スナップショットにも適用する。
 */
export function scopeInnermostTriggerReactions(state: GameState): GameState {
  state = scopeBattleImmediateDerivedReactions(state);
  const entries = [
    ...(state.pendingTargetedDisclosureContinuation
      ? [
          {
            entry: { simultaneousGroupId: undefined },
            chainId: state.pendingTargetedDisclosureContinuation.chainId,
            resolutionChainId: null,
          },
        ]
      : []),
    ...(state.pendingAfterTriggersContinuations ?? []).map((entry) => ({
      entry: { simultaneousGroupId: undefined },
      chainId: entry.waitChainId,
      resolutionChainId: null,
    })),
    ...(state.pendingEffectCompletions ?? []).map((entry) => ({
      entry: { simultaneousGroupId: undefined },
      chainId: entry.chainId ?? null,
      resolutionChainId: null,
    })),
    ...state.pendingTriggeredEffects.map((entry) => ({
      entry,
      chainId: getTriggerEventChainKey(
        { turnNumber: state.turnNumber, step: entry.step },
        entry
      ),
      resolutionChainId: `trigger:${entry.pendingId}`,
    })),
    ...state.pendingPrivateDeclarations.map((entry) => ({
      entry,
      chainId: getTriggerEventChainKey(
        { turnNumber: state.turnNumber, step: entry.step },
        entry
      ),
      resolutionChainId: null,
    })),
    ...state.battleImmediateEffects.map((entry) => ({
      entry,
      chainId: entry.causedByChainId ?? null,
      resolutionChainId: `battle:immediate:${entry.promptId}`,
    })),
  ];
  const blocked = new Set<object>();
  for (const parent of entries) {
    const hasInnerReaction = entries.some((child) => {
      if (child === parent || child.chainId === null) return false;
      if (
        parent.entry.simultaneousGroupId !== undefined &&
        parent.entry.simultaneousGroupId === child.entry.simultaneousGroupId
      )
        return false;
      return (
        (parent.chainId !== null &&
          child.chainId !== parent.chainId &&
          isChainAtOrUnder(child.chainId, parent.chainId)) ||
        (parent.resolutionChainId !== null &&
          isChainAtOrUnder(child.chainId, parent.resolutionChainId))
      );
    });
    if (!hasInnerReaction) continue;
    for (const peer of entries) {
      if (
        peer === parent ||
        (parent.entry.simultaneousGroupId !== undefined &&
          peer.entry.simultaneousGroupId === parent.entry.simultaneousGroupId)
      )
        blocked.add(peer.entry);
    }
  }
  if (blocked.size === 0) return state;
  return {
    ...state,
    pendingTriggeredEffects: state.pendingTriggeredEffects.filter(
      (entry) => !blocked.has(entry)
    ),
    pendingPrivateDeclarations: state.pendingPrivateDeclarations.filter(
      (entry) => !blocked.has(entry)
    ),
    battleImmediateEffects: state.battleImmediateEffects.filter(
      (entry) => !blocked.has(entry)
    ),
  };
}
