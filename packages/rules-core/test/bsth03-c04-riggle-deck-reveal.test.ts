import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(cardNo: string): CardDefinition {
  const def = cardNoMap.get(cardNo);
  if (!def) throw new Error(`missing card: ${cardNo}`);
  return def;
}

function firstPickAction(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  if (!action || action.kind !== "resolve_pending_deck_reveal_pick") {
    throw new Error("missing deck reveal pick action");
  }
  return action;
}

function resolveStepOptional(
  state: GameState,
  choice: "execute" | "decline"
): GameState {
  const pending = state.pendingStepOptionalChoice;
  if (!pending) throw new Error("missing pending step optional choice");
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_choice",
      actionId: `pso-${pending.pendingId}:${choice}`,
      can: true,
      reason: "test",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      effectIndex: pending.effectIndex,
      stepIndex: pending.stepIndex,
      choice,
    },
    getCardDefinitionById,
  }).state;
}

function setupState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const source = createCardInstance(card("BSTH03-C04"), {
    instanceId: "riggle-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const guidedKigen = createCardInstance(card("BSTH09.2-X01"), {
    instanceId: "guided-kigen-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "deck",
  });
  const fantasyKigen = createCardInstance(card("BSTH09.2-C01"), {
    instanceId: "fantasy-kigen-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "deck",
  });
  const guidedNoKigen = createCardInstance(card("BSTH003-X03"), {
    instanceId: "guided-no-kigen-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "deck",
  });
  const guidedFantasyKigen = createCardInstance(card("BSTH09.2-XX01"), {
    instanceId: "guided-fantasy-kigen-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "deck",
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      source,
      guidedKigen,
      guidedFantasyKigen,
      fantasyKigen,
      guidedNoKigen,
    ],
    players: base.players.map((p) =>
      p.id === "alice" ? { ...p, deckCount: 4, voidNormalCoreCount: 1 } : p
    ),
  };
}

function setupOverlapOnlyState(): GameState {
  const state = setupState();
  return {
    ...state,
    cardInstances: state.cardInstances.filter(
      (cardInstance) => cardInstance.instanceId !== "fantasy-kigen-1"
    ),
    players: state.players.map((p) =>
      p.id === "alice" ? { ...p, deckCount: 3 } : p
    ),
  };
}

function setupOverlapOnlyNoFirstState(): GameState {
  const state = setupOverlapOnlyState();
  return {
    ...state,
    cardInstances: state.cardInstances.filter(
      (cardInstance) => cardInstance.instanceId !== "guided-kigen-1"
    ),
    players: state.players.map((p) =>
      p.id === "alice" ? { ...p, deckCount: 2 } : p
    ),
  };
}

describe("BSTH03-C04 Riggle Nightbug deck reveal", () => {
  const riggle = card("BSTH03-C04");

  it("can place a core and decline the independent deck reveal choice", () => {
    const afterCoreChoice = executeEffect({
      chainId: "test:bsth03-c04-riggle-deck-reveal:139",
      state: setupState(),
      effect: riggle.effects![1]!,
      sourceInstanceId: "riggle-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(afterCoreChoice.pendingStepOptionalChoice?.stepIndex).toBe(0);

    const afterCore = resolveStepOptional(afterCoreChoice, "execute");
    expect(
      afterCore.cardInstances.find((c) => c.instanceId === "riggle-1")
        ?.normalCoreCount
    ).toBe(2);
    expect(afterCore.pendingStepOptionalChoice?.stepIndex).toBe(1);

    const finalState = resolveStepOptional(afterCore, "decline");
    expect(finalState.pendingStepOptionalChoice).toBeNull();
    expect(finalState.pendingDeckReveal).toBeNull();
    expect(
      finalState.cardInstances.filter((c) => c.zone === "deck").length
    ).toBe(4);
  });

  it("can skip the core placement and reveal only cards matching both required tribes", () => {
    const pickFilter = riggle.effects![1]?.steps[1]?.action;
    expect(pickFilter?.kind).toBe("deck_reveal");
    if (pickFilter?.kind === "deck_reveal") {
      expect(pickFilter.picks[0]?.filter).toMatchObject({
        category: ["nexus"],
        colors: ["red", "green"],
        tribes: ["起幻"],
        targetsGrandwalker: true,
        hasMechanic: ["guided"],
      });
    }

    const afterCoreChoice = executeEffect({
      chainId: "test:bsth03-c04-riggle-deck-reveal:176",
      state: setupState(),
      effect: riggle.effects![1]!,
      sourceInstanceId: "riggle-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(afterCoreChoice.pendingStepOptionalChoice?.stepIndex).toBe(0);

    const afterCoreDecline = resolveStepOptional(afterCoreChoice, "decline");
    expect(
      afterCoreDecline.cardInstances.find((c) => c.instanceId === "riggle-1")
        ?.normalCoreCount
    ).toBe(1);
    expect(afterCoreDecline.pendingStepOptionalChoice?.stepIndex).toBe(1);

    const afterReveal = resolveStepOptional(afterCoreDecline, "execute");

    const firstPick = firstPickAction(afterReveal);
    expect(firstPick.canSkip).toBe(false);
    expect(firstPick.candidateCardInstanceIds).toContain("guided-kigen-1");
    expect(firstPick.candidateCardInstanceIds).toContain(
      "guided-fantasy-kigen-1"
    );
    expect(firstPick.candidateCardInstanceIds).not.toContain(
      "guided-no-kigen-1"
    );
    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: firstPick,
        getCardDefinitionById,
        selectedDeckRevealCardIds: [],
      })
    ).toThrow(/requires 1 selection/);

    const afterFirstPick = applyLegalAction({
      state: afterReveal,
      action: firstPick,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["guided-kigen-1"],
    }).state;

    const secondPick = firstPickAction(afterFirstPick);
    expect(secondPick.canSkip).toBe(false);
    expect(secondPick.candidateCardInstanceIds).toContain("fantasy-kigen-1");
    expect(secondPick.candidateCardInstanceIds).toContain(
      "guided-fantasy-kigen-1"
    );
    expect(secondPick.candidateCardInstanceIds).not.toContain(
      "guided-no-kigen-1"
    );

    const finalState = applyLegalAction({
      state: afterFirstPick,
      action: secondPick,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["fantasy-kigen-1"],
    }).state;

    expect(finalState.pendingDeckReveal).toBeNull();
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "guided-kigen-1")
        ?.zone
    ).toBe("hand");
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "fantasy-kigen-1")
        ?.zone
    ).toBe("hand");
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "guided-no-kigen-1")
        ?.zone
    ).toBe("deck");
    expect(
      finalState.cardInstances.find(
        (c) => c.instanceId === "guided-fantasy-kigen-1"
      )?.zone
    ).toBe("deck");
  });

  it("first pick preserves overlap cards for a later mandatory group when another first pick exists", () => {
    const afterCoreChoice = executeEffect({
      chainId: "test:bsth03-c04-riggle-deck-reveal:257",
      state: setupOverlapOnlyState(),
      effect: riggle.effects![1]!,
      sourceInstanceId: "riggle-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const afterCoreDecline = resolveStepOptional(afterCoreChoice, "decline");
    const afterReveal = resolveStepOptional(afterCoreDecline, "execute");

    const firstPick = firstPickAction(afterReveal);
    expect(firstPick.canSkip).toBe(false);
    expect(firstPick.candidateCardInstanceIds).toEqual(["guided-kigen-1"]);

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: firstPick,
        getCardDefinitionById,
        selectedDeckRevealCardIds: ["guided-fantasy-kigen-1"],
      })
    ).toThrow(/Invalid deck reveal pick candidate/);

    const afterFirstPick = applyLegalAction({
      state: afterReveal,
      action: firstPick,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["guided-kigen-1"],
    }).state;
    const secondPick = firstPickAction(afterFirstPick);
    expect(secondPick.candidateCardInstanceIds).toEqual([
      "guided-fantasy-kigen-1",
    ]);
    expect(secondPick.canSkip).toBe(false);
  });

  it("does not skip a mandatory group just because its only match also satisfies a later group", () => {
    const afterCoreChoice = executeEffect({
      chainId: "test:bsth03-c04-riggle-deck-reveal:294",
      state: setupOverlapOnlyNoFirstState(),
      effect: riggle.effects![1]!,
      sourceInstanceId: "riggle-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const afterCoreDecline = resolveStepOptional(afterCoreChoice, "decline");
    const afterReveal = resolveStepOptional(afterCoreDecline, "execute");

    const firstPick = firstPickAction(afterReveal);
    expect(firstPick.candidateCardInstanceIds).toEqual([
      "guided-fantasy-kigen-1",
    ]);
    expect(firstPick.canSkip).toBe(false);

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: firstPick,
        getCardDefinitionById,
        selectedDeckRevealCardIds: [],
      })
    ).toThrow(/requires 1 selection/);
  });
});
