/**
 * treat_as 継続効果による色/シンボル拡張のテスト。
 *
 * パチュリー・ノーレッジ型 (BSTH01-M01) の
 * 「このカード/スピリットの色とシンボルは赤としても扱う」
 * を想定し、以下の経路で treat_as_color_and_symbol が反映されることを検証する:
 * 1. getEffectiveSymbolBundles — 詳細モーダル用
 * 2. calculateReduction (cost-system) — コスト軽減計算
 *
 * 修正前は (1) のみ反映され、(2) では symbolColors のみ参照されていた。
 */
import { describe, expect, it } from "vitest";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbolBundles,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

function patchouliDef(): CardDefinition {
  return {
    cardNo: "TEST-PATCHOULI",
    name: "パチュリー・ノーレッジ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple", "red", "red"],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 6000 },
      { level: 2, requiredCores: 2, bp: 8000 },
    ],
    symbolColors: ["purple"],
    textLines: ["このカード/スピリットの色とシンボルは赤としても扱う。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "幻想・紅魔",
    effects: [],
  };
}

function redSpiritDef(cost: number, reductionRed: number): CardDefinition {
  return {
    cardNo: "TEST-RED-SPIRIT",
    name: "テスト赤スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: Array.from({ length: reductionRed }, () => "red"),
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "テスト",
    effects: [],
  };
}

function treatAsColorAndSymbolCE(
  targetInstanceId: string,
  actingPlayerId: string,
  asColor: "red" | "purple" | "green" | "white" | "yellow" | "blue"
): ContinuousEffect {
  return {
    effectId: `ce-treat-as-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "TEST-PATCHOULI",
    actingPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color_and_symbol",
    modifierSymbol: [asColor],
    targetInstanceId,
  };
}

function makeStateWithPatchouli(): {
  state: GameState;
  patchouliId: string;
  def: CardDefinition;
} {
  const def = patchouliDef();
  const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const patchouli = createCardInstance(def, {
    instanceId: "patchouli-1",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const state: GameState = {
    ...baseState,
    cardInstances: [patchouli],
    activeContinuousEffects: [
      treatAsColorAndSymbolCE(patchouli.instanceId, ALICE, "red"),
    ],
  };
  return { state, patchouliId: patchouli.instanceId, def };
}

describe("treat_as continuous effect", () => {
  it("getEffectiveSymbolBundles: 紫1 + treat_as 赤 → 赤紫 1 bundle (詳細モーダル経路)", () => {
    const { state, patchouliId, def } = makeStateWithPatchouli();
    const card = state.cardInstances.find((c) => c.instanceId === patchouliId)!;

    const bundles = getEffectiveSymbolBundles(state, card, def);

    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.colors.sort()).toEqual(["purple", "red"].sort());
    expect(bundles[0]!.count).toBe(1);
  });

  it("calculateReduction: パチュリー (treat_as 赤) は 赤要求のコスト軽減に貢献する", () => {
    const { state } = makeStateWithPatchouli();
    const def = patchouliDef();
    const target = redSpiritDef(/* cost */ 3, /* red reduction */ 1);

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: target,
      getCardDefinitionById: (id) => {
        if (id === def.cardNo) return def;
        if (id === target.cardNo) return target;
        return undefined;
      },
    });

    // 1 赤要求 + パチュリー 1 赤紫 multi-color → 1 軽減
    expect(result.totalReduction).toBe(1);
    expect(result.reducedCost).toBe(2);
  });

  it("calculateReduction: 多色シンボル片側使用 — 1 赤紫 symbol で 赤1+紫1 同時要求は 1 しか軽減できない", () => {
    const { state } = makeStateWithPatchouli();
    const def = patchouliDef();
    const target: CardDefinition = {
      cardNo: "TEST-DUAL",
      name: "デュアル要求",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 5,
      reductionSymbols: ["red", "purple"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "テスト",
      effects: [],
    };

    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: target,
      getCardDefinitionById: (id) => {
        if (id === def.cardNo) return def;
        if (id === target.cardNo) return target;
        return undefined;
      },
    });

    // パチュリーの 1 赤紫 symbol は片側使用ルールで赤か紫のどちらか 1 つにしか割当できない。
    expect(result.totalReduction).toBe(1);
    expect(result.reducedCost).toBe(4);
  });

  it("calculateReduction: treat_as CE がない場合は通常の紫シンボルとして扱う", () => {
    const def = patchouliDef();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const patchouli = createCardInstance(def, {
      instanceId: "patchouli-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    // treat_as CE 未登録の状態
    const state: GameState = { ...baseState, cardInstances: [patchouli] };

    const target = redSpiritDef(3, 1);
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: target,
      getCardDefinitionById: (id) => {
        if (id === def.cardNo) return def;
        if (id === target.cardNo) return target;
        return undefined;
      },
    });

    // 紫1のみ → 赤要求は軽減できない
    expect(result.totalReduction).toBe(0);
    expect(result.reducedCost).toBe(3);
  });
});

// ============================================================
// 多色 treat_as (engine batch2-1)
// 「シンボル/軽減を 赤/紫 として扱う」= modifierSymbol が複数色。
// CE consumer (getEffectiveSymbolBundles) が全色を反映することを検証する。
// ============================================================

/** modifierSymbol に複数色を持つ treat_as_color_and_symbol CE。 */
function treatAsMultiColorCE(
  targetInstanceId: string,
  actingPlayerId: string,
  asColors: ("red" | "purple" | "green" | "white" | "yellow" | "blue")[]
): ContinuousEffect {
  return {
    effectId: `ce-treat-as-multi-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "TEST-PATCHOULI",
    actingPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color_and_symbol",
    modifierSymbol: [...asColors],
    targetInstanceId,
  };
}

describe("treat_as multi-color (engine batch2-1)", () => {
  it("getEffectiveSymbolBundles: 緑1 + treat_as [赤, 紫] → 1 シンボルが 赤緑紫 三色 bundle", () => {
    const def: CardDefinition = {
      ...patchouliDef(),
      colors: ["green"],
      symbolColors: ["green"],
      reductionSymbols: ["green"],
    };
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "multi-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [card],
      activeContinuousEffects: [
        treatAsMultiColorCE(card.instanceId, ALICE, ["red", "purple"]),
      ],
    };

    const bundles = getEffectiveSymbolBundles(state, card, def);

    // 元の緑1シンボルが「赤としても紫としても」扱われる → 1 シンボルで 3 色。
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.colors.sort()).toEqual(
      ["green", "purple", "red"].sort()
    );
    expect(bundles[0]!.count).toBe(1);
  });

  it("calculateReduction: treat_as [赤, 紫] のカードは 赤要求にも 紫要求にも貢献する", () => {
    // 元シンボル = 緑1。treat_as で赤・紫の両方を獲得 → 赤要求/紫要求どちらも 1 軽減できる。
    const def: CardDefinition = {
      ...patchouliDef(),
      cardNo: "TEST-MULTI-SRC",
      colors: ["green"],
      symbolColors: ["green"],
      reductionSymbols: ["green"],
    };
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "multi-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [card],
      activeContinuousEffects: [
        treatAsMultiColorCE(card.instanceId, ALICE, ["red", "purple"]),
      ],
    };

    const redTarget = redSpiritDef(3, 1);
    const redResult = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: redTarget,
      getCardDefinitionById: (id) => {
        if (id === def.cardNo) return def;
        if (id === redTarget.cardNo) return redTarget;
        return undefined;
      },
    });
    // 赤要求1 + 緑(=赤紫扱い)シンボル → 1 軽減
    expect(redResult.totalReduction).toBe(1);

    const purpleTarget: CardDefinition = {
      ...redSpiritDef(3, 0),
      cardNo: "TEST-PURPLE-REQ",
      colors: ["purple"],
      symbolColors: ["purple"],
      reductionSymbols: ["purple"],
    };
    const purpleResult = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: purpleTarget,
      getCardDefinitionById: (id) => {
        if (id === def.cardNo) return def;
        if (id === purpleTarget.cardNo) return purpleTarget;
        return undefined;
      },
    });
    // 紫要求1 + 緑(=赤紫扱い)シンボル → 1 軽減 (多色の両方が機能している証拠)
    expect(purpleResult.totalReduction).toBe(1);
  });

  it("単色 treat_as の挙動は従来どおり (回帰): 紫1 + treat_as [赤] → 赤紫 1 bundle", () => {
    const { state, patchouliId, def } = makeStateWithPatchouli();
    const card = state.cardInstances.find((c) => c.instanceId === patchouliId)!;
    const bundles = getEffectiveSymbolBundles(state, card, def);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.colors.sort()).toEqual(["purple", "red"].sort());
    expect(bundles[0]!.count).toBe(1);
  });
});
