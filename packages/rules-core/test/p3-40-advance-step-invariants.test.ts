import { describe, expect, it } from "vitest";
import {
  advanceStep,
  createEmptyGameState,
  getGameProgressBlockerReason,
  type GameState,
  type PendingBurstCheck,
  type PendingPrivateDeclaration,
  type PendingTriggeredEffect,
  type PendingDeckReveal,
  type PendingZoneSelection,
  type PendingCoreSplitSelection,
  type PendingCoreShootSelection,
  type PendingCoreDistribution,
  type PendingSoulStateReplacement,
  type ActiveAttack,
  type StackWindow,
  type PreDeclarationStackWindow,
  type BattleResolutionGroup,
  type BattleImmediateEffect,
} from "../src";

/**
 * P3-40: advanceStep の不変条件ガード。
 *
 * GUI から `handleAdvanceStep` 経由で `advanceStep` を直接呼ぶ経路と、
 * テスト/スクリプトから直接呼ぶ経路の両方で、進行不能なキューが残った
 * 状態でステップ送りを許さない二重防御を engine 側に置く。
 */

const lookup = (() => undefined) as never;
const triggerLookup = (() => undefined) as never;

function baseState(): GameState {
  const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return { ...state, step: "main" as const, window: "none" as const };
}

function expectAdvanceBlocked(
  overrides: Partial<GameState>,
  pattern: RegExp
): void {
  const state: GameState = { ...baseState(), ...overrides };
  expect(getGameProgressBlockerReason(state)).toMatch(pattern);
  expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(pattern);
}

describe("P3-40 advanceStep invariants", () => {
  it("refuses to progress with a pendingPrivateDeclaration queued", () => {
    const declaration: PendingPrivateDeclaration = {
      declarationId: "decl-1",
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      sourceKind: "spirit",
      sourceZone: "hand",
      registrationIndex: 0,
      pendingId: "pending-1",
      eventKind: "start_step",
      source: "step_transition",
      chainId: "test:p3-40-advance-step-invariants:50",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
    };
    const state: GameState = {
      ...baseState(),
      pendingPrivateDeclarations: [declaration],
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pending private declaration/i
    );
  });

  it("refuses to progress with pendingTriggeredEffects queued", () => {
    const pending: PendingTriggeredEffect = {
      pendingId: "pending-trig-1",
      actingPlayerId: "alice",
      eventKind: "start_step",
      source: "step_transition",
      chainId: "test:p3-40-advance-step-invariants:80",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
    };
    const state: GameState = {
      ...baseState(),
      pendingTriggeredEffects: [pending],
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pending triggered effect/i
    );
  });

  it("refuses to progress with pendingBurstChecks queued", () => {
    const burst: PendingBurstCheck = {
      checkId: "burst-1",
      actingPlayerId: "alice",
      eventKind: "after_life_decrease",
      source: "step_transition",
      chainId: "test:p3-40-advance-step-invariants:104",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: 1,
    };
    const state: GameState = {
      ...baseState(),
      pendingBurstChecks: [burst],
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pending burst check/i
    );
  });

  it("refuses to progress with battleImmediateEffects queued", () => {
    const immediate: BattleImmediateEffect = {
      promptId: "imm-1",
      attackId: "atk-1",
      timing: { kind: "phase", step: "attack", subPhase: "start" },
      sourceKind: "spirit",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      sourceCardNo: "DEF-1",
      actingPlayerId: "alice",
      participantEntityId: "entity-1",
      registrationIndex: 0,
    };
    const state: GameState = {
      ...baseState(),
      battleImmediateEffects: [immediate],
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /battle immediate effect/i
    );
  });

  it("refuses to progress while a stackWindow is open", () => {
    const stackWindow: StackWindow = {
      actingPlayerId: "alice",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      pendingResponses: [],
      subStackEverOpened: false,
      burstWindowKind: null,
    };
    const state: GameState = {
      ...baseState(),
      stackWindow,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /stack window is open/i
    );
  });

  it("refuses to progress while a preDeclarationStackWindow is open", () => {
    const preWindow: PreDeclarationStackWindow = {
      kind: "attack",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      pendingResponses: [],
    };
    const state: GameState = {
      ...baseState(),
      preDeclarationStackWindow: preWindow,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /preDeclarationStackWindow is open/i
    );
  });

  it("refuses to progress while a battleResolutionGroup is open", () => {
    const group: BattleResolutionGroup = {
      attackId: "atk-1",
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      symbolResolutionOrder: [],
      participantSnapshots: [],
    };
    const state: GameState = {
      ...baseState(),
      battleResolutionGroup: group,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /battleResolutionGroup is open/i
    );
  });

  it("refuses to progress while an activeAttack is in progress", () => {
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "entity-1",
      participantEntityIds: ["entity-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...baseState(),
      activeAttack: attack,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /activeAttack is in progress/i
    );
  });

  it.each([
    {
      name: "pendingBraveLeaveChoice",
      overrides: {
        pendingBraveLeaveChoice: {
          choosingPlayerId: "alice",
          hostInstanceId: "host-1",
          braveInstanceIds: ["brave-1"],
          leaveKind: "destroy",
          leaveCause: "effect",
        } as never,
      },
      pattern: /pendingBraveLeaveChoice/i,
    },
    {
      name: "pendingBraveAttackContinuation",
      overrides: {
        pendingBraveAttackContinuation: {
          choosingPlayerId: "alice",
          entityId: "entity-1",
          braveInstanceIds: ["brave-1"],
        } as never,
      },
      pattern: /pendingBraveAttackContinuation/i,
    },
    {
      name: "pendingConnectBattleDecision",
      overrides: {
        pendingConnectBattleDecision: { pendingId: "connect-1" } as never,
      },
      pattern: /pendingConnectBattleDecision/i,
    },
    {
      name: "pendingDeckRevealCountBoostChoice",
      overrides: {
        pendingDeckRevealCountBoostChoice: { pendingId: "boost-1" } as never,
      },
      pattern: /pendingDeckRevealCountBoostChoice/i,
    },
    {
      name: "pendingPayToActCoreGate",
      overrides: {
        pendingPayToActCoreGate: { pendingId: "pay-core-1" } as never,
      },
      pattern: /pendingPayToActCoreGate/i,
    },
    {
      name: "pendingPayToActHandDiscardGate",
      overrides: {
        pendingPayToActHandDiscardGate: {
          pendingId: "pay-hand-1",
        } as never,
      },
      pattern: /pendingPayToActHandDiscardGate/i,
    },
    {
      name: "pendingFieldMagicPreCostTrigger",
      overrides: {
        pendingFieldMagicPreCostTrigger: {
          pendingId: "field-magic-1",
        } as never,
      },
      pattern: /pendingFieldMagicPreCostTrigger/i,
    },
    {
      name: "pendingHandTrashSwapChoice",
      overrides: {
        pendingHandTrashSwapChoice: { pendingId: "hand-trash-1" } as never,
      },
      pattern: /pendingHandTrashSwapChoice/i,
    },
    {
      name: "pendingFieldHandSwapChoice",
      overrides: {
        pendingFieldHandSwapChoice: { pendingId: "field-hand-1" } as never,
      },
      pattern: /pendingFieldHandSwapChoice/i,
    },
    {
      name: "pendingTenshoSummon",
      overrides: {
        pendingTenshoSummon: { pendingId: "tensho-1" } as never,
      },
      pattern: /pendingTenshoSummon/i,
    },
    {
      name: "pendingReverseRebirthSummon",
      overrides: {
        pendingReverseRebirthSummon: { pendingId: "reverse-1" } as never,
      },
      pattern: /pendingReverseRebirthSummon/i,
    },
    {
      name: "pendingStoneFlipCombine",
      overrides: {
        pendingStoneFlipCombine: { pendingId: "stone-1" } as never,
      },
      pattern: /pendingStoneFlipCombine/i,
    },
    {
      name: "pendingSplitSummonChoice",
      overrides: {
        pendingSplitSummonChoice: { pendingId: "split-summon-1" } as never,
      },
      pattern: /pendingSplitSummonChoice/i,
    },
    {
      name: "pendingCoreCountSelection",
      overrides: {
        pendingCoreCountSelection: { pendingId: "core-count-1" } as never,
      },
      pattern: /pendingCoreCountSelection/i,
    },
    {
      name: "pendingCountSelection",
      overrides: {
        pendingCountSelection: { pendingId: "count-1" } as never,
      },
      pattern: /pendingCountSelection/i,
    },
    {
      name: "pendingDiscardSetBurstCountSelection",
      overrides: {
        pendingDiscardSetBurstCountSelection: {
          pendingId: "discard-burst-1",
        } as never,
      },
      pattern: /pendingDiscardSetBurstCountSelection/i,
    },
    {
      name: "pendingLifeCoreSelection",
      overrides: {
        pendingLifeCoreSelection: { pendingId: "life-core-1" } as never,
      },
      pattern: /pendingLifeCoreSelection/i,
    },
    {
      name: "pendingTargetRedirects",
      overrides: {
        pendingTargetRedirects: [{ promptedPlayerId: "alice" } as never],
      },
      pattern: /pendingTargetRedirect/i,
    },
  ])("refuses to progress while $name is open", ({ overrides, pattern }) => {
    expectAdvanceBlocked(overrides, pattern);
  });

  it("refuses to progress while a pendingDeckReveal is open", () => {
    const reveal: PendingDeckReveal = {
      pendingId: "reveal-1",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      revealedCardInstanceIds: [],
      picks: [],
      remainder: "top",
      phase: "picking",
      currentPickIndex: 0,
      pickedCardInstanceIds: [],
    };
    const state: GameState = {
      ...baseState(),
      pendingDeckReveal: reveal,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pendingDeckReveal is open/i
    );
  });

  it("refuses to progress while a pendingZoneSelection is open", () => {
    const selection: PendingZoneSelection = {
      pendingId: "zone-1",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      actionKind: "search_deck",
      sourceZone: "deck",
      candidateCardInstanceIds: [],
      maxCount: 1,
      destination: "hand",
      remainingActions: [],
      effectTiming: { kind: "phase", step: "main", subPhase: "start" },
    };
    const state: GameState = {
      ...baseState(),
      pendingZoneSelection: selection,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pendingZoneSelection is open/i
    );
  });

  it("refuses to progress while a pendingCoreSplitSelection is open", () => {
    const split: PendingCoreSplitSelection = {
      pendingId: "split-1",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      fromLocation: { kind: "void", player: { kind: "self" } },
      totalAmount: 1,
      destinations: [
        { location: { kind: "reserve", player: { kind: "self" } } },
      ],
      effectTiming: { kind: "phase", step: "main", subPhase: "start" },
    };
    const state: GameState = {
      ...baseState(),
      pendingCoreSplitSelection: split,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pendingCoreSplitSelection is open/i
    );
  });

  it("refuses to progress while a pendingCoreShootSelection is open", () => {
    const shoot: PendingCoreShootSelection = {
      pendingId: "shoot-1",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      candidates: [],
      totalAmount: 1,
      toKind: "void",
      toPlayerId: "alice",
      fromPlayerId: "bob",
      remainingActions: [],
      effectTiming: { kind: "phase", step: "main", subPhase: "start" },
    };
    const state: GameState = {
      ...baseState(),
      pendingCoreShootSelection: shoot,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pendingCoreShootSelection is open/i
    );
  });

  it("refuses to progress while a pendingCoreDistribution is open", () => {
    const dist: PendingCoreDistribution = {
      pendingId: "dist-1",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "DEF-1",
      candidates: [],
      totalNormalCores: 1,
      hasSoulCore: false,
      fromKind: "trash",
      fromPlayerId: "alice",
      toPlayerId: "alice",
      effectTiming: { kind: "phase", step: "main", subPhase: "start" },
    };
    const state: GameState = {
      ...baseState(),
      pendingCoreDistribution: dist,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pendingCoreDistribution is open/i
    );
  });

  it("refuses to progress while a pendingSoulStateReplacement is open", () => {
    const soul: PendingSoulStateReplacement = {
      choosingPlayerId: "alice",
      cardInstanceId: "card-1",
      originalLeaveKind: "destroy",
      originalLeaveCause: "battle",
    };
    const state: GameState = {
      ...baseState(),
      pendingSoulStateReplacement: soul,
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pendingSoulStateReplacement is open/i
    );
  });

  it("refuses to progress with mechanic pending (oracle) queued", () => {
    // P3-92: 神託は mechanic 付き pendingTriggeredEffects に統合され、
    // 既存の pendingTriggeredEffects guard が滞留を検知する。
    const base = baseState();
    const pending: PendingTriggeredEffect = {
      pendingId: "oc-1",
      actingPlayerId: "alice",
      eventKind: "oracle",
      source: "action_resolution",
      chainId: "test:p3-40-advance-step-invariants:501",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "gw-1",
      amount: null,
      step: base.step,
      window: base.window,
      resolvedSourceInstanceIds: [],
      mechanic: {
        chainId: "test:p3-40-advance-step-invariants:514",
        kind: "oracle",
        grandwalkerInstanceId: "gw-1",
        triggerCardInstanceId: "tc-1",
        triggerKind: "summon",
      },
    };
    const state: GameState = {
      ...base,
      pendingTriggeredEffects: [pending],
    };
    expect(() => advanceStep(state, lookup, triggerLookup)).toThrow(
      /pending triggered effect/i
    );
  });

  it("permits advanceStep when all pending queues are clear", () => {
    const state = baseState();
    expect(() => advanceStep(state, lookup, triggerLookup)).not.toThrow();
  });
});
