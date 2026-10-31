import {
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildBurstEffectLookup,
  getLegalActions,
  sanitizeMainDeckDefinitions,
  validateMainDeckDefinitions,
  MIN_DECK_SIZE,
  type GameState,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { parseIdCounts } from "../../apps/playground-web/src/input-validation";
export {
  supabaseUrl,
  supabaseAnonKey,
} from "../../apps/playground-web/src/supabase-config";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definitionsById = new Map(
  expanded.map((definition) => [definition.cardNo, definition])
);
const lookup = (id: string) => definitionsById.get(id);
const idLookup = new Map(ALL_CARDS.map((card) => [card.orikaId, card]));
const lookups = {
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(expanded),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(expanded),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(expanded),
  getRegisteredMagicActions: buildMagicLookup(expanded),
  getRegisteredBurstActions: buildBurstEffectLookup(expanded),
};

/** Input is the server-sanitized opponent-seat snapshot, exactly as in the GUI. */
export function ownLegalActions(state: GameState) {
  return state.gameResult
    ? []
    : getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: lookup,
        ...lookups,
      });
}

export function savedDecks(rows: unknown[]) {
  return rows.map((raw) => {
    const row = raw as { id: string; name: string; cards: unknown };
    if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
      throw new Error("保存デッキの形式を確認してください。");
    }
    const entries = parseIdCounts(row.cards);
    const definitions = entries.flatMap(({ id, count }) => {
      const definition = idLookup.get(id);
      if (!definition)
        throw new Error(
          `デッキ「${row.name}」に未解決のカードID ${id} があります。`
        );
      return Array.from({ length: count }, () => definition);
    });
    const mainDeck = sanitizeMainDeckDefinitions(definitions);
    const issues = validateMainDeckDefinitions(mainDeck);
    return {
      id: row.id,
      name: row.name,
      cardNos: mainDeck.map((card) => card.cardNo),
      selectable: mainDeck.length >= MIN_DECK_SIZE && issues.length === 0,
      issues,
      cards: entries.map(({ id, count }) => {
        const card = idLookup.get(id)!;
        return {
          cardNo: card.cardNo,
          name: card.name,
          count,
          colors: card.colors,
          textLines: card.textLines,
        };
      }),
    };
  });
}
