/**
 * BSTH02.7-TX01(A)「グランギニョル座の怪人」effects[0]:
 * 〔ターンに1回:同名〕手札にあるこのカードは、相手によって自分のライフが減ったとき、
 * 相手のスピリット/アルティメット1体を手札に戻せる。
 *
 * 新規プリミティブ: TriggerEventKind "reduce_life" を card_event/game_event DSL の
 * event 文字列として使えるように配線し (structured-effect-registrations.ts
 * TRIGGER_EVENT_META.reduce_life)、cause (self_effect/opponent_effect) を
 * count_increase/count_decrease と同型で計算するようにした (trigger-system.ts
 * collectTriggerEventsFromStateDelta)。「相手によって」の cause SSOT
 * (["opponent_effect","battle"]) は BSAZ03-M01/BSDB01-M02 と同じ。
 *
 * 発揮元が手札 (非公開ゾーン) のため、誘発は pendingPrivateDeclarations 経由
 * (BSDB01-M02 effects[2] と同型、bsdb01-cards.test.ts 参照)。
 * 「戻したとき、この効果発揮後、このカードの【転醒】を発揮できる」follow-up
 * (ENGINE-magic-rebirth-from-hand) の検証は
 * bsth02-7-tx01-magic-rebirth-from-hand.test.ts を参照。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolveLifeDamage } from "../src/core/core-system";
import { executeBattleResolution } from "../src/battle/battle-actions";
import { applyLegalAction } from "../src";
import type { CardDefinition, GameState, ActiveAttack } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const TX01 = cardNoMap.get("BSTH02.7-TX01(A)")!;

const ALICE = "alice";
const BOB = "bob";

function makeOpponentSpiritDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH02-7-TX01-OPP-SPIRIT",
    name: "テスト相手スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function setup() {
  const spiritDef = makeOpponentSpiritDef();
  const opponentSpirit = createCardInstance(spiritDef, {
    instanceId: "opp-spirit-1",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const handCard = createCardInstance(TX01, {
    instanceId: "tx01-hand-1",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const before: GameState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [opponentSpirit, handCard],
    playerOverrides: [{ lifeNormalCoreCount: 3 }, {}],
  });
  const defs = new Map<string, CardDefinition>([
    [TX01.cardNo, TX01],
    [spiritDef.cardNo, spiritDef],
  ]);
  const getDef = (id: string) => defs.get(id);
  const lookup = buildTriggeredEffectLookup([TX01, spiritDef]);
  return { before, opponentSpirit, handCard, getDef, lookup };
}

describe("BSTH02.7-TX01(A) effects[0]: 手札トリガー(相手によって自分のライフが減ったとき)", () => {
  it("effect 定義: applicability.zone:hand + game_event(player:self, reduce_life, cause:opponent) + usageLimit per_card_name", () => {
    const effect = TX01.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "reduce_life",
      cause: ["opponent_effect", "battle"],
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps[0]!.action).toEqual({
      kind: "bounce",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      },
    });
  });

  it("effects[0] の【転醒】ステップ: rebirth.maxCount が印字条件(9)と一致する", () => {
    const rebirthEffect = TX01.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    const rebirthStep = rebirthEffect.steps.find((s) => s.id === "rebirth")!;
    expect(rebirthStep.action).toEqual({
      kind: "rebirth",
      maxCount: 9,
      allowPostRebirthCorePlacementForLvDeficit: true,
    });
  });

  it("相手起因で自分のライフが減ったとき、手札のこのカードが private declaration 候補に含まれる", () => {
    const ctx = setup();
    const afterLifeDamage = resolveLifeDamage(ctx.before, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });

    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: afterLifeDamage,
      source: "action_resolution",
      chainId: "tx01-reduce-life-chain",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === ctx.handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("reduce_life");
    expect(declaration!.event?.cause).toBe("opponent_effect");
    expect(declaration!.ownerPlayerId).toBe(ALICE);
  });

  it("自分起因 (self_effect) でライフが減ったときは、誘発候補が queue されない (cause 不一致)", () => {
    const ctx = setup();
    const afterLifeDamage = resolveLifeDamage(ctx.before, ALICE, 1, [], {
      cause: "self_effect",
      actingPlayerId: ALICE,
    });

    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: afterLifeDamage,
      source: "action_resolution",
      chainId: "tx01-self-reduce-life-chain",
      attackId: null,
      causedByPlayerId: ALICE,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingPrivateDeclarations.find(
        (d) => d.sourceInstanceId === ctx.handCard.instanceId
      )
    ).toBeUndefined();
    expect(
      queued.pendingTriggeredEffects.find((p) => p.eventKind === "reduce_life")
    ).toBeUndefined();
  });

  it("[統合] 相手のアンブロックアタックによるライフ減少をcause:battleのまま手札の候補へ伝える", () => {
    const spiritDef = makeOpponentSpiritDef();
    const attacker = createCardInstance(spiritDef, {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(TX01, {
      instanceId: "tx01-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:tx01-reduce-life:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const midBattleState: GameState = {
      ...createEmptyGameState({
        playerIds: [BOB, ALICE],
        cardInstances: [attacker, handCard],
      }),
      turnNumber: 2,
      activePlayerId: BOB,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["attacker-1"],
        },
      ],
    };
    const defs = new Map<string, CardDefinition>([
      [TX01.cardNo, TX01],
      [spiritDef.cardNo, spiritDef],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([TX01, spiritDef]);

    const resolved = executeBattleResolution({
      state: midBattleState,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = resolved.state.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("reduce_life");
    expect(declaration!.event?.cause).toBe("battle");
    expect(declaration!.ownerPlayerId).toBe(ALICE);
  });

  it("実行: bounce で相手スピリットが手札に戻る", () => {
    const ctx = setup();
    const effect = TX01.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    const result = executeEffect({
      chainId: "test:bsth02-7-tx01-reduce-life-hand-trigger:254",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: ctx.getDef,
    });
    const bounced = result.cardInstances.find(
      (c) => c.instanceId === ctx.opponentSpirit.instanceId
    )!;
    expect(bounced.zone).toBe("hand");
  });

  it("[統合] private declaration 解決入口で手札マジックは in_use に移り、転醒辞退後はトラッシュへ置かれる", () => {
    const ctx = setup();
    const afterLifeDamage = resolveLifeDamage(ctx.before, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: afterLifeDamage,
      source: "action_resolution",
      chainId: "tx01-private-in-use-chain",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });

    const declaration = queued.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === ctx.handCard.instanceId
    );
    expect(declaration).toBeDefined();
    const declareAction = {
      chainId: "test:bsth02-7-tx01-reduce-life-hand-trigger:289",
      kind: "declare_private_triggered_effect" as const,
      actionId: `declare_private_triggered_effect:${declaration!.declarationId}`,
      can: true as const,
      reason: "test",
      actingPlayerId: ALICE,
      declarationId: declaration!.declarationId,
      eventKind: declaration!.eventKind,
      sourceInstanceId: declaration!.sourceInstanceId,
      sourceDefinitionId: declaration!.sourceDefinitionId,
      sourceCardNo: TX01.cardNo,
      registrationIndex: declaration!.registrationIndex,
    };

    const declared = applyLegalAction({
      state: queued,
      action: declareAction!,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    }).state;
    expect(
      declared.cardInstances.find(
        (c) => c.instanceId === ctx.handCard.instanceId
      )?.zone
    ).toBe("hand");

    const pendingTriggered = declared.pendingTriggeredEffects.find(
      (pending) => pending.pendingId === declaration!.pendingId
    );
    expect(pendingTriggered).toBeDefined();
    const resolveAction = {
      chainId: "test:bsth02-7-tx01-reduce-life-hand-trigger:319",
      kind: "resolve_pending_triggered_effect" as const,
      actionId: `resolve_pending_triggered_effect:${pendingTriggered!.pendingId}`,
      can: true as const,
      reason: "test",
      actingPlayerId: ALICE,
      pendingId: pendingTriggered!.pendingId,
      eventKind: pendingTriggered!.eventKind,
      executionMode: "optional" as const,
      sourceKind: "magic" as const,
      sourceInstanceId: ctx.handCard.instanceId,
      sourceDefinitionId: TX01.cardNo,
      sourceCardNo: TX01.cardNo,
      registrationIndex: declaration!.registrationIndex,
      targetMode: "manual" as const,
      requiredTargetCount: 1,
      targetEffectFilterTags: ["general"] as const,
      candidateTargetInstanceIds: [ctx.opponentSpirit.instanceId],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    };

    const afterResolve = applyLegalAction({
      state: declared,
      action: resolveAction,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getPendingTriggeredEffectResolver: () => undefined,
    }).state;
    const pending = afterResolve.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    expect(
      afterResolve.cardInstances.find(
        (c) => c.instanceId === ctx.handCard.instanceId
      )?.zone
    ).toBe("in_use");

    const declined = applyLegalAction({
      state: afterResolve,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending!.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.actingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    }).state;

    expect(
      declined.cardInstances.find(
        (c) => c.instanceId === ctx.handCard.instanceId
      )
    ).toMatchObject({
      zone: "trash",
      definitionId: "BSTH02.7-TX01(A)",
    });
  });
});
