import { describe, expect, it } from "vitest";
import { createEmptyGameState, maskPendingPromptsForViewer } from "../src";
import type {
  GameState,
  PendingZoneSelection,
  PendingTargetRedirect,
  PendingCoreDistribution,
  PendingHandTrashSwapChoice,
  PendingFieldHandSwapChoice,
} from "../src";

/**
 * maskPendingPromptsForViewer: viewer 視点の UI 表示用に「解決者でない pending UI prompt」を
 * null 化 / フィルタする回帰テスト。
 *
 * バグ: 非解決者クライアントが共有 pending を直接読むと、相手の対象選択中に自分の手札が
 * 自動展開する / 勝手にコア配分・配置モードに入る、等の連動バグになっていた。
 */
function baseState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

function zoneSelectionFor(actingPlayerId: string): PendingZoneSelection {
  return {
    pendingId: "zs-1",
    actingPlayerId,
    sourceInstanceId: "s-1",
    sourceDefinitionId: "def-1",
    actionKind: "search_deck",
    sourceZone: "hand",
    candidateCardInstanceIds: [],
    maxCount: 1,
    destination: "trash",
    remainingActions: [],
    effectTiming: { kind: "phase", step: "main" },
  };
}

describe("maskPendingPromptsForViewer", () => {
  it("解決者本人の viewer には pending を残す", () => {
    const state = baseState();
    state.pendingZoneSelection = zoneSelectionFor("alice");
    const masked = maskPendingPromptsForViewer(state, "alice");
    expect(masked.pendingZoneSelection).not.toBeNull();
    expect(masked.pendingZoneSelection?.pendingId).toBe("zs-1");
  });

  it("非解決者の viewer には pending を null 化する", () => {
    const state = baseState();
    state.pendingZoneSelection = zoneSelectionFor("alice");
    const masked = maskPendingPromptsForViewer(state, "bob");
    expect(masked.pendingZoneSelection).toBeNull();
  });

  it("観戦者 (viewer=null) には全 pending prompt を null 化する", () => {
    const state = baseState();
    state.pendingZoneSelection = zoneSelectionFor("alice");
    const masked = maskPendingPromptsForViewer(state, null);
    expect(masked.pendingZoneSelection).toBeNull();
  });

  it("配列 pending (pendingTargetRedirects) は FIFO 先頭の現在 resolver にだけ残す", () => {
    const state = baseState();
    const mk = (id: string, who: string): PendingTargetRedirect => ({
      pendingId: id,
      redirectEffectId: "eff",
      promptedPlayerId: who,
      sourceEffectInstanceId: "src",
      sourceEffectDefinitionId: "def",
      originalResolvedInstanceIds: ["t"],
      redirectableInstanceId: "t",
      candidateTokenInstanceIds: ["tok"],
    });
    state.pendingTargetRedirects = [mk("r-alice", "alice"), mk("r-bob", "bob")];
    const forAlice = maskPendingPromptsForViewer(state, "alice");
    expect(forAlice.pendingTargetRedirects.map((r) => r.pendingId)).toEqual([
      "r-alice",
    ]);
    const forBob = maskPendingPromptsForViewer(state, "bob");
    expect(forBob.pendingTargetRedirects).toEqual([]);
  });

  it("pendingTargetRedirects は承諾後の候補選択者に FIFO 先頭だけ残す", () => {
    const state = baseState();
    state.pendingTargetRedirects = [
      {
        pendingId: "r-alice-to-bob",
        redirectEffectId: "eff",
        promptedPlayerId: "alice",
        candidateChooserPlayerId: "bob",
        decisionConfirmed: true,
        sourceEffectInstanceId: "src",
        sourceEffectDefinitionId: "def",
        originalResolvedInstanceIds: ["t"],
        redirectableInstanceId: "t",
        candidateTokenInstanceIds: ["tok"],
      },
      {
        pendingId: "r-bob",
        redirectEffectId: "eff-2",
        promptedPlayerId: "bob",
        sourceEffectInstanceId: "src",
        sourceEffectDefinitionId: "def",
        originalResolvedInstanceIds: ["u"],
        redirectableInstanceId: "u",
        candidateTokenInstanceIds: ["tok-2"],
      },
    ];

    const forAlice = maskPendingPromptsForViewer(state, "alice");
    expect(forAlice.pendingTargetRedirects).toEqual([]);

    const forBob = maskPendingPromptsForViewer(state, "bob");
    expect(forBob.pendingTargetRedirects.map((r) => r.pendingId)).toEqual([
      "r-alice-to-bob",
    ]);
  });

  it("元 state を破壊しない (純粋関数)", () => {
    const state = baseState();
    state.pendingZoneSelection = zoneSelectionFor("alice");
    maskPendingPromptsForViewer(state, "bob");
    expect(state.pendingZoneSelection).not.toBeNull();
  });

  /**
   * P3-79: pendingCoreDistribution (BSTH01-M01 のトラッシュ→フィールドコア配分等)
   * は actingPlayerId !== viewerPlayerId のとき null 化される必要がある。
   * 非解決者の viewer がコア配置モーダルを見てしまう連動バグ (2026-06-01 報告) の回帰ガード。
   */
  it("pendingCoreDistribution は actingPlayerId !== viewer で null 化される", () => {
    const state = baseState();
    const dist: PendingCoreDistribution = {
      pendingId: "cd-1",
      actingPlayerId: "bob",
      sourceInstanceId: "src",
      sourceDefinitionId: "BSTH01-M01",
      candidates: [],
      fromKind: "trash",
      minTotal: 3,
      totalNormalCores: 3,
      hasSoulCore: true,
      mustPlaceSoulCore: true,
      fromPlayerId: "bob",
      toPlayerId: "bob",
      effectTiming: { kind: "phase", step: "attack", subPhase: "start" },
    };
    state.pendingCoreDistribution = dist;
    const forBob = maskPendingPromptsForViewer(state, "bob");
    expect(forBob.pendingCoreDistribution).not.toBeNull();
    expect(forBob.pendingCoreDistribution?.pendingId).toBe("cd-1");
    const forAlice = maskPendingPromptsForViewer(state, "alice");
    expect(forAlice.pendingCoreDistribution).toBeNull();
  });

  it("pendingTargetRedirects が先頭なら lower priority の pendingCoreDistribution を隠す", () => {
    const state = baseState();
    state.pendingTargetRedirects = [
      {
        pendingId: "redirect-alice",
        redirectEffectId: "eff",
        promptedPlayerId: "alice",
        sourceEffectInstanceId: "src",
        sourceEffectDefinitionId: "def",
        originalResolvedInstanceIds: ["t"],
        redirectableInstanceId: "t",
        candidateTokenInstanceIds: ["tok"],
      },
    ];
    state.pendingCoreDistribution = {
      pendingId: "cd-1",
      actingPlayerId: "bob",
      sourceInstanceId: "src",
      sourceDefinitionId: "BSTH01-M01",
      candidates: [],
      fromKind: "trash",
      minTotal: 3,
      totalNormalCores: 3,
      hasSoulCore: true,
      mustPlaceSoulCore: true,
      fromPlayerId: "bob",
      toPlayerId: "bob",
      effectTiming: { kind: "phase", step: "attack", subPhase: "start" },
    };

    const forAlice = maskPendingPromptsForViewer(state, "alice");
    expect(forAlice.pendingTargetRedirects).toHaveLength(1);
    expect(forAlice.pendingCoreDistribution).toBeNull();

    const forBob = maskPendingPromptsForViewer(state, "bob");
    expect(forBob.pendingTargetRedirects).toEqual([]);
    expect(forBob.pendingCoreDistribution).toBeNull();
  });

  /**
   * engine-atomic-hand-trash-swap-legal-action (BSTH02.7-TR02(B)):
   * pendingHandTrashSwapChoice には解決者本人の手札/手元 instanceId が
   * candidate として載る。非解決者 viewer に漏らすと相手が自分の
   * 手札/手元候補カードを推測できてしまう情報漏洩になる。
   */
  it("pendingHandTrashSwapChoice は actingPlayerId !== viewer で null 化される", () => {
    const state = baseState();
    const swap: PendingHandTrashSwapChoice = {
      pendingId: "hts-1",
      actingPlayerId: "bob",
      sourceInstanceId: "src",
      sourceDefinitionId: "BSTH02.7-TR02(B)",
      outgoingCandidateInstanceIds: ["hand-card-1"],
      incomingCandidateInstanceIds: ["trash-card-1"],
    };
    state.pendingHandTrashSwapChoice = swap;
    const forBob = maskPendingPromptsForViewer(state, "bob");
    expect(forBob.pendingHandTrashSwapChoice).not.toBeNull();
    expect(forBob.pendingHandTrashSwapChoice?.pendingId).toBe("hts-1");
    const forAlice = maskPendingPromptsForViewer(state, "alice");
    expect(forAlice.pendingHandTrashSwapChoice).toBeNull();
  });

  it("pendingFieldHandSwapChoice は actingPlayerId !== viewer で null 化される", () => {
    const state = baseState();
    const swap: PendingFieldHandSwapChoice = {
      pendingId: "fhs-1",
      actingPlayerId: "bob",
      sourceInstanceId: "src",
      sourceDefinitionId: "BSSG02-C01",
      incomingCandidateInstanceIds: ["hand-card-1"],
      enterRecovered: true,
    };
    state.pendingFieldHandSwapChoice = swap;
    const forBob = maskPendingPromptsForViewer(state, "bob");
    expect(forBob.pendingFieldHandSwapChoice).not.toBeNull();
    expect(forBob.pendingFieldHandSwapChoice?.pendingId).toBe("fhs-1");
    const forAlice = maskPendingPromptsForViewer(state, "alice");
    expect(forAlice.pendingFieldHandSwapChoice).toBeNull();
  });
});
