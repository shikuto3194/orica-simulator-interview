import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  sanitizeStateForViewer,
  type CardDefinition,
  type Effect,
} from "../src";

function board(effect?: Effect) {
  const actual = ALL_CARDS.find((c) => c.cardNo === "BSTH002-転醒R01(A)")!;
  const source: CardDefinition = {
    ...actual,
    effects: effect ? [effect] : actual.effects,
  };
  const filler = ALL_CARDS.find((c) => c.cardNo === "BSTH001-C01")!;
  const getCardDefinitionById = (id: string) =>
    id === source.cardNo ? source : id === filler.cardNo ? filler : undefined;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      ...[0, 1].map((i) =>
        createCardInstance(filler, {
          instanceId: `hand-${i}`,
          ownerPlayerId: "alice",
          zone: "hand",
        })
      ),
    ],
    playerOverrides: [
      { handCount: 2, deckCount: 0, reserveNormalCoreCount: 5 },
      {},
    ],
  });
  return { state, source, getCardDefinitionById };
}
describe("conditional cost continuation preserves the pre-cost snapshot", () => {
  it("declining an unavailable optional cost cannot undo the independent count prefix", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
        {
          executionMode: "optional",
          action: { kind: "discard", player: "self", count: 1 },
        },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    const f = board(effect);
    f.state.cardInstances = f.state.cardInstances.filter(
      (c) => c.zone !== "hand"
    );
    f.state.players[0]!.handCount = 0;
    const current = executeEffect({
      state: f.state,
      effect,
      effectIndex: 0,
      chainId: "snapshot-declined-tail",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const decline = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(decline).toBeDefined();
    const after = applyLegalAction({
      state: current,
      action: decline!,
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.players[0]).toMatchObject({
      countValue: 1,
      handCount: 0,
      deckCount: 0,
    });
    expect(after.pendingStepOptionalChoice).toBeNull();
  });
  it("BSTH002-転醒R01(A): no draw after selected discard refunds the card across JSON persistence", () => {
    const f = board();
    const pending = executeEffect({
      state: f.state,
      effect: f.source.effects![2]!,
      effectIndex: 2,
      chainId: "snapshot-makai",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(pending.pendingZoneSelection).not.toBeNull();
    expect(
      pending.pendingZoneSelection?.continuation?.stepContext
        .conditionalCostOriginalState
    ).toBeDefined();
    const restored = JSON.parse(JSON.stringify(pending));
    const action = getLegalActions({
      state: restored,
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const after = applyLegalAction({
      state: restored,
      action,
      selectedZoneCardIds: ["hand-1"],
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.players[0]).toMatchObject({ handCount: 2, deckCount: 0 });
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
    expect(after.pendingZoneSelection).toBeNull();
  });
  it("server-only rollback state is removed for the owner, opponent and spectator", () => {
    const f = board();
    const pending = executeEffect({
      state: f.state,
      effect: f.source.effects![2]!,
      effectIndex: 2,
      chainId: "snapshot-private",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const internal =
      pending.pendingZoneSelection!.continuation!.stepContext
        .conditionalCostOriginalState!;
    internal.log = [...internal.log, "PRIVATE-CONDITIONAL-COST-SNAPSHOT"];
    for (const viewer of ["alice", "bob", null]) {
      const shown = JSON.stringify(sanitizeStateForViewer(pending, viewer));
      expect(shown).not.toContain("conditionalCostOriginalState");
      expect(shown).not.toContain("PRIVATE-CONDITIONAL-COST-SNAPSHOT");
    }
  });
  it("an independent draw before the cost survives a resumed rollback", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          action: { kind: "discard", count: 1, player: "self" },
        },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    const f = board(effect);
    const filler = ALL_CARDS.find((c) => c.cardNo === "BSTH001-C01")!;
    f.state.cardInstances.push(
      createCardInstance(filler, {
        instanceId: "prefix-draw",
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    f.state.players[0]!.deckCount = 1;
    let current = executeEffect({
      state: f.state,
      effect,
      effectIndex: 0,
      chainId: "snapshot-prefix",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const select = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    expect(select).toBeDefined();
    current = applyLegalAction({
      state: JSON.parse(JSON.stringify(current)),
      action: select!,
      selectedZoneCardIds: ["hand-1"],
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(current.players[0]).toMatchObject({ handCount: 3, deckCount: 0 });
    expect(
      current.cardInstances.find((c) => c.instanceId === "prefix-draw")?.zone
    ).toBe("hand");
    expect(
      current.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
    expect(current.pendingZoneSelection).toBeNull();
    expect(current.pendingStepOptionalChoice).toBeNull();
  });
});
