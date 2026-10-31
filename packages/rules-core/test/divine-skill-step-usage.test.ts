import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getAvailableDivineSkillLegalActions,
  getLegalActions,
  clearExpiredEffectUsageRecords,
} from "../src";
import { applyDivineSkillAction } from "../src/legal/mechanic-trigger-handlers";
import type { CardDefinition, GameState } from "../src";

// The new step limit must consume the declaration only, never suppress its own resolution.
const printed = ALL_CARDS.find((c) => c.cardNo === "BSTH10-X03")!;
const skill = printed.grandwalkerData!.divineSkills![0]!;
const card: CardDefinition = {
  ...printed,
  grandwalkerData: {
    ...printed.grandwalkerData!,
    divineSkills: [
      {
        ...skill,
        timing: "main",
        usageLimit: { kind: "per_instance", duration: "step" },
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
        ],
      },
    ],
  },
};
const lookup = (id: string) => (id === card.cardNo ? card : undefined);
const available = (state: GameState) =>
  getAvailableDivineSkillLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
  });

describe("神技のステップ回数制限", () => {
  it("BSTH10-X03は実カードを回復し、同じステップの再宣言を止めて次のステップで再使用できる", () => {
    const actualLookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(printed, {
            instanceId: "sagume",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 9,
          }),
          {
            ...createCardInstance(actualLookup("BSTH10-M01")!, {
              instanceId: "target",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            exhaustState: "exhausted",
          },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const actions = () =>
      getAvailableDivineSkillLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: actualLookup,
      });
    for (let round = 0; round < 2; round++) {
      const action = actions()[0];
      expect(action).toBeDefined();
      state = applyDivineSkillAction({
        state,
        action: action!,
        getCardDefinitionById: actualLookup,
      }).state;
      for (let i = 0; state.stackWindow && i < 10; i++) {
        const pass = getLegalActions({
          state,
          actingPlayerId: state.stackWindow.priorityPlayerId,
          getCardDefinitionById: actualLookup,
          getRegisteredFieldCardEffectActions: () => [],
        }).find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        state = applyLegalAction({
          state,
          action: pass!,
          getCardDefinitionById: actualLookup,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
      }
      const targetAction = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: actualLookup,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((a) => a.kind === "resolve_pending_effect_target");
      expect(targetAction).toBeDefined();
      if (targetAction)
        state = applyLegalAction({
          state,
          action: targetAction,
          targetInstanceIds: ["target"],
          getCardDefinitionById: actualLookup,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === "target")
          ?.exhaustState,
        JSON.stringify(state.log)
      ).toBe("recovered");
      expect(
        state.cardInstances.find((c) => c.instanceId === "sagume")
          ?.normalCoreCount
      ).toBe(6 - round * 3);
      expect(actions()).toHaveLength(0);
      if (round === 0) {
        const nextStep: GameState = { ...state, step: "attack" };
        state = {
          ...state,
          effectUsageRecords: clearExpiredEffectUsageRecords(nextStep),
          cardInstances: state.cardInstances.map((c) =>
            c.instanceId === "target" ? { ...c, exhaustState: "exhausted" } : c
          ),
        };
      }
    }
  });
  it("宣言で再使用を止め、宣言済み効果はコアを支払って解決する", () => {
    const source = createCardInstance(card, {
      instanceId: "sagume",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 9,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      step: "main",
      activePlayerId: "alice",
    };
    const action = available(state)[0]!;
    expect(action).toBeDefined();
    const declared = applyDivineSkillAction({
      state,
      action,
      getCardDefinitionById: lookup,
    }).state;
    expect(available(declared)).toHaveLength(0);
    let resolved = declared;
    for (let i = 0; resolved.stackWindow && i < 10; i++) {
      const pass = getLegalActions({
        state: resolved,
        actingPlayerId: resolved.stackWindow.priorityPlayerId,
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      resolved = applyLegalAction({
        state: resolved,
        action: pass!,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
    expect(resolved.stackWindow).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "sagume")
        ?.normalCoreCount
    ).toBe(6);
    expect(resolved.players[0]!.countValue).toBe(1);
  });
});
