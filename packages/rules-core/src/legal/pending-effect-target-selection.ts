import { isTargetStillValid } from "../battle/battle-immediate-effect-system";
import type { GameState, PendingEffectTargetSelection, Zone } from "../model";
import type { EffectFilterTag } from "../state-based-actions";
import { resolveEmptyFireTargetCounts } from "./legal-actions-shared";

/** 選択提示と確定で、同じ生存候補・グループ必要数を使う。 */
export function revalidatePendingEffectTargets(
  state: GameState,
  pending: PendingEffectTargetSelection
): PendingEffectTargetSelection {
  if (pending.deferredStack.actionKind !== "battle_immediate_effect")
    return pending;

  const stack = pending.deferredStack;
  const liveCandidates = (ids: readonly string[], zones?: readonly Zone[]) =>
    ids.filter((id) =>
      isTargetStillValid(
        state,
        id,
        pending.targetEffectFilterTags as readonly EffectFilterTag[],
        stack.preventionLevel ?? stack.battleImmediatePreventionLevel ?? "none",
        zones ?? stack.candidateTargetZones ?? ["field"]
      )
    );
  const counts = (
    required: number,
    max: number,
    candidates: readonly string[]
  ) => {
    const candidateCount =
      pending.allowDuplicateTargets && candidates.length > 0
        ? Math.max(candidates.length, required)
        : candidates.length;
    return resolveEmptyFireTargetCounts({
      requiredTargetCount: required,
      maxTargetCount: max,
      candidateCount,
      // 宣言済みの選択待ち。候補離脱は不発として扱い、宣言をやり直さない。
      gatedByConditionalCost: false,
    });
  };
  const candidates = liveCandidates(pending.candidateInstanceIds);
  const candidateSet = new Set(candidates);
  const targetGroups = pending.targetGroups?.map((group) => {
    const candidateTargetInstanceIds = liveCandidates(
      group.candidateTargetInstanceIds.filter((id) => candidateSet.has(id)),
      group.candidateTargetZones
    );
    const effective = counts(
      group.requiredTargetCount,
      group.maxTargetCount ?? group.requiredTargetCount,
      candidateTargetInstanceIds
    );
    return {
      ...group,
      requiredTargetCount: effective.requiredTargetCount,
      maxTargetCount: effective.maxTargetCount,
      candidateTargetInstanceIds,
    };
  });
  const effective = counts(
    pending.requiredTargetCount,
    pending.maxTargetCount,
    candidates
  );
  return {
    ...pending,
    candidateInstanceIds: targetGroups?.length
      ? [
          ...new Set(
            targetGroups.flatMap((group) => group.candidateTargetInstanceIds)
          ),
        ]
      : candidates,
    requiredTargetCount: targetGroups?.length
      ? targetGroups.reduce((sum, group) => sum + group.requiredTargetCount, 0)
      : effective.requiredTargetCount,
    maxTargetCount: targetGroups?.length
      ? targetGroups.reduce((sum, group) => sum + group.maxTargetCount, 0)
      : effective.maxTargetCount,
    ...(targetGroups !== undefined ? { targetGroups } : {}),
  };
}
