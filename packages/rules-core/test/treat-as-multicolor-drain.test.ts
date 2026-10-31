/**
 * engine-drain: 複数色 treat_as（「シンボル/軽減を A/B/… としても扱う」）の
 * カードデータ変換が、エンジンの実効シンボル/軽減に全色反映されることを確認する。
 *
 * treat_as の asColor 配列（多色）対応はエンジン側で実装済み
 * （normalizeAsColors を全 consumer が通す SSOT）。本テストは「単色制約のため未表現」
 * という stale な stub を外して変換した弾カードが実際に機能することの回帰ガード。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveSymbolBundles,
} from "../src";
import { getEffectiveReductionSymbolEntries } from "../src/core/cost-system";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function treatAsEffect(def: CardDefinition) {
  return def.effects!.find((e) => e.steps[0]?.action.kind === "treat_as")!;
}

describe("複数色 treat_as: フィールドシンボル (getEffectiveSymbolBundles)", () => {
  it.each([
    [
      "BSLH01-X01",
      ["red", "purple", "green", "white", "yellow", "blue", "black"],
    ],
    [
      "BSLH01-X02",
      ["red", "purple", "green", "white", "yellow", "blue", "black"],
    ],
    ["BSLH01-C11", ["red", "purple", "green", "white", "yellow", "blue"]],
    ["BSTH02-C01", ["red", "purple", "green", "white", "yellow", "blue"]],
    ["BSLH01-C12", ["red", "purple", "green", "white", "yellow", "black"]],
  ])("%s のシンボルが指定全色として扱われる", (cardNo, expectedColors) => {
    const def = card(cardNo as string);
    const treat = treatAsEffect(def);
    expect(treat.stub).toBeUndefined();

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inst = createCardInstance(def, {
      instanceId: `${cardNo}-1`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const registered = executeEffect({
      chainId: "test:treat-as-multicolor-drain:60",
      state: { ...base, cardInstances: [inst] },
      effect: treat,
      sourceInstanceId: `${cardNo}-1`,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const cardInst = registered.cardInstances.find(
      (c) => c.instanceId === `${cardNo}-1`
    )!;
    const bundles = getEffectiveSymbolBundles(registered, cardInst, def);
    const allColors = new Set(bundles.flatMap((b) => b.colors));
    for (const c of expectedColors as string[]) {
      expect(allColors.has(c)).toBe(true);
    }
  });
});

describe("複数色 treat_as: 軽減シンボル (getEffectiveReductionSymbolEntries)", () => {
  it.each([
    ["BSSA01-X01", ["white", "yellow"]],
    ["BSSA01-X02", ["purple", "white"]],
  ])("%s の軽減シンボルが指定色も満たす", (cardNo, addedColors) => {
    const def = card(cardNo as string);
    const treat = treatAsEffect(def);
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    expect(t.kind).toBe("treat_as");
    if (t.kind === "treat_as") expect(t.appliesToCard).toBe(true);

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const entries = getEffectiveReductionSymbolEntries(
      def,
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    // 印字 4 個の軽減シンボルが残りつつ、各 entry に追加色が含まれる。
    expect(entries.length).toBe(def.reductionSymbols.length);
    const allColors = new Set(entries.flatMap((e) => e.colors));
    for (const c of addedColors as string[]) {
      expect(allColors.has(c)).toBe(true);
    }
  });
});

/**
 * BSSA01 転醒X01..X04(A) の前面 treat_as 部分（多色 asColor 配列）の盤面ガード。
 * 根拠: 10_rules/03a_cost-payment.md L10「1 個のシンボルが複数色として扱える場合でも、
 * 同時に複数色へは使えない」= 1 シンボルが複数色として扱えること自体は正規。
 * normalizeAsColors SSOT で列挙全色が実効シンボル/軽減に反映されることを assert する
 * （転醒トリガー等の残ギャップは別 stub のまま、treat_as 部分のみ検証）。
 */
describe("複数色 treat_as: BSSA01 転醒X01..X04(A)", () => {
  it("転醒X01(A) ネクサスのシンボル/軽減が白/黄も満たす", () => {
    const cardNo = "BSSA01-転醒X01(A)";
    const def = card(cardNo);
    const treat = treatAsEffect(def);
    // treat_as 部分は stub 解消済み（残ギャップは別効果 [2]/[7]/背面）。
    expect(treat.stub).toBeUndefined();

    // シンボル: フィールド配置して実効シンボル束に白/黄が含まれる。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inst = createCardInstance(def, {
      instanceId: `${cardNo}-1`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const registered = executeEffect({
      chainId: "test:treat-as-multicolor-drain:132",
      state: { ...base, cardInstances: [inst] },
      effect: treat,
      sourceInstanceId: `${cardNo}-1`,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const cardInst = registered.cardInstances.find(
      (c) => c.instanceId === `${cardNo}-1`
    )!;
    const bundles = getEffectiveSymbolBundles(registered, cardInst, def);
    const symbolColors = new Set(bundles.flatMap((b) => b.colors));
    expect(symbolColors.has("white")).toBe(true);
    expect(symbolColors.has("yellow")).toBe(true);

    // 軽減: 手札からでも有効（appliesToCard）で軽減 entry に白/黄が含まれる。
    const reductionEntries = getEffectiveReductionSymbolEntries(
      def,
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    const reductionColors = new Set(reductionEntries.flatMap((e) => e.colors));
    expect(reductionColors.has("white")).toBe(true);
    expect(reductionColors.has("yellow")).toBe(true);
  });

  it.each([
    ["BSSA01-転醒X02(A)", ["yellow", "purple"]],
    ["BSSA01-転醒X03(A)", ["yellow", "purple"]],
  ])("%s の軽減シンボルが %s も満たす", (cardNo, addedColors) => {
    const def = card(cardNo as string);
    const treat = treatAsEffect(def);
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    expect(t.kind).toBe("treat_as");
    if (t.kind === "treat_as") expect(t.appliesToCard).toBe(true);

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const entries = getEffectiveReductionSymbolEntries(
      def,
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    expect(entries.length).toBe(def.reductionSymbols.length);
    const allColors = new Set(entries.flatMap((e) => e.colors));
    for (const c of addedColors as string[]) {
      expect(allColors.has(c)).toBe(true);
    }
  });

  it.each([
    ["BSSA01-転醒X02(A)", ["yellow", "purple"]],
    ["BSSA01-転醒X03(A)", ["yellow", "purple"]],
  ])(
    "%s の軽減シンボル変更はカード状態のみで、場の状態には CE 登録しない",
    (cardNo, addedColors) => {
      const def = card(cardNo as string);
      const treat = treatAsEffect(def);
      const t = treat.steps[0]!.action;
      expect(t.kind).toBe("treat_as");
      if (t.kind === "treat_as") {
        expect(t.appliesToCard).toBe(true);
        expect(t.cardStateOnly).toBe(true);
      }

      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const fieldInst = createCardInstance(def, {
        instanceId: `${cardNo}-field`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const fieldState = { ...base, cardInstances: [fieldInst] };
      const registered = executeEffect({
        chainId: "test:treat-as-multicolor-drain:212",
        state: fieldState,
        effect: treat,
        sourceInstanceId: fieldInst.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      expect(
        registered.activeContinuousEffects.filter(
          (ce) =>
            ce.sourceInstanceId === fieldInst.instanceId &&
            ce.modifierTag.startsWith("treat_as_")
        )
      ).toHaveLength(0);

      const fieldEntries = getEffectiveReductionSymbolEntries(
        def,
        fieldState,
        "alice",
        getCardDefinitionById,
        fieldInst.instanceId,
        undefined
      );
      const fieldColors = new Set(fieldEntries.flatMap((e) => e.colors));
      for (const c of addedColors as string[]) {
        expect(fieldColors.has(c)).toBe(false);
      }

      const handInst = createCardInstance(def, {
        instanceId: `${cardNo}-hand`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
        normalCoreCount: 0,
      });
      const handState = { ...base, cardInstances: [handInst] };
      const handEntries = getEffectiveReductionSymbolEntries(
        def,
        handState,
        "alice",
        getCardDefinitionById,
        handInst.instanceId,
        undefined
      );
      const handColors = new Set(handEntries.flatMap((e) => e.colors));
      for (const c of addedColors as string[]) {
        expect(handColors.has(c)).toBe(true);
      }

      const soulInst = createCardInstance(def, {
        instanceId: `${cardNo}-soul-state`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const soulState = {
        ...base,
        cardInstances: [soulInst],
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, soulStateInstanceIds: [soulInst.instanceId] }
            : p
        ),
      };
      const soulEntries = getEffectiveReductionSymbolEntries(
        def,
        soulState,
        "alice",
        getCardDefinitionById,
        soulInst.instanceId,
        undefined
      );
      const soulColors = new Set(soulEntries.flatMap((e) => e.colors));
      for (const c of addedColors as string[]) {
        expect(soulColors.has(c)).toBe(true);
      }

      const hostDef: CardDefinition = {
        cardNo: "TEST-UNDER-HOST",
        name: "テスト under host",
        printedCategory: "spirit",
        colors: ["yellow"],
        cost: 1,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
      };
      const underInst = createCardInstance(def, {
        instanceId: `${cardNo}-under-card`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 0,
      });
      const hostInst = {
        ...createCardInstance(hostDef, {
          instanceId: `${cardNo}-under-host`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        underCards: [
          {
            cardInstanceId: underInst.instanceId,
            role: "advent_source" as const,
          },
        ],
      };
      const underState = { ...base, cardInstances: [hostInst, underInst] };
      const underEntries = getEffectiveReductionSymbolEntries(
        def,
        underState,
        "alice",
        getCardDefinitionById,
        underInst.instanceId,
        undefined
      );
      const underColors = new Set(underEntries.flatMap((e) => e.colors));
      for (const c of addedColors as string[]) {
        expect(underColors.has(c)).toBe(true);
      }
    }
  );

  it("色指定つき軽減シンボル変更は、印字の該当色枠だけに加色する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });

    const redGuide = getEffectiveReductionSymbolEntries(
      card("BSTH003-C01"),
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    expect(redGuide[0]!.colors).toEqual(
      expect.arrayContaining(["red", "yellow"])
    );
    expect(redGuide[1]!.colors).toEqual(["guide"]);

    const yellowGuide = getEffectiveReductionSymbolEntries(
      card("BSTH003-C02"),
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    expect(yellowGuide[0]!.colors).toEqual(
      expect.arrayContaining(["yellow", "red"])
    );
    expect(yellowGuide[1]!.colors).toEqual(["guide"]);

    const whiteGuide = getEffectiveReductionSymbolEntries(
      card("BSTH02-C02"),
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    expect(whiteGuide[0]!.colors).toEqual(
      expect.arrayContaining(["white", "purple"])
    );
    expect(whiteGuide[1]!.colors).toEqual(["guide"]);
  });

  it("転醒X04(A) シンボル/軽減が 6 色すべてを満たす", () => {
    const cardNo = "BSSA01-転醒X04(A)";
    const sixColors = ["red", "purple", "green", "white", "yellow", "blue"];
    const def = card(cardNo);
    const treat = treatAsEffect(def);
    expect(treat.stub).toBeUndefined();

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inst = createCardInstance(def, {
      instanceId: `${cardNo}-1`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const registered = executeEffect({
      chainId: "test:treat-as-multicolor-drain:401",
      state: { ...base, cardInstances: [inst] },
      effect: treat,
      sourceInstanceId: `${cardNo}-1`,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const cardInst = registered.cardInstances.find(
      (c) => c.instanceId === `${cardNo}-1`
    )!;
    const bundles = getEffectiveSymbolBundles(registered, cardInst, def);
    const symbolColors = new Set(bundles.flatMap((b) => b.colors));
    for (const c of sixColors) {
      expect(symbolColors.has(c)).toBe(true);
    }

    const reductionEntries = getEffectiveReductionSymbolEntries(
      def,
      base,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    const reductionColors = new Set(reductionEntries.flatMap((e) => e.colors));
    for (const c of sixColors) {
      expect(reductionColors.has(c)).toBe(true);
    }
  });
});
