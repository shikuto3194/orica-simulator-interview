/**
 * DrawAction.targetHandSize（「手札が N 枚になるまでドローする」）の解決テスト。
 *
 * BSLH01-C05『自分のエンドステップ』「自分は、自分の手札が5枚になるまでドローできる」を
 * 表現する。count を無視し max(0, targetHandSize - 現在の手札枚数) 枚を引く。
 * 従来の count: 5 - 手札枚数 近似は手札 > 5 のとき負数になり挙動が厳密でなかったため、
 * targetHandSize で不足分のみ引く（手札 >= N なら 0 枚）よう厳密化した。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const VANILLA: CardDefinition = {
  cardNo: "TEST-V",
  name: "テスト用バニラ",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

/** 手札が5枚になるまでドローする。 */
function drawToHandSize5(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "draw",
          count: 0,
          targetHandSize: 5,
        },
      },
    ],
  };
}

function instances(
  playerId: string,
  zone: "hand" | "deck",
  n: number
): CardInstance[] {
  return Array.from({ length: n }, (_, i) =>
    createCardInstance(VANILLA, {
      instanceId: `${playerId}-${zone}-${i}`,
      ownerPlayerId: playerId,
      zone,
    })
  );
}

function stateWith(aliceHand: number, aliceDeck: number): GameState {
  const cardInstances: CardInstance[] = [
    ...instances(ALICE, "hand", aliceHand),
    ...instances(ALICE, "deck", aliceDeck),
  ];
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [
      { handCount: aliceHand, deckCount: aliceDeck },
      { handCount: 0, deckCount: 40 },
    ],
  });
}

function run(state: GameState): GameState {
  return executeEffect({
    chainId: "test:draw-target-hand-size:79",
    state,
    effect: drawToHandSize5(),
    sourceInstanceId: ALICE + "-source",
    actingPlayerId: ALICE,
    getCardDefinitionById: () => VANILLA,
  });
}

function aliceHandCount(state: GameState): number {
  return state.cardInstances.filter(
    (c) => c.controllerPlayerId === ALICE && c.zone === "hand"
  ).length;
}

describe("DrawAction.targetHandSize — 手札が N 枚になるまでドロー", () => {
  it("手札2枚 → 3枚ドローして手札5枚", () => {
    const after = run(stateWith(2, 10));
    expect(aliceHandCount(after)).toBe(5);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(5);
    expect(alice.deckCount).toBe(7);
  });

  it("手札5枚（既に上限）→ 0枚ドロー", () => {
    const after = run(stateWith(5, 10));
    expect(aliceHandCount(after)).toBe(5);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(10);
  });

  it("手札7枚（上限超過）→ 0枚ドロー（捨てない・厳密化の要点）", () => {
    const after = run(stateWith(7, 10));
    expect(aliceHandCount(after)).toBe(7);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(10);
  });

  it("手札0枚・デッキ3枚 → デッキ枯渇まで3枚ドロー（手札3枚）", () => {
    const after = run(stateWith(0, 3));
    expect(aliceHandCount(after)).toBe(3);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
  });
});
