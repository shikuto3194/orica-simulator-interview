import { finishCoreChoices } from "./helpers/core-choice-driver";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  playSummonAsAction,
  moveCardZone,
  executeEffect,
  collectAndQueueTriggerReactions,
  type GameState,
  type LegalAction,
} from "../src";
import { evaluateApplicability } from "../src/effect/effect-applicability";
import { calculateReduction } from "../src/core/cost-system";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookup = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};
function card(
  no: string,
  id: string,
  zone: "hand" | "field" | "deck",
  cores = 0
) {
  return createCardInstance(lookup(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: cores,
  });
}
function setup(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 10, handCount: 2, deckCount: 5 },
        {},
      ],
      cardInstances: [
        card("BSTH07.8-XX01", "lily", "field", 5),
        card("BSTH07.8-C01", "fairy", "hand"),
        card("BSTH07.8-X01", "cirno", "hand"),
        ...Array.from({ length: 5 }, (_, i) =>
          card("BSTH07.8-C01", `deck-${i}`, "deck")
        ),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
    turnNumber: 3,
  };
}
function actions(state: GameState, actingPlayerId = "alice") {
  return getLegalActions({ state, actingPlayerId, ...lookups });
}
function apply(state: GameState, action: LegalAction) {
  return applyLegalAction({ state, action, ...lookups }).state;
}
function pass(state: GameState) {
  const action = actions(state, "bob").find(
    (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
  );
  expect(
    action,
    JSON.stringify({
      actions: actions(state, "bob"),
      pending: Object.keys(state).filter(
        (k) =>
          k.startsWith("pending") &&
          state[k as keyof GameState] &&
          (!Array.isArray(state[k as keyof GameState]) ||
            (state[k as keyof GameState] as unknown[]).length)
      ),
      stack: state.stackWindow,
      flash: state.activeAttack?.flashWindowState,
    })
  ).toBeDefined();
  return apply(state, action!);
}
function battleSetup(): GameState {
  const base = setup();
  const ids = ["attacker-0", "attacker-1", "attacker-2"];
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    cardInstances: [
      ...base.cardInstances,
      ...ids.map((id) => ({
        ...card("BSTH07.8-C01", id, "field", 1),
        exhaustState: "exhausted" as const,
      })),
    ],
    battleEntities: ids.map((id) => ({
      entityId: `be-${id}`,
      memberInstanceIds: [id],
      resolvedBp: 1000,
      resolvedSymbols: ["green"],
      attackState: "attacking",
    })),
    activeAttack: {
      attackId: "fairy-attack",
      primaryEntityId: "be-attacker-0",
      participantEntityIds: ids.map((id) => `be-${id}`),
      groupMode: "simultaneous",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: ids.map((id) => ({
        participantEntityId: `be-${id}`,
        blockedByEntityIds: [],
      })),
      symbolResolutionOrder: ids.map((id) => `be-${id}`),
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
      blockerCapacity: "participant_count",
    },
  } as GameState;
}

describe("BSTH07.8 use-origin regressions", () => {
  it.each([1, 2])(
    "normal hand summon with %i Lilies draws exactly one card",
    (copies) => {
      let state = setup();
      if (copies === 2)
        state = {
          ...state,
          cardInstances: [
            ...state.cardInstances,
            card("BSTH07.8-XX01", "lily-copy", "field", 5),
          ],
        };
      const reduction = calculateReduction({
        state,
        actingPlayerId: "alice",
        card: lookup("BSTH07.8-C01")!,
        sourceInstanceId: "fairy",
        getCardDefinitionById: lookup,
      });
      state = playSummonAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "fairy",
        paymentSources: reduction.finalCost
          ? [{ kind: "reserve", amount: reduction.finalCost }]
          : [],
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        ...lookups,
      }).state;
      const event = state.pendingTriggeredEffects.find(
        (p) => p.eventKind === "summon"
      );
      expect(event?.fromZone).toBe("hand");
      const select = actions(state).find(
        (a) =>
          a.kind === "select_pending_to_resolve" &&
          a.sourceInstanceId === "lily" &&
          a.eventKind === "summon"
      );
      if (select) state = apply(state, select);
      const resolve = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "lily"
      );
      expect(resolve, JSON.stringify(actions(state))).toBeDefined();
      const before = state.players[0]!;
      state = pass(apply(state, resolve!));
      expect(state.players[0]!.handCount).toBe(before.handCount + 1);
      expect(state.players[0]!.deckCount).toBe(before.deckCount - 1);
    }
  );

  it("Cirno hand declaration retains the three-fairy discount through in_use and summons for zero", () => {
    let state = battleSetup();
    const before = state.players[0]!.reserveNormalCoreCount;
    const declaration = actions(state).find(
      (a) => a.kind === "use_hand_card_effect" && a.sourceInstanceId === "cirno"
    );
    expect(declaration, JSON.stringify(actions(state))).toBeDefined();
    state = apply(state, declaration!);
    expect(
      state.cardInstances.find((c) => c.instanceId === "cirno")?.zone
    ).toBe("in_use");
    state = finishCoreChoices(pass(state), lookup, lookups);
    expect(state.pendingEffectSummonCostPayment).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "cirno")
    ).toMatchObject({ zone: "field", normalCoreCount: 3 });
    expect(state.players[0]!.reserveNormalCoreCount).toBe(before);
    expect(
      state.cardInstances.find((c) => c.instanceId === "lily")?.normalCoreCount
    ).toBe(2);
    expect(
      state.pendingTriggeredEffects.find((p) => p.eventKind === "summon")
        ?.fromZone,
      JSON.stringify({
        p: state.pendingTriggeredEffects,
        log: state.log,
        events: state.effectOccurrenceRecords,
      })
    ).toBe("hand");
  });

  it.each([0, 1, 2, 3])(
    "discount still follows %i current battling fairies after leaving hand",
    (count) => {
      let state = battleSetup();
      state = {
        ...state,
        activeAttack:
          count === 0
            ? null
            : {
                ...state.activeAttack!,
                participantEntityIds:
                  state.activeAttack!.participantEntityIds.slice(0, count),
              },
        battleEntities: state.battleEntities.map((entity, i) => ({
          ...entity,
          attackState: i < count ? "attacking" : "idle",
        })),
      };
      state = moveCardZone(state, "cirno", "in_use");
      const result = calculateReduction({
        state,
        actingPlayerId: "alice",
        card: lookup("BSTH07.8-X01")!,
        sourceInstanceId: "cirno",
        getCardDefinitionById: lookup,
      });
      expect(result.additionalCost).toBe(0 - count);
      expect(result.finalCost).toBe(Math.max(0, 3 - count));
      expect(
        state.cardInstances.find((c) => c.instanceId === "cirno")?.zone
      ).toBe("in_use");
    }
  );
  it.each(["trash", "set_aside", "deck"] as const)(
    "does not mistake %s -> in_use -> field for a hand summon",
    (zone) => {
      let state = setup();
      state = moveCardZone(
        moveCardZone(state, "fairy", zone),
        "fairy",
        "in_use"
      );
      const after = executeEffect({
        state,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "summon",
                target: { kind: "self" },
                costModifier: "free",
              },
            },
          ],
        },
        sourceInstanceId: "fairy",
        actingPlayerId: "alice",
        chainId: "non-hand",
        ...lookups,
        summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "fairy")?.zone
      ).toBe("field");
      const queued = collectAndQueueTriggerReactions({
        beforeState: state,
        afterState: after,
        source: "action_resolution",
        chainId: "non-hand",
        getRegisteredBurstActions: undefined,
        ...lookups,
      });
      expect(
        queued.pendingTriggeredEffects.some((p) => p.eventKind === "summon")
      ).toBe(false);
    }
  );
  it("keeps in_use outside hand applicability and resets its origin on a new use", () => {
    let state = moveCardZone(battleSetup(), "cirno", "in_use");
    expect(
      evaluateApplicability(state, { zone: ["hand"] }, "cirno", lookup)
    ).toBe(false);
    expect(state.players[0]!.handCount).toBe(1);
    state = moveCardZone(state, "cirno", "trash");
    state = moveCardZone(state, "cirno", "in_use");
    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: lookup("BSTH07.8-X01")!,
      sourceInstanceId: "cirno",
      getCardDefinitionById: lookup,
    });
    expect(result.additionalCost).toBe(0);
  });
});
