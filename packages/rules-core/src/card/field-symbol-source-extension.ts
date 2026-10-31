import { getEffectiveTribes } from "../legal/legal-actions-shared";
import { getCEsForTarget } from "./ce-lookup";
import { matchesCardReferenceFilter } from "./card-filter";
import type { CardFilter } from "../dsl-types";
import type { CardDefinition, CardInstance, GameState } from "../model";

/** シンボルだけを場の参照へ追加する。カードのゾーン・場のカード数は変えない。
 * sourceInstanceId を渡した支払い文脈だけが source_card の拡張を受ける。
 * 複数の発生源・拡張に一致しても、同じ物理カードは1回だけ参照する。
 */
export function getExtendedFieldSymbolSourceCards(
  state: GameState,
  playerId: string,
  getDefinition: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string
): CardInstance[] {
  const extensions = getCEsForTarget(state, playerId).filter(
    (ce) =>
      ce.modifierTag === "extend_field_symbol_source" &&
      ce.metadata?.zone &&
      ce.metadata.filter &&
      (ce.metadata.targetScope !== "source_card" ||
        (sourceInstanceId !== undefined &&
          ce.sourceInstanceId === sourceInstanceId))
  );
  return state.cardInstances.filter((card) => {
    if (card.controllerPlayerId !== playerId || card.faceDown) return false;
    const definition = getDefinition(card.definitionId);
    if (!definition) return false;
    return extensions.some(
      (ce) =>
        card.zone === ce.metadata!.zone &&
        matchesCardReferenceFilter(
          card,
          definition,
          ce.metadata!.filter as CardFilter,
          {
            state,
            currentCard: card,
            ...(getDefinition(ce.sourceDefinitionId)
              ? { sourceDefinition: getDefinition(ce.sourceDefinitionId)! }
              : {}),
            effectiveTribes: getEffectiveTribes(
              state,
              card,
              definition,
              getDefinition
            ),
            cardZone: card.zone,
            getCardDefinitionById: getDefinition,
          }
        )
    );
  });
}
