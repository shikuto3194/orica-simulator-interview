import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/runtime";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import type { CardDefinition, GameState } from "../src/runtime";

const definitions = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => definitions.get(id);
const card = definitions.get("BSTH02.7-CX01")!;
const getRegisteredFieldCardEffectActions = () => [];
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const skills = card.grandwalkerData!.divineSkills!;
const indices = (state: GameState, sourceId = "alice-nexus") =>
  getAvailableDivineSkillLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  })
    .filter((a) => a.sourceInstanceId === sourceId)
    .map((a) => a.skillIndex);

function fixture(): GameState {
  const nexus = (instanceId: string) =>
    createCardInstance(card, {
      instanceId,
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 20,
    });
  const spirit = createCardInstance(definitions.get("BSTH02.7-C02")!, {
    instanceId: "tired-spirit",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
  });
  const deck = Array.from({ length: 6 }, (_, i) =>
    createCardInstance(definitions.get("BSTH02.7-C02")!, {
      instanceId: `skill-deck-${i}`,
      ownerPlayerId: "alice",
      zone: "deck",
    })
  );
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        nexus("alice-nexus"),
        nexus("other-nexus"),
        spirit,
        ...deck,
      ],
      playerOverrides: [{ deckCount: 6, handCount: 0 }, {}],
    }),
    step: "main",
    activePlayerId: "alice",
  };
}

function fire(state: GameState, skillIndex: number): GameState {
  const action = getAvailableDivineSkillLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).find(
    (a) => a.sourceInstanceId === "alice-nexus" && a.skillIndex === skillIndex
  );
  expect(action).toBeDefined();
  const cores = state.cardInstances.find(
    (c) => c.instanceId === "alice-nexus"
  )!.normalCoreCount;
  state = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).state;
  expect(state.stackWindow).not.toBeNull();
  expect(
    state.cardInstances.find((c) => c.instanceId === "alice-nexus")!
      .normalCoreCount
  ).toBe(cores);
  for (let i = 0; state.stackWindow && i < 10; i++) {
    const pass = getLegalActions({
      state,
      actingPlayerId: state.stackWindow.priorityPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    state = applyLegalAction({
      state,
      action: pass!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
  }
  expect(state.stackWindow).toBeNull();
  // 効果本文の分岐・任意手順は窓後に選び、回復/黄カード移動後のドローまで完走する。
  for (let i = 0; i < 10; i++) {
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
    });
    const pending = actions.find(
      (a) =>
        (a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute") ||
        (a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0) ||
        a.kind === "resolve_pending_effect_target"
    );
    if (!pending) break;
    state = applyLegalAction({
      state,
      action: pending,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      ...(pending.kind === "resolve_pending_effect_target"
        ? { targetInstanceIds: ["tired-spirit"] }
        : {}),
    }).state;
  }
  expect(state.pendingStepChoice).toBeNull();
  expect(state.pendingStepOptionalChoice).toBeNull();
  expect(state.pendingEffectTargetSelection).toBeNull();
  for (let i = 0; state.pendingBurstChecks.length > 0 && i < 10; i++) {
    const check = getLegalActions({
      state,
      actingPlayerId: state.pendingBurstChecks[0]!.actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "decline_pending_burst_check" ||
        a.kind === "resolve_pending_burst_check"
    );
    expect(check).toBeDefined();
    state = applyLegalAction({
      state,
      action: check!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
  }
  expect(state.pendingBurstChecks).toEqual([]);
  expect(
    state.cardInstances.find((c) => c.instanceId === "alice-nexus")!
      .normalCoreCount
  ).toBe(cores - skills[skillIndex]!.coreCost);
  return state;
}

describe("BSTH02.7-CX01 契約技の『ターンに1回ずつ』", () => {
  it.each([
    [3, 4],
    [4, 3],
  ])(
    "%iコア側→%iコア側を各1回発揮でき、同名別個体は独立する",
    (firstCost, secondCost) => {
      const first = skills.findIndex((s) => s.coreCost === firstCost);
      const second = skills.findIndex((s) => s.coreCost === secondCost);
      let state = fixture();
      const voidBefore = state.players[0]!.voidNormalCoreCount;
      state = fire(state, first);
      expect(indices(state)).not.toContain(first);
      expect(indices(state)).toContain(second);
      state = fire(state, second);
      expect(indices(state)).toEqual([]);
      expect(indices(state, "other-nexus").sort()).toEqual([0, 1]);
      expect(state.usedDivineSkillKeysThisTurn).toEqual(
        expect.arrayContaining(["alice-nexus:0", "alice-nexus:1"])
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "tired-spirit")!
          .exhaustState
      ).toBe("recovered");
      expect(
        state.cardInstances.find((c) => c.instanceId === "alice-nexus")!
          .normalCoreCount
      ).toBe(13);
      expect(state.players[0]!.voidNormalCoreCount).toBe(voidBefore + 7);
      expect(
        state.cardInstances.filter(
          (c) => c.instanceId.startsWith("skill-deck-") && c.zone === "trash"
        )
      ).toHaveLength(2);
      expect(
        state.cardInstances.find((c) => c.instanceId === "skill-deck-5")!.zone
      ).toBe("hand");
      // end→startの台帳リセットを経て、次の自分のメインでは双方を再使用できる。
      state = advanceStep(
        { ...state, step: "end" },
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions
      );
      expect(state.usedDivineSkillKeysThisTurn).toEqual([]);
      expect(
        indices({ ...state, step: "main", activePlayerId: "alice" }).sort()
      ).toEqual([0, 1]);
    }
  );
});
