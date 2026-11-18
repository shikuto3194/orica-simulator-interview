// ENGINE-attack-declaration-replacement-primitive: BSRK01-C05『飛天御剣流「龍咬閃」』専用。
//
// 相手のアタック宣言 (宣言前スタック窓、preDeclarationStackWindow.kind==="attack"、
// confirmAttackDeclarationAsAction 未実行) の最中に、こちらが指定した相手の別カードへ
// アタッカー自体を差し替える（元の宣言は取り消され、なかったものになる）。同時に、
// 差し替え後の新アタックを自分の指定カードへ forced_block させる。
//
// 「可能なら」: newAttacker に合法な差し替え候補が存在しない場合、この action は no-op
// となり元のアタック宣言はそのまま進行する（forcedBlocker の予約も行わない）。
//
// アタッカー差し替え自体は既存の confirmAttackDeclarationAsAction が
// preDeclarationStackWindow.sourceInstanceId を読んで ActiveAttack を構築するタイミングを
// そのまま再利用する (window.sourceInstanceId を書き換えるだけで、宣言確定時には
// 最初から新アタッカーで宣言されたのと同じ扱いになる)。forced blocker 予約は
// window.pendingForcedBlockerInstanceId → 確定時に ActiveAttack.forcedBlockerInstanceId へ
// 引き継がれ、maybeFinalizeDesignatedAttackAfterPendingReactions (attack-burst-flow.ts) が
// 指定アタックの forced_block と同じ窓 (kind:"forced_block") を汎用化して開く。

import { getCardById } from "../card/card-lookup";
import { getAttackDeclarationBlockReason } from "../battle/battle-availability";
import { resolveTargetSpec } from "./target-resolution";
import type {
  CardDefinition,
  GameState,
  PreDeclarationStackWindow,
} from "../model";
import type { DSL } from "../dsl-types";
import type { StepExecutionContext } from "../step-execution-context";

/**
 * 相手のアタック宣言窓の最中に、newAttackerInstanceId が「元の宣言者自身のカードとして
 * アタック宣言できる」合法な候補かどうかを判定する。
 *
 * 実装ノート: 既存の attacker 合法性判定 `getAttackDeclarationBlockReason` は
 * 「宣言前 (window:"none")」の legal-action 列挙専用に書かれており、宣言前スタック窓
 * (window:"pre_declaration_stack") の最中にはそのままでは呼べない (window チェックで
 * 常に弾かれる)。ここでは判定対象カード自身の合法性 (controller/zone/pendingLeave/
 * attached/category/soul state/CE 禁止/疲労状態/forced-first-attacker) だけを再利用したいので、
 * window だけ "none" に差し替えた一時 state で判定する。SSOT: 判定ロジック自体は複製しない。
 */
function isLegalAttackDeclarationReplacementCandidate(
  state: GameState,
  candidateInstanceId: string,
  declaringPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const legalityCheckState: GameState = {
    ...state,
    window: "none",
    preDeclarationStackWindow: null,
  };
  const blockReason = getAttackDeclarationBlockReason({
    state: legalityCheckState,
    actingPlayerId: declaringPlayerId,
    sourceInstanceId: candidateInstanceId,
    getCardDefinitionById,
  });
  return blockReason === null;
}

export function executeReplaceAttackDeclaration(
  action: DSL.ReplaceAttackDeclarationAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  resolvedTargetIds?: string[]
): GameState {
  const win = state.preDeclarationStackWindow;
  if (win === null || win.kind !== "attack") {
    // 前提が崩れている（宣言前スタック窓外での誤発火）。no-op。
    return state;
  }

  const newAttackerInstanceId = resolvedTargetIds?.[0];
  if (newAttackerInstanceId === undefined) {
    // 「可能なら」: 合法な差し替え候補が存在しない → 元の宣言のまま何も起きない。
    return state;
  }

  const newAttackerCard = getCardById(state, newAttackerInstanceId);
  if (!newAttackerCard) {
    return state;
  }

  if (
    !isLegalAttackDeclarationReplacementCandidate(
      state,
      newAttackerInstanceId,
      win.actingPlayerId,
      getCardDefinitionById
    )
  ) {
    return state;
  }

  const forcedBlockerCandidates = resolveTargetSpec({
    targetSpec: action.forcedBlocker,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext: stepCtx,
  });
  const forcedBlockerInstanceId = forcedBlockerCandidates[0]?.instanceId;

  const nextWindow: PreDeclarationStackWindow = {
    ...win,
    sourceInstanceId: newAttackerInstanceId,
  };
  delete nextWindow.targetInstanceId;
  delete nextWindow.additionalSourceInstanceIds;
  if (forcedBlockerInstanceId !== undefined) {
    nextWindow.pendingForcedBlockerInstanceId = forcedBlockerInstanceId;
  } else {
    delete nextWindow.pendingForcedBlockerInstanceId;
  }

  return {
    ...state,
    preDeclarationStackWindow: nextWindow,
    log: [
      ...state.log,
      `effect:replace_attack_declaration:${win.sourceInstanceId}->${newAttackerInstanceId}`,
      ...(forcedBlockerInstanceId !== undefined
        ? [
            `effect:replace_attack_declaration:forced-blocker-reserved:${forcedBlockerInstanceId}`,
          ]
        : []),
    ],
  };
}
