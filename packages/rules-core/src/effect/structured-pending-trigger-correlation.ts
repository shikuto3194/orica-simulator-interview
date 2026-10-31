// P3-129 (ENGINE-triggered-hand-zone-immunity-dynamic-scope): correlate_pending_trigger
// Action の実行体。「Xが起きたとき、以後、相手側の誘発効果が未解決の間だけYが真」型の
// 動的スコープ相関を発揮元カード自身にセットする。新規プリミティブのため専用ファイルへ
// 分離 (rules-core 共通ファイル touch を最小化、cluster 単位並走時の競合回避)。

import { replaceCardInstances } from "../zone/card-instance-state";
import type { GameState } from "../model";
import { getCardById } from "../card/card-lookup";

/**
 * `sourceInstanceId` の `pendingTriggerCorrelations[key]` に、現在解決中の
 * pending triggered effect 自身の `pendingId` を append する。
 * `pendingId` が undefined (= 同一 event に他の登録 source が無く同時誘発でない) の場合は
 * 相関すべき相手側誘発が存在しないため no-op で同一 state を返す。
 */
export function executeCorrelatePendingTrigger(
  state: GameState,
  sourceInstanceId: string,
  key: string,
  pendingId: string | undefined
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard || pendingId === undefined) return state;

  const existing = sourceCard.pendingTriggerCorrelations?.[key] ?? [];
  if (existing.includes(pendingId)) return state;

  state.log.push(
    `effect:correlate_pending_trigger:${sourceInstanceId}:${key}:${pendingId}`
  );
  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) =>
      c.instanceId === sourceInstanceId
        ? {
            ...c,
            pendingTriggerCorrelations: {
              ...c.pendingTriggerCorrelations,
              [key]: [...existing, pendingId],
            },
          }
        : c
    )
  );
}
