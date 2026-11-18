import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  getCurrentActorPlayerIds,
  getLegalActions,
  isCurrentActor,
} from "../src";
import type {
  GameState,
  PendingBurstCheck,
  PendingPrivateDeclaration,
  PendingTriggeredEffect,
  PreGameState,
  StackWindow,
  PreDeclarationStackWindow,
  PendingTargetRedirect,
  PendingDeckReveal,
  PendingZoneSelection,
  PendingCoreShootSelection,
  PendingSummonCostExcludeChoice,
  PendingCoreSplitSelection,
  PendingCoreSourceAllocation,
  PendingCoreDistribution,
  PendingMultiPlacement,
  ActiveAttack,
  BattleFlashWindowState,
} from "../src";

/**
 * P3-64 Phase A — priority-gated PUT の actor 判定 helper のテスト。
 *
 * `getCurrentActorPlayerIds(state)` が GameState の各 pending / window から
 * 「今この瞬間に state を変更する権利を持つプレイヤー」の集合を正しく返すか確認する。
 */

function baseState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

function legalActionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: () => undefined,
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("getCurrentActorPlayerIds", () => {
  it("デフォルトは activePlayerId のみ", () => {
    const state = baseState();
    const ids = getCurrentActorPlayerIds(state);
    expect(Array.from(ids).sort()).toEqual(["alice"]);
  });

  it("preGame 中は両プレイヤーを許可", () => {
    const state = baseState();
    const preGame: PreGameState = {
      phase: "waiting_janken",
      firstPlayerId: null,
      jankenHands: {},
      jankenWinner: null,
      mulliganDone: {},
    };
    state.preGame = preGame;
    const ids = getCurrentActorPlayerIds(state);
    expect(Array.from(ids).sort()).toEqual(["alice", "bob"]);
  });

  it("pendingBraveLeaveChoice は choosingPlayerId のみ", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.pendingBraveLeaveChoice = {
      choosingPlayerId: "bob",
      hostInstanceId: "host-1",
      braveInstanceIds: ["b-1"],
      leaveKind: "destroyed",
      leaveCause: "battle",
    };
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingBraveAttackContinuation は choosingPlayerId のみ", () => {
    const state = baseState();
    state.pendingBraveAttackContinuation = {
      choosingPlayerId: "bob",
      entityId: "e-1",
      braveInstanceIds: ["b-1"],
    };
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingSoulStateReplacement は choosingPlayerId のみ", () => {
    const state = baseState();
    state.pendingSoulStateReplacement = {
      choosingPlayerId: "bob",
      cardInstanceId: "c-1",
      originalLeaveKind: "destroyed",
      originalLeaveCause: "effect_other",
    };
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingPrivateDeclarations 単独は先頭 ownerPlayerId", () => {
    const state = baseState();
    const decl: PendingPrivateDeclaration = {
      declarationId: "d-1",
      ownerPlayerId: "bob",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      sourceKind: "field_card",
      sourceZone: "field",
      registrationIndex: 0,
      pendingId: "p-1",
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:107",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
    };
    state.pendingPrivateDeclarations = [decl];
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingPrivateDeclarations 同 simultaneousGroupId は全 owner", () => {
    const state = baseState();
    const groupId = "grp-1";
    const base = (id: string, owner: string): PendingPrivateDeclaration => ({
      declarationId: id,
      ownerPlayerId: owner,
      actingPlayerId: owner,
      sourceInstanceId: `s-${id}`,
      sourceDefinitionId: "def-1",
      sourceKind: "field_card",
      sourceZone: "field",
      registrationIndex: 0,
      pendingId: `p-${id}`,
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:134",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      simultaneousGroupId: groupId,
    });
    state.pendingPrivateDeclarations = [
      base("d-1", "alice"),
      base("d-2", "bob"),
    ];
    expect(Array.from(getCurrentActorPlayerIds(state)).sort()).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("pendingPrivateDeclarations 異なる group は先頭の owner のみ", () => {
    const state = baseState();
    const make = (
      id: string,
      owner: string,
      group: string
    ): PendingPrivateDeclaration => ({
      declarationId: id,
      ownerPlayerId: owner,
      actingPlayerId: owner,
      sourceInstanceId: `s-${id}`,
      sourceDefinitionId: "def-1",
      sourceKind: "field_card",
      sourceZone: "field",
      registrationIndex: 0,
      pendingId: `p-${id}`,
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:171",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      simultaneousGroupId: group,
    });
    state.pendingPrivateDeclarations = [
      make("d-1", "alice", "g1"),
      make("d-2", "bob", "g2"),
    ];
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("公開 immediate 誘発は通常 private declaration より先に actor になる", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const privateDecl: PendingPrivateDeclaration = {
      declarationId: "d-normal",
      ownerPlayerId: "bob",
      actingPlayerId: "bob",
      sourceInstanceId: "s-normal",
      sourceDefinitionId: "def-1",
      sourceKind: "field_card",
      sourceZone: "field",
      registrationIndex: 0,
      pendingId: "p-normal",
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:202",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      triggerPriority: "normal",
    };
    const publicImmediate: PendingTriggeredEffect = {
      pendingId: "te-immediate-1",
      actingPlayerId: "bob",
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:223",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      resolvedSourceInstanceIds: [],
      triggerPriority: "immediate",
    };
    state.pendingPrivateDeclarations = [privateDecl];
    state.pendingTriggeredEffects = [
      publicImmediate,
      { ...publicImmediate, pendingId: "te-immediate-2" },
    ];

    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("同じ immediate 群では private declaration が公開 immediate 選択より先に actor になる", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const privateDecl: PendingPrivateDeclaration = {
      declarationId: "d-immediate",
      ownerPlayerId: "bob",
      actingPlayerId: "bob",
      sourceInstanceId: "s-immediate",
      sourceDefinitionId: "def-1",
      sourceKind: "field_card",
      sourceZone: "field",
      registrationIndex: 0,
      pendingId: "p-immediate",
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:250",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      triggerPriority: "immediate",
    };
    const publicImmediate: PendingTriggeredEffect = {
      pendingId: "te-immediate",
      actingPlayerId: "alice",
      eventKind: "battle_blocked",
      source: "battle",
      chainId: "test:current-actor:271",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      resolvedSourceInstanceIds: [],
      triggerPriority: "immediate",
    };
    state.pendingPrivateDeclarations = [privateDecl];
    state.pendingTriggeredEffects = [publicImmediate];

    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingBurstChecks は actingPlayerId (burst owner/responder) 集合", () => {
    const state = baseState();
    const check: PendingBurstCheck = {
      checkId: "bc-1",
      actingPlayerId: "alice",
      eventKind: "spirit_destroyed",
      source: "battle",
      chainId: "test:current-actor:294",
      attackId: null,
      relatedPlayerId: "bob",
      amount: 1,
      step: "attack",
      window: "battle",
      resolvedBurstCardInstanceIds: [],
    };
    state.pendingBurstChecks = [check];
    // owner = actingPlayerId (responder)。relatedPlayerId はイベント対象 (subject)。
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("normal private declaration と未宣言バーストが同時に残るときはバースト側 actor を先に返す", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const privateDecl: PendingPrivateDeclaration = {
      declarationId: "d-normal-life",
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
      sourceInstanceId: "hand-source",
      sourceDefinitionId: "BSLH01-M01",
      sourceKind: "spirit",
      sourceZone: "hand",
      registrationIndex: 0,
      pendingId: "p-normal-life",
      eventKind: "reduce_life",
      source: "battle_resolution",
      chainId: "battle-resolution:1",
      attackId: "attack-1",
      relatedPlayerId: "bob",
      relatedInstanceId: "attacker-1",
      amount: 1,
      step: "attack",
      window: "battle_resolution",
      triggerPriority: "normal",
      simultaneousGroupId: "sim-group:life-1",
    };
    const burst: PendingBurstCheck = {
      checkId: "bc-life-1",
      actingPlayerId: "bob",
      eventKind: "reduce_life",
      source: "battle_resolution",
      chainId: "battle-resolution:1",
      attackId: "attack-1",
      relatedPlayerId: "bob",
      relatedInstanceId: "attacker-1",
      amount: 1,
      step: "attack",
      window: "battle_resolution",
      resolvedBurstCardInstanceIds: [],
      simultaneousGroupId: "sim-group:life-1",
    };
    state.pendingPrivateDeclarations = [privateDecl];
    state.pendingBurstChecks = [burst];

    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
    expect(
      legalActionsFor(state, "bob").some(
        (action) => action.kind === "resolve_pending_burst_check"
      )
    ).toBe(true);
    expect(legalActionsFor(state, "alice")).toEqual([]);
  });

  it("pendingTriggeredEffects が残っていても未宣言バースト発動宣言を先に提示する", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const triggered: PendingTriggeredEffect = {
      pendingId: "te-1",
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:current-actor:367",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
    };
    const burst: PendingBurstCheck = {
      checkId: "bc-1",
      actingPlayerId: "bob",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:current-actor:381",
      attackId: null,
      relatedPlayerId: "alice",
      amount: 1,
      step: "main",
      window: "none",
      resolvedBurstCardInstanceIds: [],
    };
    state.pendingTriggeredEffects = [triggered];
    state.pendingBurstChecks = [burst];

    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
    expect(
      legalActionsFor(state, "bob").some(
        (action) => action.kind === "resolve_pending_burst_check"
      )
    ).toBe(true);
    expect(legalActionsFor(state, "alice")).toEqual([]);
  });

  it("公開 immediate 誘発が残っている間は未宣言バースト発動選択を actor にしない", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const triggered: PendingTriggeredEffect = {
      pendingId: "te-immediate-1",
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:current-actor:409",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
      triggerPriority: "immediate",
    };
    const burst: PendingBurstCheck = {
      checkId: "bc-1",
      actingPlayerId: "bob",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:current-actor:424",
      attackId: null,
      relatedPlayerId: "alice",
      amount: 1,
      step: "main",
      window: "none",
      resolvedBurstCardInstanceIds: [],
    };
    state.pendingTriggeredEffects = [
      triggered,
      { ...triggered, pendingId: "te-immediate-2" },
    ];
    state.pendingBurstChecks = [burst];

    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("pendingEnterFieldPlacement 中は相手の pendingBurstChecks を合法手に出さない", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.pendingEnterFieldPlacement = {
      pendingId: "efp-1",
      actingPlayerId: "alice",
      sourceInstanceId: "alice-summon-1",
      sourceDefinitionId: "TEST-SPIRIT",
      remainingStacks: [],
      minimumCoreCount: 1,
      maximumCoreCount: null,
    };
    state.pendingBurstChecks = [
      {
        checkId: "bc-bob-1",
        actingPlayerId: "bob",
        eventKind: "summon",
        source: "action_resolution",
        chainId: "test:current-actor:459",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "alice-summon-1",
        amount: null,
        step: "main",
        window: "main",
        resolvedBurstCardInstanceIds: [],
      },
    ];

    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
    expect(legalActionsFor(state, "bob")).toEqual([]);
    expect(
      legalActionsFor(state, "alice").map((action) => action.kind)
    ).toEqual(["resolve_pending_enter_field_placement"]);
  });

  it("pendingTargetRedirects は FIFO 先頭の promptedPlayerId", () => {
    const state = baseState();
    const redirect: PendingTargetRedirect = {
      pendingId: "r-1",
      redirectEffectId: "eff-1",
      promptedPlayerId: "bob",
      sourceEffectInstanceId: "src-1",
      sourceEffectDefinitionId: "def-src",
      originalResolvedInstanceIds: ["target-1"],
      redirectableInstanceId: "target-1",
      candidateTokenInstanceIds: ["token-1"],
    };
    state.pendingTargetRedirects = [redirect];
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingTargetRedirects は承諾後の候補選択 stage で candidateChooserPlayerId に移る", () => {
    const state = baseState();
    const redirect: PendingTargetRedirect = {
      pendingId: "r-1",
      redirectEffectId: "eff-1",
      promptedPlayerId: "alice",
      candidateChooserPlayerId: "bob",
      decisionConfirmed: true,
      sourceEffectInstanceId: "src-1",
      sourceEffectDefinitionId: "def-src",
      originalResolvedInstanceIds: ["target-1", "target-2"],
      redirectableInstanceId: "target-1",
      redirectableInstanceIds: ["target-1", "target-2"],
      replacementMode: "reselect",
      candidateTokenInstanceIds: ["token-1", "token-2"],
    };
    state.pendingTargetRedirects = [redirect];
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingTargetRedirects は pendingCoreDistribution より優先する", () => {
    const state = baseState();
    const redirect: PendingTargetRedirect = {
      pendingId: "r-1",
      redirectEffectId: "eff-1",
      promptedPlayerId: "alice",
      candidateChooserPlayerId: "bob",
      sourceEffectInstanceId: "src-1",
      sourceEffectDefinitionId: "def-src",
      originalResolvedInstanceIds: ["target-1"],
      redirectableInstanceId: "target-1",
      candidateTokenInstanceIds: ["token-1"],
      coreDistributionPendingId: "cd-1",
    };
    const dist: PendingCoreDistribution = {
      pendingId: "cd-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      candidates: [],
      totalNormalCores: 1,
      hasSoulCore: false,
      fromKind: "trash",
      fromPlayerId: "bob",
      toPlayerId: "bob",
      effectTiming: { kind: "phase", step: "main" },
    };
    state.pendingTargetRedirects = [redirect];
    state.pendingCoreDistribution = dist;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("pendingDeckReveal は actingPlayerId", () => {
    const state = baseState();
    const reveal: PendingDeckReveal = {
      pendingId: "dr-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      revealedCardInstanceIds: [],
      picks: [],
      remainder: "bottom",
      phase: "picking",
      currentPickIndex: 0,
      pickedCardInstanceIds: [],
    };
    state.pendingDeckReveal = reveal;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingZoneSelection は actingPlayerId", () => {
    const state = baseState();
    const sel: PendingZoneSelection = {
      pendingId: "zs-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      actionKind: "search_deck",
      sourceZone: "deck",
      candidateCardInstanceIds: [],
      maxCount: 1,
      destination: "hand",
      remainingActions: [],
      effectTiming: {
        kind: "phase",
        step: "main",
      },
    };
    state.pendingZoneSelection = sel;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingCoreShootSelection は actingPlayerId", () => {
    const state = baseState();
    const sel: PendingCoreShootSelection = {
      pendingId: "cs-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      candidates: [],
      totalAmount: 1,
      toKind: "reserve",
      toPlayerId: "alice",
      fromPlayerId: "alice",
      remainingActions: [],
      effectTiming: { kind: "phase", step: "main" },
    };
    state.pendingCoreShootSelection = sel;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingSummonCostExcludeChoice は actingPlayerId (P3-91 型回帰: 02ed1d89 で legal-actions.ts 側にのみ追加され current-actor.ts 側が欠落し fuzz stuck を招いた)", () => {
    const state = baseState();
    const sel: PendingSummonCostExcludeChoice = {
      pendingId: "scec-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      effectIndex: 0,
      candidateCardInstanceIds: [],
      maxCount: 2,
      discountPerCard: 1,
    };
    state.pendingSummonCostExcludeChoice = sel;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingCoreSplitSelection は actingPlayerId", () => {
    const state = baseState();
    const sel: PendingCoreSplitSelection = {
      pendingId: "ssp-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      fromLocation: { kind: "void" },
      totalAmount: 2,
      destinations: [
        { location: { kind: "reserve", playerId: "bob" } },
        { location: { kind: "trash", playerId: "bob" } },
      ],
      effectTiming: { kind: "phase", step: "main" },
    };
    state.pendingCoreSplitSelection = sel;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingCoreSourceAllocation は actingPlayerId", () => {
    const state = baseState();
    const alloc: PendingCoreSourceAllocation = {
      pendingId: "csa-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "BSTH05-C11",
      candidates: [
        { instanceId: "nx-1", available: 2 },
        { instanceId: "nx-2", available: 3 },
      ],
      requiredTotal: 3,
      toLocation: { kind: "void", player: "self" },
      effectTiming: { kind: "activated", mode: "flash" },
    };
    state.pendingCoreSourceAllocation = alloc;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingCoreDistribution は actingPlayerId", () => {
    const state = baseState();
    const dist: PendingCoreDistribution = {
      pendingId: "cd-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      candidates: [],
      totalNormalCores: 1,
      hasSoulCore: false,
      fromKind: "trash",
      fromPlayerId: "bob",
      toPlayerId: "bob",
      effectTiming: { kind: "phase", step: "main" },
    };
    state.pendingCoreDistribution = dist;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("pendingMultiPlacement は actingPlayerId", () => {
    const state = baseState();
    const mp: PendingMultiPlacement = {
      pendingId: "mp-1",
      actingPlayerId: "bob",
      sourceInstanceId: "s-1",
      sourceDefinitionId: "def-1",
      targets: [],
      effectTiming: { kind: "phase", step: "main" },
    };
    state.pendingMultiPlacement = mp;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("mechanic 付き pendingTriggeredEffects (神託) は誘発キュー規約で owner+turn player", () => {
    // P3-92: 神託は専用 pending ではなく誘発キューに乗る。単一 pending は auto-select
    // され、owner (bob) + turn player (alice) + chooser 変種許容の相手が actor になる。
    const state = baseState();
    state.activePlayerId = "alice";
    const pending: PendingTriggeredEffect = {
      pendingId: "oc-1",
      actingPlayerId: "bob",
      eventKind: "oracle",
      source: "action_resolution",
      chainId: "test:current-actor:701",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: "gw-1",
      amount: null,
      step: state.step,
      window: state.window,
      resolvedSourceInstanceIds: [],
      mechanic: {
        chainId: "test:current-actor:714",
        kind: "oracle",
        grandwalkerInstanceId: "gw-1",
        triggerCardInstanceId: "tc-1",
        triggerKind: "summon",
      },
    };
    state.pendingTriggeredEffects = [pending];
    expect(Array.from(getCurrentActorPlayerIds(state)).sort()).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("pendingTriggeredEffects: turn player + selected effect の owner を許可", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const selected: PendingTriggeredEffect = {
      pendingId: "te-1",
      actingPlayerId: "bob",
      eventKind: "spirit_destroyed",
      source: "battle",
      chainId: "test:current-actor:731",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      resolvedSourceInstanceIds: [],
      selectedByTurnPlayer: true,
    };
    const unselected: PendingTriggeredEffect = {
      ...selected,
      pendingId: "te-2",
      actingPlayerId: "bob",
      selectedByTurnPlayer: false,
    };
    state.pendingTriggeredEffects = [selected, unselected];
    expect(Array.from(getCurrentActorPlayerIds(state)).sort()).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("pendingTriggeredEffects: 単一 pending は auto-select 扱いで owner も許可", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const effect: PendingTriggeredEffect = {
      pendingId: "te-1",
      actingPlayerId: "bob",
      eventKind: "spirit_destroyed",
      source: "battle",
      chainId: "test:current-actor:762",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      resolvedSourceInstanceIds: [],
    };
    state.pendingTriggeredEffects = [effect];
    expect(Array.from(getCurrentActorPlayerIds(state)).sort()).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("pendingTriggeredEffects: 複数 pending で selected がなければ activePlayerId のみ", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    const effect: PendingTriggeredEffect = {
      pendingId: "te-1",
      actingPlayerId: "bob",
      eventKind: "spirit_destroyed",
      source: "battle",
      chainId: "test:current-actor:786",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      resolvedSourceInstanceIds: [],
    };
    state.pendingTriggeredEffects = [effect, { ...effect, pendingId: "te-2" }];
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("stackWindow は priorityPlayerId", () => {
    const state = baseState();
    const stack: StackWindow = {
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
      actingPlayerId: "alice",
      previousWindow: "main",
      subStackEverOpened: false,
      burstWindowKind: null,
    };
    state.stackWindow = stack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("preDeclarationStackWindow は priorityPlayerId", () => {
    const state = baseState();
    const stack: PreDeclarationStackWindow = {
      kind: "attack",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      previousWindow: "main",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
    };
    state.preDeclarationStackWindow = stack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("activeAttack.flashWindowState は priorityPlayerId", () => {
    const state = baseState();
    const flash: BattleFlashWindowState = {
      kind: "flash_before_block",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
    };
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "e-1",
      participantEntityIds: ["e-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: ["e-1"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: flash,
    };
    state.activeAttack = attack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  // ルール正源: 10_rules/02_turn-flow-and-timing.md 138-145, 217
  // attack ステップの declare_block 小窓では非アクティブプレイヤー (defender) が actor。
  it("ブロック宣言ウィンドウ: target=player のとき defender (target playerId) が actor", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.step = "attack";
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "e-1",
      participantEntityIds: ["e-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "e-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["e-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    state.activeAttack = attack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("ブロック宣言ウィンドウ: target=battle_entity のとき entity controller が actor", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.step = "attack";
    state.cardInstances = [
      {
        instanceId: "card-bob-1",
        definitionId: "BSTH01-X04",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        faceDown: false,
        exhaustState: "recovered",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
        pendingLeaveKind: null,
        pendingLeaveCause: null,
        underCards: [],
        attachedChildrenIds: [],
        pendingLeaveChainId: null,
        attachedToInstanceId: null,
        divineTransformState: null,
        minimumRequiredCores: 1,
        originalDefinitionId: "BSTH01-X04",
        pendingLeaveLvSnapshot: null,
        deferZoneMoveUntilChainEnd: false,
      },
    ];
    state.battleEntities = [
      {
        entityId: "be-target",
        resolvedBp: 8000,
        attackState: "idle",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["card-bob-1"],
      },
    ];
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "e-1",
      participantEntityIds: ["e-1"],
      groupMode: "single",
      target: { kind: "battle_entity", entityId: "be-target" },
      blockAssignments: [
        { participantEntityId: "e-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["e-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    state.activeAttack = attack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });

  it("ブロック宣言ウィンドウ: flashWindowState non-null 時は priorityPlayerId が優先", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.step = "attack";
    const flash: BattleFlashWindowState = {
      kind: "flash_before_block",
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "bob",
      pendingStackAction: null,
    };
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "e-1",
      participantEntityIds: ["e-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "e-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["e-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: flash,
    };
    state.activeAttack = attack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("ブロック宣言ウィンドウ: block 宣言確定後は defender 判定にしない (fallback)", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.step = "attack";
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "e-1",
      participantEntityIds: ["e-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "e-1", blockedByEntityIds: ["blocker-1"] },
      ],
      symbolResolutionOrder: ["e-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    state.activeAttack = attack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("ブロック宣言ウィンドウ: flashAfterBlockCompleted=true (バトル解決後) は defender 判定にしない", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.step = "attack";
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "e-1",
      participantEntityIds: ["e-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "e-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["e-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
    state.activeAttack = attack;
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["alice"]);
  });

  it("優先順: pending 系は stackWindow より優先", () => {
    const state = baseState();
    state.activePlayerId = "alice";
    state.stackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
      actingPlayerId: "alice",
      previousWindow: "main",
      subStackEverOpened: false,
      burstWindowKind: null,
    };
    state.pendingBraveLeaveChoice = {
      choosingPlayerId: "bob",
      hostInstanceId: "host-1",
      braveInstanceIds: ["b-1"],
      leaveKind: "destroyed",
      leaveCause: "battle",
    };
    expect(Array.from(getCurrentActorPlayerIds(state))).toEqual(["bob"]);
  });
});

describe("isCurrentActor", () => {
  it("デフォルトは activePlayerId のみ true", () => {
    const state = baseState();
    expect(isCurrentActor(state, "alice")).toBe(true);
    expect(isCurrentActor(state, "bob")).toBe(false);
  });

  it("preGame では両プレイヤー true", () => {
    const state = baseState();
    state.preGame = {
      phase: "waiting_janken",
      firstPlayerId: null,
      jankenHands: {},
      jankenWinner: null,
      mulliganDone: {},
    };
    expect(isCurrentActor(state, "alice")).toBe(true);
    expect(isCurrentActor(state, "bob")).toBe(true);
  });
});
