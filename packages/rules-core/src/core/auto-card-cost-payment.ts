import { getCardById } from "../card/card-lookup";
import {
  getAvailableCardCostPaymentSources,
  type CardCostPaymentSource,
} from "./payment-system";
import type { CardDefinition, GameState } from "../model";
import type { CardFilter } from "../dsl-types";

export function chooseAutoCardCostPaymentSources(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  amount: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  excludedInstanceIds: ReadonlySet<string> = new Set(),
  onBoardCoreSourceFilter?: CardFilter
): readonly CardCostPaymentSource[] | null {
  if (amount === 0) return [];
  const available = getAvailableCardCostPaymentSources({
    state,
    actingPlayerId,
    card: definition,
    getCardDefinitionById,
    ...(sourceInstanceId !== undefined ? { sourceInstanceId } : {}),
    ...(onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter }
      : {}),
  });

  if (onBoardCoreSourceFilter !== undefined) {
    let filteredRemaining = amount;
    const filteredSources: CardCostPaymentSource[] = [];
    for (const source of available.onBoardCoreSources) {
      if (filteredRemaining <= 0) break;
      if (excludedInstanceIds.has(source.instanceId)) continue;
      const card = getCardById(state, source.instanceId);
      if (!card) continue;
      const take = Math.min(source.availableCoreAmount, filteredRemaining);
      if (take <= 0) continue;
      filteredSources.push({
        kind: "card",
        instanceId: source.instanceId,
        amount: take,
        ...(take > card.normalCoreCount && source.soulCoreAvailable
          ? { includeSoulCore: true }
          : {}),
      });
      filteredRemaining -= take;
    }

    if (filteredRemaining === 0) {
      return filteredSources;
    }
    if (available.reserveSource.availableCoreAmount >= amount) {
      return [{ kind: "reserve", amount }];
    }

    return null;
  }

  let remaining = amount;
  const sources: CardCostPaymentSource[] = [];
  const reserveAmount = Math.min(
    available.reserveSource.availableCoreAmount,
    remaining
  );
  if (reserveAmount > 0) {
    sources.push({ kind: "reserve", amount: reserveAmount });
    remaining -= reserveAmount;
  }

  for (const source of available.onBoardCoreSources) {
    if (remaining <= 0) break;
    if (excludedInstanceIds.has(source.instanceId)) continue;
    const card = getCardById(state, source.instanceId);
    if (!card) continue;
    const take = Math.min(source.availableCoreAmount, remaining);
    if (take <= 0) continue;
    sources.push({
      kind: "card",
      instanceId: source.instanceId,
      amount: take,
      ...(take > card.normalCoreCount && source.soulCoreAvailable
        ? { includeSoulCore: true }
        : {}),
    });
    remaining -= take;
  }

  return remaining === 0 ? sources : null;
}
