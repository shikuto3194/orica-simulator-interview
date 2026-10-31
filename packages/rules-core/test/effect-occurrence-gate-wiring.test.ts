/**
 * ENGINE-nth-occurrence-trigger-gate Step2: trigger-system.ts 検出パイプラインへの実配線検証。
 *
 * `effect-occurrence-gate.ts`(Step1) の primitive 自体は effect-occurrence-gate.test.ts で
 * 検証済み。本テストは `Effect.occurrenceGate` → registration → `queueReactionsInternal` の
 * source choice 列挙 (private/public 分岐前) で tally + ゲート判定が実際に効くことを検証する。
 * card-data 配線 (BSLH01-C05/R03 quartz set-effect 本体) は Step3 (未着手)。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/model";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

function makeDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `Test ${cardNo}`,
    printedCategory: "spirit",
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

function makeOccurrenceGatedSummonTriggerDef(
  cardNo: string,
  targetCount: number
): CardDefinition {
  return {
    ...makeDef(cardNo),
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        occurrenceGate: { duration: "turn", targetCount },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  } as CardDefinition;
}

function makeLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(definitions.map((def) => [def.cardNo, def]));
  return (definitionId: string) => map.get(definitionId);
}

function makeSummonEvent(
  overrides: Partial<CollectedTriggerEvent> & { chainId: string }
): CollectedTriggerEvent {
  return {
    chainId: "test:effect-occurrence-gate-wiring:64",
    eventKind: "summon",
    actingPlayerId: "alice",
    source: "action_resolution",
    attackId: null,
    relatedPlayerId: "alice",
    // card_event は「このカード自身のイベントのみ反応」(relatedInstanceId === sourceCard.instanceId、
    // trigger-system.ts L1770 付近) のため、"このスピリットの召喚時" を模した自己参照イベントにする。
    relatedInstanceId: "occ-gate-1",
    amount: null,
    ...overrides,
  } as CollectedTriggerEvent;
}

describe("ENGINE-nth-occurrence-trigger-gate Step2: trigger-system wiring", () => {
  it("targetCount 未満の観測では pending が積まれず、Nth 回目でだけ発火する", () => {
    const def = makeOccurrenceGatedSummonTriggerDef("TEST-OCC-GATE", 2);
    const definitions = [def];
    const lookup = makeLookup(definitions);
    const gateCard = createCardInstance(def, {
      instanceId: "occ-gate-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [gateCard],
    });
    const lookupOptions = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    };

    // 1回目の観測: tally=1 (targetCount=2 と不一致) → 発火しない
    const afterFirst = queuePendingReactionsFromTriggerEvents(
      baseState,
      [makeSummonEvent({ chainId: "chain:1" })],
      undefined,
      lookupOptions
    );
    expect(afterFirst.pendingTriggeredEffects).toHaveLength(0);
    expect(afterFirst.pendingPrivateDeclarations).toHaveLength(0);
    expect(
      afterFirst.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "occ-gate-1"
      )?.count
    ).toBe(1);

    // 2回目の観測 (前回の state を継承): tally=2 (targetCount と一致) → 発火する
    const afterSecond = queuePendingReactionsFromTriggerEvents(
      afterFirst,
      [makeSummonEvent({ chainId: "chain:2" })],
      undefined,
      lookupOptions
    );
    const queuedCountAfterSecond =
      afterSecond.pendingTriggeredEffects.length +
      afterSecond.pendingPrivateDeclarations.length;
    expect(queuedCountAfterSecond).toBeGreaterThan(0);
    expect(
      afterSecond.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "occ-gate-1"
      )?.count
    ).toBe(2);

    // 3回目の観測: tally=3 (targetCount と不一致に戻る) → 新規 pending は積まれない
    const afterThird = queuePendingReactionsFromTriggerEvents(
      afterSecond,
      [makeSummonEvent({ chainId: "chain:3" })],
      undefined,
      lookupOptions
    );
    const queuedCountAfterThird =
      afterThird.pendingTriggeredEffects.length +
      afterThird.pendingPrivateDeclarations.length;
    expect(queuedCountAfterThird).toBe(queuedCountAfterSecond);
    expect(
      afterThird.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "occ-gate-1"
      )?.count
    ).toBe(3);
  });

  it("verifier round1 refute回帰: suppressされた観測もtallyは無条件で加算される (発動可否に関わらず)", () => {
    const def = makeOccurrenceGatedSummonTriggerDef(
      "TEST-OCC-GATE-SUPPRESS",
      2
    );
    const definitions = [def];
    const lookup = makeLookup(definitions);
    const gateCard = createCardInstance(def, {
      instanceId: "occ-gate-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [gateCard],
    });
    const lookupOptions = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    };

    // 1回目の観測は suppressDestroyedEffects:"all_opponent" 相当で effectSuppressed:true
    // (この回の反応そのものは止まるが、「観測されたこと」自体の tally は無条件加算される想定)。
    const afterFirst = queuePendingReactionsFromTriggerEvents(
      baseState,
      [makeSummonEvent({ chainId: "chain:1", effectSuppressed: true })],
      undefined,
      lookupOptions
    );
    expect(afterFirst.pendingTriggeredEffects).toHaveLength(0);
    expect(afterFirst.pendingPrivateDeclarations).toHaveLength(0);
    expect(
      afterFirst.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "occ-gate-1"
      )?.count
    ).toBe(1);

    // 2回目は suppress されない通常の観測: tally=2 (targetCount と一致) → 発火する。
    // suppress された1回目が tally から欠落していれば、ここでも count=1 のまま発火しない。
    const afterSecond = queuePendingReactionsFromTriggerEvents(
      afterFirst,
      [makeSummonEvent({ chainId: "chain:2" })],
      undefined,
      lookupOptions
    );
    expect(
      afterSecond.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "occ-gate-1"
      )?.count
    ).toBe(2);
    const queuedCountAfterSecond =
      afterSecond.pendingTriggeredEffects.length +
      afterSecond.pendingPrivateDeclarations.length;
    expect(queuedCountAfterSecond).toBeGreaterThan(0);
  });
});
