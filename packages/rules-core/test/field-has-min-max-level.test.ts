/**
 * field_has.minLevel / field_has.maxLevel フィルタ（BSTH07.8-C05 フラッシュ「妖精導界者
 * ネクサスがLv2のとき」等、cluster: 妖精導界者ネクサスのLv条件付きフラッシュ実装）。
 *
 * 仕様:
 *   - minLevel/maxLevel は対象カードの実効Lv (getEffectiveLevel) で判定する
 *     （CardFilter.minLevel/maxLevel と同型・同 SSOT、`field_has` 版として新設）。
 *   - 場外のカードは実効Lvが定義できないため対象外（field_has は元々 zone:"field" 限定）。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, Condition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { evaluateCondition } from "../src";

const ALICE = "player-1";

function makeGuidedFairyNexus(requiredCoresByLevel: number[]): CardDefinition {
  return {
    cardNo: "TEST-GUIDED-FAIRY",
    name: "test guided fairy nexus",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: requiredCoresByLevel.map((requiredCores, i) => ({
      level: i + 1,
      requiredCores,
      bp: 0,
    })),
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "妖精",
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
    effects: [],
  };
}

const getDef = (id: string): CardDefinition | undefined =>
  id === "TEST-GUIDED-FAIRY" ? makeGuidedFairyNexus([0, 1]) : undefined;

const cond: Condition = [
  {
    kind: "field_has",
    player: "self",
    tribes: ["妖精"],
    grandwalkerKind: "guided",
    minLevel: 2,
    maxLevel: 2,
  },
];

describe("field_has.minLevel/maxLevel", () => {
  it("実効LvがちょうどmaxLevelのとき true", () => {
    const nexus = createCardInstance(makeGuidedFairyNexus([0, 1]), {
      instanceId: "n1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // requiredCores[1]=1 → Lv2
    });
    const state = createEmptyGameState({ cardInstances: [nexus] });
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(true);
  });

  it("実効LvがminLevel未満のとき false", () => {
    const nexus = createCardInstance(makeGuidedFairyNexus([0, 1]), {
      instanceId: "n1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0, // Lv1
    });
    const state = createEmptyGameState({ cardInstances: [nexus] });
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(false);
  });

  it("場外(手札等)のカードは対象外", () => {
    const nexus = createCardInstance(makeGuidedFairyNexus([0, 1]), {
      instanceId: "n1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({ cardInstances: [nexus] });
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(false);
  });
});
