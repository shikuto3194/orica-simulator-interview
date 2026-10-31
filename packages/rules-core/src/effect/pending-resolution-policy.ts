import type { ContinuousEffect, GameState } from "../model";

type PendingPhase =
  | "input"
  | "rollback-input"
  | "context"
  | "cascade"
  | "trigger"
  | "completion"
  | "battle-context"
  | "outside";

/**
 * 効果本文の中断・完了・発揮後処理が参照する待機状態の正源。
 * input は本文の入力待ち、rollback-input は取消用snapshotを持つ入力待ち。
 * context は解決側が保持する外側の文脈。
 * context を本文の停止条件にすると、その文脈の内側を実行できなくなる。
 * cascade は残りスタックの退避であり、個々の効果の発揮後処理は止めない。
 * trigger は誘発待機列・収集前イベント・観測履歴、completion は呼出し元が確定した完了通知。
 * いずれも本文を止めず、選択中止で盤面を戻してもスケジューラの進行を保持する。
 * outside は盤面や離脱・宣言・ステップ等の別段階（本文を止めない）。
 * GameState の全フィールドを分類する。pendingという名前でない待機列も省略しない。
 * フィールド追加時は、ここで本文の停止条件と中止時の保持要否を必ず判断する。
 */
const resolutionStatePhases = {
  viewerLegalActions: "outside",
  semanticTriggerSequence: "trigger",
  semanticTriggerEvents: "trigger",
  nextRootTriggerChainId: "trigger",
  stepSequence: "outside",
  turnNumber: "outside",
  activePlayerId: "outside",
  playerOrder: "outside",
  step: "outside",
  window: "outside",
  players: "outside",
  cardInstances: "outside",
  zoneCountMode: "outside",
  battleEntities: "outside",
  activeAttack: "battle-context",
  stackWindow: "outside",
  preDeclarationStackWindow: "outside",
  battleResolutionGroup: "outside",
  battleImmediateEffects: "trigger",
  burstSetPlayerIdsThisTurn: "outside",
  setBurstStates: "outside",
  revealedBurstStates: "outside",
  mirageSetStates: "outside",
  mirageSetPlayerIdsThisTurn: "outside",
  mirageSetCountExemptionsUsed: "outside",
  quartzSetStates: "outside",
  usedDivineSkillKeysThisTurn: "outside",
  usedTrashAdventKeysThisTurn: "outside",
  usedAlternateCostAdventKeysThisTurn: "outside",
  usedAdventDeclareKeysThisTurn: "outside",
  countGainModifierConsumedThisTurn: "outside",
  usedTaplessBattleDeclareInstanceIdsThisTurn: "outside",
  reverseRebirthBraveSeparationExhaustSnapshots: "outside",
  activeContinuousEffects: "outside",
  effectUsageRecords: "outside",
  effectOccurrenceRecords: "trigger",
  effectQueueEntries: "outside",
  effectQueueSummary: "outside",
  publicDisclosures: "outside",
  knownDeckCards: "outside",
  illegalBurstRevealPlayerId: "outside",
  gameResult: "outside",
  resolvedRebirthTimingWindowIds: "outside",
  log: "outside",
  actionStartLogIndex: "outside",
  effectLifeReductionThisTurn: "outside",
  declarationCountThisTurn: "outside",
  lifeReductionCappedThisTurn: "outside",
  filteredLifeReductionCappedThisTurn: "outside",
  bpThresholdCappedLifeReductionThisTurn: "outside",
  declareGimmickGateUsedThisTurn: "outside",
  lifeDamageInterceptionUseCostGateUsedThisTurn: "outside",
  symbolAdditionRestrictedCountThisTurn: "outside",
  battlesEndedThisTurn: "outside",
  battlesEndedThisAttackStep: "outside",
  summonedDuringAttackStepInstanceIds: "outside",
  pendingImmediateAttackJoins: "outside",
  turnSummonedCardRefs: "trigger",
  flashCardUsageLog: "trigger",
  flashEffectActivationLog: "outside",
  attackDeclarationLog: "outside",
  mirageSetDrawLog: "outside",
  preGame: "outside",
  roomReset: "outside",
  extraTurnState: "outside",
  pendingPreDeclarationConfirmation: "outside",
  pendingAdditionalAttackGrants: "outside",
  pendingTriggeredEffects: "trigger",
  pendingPrivateDeclarations: "trigger",
  pendingDeferredTriggeredEffects: "trigger",
  pendingBurstChecks: "trigger",
  pendingLeaveEntities: "outside",
  pendingBraveLeaveChoice: "outside",
  pendingBraveAttackContinuation: "outside",
  pendingSoulStateReplacement: "outside",
  pendingAdventSourceReplacement: "outside",
  pendingSetAsideExitReplacementChoice: "input",
  pendingStoneFlipCombine: "rollback-input",
  pendingDeckReveal: "input",
  pendingTrashOptionalAdds: "outside",
  pendingZoneSelection: "input",
  pendingStepOptionalChoice: "input",
  pendingStepChoice: "input",
  pendingDeckRevealCountBoostChoice: "input",
  pendingStepOptionalTargetSelection: "input",
  pendingAfterTriggersContinuations: "context",
  pendingEffectCompletions: "completion",
  pendingRetriggerContinuations: "trigger",
  pendingDeckRevealSwapChain: "outside",
  pendingDrawStepCostChoice: "outside",
  pendingSummonCostExcludeChoice: "outside",
  pendingSummonCostCoreMoveChoice: "outside",
  pendingGroupedSummonCostOverrideChoice: "input",
  pendingLifeDamageDiscardChoice: "input",
  pendingLifeGainReplacementChoice: "input",
  pendingCoreShootSelection: "input",
  pendingEffectTargetSelection: "context",
  pendingAsIfSoulCoreChoice: "input",
  pendingEffectOptionalRepeatChoice: "input",
  pendingEffectOptionalRepeatCountSelection: "input",
  pendingBorrowedEffectChoice: "input",
  pendingBorrowedEffectTargetSelection: "input",
  pendingTargetedDisclosureContinuation: "context",
  pendingPayToActCoreGate: "context",
  pendingPayToActHandDiscardGate: "context",
  pendingFieldMagicPreCostTrigger: "outside",
  pendingEnterFieldPlacement: "input",
  pendingStackCascade: "cascade",
  pendingStackCascadeFlushGuardStacks: "outside",
  pendingStackNegateRequests: "outside",
  pendingBraveCombineChoice: "rollback-input",
  pendingHandTrashSwapChoice: "input",
  pendingFieldHandSwapChoice: "input",
  pendingTenshoSummon: "input",
  pendingReverseRebirthSummon: "input",
  pendingCoreSplitSelection: "input",
  pendingSplitSummonChoice: "input",
  pendingCoreCountSelection: "input",
  pendingCountSelection: "input",
  pendingDiscardSetBurstCountSelection: "input",
  pendingLifeCoreSelection: "input",
  pendingCoreSourceAllocation: "input",
  pendingEffectSummonCostPayment: "input",
  pendingLinkAidCostSourceChoice: "input",
  pendingCoreDistribution: "rollback-input",
  pendingMultiPlacement: "rollback-input",
  pendingTargetRedirects: "input",
  pendingChangeCleanupChoice: "input",
  pendingAccelCleanups: "completion",
  pendingBattleEndDeferrals: "outside",
  pendingTurnEndExhaustDowngrades: "outside",
  pendingImmediateBattleEnds: "outside",
  pendingConnectBattleDecision: "outside",
  pendingAttackStepEndFinalizations: "outside",
  pendingTurnEndFinalizations: "outside",
  pendingBattleEndFinalizeAttackIds: "outside",
  pendingResolutionEndLogs: "completion",
  pendingDrawEvents: "trigger",
  pendingPromptLock: "outside",
  pendingExtraSteps: "outside",
  stepContinuation: "outside",
  turnNumberHighWaterMark: "outside",
  pendingExtraTurn: "outside",
  pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds: "outside",
  pendingTurnSkips: "outside",
} as const satisfies Record<keyof GameState, PendingPhase>;

const entries = Object.entries(resolutionStatePhases) as [
  keyof GameState,
  PendingPhase,
][];

type RollbackInputKey = {
  [K in keyof typeof resolutionStatePhases]: (typeof resolutionStatePhases)[K] extends "rollback-input"
    ? K
    : never;
}[keyof typeof resolutionStatePhases];

export function hasPendingEffectResolution(
  state: GameState,
  phase: "body" | "effect" | "all" = "effect"
): boolean {
  return entries.some(([key, category]) => {
    if (
      category === "outside" ||
      category === "trigger" ||
      category === "completion" ||
      category === "battle-context" ||
      (category === "context" && phase === "body") ||
      (category === "cascade" && phase !== "all")
    )
      return false;
    const value = state[key];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
}

/**
 * 盤面の巻き戻しは、呼出し元が後から行った誘発の消費・再登録を巻き戻さない。
 * 確定済み前段の派生も同じ本文の原因IDを持つため、原因の内外では除去しない。
 * 未確定の召喚/転醒は確定境界まで誘発を生成しない（場入り収集側の責務）。
 * 完了通知も保持し、既存の安定点で派生を先に解決してから一度だけ通知する。
 */
export function restorePendingSchedulingAfterRollback(
  snapshot: GameState,
  current: GameState
): GameState {
  const restored = { ...snapshot };
  for (const [key, category] of entries) {
    if (category === "battle-context") {
      // 同じアタックの盤面・進行段階はsnapshotのまま、誘発済み記録だけ保持する。
      // 条件が再成立した際に、既解決の攻撃時/ブロック時を再生成させない。
      if (
        restored.activeAttack &&
        current.activeAttack?.attackId === restored.activeAttack.attackId
      ) {
        const {
          immediateTimingSources: _snapshotSources,
          immediateTimingReactionGroups: _snapshotGroups,
          ...attack
        } = restored.activeAttack;
        restored.activeAttack = {
          ...attack,
          ...(current.activeAttack.immediateTimingSources !== undefined
            ? {
                immediateTimingSources:
                  current.activeAttack.immediateTimingSources,
              }
            : {}),
          ...(current.activeAttack.immediateTimingReactionGroups !== undefined
            ? {
                immediateTimingReactionGroups:
                  current.activeAttack.immediateTimingReactionGroups,
              }
            : {}),
        };
      }
      continue;
    }
    if (key === "semanticTriggerEvents") {
      // Keep committed delivery receipts, but discard tentative operations that
      // belong to the cancelled board transition. Retain snapshot facts still pending.
      const committed = (current.semanticTriggerEvents ?? []).filter(
        (e) => e.delivered
      );
      const committedIds = new Set(committed.map((e) => e.semanticEventId));
      restored.semanticTriggerEvents = [
        ...committed,
        ...(snapshot.semanticTriggerEvents ?? []).filter(
          (e) => !committedIds.has(e.semanticEventId)
        ),
      ];
      continue;
    }
    if (category !== "trigger" && category !== "completion") continue;
    Object.assign(restored, { [key]: current[key] });
  }
  return restored;
}

/**
 * 確定済みイベントによるCEの回数消費・失効は、取消用snapshotにも同時に確定する。
 * 現在のCEが消えた理由を復元時に推測しない。ゾーン等の盤面由来の失効では呼ばず、
 * その場合はsnapshotのCEを通常通り復元する。変換は純粋関数で渡す。
 */
export function updateCommittedContinuousEffects(
  state: GameState,
  update: (effects: ContinuousEffect[]) => ContinuousEffect[]
): GameState {
  const visited = new Map<GameState, GameState>();
  const visit = (current: GameState): GameState => {
    const known = visited.get(current);
    if (known) return known;
    const restored = {
      ...current,
      activeContinuousEffects: update(current.activeContinuousEffects),
    };
    visited.set(current, restored);
    let changed =
      restored.activeContinuousEffects !== current.activeContinuousEffects;
    for (const [key, category] of entries) {
      if (category !== "rollback-input") continue;
      const pending = current[key] as GameState[RollbackInputKey];
      if (!pending) continue;
      // 合体しない選択から複数配置へ渡される、召喚前の取消用状態。
      if (
        "effectSummon" in pending &&
        pending.effectSummon?.triggerBeforeState
      ) {
        const snapshot = visit(pending.effectSummon.triggerBeforeState);
        if (snapshot !== pending.effectSummon.triggerBeforeState) {
          changed = true;
          Object.assign(restored, {
            [key]: {
              ...pending,
              effectSummon: {
                ...pending.effectSummon,
                triggerBeforeState: snapshot,
              },
            },
          });
        }
      }
      // 転醒の合体/コア選択も、後からコア配置の取消へ同じ状態を渡す。
      if (!("priorStateSnapshot" in pending) || !pending.priorStateSnapshot)
        continue;
      const snapshot = visit(pending.priorStateSnapshot);
      if (snapshot === pending.priorStateSnapshot) continue;
      changed = true;
      Object.assign(restored, {
        [key]: { ...pending, priorStateSnapshot: snapshot },
      });
    }
    const result = changed ? restored : current;
    visited.set(current, result);
    return result;
  };
  return visit(state);
}
