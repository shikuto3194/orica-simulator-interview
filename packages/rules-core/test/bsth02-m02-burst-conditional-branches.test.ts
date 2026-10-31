/**
 * BSTH02-M02「[妖々夢]アリス・マーガトロイド」effects[0] バースト条件分岐検証。
 *
 * 原文 textLines[0,1]:
 *   【バースト：相手の効果によって相手の手札が増えた後】
 *   相手の手札が6枚以上のとき、相手は手札をすべて破棄し、2枚ドローする。
 *   5枚以下のとき、自分はデッキから3枚ドローする。この効果で相手の効果は発揮されない。
 *   その後、このカードをコストを支払わずに召喚する。
 *
 * 検証:
 *   - shape: timing.burst + 6 step (discardAll / opp draw 2 / self draw 3 / negate(effect) /
 *     negate(opponent_burst) / self summon free) と stepCondition の極性 (ref_count
 *     discardAll min:1 for opp draw, 同 not:true for self draw)。
 *   - Branch A (opp hand=6): discard で opp 手札 0、opp が 2 ドロー、self は 3 ドローしない。
 *     最終 summon は target:self + costModifier:"free" で alice-m02 自身が field へ。
 *   - Branch B (opp hand=5): self が 3 ドロー、opp 手札は維持、alice-m02 が field へ。
 *
 * 「この効果で相手の効果は発揮されない」= needs-ruling.jsonl (BSTH03-M07,BSTH02-M02, 裁定B
 * 確定 2026-07-26) で対象読みは確定。追加補足で「バーストに限らない通常の誘発効果も含む」
 * (相手側反応が非バースト誘発効果でもバーストでも両方止める) と明記されている。
 * causedByThisEffect で直接誘発した反応だけを抑止する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState, PlayerState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function setupBurstScene(opts: { opponentHandCount: number }): {
  state: GameState;
  selfInstanceId: string;
} {
  const card = cardNoMap.get("BSTH02-M02")!;
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  // alice-m02 is the burst card being self-summoned. For unit testing the
  // executeEffect path it lives in hand (the summon step target:self pulls
  // by sourceInstanceId, not by hand search).
  const selfBurst = createCardInstance(card, {
    instanceId: "alice-m02",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const oppHand: ReturnType<typeof createCardInstance>[] = [];
  for (let i = 0; i < opts.opponentHandCount; i++) {
    oppHand.push(
      createCardInstance(card, {
        instanceId: `bob-h-${i}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "hand",
      })
    );
  }
  // give both players a deck of dummy cards so draw 2/3 has cards to pull
  const aliceDeck: ReturnType<typeof createCardInstance>[] = [];
  for (let i = 0; i < 10; i++) {
    aliceDeck.push(
      createCardInstance(card, {
        instanceId: `alice-d-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
  }
  const bobDeck: ReturnType<typeof createCardInstance>[] = [];
  for (let i = 0; i < 10; i++) {
    bobDeck.push(
      createCardInstance(card, {
        instanceId: `bob-d-${i}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      })
    );
  }
  const state: GameState = {
    ...base,
    activePlayerId: BOB,
    step: "attack",
    cardInstances: [selfBurst, ...oppHand, ...aliceDeck, ...bobDeck],
    players: base.players.map((p) => ({
      ...p,
      handCount: p.id === BOB ? opts.opponentHandCount : 1,
      deckCount: 10,
    })),
  };
  return { state, selfInstanceId: "alice-m02" };
}

function runBurst(state: GameState, sourceId: string): GameState {
  const card = cardNoMap.get("BSTH02-M02")!;
  return executeEffect({
    chainId: "test:bsth02-m02-burst-conditional-branches:109",
    state,
    effect: card.effects![0]!,
    sourceInstanceId: sourceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  });
}

describe("BSTH02-M02 effects[0] shape (burst 条件分岐)", () => {
  const card = cardNoMap.get("BSTH02-M02")!;
  const effect = card.effects![0]!;
  it("timing.burst hand_increase opponent + cause:self_effect", () => {
    expect(effect.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "hand_increase", player: "opponent" },
      cause: ["self_effect"],
    });
  });

  it("steps: discardAll / opp draw 2 / self draw 3 / negate(effect) / negate(opponent_burst) / self summon free", () => {
    expect(effect.steps).toHaveLength(6);

    const s0 = effect.steps[0]!;
    expect(s0.id).toBe("discardAll");
    expect(s0.action.kind).toBe("discard");
    if (s0.action.kind === "discard") {
      expect(s0.action.player).toBe("opponent");
      expect(s0.action.count).toBe(-1);
    }
    expect(s0.condition).toEqual([
      { kind: "hand_count", player: "opponent", min: 6 },
    ]);

    const s1 = effect.steps[1]!;
    expect(s1.action.kind).toBe("draw");
    if (s1.action.kind === "draw") {
      expect(s1.action.player).toBe("opponent");
      expect(s1.action.count).toBe(2);
    }
    // ref_count min:1 = 実際に 1 枚以上 trash に行ったとき (prevent_hand_discard で
    // 0 枚化したケースを除外)。
    expect(s1.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "discardAll",
      min: 1,
    });
    expect(s1.connector).toBe("conditional_result");

    const s2 = effect.steps[2]!;
    expect(s2.action.kind).toBe("draw");
    if (s2.action.kind === "draw") {
      // self draw: player 省略 = self
      expect(s2.action.player).toBeUndefined();
      expect(s2.action.count).toBe(3);
    }
    expect(s2.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "discardAll",
      min: 1,
      not: true,
    });

    const s3 = effect.steps[3]!;
    expect(s3.action.kind).toBe("negate");
    if (s3.action.kind === "negate") {
      expect(s3.action.negateTarget).toBe("effect");
      expect(s3.action.targetController).toBe("opponent");
      expect(s3.action.causedByThisEffect).toBe(true);
    }

    const s4 = effect.steps[4]!;
    expect(s4.action.kind).toBe("negate");
    if (s4.action.kind === "negate") {
      expect(s4.action.negateTarget).toBe("opponent_burst");
      expect(s4.action.causedByThisEffect).toBe(true);
    }

    const s5 = effect.steps[5]!;
    expect(s5.action.kind).toBe("summon");
    if (s5.action.kind === "summon") {
      expect(s5.action.target).toEqual({ kind: "self" });
      expect(s5.action.costModifier).toBe("free");
    }
  });

  it("stub は解消済み", () => {
    expect(effect.stub).toBeUndefined();
  });
});

describe("BSTH02-M02 effects[0] 条件分岐実行", () => {
  it("opp hand=6 (Branch A): opp 手札全破棄+2 ドロー、self はドローしない", () => {
    const { state, selfInstanceId } = setupBurstScene({ opponentHandCount: 6 });
    const next = runBurst(state, selfInstanceId);
    const opp = getPlayer(next, BOB);
    const me = getPlayer(next, ALICE);
    // discard で元の 6 枚は trash へ、その後 2 ドローで opp 手札 2 枚
    expect(opp.handCount).toBe(2);
    // self は元の 1 (burst card) - 1 (summon で hand→field) = 0、3 ドローは発火しない
    expect(me.handCount).toBe(0);
    // 元の opp 手札 6 枚は全て trash
    for (let i = 0; i < 6; i++) {
      const card = next.cardInstances.find(
        (c) => c.instanceId === `bob-h-${i}`
      )!;
      expect(card.zone).toBe("trash");
    }
    // alice-m02 は field へ (target:self + costModifier:free)
    const burstCard = next.cardInstances.find(
      (c) => c.instanceId === "alice-m02"
    )!;
    expect(burstCard.zone).toBe("field");
    expect(next.pendingStackNegateRequests).toEqual([]);
  });

  it("opp hand=5 (Branch B): self が 3 ドロー、opp 手札は維持", () => {
    const { state, selfInstanceId } = setupBurstScene({ opponentHandCount: 5 });
    const next = runBurst(state, selfInstanceId);
    const opp = getPlayer(next, BOB);
    const me = getPlayer(next, ALICE);
    // opp 手札維持 (Branch A 不発火)
    expect(opp.handCount).toBe(5);
    // self: 元の 1 (burst card) + 3 ドロー - 1 (summon で hand→field) = 3
    expect(me.handCount).toBe(3);
    // 元の opp 手札は trash に行っていない
    for (let i = 0; i < 5; i++) {
      const card = next.cardInstances.find(
        (c) => c.instanceId === `bob-h-${i}`
      )!;
      expect(card.zone).toBe("hand");
    }
    // alice-m02 は field へ (target:self + costModifier:free)
    const burstCard = next.cardInstances.find(
      (c) => c.instanceId === "alice-m02"
    )!;
    expect(burstCard.zone).toBe("field");
  });
});
