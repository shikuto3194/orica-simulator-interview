/**
 * BSTH05-C13 神籤「乱れおみくじ連続引き」effects[1] 「発動コストが手札すべて（最低1枚以上）破棄」
 * stub解消。
 *
 * 原文: 「自分は、手札すべて（最低1枚以上）を破棄することで、デッキの上から4枚ドローする。」
 * SSOT 流用: BSTH02-R01/R02/R03 effects[0] と同型の discard(cost) → conditional_cost
 * draw(payoff)。count:-1 (手札すべて) を discard に渡すことで「最低1枚以上」制約を
 * 新規primitive無しで表現する（手札0枚 = discard 候補0枚 = no-op = succeeded:false →
 * conditional_cost が draw をロールバック）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "player-1";
const FILLER = cardNoMap.get("BSFT01-C03")!; // tribe未指定の実在カード

const card = cardNoMap.get("BSTH05-C13")!;
const effect = card.effects![1]!;

function runEffect(state: GameState, sourceInstanceId: string): GameState {
  return executeEffect({
    chainId: "test:bsth05-c13-discard-all-cost-draw:29",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("BSTH05-C13 effects[1] shape (discard(全て)→conditional_cost draw)", () => {
  it("stub 解消済み、discard(count:-1, self) → conditional_cost draw(4枚)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.action).toEqual({
      kind: "discard",
      count: -1,
      player: "self",
    });
    expect(effect.steps[1]!.action).toEqual({ kind: "draw", count: 4 });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
  });
});

describe("BSTH05-C13 effects[1] 盤面変化", () => {
  it("手札3枚 → すべて破棄してトラッシュへ、デッキ上4枚ドロー", () => {
    const source = createCardInstance(card, {
      instanceId: "src-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const handCards = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `hand-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const deck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [source, ...handCards, ...deck],
      playerOverrides: [{ handCount: 3, deckCount: 4 }, {}],
    });
    const after = runEffect(before, "src-1");

    for (const h of handCards) {
      expect(
        after.cardInstances.find((c) => c.instanceId === h.instanceId)!.zone
      ).toBe("trash");
    }
    const drawnCount = after.log.filter((l) =>
      l.includes("effect:draw")
    ).length;
    expect(drawnCount).toBe(4);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
  });

  it("手札0枚 → discard 不成立 (最低1枚以上を満たさない)、conditional_cost で draw もロールバック", () => {
    const source = createCardInstance(card, {
      instanceId: "src-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const deck = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [source, ...deck],
      playerOverrides: [{ handCount: 0, deckCount: 4 }, {}],
    });
    const after = runEffect(before, "src-1");

    const drawnCount = after.log.filter((l) =>
      l.includes("effect:draw")
    ).length;
    expect(drawnCount).toBe(0);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(4);
  });
});
