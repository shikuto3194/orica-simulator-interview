import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  advanceStep,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  materializeAiSearchDecksWithKnowledge,
  materializeAiSearchPlayerResources,
  materializeAiSearchStepProgression,
  materializeAiSearchTurnPosition,
  materializeAiSearchTurnSchedule,
  projectAiSearchDeckKnowledgeWithVisibility,
  projectAiSearchPlayerResources,
  projectAiSearchStepProgression,
  projectAiSearchTurnPosition,
  projectAiSearchTurnSchedule,
  sampleAiSearchDeck,
  type AiObservation,
  type AiSearchTurnSchedule,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  executeGrantExtraSteps,
  executeGrantExtraTurn,
} from "../src/effect/structured-state-grants";

const card: CardDefinition = {
  cardNo: "SEARCH-SCHEDULE",
  name: "public schedule fixture",
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
        deckCount: 4,
        handCount: 0,
        reserveNormalCoreCount: 3,
        trashNormalCoreCount: 2,
      })),
      cardInstances: ids.flatMap((ownerPlayerId) =>
        Array.from({ length: 4 }, (_, i) =>
          createCardInstance(card, {
            instanceId: `secret-${ownerPlayerId}-${i}`,
            ownerPlayerId,
            zone: "deck",
          })
        )
      ),
    }),
    turnNumber: 3,
    step: "end",
  };
}
const observe = (state: GameState, root: string) =>
  buildAiObservation({
    state,
    viewpointPlayerId: root,
    getCardDefinitionById: lookup,
  });
function resume(observation: AiObservation): GameState {
  const players = materializeAiSearchPlayerResources(
    projectAiSearchPlayerResources(observation),
    { cards: [], fieldBindings: [] },
    [],
    lookup
  );
  const knowledge = projectAiSearchDeckKnowledgeWithVisibility(observation);
  const samples = (["me", "opp"] as const).map((owner) =>
    sampleAiSearchDeck(
      knowledge,
      owner,
      [{ weight: 1, cardNos: Array(4).fill(card.cardNo) }],
      [card],
      1017
    )
  );
  return {
    ...createEmptyGameState({
      playerIds: [AI_SEARCH_WORLD_PLAYERS.me, AI_SEARCH_WORLD_PLAYERS.opp],
      playerOverrides: players,
      cardInstances: materializeAiSearchDecksWithKnowledge(samples, knowledge, [
        card,
      ]),
    }),
    ...materializeAiSearchTurnPosition(
      projectAiSearchTurnPosition(observation)
    ),
    ...materializeAiSearchStepProgression(
      projectAiSearchStepProgression(observation)
    ),
    ...materializeAiSearchTurnSchedule(
      projectAiSearchTurnSchedule(observation)
    ),
  };
}
function grant(state: GameState): GameState {
  return executeGrantExtraTurn(state, state.activePlayerId, {
    kind: "grant_extra_turn",
    player: "opponent",
    skipSteps: ["core", "attack"],
  });
}

describe("I1 observed turn schedule (partial world)", () => {
  it("copies ordered public reservations into fresh synthetic fields without aliasing or inferring a missing next seat", () => {
    const source = {
      ...fixture(),
      pendingTurnSkips: [ids[1], ids[0], ids[1]],
      extraTurnState: {
        ownerPlayerId: ids[0],
        skipSteps: ["attack", "core", "attack"] as const,
        returnContext: null,
      },
    };
    const observation = observe(source, ids[0]);
    const before = structuredClone(observation);
    const projected = projectAiSearchTurnSchedule(observation);
    const result = materializeAiSearchTurnSchedule(projected);
    expect(result.extraTurnState).toEqual({
      ownerPlayerId: AI_SEARCH_WORLD_PLAYERS.me,
      skipSteps: ["attack", "core", "attack"],
      returnContext: null,
    });
    expect(result.pendingTurnSkips).toEqual([
      AI_SEARCH_WORLD_PLAYERS.opp,
      AI_SEARCH_WORLD_PLAYERS.me,
      AI_SEARCH_WORLD_PLAYERS.opp,
    ]);
    expect(result.extraTurnState!.skipSteps).not.toBe(
      projected.extraTurn!.skipSteps
    );
    expect(projected.extraTurn!.skipSteps).not.toBe(
      observation.global.turnSchedule!.extraTurn!.skipSteps
    );
    (result.extraTurnState!.skipSteps as string[]).push("draw");
    expect(projected.extraTurn!.skipSteps).toEqual([
      "attack",
      "core",
      "attack",
    ]);
    expect(observation).toEqual(before);
    expect(() =>
      projectAiSearchTurnSchedule({
        ...observation,
        global: { ...observation.global, activePlayer: "opp" },
      })
    ).toThrow("inconsistent observed active");
  });
  it.each(
    [0, 1].flatMap((seat) => [false, true].map((skip) => ({ seat, skip })))
  )(
    "root $seat skip=$skip preserves queued/chained extra turns, forbidden inserted steps and original next seat through natural deck-out",
    ({ seat, skip }) => {
      let source = grant({
        ...fixture(),
        pendingTurnSkips: skip ? [ids[1]] : [],
      });
      const initial = observe(source, ids[seat]);
      const unchanged = structuredClone(initial);
      let world = resume(initial);
      let grantedSecond = false;
      const entered: { turn: number; active: string }[] = [];
      for (let i = 0; i < 180; i++) {
        const expected = observe(source, ids[seat]);
        const actual = observe(world, AI_SEARCH_WORLD_PLAYERS.me);
        expect(projectAiSearchTurnPosition(actual)).toEqual(
          projectAiSearchTurnPosition(expected)
        );
        expect(projectAiSearchTurnSchedule(actual)).toEqual(
          projectAiSearchTurnSchedule(expected)
        );
        expect(projectAiSearchStepProgression(actual)).toEqual(
          projectAiSearchStepProgression(expected)
        );
        for (const owner of ["me", "opp"] as const) {
          const a = actual.players.find((p) => p.relative === owner)!;
          const e = expected.players.find((p) => p.relative === owner)!;
          for (const key of [
            "handCount",
            "deckCount",
            "reserveNormalCoreCount",
            "trashNormalCoreCount",
            "voidNormalCoreCount",
          ] as const)
            expect(a[key], key).toBe(e[key]);
          expect(
            world.cardInstances.filter(
              (c) =>
                c.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS[owner] &&
                c.zone === "hand"
            )
          ).toHaveLength(a.handCount);
        }
        expect(world.gameResult?.kind ?? null).toBe(
          source.gameResult?.kind ?? null
        );
        if (source.gameResult) break;
        if (source.step === "start")
          entered.push({
            turn: source.turnNumber,
            active: expected.global.activePlayer,
          });
        if (
          source.turnNumber === 4 &&
          source.step === "start" &&
          !grantedSecond
        ) {
          // Duplicate grants in one turn remain a single reservation. The next
          // grant changes the executor, without changing the original next seat.
          source = grant(grant(source));
          world = grant(grant(world));
          source = executeGrantExtraSteps(source, source.activePlayerId, {
            kind: "grant_extra_steps",
            steps: ["attack"],
          });
          world = executeGrantExtraSteps(world, world.activePlayerId, {
            kind: "grant_extra_steps",
            steps: ["attack"],
          });
          grantedSecond = true;
        }
        const previousTurn = source.turnNumber;
        source = advance(source);
        world = advance(world);
        if (previousTurn === 4 && source.turnNumber === 4)
          expect(["core", "attack"]).not.toContain(source.step);
      }
      expect(grantedSecond).toBe(true);
      expect(entered.slice(0, 3)).toEqual([
        { turn: 4, active: seat === 1 ? "me" : "opp" },
        { turn: 5, active: seat === 0 ? "me" : "opp" },
        {
          turn: skip ? 7 : 6,
          active: (skip ? seat === 0 : seat === 1) ? "me" : "opp",
        },
      ]);
      expect(world.gameResult).toMatchObject({
        kind: "player_loss",
        reason: "deck_out",
      });
      expect(world.pendingTurnSkips).toEqual([]);
      expect(initial).toEqual(unchanged);
    }
  );

  it.each([0, 1])(
    "root %s schedule and sampled fields ignore hidden instance renaming and deck order",
    (seat) => {
      const source = grant(fixture());
      const other = {
        ...source,
        cardInstances: [...source.cardInstances]
          .reverse()
          .map((c, i) => ({ ...c, instanceId: `unrelated-secret-${i}` })),
      };
      expect(projectAiSearchTurnSchedule(observe(source, ids[seat]))).toEqual(
        projectAiSearchTurnSchedule(observe(other, ids[seat]))
      );
      expect(resume(observe(source, ids[seat]))).toEqual(
        resume(observe(other, ids[seat]))
      );
      expect(
        JSON.stringify(projectAiSearchTurnSchedule(observe(source, ids[seat])))
      ).not.toContain("secret-");
    }
  );

  it("rejects old observations, malformed seats/steps/flags and unsupported return contexts without copying secrets", () => {
    const observation = observe(fixture(), ids[0]);
    const schedule = projectAiSearchTurnSchedule(observation);
    const old = structuredClone(observation);
    delete old.global.turnSchedule;
    expect(() => projectAiSearchTurnSchedule(old)).toThrow("missing observed");
    for (const bad of [
      { ...schedule, pendingExtraTurn: undefined },
      { ...schedule, extraTurn: undefined },
      { ...schedule, pendingTurnSkips: ["secret-player"] },
      {
        ...schedule,
        pendingExtraTurn: { owner: "me", skipSteps: ["unknown"] },
      },
      {
        ...schedule,
        extraTurn: {
          owner: "me",
          skipSteps: [],
          nextPlayer: null,
          hasReturnContext: false,
        },
      },
      {
        ...schedule,
        extraTurn: {
          owner: "me",
          skipSteps: [],
          nextPlayer: "secret-player",
          hasReturnContext: false,
          deferredStart: false,
        },
      },
    ])
      expect(() =>
        materializeAiSearchTurnSchedule(bad as AiSearchTurnSchedule)
      ).toThrow();
    const interrupted = executeGrantExtraTurn(
      { ...fixture(), step: "attack" },
      ids[1],
      { kind: "grant_extra_turn", returnPoint: "previous_attack_battle" },
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }
    );
    const hiddenReturn = {
      ...interrupted,
      extraTurnState: {
        ...interrupted.extraTurnState!,
        returnContext: {
          ...interrupted.extraTurnState!.returnContext!,
          turnSummonedCardRefs: [{ secret: "RETURN-SECRET" }] as never,
        },
      },
    };
    const observed = observe(hiddenReturn, ids[0]);
    expect(JSON.stringify(observed.global.turnSchedule)).not.toContain(
      "RETURN-SECRET"
    );
    expect(() => projectAiSearchTurnSchedule(observed)).toThrow(
      "unsupported interrupted"
    );
    expect(() =>
      materializeAiSearchTurnSchedule(observed.global.turnSchedule!)
    ).toThrow("unsupported interrupted");
    const deferred = {
      ...schedule,
      extraTurn: {
        owner: "me" as const,
        skipSteps: [],
        nextPlayer: null,
        hasReturnContext: false,
        deferredStart: true,
      },
    };
    expect(() => materializeAiSearchTurnSchedule(deferred)).toThrow(
      "unsupported interrupted"
    );
    const wrongOwner = {
      ...schedule,
      extraTurn: {
        owner: "opp" as const,
        skipSteps: [],
        nextPlayer: null,
        hasReturnContext: false,
        deferredStart: false,
      },
    };
    expect(() =>
      projectAiSearchTurnSchedule({
        ...observation,
        global: { ...observation.global, turnSchedule: wrongOwner },
      })
    ).toThrow("inconsistent");
    expect(() =>
      projectAiSearchTurnSchedule({ ...observation, mode: "debug_perfect" })
    ).toThrow("player observation");
  });
});
