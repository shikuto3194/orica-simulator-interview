/**
 * BSAZ03-M01「雨の断章」effects[0]:
 * 〔ターンに1回:同名〕トラッシュにあるこのカードは、本来のコスト6以上の自分のスピリットが
 * 相手によってフィールドを離れるとき、手札に戻せる。
 *
 * applicability.zone:["trash"] + timing.kind:"game_event" の組み合わせ自体に単一の同型先例は
 * 無いが、各構成要素 (applicability.zone による常駐ゾーン限定第三者観測は BSDB01-M02
 * effects[2]、cause:["opponent_effect","battle"] は「相手によって」の SSOT) は既存実装済み。
 * 第三者観測 (自分の別カードの leave_field を、トラッシュに常駐するこのカードが観測する) が
 * 実際に配線されているかを、game-event-battle-end-third-party.test.ts と同じ手法
 * (queuePendingLeave + collectAndQueueTriggerReactions + getAvailableTriggeredEffectSourceChoices)
 * で検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const M01 = cardNoMap.get("BSAZ03-M01")!;

const ALICE = "alice";
const BOB = "bob";

function makeSpiritDef(cost: number): CardDefinition {
  return {
    cardNo: `TEST-BSAZ03-M01-SPIRIT-${cost}`,
    name: `テストスピリット ${cost}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
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

function setup(opts: { spiritCost: number }) {
  const spiritDef = makeSpiritDef(opts.spiritCost);
  const spirit = createCardInstance(spiritDef, {
    instanceId: "spirit-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const trashCard = createCardInstance(M01, {
    instanceId: "m01-trash-1",
    ownerPlayerId: ALICE,
    zone: "trash",
  });
  const before: GameState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [spirit, trashCard],
  });
  const defs = new Map<string, CardDefinition>([
    [M01.cardNo, M01],
    [spiritDef.cardNo, spiritDef],
  ]);
  const getDef = (id: string) => defs.get(id);
  const lookup = buildTriggeredEffectLookup([M01, spiritDef]);
  return { before, spirit, trashCard, getDef, lookup };
}

/** 相手 (bob) 起因の破壊待機を積んだ after state + queue 済み pending triggered effects。 */
function destroyByOpponent(before: GameState, spiritInstanceId: string) {
  const chainId = "m01-recovery-chain";
  const withPendingLeave = queuePendingLeave({
    state: before,
    instanceId: spiritInstanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId: BOB,
    chainId,
  });
  return { withPendingLeave, chainId };
}

describe("BSAZ03-M01 effects[0]: トラッシュ常駐の自己回収 (本来コスト6以上の自分のスピリットが相手によって離れるとき)", () => {
  it("effect 定義: applicability.zone:trash + game_event(player:self, leave_field, cause:opponent) + usageLimit per_card_name", () => {
    const effect = M01.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      triggerFilter: {
        category: ["spirit"],
        costBasis: "printed",
        minCost: 6,
      },
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

  it("本来コスト6の自分のスピリットが相手起因で破壊されるとき、トラッシュのこのカードが誘発候補に含まれる", () => {
    const ctx = setup({ spiritCost: 6 });
    const { withPendingLeave, chainId } = destroyByOpponent(
      ctx.before,
      ctx.spirit.instanceId
    );
    const queued = collectAndQueueTriggerReactions({
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
      (p) => p.relatedInstanceId === ctx.spirit.instanceId
    );
    expect(pending).toBeDefined();
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

  it("本来コスト5 (6未満) の自分のスピリットでは、誘発候補が空のため pending 自体が queue されない", () => {
    // queueReactionsInternal は pending 生成時点で getAvailableTriggeredEffectSourceChoices を
    // 先読みし、候補ゼロなら pendingTriggeredEffects に積まない (無駄な pending を残さない最適化)。
    // triggerFilter.minCost:6 で弾かれることの間接証明。
    const ctx = setup({ spiritCost: 5 });
    const { withPendingLeave, chainId } = destroyByOpponent(
      ctx.before,
      ctx.spirit.instanceId
    );
    const queued = collectAndQueueTriggerReactions({
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
        (p) => p.relatedInstanceId === ctx.spirit.instanceId
      )
    ).toBeUndefined();
  });

  it("自分自身の効果 (self_effect) による破壊では、pending 自体が queue されない (cause:opponent_effect/battle 不一致)", () => {
    const ctx = setup({ spiritCost: 6 });
    const chainId = "m01-self-destroy-chain";
    const withPendingLeave = queuePendingLeave({
      state: ctx.before,
      instanceId: ctx.spirit.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      chainId,
    });
    const queued = collectAndQueueTriggerReactions({
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
        (p) => p.relatedInstanceId === ctx.spirit.instanceId
      )
    ).toBeUndefined();
  });

  it("実行: move_card でトラッシュのこのカードが手札に戻る", () => {
    const ctx = setup({ spiritCost: 6 });
    const effect = M01.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    const result = executeEffect({
      chainId: "test:bsaz03-m01-trash-recovery:217",
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
