import { describe, expect, it } from "vitest";
import {
  AI_OBSERVATION_ENCODER_WINDOW_DOMAIN,
  AI_SEARCH_WORLD_PLAYERS,
  STEP_ORDER,
  advanceStep,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  materializeAiSearchDecksWithKnowledge,
  materializeAiSearchFieldInstances,
  materializeAiSearchPlayerResources,
  materializeAiSearchStepProgression,
  materializeAiSearchTurnPosition,
  projectAiSearchCards,
  projectAiSearchDeckKnowledgeWithVisibility,
  projectAiSearchPlayerResources,
  projectAiSearchStepProgression,
  projectAiSearchTurnPosition,
  sampleAiSearchDeck,
  type AiObservation,
  type AiSearchTurnPosition,
  type CardDefinition,
  type GameState,
} from "../src";
import { executeGrantExtraSteps } from "../src/effect/structured-state-grants";

const card: CardDefinition = {
  cardNo: "SEARCH-POSITION",
  name: "step position fixture",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  maxDeckCount: 40,
};
const lookup = (id: string) => (id === card.cardNo ? card : undefined);
const ids = ["live-alice", "live-bob"] as const;
const advance = (state: GameState) =>
  advanceStep(
    state,
    lookup,
    () => [],
    () => []
  );
function fixture(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ids,
      playerOverrides: ids.map(() => ({
        handCount: 0,
        deckCount: 3,
        reserveNormalCoreCount: 3,
        trashNormalCoreCount: 2,
        voidNormalCoreCount: 10,
      })),
      cardInstances: ids.flatMap((ownerPlayerId) => [
        ...Array.from({ length: 3 }, (_, i) =>
          createCardInstance(card, {
            instanceId: `${ownerPlayerId}-deck-${i}`,
            ownerPlayerId,
            zone: "deck",
          })
        ),
        createCardInstance(card, {
          instanceId: `${ownerPlayerId}-field`,
          ownerPlayerId,
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "heavily_exhausted",
        }),
      ]),
    }),
    turnNumber: 2,
  };
}
function observe(state: GameState, viewpointPlayerId: string) {
  return buildAiObservation({
    state,
    viewpointPlayerId,
    getCardDefinitionById: lookup,
  });
}
function resume(observation: AiObservation): GameState {
  const visibleField = projectAiSearchCards(observation).filter(
    (c) => c.zone === "field"
  );
  const field = materializeAiSearchFieldInstances(visibleField, lookup);
  const players = materializeAiSearchPlayerResources(
    projectAiSearchPlayerResources(observation),
    field,
    visibleField,
    lookup
  );
  const knowledge = projectAiSearchDeckKnowledgeWithVisibility(observation);
  // Public fixture hypothesis, never the live deck, its order or identities.
  const samples = (["me", "opp"] as const).map((owner) =>
    sampleAiSearchDeck(
      knowledge,
      owner,
      [{ weight: 1, cardNos: Array(3).fill(card.cardNo) }],
      [card],
      1017
    )
  );
  const hidden = materializeAiSearchDecksWithKnowledge(samples, knowledge, [
    card,
  ]);
  return {
    ...createEmptyGameState({
      playerIds: [AI_SEARCH_WORLD_PLAYERS.me, AI_SEARCH_WORLD_PLAYERS.opp],
      playerOverrides: players,
      cardInstances: [...hidden, ...field.cards],
    }),
    ...materializeAiSearchTurnPosition(
      projectAiSearchTurnPosition(observation)
    ),
    ...materializeAiSearchStepProgression(
      projectAiSearchStepProgression(observation)
    ),
  };
}

describe("I1 observed turn position (partial world)", () => {
  it.each([0, 1])(
    "root %s resumes queued, inserted and nested extra steps through their real return and regular attack",
    (seat) => {
      const grant = (state: GameState, steps: GameState["step"][]) =>
        executeGrantExtraSteps(state, state.activePlayerId, {
          kind: "grant_extra_steps",
          steps,
        });
      const queued = grant(fixture(), ["attack"]);
      const inserted = advance(queued);
      expect(inserted).toMatchObject({
        step: "attack",
        stepContinuation: ["core"],
      });
      const nested = grant(inserted, ["draw", "refresh"]);
      const nestedReturn = advance(nested);
      expect(nestedReturn).toMatchObject({
        step: "draw",
        stepContinuation: ["refresh", "core"],
      });
      // Omitting the return queue would jump from the inserted attack to end.
      expect(advance({ ...inserted, stepContinuation: [] }).step).toBe("end");
      expect(advance(inserted).step).toBe("core");
      for (const checkpoint of [queued, inserted, nested, nestedReturn]) {
        let source = structuredClone(checkpoint);
        const observation = observe(source, ids[seat]);
        const before = structuredClone(observation);
        let world = resume(observation);
        let reachedEnd = false;
        const steps: string[] = [];
        for (let i = 0; i < 15; i++) {
          const expected = observe(source, ids[seat]);
          const actual = observe(world, AI_SEARCH_WORLD_PLAYERS.me);
          expect(projectAiSearchTurnPosition(actual)).toEqual(
            projectAiSearchTurnPosition(expected)
          );
          expect(projectAiSearchStepProgression(actual)).toEqual(
            projectAiSearchStepProgression(expected)
          );
          for (const owner of ["me", "opp"] as const) {
            const a = actual.players.find((p) => p.relative === owner)!;
            const e = expected.players.find((p) => p.relative === owner)!;
            for (const key of [
              "reserveNormalCoreCount",
              "trashNormalCoreCount",
              "voidNormalCoreCount",
              "handCount",
              "deckCount",
            ] as const)
              expect(a[key], key).toBe(e[key]);
          }
          expect(world.gameResult).toBeNull();
          steps.push(world.step);
          if (world.step === "end") {
            reachedEnd = true;
            break;
          }
          source = advance(source);
          world = advance(world);
        }
        expect(reachedEnd).toBe(true);
        expect(steps.slice(-6)).toEqual([
          "core",
          "draw",
          "refresh",
          "main",
          "attack",
          "end",
        ]);
        expect(observation).toEqual(before);
      }
    }
  );

  it.each([0, 1])(
    "root %s keeps step queues independent of secret deck order/IDs and live mutations",
    (seat) => {
      const source = executeGrantExtraSteps(fixture(), ids[0], {
        kind: "grant_extra_steps",
        steps: ["attack"],
      });
      const observation = observe(source, ids[seat]);
      const projected = projectAiSearchStepProgression(observation);
      const changed = structuredClone(source);
      changed.cardInstances = changed.cardInstances
        .reverse()
        .map((c, i) =>
          c.zone === "deck"
            ? { ...c, instanceId: `secret-${i}`, definitionId: "unseen" }
            : c
        );
      expect(
        projectAiSearchStepProgression(observe(changed, ids[seat]))
      ).toEqual(projected);
      source.pendingExtraSteps!.push("draw");
      expect(observation.global.stepProgression!.pendingExtraSteps).toEqual([
        "attack",
      ]);
      const world = materializeAiSearchStepProgression(projected);
      world.pendingExtraSteps!.push("refresh");
      expect(projected.pendingExtraSteps).toEqual(["attack"]);
      expect(observation.global.stepProgression!.pendingExtraSteps).toEqual([
        "attack",
      ]);
    }
  );

  it("preserves ordered repeated return steps and rejects missing/invalid old snapshots", () => {
    const input = {
      pendingExtraSteps: ["draw"] as const,
      stepContinuation: ["refresh", "core", "refresh"] as const,
    };
    expect(materializeAiSearchStepProgression(input)).toEqual(input);
    for (const invalid of [
      undefined,
      null,
      {},
      { pendingExtraSteps: [], stepContinuation: ["bad"] },
      { pendingExtraSteps: new Array(1), stepContinuation: [] },
    ])
      expect(() =>
        materializeAiSearchStepProgression(invalid as never)
      ).toThrow();
    const observation = observe(fixture(), ids[0]);
    delete observation.global.stepProgression;
    expect(() => projectAiSearchStepProgression(observation)).toThrow(
      /missing/
    );
    expect(() => projectAiSearchStepProgression(fixture() as never)).toThrow();
    observation.mode = "debug_perfect";
    expect(() => projectAiSearchStepProgression(observation)).toThrow();
  });

  it.each([0, 1])(
    "root %s resumes real core/draw/refresh without repeating completed work",
    (seat) => {
      let source = fixture();
      for (const step of ["core", "draw", "refresh"] as const) {
        source = advance(source);
        expect(source).toMatchObject({ step, window: "none" });
        const observation = observe(source, ids[seat]),
          before = structuredClone(observation);
        const position = projectAiSearchTurnPosition(observation),
          world = resume(observation);
        expect(
          projectAiSearchTurnPosition(
            observe(world, AI_SEARCH_WORLD_PLAYERS.me)
          )
        ).toEqual(position);
        const expected = advance(source),
          after = advance(world);
        const relative = after.activePlayerId;
        const sourcePlayer = expected.players.find(
          (p) => p.id === source.activePlayerId
        )!;
        const player = after.players.find((p) => p.id === relative)!;
        for (const key of [
          "reserveNormalCoreCount",
          "trashNormalCoreCount",
          "voidNormalCoreCount",
          "handCount",
          "deckCount",
        ] as const)
          expect(player[key], `${step}:${key}`).toBe(sourcePlayer[key]);
        expect(after.step).toBe(expected.step);
        expect(after.window).toBe(expected.window);
        expect(
          after.cardInstances.find(
            (c) => c.zone === "field" && c.ownerPlayerId === relative
          )!.exhaustState
        ).toBe(
          expected.cardInstances.find(
            (c) =>
              c.zone === "field" && c.ownerPlayerId === source.activePlayerId
          )!.exhaustState
        );
        expect(after.gameResult).toBeNull();
        // Canary: resetting to the factory start repeats core gain, and later
        // repeats draw and refresh too. Clock preservation alone is insufficient.
        const reset = advance({ ...world, step: "start", window: "none" });
        expect(
          reset.players.find((p) => p.id === relative)!.reserveNormalCoreCount
        ).toBe(
          world.players.find((p) => p.id === relative)!.reserveNormalCoreCount +
            1
        );
        expect(observation).toEqual(before);
      }
    }
  );

  it.each([0, 1])(
    "root %s preserves every observed step/window tag without inventing its continuation",
    (seat) => {
      const observation = observe(fixture(), ids[seat]);
      for (const step of STEP_ORDER)
        for (const window of AI_OBSERVATION_ENCODER_WINDOW_DOMAIN) {
          observation.global.step = step;
          observation.global.window = window;
          const position = projectAiSearchTurnPosition(observation);
          const materialized = materializeAiSearchTurnPosition(position);
          expect(materialized).toMatchObject({ step, window });
          expect(Object.keys(materialized).sort()).toEqual([
            "activePlayerId",
            "playerOrder",
            "step",
            "stepSequence",
            "turnNumber",
            "turnNumberHighWaterMark",
            "window",
          ]);
        }
    }
  );

  it.each([0, 1])(
    "root %s is independent of secret cards/order/IDs and returns detached scalar data",
    (seat) => {
      const source = advance(fixture()),
        expected = projectAiSearchTurnPosition(observe(source, ids[seat]));
      const changed: GameState = {
        ...source,
        cardInstances: source.cardInstances
          .map((c) =>
            c.zone === "deck"
              ? {
                  ...c,
                  instanceId: `secret-${c.instanceId}`,
                  definitionId: "SECRET-CARD",
                }
              : c
          )
          .reverse(),
      };
      const observation = observe(changed, ids[seat]),
        position = projectAiSearchTurnPosition(observation);
      expect(position).toEqual(expected);
      const result = materializeAiSearchTurnPosition(position);
      observation.global.step = "end";
      position.window = "step_end";
      expect(result).toMatchObject({ step: "core", window: "none" });
      expect(JSON.stringify(result)).not.toMatch(/live-|SECRET|instanceId/);
    }
  );

  it("rejects missing/unknown step and window values, old/debug observations and missing clocks", () => {
    const observation = observe(fixture(), ids[0]);
    for (const field of ["step", "window"] as const)
      for (const value of [undefined, null, "unknown", "", {}, 0]) {
        const changed = structuredClone(observation);
        Object.assign(changed.global, { [field]: value });
        expect(() => projectAiSearchTurnPosition(changed)).toThrow();
        const position = projectAiSearchTurnPosition(observation);
        Object.assign(position, { [field]: value });
        expect(() =>
          materializeAiSearchTurnPosition(position as AiSearchTurnPosition)
        ).toThrow();
      }
    for (const changes of [{ mode: "debug_perfect" }, { schemaVersion: 1 }]) {
      const changed = Object.assign(structuredClone(observation), changes);
      expect(() =>
        projectAiSearchTurnPosition(changed as AiObservation)
      ).toThrow();
    }
    delete observation.global.turnClock;
    expect(() => projectAiSearchTurnPosition(observation)).toThrow();
  });
});
