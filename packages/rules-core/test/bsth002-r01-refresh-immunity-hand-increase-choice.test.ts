/**
 * BSTH002-R01「明羅」effects[1,2] stub 解消検証。
 *
 * カード本文 (textLines[3,4]):
 * - Lv1-Lv2-Lv3『相手のターン』
 *   回復状態のこのスピリットは、相手のスピリット/ネクサスの効果を受けない。
 *   相手の効果で相手の手札が増えたとき、自分はデッキの上から1枚ドローするか、
 *   ボイドからコア1個を自分のリザーブに置く。
 *
 * effects[1]: self_state:"recovered" + turn_player:"opponent" condition で
 *   継続 effect_immunity(sourceScope:categories:[spirit,nexus]) を登録する
 *   (BSTH02-R02/R03 と同型の continuous+condition パターン)。
 * effects[2]: game_event:increase_hand(相手, cause:self_effect) + turn_player:opponent
 *   条件でトリガーする draw/core_move choice (BSTH002-C05 / BSSA01.ts[9] と同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

const R01 = cardNoMap.get("BSTH002-R01")!;
const IMMUNITY_EFFECT = R01.effects![1]!;
const HAND_INCREASE_EFFECT = R01.effects![2]!;

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string,
  eventAmount?: number
) {
  return executeEffect({
    chainId: "test:bsth002-r01-refresh-immunity-hand-increase-choice:45",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
    eventAmount,
  });
}

describe("BSTH002-R01 effects[1] shape (回復状態＋相手ターン限定の相手スピ/ネクサス耐性)", () => {
  it("stub 解消済み、continuous + self_state:recovered + turn_player:opponent", () => {
    expect(IMMUNITY_EFFECT.stub).toBeUndefined();
    expect(IMMUNITY_EFFECT.timing).toEqual({ kind: "continuous" });
    expect(IMMUNITY_EFFECT.condition).toEqual([
      { kind: "self_state", state: "recovered" },
      { kind: "turn_player", player: "opponent" },
    ]);
  });

  it("steps[0] = effect_immunity(target:self, sourceScope:categories:[spirit,nexus], while_on_field)", () => {
    expect(IMMUNITY_EFFECT.steps).toHaveLength(1);
    const action = IMMUNITY_EFFECT.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.duration).toEqual({ scope: "while_on_field" });
      expect(action.sourceScope).toEqual({ categories: ["spirit", "nexus"] });
    }
  });
});

describe("BSTH002-R01 effects[1] 盤面変化 (回復状態＋相手ターンだけ免疫成立)", () => {
  function setUp(opts: {
    exhaustState: "recovered" | "exhausted";
    activePlayerId: string;
  }) {
    const self = createCardInstance(R01, {
      instanceId: "akira-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: opts.exhaustState,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [self],
      activePlayerId: opts.activePlayerId,
    };
    return runEffect(state, IMMUNITY_EFFECT, "akira-1", ALICE);
  }

  // effectSource は「発生源カードがスピリット/ネクサスか」の sourceScope.categories 照合に
  // 必要 (省略時は fail-closed で常に false、BSTH02-R03 の burst 系テストと同型)。
  // R01 自身が printedCategory:"spirit" なので、そのまま発生源定義として使い回す。
  const opponentSpiritSource = { definition: R01 };

  it("回復状態 ∧ 相手ターン: 相手スピリット効果への免疫成立", () => {
    const state = setUp({ exhaustState: "recovered", activePlayerId: BOB });
    const target = state.cardInstances.find((c) => c.instanceId === "akira-1")!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        BOB,
        "none",
        opponentSpiritSource,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("疲労状態 ∧ 相手ターン: 免疫不成立 (self_state条件不成立)", () => {
    const state = setUp({ exhaustState: "exhausted", activePlayerId: BOB });
    const target = state.cardInstances.find((c) => c.instanceId === "akira-1")!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        BOB,
        "none",
        opponentSpiritSource,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("回復状態 ∧ 自分のターン: 免疫不成立 (turn_player条件不成立)", () => {
    const state = setUp({ exhaustState: "recovered", activePlayerId: ALICE });
    const target = state.cardInstances.find((c) => c.instanceId === "akira-1")!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        BOB,
        "none",
        opponentSpiritSource,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("BSTH002-R01 effects[2] shape (相手手札増加時 draw/core_move choice)", () => {
  it("stub 解消済み、game_event:increase_hand(相手, cause:self_effect) + turn_player:opponent + mandatory", () => {
    expect(HAND_INCREASE_EFFECT.stub).toBeUndefined();
    expect(HAND_INCREASE_EFFECT.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "increase_hand",
      cause: ["self_effect"],
    });
    expect(HAND_INCREASE_EFFECT.condition).toEqual([
      { kind: "turn_player", player: "opponent" },
    ]);
    expect(HAND_INCREASE_EFFECT.executionMode).toBe("mandatory");
  });

  it("steps[0] = draw(self,1) + choice[0]=core_move(void→reserve, amount:1)", () => {
    expect(HAND_INCREASE_EFFECT.steps).toHaveLength(1);
    const step = HAND_INCREASE_EFFECT.steps[0]!;
    expect(step.action).toEqual({ kind: "draw", player: "self", count: 1 });
    expect(step.choice).toEqual([
      {
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "reserve", player: "self" },
          amount: 1,
        },
      },
    ]);
  });
});

describe("BSTH002-R01 effects[2] 盤面変化 (executeEffect 直接実行、choiceIndex 未指定=デフォルトdraw)", () => {
  it("相手のターンにトリガー成立 → デフォルト action (draw) がそのまま1枚ドローされる", () => {
    const self = createCardInstance(R01, {
      instanceId: "akira-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const deckCard = createCardInstance(R01, {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [self, deckCard],
      activePlayerId: BOB,
    };

    const after = runEffect(state, HAND_INCREASE_EFFECT, "akira-1", ALICE, 1);

    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-deck-1")?.zone
    ).toBe("hand");
  });
});
