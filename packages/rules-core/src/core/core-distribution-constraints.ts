import type { PendingCoreDistribution } from "../model";
import { computeCoreDistributionGroupCapacity } from "./core-distribution-flow";

type Constraints = Pick<
  PendingCoreDistribution,
  "candidates" | "maxPerCandidate" | "allocationGroups"
>;

/** 配置先上限と共有枠だけを判定する。移動元・総数・下限は各呼び出し元が検証する。 */
export function isCoreDistributionAllocationValid(
  constraints: Constraints,
  normal: Readonly<Record<string, number>>,
  soul: Readonly<Record<string, number>> = {}
): boolean {
  const ids = new Set(constraints.candidates.map((c) => c.instanceId));
  const totals: Record<string, number> = {};
  for (const entries of [normal, soul]) {
    for (const [id, amount] of Object.entries(entries)) {
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        (amount > 0 && !ids.has(id))
      )
        return false;
      totals[id] = (totals[id] ?? 0) + amount;
    }
  }
  if (
    Object.values(totals).some(
      (n) => n > (constraints.maxPerCandidate ?? Infinity)
    )
  )
    return false;
  const groups = constraints.allocationGroups;
  return (
    groups === undefined ||
    computeCoreDistributionGroupCapacity(groups, totals) ===
      Object.values(totals).reduce((sum, n) => sum + n, 0)
  );
}

/** HUDの残り候補と確定時の検証は同じ配分判定を使う。 */
export function canAddCoreDistributionCore(
  constraints: Constraints & Pick<PendingCoreDistribution, "maxTotal">,
  normal: Readonly<Record<string, number>>,
  soul: Readonly<Record<string, number>>,
  instanceId: string
): boolean {
  const placed = [...Object.values(normal), ...Object.values(soul)].reduce(
    (sum, amount) => sum + amount,
    0
  );
  if (placed >= (constraints.maxTotal ?? Infinity)) return false;
  return isCoreDistributionAllocationValid(
    constraints,
    { ...normal, [instanceId]: (normal[instanceId] ?? 0) + 1 },
    soul
  );
}

export function getCoreDistributionAllocationCapacity(
  constraints: Constraints,
  available: number
): number {
  const caps = Object.fromEntries(
    constraints.candidates.map((c) => [
      c.instanceId,
      Math.min(available, constraints.maxPerCandidate ?? available),
    ])
  );
  return Math.min(
    available,
    constraints.allocationGroups === undefined
      ? Object.values(caps).reduce((sum, n) => sum + n, 0)
      : computeCoreDistributionGroupCapacity(constraints.allocationGroups, caps)
  );
}
