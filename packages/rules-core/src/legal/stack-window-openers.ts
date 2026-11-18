// Stack window opener + response-window player lookup helpers extracted from
// legal-actions-apply.ts (god-file decomposition, phase 1 / cluster A+B).
// Pure helpers: no dependency on the parent module's internals.

import type { ActiveStack, CardDefinition, GameState, Window } from "../model";

import {
  createInitialStackWindowState,
  createNestedStackState,
} from "../stack/stack-window-shared";

import { applyBurstActivationImmunity } from "../effect/trigger-system";

import { getCardById } from "../card/card-lookup";
import { markBurstActivationEstablished } from "../mechanics/burst-system";

export function getBattleFlashOpponentPlayerId(
  state: GameState,
  actingPlayerId: string
): string {
  const activeAttack = state.activeAttack;

  if (activeAttack?.target.kind === "player") {
    if (actingPlayerId === activeAttack.target.playerId) {
      return state.activePlayerId;
    }

    return activeAttack.target.playerId;
  }

  const actingPlayerIndex = state.playerOrder.indexOf(actingPlayerId);

  if (actingPlayerIndex === -1 || state.playerOrder.length < 2) {
    throw new Error("Cannot resolve battle flash opponent player");
  }

  const opponentPlayerId =
    state.playerOrder[(actingPlayerIndex + 1) % state.playerOrder.length];

  if (!opponentPlayerId) {
    throw new Error("Cannot resolve battle flash opponent player");
  }

  return opponentPlayerId;
}

export function getNonActingPlayerId(
  state: GameState,
  actingPlayerId: string
): string {
  const opponentPlayerId = state.playerOrder.find(
    (id) => id !== actingPlayerId
  );

  if (!opponentPlayerId) {
    throw new Error("Cannot resolve opposing player");
  }

  return opponentPlayerId;
}

/**
 * `openStackWindow` / `openBurstActivationStackWindow` 共通の新規 stack window 構築本体
 * (P3-113 スライス3)。両者は「新規 stack window を開く」という意味論は完全に同一で、
 * `burstWindowKind`（`null` = 通常 / `"activation"` = バースト発動2段階窓の第1段階）と
 * ログラベルだけが異なる歴史的重複だったため、本体をここへ集約する。
 */
function buildNewStackWindow(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string,
  burstWindowKind: "activation" | null,
  logLabel: string
): GameState {
  const opponentPlayerId = getNonActingPlayerId(state, actingPlayerId);

  state.log.push(
    `${logLabel}:${activeStack.stackId}:${actingPlayerId}:${opponentPlayerId}`
  );
  return {
    ...state,
    window: "stack",
    stackWindow: {
      actingPlayerId,
      previousWindow: state.window,
      subStackEverOpened: false,
      burstWindowKind,
      ...createInitialStackWindowState({
        activeStack,
        actingPlayerId,
        opponentPlayerId,
      }),
    },
  };
}

/**
 * 効果発揮宣言の汎用 stack window を開く（ステップ非依存）。
 *
 * P3-34: 旧 `openInitialMainStepStackWindow`。step / activePlayer ガードを撤廃し、
 * start / draw / core / refresh / main / end のいずれでも、誘発効果発揮 / 召喚 /
 * 効果使用 / バースト発動の宣言から呼び出せる。
 *
 * 呼び出し側で「窓を開いて良い文脈か」（例: main step での自由行動 vs 非 main での誘発）
 * を判断したうえでこの関数を呼ぶ。
 */
export function openStackWindow(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string
): GameState {
  return buildNewStackWindow(
    state,
    activeStack,
    actingPlayerId,
    null,
    "stack:open"
  );
}

export function openBurstActivationStackWindow(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string
): GameState {
  // バースト発動者は active player とは限らない (相手ターン中のバーストなど)。
  // バースト発動は step に関係なく 2 段階の対抗窓を持つ。
  return buildNewStackWindow(
    state,
    activeStack,
    actingPlayerId,
    "activation",
    "stack:burst-activation:open"
  );
}

// バースト効果発揮宣言スタック窓を開く
// 発動宣言窓でサブスタックが使われなかった場合のみ呼ばれる
export function openBurstEffectDeclarationStackWindow(
  state: GameState,
  burstActivationStack: ActiveStack,
  actingPlayerId: string,
  previousWindow: Window,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const opponentPlayerId = getNonActingPlayerId(state, actingPlayerId);
  // 効果発揮宣言専用の stackId を付与 (chainId は共通)
  const effectDeclStack: ActiveStack = {
    ...burstActivationStack,
    stackId: `${burstActivationStack.stackId}:effect-decl`,
    burstEffectDeclared: true,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  // 発動成立時点でセット中ではなくなる。通常は activation 窓クローズ時に
  // 除去済みだが、旧経路 / テスト直呼びのため idempotent に保険を残す。
  const stateAfterActivation = markBurstActivationEstablished({
    getCardDefinitionById,
    state,
    activeStack: burstActivationStack,
  });

  // P3-77 節②: 効果発揮宣言窓を開く = 発動成立。ここから card+controller に相手効果耐性を付与する。
  // 解決後 (useResolvePendingBurstCheckAsAction) に除去。冪等のため二重登録されない。
  const stateWithImmunity = burstActivationStack.burstCheckId
    ? applyBurstActivationImmunity(
        stateAfterActivation,
        burstActivationStack.burstCheckId,
        getCardDefinitionById
      ).state
    : stateAfterActivation;

  return {
    ...stateWithImmunity,
    window: "stack",
    stackWindow: {
      actingPlayerId,
      previousWindow,
      subStackEverOpened: false,
      burstWindowKind: "effect_declaration",
      priorityPlayerId: opponentPlayerId,
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: actingPlayerId,
      pendingStackAction: effectDeclStack,
    },
    log: [
      ...stateWithImmunity.log,
      `stack:burst-effect-decl:open:${effectDeclStack.stackId}:${actingPlayerId}:${opponentPlayerId}`,
    ],
  };
}

export function openStackSubWindowInStack(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string
): GameState {
  const win = state.stackWindow;

  if (!win || state.window !== "stack") {
    return state;
  }

  const opponentPlayerId = getNonActingPlayerId(state, actingPlayerId);
  const { stackedAction, nextWindowState } = createNestedStackState({
    windowState: win,
    activeStack,
    actingPlayerId,
    opponentPlayerId,
  });

  state.log.push(
    `stack:sub:open:${stackedAction.stackId}:${actingPlayerId}:${opponentPlayerId}`
  );
  return {
    ...state,
    stackWindow: {
      ...win,
      ...nextWindowState,
      subStackEverOpened: true,
    },
  };
}

export function openStackSubWindow(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string
): GameState {
  const activeAttack = state.activeAttack;
  const flashWindowState = activeAttack?.flashWindowState;

  if (
    !activeAttack ||
    !flashWindowState ||
    (state.window !== "flash_before_block" &&
      state.window !== "flash_after_block" &&
      state.window !== "stack_before_block" &&
      state.window !== "stack_after_block")
  ) {
    return state;
  }

  const opponentPlayerId = getBattleFlashOpponentPlayerId(
    state,
    actingPlayerId
  );
  const stackWindow =
    flashWindowState.kind === "before_block"
      ? "stack_before_block"
      : "stack_after_block";
  const { stackedAction, nextWindowState } = createNestedStackState({
    windowState: flashWindowState,
    activeStack,
    actingPlayerId,
    opponentPlayerId,
  });

  state.log.push(
    `battle:flash:stack:open:${stackedAction.stackId}:${actingPlayerId}:${opponentPlayerId}:${activeAttack.attackId}`
  );
  return {
    ...state,
    window: stackWindow,
    activeAttack: {
      ...activeAttack,
      flashWindowState: {
        ...flashWindowState,
        ...nextWindowState,
      },
    },
  };
}

/**
 * 効果の解決中に別の「使用」を宣言したとき、その使用前反応を受け付ける窓を開く。
 *
 * 通常の legal action は呼び出し元が既存の窓種別を把握しているが、効果本文の
 * `treatAsMagicUse` は battle-immediate / 通常 stack / pre-declaration のいずれからも
 * 到達する。既存窓を壊さずネストし、どの窓にも属さない即時効果からは新規 stack
 * window を開く。これにより「ただちに使用する」マジックも宣言後・効果発揮前の
 * 反応機会を失わない。
 */
export function openEffectUseResponseWindow(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string
): GameState {
  if (state.stackWindow !== null && state.window === "stack") {
    return openStackSubWindowInStack(state, activeStack, actingPlayerId);
  }
  if (state.preDeclarationStackWindow !== null) {
    return openPreDeclarationStackSubWindow(state, activeStack, actingPlayerId);
  }
  if (state.activeAttack?.flashWindowState !== null && state.activeAttack) {
    const nested = openStackSubWindow(state, activeStack, actingPlayerId);
    if (nested !== state) return nested;
  }
  return openStackWindow(state, activeStack, actingPlayerId);
}

export function openPreDeclarationStackSubWindow(
  state: GameState,
  activeStack: ActiveStack,
  actingPlayerId: string
): GameState {
  const win = state.preDeclarationStackWindow;

  if (!win || state.window !== "pre_declaration_stack") {
    return state;
  }

  const opponentId = state.playerOrder.find((id) => id !== actingPlayerId)!;
  const { stackedAction, nextWindowState } = createNestedStackState({
    windowState: win,
    activeStack,
    actingPlayerId,
    opponentPlayerId: opponentId,
  });

  state.log.push(
    `pre-declaration:sub-stack:open:${stackedAction.stackId}:${actingPlayerId}:${opponentId}`
  );
  return {
    ...state,
    preDeclarationStackWindow: {
      ...win,
      ...nextWindowState,
    },
  };
}

export function getPrimaryAttackSourceInstanceId(
  state: GameState
): string | null {
  const activeAttack = state.activeAttack;

  if (!activeAttack) {
    return null;
  }

  const primaryBattleEntity = state.battleEntities.find(
    (battleEntity) => battleEntity.entityId === activeAttack.primaryEntityId
  );

  return primaryBattleEntity?.memberInstanceIds[0] ?? null;
}

export function getCurrentAttackDefendingPlayerId(
  state: GameState
): string | null {
  const activeAttack = state.activeAttack;

  if (!activeAttack) {
    return null;
  }

  if (activeAttack.target.kind === "player") {
    return activeAttack.target.playerId;
  }

  const targetInstanceId = activeAttack.designatedTargetInstanceId;

  if (!targetInstanceId) {
    return null;
  }

  const targetCard = getCardById(state, targetInstanceId);

  // Reverse rebirth replaces the instance ID. The declared attack still belongs
  // to the active player's opponent after the old target disappears.
  return (
    targetCard?.controllerPlayerId ??
    getResponseWindowOpponentId(state, state.activePlayerId)
  );
}

export function getResponseWindowOpponentId(
  state: GameState,
  actingPlayerId: string
): string {
  const actingPlayerIndex = state.playerOrder.indexOf(actingPlayerId);

  if (actingPlayerIndex === -1 || state.playerOrder.length < 2) {
    throw new Error("Cannot resolve response-window opponent player");
  }

  const opponentPlayerId =
    state.playerOrder[(actingPlayerIndex + 1) % state.playerOrder.length];

  if (!opponentPlayerId) {
    throw new Error("Cannot resolve response-window opponent player");
  }

  return opponentPlayerId;
}
