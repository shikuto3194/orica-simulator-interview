import type { GameState } from "./model";

/** 原因効果を持たない基本処理・ステップ遷移の発生時にだけ新しい根を作る。 */
export function allocateRootTriggerChain(state: GameState): {
  state: GameState;
  chainId: string;
} {
  // 通番も保存・同期する。同じ状態への同じ操作はGUIとサーバーで同じIDになる。
  const sequence = state.nextRootTriggerChainId;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Invalid nextRootTriggerChainId");
  }
  return {
    state: { ...state, nextRootTriggerChainId: sequence + 1 },
    chainId: `event-root-v3-${sequence}`,
  };
}

export function assertTriggerChainId(
  chainId: unknown,
  context?: string
): asserts chainId is string {
  if (typeof chainId !== "string" || chainId.trim().length === 0) {
    throw new Error(
      `Trigger chainId must be a non-empty string${context ? ` (${context})` : ""}`
    );
  }
}

export function requireTriggerChainId(chainId: unknown): string {
  assertTriggerChainId(chainId);
  return chainId;
}

type PendingChainRoot = {
  [K in keyof GameState]-?: K extends `pending${string}`
    ? NonNullable<GameState[K]> extends
        | { chainId: string }
        | readonly { chainId: string }[]
      ? K
      : never
    : never;
}[keyof GameState];

// モデルの必須 chainId を持つ待機ルートが増えたら型検査で登録漏れを検出する。
const pendingChainRoots: Record<PendingChainRoot, true> = {
  pendingTriggeredEffects: true,
  pendingDeferredTriggeredEffects: true,
  pendingPrivateDeclarations: true,
  pendingBurstChecks: true,
  pendingLeaveEntities: true,
  pendingAfterTriggersContinuations: true,
  pendingEffectCompletions: true,
  pendingGroupedSummonCostOverrideChoice: true,
  pendingBorrowedEffectChoice: true,
  pendingBorrowedEffectTargetSelection: true,
  pendingTargetedDisclosureContinuation: true,
  pendingStackCascadeFlushGuardStacks: true,
  pendingHandTrashSwapChoice: true,
  pendingFieldHandSwapChoice: true,
  pendingSplitSummonChoice: true,
  pendingChangeCleanupChoice: true,
  pendingAccelCleanups: true,
};

// 再開可能な保存文脈だけを辿る。差分計算用の過去 GameState やカード本文は辿らない。
// true はその文脈自身にも原因IDが必須、false は継続へのコンテナ。
const resolutionLinks: Readonly<Record<string, boolean>> = {
  continuation: true,
  preCostEffectContinuation: true,
  postResolutionOracle: true,
  rebirthCompletion: true,
  targetedDisclosureContinuation: true,
  previousTargetedDisclosureContinuation: true,
  handWrittenResolution: true,
  targetInterruption: true,
  effectBraveCombineAsSummon: true,
  deferredStack: true,
  declaredStack: true,
  remainingStacks: true,
  pendingStackAction: true,
  negateIdentitySnapshot: true,
  triggeredPendingSnapshot: true,
  burstPendingSnapshot: true,
  supplementalTriggerEvents: true,
  coreDistributionPending: false,
  useCostGateCoreMoveResume: false,
  effectSummon: false,
  blockedByOpponentRetry: false,
  pendingSwapOut: false,
  deckRevealResumeAfterSwapSelection: false,
  deckRevealResume: false,
  reveal: false,
  adventPreparation: false,
  deferredStackResolution: false,
  flashWindowState: false,
  coreMoveResume: false,
  lifeFillResume: false,
  lifeDamageInterception: false,
  splitSummonChoice: false,
  mirageSetChoice: false,
  pending: true,
};

export function pendingResolutionContexts(state: GameState): {
  context: Readonly<Record<string, unknown>>;
  path: string;
  requiresChain: boolean;
}[] {
  const entries: {
    context: Readonly<Record<string, unknown>>;
    path: string;
    requiresChain: boolean;
  }[] = [];
  const ancestors = new Set<object>();
  const visit = (value: unknown, path: string, requiresChain: boolean) => {
    if (value === null || typeof value !== "object" || ancestors.has(value))
      return;
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`, requiresChain));
    } else {
      const record = value as Record<string, unknown>;
      entries.push({ context: record, path, requiresChain });
      for (const [key, required] of Object.entries(resolutionLinks))
        if (record[key] !== undefined)
          visit(record[key], `${path}.${key}`, required);
    }
    ancestors.delete(value);
  };
  for (const [key, value] of Object.entries(state)) {
    if (
      key.startsWith("pending") ||
      key === "stackWindow" ||
      key === "activeAttack"
    )
      visit(value, key, key in pendingChainRoots);
  }
  return entries;
}

export function pendingTriggerChainEntries(
  state: GameState
): { chainId: unknown; path: string }[] {
  return pendingResolutionContexts(state).flatMap(
    ({ context, path, requiresChain }) => {
      const entries = requiresChain
        ? [{ chainId: context.chainId, path: `${path}.chainId` }]
        : [];
      // 本文の原因とは別の、待機対象区間のID。
      if (/^pendingAfterTriggersContinuations\[\d+\]$/.test(path))
        entries.push({
          chainId: context.waitChainId,
          path: `${path}.waitChainId`,
        });
      if (
        context.effectSummonActivationZone !== undefined ||
        "effectSummonChainId" in context
      )
        entries.push({
          chainId: context.effectSummonChainId,
          path: `${path}.effectSummonChainId`,
        });
      return entries;
    }
  );
}

export function assertPendingTriggerChainIds(state: GameState): void {
  for (const entry of pendingTriggerChainEntries(state)) {
    try {
      assertTriggerChainId(entry.chainId);
    } catch {
      throw new Error(`Invalid trigger chainId: ${entry.path}`);
    }
  }
}

/** 待機済み誘発の因果情報を推測・補修しない。 */
export function getTriggerEventChainKey(
  _state: { turnNumber: number; step: string },
  event: { chainId: string | null; attackId: string | null }
): string {
  assertTriggerChainId(event.chainId);
  return event.chainId;
}

/**
 * `candidate` chain is `ownerChainId` itself or a descendant chain.
 *
 * Trigger pending IDs embed the parent chainId verbatim, then resolution wraps
 * them as `trigger:${pendingId}`. Descendant chain strings therefore contain
 * the parent chainId on `:` boundaries, even when it is not a prefix.
 */
export function isChainAtOrUnder(
  candidate: string,
  ownerChainId: string
): boolean {
  return (
    candidate === ownerChainId ||
    candidate.startsWith(`${ownerChainId}:`) ||
    candidate.includes(`:${ownerChainId}:`) ||
    candidate.endsWith(`:${ownerChainId}`)
  );
}
