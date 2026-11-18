/**
 * 数量・宣言事実・観測 (P3-170 I13 / I14 / I15) のテスト用 fixture builder。
 *
 * 旧 GameState の専用フィールド (ライフ減少の累積辞書、宣言数、N回目の観測 tally) を
 * 組み立てる代わりに、このヘルパーで「読む」「実量が記録済みの状態にする」。
 * テストは使用会計の台帳 API を直接触らない。
 */
import { describeUsageBucket, parseBucketKey } from "../../src/effect-usage";
import { isEffectOccurrenceBucket } from "../../src/effect/effect-occurrence-gate";
import {
  ceQuantitySourceOf,
  getBpThresholdCappedLifeReduction,
  getCappedLifeReduction,
  getEffectCauseLifeReduction,
  getFilteredCappedLifeReduction,
  getGimmickDeclarationCount,
  getSymbolAdditionRestrictedCount,
  recordGimmickDeclaration,
  recordLifeReductionQuantities,
  recordSymbolAdditionRestrictedCount,
} from "../../src/mechanics/quantity-usage";
import type { ContinuousEffect, GameState } from "../../src";

// ---- I14: ライフ減少の累積 ----

/** 全体 (無印 turn_cap) の累積。 */
export function cappedLifeReduction(
  state: GameState,
  playerId: string
): number {
  return getCappedLifeReduction(state, playerId);
}

/** 相手の効果によるライフ減少の累積 (`turnThreshold` 判定)。 */
export function effectCauseLifeReduction(
  state: GameState,
  playerId: string
): number {
  return getEffectCauseLifeReduction(state, playerId);
}

/** BP閾値付き累積キャップ (BSTH08.5-C21) の累積。 */
export function bpThresholdCappedLifeReduction(
  state: GameState,
  playerId: string
): number {
  return getBpThresholdCappedLifeReduction(state, playerId);
}

/** フィルタ付き turn_cap の累積。CE の効果元の能力ID (effectId ではない) で読む。 */
export function filteredCappedLifeReduction(
  state: GameState,
  protectedPlayerId: string,
  ce: Pick<
    ContinuousEffect,
    "sourceInstanceId" | "sourceDefinitionId" | "provenance"
  >
): number {
  return getFilteredCappedLifeReduction(
    state,
    protectedPlayerId,
    ceQuantitySourceOf(ce, "life_turn_cap", protectedPlayerId)
  );
}

export function seedCappedLifeReduction(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  return recordLifeReductionQuantities(state, {
    playerId,
    cappedTotal: amount,
  });
}

export function seedEffectCauseLifeReduction(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  return recordLifeReductionQuantities(state, {
    playerId,
    effectCause: amount,
  });
}

export function seedBpThresholdCappedLifeReduction(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  return recordLifeReductionQuantities(state, {
    playerId,
    bpThreshold: amount,
  });
}

// ---- I13: シンボル追加制限 ----

export function symbolAdditionRestrictedCount(
  state: GameState,
  restrictedPlayerId: string,
  ce: Pick<
    ContinuousEffect,
    "sourceInstanceId" | "sourceDefinitionId" | "provenance"
  >
): number {
  return getSymbolAdditionRestrictedCount(
    state,
    restrictedPlayerId,
    ceQuantitySourceOf(ce, "symbol_restriction", restrictedPlayerId)
  );
}

export function seedSymbolAdditionRestrictedCount(
  state: GameState,
  restrictedPlayerId: string,
  ce: Pick<
    ContinuousEffect,
    "sourceInstanceId" | "sourceDefinitionId" | "provenance"
  >,
  amount: number
): GameState {
  return recordSymbolAdditionRestrictedCount(
    state,
    restrictedPlayerId,
    ceQuantitySourceOf(ce, "symbol_restriction", restrictedPlayerId),
    amount
  );
}

// ---- I15: 宣言事実 ----

export function gimmickDeclarationCount(
  state: GameState,
  playerId: string
): number {
  return getGimmickDeclarationCount(state, playerId);
}

/** 宣言を n 回行った状態にする (ログは増やさない)。 */
export function seedGimmickDeclarations(
  state: GameState,
  playerId: string,
  times = 1
): GameState {
  let current = state;
  for (let i = 0; i < times; i++) {
    current = recordGimmickDeclaration(current, playerId);
  }
  return { ...current, log: state.log };
}

// ---- I15: N回目観測 (occurrenceGate) ----

export interface OccurrenceTally {
  /** 効果帰属の個体 (tally の主体)。 */
  sourceInstanceId: string;
  /** 効果ラベル。groupId 共有 tally の場合は undefined。 */
  label?: string;
  /** 共有 tally グループ ID。 */
  groupId?: string;
  count: number;
  /** 期間ID (`turn:3` 等)。 */
  periodId: string;
}

/** 現在の会計にある観測 tally (期限切れで整理された分は含まない)。 */
export function listOccurrenceTallies(state: GameState): OccurrenceTally[] {
  return state.effectAccounting.buckets
    .filter(isEffectOccurrenceBucket)
    .map((bucket) => {
      const described = describeUsageBucket(bucket)!;
      const key = parseBucketKey(bucket.key);
      return {
        sourceInstanceId: String(key[2]),
        ...(described.groupId !== null
          ? { groupId: described.groupId.replace(/^occurrence:/, "") }
          : {
              label: described.ability!.path.replace(/\/occurrence$/, ""),
            }),
        count: bucket.amount,
        periodId: String(key[key.length - 1]),
      };
    });
}

/** 指定個体の tally (最初の一致)。無ければ undefined。 */
export function occurrenceTallyOf(
  state: GameState,
  sourceInstanceId: string
): OccurrenceTally | undefined {
  return listOccurrenceTallies(state).find(
    (tally) => tally.sourceInstanceId === sourceInstanceId
  );
}
