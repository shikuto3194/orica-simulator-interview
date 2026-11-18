import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  getLegalActions,
  moveCardZone,
  queuePendingLeave,
  runStateBasedActions,
  type CardInstance,
  type GameState,
} from "../src";
import { resolveTurnFaceDown } from "../src/effect/turn-face-down";

const definition = ALL_CARDS.find((c) => c.cardNo === "BSTH10-X02")!;
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const card = (state: GameState) => state.cardInstances[0]!;
function setup(exhaustState: CardInstance["exhaustState"] = "exhausted") {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 20 }, {}],
      cardInstances: [
        {
          ...createCardInstance(definition, {
            instanceId: "junko",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          }),
          exhaustState,
          exhaustedByUnpreventableEffect: true,
          skipNextRefreshRecovery: true,
        },
      ],
    }),
    turnNumber: 8,
    activePlayerId: "alice",
    step: "main" as const,
  };
}
function leave(
  state: GameState,
  zone: "hand" | "deck" | "trash" | "set_aside"
) {
  return queuePendingLeave({
    state,
    instanceId: "junko",
    kind: zone === "trash" ? "destroy" : "bounce",
    cause: "effect_resolution",
    chainId: "test:card-state-reset",
    leaveDestination: { zone },
  });
}
function expectReset(state: GameState) {
  expect(card(state)).toMatchObject({
    exhaustState: "recovered",
    exhaustedByUnpreventableEffect: false,
    skipNextRefreshRecovery: false,
  });
}

describe("カード状態への移行で疲労状態をリセットする", () => {
  for (const zone of ["hand", "deck", "trash", "set_aside"] as const) {
    it.each(["exhausted", "heavily_exhausted"] as const)(
      `%s → ${zone}: 離脱待機中は維持し、実離脱時に一時状態を消す`,
      (exhaustState) => {
        const pending = leave(setup(exhaustState), zone);
        expect(
          card(runStateBasedActions(pending, lookup).state).exhaustState
        ).toBe(exhaustState);
        const after = flushPendingLeaves(pending, lookup);
        expect(card(after).zone).toBe(zone);
        expectReset(after);
        expect(card(after).normalCoreCount).toBe(0);
        expect(card(after).fieldInstanceGeneration).toBe(1);
      }
    );
  }

  it("手札へ戻った純狐を次の自分のターンに通常召喚しても疲労を引き継がない", () => {
    let state = flushPendingLeaves(leave(setup(), "hand"), lookup);
    state = { ...state, turnNumber: 10 };
    const options = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    };
    const summon = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...options,
    }).find((a) => a.kind === "summon");
    expect(summon).toBeDefined();
    state = applyLegalAction({
      state,
      action: summon!,
      paymentSources: [{ kind: "reserve", amount: 8 }],
      ...options,
    }).state;
    const pass = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...options,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass!, ...options }).state;
    const placement = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...options,
    }).find((a) => a.kind === "resolve_pending_enter_field_placement");
    expect(placement).toBeDefined();
    state = applyLegalAction({
      state,
      action: placement!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...options,
    }).state;
    expect(card(state)).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expectReset(state);
  });

  it("汎用ゾーン移動にも同じ初期化を適用する", () => {
    expectReset(moveCardZone(setup(), "junko", "hand"));
  });

  it("純化で同じフィールド内のカード状態へ移行した時点で初期化する", () => {
    const after = resolveTurnFaceDown(
      setup("heavily_exhausted"),
      ["junko"],
      "face_down",
      lookup
    );
    expect(card(after)).toMatchObject({
      zone: "field",
      zoneRoleName: "card",
      faceDown: true,
    });
    expectReset(after);
    expect(after.pendingLeaveEntities).toEqual([]);
  });

  it("状態付与中の分身は疲労を維持し、実体を失ってカード状態になれば初期化する", () => {
    const state = setup("heavily_exhausted");
    card(state).faceDown = true;
    card(state).zoneRoleName = "card";
    state.activeContinuousEffects = [
      {
        effectId: "clone",
        sourceInstanceId: "host",
        sourceDefinitionId: definition.cardNo,
        targetInstanceId: "junko",
        actingPlayerId: "alice",
        modifierTag: "act_as_spirit",
        duration: { scope: "while_on_field" },
        createdAtTurn: 8,
        createdAtAttackId: null,
      },
    ];
    expect(card(runStateBasedActions(state, lookup).state).exhaustState).toBe(
      "heavily_exhausted"
    );
    expectReset(
      runStateBasedActions({ ...state, activeContinuousEffects: [] }, lookup)
        .state
    );
  });

  it("通常の実体の疲労状態は初期化しない", () => {
    const state = setup();
    const after = runStateBasedActions(state, lookup).state;
    expect(card(after)).toMatchObject({
      exhaustState: "exhausted",
      exhaustedByUnpreventableEffect: true,
      skipNextRefreshRecovery: true,
    });
    expect(card(state).exhaustState).toBe("exhausted");
  });
});
