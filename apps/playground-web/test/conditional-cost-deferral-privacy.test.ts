import { beforeAll, describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  sanitizeStateForViewer,
  type GameState,
} from "@orica/rules-core";
import {
  __initializeGameApiLookupsForTest,
  prepareRoomViewerState,
} from "../server/game-api";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = (id: string) => definitions.find((c) => c.cardNo === id);
beforeAll(async () => {
  await __initializeGameApiLookupsForTest(ALL_CARDS);
});
function deferral() {
  const card = (
    no: string,
    instanceId: string,
    zone: "hand" | "deck" | "field" | "in_use",
    ownerPlayerId = "alice",
    normalCoreCount = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId,
      zone,
      ownerPlayerId,
      normalCoreCount,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card("BSAZ01-C03", "source", "in_use"),
        card("BSTH001-C01", "cost0", "hand"),
        card("BSTH001-C01", "cost1", "hand"),
        card("BSTH001-C01", "attacker", "field", "bob", 1),
        card("BSTH01-X05", "secret-hand", "hand", "bob"),
        card("BSTH01-X04", "secret-deck", "deck", "bob"),
      ],
      playerOverrides: [{ handCount: 2 }, { handCount: 1, deckCount: 1 }],
    }),
    activePlayerId: "bob",
    step: "attack",
    turnNumber: 4,
    battleEntities: [
      {
        entityId: "battle",
        memberInstanceIds: ["attacker"],
        resolvedBp: 1000,
        resolvedSymbols: [],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack",
      primaryEntityId: "battle",
      participantEntityIds: ["battle"],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
  };
  return executeEffect({
    state,
    effect: lookup("BSAZ01-C03")!.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    chainId: "deferral-privacy",
    targetInstanceIds: ["cost0", "cost1"],
    targetStepId: "exclude-cards",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
  });
}
const forbidden = [
  "conditionalCostOriginalState",
  "pendingConditionalCostRollback",
  "resolutionSegmentBeforeState",
  "stateSnapshot",
];
function expectPrivate(state: GameState) {
  const original = JSON.stringify(state);
  for (const viewer of ["alice", "bob", null]) {
    for (const project of [sanitizeStateForViewer, prepareRoomViewerState]) {
      const shown = project(state, viewer);
      const json = JSON.stringify(shown);
      for (const key of forbidden)
        expect(json, `${project.name}/${viewer}/${key}`).not.toContain(key);
      expect(
        shown.cardInstances.find((c) => c.instanceId === "secret-deck")
          ?.definitionId
      ).not.toBe("BSTH01-X04");
      if (viewer !== "bob") expect(json).not.toContain("BSTH01-X05");
      expect(json).not.toContain("BSTH01-X04");
    }
  }
  expect(JSON.stringify(state)).toBe(original);
}
describe("conditional-cost authoritative continuations stay off viewer delivery", () => {
  it("persisted state without the deferral field still projects private cards safely", () => {
    const state: GameState = JSON.parse(JSON.stringify(deferral()));
    delete (state as Partial<GameState>).pendingBattleEndDeferrals;
    expectPrivate(state);
    for (const viewer of ["alice", "bob", null]) {
      for (const project of [sanitizeStateForViewer, prepareRoomViewerState]) {
        expect(project(state, viewer).pendingBattleEndDeferrals).toEqual([]);
      }
    }
    expect(state).not.toHaveProperty("pendingBattleEndDeferrals");
  });
  it("real C03 battle deferral is private in both core and production room projection", () => {
    const state = deferral();
    expect(state.pendingBattleEndDeferrals).toHaveLength(1);
    expect(
      state.pendingBattleEndDeferrals[0]!.restoredStepContext
        ?.conditionalCostOriginalState
    ).toBeDefined();
    expectPrivate(state);
  });
  it.each(["borrowed", "core-source", "redirect"] as const)(
    "the %s input carrier uses the same snapshot boundary",
    (carrier) => {
      const state = deferral();
      const stepContext =
        state.pendingBattleEndDeferrals[0]!.restoredStepContext!;
      state.pendingBattleEndDeferrals = [];
      const continuation = {
        chainId: "privacy",
        sourceDefinitionId: "BSAZ01-C03",
        effectIndex: 1,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        resumeStepIndex: 1,
        stepContext,
      };
      if (carrier === "borrowed")
        state.pendingBorrowedEffectTargetSelection = {
          ...continuation,
          pendingId: "borrowed",
          choosingPlayerId: "alice",
          targetInstanceId: "attacker",
          targetDefinitionId: "BSTH001-C01",
          borrowedEffectIndex: 0,
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateInstanceIds: ["attacker"],
          targetStepId: "target",
          targetStepIndex: 0,
        };
      if (carrier === "core-source")
        state.pendingCoreSourceAllocation = {
          pendingId: "core",
          actingPlayerId: "alice",
          sourceInstanceId: "source",
          sourceDefinitionId: "BSAZ01-C03",
          candidates: [],
          requiredTotal: 1,
          toLocation: { kind: "reserve", player: "self" },
          effectTiming: { kind: "activated", mode: "main" },
          continuation,
        };
      if (carrier === "redirect")
        state.pendingTargetRedirects = [
          {
            pendingId: "redirect",
            redirectEffectId: "redirect",
            promptedPlayerId: "alice",
            sourceEffectInstanceId: "source",
            sourceEffectDefinitionId: "BSAZ01-C03",
            originalResolvedInstanceIds: ["attacker"],
            redirectableInstanceId: "attacker",
            candidateTokenInstanceIds: ["attacker"],
            continuation,
          },
        ];
      expectPrivate(state);
    }
  );
});
