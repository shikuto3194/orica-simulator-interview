/**
 * BSTH03-X04 藤原 妹紅 — Lv4-Lv5 attack, game once:
 * "自分のカウント1につき、相手のライフのコア1個をリザーブに置く。（最大3個）"
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";
const x04 = cardNoMap.get("BSTH03-X04")!;
const attackEffect = x04.effects!.find(
  (effect) =>
    effect.timing.kind === "card_event" && effect.timing.event === "attack"
)!;

function buildState(countValue: number): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      { countValue },
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
    ],
    cardInstances: [
      createCardInstance(x04, {
        instanceId: "mokou-x04",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      }),
    ],
  });
}

function resolveAttackEffect(countValue: number): GameState {
  return executeEffect({
    chainId: "test:bsth03-x04-dynamic-life-damage:45",
    state: buildState(countValue),
    effect: attackEffect,
    sourceInstanceId: "mokou-x04",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function player(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

describe("BSTH03-X04 藤原 妹紅 dynamic count life core move", () => {
  it("card-data: amount is self count_value capped at 3 and the effect is no longer stubbed", () => {
    expect(attackEffect.stub).toBeUndefined();
    const action = attackEffect.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind !== "core_move") return;
    expect(action.from).toEqual({ kind: "life", player: "opponent" });
    expect(action.to).toEqual({ kind: "reserve", player: "opponent" });
    expect(action.amount).toEqual({
      source: { kind: "count_value", player: "self" },
      cap: 3,
    });
  });

  it("count 2 moves exactly 2 opponent life cores to reserve", () => {
    const after = resolveAttackEffect(2);

    expect(player(after, BOB).lifeNormalCoreCount).toBe(3);
    expect(player(after, BOB).reserveNormalCoreCount).toBe(2);
  });

  it("count 5 is capped at 3 opponent life cores", () => {
    const after = resolveAttackEffect(5);

    expect(player(after, BOB).lifeNormalCoreCount).toBe(2);
    expect(player(after, BOB).reserveNormalCoreCount).toBe(3);
  });
});
