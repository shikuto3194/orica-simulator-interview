import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { applyActionAndChooseEntryCores } from "./helpers/choose-effect-entry-cores";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSAZ01 (アルドノア・ゼロ-地球-) カードの effects 検証テスト。
 * KG-6 スレイプニール（煌臨）/ 地球・ＣＦ 中心。
 * トラッシュ起点の同名煌臨・【タイプ：作戦】フィールド常駐マジック・動的軽減・分身生成・
 * 契約は基盤未実装のため stub。BP-minus→BP0破壊 / ドロー / デッキオープン等の
 * 誘発効果のみ DSL 変換済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  getEffectiveSymbols,
  recordEffectUsage,
  trainingProgressFingerprint,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import { resolveLifeDamage } from "../src/core/core-system";
import { createEffectResolutionScope } from "../src/effect/effect-resolution-scope";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import {
  canUseEffectByUsageLimit,
  getCandidateTargetInstanceIds,
  getStableEffectLabel,
} from "../src/legal/legal-actions-shared";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import type {
  CardCategory,
  CardDefinition,
  GameState,
  LegalAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsaz01-cards:57",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSAZ01-C01 KG-6 スレイプニール", () => {
  const c = card("BSAZ01-C01");
  it("トラッシュ起点煌臨 adventData + 召喚時ドロー(合体中+1) + アタック時BP-2000→BP0破壊", () => {
    // 〔ターンに1回：同名〕トラッシュ起点煌臨 → adventData へ変換 (declare_advent 配線済み)。
    expect(c.adventData).toBeUndefined();
    expect(c.trashAdventHostGrant!.chargeCoresOnAdvent).toBe(true);
    expect(c.trashAdventHostGrant!.cardNames).toContainEqual({
      contains: "スレイプニール",
    });
    // 煌臨 stub は撤去済み（adventData へ移行）。
    expect(
      (c.effects ?? []).some(
        (e) => typeof e.stub === "string" && e.stub.includes("煌臨")
      )
    ).toBe(false);
    // 召喚時ドロー（発揮は任意、合体中+1は同じ発揮内で強制）。
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps[0]!.action.kind).toBe("draw");
    expect(summon.steps).toHaveLength(1);
    expect(
      c.effects!.filter(
        (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
      )
    ).toHaveLength(1);
    // アタック時 BP-2000 → BP0破壊。
    const attack = c.effects![1]!;
    expect(attack.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(attack.steps[0]!.action.kind).toBe("bp_modify");
    expect(attack.steps[1]!.action.kind).toBe("destroy");
  });

  it("召喚時ドロー実行: 非合体は1枚、合体中は同じ発揮判断で2枚引く", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 40,
      playerOverrides: [{ handCount: 4 }, { handCount: 4 }],
    });
    const self = createCardInstance(c, {
      instanceId: "slep-c01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const nonCombined = runEffect(
      { ...base, activePlayerId: "alice", step: "main", cardInstances: [self] },
      c.effects![0]!,
      "slep-c01",
      "alice"
    );
    expect(nonCombined.players.find((p) => p.id === "alice")!.handCount).toBe(
      5
    );
    expect(nonCombined.players.find((p) => p.id === "alice")!.deckCount).toBe(
      39
    );

    const combinedSelf = createCardInstance(c, {
      instanceId: "slep-c01-combined",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(card("BSAZ01-C18"), {
      instanceId: "brave-c18",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: "slep-c01-combined",
    });
    combinedSelf.attachedChildrenIds = ["brave-c18"];
    const combined = runEffect(
      {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [combinedSelf, brave],
      },
      c.effects![0]!,
      "slep-c01-combined",
      "alice"
    );
    expect(combined.players.find((p) => p.id === "alice")!.handCount).toBe(6);
    expect(combined.players.find((p) => p.id === "alice")!.deckCount).toBe(38);
  });
});

describe("BSAZ01-C02 KG-6 スレイプニール［宇宙装備］", () => {
  const c = card("BSAZ01-C02");
  it("トラッシュ起点煌臨 adventData + 召喚時デッキ4オープン→地球カード1回収 + アタック/ブロック時BP-3000→BP0破壊", () => {
    expect(c.adventData).toBeUndefined();
    expect(c.trashAdventHostGrant!.chargeCoresOnAdvent).toBe(true);
    expect(
      (c.effects ?? []).some(
        (e) => typeof e.stub === "string" && e.stub.includes("煌臨")
      )
    ).toBe(false);
    const summon = c.effects![0]!;
    expect(summon.steps[0]!.action.kind).toBe("deck_reveal");
    const attack = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
    )!;
    expect(attack.steps[0]!.action.kind).toBe("bp_modify");
    expect(attack.steps[0]!.repeat).toEqual({
      additional: 1,
      optional: true,
      condition: [{ kind: "combined" }],
    });
    expect(attack.steps[1]!.action.kind).toBe("destroy");
    const block = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "block"
    )!;
    expect(block.steps[0]!.action.kind).toBe("bp_modify");
    expect(block.steps[0]!.repeat).toEqual({
      additional: 1,
      optional: true,
      condition: [{ kind: "combined" }],
    });
    expect(block.steps[1]!.action.kind).toBe("destroy");
  });
});

// BSAZ01-C03〜C12 は全カード stub 解消済み (完全実装済み):
// - C03: cluster engine-bsaz01-c03-opponent-turn-skip (13枚以上 = end_turn +
//   discard(fromZone:"deck", targetHandSize:1) + 新設 skip_next_turn primitive
//   (ENGINE-opponent-turn-skip)。bsaz01-c03-exclude-threshold.test.ts 参照)。
// - C04/C07/C08/C09/C10: engine-field-magic-self-placement 系
//   (各 bsaz01-c0{4,7,8,9,10}-*.test.ts 参照)。
// - C05: 既存 battleState + unseen discard + use_magic_without_cost
//   (bsaz01-c05-encounter-and-farewell.test.ts 参照)。
// - C06: engine-magic-field-alt-cost-and-departure-recovery
//   (bsaz01-c06-departure-recovery.test.ts / bsaz01-c06-alt-cost-field-magic-return.test.ts 参照)。
// - C11: ENGINE-brave-combine-third-party-target + ENGINE-cumulative-bp-budget-destroy
//   (bsaz01-c11-field-flash-budget-destroy.test.ts 参照)。
// - C12: engine-magic-field-pre-cost-payment-trigger (offer_magic_pre_cost_trigger 新設。
//   engine-magic-field-pre-cost-payment-trigger.test.ts 参照)。

describe("BSAZ01-C16 カーム・クラフトマン", () => {
  const c = card("BSAZ01-C16");
  it("配置時デッキ5オープン→地球・ＣＦスピリット+地球ブレイヴを2pick", () => {
    const place = c.effects![0]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    const reveal = place.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(5);
      expect(reveal.picks).toHaveLength(2);
      expect(reveal.remainder).toBe("bottom");
    }
    expect(c.effects![1]!.stub).toBeUndefined();
  });

  it("Lv2離脱反応: 相手起因leave_field + 地球・ＣＦ AND + 手札破棄conditional_cost回収", () => {
    const effect = c.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      exactEventKind: true,
      triggerFilter: {
        category: ["spirit"],
        tribes: ["地球", "ＣＦ"],
        tribesLogic: "and",
      },
      cause: ["opponent_effect", "battle"],
    });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.executionMode).toBe("optional");
    expect(effect.steps[0]!.action).toEqual({
      kind: "discard",
      count: 1,
      player: "self",
    });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    expect(effect.steps[1]!.id).toBe("c16-recover");
    const action = effect.steps[1]!.action;
    expect(action.kind).toBe("move_card");
    if (action.kind === "move_card") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        zone: "trash",
        filter: {
          category: ["spirit"],
          tribes: ["地球", "ＣＦ"],
          tribesLogic: "and",
        },
        count: 1,
      });
      expect(action.from).toEqual({
        zone: "trash",
        player: "self",
        filter: {
          category: ["spirit"],
          tribes: ["地球", "ＣＦ"],
          tribesLogic: "and",
        },
      });
      expect(action.to).toEqual({ zone: "hand" });
      expect(action.requireFullCount).toBe(true);
    }
  });

  function setupC16LeaveTrigger(sourceCoreCount: number) {
    const spiritDef = card("BSAZ01-C01");
    const source = createCardInstance(c, {
      instanceId: "c16-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: sourceCoreCount,
    });
    const leaver = createCardInstance(spiritDef, {
      instanceId: "earth-cf-leaver",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, leaver],
    });
    const lookup = buildTriggeredEffectLookup([c, spiritDef]);
    const chainId = "c16-leave-chain";
    const afterLeave = queuePendingLeave({
      state,
      instanceId: leaver.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId,
    });
    const preFlushQueued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const flushed = flushPendingLeaves(afterLeave, getCardDefinitionById);
    const queued = collectAndQueueTriggerReactions({
      beforeState: afterLeave,
      afterState: flushed,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    return {
      source,
      leaver,
      lookup,
      afterLeave,
      preFlushQueued,
      flushed,
      queued,
    };
  }

  it("自分の地球・ＣＦスピリットが相手によって離れたとき、Lv2のC16が誘発候補に含まれる", () => {
    const ctx = setupC16LeaveTrigger(2);
    const preFlushPending = ctx.preFlushQueued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.leaver.instanceId
    );
    expect(preFlushPending).toBeUndefined();
    expect(
      ctx.flushed.cardInstances.find(
        (i) => i.instanceId === ctx.leaver.instanceId
      )?.zone
    ).toBe("trash");

    const pending = ctx.queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.leaver.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.eventKind).toBe("leave_field");
    expect(pending!.cause).toBe("opponent_effect");

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.queued,
      pendingEffect: pending!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "c16-field")
    ).toBeDefined();
  });

  it("pending leave 非経由で直接手札へ戻った実離脱も、post leave_field としてC16に届く", () => {
    const spiritDef = card("BSAZ01-C01");
    const source = createCardInstance(c, {
      instanceId: "c16-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const leaver = createCardInstance(spiritDef, {
      instanceId: "earth-cf-direct-leaver",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, leaver],
    });
    const afterDirectLeave = {
      ...state,
      players: state.players.map((player) =>
        player.id === "alice"
          ? { ...player, handCount: player.handCount + 1 }
          : player
      ),
      cardInstances: state.cardInstances.map((instance) =>
        instance.instanceId === leaver.instanceId
          ? { ...instance, zone: "hand" as const }
          : instance
      ),
    };
    const lookup = buildTriggeredEffectLookup([c, spiritDef]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: afterDirectLeave,
      source: "action_resolution",
      chainId: "c16-direct-leave-chain",
      attackId: null,
      causedByPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === leaver.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.eventKind).toBe("leave_field");
    expect(pending!.cause).toBe("opponent_effect");

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choices.find(
        (choice) => choice.sourceCard.instanceId === source.instanceId
      )
    ).toBeDefined();
  });

  it("pending leave 非経由で直接トラッシュへ置かれた実離脱も、post leave_field としてC16に届く", () => {
    const spiritDef = card("BSAZ01-C01");
    const source = createCardInstance(c, {
      instanceId: "c16-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const leaver = createCardInstance(spiritDef, {
      instanceId: "earth-cf-direct-trash-leaver",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, leaver],
    });
    const afterDirectLeave = {
      ...state,
      cardInstances: state.cardInstances.map((instance) =>
        instance.instanceId === leaver.instanceId
          ? { ...instance, zone: "trash" as const }
          : instance
      ),
    };
    const lookup = buildTriggeredEffectLookup([c, spiritDef]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: afterDirectLeave,
      source: "action_resolution",
      chainId: "c16-direct-trash-leave-chain",
      attackId: null,
      causedByPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === leaver.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.eventKind).toBe("leave_field");
    expect(pending!.cause).toBe("opponent_effect");

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choices.find(
        (choice) => choice.sourceCard.instanceId === source.instanceId
      )
    ).toBeDefined();
  });

  it("Lv1のC16は同じ離れたときイベントでもmin_level条件で候補化されない", () => {
    const ctx = setupC16LeaveTrigger(0);
    const pending = ctx.queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.leaver.instanceId
    );
    if (!pending) return;
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.queued,
      pendingEffect: pending,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "c16-field")
    ).toBeUndefined();
  });

  it("実行: 手札1枚を破棄できたとき、離れた本人をトラッシュから手札に戻せる", () => {
    const handCard = createCardInstance(card("BSAZ01-C02"), {
      instanceId: "c16-hand-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const leaver = createCardInstance(card("BSAZ01-C01"), {
      instanceId: "earth-cf-leaver",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const source = createCardInstance(c, {
      instanceId: "c16-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 1 }, { handCount: 0 }],
      cardInstances: [source, handCard, leaver],
    });
    const lookup = buildTriggeredEffectLookup([c, card(leaver.definitionId)]);
    const chainId = "c16-execute-chain";
    const afterLeave = queuePendingLeave({
      state,
      instanceId: leaver.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId,
    });
    const flushed = flushPendingLeaves(afterLeave, getCardDefinitionById);
    const queued = collectAndQueueTriggerReactions({
      beforeState: afterLeave,
      afterState: flushed,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "leave_field" &&
          p.relatedInstanceId === leaver.instanceId
      )
    ).toBe(true);

    const after = executeEffect({
      chainId: "test:bsaz01-cards:564",
      state: queued,
      effect: c.effects![1]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [leaver.instanceId],
      targetStepId: "c16-recover",
      targetSelectionResolved: true,
    });
    expect(
      after.cardInstances.find((i) => i.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((i) => i.instanceId === leaver.instanceId)?.zone
    ).toBe("hand");
    expect(after.players.find((p) => p.id === "alice")!.handCount).toBe(1);
  });
});

describe("BSAZ01-C15 不見咲カオル", () => {
  const c = card("BSAZ01-C15");
  const darzana = card("BSAZ01-C14");
  const earthMagic = card("BSAZ01-C04");
  const nonDarzana = card("BSTH01-C12");
  const lookup = buildTriggeredEffectLookup(ALL_CARDS);
  const ALICE = "alice";
  const BOB = "bob";

  function buildDrawState(handDefs: CardDefinition[]): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const source = createCardInstance(c, {
      instanceId: "kaoru",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const deckCards = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(nonDarzana, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const handCards = handDefs.map((def, i) =>
      createCardInstance(def, {
        instanceId: `hand-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      })
    );
    return {
      ...base,
      activePlayerId: ALICE,
      turnNumber: 2,
      step: "core",
      cardInstances: [source, ...deckCards, ...handCards],
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
          : p
      ),
    };
  }

  function resolveDrawCostPay(
    state: GameState,
    discardCardInstanceId: string,
    options: {
      getDefinitionById?: (id: string) => CardDefinition | undefined;
      triggeredLookup?: ReturnType<typeof buildTriggeredEffectLookup>;
    } = {}
  ): GameState {
    const getDefinitionById =
      options.getDefinitionById ?? getCardDefinitionById;
    const triggeredLookup = options.triggeredLookup ?? lookup;
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_draw_step_cost_choice"
    );
    expect(action).toBeDefined();
    return applyActionAndChooseEntryCores({
      state,
      action: action!,
      getCardDefinitionById: getDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      drawStepCostChoice: "pay",
      drawStepCostDiscardCardInstanceId: discardCardInstanceId,
    }).state;
  }

  it("stub が解消され、draw_modify prepaidCost と Lv2 複数ゾーン effect_immunity に分割されている", () => {
    expect((c.effects ?? []).some((e) => e.stub)).toBe(false);

    const draw = c.effects![0]!;
    expect(draw.timing).toEqual({
      kind: "phase",
      step: "draw",
      whose: "self",
    });
    expect(draw.inline).toBe(true);
    expect(draw.executionMode).toBe("optional");
    expect(draw.steps[0]!.action.kind).toBe("draw_modify");
    if (draw.steps[0]!.action.kind === "draw_modify") {
      const action = draw.steps[0]!.action;
      expect(action.amount).toBe(1);
      expect(action.prepaidCost).toEqual({
        kind: "discard_hand",
        cardFilter: {},
        discardDisposition: {
          kind: "move_instead",
          ifCardFilter: {
            category: ["nexus"],
            cardName: { contains: "ダルザナ・マグバレッジ" },
          },
          destination: "field",
        },
      });
    }

    const immunity = c.effects![1]!;
    expect(immunity.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(immunity.steps[0]!.action.kind).toBe("effect_immunity");
    if (immunity.steps[0]!.action.kind === "effect_immunity") {
      const action = immunity.steps[0]!.action;
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: { category: ["magic"], tribes: ["地球"] },
        count: "all",
        zone: ["hand", "field", "trash"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("ドローステップ開始時に任意手札破棄の pending を立て、まだドローしない", () => {
    const after = advanceStep(
      buildDrawState([darzana, nonDarzana]),
      getCardDefinitionById,
      lookup
    );

    expect(after.step).toBe("draw");
    expect(after.pendingDrawStepCostChoice).not.toBeNull();
    expect(
      after.pendingDrawStepCostChoice!.entries[0]!.candidateCardInstanceIds
    ).toEqual(["hand-0", "hand-1"]);
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(2);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(10);
  });

  it("手札破棄候補は controller ではなく owner の手札で判定し、配置時は owner 側 controller に戻す", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const source = createCardInstance(c, {
      instanceId: "kaoru",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const aliceOwned = createCardInstance(darzana, {
      instanceId: "alice-owned",
      ownerPlayerId: ALICE,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const bobOwned = createCardInstance(nonDarzana, {
      instanceId: "bob-owned",
      ownerPlayerId: BOB,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const deckCards = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(nonDarzana, {
        instanceId: `owner-deck-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const after = advanceStep(
      {
        ...base,
        activePlayerId: ALICE,
        turnNumber: 2,
        step: "core",
        cardInstances: [source, ...deckCards, aliceOwned, bobOwned],
        players: base.players.map((p) =>
          p.id === ALICE
            ? { ...p, deckCount: deckCards.length, handCount: 1 }
            : { ...p, handCount: 1 }
        ),
      },
      getCardDefinitionById,
      lookup
    );

    expect(
      after.pendingDrawStepCostChoice?.entries[0]!.candidateCardInstanceIds
    ).toEqual(["alice-owned"]);

    const resolved = resolveDrawCostPay(after, "alice-owned");
    const placed = resolved.cardInstances.find(
      (i) => i.instanceId === "alice-owned"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.controllerPlayerId).toBe(ALICE);
    expect(resolved.players.find((p) => p.id === ALICE)!.handCount).toBe(2);
    expect(resolved.players.find((p) => p.id === BOB)!.handCount).toBe(1);
  });

  it("同名複数枚に〔重複不可〕が無いため、それぞれのドロー枚数修正 pending を立てる", () => {
    const base = buildDrawState([darzana, nonDarzana]);
    const secondSource = createCardInstance(c, {
      instanceId: "kaoru-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const after = advanceStep(
      {
        ...base,
        cardInstances: [...base.cardInstances, secondSource],
      },
      getCardDefinitionById,
      lookup
    );

    expect(after.pendingDrawStepCostChoice?.entries).toHaveLength(2);
    expect(
      after.pendingDrawStepCostChoice?.entries.map(
        (entry) => entry.sourceInstanceId
      )
    ).toEqual(["kaoru", "kaoru-2"]);
  });

  it("同名複数枚の pending は支払い済みカードを次 entry の候補から外し、二重支払いを拒否する", () => {
    const base = buildDrawState([darzana, nonDarzana]);
    const secondSource = createCardInstance(c, {
      instanceId: "kaoru-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const pending = advanceStep(
      {
        ...base,
        cardInstances: [...base.cardInstances, secondSource],
      },
      getCardDefinitionById,
      lookup
    );

    const firstPaid = resolveDrawCostPay(pending, "hand-0");
    expect(firstPaid.pendingDrawStepCostChoice?.entries).toHaveLength(1);
    expect(
      firstPaid.pendingDrawStepCostChoice!.entries[0]!.candidateCardInstanceIds
    ).toEqual(["hand-1"]);
    expect(() => resolveDrawCostPay(firstPaid, "hand-0")).toThrow(
      /valid discard candidate/
    );

    const secondPaid = resolveDrawCostPay(firstPaid, "hand-1");
    expect(secondPaid.pendingDrawStepCostChoice ?? null).toBeNull();
    expect(
      secondPaid.cardInstances.find((i) => i.instanceId === "hand-0")!.zone
    ).toBe("field");
    expect(
      secondPaid.cardInstances.find((i) => i.instanceId === "hand-1")!.zone
    ).toBe("trash");
    expect(secondPaid.players.find((p) => p.id === ALICE)!.handCount).toBe(3);
    expect(secondPaid.players.find((p) => p.id === ALICE)!.deckCount).toBe(7);
  });

  it("同名複数枚の後続 entry が候補なしになったら自動で畳んで確定済み bonus だけでドローする", () => {
    const base = buildDrawState([nonDarzana]);
    const secondSource = createCardInstance(c, {
      instanceId: "kaoru-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const pending = advanceStep(
      {
        ...base,
        cardInstances: [...base.cardInstances, secondSource],
      },
      getCardDefinitionById,
      lookup
    );
    expect(pending.pendingDrawStepCostChoice?.entries).toHaveLength(2);

    const resolved = resolveDrawCostPay(pending, "hand-0");
    expect(resolved.pendingDrawStepCostChoice ?? null).toBeNull();
    expect(
      resolved.cardInstances.find((i) => i.instanceId === "hand-0")!.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === ALICE)!.handCount).toBe(2);
    expect(resolved.players.find((p) => p.id === ALICE)!.deckCount).toBe(8);
  });

  it("破棄したカードがダルザナならトラッシュのかわりにコストなしで配置し、2枚ドローする", () => {
    const pending = advanceStep(
      buildDrawState([darzana, nonDarzana]),
      getCardDefinitionById,
      lookup
    );

    const resolved = resolveDrawCostPay(pending, "hand-0");
    const placed = resolved.cardInstances.find(
      (i) => i.instanceId === "hand-0"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.zoneRoleName).toBe("nexus");
    expect(placed.normalCoreCount).toBe(0);
    expect(placed.minimumRequiredCores).toBe(0);
    expect(
      resolved.log.some((entry) =>
        entry.includes("effect:field_place:draw_step_cost:alice:hand-0")
      )
    ).toBe(true);
    expect(resolved.log.some((entry) => entry.includes("payment:"))).toBe(
      false
    );
    expect(resolved.players.find((p) => p.id === ALICE)!.handCount).toBe(3);
    expect(resolved.players.find((p) => p.id === ALICE)!.deckCount).toBe(8);
  });

  it("ダルザナを配置したときは通常の効果配置と同じく配置時誘発をキューする", () => {
    const triggeredDarzana: CardDefinition = {
      ...darzana,
      effects: [
        ...(darzana.effects ?? []),
        {
          timing: { kind: "card_event", event: "place" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const customDefinitions = ALL_CARDS.map((definition) =>
      definition.cardNo === triggeredDarzana.cardNo
        ? triggeredDarzana
        : definition
    );
    const customDefinitionMap = new Map<string, CardDefinition>(
      customDefinitions.map((definition) => [definition.cardNo, definition])
    );
    const getCustomDefinitionById = (id: string) => customDefinitionMap.get(id);
    const customLookup = buildTriggeredEffectLookup(customDefinitions);
    const pending = advanceStep(
      buildDrawState([triggeredDarzana, nonDarzana]),
      getCustomDefinitionById,
      customLookup
    );

    const resolved = resolveDrawCostPay(pending, "hand-0", {
      getDefinitionById: getCustomDefinitionById,
      triggeredLookup: customLookup,
    });

    expect(resolved.log).toContain(
      "effect:field_place:draw_step_cost:alice:hand-0"
    );
    const pendingPlace = resolved.pendingTriggeredEffects.find(
      (pendingEffect) =>
        pendingEffect.eventKind === "place" &&
        pendingEffect.relatedInstanceId === "hand-0"
    );
    expect(pendingPlace).toBeDefined();
    expect(pendingPlace).toMatchObject({
      cause: "self_effect",
      fromZone: "hand",
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: resolved,
      pendingEffect: pendingPlace!,
      getCardDefinitionById: getCustomDefinitionById,
      getRegisteredTriggeredEffectActions: customLookup,
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "hand-0")
    ).toBeDefined();
  });

  it("破棄したカードがダルザナ以外なら通常どおりトラッシュへ置き、2枚ドローする", () => {
    const pending = advanceStep(
      buildDrawState([darzana, nonDarzana]),
      getCardDefinitionById,
      lookup
    );

    const resolved = resolveDrawCostPay(pending, "hand-1");
    expect(
      resolved.cardInstances.find((i) => i.instanceId === "hand-1")!.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === ALICE)!.handCount).toBe(3);
    expect(resolved.players.find((p) => p.id === ALICE)!.deckCount).toBe(8);
  });

  it("Lv2 なら手札/フィールド/トラッシュの地球マジックが相手の効果を受けない", () => {
    const source = createCardInstance(c, {
      instanceId: "kaoru-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handMagic = createCardInstance(earthMagic, {
      instanceId: "earth-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const fieldMagic = createCardInstance(earthMagic, {
      instanceId: "earth-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const trashMagic = createCardInstance(earthMagic, {
      instanceId: "earth-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const rebuilt = recomputeAndRebuildContinuousEffects(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, handMagic, fieldMagic, trashMagic],
      }),
      getCardDefinitionById
    );

    const ce = rebuilt.activeContinuousEffects.find(
      (effect) =>
        effect.sourceDefinitionId === c.cardNo &&
        effect.modifierTag === "defense_immune"
    );
    expect(ce?.targetFilter).toEqual(
      expect.objectContaining({
        player: "self",
        zone: ["hand", "field", "trash"],
        category: ["magic"],
        tribes: ["地球"],
      })
    );
    for (const id of ["earth-hand", "earth-field", "earth-trash"]) {
      const target = rebuilt.cardInstances.find((i) => i.instanceId === id)!;
      expect(
        isCardImmuneToOpponentEffect(
          rebuilt,
          target,
          BOB,
          "none",
          undefined,
          getCardDefinitionById
        )
      ).toBe(true);
      expect(
        isCardImmuneToOpponentEffect(
          rebuilt,
          target,
          ALICE,
          "none",
          undefined,
          getCardDefinitionById
        )
      ).toBe(false);
    }
  });
});

describe("BSAZ01-C13 デューカリオン", () => {
  const c = card("BSAZ01-C13");
  const ALICE = "alice";
  const BOB = "bob";
  const TEST_EFFECT_SOURCE_COST9: CardDefinition = {
    cardNo: "TEST-C13-OPPONENT-COST9",
    name: "テスト相手コスト9効果",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 9,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  const TEST_EFFECT_SOURCE_COST10: CardDefinition = {
    ...TEST_EFFECT_SOURCE_COST9,
    cardNo: "TEST-C13-OPPONENT-COST10",
    name: "テスト相手コスト10効果",
    cost: 10,
  };
  const TEST_SENRYOKU_MAIN_DRAW: CardDefinition = {
    cardNo: "TEST-C13-SENRYOKU-DONOR",
    name: "戦力投入",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: ["メイン", "自分は1枚ドローする。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [1],
      },
    ],
  };
  const testDefinitions = [
    ...ALL_CARDS,
    TEST_EFFECT_SOURCE_COST9,
    TEST_EFFECT_SOURCE_COST10,
    TEST_SENRYOKU_MAIN_DRAW,
  ];
  const testDefinitionMap = new Map(
    testDefinitions.map((definition) => [definition.cardNo, definition])
  );
  const getTestDef = (id: string): CardDefinition | undefined =>
    testDefinitionMap.get(id);
  const noTriggerLookup = () => [];
  const triggeredLookup = buildTriggeredEffectLookup(testDefinitions);
  const fieldLookup = buildFieldCardEffectLookup(testDefinitions);

  it("stub 解消: ライフ3以下誘発配置/弾幕/戦力投入借用に分割されている", () => {
    expect((c.effects ?? []).some((e) => e.stub)).toBe(false);
    expect(c.effects).toHaveLength(3);

    const placement = c.effects![0]!;
    expect(placement.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "reduce_life",
    });
    expect(placement.applicability).toEqual({ zone: "hand" });
    expect(placement.executionMode).toBe("optional");
    expect(placement.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(placement.preventionLevel).toBe("unpreventable");
    expect(placement.condition).toEqual([
      { kind: "life_value", player: "self", max: 3 },
    ]);
    expect(placement.steps[0]!.action.kind).toBe("summon");
    if (placement.steps[0]!.action.kind === "summon") {
      expect(placement.steps[0]!.action.target).toEqual({
        kind: "self",
        zone: "hand",
      });
      expect(placement.steps[0]!.action.costModifier).toBe("full_reduction");
    }
    expect(placement.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "place-self",
    });
    expect(placement.steps[1]!.executionMode).toBe("optional");
    expect(placement.steps[1]!.action.kind).toBe("destroy");
    if (placement.steps[1]!.action.kind === "destroy") {
      const target = placement.steps[1]!.action.target;
      expect(target.kind).toBe("filter");
      if (target.kind === "filter") {
        expect(target.player).toBe("opponent");
        expect(target.filter).toMatchObject({
          category: ["spirit", "ultimate", "nexus"],
          minSymbolCount: 2,
        });
      }
    }

    const danmaku = c.effects![1]!;
    expect(danmaku.timing).toEqual({ kind: "continuous" });
    expect(danmaku.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(danmaku.steps[0]!.action.kind).toBe("effect_immunity");
    if (danmaku.steps[0]!.action.kind === "effect_immunity") {
      const action = danmaku.steps[0]!.action;
      expect(action.sourceScope).toEqual({ maxCost: 9 });
      expect(action.target.kind).toBe("filter");
      if (action.target.kind === "filter") {
        expect(action.target.player).toBe("self");
        expect(action.target.filter).toMatchObject({
          category: ["nexus"],
          tribes: ["地球"],
        });
        expect(action.target.count).toBe("all");
      }
    }

    const borrow = c.effects![2]!;
    expect(borrow.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(borrow.timingScope).toEqual({ player: "both", period: "attack" });
    expect(borrow.applicability).toEqual({ level: { min: 2, max: 2 } });
    expect(borrow.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(borrow.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "伊奈帆" }, { contains: "アセイラム" }],
      },
    ]);
    expect(borrow.steps[0]!.action.kind).toBe("borrow_magic_effect");
    if (borrow.steps[0]!.action.kind === "borrow_magic_effect") {
      const action = borrow.steps[0]!.action;
      expect(action.borrowModes).toEqual(["main"]);
      expect(action.target.kind).toBe("filter");
      if (action.target.kind === "filter") {
        expect(action.target.zone).toEqual(["field", "trash"]);
        expect(action.target.filter).toMatchObject({
          category: ["magic"],
          cardName: [{ contains: "戦力投入" }],
          hasActivatedEffectMode: ["main"],
        });
      }
    }
  });

  it("[board] ライフが3以下に減ると手札誘発し、配置成功後に任意破壊を解決できる", () => {
    const handDucalion = createCardInstance(c, {
      instanceId: "c13-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const opponentTwoSymbolNexus = createCardInstance(c, {
      instanceId: "bob-two-symbol-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handDucalion, opponentTwoSymbolNexus],
      playerOverrides: [
        { lifeNormalCoreCount: 4, reserveNormalCoreCount: 2 },
        {},
      ],
    });
    const afterLifeDamage = resolveLifeDamage(before, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterLifeDamage,
      source: "action_resolution",
      chainId: "c13-reduce-life-chain",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (entry) => entry.sourceInstanceId === handDucalion.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("reduce_life");
    expect(declaration!.ownerPlayerId).toBe(ALICE);

    const afterPlacement = executeEffectWithChosenMinimumCores({
      chainId: "test:bsaz01-cards:1254",
      state: afterLifeDamage,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: handDucalion.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      afterPlacement.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === handDucalion.instanceId
      )?.zone
    ).toBe("field");
    expect(afterPlacement.pendingStepOptionalChoice).not.toBeNull();

    const optionalChoice = afterPlacement.pendingStepOptionalChoice!;
    const afterDestroyChoice = applyLegalAction({
      state: afterPlacement,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${optionalChoice.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: optionalChoice.actingPlayerId,
        pendingId: optionalChoice.pendingId,
        sourceInstanceId: optionalChoice.sourceInstanceId,
        effectIndex: optionalChoice.effectIndex,
        stepIndex: optionalChoice.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    const afterDestroy =
      afterDestroyChoice.pendingStepOptionalTargetSelection !== null
        ? applyLegalAction({
            state: afterDestroyChoice,
            action: {
              kind: "resolve_pending_step_optional_target_selection",
              actionId: `psots-${afterDestroyChoice.pendingStepOptionalTargetSelection.pendingId}`,
              can: true,
              reason: "test",
              actingPlayerId:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .actingPlayerId,
              pendingId:
                afterDestroyChoice.pendingStepOptionalTargetSelection.pendingId,
              sourceInstanceId:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .sourceInstanceId,
              sourceDefinitionId:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .sourceDefinitionId,
              effectIndex:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .effectIndex,
              stepIndex:
                afterDestroyChoice.pendingStepOptionalTargetSelection.stepIndex,
              requiredTargetCount:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .requiredTargetCount,
              maxTargetCount:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .maxTargetCount,
              candidateTargetInstanceIds:
                afterDestroyChoice.pendingStepOptionalTargetSelection
                  .candidateInstanceIds,
            },
            targetInstanceIds: [opponentTwoSymbolNexus.instanceId],
            getCardDefinitionById: getTestDef,
            getRegisteredTriggeredEffectActions: noTriggerLookup,
          }).state
        : afterDestroyChoice;
    const flushed = flushPendingLeaves(afterDestroy, getTestDef);

    expect(
      flushed.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === opponentTwoSymbolNexus.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("[board] ライフ4止まりでは手札誘発候補に出ない", () => {
    const handDucalion = createCardInstance(c, {
      instanceId: "c13-hand-life4",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handDucalion],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 2 },
        {},
      ],
    });
    const afterLifeDamage = resolveLifeDamage(before, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterLifeDamage,
      source: "action_resolution",
      chainId: "c13-reduce-life-chain-life4",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingPrivateDeclarations.find(
        (entry) => entry.sourceInstanceId === handDucalion.instanceId
      )
    ).toBeUndefined();
  });

  it("[board] 手札誘発の同名ターン1回を消費済みなら、ライフ3以下に減っても同名2枚目は候補に出ない", () => {
    const usedDucalion = createCardInstance(c, {
      instanceId: "c13-hand-used",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const secondDucalion = createCardInstance(c, {
      instanceId: "c13-hand-second",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [usedDucalion, secondDucalion],
      playerOverrides: [
        { lifeNormalCoreCount: 4, reserveNormalCoreCount: 2 },
        {},
      ],
    });
    const afterLifeDamage = resolveLifeDamage(before, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    const afterUsage = {
      ...afterLifeDamage,
      effectUsageRecords: recordEffectUsage({
        state: afterLifeDamage,
        sourceInstanceId: usedDucalion.instanceId,
        sourceDefinitionId: c.cardNo,
        effectLabel: getStableEffectLabel("triggered", 0, { effectIndex: 0 }),
        duration: "turn",
      }),
    };

    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterUsage,
      source: "action_resolution",
      chainId: "c13-reduce-life-chain-used",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingPrivateDeclarations.filter(
        (entry) => entry.sourceDefinitionId === c.cardNo
      )
    ).toHaveLength(0);
  });

  it("[board] 弾幕は自分の地球ネクサスを相手コスト9以下効果から守り、コスト10/自分効果/防げないは通す", () => {
    const fieldDucalion = createCardInstance(c, {
      instanceId: "c13-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const rebuilt = recomputeAndRebuildContinuousEffects(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [fieldDucalion],
      }),
      getTestDef
    );
    const target = rebuilt.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === fieldDucalion.instanceId
    )!;

    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        BOB,
        "none",
        { definition: TEST_EFFECT_SOURCE_COST9 },
        getTestDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        BOB,
        "none",
        { definition: TEST_EFFECT_SOURCE_COST10 },
        getTestDef
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        ALICE,
        "none",
        { definition: TEST_EFFECT_SOURCE_COST9 },
        getTestDef
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        BOB,
        "unpreventable",
        { definition: TEST_EFFECT_SOURCE_COST9 },
        getTestDef
      )
    ).toBe(false);
  });

  it("[board] 弾幕の発生源コスト制約は候補・affect・flushで9を拒み、10を通す", () => {
    const nexusCategory: CardCategory[] = ["nexus"];
    const destroyNexus = {
      timing: { kind: "activated", mode: "main" } as const,
      steps: [
        {
          action: {
            kind: "destroy" as const,
            target: {
              kind: "filter" as const,
              player: "opponent" as const,
              filter: { category: nexusCategory },
              count: 1 as const,
            },
          },
        },
      ],
      textRef: [],
    };
    const run = (sourceDefinition: CardDefinition) => {
      const protectedNexus = createCardInstance(c, {
        instanceId: `c13-protected-${sourceDefinition.cost}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const source = createCardInstance(sourceDefinition, {
        instanceId: `c13-source-${sourceDefinition.cost}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
      });
      const state = recomputeAndRebuildContinuousEffects(
        createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [protectedNexus, source],
        }),
        getTestDef
      );
      const registration = {
        candidateTargetZones: ["field"] as const,
        candidateTargetPlayerScope: "opponent" as const,
        targetCardFilter: { category: nexusCategory },
        targetCardFilterActionKind: "destroy" as const,
      };
      const candidates = getCandidateTargetInstanceIds(
        state,
        BOB,
        registration,
        {
          getCardDefinitionById: getTestDef,
          sourceInstanceId: source.instanceId,
        }
      );
      const afterResolution = executeEffect({
        chainId: "test:bsaz01-cards:1547",
        state,
        effect: destroyNexus,
        sourceInstanceId: source.instanceId,
        actingPlayerId: BOB,
        getCardDefinitionById: getTestDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        targetInstanceIds: candidates,
      });
      return {
        candidates,
        protectedNexusId: protectedNexus.instanceId,
        after: flushPendingLeaves(afterResolution, getTestDef, ["yellow"]),
      };
    };

    const afterCost9 = run(TEST_EFFECT_SOURCE_COST9);
    // コスト9の効果を受けない対象は候補から除外し、コスト10なら選べる。
    expect(afterCost9.candidates).toEqual([]);
    expect(
      afterCost9.after.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === afterCost9.protectedNexusId
      )?.zone
    ).toBe("field");
    expect(afterCost9.after.pendingLeaveEntities).toEqual([]);

    const afterCost10 = run(TEST_EFFECT_SOURCE_COST10);
    expect(afterCost10.candidates).toEqual([afterCost10.protectedNexusId]);
    expect(
      afterCost10.after.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === afterCost10.protectedNexusId
      )?.zone
    ).toBe("trash");
    expect(
      afterCost10.after.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === afterCost10.protectedNexusId
      )?.pendingLeaveKind
    ).toBeNull();
    expect(afterCost10.after.pendingLeaveEntities).toEqual([]);
  });

  it("[board] Lv2アタック中フラッシュでフィールド/トラッシュの戦力投入メイン効果を借用する", () => {
    const fieldDucalion = createCardInstance(c, {
      instanceId: "c13-field-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const inaho = createCardInstance(card("BSAZ01-CX01"), {
      instanceId: "inaho-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const senryoku = createCardInstance(TEST_SENRYOKU_MAIN_DRAW, {
      instanceId: "senryoku-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const deckCards = Array.from({ length: 2 }, (_, index) =>
      createCardInstance(TEST_EFFECT_SOURCE_COST9, {
        instanceId: `c13-deck-${index}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [fieldDucalion, inaho, senryoku, ...deckCards],
        playerOverrides: [{ handCount: 0, deckCount: deckCards.length }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_after_block",
      activeAttack: {
        attackId: "c13-flash-used-battle",
        primaryEntityId: "be-c13-inaho",
        participantEntityIds: ["be-c13-inaho"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "after_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
      battleEntities: [
        {
          entityId: "be-c13-inaho",
          memberInstanceIds: [inaho.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
    };
    const after = executeEffect({
      chainId: "test:bsaz01-cards:1656",
      state,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: fieldDucalion.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [senryoku.instanceId],
    });
    const alice = after.players.find((player) => player.id === ALICE)!;

    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(1);
    expect(
      after.log.some(
        (entry) =>
          entry === "borrow_magic_effect:executed:TEST-C13-SENRYOKU-DONOR"
      )
    ).toBe(true);
  });

  it("[board] Lv2フラッシュの同名ターン1回を消費済みなら、戦力投入借用は再発揮できない", () => {
    const fieldDucalion = createCardInstance(c, {
      instanceId: "c13-field-lv2-used",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const inaho = createCardInstance(card("BSAZ01-CX01"), {
      instanceId: "inaho-field-used",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const senryoku = createCardInstance(TEST_SENRYOKU_MAIN_DRAW, {
      instanceId: "senryoku-trash-used",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [fieldDucalion, inaho, senryoku],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_after_block",
    };
    const fieldRegistrations = fieldLookup(c.cardNo) ?? [];
    const registration = fieldRegistrations.find(
      (entry) => entry.effectIndex === 2
    );
    expect(registration).toBeDefined();
    if (!registration) throw new Error("expected C13 field registration");
    expect(registration.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const effectLabel = `${registration.sourceKind}:${fieldRegistrations.indexOf(
      registration
    )}`;

    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: fieldDucalion.instanceId,
        sourceDefinitionId: c.cardNo,
        getCardDefinitionById: getTestDef,
        effectLabel,
        usageLimit: registration.usageLimit!,
      })
    ).toBe(true);

    const afterUsage: GameState = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: fieldDucalion.instanceId,
        sourceDefinitionId: c.cardNo,
        effectLabel,
        duration: "turn",
      }),
    };

    expect(
      canUseEffectByUsageLimit({
        state: afterUsage,
        sourceInstanceId: fieldDucalion.instanceId,
        sourceDefinitionId: c.cardNo,
        getCardDefinitionById: getTestDef,
        effectLabel,
        usageLimit: registration.usageLimit!,
      })
    ).toBe(false);
  });

  it("[board] Lv2フラッシュ条件は無印の名前参照なので、魂状態だけの伊奈帆では戦力投入を借用しない", () => {
    const fieldDucalion = createCardInstance(c, {
      instanceId: "c13-field-lv2-soul-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const soulInaho = createCardInstance(card("BSAZ01-CX01"), {
      instanceId: "inaho-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const senryoku = createCardInstance(TEST_SENRYOKU_MAIN_DRAW, {
      instanceId: "senryoku-trash-soul-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const deckCard = createCardInstance(TEST_EFFECT_SOURCE_COST9, {
      instanceId: "c13-deck-soul-only",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [fieldDucalion, soulInaho, senryoku, deckCard],
        playerOverrides: [
          {
            handCount: 0,
            deckCount: 1,
            soulStateInstanceIds: [soulInaho.instanceId],
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_after_block",
    };
    const after = executeEffect({
      chainId: "test:bsaz01-cards:1799",
      state,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: fieldDucalion.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getTestDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [senryoku.instanceId],
    });
    const alice = after.players.find((player) => player.id === ALICE)!;

    expect(alice.handCount).toBe(0);
    expect(alice.deckCount).toBe(1);
    expect(
      after.log.some((entry) => entry.startsWith("borrow_magic_effect:"))
    ).toBe(false);
  });
});

describe("BSAZ01-C18 追加合体スロット", () => {
  const hostDef = card("BSAZ01-C01");
  const inahoDef = card("BSAZ01-CX01");
  const c18Def = card("BSAZ01-C18");
  const nonCfHostDef: CardDefinition = {
    cardNo: "TEST-BSAZ01-C18-NON-CF-HOST",
    name: "テスト用スレイプニールなしホスト",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "地球",
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const lookup = (id: string) =>
    cardNoMap.get(id) ??
    (id === nonCfHostDef.cardNo ? nonCfHostDef : undefined);
  const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

  function buildState(options: {
    withInaho: boolean;
    hostDefinition?: CardDefinition;
    c18Id?: string;
    extraC18Id?: string;
  }): GameState {
    const selectedHostDef = options.hostDefinition ?? hostDef;
    const host = createCardInstance(selectedHostDef, {
      instanceId: "bsaz01-c18-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: options.withInaho ? ["bsaz01-c18-inaho"] : [],
    });
    const inaho = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-inaho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: options.withInaho ? host.instanceId : null,
    });
    const c18 = createCardInstance(c18Def, {
      instanceId: options.c18Id ?? "bsaz01-c18-incoming",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const extraC18 =
      options.extraC18Id !== undefined
        ? createCardInstance(c18Def, {
            instanceId: options.extraC18Id,
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            zoneRoleName: "brave",
            normalCoreCount: 1,
          })
        : undefined;

    return {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        host,
        ...(options.withInaho ? [inaho] : []),
        c18,
        ...(extraC18 ? [extraC18] : []),
      ],
    };
  }

  function c18CombineActions(state: GameState, braveInstanceId: string) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "brave_combine" &&
        a.braveCardNo === "BSAZ01-C18" &&
        a.braveInstanceId === braveInstanceId &&
        a.targetInstanceId === "bsaz01-c18-host"
    );
  }

  const directCombineEffect = () =>
    c18Def.effects!.find(
      (effect) =>
        effect.steps[0]?.action.kind === "brave_combine_effect" &&
        effect.steps[0].action.asSummon === true
    )!;
  const summonTrashMagicEffect = () =>
    c18Def.effects!.find(
      (effect) =>
        effect.timing.kind === "card_event" &&
        effect.timing.event === "summon" &&
        effect.steps[0]?.action.kind === "search_zone"
    )!;
  const attackSymbolEffect = () =>
    c18Def.effects!.find(
      (effect) =>
        effect.timing.kind === "card_event" &&
        effect.timing.event === "attack" &&
        effect.steps[0]?.action.kind === "symbol_add"
    )!;

  function normalCombineState(zone: "hand" | "trash"): GameState {
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "card-20",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(inahoDef, {
            instanceId: "card-17",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(c18Def, {
            instanceId: "card-6",
            ownerPlayerId: "alice",
            zone,
          }),
        ],
        playerOverrides: [{ handCount: zone === "hand" ? 1 : 0 }],
      }),
      turnNumber: 5,
      activePlayerId: "alice",
      step: "main",
    };
  }

  function legal(state: GameState, player = "alice") {
    return getLegalActions({
      state,
      actingPlayerId: player,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
  }

  function act(
    state: GameState,
    predicate: (a: LegalAction) => boolean,
    player = "alice",
    skipOptionalEffect = false,
    targetInstanceIds?: string[]
  ) {
    const action = legal(state, player).find(predicate);
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      skipOptionalEffect,
      ...(targetInstanceIds ? { targetInstanceIds } : {}),
      ...(action!.kind === "summon"
        ? {
            paymentSources: [
              { kind: "reserve" as const, amount: action!.reducedCost },
            ],
          }
        : {}),
    }).state;
  }

  function resolveC18(state: GameState, zone: "hand" | "trash") {
    if (zone === "hand") {
      const candidates = state.pendingPrivateDeclarations.filter(
        (p) => p.sourceInstanceId === "card-6"
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        eventKind: "brave_combined",
        relatedInstanceId: "card-17",
        triggerRelatedCombinedHostInstanceId: "card-20",
      });
      expect(candidates[0]!.cause).toBeUndefined();
      state = act(
        state,
        (a) =>
          a.kind === "declare_private_triggered_effect" &&
          a.sourceInstanceId === "card-6"
      );
    } else {
      // Trash is public: it uses the public triggered queue, never a private declaration.
      expect(state.pendingPrivateDeclarations).toHaveLength(0);
      const candidates = state.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "brave_combined"
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        relatedInstanceId: "card-17",
        triggerRelatedCombinedHostInstanceId: "card-20",
      });
      expect(candidates[0]!.cause).toBeUndefined();
    }
    state = act(
      state,
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "card-6"
    );
    expect(state.stackWindow).not.toBeNull();
    state = act(state, (a) => a.kind === "pass_stack", "bob");
    expect(
      state.pendingEnterFieldPlacement?.effectBraveCombineAsSummon
    ).toMatchObject({
      braveInstanceId: "card-6",
      hostInstanceId: "card-20",
      fromZone: zone,
    });
    state = act(
      state,
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    expect(state.pendingTriggeredEffects).toHaveLength(1);
    expect(state.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "summon",
      relatedInstanceId: "card-6",
    });
    const summonPendingId = state.pendingTriggeredEffects[0]!.pendingId;
    state = act(
      state,
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "card-6"
    );
    state = act(state, (a) => a.kind === "pass_stack", "bob");
    state = act(
      state,
      (a) => a.kind === "resolve_pending_effect_target",
      "alice",
      false,
      []
    );
    expect(state.pendingTriggeredEffects).toEqual([]);
    expect(state.pendingPrivateDeclarations).toEqual([]);
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.pendingEnterFieldPlacement).toBeNull();
    expect(state.stackWindow).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "card-6")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: "card-20",
      normalCoreCount: 0,
      soulCoreCount: 0,
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "card-20")!
        .attachedChildrenIds
    ).toEqual(["card-17", "card-6"]);
    expect(
      state.log.filter(
        (entry) =>
          entry === `effect:summon:card-6:direct-combine:from=${zone}:cost=0`
      )
    ).toHaveLength(1);
    for (const prefix of ["trigger:resolve-main:end", "trigger:resolved"]) {
      expect(
        state.log.filter(
          (entry) => entry === `${prefix}:${summonPendingId}:summon:alice`
        )
      ).toHaveLength(1);
    }
    expect(
      state.effectUsageRecords.filter((u) => u.sourceInstanceId === "card-6")
    ).toEqual([
      {
        sourceInstanceId: "card-6",
        sourceDefinitionId: "BSAZ01-C18",
        playerId: "alice",
        effectLabel: "effect:2",
        turnNumber: 5,
        step: "main",
        duration: "turn",
        count: 1,
      },
    ]);
    return state;
  }

  it.each(["hand", "trash"] as const)(
    "通常LegalAction合体で%sのC18を誘発し、宣言・窓後に同じhostへ直接合体召喚する",
    (zone) => {
      let state = normalCombineState(zone);
      state = act(
        state,
        (a) =>
          a.kind === "brave_combine" &&
          a.braveInstanceId === "card-17" &&
          a.targetInstanceId === "card-20"
      );
      resolveC18(state, zone);
    }
  );

  it("合体原因の採番だけは学習進展に数えず、実際のC18宣言待ちは進展に残す", () => {
    const state = act(
      normalCombineState("hand"),
      (a) => a.kind === "brave_combine" && a.braveInstanceId === "card-17"
    );
    expect(state.pendingPrivateDeclarations).toHaveLength(1);
    expect(
      trainingProgressFingerprint({
        ...state,
        nextRootTriggerChainId: state.nextRootTriggerChainId + 1,
      })
    ).toBe(trainingProgressFingerprint(state));
    expect(
      trainingProgressFingerprint({ ...state, pendingPrivateDeclarations: [] })
    ).not.toBe(trainingProgressFingerprint(state));
  });

  it.each(["hand", "trash"] as const)(
    "効果合体で%sのC18を辞退しても同一ターンの通常合体で再提示する（Telegram 629905087）",
    (zone) => {
      let state = normalCombineState(zone);
      const effect = {
        timing: { kind: "continuous" as const },
        steps: [
          {
            action: {
              kind: "brave_combine_effect" as const,
              target: {
                kind: "filter" as const,
                player: "self" as const,
                filter: { category: ["spirit" as const] },
                count: 1,
              },
            },
          },
        ],
      };
      const beforeState = state;
      const resolution = createEffectResolutionScope({
        chainId: `c18-decline-${zone}`,
      });
      state = resolution.execute({
        state,
        effect,
        sourceInstanceId: "card-17",
        actingPlayerId: "alice",
        targetInstanceIds: ["card-20"],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      });
      state = resolution.finalize({
        state,
        beforeState,
        endLogs: [],
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "card-17")!
          .attachedToInstanceId
      ).toBe("card-20");
      state = act(
        state,
        (a) =>
          zone === "hand"
            ? a.kind === "skip_private_triggered_effect" &&
              a.sourceInstanceId === "card-6"
            : a.kind === "resolve_pending_triggered_effect" &&
              a.sourceInstanceId === "card-6",
        "alice",
        zone === "trash"
      );
      expect(
        state.effectUsageRecords.some((u) => u.sourceInstanceId === "card-6")
      ).toBe(false);
      state = act(
        state,
        (a) => a.kind === "brave_separate" && a.braveInstanceId === "card-17"
      );
      state = act(
        state,
        (a) =>
          a.kind === "brave_combine" &&
          a.braveInstanceId === "card-17" &&
          a.targetInstanceId === "card-20"
      );
      expect(state.turnNumber).toBe(5);
      resolveC18(state, zone);
    }
  );

  it("通常召喚後の合体選択もC18を一度だけ誘発する", () => {
    let state = normalCombineState("trash");
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "card-17"
          ? { ...c, zone: "hand", normalCoreCount: 0 }
          : c
      ),
      players: state.players.map((p) =>
        p.id === "alice"
          ? { ...p, handCount: 1, reserveNormalCoreCount: 20 }
          : p
      ),
    };
    state = act(
      state,
      (a) => a.kind === "summon" && a.sourceInstanceId === "card-17"
    );
    state = act(state, (a) => a.kind === "pass_stack", "bob");
    state = act(
      state,
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "card-20"
    );
    state = act(
      state,
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    resolveC18(state, "trash");
  });

  it("stub が解消され、直接合体召喚・召喚時配置・合体中シンボル追加に分割されている", () => {
    expect((c18Def.effects ?? []).some((effect) => effect.stub)).toBe(false);

    const direct = directCombineEffect();
    expect(direct.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "brave_combined",
      triggerFilter: { cardName: { contains: "界塚伊奈帆" } },
    });
    expect(direct.applicability).toEqual({ zone: ["hand", "trash"] });
    expect(direct.steps[0]!.action).toEqual({
      kind: "brave_combine_effect",
      asSummon: true,
      target: {
        kind: "trigger_related_combined_host",
        player: "self",
        filter: { category: ["spirit"] },
      },
    });

    const summon = summonTrashMagicEffect();
    expect(summon.condition).toBeUndefined();
    expect(summon.executionMode).toBeUndefined();
    expect(summon.steps[0]!.action).toEqual({
      kind: "search_zone",
      zone: "trash",
      filter: { category: ["magic"], tribes: ["地球"] },
      count: { min: 0, max: 3 },
      destination: "field",
    });

    const attack = attackSymbolEffect();
    expect(attack.applicability).toEqual({ combined: true });
    expect(attack.steps[0]!.action).toEqual({
      kind: "symbol_add",
      target: { kind: "self" },
      symbol: "yellow",
      count: {
        source: {
          kind: "cards_in_zone",
          zone: "field",
          player: "self",
          filter: { category: ["magic"] },
        },
        divisor: 5,
      },
      duration: { scope: "battle" },
    });
  });

  it("BSAZ01-C18 は『界塚伊奈帆』合体中のＣＦスピリットへ追加合体できる", () => {
    expect(c18Def.braveCondition).toEqual({
      categories: ["spirit"],
      tribes: ["ＣＦ"],
      attachedBraveNameContains: ["界塚伊奈帆"],
    });
    expect(c18Def.additionalBraveSlot).toEqual({
      hostCondition: {
        categories: ["spirit"],
        tribes: ["ＣＦ"],
        attachedBraveNameContains: ["界塚伊奈帆"],
      },
      requiredAttachedBraveNameContains: ["界塚伊奈帆"],
      maxPerHost: 1,
    });

    const state = buildState({ withInaho: true });
    const [action] = c18CombineActions(state, "bsaz01-c18-incoming");
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: lookup,
    }).state;

    const host = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "bsaz01-c18-host"
    )!;
    const c18 = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "bsaz01-c18-incoming"
    )!;
    expect(c18.attachedToInstanceId).toBe(host.instanceId);
    expect(host.attachedChildrenIds).toEqual([
      "bsaz01-c18-inaho",
      "bsaz01-c18-incoming",
    ]);
  });

  it("BSAZ01-C18 は『界塚伊奈帆』合体中でない host やＣＦでない host へは追加合体できない", () => {
    expect(
      c18CombineActions(buildState({ withInaho: false }), "bsaz01-c18-incoming")
    ).toHaveLength(0);
    expect(
      c18CombineActions(
        buildState({ withInaho: true, hostDefinition: nonCfHostDef }),
        "bsaz01-c18-incoming"
      )
    ).toHaveLength(0);
  });

  it("BSAZ01-C18 は同一 host に複数枚分の追加合体スロットを積まない", () => {
    const state = buildState({
      withInaho: true,
      c18Id: "bsaz01-c18-first",
      extraC18Id: "bsaz01-c18-second",
    });
    const [firstAction] = c18CombineActions(state, "bsaz01-c18-first");
    expect(firstAction).toBeDefined();

    const afterFirst = applyLegalAction({
      state,
      action: firstAction!,
      getCardDefinitionById: lookup,
    }).state;

    expect(c18CombineActions(afterFirst, "bsaz01-c18-second")).toHaveLength(0);
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bsaz01-c18-first"
      )?.attachedToInstanceId
    ).toBe("bsaz01-c18-host");
    expect(
      afterFirst.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bsaz01-c18-second"
      )?.attachedToInstanceId
    ).toBeNull();
  });

  it("『界塚伊奈帆』合体時、手札の BSAZ01-C18 をその host へ直接合体召喚できる", () => {
    const host = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-direct-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bsaz01-c18-direct-inaho"],
    });
    const inaho = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-direct-inaho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const incoming = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-direct-incoming",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, inaho, incoming],
      }),
      activePlayerId: "alice",
      step: "main" as const,
    };

    const pending = executeEffect({
      chainId: "test:bsaz01-cards:2097",
      state,
      effect: directCombineEffect(),
      sourceInstanceId: incoming.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      triggerRelatedInstanceId: inaho.instanceId,
      triggerRelatedCombinedHostInstanceId: host.instanceId,
    });

    expect(
      pending.pendingEnterFieldPlacement?.effectBraveCombineAsSummon
    ).toMatchObject({
      braveInstanceId: incoming.instanceId,
      hostInstanceId: host.instanceId,
      fromZone: "hand",
    });

    const resolve = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolve).toBeDefined();

    const after = applyLegalAction({
      state: pending,
      action: resolve!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      enterFieldCorePlacements: [] as never,
    }).state;

    const c18 = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === incoming.instanceId
    )!;
    const hostAfter = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === host.instanceId
    )!;
    expect(c18.zone).toBe("field");
    expect(c18.attachedToInstanceId).toBe(host.instanceId);
    expect(hostAfter.attachedChildrenIds).toEqual([
      inaho.instanceId,
      incoming.instanceId,
    ]);
    expect(after.log).toContain(
      `effect:summon:${incoming.instanceId}:direct-combine:from=hand:cost=0`
    );
    expect(c18.normalCoreCount).toBe(0);
    const summonPending = after.pendingTriggeredEffects.find(
      (pendingEffect) =>
        pendingEffect.eventKind === "summon" &&
        pendingEffect.relatedInstanceId === incoming.instanceId
    );
    expect(summonPending).toBeDefined();
    const summonResolveActions = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === summonPending?.pendingId
    );
    expect(summonResolveActions).toHaveLength(1);
    expect(summonResolveActions[0]!.executionMode).toBe("mandatory");
  });

  it("手札誘発の宣言可否でも合体先 host をイベント時点で参照し、直接合体配置へ進める", () => {
    const beforeHost = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-private-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [],
    });
    const beforeInaho = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-private-inaho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: null,
    });
    const incoming = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-private-incoming",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const beforeState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [beforeHost, beforeInaho, incoming],
      }),
      activePlayerId: "alice",
      step: "main" as const,
    };
    const queued = collectAndQueueTriggerReactions({
      beforeState,
      afterState: executeBraveCombine(
        beforeState,
        "alice",
        beforeInaho.instanceId,
        beforeHost.instanceId,
        lookup
      ),
      source: "action_resolution",
      chainId: "bsaz01-c18-private-chain",
      attackId: null,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const declaration = queued.pendingPrivateDeclarations.find(
      (pending) =>
        pending.sourceInstanceId === incoming.instanceId &&
        pending.eventKind === "brave_combined"
    );
    expect(declaration).toMatchObject({
      sourceInstanceId: incoming.instanceId,
      relatedInstanceId: beforeInaho.instanceId,
      triggerRelatedCombinedHostInstanceId: beforeHost.instanceId,
    });

    const declare = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "declare_private_triggered_effect" &&
        action.declarationId === declaration?.declarationId
    );
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: declare!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const resolve = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === incoming.instanceId
    );
    expect(resolve).toBeDefined();

    const stackOpened = applyLegalAction({
      state: declared,
      action: resolve!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const pass = getLegalActions({
      state: stackOpened,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const pending = applyLegalAction({
      state: stackOpened,
      action: pass!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(
      pending.pendingEnterFieldPlacement?.effectBraveCombineAsSummon
    ).toMatchObject({
      braveInstanceId: incoming.instanceId,
      hostInstanceId: beforeHost.instanceId,
      fromZone: "hand",
    });
  });

  it("トラッシュの BSAZ01-C18 も直接合体召喚として配置できる", () => {
    const beforeHost = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-private-trash-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [],
    });
    const beforeInaho = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-private-trash-inaho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: null,
    });
    const incoming = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-private-trash-incoming",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const beforeState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [beforeHost, beforeInaho, incoming],
      }),
      activePlayerId: "alice",
      step: "main" as const,
    };
    const queued = collectAndQueueTriggerReactions({
      beforeState,
      afterState: executeBraveCombine(
        beforeState,
        "alice",
        beforeInaho.instanceId,
        beforeHost.instanceId,
        lookup
      ),
      source: "action_resolution",
      chainId: "bsaz01-c18-private-trash-chain",
      attackId: null,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    expect(
      queued.pendingPrivateDeclarations.some(
        (pending) => pending.sourceInstanceId === incoming.instanceId
      )
    ).toBe(false);
    const pendingEffect = queued.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "brave_combined" &&
        pending.relatedInstanceId === beforeInaho.instanceId
    );
    expect(pendingEffect).toMatchObject({
      relatedInstanceId: beforeInaho.instanceId,
      triggerRelatedCombinedHostInstanceId: beforeHost.instanceId,
    });

    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === pendingEffect?.pendingId &&
        action.sourceInstanceId === incoming.instanceId &&
        action.skipOnly !== true
    );
    expect(resolve).toBeDefined();

    const stackOpened = applyLegalAction({
      state: queued,
      action: resolve!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const pass = getLegalActions({
      state: stackOpened,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const pending = applyLegalAction({
      state: stackOpened,
      action: pass!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(
      pending.pendingEnterFieldPlacement?.effectBraveCombineAsSummon
    ).toMatchObject({
      braveInstanceId: incoming.instanceId,
      hostInstanceId: beforeHost.instanceId,
      fromZone: "trash",
    });

    const placement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(placement).toBeDefined();

    const after = applyLegalAction({
      state: pending,
      action: placement!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      enterFieldCorePlacements: [] as never,
    }).state;
    const c18 = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === incoming.instanceId
    )!;
    const hostAfter = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === beforeHost.instanceId
    )!;
    expect(c18.zone).toBe("field");
    expect(c18.attachedToInstanceId).toBe(beforeHost.instanceId);
    expect(hostAfter.attachedChildrenIds).toEqual([
      beforeInaho.instanceId,
      incoming.instanceId,
    ]);
    expect(after.log).toContain(
      `effect:summon:${incoming.instanceId}:direct-combine:from=trash:cost=0`
    );
    expect(c18.normalCoreCount).toBe(0);
  });

  it("〔ターンに1回：同名〕により同一ターン2回目の同名直接合体召喚は宣言できない", () => {
    const host1 = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-private-once-host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [],
    });
    const inaho1 = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-private-once-inaho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: null,
    });
    const host2 = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-private-once-host-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [],
    });
    const inaho2 = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-private-once-inaho-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: null,
    });
    const firstIncoming = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-private-once-incoming-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const secondIncoming = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-private-once-incoming-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const beforeFirstState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          host1,
          inaho1,
          host2,
          inaho2,
          firstIncoming,
          secondIncoming,
        ],
      }),
      activePlayerId: "alice",
      step: "main" as const,
      turnNumber: 7,
    };
    const queuedFirst = collectAndQueueTriggerReactions({
      beforeState: beforeFirstState,
      afterState: executeBraveCombine(
        beforeFirstState,
        "alice",
        inaho1.instanceId,
        host1.instanceId,
        lookup
      ),
      source: "action_resolution",
      chainId: "bsaz01-c18-private-once-chain-1",
      attackId: null,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const firstDeclaration = queuedFirst.pendingPrivateDeclarations.find(
      (pending) =>
        pending.sourceInstanceId === firstIncoming.instanceId &&
        pending.eventKind === "brave_combined"
    );
    expect(firstDeclaration).toBeDefined();
    expect(
      queuedFirst.pendingPrivateDeclarations.filter(
        (pending) =>
          pending.eventKind === "brave_combined" &&
          pending.sourceDefinitionId === c18Def.cardNo
      )
    ).toHaveLength(1);

    const firstDeclare = getLegalActions({
      state: queuedFirst,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "declare_private_triggered_effect" &&
        action.declarationId === firstDeclaration?.declarationId
    );
    expect(firstDeclare).toBeDefined();

    const firstDeclared = applyLegalAction({
      state: queuedFirst,
      action: firstDeclare!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const firstResolve = getLegalActions({
      state: firstDeclared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === firstIncoming.instanceId
    );
    expect(firstResolve).toBeDefined();

    const firstStackOpened = applyLegalAction({
      state: firstDeclared,
      action: firstResolve!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const firstPass = getLegalActions({
      state: firstStackOpened,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((action) => action.kind === "pass_stack");
    expect(firstPass).toBeDefined();

    const firstPendingPlacement = applyLegalAction({
      state: firstStackOpened,
      action: firstPass!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const firstPlacement = getLegalActions({
      state: firstPendingPlacement,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(firstPlacement).toBeDefined();

    const firstResolved = applyLegalAction({
      state: firstPendingPlacement,
      action: firstPlacement!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      enterFieldCorePlacements: [] as never,
    }).state;
    expect(firstResolved.log).toContain(
      `effect:summon:${firstIncoming.instanceId}:direct-combine:from=hand:cost=0`
    );

    const queuedSecond = collectAndQueueTriggerReactions({
      beforeState: firstResolved,
      afterState: executeBraveCombine(
        firstResolved,
        "alice",
        inaho2.instanceId,
        host2.instanceId,
        lookup
      ),
      source: "action_resolution",
      chainId: "bsaz01-c18-private-once-chain-2",
      attackId: null,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const secondDeclaration = queuedSecond.pendingPrivateDeclarations.find(
      (pending) =>
        pending.sourceInstanceId === secondIncoming.instanceId &&
        pending.eventKind === "brave_combined"
    );
    expect(secondDeclaration).toBeUndefined();

    const secondActions = getLegalActions({
      state: queuedSecond,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(
      secondActions.some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === secondIncoming.instanceId
      )
    ).toBe(false);
    expect(
      secondActions.some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === secondIncoming.instanceId
      )
    ).toBe(false);
  });

  it("手札誘発は『自分のスピリット』でない opponent host には宣言できない", () => {
    const beforeHost = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-private-opponent-host",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [],
    });
    const beforeInaho = createCardInstance(inahoDef, {
      instanceId: "bsaz01-c18-private-opponent-inaho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: null,
    });
    const incoming = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-private-opponent-incoming",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const beforeState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [beforeHost, beforeInaho, incoming],
      }),
      activePlayerId: "alice",
      step: "main" as const,
    };
    const queued = collectAndQueueTriggerReactions({
      beforeState,
      afterState: executeBraveCombine(
        beforeState,
        "alice",
        beforeInaho.instanceId,
        beforeHost.instanceId,
        lookup
      ),
      source: "action_resolution",
      chainId: "bsaz01-c18-private-opponent-chain",
      attackId: null,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const declaration = queued.pendingPrivateDeclarations.find(
      (pending) =>
        pending.sourceInstanceId === incoming.instanceId &&
        pending.eventKind === "brave_combined"
    );
    expect(declaration).toBeUndefined();

    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === incoming.instanceId
      )
    ).toBe(false);
    expect(
      actions.some(
        (action) =>
          action.kind === "skip_private_triggered_effect" &&
          action.sourceInstanceId === incoming.instanceId
      )
    ).toBe(false);
  });

  it("召喚時 Lv1: トラッシュの地球マジック3枚までをフィールドに置ける", () => {
    const source = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-summoned",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const earthMagics = ["BSAZ01-C04", "BSAZ01-C07", "BSAZ01-C10"].map(
      (cardNo, index) =>
        createCardInstance(card(cardNo), {
          instanceId: `bsaz01-c18-trash-earth-${index}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "trash",
        })
    );
    const extraEarthMagic = createCardInstance(card("BSAZ01-C08"), {
      instanceId: "bsaz01-c18-trash-earth-extra",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const nonEarth = createCardInstance(card("BSTH01-C12"), {
      instanceId: "bsaz01-c18-trash-non-earth",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...earthMagics, extraEarthMagic, nonEarth],
      }),
      activePlayerId: "alice",
      step: "main" as const,
    };

    const pending = executeEffect({
      chainId: "test:bsaz01-cards:2801",
      state,
      effect: summonTrashMagicEffect(),
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(pending.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      destination: "field",
      maxCount: 3,
      canSkip: true,
    });
    expect(
      pending.pendingZoneSelection!.candidateCardInstanceIds.sort()
    ).toEqual(
      [
        ...earthMagics.map((cardInstance) => cardInstance.instanceId),
        extraEarthMagic.instanceId,
      ].sort()
    );

    const after = applyLegalAction({
      state: pending,
      action: { kind: "resolve_pending_zone_selection" },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      selectedZoneCardIds: earthMagics.map(
        (cardInstance) => cardInstance.instanceId
      ),
    }).state;

    for (const moved of earthMagics) {
      expect(
        after.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === moved.instanceId
        )?.zone
      ).toBe("field");
    }
    expect(
      after.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === extraEarthMagic.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === nonEarth.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("合体中アタック時: 自分フィールドのマジック5枚につき host に黄シンボルを live 変動で追加する", () => {
    const host = createCardInstance(hostDef, {
      instanceId: "bsaz01-c18-symbol-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bsaz01-c18-symbol-brave"],
    });
    const brave = createCardInstance(c18Def, {
      instanceId: "bsaz01-c18-symbol-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const magics = Array.from({ length: 10 }, (_, index) =>
      createCardInstance(card(index % 2 === 0 ? "BSAZ01-C04" : "BSAZ01-C07"), {
        instanceId: `bsaz01-c18-field-magic-${index}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      })
    );
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, ...magics],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      activeAttack: {
        attackId: "bsaz01-c18-symbol-attack",
        attackerInstanceId: host.instanceId,
        defenderPlayerId: "bob",
        declaredAtTurn: 1,
      },
    };
    const beforeYellowCount = getEffectiveSymbols(
      state,
      host,
      hostDef,
      lookup
    ).filter((symbol) => symbol === "yellow").length;

    const after = executeEffect({
      chainId: "test:bsaz01-cards:2900",
      state,
      effect: attackSymbolEffect(),
      sourceInstanceId: brave.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const ce = after.activeContinuousEffects.find(
      (effect) =>
        effect.modifierTag === "symbol_addition" &&
        effect.targetInstanceId === host.instanceId
    );
    expect(ce?.modifierSymbol).toEqual(["yellow"]);
    expect(ce?.modifierSymbolCount).toBeUndefined();
    expect(ce?.modifierSymbolCountDynamic).toEqual({
      source: {
        kind: "cards_in_zone",
        zone: "field",
        player: "self",
        filter: { category: ["magic"] },
      },
      divisor: 5,
    });
    const attackAction = attackSymbolEffect().steps[0]!.action;
    expect(attackAction).toMatchObject({
      count: {
        source: {
          kind: "cards_in_zone",
          zone: "field",
          player: "self",
          filter: { category: ["magic"] },
        },
        divisor: 5,
      },
    });
    expect(attackAction).not.toHaveProperty("countEvaluation");

    const hostAfter = after.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === host.instanceId
    )!;
    const symbols = getEffectiveSymbols(after, hostAfter, hostDef, lookup);
    expect(symbols.filter((symbol) => symbol === "yellow")).toHaveLength(
      beforeYellowCount + 2
    );

    const afterMagicReduced = {
      ...after,
      cardInstances: after.cardInstances.map((cardInstance) =>
        cardInstance.instanceId.startsWith("bsaz01-c18-field-magic-") &&
        Number(
          cardInstance.instanceId.slice("bsaz01-c18-field-magic-".length)
        ) < 5
          ? { ...cardInstance, zone: "trash" as const }
          : cardInstance
      ),
    };
    const hostAfterMagicReduced = afterMagicReduced.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === host.instanceId
    )!;
    const symbolsAfterMagicReduced = getEffectiveSymbols(
      afterMagicReduced,
      hostAfterMagicReduced,
      hostDef,
      lookup
    );
    expect(
      symbolsAfterMagicReduced.filter((symbol) => symbol === "yellow")
    ).toHaveLength(beforeYellowCount + 1);

    const afterMagicIncreased = {
      ...after,
      cardInstances: [
        ...after.cardInstances,
        ...Array.from({ length: 5 }, (_, index) =>
          createCardInstance(
            card(index % 2 === 0 ? "BSAZ01-C04" : "BSAZ01-C07"),
            {
              instanceId: `bsaz01-c18-field-magic-added-${index}`,
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
            }
          )
        ),
      ],
    };
    const hostAfterMagicIncreased = afterMagicIncreased.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === host.instanceId
    )!;
    const symbolsAfterMagicIncreased = getEffectiveSymbols(
      afterMagicIncreased,
      hostAfterMagicIncreased,
      hostDef,
      lookup
    );
    expect(
      symbolsAfterMagicIncreased.filter((symbol) => symbol === "yellow")
    ).toHaveLength(beforeYellowCount + 3);
  });
});

// BSAZ01-C17 は engine-field-magic-self-placement クラスタで実装済み
// (bsaz01-c17-field-magic-self-placement.test.ts 参照)。

describe("BSAZ01-X01 KG-6 スレイプニール[CPA]", () => {
  const c = card("BSAZ01-X01");
  it("煌臨は adventData (normal/both_attack_step) へ再変換 + フラッシュBP-5000→BP0破壊（ターンに1回）", () => {
    // 旧: effects[0] の煌臨宣言 stub → adventData へ移行 (declare_advent 配線済み)
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.adventVariant ?? "normal").toBe("normal");
    expect(c.adventData!.adventCondition.cardNames).toContainEqual({
      contains: "スレイプニール",
    });
    expect(
      (c.effects ?? []).some(
        (e) =>
          typeof e.stub === "string" &&
          e.stub.includes("煌臨システムへの個別配線は未対応")
      )
    ).toBe(false);
    const flash = c.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    // 「合体中、この効果を[ターンに3回]に変更する」: maxCountOverrides で 合体中→3、それ以外→1。
    expect(flash.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
      maxCountOverrides: [{ when: [{ kind: "combined" }], maxCount: 3 }],
    });
    expect(flash.steps[0]!.action.kind).toBe("bp_modify");
    expect(flash.steps[1]!.action.kind).toBe("destroy");
  });

  it("BSAZ01-X01[1] フラッシュ使用回数: 非合体は1回、ブレイヴ合体中は3回まで（maxCountOverrides 配線）", async () => {
    const { canUseEffectByUsageLimit, recordEffectUsage } =
      await import("../src/legal/legal-actions-shared");
    const flash = c.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    const usageLimit = flash.usageLimit!;
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(c, {
          instanceId: "x01",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });
    let state: GameState = { ...baseState, turnNumber: 5 };

    // 非合体: maxCount=1 (base)。1 回消費後は false。
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        usageLimit,
      })
    ).toBe(true);
    state = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        duration: "turn",
      }),
    };
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        usageLimit,
      })
    ).toBe(false);

    // ブレイヴ attach: combined override で maxCount=3 へ。2 回目以降も使える。
    const brave = createCardInstance(c, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
    });
    brave.attachedToInstanceId = "x01";
    state = {
      ...state,
      cardInstances: [...state.cardInstances, brave],
    };
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        usageLimit,
      })
    ).toBe(true);
    // 3 回目まで消費する。
    state = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        duration: "turn",
      }),
    };
    state = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        duration: "turn",
      }),
    };
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "x01",
        sourceDefinitionId: c.cardNo,
        effectLabel: "x01-flash",
        usageLimit,
      })
    ).toBe(false);
  });
});

describe("BSAZ01-X02 KG-6 スレイプニール[最終決戦]", () => {
  const c = card("BSAZ01-X02");
  it("煌臨は adventData (normal/own_turn) へ再変換 + アタック時BP-10000→BP0破壊", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.adventData!.adventVariant ?? "normal").toBe("normal");
    expect(c.adventData!.adventCondition.cardNames).toContainEqual({
      contains: "スレイプニール",
    });
    expect(
      (c.effects ?? []).some(
        (e) =>
          typeof e.stub === "string" &&
          e.stub.includes("煌臨システムへの個別配線は未対応")
      )
    ).toBe(false);
    const attack = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
    )!;
    expect(attack.steps[0]!.action.kind).toBe("bp_modify");
    expect(attack.steps[1]!.action.kind).toBe("destroy");
  });
});
