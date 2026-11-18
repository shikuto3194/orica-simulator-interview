import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type Effect,
} from "@orica/rules-core";
import { applyChosenAction, type Engine } from "./selfplay-driver";

const SOURCE: CardDefinition = {
  cardNo: "SELFPLAY-HAND-GAIN-SOURCE",
  name: "Selfplay hand gain source",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const engine: Engine = {
  cards: [SOURCE],
  getCardDefinitionById: (id) => (id === SOURCE.cardNo ? SOURCE : undefined),
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

describe("selfplay-driver: hand gain core source allocation", () => {
  it.each([
    { name: "normal and soul", normal: 1, soul: 1, cost: 2 },
    { name: "normal only", normal: 2, soul: 0, cost: 2 },
    { name: "soul only", normal: 0, soul: 1, cost: 1 },
  ])(
    "$name: pays the cost and resumes the hand gain",
    ({ normal, soul, cost }) => {
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {},
          {
            reserveNormalCoreCount: normal,
            reserveSoulCoreCount: soul,
            soulCoreLocation: soul ? { kind: "reserve" } : null,
            trashNormalCoreCount: 0,
            trashSoulCoreCount: 0,
            handCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(SOURCE, {
            instanceId: "tax-source",
            ownerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(SOURCE, {
            instanceId: "gain-source",
            ownerPlayerId: "bob",
            zone: "field",
          }),
          createCardInstance(SOURCE, {
            instanceId: "recovered",
            ownerPlayerId: "bob",
            zone: "trash",
          }),
        ],
      });
      state = { ...state, activePlayerId: "alice", step: "main" };
      const aliceBefore = state.players[0]!;
      const tax: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "require_hand_gain_cost",
              player: "opponent",
              costAmount: cost,
              duration: { scope: "while_on_field" },
            },
          },
        ],
      };
      state = executeEffect({
        chainId: "test:selfplay-core-source:tax",
        state,
        effect: tax,
        sourceInstanceId: "tax-source",
        actingPlayerId: "alice",
        getCardDefinitionById: engine.getCardDefinitionById,
      });
      state = executeEffect({
        chainId: "test:selfplay-core-source:gain",
        state,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "move_card",
                from: { zone: "trash", player: "self" },
                to: { zone: "hand" },
                count: 1,
              },
            },
          ],
        },
        sourceInstanceId: "gain-source",
        actingPlayerId: "bob",
        getCardDefinitionById: engine.getCardDefinitionById,
      });
      expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(cost);
      expect(state.pendingCoreSourceAllocation?.actingPlayerId).toBe("bob");
      expect(
        state.cardInstances.find((card) => card.instanceId === "recovered")
          ?.zone
      ).toBe("trash");
      const action = getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: engine.getCardDefinitionById,
        ...engine.lookups,
      }).find(
        (candidate) => candidate.kind === "resolve_core_source_allocation"
      );
      expect(action).toBeDefined();
      if (!action) throw new Error("Expected hand gain payment action");
      const after = applyChosenAction(state, action, engine);
      expect(after.pendingCoreSourceAllocation).toBeNull();
      expect(
        after.cardInstances.find((card) => card.instanceId === "recovered")
          ?.zone
      ).toBe("hand");
      expect(after.players[1]?.handCount).toBe(1);
      expect(after.players[1]?.reserveNormalCoreCount).toBe(0);
      expect(after.players[1]?.trashNormalCoreCount).toBe(normal);
      expect(after.players[1]?.reserveSoulCoreCount).toBe(0);
      expect(after.players[1]?.trashSoulCoreCount).toBe(soul);
      expect(after.players[1]?.soulCoreLocation).toEqual(
        soul ? { kind: "trash" } : null
      );
      expect(after.players[0]?.reserveNormalCoreCount).toBe(
        aliceBefore.reserveNormalCoreCount
      );
      expect(after.activePlayerId).toBe("alice");
    }
  );
});
