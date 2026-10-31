/**
 * ENGINE-card-filter-effective-symbol-count (2026-06-27 engine-claude lane):
 * MatchCardFilterOptions.effectiveSymbolCount 注入経路の検証。
 *
 * 合体ユニット (host+attached brave) の合算シンボル数が
 * `filter.minSymbolCount` / `filter.symbolCount` 判定に反映されること。
 * dual-color treat_as は SymbolBundle 単位で 1 シンボルとして数える正源
 * (`getCombinedUnitSymbolCount`)。
 *
 * 関連: memory project_combined_unit_symbol_and_bunshin / project_effective_bp_ssot;
 *       BSTH08.5-R11 effects[1] 「シンボル2つ以上の相手のスピリット/アルティメット2体」
 */
import { describe, it, expect } from "vitest";
import {
  getCombinedUnitSymbolCount,
  getCombinedUnitSymbols,
} from "../src/battle/battle-shared";
import { matchesCardFilter } from "../src/card/card-filter";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { CardDefinition, GameState } from "../src/model";

const BOB = "bob";

function spiritDef(): CardDefinition {
  return {
    cardNo: "TEST-HOST",
    name: "Host",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"], // 印字シンボル1
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function braveDef(): CardDefinition {
  return {
    cardNo: "TEST-BRAVE",
    name: "Brave",
    printedCategory: "brave",
    printedColors: ["red"],
    symbolColors: ["red"], // 印字シンボル1
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

const DEFS: Record<string, CardDefinition> = {
  "TEST-HOST": spiritDef(),
  "TEST-BRAVE": braveDef(),
};
const getDef = (id: string) => DEFS[id];

function makeState(opts: { combined: boolean }): GameState {
  const host = createCardInstance(spiritDef(), {
    instanceId: "host",
    ownerPlayerId: BOB,
    zone: "field",
    cores: 1,
    attachedChildrenIds: opts.combined ? ["brave"] : [],
  });
  const brave = createCardInstance(braveDef(), {
    instanceId: "brave",
    ownerPlayerId: BOB,
    zone: "field",
    zoneRoleName: "brave",
    attachedToInstanceId: opts.combined ? "host" : null,
  });
  const state = createEmptyGameState({ playerIds: [BOB, "alice"] });
  return {
    ...state,
    cardInstances: [host, brave],
  };
}

describe("effectiveSymbolCount injection (BSTH08.5-R11 など symbolCount フィルタ)", () => {
  it("印字フォールバック: 合体していないスピリット (印字シンボル1) は minSymbolCount:2 を満たさない", () => {
    const state = makeState({ combined: false });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    // 印字シンボル数 = 1, effectiveSymbolCount 未注入 → 印字フォールバック
    expect(matchesCardFilter(host, spiritDef(), { minSymbolCount: 2 })).toBe(
      false
    );
  });

  it("getCombinedUnitSymbolCount: 合体ユニット (host+brave) は 2 を返す", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const count = getCombinedUnitSymbolCount(state, host, spiritDef(), getDef);
    expect(count).toBe(2);
    // flat 版 .length と一致 (single-color の場合は等価)
    expect(
      getCombinedUnitSymbols(state, host, spiritDef(), getDef).length
    ).toBe(2);
  });

  it("effectiveSymbolCount 注入: 合体ユニット (印字1+ブレイヴ1) は minSymbolCount:2 を満たす", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const eff = getCombinedUnitSymbolCount(state, host, spiritDef(), getDef);
    // 印字直読みでは false、effectiveSymbolCount 注入で true (本 entry の core fix)
    expect(matchesCardFilter(host, spiritDef(), { minSymbolCount: 2 })).toBe(
      false
    );
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { minSymbolCount: 2 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(true);
  });

  it("effectiveSymbolCount 注入: symbolCount (完全一致) も実効値で判定", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const eff = getCombinedUnitSymbolCount(state, host, spiritDef(), getDef);
    expect(eff).toBe(2);
    // symbolCount:2 完全一致は実効値 2 で true
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { symbolCount: 2 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(true);
    // symbolCount:1 完全一致は実効値 2 で false
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { symbolCount: 1 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(false);
  });

  it("maxSymbolCount: 実効値で上限判定 (BSTH003-X03「シンボル2つ以下」型)", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const eff = getCombinedUnitSymbolCount(state, host, spiritDef(), getDef);
    expect(eff).toBe(2);
    // maxSymbolCount:2 は実効値2で満たす
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { maxSymbolCount: 2 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(true);
    // maxSymbolCount:1 は実効値2で超過 → false
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { maxSymbolCount: 1 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(false);
    // 未注入時は印字フォールバック (印字1) で maxSymbolCount:1 を満たす
    expect(matchesCardFilter(host, spiritDef(), { maxSymbolCount: 1 })).toBe(
      true
    );
  });

  it("printedSymbolCount: effectiveSymbolCount 注入下でも印字値のみで判定 (本来のシンボル N 系テキスト)", () => {
    // BSTH06-転醒R01(B) 「本来のシンボルが1つの相手のスピリット1体を破壊する」型。
    // 合体ユニットの実効シンボルが 2 でも、host の印字 symbolColors.length=1 を使う。
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const eff = getCombinedUnitSymbolCount(state, host, spiritDef(), getDef);
    expect(eff).toBe(2); // 実効は 2
    expect(spiritDef().symbolColors.length).toBe(1); // 印字は 1

    // printedSymbolCount:1 は印字のみで判定 → 合体中でも match (effectiveSymbolCount 注入の影響なし)
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { printedSymbolCount: 1 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(true);
    // printedSymbolCount:2 は印字 1 で fail
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { printedSymbolCount: 2 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(false);
  });

  it("printedMinSymbolCount: 印字基準のみで minSymbolCount 判定", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const eff = getCombinedUnitSymbolCount(state, host, spiritDef(), getDef);
    // 印字 1, 実効 2
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { printedMinSymbolCount: 1 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(true);
    expect(
      matchesCardFilter(
        host,
        spiritDef(),
        { printedMinSymbolCount: 2 },
        { effectiveSymbolCount: eff }
      )
    ).toBe(false);
  });
});
