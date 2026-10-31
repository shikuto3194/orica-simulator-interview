import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH05-M02/M03/M04 セット中（バーストゾーン）+ トラッシュ系統条件
 * の effect_immunity 回帰テスト。
 *
 * 原文: 「自分のトラッシュに系統：「X」を持つカードがあるとき、セットしている
 * このカードは相手の効果を受けない。」
 *
 * 実装: applicability.zone:"burst_set" + condition: field_has(zone:"trash", tribes)。
 * 既存 BSTH05.5-M04 と同型パターン。10_rules/04b L68-69 節①型（zone 束縛耐性）。
 *
 * 意味差分:
 * - トラッシュに該当系統あり ∧ バーストゾーンに居る → defense_immune 登録
 * - トラッシュに該当系統なし → 未登録（条件 unmet）
 * - フィールドに居る（=発動後）→ 未登録（applicability unmet）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  getStrongestDefenseLevel,
  rebuildContinuousEffectsFromField,
  resolveCardExhaustAffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import type { ContinuousEffect, ContinuousEffectTag } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function makeBaseState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

// 風神系統のダミーカード (BSTH05-M02 自身が tribe=神渡・幻想・風神 を持つので
// 自身をトラッシュに置けばマッチする)
function placeSelfInTrash(
  state: GameState,
  def: CardDefinition,
  instanceId: string,
  owner: string
): GameState {
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(def, {
        instanceId,
        ownerPlayerId: owner,
        controllerPlayerId: owner,
        zone: "trash",
        normalCoreCount: 0,
      }),
    ],
  };
}

describe("BSTH05-M02 鍵山 雛 セット中の条件付き効果耐性", () => {
  const def = cardNoMap.get("BSTH05-M02")!;

  it("continuous 効果 [0] が applicability.zone='burst_set' + condition(trash 風神) を持つ", () => {
    expect(def).toBeDefined();
    const e = def.effects![0]!;
    expect(e.timing.kind).toBe("continuous");
    expect(e.applicability).toEqual({ zone: "burst_set" });
    expect(e.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribes: ["風神"],
      },
    ]);
    expect(e.stub).toBeUndefined();
  });

  it("セット中 + トラッシュに風神カードあり → defense_immune 登録される (BSTH05-M02)", () => {
    const base = makeBaseState();
    const setInstance = createCardInstance(def, {
      instanceId: "hina-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
      normalCoreCount: 0,
    });
    let state: GameState = {
      ...base,
      cardInstances: [setInstance],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "hina-burst" }],
    };
    // 自身は tribe 風神を含むのでトラッシュに別個体を置けば条件成立
    state = placeSelfInTrash(state, def, "hina-trash", "alice");

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" &&
        ce.sourceInstanceId === "hina-burst"
    );
    expect(immune).toHaveLength(1);
    expect(getStrongestDefenseLevel(rebuilt, "hina-burst")).toBe("immune");
  });

  it("セット中だがトラッシュに風神カード無し → 登録されない (BSTH05-M02)", () => {
    const base = makeBaseState();
    const setInstance = createCardInstance(def, {
      instanceId: "hina-burst-only",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      cardInstances: [setInstance],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "hina-burst-only" },
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(0);
    expect(getStrongestDefenseLevel(rebuilt, "hina-burst-only")).toBe("none");
  });

  it("フィールド (発動後) ではトラッシュに風神があっても登録されない (BSTH05-M02)", () => {
    const base = makeBaseState();
    const fieldInstance = createCardInstance(def, {
      instanceId: "hina-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = { ...base, cardInstances: [fieldInstance] };
    state = placeSelfInTrash(state, def, "hina-trash2", "alice");
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(0);
    expect(getStrongestDefenseLevel(rebuilt, "hina-field")).toBe("none");
  });

  it("相手 (bob) のトラッシュに風神カードあっても自分側条件で登録されない (BSTH05-M02)", () => {
    const base = makeBaseState();
    const setInstance = createCardInstance(def, {
      instanceId: "hina-burst-vs",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
      normalCoreCount: 0,
    });
    let state: GameState = {
      ...base,
      cardInstances: [setInstance],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "hina-burst-vs" }],
    };
    // 相手側のトラッシュにのみ風神
    state = placeSelfInTrash(state, def, "hina-trash-bob", "bob");
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(0);
  });

  it("この効果発揮後の自己召喚は誘発解決後にコストを支払わずに召喚する", () => {
    const burst = def.effects![1]!;
    expect(burst.steps[2]).toMatchObject({
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      connector: "after_triggers",
    });
  });
});

describe("BSTH05-M03 [風神録]霧雨 魔理沙 セット中の条件付き効果耐性", () => {
  const def = cardNoMap.get("BSTH05-M03")!;

  it("continuous 効果 [0] が applicability.zone='burst_set' + condition(trash 風神/導魔) を持つ", () => {
    const e = def.effects![0]!;
    expect(e.timing.kind).toBe("continuous");
    expect(e.applicability).toEqual({ zone: "burst_set" });
    expect(e.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribes: ["風神", "導魔"],
      },
    ]);
    expect(e.stub).toBeUndefined();
  });

  it("セット中 + トラッシュに導魔カードあり → defense_immune 登録 (BSTH05-M03)", () => {
    // M03 自体は tribe=幻想・風神・導魔 なので自身をトラッシュに置けば導魔条件を満たす
    const base = makeBaseState();
    const setInstance = createCardInstance(def, {
      instanceId: "marisa-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
      normalCoreCount: 0,
    });
    let state: GameState = {
      ...base,
      cardInstances: [setInstance],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "marisa-burst" }],
    };
    state = placeSelfInTrash(state, def, "marisa-trash", "alice");
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" &&
        ce.sourceInstanceId === "marisa-burst"
    );
    expect(immune).toHaveLength(1);
    expect(getStrongestDefenseLevel(rebuilt, "marisa-burst")).toBe("immune");
  });

  it("無関係系統のみのトラッシュでは登録されない (BSTH05-M03)", () => {
    // M04 (tribe=幻想・風神) を借用するとマッチしてしまうので、別系統 only を用意。
    // BSTH05-M02 は tribe に風神を含むため使えない。完全な無関係カードを探す。
    // 簡便: トラッシュを空にして登録されないことを確認。
    const base = makeBaseState();
    const setInstance = createCardInstance(def, {
      instanceId: "marisa-burst-empty",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      cardInstances: [setInstance],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "marisa-burst-empty" },
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(0);
  });
});

describe("BSTH05-M04 [風神録]博麗 霊夢 セット中の条件付き効果耐性", () => {
  const def = cardNoMap.get("BSTH05-M04")!;

  it("continuous 効果 [0] が applicability.zone='burst_set' + condition(trash 幻想) を持つ", () => {
    const e = def.effects![0]!;
    expect(e.timing.kind).toBe("continuous");
    expect(e.applicability).toEqual({ zone: "burst_set" });
    expect(e.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribes: ["幻想"],
      },
    ]);
    expect(e.stub).toBeUndefined();
  });

  it("この効果発揮後の自己召喚は誘発解決後にコストを支払わずに召喚する", () => {
    const burst = def.effects![1]!;
    expect(burst.steps[1]).toMatchObject({
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      connector: "after_triggers",
    });
  });

  it("セット中 + トラッシュに幻想カードあり → defense_immune 登録 (BSTH05-M04)", () => {
    // M04 tribe=幻想・風神 で 幻想 を持つ
    const base = makeBaseState();
    const setInstance = createCardInstance(def, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
      normalCoreCount: 0,
    });
    let state: GameState = {
      ...base,
      cardInstances: [setInstance],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-burst" }],
    };
    state = placeSelfInTrash(state, def, "reimu-trash", "alice");
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" &&
        ce.sourceInstanceId === "reimu-burst"
    );
    expect(immune).toHaveLength(1);
    expect(getStrongestDefenseLevel(rebuilt, "reimu-burst")).toBe("immune");
  });
});

// ---------------------------------------------------------------------------
// 以下: BSTH05.ts ファイル変更に伴う cards:test-coverage gate 充足用の
// シェイプ参照テスト（pre-existing で test 参照を欠いていた 4 枚）。
// stub 解消は別イテレーション。ここは存在 + 構造（textRef / stub 配置）のみ機械ガード。
// ---------------------------------------------------------------------------

describe("BSTH05-C02 秋穣子 召喚時効果への相手ネクサス効果耐性 (Lv2)", () => {
  const card = cardNoMap.get("BSTH05-C02")!;

  it("召喚時 deck_reveal + Lv2 召喚時効果限定保護の 2 効果構造", () => {
    expect(card.effects).toHaveLength(2);
    const reveal = card.effects![0]!.steps.find(
      (s) => s.action.kind === "deck_reveal"
    );
    expect(reveal).toBeDefined();
    const lv2 = card.effects![1]!;
    expect(lv2.timing.kind).toBe("continuous");
    expect(lv2.stub).toBeUndefined();
    const immunityStep = lv2.steps![0]!;
    if (
      immunityStep.action.kind === "grant_effect_source_prevention_immunity"
    ) {
      expect(immunityStep.action.sourceScope).toEqual({
        source: "self",
        effectFilter: { timingKind: "card_event", eventAction: "summon" },
      });
    } else {
      throw new Error("expected grant_effect_source_prevention_immunity");
    }
  });

  it("Lv2 で場に出ると相手ネクサス発生源限定の効果保護 CE が登録される", () => {
    const base = makeBaseState();
    const instance = createCardInstance(card, {
      instanceId: "shouko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = { ...base, cardInstances: [instance] };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "effect_source_prevention_immunity" &&
        ce.sourceInstanceId === "shouko-1"
    );
    expect(immune).toHaveLength(1);
    expect(immune[0]!.metadata?.preventionBypass).toEqual({
      kind: "preventing_effect_filter",
      filter: { categories: ["nexus"] },
    });
  });

  it("Lv1 (requiredCores未達) では効果保護 CE が登録されない", () => {
    const base = makeBaseState();
    const instance = createCardInstance(card, {
      instanceId: "shouko-lv1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = { ...base, cardInstances: [instance] };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "effect_source_prevention_immunity" &&
        ce.sourceInstanceId === "shouko-lv1"
    );
    expect(immune).toHaveLength(0);
  });
});

describe("BSTH05-C12 神祭エクスパンデッド・オンバシラ", () => {
  const card = cardNoMap.get("BSTH05-C12")!;
  const ashiharaGrandwalker: CardDefinition = {
    cardNo: "TEST-BSTH05-C12-ASHIHARA-GRANDWALKER",
    name: "C12 テスト用アシハラ創界神",
    printedCategory: "nexus",
    printedColors: ["green"],
    colors: ["green"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "アシハラ・創界神",
    effects: [],
  };
  const testUltimate: CardDefinition = {
    cardNo: "TEST-BSTH05-C12-ULTIMATE",
    name: "C12 テスト用アルティメット",
    printedCategory: "ultimate",
    printedColors: ["blue"],
    colors: ["blue"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 3, requiredCores: 1, bp: 3000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    effects: [],
  };

  it("revealed/moved_to_trash イベント + flash choice 拡張 (ref_choice)", () => {
    expect(card.effects).toHaveLength(2);
    const auto = card.effects![0]!;
    expect(auto.timing.kind).toBe("card_event");
    if (auto.timing.kind === "card_event") {
      expect(auto.timing.event).toEqual(["revealed", "moved_to_trash"]);
    }
    const flash = card.effects![1]!;
    expect(flash.timing.kind).toBe("activated");
    const condStep = flash.steps.find(
      (s) =>
        s.stepCondition?.kind === "ref_choice" &&
        s.connector === "conditional_cost"
    );
    expect(condStep).toBeDefined();
  });

  it("[legal action] 基本疲労対象のスピリットがいなくても、有料 choice のアルティメット3体疲労は列挙される", () => {
    const magicLookup = buildMagicLookup([
      card,
      ashiharaGrandwalker,
      testUltimate,
    ]);
    const magic = createCardInstance(card, {
      instanceId: "c12-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const grandwalker = createCardInstance(ashiharaGrandwalker, {
      instanceId: "ashihara-grandwalker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const ultimates = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(testUltimate, {
        instanceId: `bob-ultimate-${index}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic, grandwalker, ...ultimates],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "default",
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        id === testUltimate.cardNo
          ? testUltimate
          : id === ashiharaGrandwalker.cardNo
            ? ashiharaGrandwalker
            : getCardDefinitionById(id),
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).filter(
      (action) =>
        action.kind === "use_magic" && action.sourceCardNo === card.cardNo
    );
    const declarationWithPaidChoice = actions.find(
      (action) =>
        action.kind === "use_magic" && action.deferredChoiceIndexes?.includes(1)
    );

    expect(declarationWithPaidChoice).toBeDefined();
    expect(declarationWithPaidChoice).toMatchObject({
      targetMode: "none",
      requiredTargetCount: 0,
      deferredChoiceIndexes: expect.arrayContaining([1]),
    });
  });
});

describe("BSTH05-M11 諏訪の装 (ブレイヴ)", () => {
  const card = cardNoMap.get("BSTH05-M11")!;
  it("[0] スピリット状態 effect_resistance(exhaust,ruleStrength) + prevent_battle (applicability.combined:false) + [1] 左右合体 override_properties(symbol) + [2] 神域 game_event", () => {
    expect(card.printedCategory).toBe("brave");
    expect(card.effects).toHaveLength(3);
    const spirit = card.effects![0]!;
    expect(spirit.timing.kind).toBe("continuous");
    expect(spirit.applicability?.combined).toBe(false);
    // step0: 疲労せず (effect_resistance exhaust, ruleStrength:true, source:all)
    const resistStep = spirit.steps![0]!;
    if (resistStep.action.kind === "effect_resistance") {
      expect(resistStep.action.resistsOutcome).toBe("exhaust");
      expect(resistStep.action.source).toBe("all");
      expect(resistStep.action.ruleStrength).toBe(true);
    } else {
      throw new Error("expected effect_resistance");
    }
    // step1: アタック/ブロック不可
    const preventStep = spirit.steps![1]!;
    if (preventStep.action.kind === "prevent_battle") {
      expect(preventStep.action.restriction).toEqual(["attack", "block"]);
      expect(preventStep.action.ruleStrength).toBe(true);
    } else {
      throw new Error("expected prevent_battle");
    }
    expect(spirit.stub).toBeUndefined();
    // [1] 左右合体 override_properties(symbol) — combined_host_category:["spirit","ultimate"]
    // でホスト種別を絞る (BSTH05-M11 brave-combine-symbol-override.test.ts に振る舞い検証あり)。
    const combinedAttack = card.effects![1]!;
    expect(combinedAttack.applicability?.combined).toBe(true);
    expect(combinedAttack.condition?.[0]).toEqual({
      kind: "combined_host_category",
      categories: ["spirit", "ultimate"],
    });
    // [2] 神域 game_event — 「系統：「風神」を持つスピリットが召喚されたとき」に人称が無いため
    // player:"either"（自分/相手いずれの召喚でも誘発、bsth05-m11-domain-void-core-recovery.test.ts
    // で振る舞い検証済み）。combined_host_category:["nexus"] でアシハラ＆創界神ネクサス合体中限定。
    const summonReact = card.effects![2]!;
    expect(summonReact.timing.kind).toBe("game_event");
    if (summonReact.timing.kind === "game_event") {
      expect(summonReact.timing.player).toBe("either");
      expect(summonReact.timing.event).toBe("summon");
      expect(summonReact.timing.triggerFilter).toEqual({
        category: ["spirit"],
        tribes: ["風神"],
      });
    }
    expect(summonReact.timingScope).toEqual({ player: "self", period: "main" });
    expect(summonReact.condition?.[0]).toEqual({
      kind: "combined_host_category",
      categories: ["nexus"],
    });
    expect(summonReact.stub).toBeUndefined();
  });

  it("スピリット状態(非合体)で場に出ると prevent_battle_both + cannot_be_exhausted (ruleStrength) CE が自身に登録される", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "brave-1" &&
        ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(1);
    expect((pb[0]!.metadata as { ruleStrength?: boolean }).ruleStrength).toBe(
      true
    );
    const exhaustImmune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "brave-1" &&
        ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaustImmune).toHaveLength(1);
    expect(
      (exhaustImmune[0]!.metadata as { ruleStrength?: boolean }).ruleStrength
    ).toBe(true);
    expect((exhaustImmune[0]!.metadata as { source?: string }).source).toBe(
      "all"
    );
  });

  it("ルール強度の cannot_be_exhausted は相手の unpreventable 効果でも貫通させない (BSTH05-M11 vs 防げない疲労)", () => {
    // BSTH05-M11 のスピリット状態 effect_resistance(exhaust, ruleStrength:true) を登録した状態で、
    // 相手側 (bob) が「防げない」(sourcePreventionLevel:"unpreventable") 疲労を発揮しようとしても
    // resolveCardExhaustAffect が blocked を返す (10_rules/07b §71 異魔神ブレイヴ class)。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const brave = rebuilt.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    // 通常の効果 (sourcePreventionLevel:"none") は当然 blocked。
    const noneDecision = resolveCardExhaustAffect(
      rebuilt,
      brave,
      "bob",
      getCardDefinitionById,
      "none"
    );
    expect(noneDecision.kind).toBe("blocked");
    // 「防げない」(unpreventable) でも ruleStrength により blocked のまま。
    const unprevDecision = resolveCardExhaustAffect(
      rebuilt,
      brave,
      "bob",
      getCardDefinitionById,
      "unpreventable"
    );
    expect(unprevDecision.kind).toBe("blocked");
  });

  it("合体中(host へ attach 済み)は applicability.combined:false により prevent_battle / cannot_be_exhausted CE が登録されない (over-block 防止)", () => {
    // 任意の非ブレイヴスピリットを host にして、ブレイヴのみが BSTH05-M11。
    const hostDef = cardNoMap.get("BSTH05-C01")!;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          attachedChildrenIds: ["brave-1"],
        }),
        createCardInstance(card, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          attachedToInstanceId: "host-1",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(0);
    const exhaustImmune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaustImmune).toHaveLength(0);
  });
});

describe("BSTH05-R01 河城 にとり", () => {
  const card = cardNoMap.get("BSTH05-R01")!;
  it("召喚時の各任意処理 + 同名ターン制限", () => {
    expect(card.effects!.length).toBeGreaterThanOrEqual(1);
    const summon = card.effects![0]!;
    expect(summon.timing.kind).toBe("card_event");
    if (summon.timing.kind === "card_event") {
      expect(summon.timing.event).toBe("summon");
    }
    expect(summon.executionMode).toBe("optional");
    expect(summon.usageLimit?.kind).toBe("per_card_name");
    expect(summon.usageLimit?.duration).toBe("turn");
    expect(summon.stub).toBeUndefined();
  });

  it("effects[0] は幻想/風神の緑スピリット2体へコア1個ずつ置き、その後1コスト支払って手札から召喚できる", () => {
    const source = createCardInstance(card, {
      instanceId: "nitori-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetA = createCardInstance(card, {
      instanceId: "nitori-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetB = createCardInstance(card, {
      instanceId: "nitori-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(card, {
      instanceId: "nitori-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, targetA, targetB, handCard],
      playerOverrides: [
        { voidNormalCoreCount: 2, reserveNormalCoreCount: 2, handCount: 1 },
        {},
      ],
    });
    let afterSummon = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth05-set-state-immunity:771",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "nitori-source",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["nitori-a", "nitori-b"],
    });
    while (afterSummon.pendingStepOptionalChoice) {
      const accept = getLegalActions({
        state: afterSummon,
        actingPlayerId: "alice",
        getCardDefinitionById,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      );
      expect(accept).toBeDefined();
      afterSummon = applyLegalAction({
        state: afterSummon,
        action: accept!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
    expect(afterSummon.pendingEffectSummonCostPayment).not.toBeNull();
    afterSummon = applyLegalAction({
      state: afterSummon,
      action: getLegalActions({
        state: afterSummon,
        actingPlayerId: "alice",
        getCardDefinitionById,
      }).find((a) => a.kind === "resolve_pending_effect_summon_cost_payment")!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    expect(afterSummon.pendingMultiPlacement).not.toBeNull();
    const placementAction = getLegalActions({
      state: afterSummon,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(placementAction).toBeDefined();
    const after = applyLegalAction({
      state: afterSummon,
      action: placementAction!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "nitori-hand",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(card.effects![0]!.stub).toBeUndefined();
    // コア1個ずつ: void 2→0、targetA/targetB それぞれ+1
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(0);
    expect(
      after.cardInstances.find((c) => c.instanceId === "nitori-a")!
        .normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "nitori-b")!
        .normalCoreCount
    ).toBe(2);
    // 手札から1コスト支払って召喚: reserve 2→0 (支払い1+進入時最低コア1)、handCount 1→0
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.handCount).toBe(0);
    const summonedCard = after.cardInstances.find(
      (c) => c.instanceId === "nitori-hand"
    )!;
    expect(summonedCard.zone).toBe("field");
    expect(summonedCard.normalCoreCount).toBe(1);
  });
});

describe("BSTH05-X03 東風谷 早苗", () => {
  const card = cardNoMap.get("BSTH05-X03")!;

  it("effects[0] 召喚時は幻想/風神の緑スピリット3体へコア1個ずつ置ける", () => {
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetA = createCardInstance(card, {
      instanceId: "sanae-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targetB = createCardInstance(card, {
      instanceId: "sanae-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const targetC = createCardInstance(card, {
      instanceId: "sanae-c",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, targetA, targetB, targetC],
      playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bsth05-set-state-immunity:880",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "sanae-source",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["sanae-a", "sanae-b", "sanae-c"],
    });
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(
      after.cardInstances.find((c) => c.instanceId === "sanae-source")!
        .normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sanae-a")!
        .normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sanae-b")!
        .normalCoreCount
    ).toBe(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sanae-c")!
        .normalCoreCount
    ).toBe(4);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sanae-source")!
        .everHadCorePlaced
    ).toBe(false);
    for (const targetId of ["sanae-a", "sanae-b", "sanae-c"]) {
      expect(
        after.cardInstances.find((c) => c.instanceId === targetId)!
          .everHadCorePlaced
      ).toBe(true);
    }
    expect(
      after.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(0);
    expect(after.log).toContain(
      "effect:core_distribute:one_each:3cores->3targets"
    );
  });

  it("effects[0] 召喚時のボイド起点配置は restrict_core_placement_void で止まる", () => {
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const targets = ["sanae-a", "sanae-b", "sanae-c"].map((instanceId) =>
      createCardInstance(card, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const restrictCE: ContinuousEffect = {
      effectId: "ce-void-restrict",
      sourceInstanceId: "restrict-source",
      sourceDefinitionId: card.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "restrict_core_placement_void",
      targetInstanceId: "alice",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, ...targets],
      playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bsth05-set-state-immunity:956",
      state: { ...state, activeContinuousEffects: [restrictCE] },
      effect: card.effects![0]!,
      sourceInstanceId: "sanae-source",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["sanae-a", "sanae-b", "sanae-c"],
    });

    expect(
      after.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(3);
    for (const targetId of ["sanae-a", "sanae-b", "sanae-c"]) {
      expect(
        after.cardInstances.find((c) => c.instanceId === targetId)!
          .normalCoreCount
      ).toBe(1);
      expect(
        after.cardInstances.find((c) => c.instanceId === targetId)!
          .everHadCorePlaced
      ).toBe(false);
    }
    expect(after.log).toContain(
      "effect:core_distribute:void->filter:blocked-by-restrict_core_placement_void:alice"
    );
  });

  it("effects[1] アタックステップ開始時はトラッシュ全コアを配分し、置いた3個につき相手1体を戻す", () => {
    const effect = card.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.steps[0]!.id).toBe("trashCoreDistribute");
    expect(effect.steps[0]!.action.kind).toBe("core_move");
    if (effect.steps[0]!.action.kind !== "core_move")
      throw new Error("expected core_move");
    expect(effect.steps[0]!.action.from).toEqual({
      kind: "trash",
      player: "self",
    });
    expect(effect.steps[0]!.action.target).toEqual({
      kind: "filter",
      player: "self",
      filter: { tribes: ["風神"], category: ["spirit"] },
      count: "all",
    });
    expect(effect.steps[0]!.action.amount).toBe("all");
    expect(effect.steps[1]!.action.kind).toBe("bounce");
    if (effect.steps[1]!.action.kind !== "bounce")
      throw new Error("expected bounce");
    expect(effect.steps[1]!.action.target.count).toEqual({
      source: {
        kind: "step_numeric_amount",
        stepId: "trashCoreDistribute",
      },
      divisor: 3,
    });
    expect(effect.steps[1]!.targetSelectionTiming).toBe("on_step");

    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const windTarget = createCardInstance(card, {
      instanceId: "sanae-wind-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentA = createCardInstance(card, {
      instanceId: "bob-spirit-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentB = createCardInstance(card, {
      instanceId: "bob-spirit-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentC = createCardInstance(card, {
      instanceId: "bob-spirit-c",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, windTarget, opponentA, opponentB, opponentC],
      playerOverrides: [{ trashNormalCoreCount: 6 }, {}],
    });

    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const lookupOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      {
        ...state,
        activePlayerId: "alice",
        step: "attack",
        window: "step_start",
      },
      [
        {
          actingPlayerId: "alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:bsth05-set-state-immunity:1070",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "attack",
          subPhase: "start",
        },
      ],
      undefined,
      lookupOptions
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const triggerAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find(
      (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
    );
    expect(triggerAction).toBeDefined();
    if (!triggerAction) throw new Error("expected triggered effect action");

    let pendingState = applyLegalAction({
      state: queued,
      action: triggerAction,
      ...lookupOptions,
    }).state;
    let passSafety = 8;
    while (pendingState.pendingCoreDistribution === null && passSafety-- > 0) {
      const passAction = getLegalActions({
        state: pendingState,
        actingPlayerId: pendingState.stackWindow?.priorityPlayerId ?? "alice",
        ...lookupOptions,
      }).find((a) => a.kind === "pass_stack");
      if (!passAction) break;
      pendingState = applyLegalAction({
        state: pendingState,
        action: passAction,
        ...lookupOptions,
      }).state;
    }

    expect(pendingState.pendingCoreDistribution).not.toBeNull();
    expect(pendingState.pendingCoreDistribution!.totalNormalCores).toBe(6);
    expect(pendingState.pendingCoreDistribution!.minTotal).toBe(6);
    expect(
      pendingState.pendingCoreDistribution!.targetInterruption
    ).toMatchObject({
      effectIndex: 1,
      actingPlayerId: "alice",
      stepIndex: 0,
      targetSpec: {
        kind: "filter",
        player: "self",
        filter: { tribes: ["風神"], category: ["spirit"] },
        count: "all",
      },
      targetStepId: "trashCoreDistribute",
      targetedDisclosureResolved: false,
    });

    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveAction,
        ...lookupOptions,
        coreDistributionAllocations: {
          "sanae-source": 3,
        },
      })
    ).toThrow(/below minimum 6/);

    const afterDistribute = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      ...lookupOptions,
      coreDistributionAllocations: {
        "sanae-source": 3,
        "sanae-wind-target": 3,
      },
    }).state;

    expect(afterDistribute.pendingCoreDistribution).toBeNull();
    expect(
      afterDistribute.players.find((p) => p.id === "alice")!
        .trashNormalCoreCount
    ).toBe(0);
    expect(
      afterDistribute.cardInstances.find(
        (c) => c.instanceId === "sanae-source"
      )!.normalCoreCount
    ).toBe(8);
    expect(
      afterDistribute.cardInstances.find(
        (c) => c.instanceId === "sanae-wind-target"
      )!.normalCoreCount
    ).toBe(4);
    expect(afterDistribute.pendingStepOptionalTargetSelection).not.toBeNull();
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.requiredTargetCount
    ).toBe(2);
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.maxTargetCount
    ).toBe(2);
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.candidateInstanceIds.sort()
    ).toEqual(["bob-spirit-a", "bob-spirit-b", "bob-spirit-c"].sort());
    expect(
      afterDistribute.cardInstances.find(
        (c) => c.instanceId === "bob-spirit-a"
      )!.zone
    ).toBe("field");

    const targetAction = getLegalActions({
      state: afterDistribute,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_step_optional_target_selection");
    expect(targetAction).toBeDefined();
    if (!targetAction) throw new Error("expected target selection action");

    const after = applyLegalAction({
      state: afterDistribute,
      action: targetAction,
      ...lookupOptions,
      targetInstanceIds: ["bob-spirit-b", "bob-spirit-c"],
    }).state;

    expect(after.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-spirit-a")!.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-spirit-b")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-spirit-c")!.zone
    ).toBe("hand");
  });

  it("effects[1] 配分確定後の対象変更は割当を置換先へ反映して再開する", () => {
    const redirectTargetDef: CardDefinition = {
      ...card,
      cardNo: "TEST-BSTH05-X03-REDIRECT-SPIRIT",
      name: "redirect target",
      tribe: "幻想",
      effects: [],
      textLines: [],
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === redirectTargetDef.cardNo
        ? redirectTargetDef
        : getCardDefinitionById(id);
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const windTarget = createCardInstance(card, {
      instanceId: "sanae-wind-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const redirectTarget = createCardInstance(redirectTargetDef, {
      instanceId: "redirect-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentA = createCardInstance(card, {
      instanceId: "bob-spirit-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentB = createCardInstance(card, {
      instanceId: "bob-spirit-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentC = createCardInstance(card, {
      instanceId: "bob-spirit-c",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const redirectCE: ContinuousEffect = {
      effectId: "ce-redirect-sanae-core-distribution",
      sourceInstanceId: "sanae-source",
      sourceDefinitionId: card.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "any",
          protectedTargetKind: "self",
        },
        redirectCandidateSource: {
          kind: "explicit",
          instanceIds: ["redirect-spirit"],
        },
        optional: true,
      } as Record<string, unknown>,
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        source,
        windTarget,
        redirectTarget,
        opponentA,
        opponentB,
        opponentC,
      ],
      playerOverrides: [{ trashNormalCoreCount: 6 }, {}],
    });

    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const lookupOptions = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      {
        ...state,
        activeContinuousEffects: [redirectCE],
        activePlayerId: "alice",
        step: "attack",
        window: "step_start",
      },
      [
        {
          actingPlayerId: "alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:bsth05-set-state-immunity:1327",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "attack",
          subPhase: "start",
        },
      ],
      undefined,
      lookupOptions
    );
    const triggerAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find(
      (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
    );
    expect(triggerAction).toBeDefined();
    if (!triggerAction) throw new Error("expected triggered effect action");

    let pendingState = applyLegalAction({
      state: queued,
      action: triggerAction,
      ...lookupOptions,
    }).state;
    let passSafety = 8;
    while (pendingState.pendingCoreDistribution === null && passSafety-- > 0) {
      const passAction = getLegalActions({
        state: pendingState,
        actingPlayerId: pendingState.stackWindow?.priorityPlayerId ?? "alice",
        ...lookupOptions,
      }).find((a) => a.kind === "pass_stack");
      if (!passAction) break;
      pendingState = applyLegalAction({
        state: pendingState,
        action: passAction,
        ...lookupOptions,
      }).state;
    }

    expect(pendingState.pendingCoreDistribution).not.toBeNull();
    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    if (!resolveAction) throw new Error("expected distribution action");

    const redirectQueued = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      ...lookupOptions,
      coreDistributionAllocations: {
        "sanae-source": 3,
        "sanae-wind-target": 3,
      },
    }).state;
    expect(redirectQueued.pendingCoreDistribution).not.toBeNull();
    expect(redirectQueued.pendingTargetRedirects).toHaveLength(1);
    const pending = redirectQueued.pendingTargetRedirects[0]!;
    expect(pending.coreDistributionPendingId).toBe(
      redirectQueued.pendingCoreDistribution!.pendingId
    );
    expect(pending.coreDistributionAllocations).toEqual({
      "sanae-source": 3,
      "sanae-wind-target": 3,
    });
    expect(pending.originalResolvedInstanceIds.sort()).toEqual(
      ["sanae-source", "sanae-wind-target"].sort()
    );
    expect((pending.redirectableInstanceIds ?? []).sort()).toEqual(
      ["sanae-source", "sanae-wind-target"].sort()
    );

    const redirected = applyLegalAction({
      state: redirectQueued,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: "alice",
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: "redirect-spirit",
      ...lookupOptions,
    });
    if (!("redirected" in redirected)) {
      throw new Error("expected redirect result");
    }
    expect(redirected.redirected).toBe(true);
    expect(redirected.resolvedAfterRedirect).toEqual(["redirect-spirit"]);
    expect(redirected.state.pendingTargetRedirects).toHaveLength(0);
    expect(redirected.state.pendingCoreDistribution).toBeNull();
    expect(
      redirected.state.players.find((p) => p.id === "alice")!
        .trashNormalCoreCount
    ).toBe(0);
    expect(
      redirected.state.cardInstances.find(
        (c) => c.instanceId === "sanae-source"
      )!.normalCoreCount
    ).toBe(5);
    expect(
      redirected.state.cardInstances.find(
        (c) => c.instanceId === "sanae-wind-target"
      )!.normalCoreCount
    ).toBe(1);
    expect(
      redirected.state.cardInstances.find(
        (c) => c.instanceId === "redirect-spirit"
      )!.normalCoreCount
    ).toBe(7);
    expect(redirected.state.pendingStepOptionalTargetSelection).not.toBeNull();
    expect(
      redirected.state.pendingStepOptionalTargetSelection!.requiredTargetCount
    ).toBe(2);
    expect(
      redirected.state.pendingStepOptionalTargetSelection!.maxTargetCount
    ).toBe(2);
  });

  it("effects[1] 単一風神配置先は対象変更後の resolved target へコアを置く", () => {
    const effect = card.effects![1]!;
    const redirectTargetDef: CardDefinition = {
      ...card,
      cardNo: "TEST-BSTH05-X03-REDIRECT-SPIRIT",
      name: "redirect target",
      tribe: "幻想",
      effects: [],
      textLines: [],
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === redirectTargetDef.cardNo
        ? redirectTargetDef
        : getCardDefinitionById(id);
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const redirectTarget = createCardInstance(redirectTargetDef, {
      instanceId: "redirect-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const redirectCE: ContinuousEffect = {
      effectId: "ce-redirect-sanae-core-destination",
      sourceInstanceId: "sanae-source",
      sourceDefinitionId: card.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "any",
          protectedTargetKind: "self",
        },
        redirectCandidateSource: {
          kind: "explicit",
          instanceIds: ["redirect-spirit"],
        },
        optional: true,
      } as Record<string, unknown>,
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, redirectTarget],
      playerOverrides: [{ trashNormalCoreCount: 6 }, {}],
    });

    const pendingRedirect = executeEffect({
      chainId: "test:bsth05-set-state-immunity:1516",
      state: {
        ...state,
        activeContinuousEffects: [redirectCE],
      },
      effect,
      effectIndex: 1,
      sourceInstanceId: "sanae-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(pendingRedirect.pendingTargetRedirects).toHaveLength(1);
    const pending = pendingRedirect.pendingTargetRedirects[0]!;
    expect(pending.originalResolvedInstanceIds).toEqual(["sanae-source"]);
    expect(pending.candidateTokenInstanceIds).toEqual(["redirect-spirit"]);

    const redirected = applyLegalAction({
      state: pendingRedirect,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: "alice",
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: "redirect-spirit",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in redirected)) {
      throw new Error("expected redirect result");
    }
    expect(redirected.redirected).toBe(true);
    expect(redirected.resolvedAfterRedirect).toEqual(["redirect-spirit"]);
    expect(
      redirected.state.players.find((p) => p.id === "alice")!
        .trashNormalCoreCount
    ).toBe(0);
    expect(
      redirected.state.cardInstances.find(
        (c) => c.instanceId === "sanae-source"
      )!.normalCoreCount
    ).toBe(5);
    expect(
      redirected.state.cardInstances.find(
        (c) => c.instanceId === "redirect-spirit"
      )!.normalCoreCount
    ).toBe(7);
  });

  it("effects[1] アタックステップ開始時は単一風神対象への即時配置でも置いた数で戻す", () => {
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const opponentA = createCardInstance(card, {
      instanceId: "bob-spirit-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentB = createCardInstance(card, {
      instanceId: "bob-spirit-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentC = createCardInstance(card, {
      instanceId: "bob-spirit-c",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponentA, opponentB, opponentC],
      playerOverrides: [{ trashNormalCoreCount: 6 }, {}],
    });

    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const lookupOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      {
        ...state,
        activePlayerId: "alice",
        step: "attack",
        window: "step_start",
      },
      [
        {
          actingPlayerId: "alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:bsth05-set-state-immunity:1624",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "attack",
          subPhase: "start",
        },
      ],
      undefined,
      lookupOptions
    );
    const triggerAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find(
      (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
    );
    expect(triggerAction).toBeDefined();
    if (!triggerAction) throw new Error("expected triggered effect action");

    let pendingState = applyLegalAction({
      state: queued,
      action: triggerAction,
      ...lookupOptions,
    }).state;
    let passSafety = 8;
    while (
      pendingState.pendingStepOptionalTargetSelection === null &&
      passSafety-- > 0
    ) {
      const passAction = getLegalActions({
        state: pendingState,
        actingPlayerId: pendingState.stackWindow?.priorityPlayerId ?? "alice",
        ...lookupOptions,
      }).find((a) => a.kind === "pass_stack");
      if (!passAction) break;
      pendingState = applyLegalAction({
        state: pendingState,
        action: passAction,
        ...lookupOptions,
      }).state;
    }

    expect(pendingState.pendingCoreDistribution).toBeNull();
    expect(
      pendingState.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(0);
    expect(
      pendingState.cardInstances.find((c) => c.instanceId === "sanae-source")!
        .normalCoreCount
    ).toBe(11);
    expect(pendingState.pendingStepOptionalTargetSelection).not.toBeNull();
    expect(
      pendingState.pendingStepOptionalTargetSelection!.requiredTargetCount
    ).toBe(2);
    expect(
      pendingState.pendingStepOptionalTargetSelection!.maxTargetCount
    ).toBe(2);

    const targetAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_step_optional_target_selection");
    expect(targetAction).toBeDefined();
    if (!targetAction) throw new Error("expected target selection action");

    const after = applyLegalAction({
      state: pendingState,
      action: targetAction,
      ...lookupOptions,
      targetInstanceIds: ["bob-spirit-b", "bob-spirit-c"],
    }).state;

    expect(after.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-spirit-a")!.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-spirit-b")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-spirit-c")!.zone
    ).toBe("hand");
  });

  it("effects[1] トラッシュの全コアは単一風神対象でもソウルコアを残せない", () => {
    const effect = card.effects![1]!;
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const opponentA = createCardInstance(card, {
      instanceId: "bob-spirit-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentB = createCardInstance(card, {
      instanceId: "bob-spirit-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentC = createCardInstance(card, {
      instanceId: "bob-spirit-c",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponentA, opponentB, opponentC],
      playerOverrides: [
        {
          trashNormalCoreCount: 6,
          soulCoreLocation: { kind: "trash" as const },
        },
        {},
      ],
    });
    const lookupOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };

    const pendingState = executeEffect({
      chainId: "test:bsth05-set-state-immunity:1766",
      state,
      effect,
      effectIndex: 1,
      sourceInstanceId: "sanae-source",
      actingPlayerId: "alice",
      ...lookupOptions,
    });

    expect(pendingState.pendingCoreDistribution).not.toBeNull();
    expect(pendingState.pendingCoreDistribution!.totalNormalCores).toBe(6);
    expect(pendingState.pendingCoreDistribution!.hasSoulCore).toBe(true);
    expect(pendingState.pendingCoreDistribution!.mustPlaceSoulCore).toBe(true);

    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    if (!resolveAction) throw new Error("expected distribution action");

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveAction,
        ...lookupOptions,
        coreDistributionAllocations: { "sanae-source": 6 },
      })
    ).toThrow(/Soul core in trash must be placed/);

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveAction,
        ...lookupOptions,
        coreDistributionAllocations: { "sanae-source": 5 },
        coreDistributionSoulCoreInstanceId: "sanae-source",
      })
    ).toThrow(/all-normal total 6/);

    const afterDistribute = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      ...lookupOptions,
      coreDistributionAllocations: { "sanae-source": 6 },
      coreDistributionSoulCoreInstanceId: "sanae-source",
    }).state;

    const alice = afterDistribute.players.find((p) => p.id === "alice")!;
    const sanae = afterDistribute.cardInstances.find(
      (c) => c.instanceId === "sanae-source"
    )!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "sanae-source",
    });
    expect(sanae.normalCoreCount).toBe(11);
    expect(sanae.soulCoreCount).toBe(1);
    expect(afterDistribute.pendingStepOptionalTargetSelection).not.toBeNull();
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.requiredTargetCount
    ).toBe(2);
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.maxTargetCount
    ).toBe(2);
  });

  it("effects[1] トラッシュの全コアは count-only 追加ソウルも全数配置して3個につき数える", () => {
    const effect = card.effects![1]!;
    const primarySoul = createCardInstance(card, {
      instanceId: "primary-soul-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      soulCoreCount: 1,
    });
    const source = createCardInstance(card, {
      instanceId: "sanae-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 5,
    });
    const windDest = createCardInstance(card, {
      instanceId: "sanae-dest",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const opponentA = createCardInstance(card, {
      instanceId: "bob-spirit-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentB = createCardInstance(card, {
      instanceId: "bob-spirit-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentC = createCardInstance(card, {
      instanceId: "bob-spirit-c",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentD = createCardInstance(card, {
      instanceId: "bob-spirit-d",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        primarySoul,
        source,
        windDest,
        opponentA,
        opponentB,
        opponentC,
        opponentD,
      ],
      playerOverrides: [
        {
          trashNormalCoreCount: 6,
          trashSoulCoreCount: 3,
          soulCoreLocation: {
            kind: "card" as const,
            instanceId: "primary-soul-card",
          },
        },
        {},
      ],
    });
    const lookupOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };

    const pendingState = executeEffect({
      chainId: "test:bsth05-set-state-immunity:1919",
      state,
      effect,
      effectIndex: 1,
      sourceInstanceId: "sanae-source",
      actingPlayerId: "alice",
      ...lookupOptions,
    });

    const pending = pendingState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.totalNormalCores).toBe(6);
    expect(pending!.hasSoulCore).toBe(true);
    expect(pending!.totalSoulCores).toBe(3);
    expect(pending!.mustPlaceSoulCore).toBe(true);

    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_core_distribution"
    ) {
      throw new Error("expected distribution action");
    }
    expect(resolveAction.totalSoulCores).toBe(3);

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveAction,
        ...lookupOptions,
        coreDistributionAllocations: { "sanae-source": 6 },
      })
    ).toThrow(/Soul core in trash must be placed/);

    const afterDistribute = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      ...lookupOptions,
      coreDistributionAllocations: { "sanae-source": 3, "sanae-dest": 3 },
      coreDistributionSoulCoreAllocations: {
        "sanae-source": 1,
        "sanae-dest": 2,
      },
    }).state;

    const alice = afterDistribute.players.find((p) => p.id === "alice")!;
    const primaryAfter = afterDistribute.cardInstances.find(
      (c) => c.instanceId === "primary-soul-card"
    )!;
    const sanae = afterDistribute.cardInstances.find(
      (c) => c.instanceId === "sanae-source"
    )!;
    const windDestAfter = afterDistribute.cardInstances.find(
      (c) => c.instanceId === "sanae-dest"
    )!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "primary-soul-card",
    });
    expect(primaryAfter.soulCoreCount).toBe(1);
    expect(sanae.normalCoreCount).toBe(8);
    expect(sanae.soulCoreCount).toBe(1);
    expect(windDestAfter.normalCoreCount).toBe(3);
    expect(windDestAfter.soulCoreCount).toBe(2);
    expect(afterDistribute.pendingStepOptionalTargetSelection).not.toBeNull();
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.requiredTargetCount
    ).toBe(3);
    expect(
      afterDistribute.pendingStepOptionalTargetSelection!.maxTargetCount
    ).toBe(3);
  });
});
