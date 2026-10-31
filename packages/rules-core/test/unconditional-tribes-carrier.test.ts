import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import type { Effect } from "../src/dsl-types";

// Source review batch: each literal card number and its entire unconditional
// tribe list were checked against textLines, rather than derived from tribe.
const reviewedFaces: Array<[string, string[]]> = [
  ["BSTH01-C12", ["幻想", "紅魔"]],
  ["BSTH01-C21", ["幻想"]],
  ["BSTH01-C22", ["紅魔", "導魔"]],
  ["BSTH01-R11", ["幻想"]],
  ["BSTH01-R12", ["幻想", "紅魔"]],
  ["BSTH01-R21", ["幻想", "紅魔"]],
  ["BSTH02-C21", ["幻想", "冥主"]],
  ["BSTH02-R11", ["幻想", "冥主"]],
  ["BSTH03-C12", ["幻想"]],
  ["BSTH03-R02", ["幻想", "起幻"]],
  ["BSTH03-R03", ["幻想", "起幻"]],
  ["BSTH04-C12", ["起幻", "幻想", "冥主"]],
  ["BSTH05-C11", ["幻想"]],
  ["BSTH05-C12", ["幻想"]],
  ["BSTH05-C13", ["幻想"]],
  ["BSTH05-R02", ["幻想"]],
];
const definitions = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const sourceDef = definitions.get("BSTH01-C12")!;
const unrelatedDef: CardDefinition = {
  ...sourceDef,
  cardNo: "TEST-UNRELATED-TRIBE",
  tribe: "異系統",
  effects: [],
};
definitions.set(unrelatedDef.cardNo, unrelatedDef);
const getDef = (id: string) => definitions.get(id);

function instance(
  def: CardDefinition,
  id: string,
  zone: "field" | "hand" | "trash"
) {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone,
    normalCoreCount: zone === "field" ? 1 : 0,
  });
}

function resolve(state: GameState, steps: Effect["steps"]): GameState {
  return executeEffect({
    chainId: "test:unconditional-tribes",
    state,
    effect: { timing: { kind: "activated", mode: "main" }, steps },
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("unconditional tribe source carrier", () => {
  it("系統本文監査16面: 各印字系統でトラッシュ回収と手札破棄を完走し、異系統は残る", () => {
    for (const [cardNo, tribes] of reviewedFaces) {
      const def = definitions.get(cardNo)!;
      const statement = `このカード${["BSTH01-C12", "BSTH01-R21"].includes(cardNo) ? "/ネクサス" : ""}は、系統：${tribes.map((tribe) => `「${tribe}」`).join("/")}を持つ。`;
      expect(def.textLines, cardNo).toContain(statement);
      expect(def.tribe?.split("・"), cardNo).toEqual(tribes);
      // Probe each printed tribe individually, including the second/third
      // tribe. The card's own activated/card_event effects are not the probe.
      for (const tribe of tribes) {
        const base = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance(sourceDef, "source", "field"),
            instance(def, "target-trash", "trash"),
            instance(def, "target-hand", "hand"),
            instance(unrelatedDef, "unrelated-hand", "hand"),
            instance(unrelatedDef, "unrelated-trash", "trash"),
          ],
        });
        const state: GameState = {
          ...base,
          step: "main",
          activePlayerId: "alice",
          players: base.players.map((player) =>
            player.id === "alice" ? { ...player, handCount: 2 } : player
          ),
        };
        const recovered = resolve(state, [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { tribes: [tribe] },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ]);
        expect(recovered.pendingZoneSelection, `${cardNo}/${tribe}`).toBeNull();
        expect(
          recovered.cardInstances.find(
            (card) => card.instanceId === "target-trash"
          )?.zone
        ).toBe("hand");
        expect(recovered.players[0]?.handCount).toBe(3);
        const discarded = resolve(recovered, [
          {
            action: {
              kind: "discard",
              count: "all",
              filter: { tribes: [tribe] },
            },
          },
        ]);
        expect(discarded.pendingZoneSelection).toBeNull();
        expect(
          discarded.cardInstances
            .filter((card) => card.instanceId.startsWith("target-"))
            .map((card) => card.zone)
        ).toEqual(["trash", "trash"]);
        expect(
          discarded.cardInstances.find(
            (card) => card.instanceId === "unrelated-hand"
          )?.zone
        ).toBe("hand");
        expect(
          discarded.cardInstances.find(
            (card) => card.instanceId === "unrelated-trash"
          )?.zone
        ).toBe("trash");
        expect(discarded.players[0]?.handCount).toBe(1);
      }
    }
  });

  it("BSTH01-C12/BSTH01-R21/BSTH02-C21: フィールドのネクサスも各印字系統によるコア移動の対象になる", () => {
    for (const cardNo of ["BSTH01-C12", "BSTH01-R21", "BSTH02-C21"]) {
      const def = definitions.get(cardNo)!;
      const tribes = reviewedFaces.find(([no]) => no === cardNo)![1];
      for (const tribe of tribes) {
        const base = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance(def, "source", "field"),
            instance(unrelatedDef, "unrelated-field", "field"),
          ],
        });
        const after = resolve(base, [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: { category: ["nexus"], tribes: [tribe] },
              },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ]);
        expect(
          after.cardInstances.find((card) => card.instanceId === "source")
            ?.normalCoreCount
        ).toBe(0);
        expect(
          after.cardInstances.find(
            (card) => card.instanceId === "unrelated-field"
          )?.normalCoreCount
        ).toBe(1);
        expect(after.players[0]?.reserveNormalCoreCount).toBe(
          base.players[0]!.reserveNormalCoreCount + 1
        );
      }
    }
  });
});
