import { localizeEffectLabel } from "@orica/rules-core";
import type {
  AttackLegalAction,
  BlockLegalAction,
  JoinActiveAttackLegalAction,
  LegalAction,
} from "@orica/rules-core";

type LegalActionKind = LegalAction["kind"];

/**
 * P3-127: attack/join_active_attack のコスト源候補集約キー。同じ攻撃宣言 (同一
 * sourceInstanceId、join_active_attack は同一 attackId) から生じる cost-source
 * variant (battleDestroyCostSourceInstanceId/attackExhaustCostSourceInstanceId
 * 違いのみ) を 1 グループに束ねる。targetInstanceId 確定済みの attack (フィールド
 * タップ対象別 legal action) は別経路のためこのグループ化の対象外。
 * BattleScreen の card-action-modal (attack/join_active_attack 共通) で同一関数を
 * 使う (SSOT)。
 */
export function attackCostGroupKey(
  a: AttackLegalAction | JoinActiveAttackLegalAction | BlockLegalAction
): string {
  if (a.kind === "attack")
    return `attack:${a.sourceInstanceId}${a.targetInstanceId ? `:${a.targetInstanceId}` : ""}`;
  if (a.kind === "block")
    return `block:${a.sourceInstanceId}:${a.participantEntityId}`;
  return `join_active_attack:${a.sourceInstanceId}:${a.attackId}`;
}

// 全 LegalAction kind についてラベル登録を必須化する (P3-37 教訓)。
// 新しい kind を rules-core に追加すると、ここでコンパイルエラー → ラベル抜けによる
// 生 kind 文字列表示を型レベルで防止する。
// 注: P3-54/P3-129 で executionMode (mandatory/optional) ベースで動的に決まる
// ラベルが一部存在する (resolve_pending_triggered_effect /
// resolve_battle_immediate_effect / select_pending_to_resolve)。
// これらの「kind だけでは決まらないラベル」は getActionLabel() で上書きする。
// Record の値はその場合の fallback / mandatory ラベルを記載する。
export const ACTION_LABELS: Record<LegalActionKind, string> = {
  summon: "召喚",
  place_nexus: "配置",
  use_field_card_effect: "効果使用",
  use_hand_card_effect: "起動効果",
  use_magic: "マジック使用",
  use_accel: "アクセル",
  use_change: "チェンジ",
  declare_advent: "煌臨",
  declare_host_dual_advent: "契約煌臨（バディ）",
  declare_dual_host_advent: "多重煌臨",
  declare_manifest: "顕現",
  attack: "アタック",
  flip_instead_of_attack: "アタックの代わりに裏返す",
  join_active_attack: "アタックに合流",
  decline_immediate_attack_join: "アタックしない",
  block: "ブロック",
  set_burst: "バーストセット",
  set_mirage: "ミラージュセット",
  set_quartz: "クォーツセット",
  activate_soul_state: "魂状態化",
  pass_battle_flash: "フラッシュパス",
  pass_stack: "スタックパス",
  pass_pre_declaration_stack: "スタックパス",
  open_battle_flash: "フラッシュ使用",
  declare_private_triggered_effect: "発揮する",
  skip_private_triggered_effect: "発揮しない",
  // resolve_pending_triggered_effect / resolve_battle_immediate_effect /
  // select_pending_to_resolve は executionMode が mandatory なら "解決"、
  // optional なら "発揮する" に動的決定。
  // ここの Record 値は getActionLabel() で上書きされる前提の fallback。
  resolve_pending_triggered_effect: "解決",
  select_pending_to_resolve: "解決",
  resolve_pending_burst_check: "バースト発動",
  decline_pending_burst_check: "発動しない",
  resolve_battle_immediate_effect: "解決",
  decline_block: "ブロックしない",
  end_attack_step: "アタック終了",
  brave_combine: "合体",
  contract_combine: "契約合体",
  link_aid: "リンクエイド",
  swap_hand_trash: "トラッシュとの入れ替え",
  decline_hand_trash_swap: "入れ替えない",
  swap_field_hand: "フィールド⇔手札入替",
  decline_field_hand_swap: "入れ替えない",
  brave_separate: "分離",
  brave_swap: "交換",
  resolve_brave_combine_choice: "合体選択",
  resolve_tensho_summon: "転召",
  resolve_reverse_rebirth_summon: "逆転醒",
  resolve_pending_deck_reveal_pick: "デッキのカード選択",
  resolve_pending_deck_reveal_order: "デッキ並び替え",
  resolve_pending_zone_selection: "ゾーン選択",
  resolve_pending_step_optional_choice: "発揮する",
  resolve_pending_step_choice: "効果選択",
  resolve_connect_battle_decision: "続けてバトルする",
  resolve_pending_deck_reveal_count_boost_choice: "枚数+1",
  resolve_pending_step_optional_target_selection: "対象選択",
  resolve_pending_draw_step_cost_choice: "ドロー枚数修正",
  resolve_pending_summon_cost_exclude_choice: "召喚コスト軽減",
  resolve_pending_summon_cost_core_move_choice: "コア移動で無償召喚",
  resolve_pending_grouped_summon_cost_override_choice:
    "召喚コストオーバーライド",
  resolve_pending_life_damage_discard_choice: "破棄して防ぐ",
  resolve_pending_life_gain_replacement_choice: "ライフ増加を置換",
  resolve_pending_core_shoot: "コアシュート",
  resolve_pending_effect_target: "対象選択",
  resolve_pending_as_if_soul_core_choice: "ソウルコア擬制選択",
  resolve_pending_effect_optional_repeat_choice: "追加発揮選択",
  resolve_pending_effect_optional_repeat_count: "追加回数選択",
  resolve_borrowed_effect_choice: "効果選択",
  resolve_borrowed_effect_target: "対象選択",
  resolve_pay_to_act_core_gate: "コア除去",
  resolve_pay_to_act_hand_discard_gate: "手札破棄",
  resolve_field_magic_pre_cost_trigger: "先に効果を使う",
  resolve_pending_core_split: "コア分配",
  resolve_pending_split_summon_choice: "場入りの分配選択",
  resolve_pending_core_count: "コア数選択",
  resolve_pending_count_decrease: "カウント数選択",
  resolve_pending_discard_set_burst_count: "バースト破棄枚数選択",
  resolve_pending_life_core_selection: "ライフコア選択",
  resolve_core_source_allocation: "支払い元選択",
  resolve_pending_link_aid_cost_source_choice: "リンクエイド支払い元",
  resolve_pending_effect_summon_cost_payment: "召喚コスト支払い",
  resolve_pending_core_distribution: "コア配分",
  abort_pending_core_distribution: "コア配分キャンセル",
  resolve_pending_change_cleanup_choice: "チェンジ後処理",
  resolve_pending_multi_placement: "コア配置",
  abort_pending_multi_placement: "コア配置キャンセル",
  resolve_pending_enter_field_placement: "コア配置",
  use_divine_skill: "神技発揮",
  confirm_target_redirect: "対象変更",
  decline_target_redirect: "変更しない",
  resolve_brave_leave_choice: "ブレイヴ選択",
  resolve_advent_source_replacement: "煌臨元へ追加",
  resolve_soul_state_replacement: "魂状態で残す",
  resolve_brave_attack_continuation: "アタック継続選択",
  resolve_set_aside_exit_replacement_choice: "置換選択",
};

/**
 * 正源: 各 LegalActionKind がどの UI 経路で発火するか。
 * - "action-bar": 下部 ActionBar が描画する pass 系 / 効果全体の決定アクション
 * - "field-tap":  フィールドカードタップ → 候補モーダル (selectableFieldIds 経由)
 * - "hand-tap":   手札カードタップ → 候補モーダル (selectableHandIds 経由)
 * - "other":      EffectQueue/専用ボタン/HUD/モーダル/自動解決/エンジンのみ 等。
 *
 * BattleScreen.tsx の selectableFieldIds/selectableHandIds、および下部 pass ボタンの
 * 表示対象は全てここから導出する。以前はこの3箇所 (+カードタップ後の候補フィルタ2箇所) で
 * 個別に kind を列挙しており、新規 kind 追加時にどこか1箇所へ足し忘れても型エラーに
 * ならず GUI から永久に発火不能になっていた (use_divine_skill が正にこれで、
 * 2026-06-14 の実装から2026-07-23 まで気づかれずGUIから一度も発揮できなかった)。
 * Record の網羅性チェックにより、新しい kind を追加すると必ずここへの分類が
 * コンパイルエラーで強制される (ACTION_LABELS と同じ機構)。
 */
export type ActionUiRoute = "action-bar" | "field-tap" | "hand-tap" | "other";

export const ACTION_UI_ROUTES: Record<LegalActionKind, ActionUiRoute> = {
  resolve_pending_triggered_effect: "action-bar",
  select_pending_to_resolve: "action-bar",
  declare_private_triggered_effect: "action-bar",
  skip_private_triggered_effect: "action-bar",
  resolve_pending_burst_check: "action-bar",
  decline_pending_burst_check: "action-bar",
  use_field_card_effect: "field-tap",
  // 手札起動効果はフィールドの起動効果と同様にカードタップ → モーダルで処理する。
  use_hand_card_effect: "hand-tap",
  resolve_battle_immediate_effect: "other",
  use_magic: "hand-tap",
  use_accel: "hand-tap",
  use_change: "hand-tap",
  declare_advent: "hand-tap",
  declare_host_dual_advent: "field-tap",
  declare_dual_host_advent: "hand-tap",
  declare_manifest: "hand-tap",
  set_burst: "hand-tap",
  // 2026-07-24 GUI配線完了 (旧: set_burst/activate_soul_state 等と同型のはずが
  // カードタップ経路に未登録で、GUIから発動不能だった。
  // set_mirage は交換先0〜1件を解決済みLegalActionに持つ。同じ入口から個別候補を選び、
  // そのActionを支払いHUDにも保持する。set_quartz は専用の配置先選択へ進む)。
  set_mirage: "hand-tap",
  set_quartz: "hand-tap",
  activate_soul_state: "hand-tap",
  summon: "hand-tap",
  place_nexus: "hand-tap",
  attack: "field-tap",
  // BSDB01-TX01(A) 型: アタック宣言の代わりに裏返す代替宣言。attack と同じくカードタップ
  // → 候補モーダルで「アタック」と並んで選択肢に出す (attackAlternativeFlip を持つ
  // カードのみ候補に出現する field-tap 経路を共有する)。
  flip_instead_of_attack: "field-tap",
  join_active_attack: "field-tap",
  decline_immediate_attack_join: "other",
  block: "field-tap",
  open_battle_flash: "other",
  pass_battle_flash: "action-bar",
  pass_stack: "action-bar",
  pass_pre_declaration_stack: "action-bar",
  // P3-55 Phase B: 「ブロックしない」専用ボタン (action-block-decline) に集約。
  decline_block: "other",
  end_attack_step: "other",
  brave_combine: "field-tap",
  // 契約合体は手札のブレイヴをタップ、リンクエイドは魂状態のカードをタップして宣言する。
  // リンクエイドの効果文内コスト源は窓後 pending を共通コアHUDで選ぶ。
  contract_combine: "hand-tap",
  link_aid: "field-tap",
  swap_hand_trash: "other",
  decline_hand_trash_swap: "other",
  swap_field_hand: "other",
  decline_field_hand_swap: "other",
  resolve_brave_combine_choice: "other",
  resolve_tensho_summon: "other",
  resolve_reverse_rebirth_summon: "other",
  brave_separate: "field-tap",
  brave_swap: "field-tap",
  resolve_brave_leave_choice: "other",
  resolve_advent_source_replacement: "other",
  resolve_soul_state_replacement: "other",
  resolve_brave_attack_continuation: "other",
  resolve_set_aside_exit_replacement_choice: "other",
  resolve_pending_deck_reveal_pick: "other",
  resolve_pending_deck_reveal_order: "other",
  resolve_pending_zone_selection: "other",
  // step-level optional は BattleScreen の専用 effect-choice-overlay で処理する。
  resolve_pending_step_optional_choice: "other",
  resolve_pending_step_choice: "other",
  resolve_connect_battle_decision: "other",
  resolve_pending_deck_reveal_count_boost_choice: "other",
  resolve_pending_step_optional_target_selection: "other",
  resolve_pending_draw_step_cost_choice: "other",
  resolve_pending_summon_cost_exclude_choice: "other",
  resolve_pending_summon_cost_core_move_choice: "other",
  resolve_pending_grouped_summon_cost_override_choice: "other",
  resolve_pending_life_damage_discard_choice: "other",
  resolve_pending_life_gain_replacement_choice: "other",
  resolve_pending_core_shoot: "other",
  // 対象選択 UI (highlight + 決定) で処理する。
  resolve_pending_effect_target: "other",
  resolve_pending_as_if_soul_core_choice: "other",
  resolve_pending_effect_optional_repeat_choice: "other",
  resolve_pending_effect_optional_repeat_count: "other",
  resolve_borrowed_effect_choice: "other",
  resolve_borrowed_effect_target: "other",
  resolve_pay_to_act_core_gate: "other",
  // 手札破棄gate は HandArea の候補選択バナーでカードID/decline payload を渡す。
  resolve_pay_to_act_hand_discard_gate: "other",
  resolve_field_magic_pre_cost_trigger: "other",
  resolve_pending_core_split: "other",
  // split_field_entry_choice は共通カード選択（手札展開・ゾーン候補）で処理する
  // (汎用 applyLegalAction フォールバック経路は splitSummonTokenCount /
  // splitSummonZoneCardInstanceIds を渡さず 0 選択で誤解決するため、資産的に危険)。
  resolve_pending_split_summon_choice: "other",
  resolve_pending_core_count: "other",
  // ENGINE-cost-modify-additional-cost-value-dynamic-amount: 専用モーダル
  // (PendingCountSelectionModal) で処理する。2026-07-24 GUI配線完了 (BSGE01-M02/
  // TX03(B) が対象、旧: engine-onlyでGUI未配線だった)。
  resolve_pending_count_decrease: "other",
  // ENGINE-composite-heterogeneous-removal-budget: 専用モーダル
  // (PendingDiscardSetBurstCountSelectionModal) で処理する。BSTH09-X01 が対象。
  resolve_pending_discard_set_burst_count: "other",
  // ENGINE-core-move-from-life-owner-soul-choice: 専用モーダル
  // (共通コアHUD) で処理する。2026-07-24 GUI配線完了
  // (旧: engine-onlyでGUI未配線だった)。
  resolve_pending_life_core_selection: "other",
  // field_card コスト支払い配分は coreSelection HUD + FieldArea tap 経路で処理する。
  resolve_core_source_allocation: "other",
  // 【リンクエイド】の効果文内コスト源は窓後の共通コアHUDで処理する。
  resolve_pending_link_aid_cost_source_choice: "other",
  // 効果文内 summon のコスト支払いは BattleScreen のコスト支払い HUD で処理する。
  resolve_pending_effect_summon_cost_payment: "other",
  resolve_pending_core_distribution: "other",
  // P3-48 follow-up: HUD のキャンセルボタン経由で発火する。
  abort_pending_core_distribution: "other",
  // チェンジ効果後の破棄/入れ替え選択は BattleScreen の対象選択 UI で処理する。
  resolve_pending_change_cleanup_choice: "other",
  // 通常召喚/配置の遅延維持コア配置: コア配置 HUD (confirmPlacement) 経由で処理する。
  // 汎用 dispatch すると enterFieldCorePlacements 未指定で
  // "Not enough enter-field cores selected" になるため出さない。
  resolve_pending_enter_field_placement: "other",
  // P3-49 placement_multi: HUD 経由で処理する。
  resolve_pending_multi_placement: "other",
  abort_pending_multi_placement: "other",
  use_divine_skill: "field-tap",
  // P3-47 F-4: redirect prompt は専用 overlay (BattleScreen 内) で処理する。
  confirm_target_redirect: "other",
  decline_target_redirect: "other",
};

/**
 * field-tap / hand-tap の対象カードタップで、そのカードがどの LegalAction の対象かを
 * 判定するための instanceId 抽出。大半は sourceInstanceId だが、ブレイヴ合体/分離/交換・
 * 契約合体・リンクエイドは「操作対象として実際にタップするカード」が sourceInstanceId と
 * 一致しないため個別に参照する。selectableFieldIds/selectableHandIds とカードタップ後の
 * 候補フィルタ (BattleScreen.tsx) はすべてこの関数を共有し、並行実装を持たない。
 */
export function tapTargetInstanceIds(action: LegalAction): readonly string[] {
  switch (action.kind) {
    case "brave_combine":
      return [action.braveInstanceId];
    case "brave_separate":
      return [action.hostInstanceId, action.braveInstanceId];
    case "brave_swap":
      return [action.fromHostInstanceId];
    case "link_aid":
      return [action.soulStateCardInstanceId];
    case "contract_combine":
      return [action.braveInstanceId];
    default:
      return "sourceInstanceId" in action ? [action.sourceInstanceId] : [];
  }
}

/**
 * P3-54/P3-129: kind に加えて executionMode を考慮した動的ラベル決定。
 * - mandatory: 「解決」 (queue を前に進める語感を統一)
 * - optional:  「発揮する」(発揮しない と並列表示される宣言ボタン)
 * それ以外の kind は ACTION_LABELS をそのまま返す。
 */
export function getActionLabel(action: LegalAction): string {
  if (action.kind === "use_magic") {
    const label =
      action.timing === "main"
        ? "メインを使用"
        : action.timing === "flash"
          ? "フラッシュを使用"
          : "スタック効果を使用";
    return (
      label +
      (action.choiceLabel
        ? "（" + localizeEffectLabel(action.choiceLabel) + "）"
        : "")
    );
  }
  if (action.kind === "select_pending_to_resolve") {
    const mode = (action as { executionMode?: string }).executionMode;
    const ownerPlayerId = (action as { ownerPlayerId?: string }).ownerPlayerId;
    const actingPlayerId = (action as { actingPlayerId?: string })
      .actingPlayerId;
    if (mode === "optional" && ownerPlayerId === actingPlayerId) {
      return "発揮する";
    }
    return "解決";
  }
  if (
    action.kind === "resolve_pending_triggered_effect" ||
    action.kind === "resolve_battle_immediate_effect"
  ) {
    // P3-91/P3-92 skipOnly: 発揮可能な variant が無い drain 専用 action。
    // apply は常に辞退扱いするためラベルも「発揮しない」にする。
    if ((action as { skipOnly?: boolean }).skipOnly) return "発揮しない";
    const mode = (action as { executionMode?: string }).executionMode;
    if (mode === "optional") return "発揮する";
    return "解決";
  }
  // pendingStepOptionalChoice の execute / decline は action.choice (SSOT) で識別する。
  if (action.kind === "resolve_pending_step_optional_choice") {
    if (action.choice === "decline") return "発揮しない";
    return action.selectedAmount !== undefined
      ? `発揮する(${action.selectedAmount})`
      : "発揮する";
  }
  if (action.kind === "resolve_pending_step_choice") {
    return localizeEffectLabel(action.choiceLabel);
  }
  // pendingConnectBattleDecision の continue / end も action.choice (SSOT) で識別する。
  if (action.kind === "resolve_connect_battle_decision") {
    return action.choice === "continue"
      ? `続けてバトルする（残り${action.remainingUses}回）`
      : "バトルを終了する";
  }
  // pendingDeckRevealCountBoostChoice の apply / decline も action.choice (SSOT) で識別する。
  if (action.kind === "resolve_pending_deck_reveal_count_boost_choice") {
    return action.choice === "apply"
      ? `枚数+${action.bonusAmount}する`
      : "枚数+1しない";
  }
  // pass_battle_flash はフラッシュ本体パスと内側スタックサブ窓への応答パスで
  // 共用される。responseTiming === "stack" のときは「スタックパス」を表示する
  // (相手のフラッシュ使用に対する応答は意味的にスタックタイミング)。
  if (action.kind === "pass_battle_flash") {
    const timing = (action as { responseTiming?: string }).responseTiming;
    return timing === "stack" ? "スタックパス" : "フラッシュパス";
  }
  if (action.kind === "set_quartz") return "クォーツセット";
  // ミラージュ交換候補は同じ入口に束ね、盤面の対象名を本文に表示する。
  // 交換候補は共通カード選択で提示する。行動名にカード番号のペアを埋め込まない。
  // 手元カード自己除外の置換選択も action.choice (SSOT) で識別する。
  // replacementKind で置換先を区別する (move_to=手札へ戻す / pay_cost=コスト支払って残す)。
  if (action.kind === "resolve_set_aside_exit_replacement_choice") {
    if (action.choice !== "replace") return "除外する";
    return action.replacementKind === "pay_cost"
      ? "コストを支払う"
      : "手札に戻す";
  }
  // declareGimmickGate (BSLH01-C12 等) は破棄ではなく宣言が支払いのためラベルを分岐する。
  if (action.kind === "resolve_pending_life_damage_discard_choice") {
    if (action.costKind === "declare_gimmick") return "宣言して軽減";
    // useCostGate (BSLH01-M05[1] 等) は破棄ではなく使用が支払いのためラベルを分岐する。
    if (action.costKind === "use") return "使用して防ぐ";
  }
  return ACTION_LABELS[action.kind];
}
