import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/runtime";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import type {
  CardCategory,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/model";
import {
  effectUsageEntryCount,
  listEffectUsage,
  sharedNameUsageLabel,
} from "./helpers/effect-usage-fixture";

const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const sword = cards.get("BSRK01-X01")!;
const host = cards.get("BSRK01-C04")!;
const under = cards.get("BSRK01-CX01")!;
const hand: CardDefinition = {
  ...under,
  cardNo: "TEST-OATH-HAND",
  name: "hand",
  effects: [],
};
const definitions = [...ALL_CARDS, hand];
const getDef = (id: string) => (id === hand.cardNo ? hand : cards.get(id));
const lookup = buildTriggeredEffectLookup(definitions);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: lookup,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredBurstActions: () => [],
};

function queue(category: CardCategory, suppressHost = false): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      {
        ...createCardInstance(host, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
        underCards: [{ cardInstanceId: "under", role: "advent_source" }],
      },
      createCardInstance(under, {
        instanceId: "under",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(sword, {
        instanceId: "sword",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(hand, {
        instanceId: "protection",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        createCardInstance(hand, {
          instanceId: `hand-${index}`,
          ownerPlayerId: "bob",
          zone: "hand",
        })
      ),
    ],
  });
  state.step = "main";
  state.players = state.players.map((player) =>
    player.id === "bob" ? { ...player, handCount: 5 } : player
  );
  const base: ContinuousEffect = {
    effectId: "immunity",
    sourceInstanceId: "protection",
    sourceDefinitionId: hand.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    immunitySourceScope: { categories: [category] },
  };
  state.activeContinuousEffects = Array.from({ length: 5 }, (_, index) => ({
    ...base,
    effectId: `immunity-${index}`,
    targetInstanceId: `hand-${index}`,
  }));
  if (suppressHost)
    state.activeContinuousEffects.push({
      ...base,
      effectId: "suppress-host",
      modifierTag: "effect_suppression",
      targetInstanceId: "host",
    });
  const combined: GameState = {
    ...state,
    cardInstances: state.cardInstances.map((card) =>
      card.instanceId === "host"
        ? { ...card, attachedChildrenIds: ["sword"] }
        : card.instanceId === "sword"
          ? { ...card, normalCoreCount: 0, attachedToInstanceId: "host" }
          : card
    ),
  };
  return collectAndQueueTriggerReactions({
    beforeState: state,
    afterState: recordSemanticTriggerEvent(combined, {
      eventKind: "brave_combined",
      relatedInstanceId: "sword",
      triggerRelatedCombinedHostInstanceId: "host",
    }),
    source: "action_resolution",
    chainId: `oath:${category}:${suppressHost}`,
    ...options,
  });
}
function declaration(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "alice", ...options }).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "sword" &&
      action.skipOnly !== true
  );
}

describe("Q1564 合体結誓 belongs to its host", () => {
  it.each(["brave", "spirit"] as const)(
    "real X01 resolves against %s-only hand immunity",
    (category) => {
      let state = queue(category);
      const action = declaration(state);
      expect(action).toMatchObject({
        sourceInstanceId: "host",
        sourceEffectInstanceId: "sword",
        sourceCardNo: sword.cardNo,
      });
      state = applyLegalAction({ state, action: action!, ...options }).state;
      expect(listEffectUsage(state)).toContainEqual(
        expect.objectContaining({
          label: sharedNameUsageLabel(sword.cardNo, "effect:0", getDef),
          share: "card_name",
          periodId: "game",
          period: "game",
          playerId: "alice",
          amount: 1,
        })
      );
      for (let guard = 0; state.stackWindow && guard < 6; guard++) {
        const pass = getLegalActions({
          state,
          actingPlayerId: state.stackWindow.priorityPlayerId,
          ...options,
        }).find((candidate) => candidate.kind === "pass_stack");
        expect(pass).toBeDefined();
        state = applyLegalAction({ state, action: pass!, ...options }).state;
      }
      expect(state.stackWindow).toBeNull();
      if (category === "brave") {
        expect(state.pendingZoneSelection).toMatchObject({
          actingPlayerId: "bob",
          maxCount: 1,
          sourceInstanceId: "host",
        });
        // A real pending boundary preserves the host and text provider separately.
        state = JSON.parse(JSON.stringify(state));
        const pick = getLegalActions({
          state,
          actingPlayerId: "bob",
          ...options,
        }).find(
          (candidate) => candidate.kind === "resolve_pending_zone_selection"
        );
        expect(pick).toBeDefined();
        state = applyLegalAction({
          state,
          action: pick!,
          selectedZoneCardIds: ["hand-0"],
          ...options,
        }).state;
      }
      expect(
        state.cardInstances.filter(
          (card) => card.ownerPlayerId === "bob" && card.zone === "hand"
        )
      ).toHaveLength(category === "brave" ? 4 : 5);
      expect(
        state.cardInstances.filter(
          (card) => card.ownerPlayerId === "bob" && card.zone === "trash"
        )
      ).toHaveLength(category === "brave" ? 1 : 0);
      expect(state.activeContinuousEffects.map((ce) => ce.modifierTag)).toEqual(
        expect.arrayContaining([
          "restrict_core_placement_life",
          "hand_gain_prevention",
        ])
      );
      expect(state.pendingZoneSelection).toBeNull();
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );

  it("cannot declare when the combined spirit's effects are suppressed", () => {
    const state = queue("brave", true);
    expect(declaration(state)).toBeUndefined();
    expect(effectUsageEntryCount(state)).toBe(0);
  });
});
