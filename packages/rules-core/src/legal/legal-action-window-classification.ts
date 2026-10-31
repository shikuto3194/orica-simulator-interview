import type { LegalAction } from "./legal-actions-types";

/**
 * P3-115 再発防止: `LegalAction["kind"]` ごとに「発揮宣言に対するスタック窓
 * (`preDeclarationStackWindow` / `stackWindow` / battle flash 窓等) を自分で開くべきか」
 * を明示する。`ACTION_LABELS: Record<LegalActionKind, string>` (action-ui.ts, P3-37) と
 * 同型の exhaustive record パターンを採用し、新しい `LegalAction` variant を追加すると
 * この分類が無い限りコンパイルエラーになる。
 *
 * キー型は `LegalAction["kind"]` を正源とする。手動 union `LegalActionKind`
 * (legal-actions-types.ts) は `LegalActionHandlerMap` 導入時 (P2-11 phase6) の
 * コメントにある通り実体から乖離済みのため使わない。
 *
 * - `opens_own_window`: `10_rules/02_turn-flow-and-timing.md` 02:190 の4カテゴリ
 *   (召喚/配置/使用、常時以外の効果発揮、アタック/ブロック宣言、バースト発動) に該当し、
 *   apply ハンドラ自身が窓を開いて宣言をスタック応答に晒す。
 * - `nested_or_deferred`: 既に窓を開いた別の宣言 (主に summon) の解決過程で生じる
 *   後続選択・置換。呼び出し元の窓で既に応答機会が与えられているため、この kind 自身は
 *   窓を開かない。
 * - `not_a_declaration`: `resolve_*`/`pass_*`/対象選択/管理系。新規のスタック宣言では
 *   ないため窓を開かない。
 */
export type DeclarationWindowKind =
  | "opens_own_window"
  | "nested_or_deferred"
  | "not_a_declaration";

export const LEGAL_ACTION_WINDOW_CLASSIFICATION: Record<
  LegalAction["kind"],
  DeclarationWindowKind
> = {
  // --- 02:190 の4カテゴリ: apply ハンドラ自身が preDeclarationStackWindow/stackWindow
  //     (または同種の応答窓) を開く ---
  summon: "opens_own_window",
  place_nexus: "opens_own_window",
  attack: "opens_own_window",
  // P3-115 本修正: 途中合流アタックも「アタック宣言」の一種として自分の窓を開く
  // (joinActiveAttackAsAction 自体は nested 呼び出し専用プリミティブのまま維持し、
  // useJoinActiveAttackAsAction/confirmJoinActiveAttackDeclarationAsAction を新設)。
  join_active_attack: "opens_own_window",
  decline_immediate_attack_join: "not_a_declaration",
  // BSDB01-TX01(A) 型: アタック宣言の代替宣言。declare_manifest と同型の
  // openEffectDeclarationStackWindow 経由で自分の窓を開く。
  flip_instead_of_attack: "opens_own_window",
  block: "opens_own_window",
  use_field_card_effect: "opens_own_window",
  use_hand_card_effect: "opens_own_window",
  // battle_immediate 効果 (アタック時/ブロック時/バトル終了時等) の能動発揮宣言。
  resolve_battle_immediate_effect: "opens_own_window",
  use_magic: "opens_own_window",
  use_accel: "opens_own_window",
  use_change: "opens_own_window",
  use_divine_skill: "opens_own_window",
  declare_advent: "opens_own_window",
  declare_host_dual_advent: "opens_own_window",
  declare_dual_host_advent: "opens_own_window",
  declare_manifest: "opens_own_window",
  contract_combine: "opens_own_window",
  link_aid: "opens_own_window",
  // メインステップ中にプレイヤーが能動宣言するセット/魂状態化。02:188-190
  // 「召喚/配置/使用、常時以外の効果発揮」+ 各ギミック SSOT
  // (08c:81-87, 07:161-163, 01:118) により、コスト支払い後に自分の宣言窓を開く。
  // 効果文内の set/enter_soul_state は外側効果の解決中処理なのでここには含めない (02:191)。
  set_mirage: "opens_own_window",
  set_quartz: "opens_own_window",
  activate_soul_state: "opens_own_window",
  // バースト発動宣言 (openBurstActivationStackWindow)。
  resolve_pending_burst_check: "opens_own_window",
  // 「発揮宣言」の確定アクション。mechanic (神託/解封/創界石転醒) 付き pending は
  // card 効果 registration を持たないため同期解決するが、カード紐付き誘発効果
  // (主経路) は openEffectDeclarationStackWindow 経由で窓を開く。
  resolve_pending_triggered_effect: "opens_own_window",
  // 召喚コスト除外 (トラッシュ除外) 選択解決後に召喚宣言の窓を開く (P3-34 系)。
  resolve_pending_summon_cost_exclude_choice: "opens_own_window",
  // 召喚コスト・トラッシュコア移動選択解決後に召喚宣言の窓を開く (BSSL01-M02 型、同型)。
  resolve_pending_summon_cost_core_move_choice: "opens_own_window",
  // before/after block flash 窓 (activeAttack.flashWindowState) を開く。
  // preDeclarationStackWindow/stackWindow とは別種の窓だが、同じ「宣言に対する応答
  // 機会を自ら開く」責務を負うため opens_own_window に分類する。
  open_battle_flash: "opens_own_window",

  // --- 既に窓を開いた別の宣言 (主に summon) の解決過程で生じる後続選択・置換 ---
  resolve_brave_combine_choice: "nested_or_deferred",
  resolve_tensho_summon: "nested_or_deferred",
  resolve_reverse_rebirth_summon: "nested_or_deferred",
  resolve_brave_leave_choice: "nested_or_deferred",
  resolve_advent_source_replacement: "nested_or_deferred",
  resolve_soul_state_replacement: "nested_or_deferred",
  resolve_brave_attack_continuation: "nested_or_deferred",

  // --- resolve_*/pass_*/対象選択/管理系 (新規スタック宣言ではない) ---
  resolve_pending_deck_reveal_pick: "not_a_declaration", // pendingDeckReveal
  resolve_pending_deck_reveal_order: "not_a_declaration", // pendingDeckReveal
  resolve_pending_zone_selection: "not_a_declaration", // pendingZoneSelection
  resolve_set_aside_exit_replacement_choice: "not_a_declaration", // pendingSetAsideExitReplacementChoice
  resolve_pending_step_optional_choice: "not_a_declaration", // pendingStepOptionalChoice
  resolve_pending_step_choice: "not_a_declaration", // pendingStepChoice: 02:197-199
  resolve_connect_battle_decision: "not_a_declaration", // pendingConnectBattleDecision
  resolve_pending_deck_reveal_count_boost_choice: "not_a_declaration", // pendingDeckRevealCountBoostChoice
  resolve_pending_step_optional_target_selection: "not_a_declaration", // pendingStepOptionalTargetSelection
  resolve_pending_draw_step_cost_choice: "not_a_declaration", // pendingDrawStepCostChoice
  resolve_pending_grouped_summon_cost_override_choice: "not_a_declaration", // pendingGroupedSummonCostOverrideChoice
  resolve_pending_life_damage_discard_choice: "not_a_declaration", // pendingLifeDamageDiscardChoice
  resolve_pending_life_gain_replacement_choice: "not_a_declaration", // pendingLifeGainReplacementChoice
  resolve_pending_core_shoot: "not_a_declaration", // pendingCoreShootSelection
  resolve_pending_effect_target: "not_a_declaration", // pendingEffectTargetSelection
  resolve_pending_as_if_soul_core_choice: "not_a_declaration", // pendingAsIfSoulCoreChoice
  resolve_pending_effect_optional_repeat_choice: "not_a_declaration", // pendingEffectOptionalRepeatChoice
  resolve_pending_effect_optional_repeat_count: "not_a_declaration", // pendingEffectOptionalRepeatCountSelection
  resolve_borrowed_effect_choice: "not_a_declaration", // pendingBorrowedEffectChoice
  resolve_borrowed_effect_target: "not_a_declaration", // pendingBorrowedEffectTargetSelection
  resolve_pay_to_act_core_gate: "not_a_declaration", // pendingPayToActCoreGate
  resolve_pay_to_act_hand_discard_gate: "not_a_declaration", // pendingPayToActHandDiscardGate
  resolve_field_magic_pre_cost_trigger: "not_a_declaration", // pendingFieldMagicPreCostTrigger
  resolve_pending_core_split: "not_a_declaration", // pendingCoreSplitSelection
  resolve_pending_split_summon_choice: "not_a_declaration", // pendingSplitSummonChoice
  resolve_pending_core_count: "not_a_declaration", // pendingCoreCountSelection
  resolve_pending_count_decrease: "not_a_declaration", // pendingCountSelection
  resolve_pending_discard_set_burst_count: "not_a_declaration", // pendingDiscardSetBurstCountSelection
  resolve_pending_life_core_selection: "not_a_declaration", // pendingLifeCoreSelection
  resolve_core_source_allocation: "not_a_declaration", // pendingCoreSourceAllocation
  resolve_pending_link_aid_cost_source_choice: "not_a_declaration", // pendingLinkAidCostSourceChoice
  resolve_pending_effect_summon_cost_payment: "not_a_declaration", // pendingEffectSummonCostPayment
  resolve_pending_core_distribution: "not_a_declaration", // pendingCoreDistribution
  abort_pending_core_distribution: "not_a_declaration", // pendingCoreDistribution
  resolve_pending_change_cleanup_choice: "not_a_declaration", // pendingChangeCleanupChoice
  resolve_pending_enter_field_placement: "not_a_declaration", // pendingEnterFieldPlacement
  resolve_pending_multi_placement: "not_a_declaration", // pendingMultiPlacement
  abort_pending_multi_placement: "not_a_declaration", // pendingMultiPlacement
  confirm_target_redirect: "not_a_declaration", // pendingTargetRedirects
  decline_target_redirect: "not_a_declaration", // pendingTargetRedirects
  decline_pending_burst_check: "not_a_declaration", // pendingBurstChecks
  select_pending_to_resolve: "not_a_declaration", // pendingTriggeredEffects: 02:197-199
  declare_private_triggered_effect: "not_a_declaration", // pendingPrivateDeclarations
  skip_private_triggered_effect: "not_a_declaration", // pendingPrivateDeclarations
  pass_battle_flash: "not_a_declaration", // 02:189 activeAttack.flashWindowState pass/close
  pass_stack: "not_a_declaration", // 02:189 既に開いた stack 窓の pass/close。新規宣言ではない。
  pass_pre_declaration_stack: "not_a_declaration", // 02:189/02:192 宣言前 stack 窓の pass/confirm。新規宣言ではない。
  decline_block: "not_a_declaration", // 02:206 ブロック宣言を行わない基本バトル進行。ブロック宣言そのものではない。
  end_attack_step: "not_a_declaration", // 02:206 通常進行の step advance。効果由来 end_attack_step は EffectAction/executeEndAttackStep。
  // バーストを裏向きでセットする準備動作。バースト発動そのものは
  // resolve_pending_burst_check 側で窓が開く。
  set_burst: "not_a_declaration", // 04b:9-10 裏向きセット準備。バースト発動宣言は resolve_pending_burst_check (02:213)。
  // swap_hand_trash/decline_hand_trash_swap は既に開いた pendingHandTrashSwapChoice の
  // 解決であり新規宣言ではない (legal-actions.ts:1237 gating 確認済み)。
  swap_hand_trash: "not_a_declaration", // pendingHandTrashSwapChoice
  decline_hand_trash_swap: "not_a_declaration", // pendingHandTrashSwapChoice
  swap_field_hand: "not_a_declaration", // pendingFieldHandSwapChoice
  decline_field_hand_swap: "not_a_declaration", // pendingFieldHandSwapChoice
  // P3-116 裁定確定 (2026-07-08, 信頼度B): 合体/交換/分離は02:190の4カテゴリに該当せず
  // 02:209「基本ステップ処理」に整合 (10_rules/05_brave-and-attack-special-cases.md
  // §合体/交換/分離とスタック窓)。not_a_declaration が正しい。
  brave_combine: "not_a_declaration", // 02:209 基本ステップ処理 (10_rules/05_brave-and-attack-special-cases.md §合体/交換/分離とスタック窓)
  brave_swap: "not_a_declaration", // 02:209 基本ステップ処理 (10_rules/05_brave-and-attack-special-cases.md §合体/交換/分離とスタック窓)
  brave_separate: "not_a_declaration", // 02:209 基本ステップ処理 (10_rules/05_brave-and-attack-special-cases.md §合体/交換/分離とスタック窓)
};
