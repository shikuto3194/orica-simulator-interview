/**
 * BSTH002-転醒R01(A) 魔界の転醒トリガー DSL 配線テスト
 * (engine-claude engine-drain-claude-explore, false-stub 解消)。
 *
 * 原文「自分の紫/白の効果で相手のカードがフィールドを離れたか、このネクサスが相手によって
 * フィールドを離れるとき、このネクサスを裏返せる。」は player が異なる2分岐の OR:
 *  - branch1 (effects[0]): 第三者(opponent)観測。BSDB01-CX01「自分の系統:「サイヤ人」に
 *    よって相手のカードがフィールドを離れるとき」の tribesRequired 版を colors に差し替えた
 *    同型 (game_event player:"opponent" + triggerSourceFilter.colors + cause:opponent_effect
 *    + sourceWhose:"either")。
 *  - branch2 (effects[1]): 自己観測。BSLH01-TR01(A)/TR04(A) と同型 (card_event leave_field)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const expandedMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getExpandedDef = (id: string) => expandedMap.get(id);

const ALICE = "alice";
const BOB = "bob";

const front = cardNoMap.get("BSTH002-転醒R01(A)")!;
const branch1Effect = front.effects![0]!;
const branch2Effect = front.effects![1]!;

function purpleSourceDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH002-R01-PURPLE-SOURCE",
    name: "テスト紫効果源",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    tribe: "幻想",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function nonMatchingColorSourceDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH002-R01-RED-SOURCE",
    name: "テスト赤効果源",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    tribe: "星竜",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function opponentTargetDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH002-R01-OPPONENT-TARGET",
    name: "テスト相手カード",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["blue"],
    tribe: "地球",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("BSTH002-転醒R01(A) 効果[0]: 第三者(相手)離脱観測 (game_event player:opponent, triggerSourceFilter.colors)", () => {
  it("timing/condition/steps が想定どおり配線されている", () => {
    expect(branch1Effect.stub).toBeUndefined();
    expect(branch1Effect.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "leave_field",
      triggerSourceFilter: { colors: ["purple", "white"] },
      cause: ["opponent_effect"],
      sourceWhose: "either",
    });
    expect(branch1Effect.condition).toEqual([
      { kind: "count_value", player: "self", max: 3 },
    ]);
    const action = branch1Effect.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") expect(action.maxCount).toBe(3);
  });

  it("自分の紫効果源によって相手のカードが離脱するとき、R01(A) が誘発候補に載る", () => {
    const purpleSource = purpleSourceDef();
    const opponentTarget = opponentTargetDef();
    const r01 = createCardInstance(front, {
      instanceId: "r01-third-party",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const purpleSourceInst = createCardInstance(purpleSource, {
      instanceId: "purple-source-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(opponentTarget, {
      instanceId: "opponent-target-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [r01, purpleSourceInst, target],
    });
    const defs = new Map<string, CardDefinition>([
      [front.cardNo, front],
      [purpleSource.cardNo, purpleSource],
      [opponentTarget.cardNo, opponentTarget],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([
      front,
      purpleSource,
      opponentTarget,
    ]);

    const chainId = "r01-third-party-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: target.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: purpleSourceInst.instanceId,
      chainId,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === target.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.effectSourceInstanceId).toBe(purpleSourceInst.instanceId);
  });

  it("効果源の色が紫/白と一致しないとき、誘発候補が空になる (triggerSourceFilter.colors で除外)", () => {
    const redSource = nonMatchingColorSourceDef();
    const opponentTarget = opponentTargetDef();
    const r01 = createCardInstance(front, {
      instanceId: "r01-red-source",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const redSourceInst = createCardInstance(redSource, {
      instanceId: "red-source-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(opponentTarget, {
      instanceId: "opponent-target-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [r01, redSourceInst, target],
    });
    const defs = new Map<string, CardDefinition>([
      [front.cardNo, front],
      [redSource.cardNo, redSource],
      [opponentTarget.cardNo, opponentTarget],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([
      front,
      redSource,
      opponentTarget,
    ]);

    const chainId = "r01-red-source-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: target.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: redSourceInst.instanceId,
      chainId,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === target.instanceId
    );
    expect(pending).toBeUndefined();
  });

  it("実行: 第三者離脱観測から R01(A) 自身が rebirth flip する", () => {
    const inst = createCardInstance(front, {
      instanceId: "r01-execute-branch1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inst],
    });
    const result = executeEffect({
      chainId: "test:bsth002-r01-rebirth-third-party-color-trigger:254",
      state: before,
      effect: branch1Effect,
      sourceInstanceId: "r01-execute-branch1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getExpandedDef,
    });
    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "r01-execute-branch1"
    )!;
    expect(flipped.definitionId).toBe("BSTH002-転醒R01(B)");
  });
});

describe("BSTH002-転醒R01(A) 効果[1]: 自己離脱観測 (card_event leave_field、BSLH01-TR01型)", () => {
  it("timing/condition/steps が想定どおり配線されている", () => {
    expect(branch2Effect.stub).toBeUndefined();
    expect(branch2Effect.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(branch2Effect.condition).toEqual([
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(branch2Effect.steps.length).toBe(1);
  });

  it("R01(A) 自身が相手起因で離脱するとき、自身が誘発候補に載る", () => {
    const r01 = createCardInstance(front, {
      instanceId: "r01-self-departure",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [r01],
    });
    const defs = new Map<string, CardDefinition>([[front.cardNo, front]]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([front]);

    const chainId = "r01-self-departure-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: r01.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === r01.instanceId
      )
    ).toBeDefined();
  });

  it("実行: 相手起因の破壊待機状態で executeRebirth → 裏面へ flip", () => {
    const inst = createCardInstance(front, {
      instanceId: "r01-execute-branch2",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    inst.pendingLeaveKind = "destroy";
    inst.pendingLeaveCause = "effect_resolution";
    inst.pendingLeaveChainId = "chain-bsth002-r01-branch2";
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inst],
    });
    before.pendingLeaveEntities = [
      {
        instanceId: "r01-execute-branch2",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: "chain-bsth002-r01-branch2",
        deferZoneMoveUntilChainEnd: false,
      },
    ];
    const result = executeEffect({
      chainId: "test:bsth002-r01-rebirth-third-party-color-trigger:349",
      state: before,
      effect: branch2Effect,
      sourceInstanceId: "r01-execute-branch2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getExpandedDef,
    });
    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "r01-execute-branch2"
    )!;
    expect(flipped.definitionId).toBe("BSTH002-転醒R01(B)");
    expect(flipped.pendingLeaveKind).toBeNull();
  });
});
