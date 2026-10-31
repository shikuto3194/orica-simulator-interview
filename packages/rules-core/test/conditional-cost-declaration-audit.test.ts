import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { GameState } from "../src";
import { previewConditionalCoreCost } from "../src/effect/conditional-cost-core-preview";
import { isConditionalCostBlocked } from "../src/legal/legal-actions-availability";
import { canExecuteOptionalStep } from "../src/effect/native-effect-front-helpers";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { Effect } from "../src/dsl-types";

const lookup = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const handEffects = buildHandActivatedEffectLookup(ALL_CARDS);

function board(
  soul: "trash" | "reserve" | "life" | "field",
  normalCores: number,
  cardNo = "BSTH11-X02"
): GameState {
  const card = (no: string, id: string, zone: "field" | "hand", cores = 0) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: "bob",
      zone,
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      card(cardNo, "source", "hand"),
      card(
        cardNo === "BSTH11-X02" ? "BSTH11-X01" : "BSTH10-X01",
        "nexus",
        "field",
        3
      ),
      {
        ...card(
          "BSTH11-C05",
          "donor",
          "field",
          soul === "field" ? normalCores : 0
        ),
        soulCoreCount: soul === "field" ? 1 : 0,
      },
    ],
    playerOverrides: [
      {},
      {
        handCount: 1,
        reserveNormalCoreCount: soul === "field" ? 0 : normalCores,
        reserveSoulCoreCount: soul === "reserve" ? 1 : 0,
        trashSoulCoreCount: soul === "trash" ? 1 : 0,
        lifeSoulCoreCount: soul === "life" ? 1 : 0,
        soulCoreLocation:
          soul === "field"
            ? { kind: "card", instanceId: "donor" }
            : { kind: soul },
      },
    ],
  });
  return {
    ...state,
    step: "attack",
    activePlayerId: "alice",
    window: "flash_before_block",
    activeAttack: {
      attackId: "audit",
      primaryEntityId: "attacker",
      participantEntityIds: ["attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "bob",
        pendingStackAction: null,
      },
    },
  };
}

function canDeclare(state: GameState): boolean {
  return getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: lookup,
    getRegisteredHandActivatedEffectActions: handEffects,
    getRegisteredFieldCardEffectActions: () => [],
  }).some(
    (action) =>
      action.kind === "use_hand_card_effect" &&
      action.sourceInstanceId === "source" &&
      action.effectIndex === 0
  );
}

describe("ことでの宣言可否: 現界", () => {
  it.each(["BSTH11-X02", "BSTH10-X05"])(
    "%s: ソウルコアがトラッシュなら維持コアの有無を問わず宣言不可",
    (cardNo) => {
      expect(canDeclare(board("trash", 0, cardNo))).toBe(false);
      expect(canDeclare(board("trash", 2, cardNo))).toBe(false);
    }
  );
  it.each(["reserve", "life", "field"] as const)(
    "%sのソウルコアを払っても維持コアが残らなければ宣言不可",
    (soul) => {
      expect(canDeclare(board(soul, 0))).toBe(false);
      expect(canDeclare(board(soul, 1))).toBe(true);
    }
  );
  it("宣言可否の照会は盤面・ログ・使用回数を変更しない", () => {
    const state = board("reserve", 1);
    const before = structuredClone(state);
    expect(canDeclare(state)).toBe(true);
    expect(canDeclare(state)).toBe(true);
    expect(state).toEqual(before);
  });
  it("複数ソウルコア: 1個支払う現界は余ったソウルを維持に使えるが、全個数支払う現界は使えない", () => {
    for (const [cardNo, allowed] of [
      ["BSTH11-X02", true],
      ["BSTH10-X05", false],
    ] as const) {
      const state = board("reserve", 0, cardNo);
      state.players[1]!.reserveSoulCoreCount = 2;
      expect(canDeclare(state)).toBe(allowed);
    }
  });
  it("ソウルコアの除外も1個の対価達成として数える", () => {
    const state = board("reserve", 1);
    const preview = previewConditionalCoreCost({
      state,
      action: lookup("BSAZ01-C14")!.effects![1]!.steps[0]!.action,
      actingPlayerId: "bob",
      sourceInstanceId: "source",
      getCardDefinitionById: lookup,
    });
    expect(preview?.paid).toBe(true);
    expect(preview?.state.players[1]!.soulCoreLocation?.kind).toBe(
      "removed_from_game"
    );
    expect(state.players[1]!.reserveSoulCoreCount).toBe(1);
  });
  it("トラッシュの通常コア3個が必要な任意支払いは2個では選べない", () => {
    const state = board("trash", 1);
    state.players[1]!.trashNormalCoreCount = 2;
    const action = lookup("BSTH11-R03")!.effects![1]!.steps.find(
      (step) =>
        step.action.kind === "core_move" && step.action.from.kind === "trash"
    )!.action;
    const args = {
      state,
      action,
      actingPlayerId: "bob",
      sourceInstanceId: "source",
      getCardDefinitionById: lookup,
      stepCtx: createStepExecutionContext(state),
    };
    expect(canExecuteOptionalStep(args)).toBe(false);
    // 通常の「可能な限り移動」は対価の全額達成条件を課さない。
    expect(
      canExecuteOptionalStep({
        ...args,
        action: {
          kind: "core_move",
          from: { kind: "trash", player: "self" },
          to: { kind: "void", player: "self" },
          amount: 3,
        },
      })
    ).toBe(true);
    state.players[1]!.trashNormalCoreCount = 3;
    expect(canExecuteOptionalStep(args)).toBe(true);
  });
});

describe("ことで全監査: 結果側と後段の境界", () => {
  function blocked(state: GameState, effect: Effect) {
    return isConditionalCostBlocked({
      state,
      actingPlayerId: "bob",
      sourceCard: state.cardInstances[0]!,
      sourceDefinition: lookup("BSTH11-X02")!,
      sourceKind: "spirit",
      resolutionKind: "field_card_effect_action",
      composition: undefined,
      effect,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      getConditionalCostCanExecuteCheck: undefined,
    });
  }
  it("回復することでなく、対価を払って回復する場合は回復済みなら宣言不可", () => {
    const state = board("reserve", 1);
    state.cardInstances[0] = {
      ...state.cardInstances[0]!,
      zone: "field",
      normalCoreCount: 3,
    };
    const effect = lookup("BSLH01-C01")!.effects![2]!;
    expect(blocked(state, effect)).toBe(true);
    state.cardInstances[0]!.exhaustState = "exhausted";
    expect(blocked(state, effect)).toBe(false);
  });
  it("先にドローする独立効果があるなら、後段の対価不足は先行効果を禁止しない", () => {
    const state = board("trash", 0);
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          action: { kind: "exhaust", target: { kind: "self" } },
          executionMode: "optional",
        },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    expect(blocked(state, effect)).toBe(false);
  });
  it("疲労を対価にしてドローする効果は空デッキなら宣言不可", () => {
    const state = board("reserve", 1);
    state.players[1]!.deckCount = 0;
    state.cardInstances[0] = {
      ...state.cardInstances[0]!,
      zone: "field",
      normalCoreCount: 1,
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "exhaust", target: { kind: "self" } } },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    expect(blocked(state, effect)).toBe(true);
  });
});
