/**
 * BSTH04 (東方花映塚) カードの effects 検証テスト。
 * カード番号順に最小 1 ケース、効果実行後の盤面変化を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveBp,
  getEffectiveLevel,
  getEffectiveSymbols,
  getCombinedUnitSymbols,
  getLegalActions,
  getPlayerLifeCoreCount,
  flushPendingLeaves,
  isCardUseRestricted,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
  resolveLifeDamage,
  runReevaluationAtTiming,
  runStateBasedActions,
} from "../src/runtime";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";
import { finalizeBattleEndScopeExpirations } from "../src/battle/battle-end-scope-finalize";
import {
  expandCardDefinitionsWithBackFaces,
  generateBattleImmediateEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { executeRebirth } from "../src/effect/structured-card-replacement";
import {
  finalizeEffectResolution,
  runActionMainResolution,
} from "../src/effect/effect-resolution";
import { resolvePlacementOracleMechanic } from "../src/mechanics/oracle-system";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  PendingTriggeredEffect,
  SymbolColor,
} from "../src/runtime";

const allCardDefinitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  allCardDefinitions.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(allCardDefinitions);

function symbolAdditionCE(
  targetInstanceId: string,
  symbol: SymbolColor
): ContinuousEffect {
  return {
    effectId: `ce-extra-symbol-${targetInstanceId}`,
    sourceInstanceId: "external-symbol-source",
    sourceDefinitionId: "TEST-SYMBOL-SOURCE",
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "symbol_addition",
    modifierSymbol: [symbol],
    targetInstanceId,
  };
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string,
  targetInstanceIds?: readonly string[]
) {
  return executeEffect({
    chainId: "test:bsth04-cards:80",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    ...(targetInstanceIds !== undefined
      ? { targetInstanceIds: [...targetInstanceIds] }
      : {}),
  });
}

function resolvePendingStepTargetSelection(
  state: GameState,
  targetInstanceIds: string[],
  lookups = { getCardDefinitionById, getRegisteredTriggeredEffectActions }
): GameState {
  const pending = state.pendingStepOptionalTargetSelection;
  expect(pending).not.toBeNull();
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_target_selection",
      actionId: `psots-${pending!.pendingId}:test`,
      can: true,
      reason: "test",
      actingPlayerId: pending!.actingPlayerId,
      pendingId: pending!.pendingId,
      sourceInstanceId: pending!.sourceInstanceId,
      sourceDefinitionId: pending!.sourceDefinitionId,
      effectIndex: pending!.effectIndex,
      stepIndex: pending!.stepIndex,
      requiredTargetCount: pending!.requiredTargetCount,
      maxTargetCount: pending!.maxTargetCount,
      candidateTargetInstanceIds: pending!.candidateInstanceIds,
    },
    targetInstanceIds,
    ...lookups,
  }).state;
}

function finishKomachi(
  state: GameState,
  beforeState: GameState,
  lookups = { getCardDefinitionById, getRegisteredTriggeredEffectActions }
) {
  return finalizeEffectResolution({
    state,
    beforeState,
    chainId: "test:komachi",
    actingPlayerId: "alice",
    endLogs: [],
    ...lookups,
    getRegisteredBurstActions: () => [],
    causedBySourceInstanceId: "komachi-1",
  });
}

function queuedLeaveReplacementTrigger(
  instanceId: string,
  chainId = "chain-lv-cost"
): PendingTriggeredEffect {
  return {
    pendingId: `rebirth-${instanceId}`,
    actingPlayerId: "bob",
    eventKind: "vanish",
    source: "action_resolution",
    chainId,
    attackId: null,
    relatedPlayerId: "bob",
    relatedInstanceId: instanceId,
    amount: null,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: [],
    registeredLeaveFieldStayOnFieldSourceKeys: [`${instanceId}#0`],
  } as PendingTriggeredEffect;
}

function rebirthLvDeficitNexus(
  frontNo: string,
  backNo: string
): CardDefinition {
  return {
    cardNo: frontNo,
    name: "テスト用 転醒ネクサス",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [
      "【転醒：自分のカウント99以下】このネクサスが消滅するとき、裏返せる。",
    ],
    keywordTags: ["double_sided"],
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    effects: [
      {
        timing: { kind: "card_event", event: "vanish" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 99,
              triggerDescription: "消滅するとき",
            },
          },
        ],
        textRef: [0],
      },
    ],
    backFace: {
      cardNo: backNo,
      name: "テスト用 転醒ネクサス(B)",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
      symbolColors: [],
      textLines: ["転醒後の最低Lvコアが1個。"],
      keywordTags: [],
      effects: [],
    },
  };
}

function testBraveDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト用 ブレイヴ",
    printedCategory: "brave",
    colors: ["purple"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: ["テスト用の合体中ブレイヴ。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function vanishTriggeredSpiritDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト用 消滅時スピリット",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["purple"],
    textLines: [
      "Lv1『このスピリットの消滅時』自分はデッキから1枚ドローできる。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "vanish" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [0],
      },
    ],
  };
}

function contractSpiritDefinition(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: "テスト用 契約スピリット",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["purple"],
    textLines: ["契約カード。"],
    keywordTags: ["contract"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function buildLocalRebirthLookups(extraDefinitions: readonly CardDefinition[]) {
  const definitions = expandCardDefinitionsWithBackFaces([
    ...ALL_CARDS,
    ...extraDefinitions,
  ]);
  const byId = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return {
    getCardDefinitionById: (id: string) => byId.get(id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
  };
}

function drainTriggeredEffectsAndStack(
  state: GameState,
  actingPlayerIds: readonly string[],
  lookups: ReturnType<typeof buildLocalRebirthLookups>
): GameState {
  let current = state;
  for (let guard = 0; guard < 30; guard++) {
    if (
      current.pendingTriggeredEffects.length === 0 &&
      current.stackWindow === null &&
      current.pendingAfterTriggersContinuations.length === 0
    ) {
      return current;
    }
    let progressed = false;
    for (const actingPlayerId of actingPlayerIds) {
      const action = getLegalActions({
        state: current,
        actingPlayerId,
        ...lookups,
      }).find(
        (candidate) =>
          candidate.kind === "resolve_pending_triggered_effect" ||
          candidate.kind === "select_pending_to_resolve" ||
          candidate.kind === "pass_stack"
      );
      if (!action) continue;
      current = applyLegalAction({
        state: current,
        action,
        ...lookups,
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) return current;
  }
  return current;
}

describe("BSTH04-R02 [花映塚]魂魄 妖夢", () => {
  const card = cardNoMap.get("BSTH04-R02")!;

  it("バースト後の自己召喚は burst area のこのカードを cost-free sequential で召喚する", () => {
    const burst = card.effects![0]!;
    expect(burst.stub).toBeUndefined();
    expect(burst.steps[1]).toMatchObject({
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      connector: "sequential",
    });
  });
});

describe("BSTH04-X03 小野塚 小町", () => {
  const card = cardNoMap.get("BSTH04-X03")!;

  it("BSTH04-X03 effects[0] は count+1 成功後に Lvコスト+2、消滅時に自身へコア2個を置く", () => {
    const effect = card.effects![0]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });

    expect(effect.steps[0]!.action).toMatchObject({
      kind: "count_increase",
      amount: 1,
    });
    expect(effect.steps[1]!.connector).toBe("conditional_result");
    expect(effect.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "count-up",
    });
    expect(effect.steps[1]!.action).toMatchObject({
      kind: "override_properties",
      properties: { levelCostDelta: 2 },
    });
    expect(effect.steps[2]!.connector).toBe("after_state_check");
    expect(effect.steps[2]!.stepCondition).toEqual({
      kind: "ref_leave_established",
      stepId: "lv-cost-up",
      leaveKind: "vanish",
    });
    expect(effect.steps[2]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
      amount: 2,
    });
  });

  it("[board] Lvコスト+2で相手スピリットが消滅したとき、小町にボイドからコア2個を置く", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 20,
        cardInstances: [komachi, target],
      }),
      getCardDefinitionById
    );

    expect(
      getEffectiveLevel(state, target, targetDef, getCardDefinitionById)
    ).toBe(1);

    const result = runEffect(state, card.effects![0]!, "komachi-1", "alice", [
      "target-1",
    ]);
    const alice = result.players.find((p) => p.id === "alice")!;
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;

    expect(alice.countValue).toBe(1);
    expect(komachiAfter.normalCoreCount).toBe(3);
    expect(alice.voidNormalCoreCount).toBe(17);
    expect(targetAfter.zone).toBe("field");
    expect(targetAfter.pendingLeaveKind).not.toBeNull();
  });

  it("[board] 破壊待機中のLvコストが増えても消滅へ遷移せず小町の消滅誘発を作らない", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = {
      ...createCardInstance(targetDef, {
        instanceId: "target-pending-destroy",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      pendingLeaveKind: "destroy" as const,
      pendingLeaveCause: "effect_resolution" as const,
      pendingLeaveChainId: "destroy-chain",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 20,
        cardInstances: [komachi, target],
      }),
      pendingLeaveEntities: [
        {
          instanceId: "target-pending-destroy",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "destroy-chain",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const result = runEffect(state, card.effects![0]!, "komachi-1", "alice", [
      "target-pending-destroy",
    ]);
    const alice = result.players.find((p) => p.id === "alice")!;
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "target-pending-destroy"
    )!;

    expect(alice.countValue).toBe(1);
    expect(komachiAfter.normalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(19);
    expect(targetAfter.zone).toBe("field");
    expect(targetAfter.pendingLeaveKind).not.toBeNull();
    expect(result.log).not.toContain(
      "pending-leave-transition:destroy->vanish:target-pending-destroy"
    );
  });

  it("[board] Lvコスト+2で通常ネクサスが消滅したときも小町にコア2個を置く", () => {
    // 合成の通常ネクサス定義を使用。BSTH04-転醒R02(A) は leave_field(cause:opponent_effect)
    // の rebirth 応答窓 (08a_advent-rebirth-contract.md) が、BSTH04-X01 は導界者ネクサス
    // 専用効果耐性 (「導界者ネクサス/創界神ネクサス対象の効果しか受けない」) がそれぞれ
    // override_properties(category:["spirit","ultimate","nexus"]) と競合するため使わない。
    // buildLocalRebirthLookups で getCardDefinitionById にローカル登録する
    // (module-level getCardDefinitionById は ALL_CARDS のみ解決可能なため)。
    const nexusDef: CardDefinition = {
      cardNo: "TEST-PLAIN-NEXUS",
      name: "テスト用通常ネクサス",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const localLookups = buildLocalRebirthLookups([nexusDef]);
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(nexusDef, {
      instanceId: "target-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target],
    });

    const result = executeEffect({
      chainId: "test:bsth04-cards:544",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "komachi-1",
      actingPlayerId: "alice",
      getCardDefinitionById: localLookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        localLookups.getRegisteredTriggeredEffectActions,
      targetInstanceIds: ["target-nexus"],
    });
    const alice = result.players.find((p) => p.id === "alice")!;
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "target-nexus"
    )!;

    expect(alice.countValue).toBe(1);
    expect(komachiAfter.normalCoreCount).toBe(3);
    expect(alice.voidNormalCoreCount).toBe(17);
    expect(targetAfter.zone).toBe("field");
    expect(targetAfter.pendingLeaveKind).not.toBeNull();
  });

  it("[board] Lvコスト+2で合体ホストが消滅したらブレイヴ選択前に小町へコア2個を置く", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const braveDef = testBraveDefinition("TEST-BSTH04-X03-BRAVE");
    const lookups = buildLocalRebirthLookups([braveDef]);
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-combined-host",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["target-attached-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "target-attached-brave",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: "target-combined-host",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target, brave],
    });

    let result = executeEffect({
      chainId: "test:bsth04-cards:602",
      state,
      effect: card.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "komachi-1",
      actingPlayerId: "alice",
      ...lookups,
      targetInstanceIds: ["target-combined-host"],
      targetStepId: "lv-cost-up",
    });
    const komachiBeforeChoice = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const aliceBeforeChoice = result.players.find((p) => p.id === "alice")!;

    expect(komachiBeforeChoice.normalCoreCount).toBe(3);
    expect(aliceBeforeChoice.voidNormalCoreCount).toBe(17);
    expect(result.pendingBraveLeaveChoice).toBeNull();
    result = finishKomachi(result, state, lookups);
    expect(result.pendingBraveLeaveChoice).toMatchObject({
      hostInstanceId: "target-combined-host",
      braveInstanceIds: ["target-attached-brave"],
    });
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);

    const keepAction = getLegalActions({
      state: result,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" && action.choice === "keep"
    );
    expect(keepAction).toBeDefined();

    const resolved = applyLegalAction({
      state: result,
      action: keepAction!,
      ...lookups,
    }).state;
    const komachiResolved = resolved.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const aliceResolved = resolved.players.find((p) => p.id === "alice")!;
    const targetResolved = resolved.cardInstances.find(
      (c) => c.instanceId === "target-combined-host"
    )!;
    const braveResolved = resolved.cardInstances.find(
      (c) => c.instanceId === "target-attached-brave"
    )!;

    expect(resolved.pendingBraveLeaveChoice).toBeNull();
    expect(resolved.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(
      resolved.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(false);
    expect(komachiResolved.normalCoreCount).toBe(3);
    expect(aliceResolved.voidNormalCoreCount).toBe(17);
    expect(targetResolved.zone).toBe("trash");
    expect(braveResolved.zone).toBe("field");
    expect(braveResolved.attachedToInstanceId).toBeNull();
  });

  it("[board] runActionMainResolution 経路で 同一効果の消滅結果と別誘発を二重キューしない", () => {
    const targetDef = vanishTriggeredSpiritDefinition(
      "TEST-BSTH04-X03-VANISH-TRIGGER"
    );
    const lookups = buildLocalRebirthLookups([targetDef]);
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-with-vanish-trigger",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target],
    });
    const chainId = "test:bsth04-x03:main-resolution";

    const result = runActionMainResolution({
      state,
      chainId,
      startLogs: [],
      endLogs: [],
      context: {
        chainId,
        actingPlayerId: "alice",
        sourceKind: "spirit",
        sourceCard: komachi,
        sourceDefinition: card,
        sourceInstanceId: komachi.instanceId,
        sourceEffectIndex: 0,
        targetInstanceIds: [target.instanceId],
        ...lookups,
        getRegisteredBurstActions: () => [],
      },
      resolveEffect: (currentState) =>
        executeEffect({
          state: currentState,
          effect: card.effects![0]!,
          effectIndex: 0,
          sourceInstanceId: komachi.instanceId,
          actingPlayerId: "alice",
          chainId,
          ...lookups,
          getRegisteredBurstActions: () => [],
          targetInstanceIds: [target.instanceId],
          targetStepId: "lv-cost-up",
        }),
    });
    const vanishPendings = result.pendingTriggeredEffects.filter(
      (pending) =>
        pending.eventKind === "vanish" &&
        pending.relatedInstanceId === target.instanceId
    );
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(vanishPendings).toHaveLength(1);
    expect(vanishPendings[0]!.chainId).toBe(chainId);
  });

  it("[board] Lvコスト+2で転醒待ちの対象が転醒選択前に小町にコア2個を置く", () => {
    const nexusDef = rebirthLvDeficitNexus(
      "TEST-BSTH04-REBIRTH(A)",
      "TEST-BSTH04-REBIRTH(B)"
    );
    const lookups = buildLocalRebirthLookups([nexusDef]);
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(nexusDef, {
      instanceId: "target-rebirth-pending",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target],
    });

    let result = executeEffect({
      chainId: "test:bsth04-cards:760",
      state,
      effect: card.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "komachi-1",
      actingPlayerId: "alice",
      ...lookups,
      targetInstanceIds: ["target-rebirth-pending"],
      targetStepId: "lv-cost-up",
    });
    const alice = result.players.find((p) => p.id === "alice")!;
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "target-rebirth-pending"
    )!;

    expect(alice.countValue).toBe(1);
    expect(komachiAfter.normalCoreCount).toBe(3);
    expect(alice.voidNormalCoreCount).toBe(17);
    expect(result.pendingTriggeredEffects).toHaveLength(0);
    result = finishKomachi(result, state, lookups);
    expect(targetAfter.zone).toBe("field");
    expect(targetAfter.pendingLeaveKind).toBe("vanish");
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(result.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "vanish",
        relatedInstanceId: "target-rebirth-pending",
      })
    );
    expect(result.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "target-rebirth-pending",
        kind: "vanish",
      })
    );

    const resolved = drainTriggeredEffectsAndStack(
      result,
      ["bob", "alice"],
      lookups
    );
    const aliceResolved = resolved.players.find((p) => p.id === "alice")!;
    const komachiResolved = resolved.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetResolved = resolved.cardInstances.find(
      (c) => c.instanceId === "target-rebirth-pending"
    )!;

    expect(resolved.pendingTriggeredEffects).toHaveLength(0);
    expect(resolved.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(resolved.log).toContain(
      "effect:rebirth:target-rebirth-pending:lv-deficit:retain=0<min=3"
    );
    expect(
      resolved.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(false);
    expect(aliceResolved.countValue).toBe(1);
    expect(komachiResolved.normalCoreCount).toBe(3);
    expect(aliceResolved.voidNormalCoreCount).toBe(17);
    expect(targetResolved.zone === "field").toBe(false);
  });

  it("[board] 魂状態選択前にコアを置き、decline 後も追加では置かない", () => {
    const targetDef = contractSpiritDefinition("TEST-BSTH04-CONTRACT");
    const lookups = buildLocalRebirthLookups([targetDef]);
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-contract",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      playerOverrides: [{}, { contractCardNo: targetDef.cardNo }],
      cardInstances: [komachi, target],
    });

    let pending = executeEffect({
      chainId: "test:bsth04-cards:852",
      state,
      effect: card.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: komachi.instanceId,
      actingPlayerId: "alice",
      ...lookups,
      targetInstanceIds: [target.instanceId],
      targetStepId: "lv-cost-up",
    });

    expect(
      pending.cardInstances.find((c) => c.instanceId === komachi.instanceId)
        ?.normalCoreCount
    ).toBe(3);
    expect(pending.pendingSoulStateReplacement).toBeNull();
    pending = finishKomachi(pending, state, lookups);
    expect(pending.pendingSoulStateReplacement).toMatchObject({
      cardInstanceId: target.instanceId,
      choosingPlayerId: "bob",
    });
    expect(pending.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(pending.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: target.instanceId,
        kind: "vanish",
      })
    );

    const decline = getLegalActions({
      state: pending,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_soul_state_replacement" &&
        action.choice === "decline"
    );
    expect(decline).toBeDefined();

    const resolved = applyLegalAction({
      state: pending,
      action: decline!,
      ...lookups,
    }).state;
    const komachiResolved = resolved.cardInstances.find(
      (c) => c.instanceId === komachi.instanceId
    )!;
    const targetResolved = resolved.cardInstances.find(
      (c) => c.instanceId === target.instanceId
    )!;

    expect(resolved.pendingSoulStateReplacement).toBeNull();
    expect(resolved.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(
      resolved.pendingLeaveEntities.some(
        (pendingLeave) => pendingLeave.instanceId === target.instanceId
      )
    ).toBe(false);
    expect(targetResolved.zone).toBe("trash");
    expect(targetResolved.pendingLeaveKind).toBeNull();
    expect(komachiResolved.normalCoreCount).toBe(3);
    expect(
      resolved.log.some((entry) =>
        entry.startsWith("effect:after_triggers:resume:")
      )
    ).toBe(false);
  });

  it("[board] 複数preSelectedされてもLvコスト変更は対象1つだけに適用する", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target1 = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target2 = createCardInstance(targetDef, {
      instanceId: "target-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target1, target2],
    });

    const result = runEffect(state, card.effects![0]!, "komachi-1", "alice", [
      "target-1",
      "target-2",
    ]);
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const target1After = result.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    const target2After = result.cardInstances.find(
      (c) => c.instanceId === "target-2"
    )!;

    expect(komachiAfter.normalCoreCount).toBe(3);
    expect(target1After.zone).toBe("field");
    expect(target1After.pendingLeaveKind).toBe("vanish");
    expect(target2After.zone).toBe("field");
  });

  it("[board] 導界者ネクサスは導界者対象ではないLvコスト変更のpreSelected対象にできない", () => {
    const nexusDef = cardNoMap.get("BSTH04-X01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(nexusDef, {
      instanceId: "guided-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target],
    });

    const result = runEffect(state, card.effects![0]!, "komachi-1", "alice", [
      "guided-nexus",
    ]);
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "guided-nexus"
    )!;

    expect(komachiAfter.normalCoreCount).toBe(1);
    expect(targetAfter.zone).toBe("field");
  });

  it("[board] 自分のスピリットは相手対象ではないためpreSelectedでもLvコスト変更しない", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "own-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 20,
      cardInstances: [komachi, target],
    });

    const result = runEffect(state, card.effects![0]!, "komachi-1", "alice", [
      "own-target",
    ]);
    const alice = result.players.find((p) => p.id === "alice")!;
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "own-target"
    )!;

    expect(alice.countValue).toBe(1);
    expect(komachiAfter.normalCoreCount).toBe(1);
    expect(targetAfter.zone).toBe("field");
  });

  it("[board] Lvコスト変更は効果耐性を持つ相手スピリットには適用されない", () => {
    const immuneDef = cardNoMap.get("BSTH04-R01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(immuneDef, {
      instanceId: "immune-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 20,
        cardInstances: [komachi, target],
      }),
      getCardDefinitionById
    );

    const result = runEffect(state, card.effects![0]!, "komachi-1", "alice", [
      "immune-target",
    ]);
    const komachiAfter = result.cardInstances.find(
      (c) => c.instanceId === "komachi-1"
    )!;
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "immune-target"
    )!;

    expect(komachiAfter.normalCoreCount).toBe(1);
    expect(targetAfter.zone).toBe("field");
  });

  it("[engine] Lvコスト上昇だけで消滅する場合は上昇前の安定Lvでsnapshotを凍結する", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveLvSnapshot: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 20,
        cardInstances: [komachi, target],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-lv-cost",
          sourceInstanceId: "komachi-1",
          sourceDefinitionId: "BSTH04-X03",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "target-1",
          metadata: { properties: { levelCostDelta: 2 } },
        },
      ],
    };

    const result = runStateBasedActions(state, getCardDefinitionById);
    const targetAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;

    expect(result.checks).toContainEqual({
      kind: "vanish_due_to_core_deficit",
      instanceId: "target-1",
      detail: "cores=1 < minimum=3",
    });
    expect(targetAfter.pendingLeaveKind).toBe("vanish");
    expect(targetAfter.pendingLeaveLvSnapshot).toBe(1);
  });

  it("[engine] Lvコスト上昇だけで消滅する初期snapshot未設定カードは上昇前Lvでfallback凍結する", () => {
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-no-snapshot",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 20,
        cardInstances: [komachi, target],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-lv-cost-no-snapshot",
          sourceInstanceId: "komachi-1",
          sourceDefinitionId: "BSTH04-X03",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "target-no-snapshot",
          metadata: { properties: { levelCostDelta: 2 } },
        },
      ],
    };

    const result = runStateBasedActions(state, getCardDefinitionById);
    const targetAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "target-no-snapshot"
    )!;

    expect(targetAfter.pendingLeaveKind).toBe("vanish");
    expect(targetAfter.pendingLeaveLvSnapshot).toBe(1);
  });

  it("[engine] Lvコスト上昇だけで消滅するネクサスも上昇前の安定Lvでsnapshotを凍結する", () => {
    const nexusDef = cardNoMap.get("BSTH04-転醒R02(A)")!;
    const komachi = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(nexusDef, {
      instanceId: "target-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveLvSnapshot: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 20,
        cardInstances: [komachi, target],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-nexus-lv-cost",
          sourceInstanceId: "komachi-1",
          sourceDefinitionId: "BSTH04-X03",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "target-nexus",
          metadata: { properties: { levelCostDelta: 2 } },
        },
      ],
    };

    const result = runStateBasedActions(state, getCardDefinitionById);
    const targetAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "target-nexus"
    )!;

    expect(result.checks).toContainEqual({
      kind: "vanish_due_to_core_deficit",
      instanceId: "target-nexus",
      detail: "cores=0 < minimum=2",
    });
    expect(targetAfter.pendingLeaveKind).toBe("vanish");
    expect(targetAfter.pendingLeaveLvSnapshot).toBe(1);
  });
});

describe("BSTH04-C01/C02 6色 stack negate", () => {
  it("BSTH04-C01 は相手の6色スピリット召喚だけを無効化対象にする", () => {
    const card = cardNoMap.get("BSTH04-C01")!;
    const negateEffect = card.effects!.find((effect) =>
      effect.textRef?.includes(5)
    )!;

    expect(negateEffect.stub).toBeUndefined();
    expect(negateEffect.timingScope).toEqual({
      player: "opponent",
      period: "turn",
    });
    const negate = negateEffect.steps[1]!.action;
    expect(negate.kind).toBe("negate");
    if (negate.kind === "negate") {
      expect(negate.negateTarget).toBe("summon");
      expect(negate.targetFilter).toEqual({
        category: ["spirit"],
        colors: ["red", "purple", "green", "white", "yellow", "blue"],
        colorsLogic: "and",
        colorCount: { min: 6, max: 6 },
      });
    }
  });

  it("BSTH04-C02 は相手の6色ネクサス配置だけを無効化対象にする", () => {
    const card = cardNoMap.get("BSTH04-C02")!;
    const negateEffect = card.effects!.find((effect) =>
      effect.textRef?.includes(5)
    )!;

    expect(negateEffect.stub).toBeUndefined();
    expect(negateEffect.timingScope).toEqual({
      player: "opponent",
      period: "turn",
    });
    const negate = negateEffect.steps[1]!.action;
    expect(negate.kind).toBe("negate");
    if (negate.kind === "negate") {
      expect(negate.negateTarget).toBe("place");
      expect(negate.targetFilter).toEqual({
        category: ["nexus"],
        colors: ["red", "purple", "green", "white", "yellow", "blue"],
        colorsLogic: "and",
        colorCount: { min: 6, max: 6 },
      });
    }
  });
});

describe("BSTH04-転醒R02(A) 太陽の畑", () => {
  const card = cardNoMap.get("BSTH04-転醒R02(A)")!;

  it("転醒(カウント3以下、ライフ増減/相手離脱トリガー) / 配置時BP-5000破壊 / Lv2スタック抑制の構造", () => {
    // 転醒トリガー[0]: ライフ増減 (game_event reduce_life/core_placed_on_life) → rebirth.maxCount=3
    const lifeTrigger = card.effects![0]!;
    expect(lifeTrigger.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: ["reduce_life", "core_placed_on_life"],
    });
    const rebirthFromLife = lifeTrigger.steps[0]!.action;
    expect(rebirthFromLife.kind).toBe("rebirth");
    if (rebirthFromLife.kind === "rebirth")
      expect(rebirthFromLife.maxCount).toBe(3);

    // 転醒トリガー[1]: 相手によるフィールド離脱 (card_event leave_field cause:opponent_effect)
    const leaveTrigger = card.effects![1]!;
    expect(leaveTrigger.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
    const rebirthFromLeave = leaveTrigger.steps[0]!.action;
    expect(rebirthFromLeave.kind).toBe("rebirth");
    if (rebirthFromLeave.kind === "rebirth")
      expect(rebirthFromLeave.maxCount).toBe(3);

    // 配置時: bp_modify -5000 → destroy(maxBp:0)
    const place = card.effects![2]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    const bp = place.steps[0]!.action;
    expect(bp.kind).toBe("bp_modify");
    if (bp.kind === "bp_modify") expect(bp.amount).toBe(-5000);
    expect(place.steps[1]!.action.kind).toBe("destroy");

    // Lv2『自分のアタックステップ』系統楽族/冥主のターン最初のアタック宣言〜バトル終了後まで
    // 相手はスタック効果を発揮できない (engine-relative-duration-battle-scope-stack-restrict、
    // 詳細な盤面変化検証は bsth04-transform-r02-a-stack-restrict.test.ts)。
    const stackRestrict = card.effects![3]!;
    expect(stackRestrict.stub).toBeUndefined();
    expect(stackRestrict.timing).toEqual({
      kind: "continuous",
    });
    expect(stackRestrict.condition).toContainEqual({
      kind: "attack_occurred",
      scope: "turn",
      player: "self",
      cardFilter: { category: ["spirit"], tribes: ["楽族", "冥主"] },
      currentBattleOrdinal: 1,
    });
    const restrictStep = stackRestrict.steps[0]!.action;
    expect(restrictStep.kind).toBe("restrict_stack");
  });

  it("Lvコスト+2で消滅した転醒ネクサスはB面最低コア不足なら転醒を中断し、カウントを増やさない", () => {
    const nexus = {
      ...createCardInstance(card, {
        instanceId: "taiyo-lv-cost",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      }),
      pendingLeaveKind: "vanish" as const,
      pendingLeaveCause: "state_based_action" as const,
      pendingLeaveChainId: "chain-lv-cost",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus],
      }),
      pendingLeaveEntities: [
        {
          instanceId: "taiyo-lv-cost",
          kind: "vanish",
          cause: "state_based_action",
          causePlayerId: "bob",
          chainId: "chain-lv-cost",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
          causedByEffectSourceInstanceId: "komachi-1",
        },
      ],
      pendingTriggeredEffects: [queuedLeaveReplacementTrigger("taiyo-lv-cost")],
      activeContinuousEffects: [
        {
          effectId: "ce-taiyo-lv-cost",
          sourceInstanceId: "komachi-1",
          sourceDefinitionId: "BSTH04-X03",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "taiyo-lv-cost",
          metadata: { properties: { levelCostDelta: 2 } },
        },
      ],
    };

    const resolved = executeRebirth(
      state,
      "alice",
      { kind: "rebirth", maxCount: 3 },
      "taiyo-lv-cost",
      getCardDefinitionById,
      "test:bsth04-cards:1389"
    );
    const after = resolved.cardInstances.find(
      (c) => c.instanceId === "taiyo-lv-cost"
    )!;

    expect(after.definitionId).toBe("BSTH04-転醒R02(A)");
    expect(after.pendingLeaveKind).toBe("vanish");
    expect(resolved.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "taiyo-lv-cost",
        kind: "vanish",
        cause: "effect_resolution",
        causePlayerId: "alice",
        chainId: "effect:rebirth:taiyo-lv-cost:lv-deficit",
      })
    );
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(0);
    expect(resolved.log).toContain(
      "effect:rebirth:taiyo-lv-cost:lv-deficit:retain=0<min=2"
    );
    expect(resolved.log).toContain(
      "pending-leave-transition:vanish->vanish:taiyo-lv-cost"
    );
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) => pending.pendingId === "rebirth-taiyo-lv-cost"
      )
    ).toBe(false);
    expect(
      resolved.log.some((l) => l.includes(":flip_to:BSTH04-転醒R02(B)"))
    ).toBe(false);

    const flushed = flushPendingLeaves(resolved, getCardDefinitionById);
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "taiyo-lv-cost")!.zone
    ).toBe("trash");
  });

  it("配置時 実行: BP2000 の相手スピリットの実効BPが BP-5000 で 0 以下になる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "taiyo-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    // BSTH04-C01 チルノ: Lv1 BP2000 → -5000 で実効 BP 0 以下（destroy(maxBp:0) 対象）。
    const enemyDef = cardNoMap.get("BSTH04-C01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
    };
    const before = getEffectiveBp(
      state,
      enemy,
      enemyDef,
      getCardDefinitionById
    );
    expect(before).toBe(2000);

    const result = runEffect(state, card.effects![2]!, "taiyo-1", "alice");
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    )!;
    const after = getEffectiveBp(
      result,
      enemyAfter,
      enemyDef,
      getCardDefinitionById
    );
    expect(after).toBeLessThanOrEqual(0);
  });

  // 回帰: 転醒トリガーは fidelity stub (timing:continuous + rebirth)。配置時の
  // play_card_action 解決でこれを自動実行すると「カウント3以下」ゲートだけで
  // 強制発火し、配置直後に彼岸 (BSTH04-転醒R02(B)) へ裏返ってしまうバグがあった。
  // isStubRebirthEffect ガードで play_card_action / CE 構築の双方が skip するため、
  // 配置直後は表面 (太陽の畑) のままでなければならない。
  it("配置時: 転醒 stub が自動発火せず、彼岸に裏返らない (カウント3以下でも)", () => {
    const effectLookups = {
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card, {
          instanceId: "taiyo-place",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      // 軽減シンボルが場に無いので finalCost = 印字コスト 3。
      playerOverrides: [
        { reserveNormalCoreCount: 3 },
        { reserveNormalCoreCount: 3 },
      ],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    // 前提: alice のカウントは 0 (= 転醒条件「カウント3以下」を満たす)。
    expect(state.players.find((p) => p.id === "alice")?.countValue ?? 0).toBe(
      0
    );

    const place = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    }).find((action) => action.kind === "place_nexus");
    expect(place).toBeDefined();

    const opened = applyLegalAction({
      state,
      action: place!,
      getCardDefinitionById,
      ...effectLookups,
      paymentSources: [{ kind: "reserve", amount: 3 }],
    }).state;

    // 相手 (bob) がスタックをパス → 配置確定へ。
    const passBob = getLegalActions({
      state: opened,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passBob).toBeDefined();
    const pending = applyLegalAction({
      state: opened,
      action: passBob!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;

    // 維持コア配置 (requiredCores 0 → 0 個) を解決 = enter-field → resolve-main。
    const resolvePlacement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: pending,
      action: resolvePlacement!,
      getCardDefinitionById,
      ...effectLookups,
      enterFieldCorePlacements: [],
    }).state;

    const placed = resolved.cardInstances.find(
      (c) => c.instanceId === "taiyo-place"
    )!;
    // 表面 (太陽の畑) のまま。彼岸 (B) に裏返っていない。
    expect(placed.zone).toBe("field");
    expect(placed.definitionId).toBe("BSTH04-転醒R02(A)");
    // 彼岸の「裏返ったときカウント+1」も発火していない。
    expect(
      resolved.players.find((p) => p.id === "alice")?.countValue ?? 0
    ).toBe(0);
    // 念のため転醒ログが出ていないこと。
    expect(
      resolved.log.some((l) => l.includes(":flip_to:BSTH04-転醒R02(B)"))
    ).toBe(false);
  });
});

describe("BSTH04-転醒R01(A) 浄玻璃の鏡", () => {
  const card = cardNoMap.get("BSTH04-転醒R01(A)")!;

  it("grandstoneData(解封: 楽族/冥主の手札増加, 転醒: コア4・カウント5・1個残しボイド) + 配置時破棄・任意回収 + 神秘suppress / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const gs = card.grandstoneData!;
    expect(gs).toBeDefined();
    expect(gs.unsealConditions).toHaveLength(1);
    expect(gs.unsealConditions[0]!.events).toEqual(["hand_increase"]);
    expect(gs.unsealConditions[0]!.causeFilter?.tribes).toEqual([
      "楽族",
      "冥主",
    ]);
    expect(gs.rebirthCoreThreshold).toBe(4);
    expect(gs.rebirthMaxCount).toBe(5);
    expect(gs.rebirthRetainCores).toBe(1);

    // 配置時: deck_reveal (上2枚→トラッシュ, 起幻 黄/紫1枚ピック)
    const place = card.effects![0]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    const reveal = place.steps[0]!.action;
    expect(reveal.kind).toBe("move_card");
    if (reveal.kind === "move_card") {
      expect(reveal.count).toBe(2);
      expect(reveal.to.zone).toBe("trash");
    }

    // 【神秘】: 自分のトラッシュに起幻がある間、フィールドの6色カードの効果を自他とも抑止する。
    const mystic = card.effects![1]!;
    expect(mystic.stub).toBeUndefined();
    expect(mystic.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      zone: "trash",
      tribes: ["起幻"],
    });
    expect(mystic.steps).toHaveLength(2);
    for (const [index, player] of (["self", "opponent"] as const).entries()) {
      const suppress = mystic.steps[index]!.action;
      expect(suppress.kind).toBe("suppress_effect");
      if (suppress.kind === "suppress_effect") {
        expect(suppress.duration).toEqual({ scope: "while_on_field" });
        expect(suppress.target.kind).toBe("filter");
        if (suppress.target.kind === "filter") {
          expect(suppress.target.player).toBe(player);
          expect(suppress.target.count).toBe("all");
          expect(suppress.target.filter).toMatchObject({
            category: ["spirit", "ultimate", "nexus"],
            colors: ["red", "purple", "green", "white", "yellow", "blue"],
            colorsLogic: "and",
            colorCount: { min: 6, max: 6 },
            targetsGrandwalker: true,
          });
        }
      }
    }
  });

  it("BSTH04-転醒R01(A): トラッシュ起幻がある間だけ6色カードの効果を抑止する", () => {
    const sixColorContinuous = cardNoMap.get("BSTH01-M03")!;
    const sevenColorContinuous: CardDefinition = {
      ...sixColorContinuous,
      cardNo: "TEST-SEVEN-COLOR-CONTINUOUS",
      colors: [...sixColorContinuous.colors, "black"],
    };
    const baseContinuousEffect = sixColorContinuous.effects![0]!;
    const unconditionalSixColor: CardDefinition = {
      ...sixColorContinuous,
      cardNo: "TEST-UNCONDITIONAL-SIX-COLOR-CONTINUOUS",
      effects: [
        {
          timing: baseContinuousEffect.timing,
          steps: baseContinuousEffect.steps,
          textRef: baseContinuousEffect.textRef,
        },
      ],
    };
    const scopedSixColor: CardDefinition = {
      ...sixColorContinuous,
      cardNo: "TEST-SCOPED-SIX-COLOR-CONTINUOUS",
      effects: [
        {
          timing: baseContinuousEffect.timing,
          timingScope: { player: "self", period: "attack" },
          steps: baseContinuousEffect.steps,
          textRef: baseContinuousEffect.textRef,
        },
      ],
    };
    const localGetCardDefinitionById = (id: string) =>
      id === sevenColorContinuous.cardNo
        ? sevenColorContinuous
        : id === unconditionalSixColor.cardNo
          ? unconditionalSixColor
          : id === scopedSixColor.cardNo
            ? scopedSixColor
            : getCardDefinitionById(id);
    const source = createCardInstance(card, {
      instanceId: "kagami-mystic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const trashKigen = createCardInstance(card, {
      instanceId: "trash-kigen",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const target = createCardInstance(sixColorContinuous, {
      instanceId: "six-color-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const sevenColorTarget = createCardInstance(sevenColorContinuous, {
      instanceId: "seven-color-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const unconditionalTarget = createCardInstance(unconditionalSixColor, {
      instanceId: "unconditional-six-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const scopedTarget = createCardInstance(scopedSixColor, {
      instanceId: "scoped-six-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });

    const withoutTrash = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          source,
          target,
          sevenColorTarget,
          unconditionalTarget,
          scopedTarget,
        ],
      },
      localGetCardDefinitionById
    );
    expect(
      withoutTrash.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toHaveLength(0);
    expect(
      withoutTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "six-color-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);
    expect(
      withoutTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "seven-color-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);
    expect(
      withoutTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "unconditional-six-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);
    expect(
      withoutTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "scoped-six-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);

    const withTrash = rebuildContinuousEffectsFromField(
      {
        ...withoutTrash,
        cardInstances: [
          source,
          trashKigen,
          target,
          sevenColorTarget,
          unconditionalTarget,
          scopedTarget,
        ],
      },
      localGetCardDefinitionById
    );
    const suppressions = withTrash.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    expect(suppressions).toHaveLength(2);
    expect(
      suppressions.map((ce) => ce.metadata?.suppressTargetPlayer).sort()
    ).toEqual(["opponent", "self"]);
    expect(
      withTrash.activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId === "six-color-spirit"
      )
    ).toHaveLength(0);
    expect(
      withTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "seven-color-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);
    // Ver.17.0: 発揮場所・発揮条件のない常時効果は発揮抑止を受けない。
    expect(
      withTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "unconditional-six-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);
    // Ver.17.0: timingScope は有効期間を狭めるだけで、発揮場所・発揮条件ではない。
    expect(
      withTrash.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "scoped-six-spirit" &&
          ce.modifierTag === "cost_override"
      )
    ).toHaveLength(1);

    const reeval = runReevaluationAtTiming({
      state: withTrash,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba" as const,
            checks: ["effect_suppression" as const],
            failurePolicy: "abort_remaining" as const,
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: "six-color-spirit",
      targetInstanceIds: [],
      suppressionEffectDescriptor: {
        timingKind: "card_event",
        triggerPhrases: ["配置時"],
      },
      getCardDefinitionById: localGetCardDefinitionById,
    });
    expect(reeval.passed).toBe(false);
    expect(reeval.failedChecks).toEqual(["effect_suppression"]);
  });

  it("配置時 実行: デッキ上2枚を破棄し任意回収を選ぶ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "kagami-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const deckDef = cardNoMap.get("BSTH04-C01")!;
    const top1 = createCardInstance(deckDef, {
      instanceId: "deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const top2 = createCardInstance(deckDef, {
      instanceId: "deck-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, top1, top2],
    };
    const result = runEffect(state, card.effects![0]!, "kagami-1", "alice");
    expect(result.pendingDeckReveal).toBeNull();
    expect(result.pendingStepOptionalChoice).toBeTruthy();
    const revealedZones = result.cardInstances
      .filter((c) => c.instanceId === "deck-1" || c.instanceId === "deck-2")
      .map((c) => c.zone);
    expect(revealedZones).toEqual(["trash", "trash"]);
  });
});

describe("BSTH04-C12 投銭「宵越しの銭」", () => {
  const card = cardNoMap.get("BSTH04-C12")!;

  it("メイン効果は択一 choice: デフォルト=2枚ドロー / choice[0]=トラッシュ回収（ターンに1回:同名）", () => {
    const main = card.effects![0]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    expect(main.stub).toBeUndefined();
    const step = main.steps[0]!;
    // デフォルト action = 2枚ドロー
    expect(step.action.kind).toBe("draw");
    if (step.action.kind === "draw") expect(step.action.count).toBe(2);
    // choice[0] = トラッシュ回収、変種別 usageLimit「ターンに1回:同名」
    expect(step.choice).toHaveLength(1);
    const branch = step.choice![0]!;
    expect(branch.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(branch.action.kind).toBe("search_zone");
    if (branch.action.kind === "search_zone") {
      expect(branch.action.zone).toBe("trash");
      expect(branch.action.destination).toBe("hand");
      expect(branch.action.filter?.tribes).toEqual(["起幻"]);
      expect(branch.action.filter?.colors).toEqual(["yellow", "purple"]);
    }
  });

  it("choiceIndex 0 実行: 自分のデッキから2枚ドローし手札が2枚増える", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "zeni-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    // デッキに 2 枚積む。
    const deckDef = cardNoMap.get("BSTH04-C01")!;
    const deck = [1, 2].map((n) =>
      createCardInstance(deckDef, {
        instanceId: `deck-${n}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const aliceHandBefore = base.players.find(
      (p) => p.id === "alice"
    )!.handCount;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    const result = executeEffect({
      chainId: "test:bsth04-cards:1937",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "zeni-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 0,
    });
    const aliceAfter = result.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.handCount).toBe(aliceHandBefore + 2);
    const handZones = result.cardInstances
      .filter((c) => c.instanceId === "deck-1" || c.instanceId === "deck-2")
      .map((c) => c.zone);
    expect(handZones).toEqual(["hand", "hand"]);
  });

  it("choiceIndex 1 実行: トラッシュの系統:「起幻」黄/紫1枚を手札へ戻す pending を生成", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "zeni-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    // トラッシュに回収候補（起幻 黄/紫）。BSTH04-C12 自身が 紫 + 起幻 で適合。
    const recoverTarget = createCardInstance(card, {
      instanceId: "recover-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, recoverTarget],
    };
    const result = executeEffect({
      chainId: "test:bsth04-cards:1976",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "zeni-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    // search_zone(trash→hand) は回収対象選択 pending を生成する（候補1体）。
    expect(
      result.pendingZoneSelection ?? result.pendingTrashOptionalAdds
    ).toBeTruthy();
  });

  it("スタック効果 effects[1]: timingScope=opponent/attack + 相手スピリット/アルティメット filter + minRemainingPerCandidate:1 で stub 解消", () => {
    const stack = card.effects![1]!;
    expect(stack.stub).toBeUndefined();
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({
      player: "opponent",
      period: "attack",
    });
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.amount).toBe(1);
      expect(action.from.kind).toBe("field");
      if (action.from.kind === "field") {
        expect(action.from.player).toBe("opponent");
        expect(action.from.filter?.category).toEqual(["spirit", "ultimate"]);
        expect(action.from.minRemainingPerCandidate).toBe(1);
      }
      expect(action.to.kind).toBe("reserve");
      if (action.to.kind === "reserve") {
        expect(action.to.player).toBe("opponent");
      }
    }
  });
});

describe("BSTH04-転醒R02(B) 彼岸（裏面）", () => {
  const front = cardNoMap.get("BSTH04-転醒R02(A)")!;
  const back = front.backFace!;

  it("[2,3] 転醒時: トラッシュ召喚 + trashCoreMax:1（コアもトラッシュから置ける）の構造 / stub 解消", () => {
    const summonEffect = back.effects![0]!;
    expect(summonEffect.timing).toEqual({
      kind: "card_event",
      event: "rebirth",
    });
    expect(summonEffect.stub).toBeUndefined();
    const action = summonEffect.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.costModifier).toBe("free");
      expect(action.trashCoreMax).toBe(1);
      expect(action.trashCoreKind).toBe("generic");
      if (action.target.kind === "from_zone") {
        expect(action.target.zone).toBe("trash");
        expect(action.target.filter?.tribes).toEqual(["楽族", "冥主"]);
        expect(action.target.filter?.maxCost).toBe(5);
      }
    }
  });

  it("[2,3] 実行: reserve 0 でも維持コアをトラッシュ通常コアから1個置いて召喚する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexus = createCardInstance(back, {
      instanceId: "higan-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    // 召喚対象: BSTH04-C01 チルノ (冥主, コスト3, Lv1 requiredCores=1) をトラッシュに置く。
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const summonTarget = createCardInstance(targetDef, {
      instanceId: "chiruno-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [nexus, summonTarget],
      // reserve を 0、trash に通常コア 1 個 → 維持コアは trash からのみ充当可能。
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, reserveNormalCoreCount: 0, trashNormalCoreCount: 1 }
          : p
      ),
    };

    const result = runEffect(state, back.effects![0]!, "higan-1", "alice");

    expect(result.pendingMultiPlacement).toMatchObject({
      actingPlayerId: "alice",
      trashCoreMax: 1,
      targets: [
        expect.objectContaining({
          instanceId: "chiruno-1",
          minimumCoreCount: 1,
          enterFieldEventKind: "summon",
        }),
      ],
    });

    const action = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: result,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "chiruno-1",
          placements: [{ kind: "trash_normal", amount: 1 }],
        },
      ],
    }).state;

    const summoned = result.cardInstances.find(
      (c) => c.instanceId === "chiruno-1"
    )!;
    // フィールドへ召喚され、維持コアは pendingMultiPlacement 経由で置く。
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(0);
    const summonedAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "chiruno-1"
    )!;
    expect(summonedAfter.zone).toBe("field");
    expect(summonedAfter.normalCoreCount).toBe(1);
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
    expect(aliceAfter.reserveNormalCoreCount).toBe(0);
  });

  it("[2,3] 実行: generic trashCoreMax はトラッシュのソウルコアも維持コアに選べる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexus = createCardInstance(back, {
      instanceId: "higan-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const targetDef = cardNoMap.get("BSTH04-C01")!;
    const summonTarget = createCardInstance(targetDef, {
      instanceId: "chiruno-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [nexus, summonTarget],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveNormalCoreCount: 0,
              reserveSoulCoreCount: 0,
              trashNormalCoreCount: 0,
              trashSoulCoreCount: 1,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };

    const result = runEffect(state, back.effects![0]!, "higan-1", "alice");

    expect(result.pendingMultiPlacement).toMatchObject({
      actingPlayerId: "alice",
      trashCoreMax: 1,
      targets: [
        expect.objectContaining({
          instanceId: "chiruno-1",
          minimumCoreCount: 1,
        }),
      ],
    });
    const action = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: result,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "chiruno-1",
          placements: [{ kind: "trash_soul" }],
        },
      ],
    }).state;

    expect(resolved.pendingMultiPlacement).toBeNull();
    const summonedAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "chiruno-1"
    )!;
    expect(summonedAfter.zone).toBe("field");
    expect(summonedAfter.normalCoreCount).toBe(0);
    expect(summonedAfter.soulCoreCount).toBe(1);
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "chiruno-1",
    });
  });
});

describe("BSTH04-X02 風見幽香 — 反復発揮 (step.repeat / カウント連動)", () => {
  const card = cardNoMap.get("BSTH04-X02")!;

  it("カード data: bp_modify step は各反復を on_step で選び直し、C連鎖1以上の破壊時抑止がある", () => {
    const attackEffect = card.effects![0]!;
    expect(attackEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(attackEffect.stub).toBeUndefined();
    expect(
      card.effects!.some(
        (effect) =>
          effect.stub?.includes("C連鎖】1以上") ||
          effect.stub?.includes("破壊時効果抑止")
      )
    ).toBe(false);
    const bpStep = attackEffect.steps[0]!;
    expect(bpStep.action.kind).toBe("bp_modify");
    expect(bpStep.repeat).toBeDefined();
    expect(bpStep.repeat!.additional).toEqual({
      source: { kind: "count_value", player: "self" },
    });
    expect(bpStep.targetSelectionTiming).toBe("on_step");
    const normalDestroy = attackEffect.steps[1]!.action;
    expect(normalDestroy.kind).toBe("destroy");
    if (normalDestroy.kind === "destroy") {
      expect(normalDestroy.suppressDestroyedEffects).toBeUndefined();
    }
    expect(attackEffect.steps[1]!.condition).toEqual([
      { kind: "count_value", player: "self", max: 0 },
    ]);
    const suppressDestroy = attackEffect.steps[2]!.action;
    expect(suppressDestroy.kind).toBe("destroy");
    if (suppressDestroy.kind === "destroy") {
      expect(suppressDestroy.suppressDestroyedEffects).toBe("destroyed_only");
    }
    expect(attackEffect.steps[2]!.condition).toEqual([
      { kind: "count_value", player: "self", min: 1 },
    ]);
  });

  it("登録: mandatory dynamic repeat の対象を宣言時に一括確定しない", () => {
    const reg = generateBattleImmediateEffectRegistrations(card)[0]!;
    expect(reg.requiredTargetCount).toBeUndefined();
    expect(reg.requiredTargetCountDynamic).toBeUndefined();
    expect(reg.maxTargetCount).toBeUndefined();
    expect(reg.maxTargetCountDynamic).toBeUndefined();
    expect(reg.allowDuplicateTargets).toBeUndefined();
  });

  it("実行: カウント2 → BP-10000 を 1+2=3 回適用し BP30000 の相手を 0 以下にして破壊", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      // 自分のカウント = 2 → 反復追加 2 回 (合計 3 回の BP-10000)。
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // 八雲 紫 Lv3 BP30000 (要 5 コア)。-10000×3 = -30000 で実効 BP 0 → destroy(maxBp:0)。
    const enemyDef = cardNoMap.get("BSTH02-XX01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "yukari-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    // 同じ候補を事前に3体分まとめて固定せず、各発揮で選択窓を開く。
    const alternate = createCardInstance(enemyDef, {
      instanceId: "yukari-1-alternate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy, alternate],
    };
    const before = getEffectiveBp(
      state,
      enemy,
      enemyDef,
      getCardDefinitionById
    );
    expect(before).toBe(30000);

    let result = runEffect(state, card.effects![0]!, "yuuka-1", "alice");
    expect(
      result.pendingStepOptionalTargetSelection?.candidateInstanceIds.sort()
    ).toEqual(["yukari-1", "yukari-1-alternate"]);
    // 基礎回、追加1回目、追加2回目をそれぞれ更新済み盤面から選ぶ。
    result = resolvePendingStepTargetSelection(result, ["yukari-1"]);
    expect(
      result.pendingStepOptionalTargetSelection?.candidateInstanceIds.sort()
    ).toEqual(["yukari-1", "yukari-1-alternate"]);
    result = resolvePendingStepTargetSelection(result, ["yukari-1"]);
    expect(
      result.pendingStepOptionalTargetSelection?.candidateInstanceIds.sort()
    ).toEqual(["yukari-1", "yukari-1-alternate"]);
    result = resolvePendingStepTargetSelection(result, ["yukari-1"]);
    // 反復発揮ログが追加回数ぶん残る (1 + 2 回の bp_modify)。
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(2);
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:yukari-1:-10000")
    );
    expect(bpLogs.length).toBe(3);
    // 3 回の -10000 で BP30000 が 0 以下 → destroy(maxBp:0) が発火する。
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "yukari-1"
    )!;
    const after = getEffectiveBp(
      result,
      enemyAfter,
      enemyDef,
      getCardDefinitionById
    );
    expect(after).toBeLessThanOrEqual(0);
    expect(
      result.log.some((l) => l.startsWith("effect:destroy:alice:yukari-1"))
    ).toBe(true);
    // 対象選択を pending 経由で解決した実経路では、最終発揮後に離脱処理まで完了する。
    expect(enemyAfter.zone).toBe("trash");
  });

  it("実行: カウント2の3回 on_step 選択後、C連鎖2はライフのコアだけをトラッシュへ置く", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-chain-two",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // それぞれ1回だけ選ぶので、BP30000 の3体はいずれも生存する。
    // これにより破壊カードのコア移動を混ぜず、C連鎖2の life→trash を単独で検証する。
    const enemyDef = cardNoMap.get("BSTH02-XX01")!;
    const targets = ["life-chain-1", "life-chain-2", "life-chain-3"].map(
      (instanceId) =>
        createCardInstance(enemyDef, {
          instanceId,
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 5,
        })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...targets],
    };
    const bobBefore = state.players.find((player) => player.id === "bob")!;
    const lifeBefore = getPlayerLifeCoreCount(bobBefore);
    const trashBefore = bobBefore.trashNormalCoreCount;
    const reserveBefore = bobBefore.reserveNormalCoreCount;

    let result = runEffect(state, card.effects![0]!, self.instanceId, "alice");
    for (const target of targets) {
      expect(
        result.pendingStepOptionalTargetSelection?.candidateInstanceIds.sort()
      ).toEqual(targets.map((entry) => entry.instanceId).sort());
      result = resolvePendingStepTargetSelection(result, [target.instanceId]);
    }

    const bobAfter = result.players.find((player) => player.id === "bob")!;
    expect(getPlayerLifeCoreCount(bobAfter)).toBe(lifeBefore - 1);
    expect(bobAfter.trashNormalCoreCount).toBe(trashBefore + 1);
    expect(bobAfter.reserveNormalCoreCount).toBe(reserveBefore);
    expect(
      result.cardInstances
        .filter((entry) => entry.instanceId.startsWith("life-chain-"))
        .map((entry) => entry.zone)
    ).toEqual(["field", "field", "field"]);
  });

  it("実行: カウント0 → 反復なし (BP-10000 を 1 回のみ)。BP30000 は破壊されず残る", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyDef = cardNoMap.get("BSTH02-XX01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "yukari-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const alternate = createCardInstance(enemyDef, {
      instanceId: "yukari-2-alternate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy, alternate],
    };
    const result = resolvePendingStepTargetSelection(
      runEffect(state, card.effects![0]!, "yuuka-2", "alice"),
      ["yukari-2"]
    );
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(0);
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "yukari-2"
    )!;
    // -10000 1 回のみ → 実効 BP 20000 で生存。
    expect(enemyAfter.zone).toBe("field");
    const after = getEffectiveBp(
      result,
      enemyAfter,
      enemyDef,
      getCardDefinitionById
    );
    expect(after).toBe(20000);
  });

  it("実行: カウント0で破壊した場合も、on_step の対象選択後に最終盤面へ解決する", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-3",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyDef = cardNoMap.get("BSTH04-C01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "cirno-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const alternate = createCardInstance(enemyDef, {
      instanceId: "cirno-1-alternate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy, alternate],
    };
    const result = resolvePendingStepTargetSelection(
      runEffect(state, card.effects![0]!, "yuuka-3", "alice"),
      ["cirno-1"]
    );
    expect(
      result.cardInstances.find((entry) => entry.instanceId === "cirno-1")?.zone
    ).toBe("trash");
  });

  it("実行: カウント1では各反復の対象を別々に選び、2体を最終盤面で破壊する", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-4",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyDef = cardNoMap.get("BSTH04-C01")!;
    const first = createCardInstance(enemyDef, {
      instanceId: "cirno-batch-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const second = createCardInstance(enemyDef, {
      instanceId: "cirno-batch-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, first, second],
    };

    let result = runEffect(state, card.effects![0]!, "yuuka-4", "alice");
    result = resolvePendingStepTargetSelection(result, ["cirno-batch-1"]);
    result = resolvePendingStepTargetSelection(result, ["cirno-batch-2"]);

    expect(
      result.cardInstances
        .filter((entry) => entry.instanceId.startsWith("cirno-batch-"))
        .map((entry) => entry.zone)
    ).toEqual(["trash", "trash"]);
  });

  it("実行: C連鎖1以上は同じ on_step 破壊で対象自身の離脱時効果を発揮させない", () => {
    // 通常候補になる BSTH04-C01 の定義へ、離脱時ドローをテスト用に足す。
    // 本番と同じ target 選択・trigger lookup を通して、抑止なし count=0 と C連鎖1 count=1 を対照する。
    const candidateBaseDef = cardNoMap.get("BSTH04-C01")!;
    const destroyedTriggerDef: CardDefinition = {
      ...candidateBaseDef,
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "leave_field",
            cause: ["opponent_effect"],
          },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0],
        },
      ],
    };
    const definitions = allCardDefinitions.map((definition) =>
      definition.cardNo === candidateBaseDef.cardNo
        ? destroyedTriggerDef
        : definition
    );
    const localDefinitions = new Map(
      definitions.map((definition) => [definition.cardNo, definition])
    );
    const localGetCardDefinitionById = (id: string) => localDefinitions.get(id);
    const localTriggeredLookup = buildTriggeredEffectLookup(definitions);
    const localLookups = {
      getCardDefinitionById: localGetCardDefinitionById,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
    };
    const executeAttackEffect = (state: GameState, sourceInstanceId: string) =>
      executeEffect({
        chainId: "test:bsth04-cards:2575",
        state,
        effect: card.effects![0]!,
        sourceInstanceId,
        actingPlayerId: "alice",
        ...localLookups,
      });
    const noChainBase = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const noChainSource = createCardInstance(card, {
      instanceId: "yuuka-no-chain",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const noChainTarget = createCardInstance(destroyedTriggerDef, {
      instanceId: "destroy-trigger-no-chain",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    // mandatory target が1体だけなら自動解決されるため、実際の選択窓を経由する第2候補を置く。
    const noChainAlternate = createCardInstance(candidateBaseDef, {
      instanceId: "destroy-trigger-no-chain-alternate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const noChainState: GameState = {
      ...noChainBase,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [noChainSource, noChainTarget, noChainAlternate],
    };
    const noChain = resolvePendingStepTargetSelection(
      executeAttackEffect(noChainState, noChainSource.instanceId),
      [noChainTarget.instanceId],
      localLookups
    );
    // count=0 には C連鎖1 の destroyed_only がないため、実際の on_step 破壊後に
    // テスト用 C01 の leave_field 効果が engine の pending キューへ登録される。
    expect(
      noChain.pendingTriggeredEffects.some(
        (pending) => pending.relatedInstanceId === noChainTarget.instanceId
      )
    ).toBe(true);

    const chainBase = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    const chainSource = createCardInstance(card, {
      instanceId: "yuuka-chain-one",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const chainFirstTarget = createCardInstance(destroyedTriggerDef, {
      instanceId: "destroy-trigger-chain-one",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const chainSecondTarget = createCardInstance(destroyedTriggerDef, {
      instanceId: "destroy-trigger-chain-two",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const chainState: GameState = {
      ...chainBase,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [chainSource, chainFirstTarget, chainSecondTarget],
    };
    let chain = executeAttackEffect(chainState, chainSource.instanceId);
    chain = resolvePendingStepTargetSelection(
      chain,
      [chainFirstTarget.instanceId],
      localLookups
    );
    chain = resolvePendingStepTargetSelection(
      chain,
      [chainSecondTarget.instanceId],
      localLookups
    );
    expect(
      chain.cardInstances
        .filter((entry) =>
          entry.instanceId.startsWith("destroy-trigger-chain-")
        )
        .map((entry) => entry.zone)
    ).toEqual(["trash", "trash"]);
    // C連鎖1 の destroyed_only は、同じ effect 実行で破壊した両対象の leave_field
    // 効果を engine の pending キューへ登録しない。
    expect(
      chain.pendingTriggeredEffects.filter((pending) =>
        [chainFirstTarget.instanceId, chainSecondTarget.instanceId].includes(
          pending.relatedInstanceId ?? ""
        )
      )
    ).toEqual([]);
  });

  // 【C連鎖】2以上: 相手のライフのコア1個をトラッシュに置く。
  // life_damage (life→reserve) ではなく core_move from:life to:trash で表現。
  // 10_rules/06 L121-130: generic「ライフのコア1個をトラッシュに置く」は core_move 経路。
  it("effects[1]: C連鎖2以上のライフコアはリザーブでなくトラッシュに置かれる (stub 解消)", () => {
    const chainStep2 = card.effects![0]!;
    expect(chainStep2.stub).toBeUndefined();
    expect(chainStep2.steps[3]!.condition).toEqual([
      { kind: "count_value", player: "self", min: 2 },
    ]);
    const step = chainStep2.steps[3]!;
    expect(step.action.kind).toBe("core_move");
    if (step.action.kind === "core_move") {
      expect(step.action.from).toEqual({ kind: "life", player: "opponent" });
      expect(step.action.to).toEqual({ kind: "trash", player: "opponent" });
      expect(step.action.amount).toBe(1);
    }

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-chain2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const lifeBefore = getPlayerLifeCoreCount(bobBefore);
    const trashBefore = bobBefore.trashNormalCoreCount;
    const reserveBefore = bobBefore.reserveNormalCoreCount;

    const result = runEffect(state, chainStep2, "yuuka-chain2", "alice");

    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(getPlayerLifeCoreCount(bobAfter)).toBe(lifeBefore - 1);
    expect(bobAfter.trashNormalCoreCount).toBe(trashBefore + 1);
    // リザーブには増えない (life_damage 経路ではない事の証明)。
    expect(bobAfter.reserveNormalCoreCount).toBe(reserveBefore);
  });

  it("【C連鎖】3以上: restrict_use(self/opponent, excludeColors:yellow, duration:attack) / stub 解消", () => {
    const chainStep3 = card.effects![0]!;
    expect(chainStep3.stub).toBeUndefined();
    expect(chainStep3.steps[4]!.condition).toEqual([
      { kind: "count_value", player: "self", min: 3 },
    ]);
    expect(chainStep3.steps).toHaveLength(6);
    expect(chainStep3.steps[4]!.action).toEqual({
      kind: "restrict_use",
      player: "self",
      targetScope: "card",
      filter: { zone: ["hand", "set_aside"], excludeColors: ["yellow"] },
      duration: { scope: "attack" },
    });
    expect(chainStep3.steps[5]!.action).toEqual({
      kind: "restrict_use",
      player: "opponent",
      targetScope: "card",
      filter: { zone: ["hand", "set_aside"], excludeColors: ["yellow"] },
      duration: { scope: "attack" },
    });
  });

  it.each(["hand", "set_aside"] as const)(
    "BSTH04-X02: C連鎖3は両プレイヤーの%sの非黄カードを禁止し、黄カードを許可する",
    (zone) => {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 3 }, {}],
      });
      const self = createCardInstance(card, {
        instanceId: "yuuka-chain3",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [self],
      };

      const result = runEffect(
        state,
        card.effects![0]!,
        "yuuka-chain3",
        "alice"
      );

      const restrictCes = result.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "restrict_use"
      );
      expect(restrictCes).toHaveLength(2);

      // 現行画像と配布元の訂正 f493604 は「手札/手元」。両ゾーンを検証する。
      const greenDef: CardDefinition = {
        cardNo: "TEST-BSTH04-X02-GREEN",
        name: "テスト非黄マジック",
        printedCategory: "magic",
        colors: ["green"],
        cost: 2,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        tribe: "",
        sourceUrls: [],
        sourceConfidence: "C",
        effects: [],
      };
      const greenCard = createCardInstance(greenDef, {
        instanceId: "green-hand-1",
        ownerPlayerId: "bob",
        zone,
      });
      const greenState = {
        ...result,
        cardInstances: [...result.cardInstances, greenCard],
      };
      expect(
        isCardUseRestricted(greenState, "alice", greenCard, greenDef, (id) =>
          id === greenDef.cardNo ? greenDef : getCardDefinitionById(id)
        )
      ).toBe(true);
      expect(
        isCardUseRestricted(greenState, "bob", greenCard, greenDef, (id) =>
          id === greenDef.cardNo ? greenDef : getCardDefinitionById(id)
        )
      ).toBe(true);

      // 黄のカードは excludeColors:["yellow"] に一致しないため使用可能。
      const yellowDef: CardDefinition = {
        cardNo: "TEST-BSTH04-X02-YELLOW",
        name: "テスト黄マジック",
        printedCategory: "magic",
        colors: ["yellow"],
        cost: 2,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        tribe: "",
        sourceUrls: [],
        sourceConfidence: "C",
        effects: [],
      };
      const yellowCard = createCardInstance(yellowDef, {
        instanceId: "yellow-hand-1",
        ownerPlayerId: "bob",
        zone,
      });
      const yellowState = {
        ...result,
        cardInstances: [...result.cardInstances, yellowCard],
      };
      expect(
        isCardUseRestricted(
          yellowState,
          "alice",
          yellowCard,
          yellowDef,
          (id) =>
            id === yellowDef.cardNo ? yellowDef : getCardDefinitionById(id)
        )
      ).toBe(false);
      expect(
        isCardUseRestricted(yellowState, "bob", yellowCard, yellowDef, (id) =>
          id === yellowDef.cardNo ? yellowDef : getCardDefinitionById(id)
        )
      ).toBe(false);
    }
  );

  it("実行: カウント2以下 → restrict_use CE 未登録", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const self = createCardInstance(card, {
      instanceId: "yuuka-chain3-low",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };

    const result = runEffect(
      state,
      card.effects![0]!,
      "yuuka-chain3-low",
      "alice"
    );

    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(false);
  });

  it.each(["hand", "set_aside"] as const)(
    "BSTH04-X02: %s対象の禁止はプレイヤー耐性を通り、カード耐性とバトル終了を尊重する",
    (zone) => {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 3 }, {}],
      });
      const greenDef: CardDefinition = {
        cardNo: "TEST-YUUKA-GREEN-MAGIC",
        name: "非黄マジック",
        printedCategory: "magic",
        colors: ["green"],
        cost: 2,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        tribe: "",
        sourceUrls: [],
        sourceConfidence: "C",
        effects: [],
      };
      const yellowDef: CardDefinition = {
        ...greenDef,
        cardNo: "TEST-YUUKA-YELLOW-MAGIC",
        name: "黄マジック",
        colors: ["yellow"],
      };
      const localGetDef = (id: string) =>
        id === greenDef.cardNo
          ? greenDef
          : id === yellowDef.cardNo
            ? yellowDef
            : getCardDefinitionById(id);
      const source = createCardInstance(card, {
        instanceId: "yuuka-card-scope",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const hands = ["alice", "bob"].flatMap((playerId) =>
        [greenDef, yellowDef].map((definition) =>
          createCardInstance(definition, {
            instanceId: `${playerId}-${definition.cardNo}`,
            ownerPlayerId: playerId,
            controllerPlayerId: playerId,
            zone,
          })
        )
      );
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [source, ...hands],
        activeContinuousEffects: [
          {
            effectId: "bob-player-immunity",
            sourceInstanceId: "bob-protection",
            sourceDefinitionId: "TEST-PROTECTION",
            actingPlayerId: "bob",
            duration: { scope: "turn" },
            createdAtTurn: base.turnNumber,
            createdAtAttackId: null,
            modifierTag: "player_effect_immunity",
            targetInstanceId: "bob",
          },
        ],
      };
      const result = executeEffect({
        chainId: "test:yuuka-card-scope",
        state,
        effect: card.effects![0]!,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: localGetDef,
        getRegisteredTriggeredEffectActions,
      });
      const restricted = (
        current: GameState,
        playerId: string,
        definition: CardDefinition
      ) => {
        const candidate = current.cardInstances.find(
          (instance) =>
            instance.instanceId === `${playerId}-${definition.cardNo}`
        )!;
        return isCardUseRestricted(
          current,
          playerId,
          candidate,
          definition,
          localGetDef
        );
      };
      // bobのプレイヤー耐性で、手札/手元のカードに掛かる禁止を消してはならない。
      expect(restricted(result, "bob", greenDef)).toBe(true);
      expect(restricted(result, "alice", greenDef)).toBe(true);
      expect(restricted(result, "bob", yellowDef)).toBe(false);
      expect(restricted(result, "alice", yellowDef)).toBe(false);
      const restrictions = result.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "restrict_use"
      );
      expect(restrictions).toHaveLength(2);
      expect(
        restrictions.every((ce) => ce.metadata?.targetScope === "card")
      ).toBe(true);

      // 対象カード自身の耐性は、相手起因のカード対象禁止を阻止する。
      const withCardImmunity: GameState = {
        ...result,
        activeContinuousEffects: [
          ...result.activeContinuousEffects,
          {
            effectId: "bob-card-immunity",
            sourceInstanceId: `bob-${greenDef.cardNo}`,
            sourceDefinitionId: greenDef.cardNo,
            actingPlayerId: "bob",
            duration: { scope: "turn" },
            createdAtTurn: base.turnNumber,
            createdAtAttackId: null,
            modifierTag: "defense_immune",
            targetInstanceId: `bob-${greenDef.cardNo}`,
          },
        ],
      };
      expect(restricted(withCardImmunity, "bob", greenDef)).toBe(false);
      expect(restricted(withCardImmunity, "alice", greenDef)).toBe(true);

      const ended = finalizeBattleEndScopeExpirations(
        result,
        "yuuka-battle",
        localGetDef
      );
      expect(
        ended.activeContinuousEffects.some(
          (ce) => ce.modifierTag === "restrict_use"
        )
      ).toBe(false);
      expect(restricted(ended, "alice", greenDef)).toBe(false);
      expect(restricted(ended, "bob", greenDef)).toBe(false);
    }
  );
});

describe("BSTH04-C11 審判「ラストジャッジメント」", () => {
  const card = cardNoMap.get("BSTH04-C11")!;

  it("flash prevent_battle(全相手 spirit/ultimate attack 不可・ターン継続) + stack life_damage_interception(self, replace, battle)", () => {
    // [0]/[1] は P3-146後 needs-dsl (BSTH04-C11) で追加した while_in_trash effect_immunity +
    // 系統付与 override_properties。フラッシュ/スタックは effects[2]/[3] に繰り下がった。
    // [2] フラッシュ: 相手の spirit/ultimate すべて attack 不可（このターン）。
    const flash = card.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const prevent = flash.steps[0]!.action;
    expect(prevent.kind).toBe("prevent_battle");
    if (prevent.kind === "prevent_battle") {
      expect(prevent.restriction).toEqual(["attack"]);
      expect(prevent.duration?.scope).toBe("turn");
      expect(prevent.target.kind).toBe("filter");
      if (prevent.target.kind === "filter") {
        expect(prevent.target.player).toBe("opponent");
        expect(prevent.target.count).toBe("all");
        expect(prevent.target.filter.category).toEqual(["spirit", "ultimate"]);
      }
    }
    // [3] スタック: 次のバトル終了後まで、相手によって自分のライフは減らない。
    // life_damage_interception(cause:opponent, mode:replace, duration:battle) で表現
    // (prevent_life_damage は consumer 未配線 silent disabled, BSTH07-R10 等先例)。
    const stack = card.effects![3]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.stub).toBeUndefined();
    const stackAction = stack.steps[0]!.action;
    expect(stackAction.kind).toBe("life_damage_interception");
    if (stackAction.kind === "life_damage_interception") {
      expect(stackAction.player).toBe("self");
      expect(stackAction.cause).toBe("opponent");
      expect(stackAction.mode).toBe("replace");
      expect(stackAction.duration).toEqual({
        scope: "battle",
        nextBattleEnd: true,
      });
    }
  });

  it("[board] BSTH04-C11 stack: 解決で life_damage_interception(mode:replace, cause:opponent) CE が登録され、resolveLifeDamage(battle) が 0 にクランプされる", () => {
    const src = createCardInstance(card, {
      instanceId: "judge-resolve",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, card.effects![3]!, "judge-resolve", "alice");

    const registered = state.activeContinuousEffects.find(
      (ce) => ce.sourceInstanceId === "judge-resolve"
    );
    expect(registered).toBeDefined();
    expect(registered!.modifierTag).toBe("life_damage_interception");
    expect(registered!.duration).toEqual({
      scope: "battle",
      nextBattleEnd: true,
    });
    expect(registered!.targetInstanceId).toBe("alice");
    const meta = registered!.metadata as
      | { mode?: string; cause?: string; cap?: number }
      | undefined;
    expect(meta?.mode).toBe("replace");
    expect(meta?.cause).toBe("opponent");
    expect(meta?.cap).toBeUndefined();

    // バトル原因でのライフ減少が 0 にクランプされる (silent gap 検出)。
    const after = resolveLifeDamage(state, "alice", 2, [], {
      cause: "battle",
      actingPlayerId: "bob",
    });
    expect(
      getPlayerLifeCoreCount(after.players.find((p) => p.id === "alice")!)
    ).toBe(3);
  });
});

describe("BSTH04-M01 [花映塚]射命丸 文", () => {
  const card = cardNoMap.get("BSTH04-M01")!;

  it("treat_as(symbol=purple) + 後続効果群が定義されている（最低 1 つの continuous treat_as）", () => {
    // [0] continuous: シンボルを紫としても扱う (treat_as)
    const treat = card.effects![0]!;
    expect(treat.timing).toEqual({ kind: "continuous" });
    const act = treat.steps[0]!.action;
    expect(act.kind).toBe("treat_as");
    if (act.kind === "treat_as") {
      expect(act.asColor).toBe("purple");
      expect(act.aspects).toEqual(["symbol", "reduction_symbol"]);
      expect(act.appliesToCard).toBe(true);
    }
    // 効果群は 2 つ以上ある（[0] treat_as + 後続 effect_immunity/prevent_battle 等）
    expect((card.effects ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // Lv1-Lv2-Lv3『自分のアタックステップ』形式3 第三者 game_event:battle_end 観測
  // (BSTH04-M01 effects[2])。BSTH001-C04 同型 game_event + triggerFilter +
  // costBasis="printed" 不使用 (本来コストでなく現コスト)。no_duplicate legal-actions-apply
  // 経路は game-event-no-duplicate-multi-source.test.ts で検証済
  // (ENGINE-no-duplicate-game-event-pending-e2e-test)。
  it("effects[2]: game_event:battle_end + triggerFilter (起幻+楽族/冥主+黄/紫+コスト5+) + life_value max:5 + no_duplicate + core_move void→life (BSTH04-M01)", () => {
    const eff = card.effects![2]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing.kind).toBe("game_event");
    if (eff.timing.kind !== "game_event") return;
    expect(eff.timing.event).toBe("battle_end");
    expect(eff.timing.action).toBe("attack");
    expect(eff.timing.player).toBe("self");
    expect(eff.timing.triggerFilter).toMatchObject({
      category: ["spirit"],
      colors: ["yellow", "purple"],
      tribesRequired: ["起幻"],
      tribes: ["楽族", "冥主"],
      tribesLogic: "or",
      minCost: 5,
    });
    expect(eff.condition).toEqual([
      { kind: "life_value", player: "self", max: 5 },
    ]);
    expect(eff.executionMode).toBe("optional");
    expect(eff.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(eff.steps).toHaveLength(1);
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from).toEqual({ kind: "void", player: "self" });
      expect(action.to).toEqual({ kind: "life", player: "self" });
      expect(action.amount).toBe(1);
    }
  });
});

describe("BSTH04-XX01 [導界者]四季映姫・ヤマザナドゥ", () => {
  // cardNo 文字列を test 本文に保持して cards:test-coverage gate を通す: "BSTH04-XX01"
  const card = cardNoMap.get("BSTH04-XX01")!;

  it("【導域】Lv2 アタックステップ: continuous + attack timingScope で起幻コスト5以上の自分の黄/紫スピリットに symbols=[yellow,purple] + unblockable を付与", () => {
    expect(card).toBeDefined();
    // effects[1] = 導域 (continuous + timingScope attack + min_level 2)
    const dou_iki = card.effects![1]!;
    expect(dou_iki.timing).toEqual({ kind: "continuous" });
    expect(dou_iki.timingScope).toEqual({ player: "self", period: "attack" });
    expect(dou_iki.condition).toEqual([{ kind: "min_level", value: 2 }]);
    // stub が解消されている（override_properties.symbols + symbolCountFixed で「黄と紫シンボル1つずつになり」を表現）
    expect(dou_iki.stub).toBeUndefined();

    // steps[0] = unblockable (起幻 黄/紫 コスト5以上の自スピリットすべて, while_on_field)
    const unblock = dou_iki.steps[0]!.action;
    expect(unblock.kind).toBe("unblockable");
    if (unblock.kind === "unblockable") {
      expect(unblock.duration).toEqual({ scope: "while_on_field" });
      expect(unblock.target.kind).toBe("filter");
      if (unblock.target.kind === "filter") {
        expect(unblock.target.filter.tribes).toEqual(["起幻"]);
        expect(unblock.target.filter.colors).toEqual(["yellow", "purple"]);
        expect(unblock.target.filter.minCost).toBe(5);
        expect(unblock.target.filter.costBasis).toBe("printed");
        expect(unblock.target.count).toBe("all");
      }
    }

    // steps[1] = override_properties.symbols = ["yellow","purple"] + symbolCountFixed (同 filter, simultaneous)
    const overrideStep = dou_iki.steps[1]!;
    expect(overrideStep.connector).toBe("simultaneous");
    const op = overrideStep.action;
    expect(op.kind).toBe("override_properties");
    if (op.kind === "override_properties") {
      expect(op.properties.symbols).toEqual(["yellow", "purple"]);
      expect(op.properties.symbolCountFixed).toBe(true);
      expect(op.duration).toEqual({ scope: "while_on_field" });
      expect(op.target.kind).toBe("filter");
      if (op.target.kind === "filter") {
        expect(op.target.filter.tribes).toEqual(["起幻"]);
        expect(op.target.filter.colors).toEqual(["yellow", "purple"]);
        expect(op.target.filter.minCost).toBe(5);
        expect(op.target.filter.costBasis).toBe("printed");
        expect(op.target.count).toBe("all");
      }
    }
  });

  it("【導域】実行: 起幻 コスト5以上 黄/紫 の自スピリットへ symbols 上書きが恒常 CE として登録される", () => {
    // 黄/紫の合成スピリット (コスト5以上, 起幻) を作って override_properties が
    // getEffectiveSymbols を介して "yellow"/"purple" 2 個に変えることを確認する。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const xx01 = createCardInstance(card, {
      instanceId: "xx-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4, // Lv2
    });
    // BSTH04-X01 (コスト6以上, 起幻, 黄/紫想定) を採用; 起幻スピリットを動的検索する。
    const targetCardDef = ALL_CARDS.find(
      (c) =>
        c.cardNo.startsWith("BSTH04-") &&
        c.printedCategory === "spirit" &&
        (c.tribe ?? "").includes("起幻") &&
        c.cost >= 5 &&
        c.colors.some((col) => col === "yellow" || col === "purple")
    );
    expect(targetCardDef).toBeDefined();
    const target = createCardInstance(targetCardDef!, {
      instanceId: "tgt-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const lowCostDef = cardNoMap.get("BSTH04-C01")!;
    const lowCostTarget = createCardInstance(lowCostDef, {
      instanceId: "low-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [xx01, target, lowCostTarget],
    };

    const result = runEffect(state, card.effects![1]!, "xx-1", "alice");
    // 継続効果が activeContinuousEffects に登録されたかを確認
    const ces = result.activeContinuousEffects ?? [];
    expect(ces.some((ce) => ce.targetInstanceId === "low-1")).toBe(false);
    // override_properties.symbols は CE tag "override_properties" として登録される
    const symbolCe = ces.find(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        (ce.targetInstanceId === "tgt-1" ||
          (ce.targetFilter && ce.targetFilter.player === "self"))
    );
    expect(symbolCe).toBeTruthy();
    expect(symbolCe?.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    // unblockable CE も登録される
    const unblockCe = ces.find(
      (ce) =>
        ce.modifierTag === "unblockable" &&
        (ce.targetInstanceId === "tgt-1" ||
          (ce.targetFilter && ce.targetFilter.player === "self"))
    );
    expect(unblockCe).toBeTruthy();
    expect(unblockCe?.timingScope).toEqual({
      player: "self",
      period: "attack",
    });

    const blockerDef = cardNoMap.get("BSTH04-C01")!;
    const blocker = createCardInstance(blockerDef, {
      instanceId: "bob-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const blockState: GameState = {
      ...result,
      cardInstances: [...result.cardInstances, blocker],
      window: "declare_block",
      activeAttack: {
        attackId: "attack-bsth04-symbol-fixed",
        primaryEntityId: "be-bsth04-target",
        participantEntityIds: ["be-bsth04-target"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "be-bsth04-target",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-bsth04-target"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-bsth04-target",
          memberInstanceIds: ["tgt-1"],
          resolvedBp: 7000,
          resolvedSymbols: ["yellow", "purple"],
          attackState: "attacking",
        },
      ],
    };
    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: "bob",
        sourceInstanceId: "bob-blocker",
        participantEntityId: "be-bsth04-target",
        getCardDefinitionById,
      })
    ).toBe("attacker_unblockable");

    // 「本来のコストが5以上」は印字コストを指す。印字コスト3のチルノを
    // override_properties で実効コスト5へ上げても、導域の対象にはならない。
    const printedCostThreeDef: CardDefinition = {
      cardNo: "TEST-BSTH04-PRINTED-COST-THREE",
      name: "印字コスト3の起幻スピリット",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: ["purple"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const getCounterexampleCardDefinitionById = (id: string) =>
      id === printedCostThreeDef.cardNo
        ? printedCostThreeDef
        : getCardDefinitionById(id);
    const effectiveCostOnly = createCardInstance(printedCostThreeDef, {
      instanceId: "effective-cost-only",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const printedCostState: GameState = {
      ...result,
      cardInstances: [...result.cardInstances, effectiveCostOnly, blocker],
      activeContinuousEffects: [
        ...(result.activeContinuousEffects ?? []),
        {
          effectId: "raise-effective-cost-only",
          sourceInstanceId: "xx-1",
          sourceDefinitionId: card.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: result.turnNumber,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: effectiveCostOnly.instanceId,
          metadata: { properties: { cost: 5 } },
        } satisfies ContinuousEffect,
      ],
      window: "declare_block",
      activeAttack: {
        attackId: "attack-bsth04-printed-cost-only",
        primaryEntityId: "be-bsth04-effective-cost-only",
        participantEntityIds: ["be-bsth04-effective-cost-only"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "be-bsth04-effective-cost-only",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["be-bsth04-effective-cost-only"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "be-bsth04-effective-cost-only",
          memberInstanceIds: [effectiveCostOnly.instanceId],
          resolvedBp: 2000,
          resolvedSymbols: ["purple", "yellow"],
          attackState: "attacking",
        },
      ],
    };
    expect(
      getBlockDeclarationBlockReason({
        state: printedCostState,
        actingPlayerId: "bob",
        sourceInstanceId: "bob-blocker",
        participantEntityId: "be-bsth04-effective-cost-only",
        getCardDefinitionById: getCounterexampleCardDefinitionById,
      })
    ).toBeNull();
    // 同じ printed filter を持つ symbol override も、実効コストだけ5の
    // 反例へは適用されない。元の紫1個が「黄/紫各1個」へ上書きされない。
    expect(
      getEffectiveSymbols(
        printedCostState,
        effectiveCostOnly,
        printedCostThreeDef,
        getCounterexampleCardDefinitionById
      )
    ).toEqual(["purple"]);
  });

  it("【導域】実行: 後から場に出た適格スピリットにも symbols 固定 global CE が適用され、追加/合体分を抑止する", () => {
    const xx01 = createCardInstance(card, {
      instanceId: "xx-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [xx01],
      }),
      activePlayerId: "alice",
      step: "attack",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      base,
      getCardDefinitionById
    );
    const symbolCe = rebuilt.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        ce.targetFilter !== undefined &&
        Array.isArray(ce.metadata?.properties?.symbols)
    );
    expect(symbolCe).toBeTruthy();

    const komachiDef = cardNoMap.get("BSTH04-X03")!;
    expect(komachiDef.symbolColors).toEqual(["purple"]);
    const komachi = createCardInstance(komachiDef, {
      instanceId: "komachi-late",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["komachi-brave"],
    });
    const braveDef = cardNoMap.get("BSGE01-C05")!;
    const brave = createCardInstance(braveDef, {
      instanceId: "komachi-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "komachi-late",
    });
    const withLateTarget: GameState = {
      ...rebuilt,
      cardInstances: [...rebuilt.cardInstances, komachi, brave],
      activeContinuousEffects: [
        ...rebuilt.activeContinuousEffects,
        symbolAdditionCE("komachi-late", "green"),
      ],
    };

    expect(
      getEffectiveSymbols(
        withLateTarget,
        komachi,
        komachiDef,
        getCardDefinitionById
      )
    ).toEqual(["yellow", "purple"]);
    expect(
      getCombinedUnitSymbols(
        withLateTarget,
        komachi,
        komachiDef,
        getCardDefinitionById
      )
    ).toEqual(["yellow", "purple"]);
  });

  // 実バグ回帰 (2026-07-05 snapshot): 配置時導託でデッキ上3枚をトラッシュした際、
  // マジックカード(BSTH04-C11, 幻想/起幻・コスト4)が対象カードとして誤カウントされ
  // コア+3になっていた（正しくはスピリット(BSTH04-X03)1枚のみ対象でコア+1）。
  // 原因: oracleConditions[0] が categories 未指定で printedCategory を区別しなかった。
  it("配置時導託: デッキ上3枚がマジック2枚+スピリット1枚 → マジックは対象外でコア+1のみ", () => {
    const xx01Def = card;
    const magicDef = cardNoMap.get("BSTH04-C11")!; // magic, 起幻・幻想, cost4
    const spiritDef = cardNoMap.get("BSTH04-X03")!; // spirit, 起幻・幻想・冥主, cost5
    expect(magicDef.printedCategory).toBe("magic");
    expect(spiritDef.printedCategory).toBe("spirit");

    const nexus = createCardInstance(xx01Def, {
      instanceId: "xx01-1",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const deckCards = [
      createCardInstance(magicDef, {
        instanceId: "deck-1",
        ownerPlayerId: "bob",
        zone: "deck",
      }),
      createCardInstance(magicDef, {
        instanceId: "deck-2",
        ownerPlayerId: "bob",
        zone: "deck",
      }),
      createCardInstance(spiritDef, {
        instanceId: "deck-3",
        ownerPlayerId: "bob",
        zone: "deck",
      }),
    ];
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 10,
      cardInstances: [nexus, ...deckCards],
    });

    const result = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "xx01-1" },
      getCardDefinitionById
    );

    const byId = (id: string) =>
      result.cardInstances.find((c) => c.instanceId === id)!;
    expect(byId("deck-1").zone).toBe("trash");
    expect(byId("deck-2").zone).toBe("trash");
    expect(byId("deck-3").zone).toBe("trash");
    // マジック2枚は対象外、スピリット1枚のみ対象 → コア+1（修正前はコア+3のバグ）
    expect(byId("xx01-1").normalCoreCount).toBe(1);
  });
});

// ENGINE-search-zone-mandatory-migration (2026-06-21):
// 召喚時効果 step1 「カード1枚を手札に加える」=終止形=強制。親 effect が
// optional (前段 deck_reveal が可能形「破棄できる」) であっても、いったん
// effect を発揮した後の search_zone は canSkip:false で空選択を拒否する。
describe("BSTH04-C03 [花映塚]因幡 てゐ — search_zone(mandatory) 配線", () => {
  const card = cardNoMap.get("BSTH04-C03")!;

  it("自分の導シンボルがないときだけ self に guide symbol_add を登録する", () => {
    const guide = card.effects![2]!;
    expect(guide.stub).toBeUndefined();
    expect(guide.condition).toEqual([
      {
        kind: "field_lacks",
        player: "self",
        symbolColors: ["guide"],
      },
    ]);
    const action = guide.steps[0]!.action;
    expect(action.kind).toBe("symbol_add");
    if (action.kind === "symbol_add") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.symbol).toBe("guide");
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("[board] 自分の導シンボルがない盤面では、このスピリットが導シンボルを得る", () => {
    const self = createCardInstance(card, {
      instanceId: "tei-no-guide",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        activePlayerId: "alice",
        step: "main",
      },
      getCardDefinitionById
    );
    const selfAfter = state.cardInstances.find(
      (c) => c.instanceId === "tei-no-guide"
    )!;

    expect(
      getEffectiveSymbols(state, selfAfter, card, getCardDefinitionById)
    ).toContain("guide");
  });

  it("[board] 自己付与した guide CE は再評価で自壊しない", () => {
    const self = createCardInstance(card, {
      instanceId: "tei-self-guide",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const registered = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        activePlayerId: "alice",
        step: "main",
      },
      getCardDefinitionById
    );

    const registeredSelfGuideCe = registered.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === "tei-self-guide" &&
        ce.modifierTag === "symbol_addition" &&
        ce.modifierSymbol?.includes("guide")
    );
    expect(registeredSelfGuideCe).toBeDefined();

    let recomputed = registered;
    for (let i = 0; i < 3; i++) {
      recomputed = recomputeAndRebuildContinuousEffects(
        recomputed,
        getCardDefinitionById
      );
    }
    const selfGuideCes = recomputed.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "tei-self-guide" &&
        ce.modifierTag === "symbol_addition" &&
        ce.modifierSymbol?.includes("guide")
    );
    const selfAfter = recomputed.cardInstances.find(
      (c) => c.instanceId === "tei-self-guide"
    )!;

    expect(selfGuideCes).toHaveLength(1);
    expect(selfGuideCes[0]!.effectId).toBe(registeredSelfGuideCe!.effectId);
    expect(
      getEffectiveSymbols(recomputed, selfAfter, card, getCardDefinitionById)
    ).toContain("guide");
  });

  it("[board] 自分の導シンボルが既にある盤面では、追加の guide CE を登録しない", () => {
    const guideDef: CardDefinition = {
      cardNo: "TEST-GUIDE-NEXUS-BSTH04-C03",
      name: "テスト導シンボルネクサス",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["guide"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    cardNoMap.set(guideDef.cardNo, guideDef);
    const guideNexus = createCardInstance(guideDef, {
      instanceId: "existing-guide",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const self = createCardInstance(card, {
      instanceId: "tei-with-guide",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [guideNexus, self],
        }),
        activePlayerId: "alice",
        step: "main",
      },
      getCardDefinitionById
    );
    const selfGuideCe = state.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === "tei-with-guide" &&
        ce.modifierTag === "symbol_addition" &&
        ce.modifierSymbol?.includes("guide")
    );
    const selfAfter = state.cardInstances.find(
      (c) => c.instanceId === "tei-with-guide"
    )!;

    expect(selfGuideCe).toBeUndefined();
    expect(
      getEffectiveSymbols(state, selfAfter, card, getCardDefinitionById)
    ).not.toContain("guide");
  });

  it("[board] このスピリット自身に別由来の導シンボルがある盤面では、追加の guide CE を登録しない", () => {
    const self = createCardInstance(card, {
      instanceId: "tei-external-guide",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        activePlayerId: "alice",
        step: "main",
        activeContinuousEffects: [symbolAdditionCE(self.instanceId, "guide")],
      },
      getCardDefinitionById
    );
    const selfGuideCes = state.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === self.instanceId &&
        ce.modifierTag === "symbol_addition" &&
        ce.modifierSymbol?.includes("guide")
    );
    const selfAfter = state.cardInstances.find(
      (c) => c.instanceId === self.instanceId
    )!;

    expect(selfGuideCes).toHaveLength(0);
    expect(
      getEffectiveSymbols(state, selfAfter, card, getCardDefinitionById)
    ).toContain("guide");
  });

  it("召喚時 step1 search_zone は mandatory:true でフラグ伝搬される", () => {
    const summon = card.effects![1]!;
    expect(summon.executionMode).toBe("mandatory");
    expect(summon.steps[0]!.executionMode).toBe("optional");
    const search = summon.steps[1]!.action;
    expect(search.kind).toBe("search_zone");
    if (search.kind === "search_zone") {
      expect(search.mandatory).toBe(true);
    }
  });

  it("候補2枚 → pendingZoneSelection.canSkip=false / 空選択は throw / 1枚選択で hand へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    // トラッシュに回収候補（起幻 黄/紫）。BSTH04-C03 自身が紫 + 起幻 で適合。
    const target1 = createCardInstance(card, {
      instanceId: "lily-trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const target2 = createCardInstance(card, {
      instanceId: "lily-trash-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    // デッキ上 2 枚（前段 move_card で破棄される）。
    // search_zone のフィルタ (colors:yellow|purple AND tribes:起幻) に
    // 該当しないカード (BSKB01-C01 = 紫 鋼騎士) を使い、トラッシュへ
    // 落ちた後も search_zone 候補に含まれないようにする。
    const deckDef = cardNoMap.get("BSKB01-C01")!;
    const deck1 = createCardInstance(deckDef, {
      instanceId: "lily-deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deck2 = createCardInstance(deckDef, {
      instanceId: "lily-deck-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, target1, target2, deck1, deck2],
    };
    let after = executeEffect({
      chainId: "test:bsth04-cards:3679",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "lily-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const executeMill = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    after = applyLegalAction({
      state: after,
      action: executeMill,
      getCardDefinitionById,
    }).state;
    expect(after.pendingZoneSelection).not.toBeNull();
    expect(after.pendingZoneSelection!.actionKind).toBe("return_from_trash");
    expect(after.pendingZoneSelection!.actingPlayerId).toBe("alice");
    expect(after.pendingZoneSelection!.destination).toBe("hand");
    expect(after.pendingZoneSelection!.maxCount).toBe(1);
    expect(after.pendingZoneSelection!.candidateCardInstanceIds.sort()).toEqual(
      ["lily-trash-1", "lily-trash-2"].sort()
    );
    // 終止形「加える」= 強制。空選択は拒否される。
    expect(after.pendingZoneSelection!.canSkip).toBe(false);

    expect(() =>
      applyLegalAction({
        state: after,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: [],
        getCardDefinitionById,
      })
    ).toThrow(/cannot be skipped/);

    const resolved = applyLegalAction({
      state: after,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["lily-trash-1"],
      getCardDefinitionById,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "lily-trash-1")?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "lily-trash-2")?.zone
    ).toBe("trash");
  });
});

describe("BSTH04-R01 [花映塚]十六夜 咲夜", () => {
  const card = cardNoMap.get("BSTH04-R01")!;

  it("trash immunity + burst(life_decrease) + Lv1-3 effect_immunity", () => {
    const trashImmunity = card.effects!.find((e) => e.textRef?.[0] === 0)!;
    expect(trashImmunity.timing.kind).toBe("continuous");
    expect(trashImmunity.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      duration: { scope: "while_in_trash" },
      sourcePlayerScope: "any",
    });

    const burst = card.effects!.find(
      (e) => e.timing.kind === "burst" && e.textRef?.[0] === 2
    )!;
    expect(burst.timing.kind).toBe("burst");
    if (burst.timing.kind === "burst") {
      expect(burst.timing.trigger.kind).toBe("life_decrease");
    }
    expect(card.keywordTags).toContain("burst");
    expect(burst.steps[0]!.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });

    const fieldImmunity = card.effects!.find((e) => e.textRef?.[0] === 5)!;
    expect(fieldImmunity.applicability).toEqual({
      level: { min: 1, max: 3 },
    });
    expect(fieldImmunity.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      duration: { scope: "while_on_field" },
      sourceScope: { categories: ["spirit", "nexus"] },
    });
  });
});
