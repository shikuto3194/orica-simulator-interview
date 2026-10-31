/**
 * BSTH03-C31「永遠亭」 effects[3] shape 検証。
 *
 * 原文 (Lv2): 「自分の手札は、6枚以下の間、相手の効果を受けない。」
 *
 * effect_immunity(target.zone:["hand"]) + hand_count 条件付きゾーン免疫は
 * BSDB01-C06 / BSTH02.7-C03 / BSGE01-C04 と同型 (ENGINE-effect-immunity-hand-zone-scope
 * 既存 primitive 流用)。旧 stub note「手札枚数条件付き効果免疫はDSL未対応」は stale で、
 * 実際には hand_count ConditionClause + effect_immunity action で表現済み。
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

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth03-c31-hand-zone-immunity:32",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH03-C31 永遠亭 effects[3] shape", () => {
  const card = cardNoMap.get("BSTH03-C31")!;
  const effect = card.effects![3]!;

  it("Lv2以上 + 手札6枚以下 condition、stub 解消済み", () => {
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "hand_count", player: "self", max: 6 },
    ]);
    expect(effect.stub).toBeUndefined();
  });

  it("steps[0] = effect_immunity(target.zone:[hand], count:all, while_on_field)", () => {
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });
});

describe("BSTH03-C31 効果実行後の盤面変化 (手札ゾーン免疫)", () => {
  const card = cardNoMap.get("BSTH03-C31")!;
  const effect = card.effects![3]!;

  function setUp(handCount: number, requiredCores: number) {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "eirentei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: requiredCores,
    });
    const handCard = createCardInstance(card, {
      instanceId: "alice-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const fieldOther = createCardInstance(card, {
      instanceId: "alice-field-other",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      cardInstances: [self, handCard, fieldOther],
    };
    const next = runEffect(state, effect, "eirentei-1", "alice");
    return {
      state: next,
      handCard: next.cardInstances.find(
        (c) => c.instanceId === "alice-hand-1"
      )!,
      fieldOther: next.cardInstances.find(
        (c) => c.instanceId === "alice-field-other"
      )!,
    };
  }

  it("Lv2 + 手札6枚以下: 手札カードは相手起因効果に免疫成立", () => {
    const { state, handCard } = setUp(6, 1);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("フィールドの別カードはゾーン対象外のため免疫不成立", () => {
    const { state, fieldOther } = setUp(6, 1);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        fieldOther,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("手札7枚 (hand_count条件不成立): 免疫は登録されない", () => {
    const { state, handCard } = setUp(7, 1);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("Lv1 (min_level条件不成立): 免疫は登録されない", () => {
    const { state, handCard } = setUp(6, 0);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("自分起因効果は immunityPlayerScope 省略時 (opponent限定) のため防がれない", () => {
    const { state, handCard } = setUp(6, 1);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "alice",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});
