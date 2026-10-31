import type { BattleImmediateEffectActionRegistrationLookup } from "./battle-immediate-effect-system";
import type {
  ActiveStack,
  BattleFlashWindowKind,
  CardDefinition,
  GameState,
  PreDeclarationStackWindow,
} from "../model";

export type AttackDeclarationBlockReason =
  | "not_attack_step"
  | "not_active_player"
  | "window_not_open"
  | "source_not_controlled_by_acting_player"
  | "source_not_on_field"
  | "source_pending_leave"
  | "source_is_attached"
  | "source_category_cannot_attack"
  | "source_not_ready"
  | "another_attack_in_progress"
  // 「このスピリットは可能ならこのターンの最初にアタックする」CE 保持カードが
  // 現に合法アタック宣言可能な間、他カードのアタック宣言を抑止する
  // (ENGINE-force-first-attack-this-turn, BSTH02.7-TR02(A))。
  | "forced_first_attacker_pending";

export type JoinActiveAttackBlockReason =
  | "not_attack_step"
  | "not_active_player"
  | "no_active_attack"
  | "source_not_controlled_by_acting_player"
  | "source_not_on_field"
  | "source_pending_leave"
  | "source_is_attached"
  | "source_category_cannot_attack"
  | "source_not_ready"
  | "source_already_in_active_attack";

export type BlockDeclarationBlockReason =
  | "not_attack_step"
  | "no_active_attack"
  | "pending_battle_immediate_effects"
  | "window_not_open"
  | "active_attack_not_targeting_player"
  | "not_defending_player"
  | "source_not_controlled_by_acting_player"
  | "source_not_on_field"
  | "source_pending_leave"
  | "source_is_attached"
  | "source_category_cannot_block"
  | "source_not_ready"
  | "source_already_in_active_attack"
  | "source_already_blocking"
  | "participant_not_in_active_attack"
  | "participant_not_ready"
  | "participant_already_blocked"
  | "attacker_unblockable"
  // P2-05: ブロック数上限到達 (単体=1 / 同時アタックは blockerCapacity)
  | "block_capacity_reached"
  // P2-05: 防御側が「これ以上ブロックしない」を宣言済み
  | "block_declaration_completed"
  // P2-05 Phase 5: 別の participant が複数体ブロック強制の途中 (必要数未満) で、
  // それを完了するまで他の participant への新規ブロック宣言は不可
  | "pending_incomplete_multi_block"
  // P2-05 Phase 5: 複数体ブロック強制 (requiredBlockerCount>=2) の 1 体目宣言時、
  // 要求数を満たせる候補が場に揃っていない (このアタッカーはブロック不可能)
  | "insufficient_blockers_for_required_multi_block"
  // 「可能ならブロックする」効果の対象 participant に合法ブロッカーが残っている間、
  // 別 participant へのブロック宣言を抑止する
  | "required_block_if_able_pending";

/**
 * P3-55 Phase B: 防御側 (非アクティブプレイヤー) の「ブロックしない」意思表示が
 * legal にならない理由。
 * - `not_attack_step`: 攻撃ステップ外
 * - `not_defending_player`: アクティブプレイヤー (=攻撃側) は decline できない
 * - `no_active_attack`: 進行中のアタックがない
 * - `pending_battle_immediate_effects`: 未解決の battle immediate effect が残っている
 * - `before_block_flash_not_completed`: before_block flash がまだ完了していない
 * - `block_already_declared`: 既に少なくとも 1 体ブロック宣言済 (decline は手遅れ)
 * - `required_block_if_able`: 「可能ならブロックする」効果中に合法ブロッカーがいる
 * - `flash_window_open`: フラッシュ窓が開いている (まずパス/効果使用)
 * - `window_not_open`: window state が decline_block を許す状態にない
 * - `battle_resolution_group_already_exists`: 既に解決中
 */
export type DeclineBlockBlockReason =
  | "not_attack_step"
  | "not_defending_player"
  | "no_active_attack"
  | "pending_battle_immediate_effects"
  | "before_block_flash_not_completed"
  | "block_already_declared"
  | "required_block_if_able"
  | "flash_window_open"
  | "window_not_open"
  | "battle_resolution_group_already_exists";

export type OpenBattleFlashBlockReason =
  | "not_attack_step"
  | "not_active_player"
  | "no_active_attack"
  | "pending_battle_immediate_effects"
  | "battle_resolution_group_already_exists"
  | "window_not_open"
  | "flash_window_already_open"
  | "flash_window_already_completed"
  | "after_block_flash_not_available"
  // P2-05: 複数ブロックの宣言がまだ完了していない (防御側の追加 block / decline 待ち)
  | "block_declaration_not_completed";

export type PassBattleFlashBlockReason =
  | "not_attack_step"
  | "no_active_attack"
  | "flash_window_not_open"
  | "flash_window_state_missing"
  | "not_priority_player";

export interface UseAttackAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetInstanceId?: string; // 指定アタック対象スピリット (未設定=通常アタック)
  /** attack_exhaust_cost_gate の支払いに疲労させるカード。 */
  attackExhaustCostSourceInstanceId?: string;
  /** attack_exhaust_cost_gate が重複したときの支払い元一覧。 */
  attackExhaustCostSourceInstanceIds?: string[];
  /** 同時アタック追加参加体ごとの attack_exhaust_cost_gate 支払い元。 */
  additionalAttackExhaustCostSourceInstanceIds?: Record<
    string,
    string | string[]
  >;
  /** battle_destroy_cost_gate_attack/both の支払いに破壊するカード (BSDB01-C09)。 */
  battleDestroyCostSourceInstanceId?: string;
  /** battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
  /**
   * 同時アタック宣言の追加参加カード (P2-05)。
   * allow_simultaneous_attack CE がある場合のみ指定可。指定アタックとの併用不可。
   */
  additionalSourceInstanceIds?: string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /**
   * P3-37 follow-up + P3-39: アタック宣言で生じる二次イベント (card_exhausted 等) の
   * リスナー判定に使用。 P3-39 で必須化（未指定だとリスナー無し event が空 pending として残るため）。
   */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
}

export interface AttackDeclarationResult {
  state: GameState;
  entityId: string;
  attackId: string;
}

export interface JoinActiveAttackOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  /** attack_exhaust_cost_gate の支払いに疲労させるカード。 */
  attackExhaustCostSourceInstanceId?: string;
  /** attack_exhaust_cost_gate が重複したときの支払い元一覧。 */
  attackExhaustCostSourceInstanceIds?: string[];
  /** pre-declaration stack window を開く前に支払い済みの場合は二重払いしない。 */
  attackExhaustCostAlreadyPaid?: boolean;
  /** battle_destroy_cost_gate_attack/both の支払いに破壊するカード (BSDB01-C09)。 */
  battleDestroyCostSourceInstanceId?: string;
  /** battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
  /** pre-declaration stack window を開く前に支払い済みの場合は二重払いしない。 */
  battleDestroyCostAlreadyPaid?: boolean;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /** P3-14 C-2: 「〜がアタックしたとき」game_event 観測トリガーのキューイングに使用 (省略時は空 lookup)。 */
  getRegisteredTriggeredEffectActions?: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  /**
   * 合流の種別 (P2-05)。省略時 "mid_battle" (効果による途中参加 = 従来挙動)。
   * "simultaneous_declaration" = 同時アタック宣言の一部としての合流。
   * group 全体で「アタックしたとき」観測は 1 回 (公式 Q26342) のため
   * 観測トリガー (queueBattleDeclarationTriggers) と timing:"join" 即時効果を
   * スキップする。参加体自身の『アタック時』(timing:"attack") は発揮する (Q26329)。
   */
  joinMode?: "mid_battle" | "simultaneous_declaration";
  /**
   * 同時アタック宣言時、primary の『アタック時』と同じ同時誘発グループに
   * 束ねるための group id (解決順はターンプレイヤーが選ぶ)。
   */
  simultaneousGroupId?: string;
}

/**
 * P3-115: `join_active_attack` をプレイヤーの独立宣言として使う場合の窓オープン用
 * options。`JoinActiveAttackOptions` と異なり `getRegisteredTriggeredEffectActions`/
 * `getRegisteredBurstActions` を必須化する (`useAttackAsAction`/`useBlockAsAction` と同型)。
 */
export interface UseJoinActiveAttackAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  /** attack_exhaust_cost_gate の支払いに疲労させるカード。 */
  attackExhaustCostSourceInstanceId?: string;
  /** attack_exhaust_cost_gate が重複したときの支払い元一覧。 */
  attackExhaustCostSourceInstanceIds?: string[];
  /** battle_destroy_cost_gate_attack/both の支払いに破壊するカード (BSDB01-C09)。 */
  battleDestroyCostSourceInstanceId?: string;
  /** battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
}

export interface UseBlockAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  participantEntityId: string;
  /** battle_destroy_cost_gate_block/both の支払いに破壊するカード (BSDB01-C09)。 */
  battleDestroyCostSourceInstanceId?: string;
  /** battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /** P3-39: pre_declaration_block stack window の listener 解決に使用。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
}

export interface BlockDeclarationResult {
  state: GameState;
  attackId: string;
  blockerEntityId: string;
  participantEntityId: string;
}

/**
 * P3-55 Phase B: `decline_block` apply は battle resolution group 作成 + BP 比較 +
 * ライフ減少 + entity 破壊 + 二次イベント listener pending の生成までを一括で実行する。
 * `pass_battle_flash` (after_block close) からの auto-chain も同じ実体 helper を呼ぶ。
 */
export interface UseDeclineBlockAsActionOptions {
  state: GameState;
  /** 防御側 (非アクティブ) プレイヤーの ID */
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /**
   * P3-37 follow-up + P3-39: バトル解決で生じる二次イベントのリスナー判定に使用。
   * P3-39 で必須化（未指定だとリスナー無し event が空 pending として残るため）。
   */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
}

/** P3-55 Phase B: decline_block apply の結果 (battle resolution まで完了済)。 */
export interface DeclineBlockResult {
  state: GameState;
  attackId: string;
  totalLifeDamage: number;
  destroyedEntityIds: string[];
}

/**
 * P3-55 Phase B: バトル解決 helper の入力。decline_block apply と
 * pass_battle_flash (after_block close) からの auto-chain で共有する。
 */
export interface ExecuteBattleResolutionOptions {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
}

/** P3-55 Phase B: executeBattleResolution の戻り値 (DeclineBlockResult と同形)。 */
export interface ExecuteBattleResolutionResult {
  state: GameState;
  attackId: string;
  totalLifeDamage: number;
  destroyedEntityIds: string[];
}

export interface UseOpenBattleFlashAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  flashKind: BattleFlashWindowKind;
}

export interface OpenBattleFlashResult {
  state: GameState;
  attackId: string;
  flashKind: BattleFlashWindowKind;
}

export interface UsePassBattleFlashAsActionOptions {
  state: GameState;
  actingPlayerId: string;
}

export type PassBattleFlashOutcome =
  | "priority_transferred"
  | "stack_closed_needs_resolution"
  | "flash_window_closed";

export interface PassBattleFlashResult {
  state: GameState;
  attackId: string;
  flashKind: BattleFlashWindowKind;
  closed: boolean;
  nextPriorityPlayerId: string | null;
  outcome: PassBattleFlashOutcome;
  resolvedStack: ActiveStack | null; // 互換保持（常に null）
  // stack_closed_needs_resolution のときセット（1-pass cascade: LIFO 順、最初が最内側）
  resolvedStacks: ActiveStack[];
}

export type PassPreDeclarationStackBlockReason =
  | "not_in_pre_declaration_stack_window"
  | "not_priority_player";

// 1-pass cascade モデル: 片方がパスした時点で pre_declaration_stack 窓は即閉じ、
// 保留スタックは LIFO で全て解決。
// priority_transferred は attack/block 宣言成立時に legal-actions-apply.ts から返される
// 兼用結果として残存（宣言直後のステート遷移用）。
export type PassPreDeclarationStackOutcome =
  | "priority_transferred"
  | "stack_closed";

export interface UsePassPreDeclarationStackAsActionOptions {
  state: GameState;
  actingPlayerId: string;
}

export interface PassPreDeclarationStackResult {
  state: GameState;
  outcome: PassPreDeclarationStackOutcome;
  closedWindow: PreDeclarationStackWindow | null; // stack_closed のときセット
  resolvedStack: ActiveStack | null; // 互換保持（常に null）
  // 1-pass cascade: LIFO 順の解決対象スタック群（最初が最内側）。stack_closed のときのみセット。
  resolvedStacks: ActiveStack[];
}
