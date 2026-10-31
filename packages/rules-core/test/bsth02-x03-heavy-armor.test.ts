/**
 * BSTH02-X03『魂魄 妖夢』effects[1] 【超重装甲：紫/緑/白】shape 検証。
 *
 * 原文 textLines[2,3]:
 *   「このスピリットと系統：「幻想」を持つ自分のコスト6以上の紫のスピリットすべてに
 *    "【超重装甲：紫/緑/白】このスピリットは相手の紫/緑/白の効果を受けない。"を与える。」
 *
 * - 妖夢自身は colors=["white"] のため第 2 effect の filter (colors:["purple"]) に
 *   含まれない → effect_immunity target:self の独立 effect が必要。
 * - 第 2 effect は filter player:"self" / category:["spirit"] / tribes:["幻想"] /
 *   colors:["purple"] / minCost:6 / count:"all" / excludeSelf:true、sourceScope.colors=
 *   ["purple","green","white"]、duration:while_on_field。
 * - 配線方針は BSTH08-M01/M02 同型 (sourceScope.colors 一致時のみ免疫成立、
 *   [[project_immunity_source_scope_effective]] 発生源カード実効値で照合)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH02-X03 effects[1] 【超重装甲：紫/緑/白】 shape", () => {
  const card = cardNoMap.get("BSTH02-X03")!;
  const heavyArmorEffects = (card.effects ?? []).filter(
    (e) =>
      e.timing.kind === "continuous" &&
      Array.isArray(e.textRef) &&
      e.textRef.includes(2) &&
      e.textRef.includes(3)
  );

  it("textRef [2,3] の continuous 効果が 2 effect 構造 (self + filter) で全て stub 無し", () => {
    expect(heavyArmorEffects).toHaveLength(2);
    for (const eff of heavyArmorEffects) {
      expect(eff.stub).toBeUndefined();
      expect(eff.steps).toHaveLength(1);
      expect(eff.steps[0]!.action.kind).toBe("effect_immunity");
    }
  });

  it("effect A: target:self + sourceScope.colors=[purple,green,white] + while_on_field", () => {
    const selfEff = heavyArmorEffects.find((e) => {
      const a = e.steps[0]!.action;
      return a.kind === "effect_immunity" && a.target.kind === "self";
    });
    expect(selfEff).toBeDefined();
    const action = selfEff!.steps[0]!.action;
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.sourceScope?.colors).toEqual(["purple", "green", "white"]);
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("effect B: target:filter (own 幻想 purple spirit minCost:6 count:all excludeSelf) + sourceScope.colors", () => {
    const filterEff = heavyArmorEffects.find((e) => {
      const a = e.steps[0]!.action;
      return a.kind === "effect_immunity" && a.target.kind === "filter";
    });
    expect(filterEff).toBeDefined();
    const action = filterEff!.steps[0]!.action;
    if (action.kind === "effect_immunity" && action.target.kind === "filter") {
      expect(action.target.player).toBe("self");
      expect(action.target.count).toBe("all");
      expect(action.target.excludeSelf).toBe(true);
      expect(action.target.filter.category).toEqual(["spirit"]);
      expect(action.target.filter.tribes).toEqual(["幻想"]);
      expect(action.target.filter.colors).toEqual(["purple"]);
      expect(action.target.filter.minCost).toBe(6);
      expect(action.sourceScope?.colors).toEqual(["purple", "green", "white"]);
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("実盤面では本人と条件一致する味方だけが紫/緑/白発生源への耐性を得る", () => {
    const eligible: CardDefinition = {
      ...card,
      cardNo: "TEST-BSTH02-X03-FANTASY-PURPLE-6",
      name: "条件一致する紫の幻想スピリット",
      colors: ["purple"],
      cost: 6,
      tribe: "幻想",
      effects: [],
    };
    const tooLow: CardDefinition = {
      ...eligible,
      cardNo: "TEST-BSTH02-X03-FANTASY-PURPLE-5",
      name: "コスト不足の紫の幻想スピリット",
      cost: 5,
    };
    const definitions = new Map<string, CardDefinition>([
      ...ALL_CARDS.map((definition) => [definition.cardNo, definition]),
      [eligible.cardNo, eligible],
      [tooLow.cardNo, tooLow],
    ]);
    const instance = (definition: CardDefinition, instanceId: string) =>
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance(card, "youmu"),
        instance(eligible, "eligible"),
        instance(tooLow, "too-low"),
      ],
    });
    const state = heavyArmorEffects.reduce(
      (current, effect) =>
        executeEffect({
          chainId: "test:bsth02-x03-heavy-armor:122",
          state: current,
          effect,
          sourceInstanceId: "youmu",
          actingPlayerId: "alice",
          getCardDefinitionById: (cardNo) => definitions.get(cardNo),
        }),
      base
    );
    const defenseEffects = state.activeContinuousEffects.filter(
      (continuousEffect) =>
        continuousEffect.sourceInstanceId === "youmu" &&
        continuousEffect.modifierTag === "defense_immune"
    );
    expect(defenseEffects).toHaveLength(2);
    expect(
      defenseEffects.some(
        (continuousEffect) => continuousEffect.targetInstanceId === "youmu"
      )
    ).toBe(true);
    expect(
      defenseEffects.find((continuousEffect) => continuousEffect.targetFilter)
        ?.targetFilter
    ).toMatchObject({
      player: "self",
      category: ["spirit"],
      tribes: ["幻想"],
      colors: ["purple"],
      minCost: 6,
    });

    const purpleSource: CardDefinition = {
      ...eligible,
      cardNo: "TEST-BSTH02-X03-PURPLE-SOURCE",
      tribe: "",
    };
    const redSource: CardDefinition = {
      ...purpleSource,
      cardNo: "TEST-BSTH02-X03-RED-SOURCE",
      colors: ["red"],
    };
    const byId = new Map(
      state.cardInstances.map((item) => [item.instanceId, item])
    );
    expect(
      isCardImmuneToOpponentEffect(
        state,
        byId.get("youmu")!,
        "bob",
        "none",
        {
          definition: purpleSource,
        },
        (cardNo) => definitions.get(cardNo)
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        byId.get("eligible")!,
        "bob",
        "none",
        {
          definition: purpleSource,
        },
        (cardNo) => definitions.get(cardNo)
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        byId.get("too-low")!,
        "bob",
        "none",
        {
          definition: purpleSource,
        },
        (cardNo) => definitions.get(cardNo)
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        byId.get("eligible")!,
        "bob",
        "none",
        {
          definition: redSource,
        },
        (cardNo) => definitions.get(cardNo)
      )
    ).toBe(false);
  });
});
