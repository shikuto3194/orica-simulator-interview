import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  AI_SEARCH_WORLD_PLAYERS,
  advanceStep,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  executeDiscardSetBurst,
  getBurstSetBlockReason,
  getMirageSetBlockReason,
  materializeAiSearchSetUsage,
  moveCardZone,
  projectAiSearchSetUsage,
  removeMirageSetState,
  useSetBurstAsAction,
  useSetMirageAsAction,
  type AiObservation,
  type CardDefinition,
  type GameState,
} from "../src";

const plain: CardDefinition = {
  cardNo: "SEARCH-SET-NORMAL",
  name: "公開セット候補",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  keywordTags: ["can_set_as_burst"],
  mirageData: { cost: 0, reduction: [] },
  textLines: [],
};
const exempt = ALL_CARDS.find((card) => card.cardNo === "BSTH002-C01")!;
const lookup = (id: string) => [plain, exempt].find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
const owners = ["live-alice", "live-bob"] as const;
function fixture(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: owners,
      startingDeckCount: 1,
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
      cardInstances: [
        ...owners.flatMap((ownerPlayerId) =>
          [plain, plain, exempt, exempt].map((definition, index) =>
            createCardInstance(definition, {
              instanceId: `${ownerPlayerId}-${index}`,
              ownerPlayerId,
              zone: "hand",
            })
          )
        ),
        ...owners.map((ownerPlayerId) =>
          createCardInstance(plain, {
            instanceId: `${ownerPlayerId}-deck`,
            ownerPlayerId,
            zone: "deck",
          })
        ),
      ],
    }),
    step: "main",
    zoneCountMode: undefined,
    turnNumber: 3,
  };
}
function observe(state: GameState, seat = 0) {
  return buildAiObservation({
    state,
    viewpointPlayerId: owners[seat],
    getCardDefinitionById: lookup,
  });
}
function setMirage(state: GameState, owner: string, index: number) {
  return useSetMirageAsAction({
    state,
    actingPlayerId: owner,
    sourceInstanceId: `${owner}-${index}`,
    paymentSources: index < 2 ? [] : [{ kind: "reserve", amount: 2 }],
    ...options,
  }).state;
}
function synthetic(usage: ReturnType<typeof projectAiSearchSetUsage>) {
  const ids = [
    AI_SEARCH_WORLD_PLAYERS.me,
    AI_SEARCH_WORLD_PLAYERS.opp,
  ] as const;
  return {
    ...createEmptyGameState({
      playerIds: ids,
      startingDeckCount: 1,
      playerOverrides: [
        { reserveNormalCoreCount: 10, handCount: 2 },
        { reserveNormalCoreCount: 10, handCount: 2 },
      ],
      // Public test hypotheses, not copied live hands or an actual world builder.
      cardInstances: [
        ...ids.flatMap((ownerPlayerId) =>
          [plain, exempt].map((definition, index) =>
            createCardInstance(definition, {
              instanceId: `${ownerPlayerId}-${index}`,
              ownerPlayerId,
              zone: "hand",
            })
          )
        ),
        ...ids.map((ownerPlayerId) =>
          createCardInstance(plain, {
            instanceId: `${ownerPlayerId}-deck`,
            ownerPlayerId,
            zone: "deck",
          })
        ),
      ],
    }),
    ...materializeAiSearchSetUsage(usage),
    step: "main" as const,
    zoneCountMode: undefined,
    turnNumber: 3,
  };
}

describe("I1 public set-action usage (partial world)", () => {
  it.each([0, 1])(
    "root %s preserves both owners' real set actions after their slots are emptied",
    (seat) => {
      let source = fixture();
      for (const owner of owners) {
        source = { ...source, activePlayerId: owner };
        source = useSetBurstAsAction({
          state: source,
          actingPlayerId: owner,
          sourceInstanceId: `${owner}-0`,
          ...options,
        }).state;
        source = executeDiscardSetBurst(source, owner, 1, lookup);
        source = setMirage(source, owner, 1);
        source = removeMirageSetState(
          moveCardZone(source, `${owner}-1`, "trash"),
          `${owner}-1`
        );
      }
      expect(source.setBurstStates).toEqual([]);
      expect(source.mirageSetStates).toEqual([]);
      const observation = observe(source, seat),
        before = structuredClone(observation);
      expect(
        observation.players.every(
          (p) => p.burstSetCount === 0 && p.mirageSetCount === 0
        )
      ).toBe(true);
      const usage = projectAiSearchSetUsage(observation);
      expect(usage).toEqual(
        ["me", "opp"].map((owner) => ({
          owner,
          burst: true,
          mirage: true,
          mirageCountExemptionCardNos: [],
        }))
      );
      const world = synthetic(usage);
      expect(
        projectAiSearchSetUsage(
          buildAiObservation({
            state: world,
            viewpointPlayerId: AI_SEARCH_WORLD_PLAYERS.me,
            getCardDefinitionById: lookup,
          })
        )
      ).toEqual(usage);
      for (const owner of Object.values(AI_SEARCH_WORLD_PLAYERS)) {
        const state = { ...world, activePlayerId: owner };
        const action = {
          state,
          actingPlayerId: owner,
          sourceInstanceId: `${owner}-0`,
          ...options,
        };
        expect(getBurstSetBlockReason(action)).toBe(
          "already_set_burst_this_turn"
        );
        expect(getMirageSetBlockReason(action)).toBe(
          "already_set_mirage_this_turn"
        );
        // Canary: occupancy alone would incorrectly permit both ordinary actions.
        const lostUsage = {
          ...state,
          burstSetPlayerIdsThisTurn: [],
          mirageSetPlayerIdsThisTurn: [],
        };
        expect(
          getBurstSetBlockReason({ ...action, state: lostUsage })
        ).toBeNull();
        expect(
          getMirageSetBlockReason({ ...action, state: lostUsage })
        ).toBeNull();
        // A normal-action restriction must not erase an authorized effect set.
        const effectSet = useSetBurstAsAction({
          ...action,
          settingMode: "effect",
        }).state;
        expect(
          effectSet.cardInstances.find((c) => c.instanceId === `${owner}-0`)
            ?.zone
        ).toBe("burst");
        expect(effectSet.burstSetPlayerIdsThisTurn).toEqual(
          world.burstSetPlayerIdsThisTurn
        );
      }
      expect(observation).toEqual(before);
      expect(JSON.stringify(usage)).not.toMatch(
        /live-|instanceId|cardNo|SEARCH-SET/
      );
    }
  );

  it.each([0, 1])(
    "root %s preserves a consumed real Mirage exemption and resets it at the next turn",
    (seat) => {
      let source = fixture();
      for (const owner of owners) {
        source = { ...source, activePlayerId: owner };
        source = setMirage(source, owner, 0);
        source = setMirage(source, owner, 2);
        expect(source.mirageSetCountExemptionsUsed).toContainEqual({
          playerId: owner,
          cardNo: exempt.cardNo,
        });
        source = removeMirageSetState(
          moveCardZone(source, `${owner}-2`, "trash"),
          `${owner}-2`
        );
      }
      const world = synthetic(projectAiSearchSetUsage(observe(source, seat)));
      for (const owner of Object.values(AI_SEARCH_WORLD_PLAYERS)) {
        const state = { ...world, activePlayerId: owner };
        const action = {
          state,
          actingPlayerId: owner,
          sourceInstanceId: `${owner}-1`,
          ...options,
        };
        expect(getMirageSetBlockReason(action)).toBe(
          "already_set_mirage_this_turn"
        );
        const unconsumed = {
          ...state,
          mirageSetCountExemptionsUsed: [],
        };
        expect(
          getMirageSetBlockReason({ ...action, state: unconsumed })
        ).toBeNull();
        const nextTurn = advanceStep(
          { ...state, step: "end" },
          lookup,
          () => [],
          () => []
        );
        expect(nextTurn.turnNumber).toBeGreaterThan(state.turnNumber);
        expect(nextTurn.gameResult).toBeNull();
        expect(
          materializeAiSearchSetUsage(
            projectAiSearchSetUsage(
              buildAiObservation({
                state: nextTurn,
                viewpointPlayerId: owner,
                getCardDefinitionById: lookup,
              })
            )
          )
        ).toEqual({
          burstSetPlayerIdsThisTurn: [],
          mirageSetPlayerIdsThisTurn: [],
          mirageSetCountExemptionsUsed: [],
        });
        const reset = {
          ...nextTurn,
          step: "main" as const,
          activePlayerId: owner,
        };
        expect(getMirageSetBlockReason({ ...action, state: reset })).toBeNull();
        const after = useSetMirageAsAction({
          ...action,
          state: reset,
          paymentSources: [{ kind: "reserve", amount: 2 }],
        }).state;
        expect(
          after.cardInstances.find((c) => c.instanceId === `${owner}-1`)?.zone
        ).toBe("mirage");
      }
    }
  );

  it.each([0, 1])(
    "root %s ignores opponent hand/deck identities, secret IDs and array order",
    (seat) => {
      const source = fixture(),
        other = structuredClone(source);
      source.burstSetPlayerIdsThisTurn = [owners[0], owners[1]];
      other.burstSetPlayerIdsThisTurn = [owners[1], owners[0]];
      for (const card of other.cardInstances) {
        card.instanceId = `renamed-${card.instanceId}`;
        if (card.ownerPlayerId !== owners[seat])
          card.definitionId = exempt.cardNo;
      }
      other.cardInstances.reverse();
      expect(projectAiSearchSetUsage(observe(other, seat))).toEqual(
        projectAiSearchSetUsage(observe(source, seat))
      );
    }
  );

  it("免除だけを使った通常枠未使用の公開履歴を同名単位で往復する", () => {
    const source = setMirage(fixture(), owners[0], 2);
    expect(source.mirageSetPlayerIdsThisTurn).toEqual([]);
    const usage = projectAiSearchSetUsage(observe(source));
    expect(usage[0]).toMatchObject({
      mirage: false,
      mirageCountExemptionCardNos: [exempt.cardNo],
    });
    const restored = materializeAiSearchSetUsage(usage);
    expect(restored.mirageSetPlayerIdsThisTurn).toEqual([]);
    expect(restored.mirageSetCountExemptionsUsed).toEqual([
      { playerId: AI_SEARCH_WORLD_PLAYERS.me, cardNo: exempt.cardNo },
    ]);
  });

  it("rejects old, missing, malformed, accessor and inconsistent flags instead of guessing from slots", () => {
    const observation = observe(fixture());
    for (const invalid of [
      undefined,
      null,
      {},
      { burst: false, mirage: false, mirageCountExemptionCardNos: 0 },
      {
        burst: false,
        mirage: false,
        mirageCountExemptionCardNos: ["duplicate", "duplicate"],
      },
    ]) {
      const copy = structuredClone(observation);
      copy.players[1].setUsageThisTurn = invalid as never;
      expect(() => projectAiSearchSetUsage(copy)).toThrow(/set usage/);
    }
    const flags = observation.players[0].setUsageThisTurn!;
    Object.defineProperty(flags, "burst", {
      get: () => {
        throw new Error("getter invoked");
      },
    });
    expect(() => projectAiSearchSetUsage(observation)).toThrow(
      /set usage data/
    );
    for (const mode of ["debug_perfect", "spectator_full"] as const)
      expect(() => projectAiSearchSetUsage({ ...observation, mode })).toThrow(
        /player observation/
      );
    expect(() =>
      projectAiSearchSetUsage(fixture() as unknown as AiObservation)
    ).toThrow(/player observation/);
  });

  it("validates both owners and returns detached canonical arrays", () => {
    const usage = projectAiSearchSetUsage(observe(fixture()));
    for (const invalid of [
      [],
      usage.slice(0, 1),
      [usage[0], usage[0]],
      [usage[0], { ...usage[1], owner: "stranger" }],
    ])
      expect(() => materializeAiSearchSetUsage(invalid as never)).toThrow(
        /set usage/
      );
    const used = usage.map((entry) => ({ ...entry, burst: true }));
    const one = materializeAiSearchSetUsage(used),
      two = materializeAiSearchSetUsage([...used].reverse());
    expect(one).toEqual(two);
    one.burstSetPlayerIdsThisTurn.pop();
    expect(two.burstSetPlayerIdsThisTurn).toHaveLength(2);
    expect(used.every((entry) => entry.burst)).toBe(true);
  });
});
