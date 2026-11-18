// ============================================================
// Card Action Modal — 表示順優先度
// ============================================================
//
// フィールドカードクリック / ハンドカードドロップで開くアクション選択モーダル
// (`card-action-modal`) の button 並びを固定するための優先度テーブル。
//
// BS の宣言フェーズ順序 (戦闘宣言 → 効果発揮 → 配置 → 使用) を踏襲し、
// 「両要素 (アタック + 効果発揮) がある場合は アタック → 効果発揮 → キャンセル」
// という GUI 要件 (P3-14 A-7 関連の UI 統合) を達成する。
//
// 「キャンセル」ボタンはこのリストとは独立してモーダル末尾に render する。
// ============================================================

import type { LegalAction } from "@orica/rules-core";

/**
 * action.kind ごとの表示順 priority。値が小さいほど先頭に出る。
 *
 * 順序の意図:
 *   0  attack             — 戦闘宣言は最優先 (ターン中の主たる選択肢)
 *   0.6 flip_instead_of_attack — アタックの代替宣言 (BSDB01-TX01(A) 型)。attack の直後
 *   1  block              — 防御側の主選択肢
 *   2  use_field_card_effect — 効果発揮 (能動起動)
 *   3-5 brave_*           — ブレイヴ操作 (戦闘/効果より頻度低)
 *   5.1-5.2 contract_combine / link_aid — brave 系と同型のカードタップ起動 (P3-111)
 *   6-8 summon / place_nexus / set_burst — 配置系
 *   9-11 use_magic / use_accel / use_change — 使用系
 *   その他は 100 にフォールバック (末尾)
 */
export const CARD_ACTION_MODAL_ORDER: Record<string, number> = {
  attack: 0,
  flip_instead_of_attack: 0.6,
  join_active_attack: 0.5,
  block: 1,
  use_field_card_effect: 2,
  use_hand_card_effect: 2,
  brave_combine: 3,
  brave_separate: 4,
  brave_swap: 5,
  contract_combine: 5.1,
  link_aid: 5.2,
  summon: 6,
  place_nexus: 8,
  set_burst: 9,
  use_magic: 10,
  use_accel: 11,
  use_change: 12,
};

export const CARD_ACTION_MODAL_DEFAULT_PRIORITY = 100;

/**
 * LegalAction[] を表示順優先度で並び替えた新しい配列を返す。
 * 入力配列は不変。同じ priority の action は元の相対順序を保持する (stable sort)。
 */
export function sortCardActionsForModal<T extends Pick<LegalAction, "kind">>(
  actions: readonly T[]
): T[] {
  return actions.slice().sort((a, b) => {
    const ra =
      CARD_ACTION_MODAL_ORDER[a.kind] ?? CARD_ACTION_MODAL_DEFAULT_PRIORITY;
    const rb =
      CARD_ACTION_MODAL_ORDER[b.kind] ?? CARD_ACTION_MODAL_DEFAULT_PRIORITY;
    return ra - rb;
  });
}
