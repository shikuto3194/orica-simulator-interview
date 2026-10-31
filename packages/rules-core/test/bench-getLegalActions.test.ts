/**
 * getLegalActions ベンチマーク。
 * 終盤シナリオ（field 10枚 + hand 5枚 + CE 30個 + usageRecords 20件）で
 * getLegalActions のスループットを計測する。
 *
 * 実行: vitest run bench-getLegalActions
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectUsageRecord,
} from "../src/model";

function makeDef(
  cardNo: string,
  category: "spirit" | "magic" | "nexus" | "brave" = "spirit"
): CardDefinition {
  return {
    cardNo,
    name: `Test ${cardNo}`,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C" as const,
  };
}

function makeFieldCard(i: number, playerId: string): CardInstance {
  const def = makeDef(`field-${playerId}-${i}`);
  return createCardInstance(def, {
    instanceId: `${playerId}-field-${i}`,
    ownerPlayerId: playerId,
    zone: "field",
    normalCoreCount: 2,
  });
}

function makeHandCard(i: number, playerId: string): CardInstance {
  const def = makeDef(`hand-${playerId}-${i}`);
  return createCardInstance(def, {
    instanceId: `${playerId}-hand-${i}`,
    ownerPlayerId: playerId,
    zone: "hand",
  });
}

function makeDeckCard(i: number, playerId: string): CardInstance {
  const def = makeDef(`deck-${playerId}-${i}`);
  return createCardInstance(def, {
    instanceId: `${playerId}-deck-${i}`,
    ownerPlayerId: playerId,
    zone: "deck",
  });
}

function makeCE(i: number, targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-${i}`,
    sourceInstanceId: `source-${i}`,
    sourceDefinitionId: `def-${i}`,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "bp_modifier",
    modifierAmount: i % 2 === 0 ? 1000 : -500,
    targetInstanceId,
  };
}

function makeUsageRecord(i: number): EffectUsageRecord {
  return {
    sourceInstanceId: `alice-field-${i % 5}`,
    sourceDefinitionId: `field-alice-${i % 5}`,
    effectLabel: `spirit:${i % 3}`,
    turnNumber: 1,
    step: "main",
    duration: "turn",
    count: 1,
  };
}

describe("getLegalActions benchmark", () => {
  it("late-game scenario throughput", () => {
    const cards: CardInstance[] = [];

    // alice: field 5, hand 3, deck 20
    for (let i = 0; i < 5; i++) cards.push(makeFieldCard(i, "alice"));
    for (let i = 0; i < 3; i++) cards.push(makeHandCard(i, "alice"));
    for (let i = 0; i < 20; i++) cards.push(makeDeckCard(i, "alice"));

    // bob: field 5, hand 2, deck 20
    for (let i = 0; i < 5; i++) cards.push(makeFieldCard(i, "bob"));
    for (let i = 0; i < 2; i++) cards.push(makeHandCard(i, "bob"));
    for (let i = 0; i < 20; i++) cards.push(makeDeckCard(i, "bob"));

    // CE: 30個 (field カードに分散)
    const ces: ContinuousEffect[] = [];
    for (let i = 0; i < 30; i++) {
      const target = i < 15 ? `alice-field-${i % 5}` : `bob-field-${i % 5}`;
      ces.push(makeCE(i, target));
    }

    // Usage records: 20件
    const usageRecords: EffectUsageRecord[] = [];
    for (let i = 0; i < 20; i++) usageRecords.push(makeUsageRecord(i));

    const defMap = new Map<string, CardDefinition>();
    for (const c of cards) {
      if (!defMap.has(c.definitionId)) {
        defMap.set(c.definitionId, makeDef(c.definitionId));
      }
    }

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    });
    const state = {
      ...base,
      step: "main" as const,
      window: "none" as const,
      activePlayerId: "alice",
      activeContinuousEffects: ces,
      effectUsageRecords: usageRecords,
    };

    const options = {
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id: string) => defMap.get(id),
      getRegisteredFieldCardEffectActions: () => [],
    };

    // Warm up
    getLegalActions(options);

    // Benchmark: 100 iterations
    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      getLegalActions(options);
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    console.log(
      `[BENCH] getLegalActions × ${iterations}: total=${totalMs.toFixed(1)}ms, avg=${avgMs.toFixed(3)}ms`
    );

    // Baseline assertion: should complete in reasonable time
    expect(avgMs).toBeLessThan(10);
  });
});
