import { finishCoreChoices } from "./helpers/core-choice-driver";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  expandCardDefinitionsWithBackFaces,
  filterRestrictedTimings,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeEndBattle } from "../src/effect/structured-state-grants";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { getRequiredBattleCostGateAmount } from "../src/battle/battle-availability";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { checkAndQueueStoneRebirthChoices } from "../src/mechanics/grandstone-system";
import {
  getCombinedUnitCost,
  getEffectiveCost,
  getUsageLimitMaxCount,
} from "../src/legal/legal-actions-shared";
import type { CardDefinition, ContinuousEffect } from "../src/model";
import { flushPendingLeaves } from "../src/state-based-actions";

const defs = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);
const getDef = (id: string) => defs.get(id);
const ALICE = "alice";
const BOB = "bob";

describe("back-face coverage effects", () => {
  it.each([
    ["BSKB01-TX01(B)", [2, 3, 4, 5, 6]],
    ["BSLH01-TR02(B)", [2, 3]],
    ["BSLH01-TR03(B)", [2, 3]],
    ["BSLH01-TR04(B)", [8, 9]],
    ["BSTH005-TX01(B)", [2, 3]],
    ["BSTH02.7-TR01(B)", [2, 3]],
    ["BSTH02.7-TR02(B)", [2, 3]],
    ["BSTH02.7-TR03(B)", [2, 3]],
    ["BSTH08-転醒R01(B)", [2, 3]],
    ["BSTH09-TR01(B)", [5, 6]],
  ])("%s exposes its text-referenced executable effect", (cardNo, textRef) => {
    const card = defs.get(cardNo)!;
    expect(
      card.effects?.some((effect) =>
        effect.textRef?.every((line) => textRef.includes(line))
      )
    ).toBe(true);
  });

  it("BSDB01-R04 set effect returns every eligible opposing permanent to the bottom", () => {
    const r04 = defs.get("BSDB01-R04")!;
    const vegeta = ALL_CARDS.find(
      (card) => card.name.includes("ベジータ") && card.cost >= 9
    )!;
    const enemy = defs.get("BSDB01-C01")!;
    const source = createCardInstance(r04, {
      instanceId: "r04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const vegetaInstance = createCardInstance(vegeta, {
      instanceId: "vegeta",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const enemyInstance = createCardInstance(enemy, {
      instanceId: "enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, vegetaInstance, enemyInstance],
      playerOverrides: [{ countValue: 21 }, {}],
    });
    const afterEffect = executeEffect({
      chainId: "test:backface-effects-regression:92",
      state: before,
      effect: r04.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = flushPendingLeaves(afterEffect, getDef);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === enemyInstance.instanceId
      )?.zone
    ).toBe("deck");
  });

  it("BSKB01-TX01(B) offers a two-core shot across separate opposing spirits", () => {
    const sourceDef = defs.get("BSKB01-TX01(B)")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "metaknight",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const first = createCardInstance(defs.get("BSKB01-C01")!, {
      instanceId: "enemy-first",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const second = createCardInstance(defs.get("BSKB01-R01")!, {
      instanceId: "enemy-second",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const initial = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, first, second],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const coreShot = sourceDef.effects![0]!.steps[1]!.action;
    expect(coreShot.kind).toBe("core_move");
    const pendingShoot = executeEffect({
      chainId: "test:backface-effects-regression:136",
      state: initial,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: coreShot }],
      },
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(pendingShoot.pendingCoreShootSelection?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: first.instanceId }),
        expect.objectContaining({ instanceId: second.instanceId }),
      ])
    );
    const chooseSources = getLegalActions({
      state: pendingShoot,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_core_shoot");
    expect(chooseSources).toBeDefined();
    const after = applyLegalAction({
      state: pendingShoot,
      action: chooseSources!,
      coreShootDistribution: {
        [first.instanceId]: 1,
        [second.instanceId]: 1,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(
      after.cardInstances.find((card) => card.instanceId === first.instanceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((card) => card.instanceId === second.instanceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.players.find((player) => player.id === BOB)?.trashNormalCoreCount
    ).toBe(2);
  });

  it("BSKB01-TX01(B) forces its revealed-hand spirit discard to be chosen by the controller", () => {
    const sourceDef = defs.get("BSKB01-TX01(B)")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "metaknight-hand-discard",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const firstSpirit = createCardInstance(defs.get("BSKB01-C01")!, {
      instanceId: "opponent-hand-spirit-one",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const secondSpirit = createCardInstance(defs.get("BSKB01-R01")!, {
      instanceId: "opponent-hand-spirit-two",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const effect = sourceDef.effects![0]!;
    const revealStep = effect.steps[2]!;
    const discardStep = effect.steps[3]!;
    expect(revealStep.executionMode).not.toBe("optional");
    expect(discardStep.executionMode).not.toBe("optional");
    expect(discardStep.action.kind).toBe("discard");
    if (discardStep.action.kind !== "discard") {
      throw new Error("expected BSKB01 revealed-hand discard action");
    }
    expect(discardStep.action.selectionPlayer).toBe("effect_controller");

    // The outer attack/rebirth effect remains optional to start, but once its
    // two-count branch is reached this individual sentence is mandatory.
    const pending = executeEffect({
      chainId: "test:backface-effects-regression:213",
      state: createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, firstSpirit, secondSpirit],
        playerOverrides: [{}, { handCount: 2 }],
      }),
      effect: {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        steps: [{ action: discardStep.action }],
      },
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(pending.pendingZoneSelection).toMatchObject({
      actingPlayerId: ALICE,
      canSkip: false,
      candidateCardInstanceIds: expect.arrayContaining([
        firstSpirit.instanceId,
        secondSpirit.instanceId,
      ]),
    });
  });

  it("BSLH01-TR02(B) restricts only a CB spirit costing at least six as a stack source", () => {
    const quartzDef = defs.get("BSLH01-TR02(B)")!;
    const cbSix: CardDefinition = {
      ...quartzDef,
      cardNo: "TEST-CB-STACK-SIX",
      cost: 6,
      effects: [],
    };
    const cbFive: CardDefinition = {
      ...cbSix,
      cardNo: "TEST-CB-STACK-FIVE",
      cost: 5,
    };
    const nonCbSix: CardDefinition = {
      ...cbSix,
      cardNo: "TEST-NON-CB-STACK-SIX",
      tribe: "星霊",
    };
    const lookup = (id: string) =>
      id === cbSix.cardNo
        ? cbSix
        : id === cbFive.cardNo
          ? cbFive
          : id === nonCbSix.cardNo
            ? nonCbSix
            : getDef(id);
    const quartz = createCardInstance(quartzDef, {
      instanceId: "quartz",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const eligible = createCardInstance(cbSix, {
      instanceId: "eligible-cb",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const ineligible = createCardInstance(cbFive, {
      instanceId: "ineligible-cb",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const nonCb = createCardInstance(nonCbSix, {
      instanceId: "ineligible-non-cb",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const state = executeEffect({
      chainId: "test:backface-effects-regression:285",
      state: {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [quartz, eligible, ineligible, nonCb],
        }),
        step: "attack",
        activePlayerId: ALICE,
        players: createEmptyGameState({ playerIds: [ALICE, BOB] }).players.map(
          (player) =>
            player.id === ALICE
              ? { ...player, soulStateInstanceIds: [quartz.instanceId] }
              : player
        ),
      },
      effect: quartzDef.effects![3]!,
      sourceInstanceId: quartz.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      filterRestrictedTimings(
        ["stack"],
        state,
        BOB,
        undefined,
        lookup,
        undefined,
        "field",
        eligible.instanceId,
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual([]);
    expect(
      filterRestrictedTimings(
        ["stack"],
        state,
        BOB,
        undefined,
        lookup,
        undefined,
        "field",
        ineligible.instanceId,
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual(["stack"]);
    expect(
      filterRestrictedTimings(
        ["stack"],
        state,
        BOB,
        undefined,
        lookup,
        undefined,
        "field",
        nonCb.instanceId,
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual(["stack"]);
    expect(quartzDef.effects![0]!.executionMode).not.toBe("optional");
  });

  it("BSLH01-TR03(B) charges its designated attacker only for the attack step's first battle", () => {
    const quartzDef = defs.get("BSLH01-TR03(B)")!;
    const quartz = createCardInstance(quartzDef, {
      instanceId: "tr03-quartz",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const attacker = createCardInstance(defs.get("BSKB01-TX01(B)")!, {
      instanceId: "designated-attacker",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const initial = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [quartz, attacker],
      playerOverrides: [{ soulStateInstanceIds: [quartz.instanceId] }, {}],
    });
    const registered = executeEffect({
      chainId: "test:backface-effects-regression:366",
      state: { ...initial, step: "attack", activePlayerId: BOB },
      effect: quartzDef.effects![2]!,
      sourceInstanceId: quartz.instanceId,
      actingPlayerId: ALICE,
      targetInstanceIds: [attacker.instanceId],
      targetSelectionResolved: true,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      getRequiredBattleCostGateAmount(registered, attacker, getDef, [
        "battle_cost_gate_attack",
      ])
    ).toBe(2);
    expect(
      getRequiredBattleCostGateAmount(
        {
          ...registered,
          battlesEndedThisTurn: 5,
          battlesEndedThisAttackStep: 1,
        },
        attacker,
        getDef,
        ["battle_cost_gate_attack"]
      )
    ).toBe(0);
    expect(
      getRequiredBattleCostGateAmount(
        {
          ...registered,
          battlesEndedThisTurn: 5,
          battlesEndedThisAttackStep: 0,
        },
        attacker,
        getDef,
        ["battle_cost_gate_attack"]
      )
    ).toBe(2);
    expect(quartzDef.effects![0]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
  });

  it("effect:end_battle advances the same attack-step first-battle tally", () => {
    const attackerDef = defs.get("BSKB01-TX01(B)")!;
    const attacker = createCardInstance(attackerDef, {
      instanceId: "effect-ended-attacker",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const attackId = "effect-ended-battle";
    const entityId = "battle-entity:effect-ended-attacker";
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "declare_attack" as const,
      battlesEndedThisTurn: 4,
      battlesEndedThisAttackStep: 0,
      activeAttack: {
        attackId,
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 5000,
          resolvedSymbols: [],
          attackState: "attacking" as const,
        },
      ],
    };
    const ended = executeEndBattle(state, ALICE, false, getDef, () => []);
    expect(ended.battlesEndedThisTurn).toBe(5);
    expect(ended.battlesEndedThisAttackStep).toBe(1);
  });

  it("mandatory back-face effects cannot be declined before their optional trailing step", () => {
    expect(defs.get("BSLH01-TR02(B)")!.effects![0]!.executionMode).not.toBe(
      "optional"
    );
    expect(defs.get("BSTH005-TX01(B)")!.effects![0]!.executionMode).not.toBe(
      "optional"
    );
    const bsth08Effect = defs.get("BSTH08-転醒R01(B)")!.effects![0]!;
    expect(bsth08Effect.executionMode).not.toBe("optional");
    expect(bsth08Effect.steps[2]!.executionMode).toBe("optional");
  });

  it("BSLH01-TR03(B) forces count +1 before offering its optional reverse-side choice", () => {
    const quartzDef = defs.get("BSLH01-TR03(B)")!;
    const quartz = createCardInstance(quartzDef, {
      instanceId: "tr03-end-step-quartz",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const effect = quartzDef.effects![1]!;
    expect(effect.executionMode).not.toBe("optional");
    expect(effect.steps[0]!.executionMode).not.toBe("optional");
    expect(effect.steps[1]!.executionMode).toBe("optional");
    const afterCount = executeEffect({
      chainId: "test:backface-effects-regression:485",
      state: createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [quartz],
        playerOverrides: [{ countValue: 4 }, {}],
      }),
      effect,
      effectIndex: 1,
      sourceInstanceId: quartz.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      afterCount.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(5);
    expect(afterCount.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: ALICE,
      stepIndex: 1,
      canDecline: true,
    });
    const decline = getLegalActions({
      state: afterCount,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(decline).toBeDefined();
  });

  it("BSLH01-TR03(B) reverses and deploys its parent backFace without paying cost", () => {
    const backDef = defs.get("BSLH01-TR03(B)")!;
    const frontDef = defs.get("BSLH01-TR03(A)")!;
    const back = {
      ...createCardInstance(backDef, {
        instanceId: "tr03-free-reverse",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      originalDefinitionId: frontDef.cardNo,
    };
    // B 面自身ではなく、継承/付与先を想定した別 source から B 面の effect を実行する。
    // pending 解決後も effect-source だけが置換後 A 面を指し、元 source は変わらないことを
    // 最後の reverse_rebirth で観測する。
    const inheritedEffectHost = {
      ...createCardInstance(backDef, {
        instanceId: "tr03-inherited-effect-host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
      originalDefinitionId: frontDef.cardNo,
    };
    const effect = {
      ...backDef.effects![1]!,
      // pattern2 pending の解決後にのみ進む後続 step を足し、元の無償配置が StepResult を
      // succeeded として引き継ぎ、置換後 A 面 instance から再開することを検証する。
      steps: [
        ...backDef.effects![1]!.steps.map((step, index) =>
          index === 1 ? { ...step, id: "reverse-choice" } : step
        ),
        {
          connector: "if_succeeded" as const,
          action: {
            kind: "count_increase" as const,
            player: "self" as const,
            amount: 1,
          },
        },
        {
          connector: "sequential" as const,
          stepCondition: {
            kind: "ref_choice" as const,
            stepId: "reverse-choice",
            choiceIndex: 2,
          },
          action: {
            kind: "count_increase" as const,
            player: "self" as const,
            amount: 1,
          },
        },
        {
          connector: "sequential" as const,
          action: {
            kind: "reverse_rebirth" as const,
            mode: "flip" as const,
          },
        },
      ],
    };
    // The replacement A face observes only count increases caused by itself.  This
    // makes the final state-delta cause observable: a stale B-face ID cannot queue
    // this trigger after the deferred placement resolves.
    const frontWithCountCauseObserver: CardDefinition = {
      ...frontDef,
      effects: [
        ...(frontDef.effects ?? []),
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "count_increase",
            requireTriggerSelf: true,
          },
          steps: [{ action: { kind: "noop" } }],
        },
      ],
    };
    const localDefinitions = new Map<string, CardDefinition>([
      [frontWithCountCauseObserver.cardNo, frontWithCountCauseObserver],
    ]);
    const lookup = (id: string) => localDefinitions.get(id) ?? getDef(id);
    const triggeredLookup = (id: string) => {
      const definition = lookup(id);
      return definition ? generateTriggeredEffectRegistrations(definition) : [];
    };
    const afterCount = executeEffect({
      chainId: "test:backface-effects-regression:606",
      state: createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [back, inheritedEffectHost],
        playerOverrides: [{ countValue: 4, reserveNormalCoreCount: 0 }, {}],
      }),
      effect,
      effectIndex: 1,
      sourceInstanceId: inheritedEffectHost.instanceId,
      actingPlayerId: ALICE,
      effectSourceInstanceId: back.instanceId,
      effectSourceDefinitionId: backDef.cardNo,
      sourceCardReferenceInstanceId: back.instanceId,
      getCardDefinitionById: lookup,
      promptUnresolvedChoice: true,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(
      afterCount.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(5);
    const chooseFreeReverse = getLegalActions({
      state: afterCount,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 2
    );
    expect(chooseFreeReverse).toBeDefined();
    const pendingPlacement = applyLegalAction({
      state: afterCount,
      action: chooseFreeReverse!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(pendingPlacement.pendingReverseRebirthSummon).toMatchObject({
      sourceInstanceId: back.instanceId,
      frontDefinitionId: frontDef.cardNo,
      costToPay: 0,
      minimumCoreCount: 0,
      continuation: {
        sourceInstanceId: inheritedEffectHost.instanceId,
        effectSourceInstanceId: back.instanceId,
        effectSourceDefinitionId: backDef.cardNo,
        sourceCardReferenceInstanceId: back.instanceId,
      },
    });
    const resolvePlacement = getLegalActions({
      state: pendingPlacement,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
    }).find((action) => action.kind === "resolve_reverse_rebirth_summon");
    expect(resolvePlacement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: pendingPlacement,
      action: resolvePlacement!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(afterPlacement.pendingReverseRebirthSummon).toBeNull();
    const replacement = afterPlacement.cardInstances.find(
      (card) => card.definitionId === frontDef.cardNo && card.zone === "field"
    );
    expect(replacement).toBeDefined();
    expect(afterPlacement.pendingTriggeredEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "count_increase",
          relatedInstanceId: replacement!.instanceId,
        }),
      ])
    );
    // 最終 step の flip は effect-source（置換後 A 面）に向くため no-op となる。metadata を
    // 落として継承元 source へ戻る実装なら、こちらの B 面 host が表返しされてこの検証が失敗する。
    expect(
      afterPlacement.cardInstances.find(
        (card) => card.instanceId === inheritedEffectHost.instanceId
      )?.definitionId
    ).toBe(backDef.cardNo);
    const alice = afterPlacement.players.find((player) => player.id === ALICE)!;
    expect(alice.countValue).toBe(7);
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("BSTH005-TX01(B) attributes a one-step reverse-rebirth placement to its replacement A face", () => {
    const backDef = defs.get("BSTH005-TX01(B)")!;
    const frontDef = defs.get("BSTH005-TX01(A)")!;
    const back = {
      ...createCardInstance(backDef, {
        instanceId: "bsth005-one-step-back",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      originalDefinitionId: frontDef.cardNo,
    };
    // A separate listener preserves the resulting placement event, whose
    // effectSourceInstanceId is the finalization cause under test.
    const observerDef: CardDefinition = {
      ...backDef,
      cardNo: "TEST-BSTH005-REVERSE-REBIRTH-OBSERVER",
      effects: [
        {
          timing: { kind: "game_event", player: "self", event: "place" },
          steps: [{ action: { kind: "noop" } }],
        },
      ],
    };
    const observer = createCardInstance(observerDef, {
      instanceId: "bsth005-one-step-observer",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const localDefinitions = new Map<string, CardDefinition>([
      [observerDef.cardNo, observerDef],
    ]);
    const lookup = (id: string) => localDefinitions.get(id) ?? getDef(id);
    const triggeredLookup = (id: string) => {
      const definition = lookup(id);
      return definition ? generateTriggeredEffectRegistrations(definition) : [];
    };
    const pending = executeEffect({
      chainId: "test:backface-effects-regression:730",
      state: createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [back, observer],
        playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
      }),
      effect: backDef.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: back.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(pending.pendingReverseRebirthSummon).toMatchObject({
      sourceInstanceId: back.instanceId,
      frontDefinitionId: frontDef.cardNo,
    });
    expect(pending.pendingReverseRebirthSummon?.continuation).toBeUndefined();
    const resolvePlacement = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
    }).find((action) => action.kind === "resolve_reverse_rebirth_summon");
    expect(resolvePlacement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: pending,
      action: resolvePlacement!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const replacement = afterPlacement.cardInstances.find(
      (card) => card.definitionId === frontDef.cardNo && card.zone === "field"
    );
    expect(replacement).toBeDefined();
    const placementEvent = afterPlacement.pendingTriggeredEffects.find(
      (pendingEffect) =>
        pendingEffect.eventKind === "place" &&
        pendingEffect.relatedInstanceId === replacement!.instanceId
    );
    expect(placementEvent).toMatchObject({
      event: { effectSourceInstanceId: replacement!.instanceId },
    });
  });

  it("BSTH02.7-TR02(B) lets each core placement be declined before its trailing exhaustion", () => {
    const quartzDef = defs.get("BSTH02.7-TR02(B)")!;
    const quartz = createCardInstance(quartzDef, {
      instanceId: "tr02-optional-distribute",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const exhaustibleOpponent = createCardInstance(defs.get("BSKB01-C01")!, {
      instanceId: "tr02-exhaustible-opponent",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const effect = quartzDef.effects![0]!;
    expect(effect.steps[0]!.executionMode).toBe("optional");
    expect(effect.steps[1]!.executionMode).toBe("optional");
    const initial = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [quartz, exhaustibleOpponent],
      startingVoidNormalCoreCount: 3,
    });
    const firstPending = executeEffect({
      chainId: "test:backface-effects-regression:796",
      state: initial,
      effect,
      effectIndex: 0,
      sourceInstanceId: quartz.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(firstPending.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: ALICE,
      stepIndex: 0,
      canDecline: true,
    });
    const declineFirst = getLegalActions({
      state: firstPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declineFirst).toBeDefined();
    const secondPending = applyLegalAction({
      state: firstPending,
      action: declineFirst!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(secondPending.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: ALICE,
      stepIndex: 1,
      canDecline: true,
    });
    const declineSecond = getLegalActions({
      state: secondPending,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declineSecond).toBeDefined();
    const exhaustionPending = applyLegalAction({
      state: secondPending,
      action: declineSecond!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(exhaustionPending.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: ALICE,
      stepIndex: 2,
      canDecline: false,
    });
  });

  it("BSTH08-転醒R01(B) respects an opposing cannot-leave-field replacement before suppressing entry effects", () => {
    const sourceDef = defs.get("BSTH08-転醒R01(B)")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "bsth08-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const protectedTarget = createCardInstance(defs.get("BSKB01-C01")!, {
      instanceId: "bsth08-protected-target",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const cannotLeave: ContinuousEffect = {
      effectId: "bsth08-cannot-leave",
      sourceInstanceId: protectedTarget.instanceId,
      sourceDefinitionId: protectedTarget.definitionId,
      actingPlayerId: BOB,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_leave_field",
      targetInstanceId: protectedTarget.instanceId,
      metadata: { source: "all" },
    };
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, protectedTarget],
      }),
      activeContinuousEffects: [cannotLeave],
    };
    const bottomDeck = sourceDef.effects![0]!.steps[0]!.action;
    expect(bottomDeck.kind).toBe("send_to_deck");
    if (bottomDeck.kind !== "send_to_deck") {
      throw new Error("expected BSTH08 bottom-deck action");
    }
    expect(bottomDeck.pierceCannotLeaveField).toBeUndefined();
    const afterEffect = executeEffect({
      chainId: "test:backface-effects-regression:893",
      state: before,
      effect: sourceDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      targetInstanceIds: [protectedTarget.instanceId],
      targetStepId: "bottom-deck",
      targetSelectionResolved: true,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = flushPendingLeaves(afterEffect, getDef);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === protectedTarget.instanceId
      )?.zone
    ).toBe("field");
  });

  it("BSTH02.7-TR03(A) rebirth registers its B-face effect and summons an eligible toy spirit from trash at cost 0", () => {
    const frontDef = defs.get("BSTH02.7-TR03(A)")!;
    const braveDef = defs.get("BSTH02.7-TR03(B)")!;
    const puppetDef = defs.get("BSTH02.7-C02")!;
    // 同じトラッシュにいても、系統不一致/コスト超過のスピリットは B 面の
    // 「動玩・コスト6以下」の対象選択に混ざらない。
    const nonToyDef: CardDefinition = {
      ...puppetDef,
      cardNo: "TEST-BSTH02.7-NON-TOY",
      name: "non-toy spirit",
      tribe: "導魔",
      effects: [],
    };
    const expensiveToyDef: CardDefinition = {
      ...puppetDef,
      cardNo: "TEST-BSTH02.7-EXPENSIVE-TOY",
      name: "expensive toy spirit",
      cost: 7,
      effects: [],
    };
    const extraDefs = new Map<string, CardDefinition>([
      [nonToyDef.cardNo, nonToyDef],
      [expensiveToyDef.cardNo, expensiveToyDef],
    ]);
    const getRebirthDef = (id: string) => extraDefs.get(id) ?? getDef(id);
    const stone = createCardInstance(frontDef, {
      instanceId: "string-source",
      ownerPlayerId: ALICE,
      zone: "field",
      // 創界石の転醒閾値 3 に到達する直前の盤面。
      normalCoreCount: 2,
    });
    const puppet = createCardInstance(puppetDef, {
      instanceId: "string-puppet",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const nonToy = createCardInstance(nonToyDef, {
      instanceId: "string-non-toy",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const expensiveToy = createCardInstance(expensiveToyDef, {
      instanceId: "string-expensive-toy",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [stone, puppet, nonToy, expensiveToy],
      // コスト0でもLv1維持コア1個は通常どおり配置する。
      playerOverrides: [
        { reserveNormalCoreCount: 1, voidNormalCoreCount: 0 },
        {},
      ],
    });
    const thresholdReached = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId === stone.instanceId
          ? { ...card, normalCoreCount: 3 }
          : card
      ),
    };
    const triggeredLookup = buildTriggeredEffectLookup([
      ...defs.values(),
      ...extraDefs.values(),
    ]);
    const fieldLookup = buildFieldCardEffectLookup([
      ...defs.values(),
      ...extraDefs.values(),
    ]);
    const closeStack = (state: typeof before) => {
      let current = state;
      for (let guard = 0; current.stackWindow && guard < 8; guard++) {
        const actions = getLegalActions({
          state: current,
          actingPlayerId: current.stackWindow.priorityPlayerId,
          getCardDefinitionById: getRebirthDef,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredFieldCardEffectActions: fieldLookup,
        });
        const pass = actions.find((action) => action.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          getCardDefinitionById: getRebirthDef,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredFieldCardEffectActions: fieldLookup,
        }).state;
      }
      expect(current.stackWindow).toBeNull();
      return current;
    };

    // 実際の創界石トリガーが、閾値到達から任意の転醒選択を生成する。
    let state = checkAndQueueStoneRebirthChoices(
      before,
      thresholdReached,
      getRebirthDef,
      "test:backface-effects-regression:1010"
    );
    const stoneRebirth = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getRebirthDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.eventKind === "stone_rebirth"
    );
    expect(stoneRebirth).toBeDefined();
    state = closeStack(
      applyLegalAction({
        state,
        action: stoneRebirth!,
        getCardDefinitionById: getRebirthDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state
    );

    // この創界石は「自分のスピリットに合体できる」型だが、候補がない盤面では
    // 選択を介さずA面からB面へ実際に flip し、転醒時効果の登録まで完了する。
    expect(
      state.cardInstances.find((card) => card.instanceId === stone.instanceId)
        ?.definitionId
    ).toBe(braveDef.cardNo);
    expect(
      state.cardInstances.find((card) => card.instanceId === stone.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      state.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(1);

    // B面の card_event:"rebirth" 登録を lookup 経由で受諾する。
    const rebirthEffect = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getRebirthDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.eventKind === "rebirth" &&
        action.sourceInstanceId === stone.instanceId &&
        action.skipOnly !== true
    );
    expect(rebirthEffect).toBeDefined();
    state = closeStack(
      applyLegalAction({
        state,
        action: rebirthEffect!,
        getCardDefinitionById: getRebirthDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state
    );
    const postRebirthActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getRebirthDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const selectPuppet = postRebirthActions.find(
      (action) =>
        action.kind === "resolve_pending_effect_target" &&
        action.candidateTargetInstanceIds.includes(puppet.instanceId)
    );
    expect(selectPuppet).toBeDefined();
    if (
      !selectPuppet ||
      selectPuppet.kind !== "resolve_pending_effect_target"
    ) {
      throw new Error("expected a pending target selection for the toy spirit");
    }
    expect(selectPuppet.candidateTargetInstanceIds).toEqual([
      puppet.instanceId,
    ]);
    state = applyLegalAction({
      state,
      action: selectPuppet,
      getCardDefinitionById: getRebirthDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      targetInstanceIds: [puppet.instanceId],
    }).state;
    const placementAction = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getRebirthDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    const after = applyLegalAction({
      state,
      action: placementAction!,
      getCardDefinitionById: getRebirthDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: puppet.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;

    const summoned = after.cardInstances.find(
      (card) => card.instanceId === puppet.instanceId
    );
    expect(summoned?.zone).toBe("field");
    expect(summoned?.normalCoreCount).toBe(1);
    expect(
      after.cardInstances.find((card) => card.instanceId === nonToy.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === expensiveToy.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((card) => card.instanceId === stone.instanceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((card) => card.instanceId === stone.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      after.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(1);
    expect(
      after.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);
    expect(braveDef.effects![0]!.steps[0]!.action).toMatchObject({
      kind: "summon",
      costModifier: { override: 0 },
      target: { kind: "from_zone", zone: "trash", filter: { maxCost: 6 } },
    });
  });

  it("BSTH02.7-TR03(B) zeros its brave contribution while preserving the host's own cost", () => {
    const braveDef = defs.get("BSTH02.7-TR03(B)")!;
    const hostDef = defs.get("BSKB01-TX01(B)")!;
    const host = createCardInstance(hostDef, {
      instanceId: "string-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["string-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "string-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: host.instanceId,
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, brave],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
    };
    expect(getEffectiveCost(before, host, hostDef, getDef)).toBe(hostDef.cost);
    expect(getCombinedUnitCost(before, host, hostDef, getDef)).toBe(
      hostDef.cost + braveDef.cost
    );
    const after = executeEffect({
      chainId: "test:backface-effects-regression:1183",
      state: before,
      effect: braveDef.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(getEffectiveCost(after, host, hostDef, getDef)).toBe(hostDef.cost);
    expect(getEffectiveCost(after, brave, braveDef, getDef)).toBe(0);
    expect(getCombinedUnitCost(after, host, hostDef, getDef)).toBe(
      hostDef.cost
    );
    expect(
      after.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "override_properties" &&
          effect.targetInstanceId === brave.instanceId &&
          effect.duration.scope === "battle"
      )
    ).toBe(true);
    expect(braveDef.effects![1]!.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
  });

  it.each([
    [0, false],
    [1, true],
    [2, true],
  ])(
    "BSTH09-TR01(B) makes its attack trigger legal exactly when count is positive (count %i)",
    (countValue, expectedAvailable) => {
      const braveDef = defs.get("BSTH09-TR01(B)")!;
      const host = createCardInstance(defs.get("BSKB01-TX01(B)")!, {
        instanceId: "count-host",
        ownerPlayerId: ALICE,
        zone: "field",
        attachedChildrenIds: ["count-brave"],
      });
      const brave = createCardInstance(braveDef, {
        instanceId: "count-brave",
        ownerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: host.instanceId,
      });
      const attackId = "count-gate-attack";
      const entityId = "battle-entity:count-host";
      const state = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [host, brave],
          playerOverrides: [{ countValue }, {}],
        }),
        activePlayerId: ALICE,
        step: "attack" as const,
        window: "declare_attack" as const,
        activeAttack: {
          attackId,
          primaryEntityId: entityId,
          participantEntityIds: [entityId],
          groupMode: "single" as const,
          target: { kind: "player" as const, playerId: BOB },
          blockAssignments: [
            { participantEntityId: entityId, blockedByEntityIds: [] },
          ],
          symbolResolutionOrder: [entityId],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId,
            memberInstanceIds: [host.instanceId],
            resolvedBp: 5000,
            resolvedSymbols: [],
            attackState: "attacking" as const,
          },
        ],
      };
      expect(
        getUsageLimitMaxCount(braveDef.effects![1]!.usageLimit!, {
          state,
          sourceInstanceId: brave.instanceId,
          sourceDefinitionId: braveDef.cardNo,
          getCardDefinitionById: getDef,
        })
      ).toBe(1);
      expect(braveDef.effects![1]!.condition).toEqual([
        { kind: "count_value", player: "self", min: 1 },
      ]);
      expect(braveDef.effects![1]!.steps[0]!.repeat).toEqual({
        additional: {
          source: { kind: "count_value", player: "self" },
          offset: -1,
        },
      });
      const battleImmediateLookup = buildBattleImmediateEffectLookup([
        braveDef,
      ]);
      const queued = queueRegisteredBattleImmediateEffects({
        state,
        attackId,
        participantEntityId: entityId,
        actingPlayerId: ALICE,
        sourceCard: host,
        sourceDefinition: defs.get("BSKB01-TX01(B)")!,
        timing: "attack",
        getCardDefinitionById: getDef,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      });
      const actions = getLegalActions({
        state: queued,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).filter(
        (action) =>
          action.kind === "resolve_battle_immediate_effect" &&
          action.sourceEffectInstanceId === brave.instanceId &&
          !action.skipOnly
      );
      expect(actions.length > 0).toBe(expectedAvailable);
    }
  );

  it("BSTH09-TR01(B) は count 2 で独立した2巡を解決し、同名の2枚目を同ターンに発揮できない", () => {
    const front = ALL_CARDS.find((card) => card.cardNo === "BSTH09-TR01(A)")!;
    const braveDef = front.backFace!;
    expect(braveDef.cardNo).toBe("BSTH09-TR01(B)");
    const hostDef = defs.get("BSKB01-TX01(B)")!;
    const firstHost = createCardInstance(hostDef, {
      instanceId: "same-name-first-host",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["same-name-first-brave"],
    });
    const firstBrave = createCardInstance(braveDef, {
      instanceId: "same-name-first-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: firstHost.instanceId,
    });
    const secondHost = createCardInstance(hostDef, {
      instanceId: "same-name-second-host",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["same-name-second-brave"],
    });
    const secondBrave = createCardInstance(braveDef, {
      instanceId: "same-name-second-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: secondHost.instanceId,
    });
    const deckEntrants = Array.from({ length: 8 }, (_, index) =>
      createCardInstance(defs.get("BSKB01-C01")!, {
        instanceId: `same-name-deck-entrant-${index + 1}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const firstAttackId = "same-name-first-attack";
    const firstEntityId = "battle-entity:same-name-first-host";
    const beforeFirstAttack = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          firstHost,
          firstBrave,
          secondHost,
          secondBrave,
          ...deckEntrants,
        ],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "declare_attack" as const,
      activeAttack: {
        attackId: firstAttackId,
        primaryEntityId: firstEntityId,
        participantEntityIds: [firstEntityId],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [
          { participantEntityId: firstEntityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [firstEntityId],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: firstEntityId,
          memberInstanceIds: [firstHost.instanceId],
          resolvedBp: 5000,
          resolvedSymbols: [],
          attackState: "attacking" as const,
        },
      ],
    };
    const battleImmediateLookup = buildBattleImmediateEffectLookup([braveDef]);
    const legalOptions = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    };
    const firstQueued = queueRegisteredBattleImmediateEffects({
      state: beforeFirstAttack,
      attackId: firstAttackId,
      participantEntityId: firstEntityId,
      actingPlayerId: ALICE,
      sourceCard: firstHost,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const firstDeclaration = getLegalActions({
      state: firstQueued,
      actingPlayerId: ALICE,
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceEffectInstanceId === firstBrave.instanceId &&
        !action.skipOnly
    );
    expect(firstDeclaration).toBeDefined();
    if (!firstDeclaration) {
      throw new Error("expected first BSTH09-TR01(B) declaration");
    }
    const declared = applyLegalAction({
      state: firstQueued,
      action: firstDeclaration,
      ...legalOptions,
    }).state;
    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:same-name-first",
        can: true,
        reason: "test_close",
        actingPlayerId: BOB,
      },
      ...legalOptions,
    }).state;
    expect(resolved.pendingDeckReveal).not.toBeNull();
    const resolveRevealedChoice = (state: typeof resolved) => {
      const revealedChoice = getLegalActions({
        state,
        actingPlayerId: ALICE,
        ...legalOptions,
      }).find(
        (action) =>
          action.kind === "resolve_pending_deck_reveal_pick" &&
          action.pickIndex === -1
      );
      if (!revealedChoice) {
        return state;
      }
      return applyLegalAction({
        state,
        action: revealedChoice,
        selectedDeckRevealCardIds: [],
        ...legalOptions,
      }).state;
    };
    const afterFirstRevealedChoice = resolveRevealedChoice(resolved);
    const pick = getLegalActions({
      state: afterFirstRevealedChoice,
      actingPlayerId: ALICE,
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_deck_reveal_pick" &&
        action.pickIndex >= 0
    );
    expect(pick).toBeDefined();
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("expected first BSTH09-TR01(B) deck-reveal pick");
    }
    const firstRevealedIds = [
      ...afterFirstRevealedChoice.pendingDeckReveal!
        .originalRevealedCardInstanceIds,
    ];
    expect(firstRevealedIds).toEqual(
      deckEntrants.slice(0, 4).map((card) => card.instanceId)
    );
    expect(pick.candidateCardInstanceIds).toContain(
      deckEntrants[0]!.instanceId
    );
    const afterFirstPick = finishCoreChoices(
      applyLegalAction({
        state: afterFirstRevealedChoice,
        action: pick,
        selectedDeckRevealCardIds: [deckEntrants[0]!.instanceId],
        ...legalOptions,
      }).state,
      getDef,
      legalOptions
    );
    const firstOrder = getLegalActions({
      state: afterFirstPick,
      actingPlayerId: ALICE,
      ...legalOptions,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(firstOrder).toBeDefined();
    if (
      !firstOrder ||
      firstOrder.kind !== "resolve_pending_deck_reveal_order"
    ) {
      throw new Error("expected first BSTH09-TR01(B) remainder order");
    }
    const afterFirstResolution = finishCoreChoices(
      applyLegalAction({
        state: afterFirstPick,
        action: firstOrder,
        deckRevealRemainderOrder: firstOrder.remainingCardInstanceIds,
        ...legalOptions,
      }).state,
      getDef,
      legalOptions
    );
    expect(
      afterFirstResolution.cardInstances.find(
        (card) => card.instanceId === deckEntrants[0]!.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterFirstResolution.pendingDeckReveal?.continuation?.repeatResume
    ).toMatchObject({
      stepIndex: 0,
      nextAdditionalIndex: 1,
      additionalCount: 1,
      skipBaseAction: true,
    });
    const afterSecondRevealedChoice =
      resolveRevealedChoice(afterFirstResolution);
    const secondRevealedIds = [
      ...afterSecondRevealedChoice.pendingDeckReveal!
        .originalRevealedCardInstanceIds,
    ];
    expect(secondRevealedIds).toEqual(
      deckEntrants.slice(4).map((card) => card.instanceId)
    );
    expect(secondRevealedIds).not.toEqual(
      expect.arrayContaining(firstRevealedIds)
    );
    const secondPick = getLegalActions({
      state: afterSecondRevealedChoice,
      actingPlayerId: ALICE,
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_deck_reveal_pick" &&
        action.pickIndex >= 0
    );
    expect(secondPick).toBeDefined();
    if (!secondPick || secondPick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("expected second BSTH09-TR01(B) deck-reveal pick");
    }
    expect(secondPick.candidateCardInstanceIds).toContain(
      deckEntrants[4]!.instanceId
    );
    const afterSecondPick = finishCoreChoices(
      applyLegalAction({
        state: afterSecondRevealedChoice,
        action: secondPick,
        selectedDeckRevealCardIds: [deckEntrants[4]!.instanceId],
        ...legalOptions,
      }).state,
      getDef,
      legalOptions
    );
    const secondOrder = getLegalActions({
      state: afterSecondPick,
      actingPlayerId: ALICE,
      ...legalOptions,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(secondOrder).toBeDefined();
    if (
      !secondOrder ||
      secondOrder.kind !== "resolve_pending_deck_reveal_order"
    ) {
      throw new Error("expected second BSTH09-TR01(B) remainder order");
    }
    const afterSecondResolution = finishCoreChoices(
      applyLegalAction({
        state: afterSecondPick,
        action: secondOrder,
        deckRevealRemainderOrder: secondOrder.remainingCardInstanceIds,
        ...legalOptions,
      }).state,
      getDef,
      legalOptions
    );
    expect(afterSecondResolution.pendingDeckReveal).toBeNull();
    expect(
      afterSecondResolution.cardInstances.find(
        (card) => card.instanceId === deckEntrants[4]!.instanceId
      )?.zone
    ).toBe("field");
    expect(
      afterSecondResolution.cardInstances
        .filter((card) => card.zone === "deck")
        .map((card) => card.instanceId)
    ).toEqual(
      expect.arrayContaining([
        deckEntrants[1]!.instanceId,
        deckEntrants[2]!.instanceId,
        deckEntrants[3]!.instanceId,
        deckEntrants[5]!.instanceId,
        deckEntrants[6]!.instanceId,
        deckEntrants[7]!.instanceId,
      ])
    );
    expect(afterSecondResolution.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: firstBrave.instanceId,
          sourceDefinitionId: braveDef.cardNo,
          effectLabel: "effect:1",
          duration: "turn",
          count: 1,
        }),
      ])
    );
    const secondAttackId = "same-name-second-attack";
    const secondEntityId = "battle-entity:same-name-second-host";
    const beforeSecondAttack = {
      ...afterSecondResolution,
      activePlayerId: ALICE,
      step: "attack" as const,
      window: "declare_attack" as const,
      activeAttack: {
        attackId: secondAttackId,
        primaryEntityId: secondEntityId,
        participantEntityIds: [secondEntityId],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: BOB },
        blockAssignments: [
          { participantEntityId: secondEntityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [secondEntityId],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: secondEntityId,
          memberInstanceIds: [secondHost.instanceId],
          resolvedBp: 5000,
          resolvedSymbols: [],
          attackState: "attacking" as const,
        },
      ],
      battleImmediateEffects: [],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state: beforeSecondAttack,
      attackId: secondAttackId,
      participantEntityId: secondEntityId,
      actingPlayerId: ALICE,
      sourceCard: secondHost,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      queued.battleImmediateEffects.some(
        (pending) =>
          pending.sourceEffectInstanceId === secondBrave.instanceId &&
          pending.sourceEffectDefinitionId === braveDef.cardNo
      )
    ).toBe(false);
  });

  it("BSTH09-TR01(B) count 1 resolves exactly one full deck-reveal round and suppresses only the entrant's summon effect", () => {
    const braveDef = defs.get("BSTH09-TR01(B)")!;
    const entrant: CardDefinition = {
      cardNo: "TEST-BSTH09-ENTRANT",
      name: "suppressed entrant",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      tribe: "test",
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 10 } },
          ],
        },
      ],
    };
    const observer: CardDefinition = {
      ...entrant,
      cardNo: "TEST-BSTH09-OBSERVER",
      name: "third-party observer",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "summon",
            triggerFilter: { category: ["spirit"] },
          },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    };
    const customDefs = new Map([
      [entrant.cardNo, entrant],
      [observer.cardNo, observer],
    ]);
    const lookup = (id: string) => customDefs.get(id) ?? getDef(id);
    const triggeredLookup = (id: string) => {
      const definition = lookup(id);
      return definition ? generateTriggeredEffectRegistrations(definition) : [];
    };
    const host = createCardInstance(defs.get("BSTH09-X01")!, {
      instanceId: "brave-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["b09-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "b09-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: host.instanceId,
    });
    const observerInstance = createCardInstance(observer, {
      instanceId: "observer",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const entrantInstance = createCardInstance(entrant, {
      instanceId: "entrant",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const remainderInstances = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(defs.get("BSKB01-C01")!, {
        instanceId: `count-one-remainder-${index + 1}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const revealed = executeEffect({
      chainId: "test:backface-effects-regression:1736",
      state: {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [
            host,
            brave,
            observerInstance,
            entrantInstance,
            ...remainderInstances,
          ],
          playerOverrides: [{ countValue: 1 }, {}],
        }),
        activePlayerId: ALICE,
        step: "attack",
      },
      effect: braveDef.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(revealed.pendingDeckReveal?.suppressFieldEntryEffects).toBe(true);
    const pick = getLegalActions({
      state: revealed,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_deck_reveal_pick" &&
        action.pickIndex >= 0
    );
    expect(pick).toBeDefined();
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("expected BSTH09 deck-reveal field pick");
    }
    const afterPick = finishCoreChoices(
      applyLegalAction({
        state: revealed,
        action: pick,
        selectedDeckRevealCardIds: [entrantInstance.instanceId],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state,
      lookup,
      { getRegisteredTriggeredEffectActions: triggeredLookup }
    );
    const order = getLegalActions({
      state: afterPick,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(order).toBeDefined();
    if (!order || order.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("expected BSTH09 count-one deck-reveal remainder order");
    }
    const entered = finishCoreChoices(
      applyLegalAction({
        state: afterPick,
        action: order,
        deckRevealRemainderOrder: order.remainingCardInstanceIds,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state,
      lookup,
      { getRegisteredTriggeredEffectActions: triggeredLookup }
    );
    expect(entered.pendingDeckReveal).toBeNull();
    expect(
      entered.cardInstances.filter((card) => card.zone === "field")
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: entrantInstance.instanceId }),
      ])
    );
    expect(
      entered.cardInstances
        .filter((card) => card.zone === "deck")
        .map((card) => card.instanceId)
    ).toEqual(
      expect.arrayContaining(remainderInstances.map((card) => card.instanceId))
    );
    expect(
      entered.cardInstances.find(
        (card) => card.instanceId === entrantInstance.instanceId
      )?.zone
    ).toBe("field");
    expect(entered.log).toContain(
      `effect:field-entry-suppress-triggered-effects:${entrantInstance.instanceId}`
    );
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: revealed,
        afterState: entered,
        source: "action_resolution",
        getCardDefinitionById: lookup,
      }).find((event) => event.relatedInstanceId === entrantInstance.instanceId)
        ?.suppressedSourceInstanceIds
    ).toEqual([entrantInstance.instanceId]);
    expect(
      entered.pendingTriggeredEffects[0]?.suppressedSourceInstanceIds
    ).toEqual([entrantInstance.instanceId]);
    let afterBurstChecks = entered;
    for (let guard = 0; guard < 4; guard += 1) {
      const burstCheck = getLegalActions({
        state: afterBurstChecks,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).find((action) => action.kind === "resolve_pending_burst_check");
      if (!burstCheck) break;
      afterBurstChecks = applyLegalAction({
        state: afterBurstChecks,
        action: burstCheck,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state;
    }
    const triggerActions = getLegalActions({
      state: afterBurstChecks,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter((action) => action.kind === "resolve_pending_triggered_effect");
    expect(triggerActions.map((action) => action.sourceInstanceId)).toEqual([
      observerInstance.instanceId,
    ]);
    const observerTrigger = triggerActions[0]!;
    const resolved = applyLegalAction({
      state: afterBurstChecks,
      action: observerTrigger,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    let settled = resolved;
    for (let guard = 0; guard < 4; guard += 1) {
      if (settled.window !== "stack" || !settled.stackWindow) break;
      settled = applyLegalAction({
        state: settled,
        action: {
          kind: "pass_stack",
          actionId: `pass:observer-trigger:${guard}`,
          can: true,
          reason: "test_close_triggered_stack",
          actingPlayerId: settled.stackWindow.priorityPlayerId,
        },
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state;
    }
    expect(
      settled.players.find((player) => player.id === ALICE)?.countValue
    ).toBe(2);
  });
});
