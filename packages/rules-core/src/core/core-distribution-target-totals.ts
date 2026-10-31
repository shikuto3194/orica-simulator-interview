import { getTotalCoresOnCardById } from "./core-system";
import type { CoreDistributionAllowedSource, GameState } from "../model";

type PendingCoreDistribution = NonNullable<
  GameState["pendingCoreDistribution"]
>;

/** Shared input shape for the two-stage target-total/core-source distribution. */
export type CoreDistributionTargetTotalsInput = Pick<
  PendingCoreDistribution,
  | "candidates"
  | "totalNormalCores"
  | "totalSoulCores"
  | "hasSoulCore"
  | "fromKind"
  | "allowedSources"
  | "sourceAvailable"
  | "soulSourceAvailable"
  | "sourceTotalAvailable"
  | "maxTotal"
>;

export interface CoreDistributionTargetTotalBounds {
  readonly candidateIds: readonly string[];
  readonly currentTotals: Readonly<Record<string, number>>;
  readonly minimumTotals: Readonly<Record<string, number>>;
  readonly maximumTotals: Readonly<Record<string, number>>;
  readonly minimumSelectedTotal: number;
  readonly maximumSelectedTotal: number;
  readonly maximumDeficitTotal: number;
}

function sourceKey(source: CoreDistributionAllowedSource): string {
  return source.kind === "field" ? `field:${source.instanceId}` : source.kind;
}

function sourceTotalAvailable(
  input: CoreDistributionTargetTotalsInput,
  key: string
): number {
  return (
    input.sourceTotalAvailable?.[key] ??
    (input.sourceAvailable?.[key] ?? 0) +
      (input.soulSourceAvailable?.[key] ?? 0)
  );
}

/**
 * Maximum number of physical cores that the source owner may move. In the
 * first target-total phase this is a reachability bound, not a final total.
 */
export function getCoreDistributionMoveLimit(
  input: CoreDistributionTargetTotalsInput
): number {
  if (input.maxTotal !== undefined) return input.maxTotal;
  const totalSoulCores = input.totalSoulCores ?? (input.hasSoulCore ? 1 : 0);
  if (input.fromKind !== "any_movable") {
    return input.totalNormalCores + totalSoulCores;
  }
  return (input.allowedSources ?? []).reduce(
    (sum, source) => sum + sourceTotalAvailable(input, sourceKey(source)),
    0
  );
}

/**
 * Shared reachability bounds for phase one of
 * `target_totals_then_core_owner_sources`.
 *
 * The target chooser selects each card's final core total. The core owner
 * later supplies physical cores, so a target card's own movable cores may
 * stay on that card; final totals must not be mistaken for incoming amounts.
 */
export function getCoreDistributionTargetTotalBounds(
  state: GameState,
  input: CoreDistributionTargetTotalsInput,
  moveLimit: number = getCoreDistributionMoveLimit(input)
): CoreDistributionTargetTotalBounds {
  const candidateIds = input.candidates.map(
    (candidate) => candidate.instanceId
  );
  const candidateIdSet = new Set(candidateIds);
  const sourceTotalByKey = new Map<string, number>();
  let allSourceAvailable = 0;
  let nonTargetSourceAvailable = 0;

  for (const source of input.allowedSources ?? []) {
    const key = sourceKey(source);
    const available = sourceTotalAvailable(input, key);
    sourceTotalByKey.set(key, available);
    allSourceAvailable += available;
    if (source.kind !== "field" || !candidateIdSet.has(source.instanceId)) {
      nonTargetSourceAvailable += available;
    }
  }

  const currentTotals: Record<string, number> = {};
  const minimumTotals: Record<string, number> = {};
  const maximumTotals: Record<string, number> = {};
  let currentTargetTotal = 0;

  for (const candidate of input.candidates) {
    const id = candidate.instanceId;
    const current = getTotalCoresOnCardById(state, id);
    const selfAvailable = sourceTotalByKey.get(`field:${id}`) ?? 0;
    const otherSourceAvailable = Math.max(
      0,
      allSourceAvailable - selfAvailable
    );
    currentTotals[id] = current;
    // A single source cannot lose more than the action's overall move cap.
    // Apply that bound before enumeration so unreachable low final totals do
    // not exhaust the bounded input generator ahead of legal choices.
    minimumTotals[id] = Math.max(
      0,
      current - Math.min(moveLimit, selfAvailable)
    );
    maximumTotals[id] = current + Math.min(moveLimit, otherSourceAvailable);
    currentTargetTotal += current;
  }

  return {
    candidateIds,
    currentTotals,
    minimumTotals,
    maximumTotals,
    minimumSelectedTotal: currentTargetTotal,
    maximumSelectedTotal:
      currentTargetTotal + Math.min(moveLimit, nonTargetSourceAvailable),
    maximumDeficitTotal: moveLimit,
  };
}
