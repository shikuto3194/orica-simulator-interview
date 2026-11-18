// Module-level pending/CE id sequence counters (P2-12): structured-effect-interpreter.ts
// 及び分割後の各 structured-*.ts クラスタから共有される。
//
// これらは可変 module state (`let`) であり、import された binding へは代入できないため、
// クラスタ分割時にカウンタ本体を単一クラスタへ移すと他クラスタが増分できなくなる。
// そこで全カウンタと mutator をこの依存ゼロの共有モジュールに集約し、
// 親・子クラスタはいずれも mutator 関数を import して呼ぶだけにする（`nextCeId` 既存パターンの一般化）。
// 本モジュールは index.ts の barrel には載らない（親のみが再エクスポート対象）ため公開 API を汚さない。

let ceSequence = 1;
/** ContinuousEffect / 修飾子の effectId 用連番 (`dsl-ce-<tag>-<n>`)。 */
export function nextCeId(tag: string): string {
  return `dsl-ce-${tag}-${ceSequence++}`;
}

let pendingSelectionSequence = 0;
/**
 * カード/ゾーン選択 pending の pendingId 用連番。prefix はキュー種別
 * (`cs`/`cd`/`zs`/`dr`/`mp` 等) を表し、複数クラスタで単一カウンタを共有する。
 */
export function nextPendingSelectionId(prefix: string): string {
  return `${prefix}-${pendingSelectionSequence++}`;
}

// field_card コスト支払い配分 pending (`pendingCoreSourceAllocation`) 用 sequence。
let coreSourceAllocationPendingSequence = 0;
/** `pendingCoreSourceAllocation` の pendingId 用連番 (`csa-<n>`)。 */
export function nextCoreSourceAllocationId(): string {
  return `csa-${coreSourceAllocationPendingSequence++}`;
}

// ライフ→任意先 通常+ソウル混在の持ち主選択 pending (`pendingLifeCoreSelection`) 用 sequence。
let lifeCoreSelectionPendingSequence = 0;
/** `pendingLifeCoreSelection` の pendingId 用連番 (`lcs-<n>`)。 */
export function nextLifeCoreSelectionId(): string {
  return `lcs-${lifeCoreSelectionPendingSequence++}`;
}

// vanish の coreDestinationChoice が生成する pendingCoreSplitSelection 用 sequence
// (effect-interpreter.ts の core_move splitDestinations 用カウンタとは独立)。
let vanishCoreDestinationChoicePendingSequence = 0;
/** vanish coreDestinationChoice の pendingId 用連番 (`vanish-core-dest-<n>`)。 */
export function nextVanishCoreDestinationId(): string {
  return `vanish-core-dest-${vanishCoreDestinationChoicePendingSequence++}`;
}
