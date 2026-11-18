/**
 * engine-drain: 支払い文脈限定 treat_as（`whenPayingForFilter`）の盤面ガード。
 *
 * 「自分が系統:「夜錆」を持つカードを召喚/配置するとき、このスピリットのシンボルを白/紫としても扱う」
 * (BSSA01-C01) の検証。フィールドに居るこのスピリットの実効シンボルは普段は紫のままで
 * （BP・表示・色判定に影響しない＝CE 非登録）、夜錆カードの召喚/配置コスト軽減時に限り
 * 白/紫の軽減シンボルとして機能する。
 *
 * 根拠: 10_rules/03a_cost-payment.md（コスト軽減）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveSymbolBundles,
} from "../src";
import { calculateReduction } from "../src/core/cost-system";
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

const C01 = "BSSA01-C01";

/** BSSA01-C01 を 1 体フィールドに置いた state を作る。 */
function stateWithC01OnField() {
  const def = card(C01);
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const inst = createCardInstance(def, {
    instanceId: `${C01}-1`,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 0,
  });
  return { state: { ...base, cardInstances: [inst] }, def };
}

describe("支払い文脈限定 treat_as (whenPayingForFilter): BSSA01-C01", () => {
  it("stub が解消され whenPayingForFilter:夜錆 が設定されている", () => {
    const def = card(C01);
    const treat = def.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const action = treat.steps[0]!.action;
    expect(action.kind).toBe("treat_as");
    if (action.kind === "treat_as") {
      expect(action.whenPayingForFilter).toEqual({ tribes: ["夜錆"] });
      expect(action.asColor).toEqual(["white", "purple"]);
    }
  });

  it("無条件には適用されない: 実効シンボル束は印字どおり紫のみ（白を含まない）", () => {
    const { state, def } = stateWithC01OnField();
    // continuous treat_as を「登録試行」しても CE は積まれない（no-op）。
    const treat = def.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const after = executeEffect({
      chainId: "test:paying-for-treat-as-symbol:69",
      state,
      effect: treat,
      sourceInstanceId: `${C01}-1`,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // treat_as_symbol CE は積まれない。
    expect(
      after.activeContinuousEffects.some((ce) =>
        ce.modifierTag.startsWith("treat_as")
      )
    ).toBe(false);
    const inst = after.cardInstances.find((c) => c.instanceId === `${C01}-1`)!;
    const bundles = getEffectiveSymbolBundles(after, inst, def);
    const colors = new Set(bundles.flatMap((b) => b.colors));
    // 印字シンボルは黄のみ。支払い文脈限定の白/紫は実効シンボルに漏れない。
    expect(colors.has("yellow")).toBe(true);
    expect(colors.has("white")).toBe(false);
    expect(colors.has("purple")).toBe(false);
  });

  it("夜錆カードの支払い時: C01 のシンボルが白の軽減を供給する", () => {
    const { state } = stateWithC01OnField();
    // 支払い対象は別の夜錆カード（白軽減を要求するもの）。BSSA01-C02 ユージオ（白軽減・夜錆）。
    const payTarget = card("BSSA01-C02");
    expect(payTarget.tribe.includes("夜錆")).toBe(true);
    expect(payTarget.reductionSymbols).toContain("white");

    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: payTarget,
      getCardDefinitionById,
    });
    // C01 の紫シンボル 1 個が白として軽減を供給 → 白軽減が 1 以上適用される。
    const white = result.reductionBreakdown.find((b) => b.color === "white")!;
    expect(white.available).toBeGreaterThanOrEqual(1);
    expect(result.totalReduction).toBeGreaterThanOrEqual(1);
  });

  it("非夜錆カードの支払い時: C01 は白の軽減を供給しない", () => {
    const { state } = stateWithC01OnField();
    // 白軽減を要求するが系統に夜錆を持たないカード。
    const nonYasabi = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "spirit" &&
        c.reductionSymbols.includes("white") &&
        !(c.tribe ?? "").split("・").includes("夜錆") &&
        !c.colors.includes("purple")
    );
    expect(nonYasabi).toBeDefined();

    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: nonYasabi!,
      getCardDefinitionById,
    });
    // C01 の紫シンボルは白として供給されない（夜錆支払いでないため加色なし）。
    // 供給側に white は現れない（C01 は purple のみ）。
    const white = result.reductionBreakdown.find((b) => b.color === "white")!;
    expect(white.available).toBe(0);
  });
});
