import { getCardById } from "../card/card-lookup";
import { getApplicableAdditionalCostDelta } from "../card/card-filter";
import {
  calculateFullReductionSummonCost,
  getEffectiveCostFloor,
  type AdditionalCostModifier,
} from "../core/cost-system";
import { getAvailableCardCostPaymentSources } from "../core/payment-system";
import type { CardDefinition, GameState, SummonAction } from "../model";

/** 無償召喚でもコスト下限と別途の余分支払いは残る（03a）。通常のコスト変更は払わない。 */
export function calculateFreeSummonCost(options: {
  state: GameState;
  actingPlayerId: string;
  definition: CardDefinition;
  sourceInstanceId?: string;
  summonCause?: "effect" | "burst";
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): number {
  const card = options.sourceInstanceId
    ? getCardById(options.state, options.sourceInstanceId)
    : undefined;
  const floor = getEffectiveCostFloor(
    options.definition,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId
  );
  const extra = getApplicableAdditionalCostDelta(
    options.state,
    options.actingPlayerId,
    options.definition,
    {
      ...(card ? { card, cardZone: card.zone } : {}),
      ...(options.summonCause ? { summonCause: options.summonCause } : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      onlyAdditionalPayment: true,
    }
  );
  return Math.max(0, floor + extra);
}

export function resolveSummonActionCost(options: {
  state: GameState;
  actingPlayerId: string;
  definition: CardDefinition;
  action: SummonAction;
  sourceInstanceId?: string;
  perCardOverride?: number;
  additionalCostModifiers?: readonly AdditionalCostModifier[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): number {
  const clampFloor = (
    reducedCost: number,
    additionalCostDelta: number
  ): number => {
    const floor = getEffectiveCostFloor(
      options.definition,
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById,
      options.sourceInstanceId
    );
    return Math.max(0, Math.max(floor, reducedCost + additionalCostDelta));
  };
  const fixedPaymentCost = (
    fixedPayment: number,
    additionalCostDelta: number
  ): number => Math.max(0, fixedPayment + additionalCostDelta);
  const summonCause = options.action.summonCause;
  // engine-summon-cause-conditional-cost-tax (BSTH02-C02):「相手がバースト効果以外の効果で
  // スピリットカードを召喚するとき、3コスト余分に支払わなければ召喚できない」。原文が
  // withoutCost（無償召喚）に対する例外を明示していないため、「支払わなければ召喚できない」を
  // 無償化さえ上書きする絶対的追加コストとして解釈し、全分岐に一律加算する。
  const summonedCardInstance = options.sourceInstanceId
    ? getCardById(options.state, options.sourceInstanceId)
    : undefined;
  const additionalCostDelta =
    summonCause !== undefined
      ? getApplicableAdditionalCostDelta(
          options.state,
          options.actingPlayerId,
          options.definition,
          {
            ...(summonedCardInstance ? { card: summonedCardInstance } : {}),
            summonCause,
            getCardDefinitionById: options.getCardDefinitionById,
          }
        )
      : 0;
  if (options.action.withoutCost)
    return calculateFreeSummonCost({
      ...options,
      ...(summonCause ? { summonCause } : {}),
    });
  // perCardOverride (グループ化コストオーバーライド対象の固定コスト) は、同一 action に
  // 付与されうる action.fullReduction (対象外カードへの軽減シンボル充足コスト) より優先する
  // (BSTH02.7-C06 branch2: オーバーライド対象は overrideCost 固定、対象外は fullReduction)。
  const perCardOverride =
    options.perCardOverride ??
    (options.sourceInstanceId !== undefined
      ? options.action.perCardOverrideCost?.[options.sourceInstanceId]
      : undefined);
  if (perCardOverride !== undefined)
    return clampFloor(perCardOverride, additionalCostDelta);
  if (options.action.fullReduction) {
    // additionalCost は calculateFullReductionSummonCost 内の calculateReduction が
    // summonCause 経由で自動合流させるため、ここでの additionalCostDelta は加算しない
    // (二重加算防止)。
    return calculateFullReductionSummonCost({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      definition: options.definition,
      ...(options.sourceInstanceId !== undefined
        ? { sourceInstanceId: options.sourceInstanceId }
        : {}),
      ...(summonCause !== undefined ? { summonCause } : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }
  if (options.action.fixedPayment !== undefined)
    return fixedPaymentCost(options.action.fixedPayment, additionalCostDelta);
  if (options.action.overrideCost !== undefined) {
    // 「コストNとして」は固定支払いではなく総コストの基準値の置換。通常の召喚と
    // 同じ payment-system を通すことで、軽減シンボル・下限・追加コスト・軽減不能を
    // override 後の値へ一貫して適用する（03a）。
    return getAvailableCardCostPaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: options.definition,
      getCardDefinitionById: options.getCardDefinitionById,
      baseCostOverride: options.action.overrideCost,
      ...(options.sourceInstanceId !== undefined
        ? { sourceInstanceId: options.sourceInstanceId }
        : {}),
      ...(summonCause !== undefined ? { summonCause } : {}),
      ...(options.additionalCostModifiers !== undefined
        ? { additionalCostModifiers: options.additionalCostModifiers }
        : {}),
      useKind:
        options.definition.printedCategory === "nexus"
          ? "place_nexus"
          : "summon",
    }).reduction.finalCost;
  }
  return getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.definition,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    ...(summonCause !== undefined ? { summonCause } : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    useKind:
      options.definition.printedCategory === "nexus" ? "place_nexus" : "summon",
  }).reduction.finalCost;
}

export function buildSummonActionCostModifier(
  costModifier: import("../dsl-types").CostModifier | undefined
): Pick<
  SummonAction,
  "withoutCost" | "fullReduction" | "overrideCost" | "fixedPayment"
> {
  if (costModifier === "free") return { withoutCost: true };
  if (costModifier === "full_reduction") return { fullReduction: true };
  if (typeof costModifier === "object") {
    if ("override" in costModifier)
      return { overrideCost: costModifier.override };
    if ("fixedPayment" in costModifier)
      return { fixedPayment: costModifier.fixedPayment };
  }
  return {};
}
