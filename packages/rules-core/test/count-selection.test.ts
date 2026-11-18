/**
 * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: 汎用「カウントを好きなだけ
 * 減らす」プレイヤー数選択の基盤テスト。
 *
 * count_decrease の amount が {min, max}（範囲、通常 min:0）のとき、pendingCountSelection を
 * 生成し、applyLegalAction(resolve_pending_count_decrease) で減らす数を確定する。
 * PendingCoreCountSelection (P3-88) と同型パターンだが、後続ステップ（「そうしたとき」の
 * 連動効果）を継続 (ZoneSelectionContinuation 型と同型) で再開する点が異なる。
 *
 * 代表カード: BSGE01-M02「自分のカウントを好きなだけ減らせる。そうしたとき、〜減らしたカウント
 * 1につき…」(min=0, max=reducible countValue)。本テストは合成 effect で基盤機構のみ検証する
 * (card-data 配線は別 iteration: CardFilter zone 拡張が別途必要)。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeHandWrittenEffectResolver,
  type EffectActionContext,
} from "../src/effect/effect-resolution";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { hasOpenEffectResolutionPending } from "../src/legal/pending-action-handlers";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

// 継続 (ZoneSelectionContinuation 型) の resume は sourceDefinitionId + effectIndex から
// `def.effects[effectIndex]` を再引きする (effect オブジェクト自体は保存しない)。
// 単一ステップの pendingCoreCountSelection と違い本テストは後続ステップの resume を検証するため、
// getCardDefinitionById が実際に effects[] を持つ定義を返す必要がある。
function getTestCardDefinitionById(): CardDefinition | undefined {
  return {
    cardNo: "TEST-000",
    name: "test",
    printedCategory: "spirit",
    colors: [],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: [],
    textLines: [],
    tribe: "",
    effects: [decreaseCountThenMoveCores()],
  } as unknown as CardDefinition;
}

function decreaseCountThenMoveCores(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        id: "cd",
        action: { kind: "count_decrease", player: "self", amount: { min: 0 } },
      },
      {
        action: {
          kind: "core_move",
          from: { kind: "reserve", player: "self" },
          to: { kind: "void", player: "self" },
          amount: { source: { kind: "step_numeric_amount", stepId: "cd" } },
        },
        connector: "conditional_result",
      },
    ],
  };
}

function decreaseCountThenMoveCoresFlash(): Effect {
  return {
    ...decreaseCountThenMoveCores(),
    timing: { kind: "activated", mode: "flash" },
  };
}

function increaseCountFlash(amount: number): Effect {
  return {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: { kind: "count_increase", player: "self", amount },
      },
    ],
  };
}

function multiEffectDispatchDefinition(): CardDefinition {
  return {
    cardNo: "TEST-COUNT-SELECTION-DISPATCH",
    name: "count selection dispatch test",
    printedCategory: "spirit",
    colors: [],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: [],
    textLines: [],
    tribe: "",
    effects: [decreaseCountThenMoveCoresFlash(), increaseCountFlash(9)],
  } as unknown as CardDefinition;
}

function stateWithAliceCountAndReserve(
  countValue: number,
  reserve: number
): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      { countValue, reserveNormalCoreCount: reserve, voidNormalCoreCount: 0 },
      {},
    ],
  });
}

function generate(countValue: number, reserve = 10): GameState {
  return executeEffect({
    chainId: "test:count-selection:119",
    state: stateWithAliceCountAndReserve(countValue, reserve),
    effect: decreaseCountThenMoveCores(),
    sourceInstanceId: "s1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getTestCardDefinitionById,
  });
}

function resolveWith(state: GameState, chosen: number): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getTestCardDefinitionById,
  });
  const action = actions.find(
    (a) => a.kind === "resolve_pending_count_decrease"
  );
  expect(action).toBeDefined();
  const applied = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getTestCardDefinitionById,
    countDecreaseSelection: chosen,
  });
  return applied.state;
}

function alice(state: GameState) {
  return state.players.find((p) => p.id === ALICE)!;
}

describe("ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2 カウント数選択 pending の生成", () => {
  it("amount {min:0} かつ countValue>0 で pending を生成 (min0/max=countValue)", () => {
    const gen = generate(5);
    expect(gen.pendingCountSelection).not.toBeNull();
    expect(gen.pendingCountSelection!.min).toBe(0);
    expect(gen.pendingCountSelection!.max).toBe(5);
    expect(gen.pendingCountSelection!.actingPlayerId).toBe(ALICE);
    expect(gen.pendingCountSelection!.targetPlayerId).toBe(ALICE);
    // 生成時点では盤面未変化
    expect(alice(gen).countValue).toBe(5);
    expect(alice(gen).reserveNormalCoreCount).toBe(10);
  });

  it("legal action が min/max と targetPlayerId を提示する", () => {
    const gen = generate(5);
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestCardDefinitionById,
    });
    const a = actions.find((x) => x.kind === "resolve_pending_count_decrease");
    expect(a).toMatchObject({
      kind: "resolve_pending_count_decrease",
      min: 0,
      max: 5,
      targetPlayerId: ALICE,
    });
  });

  it("countValue=0 なら noop で pending を生成しない (effectiveMax<=effectiveMin)", () => {
    const gen = generate(0);
    expect(gen.pendingCountSelection).toBeNull();
    expect(alice(gen).countValue).toBe(0);
    expect(alice(gen).reserveNormalCoreCount).toBe(10);
    expect(alice(gen).voidNormalCoreCount).toBe(0);
  });
});

describe("ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2 カウント数選択の解決（継続 resume）", () => {
  it("3 を選ぶとカウントが2に減り、後続 conditional_result のコア移動が numericAmount=3 で発火する", () => {
    const after = resolveWith(generate(5), 3);
    expect(after.pendingCountSelection).toBeNull();
    expect(alice(after).countValue).toBe(2);
    expect(alice(after).reserveNormalCoreCount).toBe(7);
    expect(alice(after).voidNormalCoreCount).toBe(3);
  });

  it("0 を選ぶとカウント不変、conditional_result の後続ステップはスキップされる（「そうしたとき」ゲート）", () => {
    const after = resolveWith(generate(5), 0);
    expect(alice(after).countValue).toBe(5);
    expect(alice(after).reserveNormalCoreCount).toBe(10);
    expect(alice(after).voidNormalCoreCount).toBe(0);
  });

  it("範囲外 (6) はエラー", () => {
    const gen = generate(5);
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestCardDefinitionById,
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_count_decrease"
    )!;
    expect(() =>
      applyLegalAction({
        state: gen,
        action,
        getCardDefinitionById: getTestCardDefinitionById,
        countDecreaseSelection: 6,
      })
    ).toThrow();
  });
});

describe("ENGINE-count-selection-dispatch 後続 effect dispatch 停止", () => {
  it("pendingCountSelection は postResolutionOracle ready 判定上の未解決 effect pending として扱う", () => {
    const state: GameState = {
      ...stateWithAliceCountAndReserve(5, 10),
      pendingCountSelection: {
        pendingId: "count-selection-oracle-gate",
        actingPlayerId: ALICE,
        sourceInstanceId: "s1",
        sourceDefinitionId: "TEST-000",
        targetPlayerId: ALICE,
        playerRef: "self",
        sourceTribes: [],
        min: 0,
        max: 5,
        effectTiming: decreaseCountThenMoveCores().timing,
      },
    };

    expect(hasOpenEffectResolutionPending(state)).toBe(true);
  });

  it("pendingCountSelection が残る間は同一カードの後続 activated effect を dispatch しない", () => {
    const sourceDefinition = multiEffectDispatchDefinition();
    const sourceCard = createCardInstance(sourceDefinition, {
      instanceId: "count-selection-dispatch-source",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const getDefinitionById = (id: string) =>
      id === sourceDefinition.cardNo ? sourceDefinition : undefined;
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { countValue: 5, reserveNormalCoreCount: 10, voidNormalCoreCount: 0 },
        {},
      ],
      cardInstances: [sourceCard],
    });
    const context: EffectActionContext = {
      chainId: "count-selection-dispatch-chain",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: ALICE,
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition,
      targetInstanceIds: [],
      getCardDefinitionById: getDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      effectTimingFilter: "flash",
    };

    const after = executeHandWrittenEffectResolver({
      state,
      context,
      getResolver: () => undefined,
    });

    expect(after.pendingCountSelection).not.toBeNull();
    expect(alice(after).countValue).toBe(5);
    expect(after.log).not.toContain("effect:count_increase:alice:9");
    expect(after.flashEffectActivationLog).toEqual([
      expect.objectContaining({
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceDefinition.cardNo,
        effectIndex: 0,
      }),
    ]);
  });
});
