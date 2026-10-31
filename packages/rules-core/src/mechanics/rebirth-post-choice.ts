import type {
  GameState,
  PendingRebirthCompletion,
  RebirthAction,
} from "../model";

let rebirthPostChoiceSequence = 0;

export function nextRebirthPostChoicePendingId(prefix = "rebirth-post-choice") {
  return `${prefix}-${rebirthPostChoiceSequence++}`;
}

export function createDeferredPostChoiceRebirthAction(
  action: RebirthAction
): RebirthAction {
  const { postRebirthChoice: _postRebirthChoice, ...rest } = action;
  return {
    ...rest,
    // pending は通信/保存をまたぐ。Infinity は JSON で null になるため有限値で保持する。
    maxCount:
      action.maxCount === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : action.maxCount,
    skipBackFaceLvDeficitForPostChoice: true,
    deferRebirthCompletionUntilPostChoice: true,
  };
}

export function createPostChoiceRebirthCompletion(options: {
  action: RebirthAction;
  sourceInstanceId: string;
  actingPlayerId: string;
  chainId: string;
  rebirthTimingWindowId?: string;
}): PendingRebirthCompletion {
  return {
    sourceInstanceId: options.sourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    chainId: options.chainId,
    deferredAction: createDeferredPostChoiceRebirthAction(options.action),
    ...(options.action.countBonusMode !== undefined
      ? { countBonusMode: options.action.countBonusMode }
      : {}),
    ...(options.rebirthTimingWindowId !== undefined
      ? { rebirthTimingWindowId: options.rebirthTimingWindowId }
      : {}),
  };
}

/**
 * 転醒に内蔵された「このとき」選択が未確定の間は、実カードはまだ A 面の仮想転醒として扱う。
 * SBA / 解決継続判定が参照する軽量 SSOT。
 */
export function isAwaitingRebirthPostChoice(options: {
  state: GameState;
  instanceId: string;
}): boolean {
  if (
    options.state.pendingStoneFlipCombine?.braveInstanceId ===
    options.instanceId
  ) {
    return true;
  }
  const pendingCore = options.state.pendingCoreDistribution;
  return Boolean(
    pendingCore?.rebirthCompletion?.deferredAction &&
    pendingCore.rebirthCompletion.sourceInstanceId === options.instanceId
  );
}
