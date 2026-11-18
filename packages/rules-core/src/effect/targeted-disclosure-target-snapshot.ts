import { getCardById } from "../card/card-lookup";
import type { GameState, Zone } from "../model";

/**
 * 対象開示の直前に、選択済み TargetRef が属していた zone を固定する。
 *
 * 本体再開では target lock を再取得しない一方、対象が既にその zone を離れていれば
 * 効果対象には残せない。zone の存在確認だけをここへ集約し、耐性など action 固有の
 * affect gate は各 executor に委ねる。
 */
export function snapshotTargetedDisclosureTargetZones(
  state: GameState,
  targetInstanceIds: readonly string[]
): Record<string, Zone> {
  return Object.fromEntries(
    targetInstanceIds.flatMap((instanceId) => {
      const card = getCardById(state, instanceId);
      return card ? [[instanceId, card.zone] as const] : [];
    })
  );
}

/**
 * legacy continuation（snapshot 未保持）は既存の互換挙動を保つ。新規 continuation は
 * 選択時 zone に残っている対象だけを再開へ渡す。
 */
export function filterTargetsStillInSnapshottedZones(
  state: GameState,
  targetInstanceIds: readonly string[],
  targetZonesByInstanceId: Readonly<Record<string, Zone>> | undefined
): string[] {
  if (targetZonesByInstanceId === undefined) return [...targetInstanceIds];
  return targetInstanceIds.filter((instanceId) => {
    const expectedZone = targetZonesByInstanceId[instanceId];
    const card = getCardById(state, instanceId);
    return expectedZone === undefined || card?.zone === expectedZone;
  });
}
