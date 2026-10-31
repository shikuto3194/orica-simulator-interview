/**
 * BSTH02.7-C02「紅毛の和蘭人形」 effects[1] shape 検証。
 *
 * 原文 (Lv3『自分のアタックステップ』): 「このスピリットは系統：「起幻」を持ち、
 * 相手のスピリット/アルティメット/ブレイヴ/ネクサス/スタックの効果を受けない。」
 *
 * SSOT: BSTH07.8-X01 effects[6,7] (「Lv2-Lv3『自分のアタックステップ』相手の
 * ネクサス/マジックの効果を受けない」= sourceScope.categories + timingScope:
 * {player:"self",period:"attack"}) と同型パターン。
 *
 * 系統付与は override_properties.addTribes (BSTH002-M01「系統：「幻想」/「封魔」を
 * 持つ」と同型)。
 *
 * 「スタック」発動効果からの免疫 (カテゴリ非依存) は immunitySourceScope.activatedTimings
 * 軸 (ENGINE-immunity-source-activation-timing) で表現。spirit/ultimate/brave/nexus の
 * 4 カテゴリ免疫と OR 結合 (`immunitySourceMatches`)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveTribes,
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
    chainId: "test:bsth02-7-c02-attack-step-immunity:40",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH02.7-C02 紅毛の和蘭人形 effects[1] shape", () => {
  const card = cardNoMap.get("BSTH02.7-C02")!;
  const effect = card.effects![1]!;

  it("Lv3 条件 + 自分のアタックステップ限定 timingScope", () => {
    expect(effect.condition).toEqual([{ kind: "min_level", value: 3 }]);
    expect(effect.timingScope).toEqual({ player: "self", period: "attack" });
    expect(effect.stub).toBeUndefined();
  });

  it("steps[0] = override_properties addTribes:[起幻] (self / while_on_field)", () => {
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("override_properties");
    if (action.kind === "override_properties") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.properties).toEqual({ addTribes: ["起幻"] });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("steps[1] = effect_immunity self, sourceScope.categories=[spirit,ultimate,brave,nexus]", () => {
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[1]!.connector).toBe("simultaneous");
    const action = effect.steps[1]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.sourceScope).toEqual({
        categories: ["spirit", "ultimate", "brave", "nexus"],
        activatedTimings: ["stack"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });
});

describe("BSTH02.7-C02 効果実行後の盤面変化 (Lv3 自分のアタックステップ)", () => {
  const card = cardNoMap.get("BSTH02.7-C02")!;
  const effect = card.effects![1]!;

  function setUp(step: "attack" | "main", activePlayerId: "alice" | "bob") {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "oranda-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv3 (requiredCores:3)
    });
    const state: GameState = {
      ...base,
      activePlayerId,
      step,
      cardInstances: [self],
    };
    const next = runEffect(state, effect, "oranda-1", "alice");
    const target = next.cardInstances.find((c) => c.instanceId === "oranda-1")!;
    return { state: next, target };
  }

  it("系統「起幻」が実効系統に加算される", () => {
    const { state, target } = setUp("attack", "alice");
    const tribes = getEffectiveTribes(
      state,
      target,
      card,
      getCardDefinitionById
    );
    expect(tribes).toContain("起幻");
  });

  it("自分のアタックステップ中: spirit/ultimate/brave/nexus 発生源は免疫成立", () => {
    const { state, target } = setUp("attack", "alice");
    for (const category of ["spirit", "ultimate", "brave", "nexus"] as const) {
      const source: CardDefinition = {
        ...card,
        cardNo: `TEST-${category}`,
        printedCategory: category,
      } as unknown as CardDefinition;
      expect(
        isCardImmuneToOpponentEffect(state, target, "bob", "none", {
          definition: source,
        })
      ).toBe(true);
    }
  });

  it("自分のアタックステップ中: magic 発生源でも発動タイミング不明なら免疫不成立", () => {
    const { state, target } = setUp("attack", "alice");
    const magicSource: CardDefinition = {
      ...card,
      cardNo: "TEST-MAGIC",
      printedCategory: "magic",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: magicSource,
      })
    ).toBe(false);
  });

  it("自分のアタックステップ中: magic 発生源でもスタック発動タイミングなら免疫成立 (activatedTimings, カテゴリ非依存)", () => {
    const { state, target } = setUp("attack", "alice");
    const magicSource: CardDefinition = {
      ...card,
      cardNo: "TEST-MAGIC",
      printedCategory: "magic",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: magicSource,
        effectActivationTiming: "stack",
      })
    ).toBe(true);
  });

  it("自分のアタックステップ中: magic 発生源が main/flash 発動なら免疫不成立 (stack 限定)", () => {
    const { state, target } = setUp("attack", "alice");
    const magicSource: CardDefinition = {
      ...card,
      cardNo: "TEST-MAGIC",
      printedCategory: "magic",
    } as unknown as CardDefinition;
    for (const timing of ["main", "flash"] as const) {
      expect(
        isCardImmuneToOpponentEffect(state, target, "bob", "none", {
          definition: magicSource,
          effectActivationTiming: timing,
        })
      ).toBe(false);
    }
  });

  it("自分のアタックステップ外 (相手ターン main): timingScope により免疫不成立", () => {
    const { state, target } = setUp("main", "bob");
    const spiritSource: CardDefinition = {
      ...card,
      cardNo: "TEST-SPIRIT",
      printedCategory: "spirit",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: spiritSource,
      })
    ).toBe(false);
  });
});
