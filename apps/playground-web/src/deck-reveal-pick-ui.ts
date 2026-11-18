import type { ResolvePendingDeckRevealPickLegalAction } from "@orica/rules-core";

/** The engine supplies branch-specific counts after affordability/candidate checks. */
export function deckRevealPickSelection(
  action: ResolvePendingDeckRevealPickLegalAction,
  branchIndex: number | null,
  selectedIds: readonly string[]
) {
  const branches = action.exclusiveGroupBranches;
  const exclusive = !!branches?.length;
  const branch = branchIndex === null ? undefined : branches?.[branchIndex];
  const candidateIds = exclusive
    ? (branch?.candidateCardInstanceIds ?? [])
    : action.candidateCardInstanceIds;
  const maxCount = exclusive
    ? (branch?.count ?? 0)
    : Math.min(action.maxPickCount, candidateIds.length);
  const requiredCount = exclusive ? maxCount : action.canSkip ? 0 : maxCount;
  return {
    candidateIds,
    maxCount,
    requiredCount,
    canConfirm:
      (!exclusive || !!branch) &&
      (!exclusive || selectedIds.length > 0) &&
      selectedIds.length >= requiredCount &&
      selectedIds.length <= maxCount &&
      new Set(selectedIds).size === selectedIds.length &&
      selectedIds.every((id) => candidateIds.includes(id)),
  };
}
