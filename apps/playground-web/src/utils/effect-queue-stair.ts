/** 効果キューの階段状レイアウトと前面化の並び。描画と「はみ出し判定」が同じ式を使う。 */

export const QUEUE_CARD_OFFSET_X = 55;
export const QUEUE_CARD_OFFSET_Y = 10;

/**
 * position: 0 = 最背面 … count - 1 = 最前面。
 * 前面を基準 (0, 0) に固定し、1枚後ろにつき左上へ退く。前面は枚数・並びに依らず動かない。
 */
export function queueCardStairOffset(
  position: number,
  count: number
): { x: number; y: number } {
  const behind = Math.max(0, count - 1 - position);
  return {
    x: -behind * QUEUE_CARD_OFFSET_X,
    y: -behind * QUEUE_CARD_OFFSET_Y,
  };
}

/** 選んだ1件だけを最前面 (末尾) へ移す。他の並びは変えない。 */
export function promoteToFront(ids: string[], id: string): string[] {
  if (!ids.includes(id) || ids[ids.length - 1] === id) return ids;
  return [...ids.filter((candidate) => candidate !== id), id];
}

/**
 * focusStack を表示順 (最背面 → 最前面) に正規化する。
 * 消えた id は除き、まだ同期されていない新規 id は末尾 (前面) へ足す。
 */
export function stairOrder(
  itemIds: readonly string[],
  focusStackIds: readonly string[]
): string[] {
  const present = new Set(itemIds);
  const ordered = focusStackIds.filter((id) => present.has(id));
  const seen = new Set(ordered);
  return [...ordered, ...itemIds.filter((id) => !seen.has(id))];
}
