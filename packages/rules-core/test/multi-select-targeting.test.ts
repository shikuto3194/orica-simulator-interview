// ============================================================
// P3-14 D-2 Phase 2 — 複数選択 (multi-select) targeting
// ============================================================
//
// `Count = { min, max }` 形式の TargetSpec.count から
// `requiredTargetCount` (=min) / `maxTargetCount` (=max) が
// 登録 → legal action → validation の経路で正しく伝搬することを検証する。

import { describe, it, expect } from "vitest";
import {
  generateTriggeredEffectRegistrations,
  generateBattleImmediateEffectRegistrations,
  generateFieldCardEffectRegistrations,
  generateMagicRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  getMaxTargetCount,
  getRequiredTargetCount,
  getTargetMode,
  resolveLegalActionTargets,
} from "../src/legal/legal-actions-shared";
import type { CardDefinition } from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// テスト用ヘルパー
// ============================================================

function makeDef(effects: Effect[]): CardDefinition {
  return {
    cardNo: "TEST-MS-001",
    name: "テスト用カード",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

// ============================================================
// getMaxTargetCount / getTargetMode 単体
// ============================================================

describe("D-2 Phase 2: getMaxTargetCount", () => {
  it("maxTargetCount 未指定時は requiredTargetCount を返す", () => {
    expect(getMaxTargetCount({ requiredTargetCount: 3 })).toBe(3);
  });

  it("maxTargetCount > requiredTargetCount のときは maxTargetCount を返す", () => {
    expect(
      getMaxTargetCount({ requiredTargetCount: 1, maxTargetCount: 3 })
    ).toBe(3);
  });

  it("maxTargetCount < requiredTargetCount は防御的に requiredTargetCount を返す", () => {
    expect(
      getMaxTargetCount({ requiredTargetCount: 5, maxTargetCount: 2 })
    ).toBe(5);
  });

  it("requiredTargetCount 未指定時は 0", () => {
    expect(getMaxTargetCount({})).toBe(0);
    expect(getRequiredTargetCount({})).toBe(0);
  });

  it("min=0, max=3 の任意選択", () => {
    expect(
      getRequiredTargetCount({ requiredTargetCount: 0, maxTargetCount: 3 })
    ).toBe(0);
    expect(
      getMaxTargetCount({ requiredTargetCount: 0, maxTargetCount: 3 })
    ).toBe(3);
  });
});

describe("D-2 Phase 2: getTargetMode", () => {
  it("required > 0 → manual", () => {
    expect(getTargetMode(3)).toBe("manual");
    expect(getTargetMode(1, 3)).toBe("manual");
  });

  it("required = 0 / max 未指定 → none", () => {
    expect(getTargetMode(0)).toBe("none");
  });

  it("required = 0 / max > 0 → manual (任意選択)", () => {
    expect(getTargetMode(0, 3)).toBe("manual");
  });

  it("required = 0 / max = 0 → none", () => {
    expect(getTargetMode(0, 0)).toBe("none");
  });
});

// ============================================================
// resolveLegalActionTargets 範囲 validation
// ============================================================

describe("D-2 Phase 2: resolveLegalActionTargets", () => {
  const baseAction = {
    actionId: "test-action-1",
    targetMode: "manual" as const,
    candidateTargetInstanceIds: ["c1", "c2", "c3", "c4"],
  };

  it("固定数 (max 未指定) は完全一致を要求", () => {
    const action = { ...baseAction, requiredTargetCount: 2 };
    expect(resolveLegalActionTargets(action, ["c1", "c2"])).toEqual([
      "c1",
      "c2",
    ]);
    expect(() => resolveLegalActionTargets(action, ["c1"])).toThrow(
      /target count does not match/
    );
    expect(() => resolveLegalActionTargets(action, ["c1", "c2", "c3"])).toThrow(
      /target count does not match/
    );
  });

  it("可変選択 [min..max] の範囲内は受理", () => {
    const action = { ...baseAction, requiredTargetCount: 1, maxTargetCount: 3 };
    expect(resolveLegalActionTargets(action, ["c1"])).toEqual(["c1"]);
    expect(resolveLegalActionTargets(action, ["c1", "c2"])).toEqual([
      "c1",
      "c2",
    ]);
    expect(resolveLegalActionTargets(action, ["c1", "c2", "c3"])).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("可変選択で min より少ない数は拒否", () => {
    const action = { ...baseAction, requiredTargetCount: 1, maxTargetCount: 3 };
    expect(() => resolveLegalActionTargets(action, [])).toThrow(/out of range/);
  });

  it("可変選択で max を超えた数は拒否", () => {
    const action = { ...baseAction, requiredTargetCount: 1, maxTargetCount: 3 };
    expect(() =>
      resolveLegalActionTargets(action, ["c1", "c2", "c3", "c4"])
    ).toThrow(/out of range/);
  });

  it("min=0/max=3 で空配列は受理 (任意選択ゼロ件)", () => {
    const action = { ...baseAction, requiredTargetCount: 0, maxTargetCount: 3 };
    expect(resolveLegalActionTargets(action, [])).toEqual([]);
    expect(resolveLegalActionTargets(action, ["c1"])).toEqual(["c1"]);
  });

  it("min=0/max>0 で targetInstanceIds 未指定 (undefined) は空配列扱い", () => {
    const action = { ...baseAction, requiredTargetCount: 0, maxTargetCount: 3 };
    expect(resolveLegalActionTargets(action, undefined)).toEqual([]);
  });

  it("min>0 で targetInstanceIds 未指定はエラー", () => {
    const action = { ...baseAction, requiredTargetCount: 1, maxTargetCount: 3 };
    expect(() => resolveLegalActionTargets(action, undefined)).toThrow(
      /requires targets/
    );
  });

  it("可変選択時に重複した instanceId を弾く", () => {
    const action = { ...baseAction, requiredTargetCount: 1, maxTargetCount: 3 };
    expect(() => resolveLegalActionTargets(action, ["c1", "c1"])).toThrow(
      /Duplicate target/
    );
  });

  it("候補外の instanceId を弾く (固定数・可変選択両方)", () => {
    const fixed = { ...baseAction, requiredTargetCount: 1 };
    expect(() => resolveLegalActionTargets(fixed, ["unknown"])).toThrow(
      /not a legal candidate/
    );
    const variable = {
      ...baseAction,
      requiredTargetCount: 1,
      maxTargetCount: 3,
    };
    expect(() =>
      resolveLegalActionTargets(variable, ["c1", "unknown"])
    ).toThrow(/not a legal candidate/);
  });
});

// ============================================================
// extractFieldTargetingFromAction 経由 (registration 自動生成)
// ============================================================

describe("D-2 Phase 2: registration generation from { min, max } Count", () => {
  it("固定数 (count: 1) → requiredTargetCount=1, maxTargetCount 未設定", () => {
    const def = makeDef([
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(1);
    expect(reg.maxTargetCount).toBeUndefined();
    expect(getMaxTargetCount(reg)).toBe(1);
  });

  it("可変選択 (count: { min: 1, max: 3 }) → requiredTargetCount=1, maxTargetCount=3", () => {
    const def = makeDef([
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: { min: 1, max: 3 },
              },
            },
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(1);
    expect(reg.maxTargetCount).toBe(3);
    expect(getMaxTargetCount(reg)).toBe(3);
  });

  it("任意選択 (count: { min: 0, max: 3 }) → requiredTargetCount=0, maxTargetCount=3", () => {
    const def = makeDef([
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: { min: 0, max: 3 },
              },
            },
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(0);
    expect(reg.maxTargetCount).toBe(3);
  });

  it("上限が DynamicCount (count: { min: 0, max: floor(count/2) }) → maxTargetCount 未設定・maxTargetCountDynamic に raw bound 保持", () => {
    const def = makeDef([
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: {
                  min: 0,
                  max: {
                    source: { kind: "count_value", player: "self" },
                    divisor: 2,
                  },
                },
              },
            },
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(0);
    // 動的上限は登録時に数値化できないため maxTargetCount は未設定。
    expect(reg.maxTargetCount).toBeUndefined();
    // raw bound を保持し、deferred 解決時に resolveCountBound で数値化する。
    expect(reg.maxTargetCountDynamic).toEqual({
      source: { kind: "count_value", player: "self" },
      divisor: 2,
    });
  });

  it("min===max は固定数として扱う (maxTargetCount 未設定)", () => {
    const def = makeDef([
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: { min: 2, max: 2 },
              },
            },
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(2);
    expect(reg.maxTargetCount).toBeUndefined();
  });

  it("battle immediate 効果でも { min, max } が伝搬する", () => {
    const def = makeDef([
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: { min: 1, max: 2 },
              },
            },
          },
        ],
      },
    ]);
    const regs = generateBattleImmediateEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(1);
    expect(reg.maxTargetCount).toBe(2);
  });

  it("field card effect (activated/main) でも { min, max } が伝搬する", () => {
    const def = makeDef([
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: { min: 1, max: 3 },
              },
              amount: 2000,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    ]);
    const regs = generateFieldCardEffectRegistrations(def);
    expect(regs.length).toBeGreaterThan(0);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(1);
    expect(reg.maxTargetCount).toBe(3);
  });

  it("magic action でも { min, max } が伝搬する", () => {
    const magicDef: CardDefinition = {
      cardNo: "TEST-MS-MAGIC-001",
      name: "テスト用マジック",
      printedCategory: "magic",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: { min: 1, max: 2 },
                },
              },
            },
          ],
        },
      ],
    };
    const regs = generateMagicRegistrations(magicDef);
    expect(regs.length).toBeGreaterThan(0);
    const reg = regs[0]!;
    expect(reg.requiredTargetCount).toBe(1);
    expect(reg.maxTargetCount).toBe(2);
  });
});
