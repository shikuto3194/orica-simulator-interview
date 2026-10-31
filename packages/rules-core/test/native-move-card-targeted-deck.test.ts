import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeMoveCard } from "../src/effect/native-move-core-handlers";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardDefinition, GameState } from "../src/model";
import type { DSL } from "../src/dsl-types";

const ALICE = "player-1";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-MOVE-CARD",
    name: "Test Move Card",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  } as CardDefinition;
}

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  dummyDef({ cardNo: id });

function makeStateWithHiddenDeck(deckCount: number): GameState {
  return createEmptyGameState({
    playerOverrides: [{ deckCount }, {}],
  });
}

function makeTargetedDeckTrashAction(): DSL.MoveCardAction {
  return {
    kind: "move_card",
    target: {
      kind: "filter",
      player: "self",
      zone: "deck",
      filter: { category: ["spirit"] },
      count: 1,
    },
    from: { zone: "deck", player: "self" },
    to: { zone: "trash", player: "self" },
    count: 1,
  };
}

describe("native move_card targeted deck->trash", () => {
  it("targeted move_card は resolvedTargetIds が空なら hidden deck discard にフォールバックしない", () => {
    const state = makeStateWithHiddenDeck(3);

    const after = executeMoveCard(
      makeTargetedDeckTrashAction(),
      state,
      ALICE,
      "source-1",
      getCardDefinitionById,
      createStepExecutionContext(state),
      []
    );

    expect(after.players.find((p) => p.id === ALICE)?.deckCount).toBe(3);
    expect(
      after.cardInstances.filter((card) => card.zone === "trash")
    ).toHaveLength(0);
    expect(after.log).not.toContain("effect:move_card:deck->trash:1cards");
  });

  it("targeted move_card は resolved target が実在するとそのカードだけを移動する", () => {
    const deckCard = createCardInstance(dummyDef({ cardNo: "DECK-CARD" }), {
      instanceId: "deck-card-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const state: GameState = {
      ...makeStateWithHiddenDeck(1),
      cardInstances: [deckCard],
    };

    const after = executeMoveCard(
      makeTargetedDeckTrashAction(),
      state,
      ALICE,
      "source-1",
      getCardDefinitionById,
      createStepExecutionContext(state),
      [deckCard.instanceId]
    );

    expect(
      after.cardInstances.find(
        (card) => card.instanceId === deckCard.instanceId
      )?.zone
    ).toBe("trash");
    expect(after.players.find((p) => p.id === ALICE)?.deckCount).toBe(0);
    expect(
      after.cardInstances.filter((card) => card.zone === "trash")
    ).toHaveLength(1);
    expect(after.log).toContain("effect:move_card:deck->trash:1cards");
  });
});
