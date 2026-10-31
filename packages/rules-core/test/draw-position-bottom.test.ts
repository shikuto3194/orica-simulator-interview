/**
 * draw アクションの position オプション（"top" | "bottom"）を検証する。
 *
 * デッキは cardInstances の配列順で 先頭 = top / 末尾 = bottom（move_card の
 * deck 位置規約と同一）。"bottom" 指定時は末尾 N 枚を引く。
 *
 * 正源カード:
 * - BSES01-C05「デッキの下から1枚ドロー」
 * - BSKB01-R02「デッキの下から2枚ドロー」
 * - BSSA01-C01「デッキの下から1枚ドロー」
 * - BSLH01-TR02(A)「デッキの下から2枚ドロー」
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

function getCardDef(_id: string): CardDefinition | undefined {
  return dummyDef();
}

/** deck-0 (top) .. deck-(n-1) (bottom) を ALICE のデッキに並べた state を作る。 */
function makeStateWithDeck(cardCount: number): GameState {
  const state = createEmptyGameState({
    playerOverrides: [{ deckCount: cardCount, handCount: 0 }, {}],
  });
  const deckCards = Array.from({ length: cardCount }, (_, i) =>
    createCardInstance(dummyDef({ cardNo: `DECK-${i}` }), {
      instanceId: `deck-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  return {
    ...state,
    cardInstances: [...state.cardInstances, ...deckCards],
  };
}

function drawEffect(count: number, position?: "top" | "bottom"): Effect {
  return {
    timing: { kind: "card_event", event: "summon" },
    steps: [
      { action: { kind: "draw", count, ...(position ? { position } : {}) } },
    ],
  } as Effect;
}

function runDraw(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:draw-position-bottom:73",
    state,
    effect,
    effectIndex: 0,
    sourceInstanceId: "deck-0",
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

function zoneOf(state: GameState, id: string): string {
  return state.cardInstances.find((c) => c.instanceId === id)!.zone;
}

describe("draw position", () => {
  it('"bottom" は末尾 N 枚を手札に引く（デッキの下から）', () => {
    const state = makeStateWithDeck(5); // deck-0(top) .. deck-4(bottom)
    const next = runDraw(state, drawEffect(2, "bottom"));

    // 下から 2 枚 = deck-4, deck-3 が手札へ
    expect(zoneOf(next, "deck-4")).toBe("hand");
    expect(zoneOf(next, "deck-3")).toBe("hand");
    // 残りはデッキに留まる
    expect(zoneOf(next, "deck-0")).toBe("deck");
    expect(zoneOf(next, "deck-1")).toBe("deck");
    expect(zoneOf(next, "deck-2")).toBe("deck");

    const alice = next.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(3);
    expect(alice.handCount).toBe(2);
  });

  it('省略時（"top"）は先頭から引く（既存挙動）', () => {
    const state = makeStateWithDeck(5);
    const next = runDraw(state, drawEffect(1));

    expect(zoneOf(next, "deck-0")).toBe("hand");
    expect(zoneOf(next, "deck-4")).toBe("deck");

    const alice = next.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(4);
    expect(alice.handCount).toBe(1);
  });

  it('"bottom" は count がデッキ枚数を超えても全枚数で頭打ち', () => {
    const state = makeStateWithDeck(2);
    const next = runDraw(state, drawEffect(5, "bottom"));

    expect(zoneOf(next, "deck-0")).toBe("hand");
    expect(zoneOf(next, "deck-1")).toBe("hand");
    const alice = next.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(0);
    expect(alice.handCount).toBe(2);
  });
});
