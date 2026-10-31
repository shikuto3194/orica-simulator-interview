import type { GameState, PendingMultiPlacement } from "./model";

/**
 * flushPendingLeaves が生成する「離脱処理そのもの」の選択待ち。
 *
 * `hasOutstandingEffectResolutionContinuation` には含めない。あちらへ含めると
 * flush が自分で立てた pending を待つ deadlock になるため、after_triggers や
 * effect turn-end finalization など flush 外側の順序制御だけがこの helper を参照する。
 */
export function hasPendingLeaveResolutionChoice(state: GameState): boolean {
  return (
    state.pendingBraveLeaveChoice !== null ||
    state.pendingBraveAttackContinuation !== null ||
    state.pendingSoulStateReplacement !== null ||
    state.pendingAdventSourceReplacement !== null
  );
}

/** All entries in one simultaneous placement, including owners already confirmed. */
export function getMultiPlacementTargets(
  pending: PendingMultiPlacement | null | undefined
): PendingMultiPlacement["targets"] {
  return pending
    ? [
        ...(pending.completedTargets ?? []),
        ...pending.targets,
        ...(pending.remainingPlacements ?? []).flatMap(
          (group) => group.targets
        ),
      ]
    : [];
}
