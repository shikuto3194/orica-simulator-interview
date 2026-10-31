/**
 * 単一対象コアシュート: `core_move.target` で相手スピリット/アルティメット1体を選び、
 * `from: { kind: "target_card" }` でその1体のコアのみを源にする。
 *
 * 範囲 `amount: { min, max }` のとき、選んだ対象1体のコンテナを源として
 * pendingCoreCountSelection（プレイヤーが移動コア数を選択）を生成する。
 * BSSL01-C05【合体中】『アタック時』「相手のスピリット/アルティメット1体のコアを、
 * 自分のカウント2につき1個までリザーブに置ける」型。
 *
 * フィールド全体コアシュート（from: field）と異なり、コアは1体からのみ取る。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const SOURCE_DEF: CardDefinition = {
  cardNo: "TEST-SRC",
  name: "テスト源",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const TARGET_DEF: CardDefinition = {
  cardNo: "TEST-TGT",
  name: "テスト対象",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

/** 相手スピリット1体のコアを「自分のカウント2につき1個まで」相手リザーブへ。 */
function singleTargetCoreshootUpToHalfCount(): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          target: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit", "ultimate"] },
            count: 1,
          },
          from: { kind: "target_card" },
          to: { kind: "reserve", player: "opponent" },
          amount: {
            min: 0,
            max: {
              source: { kind: "count_value", player: "self" },
              divisor: 2,
            },
          },
        },
      },
    ],
  };
}

function stateWith(countValue: number, targetCores: number): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(SOURCE_DEF, {
        instanceId: "alice-src",
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(TARGET_DEF, {
        instanceId: "bob-tgt",
        ownerPlayerId: BOB,
        zone: "field",
        cores: targetCores,
      }),
    ],
    playerOverrides: [{ countValue }, { reserveNormalCoreCount: 0 }],
  });
}

function run(countValue: number, targetCores: number): GameState {
  return executeEffect({
    chainId: "test:single-target-coreshoot:109",
    state: stateWith(countValue, targetCores),
    effect: singleTargetCoreshootUpToHalfCount(),
    sourceInstanceId: "alice-src",
    actingPlayerId: ALICE,
    getCardDefinitionById: (id) =>
      id === SOURCE_DEF.cardNo
        ? SOURCE_DEF
        : id === TARGET_DEF.cardNo
          ? TARGET_DEF
          : undefined,
    targetInstanceIds: ["bob-tgt"],
  });
}

describe("単一対象コアシュート (core_move.target + from: target_card)", () => {
  it("カウント5・対象コア3 → max=floor(5/2)=2 の pending を選んだ1体に対して生成", () => {
    const gen = run(5, 3);
    expect(gen.pendingCoreCountSelection).not.toBeNull();
    expect(gen.pendingCoreCountSelection!.min).toBe(0);
    expect(gen.pendingCoreCountSelection!.max).toBe(2);
    // 源は選択した対象1体に束ねた card_instance ロケーション。
    expect(gen.pendingCoreCountSelection!.fromLocation).toEqual({
      kind: "card_instance",
      instanceId: "bob-tgt",
    });
  });

  it("動的 max が対象の保有コアを上回るときは保有コアに丸める", () => {
    // カウント10 → floor=5 だが対象コアは3 → max=3
    const gen = run(10, 3);
    expect(gen.pendingCoreCountSelection!.max).toBe(3);
  });

  it("カウント1 → max=floor(1/2)=0 → 選択余地なし → noop (pending 無し・盤面不変)", () => {
    const gen = run(1, 3);
    expect(gen.pendingCoreCountSelection).toBeNull();
    const tgt = gen.cardInstances.find((c) => c.instanceId === "bob-tgt")!;
    expect(tgt.normalCoreCount).toBe(3);
  });

  it("数選択を解決すると、選んだ1体のコアのみが相手リザーブへ移る", () => {
    const gen = run(5, 3); // max=2
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const action = actions.find((a) => a.kind === "resolve_pending_core_count");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: gen,
      action: action!,
      getCardDefinitionById: () => undefined,
      coreCountSelection: 2,
    }).state;
    expect(after.pendingCoreCountSelection).toBeNull();
    // 対象1体のコアが 3 → 1 に減り、相手リザーブに 2 個増えた。
    const tgt = after.cardInstances.find((c) => c.instanceId === "bob-tgt")!;
    expect(tgt.normalCoreCount).toBe(1);
    const bobPlayer = after.players.find((p) => p.id === BOB)!;
    expect(bobPlayer.reserveNormalCoreCount).toBe(2);
  });
});
