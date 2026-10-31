/**
 * P3-47 F-4 Step 3a: pendingTargetRedirects の lifecycle (gate + apply handlers) を検証する。
 *
 * 本テストは pending state を手動で injection して legal-actions / applyLegalAction 経路を
 * 確認する。effect-interpreter からの自動発行は Step 3b で配線する。
 *
 * 検証項目:
 * - gate: pendingTargetRedirects があると confirm/decline のみ legal
 * - confirm: candidate 内の withInstanceId で対象集合を置換、redirected=true
 * - decline: 元集合のまま、redirected=false
 * - 候補外 instanceId はエラー
 * - 別プレイヤーが confirm/decline 試行はエラー
 * - withInstanceId 未指定の confirm はエラー
 * - 複数 pending: FIFO で先頭を消化、残りは継続
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState } from "../src/factories";
import { getLegalActions, applyLegalAction } from "../src/legal/legal-actions";
import type {
  GameState,
  PendingTargetRedirect,
  CardDefinition,
} from "../src/model";
import type { ConfirmTargetRedirectLegalAction } from "../src/legal/legal-actions-types";

const ALICE = "player-1";
const BOB = "player-2";
const HOST = "host-flandre";
const TOKEN_A = "token-a";
const TOKEN_B = "token-b";

function makePending(
  overrides: Partial<PendingTargetRedirect> = {}
): PendingTargetRedirect {
  return {
    pendingId: "pr-1",
    redirectEffectId: "ce-redirect",
    promptedPlayerId: ALICE,
    sourceEffectInstanceId: "opp-magic",
    sourceEffectDefinitionId: "OPP-001",
    originalResolvedInstanceIds: [HOST],
    redirectableInstanceId: HOST,
    candidateTokenInstanceIds: [TOKEN_A, TOKEN_B],
    ...overrides,
  };
}

function stateWithPending(pendings: PendingTargetRedirect[]): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return {
    ...base,
    pendingTargetRedirects: pendings,
  };
}

const noopGetDef = (_id: string): CardDefinition | undefined => undefined;
const noopGetTriggered = () => undefined;

describe("P3-47 F-4 Step 3a: pendingTargetRedirects lifecycle", () => {
  it("pending がある間は confirm/decline のみ legal (FIFO 先頭)", () => {
    const state = stateWithPending([makePending()]);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: noopGetDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    expect(actions).toHaveLength(2);
    const kinds = actions.map((a) => a.kind).sort();
    expect(kinds).toEqual([
      "confirm_target_redirect",
      "decline_target_redirect",
    ]);
    actions.forEach((a) => {
      expect(a.actingPlayerId).toBe(ALICE);
      if (a.kind === "confirm_target_redirect") {
        expect(a.candidateTokenInstanceIds).toEqual([TOKEN_A, TOKEN_B]);
        expect(a.redirectableInstanceId).toBe(HOST);
      }
    });
  });

  it("confirm: 指定 candidate で対象集合を置換、redirected=true", () => {
    const state = stateWithPending([
      makePending({ originalResolvedInstanceIds: [HOST, "other-card"] }),
    ]);
    const result = applyLegalAction({
      state,
      action: {
        kind: "confirm_target_redirect",
        actionId: "redirect-confirm-pr-1",
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: "pr-1",
        originalResolvedInstanceIds: [HOST, "other-card"],
        redirectableInstanceId: HOST,
        candidateTokenInstanceIds: [TOKEN_A, TOKEN_B],
        sourceEffectInstanceId: "opp-magic",
        sourceEffectDefinitionId: "OPP-001",
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: noopGetDef,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(true);
    expect(result.resolvedAfterRedirect).toEqual([TOKEN_A, "other-card"]);
    expect(result.state.pendingTargetRedirects).toHaveLength(0);
    expect(result.state.log.some((l) => l.includes("confirm"))).toBe(true);
  });

  it("confirm: 判断者と候補選択者が異なる場合は承諾後に chooser へ候補選択を渡す", () => {
    const state = stateWithPending([
      makePending({
        originalResolvedInstanceIds: [HOST, "other-card"],
        candidateChooserPlayerId: BOB,
      }),
    ]);
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: noopGetDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    const confirmDecision = aliceActions.find(
      (a): a is ConfirmTargetRedirectLegalAction =>
        a.kind === "confirm_target_redirect"
    );
    expect(confirmDecision?.replacementSelectionRequired).toBe(false);
    expect(confirmDecision?.candidateTokenInstanceIds).toEqual([]);
    const decisionResult = applyLegalAction({
      state,
      action: confirmDecision!,
      getCardDefinitionById: noopGetDef,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    if (!("redirected" in decisionResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(decisionResult.redirected).toBe(false);
    expect(
      decisionResult.state.pendingTargetRedirects[0]?.decisionConfirmed
    ).toBe(true);

    const bobActions = getLegalActions({
      state: decisionResult.state,
      actingPlayerId: BOB,
      getCardDefinitionById: noopGetDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    expect(bobActions).toHaveLength(1);
    const chooseReplacement = bobActions[0];
    expect(chooseReplacement.kind).toBe("confirm_target_redirect");
    if (chooseReplacement.kind !== "confirm_target_redirect") {
      throw new Error("expected confirm_target_redirect");
    }
    expect(chooseReplacement.replacementSelectionRequired).toBe(true);
    expect(chooseReplacement.candidateTokenInstanceIds).toEqual([
      TOKEN_A,
      TOKEN_B,
    ]);
    const result = applyLegalAction({
      state: decisionResult.state,
      action: chooseReplacement,
      redirectTargetReplacementInstanceId: TOKEN_B,
      getCardDefinitionById: noopGetDef,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(true);
    expect(result.resolvedAfterRedirect).toEqual([TOKEN_B, "other-card"]);
    expect(result.state.pendingTargetRedirects).toHaveLength(0);
  });

  it("confirm: reselect は複数対象を同数の replacement へ選び直し、単一対象へ潰さない", () => {
    const state = stateWithPending([
      makePending({
        originalResolvedInstanceIds: [HOST, "other-card"],
        redirectableInstanceIds: [HOST, "other-card"],
        replacementMode: "reselect",
        candidateTokenInstanceIds: [TOKEN_A, TOKEN_B],
      }),
    ]);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: noopGetDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    const confirm = actions.find(
      (a): a is ConfirmTargetRedirectLegalAction =>
        a.kind === "confirm_target_redirect"
    );
    expect(confirm?.replacementMode).toBe("reselect");
    expect(confirm?.replacementTargetCount).toBe(2);

    const result = applyLegalAction({
      state,
      action: confirm!,
      redirectTargetReplacementInstanceIds: [TOKEN_A, TOKEN_B],
      getCardDefinitionById: noopGetDef,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(true);
    expect(result.resolvedAfterRedirect).toEqual([TOKEN_A, TOKEN_B]);
    expect(result.state.pendingTargetRedirects).toHaveLength(0);
  });

  it("decline: 元集合のまま、redirected=false", () => {
    const state = stateWithPending([
      makePending({ originalResolvedInstanceIds: [HOST, "other-card"] }),
    ]);
    const result = applyLegalAction({
      state,
      action: {
        kind: "decline_target_redirect",
        actionId: "redirect-decline-pr-1",
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: "pr-1",
      },
      getCardDefinitionById: noopGetDef,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(false);
    expect(result.resolvedAfterRedirect).toEqual([HOST, "other-card"]);
    expect(result.state.pendingTargetRedirects).toHaveLength(0);
    expect(result.state.log.some((l) => l.includes("decline"))).toBe(true);
  });

  it("候補外 withInstanceId は確認時にエラー", () => {
    const state = stateWithPending([makePending()]);
    expect(() =>
      applyLegalAction({
        state,
        action: {
          kind: "confirm_target_redirect",
          actionId: "redirect-confirm-pr-1",
          can: true,
          reason: "pending_target_redirect",
          actingPlayerId: ALICE,
          pendingId: "pr-1",
          originalResolvedInstanceIds: [HOST],
          redirectableInstanceId: HOST,
          candidateTokenInstanceIds: [TOKEN_A, TOKEN_B],
          sourceEffectInstanceId: "opp-magic",
          sourceEffectDefinitionId: "OPP-001",
        },
        redirectTargetReplacementInstanceId: "not-a-candidate",
        getCardDefinitionById: noopGetDef,
        getRegisteredTriggeredEffectActions: noopGetTriggered,
      })
    ).toThrow(/not in candidateTokenInstanceIds/);
  });

  it("withInstanceId 未指定の confirm はエラー", () => {
    const state = stateWithPending([makePending()]);
    expect(() =>
      applyLegalAction({
        state,
        action: {
          kind: "confirm_target_redirect",
          actionId: "redirect-confirm-pr-1",
          can: true,
          reason: "pending_target_redirect",
          actingPlayerId: ALICE,
          pendingId: "pr-1",
          originalResolvedInstanceIds: [HOST],
          redirectableInstanceId: HOST,
          candidateTokenInstanceIds: [TOKEN_A, TOKEN_B],
          sourceEffectInstanceId: "opp-magic",
          sourceEffectDefinitionId: "OPP-001",
        },
        // redirectTargetReplacementInstanceId 未指定
        getCardDefinitionById: noopGetDef,
        getRegisteredTriggeredEffectActions: noopGetTriggered,
      })
    ).toThrow(/requires redirectTargetReplacementInstanceId/);
  });

  it("別プレイヤーが解決を試みるとエラー (promptedPlayerId 不一致)", () => {
    const state = stateWithPending([makePending()]);
    expect(() =>
      applyLegalAction({
        state,
        action: {
          kind: "decline_target_redirect",
          actionId: "redirect-decline-pr-1",
          can: true,
          reason: "pending_target_redirect",
          actingPlayerId: BOB, // promptedPlayerId は ALICE
          pendingId: "pr-1",
        },
        getCardDefinitionById: noopGetDef,
        getRegisteredTriggeredEffectActions: noopGetTriggered,
      })
    ).toThrow(/promptedPlayerId/);
  });

  it("複数 pending: FIFO 先頭を消化、残りは継続して legal", () => {
    const state = stateWithPending([
      makePending({ pendingId: "pr-1" }),
      makePending({ pendingId: "pr-2", redirectableInstanceId: "host-2" }),
    ]);
    const result = applyLegalAction({
      state,
      action: {
        kind: "decline_target_redirect",
        actionId: "redirect-decline-pr-1",
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: "pr-1",
      },
      getCardDefinitionById: noopGetDef,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    expect(result.state.pendingTargetRedirects).toHaveLength(1);
    expect(result.state.pendingTargetRedirects[0]?.pendingId).toBe("pr-2");
    // 次の pending に対する legal action が出続ける
    const nextActions = getLegalActions({
      state: result.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: noopGetDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noopGetTriggered,
    });
    expect(nextActions).toHaveLength(2);
    expect(nextActions.every((a) => a.actionId.includes("pr-2"))).toBe(true);
  });

  it("不存在 pendingId はエラー", () => {
    const state = stateWithPending([makePending({ pendingId: "pr-1" })]);
    expect(() =>
      applyLegalAction({
        state,
        action: {
          kind: "decline_target_redirect",
          actionId: "redirect-decline-pr-X",
          can: true,
          reason: "pending_target_redirect",
          actingPlayerId: ALICE,
          pendingId: "pr-X",
        },
        getCardDefinitionById: noopGetDef,
        getRegisteredTriggeredEffectActions: noopGetTriggered,
      })
    ).toThrow(/Unknown pendingTargetRedirect/);
  });
});
