/**
 * DynamicCount.subtract（差分減算ソース）の解決テスト。
 *
 * 「自分の手札が相手と同じ枚数になるようデッキの上からドローする」(BSTH08-R01) を
 * 相手手札 − 自分手札（負なら 0）で表現する。`source` と `subtract` は同じ
 * `DynamicCountSource` 集計ロジック（resolveSourceCount, SSOT）を共用する。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

/** フィルター不要のバニラ札（zone カウント専用なので最小定義で十分）。 */
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

/** 自分の手札が相手と同じ枚数になるようドロー（相手手札 − 自分手札、負なら 0）。 */
function drawToMatchOpponentHand(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "draw",
          count: {
            source: { kind: "cards_in_zone", zone: "hand", player: "opponent" },
            subtract: { kind: "cards_in_zone", zone: "hand", player: "self" },
          },
        },
      },
    ],
  };
}

function instances(
  playerId: string,
  zone: "hand" | "deck",
  n: number,
  startIndex: number
): CardInstance[] {
  return Array.from({ length: n }, (_, i) =>
    createCardInstance(VANILLA, {
      instanceId: `${playerId}-${zone}-${startIndex + i}`,
      ownerPlayerId: playerId,
      zone,
    })
  );
}

function stateWith(opts: {
  aliceHand: number;
  aliceDeck: number;
  bobHand: number;
}): GameState {
  const cardInstances: CardInstance[] = [
    ...instances(ALICE, "hand", opts.aliceHand, 0),
    ...instances(ALICE, "deck", opts.aliceDeck, 0),
    ...instances(BOB, "hand", opts.bobHand, 0),
  ];
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [
      { handCount: opts.aliceHand, deckCount: opts.aliceDeck },
      { handCount: opts.bobHand, deckCount: 40 },
    ],
  });
}

function run(state: GameState): GameState {
  return executeEffect({
    chainId: "test:draw-count-dynamic-subtract:87",
    state,
    effect: drawToMatchOpponentHand(),
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

describe("DynamicCount.subtract — 差分ドロー（相手手札 − 自分手札）", () => {
  it("自分1枚・相手4枚 → 3枚ドローして手札4枚（相手と同数）", () => {
    const after = run(stateWith({ aliceHand: 1, aliceDeck: 10, bobHand: 4 }));
    expect(aliceHandCount(after)).toBe(4);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(4);
    expect(alice.deckCount).toBe(7);
  });

  it("自分5枚・相手2枚 → 差分が負なので0枚（捨てない・手札5枚のまま）", () => {
    const after = run(stateWith({ aliceHand: 5, aliceDeck: 10, bobHand: 2 }));
    expect(aliceHandCount(after)).toBe(5);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(5);
    expect(alice.deckCount).toBe(10);
  });

  it("既に同数（自分3・相手3）→ 0枚ドロー", () => {
    const after = run(stateWith({ aliceHand: 3, aliceDeck: 10, bobHand: 3 }));
    expect(aliceHandCount(after)).toBe(3);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(10);
  });
});
