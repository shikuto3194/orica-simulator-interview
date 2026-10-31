import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { matchesCardFilter } from "../src/card/card-filter";
import { matchesOracleCondition } from "../src/mechanics/oracle-system";
import {
  hasZeroCounter,
  isImaginBrave,
  isQuartz,
  getQuartzSetStatesByHost,
  getQuartzHost,
} from "../src/model";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import type { CardDefinition, GameState, QuartzSetState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function makeBaseGameState(): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    startingLife: 5,
    startingDeckCount: 40,
  });
}

describe("P2-07 type scaffolding", () => {
  describe("E-1 ZeroCounterData", () => {
    it("hasZeroCounter returns true when zeroCounterData is present", () => {
      const def: Pick<CardDefinition, "zeroCounterData"> = {
        zeroCounterData: {
          cost: 3,
          reduction: ["red"],
          recoveryCost: 2,
        },
      };
      expect(hasZeroCounter(def)).toBe(true);
    });

    it("hasZeroCounter returns false when zeroCounterData is absent", () => {
      expect(hasZeroCounter({})).toBe(false);
    });

    it("ZeroCounterData accepts effects array", () => {
      const def: Pick<CardDefinition, "zeroCounterData"> = {
        zeroCounterData: {
          cost: 0,
          reduction: [],
          effects: [
            {
              timing: { kind: "activated", mode: "stack" },
              steps: [],
            },
          ],
        },
      };
      expect(def.zeroCounterData?.effects?.length).toBe(1);
    });
  });

  describe("G-1 ImaginBraveData", () => {
    it("isImaginBrave returns true when imaginBraveData is present", () => {
      const def: Pick<CardDefinition, "imaginBraveData"> = {
        imaginBraveData: {
          leftCondition: { tribes: ["風神"], minCost: 5 },
          rightCondition: { tribes: ["風神"], minCost: 5 },
        },
      };
      expect(isImaginBrave(def)).toBe(true);
    });

    it("isImaginBrave returns false when imaginBraveData is absent", () => {
      expect(isImaginBrave({})).toBe(false);
    });

    it("ImaginBraveData supports sharedCondition fallback", () => {
      const def: Pick<CardDefinition, "imaginBraveData"> = {
        imaginBraveData: {
          sharedCondition: { tribes: ["風神"] },
        },
      };
      expect(def.imaginBraveData?.sharedCondition?.tribes).toEqual(["風神"]);
      expect(def.imaginBraveData?.leftCondition).toBeUndefined();
      expect(def.imaginBraveData?.rightCondition).toBeUndefined();
    });
  });

  describe("H-2 QuartzData", () => {
    it("isQuartz returns true when quartzData is present", () => {
      const def: Pick<CardDefinition, "quartzData"> = {
        quartzData: {
          quartzName: "テスト珠",
          cost: 2,
          reduction: [],
          attributeValues: { 時: 5 },
        },
      };
      expect(isQuartz(def)).toBe(true);
    });

    it("isQuartz returns false when quartzData is absent", () => {
      expect(isQuartz({})).toBe(false);
    });

    it("QuartzData supports countCost (カウント消費型)", () => {
      const def: Pick<CardDefinition, "quartzData"> = {
        quartzData: {
          quartzName: "テスト珠",
          cost: 0,
          reduction: [],
          countCost: 2,
        },
      };
      expect(def.quartzData?.countCost).toBe(2);
    });

    it("QuartzData supports hostFilter for ホスト限定", () => {
      const def: Pick<CardDefinition, "quartzData"> = {
        quartzData: {
          quartzName: "テスト珠",
          cost: 1,
          reduction: [],
          hostFilter: { tribes: ["戦術オーブメント"] },
        },
      };
      expect(def.quartzData?.hostFilter?.tribes).toEqual(["戦術オーブメント"]);
    });
  });

  describe("QuartzSetState management", () => {
    function quartzDef(): CardDefinition {
      return {
        cardNo: "QZ-001",
        name: "Quartz Test",
        printedCategory: "magic",
        colors: ["blue"],
        cost: 2,
        reductionSymbols: [],
        levelDefs: [],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
        quartzData: { quartzName: "テスト珠", cost: 2, reduction: [] },
      };
    }

    function hostDef(): CardDefinition {
      return {
        cardNo: "HOST-001",
        name: "Host Test",
        printedCategory: "spirit",
        colors: ["blue"],
        cost: 4,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
        symbolColors: ["blue"],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
      };
    }

    function makeQuartzCard(instanceId: string, owner: string) {
      return createCardInstance(quartzDef(), {
        instanceId,
        ownerPlayerId: owner,
        zone: "field",
      });
    }

    function makeHostCard(instanceId: string, owner: string) {
      return createCardInstance(hostDef(), {
        instanceId,
        ownerPlayerId: owner,
        zone: "field",
      });
    }

    it("getQuartzSetStatesByHost returns empty when none set", () => {
      const state = makeBaseGameState();
      expect(getQuartzSetStatesByHost(state, "host-1")).toEqual([]);
    });

    it("getQuartzSetStatesByHost finds sets attached to host", () => {
      const state = makeBaseGameState();
      const sets: QuartzSetState[] = [
        {
          quartzInstanceId: "qz-1",
          hostInstanceId: "host-1",
          ownerPlayerId: ALICE,
        },
        {
          quartzInstanceId: "qz-2",
          hostInstanceId: "host-1",
          ownerPlayerId: ALICE,
        },
        {
          quartzInstanceId: "qz-3",
          hostInstanceId: "host-2",
          ownerPlayerId: ALICE,
        },
      ];
      const populated: GameState = { ...state, quartzSetStates: sets };
      const found = getQuartzSetStatesByHost(populated, "host-1");
      expect(found.map((q) => q.quartzInstanceId)).toEqual(["qz-1", "qz-2"]);
    });

    it("getQuartzHost returns host instanceId for set quartz", () => {
      const state = makeBaseGameState();
      const populated: GameState = {
        ...state,
        quartzSetStates: [
          {
            quartzInstanceId: "qz-1",
            hostInstanceId: "host-1",
            ownerPlayerId: ALICE,
          },
        ],
      };
      expect(getQuartzHost(populated, "qz-1")).toBe("host-1");
      expect(getQuartzHost(populated, "qz-unknown")).toBeNull();
    });

    it("invariant detects duplicate quartzInstanceId", () => {
      const state = makeBaseGameState();
      const quartz = makeQuartzCard("qz-1", ALICE);
      const host = makeHostCard("host-1", ALICE);
      const populated: GameState = {
        ...state,
        cardInstances: [quartz, host],
        quartzSetStates: [
          {
            quartzInstanceId: "qz-1",
            hostInstanceId: "host-1",
            ownerPlayerId: ALICE,
          },
          {
            quartzInstanceId: "qz-1",
            hostInstanceId: "host-1",
            ownerPlayerId: ALICE,
          },
        ],
      };
      const issues = collectGameStateInvariantIssues(populated);
      const duplicateIssue = issues.find(
        (i) => i.code === "duplicate_quartz_set_card_instance"
      );
      expect(duplicateIssue).toBeDefined();
    });

    it("invariant detects missing host card", () => {
      const state = makeBaseGameState();
      const quartz = makeQuartzCard("qz-1", ALICE);
      const populated: GameState = {
        ...state,
        cardInstances: [quartz],
        quartzSetStates: [
          {
            quartzInstanceId: "qz-1",
            hostInstanceId: "host-missing",
            ownerPlayerId: ALICE,
          },
        ],
      };
      const issues = collectGameStateInvariantIssues(populated);
      const missingHost = issues.find(
        (i) => i.code === "missing_quartz_host_card"
      );
      expect(missingHost).toBeDefined();
    });

    it("invariant detects unknown owner", () => {
      const state = makeBaseGameState();
      const quartz = makeQuartzCard("qz-1", ALICE);
      const host = makeHostCard("host-1", ALICE);
      const populated: GameState = {
        ...state,
        cardInstances: [quartz, host],
        quartzSetStates: [
          {
            quartzInstanceId: "qz-1",
            hostInstanceId: "host-1",
            ownerPlayerId: "unknown-player",
          },
        ],
      };
      const issues = collectGameStateInvariantIssues(populated);
      const ownerIssue = issues.find((i) => i.code === "missing_quartz_owner");
      expect(ownerIssue).toBeDefined();
    });

    it("clean state with valid quartz set has no related invariant issues", () => {
      const state = makeBaseGameState();
      const quartz = makeQuartzCard("qz-1", ALICE);
      const host = makeHostCard("host-1", ALICE);
      const populated: GameState = {
        ...state,
        cardInstances: [quartz, host],
        quartzSetStates: [
          {
            quartzInstanceId: "qz-1",
            hostInstanceId: "host-1",
            ownerPlayerId: ALICE,
          },
        ],
      };
      const issues = collectGameStateInvariantIssues(populated);
      const quartzRelated = issues.filter(
        (i) =>
          i.code.startsWith("missing_quartz_") ||
          i.code === "duplicate_quartz_set_card_instance"
      );
      expect(quartzRelated).toEqual([]);
    });
  });

  describe("CardDefinition field integration", () => {
    it("a single CardDefinition can carry zeroCounterData + imaginBraveData + quartzData", () => {
      const def = {
        cardNo: "TEST-001",
        name: "Test",
        printedCategory: "spirit" as const,
        colors: ["red"] as const,
        cost: 4,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: ["red"] as const,
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C" as const,
        zeroCounterData: { cost: 1, reduction: [] },
        imaginBraveData: { sharedCondition: { tribes: ["X"] } },
        quartzData: { quartzName: "テスト珠", cost: 1, reduction: [] },
      } satisfies CardDefinition;
      expect(hasZeroCounter(def)).toBe(true);
      expect(isImaginBrave(def)).toBe(true);
      expect(isQuartz(def)).toBe(true);
    });

    it("hasMechanic matches P2-07 scaffold fields", () => {
      const base = {
        cardNo: "TEST-002",
        name: "Mechanic Test",
        printedCategory: "spirit" as const,
        colors: ["red"] as const,
        cost: 4,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: ["red"] as const,
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C" as const,
      };
      const def = {
        ...base,
        zeroCounterData: { cost: 1, reduction: [] },
        imaginBraveData: { sharedCondition: { tribes: ["X"] } },
        quartzData: { quartzName: "テスト珠", cost: 1, reduction: [] },
      } satisfies CardDefinition;
      const card = createCardInstance(def, {
        instanceId: "mechanic-test",
        ownerPlayerId: ALICE,
      });

      expect(
        matchesCardFilter(card, def, { hasMechanic: ["zero_counter"] })
      ).toBe(true);
      expect(matchesCardFilter(card, def, { hasMechanic: ["imagin"] })).toBe(
        true
      );
      expect(matchesCardFilter(card, def, { hasMechanic: ["quartz"] })).toBe(
        true
      );
      expect(matchesOracleCondition(def, { hasMechanic: ["quartz"] })).toBe(
        true
      );
    });
  });
});
