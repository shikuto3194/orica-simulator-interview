import type { GameState } from "@orica/rules-core";

/** Same-owner multi-source choices can submit targets and physical sources together. */
export function requiresCoreDistributionTargetTotals(
  pending: NonNullable<GameState["pendingCoreDistribution"]>
): boolean {
  const selection = pending.targetTotalSelection;
  return (
    selection !== undefined &&
    selection.fixedTargetTotals === undefined &&
    (pending.fromKind !== "any_movable" ||
      selection.targetChooserPlayerId !== selection.sourceOwnerPlayerId)
  );
}
