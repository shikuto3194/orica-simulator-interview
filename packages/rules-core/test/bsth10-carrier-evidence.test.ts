import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type Zone,
} from "../src";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  resolveOracleMechanic,
  resolvePlacementOracleMechanic,
} from "../src/mechanics/oracle-system";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const make = (no: string, id: string, zone: Zone, cores = 0) =>
  createCardInstance(lookup(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: cores,
  });

describe("BSTH10 carrier contracts", () => {
  for (const no of [
    "BSTH10-C01",
    "BSTH10-M01",
    "BSTH10-M02",
    "BSTH10-R01",
    "BSTH10-R02",
    "BSTH10-X02",
    "BSTH10-X05",
  ]) {
    it(`${no} no_contract: 未契約なら召喚し、契約中は手札に残す`, () => {
      for (const contractCardNo of [null, "BSTH09-CX01"]) {
        const state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [make(no, "source", "hand")],
          playerOverrides: [
            { contractCardNo, reserveNormalCoreCount: 20, handCount: 1 },
            {},
          ],
        });
        const result = executeEffect({
          chainId: "test:bsth10-carrier-evidence:44",
          state,
          effect: {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: {
                  kind: "summon",
                  target: { kind: "self", zone: "hand" },
                },
              },
            ],
          },
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
        });
        expect(
          result.cardInstances.find((c) => c.instanceId === "source")?.zone,
          JSON.stringify(result.log)
        ).toBe(contractCardNo ? "hand" : "field");
        expect(result.players[0]!.handCount).toBe(contractCardNo ? 1 : 0);
      }
    });
  }
  for (const no of ["BSTH10-X01", "BSTH10-X03", "BSTH10-X04"]) {
    it(`${no} oracle: 対象の召喚で1コアをボイドから置く`, () => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          make(no, "god", "field"),
          make("BSTH10-M01", "trigger", "field", 1),
        ],
        playerOverrides: [{ voidNormalCoreCount: 10 }, {}],
      });
      const queued = checkAndQueueOracleChoices(
        state,
        "trigger",
        "summon",
        lookup,
        "test:bsth10-carrier-evidence:80"
      );
      const mechanic = queued.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "oracle"
      )?.mechanic;
      expect(mechanic?.kind).toBe("oracle");
      if (mechanic?.kind !== "oracle") throw new Error("oracle missing");
      const result = resolveOracleMechanic(
        queued,
        mechanic,
        "alice",
        true,
        lookup
      );
      expect(
        result.cardInstances.find((c) => c.instanceId === "god")
          ?.normalCoreCount
      ).toBe(1);
      expect(result.players[0]!.voidNormalCoreCount).toBe(9);
    });
    it(`${no} placement_oracle: 3枚をトラッシュへ置き対象数のコアを得る`, () => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          make(no, "god", "field"),
          make("BSTH10-M01", "ultimate", "deck"),
          make("BSTH10-C04", "spirit", "deck"),
          make("BSTH10-X03", "nexus", "deck"),
        ],
        playerOverrides: [{ deckCount: 3, voidNormalCoreCount: 10 }, {}],
      });
      const queued = checkAndQueuePlacementOracle(
        state,
        "god",
        lookup,
        "test:bsth10-carrier-evidence:115"
      );
      const mechanic = queued.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "placement_oracle"
      )?.mechanic;
      expect(mechanic?.kind).toBe("placement_oracle");
      if (mechanic?.kind !== "placement_oracle")
        throw new Error("placement oracle missing");
      const result = resolvePlacementOracleMechanic(queued, mechanic, lookup);
      const amount = no === "BSTH10-X01" ? 3 : 2;
      expect(
        result.cardInstances
          .filter((c) => c.zone === "trash")
          .map((c) => c.instanceId)
      ).toEqual(["ultimate", "spirit", "nexus"]);
      expect(
        result.cardInstances.find((c) => c.instanceId === "god")
          ?.normalCoreCount
      ).toBe(amount);
      expect(result.players[0]!.voidNormalCoreCount).toBe(10 - amount);
    });
  }
});
