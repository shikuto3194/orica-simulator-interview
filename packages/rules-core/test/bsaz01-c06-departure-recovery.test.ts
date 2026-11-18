import { collectAfterPhysicalLeave } from "./physical-leave-test-helper";
/**
 * BSAZ01-C06「出撃」effects[0]:
 * 〔ターンに1回：同名〕トラッシュにあるこのカードは、自分のブレイヴ/ネクサスが相手によって
 * フィールドを離れたとき、手札に戻せる。
 *
 * BSAZ03-M01 effects[0] (bsaz03-m01-trash-recovery.test.ts) と同型の
 * applicability.zone:["trash"] + timing.kind:"game_event"(leave_field, cause:opponent_effect/battle)
 * 第三者トラッシュ常駐リスナー。triggerFilter.category を spirit から brave/nexus に差し替え、
 * costBasis/minCost 条件は原文に無いため付与しない点のみ異なる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C06 = cardNoMap.get("BSAZ01-C06")!;

const ALICE = "alice";
const BOB = "bob";

function makeNexusDef(): CardDefinition {
  return {
    cardNo: "TEST-BSAZ01-C06-NEXUS",
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

function makeSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-BSAZ01-C06-SPIRIT",
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

function setup(fieldCardDef: CardDefinition) {
  const fieldCard = createCardInstance(fieldCardDef, {
    instanceId: "field-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const trashCard = createCardInstance(C06, {
    instanceId: "c06-trash-1",
    ownerPlayerId: ALICE,
    zone: "trash",
  });
  const before: GameState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [fieldCard, trashCard],
  });
  const defs = new Map<string, CardDefinition>([
    [C06.cardNo, C06],
    [fieldCardDef.cardNo, fieldCardDef],
  ]);
  const getDef = (id: string) => defs.get(id);
  const lookup = buildTriggeredEffectLookup([C06, fieldCardDef]);
  return { before, fieldCard, trashCard, getDef, lookup };
}

function leaveByOpponent(before: GameState, instanceId: string) {
  const chainId = "c06-recovery-chain";
  const withPendingLeave = queuePendingLeave({
    state: before,
    instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId: BOB,
    chainId,
  });
  return { withPendingLeave, chainId };
}

describe("BSAZ01-C06 effects[0]: トラッシュ常駐の自己回収 (自分のブレイヴ/ネクサスが相手によって離れたとき)", () => {
  it("effect 定義: applicability.zone:trash + game_event(player:self, leave_field, cause:opponent) + usageLimit per_card_name", () => {
    const effect = C06.effects!.find(
      (e) =>
        Array.isArray(e.textRef) && e.textRef[0] === 0 && e.textRef.length === 1
    )!;
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      exactEventKind: true,
      triggerFilter: { category: ["brave", "nexus"] },
      cause: ["opponent_effect", "battle"],
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps[0]!.action).toEqual({
      kind: "move_card",
      target: { kind: "self" },
      from: { zone: "trash", player: "self" },
      to: { zone: "hand" },
      count: 1,
      requireFullCount: true,
    });
  });

  it("自分のネクサスが相手起因でフィールドを離れたとき、トラッシュのこのカードが誘発候補に含まれる", () => {
    const ctx = setup(makeNexusDef());
    const { withPendingLeave, chainId } = leaveByOpponent(
      ctx.before,
      ctx.fieldCard.instanceId
    );
    const queued = collectAfterPhysicalLeave({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.fieldCard.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.eventKind).toBe("leave_field");
    expect(queued.pendingBurstChecks).toHaveLength(1);
    expect(
      queued.cardInstances.find(
        (card) => card.instanceId === ctx.fieldCard.instanceId
      )?.zone
    ).toBe("trash");
    expect(pending!.cause).toBe("opponent_effect");

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.trashCard.instanceId)
    ).toBeDefined();
  });

  it("自分のスピリットが相手起因でフィールドを離れても、triggerFilter.category不一致のため誘発候補が空 (pending自体queueされない)", () => {
    const ctx = setup(makeSpiritDef());
    const { withPendingLeave, chainId } = leaveByOpponent(
      ctx.before,
      ctx.fieldCard.instanceId
    );
    const queued = collectAfterPhysicalLeave({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === ctx.fieldCard.instanceId
      )
    ).toBeUndefined();
  });

  it("自分自身の効果 (self_effect) によるネクサス離脱では、pending 自体が queue されない (cause:opponent_effect/battle 不一致)", () => {
    const ctx = setup(makeNexusDef());
    const chainId = "c06-self-leave-chain";
    const withPendingLeave = queuePendingLeave({
      state: ctx.before,
      instanceId: ctx.fieldCard.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      chainId,
    });
    const queued = collectAfterPhysicalLeave({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === ctx.fieldCard.instanceId
      )
    ).toBeUndefined();
  });

  it("代替コスト機構(textRef[2])は実装済み: return_to_deck_bottom_field の useCostPayment を持つ (詳細は bsaz01-c06-alt-cost-field-magic-return.test.ts)", () => {
    const effect = C06.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 2
    )!;
    expect(effect.stub).toBeUndefined();
    const step = effect.steps[0]!;
    expect(step.action.kind).toBe("cost_modify");
    if (step.action.kind !== "cost_modify") return;
    expect(step.action.useCostPayment).toEqual({
      kind: "return_to_deck_bottom_field",
      sourceZone: "field",
      maxCount: 3,
      filter: { category: ["magic"] },
    });
  });

  it("実行: move_card でトラッシュのこのカードが手札に戻る", () => {
    const ctx = setup(makeNexusDef());
    const effect = C06.effects!.find(
      (e) =>
        Array.isArray(e.textRef) && e.textRef[0] === 0 && e.textRef.length === 1
    )!;
    const result = executeEffect({
      chainId: "test:bsaz01-c06-departure-recovery:247",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.trashCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: ctx.getDef,
    });
    const moved = result.cardInstances.find(
      (c) => c.instanceId === ctx.trashCard.instanceId
    )!;
    expect(moved.zone).toBe("hand");
  });
});
