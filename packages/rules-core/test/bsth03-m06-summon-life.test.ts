import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
  type GameState,
  type LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};
function setup(
  route: "normal" | "burst",
  prevention = false,
  eirentei = false
): GameState {
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 20,
          lifeNormalCoreCount: 5,
          voidNormalCoreCount: 10,
          handCount: 1,
        },
      ],
      cardInstances: [
        createCardInstance(definitions.get("BSTH03-M06")!, {
          instanceId: "m06",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(definitions.get("BSTH01-C01")!, {
          instanceId: "opponent",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...(eirentei
          ? [
              createCardInstance(definitions.get("BSTH03-C31")!, {
                instanceId: "eirentei",
                ownerPlayerId: "bob",
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
        ...(prevention
          ? [
              createCardInstance(definitions.get("BSTH002-R02")!, {
                instanceId: "life-lock",
                ownerPlayerId: "bob",
                zone: "mirage",
              }),
            ]
          : []),
      ],
      mirageSetStates: prevention
        ? [{ playerId: "bob", cardInstanceId: "life-lock" }]
        : [],
    }),
    step: "main",
    activePlayerId: "alice",
    turnNumber: 4,
  };
  const ready = recomputeAndRebuildContinuousEffects(
    state,
    lookups.getCardDefinitionById
  );
  if (route === "normal") return ready;
  const set = act(ready, "alice", "set_burst");
  expect(set.cardInstances.find((c) => c.instanceId === "m06")).toMatchObject({
    zone: "burst",
    faceDown: false,
  });
  // Start the opponent's main step with the burst produced by the real setter.
  return { ...set, activePlayerId: "bob", turnNumber: 5 };
}
function actions(state: GameState, player = "alice") {
  return getLegalActions({ state, actingPlayerId: player, ...lookups });
}
function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  const offered = actions(state, player);
  const action = offered.find((a) => a.kind === kind);
  expect(action, JSON.stringify(offered)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}
function summon(
  route: "normal" | "burst",
  prevention = false,
  eirentei = false
) {
  let state = setup(route, prevention, eirentei);
  if (route === "normal") {
    state = act(state, "alice", "summon", {
      paymentSources: [{ kind: "reserve", amount: 8 }],
    });
    state = act(state, "bob", "pass_stack");
  } else {
    state = advanceStep(
      state,
      lookups.getCardDefinitionById,
      lookups.getRegisteredTriggeredEffectActions,
      lookups.getRegisteredBurstActions
    );
    state = act(state, "alice", "resolve_pending_burst_check");
    state = act(state, "bob", "pass_stack");
    if (state.stackWindow) state = act(state, "bob", "pass_stack");
    if (state.pendingEffectTargetSelection)
      state = act(state, "alice", "resolve_pending_effect_target", {
        targetInstanceIds: ["opponent"],
      });
  }
  if (state.pendingEnterFieldPlacement)
    state = act(state, "alice", "resolve_pending_enter_field_placement", {
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
  if (state.pendingMultiPlacement) {
    state = act(state, "alice", "resolve_pending_multi_placement", {
      multiPlacementAllocations: [
        {
          destinationInstanceId: "m06",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });
  }
  expect(state.cardInstances.find((c) => c.instanceId === "m06")).toMatchObject(
    { zone: "field", normalCoreCount: 1 }
  );
  return state;
}
const alice = (state: GameState) =>
  state.players.find((p) => p.id === "alice")!;
const lifeAction = (state: GameState) =>
  actions(state).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "m06"
  );

describe.each(["normal", "burst"] as const)(
  "BSTH03-M06 %s summon life",
  (route) => {
    it("Lv3の召喚時を明示発揮するとlifeが5→6、voidが10→9になる", () => {
      let state = summon(route);
      expect(
        state.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "summon" && p.relatedInstanceId === "m06"
        )
      ).toHaveLength(1);
      expect(
        lifeAction(state),
        JSON.stringify({
          actions: actions(state),
          pending: state.pendingTriggeredEffects,
          log: state.log,
        })
      ).toBeDefined();
      expect(alice(state).lifeNormalCoreCount).toBe(5);
      state = act(state, "alice", "resolve_pending_triggered_effect", {
        skipOptionalEffect: false,
      });
      state = act(state, "bob", "pass_stack");
      expect(alice(state).lifeNormalCoreCount).toBe(6);
      expect(alice(state).voidNormalCoreCount).toBe(9);
      expect(
        state.players.find((p) => p.id === "bob")?.lifeNormalCoreCount
      ).toBe(5);
      expect(lifeAction(state)).toBeUndefined();
    });
    it("永遠亭下でもアルティメットの召喚時を任意発揮するとlife+1/void-1となり制限ログを出さない", () => {
      let state = summon(route, false, true);
      expect(
        state.activeContinuousEffects
          .filter((ce) => ce.modifierTag === "restrict_core_placement_void")
          .map((ce) => ce.targetInstanceId)
          .sort()
      ).toEqual(["alice", "bob"]);
      expect(
        state.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "summon" && p.relatedInstanceId === "m06"
        )
      ).toHaveLength(1);
      expect(lifeAction(state)).toMatchObject({ executionMode: "optional" });
      state = act(state, "alice", "resolve_pending_triggered_effect", {
        skipOptionalEffect: false,
      });
      state = act(state, "bob", "pass_stack");
      expect(alice(state).lifeNormalCoreCount).toBe(6);
      expect(alice(state).voidNormalCoreCount).toBe(9);
      expect(
        state.log.filter((line) =>
          line.includes("blocked-by-restrict_core_placement_void")
        )
      ).toEqual([]);
      expect(lifeAction(state)).toBeUndefined();
    });
    it("任意効果をスキップするとlifeとvoidは変わらない", () => {
      let state = summon(route);
      expect(lifeAction(state)).toBeDefined();
      state = act(state, "alice", "resolve_pending_triggered_effect", {
        skipOptionalEffect: true,
      });
      expect(alice(state).lifeNormalCoreCount).toBe(5);
      expect(alice(state).voidNormalCoreCount).toBe(10);
      expect(lifeAction(state)).toBeUndefined();
    });
    it("Lv3未満の0コアでは召喚時効果の候補を出さない", () => {
      const state = summon(route);
      const belowLevel = {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "m06" ? { ...c, normalCoreCount: 0 } : c
        ),
      };
      expect(lifeAction(belowLevel)).toBeUndefined();
      expect(alice(belowLevel).lifeNormalCoreCount).toBe(5);
      expect(alice(belowLevel).voidNormalCoreCount).toBe(10);
    });
    it("実カードのlife_gain_preventionがあると発揮してもlifeとvoidは変わらない", () => {
      let state = summon(route, true);
      expect(
        state.activeContinuousEffects.some(
          (ce) => ce.modifierTag === "life_gain_prevention"
        )
      ).toBe(true);
      expect(lifeAction(state)).toBeDefined();
      state = act(state, "alice", "resolve_pending_triggered_effect", {
        skipOptionalEffect: false,
      });
      state = act(state, "bob", "pass_stack");
      expect(alice(state).lifeNormalCoreCount).toBe(5);
      expect(alice(state).voidNormalCoreCount).toBe(10);
      expect(lifeAction(state)).toBeUndefined();
    });
  }
);
