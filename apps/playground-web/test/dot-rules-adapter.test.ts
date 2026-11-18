import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  sanitizeStateForViewer,
  isCardDefinitionMainDeckAllowed,
} from "@orica/rules-core";
import {
  ownLegalActions,
  savedDecks,
} from "../../../scripts/dot/rules-adapter";

const own = ALL_CARDS.find(
  (card) =>
    card.orikaId &&
    card.printedCategory === "spirit" &&
    card.cost <= 3 &&
    isCardDefinitionMainDeckAllowed(card)
)!;
const opponents = ALL_CARDS.filter(
  (card) => card.cardNo !== own.cardNo && isCardDefinitionMainDeckAllowed(card)
).slice(0, 2);

describe("dot uses actual card data and only the opponent-seat projection", () => {
  it("enumerates real bob actions independently of the hidden alice hand", () => {
    const views = opponents.map((definition) =>
      sanitizeStateForViewer(
        {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              createCardInstance(own, {
                instanceId: "bob-hand",
                ownerPlayerId: "bob",
                zone: "hand",
              }),
              createCardInstance(definition, {
                instanceId: "alice-hand",
                ownerPlayerId: "alice",
                zone: "hand",
              }),
            ],
            playerOverrides: [
              { reserveNormalCoreCount: 20 },
              { reserveNormalCoreCount: 20 },
            ],
          }),
          activePlayerId: "bob",
          step: "main",
          pendingEnterFieldPlacement: null,
        },
        "bob"
      )
    );
    const actions = views.map((view) => ownLegalActions(view));
    expect(actions[0].length).toBeGreaterThan(0);
    expect(actions[0]).toEqual(actions[1]);
  });

  it("returns named saved decks with real card names and text, without choosing one", () => {
    const result = savedDecks([
      {
        id: "named-deck",
        name: "保存されたデッキ",
        cards: [{ id: own.orikaId, count: 3 }],
      },
    ]);
    expect(result[0].name).toBe("保存されたデッキ");
    expect(result[0].cardNos).toEqual([own.cardNo, own.cardNo, own.cardNo]);
    expect(result[0].cards[0]).toMatchObject({
      name: own.name,
      textLines: own.textLines,
      count: 3,
    });
    expect(result[0].selectable).toBe(false);
  });

  it("rejects unknown stored card identities instead of silently replacing them", () => {
    expect(() =>
      savedDecks([
        {
          id: "bad",
          name: "不明カード",
          cards: [{ id: Number.MAX_SAFE_INTEGER, count: 1 }],
        },
      ])
    ).toThrow(/未解決/);
  });
});
