/**
 * BSTH02.7-C03「輪廻の西蔵人形」 effects[1] shape 検証。
 *
 * 原文 (Lv2-Lv3): 「自分の手札が5枚以下の間、自分の手札/手元は相手の効果を受けない。」
 *
 * effect_immunity(target.zone:["hand","set_aside"]) = ゾーン単位免疫の初出primitive
 * (ENGINE-effect-immunity-hand-zone-scope)。従来 collectTargetCardCandidates /
 * dynamicTargetFilterFromEffectTarget / matchesEffectResistanceFilter は field 固定
 * だったため、「手札ゾーン全体に相手効果耐性を張る機構が無い」(BSDB01-C06 / BSRK01-C02
 * 旧 stub note) として複数カードが未実装のまま残っていた。本カードで zone を
 * EffectTarget / ContinuousEffect.targetFilter に伝播する汎用経路を実装する。
 *
 * per-instance snapshot CE ではなく global CE (targetFilter) を使う理由:
 * recomputeContinuousEffects (legal-actions-shared.ts) は「targetInstanceId 付き CE は
 * 対象カードが zone!=="field" になったら除去する」規約を持つため、手札/手元カードへ
 * targetInstanceId 付き CE を登録した瞬間に次の recompute で消えてしまう。
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
    chainId: "test:bsth02-7-c03-hand-zone-immunity:39",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH02.7-C03 輪廻の西蔵人形 effects[1] shape", () => {
  const card = cardNoMap.get("BSTH02.7-C03")!;
  const effect = card.effects![1]!;

  it("Lv2以上 + 手札5枚以下 condition、stub 解消済み", () => {
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "hand_count", player: "self", max: 5 },
    ]);
    expect(effect.stub).toBeUndefined();
  });

  it("steps[0] = effect_immunity(target.zone:[hand,set_aside], count:all, while_on_field)", () => {
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand", "set_aside"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });
});

describe("BSTH02.7-C03 効果実行後の盤面変化 (手札/手元ゾーン免疫)", () => {
  const card = cardNoMap.get("BSTH02.7-C03")!;
  const effect = card.effects![1]!;

  function setUp(handCount: number, requiredCores: number) {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "nishikura-1",
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
    const setAsideCard = createCardInstance(card, {
      instanceId: "alice-setaside-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
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
      cardInstances: [self, handCard, setAsideCard, fieldOther],
    };
    const next = runEffect(state, effect, "nishikura-1", "alice");
    return {
      state: next,
      handCard: next.cardInstances.find(
        (c) => c.instanceId === "alice-hand-1"
      )!,
      setAsideCard: next.cardInstances.find(
        (c) => c.instanceId === "alice-setaside-1"
      )!,
      fieldOther: next.cardInstances.find(
        (c) => c.instanceId === "alice-field-other"
      )!,
    };
  }

  it("Lv2 + 手札5枚以下: 手札/手元カードは相手起因効果に免疫成立", () => {
    const { state, handCard, setAsideCard } = setUp(5, 2);
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
    expect(
      isCardImmuneToOpponentEffect(
        state,
        setAsideCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("フィールドの別カードはゾーン対象外のため免疫不成立", () => {
    const { state, fieldOther } = setUp(5, 2);
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

  it("手札6枚 (hand_count条件不成立): 免疫は登録されない", () => {
    const { state, handCard } = setUp(6, 2);
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
    const { state, handCard } = setUp(5, 1);
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
    const { state, handCard } = setUp(5, 2);
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
