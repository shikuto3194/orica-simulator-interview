import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { applyLegalAction, getLegalActions } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { materializeDeferredTrashOptionalAdds } from "../src/effect/structured-effect-interpreter";
import { resolvePlacementOracleMechanic } from "../src/mechanics/oracle-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const card = (cardNo: string): CardDefinition => {
  const definition = cardNoMap.get(cardNo);
  if (!definition) throw new Error(`card not found: ${cardNo}`);
  return definition;
};
const getCardDefinitionById = (
  definitionId: string
): CardDefinition | undefined => cardNoMap.get(definitionId);

const ALICE = "alice";
const BOB = "bob";

describe("BSTH02-R11 × BSSA01-XX01 配置時神託", () => {
  it("白/紫の神託効果でデッキからトラッシュに置かれたR11を手札に加えると、白/紫の導界者ネクサスにコア1個を置く", () => {
    const cardinal = createCardInstance(card("BSSA01-XX01"), {
      instanceId: "cardinal",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const guideNexus = createCardInstance(card("BSTH02-X01"), {
      instanceId: "saigyouyou",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const r11 = createCardInstance(card("BSTH02-R11"), {
      instanceId: "r11",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const filler1 = createCardInstance(card("BSTH02-C02"), {
      instanceId: "filler-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const filler2 = createCardInstance(card("BSTH02-C03"), {
      instanceId: "filler-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [cardinal, guideNexus, r11, filler1, filler2],
      playerOverrides: [{ deckCount: 3, handCount: 0 }, {}],
    });

    const afterOracle = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "cardinal" },
      getCardDefinitionById
    );

    expect(
      afterOracle.cardInstances.find(
        (candidate) => candidate.instanceId === "r11"
      )?.zone
    ).toBe("trash");
    expect(afterOracle.pendingTrashOptionalAdds).toHaveLength(1);
    expect(afterOracle.pendingTrashOptionalAdds[0]?.instanceIds).toContain(
      "r11"
    );

    const pendingState = materializeDeferredTrashOptionalAdds(afterOracle);
    expect(pendingState.pendingDeckReveal?.origin).toBe("trash");
    expect(
      pendingState.pendingDeckReveal?.revealedAutoAddCandidateIds
    ).toContain("r11");

    const resolvePick = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(resolvePick).toBeDefined();

    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action: resolvePick!,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["r11"],
    }) as { state: GameState };

    expect(
      resolved.cardInstances.find((candidate) => candidate.instanceId === "r11")
        ?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find(
        (candidate) => candidate.instanceId === "saigyouyou"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (candidate) => candidate.instanceId === "cardinal"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((player) => player.id === ALICE)?.handCount
    ).toBe(1);
  });
});
