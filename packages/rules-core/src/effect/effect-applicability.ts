import type { CardDefinition, GameState, Zone } from "../model";
import type { Effect } from "../dsl-types";
import { evaluateEffectApplicabilityForCard } from "./effect-applicability-core";
import { getCardCurrentLevel } from "./structured-condition-eval";

export function evaluateApplicability(
  state: GameState,
  applicability: NonNullable<Effect["applicability"]>,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceZone?: Zone
): boolean {
  const card = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!card) return false;

  return evaluateEffectApplicabilityForCard({
    state,
    applicability,
    // コストの適用ゾーンだけを宣言元で評価し、state内のカード所在は変えない。
    card: sourceZone === undefined ? card : { ...card, zone: sourceZone },
    definition: getCardDefinitionById(card.definitionId),
    getCardDefinitionById,
    getCurrentLevel: getCardCurrentLevel,
  });
}
