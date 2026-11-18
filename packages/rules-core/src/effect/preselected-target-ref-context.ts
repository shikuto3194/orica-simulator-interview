/**
 * 対象開示後に復元した TargetRef の実行文脈。
 *
 * `resolvedTargetIds` は既存の executor 群が共有する public な `string[]` のままに
 * 保つ必要がある。そこで一時的な実行文脈だけを WeakSet で結び、各 executor が
 * `resolveTargetCards` を呼び直しても target-acquisition を再適用しないようにする。
 * 配列そのものの要素は変更せず、通常の preSelectedIds / 直接 API 呼出には影響しない。
 */
const preservedPreSelectedTargetRefs = new WeakSet<readonly string[]>();

export function markPreSelectedTargetRefsPreserved(
  targetInstanceIds: readonly string[]
): string[] {
  const marked = [...targetInstanceIds];
  preservedPreSelectedTargetRefs.add(marked);
  return marked;
}

export function arePreSelectedTargetRefsPreserved(
  targetInstanceIds: readonly string[] | undefined
): boolean {
  return (
    targetInstanceIds !== undefined &&
    preservedPreSelectedTargetRefs.has(targetInstanceIds)
  );
}
