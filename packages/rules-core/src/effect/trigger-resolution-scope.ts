import { getTriggerEventChainKey, isChainAtOrUnder } from "../chain-id";
import { scopeBattleImmediateDerivedReactions } from "../battle/battle-timing-reevaluation";
import type { GameState } from "../model";
import {
  getTriggerResolutionChainId,
  getTriggerResolutionGroupId,
} from "./trigger-resolution-identity";

/**
 * Q6645 / Q6163: 内側の同時誘発群が空になるまで外側へ戻らない。
 * 合法手・操作権の判定用ビュー。実状態の待機効果は削除しない。
 * 共通のchain包含判定を使い、既存スナップショットにも適用する。
 */
export function scopeInnermostTriggerReactions(state: GameState): GameState {
  // Original immediate reactions finish before a newly qualified normal reaction.
  const immediateGroups = new Set(
    [
      ...state.pendingTriggeredEffects,
      ...state.pendingPrivateDeclarations,
    ].flatMap((pending) =>
      pending.triggerPriority === "immediate" &&
      pending.simultaneousGroupId !== undefined
        ? [pending.simultaneousGroupId]
        : []
    )
  );
  const deferredPromotionChains = new Set<string>();
  if (immediateGroups.size > 0) {
    const available = state.pendingTriggeredEffects.filter((pending) => {
      const priority = pending.activationPriority;
      if (
        pending.triggerPriority !== "immediate" &&
        priority &&
        pending.simultaneousGroupId !== undefined &&
        immediateGroups.has(pending.simultaneousGroupId)
      ) {
        deferredPromotionChains.add(priority.causedByChainId);
        return false;
      }
      return true;
    });
    if (available.length !== state.pendingTriggeredEffects.length)
      state = { ...state, pendingTriggeredEffects: available };
  }
  // Filter held promotions before choosing a battle-derived group.
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
    ...(state.pendingEffectCompletions ?? [])
      .filter((entry) => !deferredPromotionChains.has(entry.chainId))
      .map((entry) => ({
        entry: { simultaneousGroupId: undefined },
        chainId: entry.chainId ?? null,
        resolutionChainId: null,
      })),
    ...state.pendingTriggeredEffects.map((entry) => ({
      entry,
      chainId: getTriggerResolutionChainId(entry),
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
        getTriggerResolutionGroupId(parent.entry) !== undefined &&
        getTriggerResolutionGroupId(parent.entry) ===
          getTriggerResolutionGroupId(child.entry)
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
        (getTriggerResolutionGroupId(parent.entry) !== undefined &&
          getTriggerResolutionGroupId(peer.entry) ===
            getTriggerResolutionGroupId(parent.entry))
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
