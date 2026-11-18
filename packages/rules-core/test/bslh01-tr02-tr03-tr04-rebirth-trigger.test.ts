/**
 * BSLH01-TR02(A)/TR03(A)/TR04(A) 転醒トリガーの DSL 配線テスト
 * (engine-drain-claude-explore, 型拡張ギャップ「転醒トリガー」false-stub 解消)。
 *
 * TR01(A) (bslh01-tr01-rebirth-trigger.test.ts) の「このスピリット自身が相手によって
 * 離脱時、ENIGMA があれば裏返す」card_event 前例を踏まえ:
 *  - TR02(A): 「自分のスピリットが」(第三者観測) + 「トラッシュの<ソウルコア>以外の
 *    コア1個を置いて」裏返す。game_event(leave_field, player:"self",
 *    triggerFilter:{category:["spirit"]}) + core_move(trash→this_card) + rebirth。
 *  - TR03(A): 「自分のスピリット/このネクサス」= 第三者(spirit) ∪ 自己(cardName:"self")
 *    の OR。ENIGMA ゲート無し。
 *  - TR04(A): TR01(A) と同型 (自己 card_event + ENIGMA ゲート、コア配置なし)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  evaluateCondition,
  executeRebirth,
} from "../src/effect/structured-effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src";
import type { CardDefinition, Condition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const expandedMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getExpandedDef = (id: string) => expandedMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function otherSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-BSLH01-TR0X-SPIRIT",
    name: "テストスピリット",
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

function otherNexusDef(): CardDefinition {
  return {
    cardNo: "TEST-BSLH01-TR0X-NEXUS",
    name: "テストネクサス",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["yellow"],
    levelDefs: [{ level: 1, requiredCores: 1 }],
    symbolColors: ["yellow"],
    tribe: "地球",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function findRebirthEffect(def: CardDefinition) {
  return def.effects!.find(
    (e) =>
      Array.isArray(e.textRef) &&
      e.textRef[0] === 3 &&
      e.textRef[1] === 4 &&
      e.steps.some((s) => s.action.kind === "rebirth")
  )!;
}

describe("BSLH01-TR02(A) [碧の軌跡]ワジ・ヘミスフィア 転醒トリガー", () => {
  const front = cardNoMap.get("BSLH01-TR02(A)")!;
  const rebirthEffect = findRebirthEffect(front);

  it("効果[3,4]: 第三者離脱観測 (game_event leave_field, triggerFilter:spirit) + core_move(trash→this_card) + rebirth", () => {
    expect(rebirthEffect.stub).toBeUndefined();
    expect(rebirthEffect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      triggerFilter: { category: ["spirit"] },
      cause: ["opponent_effect", "battle"],
    });
    expect(rebirthEffect.executionMode).toBe("optional");
    expect(rebirthEffect.condition).toEqual([
      { kind: "count_value", player: "self", max: 9 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ENIGMA" }],
        includeSoulState: true,
      },
    ]);
    expect(rebirthEffect.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "this_card" },
      amount: 1,
      effectKind: "normal_only",
    });
    const rebirthAction = rebirthEffect.steps[1]!.action;
    expect(rebirthAction.kind).toBe("rebirth");
    if (rebirthAction.kind === "rebirth") {
      expect(rebirthAction.maxCount).toBe(9);
      // B面 textLines[0]「この面に裏返ったとき、フィールドに残る。」にカウント増減の
      // 記述が無いため、定型文由来の自動+1(デフォルト)を明示的に抑止する (P3-132)。
      expect(rebirthAction.countBonusMode).toBe("none");
    }
  });

  it("自分の他のスピリットが相手起因で離脱するとき、TR02(A) 自身が誘発候補に載る (ENIGMA 魂状態ゲート成立)", () => {
    const spiritDef = otherSpiritDef();
    const enigmaCard = ALL_CARDS.find((c) => c.name.includes("ENIGMA"))!;
    const tr02 = createCardInstance(front, {
      instanceId: "tr02-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const otherSpirit = createCardInstance(spiritDef, {
      instanceId: "other-spirit-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enigmaInst = createCardInstance(enigmaCard, {
      instanceId: "enigma-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [tr02, otherSpirit, enigmaInst],
    });
    before.players
      .find((p) => p.id === ALICE)!
      .soulStateInstanceIds.push("enigma-1");
    const defs = new Map<string, CardDefinition>([
      [front.cardNo, front],
      [spiritDef.cardNo, spiritDef],
      [enigmaCard.cardNo, enigmaCard],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([front, spiritDef, enigmaCard]);

    const chainId = "tr02-departure-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: otherSpirit.instanceId,
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
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === otherSpirit.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.cause).toBe("opponent_effect");
  });

  it("自分のネクサスが相手起因で離脱しても、triggerFilter.category不一致のため候補が空", () => {
    const nexusDef = otherNexusDef();
    const tr02 = createCardInstance(front, {
      instanceId: "tr02-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const otherNexus = createCardInstance(nexusDef, {
      instanceId: "other-nexus-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [tr02, otherNexus],
    });
    const defs = new Map<string, CardDefinition>([
      [front.cardNo, front],
      [nexusDef.cardNo, nexusDef],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([front, nexusDef]);

    const chainId = "tr02-nexus-departure-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: otherNexus.instanceId,
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
        (p) => p.relatedInstanceId === otherNexus.instanceId
      )
    ).toBeUndefined();
  });

  it("実行: トラッシュの通常コア1個→自身に配置 + rebirth flip (ENIGMA 魂状態ゲート成立)", () => {
    const enigmaCard = ALL_CARDS.find((c) => c.name.includes("ENIGMA"))!;
    const inst = createCardInstance(front, {
      instanceId: "tr02-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const enigmaInst = createCardInstance(enigmaCard, {
      instanceId: "enigma-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ trashNormalCoreCount: 2, countValue: 3 }, {}],
      cardInstances: [inst, enigmaInst],
    });
    before.players
      .find((p) => p.id === ALICE)!
      .soulStateInstanceIds.push("enigma-1");
    const getDefWithEnigma = (id: string) =>
      id === enigmaCard.cardNo ? enigmaCard : getExpandedDef(id);
    const result = executeEffect({
      chainId: "test:bslh01-tr02-tr03-tr04-rebirth-trigger:265",
      state: before,
      effect: rebirthEffect,
      sourceInstanceId: "tr02-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithEnigma,
    });
    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "tr02-1"
    )!;
    // core_move(trash→this_card, amount:1) が先に適用され、flip 後の裏面カードに乗る。
    expect(flipped.definitionId).toBe("BSLH01-TR02(B)");
    expect(flipped.normalCoreCount).toBe(2);
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(1);
    // B面に「カウント+1する」定型文が無いため、転醒してもカウントは変動しない (P3-132)。
    expect(alice.countValue).toBe(3);
  });
});

describe("BSLH01-TR03(A) [零の軌跡]リーシャ・マオ 転醒トリガー", () => {
  const front = cardNoMap.get("BSLH01-TR03(A)")!;
  const rebirthEffect = findRebirthEffect(front);

  it("効果[3,4]: 第三者/自己離脱観測 OR (filterOr: spirit ∪ cardName:self) + core_move + rebirth、ENIGMAゲート無し", () => {
    expect(rebirthEffect.stub).toBeUndefined();
    expect(rebirthEffect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      triggerFilter: {
        filterOr: [{ category: ["spirit"] }, { cardName: "self" }],
      },
      cause: ["opponent_effect", "battle"],
    });
    expect(rebirthEffect.condition).toEqual([
      { kind: "count_value", player: "self", max: 8 },
    ]);
    expect(rebirthEffect.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "this_card" },
      amount: 1,
      effectKind: "normal_only",
    });
    const rebirthAction = rebirthEffect.steps[1]!.action;
    expect(rebirthAction.kind).toBe("rebirth");
    // B面 textLines[0]「この面に裏返ったとき、フィールドに残る。」にカウント増減の
    // 記述が無いため、定型文由来の自動+1(デフォルト)を明示的に抑止する (P3-132)。
    if (rebirthAction.kind === "rebirth")
      expect(rebirthAction.countBonusMode).toBe("none");
  });

  it("TR03(A) 自身が相手起因で離脱するとき、cardName:self マッチで自身が誘発候補に載る", () => {
    const tr03 = createCardInstance(front, {
      instanceId: "tr03-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [tr03],
    });
    const defs = new Map<string, CardDefinition>([[front.cardNo, front]]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([front]);

    const chainId = "tr03-self-departure-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: tr03.instanceId,
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
        (p) => p.relatedInstanceId === tr03.instanceId
      )
    ).toBeDefined();
  });
});

describe("BSLH01-TR04(A) [碧の軌跡]ヴァルド・ヴァレス 転醒トリガー", () => {
  const front = cardNoMap.get("BSLH01-TR04(A)")!;
  const rebirthEffect = findRebirthEffect(front);

  it("効果[3,4]: TR01(A) 同型 (自己 card_event + count_value + field_has ENIGMA、コア配置無し)", () => {
    expect(rebirthEffect.stub).toBeUndefined();
    expect(rebirthEffect.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(rebirthEffect.condition).toEqual([
      { kind: "count_value", player: "self", max: 9 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ENIGMA" }],
        includeSoulState: true,
      },
    ]);
    expect(rebirthEffect.steps.length).toBe(1);
    const action = rebirthEffect.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") {
      expect(action.maxCount).toBe(9);
      expect(action.countBonusMode).toBe("none");
    }
  });

  it("ENIGMA 魂状態不在 → field_has ゲート不成立", () => {
    const inst = createCardInstance(front, {
      instanceId: "tr04-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inst],
    });
    const ok = evaluateCondition(
      state,
      rebirthEffect.condition as Condition,
      "tr04-1",
      ALICE,
      getExpandedDef
    );
    expect(ok).toBe(false);
  });

  it("実行: 相手起因の破壊待機状態で executeRebirth → 裏面へ flip", () => {
    const inst = createCardInstance(front, {
      instanceId: "tr04-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
    });
    inst.pendingLeaveKind = "destroy";
    inst.pendingLeaveCause = "effect_resolution";
    inst.pendingLeaveChainId = "chain-bslh01-tr04";
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inst],
      playerOverrides: [{ countValue: 4 }, {}],
    });
    before.pendingLeaveEntities = [
      {
        instanceId: "tr04-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: "chain-bslh01-tr04",
        deferZoneMoveUntilChainEnd: false,
      },
    ];
    const after = executeRebirth(
      before,
      ALICE,
      {
        kind: "rebirth",
        maxCount: 9,
        countBonusMode: "none",
        triggerDescription: "",
      },
      "tr04-1",
      getExpandedDef,
      "test:bslh01-tr02-tr03-tr04-rebirth-trigger:438"
    );
    const flipped = after.cardInstances.find((c) => c.instanceId === "tr04-1")!;
    expect(flipped.definitionId).toBe("BSLH01-TR04(B)");
    expect(flipped.pendingLeaveKind).toBeNull();
    // B面に「カウント+1する」定型文が無いため、転醒してもカウントは変動しない (P3-132)。
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(4);
  });
});
