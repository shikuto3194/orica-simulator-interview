import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const koishi = definitions.get("BSTH06-X02")!;
const whiteMagic = ALL_CARDS.find(
  (card) => card.printedCategory === "magic" && card.colors.includes("white")
)!;
const otherMagic = ALL_CARDS.find(
  (card) => card.printedCategory === "magic" && !card.colors.includes("white")
)!;

function fixture(
  owner: string,
  cores = 3,
  recovered = false,
  candidates = true
) {
  const opponent = owner === "alice" ? "bob" : "alice";
  const entry = (
    definition: CardDefinition,
    instanceId: string,
    player = opponent,
    zone: "set_aside" | "hand" = "set_aside"
  ) =>
    createCardInstance(definition, { instanceId, ownerPlayerId: player, zone });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(koishi, {
          instanceId: "koishi",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: cores,
          exhaustState: recovered ? "recovered" : "exhausted",
        }),
        ...(candidates
          ? [
              entry(definitions.get("BSTH06-C01")!, "spirit"),
              entry(definitions.get("BSTH01-C12")!, "nexus"),
              entry(whiteMagic, "white-magic"),
            ]
          : []),
        entry(otherMagic, "other-magic"),
        entry(koishi, "own-set-aside", owner),
        entry(koishi, "opponent-hand", opponent, "hand"),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        handCount: id === opponent ? 1 : 0,
        deckCount: 0,
      })),
    }),
    activePlayerId: owner,
    step: "attack" as const,
  };
}
function resolve(
  owner: string,
  cores = 3,
  recovered = false,
  candidates = true
) {
  return executeEffect({
    state: fixture(owner, cores, recovered, candidates),
    effect: koishi.effects![2]!,
    sourceInstanceId: "koishi",
    actingPlayerId: owner,
    chainId: "test:koishi-discard-chooser",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  });
}

describe("BSTH06-X02 手元破棄の選択者", () => {
  it.each(["alice", "bob"])(
    "%s が相手の手元から選び、選択完了後にだけ回復する",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      const pending = resolve(owner);
      expect(pending.pendingZoneSelection).toMatchObject({
        actingPlayerId: owner,
        effectActingPlayerId: owner,
        targetPlayerId: opponent,
        sourceZone: "set_aside",
        maxCount: 1,
      });
      expect(pending.pendingZoneSelection!.candidateCardInstanceIds).toEqual([
        "spirit",
        "nexus",
        "white-magic",
      ]);
      expect(
        pending.cardInstances.find((card) => card.instanceId === "koishi")!
          .exhaustState
      ).toBe("exhausted");
      expect(
        getLegalActions({
          state: pending,
          actingPlayerId: opponent,
          getCardDefinitionById,
        }).some((action) => action.kind === "resolve_pending_zone_selection")
      ).toBe(false);
      const action = getLegalActions({
        state: pending,
        actingPlayerId: owner,
        getCardDefinitionById,
      }).find((action) => action.kind === "resolve_pending_zone_selection")!;
      expect(action).toBeDefined();
      for (const selected of ["spirit", "nexus", "white-magic"]) {
        const after = applyLegalAction({
          state: structuredClone(pending),
          action,
          selectedZoneCardIds: [selected],
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
        }).state;
        expect(after.pendingZoneSelection).toBeNull();
        expect(
          after.cardInstances
            .filter((card) => card.zone === "trash")
            .map((card) => card.instanceId)
        ).toEqual([selected]);
        expect(
          after.cardInstances.find((card) => card.instanceId === "koishi")!
            .exhaustState
        ).toBe("recovered");
        expect(
          after.cardInstances.find(
            (card) => card.instanceId === "opponent-hand"
          )!.zone
        ).toBe("hand");
        expect(
          after.players.find((player) => player.id === opponent)!.handCount
        ).toBe(1);
        expect(collectGameStateInvariantIssues(after)).toEqual([]);
      }
    }
  );
  it("Lv3でも発揮側が選び、Lv1では破棄も回復もしない", () => {
    expect(resolve("alice", 5).pendingZoneSelection?.actingPlayerId).toBe(
      "alice"
    );
    const after = resolve("alice", 1);
    expect(after.pendingZoneSelection).toBeNull();
    expect(after.cardInstances.some((card) => card.zone === "trash")).toBe(
      false
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "koishi")!
        .exhaustState
    ).toBe("exhausted");
  });
  it("対象がなければ手元破棄も回復もしない", () => {
    const after = resolve("alice", 3, false, false);
    expect(after.pendingZoneSelection).toBeNull();
    expect(after.cardInstances.some((card) => card.zone === "trash")).toBe(
      false
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "koishi")!
        .exhaustState
    ).toBe("exhausted");
  });
});
