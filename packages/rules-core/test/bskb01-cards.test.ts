import { flushReadyEffectCompletions } from "../src/effect/effect-completion";
/**
 * BSKB01 (星のカービィ-メタナイト編) カードの effects 検証テスト。
 * 契約煌臨「メタナイト」＆カウント中心。
 * 契約煌臨宣言 (C01/M01/X01) は adventData 配線済み (declare_advent エンジン経路。
 * 実カード煌臨経路の INTEGRATION は bskb01-advent.test.ts)。
 * 動的BP比較破壊・カウント依存の可変コア除去 /
 * 煌臨中条件・Lvコスト増加・コア除去置換は基盤/DSL 未対応のため stub。
 * count_increase / core_move / draw / discard / deck_reveal / search_zone 等の
 * 確定効果のみ DSL 変換済み（第1サブバッチ: 契約/カウント系スピリット6枚）。
 * 第2サブバッチ（C04/C05/C06/R02/R04/TX01）: C05 の鋼騎士トリガー・カウント比例BP /
 * C06 effects[0] のトラッシュ自己効果耐性、effects[1] の動的コスト総量消滅は変換済み。
 *
 * ミラージュ反復 / 系統付与 / 動的コア補充は基盤・DSL 未対応のため
 * per-effect stub。
 * draw / treat_as / rebirth は確定変換済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  ActiveAttack,
  ActiveStack,
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src/runtime";
import {
  getEffectiveBp,
  getEffectiveLevel,
  resolveCardLeavesFieldCores,
  resolveLifeDamage,
  expandCardDefinitionsWithBackFaces,
} from "../src/runtime";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import {
  createStepExecutionContext,
  recordStepResult,
  serializeStepContext,
} from "../src/step-execution-context";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { playSummonAsAction } from "../src/play/play-card-system";
import { advanceStep } from "../src/turn-system";
import {
  buildMagicLookup,
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
  queueEffectActivationTriggers,
} from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "player-1";
const BOB = "player-2";
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const getRegisteredFieldCardEffectActions =
  buildFieldCardEffectLookup(ALL_CARDS);
const getRegisteredHandActivatedEffectActions =
  buildHandActivatedEffectLookup(ALL_CARDS);
const getRegisteredBattleImmediateEffectActions =
  buildBattleImmediateEffectLookup(ALL_CARDS);

function player(state: GameState, id: string) {
  const p = state.players.find((candidate) => candidate.id === id);
  if (!p) throw new Error(`player not found: ${id}`);
  return p;
}

function instance(def: CardDefinition, instanceId: string): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "mirage",
  });
}

function treatAsWhiteCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-treat-white-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "BSKB01-C01",
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color",
    targetInstanceId,
    modifierSymbol: ["white"],
  };
}

describe("BSKB01-C01 [メタナイトの逆襲]メタナイト", () => {
  const c = card("BSKB01-C01");
  it("契約煌臨は adventData / 煌臨アタック時カウント+1 / ターン1回デッキ2破棄→2ドロー / アタック時コア2リザーブ", () => {
    // 契約煌臨宣言は adventData (declare_advent 経路) へ移行済み。
    expect(c.adventData).toMatchObject({
      adventVariant: "contract",
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventCondition: { targetCategory: ["spirit"] },
    });
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 1 },
    ]);

    // カウント+1（強制）。
    const countEff = c.effects![0]!;
    expect(countEff.timing).toEqual({
      kind: "card_event",
      event: ["advent", "attack"],
    });
    expect(countEff.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });

    // 同一効果内でカウント+1→任意のデッキ2破棄→2ドロー→カウント5につき1枚まで鋼騎士をデッキ下へ。
    expect(countEff.stub).toBeUndefined();
    const onceGroup = countEff.steps[1]!;
    expect(onceGroup.id).toBe("mill-draw-return-once");
    expect(onceGroup.action).toEqual({ kind: "noop" });
    expect(onceGroup.executionMode).toBe("optional");
    expect(onceGroup.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    const optionalGroup = countEff.steps[2]!;
    expect(optionalGroup.id).toBe("mill-draw-choice");
    expect(optionalGroup.action).toEqual({ kind: "noop" });
    expect(optionalGroup.executionMode).toBe("optional");
    expect(optionalGroup.usageLimit).toBeUndefined();
    expect(optionalGroup.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mill-draw-return-once",
    });
    expect(countEff.steps[3]!.action).toMatchObject({
      kind: "discard",
      fromZone: "deck",
      count: 2,
      deferMovedToTrashEffects: true,
    });
    expect(countEff.steps[3]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mill-draw-choice",
    });
    expect(countEff.steps[4]!.action).toEqual({ kind: "draw", count: 2 });
    expect(countEff.steps[4]!.connector).toBe("sequential");
    expect(countEff.steps[4]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mill-draw-choice",
    });
    expect(countEff.steps[5]!.action).toEqual({
      kind: "search_zone",
      zone: "trash",
      filter: { category: ["spirit"], tribes: ["鋼騎士"] },
      count: {
        min: 0,
        max: {
          source: { kind: "count_value", player: "self" },
          divisor: 5,
        },
      },
      destination: "deck",
      destinationPosition: "bottom",
    });
    expect(countEff.steps[5]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mill-draw-return-once",
    });
    expect(countEff.steps[6]!.action).toEqual({
      kind: "process_moved_to_trash",
      source: { stepId: "mill-deck" },
      fromZone: "deck",
    });
    expect(countEff.steps[6]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mill-deck",
    });

    // アタック時、相手のスピリット/アルティメット1体を選び、そのコア2個をリザーブへ→
    // 発揮後(conditional_result)、このスピリットは指定してアタックできる。
    const coreEff = c.effects![1]!;
    expect(coreEff.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(coreEff.executionMode).toBe("mandatory");
    expect(coreEff.stub).toBeUndefined();
    expect(coreEff.steps[0]!.action).toEqual({
      kind: "core_move",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      },
      from: { kind: "target_card" },
      to: { kind: "reserve", player: "opponent" },
      amount: 2,
    });
    expect(coreEff.steps[1]!.action).toMatchObject({
      kind: "designate_attack",
      target: {
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
      },
    });
    expect(coreEff.steps[1]!.connector).toBe("after_triggers");
  });

  it("BSKB01-C01: カウント5につき1枚まで、選んだ鋼騎士スピリットをトラッシュからデッキ下へ戻す", () => {
    const runToReturnPending = (
      withDeck = true,
      optionalChoice: "execute" | "decline" = "execute",
      initialCountValue = 4
    ): GameState => {
      const source = createCardInstance(c, {
        instanceId: "meta-source-return",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores: 2,
      });
      const trashA = createCardInstance(card("BSKB01-C02"), {
        instanceId: "trash-knight-a",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      });
      const trashB = createCardInstance(card("BSKB01-C03"), {
        instanceId: "trash-knight-b",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      });
      const trashEffectiveKnight = createCardInstance(card("BSKB01-TX01(A)"), {
        instanceId: "trash-effective-knight",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      });
      const trashNonKnight = createCardInstance(card("BSKB01-C06"), {
        instanceId: "trash-non-knight",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      });
      const deckCards = withDeck
        ? [
            ["deck-white-recovery", "BSAZ02-C13"],
            ["deck-moved-to-trash", "BSTH02-M01"],
            ["deck-draw-1", "BSKB01-T01"],
            ["deck-draw-2", "BSKB01-T01"],
          ].map(([instanceId, cardNo]) =>
            createCardInstance(card(cardNo), {
              instanceId,
              ownerPlayerId: ALICE,
              controllerPlayerId: ALICE,
              zone: "deck",
            })
          )
        : [];
      const base: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [
            source,
            trashA,
            trashB,
            trashEffectiveKnight,
            trashNonKnight,
            ...deckCards,
          ],
        }),
        players: createEmptyGameState({ playerIds: [ALICE, BOB] }).players.map(
          (p) =>
            p.id === ALICE
              ? {
                  ...p,
                  countValue: initialCountValue,
                  deckCount: withDeck ? 4 : 0,
                }
              : p
        ),
        activeContinuousEffects: [treatAsWhiteCE(source.instanceId)],
      };
      const before = executeEffect({
        chainId: "test:bskb01-cards:316",
        state: base,
        effect: card("BSKB01-TX01(A)").effects![0]!,
        effectIndex: 0,
        sourceInstanceId: trashEffectiveKnight.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      });

      const afterStepOptional = executeEffect({
        chainId: "test:bskb01-cards:326",
        state: before,
        effect: c.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      });
      expect(player(afterStepOptional, ALICE).countValue).toBe(
        initialCountValue + 1
      );
      const optional = afterStepOptional.pendingStepOptionalChoice!;
      expect(optional).toMatchObject({
        actingPlayerId: ALICE,
        stepIndex: 1,
        canExecute: true,
      });

      const afterGroupEntry = applyLegalAction({
        state: afterStepOptional,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${optional.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: optional.choosingPlayerId,
          pendingId: optional.pendingId,
          sourceInstanceId: optional.sourceInstanceId,
          effectIndex: optional.effectIndex,
          stepIndex: optional.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
      const millDraw = afterGroupEntry.pendingStepOptionalChoice!;
      expect(millDraw).toMatchObject({
        actingPlayerId: ALICE,
        stepIndex: 2,
        canExecute: true,
      });
      return applyLegalAction({
        state: afterGroupEntry,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${millDraw.pendingId}:${optionalChoice}`,
          can: true,
          reason: "test",
          actingPlayerId: millDraw.choosingPlayerId,
          pendingId: millDraw.pendingId,
          sourceInstanceId: millDraw.sourceInstanceId,
          effectIndex: millDraw.effectIndex,
          stepIndex: millDraw.stepIndex,
          choice: optionalChoice,
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
    };

    const afterPending = runToReturnPending();

    expect(afterPending.pendingZoneSelection).toMatchObject({
      actingPlayerId: ALICE,
      actionKind: "return_from_trash",
      sourceZone: "trash",
      maxCount: 1,
      destination: "deck",
      destinationPosition: "bottom",
      canSkip: true,
    });
    expect(
      afterPending.pendingZoneSelection!.candidateCardInstanceIds.sort()
    ).toEqual(["trash-effective-knight", "trash-knight-a", "trash-knight-b"]);
    expect(
      afterPending.cardInstances.find((x) => x.instanceId === "trash-knight-a")
    ).toMatchObject({ zone: "trash" });
    expect(
      afterPending.cardInstances.find(
        (x) => x.instanceId === "deck-moved-to-trash"
      )
    ).toMatchObject({ zone: "trash" });
    expect(
      afterPending.cardInstances.find(
        (x) => x.instanceId === "deck-white-recovery"
      )
    ).toMatchObject({ zone: "trash" });
    expect(afterPending.pendingTrashOptionalAdds).toHaveLength(0);
    expect(
      afterPending.log.some((line) =>
        line.startsWith("moved_to_trash:remove_from_game:")
      )
    ).toBe(false);

    const belowCountThreshold = runToReturnPending(true, "decline", 3);
    expect(player(belowCountThreshold, ALICE).countValue).toBe(4);
    expect(belowCountThreshold.pendingZoneSelection).toBeNull();

    const twoReturnPending = runToReturnPending(true, "execute", 9);
    expect(twoReturnPending.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      sourceZone: "trash",
      maxCount: 2,
      destination: "deck",
      destinationPosition: "bottom",
      canSkip: true,
    });
    const afterTwoReturns = applyLegalAction({
      state: twoReturnPending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-knight-a", "trash-effective-knight"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(player(afterTwoReturns, ALICE).countValue).toBe(10);
    expect(player(afterTwoReturns, ALICE).deckCount).toBe(2);
    expect(
      afterTwoReturns.cardInstances.find(
        (x) => x.instanceId === "trash-knight-a"
      )
    ).toMatchObject({ zone: "deck" });
    expect(
      afterTwoReturns.cardInstances.find(
        (x) => x.instanceId === "trash-effective-knight"
      )
    ).toMatchObject({ zone: "deck" });
    expect(
      afterTwoReturns.cardInstances.find(
        (x) => x.instanceId === "trash-knight-b"
      )
    ).toMatchObject({ zone: "trash" });

    const afterZero = applyLegalAction({
      state: afterPending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: [],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(player(afterZero, ALICE).countValue).toBe(5);
    expect(player(afterZero, ALICE).deckCount).toBe(0);
    expect(
      afterZero.cardInstances.find((x) => x.instanceId === "trash-knight-a")
    ).toMatchObject({ zone: "trash" });
    expect(
      afterZero.cardInstances.find(
        (x) => x.instanceId === "deck-moved-to-trash"
      )
    ).toMatchObject({ zone: "removed_from_game" });
    expect(afterZero.pendingTrashOptionalAdds).toHaveLength(1);
    expect(afterZero.pendingTrashOptionalAdds[0]!.instanceIds).toEqual([
      "deck-white-recovery",
    ]);
    expect(
      afterZero.log.indexOf("moved_to_trash:deferred:player-1:2")
    ).toBeGreaterThan(-1);
    const returnLogIndex = afterZero.log.findIndex((line) =>
      line.startsWith("effect:return_from_trash:player-1:0:deck:bottom")
    );
    const movedLogIndex = afterZero.log.findIndex((line) =>
      line.startsWith("moved_to_trash:remove_from_game:")
    );
    expect(returnLogIndex).toBeGreaterThan(-1);
    expect(movedLogIndex).toBeGreaterThan(returnLogIndex);

    const afterNoDeck = applyLegalAction({
      state: runToReturnPending(false),
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-knight-a"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(player(afterNoDeck, ALICE).deckCount).toBe(1);
    expect(
      afterNoDeck.cardInstances.find((x) => x.instanceId === "trash-knight-a")
    ).toMatchObject({ zone: "deck" });

    const afterDeclineMillDraw = applyLegalAction({
      state: runToReturnPending(true, "decline"),
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-knight-b"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(player(afterDeclineMillDraw, ALICE).deckCount).toBe(5);
    expect(
      afterDeclineMillDraw.cardInstances.find(
        (x) => x.instanceId === "trash-knight-b"
      )
    ).toMatchObject({ zone: "deck" });

    const after = applyLegalAction({
      state: runToReturnPending(),
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-knight-a"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;

    const alice = player(after, ALICE);
    expect(alice.countValue).toBe(5);
    expect(alice.deckCount).toBe(1);
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-knight-a")
    ).toMatchObject({ zone: "deck" });
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-knight-b")
    ).toMatchObject({ zone: "trash" });
    expect(
      after.cardInstances.find((x) => x.instanceId === "trash-non-knight")
    ).toMatchObject({ zone: "trash" });
    expect(
      after.cardInstances.find((x) => x.instanceId === "deck-moved-to-trash")
    ).toMatchObject({ zone: "removed_from_game" });
    const deckOrder = after.cardInstances
      .filter((x) => x.ownerPlayerId === ALICE && x.zone === "deck")
      .map((x) => x.instanceId);
    expect(deckOrder.slice(-1)).toEqual(["trash-knight-a"]);
  });

  it("BSKB01-C01: ターンに1回の任意グループは同名別個体ごとに独立し、同一個体の2回目は止まる", () => {
    const sourceA = createCardInstance(c, {
      instanceId: "meta-source-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 2,
    });
    const sourceB = createCardInstance(c, {
      instanceId: "meta-source-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 2,
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [sourceA, sourceB],
      }),
      activePlayerId: ALICE,
      step: "attack",
      turnNumber: 7,
    };
    const stepUsageLabel = "__step:BSKB01-C01:0:1";

    const triggerAndExecuteOptional = (
      state: GameState,
      sourceInstanceId: string
    ): GameState => {
      const afterPending = executeEffect({
        chainId: "test:bskb01-cards:577",
        state,
        effect: c.effects![0]!,
        effectIndex: 0,
        sourceInstanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      });
      const optional = afterPending.pendingStepOptionalChoice!;
      expect(optional).toMatchObject({
        sourceInstanceId,
        effectIndex: 0,
        stepIndex: 1,
        canExecute: true,
      });
      const afterEntry = applyLegalAction({
        state: afterPending,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${optional.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: optional.choosingPlayerId,
          pendingId: optional.pendingId,
          sourceInstanceId: optional.sourceInstanceId,
          effectIndex: optional.effectIndex,
          stepIndex: optional.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
      const millDraw = afterEntry.pendingStepOptionalChoice!;
      expect(millDraw).toMatchObject({
        sourceInstanceId,
        effectIndex: 0,
        stepIndex: 2,
        canExecute: true,
      });
      return applyLegalAction({
        state: afterEntry,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${millDraw.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: millDraw.choosingPlayerId,
          pendingId: millDraw.pendingId,
          sourceInstanceId: millDraw.sourceInstanceId,
          effectIndex: millDraw.effectIndex,
          stepIndex: millDraw.stepIndex,
          choice: "decline",
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
    };

    const afterEntryDeclinePending = executeEffect({
      chainId: "test:bskb01-cards:636",
      state: before,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "meta-source-a",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    const entryDecline = afterEntryDeclinePending.pendingStepOptionalChoice!;
    const afterEntryDecline = applyLegalAction({
      state: afterEntryDeclinePending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${entryDecline.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: entryDecline.choosingPlayerId,
        pendingId: entryDecline.pendingId,
        sourceInstanceId: entryDecline.sourceInstanceId,
        effectIndex: entryDecline.effectIndex,
        stepIndex: entryDecline.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(
      afterEntryDecline.effectUsageRecords.filter(
        (r) =>
          r.effectLabel === stepUsageLabel &&
          r.sourceInstanceId === "meta-source-a"
      )
    ).toHaveLength(0);

    const afterA = triggerAndExecuteOptional(before, "meta-source-a");
    expect(
      afterA.effectUsageRecords.filter(
        (r) =>
          r.effectLabel === stepUsageLabel &&
          r.sourceInstanceId === "meta-source-a"
      )
    ).toHaveLength(1);

    const afterB = triggerAndExecuteOptional(afterA, "meta-source-b");
    expect(
      afterB.effectUsageRecords.filter(
        (r) =>
          r.effectLabel === stepUsageLabel &&
          r.sourceInstanceId === "meta-source-b"
      )
    ).toHaveLength(1);

    const stateBeforeASecond: GameState = {
      ...afterB,
      players: afterB.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 4 } : p
      ),
      cardInstances: [
        ...afterB.cardInstances,
        createCardInstance(card("BSKB01-C02"), {
          instanceId: "trash-knight-second-use",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "trash",
        }),
      ],
    };
    const afterASecond = executeEffect({
      chainId: "test:bskb01-cards:704",
      state: stateBeforeASecond,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "meta-source-a",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    expect(afterASecond.pendingStepOptionalChoice).toBeNull();
    expect(afterASecond.pendingZoneSelection).toBeNull();
    // 「ターンに1回」は後段の任意ミル/ドロー/戻しグループだけに掛かる。
    // 同一個体の二回目でも、先行する強制のカウント+1は解決され続ける。
    expect(player(afterASecond, ALICE).countValue).toBe(5);
    expect(
      afterASecond.effectUsageRecords.filter(
        (r) =>
          r.effectLabel === stepUsageLabel &&
          r.sourceInstanceId === "meta-source-a"
      )
    ).toHaveLength(1);
    expect(
      afterASecond.log.some((l) =>
        l.startsWith("effect:step-usage-exhausted:meta-source-a:0:1")
      )
    ).toBe(true);
  });

  it("指定対象不在のアタック時効果は進行中バトルを維持し、追加アタック権を作らない", () => {
    const additionalAttackEff = {
      ...c.effects![1]!,
      executionMode: "mandatory" as const,
      steps: [{ action: c.effects![1]!.steps[1]!.action }],
    };
    const attacker = createCardInstance(c, {
      instanceId: "meta-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-meta:1",
      primaryEntityId: "be-meta",
      participantEntityIds: ["be-meta"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-meta", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-meta"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-meta",
          resolvedBp: 4000,
          attackState: "attacking",
          resolvedSymbols: ["purple"],
          memberInstanceIds: ["meta-attacker"],
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:bskb01-cards:781",
      state: before,
      effect: { ...additionalAttackEff, executionMode: "mandatory" },
      sourceInstanceId: attacker.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    // 進行中のバトル (declare_attack 窓、block 未確定) が破棄されず維持される。
    expect(after.activeAttack).toEqual(activeAttack);
    expect(after.step).toBe("attack");
    expect(after.window).toBe("declare_attack");
    // 疲労バイパス grant が発行される。
    expect(after.pendingAdditionalAttackGrants).toEqual([]);
  });

  it("production dispatch経由: コア除去と誘発の後に現在の攻撃先を指定して強制ブロック窓を開く", () => {
    const attacker = createCardInstance(c, {
      instanceId: "meta-attacker-e2e",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    // core_move の対象 (相手のスピリット/アルティメット1体) が場に必要。
    const opponentTarget = createCardInstance(card("BSKB01-M01"), {
      instanceId: "opponent-target-e2e",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const deckCards = [
      ["e2e-white-recovery", "BSAZ02-C13"],
      ["e2e-moved-to-trash", "BSTH02-M01"],
      ["e2e-draw-1", "BSKB01-T01"],
      ["e2e-draw-2", "BSKB01-T01"],
    ].map(([instanceId, cardNo]) =>
      createCardInstance(card(cardNo), {
        instanceId,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    let current: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker, opponentTarget, ...deckCards],
      }),
      players: createEmptyGameState({ playerIds: [ALICE, BOB] }).players.map(
        (p) => (p.id === ALICE ? { ...p, countValue: 0, deckCount: 4 } : p)
      ),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
      activeContinuousEffects: [treatAsWhiteCE(attacker.instanceId)],
    };
    const bobReserveBefore = player(current, BOB).reserveNormalCoreCount;

    const commonLookups = {
      getCardDefinitionById: cardNoMap.get.bind(cardNoMap),
      getRegisteredFieldCardEffectActions,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions,
    };

    const attackAction = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      ...commonLookups,
    }).find(
      (action) =>
        action.kind === "attack" &&
        action.sourceInstanceId === "meta-attacker-e2e"
    );
    expect(attackAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: attackAction!,
      ...commonLookups,
    }).state;

    const passPreDeclaration = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      ...commonLookups,
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(passPreDeclaration).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: passPreDeclaration!,
      ...commonLookups,
    }).state;

    // アタック宣言が確定し、declare_attack 窓でバトルが進行中。
    expect(current.step).toBe("attack");
    expect(current.window).toBe("declare_attack");
    expect(current.activeAttack).not.toBeNull();
    const originalAttackEntityId = current.activeAttack!.primaryEntityId;

    // 自カードの『アタック時』効果 (count_increase / mill+draw / core_move→designate_attack)
    // は battleImmediateEffects (resolve_battle_immediate_effect legal action) 経由で解決
    // する (pendingTriggeredEffects は他カード上のリスナー用の別経路)。core_move+
    // designate_attack (registrationIndex 1、after_triggers で1効果に合成済み) の
    // promptId が現れるまで、他の battle immediate effect を順に発揮させて片付ける。
    let guard = 0;
    let mergedEffectResolved = false;
    let trashOptionalMaterializedDuringAttack = false;
    while (
      (current.battleImmediateEffects.length > 0 ||
        current.pendingStepOptionalChoice ||
        current.pendingStepOptionalTargetSelection) &&
      guard++ < 20
    ) {
      if (current.pendingStepOptionalTargetSelection) {
        const pending = current.pendingStepOptionalTargetSelection;
        const action = getLegalActions({
          state: current,
          actingPlayerId: pending.choosingPlayerId,
          ...commonLookups,
        }).find(
          (a) => a.kind === "resolve_pending_step_optional_target_selection"
        );
        expect(action).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: action!,
          targetInstanceIds: [opponentTarget.instanceId],
          ...commonLookups,
        }).state;
        continue;
      }
      if (current.pendingDeckReveal?.origin === "trash") {
        expect(current.activeAttack).not.toBeNull();
        trashOptionalMaterializedDuringAttack = true;
        const pick = getLegalActions({
          state: current,
          actingPlayerId: ALICE,
          ...commonLookups,
        }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
        expect(pick).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pick!,
          ...commonLookups,
          selectedDeckRevealCardIds: [],
        }).state;
        continue;
      }
      if (current.pendingStepOptionalChoice) {
        const optional = current.pendingStepOptionalChoice;
        const executeMillGroup =
          optional.sourceInstanceId === attacker.instanceId &&
          optional.effectIndex === 0 &&
          (optional.stepIndex === 1 || optional.stepIndex === 2);
        const executeAttackEffect =
          optional.sourceInstanceId === attacker.instanceId &&
          optional.effectIndex === 1;
        const choice =
          executeMillGroup || executeAttackEffect ? "execute" : "decline";
        current = applyLegalAction({
          state: current,
          action: {
            kind: "resolve_pending_step_optional_choice",
            actionId: `pso-${optional.pendingId}:${choice}`,
            can: true,
            reason: "test",
            actingPlayerId: optional.choosingPlayerId,
            pendingId: optional.pendingId,
            sourceInstanceId: optional.sourceInstanceId,
            effectIndex: optional.effectIndex,
            stepIndex: optional.stepIndex,
            choice,
          },
          ...commonLookups,
        }).state;
        continue;
      }
      const actions = getLegalActions({
        state: current,
        actingPlayerId: ALICE,
        ...commonLookups,
      }).filter((action) => action.kind === "resolve_battle_immediate_effect");
      expect(
        actions.length,
        "resolve_battle_immediate_effect actions available"
      ).toBeGreaterThan(0);

      const mergedEffectAction = actions.find((action) =>
        current.battleImmediateEffects.some(
          (bie) =>
            bie.promptId === (action as { promptId: string }).promptId &&
            bie.registrationIndex === 1
        )
      );
      const countEffectAction = actions.find((action) =>
        current.battleImmediateEffects.some(
          (bie) =>
            bie.promptId === (action as { promptId: string }).promptId &&
            bie.registrationIndex === 0
        )
      );
      const nextAction =
        !trashOptionalMaterializedDuringAttack && countEffectAction
          ? countEffectAction
          : (mergedEffectAction ?? actions[0]!);
      const candidateTargetInstanceIds = (
        nextAction === mergedEffectAction
          ? (mergedEffectAction as
              | { candidateTargetInstanceIds?: string[] }
              | undefined)
          : undefined
      )?.candidateTargetInstanceIds;
      const targetInstanceIds =
        candidateTargetInstanceIds && candidateTargetInstanceIds.length > 0
          ? [candidateTargetInstanceIds[0]!]
          : undefined;
      current = applyLegalAction({
        state: current,
        action: nextAction,
        ...commonLookups,
        skipOptionalEffect: false,
        ...(targetInstanceIds ? { targetInstanceIds } : {}),
      }).state;
      if (nextAction === mergedEffectAction) {
        mergedEffectResolved = true;
      }

      let stackGuard = 0;
      while (current.stackWindow && stackGuard++ < 10) {
        const actingPlayerId = current.stackWindow.priorityPlayerId;
        const pass = getLegalActions({
          state: current,
          actingPlayerId,
          ...commonLookups,
        }).find((action) => action.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          ...commonLookups,
        }).state;
      }
    }
    expect(mergedEffectResolved).toBe(true);
    expect(trashOptionalMaterializedDuringAttack).toBe(true);

    // 誘発を解決し終えた同じアタックで、指定した相手の強制ブロックへ進む。
    expect(current.step).toBe("attack");
    expect(
      current.window,
      JSON.stringify({
        log: current.log.slice(-22),
        pending: Object.entries(current).filter(
          ([k, v]) =>
            k.startsWith("pending") &&
            v != null &&
            (!Array.isArray(v) || v.length)
        ),
        effects: current.battleImmediateEffects,
      })
    ).toBe("pre_declaration_stack");
    expect(current.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "opponent-target-e2e",
    });
    expect(current.activeAttack?.primaryEntityId).toBe(originalAttackEntityId);
    expect(current.activeAttack?.designatedTargetInstanceId).toBe(
      "opponent-target-e2e"
    );
    expect(current.pendingAdditionalAttackGrants).toEqual([]);
    // core_move (単一対象コアシュート) も production dispatch 経由で実際に成立している。
    const resolvedTarget = current.cardInstances.find(
      (instance) => instance.instanceId === "opponent-target-e2e"
    );
    expect(resolvedTarget?.normalCoreCount).toBe(1);
    expect(player(current, BOB).reserveNormalCoreCount).toBe(
      bobReserveBefore + 2
    );
  });
});

describe("BSKB01-CX01 [仮面の騎士]メタナイト", () => {
  const c = card("BSKB01-CX01");
  it("メイン終了時(お互い)コア移動(→対象)→カウント+1→BP比較破壊 / アタック時カウント+2", () => {
    const mainEnd = c.effects![1]!;
    expect(mainEnd.timing).toEqual({
      kind: "phase",
      step: "main",
      whose: "either",
      subPhase: "end",
    });
    expect(mainEnd.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "reserve", player: "opponent" },
      to: { kind: "target_card" },
      amount: 1,
    });
    expect(mainEnd.steps[1]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(mainEnd.steps[1]!.connector).toBe("conditional_result");
    // BP比較破壊が解決ステップとして表現され、stub は解消済み。
    expect(mainEnd.steps[2]!.action).toMatchObject({
      kind: "bp_compare_destroy",
      target: { kind: "ref", stepId: "place-core" },
    });
    expect(mainEnd.stub).toBeUndefined();

    const atk = c.effects![2]!;
    expect(atk.steps[0]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 2,
    });
  });
});

describe("BSKB01-M01 [銀河に願いを]メタナイト", () => {
  const c = card("BSKB01-M01");
  it("契約煌臨は adventData(both_attack_step) / Lvコスト+2 は stub / 煌臨アタック時デッキ3オープン鋼騎士ピック / カウント5でコア3リザーブ", () => {
    // 『お互いのアタックステップ』契約煌臨 → adventData (both_attack_step)。
    expect(c.adventData).toMatchObject({
      adventVariant: "contract",
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventCondition: { targetCategory: ["spirit"] },
    });
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 5 },
    ]);

    const reveal = c.effects![0]!.steps[0]!.action;
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(reveal).toMatchObject({
      kind: "deck_reveal",
      revealCount: 3,
      remainder: "bottom",
    });
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks).toEqual([
        {
          count: 1,
          filter: {
            category: ["spirit", "ultimate", "brave", "nexus"],
            tribes: ["鋼騎士"],
          },
          destination: "field",
          costGate: 1,
          exclusiveGroup: "kb01m01_field",
        },
        { count: 1, destination: "trash" },
      ]);
    }

    // Lvコスト+2: override_properties.levelCostDelta で相手ネクサス1つの最低 Lv コストを +2。
    const lvCostEff = c.effects![1]!;
    expect(lvCostEff.stub).toBeUndefined();
    expect(lvCostEff.steps[0]!.action).toMatchObject({
      kind: "override_properties",
      properties: { levelCostDelta: 2 },
    });

    // カウント5以上で相手フィールドのコア3個をリザーブへ。
    const coreStep = c.effects![1]!.steps[1]!;
    expect(coreStep.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 5,
    });
    expect(coreStep.action).toMatchObject({
      kind: "core_move",
      amount: 3,
    });
  });
});

describe("BSKB01-C03 ソードナイト＆ブレードナイト", () => {
  const c = card("BSKB01-C03");
  it("召喚時デッキ2枚破棄＋手札/トラッシュのハルバード配置 / アタック時2体へ1個ずつコア移動を DSL 化", () => {
    expect(c.effects).toHaveLength(2);
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.steps[0]!.action).toEqual({
      kind: "discard",
      player: "self",
      fromZone: "deck",
      count: 2,
      deferMovedToTrashEffects: true,
    });
    expect(summon.steps[0]!.executionMode).toBe("optional");
    expect(summon.steps[1]!.action).toEqual({
      kind: "search_zone",
      zone: ["hand", "trash"],
      filter: {
        category: ["nexus"],
        cardName: [{ contains: "戦艦ハルバード" }],
      },
      count: { min: 0, max: 1 },
      destination: "field",
    });
    expect(summon.steps[1]!.targetSelectionTiming).toBe("on_step");
    expect(summon.steps[2]!.action).toEqual({
      kind: "process_moved_to_trash",
      source: { stepId: "mill-deck" },
      fromZone: "deck",
    });
    expect(summon.steps[2]!.connector).toBe("sequential");
    expect(summon.steps[2]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mill-deck",
    });
    expect(summon.stub).toBeUndefined();

    const attack = c.effects![1]!;
    expect(attack.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(attack.steps[0]!.action).toEqual({
      kind: "core_move",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      },
      from: { kind: "target_card" },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    });
    expect(attack.steps[0]!.repeat).toEqual({
      additional: 1,
      allowDuplicateTargets: false,
    });
    expect(attack.stub).toBeUndefined();

    const regs = getRegisteredBattleImmediateEffectActions(c.cardNo) ?? [];
    const attackReg = regs.find((reg) => reg.effectIndex === 1);
    expect(attackReg).toMatchObject({
      requiredTargetCount: 2,
      maxTargetCount: 2,
      candidateTargetPlayerScope: "opponent",
    });
    expect(attackReg?.allowDuplicateTargets).toBeUndefined();
  });

  it("召喚時: 手札/トラッシュ候補から選んだ戦艦ハルバードだけをコストなし配置する", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03-summon",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handHalberd = createCardInstance(card("BSKB01-C04"), {
      instanceId: "hand-halberd",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const trashHalberd = createCardInstance(card("BSKB01-C04"), {
      instanceId: "trash-halberd",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const deckA = createCardInstance(card("BSKB01-C01"), {
      instanceId: "deck-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const deckB = createCardInstance(card("BSKB01-C02"), {
      instanceId: "deck-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, handHalberd, trashHalberd, deckA, deckB],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, deckCount: 2, handCount: 1 } : p
      ),
    };

    const afterEffect = executeEffect({
      chainId: "test:bskb01-cards:1275",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "alice-c03-summon",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    const discardChoice = afterEffect.pendingStepOptionalChoice!;
    expect(discardChoice).toMatchObject({
      sourceInstanceId: "alice-c03-summon",
      stepIndex: 0,
      stepLabel: "mill-deck",
      choosingPlayerId: ALICE,
    });
    const afterDiscard = applyLegalAction({
      state: afterEffect,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: "execute",
        pendingId: discardChoice.pendingId,
        actingPlayerId: discardChoice.choosingPlayerId,
      },
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(afterDiscard.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      sourceZone: "trash",
      destination: "field",
      maxCount: 1,
      canSkip: true,
    });
    expect(
      afterDiscard.pendingZoneSelection!.candidateCardInstanceIds.sort()
    ).toEqual(["hand-halberd", "trash-halberd"]);

    const resolved = applyLegalAction({
      state: afterDiscard,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-halberd"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;

    const byId = (id: string) =>
      resolved.cardInstances.find((candidate) => candidate.instanceId === id)!;
    expect(byId("trash-halberd")).toMatchObject({
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
      minimumRequiredCores: 0,
    });
    expect(byId("hand-halberd").zone).toBe("hand");
    expect(byId("deck-a").zone).toBe("trash");
    expect(byId("deck-b").zone).toBe("trash");
    expect(player(resolved, ALICE).deckCount).toBe(0);
    expect(player(resolved, ALICE).handCount).toBe(1);
  });

  it("召喚時: 選択済みsearch_zoneの自動配置でもfield-placeログを出す", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03-auto",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const trashHalberd = createCardInstance(card("BSKB01-C04"), {
      instanceId: "trash-halberd-auto",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, trashHalberd],
    });
    const state: GameState = { ...base, activePlayerId: ALICE };
    const searchOnlyEffect: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: ["hand", "trash"],
            target: {
              kind: "filter",
              player: "self",
              zone: ["hand", "trash"],
              filter: {
                category: ["nexus"],
                cardName: [{ contains: "戦艦ハルバード" }],
              },
              count: { min: 0, max: 1 },
            },
            filter: {
              category: ["nexus"],
              cardName: [{ contains: "戦艦ハルバード" }],
            },
            count: { min: 0, max: 1 },
            destination: "field",
          },
        },
      ],
    };

    const resolved = executeEffect({
      chainId: "test:bskb01-cards:1384",
      state,
      effect: searchOnlyEffect,
      sourceInstanceId: "alice-c03-auto",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      targetInstanceIds: ["trash-halberd-auto"],
      targetSelectionResolved: true,
    });

    expect(resolved.pendingZoneSelection).toBeNull();
    const placed = resolved.cardInstances.find(
      (candidate) => candidate.instanceId === "trash-halberd-auto"
    )!;
    expect(placed.zone).toBe("field");
    expect(resolved.log).toContain(
      "effect:field_place:return_from_trash:player-1:trash-halberd-auto"
    );
  });

  it("召喚時: 誘発スタック経路でもデッキ破棄後に落ちた戦艦ハルバードを配置候補にする", () => {
    const source = createCardInstance(c, {
      instanceId: "alice-c03-triggered",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const deckHalberd = createCardInstance(card("BSKB01-C04"), {
      instanceId: "deck-halberd-triggered",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const deckFiller = createCardInstance(card("BSKB01-C01"), {
      instanceId: "deck-filler-triggered",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      activePlayerId: ALICE,
      cardInstances: [source, deckHalberd, deckFiller],
      playerOverrides: [
        { deckCount: 2, handCount: 1, reserveNormalCoreCount: 5 },
        {},
      ],
    });
    const state: GameState = {
      ...base,
      step: "main",
    };

    const queued = playSummonAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "alice-c03-triggered",
      paymentSources: [{ kind: "reserve", amount: 4 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "summon" &&
        p.relatedInstanceId === "alice-c03-triggered"
    );
    expect(pending).toBeDefined();

    const resolveAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();

    let current = applyLegalAction({
      state: queued,
      action: resolveAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    expect(current.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );

    const pass = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(current.pendingEffectTargetSelection).toBeNull();
    const discardChoice = current.pendingStepOptionalChoice!;
    expect(discardChoice).toMatchObject({
      sourceInstanceId: "alice-c03-triggered",
      stepIndex: 0,
      stepLabel: "mill-deck",
      choosingPlayerId: ALICE,
    });

    current = applyLegalAction({
      state: current,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: "execute",
        pendingId: discardChoice.pendingId,
        actingPlayerId: discardChoice.choosingPlayerId,
      },
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(current.pendingEffectTargetSelection).toBeNull();
    expect(current.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      destination: "field",
      maxCount: 1,
      canSkip: true,
    });
    expect(current.pendingZoneSelection!.candidateCardInstanceIds).toEqual([
      "deck-halberd-triggered",
    ]);

    current = applyLegalAction({
      state: current,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["deck-halberd-triggered"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    const placed = current.cardInstances.find(
      (candidate) => candidate.instanceId === "deck-halberd-triggered"
    )!;
    expect(placed).toMatchObject({
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
      minimumRequiredCores: 0,
    });
    expect(current.log).toContain(
      "effect:field_place:return_from_trash:player-1:deck-halberd-triggered"
    );
    expect(player(current, ALICE).deckCount).toBe(0);
  });

  it("召喚時: デッキ2枚破棄を辞退しても、その後のハルバード配置を選べる", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03-decline-mill",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handHalberd = createCardInstance(card("BSKB01-C04"), {
      instanceId: "hand-halberd-decline",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const deckA = createCardInstance(card("BSKB01-C01"), {
      instanceId: "deck-decline-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const deckB = createCardInstance(card("BSKB01-C02"), {
      instanceId: "deck-decline-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, handHalberd, deckA, deckB],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, deckCount: 2, handCount: 1 } : p
      ),
    };

    const afterEffect = executeEffect({
      chainId: "test:bskb01-cards:1596",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "alice-c03-decline-mill",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    const discardChoice = afterEffect.pendingStepOptionalChoice!;
    const afterDecline = applyLegalAction({
      state: afterEffect,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: "decline",
        pendingId: discardChoice.pendingId,
        actingPlayerId: discardChoice.choosingPlayerId,
      },
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(afterDecline.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      destination: "field",
      maxCount: 1,
      canSkip: true,
    });
    expect(afterDecline.pendingZoneSelection!.candidateCardInstanceIds).toEqual(
      ["hand-halberd-decline"]
    );

    const resolved = applyLegalAction({
      state: afterDecline,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["hand-halberd-decline"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;

    const byId = (id: string) =>
      resolved.cardInstances.find((candidate) => candidate.instanceId === id)!;
    expect(byId("hand-halberd-decline")).toMatchObject({
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
      minimumRequiredCores: 0,
    });
    expect(byId("deck-decline-a").zone).toBe("deck");
    expect(byId("deck-decline-b").zone).toBe("deck");
    expect(player(resolved, ALICE).deckCount).toBe(2);
    expect(player(resolved, ALICE).handCount).toBe(0);
  });

  it("アタック時: 選んだ相手2体から1個ずつだけリザーブへ移し、片方に2個寄せない", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = card("BSKB01-C01");
    const enemyA = createCardInstance(targetDef, {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const enemyB = createCardInstance(targetDef, {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const enemyC = createCardInstance(targetDef, {
      instanceId: "enemy-c",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 4,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, enemyA, enemyB, enemyC],
    });
    const state: GameState = { ...base, activePlayerId: ALICE };

    const after = executeEffect({
      chainId: "test:bskb01-cards:1685",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "alice-c03",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      targetInstanceIds: ["enemy-a", "enemy-b"],
    });

    const byId = (id: string) =>
      after.cardInstances.find((candidate) => candidate.instanceId === id)!;
    expect(byId("enemy-a").normalCoreCount).toBe(2);
    expect(byId("enemy-b").normalCoreCount).toBe(1);
    expect(byId("enemy-c").normalCoreCount).toBe(4);
    expect(player(after, BOB).reserveNormalCoreCount).toBe(
      player(state, BOB).reserveNormalCoreCount + 2
    );
    expect(after.log).toContain(
      "effect:repeat-activation:alice-c03:1:0:iter=1/1"
    );
  });

  it("アタック時: 対象未指定の自動解決でも同じ相手1体をrepeatで再選択しない", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = card("BSKB01-C01");
    const enemyA = createCardInstance(targetDef, {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const enemyB = createCardInstance(targetDef, {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, enemyA, enemyB],
    });
    const state: GameState = { ...base, activePlayerId: ALICE };

    const after = executeEffect({
      chainId: "test:bskb01-cards:1736",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "alice-c03",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    const byId = (id: string) =>
      after.cardInstances.find((candidate) => candidate.instanceId === id)!;
    expect(byId("enemy-a").normalCoreCount).toBe(2);
    expect(byId("enemy-b").normalCoreCount).toBe(1);
    expect(player(after, BOB).reserveNormalCoreCount).toBe(
      player(state, BOB).reserveNormalCoreCount + 2
    );
  });

  it("アタック時: 1体目が通常/ソウル選択pendingを出しても解決後に残りrepeatを再開する", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = card("BSKB01-C01");
    const enemyA = createCardInstance(targetDef, {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyB = createCardInstance(targetDef, {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, enemyA, enemyB],
      playerOverrides: [
        {},
        { soulCoreLocation: { kind: "card", instanceId: "enemy-a" } },
      ],
    });
    const state: GameState = { ...base, activePlayerId: ALICE };

    const pending = executeEffect({
      chainId: "test:bskb01-cards:1786",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "alice-c03",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      targetInstanceIds: ["enemy-a", "enemy-b"],
    });

    expect(pending.pendingLifeCoreSelection).toMatchObject({
      actingPlayerId: BOB,
      totalAmount: 1,
    });
    expect(pending.pendingLifeCoreSelection?.continuation).toBeDefined();
    expect(
      pending.cardInstances.find(
        (candidate) => candidate.instanceId === "enemy-b"
      )?.normalCoreCount
    ).toBe(2);

    const action = getLegalActions({
      state: pending,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: pending,
      action: action!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      lifeCorePartitionChoice: { normalChosen: 1, soulChosen: 0 },
    }).state;

    const byId = (id: string) =>
      resolved.cardInstances.find((candidate) => candidate.instanceId === id)!;
    expect(resolved.pendingLifeCoreSelection).toBeNull();
    expect(byId("enemy-a").normalCoreCount).toBe(0);
    expect(byId("enemy-b").normalCoreCount).toBe(1);
    expect(player(resolved, BOB).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "enemy-a",
    });
    expect(player(resolved, BOB).reserveNormalCoreCount).toBe(
      player(state, BOB).reserveNormalCoreCount + 2
    );
    expect(resolved.log).toContain(
      "effect:repeat-activation:alice-c03:1:0:iter=1/1"
    );
  });

  it("アタック時: core_move_amount_modifier は2体同時指定全体へ1回だけ加算し、追加分を分配 pending にする", () => {
    const src = createCardInstance(c, {
      instanceId: "alice-c03",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = card("BSKB01-C01");
    const enemyA = createCardInstance(targetDef, {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyB = createCardInstance(targetDef, {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, enemyA, enemyB],
    });
    const modifier: ContinuousEffect = {
      effectId: "test-c03-core-move-bonus",
      sourceInstanceId: "alice-c03",
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "core_move_amount_modifier",
      modifierAmount: 2,
      metadata: { coreMoveAmountScope: "self_player_spirits" },
    };
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      activeContinuousEffects: [...base.activeContinuousEffects, modifier],
    };

    const pending = executeEffect({
      chainId: "test:bskb01-cards:1884",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "alice-c03",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      targetInstanceIds: ["enemy-a", "enemy-b"],
    });

    expect(pending.pendingCoreShootSelection).toMatchObject({
      actingPlayerId: ALICE,
      totalAmount: 4,
      mandatoryTargetInstanceIds: ["enemy-a", "enemy-b"],
    });
    const action = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find((candidate) => candidate.kind === "resolve_pending_core_shoot");
    expect(action).toMatchObject({
      totalAmount: 4,
      mandatoryTargetInstanceIds: ["enemy-a", "enemy-b"],
    });

    const after = applyLegalAction({
      state: pending,
      action: action!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      coreShootDistribution: { "enemy-a": 1, "enemy-b": 3 },
    }).state;

    const byId = (id: string) =>
      after.cardInstances.find((candidate) => candidate.instanceId === id)!;
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(byId("enemy-a").normalCoreCount).toBe(0);
    expect(byId("enemy-b").normalCoreCount).toBe(2);
    expect(player(after, BOB).reserveNormalCoreCount).toBe(
      player(state, BOB).reserveNormalCoreCount + 4
    );
    expect(
      after.log.filter((line) =>
        line.startsWith("effect:core_move_amount_modifier:applied:")
      )
    ).toEqual([
      "effect:core_move_amount_modifier:applied:player-1:+2:base=2:target_group",
    ]);
  });
});

describe("BSKB01-C02 水兵ワドルディ", () => {
  const c = card("BSKB01-C02");
  it("召喚時デッキ3枚オープン鋼騎士/ハルバード/ギャラクシア合計2枚まで + Lv2 紫シンボル2追加", () => {
    expect(c.effects).toHaveLength(3);
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.timing).toEqual({
      kind: "phase",
      step: "main",
      whose: "self",
      subPhase: "end",
    });

    const reveal = c.effects![1]!.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(3);
      expect(reveal.picks[0]).toMatchObject({ count: 2 });
      expect(reveal.remainder).toBe("trash");
    }

    const symbols = c.effects![2]!;
    expect(symbols.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(symbols.steps.map((s) => s.action)).toEqual([
      {
        kind: "symbol_add",
        target: { kind: "self" },
        symbol: "purple",
        duration: { scope: "while_on_field" },
      },
      {
        kind: "symbol_add",
        target: { kind: "self" },
        symbol: "purple",
        duration: { scope: "while_on_field" },
      },
    ]);
  });
});

describe("BSKB01-M02 [伝説の騎士]ギャラクティックナイト", () => {
  const c = card("BSKB01-M02");
  it("系統追加 / 条件付き自己召喚 / ライフ1化連動 / アタック時2体デッキ下+残置抑止", () => {
    expect(c.effects).toHaveLength(4);
    expect(c.effects![0]!.steps[0]!.action).toMatchObject({
      kind: "override_properties",
      properties: { addTribes: ["鋼騎士"] },
    });
    const selfSummon = c.effects![1]!;
    expect(selfSummon.stub).toBeUndefined();
    expect(selfSummon.executionMode).toBe("optional");
    expect(selfSummon.timingScope).toEqual({
      player: "self",
      period: "main",
    });
    expect(selfSummon.condition).toEqual([
      { kind: "count_value", player: "self", min: 9 },
      {
        kind: "field_has",
        player: "self",
        category: ["spirit"],
        cardNames: [{ contains: "メタナイト" }],
        requiredKeywordTags: ["contract"],
        includeAdventSource: true,
      },
    ]);
    expect(selfSummon.timing).toEqual({ kind: "continuous" });
    expect(selfSummon.steps[0]!.action).toEqual({
      kind: "summon",
      normalActionPermission: true,
      normalActionDeclarationSteps: [
        {
          id: "count-to-zero",
          action: {
            kind: "count_decrease",
            player: "self",
            amount: { source: { kind: "count_value", player: "self" } },
          },
        },
        {
          action: {
            kind: "count_decrease",
            player: "opponent",
            amount: {
              source: {
                kind: "step_numeric_amount",
                stepId: "count-to-zero",
              },
              divisor: 2,
            },
          },
          connector: "conditional_result",
        },
      ],
      target: { kind: "self" },
      costModifier: "free",
    });

    const lifeLink = c.effects![2]!;
    expect(lifeLink.stub).toBeUndefined();
    expect(lifeLink.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "life", player: "self" },
      to: { kind: "reserve", player: "self" },
    });
    expect(lifeLink.steps[1]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "void", player: "opponent" },
    });

    const deckBottom = c.effects![3]!;
    expect(deckBottom.timing).toEqual({ kind: "card_event", event: "attack" });
    const action = deckBottom.steps[0]!.action;
    expect(action.kind).toBe("send_to_deck");
    if (action.kind === "send_to_deck" && "filter" in action.target) {
      expect(action.position).toBe("bottom");
      expect(action.pierceCannotLeaveField).toBe(true);
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.count).toEqual({ min: 0, max: 2 });
    }
    expect(deckBottom.stub).toBeUndefined();
  });

  function makeGalacticKnightHandSummonState(options?: {
    countValue?: number;
    reserveNormalCoreCount?: number;
    opponentCountValue?: number;
    contractDefinition?: CardDefinition;
  }): {
    state: GameState;
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
  } {
    const contractDef = options?.contractDefinition ?? card("BSKB01-CX01");
    const localMap = new Map(cardNoMap);
    localMap.set(contractDef.cardNo, contractDef);
    const source = createCardInstance(c, {
      instanceId: "galactic-knight-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const metaknight = createCardInstance(contractDef, {
      instanceId: "contract-metaknight",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, metaknight],
      playerOverrides: [
        {
          countValue: options?.countValue ?? 10,
          reserveNormalCoreCount: options?.reserveNormalCoreCount ?? 1,
          handCount: 1,
        },
        { countValue: options?.opponentCountValue ?? 8 },
      ],
    });
    return {
      state: { ...base, activePlayerId: ALICE, step: "main" },
      getCardDefinitionById: (id: string) => localMap.get(id),
    };
  }

  function makeConditionalCostSelfSummonDefinition(options: {
    cardNo: string;
    summonAction: CardDefinition["effects"][number]["steps"][number]["action"];
  }): CardDefinition {
    return {
      cardNo: options.cardNo,
      name: options.cardNo,
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["purple"],
      textLines: [
        "自分のメインステップに、自分のカウント-1することで、このカードを召喚できる。",
      ],
      keywordTags: [],
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          timingScope: { player: "self", period: "main" },
          applicability: { zone: "hand" },
          steps: [
            {
              action: { kind: "count_decrease", player: "self", amount: 1 },
            },
            {
              connector: "conditional_cost",
              action: options.summonAction,
            },
          ],
        },
      ],
    };
  }

  function galacticKnightActions(
    state: GameState,
    getCardDefinitionById: (id: string) => CardDefinition | undefined,
    actingPlayerId = ALICE
  ) {
    return getLegalActions({
      state,
      actingPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredHandActivatedEffectActions,
      getRegisteredTriggeredEffectActions,
    });
  }

  function findGalacticKnightSummonAction(
    state: GameState,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) {
    return galacticKnightActions(state, getCardDefinitionById).find(
      (action) =>
        action.kind === "summon" &&
        action.sourceInstanceId === "galactic-knight-hand" &&
        action.summonPermissionEffectIndex === 1
    );
  }

  function applyGalacticKnightAction(options: {
    state: GameState;
    action: Parameters<typeof applyLegalAction>[0]["action"];
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
    enterFieldCorePlacements?: { kind: "reserve_normal"; amount: number }[];
  }): GameState {
    return applyLegalAction({
      state: options.state,
      action: options.action,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredHandActivatedEffectActions,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      ...(options.enterFieldCorePlacements !== undefined
        ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
        : {}),
    }).state;
  }

  function findSyntheticHandEffectAction(options: {
    definition: CardDefinition;
    reserveNormalCoreCount: number;
    trashNormalCoreCount?: number;
    includeEffectSummonTax?: boolean;
  }) {
    const localMap = new Map(cardNoMap);
    localMap.set(options.definition.cardNo, options.definition);
    const getCardDefinitionById = (id: string) => localMap.get(id);
    const source = createCardInstance(options.definition, {
      instanceId: "synthetic-hand-self-summon",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const taxSource = options.includeEffectSummonTax
      ? createCardInstance(card("BSTH02-C02"), {
          instanceId: "effect-summon-tax",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        })
      : undefined;
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: taxSource ? [source, taxSource] : [source],
      playerOverrides: [
        {
          countValue: 1,
          reserveNormalCoreCount: options.reserveNormalCoreCount,
          trashNormalCoreCount: options.trashNormalCoreCount ?? 0,
          handCount: 1,
        },
        {},
      ],
    });
    const state = rebuildContinuousEffectsFromField(
      { ...base, activePlayerId: ALICE, step: "main" },
      getCardDefinitionById
    );
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredHandActivatedEffectActions: buildHandActivatedEffectLookup([
        options.definition,
      ]),
    });
    return actions.find(
      (action) =>
        action.kind === "use_hand_card_effect" &&
        action.sourceInstanceId === "synthetic-hand-self-summon" &&
        action.effectIndex === 0
    );
  }

  it("BSKB01-M02: 通常召喚宣言時にカウントを0にして相手カウントを減らし、その後にstackを開く", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      countValue: 10,
      reserveNormalCoreCount: 1,
      opponentCountValue: 8,
    });

    const summonAction = findGalacticKnightSummonAction(
      state,
      getCardDefinitionById
    );
    expect(summonAction).toMatchObject({
      kind: "summon",
      fixedPaymentCost: 0,
      finalCost: 0,
      summonPermissionEffectIndex: 1,
    });
    const declared = applyGalacticKnightAction({
      state,
      action: summonAction!,
      getCardDefinitionById,
    });

    expect(
      declared.cardInstances.find(
        (x) => x.instanceId === "galactic-knight-hand"
      )
    ).toMatchObject({
      zone: "in_use",
      normalCoreCount: 0,
    });
    expect(declared.window).toBe("stack");
    expect(declared.stackWindow?.priorityPlayerId).toBe(BOB);
    expect(declared.pendingEnterFieldPlacement).toBeNull();
    expect(player(declared, ALICE).countValue).toBe(0);
    expect(player(declared, ALICE).reserveNormalCoreCount).toBe(1);
    expect(player(declared, ALICE).handCount).toBe(0);
    expect(player(declared, BOB).countValue).toBe(3);
    expect(declared.log).toContain("effect:count_decrease:player-1:10");
    expect(declared.log).toContain("effect:count_decrease:player-2:5");

    const pass = galacticKnightActions(
      declared,
      getCardDefinitionById,
      BOB
    ).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterStack = applyGalacticKnightAction({
      state: declared,
      action: pass!,
      getCardDefinitionById,
    });
    expect(afterStack.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "galactic-knight-hand"
    );
    expect(
      afterStack.cardInstances.find(
        (x) => x.instanceId === "galactic-knight-hand"
      )?.zone
    ).toBe("in_use");

    const placement = galacticKnightActions(
      afterStack,
      getCardDefinitionById
    ).find((action) => action.kind === "resolve_pending_enter_field_placement");
    expect(placement).toBeDefined();
    const after = applyGalacticKnightAction({
      state: afterStack,
      action: placement!,
      getCardDefinitionById,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
    expect(
      after.cardInstances.find((x) => x.instanceId === "galactic-knight-hand")
    ).toMatchObject({
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(0);
  });

  it("BSKB01-M02: 契約煌臨の同名メタナイトは自己召喚条件の契約スピリット扱いにしない", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      contractDefinition: card("BSKB01-M01"),
    });

    expect(
      findGalacticKnightSummonAction(state, getCardDefinitionById)
    ).toBeUndefined();
    expect(player(state, ALICE).countValue).toBe(10);
    expect(player(state, BOB).countValue).toBe(8);
  });

  it("BSKB01-M02: 維持コアを置けない場合は通常召喚を宣言できず、宣言コストも支払わない", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      countValue: 9,
      reserveNormalCoreCount: 0,
      opponentCountValue: 8,
    });

    expect(
      findGalacticKnightSummonAction(state, getCardDefinitionById)
    ).toBeUndefined();
    expect(player(state, ALICE).countValue).toBe(9);
    expect(player(state, ALICE).reserveNormalCoreCount).toBe(0);
    expect(player(state, ALICE).handCount).toBe(1);
    expect(player(state, BOB).countValue).toBe(8);
  });

  it("BSKB01-M02: 維持コアを置けない場合は手札起動 legal action も出ない", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      countValue: 10,
      reserveNormalCoreCount: 0,
      opponentCountValue: 8,
    });

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredHandActivatedEffectActions,
    });

    expect(
      actions.find(
        (action) =>
          action.kind === "summon" &&
          action.sourceInstanceId === "galactic-knight-hand" &&
          action.summonPermissionEffectIndex === 1
      )
    ).toBeUndefined();
  });

  it("BSKB01-M02: Q54通常召喚は効果召喚限定の追加コストを受けない", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      countValue: 10,
      reserveNormalCoreCount: 1,
      opponentCountValue: 8,
    });
    const taxSource = createCardInstance(card("BSTH02-C02"), {
      instanceId: "letty-tax",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const withTax = rebuildContinuousEffectsFromField(
      {
        ...state,
        cardInstances: [...state.cardInstances, taxSource],
      },
      getCardDefinitionById
    );

    expect(
      withTax.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "additional_cost"
      )
    ).toBe(true);

    const actions = getLegalActions({
      state: withTax,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredHandActivatedEffectActions,
    });

    expect(
      actions.find(
        (action) =>
          action.kind === "summon" &&
          action.sourceInstanceId === "galactic-knight-hand" &&
          action.summonPermissionEffectIndex === 1
      )
    ).toBeDefined();
  });

  it("rules-core: zone省略の costModifier free 自己召喚も効果召喚追加コストを legal gate で見る", () => {
    const definition = makeConditionalCostSelfSummonDefinition({
      cardNo: "TEST-HAND-SELF-SUMMON-FREE-NO-ZONE",
      summonAction: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
    });

    expect(
      findSyntheticHandEffectAction({
        definition,
        reserveNormalCoreCount: 1,
        includeEffectSummonTax: true,
      })
    ).toBeUndefined();
  });

  it("rules-core: target self 召喚の trashCoreMax は維持コア供給として legal gate で数えない", () => {
    const definition = makeConditionalCostSelfSummonDefinition({
      cardNo: "TEST-HAND-SELF-SUMMON-TRASH-CORE-MAX",
      summonAction: {
        kind: "summon",
        target: { kind: "self", zone: "hand" },
        costModifier: "free",
        trashCoreMax: 1,
      },
    });

    expect(
      findSyntheticHandEffectAction({
        definition,
        reserveNormalCoreCount: 0,
        trashNormalCoreCount: 1,
      })
    ).toBeUndefined();
  });

  it("BSKB01-M02: 自分のメインステップにだけQ54通常召喚 legal action が出る", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      countValue: 10,
      reserveNormalCoreCount: 1,
    });

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions,
      getRegisteredHandActivatedEffectActions,
    });

    expect(
      actions.find(
        (action) =>
          action.kind === "summon" &&
          action.sourceInstanceId === "galactic-knight-hand" &&
          action.summonPermissionEffectIndex === 1
      )
    ).toBeDefined();
  });

  it("BSKB01-M02: メイン以外と相手メインではQ54通常召喚 actionが出ない", () => {
    const { state, getCardDefinitionById } = makeGalacticKnightHandSummonState({
      countValue: 10,
      reserveNormalCoreCount: 1,
    });
    const findGalacticKnightAction = (candidate: GameState) =>
      getLegalActions({
        state: candidate,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions,
        getRegisteredHandActivatedEffectActions,
      }).find(
        (action) =>
          action.kind === "summon" &&
          action.sourceInstanceId === "galactic-knight-hand" &&
          action.summonPermissionEffectIndex === 1
      );

    expect(
      findGalacticKnightAction({ ...state, step: "attack" })
    ).toBeUndefined();
    expect(
      findGalacticKnightAction({ ...state, activePlayerId: BOB })
    ).toBeUndefined();
  });

  it("BSKB01-M02: アタック時に自分のライフを1へ下げ、置いたコア数だけ相手ライフをボイドへ置く", () => {
    const source = createCardInstance(c, {
      instanceId: "galactic-knight",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, lifeNormalCoreCount: 4, reserveNormalCoreCount: 3 }
          : { ...p, lifeNormalCoreCount: 5 }
      ),
    };

    const after = executeEffect({
      chainId: "test:bskb01-cards:2535",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "galactic-knight",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    expect(after.pendingLifeCoreSelection).toBeNull();
    expect(player(after, ALICE).lifeNormalCoreCount).toBe(1);
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(6);
    expect(player(after, BOB).lifeNormalCoreCount).toBe(2);
    expect(player(after, BOB).voidNormalCoreCount).toBe(
      player(state, BOB).voidNormalCoreCount + 3
    );
    expect(after.log).toContain(
      "effect:core_move:life:player-1->reserve:player-1:3"
    );
    expect(after.log).toContain(
      "effect:core_move:life:player-2->void:player-2:3"
    );
  });

  it("BSKB01-M02: ライフにソウルコアがある場合も総ライフ1個になる量を参照する", () => {
    const source = createCardInstance(c, {
      instanceId: "galactic-knight-with-soul-life",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
      playerOverrides: [{ soulCoreLocation: { kind: "life" } }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, lifeNormalCoreCount: 4, reserveNormalCoreCount: 3 }
          : { ...p, lifeNormalCoreCount: 5 }
      ),
    };

    const pending = executeEffect({
      chainId: "test:bskb01-cards:2582",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "galactic-knight-with-soul-life",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    expect(pending.pendingLifeCoreSelection).toMatchObject({
      actingPlayerId: ALICE,
      totalAmount: 4,
    });
    const action = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: pending,
      action: action!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      lifeCorePartitionChoice: { normalChosen: 4, soulChosen: 0 },
    }).state;

    expect(after.pendingLifeCoreSelection).toBeNull();
    expect(player(after, ALICE).lifeNormalCoreCount).toBe(0);
    expect(player(after, ALICE).lifeSoulCoreCount).toBe(1);
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(7);
    expect(player(after, BOB).lifeNormalCoreCount).toBe(1);
    expect(player(after, BOB).voidNormalCoreCount).toBe(
      player(state, BOB).voidNormalCoreCount + 4
    );
  });
});

describe("BSKB01-R01 アックスナイト＆ジャベリンナイト＆メイスナイト＆トライデントナイト", () => {
  const c = card("BSKB01-R01");
  it("手札起動（自己＋メタナイト破棄→コア除去効果+2）/ 召喚時3ドロー→3破棄 / Lv2アタック時トラッシュ鋼騎士サーチ", () => {
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(
      c.effects![0]!.steps.some(
        (s) => s.action.kind === "core_move_amount_modifier"
      )
    ).toBe(true);

    const summon = c.effects![1]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 3 });
    expect(summon.steps[1]!.action).toMatchObject({
      kind: "discard",
      count: { min: 0, max: 3 },
    });

    const atk = c.effects![2]!;
    expect(atk.condition).toContainEqual({ kind: "min_level", value: 2 });
    expect(atk.steps[0]!.action).toMatchObject({
      kind: "search_zone",
      zone: "trash",
      destination: "hand",
      filter: { tribes: ["鋼騎士"] },
    });
  });
});

describe("BSKB01-R03 宝剣ギャラクシア", () => {
  const c = card("BSKB01-R03");
  it("召喚時2ドロー→煌臨中なら相手コア1個リザーブ / 合体中このスピリットの効果で移動する相手コアはトラッシュへ強制置換 / 合体中アタック時デッキ2破棄→選んだ1枚のコスト3につきカウント+1", () => {
    const summon = c.effects![0]!;
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 2 });
    expect(summon.stub).toBeUndefined();
    // その後、煌臨中の自分のスピリットがいるとき (field_has adventState) 相手フィールドのコア1個をリザーブへ。
    const coreStep = summon.steps[1]!;
    expect(coreStep.condition).toEqual([
      { kind: "field_has", player: "self", adventState: "advented" },
    ]);
    expect(coreStep.executionMode).toBe("optional");
    expect(coreStep.action).toEqual({
      kind: "core_move",
      from: { kind: "field", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    });

    const combinedCont = c.effects![1]!;
    expect(combinedCont.applicability).toEqual({ combined: true });
    expect(combinedCont.stub).toBeUndefined();
    expect(combinedCont.steps[0]!.action).toMatchObject({
      kind: "core_move_destination_replacement",
      fromOwner: "opponent",
      toZone: "trash",
    });

    // 裁定(A)1枚選択型 (needs-ruling.jsonl BSKB01-R03 resolved 2026-07-29):
    // 破棄した(最大2枚の)中から1枚を選び、その1枚のコストのみを3で割ってカウント+1。
    const combinedAtk = c.effects![2]!;
    expect(combinedAtk.applicability).toEqual({ combined: true });
    expect(combinedAtk.stub).toBeUndefined();
    expect(combinedAtk.steps[0]!.id).toBe("mill");
    expect(combinedAtk.steps[0]!.action).toMatchObject({
      kind: "discard",
      fromZone: "deck",
      count: { min: 0, max: 2 },
    });
    expect(combinedAtk.steps[1]!.id).toBe("selectOne");
    expect(combinedAtk.steps[1]!.targetSelectionTiming).toBe("on_step");
    expect(combinedAtk.steps[1]!.action).toEqual({
      kind: "noop",
      target: {
        kind: "filter",
        player: "self",
        zone: "trash",
        filter: {},
        count: { min: 0, max: 1 },
        stepId: "mill",
      },
    });
    expect(combinedAtk.steps[2]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: {
        source: {
          kind: "cost_from_ref",
          stepId: "selectOne",
          costBasis: "printed",
        },
        divisor: 3,
      },
    });
    const battleImmediate = getRegisteredBattleImmediateEffectActions(
      "BSKB01-R03"
    )?.find((registration) => registration.effectIndex === 2);
    expect(battleImmediate?.targetGroups ?? []).not.toContainEqual(
      expect.objectContaining({ targetStepId: "selectOne" })
    );
  });

  it("合体中アタック時: デッキ2枚破棄→選んだ1枚のコストだけをカウント+1に反映し、既存トラッシュの他カードは候補に入らない", () => {
    // R03 自身は printedCategory:"brave"。applicability.combined:true は発動元
    // (ブレイヴ自身の instance) の attachedToInstanceId で判定するため、host スピリットに
    // 合体した状態を組む (bsft01-cards.test.ts 同型 precedent)。
    const hostSpirit = createCardInstance(card("BSKB01-M02"), {
      instanceId: "combine-host-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["galaxia-brave"],
      cores: 3,
    });
    const host = createCardInstance(c, {
      instanceId: "galaxia-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "combine-host-spirit",
      cores: 1,
    });
    // 既にトラッシュにある無関係カード（コスト7）。選択候補に混ざってはいけない。
    const preexistingTrash = createCardInstance(card("BSKB01-M02"), {
      instanceId: "preexisting-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    // デッキ上から2枚破棄される。1枚目=cost7, 2枚目=cost3。
    const deckTop = createCardInstance(card("BSKB01-M02"), {
      instanceId: "deck-top-cost7",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const deckSecond = createCardInstance(card("BSKB01-C02"), {
      instanceId: "deck-second-cost3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    expect(card("BSKB01-M02").cost).toBe(7);
    expect(card("BSKB01-C02").cost).toBe(3);

    const base: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          hostSpirit,
          host,
          preexistingTrash,
          deckTop,
          deckSecond,
        ],
      }),
      players: createEmptyGameState({ playerIds: [ALICE, BOB] }).players.map(
        (p) => (p.id === ALICE ? { ...p, countValue: 0, deckCount: 2 } : p)
      ),
    };

    const afterMillPending = executeEffect({
      chainId: "test:bskb01-cards:2783",
      state: base,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    // discard count:{min:0,max:2} (デッキ) は 0..2 枚の任意選択ゾーン選択を開く
    // (native-action-registry.ts の discard ハンドラ + executeDiscardHand の
    // isDeckMill+optionalUpTo 拡張、BSKB01-R03 で新規発見・修正した基盤ギャップ)。
    // actionKind は executeDiscardHand の内部種別 (hand 由来と共通、sourceZone で判別)。
    expect(afterMillPending.pendingZoneSelection).toMatchObject({
      actionKind: "discard_hand",
      sourceZone: "deck",
      maxCount: 2,
      canSkip: true,
    });
    expect(
      afterMillPending.pendingZoneSelection!.candidateCardInstanceIds.sort()
    ).toEqual(["deck-second-cost3", "deck-top-cost7"].sort());
    const afterMill = applyLegalAction({
      state: afterMillPending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["deck-top-cost7", "deck-second-cost3"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(
      afterMill.cardInstances.find((x) => x.instanceId === "deck-top-cost7")
    ).toMatchObject({ zone: "trash" });
    expect(
      afterMill.cardInstances.find((x) => x.instanceId === "deck-second-cost3")
    ).toMatchObject({ zone: "trash" });

    // ここから「破棄した中の1枚を選ぶ」新規 DSL 機能 (TargetSpec.kind:"filter".stepId)
    // の検証。トラッシュには今回の2枚に加え、無関係な既存カード(preexisting-trash)も
    // 混在した実盤面 (afterMill) を使い、stepId 絞り込みが正しく機能することを直接示す。
    const mockStepContext = createStepExecutionContext(afterMill);
    recordStepResult(mockStepContext, {
      stepId: "mill",
      affectedCardInstanceIds: ["deck-top-cost7", "deck-second-cost3"],
      succeeded: true,
    });
    const candidates = resolveTargetSpec({
      state: afterMill,
      targetSpec: {
        kind: "filter",
        player: "self",
        zone: "trash",
        filter: {},
        count: { min: 0, max: 1 },
        stepId: "mill",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: host.instanceId,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      stepContext: mockStepContext,
      // count 自動解決 (range→min=0) をスキップし、候補プールそのものを取得する。
      returnFullPool: true,
    });
    // 候補は今回破棄した2枚だけ（既存トラッシュの1枚は候補に混ざらない）。
    expect(candidates.map((card) => card.instanceId).sort()).toEqual(
      ["deck-second-cost3", "deck-top-cost7"].sort()
    );

    // 「選んだ1枚のコストのみ」を count_increase に反映する2ステップ (selectOne→count_increase)
    // を、実際の DSL 実行 (executeEffect) で回して盤面変化 (countValue) を検証する。
    // initialStepResults で「mill」ステップの結果を事前注入し、targetInstanceIds で
    // 「deck-top-cost7 (コスト7) を選んだ」ことにする。
    const gainEffect: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "main" },
      steps: [c.effects![2]!.steps[1]!, c.effects![2]!.steps[2]!],
    };
    const afterGainPending = executeEffect({
      chainId: "test:bskb01-cards:2858",
      state: afterMill,
      effect: gainEffect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      initialStepResults: [
        {
          stepId: "mill",
          affectedCardInstanceIds: ["deck-top-cost7", "deck-second-cost3"],
          succeeded: true,
        },
      ],
    });
    const selectPending = afterGainPending.pendingStepOptionalTargetSelection!;
    expect(selectPending).toMatchObject({
      targetStepId: "selectOne",
      requiredTargetCount: 0,
      maxTargetCount: 1,
    });
    expect(selectPending.candidateInstanceIds.sort()).toEqual(
      ["deck-second-cost3", "deck-top-cost7"].sort()
    );
    const afterGain = applyLegalAction({
      state: afterGainPending,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${selectPending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: selectPending.actingPlayerId,
        pendingId: selectPending.pendingId,
        sourceInstanceId: selectPending.sourceInstanceId,
        sourceDefinitionId: selectPending.sourceDefinitionId,
        effectIndex: selectPending.effectIndex,
        stepIndex: selectPending.stepIndex,
        requiredTargetCount: selectPending.requiredTargetCount,
        maxTargetCount: selectPending.maxTargetCount,
        candidateTargetInstanceIds: selectPending.candidateInstanceIds,
      },
      targetInstanceIds: ["deck-top-cost7"],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    // cost7 → floor(7/3) = 2。
    expect(player(afterGain, ALICE).countValue).toBe(2);
    expect(afterGain.pendingStepOptionalTargetSelection).toBeNull();
    // 選ばれたカードはトラッシュのまま（移動していない、cost_from_ref は参照のみ）。
    expect(
      afterGain.cardInstances.find((x) => x.instanceId === "deck-top-cost7")
    ).toMatchObject({ zone: "trash" });
  });

  it.each(["deck", "trash"] as const)(
    "[board] BSKB01-R03 の任意デッキ破棄は候補生成・確定時に現在のゾーンで耐性を判定する（%s 耐性）",
    (protectedZone) => {
      const hostSpirit = createCardInstance(card("BSKB01-C01"), {
        instanceId: `r03-host-spirit-${protectedZone}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores: 3,
      });
      const host = createCardInstance(c, {
        instanceId: `r03-host-${protectedZone}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: hostSpirit.instanceId,
        cores: 1,
      });
      const deckCards = ["first", "second"].map((suffix) =>
        createCardInstance(card("BSKB01-C02"), {
          instanceId: `r03-deck-${protectedZone}-${suffix}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const empty = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [hostSpirit, host, ...deckCards],
      });
      const base: GameState = {
        ...empty,
        players: empty.players.map((p) =>
          p.id === ALICE ? { ...p, deckCount: deckCards.length } : p
        ),
      };
      const immunity: ContinuousEffect = {
        effectId: `r03-${protectedZone}-immunity`,
        sourceInstanceId: host.instanceId,
        sourceDefinitionId: c.cardNo,
        actingPlayerId: ALICE,
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "defense_immune",
        targetFilter: { player: "self", zone: [protectedZone] },
        immunityPlayerScope: "any",
      };
      const executeMill = (state: GameState) =>
        executeEffect({
          chainId: "test:bskb01-cards:2961",
          state,
          effect: c.effects![2]!,
          effectIndex: 2,
          sourceInstanceId: host.instanceId,
          actingPlayerId: ALICE,
          getCardDefinitionById: (id) => cardNoMap.get(id),
          getRegisteredTriggeredEffectActions,
        });

      // デッキ耐性だけが初期候補を除外する。移動先のトラッシュ耐性は先取りしない。
      const initiallyProtected = executeMill({
        ...base,
        activeContinuousEffects: [immunity],
      });
      if (protectedZone === "deck") {
        expect(initiallyProtected.pendingZoneSelection).toBeNull();
      } else {
        expect(
          initiallyProtected.pendingZoneSelection?.candidateCardInstanceIds
        ).toEqual(deckCards.map((card) => card.instanceId));
      }
      expect(
        initiallyProtected.cardInstances.filter((card) => card.zone === "deck")
      ).toHaveLength(2);

      // pending 表示後に耐性が発生しても、確定時は移動元のデッキで再評価する。
      const pending = executeMill(base);
      expect(
        pending.pendingZoneSelection?.candidateCardInstanceIds
      ).toHaveLength(2);
      const resolved = applyLegalAction({
        state: { ...pending, activeContinuousEffects: [immunity] },
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: deckCards.map((card) => card.instanceId),
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
      expect(resolved.pendingZoneSelection).toBeNull();
      const remainingDeckCount = protectedZone === "deck" ? 2 : 0;
      expect(
        resolved.cardInstances.filter((card) => card.zone === "deck")
      ).toHaveLength(remainingDeckCount);
      expect(
        resolved.cardInstances.filter((card) => card.zone === "trash")
      ).toHaveLength(2 - remainingDeckCount);
      expect(player(resolved, ALICE).deckCount).toBe(remainingDeckCount);
    }
  );

  it("[board] デッキ破棄の候補は先に『上から2枚』を確定し、耐性で先頭を飛ばして3枚目を混入させない", () => {
    const hostSpirit = createCardInstance(card("BSKB01-C01"), {
      instanceId: "r03-window-host-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const host = createCardInstance(c, {
      instanceId: "r03-window-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: hostSpirit.instanceId,
      cores: 1,
    });
    const [protectedTop, second, third] = ["top", "second", "third"].map(
      (suffix) =>
        createCardInstance(card("BSKB01-C02"), {
          instanceId: `r03-window-${suffix}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "deck",
        })
    );
    const empty = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostSpirit, host, protectedTop, second, third],
    });
    const base: GameState = {
      ...empty,
      players: empty.players.map((p) =>
        p.id === ALICE ? { ...p, deckCount: 3 } : p
      ),
      activeContinuousEffects: [
        {
          effectId: "r03-window-protected-top",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: c.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: protectedTop.instanceId,
          immunityPlayerScope: "any",
        },
      ],
    };
    const pending = executeEffect({
      chainId: "test:bskb01-cards:3060",
      state: base,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    // 3枚目はデッキ上2枚という効果の窓外。先頭が耐性で対象外でも繰り上がらない。
    expect(pending.pendingZoneSelection?.candidateCardInstanceIds).toEqual([
      second.instanceId,
    ]);
    const resolved = applyLegalAction({
      state: pending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: [second.instanceId],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === protectedTop.instanceId
      )
    ).toMatchObject({ zone: "deck" });
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === second.instanceId
      )
    ).toMatchObject({ zone: "trash" });
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === third.instanceId
      )
    ).toMatchObject({ zone: "deck" });
    expect(player(resolved, ALICE).deckCount).toBe(2);
  });

  it.each(["prevent", "redirect"] as const)(
    "[board] 選択待ち中に有効化されたデッキ破棄 %s を確定時に再評価する",
    (replacement) => {
      const hostSpirit = createCardInstance(card("BSKB01-C01"), {
        instanceId: `r03-dynamic-${replacement}-host-spirit`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores: 3,
      });
      const host = createCardInstance(c, {
        instanceId: `r03-dynamic-${replacement}-host`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: hostSpirit.instanceId,
        cores: 1,
      });
      const deckCards = ["first", "second"].map((suffix) =>
        createCardInstance(card("BSKB01-C02"), {
          instanceId: `r03-dynamic-${replacement}-${suffix}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const empty = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [hostSpirit, host, ...deckCards],
      });
      const pending = executeEffect({
        chainId: "test:bskb01-cards:3129",
        state: {
          ...empty,
          players: empty.players.map((p) =>
            p.id === ALICE ? { ...p, deckCount: deckCards.length } : p
          ),
        },
        effect: c.effects![2]!,
        effectIndex: 2,
        sourceInstanceId: host.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      });
      expect(pending.pendingZoneSelection).not.toBeNull();

      const replacementCard = createCardInstance(
        card(replacement === "prevent" ? "BSTH08.5-C21" : "BSTH05.5-X02"),
        {
          instanceId: `r03-dynamic-${replacement}-replacement`,
          // X02 は「相手への」破棄を差し替えるため、R03 を使う Alice の相手 Bob 側に置く。
          ownerPlayerId: replacement === "redirect" ? BOB : ALICE,
          controllerPlayerId: replacement === "redirect" ? BOB : ALICE,
          zone: replacement === "prevent" ? "set_aside" : "field",
          ...(replacement === "redirect" ? { cores: 5 } : {}),
        }
      );
      // C21 (手元) / X02 Lv2 (自分のアタックステップ) がこの時点で盤面に入った場合の
      // 継続効果。pending 作成時ではなく確定時にこの CE を live 評価することを検証する。
      const replacementCE: ContinuousEffect = {
        effectId: `r03-dynamic-${replacement}-ce`,
        sourceInstanceId: replacementCard.instanceId,
        sourceDefinitionId: replacementCard.definitionId,
        actingPlayerId: replacement === "redirect" ? BOB : ALICE,
        ...(replacement === "redirect"
          ? {
              timingScope: {
                player: "self" as const,
                period: "attack" as const,
              },
            }
          : {}),
        duration: {
          scope: replacement === "prevent" ? "while_in_set_aside" : "permanent",
        },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag:
          replacement === "prevent"
            ? "prevent_deck_discard"
            : "redirect_deck_discard_to_exclude",
        targetInstanceId: ALICE,
      };
      const withReplacement: GameState = {
        ...pending,
        activePlayerId: replacement === "redirect" ? BOB : ALICE,
        step: replacement === "redirect" ? "attack" : "main",
        cardInstances: [...pending.cardInstances, replacementCard],
        activeContinuousEffects: [replacementCE],
      };
      expect(
        withReplacement.activeContinuousEffects.some(
          (effect) =>
            effect.modifierTag ===
            (replacement === "prevent"
              ? "prevent_deck_discard"
              : "redirect_deck_discard_to_exclude")
        )
      ).toBe(true);

      const resolved = applyLegalAction({
        state: withReplacement,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: deckCards.map((card) => card.instanceId),
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
      expect(resolved.pendingZoneSelection).toBeNull();
      if (replacement === "prevent") {
        expect(
          resolved.cardInstances.filter((card) => card.zone === "deck")
        ).toHaveLength(2);
        expect(
          resolved.cardInstances.filter((card) => card.zone === "trash")
        ).toHaveLength(0);
        expect(player(resolved, ALICE).deckCount).toBe(2);
      } else {
        expect(
          resolved.cardInstances.filter((card) => card.zone === "deck")
        ).toHaveLength(0);
        expect(
          resolved.cardInstances.filter((card) => card.zone === "trash")
        ).toHaveLength(0);
        expect(
          resolved.cardInstances.filter(
            (card) => card.zone === "removed_from_game"
          )
        ).toHaveLength(2);
        expect(player(resolved, ALICE).deckCount).toBe(0);
      }
    }
  );

  it("[board] effect_controller が相手デッキを選ぶ pending は選択者でなくデッキ所有者の deckCount を減らす", () => {
    const source = createCardInstance(card("BSKB01-C01"), {
      instanceId: "r03-opponent-deck-discard-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const aliceDeckCards = ["first", "second", "third"].map((suffix) =>
      createCardInstance(card("BSKB01-C02"), {
        instanceId: `r03-opponent-deck-discard-alice-${suffix}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const bobDeckCards = ["first", "second"].map((suffix) =>
      createCardInstance(card("BSKB01-C02"), {
        instanceId: `r03-opponent-deck-discard-bob-${suffix}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, ...aliceDeckCards, ...bobDeckCards],
      playerOverrides: [{ deckCount: 3 }, { deckCount: 2 }],
    });
    const opponentDeckDiscard: NonNullable<CardDefinition["effects"]>[number] =
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "discard",
              player: "opponent",
              fromZone: "deck",
              selectionPlayer: "effect_controller",
              count: { min: 0, max: 2 },
            },
          },
        ],
      };
    const pending = executeEffect({
      chainId: "test:bskb01-cards:3276",
      state: base,
      effect: opponentDeckDiscard,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(pending.pendingZoneSelection).toMatchObject({
      actingPlayerId: ALICE,
      targetPlayerId: BOB,
      sourceZone: "deck",
    });

    const resolved = applyLegalAction({
      state: pending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: [bobDeckCards[0]!.instanceId],
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === bobDeckCards[0]!.instanceId
      )?.zone
    ).toBe("trash");
    expect(player(resolved, ALICE).deckCount).toBe(3);
    expect(player(resolved, BOB).deckCount).toBe(1);
  });
});

describe("BSKB01-X01 [英雄を討ち倒し者]メタナイト", () => {
  const c = card("BSKB01-X01");
  it("契約煌臨は adventData / OC(カウント7)煌臨アタック時に相手フィールドコア3までトラッシュ / バトル終了時 BP比較破壊", () => {
    // 『お互いのターン』契約煌臨 → adventData (main_and_flash) + count gate。
    expect(c.adventData).toMatchObject({
      adventVariant: "contract",
      adventTiming: "main_and_flash",
      soulCoreDest: "trash",
      adventCondition: { targetCategory: ["spirit"] },
    });
    expect(c.adventData!.adventCondition.minCost).toBeUndefined();
    expect(c.adventData!.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
    ]);

    const oc = c.effects![0]!;
    expect(oc.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 7,
    });
    expect(oc.usageLimit).toEqual({ kind: "per_instance", duration: "turn" });
    expect(oc.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "field", player: "opponent" },
      to: { kind: "trash", player: "opponent" },
      amount: { min: 0, max: 3 },
    });

    // バトル終了時の動的BP比較破壊 + 相手のみ破壊でライフコア除去（bp_compare_destroy +
    // self_state:"on_field" ゲート）。詳細挙動は bskb01-x01-bp-compare-battle-end.test.ts。
    const be = c.effects![1]!;
    expect(be.timing).toMatchObject({
      kind: "card_event",
      event: "attack",
      deferredTo: "battle_end",
    });
    expect(be.stub).toBeUndefined();
    expect(be.steps[0]!.action).toMatchObject({ kind: "bp_compare_destroy" });
    expect(be.steps[1]!.stepCondition).toMatchObject({
      kind: "all",
      conditions: expect.arrayContaining([
        {
          kind: "ref_leave_established",
          stepId: "bp-compare",
          subject: "source",
          leaveKind: "destroy",
          not: true,
        },
      ]),
    });
  });
});

describe("BSKB01-C04 戦艦ハルバード", () => {
  const c = card("BSKB01-C04");
  const metaknight = card("BSKB01-CX01");
  const targetMagic = card("BSGE01-C04");
  const stackResponder: CardDefinition = {
    cardNo: "TEST-STACK-RESPONDER",
    name: "stack responder",
    cost: 0,
    colors: ["purple"],
    category: "magic",
    levelDefs: [],
    effects: [
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  const accelTargetDef: CardDefinition = {
    cardNo: "TEST-ACCEL-TARGET",
    name: "accel target",
    cost: 0,
    colors: ["purple"],
    category: "spirit",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    accelData: {
      timing: "flash",
      cost: 0,
      reduction: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    },
  };

  function createHalberdBoard(
    targetStack: ActiveStack,
    extraCards: CardInstance[] = []
  ): GameState {
    const halberd = createCardInstance(c, {
      instanceId: "alice-halberd",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const meta = createCardInstance(metaknight, {
      instanceId: "alice-metaknight",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [halberd, meta, ...extraCards],
      }),
      step: "attack",
      window: "stack",
      stackWindow: {
        priorityPlayerId: ALICE,
        consecutivePassCount: 1,
        actingPlayerId: BOB,
        previousWindow: "none",
        stackResponseSourcePlayerId: BOB,
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: targetStack,
      },
    } as GameState;
  }

  function productionLookups(defs: readonly CardDefinition[] = ALL_CARDS) {
    const map = new Map<string, CardDefinition>(
      defs.map((def) => [def.cardNo, def])
    );
    return {
      getCardDefinitionById: (id: string) => map.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredMagicActions: buildMagicLookup(defs),
    };
  }

  function closeStackWindow(state: GameState, lookups = productionLookups()) {
    const closeWindow = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(closeWindow).toBeDefined();
    return applyLegalAction({
      state,
      action: closeWindow!,
      ...lookups,
    }).state;
  }

  function resolveHalberdTrigger(
    state: GameState,
    lookups = productionLookups()
  ) {
    const resolveHalberd = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-halberd" &&
        action.choiceIndex === undefined &&
        action.skipOnly !== true
    );
    expect(resolveHalberd).toBeDefined();
    return applyLegalAction({
      state,
      action: resolveHalberd!,
      ...lookups,
    }).state;
  }

  function passHalberdStack(
    state: GameState,
    lookups = productionLookups(),
    choiceIndex = 0,
    targetInstanceIds: string[] = []
  ) {
    const passHalberd = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passHalberd).toBeDefined();
    let current = applyLegalAction({
      state,
      action: passHalberd!,
      ...lookups,
    }).state;
    expect(current.pendingStepChoice).not.toBeNull();
    const choiceAction = getLegalActions({
      state: current,
      actingPlayerId: current.pendingStepChoice!.choosingPlayerId,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === choiceIndex
    );
    expect(choiceAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: choiceAction!,
      ...lookups,
    }).state;
    if (current.pendingEffectTargetSelection === null) {
      return current;
    }
    const resolvedTargetInstanceIds =
      targetInstanceIds.length > 0
        ? targetInstanceIds
        : current.pendingEffectTargetSelection.candidateInstanceIds.slice(
            0,
            current.pendingEffectTargetSelection.requiredTargetCount
          );
    const targetAction = getLegalActions({
      state: current,
      actingPlayerId: current.pendingEffectTargetSelection!.actingPlayerId,
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    return applyLegalAction({
      state: current,
      action: targetAction!,
      targetInstanceIds: resolvedTargetInstanceIds,
      ...lookups,
    }).state;
  }

  it("フラッシュでトークンを出す処理は put+core_move(count_area) / Lv2 無効化は effect_declaration negate と suppress_stack_source", () => {
    const tokenSummon = c.effects![0]!;
    expect(tokenSummon.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(tokenSummon.stub).toBeUndefined();
    expect(tokenSummon.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(tokenSummon.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
        includeSoulState: true,
        includeAdventSource: true,
      },
    ]);
    expect(tokenSummon.steps[0]!.action).toEqual({
      kind: "put",
      target: { kind: "from_token_pool", count: 1 },
      costModifier: "free",
      disableAutoReserveFieldCores: true,
    });
    expect(tokenSummon.steps[1]!.action).toEqual({
      kind: "core_move",
      from: { kind: "count_area", player: "self" },
      to: { kind: "ref", stepId: "c04-token-summon" },
      amount: 1,
    });

    const suppress = c.effects![1]!;
    expect(suppress.stub).toBeUndefined();
    expect(suppress.timing).toEqual({ kind: "continuous" });
    expect(suppress.applicability).toEqual({ level: { min: 2 } });
    expect(suppress.timingScope).toEqual({ player: "self", period: "attack" });
    expect(suppress.steps[0]!.action).toEqual({
      kind: "suppress_stack_source",
      target: "self",
      player: "opponent",
      duration: { scope: "while_on_field" },
      effectFilter: { effectIndex: [2, 3, 4] },
    });

    const magic = c.effects![2]!;
    expect(magic.stub).toBeUndefined();
    expect(magic.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "effect_declaration",
      triggerEffectActionKind: "magic",
      triggerEffectTiming: "flash",
    });
    const expectedBalCaptainCostChoice = [
      {
        label: "バル艦長を除外",
        action: {
          kind: "remove_from_game",
          target: {
            kind: "filter",
            player: "self",
            filter: {
              category: ["nexus"],
              cardName: { exact: "バル艦長" },
              minLevel: 2,
            },
            count: 1,
          },
        },
      },
    ];
    expect(magic.steps).toEqual([
      {
        id: "c04-negate-cost",
        action: { kind: "destroy", target: { kind: "self" } },
        choice: expectedBalCaptainCostChoice,
      },
      {
        action: { kind: "negate", negateTarget: "use" },
        connector: "conditional_cost",
      },
    ]);

    const accel = c.effects![3]!;
    expect(accel.stub).toBeUndefined();
    expect(accel.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "effect_declaration",
      triggerEffectActionKind: "accel",
    });
    expect(accel.steps[0]).toEqual({
      id: "c04-negate-cost",
      action: { kind: "destroy", target: { kind: "self" } },
      choice: expectedBalCaptainCostChoice,
    });
    expect(accel.steps[1]).toEqual({
      action: { kind: "negate", negateTarget: "effect" },
      connector: "conditional_cost",
    });

    const stackEffect = c.effects![4]!;
    expect(stackEffect.stub).toBeUndefined();
    expect(stackEffect.timing).toMatchObject({
      kind: "game_event",
      player: "opponent",
      event: "effect_declaration",
      triggerEffectTiming: "stack",
      triggerEffectActionKind: expect.arrayContaining(["magic"]),
    });
    expect(stackEffect.steps[0]).toEqual({
      id: "c04-negate-cost",
      action: { kind: "destroy", target: { kind: "self" } },
      choice: expectedBalCaptainCostChoice,
    });
    expect(stackEffect.steps[1]).toEqual({
      action: {
        kind: "negate",
        negateTarget: "effect",
        targetEffectTiming: "stack",
      },
      connector: "conditional_cost",
    });
  });

  it("[board] カウントエリアのコア1個でトークン「ヘビーロブスター」を出す。リザーブに余剰コアがあっても追加では置かれない", () => {
    const halberd = createCardInstance(c, {
      instanceId: "alice-halberd",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const meta = createCardInstance(metaknight, {
      instanceId: "alice-metaknight",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [halberd, meta],
        playerOverrides: [{ countValue: 1, reserveNormalCoreCount: 3 }],
      }),
      step: "main",
    };
    const tokenSummon = c.effects![0]!;
    const after = executeEffect({
      chainId: "test:bskb01-cards:3694",
      state,
      effect: tokenSummon,
      sourceInstanceId: "alice-halberd",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
    });
    const summoned = after.cardInstances.find(
      (card) => card.definitionId === "BSKB01-T01" && card.zone === "field"
    );
    expect(summoned).toBeDefined();
    expect(summoned!.normalCoreCount).toBe(1);
    expect(player(after, ALICE).countValue).toBe(0);
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(3);
  });

  it("[board] 神喰の保護カウントは戦艦ハルバード(系統:鋼騎士)のカウントエリア消費で使えない", () => {
    const halberd = createCardInstance(c, {
      instanceId: "alice-halberd",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const meta = createCardInstance(metaknight, {
      instanceId: "alice-metaknight",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [halberd, meta],
        playerOverrides: [{ countValue: 1, protectedCounts: { 神喰: 1 } }, {}],
      }),
      step: "main",
    };
    const tokenSummon = c.effects![0]!;
    const after = executeEffect({
      chainId: "test:bskb01-cards:3735",
      state,
      effect: tokenSummon,
      sourceInstanceId: "alice-halberd",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
    });
    const summoned = after.cardInstances.find(
      (card) => card.definitionId === "BSKB01-T01" && card.zone === "field"
    );
    expect(summoned).toBeDefined();
    expect(summoned!.normalCoreCount).toBe(0);
    expect(player(after, ALICE).countValue).toBe(1);
    expect(player(after, ALICE).protectedCounts).toEqual({ 神喰: 1 });
  });

  it("マジックの効果発揮前に公開誘発として解決し、破壊できたら対象効果を無効化する", () => {
    const magic = createCardInstance(targetMagic, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const deckCards = [0, 1, 2].map((i) =>
      createCardInstance(card("BSKB01-C01"), {
        instanceId: `bob-deck-${i}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      })
    );
    const targetStack: ActiveStack = {
      stackId: "stack:bob-magic",
      actionKind: "magic",
      chainId: "chain:bob-magic",
      actingPlayerId: BOB,
      cardInstanceId: magic.instanceId,
      cardDefinitionId: targetMagic.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const lookups = productionLookups();
    const state = createHalberdBoard(targetStack, [magic, ...deckCards]);

    const queued = closeStackWindow(state, lookups);
    expect(queued.pendingStackCascade?.waitForTriggeredEffects).toBe(true);
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "effect_declaration",
      relatedInstanceId: magic.instanceId,
      effectSourceInstanceId: magic.instanceId,
      effectActionKind: "magic",
    });

    const halberdStacked = resolveHalberdTrigger(queued, lookups);
    expect(halberdStacked.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );

    const after = passHalberdStack(halberdStacked, lookups);
    expect(after.pendingStackCascade).toBeNull();
    expect(after.stackWindow).toBeNull();
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "alice-halberd")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === BOB && ci.zone === "hand"
      )
    ).toHaveLength(0);
    expect(
      after.cardInstances.filter(
        (ci) => ci.ownerPlayerId === BOB && ci.zone === "deck"
      )
    ).toHaveLength(3);
    expect(after.log).toContain("magic:nullified:chain:bob-magic:bob-magic");
  });

  it("同じ発揮前イベントに複数のハルバードが反応しても、1枚目の無効化成立後は兄弟誘発を再キューしない", () => {
    const secondHalberd = createCardInstance(c, {
      instanceId: "alice-halberd-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const magic = createCardInstance(targetMagic, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const targetStack: ActiveStack = {
      stackId: "stack:bob-magic",
      actionKind: "magic",
      chainId: "chain:bob-magic",
      actingPlayerId: BOB,
      cardInstanceId: magic.instanceId,
      cardDefinitionId: targetMagic.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const lookups = productionLookups();
    const state = createHalberdBoard(targetStack, [secondHalberd, magic]);

    const queued = closeStackWindow(state, lookups);
    expect(queued.pendingTriggeredEffects).toHaveLength(1);

    const halberdStacked = resolveHalberdTrigger(queued, lookups);
    expect(halberdStacked.pendingTriggeredEffects).toHaveLength(0);
    expect(
      halberdStacked.log.some((entry) => entry.startsWith("trigger:requeued:"))
    ).toBe(false);

    const after = passHalberdStack(halberdStacked, lookups);
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "alice-halberd")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "alice-halberd-2")
        ?.zone
    ).toBe("field");
    expect(after.log).toContain("magic:nullified:chain:bob-magic:bob-magic");
  });

  it("アクセル/スタック効果も発揮前誘発で解決し、対象効果を無効化する", () => {
    const accelTarget = createCardInstance(accelTargetDef, {
      instanceId: "bob-accel-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
      cores: 0,
    });
    const stackTarget = createCardInstance(card("BSKB01-C01"), {
      instanceId: "bob-stack-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const stackMagicTarget = createCardInstance(targetMagic, {
      instanceId: "bob-stack-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
      cores: 0,
    });
    const cases: Array<{
      label: string;
      stack: ActiveStack;
      expectedActionKind: string;
      target: CardInstance;
      defs?: readonly CardDefinition[];
    }> = [
      {
        label: "accel",
        expectedActionKind: "accel",
        target: accelTarget,
        defs: [...ALL_CARDS, accelTargetDef],
        stack: {
          stackId: "stack:bob-accel",
          actionKind: "accel",
          chainId: "chain:bob-accel",
          actingPlayerId: BOB,
          cardInstanceId: accelTarget.instanceId,
          cardDefinitionId: accelTarget.definitionId,
          targetInstanceIds: [],
          chosenTiming: "flash",
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        } as ActiveStack,
      },
      {
        label: "stack-magic",
        expectedActionKind: "magic",
        target: stackMagicTarget,
        stack: {
          stackId: "stack:bob-stack-magic",
          actionKind: "magic",
          chainId: "chain:bob-stack-magic",
          actingPlayerId: BOB,
          cardInstanceId: stackMagicTarget.instanceId,
          cardDefinitionId: stackMagicTarget.definitionId,
          targetInstanceIds: [],
          targetEffectFilterTags: ["general"],
          reducedCost: 0,
          totalReduction: 0,
          chosenTiming: "stack",
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        } as ActiveStack,
      },
      {
        label: "stack-effect",
        expectedActionKind: "field_card_effect",
        target: stackTarget,
        stack: {
          stackId: "stack:bob-field-stack",
          actionKind: "field_card_effect",
          chainId: "chain:bob-field-stack",
          actingPlayerId: BOB,
          cardInstanceId: stackTarget.instanceId,
          cardDefinitionId: stackTarget.definitionId,
          targetInstanceIds: [],
          chosenTiming: "stack",
          suppressionEffectDescriptor: { effectIndex: 0 },
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        } as ActiveStack,
      },
    ];

    for (const testCase of cases) {
      const lookups = productionLookups(testCase.defs ?? ALL_CARDS);
      const state = createHalberdBoard(testCase.stack, [testCase.target]);
      const queued = closeStackWindow(state, lookups);
      expect(queued.pendingTriggeredEffects[0]).toMatchObject({
        eventKind: "effect_declaration",
        effectActionKind: testCase.expectedActionKind,
        relatedInstanceId: testCase.target.instanceId,
      });

      const halberdStacked = resolveHalberdTrigger(queued, lookups);
      const after = passHalberdStack(halberdStacked, lookups);
      expect(after.pendingStackCascade).toBeNull();
      expect(after.stackWindow).toBeNull();
      expect(
        after.cardInstances.find((ci) => ci.instanceId === "alice-halberd")
          ?.zone
      ).toBe("trash");
      expect(after.log.some((entry) => entry.includes(":nullified:"))).toBe(
        true
      );
    }
  });

  it("無効化済み stack には発揮前誘発を積まず、ハルバードの応答 stack source は抑止する", () => {
    const defs = [...ALL_CARDS, stackResponder];
    const lookups = productionLookups(defs);
    const responder = createCardInstance(stackResponder, {
      instanceId: "bob-stack-responder",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const target = createCardInstance(card("BSKB01-C01"), {
      instanceId: "bob-effect-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const targetStack = {
      stackId: "stack:bob-nullified",
      actionKind: "field_card_effect",
      chainId: "chain:bob-nullified",
      actingPlayerId: BOB,
      cardInstanceId: target.instanceId,
      cardDefinitionId: target.definitionId,
      targetInstanceIds: [],
      chosenTiming: "stack",
      suppressionEffectDescriptor: { effectIndex: 0 },
      isNullified: true,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    } as ActiveStack;
    const nullifiedState = createHalberdBoard(targetStack, [target, responder]);
    const afterNullified = closeStackWindow(nullifiedState, lookups);
    expect(afterNullified.pendingTriggeredEffects).toHaveLength(0);
    expect(afterNullified.pendingStackCascade).toBeNull();

    const liveState = createHalberdBoard(
      { ...targetStack, isNullified: false },
      [target, responder]
    );
    const queued = closeStackWindow(liveState, lookups);
    const halberdStacked = resolveHalberdTrigger(queued, lookups);
    const bobActions = getLegalActions({
      state: halberdStacked,
      actingPlayerId: BOB,
      ...lookups,
    });
    expect(bobActions.map((action) => action.kind)).toEqual(["pass_stack"]);
  });

  it("BSKB01-C05: Lv2 バル艦長を除外してハルバードの無効化コストを置換する", () => {
    const balCaptain = createCardInstance(card("BSKB01-C05"), {
      instanceId: "alice-bal-captain",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 2,
    });
    const magic = createCardInstance(targetMagic, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "in_use",
    });
    const targetStack: ActiveStack = {
      stackId: "stack:bob-magic-bal-cost",
      actionKind: "magic",
      chainId: "chain:bob-magic-bal-cost",
      actingPlayerId: BOB,
      cardInstanceId: magic.instanceId,
      cardDefinitionId: targetMagic.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const lookups = productionLookups();
    const state = createHalberdBoard(targetStack, [balCaptain, magic]);
    const queued = closeStackWindow(state, lookups);
    const resolveActions = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...lookups,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-halberd" &&
        action.skipOnly !== true
    );
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0]?.choiceIndex).toBeUndefined();
    expect(resolveActions[0]?.deferredChoiceIndexes).toEqual([0, 1]);

    const halberdStacked = resolveHalberdTrigger(queued, lookups);
    const after = passHalberdStack(halberdStacked, lookups, 1, [
      "alice-bal-captain",
    ]);
    expect(
      after.cardInstances.find((ci) => ci.instanceId === "alice-halberd")?.zone
    ).toBe("field");
    const balAfter = after.cardInstances.find(
      (ci) => ci.instanceId === "alice-bal-captain"
    );
    expect(balAfter?.zone).toBe("removed_from_game");
    expect(balAfter?.pendingLeaveKind).toBeNull();
    expect(after.pendingStackCascade).toBeNull();
    expect(after.stackWindow).toBeNull();
    expect(after.pendingEffectTargetSelection).toBeNull();
    expect(after.pendingStepChoice).toBeNull();
    expect(after.log).toContain(
      "magic:nullified:chain:bob-magic-bal-cost:bob-magic"
    );
  });

  it.each([
    ["magic", 2],
    ["magic", 4],
    ["accel", 2],
    ["accel", 4],
    ["stack-effect", 2],
    ["stack-effect", 4],
  ] as const)(
    "BSKB01-C05: %s の置換は Lvコスト+2 後の実効Lvで判定する（%iコア）",
    (kind, cores) => {
      const captain = createCardInstance(card("BSKB01-C05"), {
        instanceId: "alice-bal-captain",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores,
      });
      const levelCostSource = createCardInstance(card("BSKB01-M01"), {
        instanceId: "bob-level-cost-source",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        cores: 1,
      });
      const targetDef =
        kind === "accel"
          ? accelTargetDef
          : kind === "stack-effect"
            ? card("BSKB01-C01")
            : targetMagic;
      const target = createCardInstance(targetDef, {
        instanceId: "bob-effect-target",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: kind === "stack-effect" ? "field" : "in_use",
        cores: kind === "stack-effect" ? 1 : 0,
      });
      const targetStack: ActiveStack = {
        stackId: `stack:bob-${kind}-level-cost`,
        actionKind: kind === "stack-effect" ? "field_card_effect" : kind,
        chainId: `chain:bob-${kind}-level-cost`,
        actingPlayerId: BOB,
        cardInstanceId: target.instanceId,
        cardDefinitionId: targetDef.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        reducedCost: 0,
        totalReduction: 0,
        chosenTiming: kind === "stack-effect" ? "stack" : "flash",
        ...(kind === "stack-effect"
          ? { suppressionEffectDescriptor: { effectIndex: 0 } }
          : {}),
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      };
      const lookups = productionLookups(
        kind === "accel" ? [...ALL_CARDS, accelTargetDef] : ALL_CARDS
      );
      const before = createHalberdBoard(targetStack, [
        captain,
        levelCostSource,
        target,
      ]);
      // 実カード M01 の前段を受諾・対象確定後の入口から解決する。
      // 03a:111 のとおり各Lvの必要コア数に+2。
      const levelCostEffect = card("BSKB01-M01").effects![1]!;
      const withLevelCost = executeEffect({
        state: before,
        effect: {
          ...levelCostEffect,
          steps: [levelCostEffect.steps[0]!],
        },
        effectIndex: 1,
        sourceInstanceId: levelCostSource.instanceId,
        actingPlayerId: BOB,
        chainId: `test:captain-level-cost-${kind}-${cores}`,
        targetInstanceIds: [captain.instanceId],
        targetSelectionResolved: true,
        optionalExecuteResumeStepIndex: 0,
        ...lookups,
      });
      expect(
        getEffectiveLevel(
          withLevelCost,
          withLevelCost.cardInstances.find(
            (ci) => ci.instanceId === captain.instanceId
          )!,
          card("BSKB01-C05"),
          lookups.getCardDefinitionById
        )
      ).toBe(cores === 2 ? 1 : 2);

      const queued = closeStackWindow(withLevelCost, lookups);
      const stacked = resolveHalberdTrigger(queued, lookups);
      // 置換枝を選んでも、実効Lv1の艦長は対象にならず、対価未払いで無効化しない。
      const after = passHalberdStack(stacked, lookups, 1, [captain.instanceId]);
      expect(
        after.cardInstances.find((ci) => ci.instanceId === captain.instanceId)
          ?.zone
      ).toBe(cores === 2 ? "field" : "removed_from_game");
      expect(
        after.cardInstances.find((ci) => ci.instanceId === "alice-halberd")
          ?.zone
      ).toBe("field");
      expect(after.log.some((entry) => entry.includes(":nullified:"))).toBe(
        cores === 4
      );
      expect(after.pendingStackCascade).toBeNull();
      expect(after.stackWindow).toBeNull();
      expect(after.pendingStepChoice).toBeNull();
      expect(after.pendingEffectTargetSelection).toBeNull();
    }
  );
});

describe("BSKB01-C05 バル艦長", () => {
  const c = card("BSKB01-C05");

  function queueC05DestroyTrigger(
    sourceCardNo: string,
    cause: "effect_resolution" | "bp_compare" = "effect_resolution",
    leaveKind: "destroy" | "vanish" = "destroy"
  ) {
    const observer = createCardInstance(c, {
      instanceId: "alice-c05-observer",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const destroySource = createCardInstance(card(sourceCardNo), {
      instanceId: "alice-destroy-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-destroy-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [observer, destroySource, target],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: target.instanceId,
      kind: leaveKind,
      cause,
      chainId: `test-chain:bskb01-c05-${leaveKind}`,
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: destroySource.instanceId,
    });
    return collectAndQueueTriggerReactions({
      chainId: "test:bskb01-cards:4139",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
  }

  function buildC05BattleDestroyState() {
    const observer = createCardInstance(c, {
      instanceId: "alice-c05-observer",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const attacker = createCardInstance(card("BSKB01-C01"), {
      instanceId: "alice-steel-attacker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const blocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-battle-blocker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEntities: BattleEntity[] = [
      {
        entityId: "battle-attacker",
        memberInstanceIds: [attacker.instanceId],
        resolvedBp: 4000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
      {
        entityId: "battle-blocker",
        memberInstanceIds: [blocker.instanceId],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "blocking",
      },
    ];
    const activeAttack: ActiveAttack = {
      attackId: "attack:bskb01-c05-battle",
      primaryEntityId: "battle-attacker",
      participantEntityIds: ["battle-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "battle-attacker",
          blockedByEntityIds: ["battle-blocker"],
        },
      ],
      symbolResolutionOrder: ["battle-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [observer, attacker, blocker],
        playerOverrides: [{ countValue: 0 }, {}],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "declare_attack" as const,
      activeAttack,
      battleEntities,
    };
  }

  function resolveC05PendingTrigger(queued: GameState): GameState {
    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-c05-observer"
    );
    expect(resolve).toBeDefined();
    const stacked = applyLegalAction({
      state: queued,
      action: resolve!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    const pass = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    return applyLegalAction({
      state: stacked,
      action: pass!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
  }

  function buildC05AmbiguousBattleDestroyState() {
    const observer = createCardInstance(c, {
      instanceId: "alice-c05-observer",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const attacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bob-ambiguous-attacker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const steelBlocker = createCardInstance(card("BSKB01-C01"), {
      instanceId: "alice-steel-blocker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonSteelBlocker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "alice-nonsteel-blocker",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const battleEntities: BattleEntity[] = [
      {
        entityId: "battle-attacker",
        memberInstanceIds: [attacker.instanceId],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
      {
        entityId: "battle-steel-blocker",
        memberInstanceIds: [steelBlocker.instanceId],
        resolvedBp: 4000,
        resolvedSymbols: ["purple"],
        attackState: "blocking",
      },
      {
        entityId: "battle-nonsteel-blocker",
        memberInstanceIds: [nonSteelBlocker.instanceId],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "blocking",
      },
    ];
    const activeAttack: ActiveAttack = {
      attackId: "attack:bskb01-c05-ambiguous-battle",
      primaryEntityId: "battle-attacker",
      participantEntityIds: ["battle-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [
        {
          participantEntityId: "battle-attacker",
          blockedByEntityIds: [
            "battle-steel-blocker",
            "battle-nonsteel-blocker",
          ],
        },
      ],
      symbolResolutionOrder: ["battle-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [observer, attacker, steelBlocker, nonSteelBlocker],
        playerOverrides: [{ countValue: 0 }, {}],
      }),
      turnNumber: 2,
      activePlayerId: BOB,
      step: "attack" as const,
      window: "declare_attack" as const,
      activeAttack,
      battleEntities,
    };
  }

  it("鋼騎士トリガーのカウント+1とカウント比例BP / Lv2コスト置換は実装済み", () => {
    const trigger = c.effects![0]!;
    expect(trigger.stub).toBeUndefined();
    expect(trigger.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: ["destroy", "vanish"],
      triggerFilter: { category: ["spirit", "ultimate", "nexus"] },
      triggerSourceFilter: { tribes: ["鋼騎士"] },
      cause: ["opponent_effect", "battle"],
      sourceWhose: "either",
    });
    expect(trigger.usageLimit).toEqual({ kind: "per_trigger_activation" });
    expect(trigger.steps).toEqual([
      { action: { kind: "count_increase", player: "self", amount: 1 } },
    ]);

    const bp = c.effects![1]!;
    expect(bp.timing).toEqual({ kind: "continuous" });
    expect(bp.stub).toBeUndefined();
    expect(bp.steps[0]!.action).toEqual({
      kind: "bp_modify",
      target: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], tribes: ["鋼騎士"] },
        count: "all",
      },
      amount: {
        source: { kind: "count_value", player: "self" },
        multiplier: 1000,
      },
      duration: { scope: "while_on_field" },
    });

    const lv2 = c.effects![2]!;
    expect(lv2.executionMode).toBe("optional");
    expect(lv2.condition).toContainEqual({ kind: "min_level", value: 2 });
    expect(lv2.steps).toEqual([{ action: { kind: "noop" } }]);
    expect(lv2.stub).toBeUndefined();
  });

  it("BSKB01-C05: カウント比例BPは後から場に出た鋼騎士にも追従し、非鋼騎士には適用しない", () => {
    const observer = createCardInstance(c, {
      instanceId: "alice-c05-bp-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const existingSteel = createCardInstance(card("BSKB01-C01"), {
      instanceId: "alice-existing-steel",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonSteel = createCardInstance(card("BSDB01-C05"), {
      instanceId: "alice-non-steel",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [observer, existingSteel, nonSteel],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const get = (id: string) => cardNoMap.get(id);
    const baseExistingSteelBp = getEffectiveBp(
      before,
      existingSteel,
      card("BSKB01-C01"),
      get
    );
    const baseNonSteelBp = getEffectiveBp(
      before,
      nonSteel,
      card("BSDB01-C05"),
      get
    );

    const withAura = executeEffect({
      chainId: "test:bskb01-cards:4431",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: observer.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const bpCe = withAura.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCe).toMatchObject({
      targetFilter: {
        player: "self",
        category: ["spirit"],
        tribes: ["鋼騎士"],
      },
      modifierAmountDynamic: {
        source: { kind: "count_value", player: "self" },
        multiplier: 1000,
      },
    });
    expect(
      getEffectiveBp(withAura, existingSteel, card("BSKB01-C01"), get)
    ).toBe(baseExistingSteelBp + 3000);
    expect(getEffectiveBp(withAura, nonSteel, card("BSDB01-C05"), get)).toBe(
      baseNonSteelBp
    );

    const lateSteel = createCardInstance(card("BSKB01-C02"), {
      instanceId: "alice-late-steel",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const lateBaseState = {
      ...before,
      cardInstances: [...before.cardInstances, lateSteel],
    };
    const lateAuraState = {
      ...withAura,
      cardInstances: [...withAura.cardInstances, lateSteel],
    };
    const baseLateSteelBp = getEffectiveBp(
      lateBaseState,
      lateSteel,
      card("BSKB01-C02"),
      get
    );
    expect(
      getEffectiveBp(lateAuraState, lateSteel, card("BSKB01-C02"), get)
    ).toBe(baseLateSteelBp + 3000);

    player(lateAuraState, ALICE).countValue = 5;
    expect(
      getEffectiveBp(lateAuraState, lateSteel, card("BSKB01-C02"), get)
    ).toBe(baseLateSteelBp + 5000);

    const protectedObserver = createCardInstance(c, {
      instanceId: "alice-c05-protected-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const protectedSteel = createCardInstance(card("BSKB01-C01"), {
      instanceId: "alice-protected-steel",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const protectedBefore = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [protectedObserver, protectedSteel],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    const protectedBaseSteelBp = getEffectiveBp(
      protectedBefore,
      protectedSteel,
      card("BSKB01-C01"),
      get
    );
    const protectedWithAura = executeEffect({
      chainId: "test:bskb01-cards:4515",
      state: protectedBefore,
      effect: c.effects![1]!,
      sourceInstanceId: protectedObserver.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      getEffectiveBp(protectedWithAura, protectedSteel, card("BSKB01-C01"), get)
    ).toBe(protectedBaseSteelBp + 2000);
  });

  it("BSKB01-C05: 鋼騎士効果で相手が破壊されると count+1 が誘発する", () => {
    const queued = queueC05DestroyTrigger("BSKB01-C01");
    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "destroy" &&
        p.relatedInstanceId === "bob-destroy-target"
    );
    expect(pending).toBeDefined();
    expect(pending!.effectSourceInstanceId).toBe("alice-destroy-source");
    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(
      sourceChoices
        .filter((choice) => choice.actionRegistration.effectIndex === 0)
        .map((choice) => choice.sourceCard.instanceId)
    ).toContain("alice-c05-observer");

    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-c05-observer"
    );
    expect(resolve).toBeDefined();
    const stacked = applyLegalAction({
      state: queued,
      action: resolve!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    const pass = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const counted = applyLegalAction({
      state: stacked,
      action: pass!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    expect(player(counted, ALICE).countValue).toBe(1);
  });

  it("BSKB01-C05: 鋼騎士効果で相手が消滅すると count+1 が誘発する", () => {
    const queued = queueC05DestroyTrigger(
      "BSKB01-C01",
      "effect_resolution",
      "vanish"
    );
    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "vanish" && p.relatedInstanceId === "bob-destroy-target"
    );
    expect(pending).toBeDefined();
    expect(pending?.cause).toBe("opponent_effect");
    expect(pending?.effectSourceInstanceId).toBe("alice-destroy-source");
    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(
      sourceChoices
        .filter((choice) => choice.actionRegistration.effectIndex === 0)
        .map((choice) => choice.sourceCard.instanceId)
    ).toContain("alice-c05-observer");

    const counted = resolveC05PendingTrigger(queued);
    expect(player(counted, ALICE).countValue).toBe(1);
  });

  it("BSKB01-C05: 鋼騎士の効果BP比べ破壊でも count+1 が誘発する", () => {
    const queued = queueC05DestroyTrigger("BSKB01-C01", "bp_compare");
    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "destroy" &&
        p.relatedInstanceId === "bob-destroy-target"
    );
    expect(pending?.cause).toBe("opponent_bp_compare");
    expect(pending?.effectSourceInstanceId).toBe("alice-destroy-source");
    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(
      sourceChoices
        .filter((choice) => choice.actionRegistration.effectIndex === 0)
        .map((choice) => choice.sourceCard.instanceId)
    ).toContain("alice-c05-observer");
  });

  it("BSKB01-C05: 鋼騎士の通常バトル破壊でも battle source attribution で count+1 が誘発する", () => {
    const resolved = executeBattleResolution({
      state: buildC05BattleDestroyState(),
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    const pending = resolved.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "destroy" &&
        p.relatedInstanceId === "bob-battle-blocker"
    );
    expect(pending?.cause).toBe("battle");
    expect(pending?.effectSourceInstanceId).toBe("alice-steel-attacker");
    expect(pending?.effectSourceInstanceIds).toEqual(["alice-steel-attacker"]);
    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: resolved,
      pendingEffect: pending!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(
      sourceChoices
        .filter((choice) => choice.actionRegistration.effectIndex === 0)
        .map((choice) => choice.sourceCard.instanceId)
    ).toContain("alice-c05-observer");

    const resolve = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-c05-observer"
    );
    expect(resolve).toBeDefined();
    const stacked = applyLegalAction({
      state: resolved,
      action: resolve!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    const pass = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const counted = applyLegalAction({
      state: stacked,
      action: pass!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    expect(player(counted, ALICE).countValue).toBe(1);
  });

  it("BSKB01-C05: 複数ブロッカー由来でも鋼騎士 source が含まれれば count+1 が1回だけ誘発する", () => {
    const resolved = executeBattleResolution({
      state: buildC05AmbiguousBattleDestroyState(),
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;
    const pending = resolved.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "destroy" &&
        p.relatedInstanceId === "bob-ambiguous-attacker"
    );
    expect(
      resolved.pendingTriggeredEffects.filter(
        (p) =>
          p.eventKind === "destroy" &&
          p.relatedInstanceId === "bob-ambiguous-attacker"
      )
    ).toHaveLength(1);
    expect(pending).toBeDefined();
    expect(pending?.effectSourceInstanceIds).toEqual([
      "alice-steel-blocker",
      "alice-nonsteel-blocker",
    ]);
    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: resolved,
      pendingEffect: pending!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(
      new Set(
        sourceChoices
          .filter((choice) => choice.actionRegistration.effectIndex === 0)
          .map((choice) => choice.sourceCard.instanceId)
      )
    ).toEqual(new Set(["alice-c05-observer"]));

    const resolve = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-c05-observer"
    );
    expect(resolve).toBeDefined();
    const stacked = applyLegalAction({
      state: resolved,
      action: resolve!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    const pass = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const counted = applyLegalAction({
      state: stacked,
      action: pass!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    expect(player(counted, ALICE).countValue).toBe(1);
  });

  it("BSKB01-C05: 鋼騎士でない自分起因では triggerSourceFilter で誘発しない", () => {
    const queued = queueC05DestroyTrigger("BSDB01-C05");
    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "destroy" &&
        p.relatedInstanceId === "bob-destroy-target"
    );
    if (!pending) {
      expect(queued.pendingTriggeredEffects).toHaveLength(0);
      return;
    }
    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(
      sourceChoices
        .filter((choice) => choice.actionRegistration.effectIndex === 0)
        .map((choice) => choice.sourceCard.instanceId)
    ).not.toContain("alice-c05-observer");
  });
});

describe("BSKB01-C06 ギャラクシアダークネス", () => {
  const c = card("BSKB01-C06");
  const initialDesignatedStepResult = {
    stepId: "designated-target",
    affectedCardInstanceIds: ["designated"],
    movedCoreCount: 0,
    numericAmount: 1,
    succeeded: true,
  };

  function resolveStepTargets(
    state: GameState,
    targetInstanceIds: string[]
  ): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_optional_target_selection"
    );
    if (!action) throw new Error("step target selection action not found");
    return applyLegalAction({
      state,
      action,
      targetInstanceIds,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
  }

  it("トラッシュ耐性は自分の効果だけを受けない while_in_trash effect_immunity", () => {
    const immunity = c.effects![0]!;
    expect(immunity.stub).toBeUndefined();
    expect(immunity.applicability).toEqual({ zone: "trash" });
    const action = immunity.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.duration.scope).toBe("while_in_trash");
      expect(action.sourcePlayerScope).toBe("self");
    }

    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.stub).toBeUndefined();
    expect(flash.steps).toHaveLength(2);

    const designate = flash.steps[0]!;
    expect(designate.id).toBe("designated-target");
    expect(designate.targetSelectionTiming).toBe("on_step");
    expect(designate.action).toMatchObject({
      kind: "noop",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      },
    });

    const vanish = flash.steps[1]!;
    expect(vanish.id).toBe("cost-budget-vanish");
    expect(vanish.targetSelectionTiming).toBe("on_step");
    expect(vanish.action.kind).toBe("vanish");
    if (vanish.action.kind === "vanish") {
      expect(vanish.action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: { min: 0 },
        excludeStepId: "designated-target",
        budget: {
          metric: "cost",
          amount: {
            source: {
              kind: "cost_from_ref",
              stepId: "designated-target",
              costBasis: "effective_or_additional",
            },
          },
        },
      });
    }
  });

  it("[board] 指定対象以外を、指定対象コスト合計まで好きなだけ消滅させる", () => {
    const source = createCardInstance(c, {
      instanceId: "galaxia",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const designated = createCardInstance(card("BSKB01-T01"), {
      instanceId: "designated",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const cost2 = createCardInstance(card("BSKB01-CX01"), {
      instanceId: "cost2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost3 = createCardInstance(card("BSKB01-C02"), {
      instanceId: "cost3",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const overBudget = createCardInstance(card("BSKB01-M01"), {
      instanceId: "over-budget",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [source, designated, cost2, cost3, overBudget],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });

    const pendingDesignate = executeEffect({
      chainId: "test:bskb01-cards:4941",
      state: before,
      effect: c.effects![1]!,
      sourceInstanceId: "galaxia",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    const designatePending =
      pendingDesignate.pendingStepOptionalTargetSelection!;
    expect(designatePending.targetStepId).toBe("designated-target");
    expect(designatePending.requiredTargetCount).toBe(1);
    expect(designatePending.candidateInstanceIds).toEqual(
      expect.arrayContaining(["designated", "cost2", "cost3", "over-budget"])
    );

    const pendingVanish = resolveStepTargets(pendingDesignate, ["designated"]);
    const vanishPending = pendingVanish.pendingStepOptionalTargetSelection!;
    expect(vanishPending.targetStepId).toBe("cost-budget-vanish");
    expect(vanishPending.requiredTargetCount).toBe(0);
    expect(vanishPending.costBudgetAmount).toBe(5);
    expect(vanishPending.candidateInstanceIds.sort()).toEqual(
      ["cost2", "cost3", "over-budget"].sort()
    );
    expect(vanishPending.candidateInstanceIds).not.toContain("designated");

    expect(() =>
      resolveStepTargets(pendingVanish, ["cost2", "cost3", "over-budget"])
    ).toThrow(/cost total 12 exceeds budget 5/);

    const resolved = resolveStepTargets(pendingVanish, ["cost2", "cost3"]);
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    const designatedAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "designated"
    )!;
    const cost2After = resolved.cardInstances.find(
      (card) => card.instanceId === "cost2"
    )!;
    const cost3After = resolved.cardInstances.find(
      (card) => card.instanceId === "cost3"
    )!;
    const overBudgetAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "over-budget"
    )!;
    expect(designatedAfter.zone).toBe("field");
    expect(designatedAfter.pendingLeaveKind).toBeNull();
    expect(cost2After.zone).not.toBe("field");
    expect(cost3After.zone).not.toBe("field");
    expect(overBudgetAfter.pendingLeaveKind).toBeNull();
    expect(player(resolved, BOB).reserveNormalCoreCount).toBe(2);
  });

  it("[board] 指定対象の合体ブレイヴと additional_cost を cost budget に含める", () => {
    const source = createCardInstance(c, {
      instanceId: "galaxia-extra-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const designated = createCardInstance(card("BSKB01-T01"), {
      instanceId: "designated",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["designated-brave"],
    });
    const designatedBrave = createCardInstance(card("BSKB01-R03"), {
      instanceId: "designated-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      attachedToInstanceId: "designated",
    });
    const cost7 = createCardInstance(card("BSKB01-M01"), {
      instanceId: "cost7",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost3 = createCardInstance(card("BSKB01-C02"), {
      instanceId: "cost3",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      cardInstances: [source, designated, designatedBrave, cost7, cost3],
    });

    const pendingDesignate = executeEffect({
      chainId: "test:bskb01-cards:5033",
      state: base,
      effect: c.effects![1]!,
      sourceInstanceId: "galaxia-extra-cost",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    const pendingVanish = resolveStepTargets(pendingDesignate, ["designated"]);
    expect(
      pendingVanish.pendingStepOptionalTargetSelection?.costBudgetAmount
    ).toBe(10);
    const resolved = resolveStepTargets(pendingVanish, ["cost7", "cost3"]);
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();

    const additionalBase = createEmptyGameState({
      cardInstances: [
        source,
        { ...designated, attachedChildrenIds: [] },
        cost7,
      ],
    });
    const withAdditionalCost: GameState = {
      ...additionalBase,
      activeContinuousEffects: [
        ...additionalBase.activeContinuousEffects,
        {
          effectId: "designated-cost-9",
          modifierTag: "additional_cost",
          modifierAmount: 9,
          targetInstanceId: "designated",
          sourceInstanceId: "galaxia-extra-cost",
          sourceDefinitionId: c.cardNo,
          provenance: { kind: "card_effect", effectIndex: 1 },
          duration: { scope: "permanent" },
        } as unknown as GameState["activeContinuousEffects"][number],
      ],
    };
    const pendingAdditionalDesignate = executeEffect({
      chainId: "test:bskb01-cards:5067",
      state: withAdditionalCost,
      effect: c.effects![1]!,
      sourceInstanceId: "galaxia-extra-cost",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    const pendingAdditionalVanish = resolveStepTargets(
      pendingAdditionalDesignate,
      ["designated"]
    );
    expect(
      pendingAdditionalVanish.pendingStepOptionalTargetSelection
        ?.costBudgetAmount
    ).toBe(9);
    expect(() =>
      resolveStepTargets(pendingAdditionalVanish, ["cost7"])
    ).not.toThrow();
  });

  it("[board] 直接 target 注入でも指定対象除外と cost budget を検証する", () => {
    const source = createCardInstance(c, {
      instanceId: "galaxia-direct",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const designated = createCardInstance(card("BSKB01-T01"), {
      instanceId: "designated",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const cost2 = createCardInstance(card("BSKB01-CX01"), {
      instanceId: "cost2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cost3 = createCardInstance(card("BSKB01-C02"), {
      instanceId: "cost3",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const overBudget = createCardInstance(card("BSKB01-M01"), {
      instanceId: "over-budget",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [source, designated, cost2, cost3, overBudget],
    });

    const executeDesignateWithTargets = (targetInstanceIds: string[]) =>
      executeEffect({
        chainId: "test:bskb01-cards:5128",
        state: before,
        effect: c.effects![1]!,
        sourceInstanceId: "galaxia-direct",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
        targetStepId: "designated-target",
        targetSelectionResolved: true,
        targetInstanceIds,
      });

    expect(() => executeDesignateWithTargets(["galaxia-direct"])).toThrow(
      /not in candidate pool/
    );
    expect(() =>
      executeDesignateWithTargets(["designated", "designated"])
    ).toThrow(/Duplicate preselected target/);
    expect(() => executeDesignateWithTargets(["designated", "cost2"])).toThrow(
      /outside allowed range 1-1/
    );
    expect(() => executeDesignateWithTargets([])).toThrow(
      /outside allowed range 1-1/
    );
    expect(
      executeDesignateWithTargets(["designated"])
        .pendingStepOptionalTargetSelection?.targetStepId
    ).toBe("cost-budget-vanish");

    const executeVanishWithTargets = (targetInstanceIds: string[]) =>
      executeEffect({
        chainId: "test:bskb01-cards:5158",
        state: before,
        effect: c.effects![1]!,
        sourceInstanceId: "galaxia-direct",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
        startFromStepIndex: 1,
        initialStepResults: [initialDesignatedStepResult],
        targetStepId: "cost-budget-vanish",
        targetSelectionResolved: true,
        targetInstanceIds,
      });

    expect(() => executeVanishWithTargets(["designated"])).toThrow(
      /not in candidate pool/
    );
    expect(() => executeVanishWithTargets(["missing-target"])).toThrow(
      /not in candidate pool/
    );
    expect(() => executeVanishWithTargets(["cost2", "cost2"])).toThrow(
      /Duplicate preselected target/
    );
    expect(() =>
      executeVanishWithTargets(["cost2", "cost3", "over-budget"])
    ).toThrow(/cost total 12 exceeds budget 5/);
    expect(() => executeVanishWithTargets(["cost2", "cost3"])).not.toThrow();
  });
});

describe("BSKB01-R02 [虚ろなる鏡の騎士]ダークメタナイト", () => {
  const c = card("BSKB01-R02");
  function resolveR02CoreDistributionAction(state: GameState) {
    const pending = state.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    const action = getLegalActions({
      state,
      actingPlayerId: pending!.actingPlayerId,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(action).toBeDefined();
    return action!;
  }

  function chooseR02TargetTotals(
    state: GameState,
    targetTotals: Record<string, number>
  ): GameState {
    return applyLegalAction({
      state,
      action: resolveR02CoreDistributionAction(state),
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      coreDistributionAllocations: targetTotals,
    }).state;
  }

  function resolveR02OwnerCoreSources(
    state: GameState,
    normalAllocations: Record<string, number>,
    normalSourceAllocations: Record<string, number>,
    soulCoreAllocations?: Record<string, number>,
    soulCoreSourceAllocations?: Record<string, number>
  ): GameState {
    return applyLegalAction({
      state,
      action: resolveR02CoreDistributionAction(state),
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      coreDistributionAllocations: normalAllocations,
      coreDistributionSourceAllocations: normalSourceAllocations,
      ...(soulCoreAllocations !== undefined
        ? { coreDistributionSoulCoreAllocations: soulCoreAllocations }
        : {}),
      ...(soulCoreSourceAllocations !== undefined
        ? {
            coreDistributionSoulCoreSourceAllocations:
              soulCoreSourceAllocations,
          }
        : {}),
    }).state;
  }

  it("契約煌臨キーワード付与 / コントラクトチェンジ / 召喚・アタック時ターン1回2ドローを表現する", () => {
    // effects[0]: 「このカード/スピリットは【契約煌臨】を持っているものとして扱う」は
    // override_properties CE (properties.grantsContractAdventEligibility:true) で解消済み
    // (advent-system.ts hasContractAdventEligibilityGrant SSOT)。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps).toEqual([
      {
        action: {
          kind: "override_properties",
          target: { kind: "self" },
          properties: { grantsContractAdventEligibility: true },
          duration: { scope: "while_on_field" },
        },
      },
    ]);
    expect(c.changeData).toMatchObject({
      cost: 4,
      reduction: ["purple", "purple"],
      swapCondition: { adventState: "advented" },
      transferAdventSourcesOnSwap: {
        cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
      },
    });
    const contractChange = c.changeData!.effects![0]!;
    expect(contractChange.stub).toBeUndefined();
    expect(contractChange.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    expect(contractChange.steps[0]!.action).toEqual({
      kind: "core_distribute",
      from: {
        kind: "field",
        player: "opponent",
        minRemainingPerCandidateByFilter: [
          {
            filter: { category: ["spirit", "ultimate"] },
            minRemaining: 1,
          },
        ],
      },
      to: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate", "nexus"] },
        count: "all",
      },
      amount: 4,
      mode: "player_choice",
    });
    expect(contractChange.steps[1]!.action).toEqual({
      kind: "life_damage_interception",
      player: "self",
      cause: "opponent",
      mode: "replace",
      battleOnly: true,
      attackerFilter: {
        category: ["spirit", "ultimate"],
        maxCores: 2,
      },
      duration: { scope: "turn" },
    });

    const draw = c.effects![1]!;
    expect(draw.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    expect(draw.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(draw.steps[0]!.action).toEqual({
      kind: "draw",
      count: 2,
      position: "bottom",
    });
    // 下からドロー位置指定が実装され、draw ステップの stub は解消済み。
    expect(draw.stub).toBeUndefined();
  });

  it("コントラクトチェンジ効果は相手S/Uを0個にせず、ネクサスは0個まで含めて4個まで任意再配置する", () => {
    const source = createCardInstance(c, {
      instanceId: "dark-meta",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const opponentSpirit = createCardInstance(card("BSKB01-C02"), {
      instanceId: "opp-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const opponentUltimate = createCardInstance(card("BSTH05.5-C01"), {
      instanceId: "opp-ultimate",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentNexus = createCardInstance(card("BSKB01-C04"), {
      instanceId: "opp-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentBrave = createCardInstance(card("BSKB01-R03"), {
      instanceId: "opp-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        source,
        opponentSpirit,
        opponentUltimate,
        opponentNexus,
        opponentBrave,
      ],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        {
          lifeNormalCoreCount: 5,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "opp-brave" },
        },
      ],
    });

    const pendingState = executeEffect({
      chainId: "test:bskb01-cards:5379",
      state: before,
      effect: c.changeData!.effects![0]!,
      isChangeData: true,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    const pending = pendingState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.fromKind).toBe("any_movable");
    expect(pending!.actingPlayerId).toBe(ALICE);
    expect(pending!.targetTotalSelection).toMatchObject({
      mode: "target_totals_then_core_owner_sources",
      targetChooserPlayerId: ALICE,
      sourceOwnerPlayerId: BOB,
    });
    expect(pending!.fromPlayerId).toBe(BOB);
    expect(pending!.toPlayerId).toBe(BOB);
    expect(pending!.totalNormalCores).toBe(4);
    expect(pending!.hasSoulCore).toBe(true);
    expect(pending!.totalSoulCores).toBe(1);
    expect(pending!.soulSourceAvailable).toEqual({
      "field:opp-brave": 1,
    });
    expect(pending!.maxTotal).toBe(4);
    expect(
      pending!.candidates.map((candidate) => candidate.instanceId).sort()
    ).toEqual(["opp-brave", "opp-nexus", "opp-spirit", "opp-ultimate"].sort());
    expect(pending!.sourceAvailable).toEqual({
      "field:opp-spirit": 2,
      "field:opp-ultimate": 1,
      "field:opp-nexus": 1,
      "field:opp-brave": 2,
    });
    expect(pending!.sourceTotalAvailable).toEqual({
      "field:opp-spirit": 2,
      "field:opp-ultimate": 1,
      "field:opp-nexus": 1,
      "field:opp-brave": 2,
    });

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveR02CoreDistributionAction(pendingState),
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        coreDistributionSoulCoreAllocations: { "opp-nexus": 1 },
      })
    ).toThrow(/target-total selection must not choose physical core sources/);
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveR02CoreDistributionAction(pendingState),
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        coreDistributionSourceAllocations: { "field:opp-brave": 1 },
      })
    ).toThrow(/target-total selection must not choose physical core sources/);

    expect(() =>
      chooseR02TargetTotals(pendingState, {
        "opp-spirit": 0,
        "opp-ultimate": 3,
        "opp-nexus": 4,
      })
    ).toThrow(/opp-spirit is below reachable minimum 1/);

    const sourceChoiceState = chooseR02TargetTotals(pendingState, {
      "opp-spirit": 1,
      "opp-ultimate": 3,
      "opp-nexus": 4,
      "opp-brave": 1,
    });
    expect(sourceChoiceState.pendingCoreDistribution).toMatchObject({
      actingPlayerId: BOB,
      targetTotalSelection: {
        fixedTargetTotals: {
          "opp-spirit": 1,
          "opp-ultimate": 3,
          "opp-nexus": 4,
          "opp-brave": 1,
        },
      },
    });

    expect(() =>
      resolveR02OwnerCoreSources(
        sourceChoiceState,
        { "opp-nexus": 3 },
        { "field:opp-spirit": 3 }
      )
    ).toThrow(/field:opp-spirit amount 3 exceeds available 2/);

    expect(() =>
      resolveR02OwnerCoreSources(
        sourceChoiceState,
        { "opp-ultimate": 2, "opp-nexus": 1 },
        {
          "field:opp-spirit": 2,
          "field:opp-brave": 1,
        },
        { "opp-nexus": 1 },
        { "field:opp-brave": 1 }
      )
    ).toThrow(/opp-ultimate total 4 does not match fixed target total 3/);

    const resolved = resolveR02OwnerCoreSources(
      sourceChoiceState,
      { "opp-ultimate": 1, "opp-nexus": 2 },
      {
        "field:opp-spirit": 2,
        "field:opp-brave": 1,
      },
      { "opp-nexus": 1 },
      { "field:opp-brave": 1 }
    );

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "opp-spirit")!
        .normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "opp-ultimate")!
        .normalCoreCount
    ).toBe(3);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "opp-nexus")!
        .normalCoreCount
    ).toBe(3);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "opp-brave")!
        .normalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "opp-brave")!
        .soulCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "opp-nexus")!
        .soulCoreCount
    ).toBe(1);
    expect(player(resolved, BOB).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "opp-nexus",
    });
    expect(
      resolved.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
  });

  it("コントラクトチェンジの core_distribute は相手T01を出すとき以外の配置先候補にしない", () => {
    const source = createCardInstance(c, {
      instanceId: "dark-meta",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const opponentSpirit = createCardInstance(card("BSKB01-C02"), {
      instanceId: "opp-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const opponentNexus = createCardInstance(card("BSKB01-C04"), {
      instanceId: "opp-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const opponentToken = createCardInstance(card("BSKB01-T01"), {
      instanceId: "opp-token-t01",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, opponentSpirit, opponentNexus, opponentToken],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    const pendingState = executeEffect({
      chainId: "test:bskb01-cards:5575",
      state: before,
      effect: c.changeData!.effects![0]!,
      isChangeData: true,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    const pending = pendingState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.fromKind).toBe("any_movable");
    expect(
      pending!.candidates.map((candidate) => candidate.instanceId).sort()
    ).toEqual(["opp-nexus", "opp-spirit"].sort());
    expect(pending!.sourceAvailable).toEqual({
      "field:opp-spirit": 2,
    });
  });

  it("コントラクトチェンジは空配分でも後続効果を継続し、効果後に破棄/入れ替えを選ばせる", () => {
    const changeCard = createCardInstance(c, {
      instanceId: "dark-meta-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const ownAdvented = {
      ...createCardInstance(card("BSKB01-C01"), {
        instanceId: "own-advented-meta",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      underCards: [
        { cardInstanceId: "masked-meta-source", role: "advent_source" },
      ],
    };
    const maskedMetaSource = createCardInstance(card("BSKB01-CX01"), {
      instanceId: "masked-meta-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const lowCoreOpponent = createCardInstance(card("BSKB01-C02"), {
      instanceId: "opp-low-core",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentNexus = createCardInstance(card("BSKB01-C04"), {
      instanceId: "opp-nexus-choice",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [
          changeCard,
          ownAdvented,
          maskedMetaSource,
          lowCoreOpponent,
          opponentNexus,
        ],
        playerOverrides: [
          { handCount: 1, reserveNormalCoreCount: 4 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      step: "main" as const,
    };

    const useChange = getLegalActions({
      state: base,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "use_change" &&
        action.sourceInstanceId === "dark-meta-hand"
    );
    expect(useChange?.kind).toBe("use_change");
    if (!useChange || useChange.kind !== "use_change") {
      throw new Error("use_change action not found");
    }
    let current = applyLegalAction({
      state: base,
      action: useChange,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
      paymentSources: [{ kind: "reserve", amount: useChange.finalCost }],
    }).state;

    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow!.priorityPlayerId,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(current.pendingCoreDistribution).not.toBeNull();
    const distributionActions = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    });
    expect(
      distributionActions.some(
        (action) => action.kind === "abort_pending_core_distribution"
      )
    ).toBe(false);

    current = chooseR02TargetTotals(current, {
      "opp-low-core": 2,
      "opp-nexus-choice": 1,
    });
    expect(current.pendingCoreDistribution).toMatchObject({
      actingPlayerId: BOB,
      targetTotalSelection: {
        fixedTargetTotals: {
          "opp-low-core": 2,
          "opp-nexus-choice": 1,
        },
      },
    });

    current = resolveR02OwnerCoreSources(current, {}, {});
    expect(current.pendingCoreDistribution).toBeNull();
    expect(
      current.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
    expect(current.pendingChangeCleanupChoice).toMatchObject({
      cardInstanceId: "dark-meta-hand",
      actingPlayerId: ALICE,
      swapCandidateInstanceIds: ["own-advented-meta"],
    });

    const cleanupActions = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).filter(
      (action) => action.kind === "resolve_pending_change_cleanup_choice"
    );
    expect(cleanupActions.map((action) => action.outcome).sort()).toEqual([
      "swap",
      "trash",
    ]);
  });

  it("コントラクトチェンジのコア配分/cleanup選択中は後続スタックのcascadeを再開しない", () => {
    const cascadeDrawDef: CardDefinition = {
      cardNo: "TEST-BSKB01-R02-CASCADE-DRAW",
      name: "R02 cascade resumed effect",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["purple"],
      textLines: ["フラッシュ：自分は1枚ドローする。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cascade-draw",
              action: { kind: "draw", count: 1 },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = [...ALL_CARDS, cascadeDrawDef];
    const getCardDefinitionById = (id: string) =>
      id === cascadeDrawDef.cardNo ? cascadeDrawDef : cardNoMap.get(id);
    const getRegisteredFieldCardEffectActions =
      buildFieldCardEffectLookup(localDefs);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    };
    const resolveCoreDistributionAction = (
      state: GameState,
      actingPlayerId: string
    ) => {
      const action = getLegalActions({
        state,
        actingPlayerId,
        ...lookups,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_core_distribution"
      );
      expect(action).toBeDefined();
      return action!;
    };
    const playerCounts = (state: GameState) => ({
      hand: player(state, ALICE).handCount,
      deck: player(state, ALICE).deckCount,
    });

    const changeCard = createCardInstance(c, {
      instanceId: "dark-meta-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const ownAdvented = {
      ...createCardInstance(card("BSKB01-C01"), {
        instanceId: "own-advented-meta",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      underCards: [
        { cardInstanceId: "masked-meta-source", role: "advent_source" },
      ],
    };
    const maskedMetaSource = createCardInstance(card("BSKB01-CX01"), {
      instanceId: "masked-meta-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const lowCoreOpponent = createCardInstance(card("BSKB01-C02"), {
      instanceId: "opp-low-core",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentNexus = createCardInstance(card("BSKB01-C04"), {
      instanceId: "opp-nexus-choice",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cascadeSource = createCardInstance(cascadeDrawDef, {
      instanceId: "cascade-draw-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [
          changeCard,
          ownAdvented,
          maskedMetaSource,
          lowCoreOpponent,
          opponentNexus,
          cascadeSource,
        ],
        playerOverrides: [
          { handCount: 1, reserveNormalCoreCount: 4, deckCount: 1 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      step: "main" as const,
    };

    const useChange = getLegalActions({
      state: base,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_change" &&
        action.sourceInstanceId === "dark-meta-hand"
    );
    expect(useChange?.kind).toBe("use_change");
    if (!useChange || useChange.kind !== "use_change") {
      throw new Error("use_change action not found");
    }
    let current = applyLegalAction({
      state: base,
      action: useChange,
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: useChange.finalCost }],
    }).state;

    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow!.priorityPlayerId,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      ...lookups,
    }).state;

    expect(current.pendingCoreDistribution).not.toBeNull();
    const cascadeStack: ActiveStack = {
      stackId: "r02-cascade-draw",
      actionKind: "field_card_effect",
      chainId: "chain-r02-cascade-draw",
      actingPlayerId: ALICE,
      cardInstanceId: "cascade-draw-source",
      cardDefinitionId: cascadeDrawDef.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      fieldEffectSourceKind: "spirit",
      fieldEffectRegistrationIndex: 0,
      chosenTiming: "flash",
      activationLabel: "flash",
      sourceActivationZone: "field",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    current = {
      ...current,
      pendingStackCascade: { remainingStacks: [cascadeStack] },
    };
    const beforeCascadeCounts = playerCounts(current);

    current = applyLegalAction({
      state: current,
      action: resolveCoreDistributionAction(current, ALICE),
      ...lookups,
      coreDistributionAllocations: {
        "opp-low-core": 1,
        "opp-nexus-choice": 2,
      },
    }).state;
    expect(current.pendingCoreDistribution).toMatchObject({
      actingPlayerId: BOB,
      targetTotalSelection: {
        fixedTargetTotals: {
          "opp-low-core": 1,
          "opp-nexus-choice": 2,
        },
      },
    });
    expect(current.pendingStackCascade?.remainingStacks).toHaveLength(1);
    expect(playerCounts(current)).toEqual(beforeCascadeCounts);

    current = applyLegalAction({
      state: current,
      action: resolveCoreDistributionAction(current, BOB),
      ...lookups,
      coreDistributionAllocations: { "opp-nexus-choice": 1 },
      coreDistributionSourceAllocations: { "field:opp-low-core": 1 },
    }).state;
    expect(current.pendingCoreDistribution).toBeNull();
    expect(current.pendingChangeCleanupChoice).toMatchObject({
      cardInstanceId: "dark-meta-hand",
      actingPlayerId: ALICE,
    });
    expect(current.pendingStackCascade?.remainingStacks).toHaveLength(1);
    expect(playerCounts(current)).toEqual(beforeCascadeCounts);

    const cleanup = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_change_cleanup_choice" &&
        action.outcome === "trash"
    );
    expect(cleanup).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: cleanup!,
      ...lookups,
    }).state;

    expect(current.pendingChangeCleanupChoice).toBeNull();
    expect(current.pendingStackCascade).toBeNull();
    expect(playerCounts(current)).toEqual({
      hand: beforeCascadeCounts.hand + 1,
      deck: beforeCascadeCounts.deck - 1,
    });
  });

  it("コントラクトチェンジの自動trash cleanup後に後続スタックのcascadeを再開する", () => {
    const cascadeDrawDef: CardDefinition = {
      cardNo: "TEST-BSKB01-R02-CASCADE-DRAW-NO-SWAP",
      name: "R02 cascade resumed effect without swap",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["purple"],
      textLines: ["フラッシュ：自分は1枚ドローする。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ id: "cascade-draw", action: { kind: "draw", count: 1 } }],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = [...ALL_CARDS, cascadeDrawDef];
    const getCardDefinitionById = (id: string) =>
      id === cascadeDrawDef.cardNo ? cascadeDrawDef : cardNoMap.get(id);
    const getRegisteredFieldCardEffectActions =
      buildFieldCardEffectLookup(localDefs);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    };
    const resolveCoreDistributionAction = (
      state: GameState,
      actingPlayerId: string
    ) => {
      const action = getLegalActions({
        state,
        actingPlayerId,
        ...lookups,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_core_distribution"
      );
      expect(action).toBeDefined();
      return action!;
    };

    const changeCard = createCardInstance(c, {
      instanceId: "dark-meta-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const lowCoreOpponent = createCardInstance(card("BSKB01-C02"), {
      instanceId: "opp-low-core",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentNexus = createCardInstance(card("BSKB01-C04"), {
      instanceId: "opp-nexus-choice",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cascadeSource = createCardInstance(cascadeDrawDef, {
      instanceId: "cascade-draw-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [
          changeCard,
          lowCoreOpponent,
          opponentNexus,
          cascadeSource,
        ],
        playerOverrides: [
          { handCount: 1, reserveNormalCoreCount: 4, deckCount: 1 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      step: "main" as const,
    };

    const useChange = getLegalActions({
      state: base,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_change" &&
        action.sourceInstanceId === "dark-meta-hand"
    );
    expect(useChange?.kind).toBe("use_change");
    if (!useChange || useChange.kind !== "use_change") {
      throw new Error("use_change action not found");
    }
    let current = applyLegalAction({
      state: base,
      action: useChange,
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: useChange.finalCost }],
    }).state;

    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow!.priorityPlayerId,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      ...lookups,
    }).state;

    current = {
      ...current,
      pendingStackCascade: {
        remainingStacks: [
          {
            stackId: "r02-cascade-draw-no-swap",
            actionKind: "field_card_effect",
            chainId: "chain-r02-cascade-draw-no-swap",
            actingPlayerId: ALICE,
            cardInstanceId: "cascade-draw-source",
            cardDefinitionId: cascadeDrawDef.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            fieldEffectSourceKind: "spirit",
            fieldEffectRegistrationIndex: 0,
            chosenTiming: "flash",
            activationLabel: "flash",
            sourceActivationZone: "field",
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        ],
      },
    };
    const beforeHand = player(current, ALICE).handCount;
    const beforeDeck = player(current, ALICE).deckCount;

    current = applyLegalAction({
      state: current,
      action: resolveCoreDistributionAction(current, ALICE),
      ...lookups,
      coreDistributionAllocations: {
        "opp-low-core": 1,
        "opp-nexus-choice": 2,
      },
    }).state;
    expect(current.pendingStackCascade?.remainingStacks).toHaveLength(1);

    current = applyLegalAction({
      state: current,
      action: resolveCoreDistributionAction(current, BOB),
      ...lookups,
      coreDistributionAllocations: { "opp-nexus-choice": 1 },
      coreDistributionSourceAllocations: { "field:opp-low-core": 1 },
    }).state;

    expect(current.pendingCoreDistribution).toBeNull();
    expect(current.pendingChangeCleanupChoice).toBeNull();
    expect(current.pendingStackCascade).toBeNull();
    expect(
      current.cardInstances.find((card) => card.instanceId === "dark-meta-hand")
        ?.zone
    ).toBe("trash");
    expect(player(current, ALICE).handCount).toBe(beforeHand + 1);
    expect(player(current, ALICE).deckCount).toBe(beforeDeck - 1);
  });

  it("コントラクトチェンジ効果はコア2個以下の相手スピリットのライフ減少だけを防ぐ", () => {
    const source = createCardInstance(c, {
      instanceId: "dark-meta",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const lowCoreAttacker = createCardInstance(card("BSKB01-C02"), {
      instanceId: "low-core",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const highCoreAttacker = createCardInstance(card("BSKB01-C03"), {
      instanceId: "high-core",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, lowCoreAttacker, highCoreAttacker],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    const withInterception = executeEffect({
      chainId: "test:bskb01-cards:6206",
      state: before,
      effect: c.changeData!.effects![0]!,
      isChangeData: true,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(withInterception.pendingCoreDistribution).not.toBeNull();
    const sourceChoiceInterception = chooseR02TargetTotals(withInterception, {
      "low-core": 2,
      "high-core": 3,
    });
    const resolvedInterception = resolveR02OwnerCoreSources(
      sourceChoiceInterception,
      {},
      {}
    );

    const ce = resolvedInterception.activeContinuousEffects.find(
      (effect) => effect.modifierTag === "life_damage_interception"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe(ALICE);
    expect(ce!.metadata).toMatchObject({
      cause: "opponent",
      mode: "replace",
      battleOnly: true,
      attackerFilter: {
        category: ["spirit", "ultimate"],
        maxCores: 2,
      },
    });

    const battleEntities: BattleEntity[] = [
      {
        entityId: "low-entity",
        memberInstanceIds: ["low-core"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
      {
        entityId: "high-entity",
        memberInstanceIds: ["high-core"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ];
    const battleResolutionGroup: BattleResolutionGroup = {
      attackId: "atk-r02",
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      symbolResolutionOrder: ["low-entity", "high-entity"],
      participantSnapshots: battleEntities.map((entity) => ({
        entityId: entity.entityId,
        memberInstanceIds: entity.memberInstanceIds,
        resolvedBp: entity.resolvedBp,
        resolvedSymbols: entity.resolvedSymbols,
        blockedBy: [],
      })),
    };
    const damage = getUnblockedLifeDamage(
      { ...resolvedInterception, battleEntities, battleResolutionGroup },
      (id) => cardNoMap.get(id)
    );

    expect(damage?.totalLifeDamage).toBe(1);

    const afterEffectDamage = resolveLifeDamage(
      resolvedInterception,
      ALICE,
      1,
      [],
      {
        cause: "opponent_effect",
        actingPlayerId: BOB,
        sourceCardMatchesFilter: () => true,
      },
      (id) => cardNoMap.get(id)
    );
    expect(
      afterEffectDamage.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(4);
  });
});

describe("BSKB01-R04 メタナイトが夜な夜なこっそり食べてるパフェ", () => {
  const c = card("BSKB01-R04");
  it("トラッシュ耐性・宣言中一時耐性・ミラージュ各ステップ終了時コア回収・ライフ補充予約は実装済", () => {
    expect(c.effects).toHaveLength(4);
    expect(c.mirageData).toEqual({
      cost: 3,
      reduction: ["purple", "purple"],
    });
    // effects[0]: トラッシュにあるこのカードは一切の効果を受けない (while_in_trash)。
    const trashImmunity = c.effects![0]!;
    expect(trashImmunity.stub).toBeUndefined();
    expect(trashImmunity.applicability).toEqual({ zone: "trash" });
    const imm = trashImmunity.steps[0]!.action;
    expect(imm.kind).toBe("effect_immunity");
    if (imm.kind === "effect_immunity") {
      expect(imm.duration.scope).toBe("while_in_trash");
    }

    // effects[1]: 手札/手元からフラッシュ使用したこのカードは、効果発揮後まで、
    // 相手の効果を受けない (ENGINE-effect-immunity-own-pending-resolution)。
    const declarationImmunity = c.effects![1]!;
    expect(declarationImmunity.stub).toBeUndefined();
    expect(declarationImmunity.applicability).toEqual({ zone: "in_use" });
    expect(declarationImmunity.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "effect_declaration",
      requireTriggerSelf: true,
      triggerEffectActionKind: "magic",
      triggerEffectTiming: "flash",
      triggerActivationZone: ["hand", "set_aside"],
    });
    const declImm = declarationImmunity.steps[0]!.action;
    expect(declImm.kind).toBe("effect_immunity");
    if (declImm.kind === "effect_immunity") {
      expect(declImm.target).toEqual({ kind: "self" });
      expect(declImm.duration.scope).toBe("while_own_declaration_pending");
    }

    // effects[2]: 【セット中】自分の各ステップ終了時、トラッシュの通常コア1個をリザーブへ。
    const mirage = c.effects![2]!;
    expect(mirage.stub).toBeUndefined();
    expect(mirage.applicability).toEqual({ zone: "mirage_set" });
    expect(mirage.timing).toEqual({
      kind: "phase",
      whose: "self",
      subPhase: "end",
    });
    expect(mirage.executionMode).toBe("optional");
    expect(mirage.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 1,
      effectKind: "normal_only",
    });

    // effects[3]: フラッシュ〔ターンに1回：同名〕予約効果 (engine-player-scoped-turn-reservation、
    // 詳細は bskb01-r04-life-reduction-void-core-turn-reservation.test.ts)。
    expect(c.effects![3]!.stub).toBeUndefined();
    expect(c.effects![3]!.steps).toHaveLength(1);
    expect(c.effects![3]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    const grantAction = c.effects![3]!.steps[0]!.action;
    expect(grantAction.kind).toBe("grant_effect");
    if (grantAction.kind === "grant_effect") {
      expect(grantAction.turnReservation).toBe(true);
    }
  });

  describe("effects[1]: 宣言時 (手札/手元フラッシュ) 一時耐性", () => {
    const lookups = {
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    };

    function makeDeclarationStackState(
      magicActivationZone: "hand" | "set_aside" | "field"
    ): { state: GameState; r04: CardInstance } {
      const r04 = createCardInstance(c, {
        instanceId: "alice-r04",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "in_use",
      });
      const targetStack: ActiveStack = {
        stackId: "stack:r04-1",
        actionKind: "magic",
        chainId: "chain:r04-1",
        actingPlayerId: ALICE,
        cardInstanceId: r04.instanceId,
        cardDefinitionId: "BSKB01-R04",
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        chosenTiming: "flash",
        magicActivationZone,
        magicEffectIndex: 3,
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      };
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          activePlayerId: ALICE,
          cardInstances: [r04],
        }),
        step: "main",
        window: "stack",
        stackWindow: {
          priorityPlayerId: BOB,
          consecutivePassCount: 0,
          actingPlayerId: ALICE,
          previousWindow: "none",
          stackResponseSourcePlayerId: ALICE,
          subStackEverOpened: false,
          burstWindowKind: null,
          pendingStackAction: targetStack,
        },
      } as GameState;
      return { state, r04 };
    }

    it("[board] 手札からのフラッシュ宣言: 相手が窓を閉じた時点で自己一時耐性が登録される", () => {
      const { state, r04 } = makeDeclarationStackState("hand");

      // 相手 (BOB) がこの宣言への応答窓を閉じる → effect_declaration が収集される。
      const bobPass = getLegalActions({
        state,
        actingPlayerId: BOB,
        ...lookups,
      }).find((action) => action.kind === "pass_stack");
      expect(bobPass).toBeDefined();
      const declared = applyLegalAction({
        state,
        action: bobPass!,
        ...lookups,
      }).state;

      expect(
        declared.pendingTriggeredEffects.some(
          (p) =>
            p.eventKind === "effect_declaration" &&
            p.relatedInstanceId === r04.instanceId
        )
      ).toBe(true);

      // ALICE (自分自身の一時耐性) を解決する。
      const resolveAction = getLegalActions({
        state: declared,
        actingPlayerId: ALICE,
        ...lookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === r04.instanceId
      );
      expect(resolveAction).toBeDefined();
      const stacked = applyLegalAction({
        state: declared,
        action: resolveAction!,
        ...lookups,
      }).state;

      // 誘発効果自体も宣言→応答窓を経る。相手 (BOB) が窓を閉じて解決を完了させる。
      const bobPass2 = getLegalActions({
        state: stacked,
        actingPlayerId: BOB,
        ...lookups,
      }).find((action) => action.kind === "pass_stack");
      const resolved = bobPass2
        ? applyLegalAction({ state: stacked, action: bobPass2, ...lookups })
            .state
        : stacked;

      // 一時耐性は宣言直後に登録される (この効果自体 (effects[3]) は登録条件
      // 「魂状態を含む自分の『メタナイト』がいるとき」を満たさない盤面のため
      // grant_effect ステップが no-op のまま直後に完全解決し、「効果発揮後」=
      // effect_activated が同一カスケード内で続けて発火するため、最終状態では
      // 自動失効済みになる。これは while_own_declaration_pending の正しい
      // lifecycle であり、removeUntilEventContinuousEffects の即時失効を実証する)。
      expect(resolved.log).toContain(
        "effect:effect_immunity:registered:alice-r04:while_own_declaration_pending"
      );
      expect(
        resolved.log.some((entry) =>
          entry.startsWith("flash:effect_activated:player-1:alice-r04:")
        )
      ).toBe(true);
      expect(
        resolved.activeContinuousEffects.some(
          (effect) =>
            effect.targetInstanceId === r04.instanceId &&
            effect.duration.scope === "while_own_declaration_pending"
        )
      ).toBe(false);
    });

    it("[board] ミラージュセット状態 (field) からの発動: triggerActivationZone 不一致で一時耐性は登録されない", () => {
      const { state, r04 } = makeDeclarationStackState("field");

      const bobPass = getLegalActions({
        state,
        actingPlayerId: BOB,
        ...lookups,
      }).find((action) => action.kind === "pass_stack");
      expect(bobPass).toBeDefined();
      const declared = applyLegalAction({
        state,
        action: bobPass!,
        ...lookups,
      }).state;

      // triggerActivationZone:["hand","set_aside"] に一致しないため、
      // このカード自身の effect_declaration 反応は誘発候補にならない。
      expect(
        declared.pendingTriggeredEffects.some(
          (p) =>
            p.eventKind === "effect_declaration" &&
            p.relatedInstanceId === r04.instanceId
        )
      ).toBe(false);
      expect(
        declared.activeContinuousEffects.some(
          (effect) =>
            effect.targetInstanceId === r04.instanceId &&
            effect.duration.scope === "while_own_declaration_pending"
        )
      ).toBe(false);
      expect(
        declared.activeContinuousEffects.some(
          (effect) =>
            effect.targetInstanceId === r04.instanceId &&
            effect.duration.scope === "while_in_trash"
        )
      ).toBe(true);
    });

    it("removeUntilEventContinuousEffects: while_own_declaration_pending は宣言元自身の effect_completed で即時失効する", () => {
      const r04 = createCardInstance(c, {
        instanceId: "alice-r04",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "in_use",
      });
      const ce: ContinuousEffect = {
        effectId: "ce-r04-decl-immunity",
        sourceInstanceId: r04.instanceId,
        sourceDefinitionId: "BSKB01-R04",
        actingPlayerId: ALICE,
        duration: { scope: "while_own_declaration_pending" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "defense_immune",
        targetInstanceId: r04.instanceId,
      };
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [r04],
        }),
        activeContinuousEffects: [ce],
      };

      // turn_end / battle_end / step_end では自然消滅しない (permanent 相当)。
      const afterTurnEnd = removeExpiredContinuousEffects(state, {
        kind: "turn_end",
      });
      expect(afterTurnEnd).toContainEqual(ce);

      // 宣言元自身 (r04) の effect_completed (=効果発揮完了直後) で即時失効する。
      const afterActivation = queueEffectActivationTriggers({
        chainId: "test:bskb01-cards:6569",
        state,
        activatorPlayerId: ALICE,
        relatedInstanceId: r04.instanceId,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      });
      expect(afterActivation.activeContinuousEffects).toContainEqual(ce);
      const afterCompletion = flushReadyEffectCompletions(afterActivation, {
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      });
      expect(
        afterCompletion.activeContinuousEffects.some(
          (effect) => effect.effectId === ce.effectId
        )
      ).toBe(false);
    });
  });

  it("ミラージュ効果はトラッシュの通常コアだけをリザーブへ1個移す", () => {
    const source = instance(c, "alice-parfait");
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {
          trashNormalCoreCount: 2,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "trash" },
        },
        {},
      ],
      cardInstances: [source],
    });

    const after = executeEffect({
      chainId: "test:bskb01-cards:6606",
      state: before,
      effect: { ...c.effects![2]!, executionMode: "mandatory" },
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    expect(player(after, ALICE).trashNormalCoreCount).toBe(1);
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(1);
    expect(player(after, ALICE).soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("End Step の終了時にも各ステップ終了時ミラージュが誘発して解決できる", () => {
    const source = instance(c, "alice-parfait");
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        playerOverrides: [
          {
            trashNormalCoreCount: 1,
            reserveNormalCoreCount: 0,
          },
          {},
        ],
        cardInstances: [source],
      }),
      step: "end",
      window: "end_step_effects",
    } as GameState;

    const queued = advanceStep(
      before,
      (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.window).toBe("end_step_end_effects");
    expect(queued.pendingPrivateDeclarations).toHaveLength(0);
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "end_step",
    });
    expect(
      queued.pendingTriggeredEffects[0]?.declaredFromPrivateZone
    ).toBeFalsy();

    const resolveAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === source.instanceId
    );
    expect(resolveAction).toBeDefined();

    const stacked = applyLegalAction({
      state: queued,
      action: resolveAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    expect(stacked.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );

    const passAction = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const after = applyLegalAction({
      state: stacked,
      action: passAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(player(after, ALICE).trashNormalCoreCount).toBe(0);
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(1);

    const cleanedUp = advanceStep(
      after,
      (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(cleanedUp.window).toBe("end_step_cleanup");
  });

  it("Main Step の終了時は解決まで Main Step に留まり、解決後に次ステップへ進む", () => {
    const source = instance(c, "alice-parfait");
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        playerOverrides: [
          {
            trashNormalCoreCount: 1,
            reserveNormalCoreCount: 0,
          },
          {},
        ],
        cardInstances: [source],
      }),
      turnNumber: 2,
      step: "main",
      window: "none",
    } as GameState;

    const queued = advanceStep(
      before,
      (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.step).toBe("main");
    expect(queued.window).toBe("step_end");
    expect(queued.pendingPrivateDeclarations).toHaveLength(0);
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(queued.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "start_step",
    });
    expect(
      queued.pendingTriggeredEffects[0]?.declaredFromPrivateZone
    ).toBeFalsy();

    const resolveAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === source.instanceId
    );
    expect(resolveAction).toBeDefined();

    const stacked = applyLegalAction({
      state: queued,
      action: resolveAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    const passAction = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const after = applyLegalAction({
      state: stacked,
      action: passAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(after.step).toBe("main");
    expect(after.window).toBe("step_end");
    expect(player(after, ALICE).trashNormalCoreCount).toBe(0);
    expect(player(after, ALICE).reserveNormalCoreCount).toBe(1);

    const advanced = advanceStep(
      after,
      (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(advanced.step).toBe("attack");
    expect(advanced.window).toBe("none");
  });
});

describe("BSKB01-T01 ヘビーロブスター", () => {
  const c = card("BSKB01-T01");
  it("トークン専用 + アタック時1ドロー/カウント以下コア数破壊 + 離脱時相互トラッシュ", () => {
    expect(c.keywordTags).toContain("token");
    expect(c.maxDeckCount).toBe(0);
    expect(c.maxTokenDeckCount).toBe(6);
    // textLines[2] (コア配置・移動・離脱時のボイド行き特殊ルール) は tokenIndependentCoreManagement
    // (ENGINE-token-independent-core-void-redirect、通常コア choke point) のエンジン基盤で
    // 自動処理され、専用 effects エントリ (stub) は不要になった (BSAZ02 grandwalkerData
    // precedent と同型)。ソウルコア分は 10_rules/06 の硬制約 (ボイドは常に不可、explicit
    // 指定でも soul をボイドに置けない) により、そもそも void 行きにならないため対応不要
    // (ENGINE-void-soul-core-count は adversarial verifier round1 lens1/6 で refute、
    // 別途 core-move-forced-void-redirect.test.ts にリグレッションガードを追加)。
    expect(c.tokenIndependentCoreManagement).toEqual({
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    });
    expect(c.effects).toHaveLength(2);
    expect(c.effects!.every((e) => e.stub === undefined)).toBe(true);

    const attack = c.effects![0]!;
    expect(attack.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    const destroy = attack.steps[1]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy" && "filter" in destroy.target) {
      expect(destroy.target.filter.maxCoresSource).toBe("self_count");
    }

    const leave = c.effects![1]!;
    expect(leave.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leave.preventionLevel).toBe("unpreventable");
    expect(leave.steps[0]!.action.kind).toBe("move_card");
    expect(leave.steps[1]!.connector).toBe("conditional_result");
  });

  it("このカードから離脱する通常コアはボイドへ強制振替される。ソウルコアは10_rules/06の硬制約(ボイド常に不可)によりリザーブのまま", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(c, {
          instanceId: "t1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      playerOverrides: [
        {
          soulCoreLocation: { kind: "card", instanceId: "t1" },
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 0,
        },
        {},
      ],
    });

    const next = resolveCardLeavesFieldCores(state, "t1", null, (id) =>
      cardNoMap.get(id)
    );

    expect(player(next, ALICE).reserveNormalCoreCount).toBe(0);
    expect(player(next, ALICE).voidNormalCoreCount).toBe(2);
    expect(player(next, ALICE).reserveSoulCoreCount).toBe(1);
    expect(player(next, ALICE).soulCoreLocation).toEqual({ kind: "reserve" });
  });
});

describe("BSKB01-TX01(A) [光の騎士]淵源を巡る英雄", () => {
  const c = card("BSKB01-TX01(A)");
  it("鋼騎士は静的系統で保持し、紫シンボル treat_as / 転醒(カウント1以上) rebirth / 全体コア除去をDSL表現する", () => {
    expect(c.tribe).toBe("鋼騎士・剣使");
    const treat = c.effects![0]!;
    expect(treat.steps[0]!.action).toEqual({
      kind: "treat_as",
      appliesToCard: true,
      aspects: ["symbol", "reduction_symbol"],
      asColor: "purple",
    });
    expect(treat.stub).toBeUndefined();

    const rebirth = c.effects![1]!;
    expect(rebirth.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 1,
    });
    expect(rebirth.stub).toBeUndefined();
    expect(rebirth.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(rebirth.executionMode).toBe("optional");
    expect(rebirth.steps).toEqual([
      {
        action: {
          kind: "set_exhaust_state",
          state: "recovered",
          target: { kind: "self" },
        },
      },
      { action: { kind: "rebirth" }, connector: "sequential" },
    ]);

    const drain = c.effects![2]!;
    expect(drain.stub).toBeUndefined();
    expect(drain.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    expect(drain.executionMode).toBe("optional");
    expect(drain.steps).toHaveLength(2);
    expect(drain.steps[0]!.action).toEqual({
      kind: "core_move",
      target: {
        kind: "filter",
        player: "either",
        filter: { category: ["spirit", "ultimate"] },
        count: "all",
        excludeSelf: true,
      },
      from: { kind: "target_card" },
      toTargetController: { kind: "reserve" },
      amount: 1,
    });
    expect(drain.steps[1]).toMatchObject({
      connector: "after_state_check",
      stepCondition: {
        kind: "ref_leave_established",
        stepId: "tx01-drain-all",
        leaveKind: "vanish",
      },
      executionMode: "optional",
    });
    expect(drain.steps[1]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
      amount: {
        source: {
          kind: "cards_from_ref",
          stepId: "tx01-drain-all",
          establishedLeaveKind: "vanish",
        },
      },
    });
  });

  it("召喚/アタック時: このスピリット以外の自分/相手スピリットから1個ずつリザーブへ置き、消滅数だけボイドから補充する", () => {
    const source = createCardInstance(c, {
      instanceId: "tx01-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const allyVanish = createCardInstance(card("BSKB01-C02"), {
      instanceId: "ally-vanish",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const allyStay = createCardInstance(card("BSKB01-C03"), {
      instanceId: "ally-stay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const enemyVanish = createCardInstance(card("BSKB01-C02"), {
      instanceId: "enemy-vanish",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyStay = createCardInstance(card("BSKB01-C03"), {
      instanceId: "enemy-stay",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    let current = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, allyVanish, allyStay, enemyVanish, enemyStay],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 5 },
        { reserveNormalCoreCount: 0 },
      ],
    });

    current = executeEffect({
      chainId: "test:bskb01-cards:7004",
      state: current,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    while (current.pendingStepOptionalChoice) {
      const optional = current.pendingStepOptionalChoice;
      current = applyLegalAction({
        state: current,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${optional.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: optional.choosingPlayerId,
          pendingId: optional.pendingId,
          sourceInstanceId: optional.sourceInstanceId,
          effectIndex: optional.effectIndex,
          stepIndex: optional.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
    }

    const byId = (id: string) =>
      current.cardInstances.find((card) => card.instanceId === id)!;

    expect(byId("tx01-source").normalCoreCount).toBe(5);
    expect(byId("ally-vanish").zone).not.toBe("field");
    expect(byId("enemy-vanish").zone).not.toBe("field");
    expect(byId("ally-stay").zone).toBe("field");
    expect(byId("ally-stay").normalCoreCount).toBe(1);
    expect(byId("enemy-stay").zone).toBe("field");
    expect(byId("enemy-stay").normalCoreCount).toBe(1);
    expect(player(current, ALICE).reserveNormalCoreCount).toBe(2);
    expect(player(current, BOB).reserveNormalCoreCount).toBe(2);
    expect(player(current, ALICE).voidNormalCoreCount).toBe(3);
    expect(current.pendingStepOptionalChoice).toBeNull();
    expect(current.pendingStepOptionalTargetSelection).toBeNull();
  });

  it("召喚/アタック時: 対象がいない場合は toTargetController 解決で throw せず no-op にする", () => {
    const source = createCardInstance(c, {
      instanceId: "tx01-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 5 },
        { reserveNormalCoreCount: 0 },
      ],
    });

    const current = executeEffect({
      chainId: "test:bskb01-cards:7069",
      state,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    const sourceAfter = current.cardInstances.find(
      (card) => card.instanceId === source.instanceId
    )!;
    expect(sourceAfter.normalCoreCount).toBe(3);
    expect(player(current, ALICE).reserveNormalCoreCount).toBe(0);
    expect(player(current, BOB).reserveNormalCoreCount).toBe(0);
    expect(current.pendingStepOptionalChoice).toBeNull();
    expect(current.pendingStepOptionalTargetSelection).toBeNull();
    expect(current.pendingLifeCoreSelection).toBeNull();
  });

  it("召喚/アタック時: 所有者ではなく対象の controller 側リザーブへコアを置く", () => {
    const source = createCardInstance(c, {
      instanceId: "tx01-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const borrowedTarget = createCardInstance(card("BSKB01-C03"), {
      instanceId: "borrowed-target",
      ownerPlayerId: ALICE,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, borrowedTarget],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 5 },
        { reserveNormalCoreCount: 0 },
      ],
    });

    const current = executeEffect({
      chainId: "test:bskb01-cards:7114",
      state,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    const targetAfter = current.cardInstances.find(
      (card) => card.instanceId === borrowedTarget.instanceId
    )!;
    expect(targetAfter.normalCoreCount).toBe(1);
    expect(player(current, ALICE).reserveNormalCoreCount).toBe(0);
    expect(player(current, BOB).reserveNormalCoreCount).toBe(1);
    expect(current.pendingStepOptionalChoice).toBeNull();
    expect(current.pendingLifeCoreSelection).toBeNull();
  });

  it.each(["exhausted", "heavily_exhausted"] as const)(
    "相手起因で離れるとき: %sから回復状態にして裏返り、離脱 pending を解除して場に残る",
    (exhaustState) => {
      const source = createCardInstance(c, {
        instanceId: "tx01-rebirth-source",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
        exhaustState,
      });
      const before = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source],
        playerOverrides: [{ countValue: 1 }, {}],
      });
      const pending = queuePendingLeave({
        state: before,
        instanceId: source.instanceId,
        kind: "destroy",
        cause: "opponent_effect",
        chainId: "test-chain:bskb01-tx01-rebirth",
        causePlayerId: BOB,
      });

      const after = executeEffect({
        chainId: "test:bskb01-cards:7159",
        state: pending,
        effect: c.effects![1]!,
        effectIndex: 1,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      });

      const flipped = after.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )!;
      expect(flipped.definitionId).toBe("BSKB01-TX01(B)");
      expect(flipped.zone).toBe("field");
      expect(flipped.exhaustState).toBe("recovered");
      expect(flipped.normalCoreCount).toBe(3);
      expect(player(after, ALICE).countValue).toBe(2);
      expect(
        after.pendingLeaveEntities.some(
          (leave) => leave.instanceId === source.instanceId
        )
      ).toBe(false);
    }
  );

  it("召喚/アタック時: core_move_amount_modifier は全体1個ずつ除去の対象ごとに再適用しない", () => {
    const source = createCardInstance(c, {
      instanceId: "tx01-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const enemyA = createCardInstance(card("BSKB01-C03"), {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const enemyB = createCardInstance(card("BSKB01-C03"), {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, enemyA, enemyB],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 5 },
        { reserveNormalCoreCount: 0 },
      ],
    });
    const modifier: ContinuousEffect = {
      effectId: "test-tx01-core-move-bonus",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: c.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "core_move_amount_modifier",
      modifierAmount: 2,
      metadata: { coreMoveAmountScope: "self_player_spirits" },
    };
    let current: GameState = {
      ...base,
      activeContinuousEffects: [...base.activeContinuousEffects, modifier],
    };

    current = executeEffect({
      chainId: "test:bskb01-cards:7232",
      state: current,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });

    const bonusAction = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    expect(bonusAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: bonusAction,
      coreSourceAllocations: { "enemy-a": 2 },
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    }).state;
    while (current.pendingStepOptionalChoice) {
      const optional = current.pendingStepOptionalChoice;
      current = applyLegalAction({
        state: current,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${optional.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: optional.choosingPlayerId,
          pendingId: optional.pendingId,
          sourceInstanceId: optional.sourceInstanceId,
          effectIndex: optional.effectIndex,
          stepIndex: optional.stepIndex,
          choice: "decline",
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
    }

    const byId = (id: string) =>
      current.cardInstances.find((card) => card.instanceId === id)!;
    expect(byId(enemyA.instanceId).zone).not.toBe("field");
    expect(byId(enemyB.instanceId).zone).toBe("field");
    expect(byId(enemyB.instanceId).normalCoreCount).toBe(2);
    expect(player(current, BOB).reserveNormalCoreCount).toBe(4);
    expect(
      current.log.filter((line) =>
        line.startsWith("effect:core_move_amount_modifier:applied:")
      )
    ).toEqual([
      "effect:core_move_amount_modifier:applied:player-1:+2:target_group",
    ]);
    expect(current.pendingStepOptionalChoice).toBeNull();
  });

  it("召喚/アタック時: 通常/ソウル混在対象の持ち主選択で中断しても、resume 後に残り対象を1回だけ処理する", () => {
    const source = createCardInstance(c, {
      instanceId: "tx01-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const soulChoiceTarget = createCardInstance(card("BSKB01-C03"), {
      instanceId: "soul-choice-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const laterVanish = createCardInstance(card("BSKB01-C02"), {
      instanceId: "later-vanish",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    let current = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, soulChoiceTarget, laterVanish],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 5 },
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: soulChoiceTarget.instanceId,
          },
        },
      ],
    });

    current = executeEffect({
      chainId: "test:bskb01-cards:7330",
      state: current,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
    });
    expect(current.pendingLifeCoreSelection).toMatchObject({
      actingPlayerId: BOB,
      totalAmount: 1,
      fromLocation: {
        kind: "card_instance",
        instanceId: soulChoiceTarget.instanceId,
      },
    });
    expect(
      current.pendingLifeCoreSelection?.continuation?.initialStepResults?.[0]
        ?.affectedCardInstanceIds
    ).toEqual([soulChoiceTarget.instanceId]);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === laterVanish.instanceId
      )?.normalCoreCount
    ).toBe(1);

    const partitionAction = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(partitionAction).toBeDefined();

    current = applyLegalAction({
      state: current,
      action: partitionAction!,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions,
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    while (current.pendingStepOptionalChoice) {
      const optional = current.pendingStepOptionalChoice;
      current = applyLegalAction({
        state: current,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${optional.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: optional.choosingPlayerId,
          pendingId: optional.pendingId,
          sourceInstanceId: optional.sourceInstanceId,
          effectIndex: optional.effectIndex,
          stepIndex: optional.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions,
      }).state;
    }

    const byId = (id: string) =>
      current.cardInstances.find((card) => card.instanceId === id)!;

    expect(current.pendingLifeCoreSelection).toBeNull();
    expect(player(current, BOB).soulCoreLocation).toEqual({ kind: "reserve" });
    expect(byId(soulChoiceTarget.instanceId).zone).toBe("field");
    expect(byId(soulChoiceTarget.instanceId).normalCoreCount).toBe(1);
    expect(byId(laterVanish.instanceId).zone).not.toBe("field");
    expect(byId(source.instanceId).normalCoreCount).toBe(4);
    expect(player(current, BOB).reserveNormalCoreCount).toBe(1);
    expect(player(current, ALICE).voidNormalCoreCount).toBe(4);
  });
});

describe("EDH-0022 after_triggers transformed source continuation", () => {
  it("retains the declared front-side effect definition when the source has transformed", () => {
    const front = card("BSKB01-TX01(A)");
    const definitions = new Map(
      expandCardDefinitionsWithBackFaces(ALL_CARDS).map((definition) => [
        definition.cardNo,
        definition,
      ])
    );
    const transformedSource = createCardInstance(
      definitions.get("BSKB01-TX01(B)")!,
      {
        instanceId: "tx01-transformed-source",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      }
    );
    const vanished = createCardInstance(card("BSKB01-C02"), {
      instanceId: "tx01-vanished-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const stepCtx = createStepExecutionContext();
    recordStepResult(stepCtx, {
      stepId: "tx01-drain-all",
      affectedCardInstanceIds: [vanished.instanceId],
      establishedLeaveKindsByCardId: { [vanished.instanceId]: "vanish" },
      succeeded: true,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [transformedSource, vanished],
        playerOverrides: [{ voidNormalCoreCount: 1 }, {}],
      }),
      // 前段のコア除去が after_triggers で中断した後、発生した転醒によって
      // instance は裏面定義になっている。それでも再開は表面 effects[2] の本文を使う。
      pendingAfterTriggersContinuations: [
        {
          chainId: "test:bskb01-cards:7450",
          continuationId: "after-triggers:edh-0022:transformed-source",
          waitChainId: "chain:edh-0022:tx01-drain",
          sourceDefinitionId: front.cardNo,
          effectIndex: 2,
          sourceInstanceId: transformedSource.instanceId,
          actingPlayerId: ALICE,
          resumeStepIndex: 1,
          stepContext: serializeStepContext(stepCtx),
        },
      ],
    };

    const resumed = resumeStackCascadeIfReady(state, {
      getCardDefinitionById: (id) => definitions.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    const pending = resumed.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    if (!pending) throw new Error("expected TX01 optional choice");
    // Prompt metadata follows the current card face, but its executable continuation
    // must continue to point to the definition from which the effect was declared.
    expect(pending.sourceDefinitionId).toBe("BSKB01-TX01(B)");
    expect(pending.continuation.sourceDefinitionId).toBe(front.cardNo);

    const afterDecline = applyLegalAction({
      state: resumed,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.choosingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: (id) => definitions.get(id),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
  });
});
