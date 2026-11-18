/**
 * BSTH03-M03 [永夜抄]レミリア・スカーレット — Lv2-Lv3『このスピリットのアタック時』
 *   「ターンに1回、系統：「起幻」を持たない相手の創界神ネクサス1つを破壊する。
 *    この効果で破壊したとき、このスピリットは回復する。」
 *
 * engine-drain: stub detail は「系統除外フィルタ・破壊成功時条件付き回復は DSL 未対応」と
 * 記していたが、CardFilter.excludeTribeSubstring（既存、GE系統除外と同型）+
 * StepCondition.ref_succeeded（既存、BSSL01-C02 等と同型）の組み合わせで表現可能な stale stub
 * だった。系統「起幻」を含む創界神ネクサスは破壊対象から除外され、破壊成功時のみ回復する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

const m03 = card("BSTH03-M03");
const attackEffect = m03.effects!.find(
  (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
)!;

function findPlainGrandwalkerNexus(): CardDefinition {
  const found = ALL_CARDS.find(
    (c) =>
      c.printedCategory === "nexus" &&
      (c.tribe ?? "").split("・").includes("創界神") &&
      !(c.tribe ?? "").includes("起幻")
  );
  if (!found) throw new Error("no plain 創界神 nexus fixture found");
  return found;
}

describe("BSTH03-M03 レミリア・スカーレット — アタック時 起幻除外破壊+破壊成功時回復", () => {
  it("構造: バースト後段はこのカード自身をコストなしで逐次召喚する", () => {
    const burst = m03.effects![0]!;
    expect(burst.stub).toBeUndefined();
    expect(burst.timing.kind).toBe("burst");
    const summonStep = burst.steps[1]!;
    expect(summonStep.connector).toBe("sequential");
    expect(summonStep.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
  });

  it("構造: stub なし・destroy に excludeTribeSubstring:起幻・recover が ref_succeeded ゲート", () => {
    expect(attackEffect.stub).toBeUndefined();
    const destroyStep = attackEffect.steps[0]!;
    expect(destroyStep.action.kind).toBe("destroy");
    if (destroyStep.action.kind === "destroy") {
      expect(destroyStep.action.target.kind).toBe("filter");
      if (destroyStep.action.target.kind === "filter") {
        expect(destroyStep.action.target.filter.excludeTribeSubstring).toEqual([
          "起幻",
        ]);
      }
    }
    const recoverStep = attackEffect.steps[1]!;
    expect(recoverStep.action.kind).toBe("recover");
    expect(recoverStep.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: destroyStep.id,
    });
  });

  it("[board] 起幻を持たない創界神ネクサスは破壊され、レミリアは回復する", () => {
    const nexusDef = findPlainGrandwalkerNexus();
    const src = createCardInstance(m03, {
      instanceId: "remilia",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
      exhaustState: "exhausted",
    });
    const tgt = createCardInstance(nexusDef, {
      instanceId: "enemy-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      cardInstances: [src, tgt],
    });
    const resolved = executeEffect({
      chainId: "test:bsth03-m03-tribe-exclude-destroy-recover:99",
      state: before,
      effect: attackEffect,
      sourceInstanceId: "remilia",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-nexus"],
    });
    const after = flushPendingLeaves(resolved, getDef);
    expect(
      after.cardInstances.find((c) => c.instanceId === "enemy-nexus")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "remilia")!.exhaustState
    ).toBe("recovered");
  });

  it("[board] 対象不在（起幻を持つ創界神ネクサスのみ）では破壊不発かつレミリアは回復しない", () => {
    const tainted: CardDefinition = {
      cardNo: "TEST-GRANDWALKER-KIGEN",
      name: "テスト起幻創界神",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "創界神・起幻",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const testGetDef = (id: string): CardDefinition | undefined =>
      id === tainted.cardNo ? tainted : getDef(id);
    const src = createCardInstance(m03, {
      instanceId: "remilia",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const tgt = createCardInstance(tainted, {
      instanceId: "enemy-tainted-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      cardInstances: [src, tgt],
    });
    const after = executeEffect({
      chainId: "test:bsth03-m03-tribe-exclude-destroy-recover:151",
      state: before,
      effect: attackEffect,
      sourceInstanceId: "remilia",
      actingPlayerId: ALICE,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "enemy-tainted-nexus")
    ).toBeDefined();
    expect(
      after.cardInstances.find((c) => c.instanceId === "remilia")!.exhaustState
    ).toBe("exhausted");
  });

  it("[board] 導界者ネクサスも破壊対象に含める (P3-137、10_rules/07 §55)", () => {
    const guidedNexus = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "nexus" && c.grandwalkerData?.kind === "guided"
    )!;
    expect(guidedNexus).toBeDefined();
    const src = createCardInstance(m03, {
      instanceId: "remilia-guided",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const tgt = createCardInstance(guidedNexus, {
      instanceId: "enemy-guided-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      cardInstances: [src, tgt],
    });
    const resolved = executeEffect({
      chainId: "test:bsth03-m03-tribe-exclude-destroy-recover:190",
      state: before,
      effect: attackEffect,
      sourceInstanceId: "remilia-guided",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-guided-nexus"],
    });
    const after = flushPendingLeaves(resolved, getDef);
    expect(
      after.cardInstances.find((c) => c.instanceId === "enemy-guided-nexus")!
        .zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "remilia-guided")!
        .exhaustState
    ).toBe("recovered");
  });
});
