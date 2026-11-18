/**
 * 使用枠の時計。期限は「生存する時計に属するか」だけで判断し、機構別のリセットを持たない。
 *
 * 追加ターン (中断) の扱い:
 *   - 台帳そのものは入れ替えない。中断元の時計 (turnId/stepId/battleId) は保存せず、
 *     returnContext の連鎖 (turnNumber・turnContext.stepOrdinalThisTurn・activeAttack.attackId) から
 *     `suspendedUsageClocks` (effect/effect-usage-accounting.ts) が導出し、生存する時計の集合に含まれる。
 *   - 追加ターン中の照会は現在の時計で識別キーを作るため、中断元の turn/step/battle 枠は
 *     見えない。game 枠は期間IDが固定なので追加ターン中の消費も累積し、復帰で上書きされない。
 *   - 復帰で時計を元の値に戻すと、中断元の枠が再び見える。
 */

import type { UsageBucket, UsageClock } from "./types";

export function createUsageClock(
  turnId: number,
  stepId: number,
  battleId: string | null
): UsageClock {
  return { turnId, stepId, battleId };
}

export function sameUsageClock(a: UsageClock, b: UsageClock): boolean {
  return (
    a.turnId === b.turnId && a.stepId === b.stepId && a.battleId === b.battleId
  );
}

/**
 * bucketが生存する時計に属するか。game は常に生存。
 * event / activation は作成ターンが生存している間だけ生存する。
 */
export function isBucketLive(
  bucket: Pick<UsageBucket, "period" | "turnId" | "stepId" | "battleId">,
  liveClocks: readonly UsageClock[]
): boolean {
  switch (bucket.period) {
    case "game":
      return true;
    case "turn":
    case "event":
    case "activation":
      return liveClocks.some((clock) => clock.turnId === bucket.turnId);
    case "step":
      return liveClocks.some(
        (clock) =>
          clock.turnId === bucket.turnId && clock.stepId === bucket.stepId
      );
    case "battle":
      return (
        bucket.battleId !== null &&
        liveClocks.some((clock) => clock.battleId === bucket.battleId)
      );
  }
}
