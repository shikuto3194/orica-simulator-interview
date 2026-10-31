/**
 * P3-47 F-2 Step 1: act_as_spirit ContinuousEffect の型と isSpirit() helper を検証する。
 *
 * - 印字 category=spirit のカードは常に isSpirit=true
 * - 非スピリットカード (例: nexus / magic) でも act_as_spirit CE が targetInstanceId 指定で
 *   登録されていれば isSpirit=true を返す
 * - getActAsSpiritMetadata は metadata の statBlueprint を取り出せる
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveBp,
  getEffectiveLevel,
  getEffectiveSymbols,
  getEffectiveSymbolBundles,
  isBattleCapableCategory,
} from "../src/battle/battle-shared";
import { matchesCardFilter } from "../src/card/card-filter";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  getEffectiveColors,
  recomputeContinuousEffects,
} from "../src/legal/legal-actions-shared";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { getAvailableBraveCombineLegalActions } from "../src/legal/legal-actions-availability";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  isSpirit,
  getActAsSpiritMetadata,
  getActAsSpiritKeywords,
  getEffectiveCategory,
  getEffectiveTribe,
  hasActAsSpiritKeyword,
  hasCannotCombineRestriction,
} from "../src/mechanics/act-as-spirit";
import type {
  ActAsSpiritMetadata,
  ActAsSpiritStatSnapshot,
} from "../src/mechanics/act-as-spirit";
import type { Effect } from "../src/dsl-types";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const ALICE = "player-1";

function spiritDef(): CardDefinition {
  return {
    cardNo: "TEST-SPIRIT",
    name: "Test Spirit",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function nexusDef(): CardDefinition {
  return {
    cardNo: "TEST-NEXUS",
    name: "Test Nexus",
    printedCategory: "nexus",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function braveDef(): CardDefinition {
  return {
    cardNo: "TEST-BRAVE",
    name: "Test Brave",
    printedCategory: "brave",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function makeStateWithCard(
  def: CardDefinition,
  ces: ContinuousEffect[] = []
): { state: GameState; instanceId: string } {
  const card = createCardInstance(def, {
    instanceId: "card-1",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const state = createEmptyGameState({ playerIds: ["player-1", "player-2"] });
  return {
    state: {
      ...state,
      cardInstances: [card],
      activeContinuousEffects: ces,
    },
    instanceId: card.instanceId,
  };
}

function actAsSpiritCE(
  targetInstanceId: string,
  metadata: ActAsSpiritMetadata
): ContinuousEffect {
  return {
    effectId: `ce-act-as-spirit-${targetInstanceId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId,
    metadata: metadata as unknown as Record<string, unknown>,
  };
}

function overridePropertiesCE(
  targetInstanceId: string,
  properties: Record<string, unknown>
): ContinuousEffect {
  return {
    effectId: `ce-override-properties-${targetInstanceId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "battle" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { properties },
  };
}

function treatAsBlueCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-treat-blue-${targetInstanceId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color" as ContinuousEffectTag,
    targetInstanceId,
    modifierSymbol: ["blue"],
  };
}

const STATIC_SNAPSHOT: ActAsSpiritStatSnapshot = {
  cost: 7,
  reductionSymbols: [],
  symbolColors: ["red"],
  tribes: ["紅魔"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 6000 },
    { level: 2, requiredCores: 3, bp: 9000 },
  ],
};

describe("P3-47 F-2 Step 1: isSpirit() helper", () => {
  it("印字 category=spirit のカードは常に isSpirit=true", () => {
    const { state, instanceId } = makeStateWithCard(spiritDef());
    const card = state.cardInstances.find((c) => c.instanceId === instanceId)!;
    expect(isSpirit(card, state, () => spiritDef())).toBe(true);
  });

  it("印字 category=nexus のカードは default で isSpirit=false", () => {
    const { state, instanceId } = makeStateWithCard(nexusDef());
    const card = state.cardInstances.find((c) => c.instanceId === instanceId)!;
    expect(isSpirit(card, state, () => nexusDef())).toBe(false);
  });

  it("act_as_spirit CE 登録で nexus カードも isSpirit=true", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state, instanceId } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances.find((c) => c.instanceId === instanceId)!;
    expect(isSpirit(card, state, () => nexusDef())).toBe(true);
  });

  it("getCardDefinitionById 省略時は CE のみで判定する", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state, instanceId } = makeStateWithCard(spiritDef(), [ce]);
    const card = state.cardInstances.find((c) => c.instanceId === instanceId)!;
    // CE が targetInstanceId 一致で登録されているので true
    expect(isSpirit(card, state)).toBe(true);

    // CE 無しで lookup 省略すると false (印字判定をスキップするため)
    const { state: emptyState, instanceId: id2 } =
      makeStateWithCard(spiritDef());
    const card2 = emptyState.cardInstances.find((c) => c.instanceId === id2)!;
    expect(isSpirit(card2, emptyState)).toBe(false);
  });

  it("別カードを target にする CE は対象外カードの isSpirit に影響しない", () => {
    const ce = actAsSpiritCE("other-card", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state, instanceId } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances.find((c) => c.instanceId === instanceId)!;
    expect(isSpirit(card, state, () => nexusDef())).toBe(false);
  });
});

describe("P3-47 F-2 Step 1: getActAsSpiritMetadata()", () => {
  it("static_copy snapshot を取り出せる", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
      overrides: { cardName: "フランドール・スカーレット" },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const meta = getActAsSpiritMetadata(state, "card-1");
    expect(meta).toBeDefined();
    expect(meta?.statBlueprint.kind).toBe("static_copy");
    if (meta?.statBlueprint.kind === "static_copy") {
      expect(meta.statBlueprint.snapshot.cost).toBe(7);
      expect(meta.statBlueprint.snapshot.symbolColors).toEqual(["red"]);
    }
    expect(meta?.overrides?.cardName).toBe("フランドール・スカーレット");
  });

  it("live_copy_from の参照源 instanceId と aspects を取り出せる", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "frandolle-host",
        aspects: ["cost", "symbolColors", "levelDefs", "currentLv"],
      },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const meta = getActAsSpiritMetadata(state, "card-1");
    expect(meta?.statBlueprint.kind).toBe("live_copy_from");
    if (meta?.statBlueprint.kind === "live_copy_from") {
      expect(meta.statBlueprint.sourceInstanceId).toBe("frandolle-host");
      expect(meta.statBlueprint.aspects).toContain("currentLv");
    }
  });

  it("CE 無しの場合 undefined を返す", () => {
    const { state } = makeStateWithCard(spiritDef());
    expect(getActAsSpiritMetadata(state, "card-1")).toBeUndefined();
  });
});

describe("P3-47 F-2 Step 2: BP / Lv 解決", () => {
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 7,
      cost: 7,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 6000 },
        { level: 2, requiredCores: 3, bp: 9000 },
        { level: 3, requiredCores: 5, bp: 14000 },
      ],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function makeFrandolleState(opts: {
    hostCores: number;
    tokenCores: number;
    blueprint: ActAsSpiritMetadata["statBlueprint"];
  }): { state: GameState; getDef: (id: string) => CardDefinition | undefined } {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "frandolle-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: opts.hostCores,
    });
    const token = createCardInstance(nexusDef(), {
      instanceId: "token-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: opts.tokenCores,
    });
    const ce: ContinuousEffect = {
      effectId: "ce-1",
      sourceInstanceId: "frandolle-host",
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: "token-1",
      metadata: { statBlueprint: opts.blueprint } as unknown as Record<
        string,
        unknown
      >,
    };
    const baseState = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [host, token],
      activeContinuousEffects: [ce],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": nexusDef(),
    };
    return { state, getDef: (id) => defs[id] };
  }

  it("live_copy_from: token の BP が host の現在 BP に追従 (Lv1)", () => {
    const { state, getDef } = makeFrandolleState({
      hostCores: 1,
      tokenCores: 1,
      blueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "frandolle-host",
        aspects: ["currentLv", "levelDefs"],
      },
    });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveBp(state, token, nexusDef(), getDef)).toBe(6000);
  });

  it("live_copy_from: host にコア追加 → token BP が Lv2 に追従", () => {
    const { state, getDef } = makeFrandolleState({
      hostCores: 3,
      tokenCores: 1,
      blueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "frandolle-host",
        aspects: ["currentLv", "levelDefs"],
      },
    });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveBp(state, token, nexusDef(), getDef)).toBe(9000);
  });

  it("live_copy_from: token Lv が host の currentLv に追従", () => {
    const { state, getDef } = makeFrandolleState({
      hostCores: 5,
      tokenCores: 1, // token のコアは 1 個しかなくても、host が Lv3 なら token も Lv3
      blueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "frandolle-host",
        aspects: ["currentLv", "levelDefs"],
      },
    });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveLevel(state, token, nexusDef(), getDef)).toBe(3);
  });

  it("static_copy: snapshot.levelDefs と token のコアで BP/Lv 計算", () => {
    const { state, getDef } = makeFrandolleState({
      hostCores: 5, // host のコアは無視
      tokenCores: 3,
      blueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    // STATIC_SNAPSHOT.levelDefs = [Lv1=1コア/6000, Lv2=3コア/9000]
    // token は 3 コア → Lv2、BP=9000
    expect(getEffectiveLevel(state, token, nexusDef(), getDef)).toBe(2);
    expect(getEffectiveBp(state, token, nexusDef(), getDef)).toBe(9000);
  });

  it("act_as_spirit 無しの場合 token の BP/Lv は token 自身の definition で計算", () => {
    // act_as_spirit CE を含まない state を作る
    const token = createCardInstance(nexusDef(), {
      instanceId: "lone-token",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [token],
      activeContinuousEffects: [],
    };
    // nexus の levelDefs は requiredCores=0/bp=0
    expect(getEffectiveBp(state, token, nexusDef(), () => nexusDef())).toBe(0);
    expect(getEffectiveLevel(state, token, nexusDef(), () => nexusDef())).toBe(
      1
    );
  });

  it("循環参照ガード: A→B→A の live_copy_from で 0 にフォールバック", () => {
    // card-A act_as_spirit live_copy_from card-B
    // card-B act_as_spirit live_copy_from card-A
    const cardA = createCardInstance(nexusDef(), {
      instanceId: "card-A",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cardB = createCardInstance(nexusDef(), {
      instanceId: "card-B",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const ceA: ContinuousEffect = {
      effectId: "ce-A",
      sourceInstanceId: "src",
      sourceDefinitionId: "SRC",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: "card-A",
      metadata: {
        statBlueprint: {
          kind: "live_copy_from",
          sourceInstanceId: "card-B",
          aspects: ["currentLv", "levelDefs"],
        },
      } as unknown as Record<string, unknown>,
    };
    const ceB: ContinuousEffect = {
      ...ceA,
      effectId: "ce-B",
      targetInstanceId: "card-B",
      metadata: {
        statBlueprint: {
          kind: "live_copy_from",
          sourceInstanceId: "card-A",
          aspects: ["currentLv", "levelDefs"],
        },
      } as unknown as Record<string, unknown>,
    };
    const baseState = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [cardA, cardB],
      activeContinuousEffects: [ceA, ceB],
    };
    // 循環すれば visited で 0 にフォールバック (例外 / スタックオーバーフローしない)
    expect(getEffectiveBp(state, cardA, nexusDef(), () => nexusDef())).toBe(0);
    expect(getEffectiveLevel(state, cardA, nexusDef(), () => nexusDef())).toBe(
      0
    );
  });

  it("分身は印字 BP(0) でなく実効 BP で minBp/maxBp 判定される (R21 紅魔館 BP5000以下)", () => {
    // 分身トークン: 印字は nexus (Lv1 BP=0) だが live_copy_from で実効 BP=6000。
    // R21「BP5000以下のスピリットを破壊」が印字 0 を読むと誤って対象になるバグの回帰防止。
    const { state, getDef } = makeFrandolleState({
      hostCores: 1,
      tokenCores: 1,
      blueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "frandolle-host",
        aspects: ["currentLv", "levelDefs"],
      },
    });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    const effectiveBp = getEffectiveBp(state, token, nexusDef(), getDef);
    expect(effectiveBp).toBe(6000);

    // 実効 BP を注入 → BP5000以下フィルタは 6000 の分身にマッチしない (破壊対象外)。
    expect(
      matchesCardFilter(
        token,
        nexusDef(),
        { maxBp: 5000 },
        { state, effectiveBp }
      )
    ).toBe(false);
    // minBp:6000 はマッチ (実効 BP=6000)。
    expect(
      matchesCardFilter(
        token,
        nexusDef(),
        { minBp: 6000 },
        { state, effectiveBp }
      )
    ).toBe(true);

    // バグの核心: effectiveBp 未注入だと印字 def.levelDefs[0].bp=0 にフォールバックし、
    // BP5000以下に誤マッチする (修正前の挙動)。注入経路が必須であることの裏取り。
    expect(
      matchesCardFilter(token, nexusDef(), { maxBp: 5000 }, { state })
    ).toBe(true);
  });
});

describe("P3-47 F-2 Step 3: getEffectiveCategory()", () => {
  it('act_as_spirit CE 適用済み nexus は "spirit" を返す', () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    expect(getEffectiveCategory(state, card, nexusDef())).toBe("spirit");
  });

  it("CE 無し nexus は印字 category を返す", () => {
    const { state } = makeStateWithCard(nexusDef());
    const card = state.cardInstances[0]!;
    expect(getEffectiveCategory(state, card, nexusDef())).toBe("nexus");
  });

  it('CE 無し spirit は "spirit" を返す', () => {
    const { state } = makeStateWithCard(spiritDef());
    const card = state.cardInstances[0]!;
    expect(getEffectiveCategory(state, card, spiritDef())).toBe("spirit");
  });

  it("engine-category-negation-override: excludeCategory が印字 category と一致すると undefined (BSTH03-M01「アルティメットとして扱わない」)", () => {
    const ultimateDef = {
      ...spiritDef(),
      printedCategory: "ultimate",
    } as CardDefinition;
    const ce = overridePropertiesCE("card-1", { excludeCategory: "ultimate" });
    const { state } = makeStateWithCard(ultimateDef, [ce]);
    const card = state.cardInstances[0]!;
    expect(getEffectiveCategory(state, card, ultimateDef)).toBeUndefined();
  });

  it("excludeCategory が印字 category と不一致なら通常どおり印字 category を返す", () => {
    const ce = overridePropertiesCE("card-1", { excludeCategory: "ultimate" });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    expect(getEffectiveCategory(state, card, nexusDef())).toBe("nexus");
  });

  it("treatAsCategory と excludeCategory 同時指定時は treatAsCategory (置換) が優先", () => {
    const ultimateDef = {
      ...spiritDef(),
      printedCategory: "ultimate",
    } as CardDefinition;
    const ce = overridePropertiesCE("card-1", {
      treatAsCategory: "spirit",
      excludeCategory: "ultimate",
    });
    const { state } = makeStateWithCard(ultimateDef, [ce]);
    const card = state.cardInstances[0]!;
    expect(getEffectiveCategory(state, card, ultimateDef)).toBe("spirit");
  });
});

describe("P3-47 F-2 Step 3: matchesCardFilter() — effectiveCategory", () => {
  it('filter.category=["spirit"] は act_as_spirit token (元 nexus) にマッチ', () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    const matched = matchesCardFilter(
      card,
      nexusDef(),
      { category: ["spirit"] },
      { state }
    );
    expect(matched).toBe(true);
  });

  it('filter.category=["nexus"] は act_as_spirit token にマッチしない ("spirit" 上書き)', () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    const matched = matchesCardFilter(
      card,
      nexusDef(),
      { category: ["nexus"] },
      { state }
    );
    expect(matched).toBe(false);
  });

  it("state なしの呼び出しでは printedCategory のまま (後方互換)", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    // state を opts に渡さない → 従来通り nexus 扱い
    const matchedSpirit = matchesCardFilter(card, nexusDef(), {
      category: ["spirit"],
    });
    const matchedNexus = matchesCardFilter(card, nexusDef(), {
      category: ["nexus"],
    });
    expect(matchedSpirit).toBe(false);
    expect(matchedNexus).toBe(true);
  });

  it("合体済み child brave の own identity は実効色込みで category 除外を判定する", () => {
    const host = {
      ...createCardInstance(spiritDef(), {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef(), {
        instanceId: "brave-1",
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      }),
      attachedToInstanceId: "host-1",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, "player-2"] }),
      cardInstances: [host, brave],
      activeContinuousEffects: [
        actAsSpiritCE("brave-1", {
          statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
        }),
        treatAsBlueCE("brave-1"),
      ],
    };
    const effectiveColors = getEffectiveColors(state, brave, braveDef());

    expect(getEffectiveCategory(state, brave, braveDef())).toBe("spirit");
    expect(effectiveColors).toContain("blue");
    expect(
      matchesCardFilter(
        brave,
        braveDef(),
        { category: ["spirit"], colors: ["blue"] },
        {
          state,
          fieldCategoryContext: true,
          effectiveColors,
        }
      )
    ).toBe(true);
  });

  it("CE 無し普通の spirit は spirit フィルタにマッチ", () => {
    const { state } = makeStateWithCard(spiritDef());
    const card = state.cardInstances[0]!;
    const matched = matchesCardFilter(
      card,
      spiritDef(),
      { category: ["spirit"] },
      { state }
    );
    expect(matched).toBe(true);
  });
});

describe("P3-47 F-2 Step 3: isBattleCapableCategory() — act_as_spirit", () => {
  it("act_as_spirit token (元 nexus) は state 渡しで battle 参加可能", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    expect(isBattleCapableCategory(nexusDef(), card, state)).toBe(true);
  });

  it("act_as_spirit token: state 未指定では battle 不可 (後方互換)", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    const card = state.cardInstances[0]!;
    expect(isBattleCapableCategory(nexusDef(), card)).toBe(false);
  });

  it("CE 無し nexus は battle 不可 (state 有無に関わらず)", () => {
    const { state } = makeStateWithCard(nexusDef());
    const card = state.cardInstances[0]!;
    expect(isBattleCapableCategory(nexusDef(), card, state)).toBe(false);
  });

  it("CE 無し spirit は battle 可能 (印字 category 経路)", () => {
    const { state } = makeStateWithCard(spiritDef());
    const card = state.cardInstances[0]!;
    expect(isBattleCapableCategory(spiritDef(), card, state)).toBe(true);
  });
});

describe("P3-47 F-2 Step 4: lifecycle 管理 (while_on_field + targetInstanceId)", () => {
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 7,
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  /**
   * host (Frandolle) と token (face-down nexus) を場に並べ、
   * act_as_spirit CE (while_on_field, source=host, target=token) を 1 件登録した state を作る。
   */
  function makeHostTokenState(opts: {
    hostZone?: "field" | "trash";
    tokenZone?: "field" | "trash";
  }): GameState {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: opts.hostZone ?? "field",
      normalCoreCount: 3,
    });
    const token = createCardInstance(nexusDef(), {
      instanceId: "token-1",
      ownerPlayerId: ALICE,
      zone: opts.tokenZone ?? "field",
      normalCoreCount: 1,
    });
    const ce: ContinuousEffect = {
      effectId: "ce-act-as-spirit-1",
      sourceInstanceId: "host-1",
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: "token-1",
      metadata: {
        statBlueprint: {
          kind: "live_copy_from",
          sourceInstanceId: "host-1",
          aspects: ["currentLv", "levelDefs"],
        },
      } as unknown as Record<string, unknown>,
    };
    const baseState = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
    });
    return {
      ...baseState,
      cardInstances: [host, token],
      activeContinuousEffects: [ce],
    };
  }

  it("host・token とも field なら CE 残存", () => {
    const state = makeHostTokenState({});
    const next = recomputeContinuousEffects(state);
    expect(next.activeContinuousEffects).toHaveLength(1);
    const token = next.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(isSpirit(token, next, () => nexusDef())).toBe(true);
  });

  it("host (sourceInstanceId) フィールド離脱で CE 削除 → token は spirit 扱い解除", () => {
    const state = makeHostTokenState({ hostZone: "trash" });
    const next = recomputeContinuousEffects(state);
    expect(next.activeContinuousEffects).toHaveLength(0);
    const token = next.cardInstances.find((c) => c.instanceId === "token-1")!;
    // token はフィールドに残留 (F-1 裁定 #2)
    expect(token.zone).toBe("field");
    // CE 解除後は元の category=nexus
    expect(isSpirit(token, next, () => nexusDef())).toBe(false);
  });

  it("token (targetInstanceId) フィールド離脱で CE 削除", () => {
    const state = makeHostTokenState({ tokenZone: "trash" });
    const next = recomputeContinuousEffects(state);
    expect(next.activeContinuousEffects).toHaveLength(0);
  });

  it("host と token 両方が trash でも CE は単純に削除 (例外なし)", () => {
    const state = makeHostTokenState({
      hostZone: "trash",
      tokenZone: "trash",
    });
    const next = recomputeContinuousEffects(state);
    expect(next.activeContinuousEffects).toHaveLength(0);
  });

  it("permanent scope ではなく while_on_field を使うことで host 離脱に追従する", () => {
    // 反例: scope=permanent + targetInstanceId のみで token 監視のみ
    // → host が trash でも token が field なら残ってしまう
    const state = makeHostTokenState({ hostZone: "trash" });
    const ceList = state.activeContinuousEffects.map((ce) => ({
      ...ce,
      duration: { scope: "permanent" as const },
    }));
    const stateWithPermanent: GameState = {
      ...state,
      activeContinuousEffects: ceList,
    };
    const next = recomputeContinuousEffects(stateWithPermanent);
    // permanent では host 離脱を検知できないため CE は残る (反証)
    expect(next.activeContinuousEffects).toHaveLength(1);
    // ゆえに本効果実装では duration.scope=while_on_field を必ず指定する
  });
});

describe("P3-47 F-2 Step 5: keyword/restriction (cannot_combine)", () => {
  function braveDef(): CardDefinition {
    return {
      cardNo: "TEST-BRAVE-01",
      name: "Test Brave",
      printedCategory: "brave",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 4,
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  it("getActAsSpiritKeywords は overrides.keywords を返す", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
      overrides: { keywords: ["cannot_combine"] },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    expect(getActAsSpiritKeywords(state, "card-1")).toEqual(["cannot_combine"]);
  });

  it("hasActAsSpiritKeyword: 個別キーワードのマッチ判定", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
      overrides: { keywords: ["cannot_combine", "cannot_use_effect"] },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    expect(hasActAsSpiritKeyword(state, "card-1", "cannot_combine")).toBe(true);
    expect(hasActAsSpiritKeyword(state, "card-1", "cannot_use_effect")).toBe(
      true
    );
    expect(hasActAsSpiritKeyword(state, "card-1", "cannot_attack")).toBe(false);
  });

  it("hasCannotCombineRestriction: keywords 未指定なら false", () => {
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
    });
    const { state } = makeStateWithCard(nexusDef(), [ce]);
    expect(hasCannotCombineRestriction(state, "card-1")).toBe(false);
  });

  it("hasCannotCombineRestriction: CE 無しのカードは false", () => {
    const { state } = makeStateWithCard(spiritDef());
    expect(hasCannotCombineRestriction(state, "card-1")).toBe(false);
  });

  it("brave_combine: cannot_combine token は合体先候補から除外", () => {
    const brave = createCardInstance(braveDef(), {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    // 印字 spirit (本来は合体先候補) に act_as_spirit overrides で
    // cannot_combine を付与した想定。
    const target = createCardInstance(spiritDef(), {
      instanceId: "spirit-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const ce: ContinuousEffect = {
      effectId: "ce-cannot-combine-1",
      sourceInstanceId: "host-1",
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: "spirit-1",
      metadata: {
        statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
        overrides: { keywords: ["cannot_combine"] },
      } as unknown as Record<string, unknown>,
    };
    const baseState = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [brave, target],
      activeContinuousEffects: [ce],
    };
    const defLookup = (id: string): CardDefinition | undefined => {
      if (id === "TEST-BRAVE-01") return braveDef();
      if (id === "TEST-SPIRIT") return spiritDef();
      return undefined;
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(actions).toHaveLength(0);
  });

  it("brave_combine: cannot_combine が無ければ通常通り合体可", () => {
    // 反例: 同じ盤面で cannot_combine を付与しなければ brave_combine 候補に出る
    const brave = createCardInstance(braveDef(), {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const target = createCardInstance(spiritDef(), {
      instanceId: "spirit-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [brave, target],
      activeContinuousEffects: [],
    };
    const defLookup = (id: string): CardDefinition | undefined => {
      if (id === "TEST-BRAVE-01") return braveDef();
      if (id === "TEST-SPIRIT") return spiritDef();
      return undefined;
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: defLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.targetInstanceId).toBe("spirit-1");
  });
});

describe("P3-47 F-2 Step 6: register_act_as_spirit DSL action", () => {
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 7,
      cost: 7,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 6000 },
        { level: 2, requiredCores: 3, bp: 9000 },
      ],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function makeFrandolleAndTokens(): {
    state: GameState;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokens = [0, 1, 2].map((i) =>
      createCardInstance(nexusDef(), {
        instanceId: `token-${i}`,
        ownerPlayerId: ALICE,
        zone: "field",
        faceDown: true,
        cores: 1,
      })
    );
    const baseState = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      cardInstances: [host, ...tokens],
      activeContinuousEffects: [],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": nexusDef(),
    };
    return { state, getDef: (id) => defs[id] };
  }

  it("live_copy_from_source: 効果発動元を sourceInstanceId として CE を登録", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_act_as_spirit",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { category: ["nexus"] },
            },
            statBlueprint: {
              kind: "live_copy_from_source",
              aspects: ["currentLv", "levelDefs", "cost", "symbolColors"],
            },
            overrides: {
              cardName: "フランドール・スカーレット",
              keywords: ["cannot_combine"],
            },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:act-as-spirit:1072",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      targetInstanceIds: ["token-0", "token-1", "token-2"],
      getCardDefinitionById: getDef,
    });

    // 3 token 全てに act_as_spirit CE が登録される
    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "act_as_spirit"
    );
    expect(ces).toHaveLength(3);
    for (const ce of ces) {
      expect(ce.sourceInstanceId).toBe("host-1");
      expect(ce.duration).toEqual({ scope: "while_on_field" });
      const meta = ce.metadata as unknown as ActAsSpiritMetadata;
      expect(meta.statBlueprint.kind).toBe("live_copy_from");
      if (meta.statBlueprint.kind === "live_copy_from") {
        expect(meta.statBlueprint.sourceInstanceId).toBe("host-1");
        expect(meta.statBlueprint.aspects).toContain("currentLv");
      }
      expect(meta.overrides?.keywords).toEqual(["cannot_combine"]);
      expect(meta.overrides?.cardName).toBe("フランドール・スカーレット");
    }

    // 各 token が isSpirit / cannot_combine を満たす
    for (const id of ["token-0", "token-1", "token-2"]) {
      const token = next.cardInstances.find((c) => c.instanceId === id)!;
      expect(isSpirit(token, next, () => nexusDef())).toBe(true);
      expect(hasCannotCombineRestriction(next, id)).toBe(true);
    }
  });

  it("static_copy: snapshot を CE metadata にそのまま埋め込む", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_act_as_spirit",
            target: {
              kind: "filter",
              player: "self",
              count: 1,
              filter: { category: ["nexus"] },
            },
            statBlueprint: {
              kind: "static_copy",
              snapshot: STATIC_SNAPSHOT,
            },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:act-as-spirit:1129",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      targetInstanceIds: ["token-0"],
      getCardDefinitionById: getDef,
    });

    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "act_as_spirit"
    );
    expect(ces).toHaveLength(1);
    const meta = ces[0]!.metadata as unknown as ActAsSpiritMetadata;
    expect(meta.statBlueprint.kind).toBe("static_copy");
    if (meta.statBlueprint.kind === "static_copy") {
      expect(meta.statBlueprint.snapshot.cost).toBe(7);
    }
  });

  it("duration を明示すれば CE.duration に伝搬する", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_act_as_spirit",
            target: {
              kind: "filter",
              player: "self",
              count: 1,
              filter: { category: ["nexus"] },
            },
            statBlueprint: {
              kind: "live_copy_from_source",
              aspects: ["currentLv"],
            },
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:act-as-spirit:1172",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      targetInstanceIds: ["token-0"],
      getCardDefinitionById: getDef,
    });
    const ce = next.activeContinuousEffects.find(
      (c) => c.modifierTag === "act_as_spirit"
    )!;
    expect(ce.duration).toEqual({ scope: "turn" });
  });

  it("対象 0 件なら CE は登録されない", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    // token を全部除外し host のみ残す → category=nexus filter が空集合
    const stateOnlyHost: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (c) => c.instanceId === "host-1"
      ),
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_act_as_spirit",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { category: ["nexus"] },
            },
            statBlueprint: {
              kind: "live_copy_from_source",
              aspects: ["currentLv"],
            },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:act-as-spirit:1215",
      state: stateOnlyHost,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "act_as_spirit"
    );
    expect(ces).toHaveLength(0);
  });

  it("登録された CE は Step 4 lifecycle (host 離脱で削除) 規約を満たす", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_act_as_spirit",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { category: ["nexus"] },
            },
            statBlueprint: {
              kind: "live_copy_from_source",
              aspects: ["currentLv", "levelDefs"],
            },
          },
        },
      ],
    };
    const registered = executeEffect({
      chainId: "test:act-as-spirit:1250",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      targetInstanceIds: ["token-0", "token-1", "token-2"],
      getCardDefinitionById: getDef,
    });
    expect(
      registered.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "act_as_spirit"
      )
    ).toHaveLength(3);

    // host を trash へ → recomputeContinuousEffects で 3 件全削除
    const hostTrashed: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "host-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const after = recomputeContinuousEffects(hostTrashed);
    expect(
      after.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "act_as_spirit"
      )
    ).toHaveLength(0);
  });
});

describe("P3-69: 裏向きカードの素性 (symbol / tribe / category / 印字効果抑止)", () => {
  // フランドール本体: 2 シンボル (赤赤) + 系統 紅魔。
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red", "red"],
      printedCost: 8,
      cost: 8,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 8000 },
        { level: 2, requiredCores: 3, bp: 13000 },
      ],
      textLines: [],
      images: {},
      tribe: "幻想・紅魔・夜族",
      colors: ["red"],
    } as CardDefinition;
  }

  // 印字ブレイヴ (BSTH01-X08 相当): 1 シンボル (赤) + 系統 紅魔 +
  // 印字の継続効果 (赤/紫シンボル 2 つ追加) を持つ。分身トークンの物理カード。
  function braveTokenDef(): CardDefinition {
    return {
      cardNo: "BRAVE-TOKEN",
      name: "Test Brave Token",
      printedCategory: "brave",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 6,
      cost: 6,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      images: {},
      tribe: "紅魔",
      colors: ["red"],
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "symbol_add",
                target: { kind: "self" },
                symbol: ["red", "purple"],
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    } as unknown as CardDefinition;
  }

  const LIVE_ASPECTS = [
    "cost",
    "symbolColors",
    "tribes",
    "levelDefs",
    "currentLv",
  ] as const;

  function makeFaceDownTokenState(opts: { withGrant: boolean }): GameState {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const token = createCardInstance(braveTokenDef(), {
      instanceId: "token-1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      normalCoreCount: 1,
    });
    const ces: ContinuousEffect[] = opts.withGrant
      ? [
          {
            effectId: "ce-token-1",
            sourceInstanceId: "host-1",
            sourceDefinitionId: "FRANDOLLE-HOST",
            actingPlayerId: ALICE,
            duration: { scope: "while_on_field" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "act_as_spirit" as ContinuousEffectTag,
            targetInstanceId: "token-1",
            metadata: {
              statBlueprint: {
                kind: "live_copy_from",
                sourceInstanceId: "host-1",
                aspects: [...LIVE_ASPECTS],
              },
              overrides: {
                cardName: "フランドール・スカーレット",
                levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
                keywords: ["cannot_combine"],
              },
            } as unknown as Record<string, unknown>,
          },
        ]
      : [];
    const baseState = createEmptyGameState({ playerIds: [ALICE, "player-2"] });
    return {
      ...baseState,
      cardInstances: [host, token],
      activeContinuousEffects: ces,
    };
  }

  const getDef = (id: string): CardDefinition | undefined => {
    if (id === "FRANDOLLE-HOST") return frandolleHostDef();
    if (id === "BRAVE-TOKEN") return braveTokenDef();
    return undefined;
  };

  it("symbol: 裏向き分身は付与元 (本体) のシンボル数 (赤2) を返す — 印字 (赤1) を漏らさない", () => {
    const state = makeFaceDownTokenState({ withGrant: true });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveSymbols(state, token, braveTokenDef(), getDef)).toEqual([
      "red",
      "red",
    ]);
    // バンドル合計 = 2 (ライフ減少数の根拠)
    const bundles = getEffectiveSymbolBundles(
      state,
      token,
      braveTokenDef(),
      getDef
    );
    expect(bundles.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it("symbol: 付与の無い裏向きカードは素性なし (シンボル 0)", () => {
    const state = makeFaceDownTokenState({ withGrant: false });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveSymbols(state, token, braveTokenDef(), getDef)).toEqual(
      []
    );
  });

  it("tribe: 裏向き分身は付与元の系統 (紅魔 含む) を返す", () => {
    const state = makeFaceDownTokenState({ withGrant: true });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveTribe(state, token, braveTokenDef(), getDef)).toBe(
      "幻想・紅魔・夜族"
    );
  });

  it("tribe: 付与の無い裏向きカードは系統なし ('')", () => {
    const state = makeFaceDownTokenState({ withGrant: false });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveTribe(state, token, braveTokenDef(), getDef)).toBe("");
  });

  it("category: 裏向きブレイヴ分身は act_as_spirit で spirit 扱い", () => {
    const state = makeFaceDownTokenState({ withGrant: true });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveCategory(state, token, braveTokenDef())).toBe("spirit");
  });

  it("オープン/デッキ等の表向きカード (faceDown=false) は zone を問わず印字素性を保持", () => {
    // 「オープン」= 公開 = faceDown:false。デッキの隠匿は zone でモデル化され faceDown ではない。
    // 系統指定で手札に加える等の参照が壊れないことを保証する。
    const deckCard = createCardInstance(braveTokenDef(), {
      instanceId: "deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
      faceDown: false,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, "player-2"] }),
      cardInstances: [deckCard],
      activeContinuousEffects: [],
    };
    // null 化ゲートは faceDown のみに依存 — 表向きなら deck でも印字素性を返す。
    expect(getEffectiveCategory(state, deckCard, braveTokenDef())).toBe(
      "brave"
    );
    expect(getEffectiveTribe(state, deckCard, braveTokenDef(), getDef)).toBe(
      "紅魔"
    );
  });

  it("category: 付与の無い裏向きカードは素性なし (getEffectiveCategory=undefined)", () => {
    const state = makeFaceDownTokenState({ withGrant: false });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveCategory(state, token, braveTokenDef())).toBeUndefined();
  });

  it("候補判定: 付与の無い裏向きカードは spirit にも brave にもマッチしない (印字 brave を漏らさない)", () => {
    const state = makeFaceDownTokenState({ withGrant: false });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(
      matchesCardFilter(
        token,
        braveTokenDef(),
        { category: ["spirit"] },
        { state }
      )
    ).toBe(false);
    // 印字は brave だが、裏向き素性なしなので brave フィルタにもマッチしない。
    expect(
      matchesCardFilter(
        token,
        braveTokenDef(),
        { category: ["brave"] },
        { state }
      )
    ).toBe(false);
  });

  it("候補判定: category=[spirit]+tribes=[紅魔] が裏向きブレイヴ分身にマッチ (core_move 配置先と同経路)", () => {
    const state = makeFaceDownTokenState({ withGrant: true });
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    const matched = matchesCardFilter(
      token,
      braveTokenDef(),
      { category: ["spirit"], tribes: ["紅魔"] },
      {
        state,
        effectiveTribes: getEffectiveTribe(
          state,
          token,
          braveTokenDef(),
          getDef
        )
          .split("・")
          .filter(Boolean),
      }
    );
    expect(matched).toBe(true);
  });

  it("印字効果抑止: 裏向きカードの印字継続効果 (symbol_add) は rebuild で登録されない", () => {
    const state = makeFaceDownTokenState({ withGrant: true });
    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    const tokenSymbolCEs = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "token-1" &&
        ce.modifierTag === "symbol_addition"
    );
    expect(tokenSymbolCEs).toHaveLength(0);
  });

  it("反例: 同じカードが表向きなら印字継続効果は rebuild で登録される", () => {
    const state = makeFaceDownTokenState({ withGrant: false });
    const faceUp: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "token-1" ? { ...c, faceDown: false } : c
      ),
    };
    const rebuilt = rebuildContinuousEffectsFromField(faceUp, getDef);
    const tokenSymbolCEs = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "token-1" &&
        ce.modifierTag === "symbol_addition"
    );
    expect(tokenSymbolCEs.length).toBeGreaterThan(0);
  });
});
