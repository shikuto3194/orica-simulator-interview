import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  canCardDefinitionBeSetAsBurst,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "../src";
import { getStackSourceActivationZone } from "../src/card/card-lookup";
import { computePayToActHandDiscardGate } from "../src/legal/pay-to-act-hand-discard-gate";

const base = (no: string) => ALL_CARDS.find((c) => c.cardNo === no)!;
const fixture: CardDefinition = {
  ...base("BSTH10-C04"),
  cardNo: "ACCESS-ROUTES",
  effects: [],
  keywordTags: ["advent"],
  mirageData: { cost: 0, reduction: [] },
  accelData: {
    timing: "main",
    cost: 0,
    reduction: [],
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  },
  changeData: {
    cost: 0,
    reduction: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
    swapCondition: { tribes: ["幻想"], maxCost: 9 },
  },
  adventData: {
    adventCondition: { minCost: 0, targetCategory: ["spirit"] },
    adventTiming: "main_and_flash",
    soulCoreDest: "trash",
  },
};
const defs = [...ALL_CARDS, fixture];
const burst = ALL_CARDS.find(
  (c) =>
    canCardDefinitionBeSetAsBurst(c) &&
    c.tribe
      ?.split("・")
      .some((t) =>
        ["幻想", "玄影", "霄獣", "妖精", "神霊", "創界神", "導界者"].includes(t)
      )
)!;
const lookup = (id: string) => defs.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function board(no: string): GameState {
  const card = (
    no: string,
    instanceId: string,
    zone: "deck" | "field",
    cores = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId,
      ownerPlayerId: "player-1",
      zone,
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    cardInstances: [
      card("BSTH10-X01", "domain", "field", 3),
      card("BSTH10-C04", "host", "field", 1),
      card(no, "top", "deck"),
      card("BSTH10-C04", "tail", "deck"),
    ],
    playerOverrides: [
      {
        handCount: 0,
        deckCount: 2,
        reserveNormalCoreCount: 20,
        reserveSoulCoreCount: 1,
        soulCoreLocation: { kind: "reserve" },
      },
      {},
    ],
  });
  return rebuildContinuousEffectsFromField(
    {
      ...state,
      activePlayerId: "player-1",
      step: "main",
      window: "none",
      turnNumber: 2,
    },
    lookup
  );
}
function closeStack(state: GameState) {
  for (let i = 0; i < 12 && state.stackWindow; i++) {
    const action = getLegalActions({
      state,
      actingPlayerId: state.stackWindow.priorityPlayerId,
      ...options,
    }).find((a) => a.kind === "pass_stack");
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...options }).state;
  }
  return state;
}
describe("BSTH10-X01 手札扱いの候補から使用完了まで", () => {
  it.each([
    ["BSTH02-R11", "use_magic", "trash"],
    [fixture.cardNo, "set_mirage", "mirage"],
    [fixture.cardNo, "use_accel", "set_aside"],
    [fixture.cardNo, "declare_advent", "field"],
    [fixture.cardNo, "use_change", "trash"],
    [burst.cardNo, "set_burst", "burst"],
  ] as const)("%s を %s で使用し実デッキ枚数を更新する", (no, kind, zone) => {
    let state = board(no);
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      ...options,
    }).find(
      (a) =>
        a.kind === kind &&
        "sourceInstanceId" in a &&
        a.sourceInstanceId === "top"
    );
    expect(
      action,
      JSON.stringify(
        getLegalActions({ state, actingPlayerId: "player-1", ...options })
      )
    ).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...options,
      paymentSources:
        "finalCost" in action! && action!.finalCost > 0
          ? [{ kind: "reserve", amount: action!.finalCost as number }]
          : [],
      targetInstanceIds: kind === "declare_advent" ? ["host"] : [],
    }).state;
    const stack = state.stackWindow?.pendingStackAction;
    if (stack) {
      expect(getStackSourceActivationZone(state, stack, "player-1")).toBe(
        "hand"
      );
      expect(getStackSourceActivationZone(state, stack, "player-2")).toBe(
        "deck"
      );
    }
    state = closeStack(state);
    if (state.pendingEffectTargetSelection) {
      const select = getLegalActions({
        state,
        actingPlayerId: "player-1",
        ...options,
      }).find((a) => a.kind === "resolve_pending_effect_target")!;
      state = applyLegalAction({
        state,
        action: select,
        targetInstanceIds: ["host"],
        ...options,
      }).state;
    }
    if (state.pendingChangeCleanupChoice) {
      const cleanup = getLegalActions({
        state,
        actingPlayerId: "player-1",
        ...options,
      }).find(
        (a) =>
          a.kind === "resolve_pending_change_cleanup_choice" &&
          a.outcome === "trash"
      )!;
      state = applyLegalAction({ state, action: cleanup, ...options }).state;
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "top")?.zone,
      JSON.stringify(state.log)
    ).toBe(zone);
    expect(state.players[0]!.handCount).toBe(0);
    expect(state.players[0]!.deckCount).toBe(1);
  });

  it("公開デッキの効果使用に相手の手札限定ゲートを適用しない", () => {
    let state = board(fixture.cardNo);
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      ...options,
    }).find((a) => a.kind === "use_change")!;
    state = applyLegalAction({
      state,
      action,
      paymentSources: [],
      ...options,
    }).state;
    const stack = state.stackWindow!.pendingStackAction!;
    const gate = {
      effectId: "hand-only-gate",
      sourceInstanceId: "host",
      sourceDefinitionId: "BSTH10-C04",
      actingPlayerId: "player-2",
      targetInstanceId: "player-1",
      modifierTag: "gate_flash_stack_hand_discard" as const,
      duration: { scope: "turn" as const },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      metadata: { sourceActivationZones: ["hand"], handDiscardCount: 1 },
    };
    state = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, gate],
    };
    expect(computePayToActHandDiscardGate(state, stack, lookup)).toBeNull();
    const logicalHandStack = { ...stack };
    delete logicalHandStack.sourcePhysicalZone;
    expect(
      computePayToActHandDiscardGate(state, logicalHandStack, lookup)
    ).not.toBeNull();
  });

  it("手札とトラッシュの交換も公開デッキを選び物理枚数を更新する", () => {
    let state = board("BSTH10-C04");
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(base("BSTH10-C04"), {
          instanceId: "incoming",
          ownerPlayerId: "player-1",
          zone: "trash",
        }),
      ],
    };
    state = executeEffect({
      chainId: "test:bsth10-deck-use-routes:258",
      state,
      sourceInstanceId: "domain",
      actingPlayerId: "player-1",
      ...options,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "queue_hand_trash_swap",
              outgoingZones: ["hand"],
              outgoingFilter: {},
              incomingFilter: {},
            },
          },
        ],
      },
    });
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      ...options,
    }).find(
      (a) => a.kind === "swap_hand_trash" && a.outgoingCardInstanceId === "top"
    )!;
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action, ...options }).state;
    expect(state.cardInstances.find((c) => c.instanceId === "top")?.zone).toBe(
      "trash"
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "incoming")?.zone
    ).toBe("hand");
    expect(state.players[0]!.deckCount).toBe(1);
    expect(state.players[0]!.handCount).toBe(1);
  });
});
