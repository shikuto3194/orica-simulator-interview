import type { CardCostPaymentSource } from "./payment-system";

export type CorePaymentSourceCapacity = {
  kind: "reserve" | "card";
  instanceId?: string;
  normalCap: number;
  soulCap: 0 | 1;
  destination?: "trash" | "void";
};

export function paymentSourceAllocationOptions(
  source: CorePaymentSourceCapacity,
  maximumAmount: number
): Array<CardCostPaymentSource | undefined> {
  const options: Array<CardCostPaymentSource | undefined> = [undefined];
  for (
    let normal = 0;
    normal <= Math.min(source.normalCap, maximumAmount);
    normal++
  ) {
    for (let soul = 0; soul <= source.soulCap; soul++) {
      const amount = normal + soul;
      if (amount <= 0 || amount > maximumAmount) continue;
      options.push(
        source.kind === "reserve"
          ? {
              kind: "reserve",
              amount,
              ...(soul > 0 ? { includeSoulCore: true } : {}),
            }
          : {
              kind: "card",
              instanceId: source.instanceId!,
              amount,
              ...(soul > 0 ? { includeSoulCore: true } : {}),
              ...(source.destination
                ? { destination: source.destination }
                : {}),
            }
      );
    }
  }
  return options;
}

/** Exact allocations, shared by input generation and cost/payload previews.
 * A true visitor result stops the search without an arbitrary candidate cap.
 */
export function visitPaymentSourceAllocations(
  sources: readonly CorePaymentSourceCapacity[],
  requiredCost: number,
  visit: (payment: readonly CardCostPaymentSource[]) => boolean
): boolean {
  const required = Math.max(0, requiredCost);
  const suffixCapacity = new Array<number>(sources.length + 1).fill(0);
  for (let i = sources.length - 1; i >= 0; i--) {
    suffixCapacity[i] =
      suffixCapacity[i + 1]! + sources[i]!.normalCap + sources[i]!.soulCap;
  }
  const selected: CardCostPaymentSource[] = [];
  const walk = (index: number, paid: number): boolean => {
    if (paid === required)
      return visit(selected.map((source) => ({ ...source })));
    if (index === sources.length || paid + suffixCapacity[index]! < required)
      return false;
    for (const entry of paymentSourceAllocationOptions(
      sources[index]!,
      required - paid
    )) {
      if (entry) selected.push(entry);
      const done = walk(index + 1, paid + (entry?.amount ?? 0));
      if (entry) selected.pop();
      if (done) return true;
    }
    return false;
  };
  return walk(0, 0);
}
