/**
 * BSTH05-X01 [創界神]八坂 神奈子 effects[2] 【神域】
 *   Lv2『自分のアタックステップ』
 *   系統：「風神」/「アシハラ」を持つ自分のスピリット/創界神ネクサスをBP+5000する。
 *
 * - timing: continuous + timingScope:self.attack (アタックステップ中限定の継続)
 * - target filter: filterOr 2 枝 (spirit ∪ targetsGrandwalker:"only" nexus) × tribes:風神/アシハラ
 * - amount: 5000, duration: permanent (継続効果は activeContinuousEffects に登録)
 *
 * BSTH05-X02 effects[1] (同型「自分のスピリット/創界神ネクサス」) の filter shape を踏襲。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { getBpModifierTotal } from "../src/legal/legal-actions-shared";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateFieldCardEffectRegistrations,
  type CardDefinition,
  type GameState,
} from "../src";

const kanako = ALL_CARDS.find((c) => c.cardNo === "BSTH05-X01");
if (!kanako) throw new Error("BSTH05-X01 not found in ALL_CARDS");
const KANAKO = kanako;

describe("BSTH05-X01 effects[2] 【神域】", () => {
  it("監査用の空 step【転神】entry は field action に登録しない", () => {
    expect(generateFieldCardEffectRegistrations(KANAKO)).toEqual([]);
  });

  it("structural: stub 除去 + timingScope:self.attack + filterOr 2 枝 + tribes 風神/アシハラ", () => {
    const e = KANAKO.effects?.[2];
    if (!e) throw new Error("BSTH05-X01 effects[2] missing");
    expect(e.stub).toBeUndefined();
    expect(e.timing).toMatchObject({ kind: "continuous" });
    expect(e.timingScope).toEqual({ player: "self", period: "attack" });
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);

    const step = e.steps[0]!;
    expect(step.action.kind).toBe("bp_modify");
    if (step.action.kind !== "bp_modify") throw new Error("expected bp_modify");
    expect(step.action.amount).toBe(5000);
    // while_on_field: source 不在後に per-target CE が掃除されるよう BSTH08-XX01 effects[2] と同型。
    expect(step.action.duration).toEqual({ scope: "while_on_field" });

    const target = step.action.target;
    if (target.kind !== "filter")
      throw new Error("expected filter target kind");
    expect(target.player).toBe("self");
    expect(target.count).toBe("all");

    const f = target.filter;
    expect(f.filterOr).toHaveLength(2);
    expect(f.filterOr![0]).toEqual({
      category: ["spirit"],
      tribes: ["風神", "アシハラ"],
    });
    expect(f.filterOr![1]).toEqual({
      category: ["nexus"],
      tribes: ["風神", "アシハラ"],
      targetsGrandwalker: "only",
    });
  });

  it("execution: 自分のアタックステップ中、bp_modify CE が登録され、対象は 風神/アシハラ spirit と 創界神 nexus のみ", () => {
    // テスト用 spirits/nexus を定義 (生成 ALL_CARDS の既存 card に依存しすぎないよう minimal で組む)。
    const fuzinSpirit: CardDefinition = {
      cardNo: "TEST-FUZIN-SPIRIT",
      name: "風神テストスピリット",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: ["green"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["green"],
      tribe: "風神",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const ashiharaSpirit: CardDefinition = {
      ...fuzinSpirit,
      cardNo: "TEST-ASHIHARA-SPIRIT",
      name: "アシハラテストスピリット",
      tribe: "アシハラ",
    };
    const otherSpirit: CardDefinition = {
      ...fuzinSpirit,
      cardNo: "TEST-OTHER-SPIRIT",
      name: "無関係スピリット",
      tribe: "幻想",
    };
    const plainNexus: CardDefinition = {
      cardNo: "TEST-PLAIN-NEXUS",
      name: "風神テストネクサス",
      printedCategory: "nexus",
      colors: ["green"],
      cost: 2,
      reductionSymbols: ["green"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["green"],
      tribe: "風神",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };

    const defs = new Map<string, CardDefinition>([
      [KANAKO.cardNo, KANAKO],
      [fuzinSpirit.cardNo, fuzinSpirit],
      [ashiharaSpirit.cardNo, ashiharaSpirit],
      [otherSpirit.cardNo, otherSpirit],
      [plainNexus.cardNo, plainNexus],
    ]);

    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        // Kanako Lv2 (cores=4 で Lv2 達成)
        createCardInstance(KANAKO, {
          instanceId: "kanako-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "nexus",
          normalCoreCount: 4,
        }),
        createCardInstance(fuzinSpirit, {
          instanceId: "fuzin-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(ashiharaSpirit, {
          instanceId: "ashihara-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(otherSpirit, {
          instanceId: "other-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(plainNexus, {
          instanceId: "plain-nexus-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "nexus",
          normalCoreCount: 0,
        }),
      ],
    };

    const effect = KANAKO.effects?.[2];
    if (!effect) throw new Error("BSTH05-X01 effects[2] missing");
    const result = executeEffect({
      chainId: "test:bsth05-x01-shin-iki-bp-modify:163",
      state,
      effect,
      sourceInstanceId: "kanako-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // 期待 match: fuzin-1 (spirit + 風神, 枝A) / ashihara-1 (spirit + アシハラ, 枝A) /
    //            kanako-1 (nexus + アシハラ + grandwalker, 枝B targetsGrandwalker:"only")。
    // 不一致: other-1 (spirit + 幻想) / plain-nexus-1 (nexus + 風神 だが grandwalker でない)。
    const bpCEs = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    const targetIds = new Set(
      result.cardInstances
        .filter(
          (c) =>
            getBpModifierTotal(result, c.instanceId, c, (id) =>
              defs.get(id)
            ) === 5000
        )
        .map((c) => c.instanceId)
    );
    expect(targetIds).toEqual(new Set(["fuzin-1", "ashihara-1", "kanako-1"]));
    for (const ce of bpCEs) {
      expect(ce.modifierAmount).toBe(5000);
      expect(ce.duration).toEqual({ scope: "while_on_field" });
      expect(ce.timingScope).toEqual({ player: "self", period: "attack" });
      expect(ce.sourceInstanceId).toBe("kanako-1");
    }
  });
});
