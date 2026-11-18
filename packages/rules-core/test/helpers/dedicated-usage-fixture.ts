/**
 * 専用の使用記録だった枠(P3-170 I05/I06/I07/I10)のテスト用 fixture builder。
 *
 * テストは使用会計の台帳 API を直接触らず、ここの「使用済みにする」「使用済みか」だけを使う。
 * 旧 GameState の専用フィールド(配列・辞書)を組み立てる代わりにこのヘルパーを使う。
 */
import {
  canApplyCountGainModifier,
  consumeCountGainModifier,
  consumeTaplessBattleDeclareBudget,
  isTaplessBattleDeclareBudgetAvailable,
  recordUseCostGatePaid,
  wasUseCostGatePaid,
} from "../../src/mechanics/dedicated-usage";
import type { GameState } from "../../src";

/** 次のターンへ進めた状態(暦ターンの時計だけを進める。ターン遷移の追加副作用は含めない)。 */
export function withNextTurnClock(state: GameState): GameState {
  return { ...state, turnNumber: state.turnNumber + 1, stepOrdinalThisTurn: 0 };
}

// ---- I05 count_gain_modifier ----

export function markCountGainModifierConsumed(
  state: GameState,
  modifier: { sourceInstanceId: string; sourceDefinitionId: string },
  beneficiaryPlayerId: string
): GameState {
  return consumeCountGainModifier(state, modifier, beneficiaryPlayerId);
}

export function isCountGainModifierConsumed(
  state: GameState,
  modifier: { sourceInstanceId: string; sourceDefinitionId: string },
  beneficiaryPlayerId: string
): boolean {
  return !canApplyCountGainModifier(state, modifier, beneficiaryPlayerId);
}

// ---- I06 allow_tapless_battle_declare ----

export function markTaplessBattleDeclareUsed(
  state: GameState,
  instanceId: string
): GameState {
  return consumeTaplessBattleDeclareBudget(state, instanceId);
}

export function isTaplessBattleDeclareUsed(
  state: GameState,
  instanceId: string
): boolean {
  return !isTaplessBattleDeclareBudgetAvailable(state, instanceId);
}

// ---- I10 useCostGate (事実) ----

export function markUseCostGatePaid(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): GameState {
  return recordUseCostGatePaid(state, playerId, sourceInstanceId);
}

export function isUseCostGatePaid(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): boolean {
  return wasUseCostGatePaid(state, playerId, sourceInstanceId);
}
