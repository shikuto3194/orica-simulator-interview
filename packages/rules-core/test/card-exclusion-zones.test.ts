import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeRemoveFromGame,
  executeEffectResistance,
  flushPendingLeaves,
} from "../src";
import type { CardZone, GameState } from "../src/model";

const definition = ALL_CARDS.find((card) => card.cardNo === "BSTH01-C01")!;
const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const zones = [
  "field",
  "hand",
  "set_aside",
  "trash",
  "in_use",
] as const satisfies readonly CardZone[];
function setup(zone: CardZone): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    players: createEmptyGameState({ playerIds: ["alice", "bob"] }).players.map(
      (player) => ({
        ...player,
        handCount: player.id === "bob" && zone === "hand" ? 1 : 0,
      })
    ),
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "target",
        ownerPlayerId: "bob",
        zone,
        normalCoreCount: zone === "field" || zone === "in_use" ? 2 : 0,
      }),
    ],
  };
}
function remove(state: GameState, zone: CardZone) {
  return flushPendingLeaves(
    executeRemoveFromGame(
      state,
      "alice",
      {
        kind: "remove_from_game",
        target: { player: "opponent", zone: [zone], count: 1 },
      },
      getDef,
      "alice-source",
      ["target"]
    ),
    getDef
  );
}
describe("カード除外の全移動元", () => {
  describe.each(zones)("%s", (zone) => {
    it("remove_from_gameは除外へ到達しコア・手札枚数を整合する", () => {
      const state = setup(zone);
      const beforeReserve = state.players.find(
        (p) => p.id === "bob"
      )!.reserveNormalCoreCount;
      const result = remove(state, zone);
      const target = result.cardInstances[0]!;
      expect(target.zone).toBe("removed_from_game");
      expect(target.normalCoreCount).toBe(0);
      expect(target.attachedChildrenIds).toEqual([]);
      expect(target.underCards).toEqual([]);
      expect(
        result.cardInstances.filter(
          (c) => c.zone === "void" || c.zone === "trash"
        )
      ).toEqual([]);
      expect(result.players.find((p) => p.id === "bob")!.handCount).toBe(0);
      expect(
        result.players.find((p) => p.id === "bob")!.reserveNormalCoreCount
      ).toBe(beforeReserve + (zone === "field" || zone === "in_use" ? 2 : 0));
      expect(result.pendingLeaveEntities).toEqual([]);
    });
    it("cannot_be_removed_from_game耐性はカード移動を止める", () => {
      const state = executeEffectResistance(
        setup(zone),
        "bob",
        {
          kind: "effect_resistance",
          target: { player: "self", zone: [zone], count: 1 },
          resistType: "cannot_be_removed_from_game",
          source: "opponent_effect",
          duration: { scope: "permanent" },
        },
        "target",
        getDef,
        ["target"]
      );
      const result = remove(state, zone);
      expect(result.cardInstances[0]!.zone).toBe(zone);
      expect(result.pendingLeaveEntities).toEqual([]);
      expect(
        result.cardInstances.some(
          (c) => c.zone === "removed_from_game" || c.zone === "void"
        )
      ).toBe(false);
    });
  });
});
