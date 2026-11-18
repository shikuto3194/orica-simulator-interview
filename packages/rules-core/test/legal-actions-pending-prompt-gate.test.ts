import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  getLegalActions,
  sanitizeStateForViewer,
} from "../src";
import type { PendingCoreSplitSelection, PendingTargetRedirect } from "../src";
import type {
  ActiveAttack,
  BattleFlashWindowState,
  GameState,
  PendingMultiPlacement,
} from "../src";

/**
 * pending UI prompt (対象選択系: resolve_* で解決する prompt) は「解決者本人」にのみ
 * legal action を返す回帰テスト。
 *
 * バグ: room モードでは各クライアントが自分視点で getLegalActions するため、gate が
 * 無いと解決者でない相手にも resolve_* が返り、相手にも対象選択モーダル (BSTH01-R05
 * アクセルのコア配分等) が表示されて相手が解決できてしまっていた。
 */
describe("pending UI prompt は解決者にのみ legal action を返す", () => {
  function stateWithCoreSplit(actingPlayerId: string) {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const sel: PendingCoreSplitSelection = {
      pendingId: "csm-0",
      actingPlayerId,
      sourceInstanceId: "s-1",
      sourceDefinitionId: "BSTH01-R05",
      fromLocation: { kind: "void" },
      totalAmount: 2,
      destinations: [
        { location: { kind: "reserve", playerId: actingPlayerId } },
        { location: { kind: "trash", playerId: actingPlayerId } },
      ],
      effectTiming: { kind: "phase", step: "main" },
    };
    state.pendingCoreSplitSelection = sel;
    return state;
  }

  const stub = () => undefined;

  it("解決者 (alice) には resolve_pending_core_split が返る", () => {
    const state = stateWithCoreSplit("alice");
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: stub,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_core_split")).toBe(
      true
    );
  });

  it("非解決者 (bob) には resolve_pending_core_split を返さない (相手にコア配分モーダルが出ない)", () => {
    const state = stateWithCoreSplit("alice");
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: stub,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_core_split")).toBe(
      false
    );
    expect(actions).toEqual([]);
  });
});

/**
 * pendingSetAsideExitReplacementChoice (ENGINE-set-aside-exit-replacement-choice、
 * BSTH08.5-M11) の解決者ゲート回帰テスト。adversarial verifier 2026-07-25 指摘:
 * pendingPromptResolverIds への追記漏れで非解決者にも resolve_* が返っていた。
 */
describe("pendingSetAsideExitReplacementChoice は解決者にのみ legal action を返す", () => {
  function stateWithSetAsideExitChoice(choosingPlayerId: string) {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    state.pendingSetAsideExitReplacementChoice = {
      choosingPlayerId,
      cardInstanceId: "m11",
      replacement: { kind: "move_to", zone: "hand" },
    };
    return state;
  }

  const stub = () => undefined;

  it("解決者 (alice) には resolve_set_aside_exit_replacement_choice が返る", () => {
    const state = stateWithSetAsideExitChoice("alice");
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: stub,
    });
    expect(
      actions.some(
        (a) => a.kind === "resolve_set_aside_exit_replacement_choice"
      )
    ).toBe(true);
  });

  it("非解決者 (bob) には resolve_set_aside_exit_replacement_choice を返さない", () => {
    const state = stateWithSetAsideExitChoice("alice");
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: stub,
    });
    expect(
      actions.some(
        (a) => a.kind === "resolve_set_aside_exit_replacement_choice"
      )
    ).toBe(false);
    expect(actions).toEqual([]);
  });
});

describe("pendingTargetRedirects は FIFO 先頭の解決者にのみ legal action を返す", () => {
  function redirectFor(
    pendingId: string,
    promptedPlayerId: string
  ): PendingTargetRedirect {
    return {
      pendingId,
      redirectEffectId: `redirect-${pendingId}`,
      promptedPlayerId,
      sourceEffectInstanceId: "src",
      sourceEffectDefinitionId: "SRC",
      originalResolvedInstanceIds: ["target"],
      redirectableInstanceId: "target",
      candidateTokenInstanceIds: ["candidate"],
    };
  }

  const stub = () => undefined;

  it("2 件目の resolver は先頭が解決されるまで gate で止める", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    state.pendingTargetRedirects = [
      redirectFor("redirect-alice", "alice"),
      redirectFor("redirect-bob", "bob"),
    ];

    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: stub,
    });
    expect(aliceActions.some((a) => a.kind === "confirm_target_redirect")).toBe(
      true
    );

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: stub,
    });
    expect(bobActions).toEqual([]);
  });
});

describe("viewer-sanitized pending prompt lock", () => {
  function stateWithAliceMultiPlacementDuringBobFlash(): GameState {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    state.activePlayerId = "alice";
    state.step = "attack";
    state.window = "flash_before_block";
    const flashWindow: BattleFlashWindowState = {
      kind: "before_block",
      priorityPlayerId: "bob",
      pendingStackAction: null,
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "bob",
    };
    const attack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "entity-1",
      participantEntityIds: ["entity-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "entity-1",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["entity-1"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: flashWindow,
    };
    const pending: PendingMultiPlacement = {
      pendingId: "mp-1",
      actingPlayerId: "alice",
      sourceInstanceId: "alisa",
      sourceDefinitionId: "BSGE01-R01",
      targets: [],
      effectTiming: { kind: "activated", mode: "flash" },
    };
    state.activeAttack = attack;
    state.pendingMultiPlacement = pending;
    return state;
  }

  it("非解決者向け sanitize では pending 中身を隠しても battle flash pass を返さない", () => {
    const state = stateWithAliceMultiPlacementDuringBobFlash();
    const bobView = sanitizeStateForViewer(state, "bob");

    expect(bobView.pendingMultiPlacement).toBeNull();
    expect(bobView.pendingPromptLock).toEqual({
      resolverPlayerIds: ["alice"],
    });

    const actions = getLegalActions({
      state: bobView,
      actingPlayerId: "bob",
      getCardDefinitionById: () => undefined,
    });
    expect(actions).toEqual([]);
  });
});
