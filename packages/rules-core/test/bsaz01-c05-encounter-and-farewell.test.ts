import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { queueBattleDeclarationTriggers } from "../src/effect/trigger-system";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import { flushPendingLeaves } from "../src/state-based-actions";
import type { CardDefinition, GameState, LegalAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const C05 = cardNoMap.get("BSAZ01-C05")!;

const testAttackerDef: CardDefinition = {
  cardNo: "TEST-BSAZ01-C05-ATTACKER",
  name: "C05 Test Attacker",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const testBlockerDef: CardDefinition = {
  cardNo: "TEST-BSAZ01-C05-BLOCKER",
  name: "C05 Test Blocker",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const e2eDefinitions = [C05, testAttackerDef, testBlockerDef];
const e2eDefinitionMap = new Map(
  e2eDefinitions.map((def) => [def.cardNo, def])
);
const e2eLookups = {
  getCardDefinitionById: (id: string) => e2eDefinitionMap.get(id),
  getRegisteredTriggeredEffectActions:
    buildTriggeredEffectLookup(e2eDefinitions),
  getRegisteredMagicActions: buildMagicLookup(e2eDefinitions),
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredBattleImmediateEffectActions: () => undefined,
  getRegisteredBurstActions: () => undefined,
};

function card(no: string): CardDefinition {
  const def = cardNoMap.get(no);
  if (!def) throw new Error(`card not found: ${no}`);
  return def;
}

function handCard(ownerPlayerId: string, instanceId: string) {
  return createCardInstance(card("BSDB01-C05"), {
    instanceId,
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    zone: "hand",
  });
}

function battleState(): GameState {
  const source = createCardInstance(C05, {
    instanceId: "bsaz01-c05-source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "in_use",
  });
  const attacker = createCardInstance(card("BSAZ01-C01"), {
    instanceId: "bsaz01-c05-attacker",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
  });
  const blocker = createCardInstance(card("BSDB01-C05"), {
    instanceId: "bsaz01-c05-blocker",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
  });

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        source,
        attacker,
        blocker,
        handCard(ALICE, "alice-hand-1"),
        handCard(ALICE, "alice-hand-2"),
        handCard(BOB, "bob-hand-1"),
        handCard(BOB, "bob-hand-2"),
      ],
      playerOverrides: [{ handCount: 2 }, { handCount: 2 }],
    }),
    activePlayerId: ALICE,
    step: "attack",
    window: "flash_after_block",
    activeAttack: {
      attackId: "bsaz01-c05-attack",
      attackerInstanceId: "bsaz01-c05-attacker",
      blockerInstanceId: "bsaz01-c05-blocker",
      windowState: "flash_after_block",
      primaryEntityId: "be-bsaz01-c05-attacker",
      participantEntityIds: ["be-bsaz01-c05-attacker"],
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "be-bsaz01-c05-attacker",
          blockedByEntityIds: ["be-bsaz01-c05-blocker"],
        },
      ],
      symbolResolutionOrder: ["be-bsaz01-c05-attacker"],
    },
    battleEntities: [
      {
        entityId: "be-bsaz01-c05-attacker",
        controllerPlayerId: ALICE,
        memberInstanceIds: ["bsaz01-c05-attacker"],
        attackState: "attacking",
        resolvedBp: card("BSAZ01-C01").levelDefs[0]!.bp,
        resolvedSymbols: [...card("BSAZ01-C01").symbolColors],
      },
      {
        entityId: "be-bsaz01-c05-blocker",
        controllerPlayerId: BOB,
        memberInstanceIds: ["bsaz01-c05-blocker"],
        attackState: "blocking",
        resolvedBp: card("BSDB01-C05").levelDefs[0]!.bp,
        resolvedSymbols: [...card("BSDB01-C05").symbolColors],
      },
    ],
  };
}

function createFreeUseE2eState(
  options: {
    attackerPlayerId?: string;
    blockerPlayerId?: string;
  } = {}
): GameState {
  const attackerPlayerId = options.attackerPlayerId ?? ALICE;
  const blockerPlayerId = options.blockerPlayerId ?? BOB;
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(C05, {
          instanceId: "c05-hand-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(C05, {
          instanceId: "c05-hand-2",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(testAttackerDef, {
          instanceId: "attacker-1",
          ownerPlayerId: attackerPlayerId,
          controllerPlayerId: attackerPlayerId,
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "recovered",
        }),
        createCardInstance(testBlockerDef, {
          instanceId: "blocker-1",
          ownerPlayerId: blockerPlayerId,
          controllerPlayerId: blockerPlayerId,
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "recovered",
        }),
        createCardInstance(testAttackerDef, {
          instanceId: "alice-filler-hand",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(testBlockerDef, {
          instanceId: "bob-filler-hand",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "hand",
        }),
      ],
      playerOverrides: [
        { handCount: 3, reserveNormalCoreCount: 0 },
        { handCount: 1, reserveNormalCoreCount: 0 },
      ],
    }),
    activePlayerId: attackerPlayerId,
    step: "attack",
    turnNumber: 2,
  };
}

function getActions(state: GameState, actingPlayerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    ...e2eLookups,
  });
}

function applyAction(state: GameState, action: LegalAction): GameState {
  return applyLegalAction({
    state,
    action,
    ...e2eLookups,
  }).state;
}

function expectAction<K extends LegalAction["kind"]>(
  state: GameState,
  actingPlayerId: string,
  kind: K,
  predicate?: (action: Extract<LegalAction, { kind: K }>) => boolean
): Extract<LegalAction, { kind: K }> {
  const action = getActions(state, actingPlayerId).find(
    (candidate): candidate is Extract<LegalAction, { kind: K }> =>
      candidate.kind === kind &&
      (predicate?.(candidate as Extract<LegalAction, { kind: K }>) ?? true)
  );
  expect(action).toBeDefined();
  return action!;
}

function passPreDeclarationStack(state: GameState): GameState {
  const priorityPlayerId = state.preDeclarationStackWindow?.priorityPlayerId;
  expect(priorityPlayerId).toBeDefined();
  return applyAction(
    state,
    expectAction(state, priorityPlayerId!, "pass_pre_declaration_stack")
  );
}

function closeBattleFlashWindow(state: GameState): GameState {
  const openAction = getActions(state, state.activePlayerId).find(
    (action) => action.kind === "open_battle_flash"
  );
  if (!openAction) return state;

  let current = applyAction(state, openAction);
  for (let i = 0; i < 2; i++) {
    const priorityPlayerId =
      current.activeAttack?.flashWindowState?.priorityPlayerId;
    if (!priorityPlayerId) return current;
    const passAction = getActions(current, priorityPlayerId).find(
      (action) => action.kind === "pass_battle_flash"
    );
    if (!passAction) return current;
    current = applyAction(current, passAction);
  }
  return current;
}

function declareAttackAndBlock(
  options: {
    attackerPlayerId?: string;
    blockerPlayerId?: string;
  } = {}
): GameState {
  const attackerPlayerId = options.attackerPlayerId ?? ALICE;
  const blockerPlayerId = options.blockerPlayerId ?? BOB;
  let state = createFreeUseE2eState({ attackerPlayerId, blockerPlayerId });
  state = applyAction(
    state,
    expectAction(
      state,
      attackerPlayerId,
      "attack",
      (action) => action.sourceInstanceId === "attacker-1"
    )
  );
  state = passPreDeclarationStack(state);
  state = closeBattleFlashWindow(state);

  const participantEntityId = state.activeAttack!.participantEntityIds[0]!;
  state = applyAction(
    state,
    expectAction(
      state,
      blockerPlayerId,
      "block",
      (action) =>
        action.sourceInstanceId === "blocker-1" &&
        action.participantEntityId === participantEntityId
    )
  );
  return passPreDeclarationStack(state);
}

function passOpenStackWindow(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 4 && current.stackWindow !== null; i++) {
    const priorityPlayerId = current.stackWindow.priorityPlayerId;
    current = applyAction(
      current,
      expectAction(current, priorityPlayerId, "pass_stack")
    );
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

describe("BSAZ01-C05 邂逅と決別", () => {
  it("手札からのコスト不要使用はブロックした/されたの2経路で同名ターン1回を共有する", () => {
    const freeUseEffects = C05.effects!.filter(
      (effect) =>
        effect.timing.kind === "game_event" &&
        effect.timing.event === "block" &&
        effect.applicability?.zone === "hand"
    );
    expect(freeUseEffects).toHaveLength(2);
    expect(freeUseEffects.map((effect) => effect.timing.player).sort()).toEqual(
      ["opponent", "self"]
    );
    expect(freeUseEffects.map((effect) => effect.limitGroupId)).toEqual([
      "BSAZ01-C05-free-use",
      "BSAZ01-C05-free-use",
    ]);
    expect(
      freeUseEffects.every(
        (effect) => effect.steps[0]?.action.kind === "use_magic_without_cost"
      )
    ).toBe(true);
    expect(C05.effects!.some((effect) => effect.stub !== undefined)).toBe(
      false
    );

    const [blockerPath, blockedPath] = freeUseEffects;
    const usageLimit = blockerPath!.usageLimit!;
    const used = recordEffectUsageIfLimited({
      state: createEmptyGameState({ playerIds: [ALICE, BOB] }),
      sourceInstanceId: "bsaz01-c05-hand",
      sourceDefinitionId: "BSAZ01-C05",
      effectLabel: "effect:0",
      usageLimit,
      groupId: blockerPath!.limitGroupId,
    });
    expect(
      canUseEffectByUsageLimit({
        state: used,
        sourceInstanceId: "bsaz01-c05-hand",
        sourceDefinitionId: "BSAZ01-C05",
        effectLabel: "effect:1",
        usageLimit: blockedPath!.usageLimit!,
        groupId: blockedPath!.limitGroupId,
      })
    ).toBe(false);
  });

  it("BSAZ01-C05 flash本体はバトル中の自他横断2体破壊を1 stepで表す", () => {
    const flashEffect = C05.effects!.find(
      (effect) =>
        effect.timing.kind === "activated" && effect.timing.mode === "flash"
    )!;
    const destroyStep = flashEffect.steps[0]!;
    expect(destroyStep.id).toBe("destroy-battlers");
    expect(destroyStep.action.kind).toBe("destroy");
    if (destroyStep.action.kind !== "destroy") return;
    expect(destroyStep.action.target).toMatchObject({
      kind: "filter",
      player: "either",
      count: 2,
      filter: {
        category: ["spirit", "ultimate"],
        battleState: "in_battle",
      },
    });
    for (const discardStep of flashEffect.steps.slice(1)) {
      expect(discardStep.stepCondition).toMatchObject({
        kind: "ref_count",
        stepId: "destroy-battlers",
        min: 2,
      });
    }
  });

  it("BSAZ01-C05 flash本体はバトル中2体を破壊し、そうしたとき双方の手札を内容を見ないで1枚ずつ破棄する", () => {
    const flashEffect = C05.effects!.find(
      (effect) =>
        effect.timing.kind === "activated" && effect.timing.mode === "flash"
    )!;
    const resolved = executeEffect({
      chainId: "test:bsaz01-c05-encounter-and-farewell:416",
      state: battleState(),
      effect: flashEffect,
      sourceInstanceId: "bsaz01-c05-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const final = flushPendingLeaves(resolved, getCardDefinitionById);

    expect(
      final.cardInstances.find((c) => c.instanceId === "bsaz01-c05-attacker")
        ?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "bsaz01-c05-blocker")
        ?.zone
    ).toBe("trash");
    expect(final.players.find((player) => player.id === ALICE)?.handCount).toBe(
      1
    );
    expect(final.players.find((player) => player.id === BOB)?.handCount).toBe(
      1
    );
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === ALICE && card.zone === "hand"
      )
    ).toHaveLength(1);
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === BOB && card.zone === "hand"
      )
    ).toHaveLength(1);
  });

  it("ブロック宣言から手札誘発を宣言し、resolve_pending_triggered_effect 経由でコスト不要使用する", () => {
    let state = declareAttackAndBlock();
    expect(state.pendingPrivateDeclarations).toHaveLength(1);
    expect(state.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: ALICE,
      sourceInstanceId: "c05-hand-1",
      sourceDefinitionId: "BSAZ01-C05",
      eventKind: "block",
      relatedPlayerId: BOB,
      relatedInstanceId: "blocker-1",
      registrationIndex: 1,
    });

    const declareAction = expectAction(
      state,
      ALICE,
      "declare_private_triggered_effect",
      (action) => action.sourceInstanceId === "c05-hand-1"
    );
    state = applyAction(state, declareAction);
    expect(state.pendingTriggeredEffects).toHaveLength(1);
    expect(
      state.effectUsageRecords.some(
        (record) =>
          record.sourceDefinitionId === "BSAZ01-C05" &&
          record.effectLabel === "effect:1" &&
          record.groupId === "BSAZ01-C05-free-use"
      )
    ).toBe(true);

    const sameTurnSecondBlock = queueBattleDeclarationTriggers({
      chainId: "test:bsaz01-c05-encounter-and-farewell:481",
      state,
      kind: "block",
      declaringInstanceId: "blocker-1",
      declaringPlayerId: BOB,
      getCardDefinitionById: e2eLookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        e2eLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: e2eLookups.getRegisteredBurstActions,
    });
    expect(sameTurnSecondBlock.pendingPrivateDeclarations).toHaveLength(0);
    expect(
      getActions(sameTurnSecondBlock, ALICE).some(
        (action) =>
          action.kind === "declare_private_triggered_effect" &&
          action.sourceInstanceId === "c05-hand-2"
      )
    ).toBe(false);

    state = applyAction(
      state,
      expectAction(
        state,
        ALICE,
        "resolve_pending_triggered_effect",
        (action) => action.sourceInstanceId === "c05-hand-1"
      )
    );
    expect(state.window).toBe("stack");

    state = passOpenStackWindow(state);
    expect(state.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: ALICE,
      sourceInstanceId: "c05-hand-1",
      sourceDefinitionId: "BSAZ01-C05",
      requiredTargetCount: 2,
    });
    expect(
      new Set(state.pendingEffectTargetSelection!.candidateInstanceIds)
    ).toEqual(new Set(["attacker-1", "blocker-1"]));

    state = applyLegalAction({
      state,
      action: expectAction(state, ALICE, "resolve_pending_effect_target"),
      targetInstanceIds: ["attacker-1", "blocker-1"],
      ...e2eLookups,
    }).state;
    const final = flushPendingLeaves(state, e2eLookups.getCardDefinitionById);

    expect(
      final.log.some((entry) => entry.includes("magic:without-cost:"))
    ).toBe(true);
    expect(final.log.some((entry) => entry.includes("magic:reduction:"))).toBe(
      false
    );
    expect(
      final.cardInstances.find((card) => card.instanceId === "c05-hand-1")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((card) => card.instanceId === "attacker-1")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((card) => card.instanceId === "blocker-1")?.zone
    ).toBe("trash");
    expect(final.players.find((player) => player.id === ALICE)?.handCount).toBe(
      1
    );
    expect(final.players.find((player) => player.id === BOB)?.handCount).toBe(
      0
    );
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === ALICE && card.zone === "hand"
      )
    ).toHaveLength(1);
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === BOB && card.zone === "hand"
      )
    ).toHaveLength(0);
  });

  it("自分のスピリット/アルティメットがブロックした経路でも手札からコスト不要使用できる", () => {
    let state = declareAttackAndBlock({
      attackerPlayerId: BOB,
      blockerPlayerId: ALICE,
    });
    expect(state.pendingPrivateDeclarations).toHaveLength(1);
    expect(state.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: ALICE,
      sourceInstanceId: "c05-hand-1",
      sourceDefinitionId: "BSAZ01-C05",
      eventKind: "block",
      relatedPlayerId: ALICE,
      relatedInstanceId: "blocker-1",
      registrationIndex: 0,
    });

    state = applyAction(
      state,
      expectAction(
        state,
        ALICE,
        "declare_private_triggered_effect",
        (action) => action.sourceInstanceId === "c05-hand-1"
      )
    );
    state = applyAction(
      state,
      expectAction(
        state,
        ALICE,
        "resolve_pending_triggered_effect",
        (action) => action.sourceInstanceId === "c05-hand-1"
      )
    );
    expect(state.window).toBe("stack");

    state = passOpenStackWindow(state);
    expect(state.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: ALICE,
      sourceInstanceId: "c05-hand-1",
      sourceDefinitionId: "BSAZ01-C05",
      requiredTargetCount: 2,
    });
    expect(
      new Set(state.pendingEffectTargetSelection!.candidateInstanceIds)
    ).toEqual(new Set(["attacker-1", "blocker-1"]));

    state = applyLegalAction({
      state,
      action: expectAction(state, ALICE, "resolve_pending_effect_target"),
      targetInstanceIds: ["attacker-1", "blocker-1"],
      ...e2eLookups,
    }).state;
    const final = flushPendingLeaves(state, e2eLookups.getCardDefinitionById);

    expect(
      final.log.some((entry) => entry.includes("magic:without-cost:"))
    ).toBe(true);
    expect(final.log.some((entry) => entry.includes("magic:reduction:"))).toBe(
      false
    );
    expect(
      final.cardInstances.find((card) => card.instanceId === "c05-hand-1")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((card) => card.instanceId === "attacker-1")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((card) => card.instanceId === "blocker-1")?.zone
    ).toBe("trash");
    expect(final.players.find((player) => player.id === ALICE)?.handCount).toBe(
      1
    );
    expect(final.players.find((player) => player.id === BOB)?.handCount).toBe(
      0
    );
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === ALICE && card.zone === "hand"
      )
    ).toHaveLength(1);
    expect(
      final.cardInstances.filter(
        (card) => card.ownerPlayerId === BOB && card.zone === "hand"
      )
    ).toHaveLength(0);
  });
});
