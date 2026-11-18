/**
 * engine batch2-1 再変換カードの統合テスト。
 *
 * 新エンジン能力（多色 treat_as の asColor 配列 / CardFilter.maxCores）で
 * stub を外したカードが、効果実行後の盤面に正しく反映されることを検証する。
 *
 * 検証の組み立て:
 * - maxCores の対象限定は **候補列挙経路**（getCandidateTargetInstanceIds）で確認する。
 *   これが production GUI が対象ピックに使う経路で、matchesCardFilter に coreCount
 *   (soul 含む合計コア) を注入して「コアN個以下」を正しく絞る。
 * - 破壊本体 + ref_succeeded 連動（破壊したとき相手ライフ→リザーブ）は、GUI が
 *   絞り込んだ候補をユーザーが選んだ状況を targetInstanceIds で再現し、executeEffect
 *   の最終盤面で確認する（pending を解決し切ってから assert）。
 * - 多色 treat_as は getEffectiveSymbolBundles に全色が反映されることを確認する。
 *
 * 注: この統合テストでは GUI 候補列挙経路を主対象にし、auto-pick 経路の
 *     maxCores/minCores は effect-interpreter.test 側の専用回帰で見る。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveSymbolBundles,
} from "../src";
import {
  getTotalCoresOnCardById,
  withSoulCoreLocation,
} from "../src/core/core-system";
import {
  expandCardDefinitionsWithBackFaces,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../src";

// 転醒 B 面は backFace にネストされ generated-index には出ないため、
// production と同じ expand を通して (B) cardNo を引けるようにする。
const EXPANDED = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  EXPANDED.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

/** card_event:["rebirth","attack"] の転醒/アタック時 destroy 効果を取り出す。 */
function rebirthAttackEffect(card: CardDefinition) {
  return card.effects!.find(
    (e) =>
      e.timing.kind === "card_event" &&
      Array.isArray((e.timing as { event: unknown }).event)
  )!;
}

/** 当該カードの triggered registration のうち targetCardFilter を持つ最初のもの。 */
function destroyRegistration(card: CardDefinition) {
  const regs = generateTriggeredEffectRegistrations(card);
  return regs.find((r) => r.targetCardFilter !== undefined)!;
}

// ============================================================
// maxCores: BSTH001-転醒R03(B) エリス（人形態）
//   『転醒/アタック時』コア3個以下の相手スピリット/アルティメット1体を破壊し、
//   破壊したとき相手のライフのコア1個をリザーブに置く。
// ============================================================

describe("BSTH001-転醒R03(B) エリス（人形態） maxCores destroy", () => {
  const card = cardNoMap.get("BSTH001-転醒R03(B)")!;

  it("構造: stub が外れ destroy(maxCores:3) + ref_succeeded life→reserve になっている", () => {
    const eff = rebirthAttackEffect(card);
    expect(eff.stub).toBeUndefined();
    const destroy = eff.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy" && "filter" in destroy.target) {
      expect(destroy.target.filter.maxCores).toBe(3);
      expect(destroy.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(destroy.target.player).toBe("opponent");
    }
    const lifeMove = eff.steps[1]!;
    expect(lifeMove.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "eris-doll-destroy",
    });
    if (lifeMove.action.kind === "core_move") {
      expect(lifeMove.action.from).toEqual({
        kind: "life",
        player: "opponent",
      });
      expect(lifeMove.action.to).toEqual({
        kind: "reserve",
        player: "opponent",
      });
    }
  });

  it("候補列挙: コア3個以下の相手のみ候補 (4個 / soul込み4個は除外)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const self = createCardInstance(card, {
      instanceId: "eris-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // コア2個 (<=3 → 候補)
    const low = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "enemy-low",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    // コア4個 (>3 → 除外)
    const high = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "enemy-high",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    // 通常コア3 + soul1 = 合計4 (>3 → 除外: soul を数える)
    const soulSpirit = createCardInstance(cardNoMap.get("BSTH001-X01")!, {
      instanceId: "enemy-soul",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const stateWithoutSoul: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, low, high, soulSpirit],
    };
    const state = withSoulCoreLocation(stateWithoutSoul, "bob", {
      kind: "card",
      instanceId: "enemy-soul",
    });
    expect(getTotalCoresOnCardById(state, "enemy-soul")).toBe(4);

    const reg = destroyRegistration(card);
    expect(reg.targetCardFilter?.maxCores).toBe(3);
    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById,
      sourceInstanceId: "eris-1",
    });
    // コア2個の low のみ候補。コア4個 / soul込み4個は除外。
    expect(candidates).toEqual(["enemy-low"]);
  });

  it("実行: 絞り込んだ対象を破壊 enqueue + 破壊成功で相手ライフ→リザーブ (最終盤面)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "eris-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const low = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "enemy-low",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const bobLifeBefore = base.players.find(
      (p) => p.id === "bob"
    )!.lifeNormalCoreCount;
    const bobReserveBefore = base.players.find(
      (p) => p.id === "bob"
    )!.reserveNormalCoreCount;

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, low],
    };
    // GUI が maxCores で絞った候補 (enemy-low) をユーザーが選んだ状況を再現。
    const result = executeEffect({
      chainId: "test:bsth-batch2-1-reconvert:185",
      state,
      effect: rebirthAttackEffect(card),
      sourceInstanceId: "eris-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["enemy-low"],
    });

    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "enemy-low")
    ).toBeDefined();
    // 破壊成功 (ref_succeeded) → 相手ライフ-1 / 相手リザーブ+1。
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore - 1);
    expect(bobAfter.reserveNormalCoreCount).toBe(bobReserveBefore + 1);
  });

  it("実行: 候補が無ければ (対象未指定) 破壊もライフ移動も起きない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "eris-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobLifeBefore = base.players.find(
      (p) => p.id === "bob"
    )!.lifeNormalCoreCount;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self], // 相手スピリット無し
    };
    const result = executeEffect({
      chainId: "test:bsth-batch2-1-reconvert:221",
      state,
      effect: rebirthAttackEffect(card),
      sourceInstanceId: "eris-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(result.pendingLeaveEntities.length).toBe(0);
    // 破壊不発 → ライフ据え置き (ref_succeeded=false で連動しない)。
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore);
  });
});

// ============================================================
// maxCores (2体破壊): BSTH002-転醒X01(B) 魅魔
// ============================================================

describe("BSTH002-転醒X01(B) 魅魔 maxCores 2体破壊", () => {
  const card = cardNoMap.get("BSTH002-転醒X01(B)")!;

  it("構造: stub が外れ destroy(maxCores:3, count:2) + ref_succeeded life→reserve", () => {
    const eff = rebirthAttackEffect(card);
    expect(eff.stub).toBeUndefined();
    const destroy = eff.steps[0]!.action;
    if (destroy.kind === "destroy" && "filter" in destroy.target) {
      expect(destroy.target.filter.maxCores).toBe(3);
      expect(destroy.target.count).toBe(2);
    }
    expect(eff.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "mima-destroy",
    });
  });

  it("候補列挙: コア3個以下の相手2体が候補, コア4個は除外", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "mima-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const e1 = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "m-enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const e2 = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "m-enemy-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const e3 = createCardInstance(cardNoMap.get("BSTH001-X01")!, {
      instanceId: "m-enemy-3",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, e1, e2, e3],
    };
    const reg = destroyRegistration(card);
    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById,
      sourceInstanceId: "mima-1",
    });
    expect(candidates.sort()).toEqual(["m-enemy-1", "m-enemy-2"].sort());
    expect(candidates).not.toContain("m-enemy-3");
  });

  it("実行: 絞り込んだ2体を破壊 + 1体以上破壊で相手ライフ→リザーブ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "mima-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const e1 = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "m-enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const e2 = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "m-enemy-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const bobLifeBefore = base.players.find(
      (p) => p.id === "bob"
    )!.lifeNormalCoreCount;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, e1, e2],
    };
    const result = executeEffect({
      chainId: "test:bsth-batch2-1-reconvert:333",
      state,
      effect: rebirthAttackEffect(card),
      sourceInstanceId: "mima-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["m-enemy-1", "m-enemy-2"],
    });
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "m-enemy-1")
    ).toBeDefined();
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "m-enemy-2")
    ).toBeDefined();
    // 1体以上破壊 → ライフ-1。
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(bobLifeBefore - 1);
  });
});

// ============================================================
// 多色 treat_as: BSSA01-転醒X04(A) 最古の金木犀 (6色)
// ============================================================

describe("BSSA01-転醒X04(A) 最古の金木犀 多色 treat_as (6色)", () => {
  const card = cardNoMap.get("BSSA01-転醒X04(A)")!;

  it("構造: stub が外れ treat_as asColor が6色配列になっている", () => {
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.appliesToCard).toBe(true);
      expect(t.aspects).toEqual(["symbol", "reduction_symbol"]);
      expect([...(t.asColor as string[])].sort()).toEqual(
        ["blue", "green", "purple", "red", "white", "yellow"].sort()
      );
    }
  });

  it("実行: getEffectiveSymbolBundles に 6色すべてが反映される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inst = createCardInstance(card, {
      instanceId: "kinmokusei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const registered = executeEffect({
      chainId: "test:bsth-batch2-1-reconvert:387",
      state: { ...base, cardInstances: [inst] },
      effect: treat,
      sourceInstanceId: "kinmokusei-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const cardInst = registered.cardInstances.find(
      (c) => c.instanceId === "kinmokusei-1"
    )!;
    const bundles = getEffectiveSymbolBundles(registered, cardInst, card);
    const allColors = new Set(bundles.flatMap((b) => b.colors));
    for (const c of ["red", "purple", "green", "white", "yellow", "blue"]) {
      expect(allColors.has(c)).toBe(true);
    }
  });
});

// ============================================================
// 多色 treat_as: BSTH09.2-転醒R03(B) 幻想の守り神 龍神 (8色: 究極/神含む)
// ============================================================

describe("BSTH09.2-転醒R03(B) 幻想の守り神 龍神 多色 treat_as (8色)", () => {
  const card = cardNoMap.get("BSTH09.2-転醒R03(B)")!;

  it("構造: シンボル treat_as が 8色 (究極=ultimate_symbol / 神=god 含む)", () => {
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.aspects).toEqual(["symbol"]);
      expect([...(t.asColor as string[])].sort()).toEqual(
        [
          "blue",
          "god",
          "green",
          "purple",
          "red",
          "ultimate_symbol",
          "white",
          "yellow",
        ].sort()
      );
    }
  });

  it("実行: getEffectiveSymbolBundles に 8色すべてが反映される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inst = createCardInstance(card, {
      instanceId: "ryujin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const registered = executeEffect({
      chainId: "test:bsth-batch2-1-reconvert:447",
      state: { ...base, cardInstances: [inst] },
      effect: treat,
      sourceInstanceId: "ryujin-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const cardInst = registered.cardInstances.find(
      (c) => c.instanceId === "ryujin-1"
    )!;
    const bundles = getEffectiveSymbolBundles(registered, cardInst, card);
    const allColors = new Set(bundles.flatMap((b) => b.colors));
    for (const c of [
      "red",
      "purple",
      "green",
      "white",
      "yellow",
      "blue",
      "ultimate_symbol",
      "god",
    ]) {
      expect(allColors.has(c)).toBe(true);
    }
  });
});

// ============================================================
// 多色 treat_as: BSTH05-X01 / X02 創界神ネクサス「シンボルは緑/導としても扱う」
//   印字は緑単色 → 導 (guide) 特殊シンボルを追加で treat_as（停止条件の stub 解消）。
// ============================================================

describe.each([
  ["BSTH05-X01", "kanako-1"],
  ["BSTH05-X02", "suwako-1"],
])("%s 創界神ネクサス treat_as 緑/導", (cardNo, instanceId) => {
  const card = cardNoMap.get(cardNo)!;

  it("構造: stub が外れ treat_as asColor が ['green','guide'] になっている", () => {
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.aspects).toEqual(["symbol"]);
      expect([...(t.asColor as string[])].sort()).toEqual(
        ["green", "guide"].sort()
      );
    }
  });

  it("実行: getEffectiveSymbolBundles に 緑 と 導(guide) が反映される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inst = createCardInstance(card, {
      instanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const registered = executeEffect({
      chainId: "test:bsth-batch2-1-reconvert:512",
      state: { ...base, cardInstances: [inst] },
      effect: treat,
      sourceInstanceId: instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const cardInst = registered.cardInstances.find(
      (c) => c.instanceId === instanceId
    )!;
    const bundles = getEffectiveSymbolBundles(registered, cardInst, card);
    const allColors = new Set(bundles.flatMap((b) => b.colors));
    expect(allColors.has("green")).toBe(true);
    expect(allColors.has("guide")).toBe(true);
  });
});

// ============================================================
// 多色 treat_as (軽減のみ / シンボル+軽減): BSSA01 転醒X01-X03(A) + XX01
//   構造確認 (stub 除去 + asColor 配列 + aspects)。
// ============================================================

describe("BSSA01 多色 treat_as stub 除去 (構造)", () => {
  it.each([
    [
      "BSSA01-転醒X01(A)",
      true,
      ["symbol", "reduction_symbol"],
      ["white", "yellow"],
    ],
    ["BSSA01-転醒X02(A)", true, ["reduction_symbol"], ["yellow", "purple"]],
    ["BSSA01-転醒X03(A)", true, ["reduction_symbol"], ["yellow", "purple"]],
    [
      "BSSA01-XX01",
      true,
      ["symbol", "reduction_symbol"],
      ["purple", "white", "yellow"],
    ],
  ])("%s: treat_as asColor 配列", (cardNo, appliesToCard, aspects, colors) => {
    const card = cardNoMap.get(cardNo as string)!;
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.appliesToCard).toBe(appliesToCard);
      expect(t.aspects).toEqual(aspects);
      expect([...(t.asColor as string[])].sort()).toEqual(
        [...(colors as string[])].sort()
      );
    }
  });

  it.each(["purple", "white", "yellow"] as const)(
    "BSSA01-XX01: 場の%sシンボルで神軽減1枠を満たし、配置コスト2→1",
    (color) => {
      const cardinal = cardNoMap.get("BSSA01-XX01")!;
      const supplier: CardDefinition = {
        cardNo: `TEST-${color.toUpperCase()}-SYMBOL`,
        name: `${color}シンボル供給テスト`,
        printedCategory: "spirit",
        colors: [color],
        cost: 1,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
        symbolColors: [color],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
        tribe: "test",
        effects: [],
      };
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const cardinalInHand = createCardInstance(cardinal, {
        instanceId: "cardinal-hand",
        ownerPlayerId: "alice",
        zone: "hand",
        cores: 0,
      });
      const symbolOnField = createCardInstance(supplier, {
        instanceId: `${color}-symbol-field`,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      const state: GameState = {
        ...base,
        cardInstances: [cardinalInHand, symbolOnField],
      };

      const result = calculateReduction({
        state,
        actingPlayerId: "alice",
        card: cardinal,
        sourceInstanceId: cardinalInHand.instanceId,
        getCardDefinitionById: (id) =>
          id === supplier.cardNo ? supplier : cardNoMap.get(id),
      });

      expect(result.totalReduction).toBe(1);
      expect(result.reducedCost).toBe(1);
      expect(result.finalCost).toBe(1);
    }
  );

  it.each(["hand", "deck", "trash", "set_aside", "removed_from_game"] as const)(
    "BSSA01-XX01: %sにあるカードの神シンボルも紫/白/黄として扱う",
    (zone) => {
      const cardinal = cardNoMap.get("BSSA01-XX01")!;
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const instance = createCardInstance(cardinal, {
        instanceId: `cardinal-${zone}`,
        ownerPlayerId: "alice",
        zone,
        cores: 0,
      });
      const state: GameState = { ...base, cardInstances: [instance] };

      const colors = new Set(
        getEffectiveSymbolBundles(
          state,
          instance,
          cardinal,
          getCardDefinitionById
        ).flatMap((bundle) => bundle.colors)
      );

      expect(colors).toEqual(new Set(["god", "purple", "white", "yellow"]));
    }
  );
});
