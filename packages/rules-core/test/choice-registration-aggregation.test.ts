// ============================================================
// P3-24 Phase 2: registration 集約検証
// ============================================================
//
// 修正前 (Phase 1 まで): choice ステップを持つ effect は「default + 各 choice」の
//   N+1 個の registration として展開され、usageLimit は label 共有 (Phase 1 fix) で
//   1 effect = 1 カウンタにする運用だった。
// 修正後 (Phase 2): 1 effect = 1 registration に集約。choice 変種は
//   registration.choices[] に集約。legal action 展開時に N 個へ分岐する。

import { describe, it, expect } from "vitest";
import {
  generateTriggeredEffectRegistrations,
  generateBattleImmediateEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  mergeTriggeredChoiceVariant,
  type RegisteredTriggeredEffectAction,
} from "../src/effect/trigger-system";
import { mergeBattleImmediateChoiceVariant } from "../src/battle/battle-immediate-effect-system";
import type { CardDefinition } from "../src/model";
import type { Effect } from "../src/dsl-types";

function makeDef(cardNo: string, effects: Effect[]): CardDefinition {
  return {
    cardNo,
    name: `テスト用 ${cardNo}`,
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

describe("P3-24 Phase 2: triggered registration aggregation", () => {
  it("choice 持ち effect は 1 registration に集約され、変種は choices[] に格納される", () => {
    const def = makeDef("TEST-AGG-001", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            // デフォルト: bounce
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
            choice: [
              {
                // 別選択肢: draw
                action: { kind: "draw", count: 2 },
              },
            ],
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.choices).toBeDefined();
    expect(reg.choices!.length).toBe(2);
    expect(reg.choices![0]!.label).toBe("手札に戻す");
    expect(reg.choices![1]!.label).toBe("ドロー");
  });

  it("choice なし effect は choices フィールドが未定義", () => {
    const def = makeDef("TEST-AGG-002", [
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
    expect(regs[0]!.choices).toBeUndefined();
    expect(regs[0]!.requiredTargetCount).toBe(1);
  });

  it("choice 変種ごとに requiredTargetCount が異なっても choices[] に独立に保持される", () => {
    const def = makeDef("TEST-AGG-003", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            // デフォルト: 1 体破壊
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
            choice: [
              {
                // 別選択肢: 2 体バウンス
                action: {
                  kind: "bounce",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: 2,
                  },
                },
              },
            ],
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    expect(regs[0]!.choices!.length).toBe(2);
    expect(regs[0]!.choices![0]!.requiredTargetCount).toBe(1);
    expect(regs[0]!.choices![1]!.requiredTargetCount).toBe(2);
  });

  it("配列 timing (複数 eventKind) × choice: 各 eventKind ごとに 1 registration ずつ集約", () => {
    const def = makeDef("TEST-AGG-004", [
      {
        timing: { kind: "card_event", event: ["summon", "place"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
            choice: [{ action: { kind: "draw", count: 2 } }],
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    // summon と place の 2 つの eventKind に対し、choice は各 registration 内で集約
    expect(regs.length).toBe(2);
    for (const reg of regs) {
      expect(reg.choices).toBeDefined();
      expect(reg.choices!.length).toBe(2);
    }
  });
});

describe("P3-24 Phase 2: battle immediate registration aggregation", () => {
  it("choice 持ち battle immediate も 1 registration に集約", () => {
    const def = makeDef("TEST-AGG-BI-001", [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
            choice: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    ]);
    const regs = generateBattleImmediateEffectRegistrations(def);
    expect(regs.length).toBe(1);
    expect(regs[0]!.choices).toBeDefined();
    expect(regs[0]!.choices!.length).toBe(2);
  });
});

describe("P3-24 Phase 2: mergeChoiceVariant helpers", () => {
  it("triggered: variant の値で top-level がオーバーライドされる", () => {
    const baseReg: RegisteredTriggeredEffectAction = {
      sourceKind: "spirit",
      eventKind: "summon",
      requiredTargetCount: 1,
      candidateTargetPlayerScope: "any",
      candidateTargetZones: ["field"],
      effectIndex: 0,
      choices: [
        { label: "手札に戻す", requiredTargetCount: 1 },
        { label: "ドロー" }, // target なし
      ],
    };
    const merged0 = mergeTriggeredChoiceVariant(baseReg, baseReg.choices![0]!);
    expect(merged0.requiredTargetCount).toBe(1);

    const merged1 = mergeTriggeredChoiceVariant(baseReg, baseReg.choices![1]!);
    // variant に target 指定がないため undefined になる (top-level の継承はしない)
    expect(merged1.requiredTargetCount).toBeUndefined();
  });

  it("battle immediate: variant の chooser はマージ対象外 (top-level に存在しない)", () => {
    const baseReg = {
      timing: "attack" as const,
      sourceKind: "spirit" as const,
      requiredTargetCount: 1,
      effectIndex: 0,
      choices: [
        { label: "破壊", requiredTargetCount: 1 },
        { label: "バウンス", requiredTargetCount: 2 },
      ],
    };
    const merged1 = mergeBattleImmediateChoiceVariant(
      baseReg,
      baseReg.choices[1]!,
      1
    );
    expect(merged1.requiredTargetCount).toBe(2);
    expect(merged1.choiceIndex).toBe(1);
  });
});
