/**
 * BSTH02-M02 [妖々夢]アリス・マーガトロイドの効果耐性検証。
 *
 * effects[1] = 「このスピリットは相手のスピリット/ネクサスの効果を受けない」
 * → sourceScope.categories=["spirit","nexus"] で発生源カテゴリ限定 immunity を表現。
 *   発生源は実効カテゴリ (getEffectiveCategory) で照合。マジック/ブレイヴ/バースト
 *   発生源は通常どおり通る (過剰免疫防止)。
 *
 * 関連: 10_rules/03c §発生源帰属、immunitySourceScope 実装 (2026-06-16 commit 2d14fead)。
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
    chainId: "test:bsth02-m02-source-scope-immunity:32",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH02-M02 [妖々夢]アリス・マーガトロイド shape", () => {
  const card = cardNoMap.get("BSTH02-M02")!;
  it("effects[1] = effect_immunity sourceScope.categories=[spirit,nexus] / self target / while_on_field", () => {
    const immune = card.effects![1]!;
    expect(immune.stub).toBeUndefined();
    expect(immune.timing).toEqual({ kind: "continuous" });
    const a = immune.steps[0]!.action;
    expect(a.kind).toBe("effect_immunity");
    if (a.kind === "effect_immunity") {
      expect(a.target).toEqual({ kind: "self" });
      expect(a.duration).toEqual({ scope: "while_on_field" });
      expect(a.sourceScope).toEqual({ categories: ["spirit", "nexus"] });
    }
  });
});

describe("BSTH02-M02 効果耐性 sourceScope.categories behaviour", () => {
  function setUp() {
    const card = cardNoMap.get("BSTH02-M02")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "alice-m02",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const next = runEffect(state, card.effects![1]!, "alice-m02", "alice");
    const target = next.cardInstances.find(
      (c) => c.instanceId === "alice-m02"
    )!;
    return { state: next, target, base: self };
  }

  it("発生源 spirit → 免疫成立", () => {
    const { state, target, base } = setUp();
    const spiritSource: CardDefinition = {
      ...base,
      cardNo: "TEST-SPIRIT",
      printedCategory: "spirit",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: spiritSource,
      })
    ).toBe(true);
  });

  it("発生源 nexus → 免疫成立", () => {
    const { state, target, base } = setUp();
    const nexusSource: CardDefinition = {
      ...base,
      cardNo: "TEST-NEXUS",
      printedCategory: "nexus",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: nexusSource,
      })
    ).toBe(true);
  });

  it("発生源 magic → 免疫不成立 (素通し)", () => {
    const { state, target, base } = setUp();
    const magicSource: CardDefinition = {
      ...base,
      cardNo: "TEST-MAGIC",
      printedCategory: "magic",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: magicSource,
      })
    ).toBe(false);
  });

  it("発生源 brave → 免疫不成立 (素通し)", () => {
    const { state, target, base } = setUp();
    const braveSource: CardDefinition = {
      ...base,
      cardNo: "TEST-BRAVE",
      printedCategory: "brave",
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: braveSource,
      })
    ).toBe(false);
  });

  it("発生源不明 → 保守的に免疫不成立 (過剰免疫防止)", () => {
    const { state, target } = setUp();
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", undefined)
    ).toBe(false);
  });
});
