/**
 * ENGINE-composite-heterogeneous-removal-budget: discard_set_burst の count が
 * {min,max}（「バーストN個まで」型）のときの枚数選択 pending 基盤テスト。
 *
 * バースト（裏向きセット中カード）は Q4185 非識別のためカード単体を target として
 * 選べない。count が範囲のとき pendingDiscardSetBurstCountSelection を生成し、
 * applyLegalAction(resolve_pending_discard_set_burst_count) で破棄枚数を確定する。
 * PendingCountSelection (count_decrease 版) と同型パターンだが、解決対象は
 * discard_set_burst 実行そのもの (executeDiscardSetBurst を直接呼ぶ)。
 *
 * 代表カード: BSTH09-X01「相手のネクサス/ミラージュ/バースト3つまでを破壊/破棄し、
 * その効果を発揮させない」。本テストは合成 effect で基盤機構のみ検証する
 * (card-data 配線は別テストファイル)。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const oppBurstCard: CardDefinition = {
  cardNo: "TEST-OPP-BURST-CS",
  name: "テスト相手バースト",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: ["【バースト：適当】"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
};

function makeStateWithBursts(
  burstCount: number,
  overrides?: { reserve?: number }
): GameState {
  const cards = [];
  const burstStates = [];
  for (let i = 0; i < burstCount; i++) {
    const id = `bob-burst-${i}`;
    cards.push(
      createCardInstance(oppBurstCard, {
        instanceId: id,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "burst",
      })
    );
    burstStates.push({ playerId: BOB, cardInstanceId: id });
  }
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    playerOverrides: [
      {
        reserveNormalCoreCount: overrides?.reserve ?? 10,
        voidNormalCoreCount: 0,
      },
      {},
    ],
  });
  return {
    ...base,
    setBurstStates: burstStates,
  };
}

// 継続 (ZoneSelectionContinuation 型) の resume は sourceDefinitionId から
// `def.effects[effectIndex]` を再引きする (count-selection.test.ts と同じパターン)。
// sourceInstanceId ("s1") は state.cardInstances に実在しないため
// pending.sourceDefinitionId は "dsl-unknown" に落ちる。oppBurstCard 以外の id は
// すべてテスト発動元カード定義として解決する (許容的モック)。
function getTestCardDefinitionById(id: string): CardDefinition | undefined {
  if (id === oppBurstCard.cardNo) return oppBurstCard;
  return dsbSourceDefinition();
}

function discardBurstThenMoveCores(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        id: "dsb",
        action: {
          kind: "discard_set_burst",
          player: "opponent",
          count: { min: 0, max: 3 },
        },
      },
      {
        action: {
          kind: "core_move",
          from: { kind: "reserve", player: "self" },
          to: { kind: "void", player: "self" },
          amount: { source: { kind: "step_numeric_amount", stepId: "dsb" } },
        },
        connector: "conditional_result",
      },
    ],
  };
}

function dsbSourceDefinition(): CardDefinition {
  return {
    cardNo: "TEST-DSB-SOURCE",
    name: "test dsb source",
    printedCategory: "spirit",
    colors: [],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: [],
    textLines: [],
    tribe: "",
    effects: [discardBurstThenMoveCores()],
  } as unknown as CardDefinition;
}

function generate(burstCount: number, reserve = 10): GameState {
  const base = makeStateWithBursts(burstCount, { reserve });
  return executeEffect({
    chainId: "test:discard-set-burst-count-selection:129",
    state: base,
    effect: discardBurstThenMoveCores(),
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
    (a) => a.kind === "resolve_pending_discard_set_burst_count"
  );
  expect(action).toBeDefined();
  const applied = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getTestCardDefinitionById,
    discardSetBurstCountSelection: chosen,
  });
  return applied.state;
}

function alice(state: GameState) {
  return state.players.find((p) => p.id === ALICE)!;
}

describe("ENGINE-composite-heterogeneous-removal-budget バースト破棄枚数選択 pending の生成", () => {
  it("count {min:0,max:3} かつバースト3枚以上あれば pending を生成 (min0/max=3)", () => {
    const gen = generate(3);
    expect(gen.pendingDiscardSetBurstCountSelection).not.toBeNull();
    expect(gen.pendingDiscardSetBurstCountSelection!.min).toBe(0);
    expect(gen.pendingDiscardSetBurstCountSelection!.max).toBe(3);
    expect(gen.pendingDiscardSetBurstCountSelection!.actingPlayerId).toBe(
      ALICE
    );
    expect(gen.pendingDiscardSetBurstCountSelection!.targetPlayerId).toBe(BOB);
    // 生成時点では盤面未変化
    expect(gen.setBurstStates).toHaveLength(3);
  });

  it("実在バースト枚数が上限未満なら max を実在数にクリップ (印字3枚まで、実在1枚)", () => {
    const gen = generate(1);
    expect(gen.pendingDiscardSetBurstCountSelection).not.toBeNull();
    expect(gen.pendingDiscardSetBurstCountSelection!.min).toBe(0);
    expect(gen.pendingDiscardSetBurstCountSelection!.max).toBe(1);
  });

  it("legal action が min/max と targetPlayerId を提示する", () => {
    const gen = generate(3);
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestCardDefinitionById,
    });
    const a = actions.find(
      (x) => x.kind === "resolve_pending_discard_set_burst_count"
    );
    expect(a).toMatchObject({
      kind: "resolve_pending_discard_set_burst_count",
      min: 0,
      max: 3,
      targetPlayerId: BOB,
    });
  });

  it("バースト0枚なら noop で pending を生成しない (effectiveMax<=effectiveMin)", () => {
    const gen = generate(0);
    expect(gen.pendingDiscardSetBurstCountSelection).toBeNull();
    expect(gen.setBurstStates).toHaveLength(0);
  });
});

describe("ENGINE-composite-heterogeneous-removal-budget バースト破棄枚数選択の解決（継続 resume）", () => {
  it("2 を選ぶとバーストが2枚破棄され、後続 conditional_result のコア移動が numericAmount=2 で発火する", () => {
    const after = resolveWith(generate(3), 2);
    expect(after.pendingDiscardSetBurstCountSelection).toBeNull();
    expect(after.setBurstStates).toHaveLength(1);
    const trashed = after.cardInstances.filter((c) => c.zone === "trash");
    expect(trashed).toHaveLength(2);
    expect(alice(after).reserveNormalCoreCount).toBe(8);
    expect(alice(after).voidNormalCoreCount).toBe(2);
  });

  it("0 を選ぶと破棄されず、conditional_result の後続ステップはスキップされる（「そうしたとき」ゲート）", () => {
    const after = resolveWith(generate(3), 0);
    expect(after.setBurstStates).toHaveLength(3);
    expect(alice(after).reserveNormalCoreCount).toBe(10);
    expect(alice(after).voidNormalCoreCount).toBe(0);
  });

  it("範囲外 (4) はエラー", () => {
    const gen = generate(3);
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestCardDefinitionById,
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_discard_set_burst_count"
    )!;
    expect(() =>
      applyLegalAction({
        state: gen,
        action,
        getCardDefinitionById: getTestCardDefinitionById,
        discardSetBurstCountSelection: 4,
      })
    ).toThrow();
  });
});
