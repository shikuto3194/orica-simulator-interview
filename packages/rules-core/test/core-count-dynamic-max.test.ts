/**
 * Count 範囲境界の DynamicCount 解決テスト。
 *
 * core_move の amount が {min, max} 範囲で、境界 (ここでは max) が DynamicCount の
 * とき、盤面で評価してから pendingCoreCountSelection の上限に反映する。
 * 「自分のカウント2につき1個まで」= max:{source:count_value, divisor:2}（端数切捨）
 * を表現する（BSSL01-C05 / BSTS01-X01 系統の動的*上限*レンジ）。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createEmptyGameState } from "../src/factories";
import type { GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

/** 相手ライフのコアを「自分のカウント2につき1個まで」ボイドへ。 */
function lifeToVoidUpToHalfCount(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "life", player: "opponent" },
          to: { kind: "void", player: "opponent" },
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

function stateWith(countValue: number, bobLife: number): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      { countValue },
      { lifeNormalCoreCount: bobLife, voidNormalCoreCount: 0 },
    ],
  });
}

function generate(countValue: number, bobLife: number): GameState {
  return executeEffect({
    chainId: "test:core-count-dynamic-max:52",
    state: stateWith(countValue, bobLife),
    effect: lifeToVoidUpToHalfCount(),
    sourceInstanceId: "s1",
    actingPlayerId: ALICE,
    getCardDefinitionById: () => undefined,
  });
}

describe("Count 範囲境界の動的解決 (max = floor(count/2))", () => {
  it("カウント5 → max=floor(5/2)=2 の pending を生成", () => {
    const gen = generate(5, 5);
    expect(gen.pendingCoreCountSelection).not.toBeNull();
    expect(gen.pendingCoreCountSelection!.min).toBe(0);
    expect(gen.pendingCoreCountSelection!.max).toBe(2);
  });

  it("カウント7 → max=floor(7/2)=3 の pending を生成", () => {
    const gen = generate(7, 5);
    expect(gen.pendingCoreCountSelection!.max).toBe(3);
  });

  it("カウント1 → max=floor(1/2)=0、min=0 で選択余地なし → noop (pending 無し)", () => {
    const gen = generate(1, 5);
    expect(gen.pendingCoreCountSelection).toBeNull();
    // 盤面未変化（0 個移動）
    const bob = gen.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(5);
    expect(bob.voidNormalCoreCount).toBe(0);
  });

  it("動的 max が available を上回るときは available に丸める", () => {
    // カウント10 → floor=5 だが相手ライフは1 → max=1
    const gen = generate(10, 1);
    expect(gen.pendingCoreCountSelection).not.toBeNull();
    expect(gen.pendingCoreCountSelection!.max).toBe(1);
  });
});
