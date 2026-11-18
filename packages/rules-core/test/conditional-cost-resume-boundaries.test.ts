import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "../src";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definition = (id: string) => definitions.find((d) => d.cardNo === id)!;
const card = (
  no: string,
  instanceId: string,
  zone: "hand" | "field" | "deck",
  normalCoreCount = 0,
  ownerPlayerId = "alice",
  def = definition(no)
) =>
  createCardInstance(def, { instanceId, zone, normalCoreCount, ownerPlayerId });
function lookups(extra: CardDefinition[] = []) {
  const cards = [...definitions, ...extra];
  return {
    getCardDefinitionById: (id: string) => cards.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredMagicActions: buildMagicLookup(cards),
    getRegisteredBurstActions: () => [],
  };
}
function settle(state: GameState, lo: ReturnType<typeof lookups>) {
  for (let i = 0; i < 40; i++) {
    if (state.pendingZoneSelection) return state;
    const action = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lo })
      )
      .find((a) =>
        [
          "resolve_pending_triggered_effect",
          "pass_stack",
          "pass_pre_declaration_stack",
        ].includes(a.kind)
      );
    if (!action) return state;
    state = applyLegalAction({
      state,
      action,
      ...lo,
      ...(action.kind === "resolve_pending_triggered_effect" && action.skipOnly
        ? { skipOptionalEffect: true }
        : {}),
    }).state;
  }
  throw new Error("conditional-cost response did not settle");
}
const roundtrip = (state: GameState): GameState =>
  JSON.parse(JSON.stringify(state));
function selectDiscard(state: GameState, lo: ReturnType<typeof lookups>) {
  const restored = roundtrip(state);
  const action = getLegalActions({
    state: restored,
    actingPlayerId: "alice",
    ...lo,
  }).find((a) => a.kind === "resolve_pending_zone_selection");
  expect(action).toBeDefined();
  return applyLegalAction({
    state: restored,
    action: action!,
    selectedZoneCardIds: ["h1"],
    ...lo,
  }).state;
}
function drawBoard(no: string, deckCount: number): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card(no, "source", "field", 1),
        card("BSTH001-C01", "h0", "hand"),
        card("BSTH001-C01", "h1", "hand"),
        ...Array.from({ length: deckCount }, (_, i) =>
          card("BSTH001-C01", `deck${i}`, "deck")
        ),
      ],
      playerOverrides: [{ handCount: 2, deckCount }, {}],
    }),
    step: "main",
    activePlayerId: "alice",
    turnNumber: 4,
  };
}

describe("leading conditional-cost connector across persisted input", () => {
  for (const no of ["BSTH02-R01", "BSTH02-R02", "BSTH02-R03"]) {
    it.each([0, 2])(
      `${no}: a persisted discard is refunded only when the draw cannot resolve (deck=%i)`,
      (deckCount) => {
        const lo = lookups();
        const pending = executeEffect({
          state: drawBoard(no, deckCount),
          effect: definition(no).effects![0]!,
          effectIndex: 0,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          chainId: "leading-cost",
          ...lo,
        });
        expect(pending.pendingZoneSelection).not.toBeNull();
        const after = selectDiscard(pending, lo);
        expect(after.players[0]).toMatchObject({
          handCount: deckCount ? 3 : 2,
          deckCount: 0,
        });
        expect(
          after.cardInstances.find((c) => c.instanceId === "h1")?.zone
        ).toBe(deckCount ? "trash" : "hand");
        expect(after.pendingZoneSelection).toBeNull();
      }
    );
    it(`${no}: a legal stack response survives the refund after persisted selection`, () => {
      const response: CardDefinition = {
        ...definition("BSTH04-C11"),
        cardNo: "TEST-DECK-RESPONSE",
        name: "Response",
        cost: 0,
        reductionSymbols: [],
        effects: [
          {
            timing: { kind: "activated", mode: "stack" },
            steps: [
              {
                action: {
                  kind: "move_card",
                  from: { zone: "deck", player: "opponent", position: "top" },
                  to: { zone: "trash" },
                  count: 1,
                  deckDiscard: true,
                },
              },
            ],
          },
        ],
      };
      const lo = lookups([response]);
      let state = drawBoard(no, 1);
      state.cardInstances.push(
        card(response.cardNo, "response", "hand", 0, "bob", response)
      );
      state.players[1]!.handCount = 1;
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "summon",
            source: "action_resolution",
            chainId: "response-cost",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "source",
            amount: null,
          },
        ],
        undefined,
        lo
      );
      const trigger = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lo,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.registrationIndex === 0
      );
      expect(trigger).toBeDefined();
      expect(trigger).not.toMatchObject({ skipOnly: true });
      state = applyLegalAction({ state, action: trigger!, ...lo }).state;
      const use = getLegalActions({ state, actingPlayerId: "bob", ...lo }).find(
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "response"
      );
      expect(use).toBeDefined();
      state = applyLegalAction({
        state,
        action: use!,
        paymentSources: [],
        ...lo,
      }).state;
      state = settle(state, lo);
      expect(state.players[0]).toMatchObject({ handCount: 2, deckCount: 0 });
      expect(state.pendingZoneSelection).not.toBeNull();
      state = selectDiscard(state, lo);
      expect(state.players[0]).toMatchObject({ handCount: 2, deckCount: 0 });
      expect(state.cardInstances.find((c) => c.instanceId === "h1")?.zone).toBe(
        "hand"
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck0")?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find((c) => c.instanceId === "response")?.zone
      ).toBe("trash");
      expect(state.pendingZoneSelection).toBeNull();
      expect(state.stackWindow).toBeNull();
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    });
  }
});

describe("BSTH002-R02 pays exactly two deck cards for the leave replacement", () => {
  it.each([0, 1, 2])(
    "real leave-field registration with deck=%i",
    (deckCount) => {
      const lo = lookups();
      const source = card("BSTH002-R02", "source", "field", 2);
      Object.assign(source, {
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "opponent_effect",
        pendingLeaveChainId: "leave-cost",
        deferZoneMoveUntilChainEnd: true,
      });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            source,
            ...Array.from({ length: deckCount }, (_, i) =>
              card("BSTH001-C01", `deck${i}`, "deck")
            ),
          ],
          playerOverrides: [{ deckCount }, {}],
        }),
        step: "main",
        activePlayerId: "bob",
        turnNumber: 4,
        pendingLeaveEntities: [
          {
            instanceId: "source",
            kind: "destroy",
            cause: "opponent_effect",
            causePlayerId: "bob",
            chainId: "leave-cost",
            deferZoneMoveUntilChainEnd: true,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
      };
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "leave_field",
            source: "action_resolution",
            chainId: "leave-cost",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "source",
            amount: null,
            cause: "opponent_effect",
            causePlayerId: "bob",
          },
        ],
        undefined,
        lo
      );
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lo,
      }).find((a) => a.kind === "resolve_pending_triggered_effect");
      expect(action).toBeDefined();
      const after = settle(state, lo);
      expect(after.players[0]!.deckCount).toBe(deckCount < 2 ? deckCount : 0);
      expect(
        after.cardInstances.find((c) => c.instanceId === "source")?.zone
      ).toBe(deckCount < 2 ? "trash" : "field");
      expect(after.pendingLeaveEntities).toHaveLength(0);
      expect(after.pendingTriggeredEffects).toHaveLength(0);
    }
  );
});
