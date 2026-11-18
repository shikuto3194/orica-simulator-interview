import type {
  ActiveStack,
  CardDefinition,
  GameState,
  StackInteractionWindowState,
} from "../model";
import { getStackNegatePreventionLevel } from "./stack-negate";

type ResponseWindowState<TResponseSourcePlayerId extends string | null> = Omit<
  StackInteractionWindowState,
  "stackResponseSourcePlayerId"
> & {
  stackResponseSourcePlayerId: TResponseSourcePlayerId;
};

export function getResponseWindowActionTimings(options: {
  windowState: StackInteractionWindowState | null;
  actingPlayerId: string;
}): Array<"flash" | "stack"> {
  const { windowState, actingPlayerId } = options;

  if (!windowState || windowState.priorityPlayerId !== actingPlayerId) {
    return [];
  }

  if (windowState.pendingStackAction !== null) {
    return ["stack"];
  }

  return windowState.stackResponseSourcePlayerId === actingPlayerId
    ? ["flash"]
    : ["stack"];
}

export function createInitialStackWindowState(options: {
  activeStack: ActiveStack;
  actingPlayerId: string;
  opponentPlayerId: string;
}): ResponseWindowState<string> {
  return {
    priorityPlayerId: options.opponentPlayerId,
    consecutivePassCount: 0,
    stackResponseSourcePlayerId: options.actingPlayerId,
    pendingStackAction: options.activeStack,
  };
}

export function createNestedStackState<
  TResponseSourcePlayerId extends string | null,
>(options: {
  windowState: ResponseWindowState<TResponseSourcePlayerId>;
  activeStack: ActiveStack;
  actingPlayerId: string;
  opponentPlayerId: string;
}): {
  stackedAction: ActiveStack;
  nextWindowState: ResponseWindowState<string>;
} {
  const stackedAction: ActiveStack = {
    ...options.activeStack,
    previousResponseSourcePlayerId:
      options.windowState.stackResponseSourcePlayerId,
    previousPendingStackAction: options.windowState.pendingStackAction
      ? {
          ...options.windowState.pendingStackAction,
          waitForResolutionChainIds: [options.activeStack.chainId],
        }
      : null,
    previousPriorityPlayerId: options.windowState.priorityPlayerId,
  };

  return {
    stackedAction,
    nextWindowState: {
      priorityPlayerId: options.opponentPlayerId,
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: options.actingPlayerId,
      pendingStackAction: stackedAction,
    },
  };
}

export function transferResponseWindowPriority<
  TResponseSourcePlayerId extends string | null,
>(
  windowState: ResponseWindowState<TResponseSourcePlayerId>,
  nextPriorityPlayerId: string
): ResponseWindowState<string> {
  return {
    ...windowState,
    priorityPlayerId: nextPriorityPlayerId,
    // フラッシュ本体 2-pass ループでは、優先権を得たプレイヤーが新たな flash 宣言者になる。
    // stackResponseSourcePlayerId を新優先権者へ追従させないと
    // getResponseWindowActionTimings が "flash" ではなく "stack" を返し、優先権を得た側
    // (= アクティブプレイヤー) が自分の『お互いのアタックステップ』flash 効果を起動できなくなる。
    // sub-stack 解決経路 (battle-actions.ts の全 peel 後の再設定) が
    // stackResponseSourcePlayerId = 次優先権者 とするのと同じ扱い。
    stackResponseSourcePlayerId: nextPriorityPlayerId,
    consecutivePassCount: 1,
  };
}

/**
 * スタック窓内の pendingStackAction を無効化 (nullify) する。
 * 効果無効化カード (例: バタフライジャマー) の resolver が呼ぶ。
 * 無効化されたスタックは解決時に効果をスキップし、
 * magic の場合はコスト支払い済み・トラッシュ移動のみ行う。
 */
export function nullifyPendingStackAction<
  TResponseSourcePlayerId extends string | null,
>(
  windowState: ResponseWindowState<TResponseSourcePlayerId>
): ResponseWindowState<TResponseSourcePlayerId> {
  if (windowState.pendingStackAction === null) {
    throw new Error(
      "Cannot nullify: no pending stack action in current window"
    );
  }

  return {
    ...windowState,
    pendingStackAction: {
      ...windowState.pendingStackAction,
      isNullified: true,
    },
  };
}

/**
 * P3-73: ActiveStack の LIFO 鎖 (previousPendingStackAction) を辿り、
 * 指定 cardInstanceId の stack に isNullified を立てて返す。見つからなければ found=false。
 */
function nullifyActiveStackChainByCardInstance(
  stack: ActiveStack | null,
  cardInstanceId: string,
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): { stack: ActiveStack | null; found: boolean } {
  if (stack === null) {
    return { stack, found: false };
  }
  if (stack.cardInstanceId === cardInstanceId) {
    const preventionLevel = getStackNegatePreventionLevel(stack);
    if (preventionLevel === "unpreventable") {
      return { stack, found: false };
    }
    return { stack: { ...stack, isNullified: true }, found: true };
  }
  const inner = nullifyActiveStackChainByCardInstance(
    stack.previousPendingStackAction,
    cardInstanceId,
    state,
    getCardDefinitionById
  );
  if (!inner.found) {
    return { stack, found: false };
  }
  return {
    stack: { ...stack, previousPendingStackAction: inner.stack },
    found: true,
  };
}

/**
 * P3-73: 指定 cardInstanceId の保留 ActiveStack を 3 種の応答窓
 * (stackWindow / preDeclarationStackWindow / battle flash 窓) ＋ LIFO ネスト鎖から探し、
 * `isNullified=true` を立てる。咲夜 BSTH01-X05 が相手フラッシュを「発揮前に」無効化するため、
 * declare 時点で対象に印を付ける用途。窓クローズ時の resolveDeferred* が isNullified を見て
 * 効果解決をスキップ (cost 支払い済み・トラッシュ移動・usageLimit 消費は維持)。
 * 対象が見つからなければ state をそのまま返す。
 */
export function markPendingStackActionNullifiedByCardInstance(
  state: GameState,
  cardInstanceId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (state.stackWindow?.pendingStackAction) {
    const result = nullifyActiveStackChainByCardInstance(
      state.stackWindow.pendingStackAction,
      cardInstanceId,
      state,
      getCardDefinitionById
    );
    if (result.found) {
      return {
        ...state,
        stackWindow: {
          ...state.stackWindow,
          pendingStackAction: result.stack,
        },
      };
    }
  }

  if (state.preDeclarationStackWindow?.pendingStackAction) {
    const result = nullifyActiveStackChainByCardInstance(
      state.preDeclarationStackWindow.pendingStackAction,
      cardInstanceId,
      state,
      getCardDefinitionById
    );
    if (result.found) {
      return {
        ...state,
        preDeclarationStackWindow: {
          ...state.preDeclarationStackWindow,
          pendingStackAction: result.stack,
        },
      };
    }
  }

  const flashWindowState = state.activeAttack?.flashWindowState;
  if (flashWindowState?.pendingStackAction && state.activeAttack) {
    const result = nullifyActiveStackChainByCardInstance(
      flashWindowState.pendingStackAction,
      cardInstanceId,
      state,
      getCardDefinitionById
    );
    if (result.found) {
      return {
        ...state,
        activeAttack: {
          ...state.activeAttack,
          flashWindowState: {
            ...flashWindowState,
            pendingStackAction: result.stack,
          },
        },
      };
    }
  }

  // P3-86 案X: 発揮前チェックポイントでは対象フラッシュは窓でなく
  // pendingStackCascade.remainingStacks に退避している。ここも探索して印を立てる。
  if (state.pendingStackCascade) {
    const remaining = state.pendingStackCascade.remainingStacks;
    for (let i = 0; i < remaining.length; i++) {
      const result = nullifyActiveStackChainByCardInstance(
        remaining[i]!,
        cardInstanceId,
        state,
        getCardDefinitionById
      );
      if (result.found && result.stack) {
        const next = [...remaining];
        next[i] = result.stack;
        return {
          ...state,
          pendingStackCascade: {
            ...state.pendingStackCascade,
            remainingStacks: next,
          },
        };
      }
    }
  }

  return state;
}

function activeStackChainInstanceIsNullified(
  stack: ActiveStack | null,
  cardInstanceId: string
): boolean {
  let cur = stack;
  while (cur !== null) {
    if (cur.cardInstanceId === cardInstanceId) {
      return cur.isNullified === true;
    }
    cur = cur.previousPendingStackAction;
  }
  return false;
}

export function isPendingStackActionNullifiedByCardInstance(
  state: GameState,
  cardInstanceId: string
): boolean {
  if (
    activeStackChainInstanceIsNullified(
      state.stackWindow?.pendingStackAction ?? null,
      cardInstanceId
    )
  ) {
    return true;
  }
  if (
    activeStackChainInstanceIsNullified(
      state.preDeclarationStackWindow?.pendingStackAction ?? null,
      cardInstanceId
    )
  ) {
    return true;
  }
  if (
    activeStackChainInstanceIsNullified(
      state.activeAttack?.flashWindowState?.pendingStackAction ?? null,
      cardInstanceId
    )
  ) {
    return true;
  }
  return (
    state.pendingStackCascade?.remainingStacks.some((stack) =>
      activeStackChainInstanceIsNullified(stack, cardInstanceId)
    ) ?? false
  );
}

/**
 * P3-86 案X: 指定 cardInstanceId が、開いている応答窓
 * (stackWindow / preDeclarationStackWindow / battle flash 窓) の
 * 保留 ActiveStack 鎖に含まれるか (read-only)。
 * 発揮前無効化誘発を「対象フラッシュが応答窓にいる間は deferred」と判定する gating 用
 * (isDeferredFlashUsePrivateDeclaration / legal-actions-availability.ts が唯一の consumer)。
 *
 * 注意: targeted disclosure 側 (P3-131) は本関数を直接使わず
 * `isInstanceInOpenResponseWindowOrPendingCascade` を使う。本関数の意味を pass_stack
 * カスケード解決中の外側 ActiveStack まで広げると、この P3-86 gate 側の「応答窓にいる間だけ
 * deferred」という意味も変わってしまい、咲夜 (BSTH01-X05) の flash-use declare 系テストが
 * 割れる (2026-07-29 実測)。
 */
export function isInstanceInOpenResponseWindow(
  state: GameState,
  cardInstanceId: string
): boolean {
  return (
    activeStackChainContains(
      state.stackWindow?.pendingStackAction ?? null,
      cardInstanceId
    ) ||
    activeStackChainContains(
      state.preDeclarationStackWindow?.pendingStackAction ?? null,
      cardInstanceId
    ) ||
    activeStackChainContains(
      state.activeAttack?.flashWindowState?.pendingStackAction ?? null,
      cardInstanceId
    )
  );
}

/**
 * 指定 chainId が、開いている応答窓の保留 ActiveStack 鎖に含まれるか。
 * cost_payment vanish など、trigger source が stack 上のカード自身ではない private
 * declaration も、同じ stack chain の応答窓を追い越して surface させないために使う。
 * isInstanceInOpenResponseWindow と同じ理由で P3-86 gate 専用 (拡張しない)。
 */
export function isChainInOpenResponseWindow(
  state: GameState,
  chainId: string
): boolean {
  return (
    activeStackChainContainsChain(
      state.stackWindow?.pendingStackAction ?? null,
      chainId
    ) ||
    activeStackChainContainsChain(
      state.preDeclarationStackWindow?.pendingStackAction ?? null,
      chainId
    ) ||
    activeStackChainContainsChain(
      state.activeAttack?.flashWindowState?.pendingStackAction ?? null,
      chainId
    )
  );
}

/**
 * P3-131: targeted disclosure QUEUEING (ENGINE-targeted-disclosure-offfield-source /
 * native-effect-front-helpers.ts・effect-resolution.ts・effect-target-handlers.ts・
 * trigger-system.ts の SSOT family) 専用の拡張版。
 *
 * `isInstanceInOpenResponseWindow` に加えて、本物の pass_stack 解決 (1-pass close で
 * `state.stackWindow` 等を null にしてから `resolveStackCascade` の LIFO カスケードへ入る)
 * 中に「まだ解決順を待っているだけで解決自体は済んでいない」外側 ActiveStack も走査する。
 * `resolveStackCascade` は各スタック解決の直前に `pendingStackCascadeFlushGuardStacks` へ
 * 「現在解決中 + まだ解決順を待つ外側」の ActiveStack を一時的に見せている
 * (P3-97 が state-based-actions.ts の stay-on-field leave reaction 判定で使う同型パターン。
 * SSOT のため同じ一時 state field を読むだけで新規並行スキャンを避ける)。
 *
 * P3-86 の `isInstanceInOpenResponseWindow` 自体は変更しない (唯一の consumer である
 * flash-use private declaration の deferred gate の意味が変わり、咲夜 X05 系テストが
 * 割れるため。2026-07-29 実測、詳細は同関数 doc comment)。
 */
export function isInstanceInOpenResponseWindowOrPendingCascade(
  state: GameState,
  cardInstanceId: string
): boolean {
  return (
    isInstanceInOpenResponseWindow(state, cardInstanceId) ||
    (state.pendingStackCascade?.remainingStacks.some((stack) =>
      activeStackChainContains(stack, cardInstanceId)
    ) ??
      false) ||
    (state.pendingStackCascadeFlushGuardStacks?.some((stack) =>
      activeStackChainContains(stack, cardInstanceId)
    ) ??
      false)
  );
}

function activeStackChainContains(
  stack: ActiveStack | null,
  cardInstanceId: string
): boolean {
  let cur = stack;
  while (cur !== null) {
    if (cur.cardInstanceId === cardInstanceId) return true;
    cur = cur.previousPendingStackAction;
  }
  return false;
}

function activeStackChainContainsChain(
  stack: ActiveStack | null,
  chainId: string
): boolean {
  let cur = stack;
  while (cur !== null) {
    if (cur.chainId === chainId) return true;
    cur = cur.previousPendingStackAction;
  }
  return false;
}

export function peelResolvedStack<
  TResponseSourcePlayerId extends string | null,
>(options: {
  windowState: ResponseWindowState<TResponseSourcePlayerId>;
}): {
  resolvedStack: ActiveStack;
  restoredPendingStackAction: ActiveStack | null;
  restoredResponseSourcePlayerId: string | TResponseSourcePlayerId;
  restoredPriorityPlayerId: string;
} {
  const resolvedStack = options.windowState.pendingStackAction;

  if (resolvedStack === null) {
    throw new Error("Cannot peel resolved stack without pending stack action");
  }

  return {
    resolvedStack,
    restoredPendingStackAction: resolvedStack.previousPendingStackAction,
    restoredResponseSourcePlayerId:
      resolvedStack.previousResponseSourcePlayerId ??
      options.windowState.stackResponseSourcePlayerId,
    restoredPriorityPlayerId:
      resolvedStack.previousPriorityPlayerId ?? resolvedStack.actingPlayerId,
  };
}
