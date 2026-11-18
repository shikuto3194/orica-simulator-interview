import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  advanceStep,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  materializeAiSearchTurnClock,
  projectAiSearchTurnClock,
  setFirstPlayer,
  type AiObservation,
  type AiSearchTurnClock,
  type CardDefinition,
  type GameState,
} from "../src";
import { executeGrantExtraTurn } from "../src/effect/structured-state-grants";

const card: CardDefinition = {
  cardNo: "SEARCH-CLOCK",
  name: "clock fixture",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
};
const lookup = (id: string) => (id === card.cardNo ? card : undefined);
const owners = ["live-alice", "live-bob"] as const;
function fixture(ids: readonly [string, string] = owners): GameState {
  return createEmptyGameState({
    playerIds: ids,
    playerOverrides: ids.map(() => ({
      handCount: 0,
      deckCount: 10,
      reserveNormalCoreCount: 3,
      voidNormalCoreCount: 10,
    })),
    // Public test hypothesis, not a copy of either live deck/order.
    cardInstances: ids.flatMap((ownerPlayerId) =>
      Array.from({ length: 10 }, (_, i) =>
        createCardInstance(card, {
          instanceId: `${ownerPlayerId}-deck-${i}`,
          ownerPlayerId,
          zone: "deck",
        })
      )
    ),
  });
}
const observe = (state: GameState, seat: number) =>
  buildAiObservation({
    state,
    viewpointPlayerId: owners[seat],
    getCardDefinitionById: lookup,
  });
const advance = (state: GameState) =>
  advanceStep(
    state,
    lookup,
    () => [],
    () => []
  );
function until(state: GameState, reached: (s: GameState) => boolean) {
  for (let i = 0; i < 40; i++) {
    if (reached(state)) return state;
    state = advance(state);
  }
  throw new Error("turn-clock fixture did not finish");
}
function finishTurn(state: GameState) {
  const number = state.turnNumber;
  return until(state, (next) => next.turnNumber !== number);
}
function synthetic(clock: AiSearchTurnClock): GameState {
  return {
    ...fixture([AI_SEARCH_WORLD_PLAYERS.me, AI_SEARCH_WORLD_PLAYERS.opp]),
    ...materializeAiSearchTurnClock(clock),
  };
}
function reproject(state: GameState) {
  return projectAiSearchTurnClock(
    buildAiObservation({
      state,
      viewpointPlayerId: AI_SEARCH_WORLD_PLAYERS.me,
      getCardDefinitionById: lookup,
    })
  );
}

describe("I1 public turn clock and seat order (partial world)", () => {
  it.each([0, 1])(
    "root %s preserves the real first-player selection through first-turn skips, the next core step and draw",
    (seat) => {
      const source = setFirstPlayer(fixture(), owners[1]);
      const observation = observe(source, seat);
      const before = structuredClone(observation);
      const clock = projectAiSearchTurnClock(observation);
      let world = synthetic(clock);
      expect(reproject(world)).toEqual(clock);
      const first = world.activePlayerId;
      expect(world.playerOrder[0]).toBe(first);
      // The observer order is different from first-player order for root 0.
      expect(clock.playerOrder).toEqual(
        seat === 0 ? ["opp", "me"] : ["me", "opp"]
      );
      world = until(world, (s) => s.step === "draw" && s.window === "none");
      expect(world.players.find((p) => p.id === first)).toMatchObject({
        reserveNormalCoreCount: 3,
        deckCount: 9,
        handCount: 1,
      });
      world = finishTurn(world);
      expect(world.turnNumber).toBe(2);
      expect(world.activePlayerId).not.toBe(first);
      world = until(world, (s) => s.step === "draw" && s.window === "none");
      expect(
        world.players.find((p) => p.id === world.activePlayerId)
      ).toMatchObject({
        reserveNormalCoreCount: 4,
        voidNormalCoreCount: 9,
        deckCount: 9,
        handCount: 1,
      });
      expect(world.cardInstances.filter((c) => c.zone === "hand")).toHaveLength(
        2
      );
      expect(world.gameResult).toBeNull();
      expect(observation).toEqual(before);
      expect(JSON.stringify(clock)).not.toMatch(
        /live-|instanceId|SEARCH-CLOCK/
      );
    }
  );

  it.each([0, 1])(
    "root %s retains an issued turn after a real interruption/restoration and issues the next unused number",
    (seat) => {
      const before: GameState = {
        ...fixture(),
        step: "attack",
        turnNumber: 3,
        stepSequence: 37,
      };
      const extra = executeGrantExtraTurn(
        before,
        owners[1],
        { kind: "grant_extra_turn", returnPoint: "previous_attack_battle" },
        {
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: () => [],
        }
      );
      expect(extra.turnNumber).toBe(4);
      const restored = finishTurn(extra);
      expect(restored.turnNumber).toBe(3);
      expect(restored.turnNumberHighWaterMark).toBe(4);
      expect(restored.extraTurnState).toBeNull();
      const clock = projectAiSearchTurnClock(observe(restored, seat));
      const world: GameState = { ...synthetic(clock), step: "attack" };
      expect(reproject(world)).toEqual(clock);
      const sourceAfter = finishTurn(restored),
        after = finishTurn(world);
      expect(after.turnNumber).toBe(5);
      expect(after.turnNumber).toBe(sourceAfter.turnNumber);
      expect(after.stepSequence).toBe(sourceAfter.stepSequence);
      expect(after.activePlayerId).not.toBe(world.activePlayerId);
      expect(after.turnNumberHighWaterMark).toBe(5);
      // A high-water reset would reuse the issued turn 4.
      expect(
        finishTurn({ ...world, turnNumberHighWaterMark: undefined }).turnNumber
      ).toBe(4);
      // The sequence must continue too; do not issue old step-event identities.
      expect(finishTurn({ ...world, stepSequence: 0 }).stepSequence).not.toBe(
        after.stepSequence
      );
    }
  );

  it.each([0, 1])(
    "root %s ignores different secret cards/order/IDs and snapshots public order",
    (seat) => {
      const source = setFirstPlayer(fixture(), owners[1]);
      const expected = projectAiSearchTurnClock(observe(source, seat));
      const changed: GameState = {
        ...source,
        cardInstances: [...source.cardInstances].reverse().map((c, i) => ({
          ...c,
          instanceId: `secret-${i}`,
          definitionId: `secret-card-${i}`,
        })),
      };
      const observation = observe(changed, seat);
      expect(projectAiSearchTurnClock(observation)).toEqual(expected);
      const clock = projectAiSearchTurnClock(observation),
        materialized = materializeAiSearchTurnClock(clock);
      (observation.global.turnClock!.playerOrder as string[]).reverse();
      expect(clock).toEqual(expected);
      (clock.playerOrder as string[]).reverse();
      expect(materialized.playerOrder).toEqual(
        materializeAiSearchTurnClock(expected).playerOrder
      );
    }
  );

  it("rejects old, non-player and inconsistent observations without defaulting missing clocks", () => {
    const observation = observe(fixture(), 0);
    for (const mutate of [
      (o: AiObservation) => {
        delete o.global.turnClock;
      },
      (o: AiObservation) => {
        o.mode = "debug_perfect";
      },
      (o: AiObservation) => {
        o.global.activePlayerId = "unknown";
      },
      (o: AiObservation) => {
        o.global.activePlayer = "opp";
      },
      (o: AiObservation) => {
        o.global.turnClock!.playerOrder = ["me", "me"];
      },
    ]) {
      const changed = structuredClone(observation);
      mutate(changed);
      expect(() => projectAiSearchTurnClock(changed)).toThrow();
    }
  });

  it("rejects invalid clocks on both projection and materialization", () => {
    const observation = observe(fixture(), 0),
      clock = projectAiSearchTurnClock(observation);
    for (const changes of [
      { turnNumber: 0 },
      { turnNumber: 1.5 },
      { turnNumber: Number.NaN },
      { turnNumberHighWaterMark: 0 },
      { turnNumberHighWaterMark: Number.POSITIVE_INFINITY },
      { stepSequence: -1 },
      { stepSequence: Number.MAX_SAFE_INTEGER + 1 },
      { playerOrder: ["me"] },
      { playerOrder: ["me", "unknown"] },
    ]) {
      expect(() =>
        materializeAiSearchTurnClock({
          ...clock,
          ...changes,
        } as AiSearchTurnClock)
      ).toThrow();
      const changed = structuredClone(observation);
      if ("turnNumber" in changes)
        changed.global.turnNumber = changes.turnNumber!;
      else Object.assign(changed.global.turnClock!, changes);
      expect(() => projectAiSearchTurnClock(changed)).toThrow();
    }
  });
});
