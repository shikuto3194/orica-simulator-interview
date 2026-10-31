import type { EnterFieldCorePlacement } from "./zone/enter-field-placement-execution";
import { assertTriggerChainId } from "./chain-id";
import { getCEsForTarget } from "./card/ce-lookup";
import type {
  BattleImmediateEffectSourceKind,
  EffectSourceKind,
  FieldEffectSourceKind,
} from "./source-kinds";
import type { TargetLockBypassProfile } from "./effect/target-affect-gate";

export type SourceConfidence = "A" | "B" | "C";

export type CardCategory = "spirit" | "brave" | "ultimate" | "nexus" | "magic";

export type CardColor =
  | "red"
  | "purple"
  | "green"
  | "white"
  | "yellow"
  | "blue"
  | "black";

/** 全カードカラーの定数配列（7色: 赤/紫/緑/白/黄/青/黒）。 */
export const CARD_COLORS: readonly CardColor[] = [
  "red",
  "purple",
  "green",
  "white",
  "yellow",
  "blue",
  "black",
] as const;

/**
 * カード色の配列から重複なしの色数を返す。
 * 例: ["red","red","blue"] → 2, 全7色 → 7
 */
export function countUniqueColors(colors: readonly CardColor[]): number {
  return new Set(colors).size;
}

/**
 * カード色の配列が色数条件を満たすか判定する。
 *
 * - `min` のみ: 「N色以上」（六色以上 = min:6, 七色 = min:7）
 * - `max` のみ: 「N色以下」
 * - `min === max`: 「ちょうどN色」（六色 = min:6, max:6）
 *
 * ルール: 六色 ≠ 七色。七色は「六色以上」に含まれる。
 */
export function matchesColorCount(
  colors: readonly CardColor[],
  min?: number,
  max?: number
): boolean {
  const count = countUniqueColors(colors);
  if (min !== undefined && count < min) return false;
  if (max !== undefined && count > max) return false;
  return true;
}

/**
 * 指定系統セットを持たない効果から「見えない/触れない」保護カウント量を返す。
 * 「追加したカウントは系統：「X」を持たない効果で数えられず、その効果を受けない」
 * を計算するための共通ヘルパ（条件評価でのカウント値・カウント減少の床値の双方で使う）。
 *
 * @param protectedCounts 保護元系統 → 保護カウント量（PlayerState.protectedCounts）
 * @param sourceTribes    効果ソースの系統リスト（`def.tribe.split("・")`）
 */
export function immuneProtectedCount(
  protectedCounts: Readonly<Record<string, number>> | undefined,
  sourceTribes: readonly string[]
): number {
  if (!protectedCounts) return 0;
  let sum = 0;
  for (const [tribe, amount] of Object.entries(protectedCounts)) {
    if (!sourceTribes.includes(tribe)) sum += amount;
  }
  return sum;
}

/**
 * 保護カウントの合計が newCount を超えないように縮める。
 * sourceTribes を持つ（=効果で減らせる）系統バケットから優先して削り、
 * 持たない（=床で保護される）バケットは可能な限り温存する。
 */
export function shrinkProtectedCounts(
  protectedCounts: Readonly<Record<string, number>> | undefined,
  newCount: number,
  sourceTribes: readonly string[] = []
): Record<string, number> | undefined {
  if (!protectedCounts) return undefined;
  const next: Record<string, number> = { ...protectedCounts };
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  let overflow = total - newCount;
  if (overflow <= 0) return next;
  const reducibleFirst = Object.keys(next).sort((a, b) => {
    const ar = sourceTribes.includes(a) ? 0 : 1;
    const br = sourceTribes.includes(b) ? 0 : 1;
    return ar - br;
  });
  for (const tribe of reducibleFirst) {
    if (overflow <= 0) break;
    const cur = next[tribe] ?? 0;
    const take = Math.min(overflow, cur);
    next[tribe] = cur - take;
    overflow -= take;
    if (next[tribe] === 0) delete next[tribe];
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/**
 * countValue / protectedCounts を更新した PlayerState を返す。
 * protectedCounts が空/undefined のときは exactOptionalPropertyTypes に従い
 * プロパティ自体を落とす。
 */
export function withCount(
  player: PlayerState,
  countValue: number,
  protectedCounts: Record<string, number> | undefined
): PlayerState {
  const { protectedCounts: _drop, ...rest } = player;
  return protectedCounts && Object.keys(protectedCounts).length > 0
    ? { ...rest, countValue, protectedCounts }
    : { ...rest, countValue };
}

/**
 * 特殊シンボル。カードカラーではないが、軽減やシンボルとして使われる。
 * - "god": 神シンボル
 * - "guide": 導シンボル
 * - "ultimate_symbol": 極シンボル (アルティメットシンボル)
 * - "seven": 七シンボル
 * - "six": 六シンボル
 */
export type SpecialSymbol =
  | "god"
  | "guide"
  | "ultimate_symbol"
  | "seven"
  | "six";

/** カードカラーまたは特殊シンボル。軽減・シンボル表示で使用。 */
export type SymbolColor = CardColor | SpecialSymbol;

/** 印字シンボルを物理的な1個ごとの色集合として読む。旧データは各色を1個とする。 */
export function getPrintedSymbolEntries<T extends string>(definition: {
  symbolColors?: readonly T[];
  symbolColorEntries?: readonly (readonly T[])[];
}): T[][] {
  return definition.symbolColorEntries
    ? definition.symbolColorEntries.map((colors) => [...colors])
    : (definition.symbolColors ?? []).map((color) => [color]);
}

export type Zone =
  | "token_pool"
  | "deck"
  | "hand"
  | "revealed" // オープン中の一時状態。デッキ/手元/フィールド等の実ゾーンではない。
  | "set_aside" // 手元ゾーン（アクセル等で使用。手札操作効果の対象外。通常召喚は可能）
  | "burst"
  | "field"
  | "trash"
  | "life"
  | "reserve"
  | "void"
  | "removed_from_game"
  | "in_use" // 宣言後・解決前の中間ゾーン (hand→in_use→trash/field)
  | "mirage" // ミラージュセットゾーン
  | "count_area"; // カウントエリア

/** カード移動先。ボイドはコア専用であり、カード除外は removed_from_game を使う。 */
export type CardZone = Exclude<Zone, "void">;

export function isCardZone(zone: Zone): zone is CardZone {
  return zone !== "void";
}

/** 汎用ゾーンを持つ保存状態からカード移動を復元するときも境界を検証する。 */
export function requireCardZone(zone: Zone): CardZone {
  if (!isCardZone(zone)) {
    throw new Error(
      "Cards cannot move to void; use removed_from_game for exclusion"
    );
  }
  return zone;
}

export type EffectActivationSourceZone =
  | "hand"
  | "deck"
  | "set_aside"
  | "trash"
  | "field"
  | "mirage"
  | "advent_source"
  | "soul_state";

export type Step =
  | "start"
  | "core"
  | "draw"
  | "refresh"
  | "main"
  | "attack"
  | "end";

export type Window =
  | "none"
  | "stack" // 効果発揮宣言後の 1-pass cascade スタック窓（ステップ非依存。元 "main_step_stack"）
  | "step_start" // 汎用: ステップ開始時効果誘発窓（将来の全ステップ共通パターン用）
  | "declare_attack"
  | "pre_declaration_stack" // 宣言前スタック窓: attack/block 宣言の成立前に相手が割り込める
  | "flash_before_block"
  | "stack_before_block" // battle flash 中に action 使用後、stack だけを許す独立窓
  | "declare_block"
  | "flash_after_block"
  | "stack_after_block" // battle flash 中に action 使用後、stack だけを許す独立窓
  | "battle_resolution"
  | "step_end" // 汎用: ステップ終了時効果誘発窓（将来の全ステップ共通パターン用）
  | "end_step_effects"
  | "end_step_end_effects"
  | "end_step_cleanup";

/**
 * 待機状態 (queuePendingLeave で記録される離脱予定) の種別。
 *
 * - destroy: 破壊 → トラッシュ
 * - vanish: 消滅 → トラッシュ
 * - bounce: バウンス → 手札（または手元 / デッキトップ等）
 * - remove_from_game: ゲームから除外 → removed_from_game ゾーン
 *   ENGINE-remove-from-game-attached-brave-orphan Step 1-4 (2026-06) で
 *   `executeRemoveFromGame` のフィールド対象は `queuePendingLeave` 経由化済み。
 *   `flushPendingLeaves` が destination 分岐 / 合体ブレイヴ choice / 煌臨元追従 /
 *   魂状態 cleanup / コアリザーブ復帰 / B→A 面復帰を一括処理し、BSLH01-T10[1]
 *   等の合体ブレイヴ orphan を解消する。非フィールド対象 (set_aside / in_use /
 *   hand 等) は離脱機構が無いため queuePendingLeave に通さず直接書き換え。
 * - rule_cleanup: ルール上フィールドに存在できない不正状態の清掃 → トラッシュ
 *   destroy / vanish / bounce / leave_field 誘発を出さない。
 */
export type PendingLeaveKind =
  | "destroy"
  | "vanish"
  | "bounce"
  | "remove_from_game"
  | "rule_cleanup";
export type PendingLeaveCause =
  | "state_based_action"
  | "cost_payment"
  | "effect_resolution"
  | "bp_compare"
  | "battle";

export type ExhaustState = "recovered" | "exhausted" | "heavily_exhausted";
export type PlayerScopedSoulCoreLocation =
  | {
      kind: "card";
      instanceId: string;
    }
  | {
      kind: "reserve";
    }
  | {
      kind: "trash";
    }
  | {
      kind: "life";
    }
  | {
      kind: "removed_from_game";
    };

export type NormalCoreContainer =
  | {
      kind: "card";
      instanceId: string;
    }
  | {
      kind: "reserve";
      playerId: string;
    }
  | {
      kind: "trash";
      playerId: string;
    }
  | {
      kind: "life";
      playerId: string;
    }
  | {
      kind: "void";
      playerId: string;
    };

export type SoulCoreContainer =
  | {
      kind: "card";
      instanceId: string;
    }
  | {
      kind: "reserve";
      playerId: string;
    }
  | {
      kind: "trash";
      playerId: string;
    }
  | {
      kind: "life";
      playerId: string;
    }
  | {
      kind: "void";
      playerId: string;
    }
  | {
      kind: "removed_from_game";
    };

export type LifeCoreKind = "normal" | "soul";
export type BattleImmediateEffectTiming =
  | "attack"
  | "block"
  | "battle"
  | "join";
export type TriggerEventSource =
  | "action_resolution"
  | "battle_resolution"
  | "step_transition"
  | "burst_post_resolution"
  | "window_transition";
/**
 * 誘発イベントの原因種別。
 * leave_field 系では pendingLeave.cause / causePlayerId から導出し、enter_field 系では
 * 効果解決由来の場入りに限り効果コントローラーから導出する。`Timing.card_event.cause`
 * での絞り込みに使用する。
 *
 * - battle: 実バトル破壊
 * - bp_compare: 効果が引き起こした BP比べ破壊（帰属不問 / 互換用の総称）
 * - opponent_bp_compare: BP比べ破壊の勝者が対象カードから見て相手
 * - self_bp_compare: BP比べ破壊の勝者が対象カードの controller 自身
 * - opponent_effect: 相手効果（state-based でも causePlayerId が相手帰属なら opponent_effect）
 * - self_effect: 自分効果
 * - state_based: state-based-action 由来で causePlayerId 未帰属（unattributed）
 * - state_based_self: state-based-action 由来で causePlayerId が所有者自身（自分のコア移動等）
 *   ── 「自分による消滅では発揮されない」型の triggerFilter で除外するために state_based と分離。
 *   matcher で `state_based` のみを許可しても、self 帰属の state-based vanish は発火しない。
 * - contract_combine: P3-111 S3。`brave_combined` イベントのうち、契約合体
 *   (`contract_combine` legal action。手札からソウルコアコストで合体) 経路由来の attach 遷移
 *   にのみ付与する。召喚時合体/直接合体（`brave_combine` / `resolve_brave_combine_choice`）の
 *   attach 遷移では付与しない (cause 未設定のまま)。「契約合体時」限定トリガーを
 *   `Timing.card_event.cause:["contract_combine"]` で表現するための区別軸
 *   （ENGINE-contract-combine-event-distinction）。
 */
export type TriggerEventCause =
  | "opponent_effect"
  | "self_effect"
  | "battle"
  | "bp_compare"
  | "opponent_bp_compare"
  | "self_bp_compare"
  | "state_based"
  | "state_based_self"
  | "contract_combine";
export type StructuredTriggerEventFamily =
  | "game_start"
  | "life"
  | "leave_field"
  | "action_after"
  /**
   * own_attack 専用 (BurstTrigger.own_attack)。「アタック宣言点」は action_after
   * (attack_finished、defender 向け「アタック後」) と時点は同じだが、attacker 自身
   * 向けの own_attack を actionKind だけで区別すると、将来 attack_finished に
   * player:"self" (『自分のスピリットのアタック後』型) が追加された際に whose 側
   * だけで own_attack と誤マッチしうる (adversarial verifier 2026-07-23 指摘)。
   * family 自体を分離して eventKind 名前空間を matcher レベルでも独立させる。
   */
  | "action_declared"
  | "enter_field"
  | "hand_increase"
  | "step_timing"
  | "state_change"
  /** F2: 魂状態化（ENIGMA「魂状態になったとき」）。 */
  | "soul_state_change"
  /** F2: クォーツセット（ENIGMA「クォーツがセットされたとき」）。 */
  | "quartz_set"
  /**
   * ENGINE-mirage-set-card-event-trigger: ミラージュカードがセットされたとき
   * (card_event 自己誘発、「このカードのセット時」)。quartz_set/enter_soul_state と
   * 同型の mirageSetStates 差分検出で発火する (BSTH002-C04)。
   */
  | "mirage_set"
  /**
   * ENGINE-field-hand-swap-trigger: 【聖詠】フィールド⇄手札入れ替え成立
   * (card_event 自己誘発 + game_event(player) 観測、両用)。BSSG01-C03/C04/C05。
   */
  | "field_hand_swap"
  | "after_draw"
  | "declaration_timing"
  | "payment_timing"
  /**
   * P3-67 Phase 3: 特定 timing の効果発揮を見るメタイベント。
   * 「相手の『召喚時』発揮後」等のバースト発動条件に使う。
   * actionKind で発揮された効果の timing (summon=召喚時 / placement=配置時 /
   * advent=煌臨時) を区別する。
   */
  | "effect_activation"
  | "effect_steps_resolved"
  | "effect_completed"
  | "card_used"
  /**
   * P3-73: 相手のフラッシュ効果使用を見る型（咲夜 BSTH01-X05「相手が手札/手元の
   * フラッシュ効果を使用したとき」）。発揮前に反応する誘発。
   */
  | "flash_use"
  /**
   * ENGINE-stack-activation-reactivation-trigger: 相手のスタック効果 (mode:"stack")
   * が完全解決した後を見る型（BSTH02.7-X01 effects[2]「相手がスタック効果を発揮した
   * とき」）。flash_use と異なり発揮**後**に反応する誘発 (magic_stack_domain と同じ
   * 「完全解決後」裁定)。
   */
  | "stack_use"
  /**
   * P3-75: 未解決 ActiveStack の効果発揮宣言を見る型。
   * 発揮前無効化が magic / accel / stack 効果を横断して反応するための汎用入口。
   */
  | "effect_declaration"
  /**
   * P3-76: 相手効果の対象集合が解決時に確定した直後、作用実行前に開示されるイベント。
   * relatedInstanceId = 対象になったカード、relatedPlayerId = その時点の controller。
   */
  | "targeting"
  | "battle_destroy_opponent_only"
  /**
   * P3-14 C-2: アタック/ブロック宣言成立後のイベント（「〜がアタック/ブロックしたとき」
   * を他カードが監視する game_event 用）。actionKind で attack / block を区別。
   * 宣言「前」(declaration_timing) とも、自カードの『アタック時』(battle immediate 系)
   * とも別系統。
   */
  | "battle_declaration"
  /**
   * P3-14 C-2: ブレイヴ合体成立イベント（「合体したとき」）。relatedInstanceId は
   * 合体したブレイヴ。BSRK01-X01 合体結誓 / BSAZ01-C18 系の観測元。
   */
  | "brave_link"
  /**
   * P3-14 C-2: コア配置イベント（現状はライフへの配置のみ発火: core_placed_on_life）。
   * relatedPlayerId = ライフの持ち主。BSTH03-C21「自分の黄/紫の効果でライフにコアを
   * 置いたとき」。他ゾーンへの拡張は実カード需要時に variant を追加する。
   */
  | "core_change"
  /**
   * 「バトル終了時」。バトルが解決し終えた時点で、バトル参加カード自身の
   * `card_event: "battle_end"` 効果を誘発する。`アタックステップ終了時` (step_timing) とは別物。
   */
  | "battle_end"
  /**
   * 「(契約)カウントが増えたとき」。PlayerState.countValue の増加を見るメタイベント。
   * relatedPlayerId = カウントが増えたプレイヤー。game_event(player) で per-player routing する。
   */
  | "count_increase"
  /**
   * 「カウントが減ったとき」。PlayerState.countValue の減少を見るメタイベント。
   * count_increase の対称版（逆転醒トリガー BSTH03-転醒R01(B) ほか）。
   */
  | "count_decrease"
  /**
   * ENGINE-void-core-decrease-trigger: ボイドのコアが減った（=ボイドを起点に他ゾーンへ
   * コアが増えた）ときのイベント。relatedPlayerId = ボイドの所有者。`core_change`
   * (ライフへの配置のみ) とは別 family にし、既存 core_placed_on_life 系リスナーとの
   * 誤マッチを避ける (matcher は family+actionKind のみで照合し eventKind を見ないため、
   * family を共有すると cross-match する)。
   */
  | "void_core_change"
  /**
   * ENGINE-c09-text-role-under-card-third-party-trigger: text_role アンダーカード
   * (【アルドノアドライブ】等) が host に実配置されたときのイベント（第三者観測用）。
   * relatedInstanceId = 配置先 host。host 自身の召喚/配置/転醒 (`declaresUnderCardSlot`
   * game_event) とは別イベント — こちらは配置が実際に成立した瞬間のみ発火する
   * (host 側の任意配置が不発だと発火しない)。`core_change`/`void_core_change` と同様の
   * 理由で独立 family にする。
   */
  | "under_card_change"
  /**
   * ENGINE-soul-drive-activation-observable-event (P3-125): 【ソウルドライブ・S】発動
   * (soulCoreLocation.kind→"removed_from_game" 遷移)。relatedPlayerId = 発動した本人。
   * `core_change`/`void_core_change` と同様の理由 (誤 cross-match 回避) で独立 family にする。
   */
  | "soul_drive_activation"
  | "trash_change";
export type StructuredTriggerEventActionKind =
  | "attack"
  | "block"
  | "summon"
  | "placement"
  | "put"
  | "advent"
  | "magic_use"
  /**
   * P3-14 C-2/C-3: state_change family 内の種別判別。exhaust / recover / rebirth は
   * 同一 family のため、actionKind が無いと exhaust リスナーが recover イベントに
   * 誤マッチする (matcher は family + actionKind で照合し eventKind を見ない)。
   */
  | "exhaust"
  | "recover"
  | "rebirth"
  | "enter_soul_state"
  | "soul_state_to_spirit_state";
export type StructuredTriggerEventCauseKind =
  | "destroy"
  | "vanish"
  | "bounce"
  | "remove_from_game";
export type EffectEventScope =
  | "genkai"
  | "shouei"
  | "contract_advent"
  | "f_contract_advent";
export type EffectResolutionActionKind =
  | "magic"
  | "accel"
  | "change"
  | "field_card_effect"
  | "hand_card_effect"
  | "summon"
  | "place_nexus"
  | "burst_activation"
  | "triggered_effect"
  | "battle_immediate_effect"
  | "divine_skill"
  | "contract_combine"
  | "link_aid"
  | "declare_advent"
  | "declare_host_dual_advent"
  | "declare_dual_host_advent"
  | "declare_manifest"
  | "flip_instead_of_attack"
  | "set_mirage"
  | "set_quartz"
  | "activate_soul_state";
export type EffectActivationTiming = "main" | "flash" | "stack";
export type EffectTimingMode = EffectActivationTiming | "any";
export type StructuredTriggerEventValidationMode =
  | "snapshot_only"
  | "require_related_instance_on_field";
export interface StructuredTriggerEvent {
  family: StructuredTriggerEventFamily;
  actionKind?: StructuredTriggerEventActionKind;
  causeKind?: StructuredTriggerEventCauseKind;
  /** step_timing 系イベントでどのステップの開始/終了かを区別 */
  step?: Step;
  /** ステップ開始時 / 終了時 を区別 */
  subPhase?: "start" | "end";
  /**
   * leave_field 系イベントの「離脱原因」。
   * 相手効果 / 自分効果 / バトル / state-based を識別。
   * `Timing.card_event.cause` 指定時に絞り込みに使用する。
   */
  cause?: TriggerEventCause;
  /**
   * P3-76: targeting/leave-field event で、triggerSourceFilter 用の発揮元を保持する。
   * relatedInstanceId は対象カード用に予約し、発揮元カード/stack 種別は別軸で運ぶ。
   */
  effectSourceInstanceId?: string;
  /** 複数の実バトル source がある leave-field event 用。 */
  effectSourceInstanceIds?: string[];
  effectSourceDefinitionId?: string;
  /**
   * leave_field 等を起こした効果の防止レベル。発揮元の CardFilter とは独立し、
   * 「『防げない』状態ではない効果で…」型の trigger gate に使う。
   */
  effectSourcePreventionLevel?: EffectPreventionLevel;
  effectActionKind?: EffectResolutionActionKind;
  /** effect_declaration event の見出しラベル由来カテゴリ。 */
  effectActivationLabel?: ActivatedEffectLabel;
  effectActivationTiming?: EffectActivationTiming;
  /**
   * ENGINE-effect-immunity-own-pending-resolution: `event:"effect_declaration"` の
   * ActiveStack 宣言元ゾーンスナップショット (`getStackSourceActivationZone` 解決値)。
   * `Timing.triggerActivationZone` の絞り込み対象。
   */
  triggerActivationZone?: EffectActivationSourceZone;
  /** @deprecated コスト差分互換用。軽減シンボル充足判定には下の2フィールドを使う。 */
  effectSourceTotalReduction?: number;
  /** effect_activated 観測元カードが使用時に実際に満たした軽減シンボル枠数。 */
  effectSourceSatisfiedReductionSymbolCount?: number;
  /** effect_activated 観測元カードが使用時に要求された軽減シンボル枠数。 */
  effectSourceRequiredReductionSymbolCount?: number;
  /** `latchSourceAtEffectActivationStart` 登録用の使用時 source 候補 id。 */
  eligibleSourceInstanceIds?: string[];
  /** enter_field event を起こした効果 index。通常召喚/配置では undefined。 */
  sourceEffectIndex?: number;
  /** 同一 eventKind 内の効果名/機構スコープ。例: put + genkai。 */
  effectScope?: EffectEventScope;
  validationMode: StructuredTriggerEventValidationMode;
}
export type TriggerEventKind =
  | "card_used"
  | "game_start"
  | "reduce_life"
  | "destroy"
  | "vanish"
  | "bounce"
  | "remove_from_game"
  | "leave_field"
  | "summon"
  | "place"
  | "put"
  | "increase_hand"
  | "start_step"
  | "end_step"
  | "exhaust"
  | "recover"
  | "advent"
  /** 「転醒時」。ダブルフェイスカードが B 面へ裏返ったときに B 面の『転醒時』効果を誘発する。 */
  | "rebirth"
  | "after_draw"
  | "pre_declaration_attack"
  | "pre_declaration_block"
  | "after_cost_paid"
  /** P3-73: 相手が手札/手元のフラッシュ効果を使用したとき（咲夜 BSTH01-X05）。 */
  | "flash"
  /**
   * ENGINE-stack-activation-reactivation-trigger: 相手のスタック効果 (mode:"stack")
   * が完全解決した後（BSTH02.7-X01 effects[2]）。flash と異なり発揮後に反応する。
   */
  | "stack"
  /** P3-75: 未解決 ActiveStack の効果発揮宣言時。発揮前無効化の汎用入口。 */
  | "effect_declaration"
  /** P3-76: 効果の対象になったとき（対象確定後・作用実行前）。 */
  | "targeted"
  /** 「バトル終了時」。バトル解決完了時にバトル参加カード自身の効果を誘発する。 */
  | "battle_end"
  /** バトルで相手のスピリット/アルティメットだけを破壊したとき。 */
  | "battle_destroy_opponent_only"
  /** 「(契約)カウントが増えたとき」。PlayerState.countValue の増加で発火する。 */
  | "count_increase"
  /** 「カウントが減ったとき」。PlayerState.countValue の減少で発火する（逆転醒トリガー等）。 */
  | "count_decrease"
  /**
   * P3-14 C-2: アタック/ブロック宣言成立後（「〜がアタック/ブロックしたとき」の
   * game_event 観測用）。自カードの『アタック時/ブロック時』は battle immediate 系
   * (CARD_EVENT_TO_BATTLE_IMMEDIATE) で処理されるため、この 2 種は game_event 専用。
   */
  | "attack"
  /** E-8: アタック宣言 action_declared 系の登録済み誘発。 */
  | "attack_declared"
  | "block"
  /** P3-14 C-2: ブレイヴ合体成立（「合体したとき」）。 */
  | "brave_combined"
  /** トラッシュにカードが入った（枚数が変わらない入れ替わりも含む）。 */
  | "trash_increase"
  /** P3-14 C-2: ライフへのコア配置（「ライフにコアを置いたとき」）。 */
  | "core_placed_on_life"
  /**
   * ENGINE-c09-text-role-under-card-third-party-trigger: text_role アンダーカードが
   * host に実配置されたとき（「〜の下に「X」が置かれたとき」第三者観測）。
   * relatedInstanceId = 配置先 host。
   */
  | "text_role_under_card_placed"
  /** F2: カードが魂状態になったとき（ENIGMA「魂状態になったとき」）。relatedInstanceId=該当カード。 */
  | "enter_soul_state"
  /** F2: 魂状態からスピリット状態になったとき。relatedInstanceId=該当カード。 */
  | "soul_state_to_spirit_state"
  /** F2: クォーツがセットされたとき（ENIGMA「クォーツがセットされたとき」）。game_event(player) 観測。 */
  | "quartz_set"
  /**
   * ENGINE-mirage-set-card-event-trigger: ミラージュカードがセットされたとき
   * （「このカードのセット時」）。card_event 自己誘発。relatedInstanceId=セットされたカード。
   */
  | "mirage_set"
  /**
   * ENGINE-field-hand-swap-trigger: 【聖詠】によるフィールド⇄手札入れ替えが成立したとき。
   * brave_combined と同型で card_event/game_event 両用の単一 eventKind。
   * - card_event: 入れ替えで場に入ったカード自身の召喚時効果を再発揮する
   *   （BSSG01-C03/C04「この効果は、手札から入れ替えたときにも発揮できる」）。
   * - game_event(player): 【聖詠】を発揮した本人を観測する
   *   （BSSG01-C05「自分が【聖詠】を発揮したとき」）。
   * relatedInstanceId = 入れ替えで場に入ったカード。
   */
  | "field_hand_swap"
  /**
   * P3-92: エンジン機構由来の誘発任意効果 (PendingTriggeredEffect.mechanic 付き
   * エントリ専用)。card_event timing 登録とは一致しない（カード効果としては登録されず、
   * 解決は legal-actions-apply の mechanic 分岐で行う）。
   * - oracle: 神託/導託コア+1（対応カードの召喚/煌臨/配置/使用時、08c:125）
   * - placement_oracle: 配置時神託（創界神配置時にデッキ上 N 枚をトラッシュ＋マッチ分コア+1、08c:125）
   * - magic_stack_domain: 青マジックのスタック効果発揮時の導域
   * - unseal: 解封コア+1（創界石、カードイベント/手札増加）
   * - stone_rebirth: 創界石の転醒（コアが N 個以上になったとき裏返せる）
   * - granted_effect: grant_effect で付与された誘発効果の発火（P3-99 §3）
   */
  | "oracle"
  | "placement_oracle"
  | "magic_stack_domain"
  | "unseal"
  | "stone_rebirth"
  | "granted_effect"
  /**
   * ENGINE-void-core-decrease-trigger: 「(自分/相手が)(自分/相手の効果で)ボイドから
   * コアを増やしたとき」。relatedInstanceId を持たない player 値イベント
   * (reduce_life/count_increase 同様) → game_event(player) で使う。BSSL01-C02 effects[0]。
   */
  | "void_core_decrease"
  /**
   * ENGINE-soul-drive-activation-observable-event (P3-125): 【ソウルドライブ・S】発動コスト
   * （自分のフィールド/リザーブの<ソウルコア>1個を除外、`effectKind:"explicit_soul_core"` +
   * `CoreLocation.removed_from_game`）を観測可能にする player 値イベント。relatedInstanceId を
   * 持たない (quartz_set/void_core_decrease 同様) → game_event(player) で使う。
   * BSLH01-X03〜X10（8枚）を発火元とする。BSLH01-C07/T17 は本イベント単体では着地せず、
   * それぞれ別の追加基盤（C07=stay_on_field 貫通、T17=Duration.untilEvents）を要した
   * （issues/archive/P3-125 参照、いずれも完了済）。
   */
  | "soul_drive_activated"
  /**
   * ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A) 柱斧): card_event/game_event
   * timing で観測する「任意の効果を発揮したとき」の非バースト版。BurstEventKind の
   * "effect_activated"（family: "effect_activation"）と同じ family を共有し actionKind を
   * 指定しない wildcard matcher で照合する（発揮された効果の timing 種別を問わない）。
   * queueEffectActivationTriggers（trigger-system.ts）が maybeQueueEffectActivationBurstCheck
   * と同じ「効果発揮完了直後」の hook point で emit する。
   */
  | "effect_activated"
  | "effect_steps_resolved"
  | "effect_completed";

export interface SupplementalTriggerEvent {
  actingPlayerId: string;
  eventKind: TriggerEventKind;
  source: TriggerEventSource;
  chainId: string | null;
  attackId: string | null;
  relatedPlayerId: string | null;
  relatedInstanceId: string | null;
  amount: number | null;
  cause?: TriggerEventCause;
  fromZone?: Zone;
  triggerRelatedCombinedHostInstanceId?: string;
  semanticEventId?: number;
}

export interface SemanticTriggerEvent extends SupplementalTriggerEvent {
  semanticEventId: number;
  turnNumber: number;
  delivered?: boolean;
}

export type BurstEventKind =
  | "reduce_life"
  | "attack_after"
  | "summon"
  | "place"
  | "leave_field"
  | "exhaust"
  /** P3-67 Phase 3: 特定 timing の効果発揮を見る型 (「召喚時発揮後」等)。 */
  | "effect_activated"
  /** P3-67: 手札増加を見る型 (「相手の効果によって相手の手札が増えた後」等)。 */
  | "hand_increase"
  /** P3-67: ステップ開始/終了を見る型 (「相手のアタックステップ開始後」等)。 */
  | "step_timing"
  /**
   * セット中バーストの追加発動条件（BurstTrigger.own_attack 参照）。attacker 自身
   * 向けの pendingBurstCheck を積む own_attack 専用 eventKind。
   */
  | "own_attack"
  /**
   * BurstTrigger.enter_soul_state（BSGE01-M04）。card_event 版と structured event
   * family ("soul_state_change") を共有する。
   */
  | "enter_soul_state";

export type EffectQueueScope = "chain" | "global";

export interface EffectQueueEntry {
  kind: "resolve";
  scope: EffectQueueScope;
  stage: string;
  chainId: string | null;
}

/** 公開済み情報をどの視点へ配送するか。 */
export type PublicDisclosureAudience = "both" | "actor_only" | "opponent_only";

/**
 * 公開情報 renderer が表示語へ変換する処理キー。
 *
 * engine は表示文やカード名を持たず、GUI がこのキーと公開時点の identity snapshot
 * を組み合わせて表示する。未知の action は `action_execute` + `actionKind` で表す。
 */
export type PublicDisclosureActionLabel =
  | "attack"
  | "attack_target"
  | "block"
  | "block_target"
  | "battle_resolve"
  | "reveal"
  | "draw"
  | "add_to_hand"
  | "move_to_top"
  | "move_to_bottom"
  | "move_to_trash"
  | "move_to_field"
  | "move_to_deck"
  | "show_cards"
  | "summon"
  | "put"
  | "genkai"
  | "advent"
  | "contract_combine"
  | "manifest"
  | "rebirth"
  | "flip"
  | "brave_swap"
  | "leave_soul_state"
  | "suppress"
  | "place"
  | "mirage_set"
  | "move_to_set_aside"
  | "move_to_removed"
  | "destroy"
  | "vanish"
  | "core_move"
  | "bp_modified"
  | "recover"
  | "exhaust"
  | "heavily_exhaust"
  | "life_reduce"
  | "life_recover"
  | "count_increase"
  | "count_decrease"
  | "count_set"
  | "symbol_modified"
  | "enter_soul_state"
  | "combine"
  | "separate"
  | "negate"
  | "property_modified"
  | "restriction_added"
  | "immunity_added"
  | "effect_granted"
  | "discard"
  | "bullet_edit_place"
  | "bullet_edit_swap"
  | "action_execute";

export interface PublicDisclosureSource {
  /** 現在の公開カードへ anchor できる間だけ viewer へ配送する live 参照。 */
  instanceId?: string;
  /** 公開時点で audience が知った identity。後に live 参照を切っても履歴へ残す。 */
  definitionIdSnapshot?: string;
  registrationIndex?: number;
  effectIndex?: number;
  /** 定義内の効果コンテナ。未指定は通常effects、nullは合成効果で参照不能。 */
  definitionPath?: readonly (string | number)[] | null;
}

/** 対象確定時に公開できる、カード/ゾーン/プレイヤーの参照。 */
export interface PublicDisclosureTarget {
  kind: "card" | "zone" | "player" | "core_source";
  instanceId?: string;
  definitionIdSnapshot?: string;
  playerId?: string;
  zone?: Zone;
  actionLabel?: PublicDisclosureActionLabel;
  /** `action_execute` fallback を具体化する DSL action kind。 */
  actionKind?: string;
}

/** 効果の実行で公開される結果。非公開カード操作には instanceId を入れない。 */
export interface PublicDisclosureResult {
  kind:
    | "card_move"
    | "core_move"
    | "bp_delta"
    | "destroyed"
    | "life_delta"
    | "count_delta"
    | "hand_delta"
    | "core_delta"
    | "exhaust_state"
    | "card_state"
    | "hidden_card_move";
  instanceId?: string;
  definitionIdSnapshot?: string;
  playerId?: string;
  count?: number;
  /** 増加は正、減少は負。 */
  amount?: number;
  /** 固定値へ変更した場合の確定値（amount は引き続き差分）。 */
  value?: number;
  zone?: Zone;
  from?: Zone;
  to?: Zone;
  exhaustState?: "recovered" | "exhausted" | "heavily_exhausted";
  /**
   * 公開済みカードがデッキへ戻った時点の履歴 snapshot。
   * `knownDeckCards` は後のシャッフルで消えるため、公開情報ログ表示はこの値を使う。
   */
  deckPositionSnapshot?: "top" | "bottom";
  deckIndexFromBottomSnapshot?: number;
  deckCountSnapshot?: number;
  order?: "top_to_bottom" | "bottom_to_top";
  hiddenReason?: "without_showing_contents" | "face_down";
  actionLabel: PublicDisclosureActionLabel;
  /** `action_execute` fallback を具体化する DSL action kind。 */
  actionKind?: string;
}

/**
 * `GameState.log` と独立した公開情報の正源。
 * sequence は engine が単調採番し、viewer ごとの通知キューとログの順番を固定する。
 */
export interface PublicDisclosure {
  id: string;
  sequence: number;
  turnNumber: number;
  step: Step;
  actorPlayerId: string;
  audience: PublicDisclosureAudience;
  source?: PublicDisclosureSource;
  kind:
    | "attack_declared"
    | "block_declared"
    | "battle_resolved"
    | "target_declared"
    | "deck_revealed"
    | "picked"
    | "zone_moved"
    | "core_moved"
    | "bp_modified"
    | "state_changed"
    | "destroyed"
    | "hidden_card_action";
  attackId?: string;
  targets: readonly PublicDisclosureTarget[];
  results: readonly PublicDisclosureResult[];
}

/**
 * 公開済みカードがデッキへ戻った後、そのカード名と既知位置だけを audience へ配送する
 * 配送用 projection。`indexFromBottom` は 0 = デッキ下、deckCount - 1 = デッキ上。
 * 内部状態は CardInstance.deckKnowledge の公開範囲だけを保持し、位置は実デッキから求める。
 */
export interface KnownDeckCard {
  playerId: string;
  indexFromBottom: number;
  definitionIdSnapshot: string;
  audience: PublicDisclosureAudience;
  actorPlayerId: string;
}

export type LifeCoreMoveEffectKind =
  | "generic"
  | "explicit_soul_core"
  | "normal_only";

/**
 * 効果の強制/任意フラグ (エターナル Ver.17.0 FAQ 基準)。
 * - "mandatory": 「○○する」— 可能な限り必ず発揮させなければいけない。
 * - "optional":  「○○できる」— プレイヤーが発揮するかどうかを選択できる。
 * 省略時は "mandatory" として扱う。
 */
export type EffectExecutionMode = "mandatory" | "optional";

/**
 * 同時誘発グループ内での解決優先度。
 * - "normal": 通常の誘発効果。
 * - "immediate": 「ただちに」型。現在解決中の効果は割り込まず、その後の同時誘発群で先に解決する。
 */
export type TriggerPriority = "normal" | "immediate";

/**
 * 効果種別 taxonomy (エターナル Ver.17.0 基準)。
 * - "activated":   プレイヤーが能動的に発揮する効果 (magic 使用、field effect 発動など)。
 * - "triggered":   ゲームイベントに反応して誘発する効果 (「〜したとき」「〜された場合」)。
 * - "continuous":  一定期間持続する効果 (「このターンの間」「このバトル中」)。
 * - "replacement": 他のイベントを置換する効果 (「〜の代わりに」「〜されるとき」)。
 * - "delayed":     今設定して後で解決する効果 (「この効果発揮後」)。
 *
 * 省略時の推定:
 * - RegisteredTriggeredEffectAction, RegisteredBurstAction → "triggered"
 * - RegisteredMagicAction, RegisteredHandCardEffectAction → "activated"
 * - RegisteredFieldCardEffectAction → "activated" (常在効果の場合は "continuous" を明示)
 * - RegisteredBattleImmediateEffectAction → "triggered"
 */
export type EffectCategory =
  | "activated"
  | "triggered"
  | "continuous"
  | "replacement"
  | "delayed";

/**
 * 起動効果の見出しラベル由来カテゴリ。
 * `Timing.mode` は使用できる窓を表し、この値は「フラッシュ効果/スタック効果」などの
 * 効果カテゴリを表す。省略時は activated timing の mode と同じカテゴリとして扱う。
 */
export type ActivatedEffectLabel = "main" | "flash" | "stack" | "none";

/**
 * 効果競合時の優先度 (エターナル Ver.17.0 FAQ 基準)。
 * 複数効果が矛盾するとき、高い forceLevel が勝つ。
 * - "prohibition": 「○○できない」— 最優先。他の効果に優越する禁止。
 * - "obligation":  「○○しなければならない」— 中位。強制だが prohibition には負ける。
 * - "normal":      「○○する」「○○できる」— 最低位。通常の効果発揮。
 *
 * 追加ルール: カード効果とゲームルールが矛盾する場合、カード効果が優先。
 * 省略時は "normal" として扱う。
 */
export type EffectForceLevel = "prohibition" | "obligation" | "normal";

/**
 * 効果防止の優先度 (エターナル Ver.17.0 FAQ 基準)。
 * 防止系効果が重なったとき、高い preventionLevel が勝つ。
 * - "unpreventable": 「防げない」— 最優先。この効果は他の防止で止められない。
 * - "immune":        「受けない」— 中位。対象が効果を受けないが、unpreventable には負ける。
 * - "suppress":      「発揮できない」— 最低位。効果の発揮自体を止めるが、上位には負ける。
 *
 * ただし瞬間的に発揮する効果は、その効果自体が発揮できない状況では発揮できない。
 * 省略時は "none" (防止なし) として扱う。
 */
export type EffectPreventionLevel =
  | "unpreventable"
  | "immune"
  | "suppress"
  | "none";

/**
 * 効果テキスト内の複数部分の接続関係 (エターナル Ver.17.0 FAQ 基準)。
 * - "simultaneous":       「さらに」— 同じタイミングで解決。途中で誘発を挟まない。
 * - "sequential":         「その後」— 前を解決後、割り込みなしで後続を解決。前が失敗しても後続は実行可。
 * - "after_triggers":     「この効果発揮後」— 前の解決で誘発した効果を先に全解決してから後続へ。
 * - "conditional_cost":   「○○することで△△する」(ことで構文)— 双方向チェック。○○不可→全体不発、△△不可→○○も不可。
 * - "conditional_result": 「○○できる。そうしたとき、△△する」— ○○は独立実行可。○○成功時に△△を可能な限り実行。
 * - "unless_previous_succeeded": 「○○しなければ△△」— ○○が成功しなかった場合だけ△△を実行。
 *
 * "sequential" は runActionMainResolution() で実装済み。
 * "after_triggers" は runPendingReactionMainResolution() で実装済み。
 */
export type EffectCompositionKind =
  | "simultaneous"
  | "sequential"
  | "after_triggers"
  | "conditional_cost"
  | "conditional_result"
  | "unless_previous_succeeded";

/**
 * 複合効果の 1 ステップ。
 * label はログ/デバッグ用の識別子 (例: "destroy_target", "draw_card")。
 */
export interface EffectCompositionStep {
  label: string;
  executionMode?: EffectExecutionMode;
  forceLevel?: EffectForceLevel;
}

/**
 * 効果テキスト内の複数部分の構造を表す。
 * 単純な効果 (1 ステップ) には不要。2 つ以上のステップが接続関係を持つときに使う。
 */
export interface EffectComposition {
  kind: EffectCompositionKind;
  steps: readonly EffectCompositionStep[];
}

/**
 * 継続効果の持続期間 (DSL 構造化形式)。
 *
 * scope 値:
 * - "turn":          「このターンの間」— ターン終了時に消滅。whose で自分/相手を指定。
 * - "battle":        「このバトル中」— バトル終了 (step_end) 時に消滅。
 *                     untilTurnEnd=true の場合は「このターン中の次のバトル終了後まで」。
 *                     nextBattleEnd=true の場合はターン限定語なしの「次のバトル終了後まで」
 *                     （ターン境界を跨いで生存し、次の battle_end で消滅）。
 * - "attack":        「このアタック中」— アタック解決時に消滅。
 * - "step":          「〇〇ステップの間」— step + whose で限定。
 * - "while_on_field": 「フィールドにいる間」— 発揮元 (sourceInstanceId) 離場で消滅。
 * - "while_target_on_field": 発揮元ではなく **対象 (targetInstanceId)** の在場で消滅。
 *                     sourceInstanceId は免疫判定用の真の効果発生源のまま保つ必要がある
 *                     (`suppressionCeCanAffectSource` 等) が、CE 自体の寿命は対象カード側に
 *                     紐づく合成効果 (BSFT01-TR03(A) の借用効果スティール抑止=
 *                     effect-borrowing.ts applyBorrowedEffectSuppression) 専用。
 * - "while_set":      「セットされている間」— 発揮元がバースト/ミラージュゾーンを離れたら消滅。
 * - "while_in_trash": 「トラッシュにある間」— 発揮元がトラッシュゾーンを離れたら消滅。
 *                     「トラッシュにあるこのカードは効果を受けない」型のゾーン束縛常時効果
 *                     (BSTH002-M01 / BSTH08-C01 等)。while_set/while_on_field と対称。
 * - "while_in_set_aside": 「手元にある間」— 発揮元が手元 (set_aside) ゾーンを離れたら消滅。
 *                     手元常駐の継続効果に使用する。while_in_trash/while_revealed と対称。
 * - "while_revealed": 「デッキからオープンされている間」— 発揮元が zone:"revealed" を
 *                     離れたら消滅。「オープンされたこのカードは系統：「X」を持つ」型の
 *                     一時的な continuous 効果 (BSTH07.8-X02)。while_set/while_in_trash と対称
 *                     (ENGINE-revealed-zone-continuous-effect-applicability)。
 * - "current_effect": P3-76 対象開示応答で、対象にした元効果の解決完了まで。
 * - "while_own_declaration_pending": 宣言者自身の効果発揮が完了するまで
 *                     (ENGINE-effect-immunity-own-pending-resolution)。「手札/手元から
 *                     フラッシュ使用したこのカードは、効果発揮後まで、相手の効果を受けない」
 *                     型 (BSKB01-R04) の一時耐性。current_effect (P3-76 対象開示応答限定、
 *                     `pendingTargetedDisclosureContinuation` 経由) とは異なり、宣言者自身の
 *                     効果解決 (`effect_activated` = 効果発揮完了直後 hook) に束縛される汎用
 *                     scope。除去は `removeUntilEventContinuousEffects`
 *                     (trigger-system.ts) が `targetInstanceId` 一致の `effect_activated`
 *                     イベントを untilEvents 相当として自動判定し、即座に行う
 *                     (`removeExpiredContinuousEffects` の turn/battle/step_end 経由では
 *                     自然消滅しない — permanent 等と同様に扱う)。
 * - "permanent":      明示的に除去されるまで永続。
 *
 * ルール: 一度発揮された時間指定効果は、発揮元がフィールドを離れても無効にならない
 *        （while_on_field / while_target_on_field / while_set / while_in_trash /
 *        while_revealed を除く）。
 */
export interface Duration {
  scope:
    | "turn"
    | "battle"
    | "attack"
    | "step"
    | "while_on_field"
    | "while_target_on_field"
    | "while_set"
    | "while_in_trash"
    | "while_in_set_aside"
    | "while_revealed"
    | "current_effect"
    | "while_own_declaration_pending"
    | "permanent";
  /** "self" / "opponent" — scope="turn" のとき「相手のターン終了時まで」等を表現 */
  whose?: "self" | "opponent";
  /** scope="step" のときの対象ステップ */
  step?: Step;
  /**
   * true のとき「次の」ターン/ステップ（現在のではなく次の）。
   * scope="turn" の場合: 効果は作成ターンの end_step では消滅せず、次のターン終了時まで延命される。
   * `turns: N` と併用すると、`N + 1` 回分の turn_end を生き延びる。
   * scope="step" の場合: `step`/`whose` に一致する最初の step_end が登録ターンと同じターンなら
   * 消滅させず、次にその条件が一致する step_end まで延命する（BSTH05.5-XX01【神域】
   * 「次の『自分のエンドステップ』まで」が初出。`removeExpiredContinuousEffects` 参照）。
   */
  next?: boolean;
  /**
   * 持続ターン数（scope="turn" のみ）。省略時 = 1。
   * 「Nターンの間」を表現する。N 回分の turn_end を生き延びる。
   */
  turns?: number;
  /**
   * true のとき turn_end も上限として扱う。
   * scope="battle" と組み合わせて「このターン中の次のバトル終了後まで」を表現する。
   */
  untilTurnEnd?: boolean;
  /**
   * true のとき、scope="battle" の登録元バトルの battle_end では失効せず、
   * ターン境界も跨いで生存し、次に閉じるバトルの battle_end で初めて失効する。
   * 「（ターン限定語なしの）次のバトル終了後まで」を表す
   * （`untilTurnEnd` は同じ battle_end 延命に加えて turn_end でも失効するため、
   * 「このターン中の」が原文に無いカードには使えない。BSDB01-C09 が初出、
   * adversarial verifier round2 で `untilTurnEnd` 誤用を refute されて新設）。
   */
  nextBattleEnd?: boolean;
  /**
   * 指定イベント種別のいずれかが、この継続効果の対象自身
   * (`ContinuousEffect.targetInstanceId`) を主語 (`relatedInstanceId`) として発生したとき、
   * scope の自然消滅を待たず即座に除去する（「指定した対象が〜するまで」型の早期終了、
   * 複数指定時はいずれか1つで成立=OR）。判定は `queuePendingReactionsFromTriggerEvents`
   * (trigger-system.ts) が集約する全 CollectedTriggerEvent 経由で行う
   * (ENGINE-continuous-effect-until-event-duration、BSLH01-T17 が初出)。
   * `targetInstanceId` 未設定の CE（player-scoped 等）には適用されない。
   */
  untilEvents?: TriggerEventKind[];
}

/** @deprecated Duration を使用してください。後方互換用エイリアス。 */
export type EffectDuration = Duration;

/**
 * 継続効果のタグ（型安全）。hand-written resolver が解釈する。
 *
 * 静的タグ: 固定値。
 * 動的タグ: テンプレートリテラル型で action プロパティから導出。
 */
export type ContinuousEffectTag =
  // --- 静的タグ ---
  | "bp_modifier"
  | "symbol_addition"
  // host 自身の underCardSlots 該当 roleTag 枠上限へ、roleTag 一致 text_role アンダーカード
  // それぞれの自身の underCardSlots (同一 roleTag) maxCount を合算加算する
  // (`under_card_slot_capacity_grant`、BSAZ02-TX01(B) precedent)。
  | "under_card_slot_capacity"
  | "under_card_role"
  | "defense_immune"
  // プレイヤー対象の「相手の効果を受けない」(P3-77 節②)。
  // targetInstanceId に保護対象プレイヤーの id を格納する (restrict_flash と同じく
  // targetInstanceId カラムを playerId 用途で多重利用)。defense_immune が
  // カード対象なのに対し、本タグはプレイヤー対象効果 (人称+読点で判定) のみブロックする。
  | "player_effect_immunity"
  // プレイヤー配下のソウルコアが、指定プレイヤー範囲の「ソウルコアを指定した効果」を
  // 受けない状態。targetInstanceId に保護対象プレイヤーの id を格納する。
  // metadata.sourcePlayerScope は保護対象プレイヤーから見た "self" | "opponent" | "any"。
  // 省略時は BS57-011 Q8962 型の "self"（相手のソウルコアは相手の効果を受けない）。
  | "soul_core_effect_immunity"
  // 「相手のバースト効果を無効にする」(BSTH09.2-転醒R03) /「相手はバースト効果を発揮できない」
  // (BSTH05-X04) の CE (P3-77 Step B/C)。発動は成立するがバースト効果が発揮されない
  // (effectSuppressed 経路に合流)。actingPlayerId = 無効/制限を課す側。
  // metadata.burstSuppressKind で "nullify"(無効) / "cannot_activate"(発揮できない) を区別する。
  // 抑制の回避は「発動中(節②)を覆う受けない」= metadata.burstActivationWindow を持つ
  // defense_immune のみ (受けない > 発揮できない / 発動中は無効も受けない)。セット束縛(節①)の
  // defense_immune は発揮(解決)時点では失効扱いのため回避源にならない。さらに
  // Effect.ignoresOpponentCannotActivateBurst を持つバーストは "cannot_activate" のみ能動的に無視する。
  | "negate_opponent_burst"
  | "negate_caused_reaction"
  | "defense_suppress"
  | "effect_suppression"
  | "cost_override"
  | "unblockable"
  // 「疲労状態でもブロックできる」許可 CE（block-while-exhausted, prevent_battle の対概念）
  | "allow_block_while_exhausted"
  // 「疲労状態のこのスピリットは、重疲労させることでアタックできる」許可 CE
  // (attack-while-exhausted, BSTH09-C04【追撃】)。allow_block_while_exhausted の
  // アタック版だが、対象は「疲労状態のみ」(重疲労は対象外) かつ消費時のコストとして
  // 通常の疲労遷移ではなく重疲労へ遷移する点が異なる (battle-actions.ts 参照)。
  | "allow_attack_while_exhausted"
  // 「ターンに1回、疲労せずにアタック/ブロックできる」許可 CE
  // (tapless-battle-declare, BSTH09-C03)。宣言前提条件は変えず(通常通り回復状態が必要)、
  // 宣言確定時の疲労遷移だけをスキップする。ターン1回制限は
  // GameState.usedTaplessBattleDeclareInstanceIdsThisTurn で追跡する。
  | "allow_tapless_battle_declare"
  // 「ブロックされない」相手をブロックできる許可 CE
  | "block_unblockable"
  // 「このスピリットのブレイヴは分離できず、このスピリットがフィールドを離れるとき、
  // フィールドに残せない」型の host-scoped CE。
  | "prevent_brave_separation"
  // 「《ソウルコア》以外のコアを取り除けない」。対象カードから通常コアを移動できない。
  // ソウルコアの移動と、フィールド離脱に伴うルール上の強制コア退避は対象外。
  // 消費側は core-system.ts / payment-system.ts。
  | "prevent_normal_core_move"
  // 「N体まで同時にアタックできる」許可 CE（P2-05。player-scoped:
  // targetInstanceId = playerId、metadata に filter / maxCount / blockerCapacity）
  | "allow_simultaneous_attack"
  // 「召喚した(filter 合致)自分のスピリット/アルティメットは、相手のブロック宣言前なら
  // ただちにアタックできる」許可 CE (P2-05 Phase 5, XX01【導域】。player-scoped:
  // targetInstanceId = playerId、metadata に filter)
  | "allow_mid_battle_join"
  // 「filter に合致するアルティメットを召喚するとき、召喚条件を無視して召喚できる」許可 CE
  // (BSAZ02-C11【アルティメット合体中】。player-scoped: targetInstanceId = playerId、
  // metadata に filter。消費は canSummonUltimate が getIgnoreSummonConditionGrant 経由で確認)
  | "allow_ignore_summon_condition"
  | "magic_use_permission"
  // 「自分は、指定 duration の間ゲームに敗北しない」付与 CE (BSTH05.5-XX01【神域】)。
  // player-scoped: targetInstanceId = playerId。消費は isPlayerImmuneToGameLoss
  // (legal-actions-shared.ts) がライフ0/デッキ0敗北判定の各呼び出し箇所
  // (applyLifeZeroDefeat / turn-system.ts のデッキ0チェック x2) から確認する。
  | "immune_to_game_loss"
  // 「filter に合致するカードを召喚するとき、発揮元を疲労させて召喚条件無視/軽減シンボル
  // 全充足を選べる」任意コスト付与 CE (BSAZ02-C08【月面基地】。player-scoped:
  // targetInstanceId = playerId、sourceInstanceId = 疲労対象の発揮元、metadata に
  // filter/benefits。消費は getDeclaredSummonAltCostGrant 経由で確認)
  | "grant_declared_summon_alt_cost"
  // 「filter に合致するスピリット/アルティメットカードを召喚するとき、対象に置くコアは
  // トラッシュからも<ソウルコア>以外のコアを指定数まで置ける」付与 (BSLH01-T13「メルティライズ」)。
  // player-scoped: targetInstanceId = playerId、metadata に filter/amount。
  // 消費は getSummonTrashCorePlacementGrant (legal-actions-shared.ts) が
  // EnterFieldCorePlacementPolicy.allowedTrashNormalCoreCount へ合流する
  // (hand summon 経路限定、ENGINE-summon-trash-core-placement-grant)。
  | "grant_summon_trash_core_placement"
  // 「このターンの間、自分は、フラッシュタイミングを[limit]回ずつまで続けて行える」付与 CE
  // (BSLH01-T15「カラミティクロウ」)。player-scoped: targetInstanceId = playerId、
  // metadata.limit。消費は getFlashConsecutiveUseLimitGrant (legal-actions-shared.ts) が
  // battle-actions.ts usePassBattleFlashAsAction の能動使用カスケード解決分岐で参照する。
  | "grant_flash_consecutive_use"
  // 「このターンの間、自分の魂状態のカードすべての【リンクエイド】を『フィールド/
  // リザーブから1コスト支払って、フィールド/リザーブのコアを好きなだけ置いて
  // スピリット状態にする』に変更する」(BSGE01-C03「ディソレイト」フラッシュ、空木レンカ
  // (魂状態含む)存在条件)。player-scoped: targetInstanceId = playerId。消費側は
  // mechanics/link-aid-system.ts の isLinkAidCostOverrideActive
  // (getAvailableLinkAidLegalActions で起動コスト源をフィールド/リザーブ全体へ拡張し、
  // resolveDeferredLinkAidStack で charge の sourceScope を field_and_reserve へ拡張)。
  | "grant_link_aid_cost_override"
  // 「自分がスピリットの効果でデッキをオープン/破棄するとき、枚数を+1できる」付与 CE
  // (BSLH01-X09【クォーツ：練刃】。player-scoped: targetInstanceId = playerId、
  // metadata に sourceFilter/bonusAmount。ENGINE-optional-deck-reveal-count-boost は
  // Step2/Step3 で deck_reveal/discard(fromZone:deck) 両方の pending choice 消費側まで
  // 配線済み (effect-interpreter.ts handleDeckRevealCountBoostChoice))
  | "grant_optional_deck_reveal_count_boost"
  // 「自分が[sourceFilter]の効果で相手の[targetFilter]を対象にするとき、ターンにN回、
  // その対象を+N する」対象数拡張の付与 CE (BSLH01-TR02(A)【クォーツ：範囲】、
  // ENGINE-target-count-expand-modifier)。既存 redirect_effect_target は対象1体を
  // 別対象に置換するだけ(1→1)で対象「数」自体は変更できないため新設。player-scoped:
  // targetInstanceId = playerId、metadata に { sourceFilter, targetFilter, targetPlayer,
  // bonusAmount, usageLimit? }。Step3 時点で auto-resolve 経路の消費側
  // (native-target-resolution.ts applyActionTargetCount 他) と usageLimit 実消費記録は
  // 配線済み。GUI 候補数上限・手動対象選択経路のみ Step4 以降 (engine-deep-ledger 参照)。
  | "expand_effect_target_count"
  // 「相手はブロックするとき、[filter]でないとブロックできない」複数体ブロック強制 CE
  // (P2-05 Phase 5, BSFT01-TR06(B)型「スピリット2体でないとブロックできず」。player-scoped:
  // targetInstanceId = playerId (自分の攻撃側)、metadata に filter / requiredBlockerCount)
  | "require_multi_block"
  // 「相手のスピリット/アルティメットは、可能ならブロックする」CE。player-scoped:
  // targetInstanceId = playerId (自分の攻撃側)、metadata に filter。
  | "require_block_if_able"
  // 「ターンの最初のバトル終了時、自分のアタックステップは終了する」制限 CE
  // (P2-05 Phase 4b, XX01【導域】。player-scoped: targetInstanceId = playerId)
  | "force_attack_step_end_after_first_battle"
  // 「自分が[tribeFilter]を持つマジックカードを使用するとき、そのコストを支払う前に、
  // ただちに[triggerEffectIndex]の効果を使用できる」権利付与 CE
  // (engine-magic-field-pre-cost-payment-trigger, BSAZ01-C12「戦力投入」)。player-scoped:
  // targetInstanceId = playerId、metadata に { tribeFilter, triggerEffectIndex }
  | "offer_magic_pre_cost_trigger"
  | "prevent_attack"
  | "prevent_life_damage"
  // --- hand_gain_cost_gate: 「(player)は、Nコスト支払わなければ、(player)の効果で
  //     デッキ/トラッシュ/オープンしたカードから手札を増やせない」
  //     (engine-opponent-hand-gain-paid-tax-gate, BSRK01-C02[3,4])。player-scoped:
  //     targetInstanceId = 制約対象 playerId、metadata.costAmount (省略時1)。
  //     消費側 (deck-reveal-pick-candidates.ts resolveDeckRevealCostGateToApply) が
  //     deck_reveal pick (origin:"deck"/"trash" 双方) の destination:"hand"系ブランチに
  //     costGate として合成し、DeckRevealPick.costGate と同じ affordability/支払い経路
  //     (pending-action-handlers.ts payDeckRevealCostGate) に載せる。
  | "hand_gain_cost_gate"
  // --- hand_gain_prevention: 「(player)は、(player)の効果で手札を増やせない」完全禁止
  //     (engine-restrict-hand-gain-bsrk01-x01, BSRK01-X01 合体結誓)。player-scoped:
  //     targetInstanceId = 制約対象 playerId。`isHandGainPreventedByOwnEffect` が
  //     効果の発揮者と手札を得るプレイヤーを照合し、draw / 非交換 bounce /
  //     search_zone / search_deck / deck_reveal の純増を止める。相手の効果による
  //     手札戻し、および hand_swap のような純増しない交換は対象外。
  | "hand_gain_prevention"
  | "draw_modify"
  // --- 動的タグ: prevent_battle ---
  | `prevent_battle_${"attack" | "block" | "both"}`
  // --- 動的タグ: battle_cost_gate: 「アタック/ブロックする(対象)から Nコスト支払わなければ
  //     アタック/ブロックできない」(BSAZ01-C09)。prevent_battle と異なり全面禁止ではなく、
  //     対象カード自身の通常コアから metadata.costAmount (省略時 1) 分を支払えれば宣言可能。
  //     消費側 (battle-availability.ts) が targetFilter 一致時に対象自身の normalCoreCount と
  //     比較し、不足時のみ「宣言不可 (source_not_ready)」を返す。宣言確定時
  //     (battle-actions.ts confirmAttackDeclarationAsAction/confirmBlockDeclarationAsAction) が
  //     moveNormalCores で対象カード自身からトラッシュへ costAmount 分を支払う。
  | `battle_cost_gate_${"attack" | "block" | "both"}`
  // --- 動的タグ: attack_exhaust_cost_gate: 「アタックする(対象)は、自分の別カード1体を
  //     疲労させなければアタックできない」。宣言 action が疲労コスト候補を選択し、
  //     pre-declaration stack 確定時にまだ有効なら疲労させる。
  | "attack_exhaust_cost_gate"
  // --- 動的タグ: battle_destroy_cost_gate: attack_exhaust_cost_gate の破壊版
  //     (BSDB01-C09)。「アタック/ブロックする(対象)は、対象自身と同じ controller の
  //     costTargetFilter.category 合致カード1体を破壊しなければアタック/ブロックできない」。
  //     restriction は battle_cost_gate と同じく attack/block/both を持つ。宣言時
  //     (useAttackAsAction/useBlockAsAction) が破壊コスト候補を選択・検証し、
  //     executeDestroy で実行してから pre-declaration stack window を開く。
  | `battle_destroy_cost_gate_${"attack" | "block" | "both"}`
  // --- 動的タグ: restrict_flash ---
  | `restrict_flash_${"hand" | "field" | "any"}`
  // --- restrict_stack: 「相手はスタック効果を発揮できない」(P3-75)。restrict_flash と同型。
  | "restrict_stack"
  // --- restrict_burst_activation: 「相手はバーストを発動できない」。
  //     negate_opponent_burst (発動は成立し、バースト効果だけを抑制) とは異なり、
  //     pending burst check の resolve legal action 生成自体を抑止する。
  | "cannot_activate_opponent_burst"
  // --- restrict_advent: 「相手は【煌臨】できない」(ENGINE-restrict-advent、BSFT01-X01)。
  //     player-scoped: targetInstanceId = 制限対象 playerId。restrict_stack と同型で、
  //     declare_advent legal action 生成側 (getAvailableAdventLegalActions) が
  //     isAdventRestricted で消費する。
  | "restrict_advent"
  // --- restrict_reserve_cost_payment: 「相手はリザーブからコストが支払えない」
  //     (ENGINE-restrict-reserve-cost-payment、BSSL01-R03)。player-scoped:
  //     targetInstanceId = 制限対象 playerId。restrict_advent と同型で、
  //     payment-system.ts の getAvailableCardCostPaymentSources が
  //     isReserveCostPaymentRestricted で消費する (reserveSource.availableCoreAmount を 0 化)。
  | "restrict_reserve_cost_payment"
  // --- prevent_recovery: 「相手の[filter]カードは回復できない」
  //     (ENGINE-persistent-recovery-block-with-advent-host-exclusion、BSTH11-X01【神域】)。
  //     player-scoped: targetInstanceId = 制限対象 playerId、metadata.filter (省略可)。
  //     restrict_advent と同型で、core-system.ts の refreshExhaustStates が
  //     重疲労→疲労の一段階回復のみを対象にブロックする消費側 (getCEsForTarget 経由)。
  | "prevent_recovery"
  // --- restrict_field_cost_payment: 「相手のマジックのスタック効果コストはフィールドから
  //     支払えない」(ENGINE-restrict-field-cost-payment、BSTH08-C06)。player-scoped:
  //     targetInstanceId = 制限対象 playerId。restrict_reserve_cost_payment と対称で、
  //     payment-system.ts の getAvailableCardCostPaymentSources が
  //     isFieldCostPaymentRestricted で消費する (onBoardCoreSources を空化)。
  //     metadata.effectModes で main/flash/stack のうち制限対象を絞れる(省略時は全種別)。
  | "restrict_field_cost_payment"
  // --- effect_source_prevention_immunity: 「自分の系統：「○○」を持つ効果は、相手の
  //     効果では防げない」(engine-effect-prevention-immunity-tribes、BSSL01-X02[9,10])。
  //     player-scoped CE: targetInstanceId = 免疫の恩恵を受けるプレイヤー、
  //     actingPlayerId = 付与元。metadata: { tribes: string[] }。消費側は
  //     isEffectSourceTribePreventionImmune (legal-actions-shared.ts) が、誘発効果
  //     宣言時 (resolve_pending_triggered_effect) および field_card_effect
  //     (flash/stack/main 起動効果) 宣言時に発生源カードの実効系統
  //     (getEffectiveTribes) を照合し、一致すれば sourcePreventionLevel を
  //     "unpreventable" へ昇格する (grant_paid_prevention_immunity の無償・自動版)。
  | "effect_source_prevention_immunity"
  // --- suppress_stack_source: 「このカード/スピリットは相手のスタックタイミング元にならない」。
  //     card-scoped: targetInstanceId = stack source card, metadata.suppressedPlayerId = 制限対象 playerId。
  | "suppress_stack_source"
  // --- force_first_attacker: 「このスピリットは可能ならこのターンの最初にアタックする」
  //     (ENGINE-force-first-attack-this-turn, BSTH02.7-TR02(A))。card-scoped:
  //     targetInstanceId = 強制対象カード自身、actingPlayerId = 発揮者。今ターン中まだ
  //     バトルが終了しておらず(battlesEndedThisTurn===0)、かつ対象カードが現に合法アタック
  //     宣言可能な間だけ、他カードのアタック宣言を getAttackDeclarationBlockReason で抑止する
  //     (「可能なら」= 対象が宣言不能になった時点で自然に制約解除、専用クリア処理は無い)。
  | "force_first_attacker"
  // --- forced_target_inclusion: 「相手が対象を選ぶ効果を発揮するとき、可能なら
  //     このカードを対象に含めなければならない」タウント (cluster:
  //     forced-target-inclusion-taunt, BSFT01-TR02(B))。card-scoped:
  //     targetInstanceId = 強制対象カード自身、actingPlayerId = 発揮者(taunt 保持側)。
  //     消費側 (legal-actions-shared.ts getMandatoryForcedTargetInclusionIds) が、
  //     相手の対象選択 pending (`PendingEffectTargetSelection`) 解決確定時に、
  //     targetInstanceId が候補プール (`candidateInstanceIds`) に含まれる間だけ
  //     選択必須化する。「可能なら」= 候補プールに無ければ(耐性・ゾーン不一致等で
  //     そもそも対象化できない)強制なし。複数 taunt 源が同時に候補化し、
  //     必須集合が maxTargetCount を超えて全員を含められない (物理的に不可能) ときは
  //     優先順位を定義せず強制を見送る (設計判断、issues/forced-target-inclusion-taunt 参照)。
  | "forced_target_inclusion"
  // --- gate_flash_stack_core: 「相手は[ゾーン]のコア1個をトラッシュに置かなければ
  //     フラッシュ/スタック効果を発揮できない」(発揮前提の除去ゲート。BSTS01-M03)。
  | "gate_flash_stack_core"
  // --- gate_flash_stack_hand_discard: 「相手は手札N枚を破棄しなければ
  //     フラッシュ/スタック効果を発揮できない」(発揮前提の手札破棄ゲート)。
  | "gate_flash_stack_hand_discard"
  // --- prevent_hand_discard: 「(対象)の手札は相手によって破棄されない」(手札破棄耐性。
  //     BSFT01-C03/C04)。player-scoped: targetInstanceId = 保護対象 playerId。
  //     metadata に handCountMax / minSourceCores の動的ゲートを格納し、消費側
  //     (executeDiscardHand) が「acting = 相手」かつゲート成立時のみ破棄対象から除外する。
  | "prevent_hand_discard"
  // --- prevent_deck_discard: 「(対象)のデッキは破棄されない」(デッキ破棄耐性。
  //     BSTH08.5-C21「お互いのデッキは破棄されない」)。player-scoped: targetInstanceId =
  //     保護対象 playerId。消費側 (executeMoveCard) がデッキ→トラッシュ移動で当該デッキ
  //     所有者が保護されていれば移動集合から除外する（原因不問）。
  | "prevent_deck_discard"
  // --- redirect_deck_discard_to_exclude: 「相手への「デッキ破棄効果」すべてを「デッキ除外
  //     効果」にする」(BSTH05.5-X02 Lv2【導域】)。player-scoped: targetInstanceId = 対象
  //     デッキ所有者 playerId。消費側 (executeMoveCard) がデッキ→トラッシュ移動で当該
  //     デッキ所有者が対象なら移動先を trash から removed_from_game へ差し替える
  //     (prevent_deck_discard の block に対する redirect 版)。timingScope で「自分の
  //     アタックステップ」限定を表現する (getCEsForTarget の timingScope フィルタが適用)。
  | "redirect_deck_discard_to_exclude"
  // --- restrict_core_placement_life: 「(対象プレイヤーは)ライフにコアを置けない」
  //     (BSTH02.7-C01 effects[2] choice[0])。player-scoped: targetInstanceId = 制限対象 playerId。
  //     消費側 (executeCoreMove) が to.kind==="life" の移動先プレイヤーに対して原因不問で
  //     全面ブロックする。prevent_deck_discard と同型 ("either" で両プレイヤー登録)。
  //     `metadata.fromZone` 設定時 (DSL.RestrictCorePlacementAction.fromZone 由来) は
  //     移動元をその Zone に限定する（「お互い、ボイドからコアをライフに置けない」=
  //     fromZone:"void"、BSTH002-C04 effects[0]）。未設定時は従来通り移動元不問。
  | "restrict_core_placement_life"
  // --- restrict_core_placement_void: 「(対象プレイヤーは)相手の効果でボイドからコアを
  //     増やせない」(BSSL01-C02 effects[0])。player-scoped: targetInstanceId = 制限対象 playerId。
  //     消費側 (executeCoreMove) が from.kind==="void" かつ移動元プレイヤー===actingPlayerId
  //     (対象プレイヤー自身の効果でボイドのコアが減る) のときのみブロックする
  //     (restrict_core_placement_life と異なり自己原因限定。ENGINE-void-core-decrease-trigger)。
  | "restrict_core_placement_void"
  // --- restrict_symbol_addition: 「(対象プレイヤーは)スピリット/アルティメットの効果で
  //     合計でN個以上シンボルを追加できない」(BSTH03-C04 effects[2])。player-scoped:
  //     targetInstanceId = 制限対象 playerId、metadata: { maxTotal: number, sourceFilter?:
  //     CardFilter }。消費側 (executeSymbolAdd) が symbol_add 実行のたびに実追加数
  //     (対象数 * count) を評価し、symbolAdditionRestrictedCountThisTurn
  //     (`${targetPlayerId}:${effectId}` キー) の累積と合わせて maxTotal を超える場合
  //     symbol_add 全体をブロックする（対象を絞らず一律禁止。
  //     prevent_deck_discard/restrict_core_placement と同型の player-scoped CE）。
  | "restrict_symbol_addition"
  // --- restrict_draw_to_top: 「このターンの間、自分はデッキの上からしかドロー/オープン
  //     できない」自己制約 (BSTH09-C05 effects[1] 後段)。player-scoped:
  //     targetInstanceId = 制限対象 playerId。消費側 (native-action-registry.ts の draw
  //     ハンドラ) が draw action の position:"bottom" 指定をこの CE 検知時に "top" へ
  //     強制上書きする。deck_reveal/peek_deck は常に top 固定 (bottom variant 無し) の
  //     ため対象は draw のみで足りる。
  | "restrict_draw_to_top"
  // --- life_gain_replacement: 「自分の効果で自分のライフが増えるとき、増やす代わりに
  //     [代替アクション]できる」置換効果 (BSTH02.7-X03 effects[3])。player-scoped:
  //     targetInstanceId = 置換権を持つプレイヤー(=ライフが増える側)。消費側
  //     (executeCoreMove) が to.kind==="life" かつ toPlayerId===actingPlayerId
  //     (自分の効果で自分のライフが増える) のときにこの CE を照合し、任意
  //     (`pendingLifeGainReplacementChoice`) で増加そのものを代替アクションに置換できる。
  | "life_gain_replacement"
  // --- life_gain_prevention: 「[プレイヤー]のライフは増やせない」型の完全禁止
  //     (BSTH002-R02【セット中】「お互い、ライフは増やせず」)。player-scoped:
  //     targetInstanceId = 増加を禁止されるプレイヤー。消費側 (executeCoreMove の
  //     to.kind==="life" 経路、executeLifeFill) が発揮者を問わず core_move/life_fill を
  //     無条件で no-op 化する（life_gain_replacement と異なりプレイヤー選択を挟まない）。
  | "life_gain_prevention"
  // --- core_move_destination_replacement: 「このスピリットの効果で移動する相手のコアすべては
  //     トラッシュに置かれる」(BSKB01-R03【合体中】) /「相手のライフから移動するコアすべてを
  //     ボイドに置く」(BSTH03-M05 Lv5)。global CE (targetInstanceId 未設定):
  //     metadata に { fromOwner: "self"|"opponent", fromZone?, matchCausingSourceOnly?, toZone }。
  //     消費側 (executeCoreMove) が fromOwner (登録者=actingPlayerId から見た self/opponent) と
  //     実際の移動元プレイヤーの一致 (+ fromZone/matchCausingSourceOnly 指定時はそれも一致)
  //     を検知すると、life_gain_replacement と異なり pending を挟まず強制的に `to` を
  //     toZone へ上書きして再実行する。
  | "core_move_destination_replacement"
  // 「相手は効果でアタックステップを終了できない」継続効果。
  | "restrict_end_attack_step"
  // 「相手は効果でバトルを終了できない」継続効果。
  | "restrict_end_battle"
  // 「相手は効果でステップを終了できない」継続効果。
  | "restrict_end_step"
  // 「相手は効果でターンを終了できない」継続効果。
  | "restrict_end_turn"
  // --- 動的タグ: treat_as ---
  | `treat_as_${"symbol" | "reduction_symbol" | "symbol_and_reduction" | "color" | "color_and_symbol"}`
  // --- 動的タグ: negate ---
  | `negate_${"summon" | "place" | "use_magic" | "effect"}`
  // --- 効果耐性 (resistType をそのまま使用) ---
  | "cannot_leave_field"
  | "cannot_be_destroyed"
  | "cannot_be_bounced"
  | "cannot_be_sent_to_deck"
  | "cannot_be_vanished"
  | "cannot_be_removed_from_game"
  | "cannot_be_exhausted"
  | "cannot_reduce_cores_below"
  // 「効果の対象にできず、含めない」target acquisition lock。
  // defense_immune / cannot_* と異なり通常の「防げない」では貫通しない。
  | "cannot_be_targeted"
  | "deck_hand_access"
  | "required_effect_cost"
  | "cannot_include"
  // 「BP比べでは破壊されない」(BSTH09.2-転醒R01(B))。バトルの BP比べ
  // (queueBattleResolutionDestroys) と効果の bp_compare_destroy の両 BP比較破壊
  // サイトでのみ参照する。通常の効果破壊・離脱には影響しない (cannot_be_destroyed
  // とは別軸: 04_state-based-rules.md §BP比べ破壊の cause 分類)。
  | "cannot_be_destroyed_by_bp_compare"
  // destination-zone-scoped resistance: 「このカードの効果以外で(指定ゾーン)に置けない」
  // (BSTH08.5-X04)。metadata.entryZone で阻止する移動先ゾーンを指定する
  // (ENGINE-set-aside-entry-restriction)。
  | "cannot_enter_zone"
  // --- 置換効果 (フィールド離脱→代替アクション) ---
  // 実行時は ContinuousEffect.metadata に trigger / source / replacement を格納する。
  | "replace_field_exit"
  | "additional_cost"
  // --- 拡張タグ ---
  | "override_properties"
  | "restrict_use"
  // 「相手はネクサスを配置するとき、軽減できない」型 (BSTH07.8-C03 Lv2)。
  // restrict_use と異なり使用自体は禁止せず、calculateReduction の symbol
  // matching / waiver だけを無効化する。metadata: { filter, restrictedKinds? }
  // (restrict_use と同形)。targetInstanceId = 制限対象プレイヤー。
  | "prevent_cost_reduction"
  // 「創界神/導界者ネクサスでは、1つしか軽減シンボルを満たせない」型 (BSTH07-転醒R01(A) Lv2)。
  // prevent_cost_reduction と異なり支払対象カードは絞らず、calculateReduction の
  // fieldSymbolSources を由来カードでフィルタして使用可能マッチ数を上限する。
  // metadata: { sourceFilter, maxSymbols, restrictedKinds? }。targetInstanceId = 制限対象プレイヤー。
  | "limit_cost_reduction"
  // 「[zone] にあり [filter] を満たすカードは、軽減シンボル供給源として
  // フィールドにあるものとしても扱う」型 (BSTH08.5-C20「能面・女（平静）」)。
  // calculateReduction の fieldSymbolSources 構築時に zone:"field" 限定へ追加する。
  // metadata: { zone, filter }。targetInstanceId = 供給先プレイヤー。
  | "extend_field_symbol_source"
  | "restrict_manifest"
  | "field_name_uniqueness"
  | "count_as_multiple"
  | "life_damage_interception"
  // --- life_damage_source_prevention_immunity (P3-125 Step3、
  //     BSLH01-X08【ソウルドライブ・S】) ---
  //     「このターンの間、[sourceFilter] を持つ自分のスピリットによるライフの減少は
  //     相手の効果では防げない」。player-scoped CE: targetInstanceId = 免疫の恩恵を
  //     受けるプレイヤー、metadata: { sourceFilter: CardFilter }。
  //     effect_source_prevention_immunity（効果宣言ドメイン）の対概念で、こちらは
  //     life_damage_interception（ライフダメージ解決ドメイン）を貫通する。消費側:
  //     core-system.ts applyLifeDamageInterception（効果起因、sourceCardMatchesFilter
  //     経由）/ battle-actions.ts getUnblockedLifeDamage（バトル起因、参加体単位）。
  | "life_damage_source_prevention_immunity"
  // --- paid_prevention_immunity_offer (ENGINE-bsge01-r04-paid-prevention-immunity) ---
  // 「host が効果を発揮するとき、対価を支払うことでその効果は相手の効果で防げなくなる」
  // 権利付与 CE。card-scoped: targetInstanceId = 権利を持つ host の instanceId。
  // metadata: { cost: { resource: "count"; amount: number } }。消費側は
  // getPaidPreventionImmunityCost (effect-resistance-check.ts) が host の
  // instanceId で本 CE を検索しコストを返す。実際の支払い判定・
  // sourcePreventionLevel 上書きは resolve_pending_triggered_effect 系の
  // legal-actions 層で行う（本 CE は「権利がある」ことのみを表す）。
  | "paid_prevention_immunity_offer"
  // --- paid_leave_suppression_immunity_offer (engine-generic-effect-activation-
  //     causal-trigger cluster, BSGE01-R02) ---
  // 「host が効果を発揮するとき、対価を支払うことで、それによってフィールドを
  // 離れるカードの効果は発揮されない」権利付与 CE。card-scoped:
  // targetInstanceId = 権利を持つ host の instanceId。
  // metadata: { cost: { resource: "count"; amount: number } }。消費側は
  // getPaidLeaveSuppressionImmunityCost (effect-resistance-check.ts) が host の
  // instanceId で本 CE を検索しコストを返す。paid_prevention_immunity_offer と
  // 同じ「権利の存在のみを表す」設計 (実際の支払い判定・適用は legal-actions 層)。
  | "paid_leave_suppression_immunity_offer"
  // --- 条件付き再発火効果（retrigger）---
  // 旧 state.activeRetriggerEffects を統合した CE バリアント。
  // retrigger* optional フィールドで event / filter / fireCount 等を管理する。
  | "retrigger"
  // --- token-as-spirit (P3-47 F-2) ---
  // 任意のカード (主に F-1 で配置された裏向きカード) を「スピリットとして扱う」
  // 継続効果。targetInstanceId に対象カードの instanceId を入れ、metadata に
  // statBlueprint / overrides を格納する。
  // metadata: { statBlueprint: ActAsSpiritStatBlueprint; overrides?: ActAsSpiritOverrides }
  | "act_as_spirit"
  // --- effect-target redirect (P3-47 F-4) ---
  // 「相手の効果が指定対象 (本体) を取ったとき、対象を別カード (token 集合) に変更できる」
  // 継続効果。target-resolution 直後 / アクション実行直前に hook され、対象集合に
  // triggerCondition.targetFilter が含まれていれば pendingTargetRedirects を発行する。
  // metadata: RedirectEffectTargetMetadata (act-as-spirit と同じく metadata で表現)
  | "redirect_effect_target"
  // --- effect-parameter override (P3-14 A-7) ---
  // 他効果のターゲットフィルタ条件 (maxBp / maxCost / target.category) を継続的に
  // 書き換えるメタ修飾。card-filter.ts:applyEffectParamOverridesToFilter が
  // destroy/vanish/bounce 系の効果分類に対応する CE を query して delta を適用する。
  // metadata: EffectParamOverrideMetadata
  | "effect_param_override"
  // --- granted-effect (P3-99 grant_effect) ---
  // 「効果そのもの」を被付与カード (targetInstanceId) へ一時付与する継続効果。
  // sourceInstanceId が発揮元 (grant 源)、targetInstanceId が被付与カード。
  // metadata: { grantedEffect: Effect; grantPlayerRef: EffectPlayerRef } を格納する。
  // 発揮元離脱で while_on_field により自動消滅 (04 §合体ブレイヴ単体破壊の一般化)。
  // 注入点 (被付与カードのイベントで grantedEffect を誘発/起動として発火) は
  // 次イテレーションで配線する (P3-99 §3、本イテレーションは登録/lifecycle のみ)。
  | "granted_effect"
  // --- count-gain メタ修飾 (BSTS01-C03) ---
  // 「自分の『カウント＋』効果で増やすカウントを＋N する」。actingPlayerId =
  // 修飾の受益プレイヤー、modifierAmount = +N。executeCountIncrease が、その
  // ターン最初に解決する受益プレイヤーの count_increase 1 件のみへ自動加算する
  // (10_rules/08a §カウント＋ メタ修飾。終止形=強制 / first-opportunity 消費 /
  //  消費追跡は GameState.countGainModifierConsumedThisTurn)。
  | "count_gain_modifier"
  // --- core-move 移動コア数 メタ修飾 (BSTH001-転醒R02(A) effect[1] 他) ---
  // 「自分のスピリットの『コア除去効果』で移動するコアの数を+N する」。
  // actingPlayerId = 修飾の受益プレイヤー (= 「自分」)、modifierAmount = +N。
  // executeCoreMove が対象コアシュート (相手カード源, source が自分のスピリット)
  // の amount に +bonus を加算する。終止形 = 強制 / 期間中ずっと +N (消費なし)。
  // metadata.coreMoveAmountScope: "self_player_spirits"。
  | "core_move_amount_modifier"
  // --- 煌臨条件コスト付与 (BSTH02-C03 Lv2) ---
  // 「系統/コスト条件を満たすスピリットすべては、自分が【煌臨】するとき、コストはNとしても扱う」。
  // additional_cost (自分自身・全コスト判定に影響) と異なり (a) targetFilter で自分以外の
  // カード群にも付与でき (b) AdventCondition.minCost 判定にのみ作用し他のコスト判定
  // (対象フィルタ・破壊条件等) には影響しない。matchesAdventCondition が
  // getAdventCostOverrides 経由で消費する (advent-system.ts SSOT)。
  | "advent_cost_override"
  // --- 継続効果の持続期間の事後書き換え (ENGINE-continuous-effect-duration-rewrite) ---
  // 「相手のマジックの『このターンの間』を『次のバトル終了後まで』に変更する」
  // (BSLH01-X03 Lv2-3)。effect_param_modify が他効果の DSL パラメータ
  // (target.filter) を書き換えるのに対し、duration_override は **既に生成された
  // ContinuousEffect の duration.scope そのもの** を、失効判定
  // (removeExpiredContinuousEffects) の都度読み替える (生成順序に非依存の SSOT)。
  // targetFilter: player + CardFilter (effect_param_override の player_cards scope
  // と同型)。metadata: DurationOverrideMetadata ({ fromScope, toDuration })。
  | "duration_override";

/**
 * 盤面に適用中の継続効果 1 件。
 * 発揮元がフィールドを離れても、duration が満了するまで残る。
 */
export interface ContinuousEffect {
  /** 一意識別子。 */
  effectId: string;
  /** 効果を発揮したカードの instanceId。離場済みでも記録は残す。 */
  sourceInstanceId: string;
  /** 効果を発揮したカードの definitionId。 */
  sourceDefinitionId: string;
  /** 効果を発揮したプレイヤー。 */
  actingPlayerId: string;
  /**
   * タイミングスコープ。設定時は state.step / state.activePlayerId に基づき
   * 消費側（getCEsForTarget / getGlobalCEs）でフィルタされる。省略時は常時有効。
   */
  timingScope?: TimingScope;
  /** 持続期間。 */
  duration: EffectDuration;
  /** 発揮時のターン番号 (期限判定に使用)。 */
  createdAtTurn: number;
  /** 発揮時の attackId (this_battle 用)。 */
  createdAtAttackId: string | null;
  /** 効果の中身を表すタグ。hand-written resolver が解釈する。 */
  modifierTag: ContinuousEffectTag;
  /** 修飾量 (BP 増減など)。効果によっては不要。 */
  modifierAmount?: number;
  /** cost_override の継続付与を開始するときだけ使用枠を消費する。CEの失効とともに終了する。 */
  usageLimitConsumed?: boolean;
  /**
   * 動的修飾量。`modifierAmount`（固定値）の代わりに `DynamicCount` を保持し、
   * 消費時（BP 計算時など）に現在の盤面で再評価する。「自分のカウント1につき BP+1000」
   * のような *継続* 比例修飾を表す。設定時は `modifierAmount` より優先される
   * （`getBpModifierTotal` が evaluateContinuousDynamicAmount で live 評価する）。
   * 評価は actingPlayerId 基準で行い、source は盤面のみで解決できる種別
   * （count_value / cores_on / cards_in_zone）に限る（stepContext を要する種別は不可）。
   */
  modifierAmountDynamic?: import("./dsl-types").DynamicCount;
  /**
   * 追加シンボル色 (symbol_addition / treat_as 系で使用)。
   * - 単色: 配列に1要素を入れる (例: ["red"])
   * - デュアルカラーシンボル: 1つのシンボルが複数色として扱われる場合は2要素以上 (例: ["red","purple"])
   *
   * symbol_addition では「シンボル1つ追加」を 1 CE として表す。
   * 配列内の複数色は「同一シンボルが各色として扱われる」意味で battle-shared.ts /
   * legal-actions-shared.ts が dual-color bundle として扱う。
   */
  modifierSymbol?: SymbolColor[];
  /**
   * 動的シンボルソース（`SymbolAddAction.symbolSource` 由来）。設定時 `modifierSymbol`
   * より優先し、消費時（`getSymbolAdditions`）に live 評価する。player は CE 生成時に
   * 解決済みの playerId（`EffectPlayerRef` ではなく具体 ID）。
   * "under_card_symbols" は playerId ではなく roleTag（対象 CE の targetInstanceId 自身の
   * アンダーカードを roleTag で絞り込み、各アンダーカードの base symbolColors を union する）
   * を保持する自己参照ソース（BSAZ02-TX01(B) precedent）。
   * "zone_symbols" は playerId + zone + 任意 filter（CardFilter）で任意ゾーンの複数カードを
   * 個別バンドルとして加算する一般化版（BSTH08.5-X04 precedent）。
   */
  modifierSymbolSource?:
    | {
        kind: "field_colors_present" | "presented_contract_colors";
        playerId: string;
      }
    | {
        kind: "under_card_symbols";
        roleTag: string;
        filter?: import("./dsl-types").CardFilter;
      }
    | {
        kind: "zone_symbols";
        playerId: string;
        zone: Zone;
        filter?: import("./dsl-types").CardFilter;
      };
  /**
   * `modifierSymbol` を追加する個数（`SymbolAddAction.count` 由来、固定値）。
   * 省略時=1。`modifierSymbolCountDynamic` 設定時はそちらが優先される。
   */
  modifierSymbolCount?: number;
  /**
   * `modifierSymbol` を追加する個数の動的量。消費時（`getSymbolAdditions`）に
   * `evaluateStatelessSourceCount` で live 評価する（`modifierAmountDynamic` と同型）。
   */
  modifierSymbolCountDynamic?: import("./dsl-types").DynamicCount;
  /**
   * `under_card_slot_capacity` 用: host 自身の underCardSlots 該当 roleTag 枠上限へ加算する
   * ソース (`UnderCardSlotCapacityGrantAction` 由来)。`hostRoleTag` = 加算先の host 自身の
   * underCardSlots roleTag、`childRoleTag` = 走査対象の host text_role アンダーカード roleTag
   * (それぞれの自身の underCardSlots[hostRoleTag] を合算する)。
   */
  modifierUnderCardSlotBonus?: {
    hostRoleTag: string;
    childRoleTag: string;
    childFilter?: import("./dsl-types").CardFilter;
  };
  /** 効果の対象カード instanceId (特定カード限定の場合)。 */
  targetInstanceId?: string;
  /**
   * 動的対象フィルタ（「すべて」系効果用）。
   * targetInstanceId が未設定で targetFilter がある場合、消費側（BP 計算 /
   * prevent_battle 判定等）が実消費時に動的マッチングを行う。
   * 新規召喚カードにも自動適用される。
   * maxCores/minCores は「コアN個以下/以上の〜」用（prevent_battle 等）。消費側が
   * `getTotalCoresOnCardById`（SSOT: 通常コア + ソウルコア）を coreCount として渡した
   * ときのみ評価される（場外カード等 coreCount 未提供時は適用されない）。
   */
  targetFilter?: { player: EffectPlayerRef } & import("./dsl-types").CardFilter;
  /**
   * `targetFilter` の動的マッチング（`matchesGlobalCETargetFilterInternal`）で発生源カード
   * 自身 (`sourceInstanceId`) を対象から除外する。`TargetSpec.excludeSelf` から
   * override_properties の count:"all" dynamic global CE 登録時に伝搬する
   * （カテゴリ全般の除外は targetFilter 側に指定する）。
   */
  targetExcludeSelf?: boolean;
  /** 効果の優先度 (prohibition > obligation > normal)。省略時は "normal"。 */
  forceLevel?: EffectForceLevel;
  /**
   * `defense_immune` 専用: 発生源スコープ限定の「相手の効果を受けない」。
   * 指定時、当該 CE は **発生源カードが scope に一致する相手の効果のみ** を免疫対象とする
   * （「相手のスピリットの効果を受けない」= categories:["spirit"] 等）。省略時は発生源を
   * 問わない blanket 免疫（従来挙動）。isCardImmuneToOpponentEffect が発生源カードと照合する。
   */
  immunitySourceScope?: {
    categories?: CardCategory[];
    colors?: CardColor[];
    maxCost?: number;
    /**
     * 発生源効果の発動タイミング (main/flash/stack) 軸。categories/colors/maxCost と OR 結合
     * (`immunitySourceMatches`)。ENGINE-immunity-source-activation-timing。
     */
    activatedTimings?: EffectActivationTiming[];
    /**
     * true のとき、発生源カードが合体状態 (`attachedToInstanceId !== null ||
     * attachedChildrenIds.length > 0`、card-filter.ts の `CardFilter.combined` と同一判定)
     * であれば scope 対象から除外する（categories 等の一致に関わらず免疫を適用しない）。
     * 「合体スピリット/マジック以外の効果を受けない」(BSAZ02-C04) のような
     * 「特定カテゴリ除外」型の耐性を表現する。省略時 = false（合体状態を考慮しない）。
     */
    excludeCombined?: boolean;
    /** 指定時は、このカテゴリの合体ユニットだけを除外する。 */
    excludeCombinedCategories?: CardCategory[];
    /**
     * true のとき、発生源カードが創界神/導界者ネクサス (`isGrandwalkerOrGuidedNexus` 判定、
     * grandwalkerData 保持カード = 神託/導託を持つカード) であれば scope 対象から除外する
     * （categories 等の一致に関わらず免疫を適用しない）。excludeCombined と同型の
     * 「特定種別除外」軸。機構由来の効果だけを除外する場合は `excludedAspects` を使う。
     * 省略時 = false（創界神/導界者を考慮しない）。
     */
    excludeGrandwalkerOrGuided?: boolean;
    /**
     * 発生源カードの実効系統 (`getEffectiveTribes`) がこの一覧のいずれかに一致すれば
     * scope 対象から除外する。excludeCombined/excludeGrandwalkerOrGuided と同型の
     * 「特定種別除外」軸。「系統：「CB」/「導力器」を持たない自分の効果を受けない」
     * (BSLH01アーツ T07-T17) のような「特定系統以外の効果を受けない」型を表現する
     * （`sourcePlayerScope:"self"` と併用）。発生源不明時は除外しない
     * （保守的に免疫を成立させる方向、categories/colors とは逆の安全側）。
     */
    excludeTribes?: string[];
    /**
     * true のとき、発生源カードがこの CE の sourceInstanceId と同一なら scope 対象から
     * 除外する。「このカード以外の効果を受けない」型で、自身の効果だけは貫通させる。
     * 発生源不明時は除外しない。
     */
    excludeSelf?: boolean;
    /**
     * 発生源カードが印字バースト系ヘッダを持つか。
     * 「相手のバースト効果を持つスピリット/アルティメットの効果を受けない」
     * (BSTH02-R03) のような原文はこちらを使い、keywordTags:["burst"] では判定しない。
     */
    hasBurstEffect?: boolean;
    /**
     * 発生源カードが持つキーワード (`CardDefinition.keywordTags`) による絞り込み。
     * categories/colors/maxCost と AND 結合（`EffectSourceFilter.keywords` /
     * `matchesEffectSourceFilter` と同じ「いずれか1つ以上一致」判定を流用）。
     */
    keywords?: string[];
    /**
     * true のとき、この CE を保持するカードの相手フィールドに現在ある全カードの
     * 実効シンボル色 (`getEffectiveSymbols`) の和集合を、動的な colors 集合として使う。
     * 固定 `colors` と併用時は両者を OR (和集合) する。「相手のフィールドにある
     * シンボルの色の効果を受けない」(BSTH05.5-M01) 型を表現する。省略時 = false。
     */
    colorsFromOpponentFieldSymbols?: boolean;
    /**
     * 指定時、この CE は「対象が受ける効果のうち、書き込み先アスペクトがこの一覧に
     * 含まれるもの」だけを免疫対象にする。他の scope 軸（categories/colors/...）が
     * 発生源カードの属性で絞るのに対し、これは **発揮される効果自身が何を書き換えるか**
     * で絞る直交した軸（呼び出し側が `effectAspect` として渡す値、例 "symbols"）。
     * 省略時は従来どおり aspect を問わない blanket 免疫。
     * 「対象のシンボルはこの効果以外の効果を受けない」(BSTH11-R02) のような
     * 「特定プロパティのみ保護、他は素通り」を表現する。ENGINE-symbol-lock-self-effect-immunity。
     * 呼び出し元は native-target-resolution.ts (override_properties の per-instance 経路、
     * symbols/symbolCountFixed 書き込みを "symbols" として判定) と legal-actions-shared.ts の
     * `globalOverridePropertiesCanAffectCard`（count:"all" filter-target dynamic global CE
     * 経路、プロパティキー名と同じ文字列 "symbols"/"addTribes"/"levelCost"/"levelCostDelta"/
     * "level" を判定に使う、ENGINE-effect-immunity-global-ce-fast-path-bypass）。
     */
    restrictedAspects?: string[];
    /**
     * 指定時、効果アスペクトがこの一覧に一致する場合は発生源スコープから除外する。
     * 「【神託】/【導託】以外の効果を受けない」のように、通常の同種カード効果を
     * 保護しつつ機構由来の効果だけを通すための負のアスペクト軸。
     */
    excludedAspects?: string[];
  };
  /**
   * `defense_immune` 専用: 免疫対象となる効果の発揮プレイヤー範囲。
   * 省略時は従来どおり opponent-only。
   * 「自分の効果を受けない」型は "self"、「一切の効果を受けない」型は "any" を使う。
   */
  immunityPlayerScope?: "opponent" | "self" | "any";
  /** 拡張メタデータ。CE 種別固有の追加情報を格納する。 */
  metadata?: Record<string, unknown>;
  /**
   * この CE がカード定義上のどの effect/step から生成されたかの出自情報。
   * リビルダ (rebuildContinuousEffectsFromField) が重複登録を防ぐために参照する。
   * 旧パイプラインで生成された CE には未設定。
   */
  provenance?: {
    effectIndex: number;
    stepIndex: number;
    /** 効果コンテナへの参照。省略は effects、null は定義外の合成効果。 */
    definitionPath?: readonly (string | number)[] | null;
    /**
     * 星霊衣のように source card と効果テキスト提供元が異なる CE 用。
     * sourceInstanceId/sourceDefinitionId は発揮主体（host）を維持し、
     * re-builder の dedup / 再評価だけを効果提供元の definition/effectIndex へ向ける。
     */
    effectSourceInstanceId?: string;
    effectSourceDefinitionId?: string;
  };

  // --- retrigger 専用フィールド (modifierTag === "retrigger" のときのみ使用) ---
  // P3-15 問題6 対応: 旧 activeRetriggerEffects を CE に統合 (2026-04-17)。
  /** 再発火のトリガーイベント。 */
  retriggerEvent?: CardEventType;
  /** トリガーカードのプレイヤー。 */
  retriggerPlayer?: EffectPlayerRef;
  /** トリガーカードのフィルタ条件。 */
  retriggerFilter?: RetriggerTriggerFilter;
  /** ソースカードの effects 配列インデックス。 */
  retriggerEffectIndex?: number;
  /** 再発火対象のステップインデックス。 */
  retriggerStepIndex?: number;
  /** 最大発火回数。省略時 = 無制限。 */
  retriggerMaxCount?: number;
  /** 現在の発火回数。 */
  retriggerFireCount?: number;
  /** 再発火時に実行する step の executionMode 上書き。 */
  retriggerFireExecutionMode?: "mandatory" | "optional";
  /** optional step を発火時に自動 execute するか。省略時 = true。 */
  retriggerAutoResolveOptional?: boolean;
}

/**
 * 効果の使用回数制限のスコープ (エターナル Ver.17.0 FAQ 基準)。
 *
 * - "per_instance": 〔ターンに1回〕等 — 各インスタンスごとに独立してカウント。
 * - "per_card_name": 〔ターンに1回:同名〕等 — 同名カード全体で共有カウント。
 * - "no_duplicate": 〔重複不可〕— 同名カードが複数いても、条件を満たすのは 1 体のみ。別カード名なら別々に発揮可。
 */
export type EffectUsageLimitKind =
  | "per_instance"
  | "per_card_name"
  /** 同一プレイヤーの limitGroupId 全体で共有する制限（カード名・個体を跨ぐ）。 */
  | "per_group"
  | "no_duplicate"
  /**
   * 「ターンに1回ずつ」「カード1枚につきターン1回」型 — 観測されたトリガー主語 Y 別に
   * 独立した turn 1 回制限。記録キーは (sourceInstanceId, effectLabel, relatedInstanceId)。
   * card_event/game_event 等の triggered effect で `pendingEffect.relatedInstanceId` を
   * 主語 Y として消費する。relatedInstanceId 不在 (主語のない player 値イベント等) では
   * per_instance 同様に動く (主語 Y が空集合)。
   * no_duplicate と併用すると、同名の発揮元間で主語の使用回数を共有する。
   */
  | "per_trigger_related_instance"
  /**
   * 「破壊効果を発揮したとき」型 — 同一 effect activation 由来の複数 trigger 発火を
   * 1 回に dedup する。記録キーは (sourceInstanceId, effectLabel, triggerActivationKey)。
   * triggerActivationKey は `PendingTriggeredEffect.chainId` から導出する。
   * 1 つの破壊効果が複数体を破壊して per-card に game_event:destroy を emit しても、
   * chainId が共有されるため listener は activation あたり 1 回だけ発火する。
   * chainId 不在 (state-based 由来等) では legacy per-instance 同様に動く。
   * 正源: ENGINE-trigger-per-effect-activation-dedup (autorun-queue/needs-dsl.audit.jsonl)。
   */
  | "per_trigger_activation";

/**
 * 使用回数制限の期間軸。
 *
 * - "turn":   〔ターンに○回〕— ターン終了時にリセット。
 * - "game":   〔ゲームに○回〕— ゲーム終了までリセットなし。
 * - "step":   〔ステップに○回〕— ステップ遷移時にリセット。
 * - "battle": 〔バトルに○回〕— 記録時の `state.activeAttack.attackId` を
 *   `EffectUsageRecord.attackId` に保存し、現在の `attackId` と一致する記録のみ有効
 *   （バトル外だと `attackId` が null になり、常に非マッチ = 使用不可。BSSL01-M03[3,4]）。
 */
export type EffectUsageLimitDuration = "turn" | "game" | "step" | "battle";

/**
 * 効果の使用回数制限。
 * maxCount を省略すると 1 回。
 * duration を省略すると "turn"。
 */
export interface EffectUsageLimit {
  kind: EffectUsageLimitKind;
  /** 制限の期間軸。省略時は "turn"。no_duplicate では無視される。 */
  duration?: EffectUsageLimitDuration;
  /** 最大使用回数。省略時は 1。 */
  maxCount?: number;
  /**
   * base maxCount に加算する動的回数。
   * 盤面のみで評価できる DynamicCount (count_value 等) を使用し、
   * 「自分のカウント4につき、この効果の発揮回数を+1回する」型を表す。
   */
  maxCountAdditionalDynamic?: import("./dsl-types").DynamicCount;
  /**
   * 条件付き maxCount 上書き (BSAZ01-X01[1] 「合体中、この効果を[ターンに3回]に変更する」 2026-06-26)。
   * 評価時点で最初に成立した entry の maxCount を採用する。全て不成立なら base の maxCount を使う。
   * 評価に getCardDefinitionById を要する clause は使えない (legal-actions-shared から
   * structured-effect-interpreter への循環 import 回避のため inline 評価。`combined` /
   * `count_value` のみ対応)。
   * 新 clause を足すときは getUsageLimitMaxCount 内 evaluateUsageLimitClause を拡張する。
   */
  maxCountOverrides?: readonly {
    when: Condition;
    maxCount: number;
  }[];
  /**
   * P3-14 C-2 (effect_resisted): 効果解決が相手効果の妨害を受けた場合は使用記録を
   * 払い戻し、制限を消費しない (「相手の効果を受けなかったとき…しか使えない」BSTH01-C21)。
   */
  unlessAffectedByOpponent?: boolean;
}

/**
 * 効果の使用回数を追跡する 1 レコード。
 * GameState.effectUsageRecords に蓄積し、期間軸に応じてクリアする。
 */
export interface EffectUsageRecord {
  /** 効果を発揮したカードの instanceId。 */
  sourceInstanceId: string;
  /** 発揮時のフィールド個体世代。per_instance のみ照合する。旧スナップショットの未設定は 0。 */
  sourceFieldInstanceGeneration?: number;
  /** 発揮時の魂状態化世代。【魂状態】を含まない per_instance 効果のみ照合する。未設定は 0。 */
  sourceSoulStateGeneration?: number;
  /** 効果を発揮したカードの definitionId (カード名スコープ判定用)。 */
  sourceDefinitionId: string;
  /** Player who used the effect. Missing on older snapshots; derive from sourceInstanceId when possible. */
  playerId?: string;
  /** 効果を特定するラベル (同一カードの複数効果を区別する)。 */
  effectLabel: string;
  /** 記録されたターン番号。 */
  turnNumber: number;
  /** 記録されたステップ (step duration 用)。 */
  step: Step;
  /** このレコードの有効期間。期限切れクリーンアップに利用する。 */
  duration: EffectUsageLimitDuration;
  /**
   * 記録時の `state.activeAttack.attackId`。duration="battle" のときのみ設定し、
   * `isRecordInDurationScope` が現在の attackId と比較してスコープ判定する。
   * バトル外での記録は null（常に非マッチ = 使用不可）。他 duration では未設定。
   */
  attackId?: string | null;
  /** 使用回数。 */
  count: number;
  /**
   * 共有使用制限グループ ID。
   * 異なるタイミング（召喚時/アタック時等）で分離された効果が
   * 同一の使用回数を共有する場合に設定する。
   * 同一 groupId のレコードは合算してカウントされる。
   */
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測されたトリガー主語 Y の instanceId。
   * 主語 Y 別に独立した turn 1 回制限を表現するため、同一 (sourceInstanceId, effectLabel)
   * でも relatedInstanceId が異なれば別レコードとして扱う。
   * 他 kind では undefined で記録する。
   */
  relatedInstanceId?: string;
  /** 主語が実離脱・再登場した場合は、新しい個体として使用回数を分ける。 */
  relatedFieldInstanceGeneration?: number;
  /**
   * 〔重複不可〕(`no_duplicate`) 専用: 同一 trigger event の scope を識別するキー。
   * 通常は `PendingTriggeredEffect.pendingId` を使う。同 pending 内のみで畳み、
   * 別 pending (別 trigger 発火) では match しないようにする。
   * 10_rules/03c §〔重複不可〕 per-event scope (裁定 2026-06-24)。
   * 他 kind / 非 trigger 経路では undefined で記録 (legacy behaviour)。
   */
  triggerEventScopeKey?: string;
  /**
   * `per_trigger_activation` 専用: 同一 effect activation 由来の trigger 群を識別するキー。
   * `PendingTriggeredEffect.chainId` から導出する。同 chainId の record と match する。
   * 他 kind では undefined で記録する。
   * 正源: ENGINE-trigger-per-effect-activation-dedup。
   */
  triggerActivationKey?: string;
}

/**
 * 「ターンに/ゲーム中にN回目の観測でのみ発火する」型 (BSLH01-C05/R03 quartz set-effect 等)。
 * `EffectUsageLimit` (発動/宣言時にのみ加算、maxCount 上限) とは別軸で、トリガー条件の
 * 検出成功のたび (発動可否に関わらず) 無条件で tally を加算し、加算後の値が `targetCount`
 * と厳密一致したときのみ発火する。1〜(targetCount-1) 回目は完全に無視される（発火しない）。
 * 正源: `effect-occurrence-gate.ts` / ENGINE-nth-occurrence-trigger-gate。
 */
export interface EffectOccurrenceGate {
  /** tally の期間軸。`EffectUsageLimitDuration` を再利用 (SSOT)。 */
  duration: EffectUsageLimitDuration;
  /** この回数目の観測でのみ発火する（範囲ではなく単一値との厳密一致）。 */
  targetCount: number;
  /**
   * 共有 tally グループ ID (`Effect.limitGroupId` と同型の合算キー、ENGINE-nth-occurrence-trigger-gate
   * Step3)。「召喚/配置/使用」のように単一の Timing では表現できず複数の card-data effect
   * エントリ (= 別 effectIndex → 別 effectLabel) に分割せざるを得ない観測を、1つの tally に
   * 合算するために使う (BSLH01-R03「相手が…召喚/配置/使用したとき、4回目なら」)。
   * 設定時は effectLabel ではなく groupId でレコードをマッチする。
   */
  groupId?: string;
}

/**
 * 効果解決途中の再評価タイミング。
 *
 * - "before_each_step": 複合効果 (EffectComposition) の各ステップ解決前に再評価する。
 * - "after_sba": SBA / flush 後に再評価する。
 * - "after_trigger_resolution": 誘発効果の解決後に再評価する。
 */
export type EffectReevaluationTiming =
  | "before_each_step"
  | "after_sba"
  | "after_trigger_resolution";

/**
 * 再評価で実行するチェックの種類。
 *
 * - "target_validity": 対象がまだ有効か (存在する・効果を受けられる)。
 * - "effect_suppression": 「発揮させない」(suppress_effect CE) によるブロック判定。
 *   CE に `metadata.effectFilter` が無ければ対象カードの全効果を抑止 (blanket)、
 *   有ればいま発揮されようとしている効果が一致するときのみ抑止する。
 * - "prevention_clash": E-4 の防止レベル衝突判定 (canEffectPenetrateDefense)。
 */
export type EffectReevaluationCheckKind =
  | "target_validity"
  | "effect_suppression"
  | "prevention_clash";

/**
 * 「発揮させない」(effect_suppression) 判定で、いま発揮されようとしている
 * 効果を識別するための記述子。`suppress_effect` の `effectFilter` と突き合わせる。
 *
 * 省略時 (descriptor 無し) は効果を特定できないため、`effectFilter` 付きの
 * 抑止 CE はマッチ判定できない。`effectFilter` 無し (blanket) の抑止 CE は
 * descriptor 有無にかかわらず対象カードの全効果を抑止する。
 */
export interface SuppressionEffectDescriptor {
  /** 効果を持つカード定義 ID。転醒/裏返り後の同一 instance 別面を区別する。 */
  sourceDefinitionId?: string;
  /** 効果発揮元の登録 sourceKind。例: "spirit" / "ultimate" / "nexus"。 */
  sourceKind?: EffectSourceKind;
  /** カード定義 effects[] 内の index。指定時は同一カード上の別効果を区別する。 */
  effectIndex?: number;
  /** 原文ラベル由来の効果分類。例: "spirit_attack_time"。 */
  effectLabels?: readonly string[];
  /** 効果の発揮タイミング種別 (例: "card_event" | "activated" | "continuous" | "triggered")。 */
  timingKind?: string;
  /** 効果の見出し (例: 「このスピリットのアタック時」)。 */
  heading?: string;
  /** 発動条件句 (例: ["召喚時", "アタック時"])。 */
  triggerPhrases?: readonly string[];
  /** card_event の発火イベント (例: "summon" | "attack")。 */
  eventAction?: string | readonly string[];
  /** 効果に付与されたキーワード。 */
  keywords?: readonly string[];
  /**
   * 効果 steps (choice 分岐含む) に含まれる action.kind の集合 (重複除去)。
   * `EffectTargetFilter.containsActionKinds` の照合元 (SSOT: deriveSuppressionEffectDescriptor
   * が effect.steps を再帰走査して算出)。
   */
  containsActionKinds?: readonly string[];
  /** activated 効果のモード (例: "main" | "flash" | "stack")。 */
  activatedMode?: string;
  /** 見出しラベルの効果分類。none は本文で許可されたタイミング行動。 */
  activationLabel?: ActivatedEffectLabel;
  /** 常時効果の発揮条件がある場合に設定。未設定は condition 無し。 */
  activationCondition?: "present";
  /** 常時効果の発揮場所がある場合に設定。未設定は location 無し。 */
  activationLocation?: "present";
}

// --- 条件付き再発火 (retrigger) ---

/** 再発火効果のトリガーフィルタ。CardFilter と同じ評価系を使う。 */
export type RetriggerTriggerFilter = import("./dsl-types").CardFilter;

/**
 * 条件付き再発火効果。
 * フラッシュ等の一時効果がターン中持続し、
 * 特定イベント発生時に再発火するパターンを表現する。
 *
 * 例: 「このターンの間、〇〇がアタックしたとき、BP-2000する（上限：6回）」
 *
 * P3-15 問題6 対応 (2026-04-17): ContinuousEffect に統合され、
 * state.activeContinuousEffects 内で `modifierTag === "retrigger"` の CE として管理される。
 * 本型は後方互換・可読性のため残した型エイリアス。
 *
 * 対応フィールドマッピング:
 * - retriggerId    → effectId
 * - event          → retriggerEvent
 * - triggerPlayer  → retriggerPlayer
 * - triggerFilter  → retriggerFilter
 * - effectIndex    → retriggerEffectIndex
 * - stepIndex      → retriggerStepIndex
 * - maxCount       → retriggerMaxCount
 * - fireCount      → retriggerFireCount
 * - fireExecutionMode → retriggerFireExecutionMode
 * - autoResolveOptional → retriggerAutoResolveOptional
 */
export type RetriggerEffect = ContinuousEffect & {
  modifierTag: "retrigger";
  retriggerEvent: CardEventType;
  retriggerPlayer: EffectPlayerRef;
  retriggerEffectIndex: number;
  retriggerStepIndex: number;
  retriggerFireCount: number;
  retriggerFireExecutionMode?: "mandatory" | "optional";
  retriggerAutoResolveOptional?: boolean;
};

export interface PendingRetriggerContinuation {
  continuationId: string;
  event: CardEventType;
  triggerCard: CardInstance;
  triggerCardDefinitionId: string;
  remainingEffectIds: readonly string[];
}

/**
 * 再評価チェックが失敗したときの処理方針。
 *
 * - "skip_step": 該当ステップをスキップし、後続ステップは続行する。
 * - "abort_remaining": 該当ステップ以降の全ステップを中止する。
 * - "remove_target": 対象を除外して続行する (残り対象があれば効果は発揮)。
 */
export type EffectReevaluationFailurePolicy =
  | "skip_step"
  | "abort_remaining"
  | "remove_target";

/**
 * 効果解決途中の再評価ポイント 1 件。
 * 複合効果の各ステップ間や SBA 後に挟み、
 * 盤面変化で効果の継続可否を判定する。
 */
export interface EffectReevaluationPoint {
  /** いつ再評価するか。 */
  timing: EffectReevaluationTiming;
  /** 何をチェックするか。 */
  checks: readonly EffectReevaluationCheckKind[];
  /** チェック失敗時の処理方針。省略時は "skip_step"。 */
  failurePolicy?: EffectReevaluationFailurePolicy;
}

export type LifeCoreDestination =
  | {
      kind: "card";
      instanceId: string;
    }
  | {
      kind: "reserve";
      playerId: string;
    }
  | {
      kind: "trash";
      playerId: string;
    }
  | {
      kind: "void";
      playerId: string;
    }
  | {
      kind: "removed_from_game";
    };

export type LeaveFieldNormalCoreDestination =
  | {
      kind: "reserve";
      playerId: string;
    }
  | {
      kind: "trash";
      playerId: string;
    }
  | {
      kind: "void";
      playerId: string;
    };

export type LeaveFieldSoulCoreDestination =
  | {
      kind: "reserve";
      playerId: string;
    }
  | {
      kind: "trash";
      playerId: string;
    }
  | {
      kind: "void";
      playerId: string;
    }
  | {
      kind: "removed_from_game";
    };

export interface LeaveFieldCoreDestinationOverride {
  normalCoreDestination?: LeaveFieldNormalCoreDestination;
  soulCoreDestination?: LeaveFieldSoulCoreDestination;
}

export interface LevelDefinition {
  level: number;
  requiredCores: number;
  /** 印字「C」のLv条件。指定時はコア数ではなくコントローラのカウントで判定する。 */
  requiredCount?: number;
  bp?: number;
}

export interface AdditionalBraveSlot {
  hostCondition?: BraveCondition;
  requiredAttachedBraveNameContains?: string[];
  maxPerHost?: number;
}

/** ダブルフェイスカードの裏面データ */
export interface CardBackFace {
  /** カード詳細のOC列。表示専用で、BP計算は既存の効果・overCount定義が担う。 */
  printedOverCount?: { minCount: number; bpBonus: number };
  name: string;
  printedCategory: CardCategory;
  colors: CardColor[];
  cost: number;
  reductionSymbols: SymbolColor[];
  levelDefs: LevelDefinition[];
  /** 印字されたOCのBP加算。Lv表のBPとは独立し、指定カウント以上で加算する。 */
  overCount?: { minCount: number; bpBonus: number };
  symbolColors: SymbolColor[];
  /** 複合印字シンボルがある場合の1個ごとの色集合。symbolColorsはこの平坦化。 */
  symbolColorEntries?: SymbolColor[][];
  textLines: string[];
  keywordTags: string[];
  tribe?: string;
  image?: string;
  rarity?: string;
  pack?: string;
  cardNo?: string;
  /**
   * ブレイヴの『BP＋』値（合体時にホストの BP に加算される `(0)合体 +N` の N）。
   * スピリット状態の Lv1 BP（`levelDefs`）とは別の印字値。B 面がブレイヴの転醒後合体で使う。
   */
  combinedBoost?: number;
  /** B 面がブレイヴの場合の合体条件（例: 創界石の転醒後ブレイヴ 玄爺/操り糸） */
  braveCondition?: BraveCondition;
  /** B 面ブレイヴが条件付き追加合体枠を宣言する場合の枠定義。 */
  additionalBraveSlot?: AdditionalBraveSlot;
  /**
   * true のとき、B 面ブレイヴが合体先から分離してスピリット状態単独になった瞬間に
   * SBA で即座に A 面へ裏返る（`executeReverseRebirth` mode:"flip" を再利用）。
   * BSGE01 裏面5面「スピリット状態のこのブレイヴは…ただちに裏返す」用（P3-111 残り）。
   */
  revertToFrontOnSeparation?: boolean;
  /** B 面が異魔神ブレイヴの場合の左右合体データ（10_rules/08c §7、例: 玄爺）。 */
  imaginBraveData?: ImaginBraveData;
  /** B 面がクォーツの場合のクォーツ定義（転醒後の効果限定セットクォーツ 虎威/妨害3 等）。 */
  quartzData?: QuartzData;
  /**
   * B 面が text_role アンダーカード枠を宣言する場合の枠定義（`CardDefinition.underCardSlots` と同型）。
   * 転醒/rebirth 後の合成定義 (`synthesizeBackFaceDefinition`) へそのまま伝播する
   * （例: BSAZ02-TX01(B) の【アルドノアドライブ：3】枠拡張）。
   */
  underCardSlots?: { roleTag: string; maxCount: number }[];
  /**
   * false のとき、B 面ブレイヴをメインステップの通常 `brave_combine` legal action に出さない。
   * `braveCondition` は合体維持/効果内合体の適格判定に引き続き使う。
   */
  allowMainStepBraveCombine?: boolean;
  effects?: import("./dsl-types").Effect[];
}

export interface CardDefinition {
  /** カード詳細のOC列。表示専用で、BP計算は既存の効果・overCount定義が担う。 */
  printedOverCount?: { minCount: number; bpBonus: number };
  cardNo: string;
  /** orika-react 側の数値カード ID（クラウドデッキ連携用） */
  orikaId?: number;
  /** orika-react cardData 配列のインデックス（表示順用） */
  orikaIndex?: number;
  name: string;
  printedCategory: CardCategory;
  colors: CardColor[];
  cost: number;
  displayCostText?: string;
  reductionSymbols: SymbolColor[];
  levelDefs: LevelDefinition[];
  symbolColors: SymbolColor[];
  /** 複合印字シンボルがある場合の1個ごとの色集合。symbolColorsはこの平坦化。 */
  symbolColorEntries?: SymbolColor[][];
  /** 印字されたOCのBP加算。Lv表のBPとは独立し、指定カウント以上で加算する。 */
  overCount?: { minCount: number; bpBonus: number };
  textLines: string[];
  keywordTags: string[];
  tribe?: string;
  image?: string;
  rarity?: string;
  pack?: string;
  maxDeckCount?: number;
  /** トークンデッキの最大枚数（トークンカード専用） */
  maxTokenDeckCount?: number;
  /** ダブルフェイスカードかどうか */
  isDoubleSided?: boolean;
  /** ダブルフェイスカードの裏面 */
  backFace?: CardBackFace;
  /** 関連トークンの cardNo 配列 */
  relatedTokenCardNos?: string[];
  /**
   * アルティメット召喚条件（《召喚条件：…》）。宣言前チェック（コスト支払いとは別。
   * 10_rules/04 L190-194）。ConditionClause 配列（全て AND）で宣言し、評価は
   * `evaluateCondition()` を正源とする（SSOT。CLAUDE.md「条件評価は evaluateCondition() を使う」）。
   * `canSummonUltimate()` が legalActions 列挙時に判定する。
   */
  summonCondition?: Condition;
  /**
   * true のとき、`summonCondition` を「宣言時のみ判定する one-shot ゲート」ではなく
   * 「フィールドに存在する間ずっと満たし続けなければならない継続ゲート」として扱う。
   * 条件を満たした時は SBA で自動配置され、満たさなくなると
   * `vanish_due_to_arts_gate_lost` でフィールドから除去される。【アーツ】自己配置トークン
   * （属性値条件を満たす間だけ場に置ける、BSLH01-T07〜T17）専用。
   * 通常のアルティメット《召喚条件》は宣言時 one-shot 判定のみのため、この flag は付けない。
   */
  continuousSummonCondition?: true;
  /**
   * 転召【転召：N／〔系統＆コスト条件〕／送り先】。召喚時効果ではなく**召喚手順内のステップ**。
   * 正しい順序＝コスト支払い → スタックタイミング → 転召 → 維持コア配置（裁定 2026-06-14,
   * 10_rules/07b 転召節 + 02:188）。この転召ステップ専用のスタック窓は開かない。
   * - 適法性: 対象（targetFilter を満たし、送り先へ動かせるコアが N 個以上ある自分のスピリット）が
   *   居なければ召喚宣言自体が不可（canSummonCard が legalActions 列挙時に判定）。
   * - 実行: スタック窓クローズ後・場入り前に、選んだ対象1体の上のコアすべてを送り先へ移す（強制）。
   */
  tenshoSummon?: TenshoSummon;
  /**
   * ブレイヴの『BP＋』値（合体時にホストの BP に加算される `(0)合体 +N` の N）。
   * スピリット状態の Lv1 BP（`levelDefs`）とは別の印字値。`getCombinedUnitBp` が合体 BP 算出に使う
   * （10_rules/05「BP（ブレイヴの『BP＋』値がスピリットの BP に加算）」）。省略時のみ levelDefs Lv1 BP へフォールバック。
   */
  combinedBoost?: number;
  /** ブレイヴの合体条件。指定されたカテゴリ/色/系統のスピリットにのみ合体可能。省略時は制限なし。 */
  braveCondition?: BraveCondition;
  /**
   * false のとき、このブレイヴはメインステップの通常 `brave_combine` legal action に出さない。
   * 「召喚/煌臨した」「スピリット状態になった」その個体にのみ合体できる型で使う。
   * `braveCondition` 自体は合体維持/契約合体/効果内合体の適格判定として残す。
   */
  allowMainStepBraveCombine?: boolean;
  /**
   * このブレイヴが、条件を満たす host の合体可能数に数えられないことを表す。
   * 例: 「系統:『導魔』を持つ自分のスピリット/導界者ネクサスの合体可能体数に数えない」。
   * 合体可否自体は `braveCondition`、host 側追加上限は `maxCombinedBraves` が引き続き担う。
   */
  braveLimitExemption?: {
    hostCondition?: BraveCondition;
  };
  /**
   * incoming brave 側が、条件を満たす host に追加の合体枠を開く。
   * `braveLimitExemption`（数えない）とは別で、このブレイヴ自身は合体数に数えたまま
   * host の通常上限を増やす。重複不可型は `maxPerHost` で同一 cardNo の上限を表す。
   */
  additionalBraveSlot?: AdditionalBraveSlot;
  /**
   * text_role アンダーカード枠の宣言（「このカードの下に『X』をN枚まで置ける」型キーワード、
   * 例【アルドノアドライブ：N】BSAZ02-C10、engine-aldnoah-drive-under-card-keyword が初出）。
   * host 側カード（配置される側ではなく置かれる先）が「roleTag を maxCount 枚まで下に置ける」と
   * 宣言する印字属性。`place_text_role_under_card` の枠上限判定・`declaresUnderCardSlot`
   * CardFilter の第三者観測トリガー絞り込みで参照する（07b §6 汎用アンダーカード基盤＋役割タグ）。
   * 07b §6 の「煌臨元」以外の役割区分に対応するメタデータで、星霊衣/バレットエディットのように
   * 常に1枚固定の既存2機構は未移行（roleTag ごとに maxCount が可変な keyword が初出のアルドノア
   * ドライブのみ利用。将来 N が可変な星霊衣系が出た場合の移行先）。
   */
  underCardSlots?: { roleTag: string; maxCount: number }[];
  /**
   * ホスト側の多重合体キーワード（「系統：Xを持つブレイヴN体まで合体できる」）。
   * 省略時は従来通り 1 体まで。指定時は `count` までブレイヴを同時合体でき、
   * 各ブレイヴ（1体目含む）は `condition` を満たす必要がある（BraveCondition を
   * ブレイヴ側定義に対して照合する SSOT 再利用。P3-16 多重合体クラスタ）。
   */
  maxCombinedBraves?: {
    count: number;
    condition?: BraveCondition;
    /**
     * true のとき、`condition` を満たす incoming brave は自身の `braveCondition`
     * (合体条件) を満たさなくてもこの host へ合体できる。
     * 「合体条件を無視して合体できる」型の host 側許可を、候補列挙・効果合体・
     * state-based 分離で同じ `maxCombinedBraves` 判定に寄せるためのフラグ。
     */
    ignoreIncomingBraveCondition?: boolean;
    /**
     * 合体したブレイヴ効果の self-reference 文言を host 側カテゴリへ読み替えられる
     * host 側許可。例: アルティメット host が、合体中の導魔ブレイヴ効果内
     * 「このスピリット」を「このアルティメット」に変更する（必須/任意は本文に従う）。
     */
    selfReferenceRewrite?: {
      fromText: "this_spirit";
      toHostCategory: "ultimate";
      executionMode: "optional" | "mandatory";
    };
    /**
     * 対応する continuous effect の effects[] index。指定時は、その effect の Lv/applicability/
     * timingScope/effect_suppression が有効な場合だけ追加合体上限を適用する。
     * 未指定の既存カードは従来どおり印字キーワード扱いで常時適用する。
     */
    effectIndex?: number;
    /**
     * カード名ごとの個別上限（「『X』2つまでと『Y』1つと合体できる」型、BSTH01-X02）。
     * `count`（合計上限）とは独立に併用され、両方を満たす必要がある。`cardNameContains` は
     * `BraveCondition.cardNameContains` と同じ部分一致判定（「カード名：」接頭辞が無い引用は
     * 部分一致という SSOT、`matchesCardName` 準拠）。
     */
    nameLimits?: { cardNameContains: string; maxCount: number }[];
  };
  /**
   * 契約合体データ（フラッシュ【契約合体：<条件>】）。手札のブレイヴが自分のソウルコアを
   * トラッシュに置くことを起動コストとして、対象の自分のスピリットに手札から合体する
   * （召喚コストは支払わない・合体していたブレイヴは破棄する）。P3-111 S2。
   */
  contractCombineData?: ContractCombineData;
  /**
   * 契約合体プロキシ起動データ（P3-111 S4）。ネクサス等のこのカード自身の Lv2 起動能力から
   * 契約合体を代理発動する（起動コスト免除・対象カード名制限）。
   */
  contractCombineProxyData?: ContractCombineProxyData;
  /**
   * リンクエイドデータ（P3-111 S6、BSGE01-CX01〜CX04/R01〜R05）。魂状態のこのカードが、
   * `costSourceTribes` に一致する自分のフィールドスピリット1体のコア1個を起動コストとして
   * （固定1個。軽減シンボル/疲労は無関係）、`timingScope` の窓でリザーブのコアを好きなだけ
   * 置いてスピリット状態になる。召喚扱いではない state-change（召喚時効果は誘発しない）。
   */
  linkAidData?: LinkAidData;
  /** 煌臨データ。手札からソウルコアを消費してフィールドカードの上に重ねる。 */
  adventData?: AdventData;
  /** トラッシュのこのカードをフィールドのスピリットとして煌臨元に使う許可。
   * 手札の incoming カード自身の煌臨条件・タイミング・コストは通常どおり。
   * この許可は同名につき各プレイヤーのターン1回。
   */
  trashAdventHostGrant?: {
    cardNames: NonNullable<AdventCondition["cardNames"]>;
    chargeCoresOnAdvent?: boolean;
  };
  /**
   * host 側 (被煌臨側) 同時2体煌臨許可データ（BSDB01-CX01【真バディ】）。
   * このカード自身は他カードへ煌臨しない (adventData 不要)。
   */
  hostDualAdventGrant?: HostDualAdventGrant;
  /**
   * 多重煌臨（1宣言で2 host に同時に重ねる）データ（BSSG01-X03「暁 切歌＆月読 調
   * 『アマルガム』」、10_rules/08a_advent-rebirth-contract.md §多重煌臨、裁定確定
   * 2026-08-01）。通常の `adventData`（1対1）とは別に、2つの host スロット条件を
   * 同時に満たす自分のスピリット/アルティメット2体へ同時に重なる型を表す。
   * `AdventData` と併存しない（1カード=1種別）。
   */
  dualHostAdventData?: DualHostAdventData;
  /** 顕現データ。手札からソウルコア+対象ネクサスのコア1個で召喚する（召喚の一種）。 */
  manifestData?: ManifestData;
  /**
   * アタック宣言の代替宣言データ（BSDB01-TX01(A)「このスピリットはアタックするかわりに
   * 裏返せる。このとき、自分のカウント+3する。」）。転醒(RebirthAction)はコア閾値/カウント
   * 上限到達で受動的に発火するトリガー専用で、プレイヤーがアタック宣言そのものの代わりに
   * 任意選択する代替宣言を表せないため、declare_advent/declare_manifest と同型の
   * カード定義直下の宣言的フィールドとして独立させる（advent/manifestData 同様、汎用
   * steps/timing 系には載せない = declare 系の既存パターンを踏襲）。
   */
  attackAlternativeFlip?: AttackAlternativeFlipData;
  /** アクセルデータ。手札からマジックのようにコストを支払い効果を使用、使用後は手元へ。 */
  accelData?: AccelData;
  /** チェンジデータ。フラッシュタイミングで手札からコストを支払い効果を使用、フィールドのスピリットと入れ替え可能。 */
  changeData?: ChangeData;
  /** ミラージュデータ。メインステップにターン1回セットし【セット中】効果を永続発揮。 */
  mirageData?: MirageData;
  /** 創界神/導界者ネクサスデータ。コア管理・対象判定・神託トリガーの特殊ルールを持つ。 */
  grandwalkerData?: GrandwalkerData;
  /** 創界石ネクサスデータ。創界神とは別カテゴリで、解封トリガーとコア閾値転醒を持つ。 */
  grandstoneData?: GrandstoneData;
  /**
   * トークン等の独立コア管理（グランドウォーカー/創界石とは別系統）。BSKB01-T01
   * 「このカード/スピリットはコアを、出すとき以外で置けず、移動するとき/このスピリット
   * がフィールドを離れるとき、ボイドに置かなければならない」用。
   */
  tokenIndependentCoreManagement?: TokenIndependentCoreManagementData;
  /** ゼロカウンターデータ（P2-07 E-1）。相手の踏み倒し召喚に割り込んで発動。 */
  zeroCounterData?: ZeroCounterData;
  /** 異魔神ブレイヴデータ（P2-07 G-1）。左右2体合体・特殊制約を持つブレイヴ。 */
  imaginBraveData?: ImaginBraveData;
  /** クォーツデータ（P2-07 H-2）。host にセットして host が効果を得る host-subcard ギミック。 */
  quartzData?: QuartzData;
  /** クォーツ host データ（ENIGMA 等）。スロット上限・セット条件を定義する。 */
  quartzHostData?: QuartzHostData;
  /** 構造化効果定義。省略時は手書き resolver にフォールバック。 */
  effects?: import("./dsl-types").Effect[];
  sourceUrls: string[];
  sourceConfidence: SourceConfidence;
}

/**
 * ブレイヴの合体条件。
 * 全フィールドを指定可能で、指定されたフィールドすべてを満たすスピリットにのみ合体できる。
 * 省略されたフィールドは制限なし。
 */
export interface BraveCondition {
  /** 合体可能なカテゴリ（通常は "spirit"、一部は "ultimate" も可） */
  categories?: CardCategory[];
  /** 合体可能な色 */
  colors?: CardColor[];
  /** 合体可能な系統 */
  tribes?: string[];
  /**
   * 創界神/導界者ネクサス条件。CardFilter.targetsGrandwalker と同じ値域だが、
   * BraveCondition では "only" を「この条件枝は創界神/導界者ネクサスだけを許す」
   * という host 条件として使う。
   */
  targetsGrandwalker?: boolean | "only";
  /**
   * `targetsGrandwalker` で許す創界神/導界者ネクサスの種別限定。
   * "guided" = 導界者ネクサス、"grandwalker" = 創界神ネクサス。
   */
  grandwalkerKind?: "grandwalker" | "guided" | "any";
  /**
   * `tribes` の複数指定時の論理（"or"（デフォルト）= いずれか1つ / "and" = すべて）。
   * CardFilter.tribesLogic / ConditionClause.combined_host_tribes.tribesLogic と同じ規約。
   * 「導魔＆導界者ネクサス」型（ホストが複合系統「導界者・導魔」を両方持つ必要がある、
   * BSTH003-C31/M02 の alternatives）を表すために使う。
   */
  tribesLogic?: "and" | "or";
  /**
   * 合体不可となる系統の部分一致文字列（否定版。`tribes` の完全一致とは別軸）。
   * 「合体条件：GE＆系統名に「O」を含まない」＝ tribes:["GE"] かつこの配列のいずれかの
   * 部分文字列を系統トークンに含む場合は不成立。CardFilter.excludeTribeSubstring と同一意味論
   * （`tribeContainsExcludedSubstring` を共有 SSOT として使う。P3-111 S1/S2）。
   */
  excludeTribeSubstring?: string[];
  /** 合体可能な最小コスト */
  minCost?: number;
  /** 合体可能な最小カウント（例: 「C2以上」） */
  minCount?: number;
  /**
   * 合体可能なカード名（指名合体・全文完全一致）。
   * 「合体条件：カード名：「X」」形式。合体先のカード名が X と完全一致する場合のみ成立。
   */
  cardNames?: string[];
  /**
   * 合体可能なカード名（部分一致）。
   * 「合体条件：「X」」形式。合体先のカード名に X を部分文字列として含めば成立。
   * 変種カード（例: 「[覚醒]フランドール・スカーレット」）も対象に含む。
   */
  cardNameContains?: string[];
  /**
   * ホストが、指定文字列をカード名に含むブレイヴと既に合体していることを要求する。
   * 「合体条件：CF＆『界塚伊奈帆』合体中」型の host 側状態条件。
   */
  attachedBraveNameContains?: string[];
  /**
   * 代替合体条件（OR）。基本条件（このオブジェクト自身の各フィールド）を満たさない場合、
   * ここに列挙したいずれか 1 つの `BraveCondition` を満たせば合体可能とする。
   * 「【合体条件：A】…【合体条件：B】」のように同一ブレイヴに複数の合体条件ブロックがあり、
   * それぞれ異なるホスト種別/系統/コストを要求する場合に使う
   * （例: BSTH003-C31「導魔＆コスト5以上」or「導魔＆導界者ネクサス」、ENGINE-brave-combine-nexus-host
   * の host-half に続く alternatives 拡張）。ネスト（alternatives 内の alternatives）は評価しない。
   */
  alternatives?: BraveCondition[];
}

/**
 * 契約合体データ（フラッシュ【契約合体：<条件>】）。P3-111 S2 自己完結型（亜種1）。
 * 発動元は手札（召喚コストは支払わない）、起動コストは自分のソウルコアをトラッシュに置くこと。
 * `resolve_brave_combine_choice` / `brave_combine`（フィールド上のブレイヴの直接合体）とは
 * 別経路。合体条件は `braveCondition` を対象ホストへ照合する（既存 SSOT 再利用）。
 */
export interface ContractCombineData {
  /** 対象ホスト（自分のスピリット）が満たすべき合体条件。 */
  braveCondition: BraveCondition;
  /** 起動可能なタイミングスコープ（例:『自分のターン』『お互いのアタックステップ』）。 */
  timingScope: TimingScope;
}

/**
 * 契約合体プロキシ起動データ（P3-111 S4、亜種2）。ネクサス等のこのカードが Lv 到達時、
 * 〔ターンに1回：同名〕、指定したカード名（省略時は無制限）への契約合体を、自分のソウルコアを
 * 「トラッシュに置いたものとして」代理発動できる（起動コスト免除）。契約合体自体のキーワード
 * 判定（`ContractCombineData.braveCondition`/`timingScope`）はブレイヴ側定義をそのまま使う
 * （このカードは対象名の追加制限とコスト免除のみを提供する別経路。SSOT 再利用）。
 */
export interface ContractCombineProxyData {
  /** このプロキシ能力が有効になる最小 Lv。 */
  requiredLevel: number;
  /**
   * 対象カードの名前制限（OR）。省略時は制限なし。記法と一致条件は card-filter の
   * matchesCardName SSOT に従う（「X」=部分一致 / カード名：「X」=完全一致）。
   */
  targetCardNames?: import("./dsl-types").CardNameMatch[];
}

/**
 * リンクエイドデータ（【リンクエイド】、P3-111 S6）。魂状態のカードが、フィールド上の自分の
 * スピリット（`costSourceTribes` の系統を持つ）から固定1コスト（通常コア1個。軽減シンボル
 * 参照でも疲労でもない）を支払うことで、リザーブのコアを好きなだけ置いてスピリット状態になる
 * （召喚扱いではない state-change。2026-06-17 ユーザー裁定、10_rules/07b §リンクエイド）。
 *
 * `grant_link_aid_cost_override` CE (BSGE01-C03「ディソレイト」フラッシュ) が自分に
 * 登録されている間は、このカード固有の `costSourceTribes` 制限を無視し、起動コスト源が
 * 「フィールド/リザーブから1コスト」に、charge 先が「フィールド/リザーブ」に拡張される
 * (mechanics/link-aid-system.ts isLinkAidCostOverrideActive が消費)。
 */
export interface LinkAidData {
  /** コスト源として1コア支払える自分のフィールドスピリットの系統条件（完全一致 OR）。 */
  costSourceTribes: string[];
  /** 起動可能なタイミングスコープ（例:『お互いのアタックステップ』）。 */
  timingScope: TimingScope;
}

/**
 * 転召【転召：N／〔系統＆コスト条件〕／送り先】の宣言。
 * 召喚手順内の強制コア消費ステップ（[[CardDefinition.tenshoSummon]]）。
 */
export interface TenshoSummon {
  /**
   * 強制コア消費の対象1体が満たすべきフィルタ（自分のスピリット・系統・コスト等）。
   * `matchesCardFilter` で評価する（SSOT）。minCores は本体ではなく `minCores` で別管理する
   * （送り先によって「動かせるコア数」の数え方が変わるため。ボイド送りは通常コアのみ）。
   */
  targetFilter: import("./dsl-types").CardFilter;
  /** 対象に必要な最低コア数 N（「最低N個」）。送り先へ動かせるコアがこれ以上ある個体のみ対象。 */
  minCores: number;
  /** コアの送り先ゾーン（【転召：N／…／<ここ>】）。既定はボイド。 */
  destination: "void" | "trash" | "reserve";
}

/**
 * 煌臨の宣言可能タイミング窓。通常経路 (AdventData.adventTiming) と
 * 代替コスト経路 (AdventData.alternateCostAdvent.timing) の双方で共有する。
 * "opponent_attack_step" は「相手のアタックステップ」限定
 * （own_attack_step の対称形、BSSL01-X01[3] 代替コスト煌臨で初出）。
 */
export type AdventTimingWindow =
  | "both_attack_step"
  | "own_attack_step"
  | "opponent_attack_step"
  | "own_turn"
  | "main_and_flash";

/**
 * 煌臨条件。色・コスト・系統・対象カテゴリを指定。
 * 合体ブレイヴのステータスも条件判定に含まれる。
 */
export interface AdventCondition {
  /** 煌臨先の色条件（合体ブレイヴ含む） */
  colors?: CardColor[];
  /** 煌臨先の最小コスト条件 */
  minCost?: number;
  /**
   * 煌臨先の煌臨状態条件。
   * "advented" 指定時、表向き煌臨元≧1（underCards role='advent_source'）の
   * 煌臨中カードだけを対象にする。
   */
  adventState?: "advented";
  /** 煌臨先の系統条件 */
  tribes?: string[];
  /** 系統の評価ロジック。"and" = 全て必須、"or"（デフォルト）= いずれか1つ */
  tribesLogic?: "and" | "or";
  /**
   * 煌臨先のカード名条件（「『孫悟空』」「コスト4以上の『暁 切歌』『月読 調』」等）。
   * いずれかの CardNameMatch に一致する名前の煌臨先のみ対象。記法と一致条件は
   * card-filter の matchesCardName SSOT に従う（「X」=部分一致 / カード名：「X」=完全一致）。
   */
  cardNames?: import("./dsl-types").CardNameMatch[];
  /**
   * 煌臨先の「契約カード」条件（「契約スピリット」等）。true のとき isContractDefinition
   * (card-filter.ts の契約カード判定 SSOT) で true な host のみ対象にする。
   */
  isContract?: boolean;
  /** 煌臨可能な対象カテゴリ。"nexus" は F契約煌臨限定 (Ver.17.0) */
  targetCategory: ("spirit" | "ultimate" | "nexus")[];
}

/**
 * 煌臨データ。CardDefinition に付与する。
 * 手札からソウルコアを消費してフィールドのスピリット/アルティメットの上に重ねる。
 */
export interface AdventData {
  /** 「煌臨するとき」重ねる前に、指定ゾーンのカードを任意枚数、煌臨元の下へ追加する。 */
  beforeAdventSourceAddition?: {
    fromZones: Array<"hand" | "trash">;
    filter: import("./dsl-types").CardFilter;
    textRef: number[];
  };
  /** 煌臨条件 */
  adventCondition: AdventCondition;
  /** 煌臨タイミング */
  adventTiming: AdventTimingWindow;
  /**
   * ソウルコア消費先: スピリット→トラッシュ、アルティメット→除外（標準ルール）。
   * "this_card" はカード固有効果でこの標準ルールを上書きし、消費したソウルコアを
   * 標準の行き先ではなくこの煌臨カード自身に置く場合 (BSSL01-X02
   * 「自分のソウルコアをこのスピリットに置く」等)。
   */
  soulCoreDest: "trash" | "removed_from_game" | "this_card";
  /**
   * 煌臨の派生形 (10_rules/08a §3 契約)。カードが印字する煌臨種別を表す。
   * - undefined / "normal": 通常の煌臨 (スピリット/アルティメットのみ、魂状態不可)。
   * - "contract": 【契約煌臨】(08a:147-149)。ソウルコアをトラッシュに置いて手札から重ね、
   *   魂状態の契約カードにも煌臨可能。
   * - "f_contract": 【F契約煌臨】(08a:156-158)。魂状態を含むスピリットおよびネクサスに煌臨可能。
   *
   * 1 カードは 1 種別のみ印字する (【煌臨】/【契約煌臨】/【F契約煌臨】は排他)。
   * legal-action 列挙時にこの値で対象列挙器 (getAdventTargets /
   * getContractAdventTargets / getFContractAdventTargets) を選ぶ。
   */
  adventVariant?: "normal" | "contract" | "f_contract";
  /**
   * 煌臨元（このカード）を取り出すゾーン (10_rules/08a §1 手順1)。
   * - undefined / "hand": 通常の手札からの煌臨。
   * - "trash": トラッシュにあるこのカードを煌臨元にする
   *   (BSAZ01-C01/C02「トラッシュにあるこのカードは…自分の「スレイプニール」を【煌臨】できる」)。
   *
   * ソウルコア消費・煌臨元への重ね・状態引き継ぎ等の処理手順は通常の煌臨と同様で、
   * 差分は legal-action 列挙が走査するゾーン (hand→trash) と executeAdvent の
   * 取り出しゾーン gate のみ。対象の同名ゲートは adventCondition.cardNames で表現する。
   */
  adventSourceZone?: "hand" | "trash";
  /**
   * 煌臨後にフィールド/リザーブのコアを好きなだけ煌臨スピリットへ置けるか
   * (BSAZ01「このとき、煌臨するカードにフィールド/リザーブのコアを好きなだけ置く」)。
   * true のとき declare_advent 解決後に buildChargeCoresPendingCoreDistribution と同じ
   * 任意コア配置 pending を生成する (契約煌臨で魂状態へ煌臨した場合の SSOT を流用)。
   */
  chargeCoresOnAdvent?: boolean;
  /**
   * 煌臨先候補に、他カードの下にある煌臨元 (underCards role='advent_source') を含めるか。
   * 通常の煌臨/契約煌臨は「煌臨元を含む」明示が無い限り underCards を対象外にする。
   * true は BSSL01-X02「魂状態/煌臨元を含む対象に重ねる」型の opt-in。
   */
  includeAdventSourceTarget?: boolean;
  /**
   * 煌臨宣言そのものの使用制限。BSSL01-X02「〔ターンに1回:同名〕このカードを
   * 手札から魂状態/煌臨元を含む対象に重ねる」型の通常 declare_advent を、
   * printed name 単位でターン中 1 回に gate する。
   */
  declareUsageLimit?: { kind: "per_card_name"; duration: "turn" };
  /**
   * 煌臨の宣言可否ゲート（「カウントN以上」等、プレイヤーのカウント資源しきい値、
   * BSDB01-M01/R01/R02/TX01(A)/X01/X02 の【契約煌臨：「X」＆カウントN以上】等）。
   * AdventCondition (target 側 = 煌臨先の host が満たすべき条件) とは別に、
   * 宣言する側 (このカード自身/actingPlayer) が満たすべき条件を表す。
   * legal-actions-availability.ts の declare_advent 列挙で evaluateCondition() により判定し、
   * false なら宣言不可 (legal action を emit しない)。
   */
  declareCondition?: ConditionClause[];
  /**
   * 代替コスト煌臨（BSSL01-X01[3]〔ターンに1回:同名〕「相手のアタックステップ中、
   * 自分のトラッシュが5枚以上のとき、《ソウルコア》をトラッシュに置いたものとして
   * 【契約煌臨】できる」型）。通常経路 (adventTiming/declareCondition/ソウルコア消費)
   * とは独立したタイミング/条件を満たせば、ソウルコアを実際には消費せず
   * （「置いたものとして」＝擬制）宣言できる。対象条件 (adventCondition) と
   * ソウルコア行き先 (soulCoreDest、擬制のため実際には未使用) は通常経路と共有する。
   * 〔ターンに1回:同名〕は GameState.usedAlternateCostAdventKeysThisTurn で追跡する
   * （usedTrashAdventKeysThisTurn と同型）。
   */
  alternateCostAdvent?: {
    /** 宣言可否条件（declareCondition と同型、evaluateCondition() で判定） */
    condition: ConditionClause[];
    /** タイミング窓（adventTiming と独立） */
    timing: AdventTimingWindow;
  };
}

/**
 * 多重煌臨（1宣言で2 host に同時に重ねる）データ (BSSG01-X03「暁 切歌＆月読 調
 * 『アマルガム』」、10_rules/08a_advent-rebirth-contract.md §多重煌臨、裁定確定
 * 2026-08-01、ユーザー確認)。
 *
 * 通常の `AdventData` は 1 枚が 1 host のスタック上に重なる 1 対 1 モデルだが、本データは
 * 「煌臨する側」自身に付与し、2つの host スロット条件 (`hostSlotConditions`) を同時に
 * 満たす自分のスピリット/アルティメット2体を対象2体へ同時に重ねることを表す
 * (host 側 `hostDualAdventGrant`（BSDB01-CX01【真バディ】、host が2枚の occupant を
 * host→A/host→B の分岐で保持する逆方向パターン）とは別軸: 本データは occupant 側1枚が
 * 2つの host を統合し、対象2体を1つの煌臨元スタックへマージする)。
 *
 * プレイヤーは対象2体のうちどちらを「上」（＝直接の煌臨先、状態引き継ぎ側）にするか選択
 * する（declare_dual_host_advent の targetInstanceIds 順序で表現: [0]=上, [1]=下）。
 * 「上」は通常の煌臨 (`executeAdvent`) と同じ状態引き継ぎを受け、「下」は単純にその下へ
 * 畳まれる（状態は引き継がれない）。維持コアは両方を合算して統合後インスタンスへ引き継ぐ。
 */
export interface DualHostAdventData {
  /**
   * 2つの host スロット条件（各要素が1体の host に要求される条件、順不同）。
   * 対象2体はこの2条件それぞれに1体ずつ一致する必要がある（同じ条件に2体一致では不可）。
   */
  hostSlotConditions: readonly [AdventCondition, AdventCondition];
  /** 煌臨タイミング（両スロット共通）。 */
  adventTiming: AdventTimingWindow;
  /** ソウルコア消費先（両スロットで共通、1回のみ消費）。 */
  soulCoreDest: "trash" | "removed_from_game" | "this_card";
}

/**
 * host 側 (被煌臨側) が「魂状態/煌臨元を含むこのカードには、対象を右左に1体ずつ
 * 【契約煌臨】できる」型の許可を自身に付与するデータ (BSDB01-CX01【真バディ】)。
 *
 * 通常の AdventData は「煌臨する側」に付与し、host 側は adventCondition で条件指定
 * されるだけの受動的存在だが、本データは host 側 CardDefinition に付与し、host が
 * (a) 通常フィールドの現在面 / (b) 魂状態 / (c) 他カードの煌臨元 (underCards
 * role='advent_source') のいずれであっても、手札カード (各 slot の名前条件を満たす)
 * を自身へ重ねられることを表す。
 *
 * **裁定確定 (2026-07-13、issues/P3-117): 1宣言=1体、host は2枚の occupant を
 * 並行/分岐で保持する** (host→A、host→B の枝分かれ。host→A→B の直列チェーンではない)。
 * 孫悟空名カード・ベジータ名カードはそれぞれ**別々の宣言**で host へ契約煌臨する
 * (通常の契約煌臨と同じ発揮/宣言モデル、1宣言1対象は変更しない)。片方の occupant が
 * 単独でフィールドを離れても host は魂状態に戻らず、もう一方の occupant の煌臨元として
 * そのまま残る (host が手放されるのは両方の occupant が離れたときのみ、
 * state-based-actions.ts の「煌臨元カード一括移動」が他の現存カードからまだ参照され
 * ているかを確認してから道連れにする)。
 *
 * 各スロットの充足状況は専用フィールドを持たず、`underCards`(既存の煌臨元表現) を
 * 走査して都度導出する (mechanics/host-dual-advent.ts
 * getHostDualAdventOpenSlotIndices、SSOT)。host を2度 (スロットごとに1回)
 * advent-system.ts の executeAdvent へ target として渡すだけで良く、
 * executeAdvent 自体への変更は不要 (host は zone:'field' のまま複数の occupant から
 * 独立に参照されることを type/データ構造レベルで妨げない)。
 *
 * ソウルコアはプレイヤーにつき単一資源 (player.soulCoreLocation) のため、各スロットの
 * advent はそれぞれ独立に通常消費/代替コストを選べる。`alternateCost` は、ソウルコアを
 * 消費せず (擬制) 同じ単体契約煌臨を行える 〔ターンに1回:同名〕 経路
 * (usedAlternateCostAdventKeysThisTurn は許可元カードの printed name で gate
 * する、通常の adventData.alternateCostAdvent と同じ記録先/キー規約)。
 */
export interface HostDualAdventGrant {
  /**
   * 各スロットの受け入れ名前条件 (advent-ing 側カードの印字名)。順不同で判定する。
   * 元は BSDB01-CX01【真バディ】(2 スロット固定) 専用だったが、BSSG01-M01/M02
   * (host 側煌臨許可付与、1 スロットのみ) 対応のため可変長に一般化した
   * (2026-07-25、[[project_full_run_harness]] 系 host-advent-grant-single-slot cluster)。
   */
  slots: readonly {
    cardNames: readonly import("./dsl-types").CardNameMatch[];
  }[];
  /** 魂状態/煌臨元でも許可が有効か。本文に明示された場合だけ true。 */
  includeSoulStateOrAdventSource?: boolean;
  /** 宣言可能タイミング窓 (adventTiming と同型)。 */
  timing: AdventTimingWindow;
  /**
   * 解決後、host 側 (このカードだったフィールド位置) のフィールド/リザーブのコアを
   * 重ねた対象へ好きなだけ配置できるか (chargeCoresOnAdvent と同型の任意コア配置 pending)。
   * 「このカードが (この宣言の前から既に) 魂状態/煌臨元なら」を意味するため、
   * 2スロット目の宣言時 (1スロット目の occupant が既に host を煌臨元にしている) は
   * host が通常フィールド現在面から始まった場合でも発生する。
   */
  hostCoreDistributionOnAdvent?: boolean;
  /**
   * true のとき、通常 (ソウルコア消費) 経路の legal action を一切生成しない
   * (擬制消費 = alternateCost 経路のみが煌臨の唯一の入口)。BSSG01-M01/M02 は原文に
   * 通常経路の記述が無いため true にする (needs-ruling.jsonl cardNo BSSG01-M01/M02
   * 裁定確定2026-07-25、案A)。省略時 false (BSDB01-CX01 は通常/代替コスト両経路併存)。
   */
  normalPathDisabled?: boolean;
  /**
   * 〔ターンに1回:同名〕ソウルコアを消費せず (擬制) 単体契約煌臨を行える代替コスト経路。
   * usedAlternateCostAdventKeysThisTurn で許可元カードの printed name 単位 gate
   * する (adventData.alternateCostAdvent と同じ記録先/キー規約を共有する)。
   */
  alternateCost?: {
    timing: AdventTimingWindow;
    /**
     * true のとき〔ターンに1回:同名〕gate を課さない (1ターンに同名カードで複数回
     * 発動できる)。BSSG01-M01/M02 は原文に「ターンに1回」の明記が無いため true にする
     * (裁定確定2026-07-25、案A: 原文通りターン制限なしで実装)。省略時 false
     * (BSDB01-CX01 は明記通りターン1回:同名 gate を課す)。
     */
    turnLimitDisabled?: boolean;
  };
  /**
   * 「重なったカードを含むこれらには対象以外を合体/煌臨/入れ替えできない」(BSDB01-CX01)。
   * true のとき、host (このカードが煌臨元として重なっている状態を含む) とその上に
   * 重なっているカード全体を、`slots` の cardNames に一致しない第三者カードからの
   * 煌臨/合体/入れ替え対象として除外する (advent-system.ts の
   * isExcludedByHostExclusiveLock を SSOT として、煌臨は advent-system.ts の対象列挙器
   * 3 種、合体は legal-actions-availability.ts の brave-combine / contract-combine
   * (自己完結型+プロキシ起動型) 列挙、入れ替えは同ファイルの brave-swap 列挙と
   * accel-change-system.ts の getChangeSwapCandidates で適用)。
   */
  exclusiveToSlots?: boolean;
}

/**
 * 顕現データ。CardDefinition に付与する。
 * 公式エターナル版キーワード効果「顕現」(battlespirits.com ルールマニュアル §特殊な効果):
 * 手札にあるそのカードを指定タイミングで、自分のライフ/フィールド/リザーブのソウルコアを
 * トラッシュに置いて、対象で指定された創界神グランウォーカーネクサスのコアで召喚コストを
 * 1コスト支払う（＝支払いはこの1個のみ、通常の軽減/リザーブ支払いは発生しない）ことで
 * 手札から召喚する。「召喚時」効果に加えて「顕現時」効果を発揮する（顕現時専用トリガーは
 * 現状カード側に需要が無いため未実装。summon 判定は enterFieldEventKind の advent_source
 * 無し場合分けで自動的に "summon" になるため card_event:["summon",...] は追加配線なしで発火する）。
 * BSTH02.7-X03「蓬莱人形」が本メカニズム唯一の採用カード（導界者ネクサス = 独自パックの
 * 創界神グランウォーカーネクサス相当パロディ）。
 */
export interface ManifestData {
  /** 顕現するプレイヤー等の条件。対象ネクサスのフィルタとは別に共通条件評価で判定する。 */
  condition?: ConditionClause[];
  /**
   * 顕現対象（創界神グランウォーカーネクサス相当）のフィルタ。matchesCardFilter で評価する
   * (SSOT、AdventCondition のような専用評価器は導入しない。CardFilter.minCores/cardName/
   * category/targetsGrandwalker/hasMechanic で条件を汎用的に表現できるため)。
   */
  targetFilter: import("./dsl-types").CardFilter;
  /**
   * 顕現宣言可能なタイミング。現状 "own_main_step"（自分のメインステップ限定）のみ。
   * AdventData.adventTiming と異なる列挙にしているのは、advent の "own_turn"/"main_and_flash"
   * が自ターン中のフラッシュ窓も許すのに対し、顕現はカード文言上メインステップの窓に
   * 限定されるカードしか現状存在しないため（将来「自分のターン」等の顕現カードが出たら拡張する）。
   */
  manifestTiming: "own_main_step";
  /** ソウルコア消費先（顕現の代替コスト）。標準は "trash"。 */
  soulCoreDest: "trash" | "removed_from_game" | "this_card";
}

/**
 * アクセルデータ。CardDefinition に付与する。
 * 手札からマジックのようにコストを支払って効果を使用し、使用後はオープンして手元に置く。
 * 条件不成立時はトラッシュへ。手元からアクセルは再使用不可（手札からのみ）。
 */
export interface AccelData {
  /** アクセルのタイミング: 「フラッシュ【アクセル】」or「メイン【アクセル】」 */
  timing: "flash" | "main";
  /** アクセル専用コスト（召喚コストとは別） */
  cost: number;
  /** アクセル専用軽減シンボル */
  reduction: SymbolColor[];
  /** アクセル効果 */
  effects?: import("./dsl-types").Effect[];
}

/**
 * チェンジデータ。CardDefinition に付与する。
 * フラッシュタイミングで手札からコストを支払い効果を使用し、
 * フィールドのスピリットと入れ替え可能。入れ替えは召喚ではない。
 */
export interface ChangeData {
  /** チェンジ専用コスト */
  cost: number;
  /** チェンジ専用軽減シンボル */
  reduction: SymbolColor[];
  /** チェンジ効果 */
  effects?: import("./dsl-types").Effect[];
  /** 入れ替え条件: 条件を満たすフィールドのスピリットと入れ替え可能 */
  swapCondition: ChangeSwapCondition;
  /**
   * 入れ替え時、戻す側スピリットの煌臨元から指定カード名に一致するものを
   * チェンジ後スピリットの煌臨元へ移す。未指定なら従来どおり移管しない。
   */
  transferAdventSourcesOnSwap?: {
    cardNames: import("./dsl-types").CardNameMatch[];
  };
}

/**
 * チェンジの入れ替え条件。
 * 条件を満たすフィールドのスピリットと入れ替え可能。
 */
export type ChangeSwapCondition = import("./dsl-types").TribeMatchFilter & {
  /** 入れ替え可能な最大コスト */
  maxCost?: number;
  /** 入れ替え可能な色 */
  colors?: CardColor[];
  /** "advented" 指定時、表向き煌臨元を持つ煌臨中スピリットだけを対象にする。 */
  adventState?: "advented";
};

/**
 * ミラージュデータ。CardDefinition に付与する。
 * メインステップにターン1回、ミラージュコストを支払ってバーストエリア（ミラージュ枠）に表向きセット。
 * 【セット中】効果を永続発揮。既存ミラージュは入れ替え（旧カードは手札に戻る、手札増加扱いではない）。
 */
export interface MirageData {
  /** ミラージュ専用コスト */
  cost: number;
  /** ミラージュ専用軽減シンボル */
  reduction: SymbolColor[];
  /** 「トラッシュにあるこのカードはセットできる」等、手札以外からの通常ミラージュセット許可。 */
  canSetFromTrash?: boolean;
  /**
   * ENGINE-mirage-set-count-exemption: 「セットしている/手札にあるこのカードは、
   * 自分のセット可能枚数に数えない」型の免除（BSTH002-C01）。
   * - このカードが手札にあり新規セット対象のとき: ターン1回のセット行動数制限
   *   (mirageSetPlayerIdsThisTurn) を免除。
   * - セット済みの各個体は常に0枠。交換後の通常枠が1以下となる追加/個別交換を選べる。
   * 手札の行動数免除だけを同名・プレイヤーごとにターン1回として別管理する。
   */
  exemptSetCountLimits?: boolean;
  /** ミラージュ【セット中】効果 */
  effects?: import("./dsl-types").Effect[];
}

/**
 * ゼロカウンターデータ。CardDefinition に付与する（P2-07 E-1 基盤）。
 *
 * カスタムルール 08b §6:
 * - 相手の「コストを支払わずに」召喚（バースト効果以外）に対して割り込み発動可能。
 * - 1つの踏み倒し召喚トリガーに対して1枚のみ発動可能。
 * - 復帰コスト（recoveryCost）は発動後の復活時に必要。
 *
 * 完全な割り込み実行ルートは demand-driven 実装。型スカフォールドのみ提供。
 */
export interface ZeroCounterData {
  /** ゼロカウンター発動コスト（手札から発動するときのコスト）。 */
  cost: number;
  /** ゼロカウンター専用軽減シンボル。 */
  reduction: SymbolColor[];
  /** 復帰コスト（フィールド復活時に必要なコスト）。0 の場合は復帰不可フラグとして扱う。 */
  recoveryCost?: number;
  /** ゼロカウンター発動時効果。 */
  effects?: import("./dsl-types").Effect[];
}

/**
 * 異魔神ブレイヴデータ。CardDefinition に付与する（P2-07 G-1 基盤）。
 *
 * カスタムルール 08c §7:
 * - 左右2体合体: ブレイヴ1枚が左/右それぞれ別のスピリットと合体できる。
 * - スピリット状態時はアタック/ブロック不可、疲労しない。
 * - Lv1 のコストは 0。
 * - 各スピリットは合体相手として個別にシンボル/効果を加算。
 *
 * 完全な合体管理（左右独立スロット、片方離脱時の継続合体）は demand-driven 実装。
 */
export interface ImaginBraveData {
  /** 左合体条件。指定された条件を満たすスピリットと「左」スロットで合体可能。 */
  leftCondition?: BraveCondition;
  /** 右合体条件。指定された条件を満たすスピリットと「右」スロットで合体可能。 */
  rightCondition?: BraveCondition;
  /** 左右共通の合体条件（両スロットに適用）。leftCondition/rightCondition で個別指定がない場合の既定。 */
  sharedCondition?: BraveCondition;
}

/**
 * クォーツデータ。CardDefinition に付与する（P2-07 H-2 基盤）。
 *
 * カスタムルール 07 §4:
 * - メインステップに指定コストを支払い、対象（host）にセット。
 * - セットコストはコア消費とは別に「カウント消費」も可能（C2 = カウント2 消費）。
 * - host が移動するとクォーツも追従。host を離れたらセット中ではなくなる。
 * - host 側の「このカードにはクォーツをセットできる」記述と照合する hostFilter で host を限定。
 *
 * 完全なホスト追従・セットコスト処理は demand-driven 実装。
 */
/** クォーツ属性値の軸。色（SymbolColor）とは別軸の 7 種（qa-033）。 */
export type QuartzAttribute = "地" | "火" | "水" | "風" | "時" | "空" | "幻";

export interface QuartzData {
  /** クォーツ名（双魚珠 等）。カード名とは別。同名2枚以上セット不可の異名判定に使う（qa-029）。 */
  quartzName: string;
  /** セットコスト（コア消費）。 */
  cost: number;
  /** セットコスト軽減シンボル（クォーツ独自軽減）。 */
  reduction: SymbolColor[];
  /** カウント消費型のセットコスト（C2 など）。指定時は cost と併用可能。 */
  countCost?: number;
  /** セット中のこのカードを、指定ゾーンから来るクォーツで入れ替えられない。 */
  replacementProhibitedFromZones?: Zone[];
  /** 属性値（<時>5 等）。host の【アーツ】解放条件をセット中合計で満たすための数値軸（qa-033）。 */
  attributeValues?: Partial<Record<QuartzAttribute, number>>;
  /** セット先 host を限定するフィルタ。省略時は host 側の文面照合に依存。 */
  hostFilter?: import("./dsl-types").CardFilter;
  /** セット中に host が得る効果（host 側で発揮される）。 */
  effects?: import("./dsl-types").Effect[];
}

/**
 * クォーツ host（ENIGMA[戦術オーブメント] 等）のセット受け入れ定義。
 * スロット上限は host が定義する一般則でない値（qa-029, §4）。
 */
export interface QuartzHostData {
  /** スロット別の最大セット枚数（例 ENIGMA: left=3, right=3, center=1 = 計7）。 */
  slots: { left: number; center: number; right: number };
  /** セット対象を限定するフィルタ（【セット条件：【クォーツ】を持つカード】等）。 */
  setCondition?: import("./dsl-types").CardFilter;
  /**
   * true なら「このカードにセット中のカードの【クォーツ】すべてを得て、発揮する」を持つ
   * (ENIGMA[戦術オーブメント] 等、host 固有の印字能力。全 host 共通則ではない、qa-030)。
   * 【セット中】表記の無いクォーツ効果は、この能力を持つ host 経由でのみ発揮する。
   */
  inheritsSetQuartzEffects?: boolean;
}

/**
 * クォーツのセット状態。GameState に保持する。
 * - host が離脱したら自動的に hostInstanceId と同じ場所へ移動し、セット解除する。
 */
export interface QuartzSetState {
  /** クォーツ自身の cardInstanceId */
  quartzInstanceId: string;
  /** セット先 host の cardInstanceId */
  hostInstanceId: string;
  /** クォーツの所有者（host とは別管理） */
  ownerPlayerId: string;
  /** セット位置（左右3＋中央1 のスロット区分。位置入れ替え可）。 */
  slot: "left" | "center" | "right";
}

/**
 * 神託/導託の対象条件。1つ以上の OracleCondition を OR で結合する。
 * カードが条件のいずれかを満たせば「対象」として神託トリガーの判定に使われる。
 *
 * 例: 【神託：〔夜錆〕〔夜錆＆ネクサス〕】
 *   → [{ tribes: ["夜錆"] }, { tribes: ["夜錆"], categories: ["nexus"] }]
 */
/**
 * 独自/拡張メカニクス名。
 * 正源: この型。CardFilter.hasMechanic / OracleCondition.hasMechanic で共有する。
 */
export type MechanicName =
  | "mirage"
  | "accel"
  | "change"
  | "burst"
  | "zero_counter"
  | "rebirth"
  | "grandwalker"
  | "guided"
  | "imagin"
  | "quartz"
  | "stack_effect";

export type OracleCondition = import("./dsl-types").TribeMatchFilter &
  Pick<import("./dsl-types").CardFilter, "colors" | "colorCount"> & {
    /** 対象カテゴリ制限（省略時は制限なし） */
    categories?: CardCategory[];
    /** 対象の最小コスト（省略時は制限なし） */
    minCost?: number;
    /**
     * 対象が持つメカニクス制限（OR）。
     * 例: ["rebirth"] で「転醒能力を持つカード（ダブルフェイス）」のみマッチ。
     */
    hasMechanic?: MechanicName[];
  };

/** 神託/導託の本文が指定する通常トリガーイベント。 */
export type OracleTriggerKind =
  | "summon"
  | "advent"
  | "place"
  | "use_magic"
  | "use_accel";

/**
 * 創界神/導界者ネクサスデータ。CardDefinition に付与する。
 *
 * 共通ルール:
 * - 配置時にコアを置けない（enter_field_core_placement_forbidden）
 * - 神託/導託と創界神/導界者対象の効果でのみコアを置ける
 * - ソウルコア配置不可
 * - フィールド離脱時、上のコアはボイドへ（通常ネクサスはリザーブ）
 * - 創界神/導界者対象の効果のみ受ける
 */
export interface GrandwalkerData {
  /**
   * 種別。
   * - "grandwalker": 創界神ネクサス
   * - "guided": 導界者ネクサス（導託/導技/導域 = 神託/神技/神域としても扱う）
   */
  kind: "grandwalker" | "guided";
  /**
   * 両タイプ持ち（例: BSTH05.5-XX01 龍神 = 創界神・導界者）の副タイプ。
   * grandwalkerKind 条件 (field_has / field_lacks / hasMechanic) は kind と
   * alsoCountsAs の両方にマッチする。判定は grandwalkerKindMatches() を使うこと。
   */
  alsoCountsAs?: "grandwalker" | "guided";
  /** 神託/導託の対象条件（OR 結合）。各条件に一致するカードの召喚等で神託トリガー。 */
  oracleConditions: OracleCondition[];
  /**
   * 召喚/煌臨などで誘発する通常の神託/導託コア+1の発揮可否。
   * 省略時は旧標準どおり optional。BSTH02.7-CX01 の本文「このネクサスにコア+1する」
   * のような終止形は mandatory で表現する。
   */
  oracleExecutionMode?: EffectExecutionMode;
  /**
   * 通常の神託/導託が反応するイベントを本文どおりに限定する。
   * 空でない本文列挙が必須。未指定/空のランタイム入力は神託を発火しない。
   */
  oracleTriggerKinds: readonly [OracleTriggerKind, ...OracleTriggerKind[]];
  /** 召喚/煌臨での神託/導託に追加の使用制限がある場合。 */
  oracleTriggerLimit?: "step_once";
  /** 導域/神域など、標準 oracle/divineSkill 以外の専用 engine hook。 */
  domainHooks?: ("blue_magic_void_payment" | "blue_magic_stack_domain")[];
  /**
   * 配置時神託: デッキ上3枚をオープンし、対象カード1枚につきコア+1。
   * 省略時は標準動作（同名在場ゲート、3枚オープン→マッチ分コア追加→残り全てトラッシュ）。
   * false に設定すると配置時神託を無効化。
   * sameNameGate:false は BSES01/BSTH02.7 の契約ネクサス型
   * 「〔ターンに1回:同名〕このネクサスを配置したとき」に使う。
   */
  placementOracle?:
    | false
    | {
        revealCount?: number;
        remainderDest?: "trash" | "bottom";
        sameNameGate?: boolean;
        turnLimit?: "per_card_name";
      };
  /**
   * 配置時神託でトラッシュに置かれたカードのうち、指定カード名に一致するものを
   * ただちに手札に加える (engine-placement-oracle-return-by-name、BSAZ02-X04/X05
   * 「このネクスの【導託】でトラッシュに置かれた『アルドノアドライブ』すべてを手札に加える」型)。
   * マッチ判定は placementOracle のコア加算対象 (oracleConditions) とは独立 — カード名一致のみ
   * (matchesCardName 経由、CardNameMatch で「X」= 部分一致規約に従う)。
   */
  placementOracleReturnToHand?: {
    cardName: import("./dsl-types").CardNameMatch;
  };
  /**
   * 神技/導技/界放/契約技 — コア消費起動効果。
   * 1枚の創界神に複数定義可能（例: 神技:2 と 神技:4）。
   */
  divineSkills?: DivineSkillEntry[];
}

/**
 * 神技/導技/界放/契約技のタイミング。
 *
 * `"flash_or_stack"` は印字「フラッシュ/スタック」（例: BSTH11-X01【神技：2～6】）用。
 * 同一印字パターンを持つ通常の起動効果 (BSTH11-C05「バックドア」等) は
 * `mode:"flash"` と `mode:"stack"` の2エントリを分けて登録するが、DivineSkillEntry は
 * 1枚のカードに複数 divineSkills を持てても timing は単一値のため、両窓での起動可否を
 * 1つの variant として表現する (ENGINE-divine-skill-stack-timing-variant)。
 */
export type DivineSkillTiming =
  | "flash"
  | "main"
  | "flash_or_stack"
  | {
      step: string;
      whose: "own" | "both" | "opponent";
      subPhase?: "end";
      /** ステップ指定に加えてフラッシュ窓と優先権を要求する。 */
      mode?: "flash";
    };

/**
 * 神技/導技/界放/契約技のコア消費数。固定値、または宣言時に min~max の任意値を
 * プレイヤーが選ぶ範囲（ENGINE-divine-skill-variable-core-cost-range、BSTH11-X01
 * 「【神技：2～6】」= 2,3,4,5,6 のいずれも選択可能、裁定2026-08-03 needs-ruling.jsonl
 * 案B採用）。範囲指定時、`getAvailableDivineSkillLegalActions` が現在のコア数で
 * 支払い可能な各整数値ごとに個別の legal action を生成する。実際に選択された額は
 * `UseDivineSkillLegalAction.coreCost`（具体値）にそのまま入るため、宣言後の
 * 支払い・deferred 解決側 (`resolveDeferredDivineSkillStack`) は range を意識しない。
 */
export type DivineSkillCoreCost = number | { min: number; max: number };

/**
 * 神技/導技/界放/契約技 — 創界神/導界者のコア消費起動効果エントリ。
 *
 * 例: 【神技：2】Lv1-Lv2『自分のメインステップ』
 *   → { label: "divine_skill", coreCost: 2, timing: "main", minLevel: 1, maxLevel: 2 }
 */
export interface DivineSkillEntry {
  /** Generic declaration limit, including per-step and per-game limits. */
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  /** 種別ラベル（表示・ルール判定用） */
  label: "divine_skill" | "guided_skill" | "divine_release" | "contract_skill";
  /** コア消費数（このネクサスのコアN個をボイドに置く）。範囲指定は DivineSkillCoreCost 参照 */
  coreCost: DivineSkillCoreCost;
  /** 起動タイミング */
  timing: DivineSkillTiming;
  /** 最低Lv条件（省略時は Lv1） */
  minLevel?: number;
  /** 最高Lv条件（省略時は制限なし） */
  maxLevel?: number;
  /** ターン制限 */
  turnLimit?: "once" | "once_per_name";
  /**
   * ターン内使用回数の上限（省略時 1）。「ターンに2回」等を表現する。
   * turnLimit のキー単位（per_instance / once_per_name）で回数を数える。
   * turnLimit 未指定時は無制限のため本フィールドは無視される。
   */
  maxUsesPerTurn?: number;
  /** 発揮する効果（DSL 形式）。各 Effect を executeEffect で順次実行する。 */
  effects?: import("./dsl-types").Effect[];
}

/**
 * 転神/転者状態。このターン中、ネクサスをスピリットとしても扱う。
 * CardInstance に付与する一時的な二重状態。
 */
export interface DivineTransformState {
  /** スピリットとしての BP 定義 */
  bpByLevel: { level: number; bp: number }[];
  /** スピリットとしての色（省略時はカード本来の色） */
  colors?: CardColor[];
  /** スピリットとしてのシンボル（省略時はカード本来のシンボル） */
  symbols?: SymbolColor[];
  /** 創界神/導界者ネクサス以外では破壊されない */
  protectedFromNonGrandwalker: boolean;
}

/** 解封トリガーのイベント種別 */
export type UnsealEventKind = "summon" | "attack" | "rebirth" | "hand_increase";

/**
 * 解封条件。創界石ネクサスの【解封：〔...〕】を表す。
 *
 * 2 系統の形がある（events で判別）:
 * - カードイベント系 (summon / attack / rebirth): 自分のカードの召喚/アタック/転醒。
 *   cardFilter でトリガーカードを絞る。転醒は B 面（裏返った後）の定義で判定する。
 * - 手札増加系 (hand_increase): 「〜を持つ自分の効果による自分の手札の増加」。
 *   causeFilter で増加の原因効果の発揮元カード（系統/色）を絞る。
 *   原因カードが特定できない経路（効果由来でない増加等）ではマッチしない (fail-closed)。
 */
export interface UnsealCondition {
  /** トリガーイベント（OR: いずれかのイベントで成立） */
  events: UnsealEventKind[];
  /** カードイベント系: トリガーカードの条件（フィールドは AND、各フィールド内は OR） */
  cardFilter?: import("./dsl-types").TribeMatchFilter & {
    /** カード名の部分一致（「X」記法）。いずれか1つを含めばマッチ */
    nameContains?: string[];
    /** カテゴリ制限（省略時は制限なし） */
    categories?: CardCategory[];
  };
  /** 手札増加系: 原因効果の発揮元カードの条件（フィールドは AND、各フィールド内は OR） */
  causeFilter?: import("./dsl-types").TribeMatchFilter & {
    colors?: CardColor[];
  };
}

/**
 * 創界石ネクサスデータ。CardDefinition に付与する。
 *
 * 共通ルール（創界神と同型だが別カテゴリ。創界神対象の効果も受けない）:
 * - 配置時にコアを置けない（enter_field_core_placement_forbidden）
 * - 解封と創界石対象の効果でのみコアを置ける
 * - 上のコアは創界石対象の効果しか受けず移動できない
 * - フィールド離脱時、上のコアはボイドへ
 * - 「創界石ネクサス」を対象にした効果しか受けない
 *
 * 解封: 条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける（任意）。
 * 転醒: このネクサスのコアが rebirthCoreThreshold 個以上になったとき裏返せる。
 */
export interface GrandstoneData {
  /** 解封条件（OR 結合） */
  unsealConditions: UnsealCondition[];
  /** 転醒: コアがこの数以上「になったとき」裏返せる（閾値を下から跨いだ遷移で発火） */
  rebirthCoreThreshold?: number;
  /** 転醒条件: 自分のカウントがこの値以下 */
  rebirthMaxCount?: number;
  /** 転醒時に残すコア数。残りはボイドへ置かれる。省略時 0（全コアボイド） */
  rebirthRetainCores?: number;
  /**
   * 転醒直後の追加処理:
   * - "combine_with_own_spirit": 転醒後ブレイヴを自分のスピリットに合体できる
   * - "charge_cores_from_field_reserve": 自分のフィールド/リザーブのコアを好きなだけ転醒後スピリットに置ける
   */
  postRebirth?: "combine_with_own_spirit" | "charge_cores_from_field_reserve";
  /** この転醒で【解封】はできない（自身の転醒イベントを解封トリガーから除外する） */
  rebirthExcludedFromUnseal?: boolean;
}

/**
 * P3-92: エンジン機構由来の誘発任意効果のペイロード（PendingTriggeredEffect.mechanic）。
 *
 * 神託/導託・解封・創界石転醒はカード効果 registration を持たない誘発任意効果
 * （テキスト/ルール上「できる」）。導域など終止形テキストの mechanic は強制誘発。
 * 発火検出は各機構（oracle-system / grandstone-system）が
 * 行い、解決待ちは pendingTriggeredEffects（正規の誘発キュー）に乗せる。
 * 受諾=発揮宣言はカード効果と同じくスタック窓を開き（02:186「常時以外の効果発揮」/ P3-34）、
 * 窓クローズ後に resolveDeferredTriggeredEffectStack の mechanic 分岐が解決する。
 * 辞退=「任意効果の不使用」は窓を開かず同期で除去する（02:199）。
 * 選択プレイヤー（創界神/創界石のコントローラー）は entry の actingPlayerId に入る。
 */
export type TriggeredMechanic =
  | {
      kind: "oracle";
      /** 対象の創界神/導界者ネクサスの instanceId */
      grandwalkerInstanceId: string;
      /** トリガーとなったカードの instanceId */
      triggerCardInstanceId: string;
      /** トリガーイベント種別 */
      triggerKind: OracleTriggerKind;
    }
  | {
      /**
       * 【導域】「自分の青のマジックカードのスタック効果が発揮されたとき」。
       * マジックの元効果解決が完全に終わった後、強制誘発としてキューされる。
       */
      kind: "magic_stack_domain";
      /** 導域を持つ創界神ネクサスの instanceId */
      grandwalkerInstanceId: string;
      /** スタック効果を発揮した青マジックの instanceId */
      triggerCardInstanceId: string;
    }
  | {
      /**
       * 配置時神託（創界神/導界者ネクサス配置時）。発揮宣言（デッキ上 N 枚トラッシュ）は
       * 「置ける」＝任意なのでスタック窓を開いて発揮する/しないを問う。発揮時の解決で
       * デッキ上 N 枚をトラッシュ（＝効果文・ブラインド）し、マッチ分のコアを創界神に
       * **強制**配置する（「対象カード1枚につきコア+1する」＝終止形・任意ではない）。
       */
      kind: "placement_oracle";
      /** 配置された創界神/導界者ネクサスの instanceId */
      grandwalkerInstanceId: string;
    }
  | {
      kind: "unseal";
      /** 対象の創界石ネクサスの instanceId */
      grandstoneInstanceId: string;
      /** トリガーイベント種別 */
      triggerEvent: UnsealEventKind;
      /** トリガーとなったカードの instanceId（hand_increase では null） */
      triggerCardInstanceId: string | null;
    }
  | {
      /**
       * 創界石の転醒（コア閾値到達）。受諾で裏返し（retainCores 残してボイドへ）
       * + postRebirth 処理を行う。
       */
      kind: "stone_rebirth";
      /** 対象の創界石ネクサスの instanceId */
      grandstoneInstanceId: string;
    }
  | {
      /**
       * P3-99: grant_effect で付与された誘発効果の発火。被付与カード（grantee）が
       * 起こしたイベントが付与効果の trigger に一致したときキューに積まれ、受諾で
       * 付与効果（CE.metadata.grantedEffect）の steps を grantee を source として実行する。
       * カード registration を持たない誘発任意効果なので mechanic として統合する
       * （[[project_mechanic_triggered_unification]] = 専用 pending 禁止）。
       */
      kind: "granted_effect";
      /** 付与 ContinuousEffect の effectId（解決時に grantedEffect を引く） */
      grantCeEffectId: string;
      /** 被付与カード（grantee, このイベントの actor）= 解決時の source/actor */
      granteeInstanceId: string;
    };

/**
 * mechanic 付き PendingTriggeredEffect を構築する（P3-92 統合の正規エントリ形）。
 * relatedInstanceId には機構の対象カード（創界神/創界石）を入れる —
 * resolution-items / GUI 誘発キュー表示のソースフォールバックに使われる。
 */
export function createMechanicPendingTriggeredEffect(options: {
  state: Pick<GameState, "step" | "window">;
  pendingId: string;
  /** 選択するプレイヤー（創界神/創界石のコントローラー） */
  actingPlayerId: string;
  mechanic: TriggeredMechanic;
  /** 機構の対象カード（創界神/創界石）の instanceId */
  relatedInstanceId: string;
  /**
   * 発火元イベントの空でない chainId。granted_effect の leave_field 系反応は
   * これを離脱イベントの chainId に合わせることで、離脱者自身への pending 反応として
   * canFlushPendingLeaveEntity から検出可能になる（ENGINE-grant-effect-pre-flush-window）。
   */
  chainId: string;
  /**
   * 発火元イベントの量（`DynamicCount.event_amount` の解決元、`PendingTriggeredEffect.amount`
   * へそのまま転写）。省略時 null（P3-14 C-5 の通常誘発 pending と同じ既定）。
   */
  amount?: number | null;
}): PendingTriggeredEffect {
  assertTriggerChainId(options.chainId);
  return {
    pendingId: `${options.pendingId}:${options.chainId}`,
    actingPlayerId: options.actingPlayerId,
    eventKind: options.mechanic.kind,
    source: "action_resolution",
    chainId: options.chainId,
    attackId: null,
    relatedPlayerId: options.actingPlayerId,
    relatedInstanceId: options.relatedInstanceId,
    amount: options.amount ?? null,
    step: options.state.step,
    window: options.state.window,
    resolvedSourceInstanceIds: [],
    mechanic: options.mechanic,
  };
}

export interface PendingRebirthCompletion {
  sourceInstanceId: string;
  actingPlayerId: string;
  chainId: string;
  countBonusMode?: RebirthCountBonusMode;
  /**
   * 「このとき」選択が確定するまで実カードを A 面に留める仮想転醒用。
   * pending 解決時にこの action を実行して初めて flip/count/転醒時誘発をコミットする。
   */
  deferredAction?: RebirthAction;
  rebirthTimingWindowId?: string;
}

/**
 * 転醒に内蔵された「このとき」選択待ち。
 * 歴史的な名前は pendingStoneFlipCombine だが、創界石だけでなく
 * 転醒後ブレイヴの合体/コア配置選択もここへ統合する。
 */
export interface PendingStoneFlipCombine {
  pendingId: string;
  actingPlayerId: string;
  /** 転醒後ブレイヴになる instanceId（仮想転醒中は実カードがまだ A 面のことがある） */
  braveInstanceId: string;
  /** GUI 表示・合体条件評価で使う転醒後ブレイヴの定義 ID */
  braveDefinitionId?: string;
  /** 解決時点で合体条件を満たす生存ホスト候補 */
  hostCandidateInstanceIds: string[];
  /** null 選択を「合体しない」として提示する。旧データ互換のため省略時 true。 */
  allowNoCombineChoice?: boolean;
  /** null 選択を「合体しない」ではなく、コア配置ルートとして扱う。 */
  corePlacementChoice?: {
    sourceScope: "field_and_reserve" | "reserve_only";
    minTotal: number;
    maxTotal: number;
  };
  /** 仮想転醒を実コミットするための保留情報。 */
  rebirthCompletion?: PendingRebirthCompletion;
  /** pending 提示直前。合体/コア配置確定後の転醒時誘発 delta の before-state。 */
  priorStateSnapshot?: GameState;
}

/**
 * CardDefinition から創界石ネクサスかどうかを判定する。
 * grandstoneData が存在すれば true。
 */
export function isGrandstoneNexus(
  definition: Pick<CardDefinition, "grandstoneData">
): boolean {
  return definition.grandstoneData != null;
}

/**
 * 創界神/導界者/創界石ネクサスのいずれか（独立コア管理カード）かを判定する。
 * 汎用コア移動のソース除外・離脱時コア→ボイドなど、3 タイプ共通の
 * コア管理ルールの判別に使う（対象制限は targetsGrandwalker / targetsGrandstone で別軸）。
 */
export function hasIndependentCoreManagement(
  definition: Pick<CardDefinition, "grandwalkerData" | "grandstoneData">
): boolean {
  return (
    definition.grandwalkerData != null || definition.grandstoneData != null
  );
}

/**
 * トークン等の独立コア管理データ（グランドウォーカー/創界石とは別系統。
 * `hasIndependentCoreManagement` はグランドウォーカー/創界石専用のため混在させない）。
 * BSKB01-T01 用に新設。
 */
export interface TokenIndependentCoreManagementData {
  /**
   * true: このカードのコアが移動する、またはこのカードがフィールドを離れるとき、
   * 移動先を問わず強制的にボイドへ置く。
   */
  redirectCoresToVoid: boolean;
  /**
   * true: このカードへの通常コア配置は「出すとき」(enter-field 配置経路) 以外禁止。
   * `moveNormalCores` 経由の呼び出し元ではこの choke point (to 側) で強制する
   * (enter-field 配置ヘルパーは `allowEnterFieldOnlyPlacementDestination` を opt-in し、
   * destination 制限だけを免除する)。
   * field コアシュート (`handleFieldCoreShoot`) も通常/ソウルとも共通 primitive
   * (`moveNormalCores` / `moveSoulCore`) と destination 候補 gate を通してこの制約を共有する。
   */
  placementRestrictedToEnterField?: boolean;
}

/**
 * カード/インスタンスがトークン系独立コア管理（コア移動時強制ボイド行き）を持つかを判定する。
 * `hasIndependentCoreManagement`（グランドウォーカー/創界石専用）とは別軸の判定。
 */
export function hasForcedCoreVoidRedirect(
  definition: Pick<CardDefinition, "tokenIndependentCoreManagement">
): boolean {
  return (
    definition.tokenIndependentCoreManagement?.redirectCoresToVoid === true
  );
}

/**
 * カード/インスタンスへの通常コア配置が「出すとき」以外禁止されているかを判定する
 * (BSKB01-T01「コアを、出すとき以外で置けず」)。`hasForcedCoreVoidRedirect` とは
 * 別軸 (from 側の強制先変更 vs to 側の配置禁止) だが同じ独立コア管理カードで両立し得る。
 */
export function hasEnterFieldOnlyCorePlacementRestriction(
  definition: Pick<CardDefinition, "tokenIndependentCoreManagement">
): boolean {
  return (
    definition.tokenIndependentCoreManagement
      ?.placementRestrictedToEnterField === true
  );
}

/**
 * CardDefinition / CardInstance から創界神/導界者ネクサスかどうかを判定する。
 * grandwalkerData が存在すれば true。
 */
export function isGrandwalkerOrGuidedNexus(
  definition: Pick<CardDefinition, "grandwalkerData">
): boolean {
  return definition.grandwalkerData != null;
}

/**
 * GrandwalkerData が指定の種別として扱われるかを判定する（SSOT）。
 * 両タイプ持ち（alsoCountsAs）を含めて kind 一致を見る。
 * grandwalkerKind 条件 (field_has / field_lacks / hasMechanic) は必ずこれを使う。
 */
export function grandwalkerKindMatches(
  data: Pick<GrandwalkerData, "kind" | "alsoCountsAs"> | undefined,
  kind: "grandwalker" | "guided"
): boolean {
  if (!data) return false;
  return data.kind === kind || data.alsoCountsAs === kind;
}

/**
 * CardDefinition が印字バースト系ヘッダ（【バースト】/Sバースト/バースト転召）を持つか。
 * `〖...〗` は古いテスト fixture のヘッダ表記としてのみ互換許容する。
 *
 * 「バースト1つを破棄する」「バースト効果を発揮できない」など本文中の対象語は、
 * そのカード自身のバースト効果ではないため一致させない。
 */
const PRINTED_BURST_EFFECT_HEADER_RE =
  /^\s*[【〖](?:[SＳ]バースト|バースト(?:転召)?)(?:[：:].*)?[】〗]/;

export function cardHasPrintedBurstEffectHeader(
  definition: Pick<CardDefinition, "textLines">
): boolean {
  return (definition.textLines ?? []).some((line) =>
    PRINTED_BURST_EFFECT_HEADER_RE.test(line)
  );
}

/**
 * CardDefinition が指定メカニクスを持つかを判定する。
 * CardFilter.hasMechanic / OracleCondition.hasMechanic の SSOT。
 */
export function cardDefinitionHasMechanic(
  definition: CardDefinition,
  mechanic: MechanicName
): boolean {
  switch (mechanic) {
    case "mirage":
      return (
        !!definition.mirageData || definition.keywordTags.includes("mirage")
      );
    case "accel":
      return !!definition.accelData;
    case "change":
      return !!definition.changeData;
    case "burst":
      return cardHasPrintedBurstEffectHeader(definition);
    case "zero_counter":
      return (
        !!definition.zeroCounterData ||
        definition.keywordTags.includes("zero_counter")
      );
    case "rebirth":
      return !!definition.backFace || definition.isDoubleSided === true;
    case "grandwalker":
      return grandwalkerKindMatches(definition.grandwalkerData, "grandwalker");
    case "guided":
      return grandwalkerKindMatches(definition.grandwalkerData, "guided");
    case "imagin":
      return !!definition.imaginBraveData;
    case "quartz":
      return !!definition.quartzData;
    case "stack_effect":
      return (
        (definition.effects ?? []).some(
          (effect) =>
            effect.timing.kind === "activated" && effect.timing.mode === "stack"
        ) ||
        definition.textLines.some((line) => {
          const trimmed = line.trim();
          return (
            trimmed === "スタック" ||
            trimmed.includes("スタック効果を使用できる")
          );
        })
      );
  }
}

/**
 * CardDefinition から異魔神ブレイヴかどうかを判定する（P2-07 G-1）。
 * imaginBraveData が存在すれば true。
 */
export function isImaginBrave(
  definition: Pick<CardDefinition, "imaginBraveData">
): boolean {
  return definition.imaginBraveData != null;
}

/**
 * 異魔神ブレイヴが左右両スロットで同時合体中か判定する（10_rules/08c §7【左右合体中】）。
 * 左スロット=汎用 `attachedToInstanceId`、右スロット=`imaginRightCombinedWith` の両方が
 * 非 null のときのみ true。片方だけの合体（通常合体と区別できない状態）は false。
 */
export function isImaginBraveDualCombined(
  card: Pick<CardInstance, "attachedToInstanceId" | "imaginRightCombinedWith">
): boolean {
  return (
    card.attachedToInstanceId !== null && card.imaginRightCombinedWith !== null
  );
}

/**
 * CardDefinition からゼロカウンター能力を持つかどうかを判定する（P2-07 E-1）。
 * zeroCounterData が存在すれば true。
 */
export function hasZeroCounter(
  definition: Pick<CardDefinition, "zeroCounterData">
): boolean {
  return definition.zeroCounterData != null;
}

/**
 * CardDefinition がクォーツかどうかを判定する（P2-07 H-2）。
 * quartzData が存在すれば true。
 */
export function isQuartz(
  definition: Pick<CardDefinition, "quartzData">
): boolean {
  return definition.quartzData != null;
}

/**
 * GameState から指定 host にセットされているクォーツ群を取得する（P2-07 H-2）。
 */
export function getQuartzSetStatesByHost(
  state: Pick<GameState, "quartzSetStates">,
  hostInstanceId: string
): readonly QuartzSetState[] {
  return state.quartzSetStates.filter(
    (q) => q.hostInstanceId === hostInstanceId
  );
}

/**
 * GameState から指定クォーツの host instanceId を取得する（P2-07 H-2）。
 * セット中でなければ null。
 */
export function getQuartzHost(
  state: Pick<GameState, "quartzSetStates">,
  quartzInstanceId: string
): string | null {
  const setState = state.quartzSetStates.find(
    (q) => q.quartzInstanceId === quartzInstanceId
  );
  return setState?.hostInstanceId ?? null;
}

// --- 構造化効果モデル ---

/** カードイベント種別（card_event / game_event の event 値） */
export type CardEventType =
  /** カードの使用が完了した後。効果の借用・発揮だけでは発生しない。 */
  | "card_used"
  | "effect_steps_resolved"
  | "effect_completed"
  | "game_start"
  | "summon"
  | "place"
  | "put"
  | "attack"
  | "block"
  | "pre_declaration_attack"
  | "pre_declaration_block"
  | "destroy"
  /**
   * 「消滅したとき」。pendingLeaveKind="vanish" の離脱で発火する。destroy とは別 event
   * 種別で、`Timing.card_event.cause` による離脱原因の絞り込み（「自分による消滅では
   * 発揮されない」= cause から self_effect を除く）と併用する。内部 TriggerEventKind の
   * "vanish" へ素通しされる（CARD_EVENT_TO_TRIGGER）。
   */
  | "vanish"
  /** 手札/デッキに戻す離脱。破壊・消滅・除外を含めずに自己離脱を観測する。 */
  | "bounce"
  | "remove_from_game"
  | "leave_field"
  | "exhaust"
  | "recover"
  | "revealed"
  | "moved_to_trash"
  | "targeted"
  | "rebirth"
  | "advent"
  | "flash"
  /**
   * ENGINE-stack-activation-reactivation-trigger: 相手のスタック効果 (mode:"stack" の
   * 発揮) が完全解決した後に発火する第三者観測イベント。「相手がスタック効果を発揮した
   * とき」(BSTH02.7-X01 effects[2]) 用。"flash" と異なり発揮**後**に反応する誘発
   * (完全解決を待つ magic_stack_domain 同様の裁定、10_rules/08c)。
   */
  | "stack"
  | "effect_declaration"
  | "after_draw"
  | "after_cost_paid"
  /** 「バトル終了時」。バトル解決完了時に発火する自カードイベント。 */
  | "battle_end"
  /** バトルで相手のスピリット/アルティメットだけを破壊したとき。 */
  | "battle_destroy_opponent_only"
  /**
   * 「(契約)カウントが増えたとき」。PlayerState.countValue の増加で発火する。
   * カウントは player 値で relatedInstanceId を持たないため card_event 自己一致
   * (relatedInstanceId === self) では拾えない → game_event(player:"self") で使う。
   */
  | "count_increase"
  /**
   * 「カウントが減ったとき」。PlayerState.countValue の減少で発火する。
   * count_increase と同様 player 値イベント → game_event(player:"self") で使う。
   */
  | "count_decrease"
  /**
   * P3-14 C-2: ブレイヴ合体成立（「合体したとき」）。card_event = 合体したブレイヴ自身、
   * game_event = 観測（「自分のスピリットに「X」が合体したとき」、triggerFilter はブレイヴ側）。
   */
  | "brave_combined"
  /** トラッシュにカードが入った。relatedInstanceId は入ったカード。 */
  | "trash_increase"
  /**
   * P3-14 C-2: ライフへのコア配置。relatedInstanceId を持たないため game_event
   * (player = ライフの持ち主) で使う。原因効果の色は trigger_colors 条件で絞る。
   */
  | "core_placed_on_life"
  /**
   * ENGINE-c09-text-role-under-card-third-party-trigger: text_role アンダーカード
   * (【アルドノアドライブ】等) が host に実配置されたとき。game_event(player:"self") で
   * 「自分のスピリット/アルティメット/ネクサスの下に「X」が置かれたとき」型の第三者観測に使う
   * （BSAZ02-C09）。triggerFilter.hasUnderCardRoleTag で roleTag を絞り込む。
   */
  | "text_role_under_card_placed"
  /**
   * F2 クォーツ: 「(このカードが)魂状態になったとき」。card_event 自己誘発。
   * soulStateInstanceIds への追加を差分検出して発火（trigger-system collectTriggerEventsFromStateDelta）。
   */
  | "enter_soul_state"
  /**
   * F2: 「魂状態からスピリット状態になったとき」。soulStateInstanceIds から外れ、
   * 同じ instance が未合体の field 上に残る差分で発火する。
   */
  | "soul_state_to_spirit_state"
  /**
   * F2 クォーツ: 「(自分の)クォーツがセットされたとき」。relatedInstanceId を持たない
   * player 値イベント → game_event(player) で使う（count_increase 同様）。
   */
  | "quartz_set"
  /**
   * ENGINE-mirage-set-card-event-trigger: 「(このカードの)ミラージュがセットされたとき」。
   * mirageSetStates への追加を差分検出して発火（enter_soul_state 同様の card_event 自己誘発、
   * trigger-system collectTriggerEventsFromStateDelta）。BSTH002-C04。
   */
  | "mirage_set"
  /**
   * ENGINE-field-hand-swap-trigger: 【聖詠】によるフィールド⇄手札入れ替えが成立したとき。
   * card_event = 入れ替えで場に入ったカード自身（BSSG01-C03/C04 の召喚時効果を再発揮）、
   * game_event(player) = 【聖詠】を発揮した本人を観測（BSSG01-C05）。brave_combined と
   * 同型の単一 eventKind 兼用。legal-actions-apply.ts の swap_field_hand ハンドラが
   * queuePendingReactionsFromTriggerEvents で直接発火する（zone-diff 経由の enter_field
   * 汎用検出は使わない — 入れ替えは公式ルール上「召喚」ではないため、既存の
   * card_event:summon/game_event:summon リスナーを誤発火させないよう独立イベントにする）。
   */
  | "field_hand_swap"
  /**
   * 「ライフが減ったとき」。プレイヤーのライフコア数減少で発火する。relatedInstanceId を
   * 持たない player 値イベント → game_event(player) で使う（count_increase 同様）。
   * cause で「相手によって」(opponent_effect/battle) と「自分によって」(self_effect) を絞る
   * (BSTH02.7-TX01(A) 等)。
   */
  | "reduce_life"
  /**
   * 「手札が増えたとき」。プレイヤーの手札枚数増加で発火する。player 値イベント →
   * game_event(player) で使う。cause で「相手の効果」などを絞る。
   * relatedInstanceId には causedBySourceInstanceId (=この増加を引き起こした効果の
   * 発揮元カード) が乗る (count_increase/reduce_life 同型、ENGINE-triggered-hand-zone-immunity)。
   * `trigger_tribes`/`trigger_source_player` 評価用。原因カードが特定できない増加
   * (効果由来でない等) では null のまま (fail-closed)。
   */
  | "increase_hand"
  /**
   * ENGINE-void-core-decrease-trigger: 「ボイドからコアを増やしたとき」。ボイドのコア数
   * 減少（=ボイドを起点として他ゾーンへコアが増える）で発火する。relatedInstanceId を
   * 持たない player 値イベント → game_event(player) で使う（reduce_life 同様）。
   * cause で「相手によって」(opponent_effect)と「自分によって」(self_effect) を絞る
   * (BSSL01-C02「相手が相手の効果でボイドからコアを増やしたとき」)。
   */
  | "void_core_decrease"
  /**
   * ENGINE-soul-drive-activation-observable-event (P3-125): 【ソウルドライブ・S】が発動した
   * とき（自分のフィールド/リザーブの<ソウルコア>1個を除外するコストの支払い成立）。
   * relatedInstanceId を持たない player 値イベント → game_event(player) で使う
   * （quartz_set/void_core_decrease 同様）。BSLH01-X03〜X10 が発火元。
   */
  | "soul_drive_activated"
  /**
   * ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A) 柱斧): 「(自分の)カードが
   * 任意の効果を発揮したとき」。relatedInstanceId = 発揮したカード。第三者観測は
   * game_event(player) + triggerFilter で系統/カテゴリを絞る（count_increase 同様）。
   */
  | "effect_activated";

/**
 * 効果のタイミング (DSL discriminated union)。
 *
 * - card_event:  このカード自身のイベント（召喚時、アタック時等）
 * - game_event:  ゲーム内の他カード/プレイヤーのイベント（相手のスピリット召喚時等）
 * - phase:       ステップ開始/終了時（スタートステップ、エンドステップ等）
 * - activated:   起動効果（メイン/フラッシュ/スタック）
 * - burst:       バースト効果
 * - continuous:  常時効果
 */
/**
 * バーストの発動条件。構造化されたトリガー or 後方互換の文字列。
 */
export type BurstTrigger =
  | { kind: "life_decrease"; player: EffectPlayerRef }
  | { kind: "spirit_destroyed"; player: EffectPlayerRef }
  | { kind: "spirit_exhausted"; player: EffectPlayerRef }
  | { kind: "opponent_summon" }
  /**
   * 「相手のスピリット／アルティメットのアタック後」型。アタック宣言を見て発動する
   * バースト。eventKind は attack_after（既存 firing 経路 maybeQueueAttackAfterBurstCheck /
   * matcher {family:"action_after", actionKind:"attack"} を流用）。player は発動主体から
   * 見た「誰のアタックか」(通常 opponent)。アタックするのは常にスピリット/アルティメットの
   * ため category フィルタは不要。
   */
  | { kind: "attack_finished"; player: EffectPlayerRef }
  /**
   * P3-67 Phase 3: 特定 timing の効果発揮を見る型。「相手の『召喚時』発揮後」等。
   * activatedTimings = 監視する発揮 timing (summon=召喚時 / place=配置時 / advent=煌臨時)。
   * 複数指定で「召喚／配置時発揮後」のような OR を表す。
   */
  | {
      kind: "effect_activated";
      player: EffectPlayerRef;
      activatedTimings: readonly ("summon" | "place" | "advent")[];
    }
  /**
   * engine-generic-effect-activation-causal-trigger cluster (b): 発動元非依存の
   * 『任意の効果が発揮したとき』観測トリガー。上記 effect_activated は
   * 発揮元カード自身の card_event timing 効果 (召喚/配置/煌臨) に限定されるが、
   * こちらは actionKind を問わず「player が何らかの効果をスタック解決経由で
   * 発揮した」ことだけを見る (BSTH02.7-X01 effects[1]「相手がスタック効果を
   * 発揮したとき」型)。eventMatcher に actionKind を持たせないことで
   * matchesTriggerEvent が actionKind 不問マッチする性質を利用する。
   */
  | { kind: "any_effect_activated"; player: EffectPlayerRef }
  /** P3-67: 手札増加バースト。「相手の効果によって相手の手札が増えた後」等。 */
  | { kind: "hand_increase"; player: EffectPlayerRef }
  /**
   * P3-67: ステップ開始/終了バースト。「相手のアタックステップ開始後」等。
   * step = 監視するステップ、subPhase = 開始/終了 (省略時 start)。
   */
  | {
      kind: "step_timing";
      player: EffectPlayerRef;
      step: Step;
      subPhase?: "start" | "end";
    }
  /**
   * セット中バーストの追加発動条件（裁定 2026-07-23, 10_rules/04b_burst-rules.md
   * §セット中バーストの追加発動条件）。「セットしているこのカードは、自分の
   * スピリットがアタックしたときに発動できる」型（BSGE01-M03/M04）。通常の
   * バースト条件 (life_decrease 等) とは別の追加トリガーとして、同じバースト
   * 効果本体に対しもう1つ effects エントリを用意し、こちらの trigger を付与する。
   * player は通常 "self"。既存 attack_finished(eventKind:attack_after) とは
   * 別の eventKind (own_attack) を持つ — actingPlayerId が defendingPlayerId
   * 固定の attack_after 経路とは異なり、attacker 自身向けの pendingBurstCheck を
   * 積む専用経路 maybeQueueOwnAttackBurstCheck (attack-burst-flow.ts) を使うため、
   * 同一 eventKind を共有すると attack_after 側の重複キューイング guard
   * (eventKind+attackId) と衝突する。
   */
  | { kind: "own_attack"; player: EffectPlayerRef }
  /**
   * BSGE01-M04『竹田ヒバリ』【バースト：フィールドを離れた自分のスピリットが魂状態に
   * なった後】。既存の card_event `enter_soul_state`（F2, ENIGMA「魂状態になったとき」）と
   * 同じ diff-detection（trigger-system.ts `collectTriggerEvents` の enter_soul_state 検出
   * ブロック）を burst 経路にも流用する（mapTriggerEventToBurstCheck 経由）。
   * player は通常 "self"（新たに魂状態になったカードの owner 視点）。
   */
  | { kind: "enter_soul_state"; player: EffectPlayerRef }
  | string;

export type Timing =
  | {
      kind: "card_event";
      event: CardEventType | CardEventType[];
      /**
       * 指定イベントの主語を、発揮元ではなく効果テキストを持つカード自身にする。
       * 合体中ブレイヴの転醒など、host が発揮してもイベントは継承元で起こる場合に使う。
       * 未指定イベントは従来の発揮元主語。効果元・回数制限の帰属は変更しない。
       */
      effectSourceEvents?: readonly CardEventType[];
      deferredTo?: "battle_end" | "step_end";
      cause?: TriggerEventCause | readonly TriggerEventCause[];
      /**
       * enter_field event を起こした効果 index を絞る。
       * 「この効果で召喚したとき」型の summon permission follow-up で使う。
       */
      sourceEffectIndex?: number | readonly number[];
      /**
       * 同一 event 内の効果名/機構スコープを絞る。
       * 例: `event:"put", effectScope:"genkai"` は【現界】による「出す」のみ。
       */
      effectScope?: EffectEventScope | readonly EffectEventScope[];
      /**
       * P3-14 C-5: イベントの行為種別絞り込み (eventMatcher.actionKind)。
       * battle_end で「このスピリットのアタック時のバトル終了時のみ」(action:"attack") を
       * 表現する (BSTH01-R02)。ブロック側限定なら "block"。省略時は両側にマッチ。
       */
      action?: "attack" | "block";
    }
  | {
      kind: "game_event";
      /** 召喚のコスト支払い前。通常の召喚完了イベントとは別の実行境界。 */
      beforeCost?: true;
      player: EffectPlayerRef;
      event: CardEventType | CardEventType[];
      /** 「フィールドを離れたとき」。待機入りではなく実移動後のみ観測する。 */
      afterPhysicalLeave?: true;
      /** イベントを発生させたキーワード効果の種類。 */
      effectScope?: EffectEventScope | readonly EffectEventScope[];
      triggerFilter?: import("./dsl-types").CardFilter;
      /**
       * `event:"effect_activated"` 用。効果発揮完了後に pending を積むが、本文が
       * 「使用するとき ... 効果発揮後」と使用時点の source 存在も要求する場合に、
       * 使用宣言時点で候補だった source instance だけへ絞る。
       */
      latchSourceAtEffectActivationStart?: true;
      /** 効果内で選択・解決された action 種別を OR で絞る（結果の成功とは独立）。 */
      actionKinds?: readonly import("./dsl-types").Action["kind"][];
      /**
       * game_event の発揮元カードフィルタ。triggerFilter は relatedInstanceId
       * (= 対象/発生カード) に適用し、こちらは targeting 等で運ぶ effectSourceInstanceId
       * (= その対象化を起こした効果のカード) に適用する。
       */
      triggerSourceFilter?: import("./dsl-types").CardFilter;
      /**
       * event を発生させた効果の防止レベルを許可リストで絞る。未伝播のイベントは
       * fail-closed で一致しない。通常の効果は明示的に "none" として伝播される。
       */
      triggerSourcePreventionLevels?: readonly EffectPreventionLevel[];
      cause?: TriggerEventCause | readonly TriggerEventCause[];
      /**
       * イベントを直接起こしたプレイヤーをリスナー基準で絞る。`cause` が battle のように
       * 行為種別だけを表す場合でも、「相手によって」を実際の加害者で判定する。
       * 原因未伝播イベントは安全側で不一致。
       */
      triggerCausedBy?: "self" | "opponent";
      /**
       * true のとき、registration の eventKind と pending の eventKind を完全一致させる。
       * `event:"leave_field"` は通常 pre-flush の destroy/vanish/bounce/remove_from_game
       * family にもマッチするため、「フィールドを離れたとき」型は true にして
       * 物理 flush 後の leave_field 境界だけを見る。
       */
      exactEventKind?: boolean;
      /** P3-14 C-5: card_event 側と同じ actionKind 絞り込み。 */
      action?: "attack" | "block";
      /**
       * P3-75/P3-76: targeting/effect_declaration event で、対象にした効果の実行窓を
       * 絞り込む。見出しラベル由来の効果カテゴリは `triggerEffectLabel` を使う。
       */
      triggerEffectTiming?: EffectActivationTiming;
      /**
       * effect_declaration event で、対象にした効果の見出しラベル由来カテゴリを絞り込む。
       * 「スタック効果」を見る場合は `triggerEffectLabel:"stack"` とし、本文中の
       * 「スタックタイミングで」型 (`activationLabel:"none"`) を混ぜない。
       */
      triggerEffectLabel?: ActivatedEffectLabel;
      /**
       * P3-75: effect_declaration event で、対象にした効果の ActiveStack 種別を絞り込む。
       * 例: magic / accel / field_card_effect。省略時は effectActivationTiming のみで絞る。
       */
      triggerEffectActionKind?:
        | EffectResolutionActionKind
        | readonly EffectResolutionActionKind[];
      /**
       * ENGINE-effect-immunity-own-pending-resolution: `event:"effect_declaration"` で、
       * 宣言された効果の ActiveStack 宣言元ゾーン (`getStackSourceActivationZone` 解決値、
       * `StepCondition.kind:"activation_zone"` と同じ導出元) を絞り込む。「手札/手元から
       * フラッシュ効果を使用したこのカードは…」型 (BSKB01-R04) のように、declaration
       * 自体のゾーンで自己反応を絞る必要がある場合に使う。`activation_zone` StepCondition は
       * 同一効果の steps 内 (StepExecutionContext.activationZone 経由) でしか評価できず、
       * 独立した card_event/game_event 反応では参照できないため、この Timing レベルの
       * 絞り込みが必要になる。
       */
      triggerActivationZone?:
        | EffectActivationSourceZone
        | readonly EffectActivationSourceZone[];
      /**
       * 「このスピリット/カードの召喚以外で」型の自己除外。true のとき、
       * イベントを起こしたカード (relatedInstanceId) がこのリスナー自身の instance と
       * 一致する場合は誘発しない（自カード自身の召喚/煌臨/配置で誤発火させない）。
       * 例: BSTS01-CX01「このスピリットの召喚以外で系統『暴嵐』を…召喚/煌臨/配置したとき」。
       * 省略時 = false（自己一致でも通常どおり誘発候補に含む）。
       */
      excludeTriggerSelf?: boolean;
      /**
       * excludeTriggerSelf の逆。true のとき、イベントを起こしたカード
       * (relatedInstanceId) がこのリスナー自身の instance と一致する場合のみ誘発する。
       * 例: BSTS01-CX01「この『リムル』の効果で自分のカウントが増えたとき」
       * — count_increase の発生源が自カード自身の効果である場合だけ反応。
       * count_increase / count_decrease 等 player 値イベントでは、
       * relatedInstanceId に causedBySourceInstanceId (=効果発揮元カード) が乗る。
       * 省略時 = false（自己ソース絞り込みなし、通常どおり）。
       */
      requireTriggerSelf?: boolean;
      /**
       * バトル終了時 形式4 (10_rules/02 §バトル終了時 形式別、裁定 2026-06-22) の opt-out フラグ。
       * 通常 require_related_instance_on_field 検査のあるイベント (battle_end / advent / rebirth /
       * brave_combined 等) は「観測対象 (relatedInstanceId) がイベント時点でフィールドに残って
       * いる」場合のみリスナーを誘発するが、形式4 「Lv1-Lv2『お互いのアタックステップ』...
       * バトル終了時、〜」型 (BSDB01-M01[2]) は **任意のバトル観測**＋**バトル参加者の離脱を許容**
       * (= 観測対象 on-field を要求しない) する。効果ソース自身の場残留は applicability/sourceZone
       * 既定の field-only により別軸で保証される。
       * 省略時 = true（通常どおり関連カード on-field を要求）。
       */
      requireRelatedInstanceOnField?: boolean;
      /**
       * ENGINE-leave-field-third-party-opponent-source-whose: `getTriggeredEffectSourceUseBlockReason`
       * の既定 whose="self" は `actingPlayerId` が「リスナー自身のコントローラ」と一致することを
       * 要求するが、leave_field/destroy 等一部 family は `actingPlayerId` が「離脱したカードの
       * コントローラ」という別の意味論を持つ (PLAYER_VALUE_EVENT_KINDS_FOR_WHOSE_GAP のコメント
       * 参照)。「自分の系統Xによって相手のカードがフィールドを離れるとき」型
       * (BSDB01-CX01[2,3]) のような第三者 opponent 観測は、`player`/`cause`/`triggerSourceFilter`
       * で既に必要な絞り込みが揃っているため、既定の自己コントローラ一致要求を明示的に
       * 外す必要がある。省略時は従来どおり (phase timing の `whose` 同様、既定 "self")。
       * card_event/phase 全体への自動適用ではなく opt-in field のため既存カードへの影響なし。
       */
      sourceWhose?: EffectPlayerRef;
    }
  | {
      kind: "phase";
      /** Omit step for every step at the specified subPhase (e.g. 各ステップ終了時). */
      step?: Step;
      whose?: EffectPlayerRef;
      subPhase?: "start" | "end";
    }
  | {
      kind: "activated";
      mode: EffectTimingMode;
      deferredTo?: "battle_end" | "step_end";
    }
  | {
      kind: "burst";
      trigger?: BurstTrigger;
      /**
       * P3-67 Phase 2: 発動条件のカードフィルタ (色・系統・カテゴリ等)。
       * イベント対象カード (例: 召喚されたカード / 離れたカード) が満たすべき条件。
       * 例: 「相手のアルティメットが…」→ { category: ["ultimate"] }。
       */
      triggerFilter?: import("./dsl-types").CardFilter;
      /**
       * P3-67: 発動条件の「原因」絞り (leave_field 系)。
       * 「相手によって自分のスピリットが離れた後」のように、離脱の cause を
       * 絞るバーストで使う。指定時はイベントの cause がこの集合に含まれる場合のみ発動。
       * 省略時は cause を問わない。文字列 trigger からは自動導出される
       * (「相手によって」→ [opponent_effect, battle, opponent_bp_compare] 等。generateBurstRegistrations 参照)。
       */
      cause?: readonly TriggerEventCause[];
      /**
       * 手札からの直接バースト発動（裁定 2026-06-16, 信頼度 C / 10_rules/04b §手札からの直接バースト発動）。
       * 「手札にあるこのカードは、バースト条件を満たしたとき〜なら発動できる」型
       * （BSTS01-M01[2]）。バーストエリアへ事前セットせず、手札のカードを直接バーストとして
       * 発動する。true のとき発動源を手札ゾーンに許可する。
       * - 発動宣言タイミング・自動発動機会は通常バーストと同じ（通常 burst 経路に乗せる）。
       * - 発動するとこのカードは「バーストゾーンで発動した」扱い。ゾーン移動は内部状態のみで扱う。
       *   行き先はバースト効果本体が決める（BSTS01-M01[4,5] は自己召喚でフィールドへ出る）。
       */
      handSource?: boolean;
      /**
       * 手札ソースバーストの追加発動条件（カウント閾値等）。発動宣言時に評価する。
       * 例: BSTS01-M01[2] 「自分のカウント5以上なら」→ [{ kind: "count_value", ... }]。
       */
      handSourceCondition?: readonly ConditionClause[];
    }
  | { kind: "continuous" };

/** @deprecated Timing を使用してください。後方互換用エイリアス。 */
export type EffectTiming = Timing;

/**
 * カードテキストの『自分の/相手の/お互いの + ステップ/ターン』部分を表現する。
 * timing（効果の種類/モード）と直交する軸として「誰のいつ」を指定する。
 *
 * 省略時は timing ごとのデフォルト:
 * - activated(main) → {player:"self", period:"main"}
 * - activated(flash) → {player:"both", period:"attack"}
 * - continuous → 制限なし
 * - card_event → N/A
 */
export interface TimingScope {
  /** 自分=self, 相手=opponent, お互い=both */
  player: "self" | "opponent" | "both";
  /** ステップ指定 or ターン全体。省略時は timing から暗黙推定。 */
  period?: Step | "turn";
  /** 開始時/終了時 のサブフェーズ。省略時=ステップ全体。 */
  subPhase?: "start" | "end";
}

export type EffectPlayerRef = "self" | "opponent" | "either";

export interface EffectTarget {
  player: EffectPlayerRef;
  /** DSL CardFilter を保持する v1 bridge。filterOr/hasMechanic 等は matchesCardFilter に委譲する。 */
  filter?: import("./dsl-types").CardFilter;
  category?: CardCategory[];
  maxBp?: number;
  minCost?: number;
  maxCost?: number;
  /** minCost / maxCost の判定基準。既定は追加コスト値も含める。 */
  costBasis?: "effective_or_additional" | "printed";
  /** 合体状態フィルタ。true=合体中 / false=合体していない。 */
  combined?: boolean;
  /**
   * カード上の合計コア数の上限/下限（「コアN個以下/以上の〜」）。
   * 「コア」は generic なのでソウルコアを含む（10_rules/06_core-system.md L41）。
   * collectTargetCardCandidates で `getTotalCoresOnCardById`（= 通常コア + soul, SSOT）と比較する。
   * 場のカードのみ意味を持つ（collectTargetCardCandidates は field カードのみ走査）。
   * CardFilter.maxCores/minCores と同義（convertTargetSpecToEffectTarget が伝播）。
   */
  maxCores?: number;
  minCores?: number;
  /**
   * 対象カードのコントローラーがこのターン中に `declare_gimmick` を実行済みか
   * （「宣言しなければアタック/ブロックできない」型、BSLH01-C12）。true=宣言済みのみ一致 /
   * false=未宣言のみ一致。`GameState.declarationCountThisTurn` を判定基準とする
   * （declare_gimmick primitive の SSOT、CardFilter.declaredThisTurn と同義）。
   */
  declaredThisTurn?: boolean;
  tribes?: string[];
  colors?: CardColor[];
  /** 最小色数（「六色以上」= 6）。matchesColorCount() で判定。 */
  minColorCount?: number;
  /** 最大色数（「ちょうど六色」= min:6, max:6）。省略時は上限なし。 */
  maxColorCount?: number;
  /**
   * 系統の論理結合。省略時は OR（いずれかを持つ）。
   * "and" は「幻想」と「導魔」のように全てを持つ。
   * 複合条件（「幻想」と「導魔」/「楽族」= AND(幻想, OR(導魔,楽族))）は
   * tribesRequired + tribes で表現: tribesRequired は必須、tribes は選択。
   */
  tribesLogic?: "and" | "or";
  /** AND 条件で必須の系統（tribesLogic とは別軸で使用可能） */
  tribesRequired?: string[];
  /** 系統を持たないカードだけに一致する。 */
  noTribes?: boolean;
  /** カード名で指定（「カード名：「ミニ八卦炉」」等） */
  cardNames?: string[];
  /** CardFilter.cardName 由来の名前条件（contains/exact/self を保持する）。 */
  cardName?:
    | import("./dsl-types").CardNameMatch
    | import("./dsl-types").CardNameMatch[];
  /**
   * true のとき、効果の発生源カード自身を対象とする（「このスピリットは回復する」等）。
   * player/category/count は無視され、sourceInstanceId のカードが直接対象になる。
   */
  selfCard?: boolean;
  /** 対象枚数。-1 で「すべて」を意味する。 */
  count: number;
  /** true のとき、魂状態のカードも対象に含める（デフォルトは除外）。 */
  includeSoulState?: boolean;
  /** true のとき、創界神/導界者ネクサスも対象に含める（デフォルトは除外）。 */
  includeGrandwalker?: boolean;
  /**
   * true のとき、**創界神/導界者ネクサスのみ**に対象を制限する（通常スピリット・通常ネクサス除外）。
   * CardFilter.targetsGrandwalker:"only" (dsl-types.ts) からの射影。
   * - includeGrandwalker:true と排他ではない（"only" は inclusion + exclusivity の両方を含意し、
   *   convertTargetSpecToEffectTarget で両方を真にセットする）。
   * - collectTargetCardCandidates / 同型の場サイト (structured-effect-interpreter.ts) が
   *   `!isGrandwalkerOrGuidedNexus(def)` のとき false 返却する。
   */
  grandwalkerOnly?: boolean;
  /** true のとき、創界石ネクサスも対象に含める（デフォルトは除外。創界神とは別軸）。 */
  includeGrandstone?: boolean;
  /**
   * 対象ゾーン（`TargetSpec.zone` からの伝播、省略時は従来どおり field 限定）。
   * `collectTargetCardCandidates` が field 固定チェックの代わりに参照する
   * (ENGINE-effect-immunity-hand-zone-scope)。
   */
  zone?: readonly Zone[];
}

export type EffectCoreLocation =
  /** core_move の1個移動用 source union。選択は共通コア配分 pending を使う。 */
  | { kind: "union"; sources: EffectCoreLocation[] }
  | { kind: "void"; player: EffectPlayerRef }
  | { kind: "reserve"; player: EffectPlayerRef }
  | { kind: "trash"; player: EffectPlayerRef }
  | { kind: "life"; player: EffectPlayerRef }
  /**
   * ゲーム外 (from 専用、soul core のみ)。「ゲーム外から<ソウルコア>1個を自分の
   * リザーブに置ける」(BSLH01-C05/R03 等) のソース。`generateSoulCoreOutsideGame`
   * (core-system.ts) に委譲し、既存ゾーンからの移動ではなく新規カウント計上を行う。
   * `player` は持たない (発揮者自身に紐づくため to 側の player で解決する)。
   */
  | { kind: "outside_game" }
  /**
   * ゲームから除外（to 専用、soul core のみ）。dsl-types.ts CoreLocation の同名 kind
   * (P3-125 Step1) の解決済み形。`PlayerScopedSoulCoreLocation` の既存 "removed_from_game"
   * kind へ委譲する (moveSoulCore)。
   */
  | { kind: "removed_from_game"; player: EffectPlayerRef }
  | {
      /**
       * フィールド上のカードのコア源（コアシュート）。`filter` 指定時は対象カードを
       * CardFilter で限定（battleState/maxCost/category/maxCores 等）。省略時は従来どおり
       * controller/zone のみ。`minRemainingPerCandidate` は「コアを0個にできない」残数下限。
       * `minRemainingPerCandidateByFilter` は同一 source 内の種別別下限を表す。
       */
      kind: "field";
      player: EffectPlayerRef;
      filter?: import("./dsl-types").CardFilter;
      minRemainingPerCandidate?: number;
      minRemainingPerCandidateByFilter?: Array<{
        filter: import("./dsl-types").CardFilter;
        minRemaining: number;
      }>;
      /**
       * 「フィールド/リザーブのコア」横断コア除去（BSTH001-X01「相手のフィールド/
       * リザーブのコア2個をボイドに置ける」）。true のときフィールドカード上のコアに加え
       * player のリザーブ通常コアも同一選択（pendingCoreShootSelection）の候補に含める。
       * リザーブは sentinel instanceId `reserve:<playerId>` の擬似候補として表現する。
       * 06_core-system.md L41「どの物理コアを動かすかは持ち主が選ぶ」+ コアシュート規約に
       * 従い、相手コア除去では効果コントローラ（acting player）が選ぶ。
       * filter はフィールドカードのみに適用（リザーブには無効）。
       */
      includeReserve?: boolean;
      /** Move amount from each included zone; one amount bonus is shared by the zones. */
      eachZone?: boolean;
    }
  | { kind: "this_card" }
  | { kind: "target_card" }
  /**
   * 解決済みの特定カード上のコア源（単一対象コアシュート）。`target_card` を実行時に
   * 選択した対象1体の instanceId へ束ねた形。pendingCoreCountSelection に保存し、
   * 数選択解決時に executeCoreMove がこの1体からコアを移す。
   */
  | { kind: "card_instance"; instanceId: string }
  | {
      /**
       * 特定条件のフィールドカード上のコア（「自分の緑の創界神ネクサスのコア」等）。
       * P3-14 D-6: filter は DSL CardFilter 全体を受ける（targetsGrandwalker /
       * tribesRequired 等の AND 条件をコスト支払い元の限定に使う）。
       */
      kind: "field_card";
      player: EffectPlayerRef;
      filter: import("./dsl-types").CardFilter;
    }
  | {
      /**
       * カウントエリア（フィールドに含まれない独立ゾーン）源。PlayerState.countValue を
       * 実質的なコア数として扱い、availableCores=countValue。10_rules/08a
       * §カウントエリア「カウントに関する効果以外でコアを移動・使用・参照できない」の
       * 明示例外として、この kind を使う効果 (BSKB01-C04 のみ) だけが countValue を
       * 移動可能なコア源として扱う。executeCoreMove の専用 handler
       * (handleCountAreaSource) は countValue を decrement し、moveNormalCores の
       * enter-field-only 配置制限 (BSKB01-T01) を意図的にバイパスする
       * (structured-summon.ts の enter-field 自動配置と同じ exemption)。
       */
      kind: "count_area";
      player: EffectPlayerRef;
    };

export interface DrawAction {
  kind: "draw";
  count: number;
}

export interface DestroyAction {
  kind: "destroy";
  target: EffectTarget;
  suppressDestroyedEffects?: "destroyed_only" | "all_opponent";
  /**
   * 残置抑制を「破壊された対象の印字カテゴリがこのリストに含まれる場合のみ」適用する。
   * 未指定なら従来通り対象全体に一律適用。例: BSTH001-R02『破壊したスピリットは
   * フィールドに残らない』= filter=["spirit","ultimate"] / suppressDestroyedEffects:
   * "destroyed_only" / suppressDestroyedEffectsByCategory:["spirit"]。
   */
  suppressDestroyedEffectsByCategory?: CardCategory[];
}

export interface CoreMoveAction {
  kind: "core_move";
  from: EffectCoreLocation;
  to: EffectCoreLocation;
  amount: number | "all";
}

export interface CoreSetToLevelAction {
  kind: "core_set_to_level";
  from: EffectCoreLocation;
  target: EffectTarget;
  level: number;
}

export interface BpModifyAction {
  kind: "bp_modify";
  target: EffectTarget;
  amount: number;
  duration: EffectDuration;
}

export interface RecoverAction {
  kind: "recover";
  target: EffectTarget;
}

export interface ExhaustAction {
  kind: "exhaust";
  target: EffectTarget;
  /** 省略時は "exhausted"。"heavily_exhausted" で重疲労。 */
  targetState?: "exhausted" | "heavily_exhausted";
  /**
   * 「相手は、この効果をN体以上防げない」のN-1。
   * 相手が防止できる対象の最大数。例: "2体以上防げない" → maxPreventable: 1。
   * 省略時は制限なし（通常の防止ルール適用）。
   */
  maxPreventable?: number;
}

export interface SearchDeckAction {
  kind: "search_deck";
  count: number;
  /**
   * 検索対象の絞り込み。`search_zone` ハンドラは DSL の `CardFilter` を無変換で
   * 渡し、`executeSearchDeck` は `matchesCardFilter` (SSOT) にそのまま流す
   * （BSFT01-C03/TR10(A)/TR13(A) の `tribesRequired:["光導","鍵"]` はこの経路で効く）。
   * サブセットを手で再定義すると宣言と実態が乖離するため `CardFilter` を使う。
   */
  filter?: import("./dsl-types").CardFilter;
  destination: "hand" | "field" | "top_of_deck" | "bottom_of_deck";
  /**
   * 操作対象デッキの所有プレイヤー。省略時 = actingPlayerId（従来挙動）。
   * SearchZoneAction.player を deck 経路へ伝搬する内部 SSOT。
   */
  targetPlayerId?: string;
  /**
   * 候補超過 pendingZoneSelection の枚数選択を exact にするか。
   * 発揮有無の任意性は EffectStep.executionMode で扱い、実行後に「1枚」
   * などの exact 枚数を要求する場合は canSkip:false へ伝搬する。
   */
  mandatory?: boolean;
  /**
   * 「N枚まで」型の任意上限。候補数が count 以下でも 0..count の
   * pendingZoneSelection を開き、プレイヤーが選んだ枚数だけ解決する。
   */
  optionalUpTo?: boolean;
}

export interface ReturnFromTrashAction {
  kind: "return_from_trash";
  count: number;
  /** 戻す対象の絞り込み。`SearchDeckAction.filter` と同じ理由で `CardFilter` を使う。 */
  filter?: import("./dsl-types").CardFilter;
  /**
   * 戻し先ゾーン。
   * - "deck" = デッキへ戻す（位置は state がデッキ順を保持しないため top/bottom 同値、
   *   「好きな順番でデッキの下に戻す」型も deckCount 加算のみで表現する）。
   *   相手トラッシュ操作（BSFT01-TR11(B)/BSTH07-転醒X01(B)）と組み合わせて使う。
   * - "removed_from_game" = トラッシュからゲーム外へ除外（BSTH08-XX01 effects[1]
   *   【導技：4】トラッシュ1枚を除外するコスト）。手札/デッキカウントは更新せず、
   *   face-down policy を適用する。
   */
  destination:
    | "hand"
    | "field"
    | "set_aside"
    | "deck"
    | "removed_from_game"
    | "hand_or_set_aside_choice";
  /** destination が deck のときの元テキスト位置指定。state は deck 順非保持のため実移動は deckCount 加算。 */
  destinationPosition?: "top" | "bottom";
  /**
   * 候補超過 pendingZoneSelection の枚数選択を exact にするか。
   * 発揮有無の任意性は EffectStep.executionMode で扱い、実行後に「1枚」
   * などの exact 枚数を要求する場合は canSkip:false へ伝搬する。
   */
  mandatory?: boolean;
  /**
   * 「N枚まで」型の任意上限。候補数が count 以下でも 0..count の
   * pendingZoneSelection を開き、プレイヤーが選んだ枚数だけ解決する。
   */
  optionalUpTo?: boolean;
}

export interface LifeDamageAction {
  kind: "life_damage";
  player: EffectPlayerRef;
  amount: number;
}

export interface SymbolAddAction {
  kind: "symbol_add";
  target: EffectTarget;
  /**
   * 追加シンボルの色。
   * - 単色: SymbolColor (例: "red")
   * - デュアルカラーシンボル (1 シンボルが複数色として機能): SymbolColor[] (例: ["red","purple"])
   * `symbolSource` 指定時は無視される（動的解決に置き換わる）。
   */
  symbol?: SymbolColor | SymbolColor[];
  /**
   * 動的シンボルソース。指定時、`symbol` は無視され消費時（`getSymbolAdditions`）に
   * live 評価する 1 シンボル（複数色バンドル）として扱う。
   * 「自分のフィールドにあるすべてのシンボルとして扱うシンボル1つを得る」
   * (BSTH01-M13 Lv1-Lv2) 型の動的シンボルコピー用。
   */
  symbolSource?: SymbolDynamicSource;
  duration: EffectDuration;
}

/**
 * host 自身 (target:self 前提) の underCardSlots 該当 hostRoleTag 枠上限へ、childRoleTag
 * 一致 text_role アンダーカードそれぞれの自身の underCardSlots (同一 hostRoleTag) maxCount を
 * 合算加算する継続効果 (`SymbolAddAction.symbolSource.kind==="under_card_symbols"` と同型の
 * 自己参照型動的加算、BSAZ02-TX01(B) precedent)。
 */
export interface UnderCardSlotCapacityGrantAction {
  kind: "under_card_slot_capacity_grant";
  target: EffectTarget;
  hostRoleTag: string;
  childRoleTag: string;
  childFilter?: import("./dsl-types").CardFilter;
  duration: EffectDuration;
}

/**
 * symbol_add の動的シンボルソース。
 * - "field_colors_present": player のフィールド上の合体単位の実効シンボル色
 *   (循環コピー自身を除く) を union した集合を、1 シンボルが
 *   複数色として機能するバンドルとして扱う。CE 由来の再帰参照 (自身の symbol_add が
 *   自身の実効シンボルに再帰的に依存する事態) を避けるため base のみを参照する。
 * - "presented_contract_colors": player がゲーム開始時に提示した契約カードの印字 colors
 *   を、1 シンボルが複数色として機能するバンドルとして扱う。
 * - "under_card_symbols": 発動元カード自身 (target:self 前提) の roleTag 一致アンダーカード
 *   すべての base symbolColors (definition.symbolColors) を、各アンダーカードの各シンボルを
 *   個別の 1 シンボルとして (field_colors_present と異なり 1 つの複数色バンドルへ統合せず)
 *   加算する。「このアルティメットの下にあるアルティメットカードすべてのシンボルを…得る」
 *   (BSAZ02-TX01(B)) 型。「Lvを無視で」= アンダーカードの base 値をそのまま用いる (level 非依存)。
 * - "zone_symbols": player の指定 zone にあり filter (省略時=無条件) に一致する各カードの
 *   base symbolColors を、各カードの各シンボルを個別の 1 シンボルとして加算する。
 *   under_card_symbols のホスト自身アンダーカード限定版に対し、任意ゾーン+CardFilter に
 *   一般化した版（「手元にある系統:面霊のブレイヴカードすべてのシンボルを追加する」
 *   BSTH08.5-X04 型）。裏向きカードは素性を持たないため除外する。
 */
export type SymbolDynamicSource =
  | {
      kind: "field_colors_present";
      player: EffectPlayerRef;
    }
  | {
      kind: "presented_contract_colors";
      player: EffectPlayerRef;
    }
  | {
      kind: "under_card_symbols";
      roleTag: string;
      filter?: import("./dsl-types").CardFilter;
    }
  | {
      kind: "zone_symbols";
      zone: Zone;
      player: EffectPlayerRef;
      filter?: import("./dsl-types").CardFilter;
    };

export interface BounceAction {
  kind: "bounce";
  target: EffectTarget;
  /** 相手が防げる最大体数。例: 1 = 「2体以上防げない」 */
  maxPreventable?: number;
  /**
   * 移動先ゾーン。省略時は "hand"（手札に戻す）。
   * バウンスは SBR 上「手札 / デッキ / 手元」へ戻す単一カテゴリで、差は理由と移動先のみ
   * （10_rules/04_state-based-rules.md）。"set_aside" で「手元に置く」を表す。
   * デッキ戻しは別 primitive `send_to_deck` を使う。
   */
  destination?: "hand" | "set_aside";
  /** 選択済み対象ごとの戻し先。全対象を一度に離場処理へ渡す。 */
  destinationByCardId?: Record<string, "hand" | "set_aside">;
}

export interface DiscardHandAction {
  /** Exclude cards only treated as hand by an access rule. */
  physicalHandOnly?: boolean;
  kind: "discard_hand";
  /** 破棄枚数。-1 で「手札すべて」。targetHandSize 指定時は無視。 */
  count: number;
  /** 「手札がN枚になるように破棄」（count の代わりに使用） */
  targetHandSize?: number;
  /**
   * targetHandSize 併用時の破棄上限キャップ。「N枚破棄するか、N枚になるように破棄する
   * （少ない方）」型 (BSAZ02-X02) を effectiveCount = min(capCount, computed) で表す。
   */
  capCount?: number;
  /** 破棄させるプレイヤー。省略時は効果の context から決定。 */
  targetPlayer?: EffectPlayerRef;
  /**
   * 破棄元ゾーン。省略時は "hand"。"hand_or_set_aside" で手札/手元の両方。
   * "deck" = デッキの上からのミル破棄（不可視・位置固定、常に先頭 N 枚を強制確定。
   * 選択モーダルを出さない。deckCount を直接減算する）。
   * "mirage" = セット中ミラージュの破棄（ENGINE-composite-heterogeneous-removal-budget、
   * BSTH09-X01「相手のミラージュ3つまでを破棄」）。手札破棄耐性 (prevent_hand_discard)
   * ゲートの対象外 (deck ミルと同じ扱い)。
   */
  fromZone?: "hand" | "set_aside" | "hand_or_set_aside" | "deck" | "mirage";
  /**
   * 破棄対象の絞り込み。評価は `matchesCardFilter` (SSOT) に丸ごと渡るため、
   * 型はサブセットを手で再定義せず `CardFilter` をそのまま使う（部分列挙にすると
   * `tribesLogic` / `tribesRequired` のような後付けフィールドが射影で黙って落ちる）。
   */
  filter?: import("./dsl-types").CardFilter;
  /**
   * 「内容を見ないで破棄」(blind discard)。true のとき選択モーダル
   * (pendingZoneSelection) を生成せず、エンジンが枚数分を確定する。
   * 「相手は1枚選んで捨てる」(選択あり) とは区別する。
   */
  unseen?: boolean;
  /**
   * 複数の破棄候補から選ぶプレイヤー。省略時は破棄対象プレイヤー自身。
   * `"effect_controller"` は効果の発揮者が公開済みの相手手札から選ぶ場合に使う。
   */
  selectionPlayer?: "target_player" | "effect_controller";
  /**
   * 行き先ゾーン。省略時は `"trash"`（通常破棄）。`"deck_bottom"` で
   * 「手札からカードをデッキの下に戻す」を表す（BSRK01-C03）。選択ロジックは
   * 破棄と共通で、最終的な移動先のみが変わる。
   */
  destination?: "trash" | "deck_bottom";
  /**
   * この破棄でトラッシュに置かれたカード自身の moved_to_trash 自動効果を抑止する。
   * 「〜を破棄し、その効果を発揮させない」型の共通表現。
   */
  suppressMovedToTrashEffects?: boolean;
}

export interface SendToDeckAction {
  kind: "send_to_deck";
  target: EffectTarget;
  position: "top" | "bottom";
  /** 相手が防げる最大体数。例: 0 = 「防げない」 */
  maxPreventable?: number;
  /**
   * 「フィールドに残させない」。`cannot_leave_field` だけを貫通し、
   * outcome 固有の `cannot_be_sent_to_deck` は貫通しない。
   */
  pierceCannotLeaveField?: boolean;
}

/**
 * 手札公開アクション（純粋な閲覧）。
 * 対象プレイヤーの手札を指定相手に見せるだけで、カードのゾーン移動は伴わない。
 * 公開後にカードを選ばせて破棄/破壊等を行う場合は、続くステップで `discard`/`destroy` を呼び出す。
 *
 * 「見る」（観察者のみ）と「公開」（相手にも見せる）の差は `revealTo` で表現:
 *   - "self"     = 効果オーナーのみ閲覧（「見る」）
 *   - "opponent" = 効果オーナーの相手のみ閲覧
 *   - "both"     = 両者閲覧（「公開」）
 */
export interface RevealHandAction {
  kind: "reveal_hand";
  /** 公開される手札の所有プレイヤー。省略時は実行者。 */
  targetPlayer?: EffectPlayerRef;
  /** 手札を見ることができるプレイヤー。 */
  revealTo: "self" | "opponent" | "both";
  /** 公開する枚数。省略時は対象手札すべて。 */
  count?: number;
  /**
   * 公開対象の絞り込み。省略時は手札全枚を公開。
   * `DiscardHandAction.filter` と同じ理由で `CardFilter` をそのまま使う。
   */
  filter?: import("./dsl-types").CardFilter;
}

/**
 * デッキ閲覧アクション（カードのゾーン移動を伴わない純粋な閲覧）。
 * 対象プレイヤーのデッキ上から N 枚の内容を `revealTo` 指定の相手に開示する。
 *
 * 「見る」と「公開」の差は `revealTo` で表現:
 *   - "self"     = 効果オーナーのみ閲覧（「見る」）
 *   - "opponent" = 効果オーナーの相手のみ閲覧
 *   - "both"     = 両者閲覧（「公開」）
 *
 * 例: 「ターンプレイヤーのデッキの上から5枚内容を見る」(BSAZ02-X01)
 *   → peek_deck(targetPlayer=turn_player, count=5, revealTo=self)
 *
 * デッキの並び替えが必要な場合は、続くステップで `move_card` 等を組み合わせる。
 */
export interface PeekDeckAction {
  kind: "peek_deck";
  /** 閲覧対象デッキの所有プレイヤー。省略時は実行者。 */
  targetPlayer?: EffectPlayerRef;
  /** デッキ上から閲覧する枚数 */
  count: number;
  /** 内容を見ることができるプレイヤー */
  revealTo: "self" | "opponent" | "both";
}

/**
 * 指定ゾーンをシャッフルする。
 * 通常はデッキを対象にするが、トラッシュをデッキに戻す前段で使うケース等もある。
 * シャッフルはゾーン内のカード順序を Fisher-Yates でランダム化する。
 *
 * 例: 「自分は、自分のデッキをシャッフルし、その後、デッキの上から1枚までドローする」(BSLH01)
 *   → shuffle_zone(zone=deck) → draw(count=1)
 */
export interface ShuffleZoneAction {
  kind: "shuffle_zone";
  /** シャッフル対象ゾーン */
  zone: Zone;
  /** 対象ゾーンの所有プレイヤー。省略時は実行者。 */
  targetPlayer?: EffectPlayerRef;
}

/**
 * デッキオープン → フィルタ選択 → 残りをデッキに戻す。
 * 「デッキを上からN枚オープンできる。その中の[picks]を手札に加える。残ったカードはデッキの下に戻す。」
 */
export interface DeckRevealAction {
  beforePickSteps?: import("./dsl-types").EffectStep[];
  beforeMoveSteps?: import("./dsl-types").EffectStep[];
  kind: "deck_reveal";
  /** オープンする枚数 */
  revealCount: number;
  /**
   * オープン/閲覧したカードの可視範囲。省略時は従来どおり "both"。
   * 「内容を見る」型は "self" を指定し、revealed 効果も発火させない。
   */
  revealTo?: "self" | "opponent" | "both";
  /** 選択グループ。各グループのフィルタに一致するカードを指定枚数まで手札に加える */
  picks: DeckRevealPick[];
  /** 残りカードの行き先。"top_or_bottom" は一括上下選択、"top_bottom_split" はカード別上下分配 */
  remainder:
    | "top"
    | "bottom"
    | "top_or_bottom"
    | "top_bottom_split"
    | "bottom_or_trash"
    | "trash";
  /** オープン対象のプレイヤー（このプレイヤーのデッキがオープンされる）。省略時は実行者。選択は常に実行者が行う。 */
  targetPlayer?: EffectPlayerRef;
  /**
   * true のとき、オープンしたカード自身の revealed 効果 (card_event event:"revealed") を
   * 一切評価しない（「オープンしたカードの効果は発揮されない」）。省略時 = false。
   */
  suppressRevealedEffects?: boolean;
  /** field へ入れた選択カード自身の summon/place 効果を抑止する。 */
  suppressFieldEntryEffects?: boolean;
}

export type DeckRevealPickFilter = {
  category?: CardCategory[];
  colors?: CardColor[];
  tribes?: string[];
  /** tribes の評価ロジック。"and" = 全て必須、"or"（デフォルト）= いずれか1つ */
  tribesLogic?: "and" | "or";
  /** 創界神/導界者ネクサスを対象候補に含める。 */
  targetsGrandwalker?: boolean | "only";
  /** 導界者などの mechanic 判定。CardFilter.hasMechanic と同じ SSOT。 */
  hasMechanic?: MechanicName[];
  maxCost?: number;
  /** カード名フィルタ（配列で複数指定時はOR）。CardFilter.cardName と同一意味論。 */
  cardName?:
    | import("./dsl-types").CardNameMatch
    | import("./dsl-types").CardNameMatch[];
};

export interface DeckRevealPick {
  count: number;
  /** 単一条件フィルタ */
  filter?: DeckRevealPickFilter;
  /** OR 条件フィルタ（いずれか1つに合致すればよい） */
  filterOr?: DeckRevealPickFilter[];
  /**
   * 候補があるとき、空選択を許さない。
   * 「1枚を手札に加える」等の強制 pick 用。省略時 = false（0..count）。
   */
  mandatory?: boolean;
  /**
   * 選択カードの行き先。
   * - `"hand"` (省略時): 通常の手札追加。
   * - `"field"`: 直接フィールド配置（配置時誘発が発火）。
   * - `"hand_swap"`: 「手札1枚と入れ替え」。
   *   選択カードを手札に入れ、手札1枚を deck_reveal.remainder の top/bottom/trash へ送る。
   *   手札が空なら pick 諦め（単純 add フォールバックなし）。
   * - `"hand_or_set_aside_swap"`: 「手札/手元と入れ替え」(BSTH09-C04/C05)。
   *   選択カードを手札 or 手元に入れ、入れたゾーンの 1 枚を「このカード」の行き先
   *   （deck_reveal.remainder の top/bottom/trash）へ送る 1 対 1 物理交換。
   *   per-pick 独立選択。両ゾーンとも空なら pick 諦め（単純 add フォールバックなし）。
   *   正源: 10_rules/07b §BSTH09-C04/C05（裁定 2026-06-17）。
   * - `"mirage_set"`: 「コストを支払わずにミラージュとしてセットする」(BSGE01-M04)。
   *   既存ミラージュがあれば手札へ戻し (手札増加扱いではない、useSetMirageAsAction と同じ)、
   *   このカードを mirageSetStates の新エントリにする。ターン1回制限の対象外
   *   (効果によるセットは対象外、mirage-system.ts コメント参照)。
   * - `"set_aside"`: 常に手元に置く（固定、選択不要）。
   * - `"hand_or_set_aside_choice"`: 「手札に加えるまたは手元に置く」(BSTH08.5-C23)。
   *   swap 型と異なり交換相手不要のため、別 pending を起こさず
   *   `ApplyLegalActionOptions.deckRevealPickFreeDestination` を同一アクションの
   *   追加入力として要求する。dsl-types.ts の同名フィールドと対。
   * - `"trash"`: 選択カードを直接トラッシュへ置く (BSKB01-M01)。他 pick と独立に
   *   1 枚だけを選んでトラッシュへ送れる。dsl-types.ts の同名フィールドと対。
   */
  destination?:
    | "hand"
    | "field"
    | "hand_swap"
    | "hand_or_set_aside_swap"
    | "mirage_set"
    | "set_aside"
    | "hand_or_set_aside_choice"
    | "trash";
  /**
   * 排他選択グループ ID。同じ id の pick group 同士は XOR 関係になる:
   * いずれか 1 グループを満たす選択をすると、同グループの他メンバーは
   * 自動的にスキップされる（「AすべてかB1枚を手札に加える」BSTH08.5-X03 型）。
   * 正源: `getDeckRevealExclusiveGroupBranches`
   * (`legal/deck-reveal-pick-candidates.ts`)。dsl-types.ts の同名フィールドと対。
   */
  exclusiveGroup?: string;
  /**
   * このブランチの選択に要求される追加コスト（リザーブから自動支払い）。
   * dsl-types.ts の同名フィールドと対。正源: `getDeckRevealExclusiveGroupBranches`。
   */
  costGate?: number;
}

/**
 * 魂状態にする: 対象カードを魂状態化し、上のコアをリザーブに移動。
 * 契約カードが相手の効果でフィールドを離れるとき、代わりに魂状態にできる。
 */
export interface EnterSoulStateAction {
  kind: "enter_soul_state";
  target: EffectTarget;
}

/**
 * 効果でこのカードを配置する。魂状態起点の【復活】は
 * `applicability.soulState` + `place(self)` で表す。
 */
export interface PlaceAction {
  kind: "place";
  target: "self";
}

/** カウント+N（ボイドからカウントエリアへ概念的に移動） */
export interface CountIncreaseAction {
  kind: "count_increase";
  player: EffectPlayerRef;
  amount: number;
  /**
   * 「追加したカウントは系統：「X」を持たない効果で数えられず、その効果を受けない」
   * (BSGE01 神喰 等)。設定時、増加分は PlayerState.protectedCounts[X] に記録され、
   * X 系統を持たない効果からはカウントとして数えられず・減らされない。
   */
  protectedFromNonTribe?: string;
}

/**
 * カウント＋ メタ修飾 (BSTS01-C03 ［行政担当］リグルド)。
 * 「自分の『カウント＋』効果で増やすカウントを＋N する」。
 * 継続効果として登録され、executeCountIncrease が、そのターン最初に解決する
 * 受益プレイヤーの count_increase 1 件のみへ +amount を自動加算する
 * (10_rules/08a §カウント＋ メタ修飾。終止形＝強制 / 〔ターンに1回:同名〕は
 *  first-opportunity 消費 / 範囲＝受益プレイヤーの count_increase 全般)。
 */
export interface CountGainModifierAction {
  kind: "count_gain_modifier";
  /** 修飾の受益プレイヤー (「自分の」= self)。 */
  player: EffectPlayerRef;
  /** カウント＋ に上乗せする量。 */
  amount: number;
  /** 継続期間 (通常 while_on_field)。 */
  duration: EffectDuration;
}

/**
 * コア除去効果で移動するコア数 +N メタ修飾 (BSTH001-転醒R02(A) effect[1] 他)。
 * 「自分のスピリットの『コア除去効果』で移動するコアの数を+N する」。
 * 継続効果として登録され、executeCoreMove が対象コアシュート (相手カード源かつ
 * source が自分のスピリット) の amount に +bonus を加算する。
 * 終止形 = 強制 / 期間中ずっと +N (first-opportunity 消費なし)。
 */
export interface CoreMoveAmountModifierAction {
  kind: "core_move_amount_modifier";
  /**
   * 修飾のスコープ。
   * - self_player = 自分のコア除去効果すべて。発揮元のカテゴリ・ゾーンを問わない。
   * - self_player_spirits = 自分のスピリットがソース (BSTH001-転醒R02(A))。
   * - self_card = 修飾源と同じ合体スピリットのコア除去効果すべて (BSSA01-転醒X01(B))。
   * - self_card_opponent_life_reduction = 修飾源と同じ合体スピリットが source となって
   *   相手のライフのコアを移動させる(=相手のライフを減らす)ときのみ +N (BSSA01-転醒X01(B))。
   */
  scope:
    | "self_player"
    | "self_player_spirits"
    | "self_card"
    | "self_card_opponent_life_reduction";
  /** 移動コア数に上乗せする量。 */
  amount: number;
  /** 継続期間 (通常 while_on_field)。 */
  duration: EffectDuration;
}

/** カウント-N */
export interface CountDecreaseAction {
  kind: "count_decrease";
  player: EffectPlayerRef;
  amount: number;
}

/** カウントを指定値にセット */
export interface CountSetAction {
  kind: "count_set";
  player: EffectPlayerRef;
  value: number;
}

/** このターンの間、対象はアタックできない */
export interface PreventAttackAction {
  kind: "prevent_attack";
  target: EffectTarget;
  duration: EffectDuration;
}

/** 次のバトル終了後まで、相手によってライフは減らない */
export interface PreventLifeDamageAction {
  kind: "prevent_life_damage";
  player: EffectPlayerRef;
  duration: EffectDuration;
}

/** 消滅: 破壊と異なりコアはリザーブに置かれる */
export interface VanishAction {
  kind: "vanish";
  target: EffectTarget;
  /**
   * 「その効果を発揮させない」（消滅対象の離脱誘発効果を抑止）。destroy と同じ
   * Q19 裁定（P3-74）の機構を消滅に適用する。"destroyed_only" = 消滅した対象の
   * 効果のみ抑止 / "all_opponent" = 相手の効果すべて抑止。指定時は
   * cannot_leave_field 耐性を貫通する（cannot_be_vanished は貫通しない）。
   */
  suppressDestroyedEffects?: "destroyed_only" | "all_opponent";
  /**
   * 「この効果でブレイヴはフィールドに残せない」。消滅対象が合体スピリットのとき、
   * ブレイヴ残存（10_rules/05 の選択肢1）を禁じ、ブレイヴもホストと同時に同じ場所へ
   * 移動させる（選択肢2を強制）。
   */
  braveCannotRemain?: boolean;
}

/** 召喚/配置/使用を無効にする（スタック効果） */
export interface NegateAction {
  kind: "negate";
  /** 解決中の原因効果に結び付いた誘発反応だけを対象とする。 */
  causedByThisEffect?: boolean;
  /** 無効にする対象行動。"opponent_burst" = 相手のバースト効果を無効にする (P3-77 Step C)。 */
  negateTarget: "summon" | "place" | "use_magic" | "effect" | "opponent_burst";
  targetFilter?: import("./dsl-types").CardFilter;
  /** negateTarget === "effect" 用: 対象 pending stack のコントローラ制約。 */
  targetController?: "opponent";
  /** 無効にする対象効果の timing。例: 「フラッシュ効果の使用」なら "flash"。 */
  targetEffectTiming?: "main" | "flash" | "stack";
  /** negateTarget === "effect" 用: 無効にする効果種別を絞り込む。 */
  targetEffectFilter?: import("./dsl-types").EffectTargetFilter;
  /**
   * negateTarget === "effect" 用: 無効化した発生源の同一効果を継続的に
   * effect_suppression する。未指定時は直下 pending stack の単発 nullify のみ。
   */
  suppressMatchedEffect?: boolean;
  /**
   * negateTarget === "opponent_burst" 専用。"nullify"(既定)=無効にする /
   * "cannot_activate"=発揮できない。CE の metadata.burstSuppressKind に伝搬する。
   */
  burstSuppressKind?: "nullify" | "cannot_activate";
  /**
   * 登録する CE の duration。省略時は `{ scope: "turn" }`（「このターンの間」既定）。
   * 継続効果（`timing: "continuous"` の常駐無効化）として登録する場合は
   * `{ scope: "while_on_field" }` を指定し、condition / timingScope による発動可否は
   * effect.condition（recompute add/remove）と effect.timingScope（消費時 isCEActiveForScope）
   * に委ねる（BSTH09.2-転醒R03(B)「自分のアタックステップ・カウント2以上で相手バースト無効」）。
   */
  duration?: Duration;
}

/** 場入りコアの供給元に残さなければならない合計コア数（通常/ソウル共通）。 */
export interface FieldCoreSourceMinimum {
  categories: readonly CardCategory[];
  minimum: number;
}

/**
 * 統一召喚アクション。
 * - target "self": 効果発動カード自身を召喚（旧 summon_self / summon_self_from_hand）
 * - target "other": 別カードを召喚（旧 summon_from_zone）
 */
export interface SummonAction {
  kind: "summon";
  /** "self" = 自身を召喚, "other" = 別カードを召喚 */
  target: "self" | "other";
  /** 召喚元ゾーン制約（target:"self" で省略時は任意ゾーン、target:"other" では必須） */
  zone?:
    | "hand"
    | "set_aside"
    | "trash"
    | "hand_or_set_aside"
    | "hand_or_trash"
    | "hand_or_set_aside_or_trash";
  /** 召喚対象のフィルタ（target:"other" 用） */
  filter?: import("./dsl-types").CardFilter;
  /** 召喚枚数（target:"other" 用、デフォルト1） */
  count?: number;
  /** コスト上書き（印刷コストを上書きし軽減が走る）。「コストをXにして」用 */
  overrideCost?: number;
  /** コストを支払わずに召喚 */
  withoutCost?: boolean;
  /** 軽減をすべて満たしたものとして召喚 */
  fullReduction?: boolean;
  /** 支払い総額を固定（軽減なし）。「Xコスト支払って」用 */
  fixedPayment?: number;
  /**
   * リザーブ以外のコスト支払い元を CardFilter に一致するフィールド上カードへ限定する。
   * リザーブ支払いとフィルタ済みフィールド支払いは排他枝として扱い、混合しない。
   */
  onBoardCoreSourceFilter?: import("./dsl-types").CardFilter;
  fieldCoreSourceMinimum?: FieldCoreSourceMinimum;
  /**
   * 「召喚するスピリットのコアは、トラッシュからも N 個まで置ける」(BSTH04-転醒R02(B))。
   * フィールド進入時コア配置 (維持コア) のうち最大 N 個をコントローラーのトラッシュから補える
   * (reserve 不足分を trash で充当)。配置総数は変えず源を一部 trash に振り替える。0/省略時は reserve のみ。
   */
  trashCoreMax?: number;
  /**
   * `trashCoreMax` で許可するトラッシュ由来コアの種類。
   * "normal" / 省略は「《ソウルコア》以外」、"generic" は通常/ソウルを含む。
   */
  trashCoreKind?: "normal" | "generic";
  /**
   * 対象別コストオーバーライド (instanceId → 上書き後コスト)。target:"other" の複数召喚で
   * カードごとに異なるコストを適用する場合専用 (PendingGroupedSummonCostOverrideChoice 解決後の
   * 再実行で使う。BSTH02.7-C06 branch2)。指定 instanceId は overrideCost/fixedPayment/def.cost
   * より優先。
   */
  perCardOverrideCost?: Readonly<Record<string, number>>;
  /**
   * 「手札/トラッシュ/煌臨元にある〜を召喚できる」の煌臨元 (advent_source) 分。
   * true のとき、`zone` 探索候補に加えて、召喚実行者が host となっている煌臨元アンダーカード
   * (`collectUnderCardScopeIds(state).adventSource`、host 側 `underCards` role:"advent_source")
   * のうち自分所有分も召喚候補に含める (BSSL01-X01[5,6])。煌臨元は runtime Zone 上 "field" の
   * ままホストの下に重なるため `zone` の通常ゾーン列挙では拾えず (ApplicabilityZone の
   * "advent_source" と同じ理由)、独立した orthogonal フラグとして表現する。召喚後は
   * `stripAdventSourceUnderCardReference` でホスト側の参照を剥がす
   * (`executeSummonSelf` と同じ「独立した場のカードへ戻す」処理)。
   */
  includeAdventSource?: boolean;
  /**
   * `summon.target.from_zone.includeSoulState` 由来。魂状態カードは runtime Zone 上 "field" のまま
   * `soulStateInstanceIds` に登録されるため、通常 `zone` 探索とは独立した候補 union として扱う。
   */
  includeSoulState?: boolean;
  /**
   * `summon.target.from_zone.restrictToTriggerLeaveAdventSource` 由来 (BSSG01-C08 Lv2)。
   * 指定時、`zone`/`filter` で一致した候補をこの instanceId 集合との交差にさらに絞り込む
   * (`includeAdventSource`/`includeSoulState` が候補を追加するのに対し、こちらは候補を
   * 制限する軸)。「相手の効果で離れたそのスピリット/アルティメットの煌臨元」のように、
   * 同ゾーンの他カードを混ぜず特定チェーンだけに限定したい場合に使う。
   * SSOT: pending leave pre-flush で捕捉した `StepExecutionContext.triggerAdventSourceInstanceIds`。
   */
  restrictToInstanceIds?: readonly string[];
  /**
   * 「配置した〜の『配置したとき』の【導託】は発揮されない」型の抑止 (BSAZ02-C17)。
   * true のとき、この summon で場に入ったカードの `CardInstance.oraclePlacementSuppressed`
   * を true にし、その配置に伴う配置時神託/導託 (`checkAndQueuePlacementOracle`) を
   * 不発にする。他の召喚（このカード自身の通常配置等）には影響しない単発フラグ。
   */
  suppressPlacementOracle?: boolean;
  /**
   * この summon action 単発限定の召喚条件バイパス (BSAZ02-X01[3])。SSOT:
   * `dsl-types.ts SummonAction.ignoreSummonCondition`。true のとき `executeSummonSelf` が
   * この呼び出しに限り `canSummonUltimate` の summonCondition チェックをバイパスする
   * （`allow_ignore_summon_condition` CE のような永続許可ではなく、他の召喚経路
   * （通常メインフェイズ召喚の legal action 列挙等）には一切影響しない）。
   */
  ignoreSummonCondition?: boolean;
  /**
   * この summon を発生させた効果の分類。`"burst"` = バースト効果解決中
   * (`EffectResolutionActionKind === "burst_activation"`) の召喚、`"effect"` = それ以外の
   * カード効果 (常時/誘発/起動等) による召喚。通常召喚 (手札からの legal action、
   * `playHandCardWithPlacement` 経由) はこの action 自体を経由しないため常に undefined。
   * `CardFilter.summonCause`（BSTH02-C02「相手がバースト効果以外の効果でスピリットカードを
   * 召喚するとき、3コスト余分に支払わなければ召喚できない」）の判定元。native-action-registry.ts
   * の "summon" handler が `ctx.effectMeta.effectActionKind` から自動導出する。
   */
  summonCause?: "effect" | "burst";
  /**
   * SSOT: `dsl-types.ts DSL.SummonAction.target.self.carryOverExistingCores`。
   * true のとき `executeSummonSelf` は召喚実行前に対象カードへ既に乗っているコア
   * (`normalCoreCount`) を維持したままフィールドへ移動し、フィールド進入時の維持コア自動配置は
   * 「levelDefs[0].requiredCores − 既存コア数」の残数のみを要求する。省略時 (既定) は従来どおり
   * 0リセット + 満額配置（既存 target:"self" 消費者は全てオフフィールド中にコアが乗らないため
   * 挙動不変）。
   */
  carryOverExistingCores?: boolean;
  /**
   * SSOT: `dsl-types.ts DSL.SummonAction.suppressThirdPartySummonObservation`
   * (BSTH11-X02【現界】)。true のとき `collectTriggerEventsFromStateDelta` がこの場入りの
   * eventKind:"summon" を game_event (第三者観測) リスナーへ配送しない。card_event
   * (このカード自身) は relatedInstanceId===self でのみ反応するため影響を受けない。
   */
  suppressThirdPartySummonObservation?: boolean;
  /**
   * Internal enter-field classification for summon-action-shaped effects that are not
   * actually summon in the card text. Omitted = normal summon/placement by category.
   */
  enterFieldEventKind?: "summon" | "place" | "put";
  /**
   * Additional scope attached to the emitted enter-field event.
   * `enterFieldEventKind:"put" + effectScope:"genkai"` represents 【現界】.
   */
  effectScope?: EffectEventScope;
}

/** 相手の効果を受けない（CE: defense_immune 登録） */
export interface EffectImmunityAction {
  kind: "effect_immunity";
  target: EffectTarget;
  duration: EffectDuration;
}

/**
 * コスト変更系効果（CE: cost_override 登録）。
 * `filter` は消費側 `matchesCostCEFilterClause`（card-filter.ts）が実際に解釈する
 * フィールドだけを許可する `CostCEFilterFields`（dsl-types.ts、guard-audit-card-filter-projection
 * 2026-08-05 subset-type-unification、敵対的検証 Lens 2 で CardFilter 全体許可の
 * silent no-op trap を反証）。旧実装は独自の 7 フィールドサブセット型 + 呼び出し側
 * allowlist コピーの二重管理で、requiredKeywordTags 等の新フィールドが黙って脱落していた。
 */
export interface CostOverrideAction {
  kind: "cost_override";
  player: EffectPlayerRef;
  filter?: import("./dsl-types").CostCEFilterFields;
  costOverride: number;
  duration: EffectDuration;
}

/** 「コストはXとしても扱う」: 元のコスト値を維持しつつ追加コスト値を持つ */
export interface AdditionalCostAction {
  kind: "additional_cost";
  additionalCost: number;
  additionalCostDynamic?: import("./dsl-types").DynamicCount;
}

/** 手札/手元間のカード移動 */
export interface MoveToSetAsideAction {
  kind: "move_to_set_aside";
  count: number;
  /** 手元へ移す対象の絞り込み。`SearchDeckAction.filter` と同じ理由で `CardFilter` を使う。 */
  filter?: import("./dsl-types").CardFilter;
}

/** ブロックされない（CE: unblockable 登録） */
export interface UnblockableAction {
  kind: "unblockable";
  target: EffectTarget;
  duration: EffectDuration;
}

/** 「ブロックされない」相手をブロックできる（CE: block_unblockable 登録） */
export interface BlockUnblockableAction {
  kind: "block_unblockable";
  target: EffectTarget;
  duration: EffectDuration;
}

/** アタックステップを終了する */
export interface EndAttackStepAction {
  kind: "end_attack_step";
  /**
   * 「この効果は、相手の『アタックステップを終了できない』効果を受けない」(R12 ルナクロック)。
   * true のとき、`restrict_end_attack_step` 継続効果による妨害を受けず終了を実行する。
   * 攻撃側が全防御を貫通する `preventionLevel:"unpreventable"` とは別概念で、
   * 「この終了する効果が当該妨害効果を受けない (= 効果耐性/防御)」を表す。
   */
  unaffectedByRestriction?: boolean;
}

/** ターンを終了する。エンドステップ自体は行わない。 */
export interface EndTurnAction {
  kind: "end_turn";
  /** true のとき、`restrict_end_turn` 継続効果による妨害を受けず終了を実行する。 */
  unaffectedByRestriction?: boolean;
}

/** 現在のバトルだけを終了する（アタックステップ自体は継続）。 */
export interface EndBattleAction {
  kind: "end_battle";
  /** true のとき、`restrict_end_battle` 継続効果による妨害を受けず終了を実行する。 */
  unaffectedByRestriction?: boolean;
}

/** 現在のバトルだけをただちに終了する（BP比較/ライフダメージ無し）。 */
export interface EndSingleBattleAction {
  kind: "end_single_battle";
  /** true のとき、`restrict_end_battle` 継続効果による妨害を受けず終了を実行する。 */
  unaffectedByRestriction?: boolean;
}

export interface RestrictEndActionBase {
  /** 制限対象のプレイヤー (通常 "opponent")。 */
  player: EffectPlayerRef;
  /** 制限の持続時間。 */
  duration: EffectDuration;
  /**
   * 登録時に条件を満たすなら、この終了制限 CE は「相手の効果では防げない」。
   * `count_increase` 後に判定する必要がある同一 effect 内の後段向けに action 側へ置く。
   */
  unpreventableIf?: ConditionClause[];
}

/**
 * 「相手は効果でアタックステップを終了できない」継続効果を登録する。
 * `restrict_flash` と同型: 制限対象プレイヤー (`player`) を CE の targetInstanceId に格納し、
 * 効果由来の `end_attack_step` (executeEndAttackStep) のみを妨害する
 * (通常のステップ進行 advanceStep は対象外 = テキスト「効果で」に合致)。
 */
export interface RestrictEndAttackStepAction extends RestrictEndActionBase {
  kind: "restrict_end_attack_step";
}

/** 「相手は効果でバトルを終了できない」継続効果を登録する。 */
export interface RestrictEndBattleAction extends RestrictEndActionBase {
  kind: "restrict_end_battle";
}

/** 「相手は効果でステップを終了できない」継続効果を登録する。 */
export interface RestrictEndStepAction extends RestrictEndActionBase {
  kind: "restrict_end_step";
}

/** 「相手は効果でターンを終了できない」継続効果を登録する。 */
export interface RestrictEndTurnAction extends RestrictEndActionBase {
  kind: "restrict_end_turn";
}

/**
 * アタック宣言の代替宣言データ。CardDefinition に付与する（AdventData/ManifestData 同型）。
 * 「アタックするかわりに裏返せる」型は、転醒(RebirthAction.maxCount)のようなカウント上限
 * トリガーを持たず、通常のアタック宣言が可能などのタイミングであれば常に任意選択できる。
 * 実行は executeRebirth を再利用せず、専用の面反転処理 (flipCardFaceWithoutRebirthCountBonus,
 * structured-card-replacement.ts) を使う。理由: executeRebirth は転醒後カードの B 面共通印字
 * テキスト由来の自動カウント+1 (08a_advent-rebirth-contract.md 「射程注記」参照) を無条件に
 * 含むが、本カードの B 面 textLines にはその定型文が存在せず (needs-ruling.jsonl:
 * BSDB01-TX01(A) 参照)、カード本文が明記する count_increase amount:3 のみを適用する。
 */
export interface AttackAlternativeFlipData {
  /** 裏返した際のカウント増加量（カード本文が明記する付随効果。カウント+1の自動付与はしない） */
  countIncreaseAmount: number;
}

export type RebirthCountBonusMode = "increment_1" | "reset_to_zero" | "none";

export type RebirthPostChoice =
  | {
      /**
       * 「このとき、この転醒後ブレイヴを自分のスピリットに合体できる」。
       * optional=true なら合体しない選択も合法。
       */
      kind: "brave_combine";
      optional?: boolean;
    }
  | {
      /**
       * 「合体するか、コアN個を置いてスピリット状態にする」。
       * コア配置は exact amount で、置けない場合そのルートは提示しない。
       */
      kind: "brave_combine_or_core";
      coreCount: number;
      sourceScope?: "field_and_reserve" | "reserve_only";
    }
  | {
      /**
       * 「このとき、この転醒後スピリットにコアを好きなだけ置ける」。
       * `minimum: "back_face_lv"` は、転醒後 B 面が Lv1 以上になるために不足する数を
       * pending の最低配置数として計算する。
       */
      kind: "core_distribute";
      sourceScope?: "field_and_reserve" | "reserve_only";
      minimum?: number | "back_face_lv";
    };

/**
 * 転醒: カードを裏返す。
 * 原文「【転醒：自分のカウントN以下（転醒は同時に使えない）】〜したとき、このカードを裏返せる。」
 */
export interface RebirthAction {
  kind: "rebirth";
  /** 転醒条件: 自分のカウントがこの値以下 */
  maxCount: number;
  /** 転醒トリガー（テキストの発動条件を説明的に記載） */
  triggerDescription: string;
  /** 転醒後のコア処理: 残すコア数（省略時は全コア維持） */
  retainCores?: number;
  /**
   * 残さないコアの行き先（省略時 "reserve"）。
   * 創界石の転醒は「置かれているコアすべて（/1個を残して）をボイドに置く」なので "void"。
   */
  returnedCoresDest?: "reserve" | "void";
  /**
   * 合体相手を転醒後カードの煌臨元として畳む（08a §2 「煌臨元カードとして追加することで…裏返せる」）。
   * BSSA01-転醒X02(A)（ブレイヴが host を煌臨元に畳んで分離・裏返す）/
   * BSSA01-転醒X03(A)（host が合体ブレイヴを煌臨元に畳んで裏返す）型。
   * true のとき executeRebirth は sourceInstanceId の合体相手（attachedToInstanceId か
   * attachedChildrenIds の brave）を attachAsAdventSource で sourceInstanceId（転醒後カード）の
   * 煌臨元へ移し、合体リンクを解除する（SSOT: advent-system.attachAsAdventSource）。
   */
  foldCombinedPartnerToAdventSource?: boolean;
  /**
   * 外部転醒: 指定 target の対象 instance を flip する。省略時は sourceInstanceId 自身を flip。
   * BSSA01-XX01 神技4「夜錆の転醒前1つの【転醒】を発揮する」型。
   * 解決経路: effect-interpreter case "rebirth" が target を resolveTargets で展開し、
   * front-face (instance.definitionId === originalDefinitionId) のみに絞って 1 instance ごとに
   * executeRebirth を呼ぶ（sourceInstanceId は対象 instance）。
   */
  target?: EffectTarget;
  /**
   * 外部転醒で「転醒条件を満たしたものとして発揮」の意味。true で maxCount チェックを skip。
   * BSSA01-XX01 神技4 のみが現状の使用元。
   */
  forceTriggerCondition?: boolean;
  /** 内部用: 「合体していたものとして発揮」の合体相手。コア選択をまたいでも保持する。 */
  asIfCombinedWithInstanceId?: string;
  /**
   * 「ブレイヴを分離し裏返せる」型。通常の分離と同様、フィールド/リザーブから
   * Lv1以上になる任意数のコアをHUDで配置する。確定まで転醒を保留する。
   */
  separatesFromHost?: boolean;
  /**
   * Q1282/Q1296 型: 「ソウルコアを置いて裏返せる」は可能な限り置き、置けない/置いても
   * B 面最低 Lv に届かない場合でも一度裏返して count+1 した後、その転醒後カードを消滅待機にする。
   * 通常の転醒 lv-deficit は flip 前中断のままなので、該当カードのみ opt-in する。
   */
  vanishAfterFlipOnLvDeficit?: boolean;
  /**
   * 「このとき、この転醒後スピリットにコアを置ける」本文で、B面最低Lv不足を
   * 直後の core_distribute step で補える型。true のとき executeRebirth は
   * Lv不足だけでは中断せず、後続 core_distribute の rollbackIfBelowMinTotal に判定を委ねる。
   */
  allowPostRebirthCorePlacementForLvDeficit?: boolean;
  /**
   * 「〜裏返せる。このとき〜」のうち、転醒に内蔵された後続選択。
   * 実カードの面反転・count・転醒時誘発は、この選択が確定するまで仮想転醒として保留する。
   */
  postRebirthChoice?: RebirthPostChoice;
  /** 内部用: postRebirthChoice pending 解決時の実コミットでは Lv 不足を選択完了まで保留する。 */
  skipBackFaceLvDeficitForPostChoice?: boolean;
  /** 内部用: postRebirthChoice pending 解決時、count/転醒時誘発の完了を caller 側で行う。 */
  deferRebirthCompletionUntilPostChoice?: boolean;
  /**
   * B面の定型テキストが定義する count 処理。省略時は通常の転醒定型文
   * 「この面に裏返ったとき...カウント+1する」として扱う。
   * B面に count 文言が無い独自 flip は "none" を明示する。
   */
  countBonusMode?: RebirthCountBonusMode;
}

/**
 * 逆転醒: B面→A面。executeRebirth（A→B flip）の逆方向。10_rules/08a §逆転醒、issues/P3-98。
 * 語尾で 2 分類（裁定 2026-06-12）。いずれも countValue は変動しない（裁定 2026-06-14）。
 * - mode:"flip"（パターン1: 「表にする/裏返す/表返す」）: 面反転のみ。コスト/維持コア/instance 変更なし。
 *   状態（コア・疲労/回復・期間効果・instanceId）完全引継。表面 def は instance.originalDefinitionId から逆引き。
 * - mode:"summon"（パターン2: 「裏返して配置/召喚する」）: 通常 summon/配置パイプライン経由。
 *   withoutCost（「コストを支払わず」明示時のみ）でコスト支払いのみ bypass。P3-98 §3 の
 *   pending カスケードで支払い・維持コア配置を確定し、`resolve_reverse_rebirth_summon` 後に
 *   置換後 A 面 instance から同一 effect の後続 step を再開する。
 */
export interface ReverseRebirthAction {
  kind: "reverse_rebirth";
  mode: "flip" | "summon";
  /** mode:"summon" のとき、「コストを支払わず」明示時のみ true。 */
  withoutCost?: boolean;
}

/**
 * 効果ステップ内からの直接合体（ENGINE-bsft01-tr-rebirth-brave-combine-branch）。
 * 「このカードを自分のスピリットに合体させることができる」型。main フェーズ限定・コスト無しの
 * player action `brave_combine`（legal-actions-apply.ts）とは別経路で、効果解決の途中
 * （フラッシュ/スタック/転醒許可窓等）から同じ合体処理（コア移動+attach+疲労合流）を発揮する。
 * 合体先候補は target（自分のスピリット/アルティメット）を、発動元カード自身の braveCondition
 * （CardDefinition.braveCondition）+ maxCombinedBraves 上限 + cannot_combine 制約で絞り込む
 * （isEligibleBraveCombineHost, legal-actions-shared.ts が SSOT。目的の braveCondition は
 * 発動元カード自身の定義から自動導出するため、card-data 側で再宣言しない）。
 * 実処理は executeBraveCombine（mechanics/brave-combine.ts）を legal-actions-apply.ts の
 * player action ハンドラと共有する。
 */
export interface BraveCombineEffectAction {
  kind: "brave_combine_effect";
  /** 合体先候補（自分のスピリット/アルティメット）。braveCombineHostOnly 絞り込みは解決時に自動適用。 */
  target: EffectTarget;
  /** field 外からの直接合体を召喚として扱う（「直接合体するように召喚」型）。 */
  asSummon?: boolean;
}

/**
 * 「シンボル/軽減シンボルは○としても扱う」「色とシンボルは○としても扱う」
 * symbol_add（追加）とは異なり、既存のシンボル/軽減/色を別の色としても扱う。
 *
 * aspect によって asColor の許容型が異なる:
 * - symbol / reduction_symbol / symbol_and_reduction → SymbolColor（特殊シンボル含む）
 * - color / color_and_symbol → CardColor のみ（カード色に特殊シンボルは来ない）
 *
 * 多色: `asColor` は単色 (`SymbolColor`) または複数色 (`SymbolColor[]`) を取る。
 * 「シンボル/軽減を 赤/紫/緑/白/黄/青 として扱う」のように 1 シンボルが複数色
 * すべてとして扱われる場合は配列で渡す。単色の挙動は従来どおり。
 */
export type TreatAsAction = TreatAsActionBase &
  (TreatAsSymbolAspect | TreatAsColorAspect);

interface TreatAsActionBase {
  kind: "treat_as";
  /** カード状態を問わず適用（「このカード/<実体種類>の〜」＝手札でも有効） */
  appliesToCard?: boolean;
  /** カード状態にだけ適用し、場の実体状態（スピリット/アルティメット/ブレイヴ/ネクサス等）へ CE 登録しない。 */
  cardStateOnly?: boolean;
}

interface TreatAsSymbolAspect {
  aspect: "symbol" | "reduction_symbol" | "symbol_and_reduction";
  asColor: SymbolColor | SymbolColor[];
  /** `reduction_symbol` 限定: 印字軽減シンボルのうち指定色の枠だけへ加色する。 */
  reductionSymbolBaseColors?: SymbolColor[];
}

interface TreatAsColorAspect {
  aspect: "color" | "color_and_symbol";
  asColor: CardColor | CardColor[];
}

/**
 * `TreatAsAction.asColor` (単色 or 多色) を必ず配列に正規化する。
 * 単色 → `[c]`、配列 → そのまま。treat_as の全 consumer はこの helper を通して
 * 「列挙された全色を適用する」(SSOT)。
 */
export function normalizeAsColors<T extends SymbolColor>(
  asColor: T | readonly T[]
): T[] {
  return Array.isArray(asColor) ? [...asColor] : [asColor as T];
}

/**
 * ゲームから除外する（「除外する」）。消滅 (vanish) とは異なる。
 * 除外されたカードは removed_from_game ゾーンに置かれる。
 */
export interface RemoveFromGameAction {
  kind: "remove_from_game";
  target: EffectTarget;
  /**
   * 「この効果で離れた対象はフィールドに残せない」（BSLH01-T10 等）。
   * 指定時、相手の `cannot_leave_field` 常時効果を貫通する（Q19 / P3-74 と同機構）。
   * `cannot_be_removed_from_game` 等の outcome-specific 耐性は貫通しない。
   */
  pierceCannotLeaveField?: boolean;
}

/**
 * 「相手の効果でフィールドを離れない」等、特定の効果耐性。
 * effect_immunity（相手の効果を受けない）よりスコープが限定的。
 *
 * 置換効果（resistType: "replace_field_exit"）は破壊・バウンス・消滅等の
 * 任意のフィールド離脱を捕捉して別アクションに置き換える（手札 / デッキ下）。
 * - replacementTrigger: どの離脱種別を捕捉するか
 * - replacementAction: 何に置き換えるか
 *
 * 「破壊されたとき疲労状態でフィールドに残る」のような *triggered* 系の
 * 残置効果は本アクションでは表現しない。`Timing.card_event` + `stay_on_field`
 * アクションを使うこと（pending leave 入った *後* に発火する triggered effect）。
 */
export interface EffectResistanceAction {
  targetLockSourceFilter?: import("./effect/target-affect-gate").EffectSourceFilter;
  kind: "effect_resistance";
  target: EffectTarget;
  /** 耐性の種類 */
  resistType:
    | "cannot_leave_field"
    | "cannot_be_destroyed"
    | "cannot_be_bounced"
    | "cannot_be_sent_to_deck"
    | "cannot_be_vanished"
    | "cannot_be_removed_from_game"
    | "cannot_be_exhausted"
    | "cannot_reduce_cores_below"
    | "cannot_be_targeted"
    | "cannot_include"
    | "cannot_be_destroyed_by_bp_compare"
    | "cannot_enter_zone"
    | "replace_field_exit";
  /**
   * 耐性の対象源（相手の効果 / 相手による離脱 / 全効果 / 自分の効果）。
   * "self" は `resistType: "replace_field_exit"` (置換効果) 専用
   * (ENGINE-set-aside-exit-replacement-choice)。
   */
  source: "opponent_effect" | "opponent" | "all" | "self";
  duration: EffectDuration;
  /** resistType === "cannot_reduce_cores_below" の最小残存コア数。 */
  coreMinimum?: number;
  /** resistType === "cannot_enter_zone" のとき、阻止する移動先ゾーン。必須。 */
  entryZone?: Zone;
  /**
   * resistType === "cannot_reduce_cores_below" の動的下限（`coreMinimum` の代わり）。
   * 判定対象カード自身の `levelDefs` から指定 `level` の `requiredCores` を都度参照する。
   * `dsl-types.ts` の同名フィールドと対（native-action-registry.ts で素通し）。
   */
  coreMinimumSource?: { kind: "own_level_required_cores"; level: number };
  /**
   * 特定の離脱原因では耐性を適用しない。
   * 例: 「バトル以外でフィールドを離れない」= cannot_leave_field +
   * excludedCauses:["battle"]。
   */
  excludedCauses?: ("effect" | "battle" | "bp_compare")[];
  /**
   * 置換効果のトリガー条件（resistType === "replace_field_exit" の場合のみ使用）。
   * - "leave_field": 任意の離脱原因（destroy/bounce/vanish）
   * - "destroy": 破壊のみ
   * - "bounce": 手札戻しのみ
   * - "vanish": 消滅のみ
   */
  replacementTrigger?: "leave_field" | "destroy" | "bounce" | "vanish";
  /**
   * 置換効果のアクション（resistType === "replace_field_exit" の場合のみ使用）。
   * - { kind: "move_to", zone: "hand" | "deck_bottom" }: 指定ゾーンへ移動
   * - { kind: "pay_cost", amount }: ゾーン移動せず、代わりに amount コスト支払う
   *   (BSTH08.5-X04「かわりに1コスト支払うことができる」)。
   * - { kind: "advent_source", target, orTrash }: 離脱カードを target スピリットの
   *   煌臨元に追加（orTrash:true なら「追加 / トラッシュ」をコントローラーが選択）。
   * - { kind: "soul_state" }: 離脱を魂状態化に置き換える（「相手によって離れたこの
   *   スピリットは魂状態にできる」BSGE01-R01..R05）。consumer は checkSoulStateReplacement
   *   （08a L158-159、上のコアは全てリザーブへ）。
   *
   * 疲労状態でフィールドに残す挙動は triggered effect として実装するため
   * ここからは削除されている（StayOnFieldAction を参照）。
   */
  replacementAction?:
    | { kind: "move_to"; zone: "hand" | "deck_bottom" }
    | { kind: "pay_cost"; amount: number }
    | {
        kind: "advent_source";
        target: import("./dsl-types").CardFilter;
        orTrash: boolean;
      }
    | { kind: "soul_state" };
  /**
   * ルール強度耐性。指定時は本耐性 CE を「ルール由来の不可」として扱い、
   * `sourcePreventionLevel: "unpreventable"` (「防げない」) の相手効果でも貫通させない。
   * 10_rules/07b §71 スピリット状態ブレイヴ class 用 (DSL 側 EffectResistanceAction.ruleStrength
   * と対)。consumer は CE metadata.ruleStrength を読む。
   */
  ruleStrength?: boolean;
}

/**
 * カードを「フィールドに留まらせる」アクション（triggered effect 用）。
 * `pendingLeaveEntities` から対象を取り除き、指定の疲労状態に設定して
 * フィールドに残置する。同じ simultaneousGroupId に属する destroy/leave_field
 * 系の pending triggered/burst も連動してキャンセルする。
 *
 * 「破壊されたとき疲労状態でフィールドに残る」等の *triggered* な残置を
 * 表現する。真の置換（破壊そのものを回避）は `EffectResistanceAction` を使う。
 */
export interface StayOnFieldAction {
  kind: "stay_on_field";
  target: EffectTarget;
  /**
   * 残置時の新しい疲労状態。省略時は現在の疲労状態を維持する
   * （「同じ状態で残す/残せる」）。
   */
  newExhaustState?: ExhaustState;
}

/**
 * 「アタック/ブロックできない」。prevent_attack の拡張版。
 */
export interface PreventBattleAction {
  kind: "prevent_battle";
  target: EffectTarget;
  /** アタック禁止/ブロック禁止/両方 */
  restriction: "attack" | "block" | "both";
  duration: EffectDuration;
  /**
   * ルール強度の戦闘不可。通常効果による prevent_battle と区別し、
   * 成立済み battle entity の state cleanup でのみ参照する。
   */
  ruleStrength?: boolean;
}

export interface PreventBraveSeparationAction {
  kind: "prevent_brave_separation";
  target: EffectTarget;
  duration: EffectDuration;
}

/**
 * 「(対象)は《ソウルコア》以外のコアを取り除けない」。
 *
 * 対象カードからの通常コア移動だけを禁止し、ソウルコアの移動は許可する。フィールド離脱時に
 * ルールで行うコア退避は `moveNormalCores` の明示的 bypass を通るため、この action の対象外。
 */
export interface PreventNormalCoreMoveAction {
  kind: "prevent_normal_core_move";
  target: EffectTarget;
  duration: EffectDuration;
}

/**
 * 「アタック/ブロックする(対象)から Nコスト支払わなければアタック/ブロックできない」。
 * prevent_battle の対概念で、全面禁止ではなく対象カード自身の通常コアからの支払いで
 * 宣言可能にする条件付きゲート（BSAZ01-C09）。動的 filter (player + category) のみ対応。
 */
export interface RequireBattleCostAction {
  kind: "require_battle_cost";
  target: EffectTarget;
  /** `TargetSpec.kind:"ref"` 等で先に指定した対象への固定ゲート。 */
  targetInstanceIds?: readonly string[];
  /** アタック/ブロック/両方のどちらにゲートを課すか */
  restriction: "attack" | "block" | "both";
  /** 対象カード自身の通常コアから支払う量 */
  costAmount: number;
  duration: EffectDuration;
  /** このアタックステップで最初のアタックだけに課すゲート。 */
  firstAttackOnly?: boolean;
}

export interface RequireAttackExhaustCostAction {
  kind: "require_attack_exhaust_cost";
  target: EffectTarget;
  /** 疲労コストにできる同 controller のカード種別。現行は category のみ対応。 */
  costTargetFilter: Pick<import("./dsl-types").CardFilter, "category">;
  duration: EffectDuration;
}

/**
 * 「アタック/ブロックする(対象)は、対象自身と同じ controller の別カード1体を
 * 破壊しなければアタック/ブロックできない」(BSDB01-C09)。require_attack_exhaust_cost
 * の破壊版。破壊コストは宣言時に costTargetFilter.category 合致カードから選んで
 * 支払う（対象カード自身は候補から除外）。restriction は require_battle_cost と
 * 同じく attack/block/both を選べる点が require_attack_exhaust_cost（アタック専用）
 * と異なる。
 */
export interface RequireBattleDestroyCostAction {
  kind: "require_battle_destroy_cost";
  destination?: "deck_bottom";
  target: EffectTarget;
  restriction: "attack" | "block" | "both";
  /** 破壊コストにできる同 controller のカード種別。現行は category のみ対応。 */
  costTargetFilter: Pick<import("./dsl-types").CardFilter, "category">;
  duration: EffectDuration;
}

/**
 * 「(player)は、Nコスト支払わなければ、(player)の効果でデッキ/トラッシュ/オープンした
 * カードから手札を増やせない」継続制約 (engine-opponent-hand-gain-paid-tax-gate,
 * BSRK01-C02[3,4])。DSL.RequireHandGainCostAction の v1 bridge。
 */
export interface RequireHandGainCostAction {
  kind: "require_hand_gain_cost";
  player: EffectPlayerRef;
  costAmount: number;
  duration: EffectDuration;
}

/**
 * 「(player)は、(player)の効果で手札を増やせない」完全禁止 (engine-restrict-hand-gain-
 * bsrk01-x01, BSRK01-X01 合体結誓)。DSL.HandGainPreventionAction の v1 bridge。
 */
export interface HandGainPreventionAction {
  kind: "hand_gain_prevention";
  player: EffectPlayerRef;
  duration: EffectDuration;
}

/**
 * ドローの枚数を修正する（「ドローの枚数を+Nする」）。
 * draw アクションとは異なり、通常ドローの枚数を変更する継続効果。
 */
export interface DrawModifyAction {
  kind: "draw_modify";
  amount: number;
  duration: EffectDuration;
  prepaidCost?: {
    kind: "discard_hand";
    cardFilter: import("./dsl-types").CardFilter;
    discardDisposition?: import("./dsl-types").DrawStepPrepaidDiscardDisposition;
  };
}

/**
 * ライフを指定値まで回復する（「ライフがNになるようにコアを置く」）。
 * life_damage / core_move とは異なり、目標値への差分計算。
 */
export interface LifeFillAction {
  kind: "life_fill";
  player: EffectPlayerRef;
  /** 目標ライフ値 */
  targetValue: number;
}

/**
 * 追加アタック（「相手のスピリット/ライフにアタックし、ただちにバトルを解決する」）。
 */
export interface AdditionalAttackAction {
  kind: "additional_attack";
}

/**
 * 転神/転者: 創界神/導界者ネクサスにスピリット二重状態を付与する。
 * ターン終了時に自動リセット。
 */
export interface DivineTransformAction {
  kind: "divine_transform";
  target: EffectTarget;
  /** スピリットとしての BP 定義 */
  bpByLevel: { level: number; bp: number }[];
  /** スピリットとしての色（省略時はカード本来の色） */
  colors?: CardColor[];
  /** スピリットとしてのシンボル（省略時はカード本来のシンボル） */
  symbols?: SymbolColor[];
  /** 創界神/導界者ネクサス以外では破壊されない（デフォルト: true） */
  protectedFromNonGrandwalker?: boolean;
}

/**
 * フラッシュ効果の使用を制限する（「相手は手札のフラッシュ効果を使用できない」等）。
 * アタック時の条件付き効果として使用され、バトル中の特定プレイヤーの
 * フラッシュ効果使用を禁止する。
 */
export interface RestrictFlashAction {
  kind: "restrict_flash";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /**
   * 制限対象の発動元ゾーン。
   * - "any": 全ゾーン
   * - 単一 Zone: そのゾーンのみ（例: "hand" / "field"）
   * - Zone[]: 配列で指定したゾーン群のみ
   * 旧 V1 互換: "hand" / "field" / "any" の 3 値はそのまま受け付ける。
   */
  source: Zone | Zone[] | "any";
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * スタック効果の使用を制限する（「相手はスタック効果を発揮できない」等）。
 * restrict_flash と同型。スタック応答窓でのスタック効果発揮を禁止する (P3-75)。
 */
export interface RestrictStackAction {
  kind: "restrict_stack";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
  /**
   * 省略時は player target。effect_source は発揮元カード/効果側を対象にし、
   * そのカードの効果耐性で回避できる。
   */
  targetScope?: "player" | "effect_source";
  /** effect_source scope 用の効果種別フィルタ。 */
  effectFilter?: import("./dsl-types").EffectTargetFilter;
  /** effect_source scope 用の発揮元カード条件。 */
  sourceCardFilter?: import("./dsl-types").CardFilter;
}

/**
 * バースト発動宣言を制限する（「相手はバーストを発動できない」等）。
 * negate_opponent_burst は発動後のバースト効果抑制であり、本 action は
 * pending burst check の resolve legal action 生成そのものを抑止する。
 */
export interface RestrictBurstActivationAction {
  kind: "restrict_burst_activation";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
  /** 対価。指定時のみ「対価未払い時に禁止」判定になる (BSTH02-M02)。
   * dsl-types.ts の DSL.RestrictBurstActivationAction.cost と同一シェイプ。 */
  cost?: { resource: "life_core"; amount: number };
}

/**
 * 煌臨宣言を制限する（「相手は【煌臨】できない」等。ENGINE-restrict-advent、BSFT01-X01）。
 * restrict_stack と同型。プレイヤー単位で declare_advent legal action の生成自体を抑止する。
 */
export interface RestrictAdventAction {
  kind: "restrict_advent";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「相手の[filter]カードは回復できない」(ENGINE-persistent-recovery-block-with-advent-host-exclusion、
 * BSTH11-X01【神域】)。restrict_advent と同型。filter 省略時は対象プレイヤーの全カード。
 * 回復処理・状態指定処理で、禁止する操作と到達先を区別する。
 */
export interface RestrictRecoveryAction {
  kind: "restrict_recovery";
  /** 省略時は「回復できない」。become_recovered は「回復状態にできない」。 */
  restriction?: "recover" | "become_recovered";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /** 対象を絞るフィルタ。省略時は対象プレイヤーの全カード。 */
  filter?: import("./dsl-types").CardFilter;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「相手はリザーブからコストが支払えない」(ENGINE-restrict-reserve-cost-payment、
 * BSSL01-R03)。restrict_advent と同型。コスト支払いソースからリザーブを除外する
 * (フィールドのカード上のコアは引き続き使える。10_rules/03a 支払いソース)。
 */
export interface RestrictReserveCostPaymentAction {
  kind: "restrict_reserve_cost_payment";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「相手のマジックのスタック効果コストは、フィールドから支払えない」
 * (ENGINE-restrict-field-cost-payment、BSTH08-C06)。restrict_reserve_cost_payment と
 * 対称。コスト支払いソースからフィールドのカード上のコアを除外する
 * (リザーブは引き続き使える)。effectModes 省略時は全コスト種別を制限する。
 */
export interface RestrictFieldCostPaymentAction {
  kind: "restrict_field_cost_payment";
  /** 制限対象のプレイヤー */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
  /** 制限対象のコスト種別。省略時は main/flash/stack すべてを制限する。 */
  effectModes?: readonly ("main" | "flash" | "stack")[];
}

/**
 * 「自分の系統：「○○」を持つ効果は、相手の効果では防げない」
 * (engine-effect-prevention-immunity-tribes、BSSL01-X02[9,10])。player-scoped CE
 * (`effect_source_prevention_immunity`) を登録し、登録後に宣言される効果のうち
 * 発生源カードの実効系統や effectClass scope に一致するものを sourcePreventionLevel:
 * "unpreventable" へ動的に昇格する。消費側は legal-actions-shared.ts。
 */
export interface GrantEffectSourcePreventionImmunityAction {
  kind: "grant_effect_source_prevention_immunity";
  /** 免疫の恩恵を受けるプレイヤー（通常 "self"）。 */
  player: EffectPlayerRef;
  /**
   * 免疫対象となる効果の発生源カードが満たすべきスコープ。`{ soulDriveDeparture: true }` は
   * 【ソウルドライブ・S】型コスト（explicit_soul_core + removed_from_game）を払い相手の
   * スピリット/アルティメットに離脱を及ぼす**宣言中の効果定義そのもの**を対象にする
   * （BSLH01-C07）。判定は `resolveEffectSourcePreventionLevel` が effect を直接検査する。
   */
  sourceScope:
    | { tribes: string[] }
    | { soulDriveDeparture: true }
    | {
        effectFilter: import("./dsl-types").EffectTargetFilter;
        source: "self" | "combined_host" | "combined_unit";
      }
    | {
        effectClass: import("./effect/effect-param-override").EffectParamOverrideClass;
        source: "self" | "combined_host" | "combined_unit";
        sourceMinLevel?: number;
      };
  /**
   * 指定時は blanket `unpreventable` へ昇格せず、防止側 CE の発生源がこの
   * profile に一致する target/leave 防止だけを貫通する。
   */
  preventionBypass?: import("./effect/target-affect-gate").TargetLockBypassProfile;
  /**
   * 省略時は既存互換の "prevention"（target/leave 防止貫通）。
   * "stack_negate" は効果発揮/使用を無効にする stack negate だけを拒否する。
   */
  appliesTo?: readonly ("prevention" | "stack_negate")[];
  /** grant 自体の発動回数制限（実際に unpreventable へ昇格した回のみ消費）。 */
  usageLimit?: EffectUsageLimit;
  duration: EffectDuration;
}

/**
 * 特定カードを相手のスタックタイミング元から除外する。
 */
export interface SuppressStackSourceAction {
  kind: "suppress_stack_source";
  /** 現状は発揮元自身のみ。 */
  target: "self";
  /** stack 応答を禁止する対象プレイヤー。 */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
  /** 指定時は、現在の stack source の効果記述子がこの条件に合う場合だけ抑止する。 */
  effectFilter?: import("./dsl-types").EffectTargetFilter;
}

/**
 * 「このスピリットは可能ならこのターンの最初にアタックする」(ENGINE-force-first-attack-this-turn、
 * BSTH02.7-TR02(A))。発揮元自身を今ターンの最初のアタッカーとして強制する。
 *
 * 「可能なら」= ハード強制ではない: 対象が別要因でアタック宣言不能になれば
 * (疲労/破壊/prevent_attack CE 等)、他カードのアタック宣言制約は自然に解除される
 * (getAttackDeclarationBlockReason が対象自身の legality を都度再評価するため、
 * 専用クリア処理・専用 pending は不要)。今ターン中に既にバトルが1つ終了していれば
 * (battlesEndedThisTurn>0)「最初」の機会は過ぎているため制約は適用しない。
 * duration は常に `{ scope: "turn" }`（今ターン終了で自然消滅）固定。
 */
export interface ForceFirstAttackerAction {
  kind: "force_first_attacker";
  /** 現状は発揮元自身のみ。 */
  target: "self";
}

/**
 * 「相手が対象を選ぶ効果を発揮するとき、可能ならこのカードを対象に含めなければ
 * ならない」タウント (forced-target-inclusion-taunt cluster, BSFT01-TR02(B))。
 *
 * 「可能なら」= ハード強制ではない: 発揮元自身が相手の対象選択 pending の
 * 候補プールに入っていない場合 (耐性・ゾーン不一致・対象数超過で全員は含められない
 * 等) は強制しない (`getMandatoryForcedTargetInclusionIds` が都度再評価するため、
 * 専用クリア処理・専用 pending は不要、force_first_attacker と同型)。
 * duration は常に `{ scope: "while_on_field" }`（場を離れれば自然消滅）固定。
 */
export interface ForcedTargetInclusionAction {
  kind: "forced_target_inclusion";
  /** 現状は発揮元自身のみ。 */
  target: "self";
}

/**
 * 「相手は[ゾーン]のコア1個をトラッシュに置かなければ、フラッシュ/スタック効果を発揮できない」
 * (発揮前提の除去/移動効果。BSTS01-M03 / 10_rules/03c §「○○しなければ△△を発揮できない」)。
 *
 * restrict_stack のハード禁止でなく、発揮の前提として相手にコア除去(移動)を課す継続ゲート。
 * 発揮(解決)直前・対象選択前に、相手は指定ゾーン(既定: フィールド/リザーブ)のコア1個を
 * トラッシュへ移さなければそのフラッシュ/スタック効果を発揮できない。
 */
export interface GateFlashStackCoreAction {
  kind: "gate_flash_stack_core";
  /** ゲートをかける対象プレイヤー */
  player: EffectPlayerRef;
  /** コアの除去元ゾーン (既定: フィールド + リザーブ)。 */
  source?: Zone | Zone[];
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「相手は手札N枚を破棄しなければ、フラッシュ/スタック効果を発揮できない」
 * (発揮前提の手札破棄効果。BSSA01-X01 / BSTH03-R02 / BSTH09-R02)。
 *
 * 追加コストではなく、発揮(解決)直前・対象選択前に手札カードへの破棄を要求する
 * 継続ゲート。対象は見出しラベル由来の「フラッシュ」/「スタック」効果カテゴリであり、
 * 使用窓(mode)とは分離して照合する。
 */
export interface GateFlashStackHandDiscardAction {
  kind: "gate_flash_stack_hand_discard";
  /** ゲートをかける対象プレイヤー */
  player: EffectPlayerRef;
  /** 破棄枚数。省略時 1。DynamicCount は解決直前に再評価する。 */
  count?: import("./dsl-types").CountBound;
  /** 対象にする効果カテゴリ。省略時は flash + stack。 */
  targetEffectLabels?: readonly EffectActivationTiming[];
  /** 対象にする宣言時ゾーン。BSTH09-R02「手札/手元から使用した」用。 */
  sourceActivationZones?: readonly EffectActivationSourceZone[];
  /** effect 側 usageLimit no_duplicate の internal snapshot。 */
  noDuplicate?: boolean;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「(対象プレイヤー)の手札は、相手によって破棄されない」(手札破棄耐性。BSFT01-C03/C04 等)。
 *
 * player-scoped CE (`prevent_hand_discard`) を登録し、executeDiscardHand が
 * **acting プレイヤーが保護対象プレイヤーの相手のとき**だけ、対象の手札カードを
 * 破棄対象集合から除外する。自分自身の効果による手札破棄 (コストの自捨て等) は止めない。
 *
 * 条件付与:
 * - `handCountMax` 指定時: 保護対象の手札枚数が N 枚以下の間だけ耐性が有効
 *   (「手札は5枚以下の間」)。N を超えていれば相手は破棄できる。
 * - `minSourceCores` 指定時: 発揮元カード (sourceInstanceId) の通常コアが N 個以上の間だけ
 *   有効 (「このネクサスのコアが1個以上のとき」)。発揮元離場/コア枯渇で失効。
 * いずれも解決直前 (消費側) で再評価する動的ゲート。
 */
export interface PreventHandDiscardAction {
  kind: "prevent_hand_discard";
  /** 保護対象のプレイヤー */
  player: EffectPlayerRef;
  /** 手札枚数の上限ゲート (この枚数以下の間だけ耐性有効)。 */
  handCountMax?: number;
  /** 発揮元カードの最低通常コア数ゲート。 */
  minSourceCores?: number;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「(対象プレイヤー)のデッキは破棄されない」(デッキ破棄耐性。BSTH08.5-C21「お互いのデッキは
 * 破棄されない」)。
 *
 * player-scoped CE (`prevent_deck_discard`) を登録し、真のデッキ破棄
 * (`move_card` の `deckDiscard: true` または discard primitive) のとき、対象デッキ所有者が
 * 保護されていれば当該カードを移動集合から除外する。単なるデッキ→トラッシュ配置には適用しない。
 * 手札破棄耐性と異なり原因不問（「破棄されない」）。`player: "either"` で両プレイヤーを保護する。
 */
export interface PreventDeckDiscardAction {
  kind: "prevent_deck_discard";
  /** 保護対象のプレイヤー ("either" = お互い) */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする」(BSTH05.5-X02 Lv2
 * 【導域】『自分のアタックステップ』)。
 *
 * player-scoped CE (`redirect_deck_discard_to_exclude`) を登録し、真のデッキ破棄
 * (`move_card` の `deckDiscard: true` または discard primitive) のとき、対象デッキ所有者が対象なら移動先を
 * `removed_from_game` へ差し替える。prevent_deck_discard (block) の redirect 版。
 * 「自分のアタックステップ」限定は duration/timingScope に委譲する。
 */
export interface RedirectDeckDiscardToExcludeAction {
  kind: "redirect_deck_discard_to_exclude";
  /** リダイレクト対象 (デッキ破棄が発生する側) のプレイヤー ("either" = お互い) */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「(対象プレイヤーは)ライフにコアを置けない」(BSTH02.7-C01 effects[2] choice[0])。
 * 「(対象プレイヤーは)相手の効果でボイドからコアを増やせない」(BSSL01-C02 effects[0])。
 *
 * player-scoped CE を登録する。`scope` 省略時 (= `"to_life"`, 後方互換) は
 * `restrict_core_placement_life` タグで登録し、`executeCoreMove` が `to.kind==="life"` の
 * 移動先プレイヤーに対して原因(発動者)不問で全面ブロックする。`scope:"from_void_self"` は
 * `restrict_core_placement_void` タグで登録し、`executeCoreMove` が `from.kind==="void"` かつ
 * 移動元プレイヤー===actingPlayerId (対象プレイヤー自身の効果でボイドのコアが減る) のときのみ
 * ブロックする (life 側と異なり「相手の効果で」= 自己原因限定。ENGINE-void-core-decrease-trigger)。
 * `player: "either"` で両プレイヤーを保護対象にできる (prevent_deck_discard と同型)。
 */
export interface RestrictCorePlacementAction {
  kind: "restrict_core_placement";
  /** 制限対象のプレイヤー ("either" = お互い) */
  player: EffectPlayerRef;
  /** 制限の持続時間 */
  duration: EffectDuration;
  /** 制限する移動パターン。省略時 `"to_life"` (原因不問でライフへの配置を禁止)。 */
  scope?: "to_life" | "from_void_self";
  /**
   * `scope:"to_life"` 併用時、移動元をこの Zone に絞り込む。省略時は移動元不問。
   * 「お互い、ボイドからコアをライフに置けない」(BSTH002-C04 effects[0]) のような、
   * 移動元限定・原因不問の制限を表す。
   */
  fromZone?: "void";
  /**
   * `scope:"from_void_self"` 併用時、「召喚時」効果由来の増加だけに絞り込む。省略時は
   * 自己原因なら timing 不問で全面ブロック。「お互い『このスピリットの召喚時』効果で
   * ボイドからコアを増やせない」(BSTH03-C31 Lv1-Lv2) のような timing 限定制限を表す。
   */
  sourceTimingScope?: "summon";
  /** コア移動を起こす効果の発揮元。制限を登録したカードやコアの移動先ではない。 */
  sourceFilter?: import("./dsl-types").CardFilter;
}

/**
 * 「(対象プレイヤーは)スピリット/アルティメットの効果で合計でN個以上シンボルを
 * 追加できない」(BSTH03-C04 effects[2])。player-scoped CE (`restrict_symbol_addition`)
 * を登録する。`player: "either"` で両プレイヤーを制限対象にできる (prevent_deck_discard
 * と同型)。`sourceFilter` 省略時は全 symbol_add を対象、指定時はその filter に一致する
 * カードの効果による symbol_add のみをカウント対象にする。消費側 (`executeSymbolAdd`) が
 * 実追加数 (対象数 * count) と `symbolAdditionRestrictedCountThisTurn` (CE単位キー) の
 * 累積を合わせて `maxTotal` を超える場合、symbol_add を全面ブロックする。
 */
export interface RestrictSymbolAdditionAction {
  kind: "restrict_symbol_addition";
  /** 制限対象のプレイヤー ("either" = お互い) */
  player: EffectPlayerRef;
  /** このスコープ内で追加できるシンボルの累計上限 */
  maxTotal: number;
  /** 指定時、この filter に一致するカードの効果による symbol_add のみをカウント対象にする */
  sourceFilter?: import("./dsl-types").CardFilter;
  /** 制限の持続時間 */
  duration: EffectDuration;
}

/**
 * 「自分の効果で自分のライフが増えるとき、増やす代わりに相手のライフのコア1個を
 * トラッシュに置ける」(BSTH02.7-X03 effects[3])。
 *
 * player-scoped CE (`life_gain_replacement`) を登録する。消費側 (`executeCoreMove`) が
 * `to.kind==="life"` かつ移動先プレイヤー===actingPlayerId (自分の効果で自分のライフが
 * 増える) のときにこの CE を照合し、任意 (`pendingLifeGainReplacementChoice`) で
 * 増加そのものを「相手のライフのコア1個をトラッシュに置く」代替アクションに置換できる。
 * `timingScope` (BSTH02.7-C02 effects[1] 先例と同型 `{player:"self",period:"attack"}`)
 * で「自分のアタックステップ中」を表現する。
 */
export interface LifeGainReplacementAction {
  kind: "life_gain_replacement";
  /** 置換権を持つプレイヤー (=ライフが増える側) */
  player: EffectPlayerRef;
  /** 効果の持続時間 */
  duration: EffectDuration;
}

/**
 * 「[プレイヤー]のライフは増やせない」型の完全禁止 (BSTH002-R02【セット中】
 * 「お互い、ライフは増やせず」)。`life_gain_replacement` と異なり、対象プレイヤーの
 * ライフへの増加を発揮者を問わず無条件・強制的に完全ブロックする（プレイヤーの
 * 選択を挟まない）。
 */
export interface LifeGainPreventionAction {
  kind: "life_gain_prevention";
  /** 増加を禁止されるプレイヤー */
  player: EffectPlayerRef;
  /** 効果の持続時間 */
  duration: EffectDuration;
}

/**
 * 「このスピリットの効果で移動する相手のコアすべてはトラッシュに置かれる」
 * (BSKB01-R03【合体中】)。「相手のライフから移動するコアすべてをボイドに置く」
 * (BSTH03-M05 Lv5)。
 *
 * global CE (`core_move_destination_replacement`) を登録する。消費側
 * (`executeCoreMove`) が `fromOwner`（登録者から見た self/opponent）と実際の移動元
 * プレイヤーが一致し（`fromZone` 指定時はゾーンも一致し、`matchCausingSourceOnly`
 * 指定時は `sourceInstanceId` も一致し）たときにこの CE を照合し、
 * `life_gain_replacement` と異なり pending を挟まず強制的に `to` を `toZone` へ
 * 上書きして再実行する。
 */
export interface CoreMoveDestinationReplacementAction {
  kind: "core_move_destination_replacement";
  /** 移動元の所有者。either は両者。 */
  fromOwner: "self" | "opponent" | "either";
  /** 対象化する移動元ゾーン。省略時はゾーン不問。 */
  fromZone?: "field" | "life" | "reserve" | "trash" | "void";
  /** true のとき、この CE の発揮元と同じ合体スピリットの効果だけを対象にする。 */
  matchCausingSourceOnly?: boolean;
  /** 変更先ゾーン。optional 未指定時は強制。 */
  toZone: "trash" | "void";
  /** この移動先だけを変更する。省略時は元の移動先を問わない。 */
  matchToZone?: "reserve" | "trash" | "void" | "life";
  /** 各効果の解決時に既存の step choice で移動先を選ぶ。 */
  optional?: boolean;
  /** 効果の持続時間 */
  duration: EffectDuration;
}

export type EffectAction =
  | DrawAction
  | DestroyAction
  | CoreMoveAction
  | CoreSetToLevelAction
  | BpModifyAction
  | RecoverAction
  | ExhaustAction
  | SearchDeckAction
  | ReturnFromTrashAction
  | LifeDamageAction
  | SymbolAddAction
  | BounceAction
  | DiscardHandAction
  | SendToDeckAction
  | RevealHandAction
  | PeekDeckAction
  | ShuffleZoneAction
  | DeckRevealAction
  | CountIncreaseAction
  | CountGainModifierAction
  | CoreMoveAmountModifierAction
  | CountDecreaseAction
  | CountSetAction
  | PreventAttackAction
  | PreventLifeDamageAction
  | VanishAction
  | NegateAction
  | SummonAction
  | PlaceAction
  | EffectImmunityAction
  | CostOverrideAction
  | AdditionalCostAction
  | UnblockableAction
  | BlockUnblockableAction
  | EndAttackStepAction
  | EndTurnAction
  | EndBattleAction
  | EndSingleBattleAction
  | RebirthAction
  | ReverseRebirthAction
  | MoveToSetAsideAction
  | TreatAsAction
  | RemoveFromGameAction
  | EffectResistanceAction
  | PreventBattleAction
  | PreventBraveSeparationAction
  | PreventNormalCoreMoveAction
  | RequireBattleCostAction
  | RequireAttackExhaustCostAction
  | RequireBattleDestroyCostAction
  | RequireHandGainCostAction
  | HandGainPreventionAction
  | DrawModifyAction
  | LifeFillAction
  | AdditionalAttackAction
  | RestrictFlashAction
  | RestrictStackAction
  | RestrictBurstActivationAction
  | RestrictAdventAction
  | RestrictRecoveryAction
  | RestrictReserveCostPaymentAction
  | RestrictFieldCostPaymentAction
  | GrantEffectSourcePreventionImmunityAction
  | SuppressStackSourceAction
  | ForceFirstAttackerAction
  | ForcedTargetInclusionAction
  | GateFlashStackCoreAction
  | GateFlashStackHandDiscardAction
  | PreventHandDiscardAction
  | PreventDeckDiscardAction
  | RedirectDeckDiscardToExcludeAction
  | RestrictCorePlacementAction
  | RestrictSymbolAdditionAction
  | LifeGainReplacementAction
  | LifeGainPreventionAction
  | CoreMoveDestinationReplacementAction
  | RestrictEndAttackStepAction
  | RestrictEndBattleAction
  | RestrictEndStepAction
  | RestrictEndTurnAction
  | EnterSoulStateAction
  | DivineTransformAction
  | StayOnFieldAction;

// --- 効果条件 (ConditionClause 配列) ---

/** 効果発動/適用のゲーム状態条件節。配列内は AND 結合。 */
export type ConditionClause =
  | { kind: "min_level"; value: number }
  | { kind: "combined" }
  /**
   * 効果発生源(ブレイヴ)が現在合体しているホストカードの category が categories に
   * 含まれるか。非合体中(ホスト無し)は false。【アルティメット合体中】/【スピリット合体中】
   * のようにホスト種別を限定する見出しラベルは `applicability:{combined:true}` だけでは
   * 表現できない（combined はホスト種別を区別しない汎用「いずれかに合体中」判定、
   * BSAZ02-C11 adversarial verifier round1 lens1 指摘）ため、この condition を併用する。
   * category は getEffectiveCategory 経由（act_as_spirit 等の実効値反映、SSOT）。
   */
  | { kind: "combined_host_category"; categories: CardCategory[] }
  /**
   * combined_host_category の系統版。効果発生源(ブレイヴ)が現在合体しているホストカードの
   * 実効系統が tribes に一致するか。非合体中(ホスト無し)は false。「系統：「X」を持つ
   * 自分の合体スピリットがアタックしたとき」型のブレイヴ側アタック時条件を、
   * ブレイヴ自身の系統ではなく合体先 host へ向けるために使う。
   */
  | {
      kind: "combined_host_tribes";
      tribes: string[];
      tribesLogic?: "and" | "or";
    }
  /**
   * combined_host_category のカード名版。効果発生源(ブレイヴ)が現在合体しているホストカードの
   * 実効カード名が cardNames のいずれかに一致するか。非合体中(ホスト無し)は false。
   * 「合体中のこの『X』」のように、ブレイヴ側効果のホスト名を限定する用途。
   */
  | {
      kind: "combined_host_card_name";
      cardNames: import("./dsl-types").CardNameMatch[];
    }
  /**
   * combined_host_card_name の煌臨元版。効果発生源(ブレイヴ)が現在合体しているホストカードの
   * 煌臨元 (underCards role='advent_source') の実効カード名が cardNames のいずれかに一致するか。
   * 非合体中(ホスト無し)・ホストが非煌臨(advent_source 無し)は false。
   * combined_host_card_name はホスト自身の印字名を見るため「『X』が煌臨元の…スピリット」型
   * (「X」という別カードが煌臨元として下にいる、ホスト自身の名前ではない) には使えない
   * (adversarial verifier round1 refute、BSRK01-X01 合体結誓。ホスト自身が「X」を含む名前を
   * 持つが煌臨元を伴わないケース (例: BSRK01-CX01「緋村 剣心」の通常召喚) を誤って一致させて
   * いたバグの修正が初出)。`requireContractAdventVariant:true` のとき、ホスト自身の
   * `hasEffectiveAdventVariant(..., ["contract"])` による印字・付与の資格も要求する
   * （「契約煌臨スピリット」限定）。
   */
  | {
      kind: "combined_host_advent_source_card_name";
      cardNames: import("./dsl-types").CardNameMatch[];
      requireContractAdventVariant?: boolean;
    }
  /**
   * トリガーを引き起こした効果のソースカードが、効果発生源(ブレイヴ)の合体先ホストと
   * 同一 instance か。非合体中・trigger source 不明は false。
   * 「この『X』の効果で〜」を、単なる同名別個体ではなく同一合体ユニット由来に縛る。
   */
  | { kind: "trigger_source_is_combined_host" }
  /**
   * combined_host_category の逆方向: 効果発生源(スピリット/アルティメット側)が現在合体して
   * いるブレイヴ(attachedToInstanceId === sourceInstanceId の field 上カード)の**いずれか**が
   * tribes のいずれかを持つか。非合体中(ブレイヴ無し)は false。「系統：「X」を持つブレイヴとの
   * 合体中」という見出しラベルを、ホスト側カードの発動条件として表現するための combined
   * ファミリー追加 (BSTH05.5-X01)。系統は getEffectiveTribes 経由（grant_effect 等の付与を
   * 反映、SSOT）。
   */
  | { kind: "combined_guest_tribes"; tribes: string[] }
  // reference:"self" のときは `resolveSelfReferenceCard()` と同じ「このスピリット」
  // 参照（合体中ブレイヴなら host）を見る。省略時は従来どおり効果発生源自身。
  // "on_field": 効果発生源 (sourceInstanceId) が現在フィールドにいる。bp_compare_destroy 等で
  // 源と対象が相討ちになり得る効果の後続を「源が残ったときだけ」に絞る用途（「相手の対象だけを
  // 破壊したとき」= 対象が場を離れた ∧ 源が場に残っている）。
  // "advented": 効果発生源自身が【煌臨中】= 表向き煌臨元≧1（adventSourceIdsOf > 0、
  //   10_rules/08a L34）。「自身が煌臨中である」自己ゲート用。
  // "in_advent_source": 効果発生源自身が他カードの煌臨元として下に置かれている
  //   （= 他カード `c` の `c.underCards` に role='advent_source' で登録されている）。
  //   【契約煌臨元】タグ付きの効果（契約スピリットが advent source の位置にいる間だけ
  //   発揮される効果）の継続ゲート用。BSDB01-CX01 / BSTS01-CX01 等の【契約煌臨元】
  //   gating。collectUnderCardScopeIds を SSOT として共有。
  | {
      kind: "self_state";
      state:
        | "recovered"
        | "exhausted"
        | "on_field"
        | "advented"
        | "in_advent_source"
        /**
         * このカードが現在の zone に入ったのが「今ターン」か
         * (`CardInstance.zoneEnteredAtTurn === state.turnNumber`、
         * ENGINE-accel-tribe-cost-override)。「〜に置かれたターンの間」型の
         * 継続効果ゲート用。moveCardZone を経由しないゾーン変更ではスタンプされない点に注意。
         */
        | "zone_entered_this_turn";
      reference?: "source" | "self";
      /** 「このスピリットがいるなら」等の実体条件。CardFilter と同じ包含規則で評価する。 */
      filter?: import("./dsl-types").CardFilter;
      /**
       * 効果発生源自身のバトル参加状態。`field_has.battleState` では同名/同種の別個体を
       * 拾い得るため、「このスピリットがアタック中」型の自己ゲートは self_state に閉じる。
       */
      battleState?: "attacking" | "blocking" | "in_battle";
      /**
       * 宣言前スタック窓で未成立の自己アタック/ブロック宣言を拾う。
       * `battleState` と併用した場合は、成立済み battleState または未成立 declaration の
       * どちらかを満たせば真とする。
       */
      pendingDeclaration?: "attack" | "block" | "in_battle";
    }
  /**
   * P3-129 (ENGINE-triggered-hand-zone-immunity-dynamic-scope): 効果発生源自身
   * (sourceInstanceId) の `CardInstance.pendingTriggerCorrelations[key]` に記録された
   * pendingId のいずれかが、現在も `state.pendingTriggeredEffects` に存在するか判定する。
   * 「Xが起きたとき、以後、相手側の誘発効果が未解決の間だけY」型 (BSTH07-転醒X02(A)
   * 【神秘】等) の継続効果を、相手側誘発の解決状況で動的にゲートする用途。存在しなくなれば
   * (=相手側誘発が解決/消滅すれば) 自動的に false へ戻る。`correlate_pending_trigger` Action
   * が唯一の書き込み経路。
   */
  | { kind: "correlated_pending_trigger_active"; key: string }
  /**
   * ENGINE-targeted-disclosure-offfield-source: game_event:"targeted" 等の
   * trigger の relatedInstanceId (対象化された/観測されたカード) が、評価時点で
   * zone!=="field" か判定する (`TriggerContext.relatedInstanceZone` 経由)。
   * targeted disclosure はフィールド外で発揮中の対象にも発火するため、
   * 「フィールド以外で発揮中の…を対象とした相手の効果」(BSLH01-T14) のように
   * 通常の on-field 対象化と区別したいカードで使う。relatedInstanceZone 未注入
   * (対象なし等) は fail-closed で false。
   */
  | { kind: "trigger_related_instance_off_field" }
  // 効果発生源カード自身の名前条件（「このスピリットが『X』/『Y』のとき」型、
  // BSGE01-M01/M03/M04 バレットエディット役割カード等）。field_has はフィールド全体を
  // 走査して枚数を数えるが、self_name は sourceInstanceId のカード 1 枚の名前のみを見る。
  // reference:"self" のときは `resolveSelfReferenceCard()` と同じ「このスピリット」
  // 参照（合体中ブレイヴなら host）の名前を見る。
  | {
      kind: "self_name";
      names: import("./dsl-types").CardNameMatch[];
      reference?: "source" | "self";
    }
  /**
   * 効果発生源自身の実効 BP 条件。合体スピリットなら合体中ブレイヴの BP+ も含む。
   * 「このスピリットが BP40000 以上なら」型の自己ゲート用。
   */
  | {
      kind: "self_bp";
      min?: number;
      max?: number;
    }
  /**
   * 効果発生源自身のカード上総コア数条件。通常コア + ソウルコアを
   * `getTotalCoresOnCardById` で数える（10_rules/06: generic な「コア」は
   * ソウル除外指定がない限りソウルコアを含む）。実効 Lv ではなく、原文が
   * 「このスピリットのコアがN個以上」と明示する自己ゲート用。
   */
  | {
      kind: "self_core_count";
      min?: number;
      max?: number;
    }
  /**
   * 効果発生源自身の下に、指定 roleTag の text_role アンダーカードが minCount 枚以上あるか
   * （「あるとき、以下の効果を得る」型 host 側ゲート、例【アルドノアドライブ：N】BSAZ02-C07、
   * engine-aldnoah-drive-under-card-keyword が初出）。`in_advent_source`（自身が他カードの
   * 下にある）とは逆方向（自身の下に他カードがある）。判定は `countTextRoleUnderCards`
   * （star-garment-utils.ts、roleTag 引数を取る既存汎用 helper）を再利用する。
   */
  | {
      kind: "self_under_card_count";
      roleTag: string;
      /** 省略時1（「あるとき」= 1枚以上）。 */
      minCount?: number;
    }
  /**
   * 効果発生源自身の下にある煌臨元（underCards role='advent_source'）カード群の
   * 名前条件。「このアルティメットの降臨元に『X』と『Y』があるとき」(BSSG01-X03) 型の
   * 自己ゲート用。`self_under_card_count`（roleTag ベース、role='text_role' 限定、
   * countTextRoleUnderCards SSOT）とは別軸で、role='advent_source' の underCards を
   * 対象に名前一致で判定する（adventSourceIdsOf を SSOT として使用）。
   */
  | {
      kind: "self_advent_source_names";
      names: import("./dsl-types").CardNameMatch[];
      /**
       * 省略時 "and"（原文「AとBがあるとき」= names の各要素につき、いずれかの
       * 煌臨元カードが最低1枚一致することを要求）。"or" は将来の「AまたはBが
       * あるとき」型のために用意。
       */
      logic?: "and" | "or";
    }
  | {
      kind: "field_has";
      player: EffectPlayerRef;
      /**
       * `player:"either"` を「自分/相手いずれかが単独で条件を満たせば true」
       * (既定、needs-ruling.jsonl:BSTH02-R01/R02/R03 裁定C) ではなく「自分+相手の
       * 合算枚数」で判定する opt-in（`field_core_sum_both_players` がコア数の合算判定を
       * 持つのと対称、こちらはカード枚数の合算）。`player !== "either"` では無視される。
       * 「「西行妖」が1つ(自分+相手の合計がちょうど1体、自己包含)」(BSTH02-X01,
       * needs-ruling.jsonl:BSTH02-X01-self-count) のような単一カード名の総数ちょうど
       * N 判定に使う。省略時 false = 従来の OR 判定（BSTH02-R01/R02/R03 の既存挙動を
       * 変えない、field-has-either-player.test.ts で固定）。
       */
      sumAcrossPlayers?: boolean;
      zone?: Zone;
      category?: CardCategory[];
      colors?: CardColor[];
      /**
       * 実効シンボル色フィルタ（カード色 `colors` と区別）。各カードの
       * getEffectiveSymbols（base symbolColors + treat_as/symbol_addition CE）に
       * 指定色のいずれかが含まれるとき一致。「自分の青シンボルがあるとき」
       * （BSTH07-転醒R01(B)[1] 等）= colors:["blue"] では「青を持つカード（色のみ）」
       * を拾ってしまうため、symbolColors:["blue"] で「青シンボルを 1 つ以上持つ
       * カード」に限定する。`colors` とは独立（両方指定可、AND 評価）。
       */
      symbolColors?: SymbolColor[];
      /**
       * 色数条件（「青1色のネクサス」= 単色青、BSTH07-転醒X01(B)[2,3] 等）。
       * - "mono" = 実効色がちょうど1色。`colors` と併用すると「その1色がいずれかに一致」を要求。
       * - "multi" = 実効色が2色以上。
       * 省略時は色数を問わない（colors はいずれか一致のみ）。
       */
      colorCount?: "mono" | "multi";
      tribes?: string[];
      /**
       * 必須系統（AND）。`tribes`（OR）と独立に評価する（CardFilter.tribesRequired と同型、
       * BSTH02.7-C02「系統：「幻想」と「動玩」を持つカード」のような複数系統 AND 条件用）。
       */
      tribesRequired?: string[];
      /** カード名一致 (「自分の『剣心』がいる」等)。いずれか一致で OK。 */
      cardNames?: import("./dsl-types").CardNameMatch[];
      /**
       * カード名一致の除外フィルタ（否定版、`cardNames` とは別軸）。指定した名前に
       * いずれか一致するカードは件数カウントから除外する（BSAZ02-X03「『オルテュギア』
       * 以外の自分の系統：『ＣＦ』のアルティメット0体」のような、召喚条件が自分自身が
       * 生成した同名分身トークンを数えないようにする用途。`CardFilter.excludeColors`/
       * `excludeTribeSubstring` と同じ「否定フィルタ」パターン）。
       */
      excludeCardNames?: import("./dsl-types").CardNameMatch[];
      /**
       * カード名一致の実効名版（`cardNames` の姉妹フィールド）。`cardNames` は既存カード群の
       * raw `def.name` 依存を崩さぬよう据え置いているため、act_as_spirit/override_properties
       * でカード名を上書きされたトークン（`getEffectiveCardName` 経由）を拾えない。
       * `excludeCardNames`（新設・実効名基準）と同じ判定経路を INCLUDE 方向に流用する
       * (「自分が生成した『オルテュギア』分身アルティメットが既にいるか」のような、
       * 自己生成トークンの実効名を数える用途。BSAZ02-X03【分身：1】上限ゲート、
       * ENGINE-x03-bunshin-count-gate)。
       */
      cardNamesEffective?: import("./dsl-types").CardNameMatch[];
      /**
       * true のとき、act_as_spirit で登録された（＝分身スピリット/分身アルティメット等の
       * トークン）カードのみに絞り込む。`cardNamesEffective` (実効名) だけでは、印字上の
       * 実カードがトークンと同名になるケース（例: BSAZ02-X03「オルテュギア」は
       * summonCondition.excludeCardNames で同名2枚目以降の召喚を許可しており、自身が
       * 生成する分身アルティメットも同じ実効名「オルテュギア」を持つ）を区別できず、
       * 場に実カードが2枚以上あると誤って「既存の分身」としてカウントしてしまう
       * (round2 adversarial verifier 指摘、BSAZ02-X03【分身：1】上限ゲート)。
       * `getActAsSpiritMetadata`（act-as-spirit.ts SSOT）で判定するため、印字上の実カードは
       * 常に false、act_as_spirit CE を持つトークンのみ true になる。
       */
      actAsSpiritOnly?: boolean;
      /**
       * `actAsSpiritOnly` と併用し、さらに「発動元カード自身が register_act_as_spirit した
       * トークンか」（act_as_spirit CE の `sourceInstanceId` が本条件を評価しているカード
       * 自身と一致するか、`getActAsSpiritSourceInstanceId` SSOT 経由）に絞り込む。
       * 場に同名の実カードが複数いる場合、各カードは「自分自身が生成したトークン」のみを
       * 数えるべきで、他の実カードが生成したトークンまで数えると誤って自分の発揮を
       * ブロックしてしまう (round2 adversarial verifier 指摘、BSAZ02-X03【分身：1】上限)。
       */
      actAsSpiritSourceSelf?: boolean;
      /**
       * バトル状態フィルタ (「地霊スピリットがアタックしている間」等)。
       * "in_battle" = アタック中またはブロック中のいずれか (`CardFilter.battleState` の
       * "in_battle" と同義、BSAZ02-C17「アルティメットがアタック/ブロックしている間」等)。
       */
      battleState?: "attacking" | "blocking" | "in_battle";
      /**
       * 煌臨状態フィルタ（「煌臨中の自分のスピリットがいるとき」BSKB01-R03 等）。
       * "advented" 指定時、マッチ対象は表向き煌臨元≧1（adventSourceIdsOf > 0 = 【煌臨中】、
       * 10_rules/08a L34）の個体に限定する。
       */
      adventState?: "advented";
      minCount?: number;
      maxCount?: number;
      /** 印字/実効コストで場の存在条件を絞る（「本来のコスト9以上の自分の『ベジータ』」等）。 */
      minCost?: number;
      maxCost?: number;
      /** 省略時も printed。field_has は現時点では印字コスト条件のみを扱う。 */
      costBasis?: "printed";
      minCores?: number;
      /**
       * 現在Lvの下限/上限（「Lv2の〜がいるとき」型、BSTH07.8-C05 フラッシュ「妖精導界者
       * ネクサスがLv2のとき」等）。`CardFilter.minLevel`/`maxLevel` と同型・同 SSOT
       * (getEffectiveLevel)。場のカードのみ意味を持つ (フィールド外は判定不能=不一致)。
       */
      minLevel?: number;
      maxLevel?: number;
      excludeSelf?: boolean;
      grandwalkerKind?: "grandwalker" | "guided" | "any";
      /**
       * 名前参照の包含スコープ（10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
       * 無印（両 false）は通常フィールドに実体配備された個体のみを数える。魂状態
       * （soulStateInstanceIds）・煌臨元/その他アンダーカード（underCards）は数えない。
       * - includeSoulState=true: 魂状態（soulStateInstanceIds）も数える（「魂状態を含む「X」」）。
       * - includeAdventSource=true: 煌臨元（underCards role='advent_source'）も数える
       *   （「煌臨元を含む「X」」）。text_role アンダーカードは常に数えない。
       */
      includeSoulState?: boolean;
      includeAdventSource?: boolean;
      /**
       * 魂状態に限定（「魂状態の自分の系統:「導力器」を持つブレイヴカードがあるとき」型、
       * BSLH01-C03 effects[2] 等）。true のとき soulStateInstanceIds に含まれる個体のみが
       * マッチ対象になる。includeSoulState を暗黙に有効化する（魂状態を opt-in した上で
       * さらに限定する）。dsl-types.ts CardFilter.soulState:"only" と意味的に等価。
       */
      soulStateOnly?: boolean;
      /**
       * 「契約スピリット」等の契約カード条件（field_has 版）。true のとき
       * isContractDefinition（card-filter.ts、AdventCondition.isContract と同じ SSOT）で
       * true な定義のみ対象にする（BSSL01-C06「契約スピリットの『水篠 旬』」等）。
       */
      isContract?: boolean;
      /**
       * CardDefinition.keywordTags に指定タグをすべて持つカードだけに一致する。
       * isContractDefinition と同じく「契約スピリット」本体など keywordTags 側の
       * 印字分類を直接要求する場合に使う。
       */
      requiredKeywordTags?: string[];
    }
  | {
      kind: "field_lacks";
      player: EffectPlayerRef;
      zone?: Zone;
      category?: CardCategory[];
      colors?: CardColor[];
      /**
       * 実効シンボル色フィルタ（field_has.symbolColors と対称）。
       * 「自分の導シンボルがないとき」型で、カード色ではなく
       * getEffectiveSymbols による実効シンボルを判定する。
       */
      symbolColors?: SymbolColor[];
      tribes?: string[];
      cardName?: "self";
      /**
       * カード名一致 (「自分の『月読 調』がいないとき」等)。いずれか一致するカードが
       * 場に無いとき field_lacks が成立する。field_has の cardNames と対称。
       * `cardName: "self"` とは独立に AND 評価される。
       */
      cardNames?: import("./dsl-types").CardNameMatch[];
      excludeSelf?: boolean;
      grandwalkerKind?: "grandwalker" | "guided" | "any";
    }
  | {
      /**
       * フィールドの全カードが指定 `filter` (CardFilter) を満たすとき true（全称量化 ∀card:P(card)、
       * ENGINE-universal-field-condition）。`field_has`/`field_lacks` はいずれも存在量化
       * (∃card:P(card) / ¬∃card:P(card)) のみを表現し、「Pでないカードが場に無い」(¬∃¬P = ∀P)を
       * 直接書けない。本 kind は「満たすべき条件 P」を filter にそのまま書けるようにした対称形
       * (field_lacks が「あってはいけない条件」を書くのと逆)。
       * 判定は `matchesCardFilter`（card-filter.ts SSOT）を流用し、対象ゾーンに一致するカードの
       * うち filter を満たさないものが1枚も無いことを確認する（0枚のときは空虚に真）。
       * 「自分のフィールドに系統：「幻想」/「秘神」を持たないカードか緑以外のカードがなければ」
       * (BSTH11-X01/X03/X04) = filter:{tribes:["幻想","秘神"], colors:["green"]} で表現する
       * (原文の「Pでないカードが無い」から否定を計算し直さず、満たすべき肯定条件 P を直接書ける)。
       */
      kind: "field_all_match";
      player: EffectPlayerRef;
      zone?: Zone;
      filter: import("./dsl-types").CardFilter;
      excludeSelf?: boolean;
    }
  | { kind: "hand_count"; player: EffectPlayerRef; min?: number; max?: number }
  /** プレイヤーの setBurstStates 件数（バーストセット枚数）。max:0 で「バースト未セット」判定に使う。 */
  | {
      kind: "burst_set_count";
      player: EffectPlayerRef;
      min?: number;
      max?: number;
    }
  | { kind: "count_value"; player: EffectPlayerRef; min?: number; max?: number }
  /** このターンに終了時の解決まで完了したバトル数。終了処理待ちのバトルは数えない。 */
  | { kind: "completed_battle_count"; min?: number; max?: number }
  | {
      /**
       * プレイヤーが制御する host にセット中クォーツの属性値合計（アーツ解放/条件付き効果。qa-033）。
       * attribute:"any" は「属性値のいずれか1種の合計が」型（BSLH01-X10）: 7種を個別に集計し、
       * min/max を1種でも満たせば true（属性を跨いで合算しない）。
       */
      kind: "quartz_attribute";
      player: EffectPlayerRef;
      attribute: QuartzAttribute | "any";
      min?: number;
      max?: number;
    }
  | {
      /**
       * OR-of-AND: groups のうち少なくとも1つが全て(AND)成立すれば true（groups が空なら false）。
       * 複数の閾値プロファイルを OR 結合する用途（【アーツ】属性値ゲート「地4風1 / 水4地1 / ...」
       * のような quartz_attribute 複数組合せ、BSLH01-T07〜T17）。各内側配列は evaluateCondition
       * と同じ AND 評価（既存 ConditionClause を再利用、専用比較ロジックを増やさない）。
       */
      kind: "any_of";
      groups: ConditionClause[][];
    }
  | { kind: "life_value"; player: EffectPlayerRef; min?: number; max?: number }
  /**
   * このターン、指定プレイヤーのライフが実際に1点以上減っているか。「自分のライフが
   * 減ったターンのエンドステップに〜」型 (BSTH002-R02) の自己ゲート用。
   * `lifeReductionCappedThisTurn[playerId] > 0`（`life_damage_interception`
   * mode:"turn_cap" が実減少量を計上するターン累積カウンタ、ターン開始でリセット）を
   * 「1点でも減れば true」の判定として再利用する（SSOT: 同じ「このターンのライフ減少」
   * を表す別カウンタを新設しない）。
   * ⚠ このカウンタは mode:"turn_cap" CE を経由した減少のみを計上する。対象プレイヤーに
   * 常時発揮中の turn_cap CE が無いターンは、実際にライフが減っていても false のままに
   * なりうる。turn_cap CE が同一カード等から無条件に発揮されている前提で使うこと。
   */
  | { kind: "life_reduced_this_turn"; player: EffectPlayerRef }
  /**
   * 「このカードの効果で使用していたとき」(BSLH01-M05 textLines[6])。同名カードが
   * 今ターン中に自分自身の `life_damage_interception` `useCostGate`（コストを支払わず
   * 使用することでライフ減少を防ぐ型）の支払いに使われたかを判定する。
   * `lifeDamageInterceptionUseCostGateUsedThisTurn`（`${playerId}:${definitionId}` 単位、
   * 毎ターン開始でリセット）を参照する（declareGimmickGateUsedThisTurn と同型の
   * player-scoped 使用済みフラグ）。`player` は通常 "self"。
   */
  | {
      kind: "life_damage_interception_use_cost_gate_paid_this_turn";
      player: EffectPlayerRef;
    }
  | {
      /**
       * P3-63: フィールドのカード総数 (カテゴリ・色・系統フィルタなし) で判定。
       * BSTH02-M01「自分のフィールドにカードが3枚以上あれば発揮できず」のような
       * 純カード枚数条件用。`field_has` は filter なしでも minCount/maxCount で表現
       * 可能だが、意図 (純枚数) と semantics (filter 一致枚数) を分離するため discrete。
       */
      kind: "field_card_count";
      player: EffectPlayerRef;
      min?: number;
      max?: number;
      excludeSelf?: boolean;
    }
  | {
      /**
       * 自分・相手それぞれのフィールド+リザーブ合計コア数（通常+ソウル。generic「コア」は
       * soul を含む SSOT、project_soul_core_movement_generic 準拠）が、両者とも独立に
       * min 以上のとき成立。「創界神ネクサス/導界者ネクサス/創界石ネクサス以外の
       * フィールド/リザーブのコアの合計がお互いどちらも5個以上」(BSTH02-X01 【導域:1】)
       * 型の、両プレイヤー独立閾値 AND 判定用。`field_has`/`field_card_count` の
       * `player: EffectPlayerRef` は単一プレイヤー解決 (resolvePlayerRef) のため
       * 「両者それぞれ」の AND 判定を表現できず discrete に新設。
       */
      kind: "field_core_sum_both_players";
      min: number;
      /** true のとき grandwalkerData を持つカード（創界神=grandwalker/導界者=guided）を集計から除外 */
      excludeGrandwalker?: boolean;
      /** true のとき grandstoneData を持つカード（創界石ネクサス）を集計から除外 */
      excludeGrandstone?: boolean;
    }
  | {
      /**
       * 任意ゾーン内のカード枚数 (CardFilter 一致) で判定。
       * 「自分のトラッシュにあるブレイヴカードの数が N 枚以上」(BSES01-X01
       * 行きつく果てまで) 等。field 限定の `field_has`/`field_card_count` と異なり
       * trash/reserve など任意ゾーンを数える。DynamicCount の value source
       * `cards_in_zone` の condition 版で、集計ロジックは同一 (matchesCardFilter)。
       * `zone` は配列も取れる（CardFilter.zone / TargetSpec.filter.zone と同型の
       * OR 結合。「手札/手元にある」型の 2 ゾーン合算存在チェックに使う、
       * engine-atomic-hand-trash-swap-legal-action）。
       */
      kind: "cards_in_zone";
      player: EffectPlayerRef;
      zone: Zone | Zone[];
      filter?: import("./dsl-types").CardFilter;
      min?: number;
      max?: number;
    }
  | {
      /**
       * このターンに指定プレイヤーが召喚したカードごとの実効色数の合計を min/max 判定する。
       * 同一カード内の重複色は1色として扱うが、別カード由来の同色はそれぞれ加算する。
       * 召喚イベント時点のスナップショットを GameState.turnSummonedCardRefs に保持し、
       * filter は cards_in_zone と同じ CardFilter/matchesCardFilter 経路で評価する。
       */
      kind: "summoned_this_turn_color_count";
      player: EffectPlayerRef;
      filter?: import("./dsl-types").CardFilter;
      min?: number;
      max?: number;
    }
  | { kind: "no_same_name_on_field" }
  | {
      /**
       * 「自分が契約していなければ」= 指定 `player`（省略時は自分/actingPlayerId）が
       * 契約カードをデッキに採用していない（提示情報と所有カードの印字定義で判定）。
       * `negate:true` で逆 (「<player>が契約していれば」) を判定する
       * （例: 「相手が契約していれば」= `player:"opponent", negate:true`、BSTH11-C03）。
       * 提示を明示する本文は no_presented_contract_card / presented_contract_color で別に扱う。
       */
      kind: "no_contract_card";
      player?: EffectPlayerRef;
      negate?: boolean;
    }
  | {
      /**
       * 「ゲーム開始時に契約カードを提示していなければ」= 提示情報のみを判定する。
       * デッキに契約カードを採用していても、未提示なら成立（独自QA qa-041）。
       */
      kind: "no_presented_contract_card";
      player?: EffectPlayerRef;
      negate?: boolean;
    }
  | {
      /**
       * 「自分がこのカードと契約しているとき」型。
       * `contracts_only_mono_color` と同じデッキ採用レベル判定として、指定 player の
       * ownerPlayerId 一致カードを zone 横断で走査し、契約カード定義かつ cardNo 一致なら
       * true。cardNo 省略時は効果発生源自身の定義 cardNo を使う。
       */
      kind: "owns_contract_card";
      player: EffectPlayerRef;
      cardNo?: string;
    }
  | {
      /**
       * 「自分が <color>1色以外と契約していなければ」(BSGE01-C14/C15 errata 2026-06-26)。
       * `player` のデッキに採用された契約カード (isContractDefinition = keywordTags に
       * "contract") を全 zone 横断で走査し、**印字色 (def.colors)**
       * が `color` 単色のみであれば true、それ以外の色を含む契約カードが 1 枚でも採用
       * されていれば false。契約カード未採用 (0 枚) は true (no_contract_card と同じく
       * 「契約していない」扱い)。
       *
       * デッキ採用レベル判定 (memory project_contract_state_deck_vs_presentation):
       * 提示レベル (player.contractCardNo) ではなくデッキに採用されている契約カード
       * すべてが対象。判定はデッキ採用時点の素性 = 印字色のみ (zone CE/treat_as_color
       * は無視) で、フィールド上で treat_as_color CE が乗っても gate は変化しない。
       * errata 2026-06-26 BSGE01-C15 裁定参照。
       */
      kind: "contracts_only_mono_color";
      player: EffectPlayerRef;
      color: CardColor;
    }
  | {
      /**
       * 「自分がゲーム開始時に提示した契約カードが<color>のとき」(BSGE01-C07「自分が
       * ゲーム開始時に提示した契約カードが緑のとき、かわりに〜」)。
       * `contracts_only_mono_color` はデッキ採用済み契約カード全体（複数枚横断）を見るのに
       * 対し、本 clause は提示レベル (`player.contractCardNo`、単一) のみを見る点で区別する
       * (memory project_contract_state_deck_vs_presentation)。印字色 (def.colors) が
       * `color` を含めば true。契約未提示 (contractCardNo=null) は false。
       * `negate:true` で「緑でないとき」（=通常分岐）判定になる。
       */
      kind: "presented_contract_color";
      player: EffectPlayerRef;
      color: CardColor;
      negate?: boolean;
    }
  | { kind: "trigger_colors"; colors: CardColor[] }
  /**
   * トリガーを引き起こした効果のソースカードが指定系統のいずれかを持つか。
   * trigger_colors の系統版（「自分の系統：「鍵」/「星霊」を持つ効果で〜」BSFT01-C02 等）。
   * sourceCard（＝効果を持つカード自身＝回収されるカード）へはフォールバックしない
   * （自カードの系統が一致すると誤発火するため）。triggerContext.sourceTribes 必須。
   * `excludeSelfSource:true` で「このカード以外の」を追加限定する
   * （BSTH07-転醒R01(A)「このネクサス以外の自分の系統：「起幻」を持つ効果でドロー〜」。
   * カード自身が印字系統として起幻を持つ場合、自身の他効果由来トリガーを誤って
   * 拾わないための除外）。triggerContext.sourceInstanceId が自カード instanceId と
   * 一致すれば不成立。
   */
  | { kind: "trigger_tribes"; tribes: string[]; excludeSelfSource?: boolean }
  /**
   * トリガーを引き起こした効果のソースカードが、指定カード名または指定系統のいずれかに一致するか。
   * 「自分の『霧の湖』/系統:『妖精』を持つ効果で〜」のような名前 OR 系統の発生源限定を
   * 1 clause 内の OR として表す。trigger_tribes と同じく、sourceCard（回収対象）へは
   * フォールバックしない。triggerContext.sourceCardName/sourceTribes のどちらか一致時のみ成立。
   */
  | {
      kind: "trigger_source_match";
      cardNames?: import("./dsl-types").CardNameMatch[];
      tribes?: string[];
    }
  /**
   * トリガーを引き起こした効果のソースカードのコントローラー判定。
   * 「自分の系統:「鍵」/「星霊」を持つ効果で〜」（BSFT01-C03/C04）のように、
   * トリガー原因が自分の効果か相手の効果かで限定する用途。
   * sourceCard（＝効果を持つカード自身）の controllerPlayerId へはフォールバックしない
   * （自カードのコントローラーが一致すると誤発火するため）。triggerContext.sourcePlayerId 必須。
   * player:"self"   = sourcePlayerId === actingPlayerId
   * player:"opponent" = sourcePlayerId !== actingPlayerId
   */
  | { kind: "trigger_source_player"; player: EffectPlayerRef }
  | {
      /**
       * イベントが論理上発生した元ゾーン。deck_reveal から後続移動したカードは、
       * そのオープン効果に由来する event として deck を維持し得る。
       */
      kind: "trigger_from_zone";
      zones: Zone[];
    }
  | {
      /**
       * 実際に直前までいたゾーン。deck_reveal 後の破棄を、デッキから直接の破棄と
       * 区別する必要がある card_event 用の明示的な物理起点条件。
       */
      kind: "trigger_physical_from_zone";
      zones: Zone[];
    }
  | { kind: "trigger_cause"; causes: TriggerEventCause[] }
  /**
   * トリガーを引き起こした効果のソースカードの印字カテゴリで限定。
   * 「マジック以外の自分の効果で〜」(BSES01-C01) のように、効果の発生源カードの種別
   * (spirit/nexus/magic/brave/ultimate) によって誘発をゲートする用途。
   * include は in-list、exclude は not-in-list で AND（両方指定可）。
   * triggerContext.sourceCategory が必須（sourceCard へのフォールバックは行わない —
   * 自カード = 回収対象の category が一致して誤発火するため）。
   */
  | {
      kind: "trigger_source_category";
      include?: CardCategory[];
      exclude?: CardCategory[];
    }
  | { kind: "colors"; colors: CardColor[] }
  | { kind: "tribes"; tribes: string[] }
  | { kind: "self_color_count"; min?: number; max?: number }
  | { kind: "self_soul_state" }
  | { kind: "grandwalker_core_count"; min?: number; max?: number }
  | {
      /**
       * <ソウルコア> の所在ゾーン判定（10_rules/06_core-system.md「ソウルコアは少なくとも
       * フィールド上のカード/リザーブ/トラッシュに存在し得る」+ ライフにも置ける、
       * 2026-06-09 撤回済み）。`zones` のいずれかにソウルコアがあれば true（OR）、
       * `negate:true` で「いずれのゾーンにも無ければ」を表現する（BSLH01-C11
       * 「フィールド/リザーブにソウルコアが無ければ」等）。field はカード個体の
       * `CardInstance.soulCoreCount`（SSOT, core-system.ts）、reserve/trash/life は
       * プレイヤーのロケーション別カウント（`PlayerState.reserveSoulCoreCount` 等、
       * 同 SSOT が dual-write）を見る。
       */
      kind: "soul_core_zone";
      player: EffectPlayerRef;
      zones: ("field" | "reserve" | "trash" | "life")[];
      negate?: boolean;
    }
  | { kind: "in_battle"; state?: "attacking" | "blocking" }
  | {
      /**
       * 現在のステップ判定。「アタックステップなら」「メインステップに」等の
       * ステップ単位サブ条件を表す（state.step との一致）。ターンプレイヤー軸は
       * whose で絞る:
       *   - "self"     = 効果コントローラーのターンの当該ステップ（自分のアタックステップ等）
       *   - "opponent" = 相手のターンの当該ステップ（相手のアタックステップ等）
       *   - "either"   = どちらのターンでも当該ステップ（『お互いのアタックステップ』）。省略時の既定。
       * ルール: 10_rules/02 のステップ分類（STEP_ORDER）。state.step / state.activePlayerId を参照。
       * TimingScope（効果窓全体のステップ限定）と異なり、効果内の特定 step を
       * サブ条件としてゲートする用途（「フラッシュで使えるが、アタックステップなら追加で〜」）。
       */
      kind: "step_phase";
      step: Step;
      whose?: EffectPlayerRef;
    }
  | {
      /**
       * ターンプレイヤー判定。「自分のターンなら」「自分のターンしか発揮されない」
       * 「相手のターンなら」等の発揮条件を表す。player で参照するターンプレイヤーを
       * 選ぶ (self = 効果コントローラーのターン, opponent = 相手のターン)。
       * ルール: 10_rules/02 L105「メインステップでは、ターンプレイヤーが…」
       * (ターンプレイヤー = state.activePlayerId)。
       */
      kind: "turn_player";
      player: EffectPlayerRef;
    }
  | {
      /**
       * 独自拡張: カードの使用履歴を参照する条件句。
       * 「フラッシュ効果使用後以外で」「スタック効果使用後以外で」「カードを使用後」など。
       * scope で参照範囲を絞る。"latest" は現在の step/attackId 文脈で直近の
       * カード使用だけを参照する（「カードを使用後」型の直後ゲート）。
       * mode で "flash"（既定）/"main"/"stack"/"play"/"any" を選ぶ
       * （BSAZ01-C08/C09 等の【タイプ：作戦】がスタック窓を開くカードは
       * "スタック効果使用後以外で" と書かれるため。BSFT01-CX01 の「カードを使用後」は
       * mode:"any" で見出し種別を問わない）。flashCardUsageLog の各エントリが実際に使用された
       * mode を保持し、ここで絞り込む。negate=true で「〜していない」判定。
       * cardFilter で特定のカードに絞り込み可能。
       * 裁定ソース: memory/project_flash_usage_ruling.md (2026-04-16 ユーザー裁定)。
       */
      kind: "flash_used";
      target: "card_usage";
      scope: "latest" | "step" | "battle" | "turn" | "game";
      player: EffectPlayerRef;
      mode?: "main" | "flash" | "stack" | "play" | "any";
      completion?: "declared" | "completed" | "any";
      /**
       * card_event の「このカード」のように、条件評価中の source instance と
       * 実際に使用した cardInstanceId が同一であることを要求する。
       * cardFilter の同名照合だけでは同名別 instance を区別できない自己参照向け。
       */
      sameInstanceAsSource?: boolean;
      negate?: boolean;
      cardFilter?: import("./dsl-types").CardFilter;
    }
  | {
      /**
       * 独自拡張: フラッシュ効果の発揮履歴を参照する条件句。
       * effect activation log は現在 flash 効果のみを記録するため、mode は持たせない。
       */
      kind: "flash_used";
      target: "effect_activation";
      scope: "latest" | "step" | "battle" | "turn" | "game";
      player: EffectPlayerRef;
      negate?: boolean;
      cardFilter?: import("./dsl-types").CardFilter;
    }
  | {
      /**
       * 「このカードの召喚/煌臨等で【神託/導託】していないとき」判定
       * (BSTH02-C01 effects[0] 等)。sourceInstanceId をトリガーカードとして、
       * `triggerKind` の発生でいずれかの自分の創界神/導界者ネクサスに神託が
       * enqueue され得るかを、副作用なしで判定する。判定ロジックは
       * oracle-system.ts の `wouldQueueOracleChoices`（checkAndQueueOracleChoices
       * と同一の対象条件・ボイドコア有無・ステップ1回制限判定を共有する SSOT）。
       * `negate:true` で「していないとき」（=いずれの神託も enqueue されない）判定になる。
       */
      kind: "oracle_would_trigger";
      triggerKind: OracleTriggerKind;
      negate?: boolean;
    }
  | {
      /**
       * 独自拡張: 他カードのアタック宣言履歴を参照する条件句。
       * 「自分の系統：○○を持つスピリットがアタックしたとき、下の効果を発揮できる」型
       * (BSSL01-M01 等)、他カードのアタックを発火点にした発揮解禁ゲートを表現する
       * (`flash_used` と対称構造。attackDeclarationLog を SSOT とする)。
       * target で「アタック宣言をしたカード」を player/cardFilter で絞り込み、
       * scope で参照範囲を絞る。negate=true で「〜していない」判定。
       * `targetFilter` は指定アタックの対象カードを絞り込む (BSAZ02-M01 型「相手が
       * 系統『火星』を持つ自分のアルティメットに指定アタックしたとき」)。通常アタック
       * (指定アタックでない宣言) の log entry は `designatedTargetDefinitionId` を
       * 持たないため `targetFilter` 指定時は一致しない。
       * `targetControllerLifeAtDeclaration` は指定アタック対象カードのコントローラーが
       * 宣言時点で満たしていたライフコア数を絞り込む (BSAZ02-M01「自分のライフが1のとき、
       * 相手は…指定アタックできる。そうした相手のターン終了時、…」の「そうした」= 宣言成立の
       * 事実自体を指す裁定 [needs-ruling.jsonl:BSAZ02-M01 resolution A]。ターン終了時点の
       * 現在ライフを再評価すると宣言後の増減で誤判定するため、
       * `AttackDeclarationLogEntry.designatedTargetControllerLifeAtDeclaration` の
       * 宣言時スナップショットと照合する)。
       */
      kind: "attack_occurred";
      scope: "step" | "battle" | "turn" | "game";
      player: EffectPlayerRef;
      /** 絞り込んだ宣言のN回目が現在のバトルか。未成立のアタック宣言窓も含む。 */
      currentBattleOrdinal?: number;
      negate?: boolean;
      cardFilter?: import("./dsl-types").CardFilter;
      targetFilter?: import("./dsl-types").CardFilter;
      targetControllerLifeAtDeclaration?: { min?: number; max?: number };
    }
  | {
      /**
       * 独自拡張: 【セット中】(ミラージュ/バースト) 効果由来のドロー履歴を参照する条件句。
       * 「このターン、自分がミラージュ効果でドローしていなければ」型の排他ゲート
       * (BSGE01-C03/C10 初出。同一プレイヤーが複数の同型 set-effect を重ねて使えないようにする
       * アンチコンボ条件)。`attack_occurred`/`flash_used` と対称構造で mirageSetDrawLog を
       * SSOT とする。negate=true で「〜していない」判定 (カード文言の「していなければ」に対応)。
       */
      kind: "mirage_draw_occurred";
      scope: "turn" | "game";
      player: EffectPlayerRef;
      negate?: boolean;
    }
  | {
      /**
       * `timing.deferredTo:"battle_end"` 効果限定: 直前に終了したバトルがブロックされていたか
       * (「ブロックされたバトルの終了時」型、BSFT01-X01[7,8] 初出)。判定は
       * `fireBattleEndDeferrals`（battle-actions.ts）が battleResolutionGroup.participantSnapshots
       * の `blockedBy` から算出し `TriggerContext.battleWasBlocked` 経由で運ぶ。deferredTo 以外の
       * 通常 condition 評価では triggerContext が渡らないため常に false（安全側）。
       */
      kind: "battle_was_blocked";
    }
  | {
      /**
       * `timing.deferredTo:"battle_end"` 効果限定: 直前に終了したバトルで対象プレイヤー
       * （攻撃を受けた側）のライフが実際に減ったか（「このスピリットのアタックで相手のライフが
       * 減っていないとき」型、BSTH05-X04[6,7] 初出）。判定は `battle-actions.ts` の
       * `executeBattleResolution` が算出した `appliedLifeDamage`（このバトルで実際に
       * 適用されたライフ減少量）を `fireBattleEndDeferrals` へ渡し、
       * `TriggerContext.battleLifeReduced` 経由で運ぶ。`battle_was_blocked` と同様、
       * deferredTo 以外の通常 condition 評価では triggerContext が渡らないため常に false
       * （安全側）。`negate:true` で「減っていないとき」を表現する。
       */
      kind: "battle_life_reduced";
      negate?: boolean;
    };

/** 効果条件。ConditionClause の配列（全て AND）。 */
export type Condition = ConditionClause[];

/** @deprecated Condition を使用してください。後方互換用。 */
export type EffectCondition = Condition;

export interface CardInstance {
  /** フィールドで効果により指定された隣接位置。ゾーン離脱時に解除する。 */
  fieldPosition?:
    | { anchorInstanceId: string; side: "left" | "right" }
    | undefined;
  instanceId: string;
  definitionId: string;
  /** 転醒で裏返った場合でも元の A 面 definitionId を保持。フィールド離脱時に A 面に自動復帰するために使用。 */
  originalDefinitionId: string;
  ownerPlayerId: string;
  controllerPlayerId: string;
  zone: Zone;
  /** in_useへ入る直前の実ゾーン。召喚元・使用コスト条件に用い、手札枚数には含めない。 */
  inUseSourceZone?: Zone | undefined;
  zoneRoleName: string;
  normalCoreCount: number;
  /**
   * このカード上のソウルコア数（複数個対応 S2, P3-101）。`normalCoreCount` と対称。
   * `isSoulCoreOn`/`getTotalCoresOnCardById` の SSOT (core-system.ts)。
   * `moveSoulCore` が `PlayerState.soulCoreLocation`（旧 SSOT、依然 ownership 判定の
   * 正源）と dual-write で同期する。旧 soulCoreLocation を直接読む経路
   * (14ファイル超, S2 blast radius 未移行分) は本フィールドとは独立に動作継続する。
   */
  soulCoreCount: number;
  /**
   * このカード上に（通常/ソウルいずれかの）コアが 1 個以上置かれたことがゲーム中に
   * 一度でもあったかの一方向ラッチ（engine-bsth02-c21-cumulative-core-cost-fix、
   * BSTH02-C21「ゲーム中にコア1個以上を置かれた相手の創界神ネクサス」）。一度 true に
   * なると、コアが全て離れて 0 になっても false へは戻らない（zone 移動でも維持。
   * カードが新規 instance として再生成された場合のみリセットされる）。
   * `updateNormalCoreCountAtLocation` / `updateSoulCoreCountAtLocation`
   * (core-system.ts、"card" ロケーションの単一書き込み経路) が唯一の更新箇所。
   */
  everHadCorePlaced: boolean;
  minimumRequiredCores: number;
  exhaustState: ExhaustState;
  /**
   * 「防げない」疲労効果で疲労したことを示すプロヴェナンス。
   * スピリット状態で疲労しない系ブレイヴは通常の疲労状態を SBA/分離で回復するが、
   * この印がある場合だけ例外として疲労状態を保持する。省略時は false と同義。
   */
  exhaustedByUnpreventableEffect?: boolean;
  /**
   * engine-exhaust-provenance-skip-refresh (BSLH01-C04): 「次のリフレッシュステップでは
   * 回復できない」1回限定マーカー。`prevent_next_recovery` Action で true になり、
   * `refreshExhaustStates` が次回の一段階回復（重疲労→疲労も含む）を禁止し、
   * 回復状態でも同時に false へ戻す。省略時 (undefined) = false と同義。
   */
  skipNextRefreshRecovery?: boolean;
  pendingLeaveKind: PendingLeaveKind | null;
  pendingLeaveCause: PendingLeaveCause | null;
  pendingLeaveChainId: string | null;
  deferZoneMoveUntilChainEnd: boolean;
  attachedToInstanceId: string | null;
  attachedChildrenIds: string[];
  /**
   * 異魔神ブレイヴ（`imaginBraveData` 保有）の右合体スロットホスト instanceId
   * (10_rules/08c §7)。左合体スロットは既存の汎用単一合体 `attachedToInstanceId` /
   * 相手側 `attachedChildrenIds` をそのまま流用し（通常のブレイヴ合体と完全互換）、
   * 右合体スロットだけをこの独立フィールドで追跡する。通常ブレイヴは常に null。
   * 右ホスト側の `attachedChildrenIds` には追加しない（P3-16 多重合体の相互整合性
   * invariant を汚さないための意図的な非対称設計）。片方離脱時のクリンナップ・
   * シンボル個別加算は未配線（後続 cluster）。「疲労しない」は
   * `isCardExhaustionForbidden` を疲労 primitive と battle 宣言で共有する。
   */
  imaginRightCombinedWith: string | null;
  /**
   * 消滅待機に入った時点での Lv スナップショット（Ver.17.0 例2）。
   * `runStateBasedActions` がフィールドで安定しているスピリットの実効 Lv を毎パス
   * ローリング記録し、消滅待機へ遷移した瞬間の直前値で凍結する。コアが全移動して
   * Lv0 になっても「Lv2 で消滅した」を再現でき、消滅時 / フィールドを離れるときの
   * Lv 依存効果と Lv/BP 表示に使う。`pendingLeaveKind==="vanish"` の間、実効 Lv 算出の
   * 単一の正源 `getEffectiveLevel` がこの値を返し、Lv/BP 表示・effective identity・
   * Lv 条件評価（`getCardCurrentLevel` は `getEffectiveLevel` へ委譲）が同一値を共有する。
   */
  pendingLeaveLvSnapshot: number | null;
  /**
   * アンダーカード（このカードの「下」に置かれたカード）の役割付きスタック。
   * role='advent_source'=煌臨元（表向きで下に重なる。表向き煌臨元≧1枚 → 【煌臨中】。
   * フィールド離脱時はホストと同じ場所へ一括移動）。role='text_role'=星霊衣/アルドノア/
   * バレットエディット系（挙動はカードテキストで per-card 定義。離脱時処遇は face-down policy 既定）。
   * 煌臨元の読み取りは `adventSourceIdsOf()` を正源 helper として経由する。
   */
  underCards: UnderCardEntry[];
  /**
   * 転神/転者状態。null でなければこのターン中スピリットとしても扱う。
   * ターン終了時に null にリセットされる。
   */
  divineTransformState: DivineTransformState | null;
  /**
   * 裏向き状態。true の場合、相手プレイヤーに対して定義情報 (definitionId 等) を秘匿する。
   * 主に F-1 (裏向きフィールド配置 / フランドール【フォーオブアカインド】等) で使用。
   * *フィールド上の裏向き配置状態* を表す。ゾーン移動時は `applyFaceDownPolicyOnZoneChange`
   * が常に解除し通常カードに戻す (2026-05-29 裁定)。相手への秘匿は移動先ゾーンの可視性が
   * 担保する。「裏向きで置く/戻す」と明記された効果のみ `move_card.faceDown:true` で再設定する。
   */
  faceDown: boolean;
  /** Identity remains absent, but both players may inspect this face-down card (qa-056). */
  faceDownContentsPublic?: boolean;
  /**
   * `zone:"revealed"` の一時公開範囲。未設定は従来互換で "both"。
   * 「内容を見る」型は "self" にし、相手 viewer では state-sanitize が定義情報を伏せる。
   */
  revealedTo?: "self" | "opponent" | "both";
  /** `revealedTo` の self/opponent 判定基準になる効果解決者。 */
  revealedByPlayerId?: string;
  /** デッキ内での既知範囲。位置・名前は実体から導出し、viewer には配送しない。null は既知位置なしを確定済み。 */
  deckKnowledge?: {
    audience: PublicDisclosureAudience;
    actorPlayerId: string;
  } | null;
  /**
   * このカードが場に入った際の「配置したとき」神託/導託 (`checkAndQueuePlacementOracle`) を
   * 不発にする単発フラグ (BSAZ02-C17「配置した導界者ネクサスの『配置したとき』の【導託】は
   * 発揮されない」)。`SummonAction.suppressPlacementOracle` 経由で配置と同時に true が
   * 設定される。**`effect-resolution.ts finalizeEffectResolution` のフィールド新規進入
   * diff パスが唯一の消費点** — 読み取ると同時に必ず false へ戻すため、CardInstance に
   * 常駐する値としては基本的に false のみが観測される（move_card 等 suppressPlacementOracle
   * を経由しない別経路での将来の再配置へ persist しない、verifier round1 指摘の修正）。
   */
  oraclePlacementSuppressed: boolean;
  /**
   * text_role アンダーカードが host 離脱により完全 detach された際の由来マーカー
   * (ENGINE-x03-cross-zone-aldnoah-drive-transfer、BSAZ02-X03)。host が場を離れると
   * `flushPendingLeaves` (state-based-actions.ts) が host.underCards を即座に空にし
   * `attachedToInstanceId: null` にする (07b §6) ため、detach 後は子カード単体からしか
   * 元 host の情報を辿れない。detach の瞬間の host 実効カード名 (`resolveActAsSpiritCardName`
   * 経由、override_properties 由来の一般 cardName 上書きは対象外の限定的な実装) + roleTag を
   * ここに記録する。`place_text_role_under_card` の `moveFrom:"field_or_trash_host"` が
   * このマーカーを消費し、再アタッチ時に null へ戻す。それ以外の消費箇所は無い。
   */
  detachedUnderCardOrigin: {
    hostCardNameEffective: string;
    roleTag: string;
  } | null;
  /**
   * P3-129 (ENGINE-triggered-hand-zone-immunity-dynamic-scope): 「Xが起きたとき、以後、相手側の
   * 誘発効果が未解決の間だけYが真」型の動的スコープ相関。key → 発火時点の
   * `PendingTriggeredEffect.pendingId` の集合。`correlate_pending_trigger` Action が
   * 唯一の書き込み経路（発火のたび append、解決済み id の自動除去はしない — 生存判定は
   * 読み取り側 `ConditionClause.correlated_pending_trigger_active` が
   * `state.pendingTriggeredEffects` に対して行うため stale id は単に無害に false 化する）。
   * 発火元自身の登録 source が resolve された後もこの pendingId が
   * `state.pendingTriggeredEffects` に残っていれば、同一 event に対する相手側の別 source が
   * まだ未解決であることを意味する (2人対戦前提、同一 event に自分側の複数 source が
   * 併存する場合は近似が崩れる点に注意)。BSTH07-転醒X02(A)【神秘】等。
   */
  pendingTriggerCorrelations?: Readonly<Record<string, readonly string[]>>;
  /**
   * このカードが現在の `zone` に入った時点の `state.turnNumber`
   * (ENGINE-accel-tribe-cost-override)。「このカードが〜に置かれたターンの間」型の
   * 継続効果ゲート用 SSOT。`moveCardZone` (core-system.ts、唯一の書き込み経路) が
   * ゾーン変更時に現在ターン番号で上書きする。`ConditionClause.self_state`
   * `state:"zone_entered_this_turn"` が `state.turnNumber === zoneEnteredAtTurn` を見て
   * 「今がその配置ターンか」を判定する。継続効果 duration ではなく condition で表現する
   * 理由: `duration:{scope:"turn"}` は登録のたび `createdAtTurn` を現在ターンで
   * 再スタンプしてしまい、`rebuildContinuousEffectsFromField` の期限切れ→再登録サイクルで
   * 「配置ターンだけ」ではなく「常に有効」になってしまう (2026-07-31 特定)。condition なら
   * ターン経過で恒久的に false になり再登録が自然に止まる。moveCardZone を経由しない
   * ゾーン変更 (play-card-resolution.ts の召喚等) は現状スタンプ対象外 — 本フィールドを
   * 使う効果は set_aside 進入 (アクセル/チェンジ経由、必ず moveCardZone を通る) 限定。
   */
  zoneEnteredAtTurn: number;
  /** 実際にフィールドを離れるごとに増える個体世代。物理カードの instanceId は維持。未設定は 0。 */
  fieldInstanceGeneration?: number;
  /** 魂状態への移行ごとに進む世代。【魂状態】を含まない効果の個体制限を区別する。 */
  soulStateGeneration?: number;
}

const FIELD_NON_CARD_STATE_ROLE_NAMES = new Set([
  "spirit",
  "ultimate",
  "brave",
  "nexus",
  "magic",
  "quartz",
  "arts",
]);

/**
 * カード状態か、フィールドの実体として扱われているかの共通判定。
 * 印字種類とは別軸で、表裏を問わずカード状態は実体を持たない。
 * 分身などの状態付与は実体を与えるが、魂状態・下のカード・非フィールドには適用しない。
 * 「このカード」だけを指す自己修飾、戦闘資格、フィールド表示で共有する。
 * 効果源の種類照合には使わない。Q3641: スピリットカードの効果もスピリットの効果。
 */
export function isCardTextCardState(
  card: Pick<CardInstance, "instanceId" | "zone" | "zoneRoleName"> &
    Partial<Pick<CardInstance, "faceDown" | "divineTransformState">>,
  state?: Partial<
    Pick<
      GameState,
      | "players"
      | "cardInstances"
      | "activeContinuousEffects"
      | "step"
      | "activePlayerId"
      | "window"
    >
  >
): boolean {
  if (
    state?.players?.some((player) =>
      player.soulStateInstanceIds.includes(card.instanceId)
    )
  ) {
    return true;
  }
  if (
    state?.cardInstances?.some((host) =>
      host.underCards?.some((entry) => entry.cardInstanceId === card.instanceId)
    )
  ) {
    return true;
  }
  if (card.zone !== "field") return true;
  if (state?.activeContinuousEffects) {
    const ces = getCEsForTarget(
      { ...state, activeContinuousEffects: state.activeContinuousEffects },
      card.instanceId
    );
    if (
      ces.some(
        (ce) =>
          ce.modifierTag === "act_as_spirit" ||
          (ce.modifierTag === "override_properties" &&
            (
              ce.metadata?.properties as
                | { treatAsCategory?: CardCategory }
                | undefined
            )?.treatAsCategory !== undefined)
      )
    )
      return false;
  }
  if (card.faceDown) return true;
  if (card.divineTransformState) return false;
  return !FIELD_NON_CARD_STATE_ROLE_NAMES.has(card.zoneRoleName);
}

export const BULLET_EDIT_ROLE_TAG = "バレットエディット";
export const LEGACY_BULLET_EDIT_ROLE_TAG = "装弾";

export function normalizeUnderCardRoleTag(roleTag: string): string;
export function normalizeUnderCardRoleTag(roleTag: undefined): undefined;
export function normalizeUnderCardRoleTag(
  roleTag: string | undefined
): string | undefined;
export function normalizeUnderCardRoleTag(
  roleTag: string | undefined
): string | undefined {
  return roleTag === LEGACY_BULLET_EDIT_ROLE_TAG
    ? BULLET_EDIT_ROLE_TAG
    : roleTag;
}

export function underCardRoleTagsEqual(
  left: string | undefined,
  right: string | undefined
): boolean {
  return normalizeUnderCardRoleTag(left) === normalizeUnderCardRoleTag(right);
}

/** アンダーカードの役割。'advent_source'=煌臨元、'text_role'=カードテキスト定義（星霊衣/アルドノア/バレットエディット系）。 */
export type UnderCardRole = "advent_source" | "text_role";

/** アンダーカード（このカードの「下」に置かれたカード）の役割付きエントリ。 */
export interface UnderCardEntry {
  /** 下に置かれたカードの instanceId。 */
  cardInstanceId: string;
  /** 役割。 */
  role: UnderCardRole;
  /** text_role 用の役割タグ（'星霊衣'|'アルドノア'|'バレットエディット' 等、カード定義由来。advent_source では未使用）。 */
  roleTag?: string;
}

/**
 * 煌臨元（role='advent_source'）アンダーカードの instanceId 一覧を返す正源 helper。
 * 表向き煌臨元≧1 → 【煌臨中】判定や、フィールド離脱時の一括移動収集に使う。
 */
export function adventSourceIdsOf(card: {
  underCards?: UnderCardEntry[];
}): string[] {
  const out: string[] = [];
  // ?? [] は旧スナップショット (rename 前 = underCards 不在) のデシリアライズ耐性。
  for (const e of card.underCards ?? []) {
    if (e.role === "advent_source") out.push(e.cardInstanceId);
  }
  return out;
}

/** text_role アンダーカードの instanceId 一覧を roleTag で絞って返す。 */
export function textRoleUnderCardIdsOf(
  card: { underCards?: UnderCardEntry[] },
  roleTag?: string
): string[] {
  const out: string[] = [];
  for (const e of card.underCards ?? []) {
    if (e.role !== "text_role") continue;
    if (roleTag !== undefined && !underCardRoleTagsEqual(e.roleTag, roleTag)) {
      continue;
    }
    out.push(e.cardInstanceId);
  }
  return out;
}

/**
 * アンダーカード（下に置かれたカード）の包含スコープ判定用 instanceId 集合の正源 helper
 * （10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
 *
 * アンダーカードはホストの離脱まで `zone:"field"` を保持するため、ゾーンだけで絞る
 * カウント経路（`field_has`）・参照/対象選択経路（`matchesCardFilter` 候補列挙）の双方が
 * 無印スコープでもこれらを無差別に拾ってしまう。本 helper でカード全体を一度走査し、
 * - `textRole`: 星霊衣/アルドノア/バレットエディット系（role='text_role'）= **常に**無印スコープ外。
 * - `adventSource`: 煌臨元（role='advent_source'）= 「煌臨元を含む」接頭句でのみ opt-in。
 * の 2 集合を返す。count 経路（structured-effect-interpreter の field_has）と
 * reference 経路（target-resolution の候補列挙）が同一集合を共有する SSOT。
 */
export function collectUnderCardScopeIds(state: {
  cardInstances: ReadonlyArray<{ underCards?: UnderCardEntry[] }>;
}): { adventSource: Set<string>; textRole: Set<string> } {
  const adventSource = new Set<string>();
  const textRole = new Set<string>();
  for (const c of state.cardInstances) {
    for (const e of c.underCards ?? []) {
      if (e.role === "advent_source") adventSource.add(e.cardInstanceId);
      else textRole.add(e.cardInstanceId);
    }
  }
  return { adventSource, textRole };
}

/** 下カードの所属は host.underCards が正源。子側の合体リンク有無には依存しない。 */
export function isTextRoleUnderCard(
  state: Pick<GameState, "cardInstances">,
  card: Pick<CardInstance, "instanceId">
): boolean {
  return collectUnderCardScopeIds(state).textRole.has(card.instanceId);
}

export function isAdventSourceUnderCard(
  state: Pick<GameState, "cardInstances">,
  card: Pick<CardInstance, "instanceId">
): boolean {
  return collectUnderCardScopeIds(state).adventSource.has(card.instanceId);
}

/**
 * 指定したカードを参照する host 側 `underCards` エントリを除去する。
 *
 * アンダーカードを独立した場のカードへ戻す経路と、アンダーカード自身が field を離れる
 * 経路で共有する、親→子参照解除の SSOT。role は問わない。
 */
export function stripUnderCardReferences<
  T extends { underCards: UnderCardEntry[] },
>(cardInstances: readonly T[], removedInstanceIds: ReadonlySet<string>): T[] {
  return cardInstances.map((c) =>
    c.underCards.some((entry) => removedInstanceIds.has(entry.cardInstanceId))
      ? {
          ...c,
          underCards: c.underCards.filter(
            (entry) => !removedInstanceIds.has(entry.cardInstanceId)
          ),
        }
      : c
  );
}

/**
 * 煌臨元 (advent_source) アンダーカードを召喚許可等で独立した場のカードへ戻す際の
 * 単一 ID 互換 wrapper (engine-advent-source-summon-permission、BSSL01-X03)。
 */
export function stripAdventSourceUnderCardReference<
  T extends { underCards: UnderCardEntry[] },
>(cardInstances: readonly T[], removedInstanceId: string): T[] {
  return stripUnderCardReferences(cardInstances, new Set([removedInstanceId]));
}

/**
 * 「このスピリット」系の self 参照先を返す正源 helper。
 *
 * 合体中ブレイヴ自身を sourceInstanceId とする効果では、テキスト上の「このスピリット」は
 * attached brave 単体ではなく合体先 host を指す。host が場に存在しない場合は source 自身へ
 * fail-closed に戻す。
 */
export function resolveSelfReferenceCard(
  state: { cardInstances: ReadonlyArray<CardInstance> },
  sourceInstanceId: string,
  includeAdventSourceHost = false
): CardInstance | undefined {
  const source = state.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  if (!source) return undefined;
  if (includeAdventSourceHost) {
    const host = state.cardInstances.find(
      (card) =>
        card.zone === "field" &&
        adventSourceIdsOf(card).includes(sourceInstanceId)
    );
    if (host) return host;
  }
  if (source.attachedToInstanceId) {
    const host = state.cardInstances.find(
      (card) =>
        card.instanceId === source.attachedToInstanceId &&
        card.zone === "field" &&
        card.pendingLeaveKind === null
    );
    if (host) return host;
  }
  return source;
}

export interface BattleEntity {
  entityId: string;
  memberInstanceIds: string[];
  /**
   * Active battle shell only: members that left the field after this entity
   * became part of activeAttack. Kept out of memberInstanceIds so invariants do
   * not treat them as on-field battle members, but copied into battle-end
   * snapshots so the started battle can still reach its battle_end context.
   */
  leftFieldMemberInstanceIds?: string[];
  resolvedBp: number;
  resolvedSymbols: SymbolColor[];
  /** 多色シンボルも1個として数えた個数。旧snapshotはresolvedSymbols.lengthへfallback。 */
  resolvedSymbolCount?: number;
  attackState: "idle" | "attacking" | "blocking";
}

export type ActiveAttackTarget =
  | {
      kind: "player";
      playerId: string;
    }
  | {
      kind: "battle_entity";
      entityId: string;
    };

export interface ActiveAttackBlockAssignment {
  participantEntityId: string;
  /**
   * この participant (アタッカー) をブロックしているカードの entityId 一覧。
   * 空配列 = 未ブロック。通常は 0 or 1 件だが、`require_multi_block` CE
   * (P2-05 Phase 5, BSFT01-TR06(B)型「スピリット2体でないとブロックできず」) が
   * 有効な participant では 2 件以上になりうる。BP 比較は各エントリと個別に
   * 1vs1 で行う (合算比較ではない、10_rules/05b §複数体ブロック強制)。
   */
  blockedByEntityIds: string[];
  /**
   * この participant をブロックするために必要な最小ブロッカー数 (P2-05 Phase 5)。
   * 省略時 1。`require_multi_block` CE を `blockerCapacity` と同じくアタック宣言確定時に
   * スナップショットする (current-actor.ts が `getCardDefinitionById` 無しの純粋関数である
   * ため、実行時の CardFilter 照合ではなく確定済みの数値をここへ持つ)。
   */
  requiredBlockerCount?: number;
}

export type BattleFlashWindowKind = "before_block" | "after_block";

// バースト発動の follow-up 情報: 発動宣言窓を開く際に ActiveStack へ格納し、
// resolveDeferredStackAction 時に参照してフォローアップ処理を再構築する
export interface BurstFollowUpInfo {
  playsSourceCardWithoutCostAfterResolve: boolean;
  usesSourceCardWithoutCostAfterResolve: boolean;
  playsTargetCardWithoutCostAfterResolve: boolean;
  usesTargetCardWithoutCostAfterResolve: boolean;
  // usesTargetCard 用: target magic ごとの targetEffectFilterTags
  targetMagicEffectFilterTagsByInstanceId: Array<{
    instanceId: string;
    targetEffectFilterTags: readonly string[];
  }>;
  // 宣言時のプレイヤー選択 (per-target)
  perTargetFollowUpInputs: Array<{
    targetInstanceId: string;
    enterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
    followUpTargetInstanceIds?: string[];
    followUpChosenLifeCoreKind?: LifeCoreKind | null;
  }>;
  // 宣言時のプレイヤー選択 (グローバル)
  followUpTargetInstanceIds?: string[];
  followUpChosenLifeCoreKind?: LifeCoreKind | null;
}

export interface ActiveStack {
  stackId: string;
  actionKind: EffectResolutionActionKind;
  chainId: string;
  /** 応答効果の派生処理まで待つ順序上の依存。自身の誘発原因 chainId とは別。 */
  waitForResolutionChainIds?: string[];
  actingPlayerId: string;
  cardInstanceId: string;
  cardDefinitionId: string;
  /**
   * 通常の召喚/配置/ミラージュセットで、スタック窓中に宣言自体が違法になった場合に戻す
   * 宣言自身の支払い差分。場入り必要コア不足では使わない（10_rules/03f）。
   *
   * 応答で解決済みの効果・誘発・盤面を巻き戻さないため、GameState 全体の
   * snapshot は保持しない。効果による召喚ではなく、通常行動としての
   * 宣言が保持する（煌臨元・魂状態等からの通常召喚許可も含む）。
   */
  normalHandPlayRollback?: {
    /** 通常行動として宣言した場外カードの元ゾーン。旧 snapshot は hand。 */
    sourceZone?: Zone;
    /** 宣言で in_use へ動かしたカード群の所属だけを復元する。 */
    sourceCards?: readonly Pick<
      CardInstance,
      | "instanceId"
      | "zone"
      | "zoneRoleName"
      | "zoneEnteredAtTurn"
      | "fieldInstanceGeneration"
      | "soulStateGeneration"
    >[];
    sourceUnderCards?: readonly {
      hostInstanceId: string;
      entry: UnderCardEntry;
      index: number;
    }[];
    sourceSoulStateEntries?: readonly {
      playerId: string;
      instanceId: string;
    }[];
    paidCores: readonly (
      | {
          kind: "reserve";
          normalCoreCount: number;
          soulCoreCount: number;
          normalDestination: "trash" | "void";
          soulDestination: "trash" | null;
        }
      | {
          kind: "card";
          instanceId: string;
          normalCoreCount: number;
          soulCoreCount: number;
          normalDestination: "trash" | "void";
          soulDestination: "trash" | null;
        }
    )[];
    /**
     * 宣言に伴う支払いと after-cost-paid で生じた待機反応を識別する。
     * スタック窓の後に宣言自体を戻す場合、相手応答で追加された誘発には触れず、
     * この宣言差分に由来する待機反応だけを撤回する。
     */
    declarationTriggeredEffectPendingIds?: readonly string[];
    /** 上記 pending に対応する非公開誘発宣言。 */
    declarationPrivateDeclarationIds?: readonly string[];
    /**
     * コスト支払い消滅の trigger 検出で増えた occurrence tally の差分。
     * rollback 時に差分だけを引くため、応答側が同じ tally を増やしていても残せる。
     */
    declarationOccurrenceDeltas?: readonly EffectUsageRecord[];
    /** 宣言が消費した使用回数。応答が同じレコードを増やしても増分だけ戻す。 */
    declarationUsageDeltas?: readonly EffectUsageRecord[];
    /** 通常召喚コストで除外したカードの差分。GameState 全体は保存しない。 */
    declarationExcludedCardDeltas?: readonly {
      before: CardInstance;
      after: CardInstance;
    }[];
    /** 宣言内の対価・付随処理によるカウントの符号付き差分。 */
    declarationCountDeltas?: readonly {
      playerId: string;
      amount: number;
      protectedCountDeltas?: readonly { tribe: string; amount: number }[];
    }[];
  };
  /** 窓後に宣言条件を再検査済み。解決手順内のコア移動で再検査しない。 */
  playDeclarationLegalityChecked?: boolean;
  /** 選択・支払い済みの宣言時代替コストによる召喚条件無視。 */
  playDeclarationIgnoresSummonCondition?: boolean;
  /** 宣言内の対価支払い後も成立していた許可条件。自分の支払いを応答と誤認しない。 */
  playDeclarationRecheckCondition?: Condition;
  /** under-card など、場の source card と効果提供 card が異なる場合の効果側 instanceId。 */
  effectSourceInstanceId?: string;
  /** under-card など、場の source card と効果提供 card が異なる場合の効果側 definitionId。 */
  effectSourceDefinitionId?: string;
  targetInstanceIds: string[];
  /** targetInstanceIds を適用する DSL step id。未指定時は従来通り最初の対象 step で消費する。 */
  targetStepId?: string;
  /** 複数ロール対象を step ごとに再割り当てするための宣言時 target group。 */
  targetGroups?: readonly PendingEffectTargetGroup[];
  /** optional repeat など、同一 instanceId を複数回の対象選択として扱う場合に true。 */
  allowDuplicateTargets?: boolean;
  /** 単一 targetGroups なし対象の宣言時候補 zone。未指定時は従来通り field。 */
  candidateTargetZones?: readonly Zone[];
  /** 選択を確定した各対象の実ゾーン。魂状態・煌臨元等の追加候補も同じ存在再検査に通す。 */
  targetZonesByInstanceId?: Readonly<Record<string, Zone>>;
  /**
   * targeted disclosure の応答後に再開する宣言済み TargetRef。対象取得 gate を
   * 再適用せず、先に行う zone presence 再検査と action 固有の affect gate だけを通す。
   */
  preservePreSelectedTargetRefs?: boolean;
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags: readonly string[];
  /**
   * 単一 EffectStep.choice のうち宣言時点で合法だった分岐。
   * choiceIndex は宣言 action へ載せず、スタック窓クローズ後にこの候補から確定する。
   */
  deferredChoiceIndexes?: readonly number[];
  /** 宣言時に固定された軽減後コスト。支払い/解決再開用。 */
  reducedCost?: number;
  /** 宣言時に固定された軽減量。 */
  totalReduction?: number;
  /** 宣言時に実際に満たした軽減シンボル枠数。 */
  satisfiedReductionSymbolCount?: number;
  /** 宣言時に要求された軽減シンボル枠数（追加軽減シンボル込み）。 */
  requiredReductionSymbolCount?: number;
  /**
   * effect_activated 後誘発のうち「使用するとき」の source 存在を要求する
   * registration 用に、宣言時点で候補だった source instance/effect-source ids を保持する。
   */
  eligibleSourceInstanceIdsAtEffectActivationStart?: string[];
  /** 宣言時に固定された追加コスト。deferred 解決時の cost_paid_this_effect 復元に使う。 */
  additionalCost?: number;
  /** 宣言時に実際に支払った最終コスト。deferred 解決時の cost_paid_this_effect 復元に使う。 */
  finalCost?: number;
  /**
   * 発揮前/場入り前の cost filter 判定用の現在コスト。
   * 自己 cost override / fixed payment は反映し、通常のシンボル軽減は反映しない。
   */
  costForFilter?: number;
  /** magic 用: 宣言時に選んだタイミング (deferred 解決で effect filter として使う)。 */
  chosenTiming?: "main" | "flash" | "stack";
  /** 見出しラベル由来の起動効果カテゴリ。未指定時は chosenTiming 相当。 */
  activationLabel?: ActivatedEffectLabel;
  /** magic 用: 宣言時点の実効色。解決後 hook で手札 zone 固有の treat_as_color を失わないため保持する。 */
  magicEffectiveColors?: readonly CardColor[] | undefined;
  /**
   * magic 用: 宣言時点で magicCard がいたゾーン (手札/手元/トラッシュ)。in_use へ移動する前のスナップショット。
   * `StepCondition.kind === "activation_zone"` の解決元 (ENGINE-magic-activation-source-zone-condition)。
   */
  magicActivationZone?: "hand" | "set_aside" | "trash" | "field";
  /**
   * 宣言時点のソースゾーン。magic は後方互換の magicActivationZone も持つが、
   * accel/change/hand_card_effect を含む汎用 pay-to-act gate がこの snapshot を参照する。
   */
  sourceActivationZone?: EffectActivationSourceZone;
  /** Physical declaration origin when an access rule treats another zone as hand. */
  sourcePhysicalZone?: EffectActivationSourceZone;
  /**
   * source が in_use にある間だけ、初回 applicability 判定で用いる元ゾーン。
   * `activationZone` と異なり step condition / battle-end source 残留要件へは伝播しない。
   */
  applicabilityEvaluationZone?: EffectActivationSourceZone;
  /**
   * ENGINE-leave-field-free-use-stay-on-field-flush-gate: 三者観測 game_event
   * (例: leave_field) の主語 Y を、use_magic_without_cost 経由で別 effectIndex
   * (flash 本体) まで発揮解決する際に引き継ぐための snapshot。resolveMagicMainAndMoveToTrash
   * まで到達すると effect-interpreter.ts の stepCtx.triggerRelatedInstanceId(s) に復元され、
   * TargetSpec.kind:"trigger_related_instance"（BSAZ01-C03 等）が別 effectIndex からでも
   * 解決できる (三者観測 game_event の主語伝播、effect-resolution.ts:341 と同じ概念の
   * 別経路への延長)。
   */
  magicTriggerRelatedInstanceId?: string;
  magicTriggerRelatedInstanceIds?: readonly string[];
  /** magic 用: choice ステップの選択肢インデックス (宣言時に選択した分岐)。
   * deferred 解決時に EffectActionContext.choiceIndex へ復元し、
   * lookupRegistrationForStack の変種マージ (窓後対象選択) にも使う。 */
  magicChoiceIndex?: number;
  /** magic 用: 解決対象の DSL effect index。 */
  magicEffectIndex?: number;
  fieldEffectSourceKind?: string; // field_card_effect 用
  /** field_card_effect 用: choice / optional repeat の選択肢インデックス。 */
  fieldEffectChoiceIndex?: number;
  /** field_card_effect 用: `RegisteredFieldCardEffectAction[]` 内の登録 index。
   * 同一カードに複数の activated/flash 効果がある場合 (BSTH01-X04 フランドール 等)、
   * どの効果が宣言されたかを保持する。effect text 抽出等の GUI 表示で利用。 */
  fieldEffectRegistrationIndex?: number;
  /** field_card_effect 用: 宣言された登録が指す DSL `effects[]` index。 */
  fieldEffectIndex?: number;
  /** hand_card_effect 用: 解決対象の DSL effect index。
   * deferred 解決で `targetEffectIndex` として効果解決へ渡し、当該起動効果のみを実行する
   * (手札起動効果は手札からの自己召喚を含み得るためフィールド在席を要求しない)。 */
  handActivatedEffectIndex?: number;
  /** hand_card_effect 用: choice / optional repeat の選択肢インデックス。 */
  handActivatedChoiceIndex?: number;
  /** summon/place permission 由来の play-card stack で、原因効果 index を保持する。 */
  sourceEffectIndex?: number;
  /** set_mirage 用: 宣言時に確定した入れ替え対象。窓中の盤面変化で再選択しない。 */
  mirageReplacedInstanceIds?: readonly string[];
  /** set_mirage 用: 既存ミラージュを維持して追加する宣言だったか。 */
  mirageKeepExistingMirages?: boolean;
  /** set_mirage 用: セット回数免除を消費する宣言だったか。 */
  mirageSetCountExemptionConsumed?: boolean;
  /** set_quartz 用: 宣言時に確定したセット先 host。 */
  quartzHostInstanceId?: string;
  /** set_quartz 用: 宣言時に確定したセット先スロット。 */
  quartzSlot?: "left" | "center" | "right";
  /** クォーツ入れ替え先。解決時にも同じhost/位置にあることを検証する。 */
  replacedQuartzInstanceId?: string;
  enterFieldCorePlacements?: readonly EnterFieldCorePlacement[]; // play_card 用
  /**
   * ブレイヴ直接合体召喚用: 場入りと同時に合体させるホスト instanceId。
   * 宣言時ではなく、スタック窓クローズ後の解決時に開く合体選択 pending
   * (`pendingBraveCombineChoice`) で確定し、ここへ書き込む。以降
   * `resolveDeferredPlayCardWithPlacement` の attach + ブレイヴ上コアのホスト移動へ復元する。
   * スピリット状態召喚では undefined。
   */
  combineHostInstanceId?: string;
  /**
   * ブレイヴ召喚で合体選択 pending を一度処理済みかどうか。
   * true なら resolveDeferredStackAction は合体選択を再提示せず場入り配置へ進む。
   * (スピリット状態を選んだ場合は combineHostInstanceId 未設定のまま true になる)
   */
  braveCombineChoiceResolved?: boolean;
  /**
   * declare_advent / host_dual_advent 用: 窓後の「ソウルコアを置いたものとして」
   * 選択で代替コスト経路を選んだか。発揮宣言時には固定しない。
   */
  adventUseAlternateCost?: boolean;
  /** 煌臨前の追加選択の確定結果。空配列は追加を辞退済み。 */
  adventSelectedSourceIds?: string[];
  /** 常時の煌臨許可を利用する場合の許可元。窓後の支払い方法選択で確定する。 */
  adventGrantSourceInstanceId?: string;
  /**
   * 契約合体 / 煌臨系の「ソウルコアを置いたものとして」選択を窓後に処理済みか。
   * true のとき resolveDeferredStackAction は同じ選択 pending を再生成しない。
   */
  asIfSoulCoreChoiceResolved?: boolean;
  /**
   * 転召（召喚手順内ステップ）の強制コア消費を処理済みかどうか。
   * true なら resolveDeferredStackAction は転召選択を再提示せず維持コア配置へ進む。
   * 転召を持たないカード / 解決時に対象不在だった場合も（不発確定後に）true になる。
   * ルール正源: 10_rules/07b 転召節 + 02:188（コスト支払い完了後にスタック窓、転召はその後・場入り前）。
   */
  tenshoResolved?: boolean;
  /**
   * gate_flash_stack_core (BSTS01-M03) の発揮前提コア除去を処理済みかどうか。
   * true なら resolveDeferredStackAction はゲートを再提示せず通常解決へ進む
   * (粒度＝発揮1回ごとにコア1個なので、本フラグはこの ActiveStack 解決でのみ立つ)。
   * ゲート CE が無い / コア除去不要 (耐性持ち効果・全ゲートが同名抑止済み) の場合も true になる。
   */
  payToActGateResolved?: boolean;
  /**
   * gate_flash_stack_hand_discard の発揮前提手札破棄を処理済みかどうか。
   * core gate と同時に存在しても片方の resolved フラグで他方を飛ばさないため分離する。
   */
  payToActHandDiscardGateResolved?: boolean;
  burstCheckId?: string; // burst_activation 用: 解決対象の checkId
  /**
   * burst_activation 用: 発動宣言時点の pendingBurstCheck snapshot。
   * choice / target 等で stack 解決が中断したあと、state 側の pending が先に消費済みでも
   * 同じバースト解決として再開できるように保持する。
   */
  burstPendingSnapshot?: PendingBurstCheck;
  /** burst_activation 用: 発動宣言時の所在。応答で別ゾーンへ移動した発動を再開しない。 */
  burstActivationSourceZone?: Zone;
  burstSourceKind?: EffectSourceKind; // burst_activation 用: BurstActionRegistration.sourceKind
  /** burst_activation 用: 宣言時に選んだ RegisteredBurstAction の index。 */
  burstRegistrationIndex?: number;
  /** burst_activation 用: choice / optional repeat の選択肢インデックス。 */
  burstChoiceIndex?: number;
  /** バースト効果発揮宣言済み。発動宣言への応答とは窓クローズ後も区別する。 */
  burstEffectDeclared?: boolean;
  /**
   * burst_activation 用: バースト発動キューで「発動する」を選択済みだが、
   * 他の非公開宣言キュー完了まで発動宣言窓を開かず待っている。
   */
  burstActivationWindowPending?: boolean;
  /** burstActivationWindowPending 再開時に復元する元 window。 */
  burstActivationPreviousWindow?: Window;
  /**
   * burst_activation 用: 発動宣言窓は閉じたが、効果発揮宣言窓を
   * 「他の効果をすべて解決後」まで遅延している。
   */
  burstEffectDeclarationPending?: boolean;
  /** burstEffectDeclarationPending 再開時に復元する元 window。 */
  burstEffectDeclarationPreviousWindow?: Window;
  burstFollowUpInfo?: BurstFollowUpInfo; // burst_activation 用: follow-up 情報 (hasFollowUp=true 時)
  /** triggered_effect 用: 発揮宣言した PendingTriggeredEffect の snapshot。
   * deferred 解決時に re-insert + useResolvePendingTriggeredEffectAsAction で利用。 */
  triggeredPendingSnapshot?: PendingTriggeredEffect;
  /** triggered_effect 用: registration index (composition / reevaluation / usageLimit 再構築用)。 */
  triggeredRegistrationIndex?: number;
  /** triggered_effect 用: source card no (registration lookup 用)。 */
  triggeredSourceCardNo?: string;
  /** triggered_effect 用: source kind (FieldEffectSourceKind)。 */
  triggeredSourceKind?: FieldEffectSourceKind;
  /** triggered_effect 用: choice index (declaration 時に選択した分岐)。 */
  triggeredChoiceIndex?: number;
  /** triggered_effect 用: declaration 時にすでに usageLimit 消費済みかどうか。 */
  triggeredUsageLimitConsumedOnDeclaration?: boolean;
  /** triggered_effect 用: declaration 時に判定済みの effect suppression 状態。 */
  triggeredEffectSuppressed?: boolean;
  /** battle_immediate_effect 用: 発揮宣言した BattleImmediateEffect の snapshot。
   * deferred 解決時に re-insert + useBattleImmediateEffectAsAction で利用。 */
  battleImmediatePromptSnapshot?: BattleImmediateEffect;
  /** battle_immediate_effect 用: registration index (composition / reevaluation / usageLimit 再構築用)。 */
  battleImmediateRegistrationIndex?: number;
  /** battle_immediate_effect 用: source card no (registration lookup 用)。 */
  battleImmediateSourceCardNo?: string;
  /** battle_immediate_effect 用: source kind (BattleImmediateEffectSourceKind)。 */
  battleImmediateSourceKind?: BattleImmediateEffectSourceKind;
  /** battle_immediate_effect 用: choice index (declaration 時に選択した分岐)。 */
  battleImmediateChoiceIndex?: number;
  /** battle_immediate_effect 用: declaration 時に判定済みの prevention level。 */
  battleImmediatePreventionLevel?: EffectPreventionLevel;
  /** divine_skill 用: DivineSkillEntry の index (grandwalkerData.divineSkills[]）。 */
  divineSkillIndex?: number;
  /**
   * divine_skill 用: 発揮コスト（創界神上 → ボイドに置くコア数）。
   * 「コアをボイドに置く」は使用コストではなく効果文内のため、宣言時ではなく
   * deferred 解決（窓クローズ後）で支払う。
   */
  divineSkillCoreCost?: number;
  /** 窓後の範囲支払いを確定済み。対象選択からの再開時に二重払いしない。 */
  divineSkillCoreCostPaid?: boolean;
  /** divine_skill 用: スキル種別ラベル (divine_skill / guided_skill / divine_release / contract_skill)。 */
  divineSkillLabel?: string;
  /**
   * divine_skill 用: choice index (declaration 時に選択した分岐。他 actionKind の
   * `*ChoiceIndex` と同型、`getActiveStackChoiceIndex`/`lookupRegistrationForStack` で参照)。
   */
  divineSkillChoiceIndex?: number;
  /**
   * link_aid 用の後方互換フィールド。現行経路では支払い元選択は発揮宣言時ではなく、
   * スタック窓クローズ後の pendingLinkAidCostSourceChoice で行う。
   */
  linkAidCostSourceInstanceId?: string;
  /**
   * contract_combine 用: 窓後のプロキシ起動 (P3-111 S4) 選択で起動コスト
   * （ソウルコアをトラッシュに置く）を免除するかどうか。cardInstanceId は手札の
   * ブレイヴ。合体先ホストは pendingEffectTargetSelection で選ぶ。
   */
  contractCombineCostWaived?: boolean;
  /** contract_combine 用: プロキシ起動元カードの instanceId（使用制限記録キー）。 */
  contractCombineProxySourceInstanceId?: string;
  /**
   * contract_combine 用: 窓後に選んだプロキシ起動元の対象カード名制限。
   */
  contractCombineProxyTargetCardNames?: import("./dsl-types").CardNameMatch[];
  previousResponseSourcePlayerId: string | null; // stack 解決後に戻る先
  previousPendingStackAction: ActiveStack | null; // LIFO 解決用の下位 stack
  previousPriorityPlayerId?: string; // ネスト宣言前の response/flash 窓 priority
  /**
   * 効果が無効化されたかどうか。
   * true の場合、効果解決をスキップしカードをトラッシュへ移動する。
   * 「使用した」事実は残り、コスト支払い済み・トラッシュ移動は通常通り行う。
   */
  isNullified?: boolean;
  /** 再評価ポイント (効果登録からコピー)。deferred stack 解決時に利用。 */
  reevaluationPoints?: readonly EffectReevaluationPoint[];
  /** `suppress_effect` の effectFilter 突き合わせ用記述子 (効果登録からコピー)。 */
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
  /** 防止レベル (効果登録からコピー)。deferred stack 解決時に利用。 */
  preventionLevel?: EffectPreventionLevel;
  /** 防止元 CE の発生源が一致するときだけ target/leave 防止を貫通する profile。 */
  preventionBypass?: TargetLockBypassProfile;
  /** stack negate 専用の防止レベル。target/leave 防止貫通には使わない。 */
  negatePreventionLevel?: EffectPreventionLevel;
  /**
   * engine-generic-effect-activation-causal-trigger cluster: 解決開始時に
   * `paid_leave_suppression_immunity_offer` CE の対価を支払った場合 true。
   * deferred 解決の flush 直前に、この triggered effect (cardInstanceId が host) の
   * 解決によってフィールドを離れる (causedByEffectSourceInstanceId が一致する)
   * カードの destroy/vanish 誘発効果を抑制する。
   */
  suppressCausedLeaveEffects?: boolean;
  /** R04/R02 型の発揮時支払い choice を、この stack で既に処理したか。 */
  paidPreventionImmunityChoiceResolved?: boolean;
  paidLeaveSuppressionChoiceResolved?: boolean;
  /**
   * 発揮時支払いなど、元効果解決前に state だけは更新するが、誘発タイミングは
   * 元効果解決後の通常誘発束に合流させるイベント。
   */
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  /**
   * P3-75: 発揮前 effect_declaration event をこの ActiveStack で既に queue したか。
   * resume 時に同じ発揮前誘発を再生成しないための stack-local marker。
   */
  effectDeclarationTriggerQueued?: boolean;
  /** 効果構成 (効果登録からコピー)。deferred stack 解決時に simultaneous 等を反映。 */
  composition?: EffectComposition;
  /**
   * P3-30: 効果内 `pay_cost` step の支払いソース。
   * 宣言時に保持し、deferred 解決時に EffectActionContext へ復元する。
   */
  payCostPaymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
  /**
   * ことで構文 (`conditional_cost`) の `pay_cost` コア源選択を、宣言時(窓前)でなく
   * 解決時(窓後)へ遅延する意思表示 (GUI が窓前モーダルを抑止したとき true)。
   * deferred 解決時に `allowPendingPayCostSourceAllocation` として executeEffect へ渡し、
   * 配分曖昧なら pendingCoreSourceAllocation を立てて窓後にコア源選択させる。
   */
  deferPayCostSourceSelection?: boolean;
  /**
   * P3-34 B: 効果起点 summon のコスト支払い元。
   * 宣言時に保持し、deferred 解決時に EffectActionContext へ復元する。
   */
  summonPaymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
  /**
   * P3-34 B: 効果起点 summon のフィールド進入時コア配置。
   * 宣言時に保持し、deferred 解決時に EffectActionContext へ復元する。
   */
  summonEnterFieldCorePlacements?: readonly import("./zone/enter-field-placement-execution").EnterFieldCorePlacement[];
  /**
   * pendingEffectTargetSelection で対象選択を完了済みかどうか。
   * 可変選択 (min=0/max>0) で player が能動的に 0 体を選んだとき、resumedStack の
   * targetInstanceIds が空のままになるため、resolveDeferredStackAction が再度
   * getStackTargetSelection を呼ばないようガードする (空選択ループ防止)。
   * 0..N 選択を受理した場合は executeEffect 側で conditional_cost shortage を検出して
   * rollback する。
   */
  targetSelectionResolved?: boolean;
  /**
   * optional repeat の追加回数を窓後に選んだ結果、この stack の対象選択数を
   * exact 指定するための一時値。対象確定後は targetInstanceIds の長さから
   * repeat 実行回数を復元できるため、解決ローカルのメタデータとして扱う。
   */
  optionalRepeatTargetCount?: number;
  /**
   * P3-62: 「発揮できない」(condition unmet / conditional_cost rollback) 時の
   * usageLimit 払い戻し情報。宣言時 (recordEffectUsageIfLimited 呼び出し時) と対になる
   * effectLabel / usageLimit を保持し、deferred 解決時に EffectActionContext.recordedUsage
   * へ復元して executeEffect に伝搬する。
   */
  recordedUsage?: RecordedEffectUsage;
  /**
   * P3-99 起動権 variant: grant_effect で付与された「起動効果」をプレイヤーが能動発揮した
   * スタック。actionKind は "field_card_effect" を流用し、解決を resolveDeferredFieldEffectStack
   * へフォールスルーさせつつ、本フィールドが設定されているときは登録参照ではなく付与 CE
   * (effectId) の metadata.grantedEffect を被付与カード (cardInstanceId = grantee) を source
   * として実行する。
   */
  grantedEffectCeId?: string;
  /**
   * この stack 解決により起動元カードの解決が中断されている場合、最終安定点で発火させる神託。
   * 例: マジック効果内の召喚/配置が維持コア選択で止まった後、そのマジック使用時神託をキューする。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
}

/**
 * 宣言時に記録した usageLimit 消費 1 件分 (払い戻しの最小単位)。
 * effectLabel は記録時と同一でなければ refund が空振りする。
 */
export interface RecordedEffectUsageEntry {
  /** 省略時は refund 呼び出し元の sourceInstanceId を使う。 */
  sourceInstanceId?: string;
  effectLabel: string;
  usageLimit: EffectUsageLimit | readonly EffectUsageLimit[];
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測トリガー主語 Y。
   * refund 時に同じ Y のレコードのみを取り消すため記録する。
   */
  relatedInstanceId?: string;
  /** no_duplicate の per-event scope。record/refund を対称にするため保持する。 */
  triggerEventScopeKey?: string;
}

/**
 * P3-62 払い戻し情報。choice 変種別 usageLimit (「ターンに1回ずつ」) の導入により、
 * 1 回の宣言で effect 共有ラベルと変種別ラベルの 2 記録が併存し得るため、
 * 主記録 + 追加記録 (extraRecords) の形にする。refund は全エントリへ対称に適用する。
 */
export interface RecordedEffectUsage extends RecordedEffectUsageEntry {
  /** 主記録と同時に払い戻す追加記録 (例: effect 共有ラベルと choice 変種別ラベルの併存時)。 */
  extraRecords?: readonly RecordedEffectUsageEntry[];
}

export interface StackInteractionWindowState {
  priorityPlayerId: string; // 現在の priority holder (最初は相手)
  consecutivePassCount: number; // 0 or 1
  stackResponseSourcePlayerId: string | null; // 宣言者=flash timing, 相手=stack timing
  pendingStackAction: ActiveStack | null; // サブスタック保留効果
}

export interface PreDeclarationStackWindow extends Omit<
  StackInteractionWindowState,
  "stackResponseSourcePlayerId"
> {
  kind: "attack" | "block" | "forced_block" | "join_active_attack";
  actingPlayerId: string; // 宣言したプレイヤー
  sourceInstanceId: string; // 攻撃/ブロックするカード
  participantEntityId?: string; // block 専用: ブロック対象の attacker entity
  targetInstanceId?: string; // attack 専用: 指定アタック対象スピリットのインスタンスID (未設定=通常アタック)
  /**
   * attack 専用: 同時アタック宣言の追加参加カード (P2-05)。
   * allow_simultaneous_attack CE がある場合のみ設定される。confirm 時に
   * 個別再検証され、無効になった参加体は脱落する (primary 無効は宣言全体キャンセル)。
   */
  additionalSourceInstanceIds?: string[];
  /** attack 専用: アタック宣言時に選択した疲労コスト支払い元。 */
  attackExhaustCostSourceInstanceId?: string;
  /** attack 専用: attack_exhaust_cost_gate が重複したときの支払い元一覧。 */
  attackExhaustCostSourceInstanceIds?: string[];
  /** attack 専用: 同時アタック追加参加体ごとの疲労コスト支払い元。 */
  additionalAttackExhaustCostSourceInstanceIds?: Record<
    string,
    string | string[]
  >;
  /**
   * attack/block 兼用: 宣言時に選択した battle_destroy_cost_gate 破壊コスト支払い元
   * (BSDB01-C09)。confirm 時の再検証 (getAttackDeclarationBlockReason/
   * getBlockDeclarationBlockReason 再実行) は、既に破壊済みのカードを候補から失って
   * unaffordable と誤判定しうるため、支払い済みなら battle_destroy_cost_gate CE を
   * 除いた state で再検証する (attackExhaustCostSourceInstanceId と同じ回避パターン)。
   */
  battleDestroyCostSourceInstanceId?: string;
  /** attack/block 兼用: battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
  /**
   * attack 専用 (ENGINE-attack-declaration-replacement-primitive): この宣言が確定した際、
   * 通常アタック確定 (designatedTargetInstanceId 不使用) でも指定カードへ forced_block を
   * 強制するための予約。confirmAttackDeclarationAsAction で ActiveAttack.forcedBlockerInstanceId
   * へ引き継がれる。BSRK01-C05『龍咬閃』専用の replace_attack_declaration action が設定する。
   */
  pendingForcedBlockerInstanceId?: string;
  previousWindow: Window; // キャンセル時に復元する窓 (step trigger の再発火防止)
  stackResponseSourcePlayerId: string; // 宣言者=flash timing, 相手=stack timing
}

/**
 * 効果発揮宣言の 1-pass cascade スタック窓。
 *
 * ステップ非依存: start / draw / core / refresh / main / end のいずれでも、
 * 「常時以外の効果発揮」「召喚/配置/使用」「バースト発動」が宣言された際に開く。
 * 旧名 `MainStepStackWindow` (P3-29 時点では main step 想定だったが、P3-34 で
 * 「全ステップでスタックタイミングは発生し得る」裁定に基づき汎用化)。
 *
 * バースト関連の `subStackEverOpened` / `burstWindowKind` はバースト発動経路でのみ使用。
 */
export interface StackWindow extends Omit<
  StackInteractionWindowState,
  "stackResponseSourcePlayerId"
> {
  actingPlayerId: string; // 宣言したプレイヤー
  previousWindow: Window; // stack 窓終了後に復元する元 window
  stackResponseSourcePlayerId: string; // 宣言者=flash timing, 相手=stack timing
  subStackEverOpened: boolean; // この窓の期間中にサブスタックが1回でも開かれたか
  burstWindowKind: "activation" | "effect_declaration" | null; // バースト関連窓の種別 (null=通常)
}

export interface BattleFlashWindowState extends StackInteractionWindowState {
  kind: BattleFlashWindowKind;
  /**
   * `priorityPlayerId` が現在の能動フラッシュ使用連続ストリークで何回目の使用を終えたか
   * (ENGINE-flash-priority-consecutive-use-grant、BSLH01-T15)。既定 0。優先権が別プレイヤーへ
   * 移譲されるたび 0 にリセットされる（不変条件: この値が 1 以上のときは常に
   * `priorityPlayerId` = そのストリークを継続中のプレイヤー）。誘発 (triggered_effect) による
   * 解決や、能動使用に伴わない pass では加算されない。
   */
  consecutiveActiveUseCount?: number;
}

export interface ActiveAttack {
  attackId: string;
  primaryEntityId: string;
  participantEntityIds: string[];
  groupMode: "single" | "simultaneous";
  /**
   * 同時アタックに対する相手のブロック数上限 (P2-05)。
   * allow_simultaneous_attack CE の blockerCapacity を宣言 confirm 時に
   * スナップショットする。未設定 = 1 (公式 Q26724)。
   * "participant_count" = 同時アタック数まで (qa-022)。
   */
  blockerCapacity?: number | "participant_count";
  /**
   * 防御側が「これ以上ブロックしない」を明示済みか (複数ブロックの完了宣言)。
   * true になると after_block flash → バトル解決へ進める。
   */
  blockDeclarationCompleted?: boolean;
  target: ActiveAttackTarget;
  designatedTargetInstanceId?: string;
  /**
   * ENGINE-attack-declaration-replacement-primitive: 指定アタック (target.kind==="battle_entity"
   * + designatedTargetInstanceId) とは別軸の、汎用「このアタックを強制ブロックするカード」指定。
   * 通常アタック (target.kind==="player") でも forced_block 窓を開く契機になる。
   * BSRK01-C05 の replace_attack_declaration action のみが設定する。
   */
  forcedBlockerInstanceId?: string;
  attackAfterBurstChecked?: boolean;
  /** own_attack (attacker 向け) pendingBurstCheck を積み済みか。attackAfterBurstChecked
   * (defender 向け) とは別軸で管理する (maybeQueueOwnAttackBurstCheck)。 */
  ownAttackBurstChecked?: boolean;
  blockAssignments: ActiveAttackBlockAssignment[];
  symbolResolutionOrder: string[];
  flashBeforeBlockCompleted: boolean;
  flashAfterBlockCompleted: boolean;
  flashWindowState: BattleFlashWindowState | null;
  /** 宣言時の発揮元と誘発済み本文。アタック/ブロック時の条件達成を再評価する。 */
  immediateTimingSources?: {
    timing: BattleImmediateEffectTiming;
    sourceInstanceId: string;
    sourceDefinitionId: string;
    fieldInstanceGeneration: number;
    participantEntityId: string;
    queuedPromptIds: string[];
    /** 宣言時に見えていた効果提供元。条件未達の本文も含む。旧snapshotでは未保存。 */
    effectSourceRefs?: {
      instanceId: string;
      definitionId: string;
      fieldInstanceGeneration: number;
    }[];
  }[];
  /** 新規有効化した本文の解決後も、同じ原因の反応が残る間は元の宣言時効果を待たせる。 */
  immediateTimingReactionGroups?: {
    simultaneousGroupId: string;
    causedByChainId: string;
  }[];
  /**
   * P3-14 C-5: このバトル中に破壊判定が成立したカードの記録。
   * 「このバトルで破壊した相手のスピリット/アルティメット1体につき」(BSTH01-R02) 等の
   * 動的カウント源。queuePendingLeave (kind=destroy) で追記し、待機状態遷移
   * (destroy→他 kind) で除去する。破壊判定は Q16 で常に成立するため、残留置換等で
   * フィールドに残っても記録は維持する。
   */
  battleDestroyedRecords?: BattleDestroyedRecord[];
  /**
   * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): 「◯回まで連続でバトルできる」
   * 型 grant (BSTH06-X03【三歩必殺】)。`connect_battle` DSL action がアタック時に設定する。
   * バトル解決が battle_end 誘発へ進む直前に、このスピリットがまだフィールドにいれば
   * `remainingUses > 0` の間 `pendingConnectBattleDecision` を開いて続行/終了を選ばせる。
   * 継続時は `remainingUses` を 1 消費し、アタック宣言なし・疲労なしで
   * ブロック前フラッシュタイミングへ戻る (Q9096/Q9103)。`remainingUses` は継続回数
   * (総バトル回数ではない、DSL.ConnectBattleAction.maxUses 参照)。
   */
  connectBattleGrant?: {
    sourceInstanceId: string;
    remainingUses: number;
  } | null;
}

/**
 * ENGINE-battle-connect-repeat: 連続バトルの続行/終了を選ぶプレイヤー決定待ち。
 * バトル解決 (BP 比較・ライフダメージ・バースト) が完了し、battle_end トリガーが発火する
 * **前** に開く (Q9098「バトル終了時に発揮する効果を発揮する前にフラッシュタイミングに戻る」)。
 * `choice:"end"` なら保持しているコンテキストで通常の battle_end 経路
 * (`finalizeBattleEndSequenceAfterCombat`) をそのまま実行する。
 */
export interface PendingConnectBattleDecision {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  attackId: string;
  remainingUses: number;
  participantInstanceIds: readonly string[];
  blockSideInstanceIds: readonly string[];
  participantSnapshots: readonly BattleResolutionParticipantSnapshot[];
  appliedLifeDamage: number;
  participantOwnSymbols: readonly { entityId: string; ownSymbols: number }[];
  destroyedRecords?: readonly BattleDestroyedRecord[];
}

/** P3-14 C-5: バトル中破壊記録の 1 エントリ。 */
export interface BattleDestroyedRecord {
  instanceId: string;
  definitionId: string;
  /** 破壊されたカードのコントローラ。 */
  ownerPlayerId: string;
  /** 破壊の原因プレイヤー (バトル破壊は相手側、効果破壊は効果コントローラ)。 */
  causePlayerId: string | null;
}

export interface BattleResolutionEntitySnapshot {
  entityId: string;
  memberInstanceIds: string[];
  resolvedBp: number;
  resolvedSymbols: SymbolColor[];
  resolvedSymbolCount?: number;
}

export interface BattleResolutionParticipantSnapshot extends BattleResolutionEntitySnapshot {
  /** 複数ブロッカー対応 (P2-05 Phase 5)。BP 比較は各エントリと個別に 1vs1 で行う。 */
  blockedBy: BattleResolutionEntitySnapshot[];
}

export interface BattleResolutionGroup {
  attackId: string;
  groupMode: ActiveAttack["groupMode"];
  target: ActiveAttackTarget;
  symbolResolutionOrder: string[];
  participantSnapshots: BattleResolutionParticipantSnapshot[];
}

export interface BattleImmediateEffect {
  promptId: string;
  attackId: string;
  timing: BattleImmediateEffectTiming;
  sourceKind: BattleImmediateEffectSourceKind;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /**
   * 解決する印字効果の定義。通常は sourceDefinitionId と同じ。
   * 星霊衣のように host 実体が under-card B面の印字効果を発揮する場合だけ分離する。
   */
  sourceEffectDefinitionId?: string;
  /**
   * 印字効果を提供する card instance。通常は sourceInstanceId と同じ。
   * 星霊衣 under-card 由来効果では under-card 側の instanceId を保持し、
   * 同一定義 under-card が複数ある場合の prompt/usage を分離する。
   */
  sourceEffectInstanceId?: string;
  sourceCardNo: string;
  actingPlayerId: string;
  participantEntityId: string;
  registrationIndex: number;
  /** Host-side rewrite permissions can make an otherwise mandatory brave prompt optional. */
  executionMode?: EffectExecutionMode;
  /** 同時に誘発した効果群を識別する ID。PendingTriggeredEffect と共有し、ターンプレイヤーが解決順を選べる。 */
  simultaneousGroupId?: string;
  /** 同じ宣言タイミングの解決中に条件を満たした場合、その原因効果のチェーン。 */
  causedByChainId?: string;
}

export interface PendingTriggeredEffect {
  resolvedActionKinds?: readonly import("./dsl-types").Action["kind"][];
  pendingId: string;
  actingPlayerId: string;
  /** @deprecated ログ互換用。新コードは event を使う。 */
  eventKind: TriggerEventKind;
  event?: StructuredTriggerEvent;
  source: TriggerEventSource;
  chainId: string;
  attackId: string | null;
  relatedPlayerId: string | null;
  relatedInstanceId: string | null;
  /** brave_combined event 時点の合体先 host snapshot。 */
  triggerRelatedCombinedHostInstanceId?: string;
  relatedInstanceIds?: string[];
  relatedInstanceIdsBySourceRegistrationKey?: Record<string, string[]>;
  /** イベント時点で構造的に観測できた公開登録。面・場の個体・継承先も固定する。 */
  timingSourceRegistrations?: Record<
    string,
    {
      sourceInstanceId: string;
      sourceDefinitionId: string;
      sourceFieldInstanceGeneration: number;
      effectDefinitionId: string;
      effectFieldInstanceGeneration: number;
      /** 内部のイベント時述語結果。動的条件・非公開定義は含めず、表示コピーから除く。 */
      eventConditionResults?: Record<string, boolean>;
    }
  >;
  /** まだ発揮資格を得ていない観測登録。同じ同時誘発群が進行中の場合だけ再評価する。 */
  dormantSourceRegistrationKeys?: string[];
  /** 「ただちに」の完了まで発揮条件判定を待つ公開候補。通常群へ戻る際に一度だけ確定する。 */
  deferredConditionSourceKeys?: string[];
  /**
   * pending leave pre-flush で離脱予定カードが保持していた煌臨元 instanceId スナップショット
   * (`CollectedTriggerEvent.adventSourceInstanceIds` からそのまま転写、trigger-system.ts)。
   * `StepExecutionContext.triggerAdventSourceInstanceIds` へ伝播し、
   * `SummonAction.from_zone.restrictToTriggerLeaveAdventSource` が参照する
   * (BSSG01-C08 Lv2、engine-advent-source-leave-summon)。
   */
  adventSourceInstanceIds?: string[];
  amount: number | null;
  step: Step;
  window: Window;
  resolvedSourceInstanceIds: string[];
  /**
   * 解決/辞退済みの誘発ソースを (instanceId, registrationIndex) 粒度で記録する除外キー。
   * 形式は `${instanceId}#${registrationIndex}`（registrationIndex 不明時は素の instanceId）。
   * 1 枚のカードが同タイミングの誘発効果を複数持つ場合 (例: BSTH06-C01 の 2 つの『召喚時』)、
   * 片方を解決/辞退しても他方を残すため、instanceId 単位の resolvedSourceInstanceIds とは別に
   * effect 単位の除外をここで持つ。getAvailableTriggeredEffectSourceChoices が両方を見る。
   */
  resolvedSourceRegistrationKeys?: string[];
  /**
   * P3-97: この pending にぶら下がる登録済み card_event 離脱反応のうち、
   * 効果本体が `stay_on_field` / `rebirth` を含む source key。
   * `resolvedSourceRegistrationKeys` と突き合わせ、未解決の残置 source がある間だけ
   * pre-flush の pendingLeave を保留する。
   */
  registeredLeaveFieldStayOnFieldSourceKeys?: string[];
  /**
   * 待機入りで誘発した登録済み効果の source key。残置や対象操作だけでなく
   * ドロー/カウント等も含め、未解決の間は魂状態/ブレイヴ選択と実移動を待つ。
   */
  registeredLeaveFieldPreFlushSourceKeys?: string[];
  /**
   * pendingLeave 生成時点の pre-flush destroy/vanish/bounce/remove event。
   * 解決時には source card が trash 等へ移っていることがあるため、card_event 自己誘発の
   * sourceZone 判定は queue 時点の field snapshot として扱う。
   */
  preFlushLeaveEvent?: boolean;
  /** 登録済み source を pre-flush で直接 queue した leave event。 */
  registeredPreFlushLeaveEvent?: boolean;
  /** イベント原因。leave_field 系と効果解決由来の enter_field 系で使用する。 */
  cause?: TriggerEventCause;
  /**
   * イベントを直接引き起こしたプレイヤー。`Timing.triggerCausedBy` 指定時に、
   * リスナーの controller と照合する。通常の cause 分類とは独立して「相手によって」
   * を判定するため、自己アタック由来のライフ減少を相手アタックと誤認しない。
   */
  causedByPlayerId?: string;
  /**
   * enter_field 系イベント (summon / place / advent) で被誘発カードが場入り前にいたゾーン。
   * `trigger_from_zone` 条件評価に注入する（「手札から召喚したとき」等の発生源ゾーン判別）。
   */
  fromZone?: Zone;
  /**
   * engine-suppress-third-party-summon-observation (BSTH11-X02【現界】):
   * `CollectedTriggerEvent.suppressThirdPartyObservation` からそのまま転写。
   * true のとき game_event (第三者観測) リスナーはこの pending にマッチしない。
   */
  suppressThirdPartyObservation?: boolean;
  /**
   * P3-130: `targeted` イベントで relatedInstance がフィールド外にいた場合、
   * queue 時点で「開いている応答窓の保留 ActiveStack 鎖に自身が乗っている」
   * (= `isInstanceInOpenResponseWindow`) を満たしていたかのスナップショット。
   * `getAvailableTriggeredEffectSourceChoices` の宣言可否判定 (declare-time) は
   * P3-34 により resolve_pending_triggered_effect が窓クローズ後にしか現れないため、
   * 同じ primitive を都度re-deriveすると窓が閉じた瞬間に恒久的到達不能になる
   * (queue 時は開窓、declare 時は必ず閉窓という構造的すれ違い)。このフラグで
   * queue 時点の判定を declare 時まで持ち越し、再評価対象を「関連カードが
   * まだ存在するか」に絞る。on-field disclosure (このフラグ未設定) の挙動は不変。
   */
  relatedInstanceOffFieldActivating?: boolean;
  /** 同時に誘発した効果群を識別する ID。同じ ID を持つ効果はターンプレイヤーが解決順を選べる。 */
  simultaneousGroupId?: string;
  /** 「ただちに」型など、同時誘発群内で通常誘発より先に解決する優先度。 */
  triggerPriority?: TriggerPriority;
  /** suppressDestroyedEffects="destroyed_only" で抑制された破壊カードの instanceId。
   * このリストに含まれるカードをソースとする効果は発動するが発揮されない（resolver をスキップ）。 */
  suppressedSourceInstanceIds?: string[];
  /** suppressDestroyedEffects="all_opponent" のとき true。
   * すべてのソースカードの効果が発動するが発揮されない。 */
  effectSuppressed?: boolean;
  /** P3-76 targeting/leave-field: triggerSourceFilter 用イベント source。 */
  effectSourceInstanceId?: string;
  /** 複数の実バトル source がある leave-field event 用。 */
  effectSourceInstanceIds?: string[];
  effectSourceDefinitionId?: string;
  /** leave_field 等を起こした効果の防止レベル。 */
  effectSourcePreventionLevel?: EffectPreventionLevel;
  effectActionKind?: EffectResolutionActionKind;
  /** effect_declaration event の見出しラベル由来カテゴリ。 */
  effectActivationLabel?: ActivatedEffectLabel;
  effectActivationTiming?: EffectActivationTiming;
  /**
   * ENGINE-effect-immunity-own-pending-resolution: `event:"effect_declaration"` の
   * ActiveStack 宣言元ゾーンスナップショット (`getStackSourceActivationZone` 解決値)。
   * `Timing.triggerActivationZone` の絞り込み対象。
   */
  triggerActivationZone?: EffectActivationSourceZone;
  /** @deprecated コスト差分互換用。軽減シンボル充足判定には下の2フィールドを使う。 */
  effectSourceTotalReduction?: number;
  /** effect_activated 観測元カードが使用時に実際に満たした軽減シンボル枠数。 */
  effectSourceSatisfiedReductionSymbolCount?: number;
  /** effect_activated 観測元カードが使用時に要求された軽減シンボル枠数。 */
  effectSourceRequiredReductionSymbolCount?: number;
  /**
   * 使用時点で source 候補だった instance/effect-source ids。
   * `latchSourceAtEffectActivationStart` を持つ registration のみが参照する。
   */
  eligibleSourceInstanceIds?: string[];
  /** enter_field event を起こした効果 index。通常召喚/配置では undefined。 */
  sourceEffectIndex?: number;
  /** 同一 eventKind 内の効果名/機構スコープ。例: put + genkai。 */
  effectScope?: EffectEventScope;
  /** 非公開ゾーン source が private 宣言を通過して公開キュー化されたもの。 */
  declaredFromPrivateZone?: boolean;
  /**
   * コスト支払い消滅など、原因別イベントだけを先行収集する pending。
   * game_event の `leave_field` 監視は物理移動時の `leave_field` 境界で拾うため、
   * このフラグがある場合は game_event も eventKind を exact に照合する。
   */
  exactGameEventKind?: boolean;
  /** declaredFromPrivateZone の source を applicability 再スキャンなしで解決するための pre-bind 情報。 */
  declaredSourceInstanceId?: string;
  declaredSourceDefinitionId?: string;
  declaredSourceKind?: FieldEffectSourceKind;
  declaredRegistrationIndex?: number;
  /** private 宣言時に usageLimit を消費済みの場合、公開解決時に二重消費しない。 */
  usageLimitConsumedOnPrivateDeclaration?: boolean;
  /**
   * P3-36 Phase C: ターンプレイヤーが「次に解決する pending」として選択済みかどうか。
   * - undefined / false: 未選択。turn player が `select_pending_to_resolve` で選ぶまで
   *   resolve_pending_triggered_effect は legal にならない（ただし queue が単一の場合は
   *   auto-select 扱い）。
   * - true: 選択済み。owner に解決アクションが提示される。
   */
  selectedByTurnPlayer?: boolean;
  /**
   * P3-36 Phase C: 1 つの owner pending に mandatory/optional source が混在する場合、
   * turn player が「次に解決する 1 件」として選んだ source/effect registration。
   * 未指定なら pending 全体の選択を表す。
   */
  selectedSourceInstanceId?: string;
  selectedSourceEffectInstanceId?: string;
  selectedRegistrationIndex?: number;
  /**
   * P3-92: エンジン機構由来の誘発任意効果（神託/解封/創界石転醒）のペイロード。
   * 存在する場合、この pending はカード効果 registration を持たず、
   * legal-actions は単一の optional resolve/skip を提示し、apply は mechanic 分岐で
   * 同期解決する（getAvailableTriggeredEffectSourceChoices のスキャン対象外）。
   */
  mechanic?: TriggeredMechanic;
}

export interface PendingPrivateDeclaration {
  /** 別効果の離脱誘発は、宣言時にも現在の待機状態を参照する。 */
  preFlushLeaveEvent?: boolean;
  declarationId: string;
  ownerPlayerId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceKind: FieldEffectSourceKind;
  sourceZone: import("./dsl-types").ApplicabilityZone;
  registrationIndex: number;
  pendingId: string;
  /** @deprecated ログ互換用。新コードは event を使う。 */
  eventKind: TriggerEventKind;
  event?: StructuredTriggerEvent;
  source: TriggerEventSource;
  chainId: string;
  attackId: string | null;
  /**
   * 宣言前の private leave-field 反応が、離脱者自身を flush 前に扱う必要がある場合の source key。
   * 公開 pending の同名フィールドへ宣言時に伝搬する。
   */
  registeredLeaveFieldStayOnFieldSourceKeys?: string[];
  registeredLeaveFieldPreFlushSourceKeys?: string[];
  /** 登録済み source を pre-flush で直接 queue した leave event。 */
  registeredPreFlushLeaveEvent?: boolean;
  relatedPlayerId: string | null;
  relatedInstanceId: string | null;
  /** brave_combined event 時点の合体先 host snapshot。 */
  triggerRelatedCombinedHostInstanceId?: string;
  relatedInstanceIds?: string[];
  relatedInstanceIdsBySourceRegistrationKey?: Record<string, string[]>;
  amount: number | null;
  step: Step;
  window: Window;
  /** `trigger_from_zone` 条件再評価用。private 宣言後の公開 pending へ引き継ぐ。 */
  fromZone?: Zone;
  cause?: TriggerEventCause;
  simultaneousGroupId?: string;
  /** 宣言後の PendingTriggeredEffect へ引き継ぐ同時誘発群内の解決優先度。 */
  triggerPriority?: TriggerPriority;
  suppressedSourceInstanceIds?: string[];
  effectSuppressed?: boolean;
  /** P3-76 targeting/leave-field: triggerSourceFilter 用イベント source。 */
  effectSourceInstanceId?: string;
  /** 複数の実バトル source がある leave-field event 用。 */
  effectSourceInstanceIds?: string[];
  effectSourceDefinitionId?: string;
  /** leave_field 等を起こした効果の防止レベル。 */
  effectSourcePreventionLevel?: EffectPreventionLevel;
  effectActionKind?: EffectResolutionActionKind;
  effectActivationTiming?: EffectActivationTiming;
  /** @deprecated コスト差分互換用。軽減シンボル充足判定には下の2フィールドを使う。 */
  effectSourceTotalReduction?: number;
  /** effect_activated 観測元カードが使用時に実際に満たした軽減シンボル枠数。 */
  effectSourceSatisfiedReductionSymbolCount?: number;
  /** effect_activated 観測元カードが使用時に要求された軽減シンボル枠数。 */
  effectSourceRequiredReductionSymbolCount?: number;
  /** `PendingTriggeredEffect.eligibleSourceInstanceIds` の private declaration 伝搬用。 */
  eligibleSourceInstanceIds?: string[];
}

export interface PendingBurstCheck {
  checkId: string;
  actingPlayerId: string;
  /** @deprecated ログ互換用。新コードは event を使う。 */
  eventKind: BurstEventKind;
  event?: StructuredTriggerEvent;
  source: TriggerEventSource;
  chainId: string;
  attackId: string | null;
  relatedPlayerId: string;
  relatedInstanceId?: string | null;
  amount: number;
  step: Step;
  window: Window;
  resolvedBurstCardInstanceIds: string[];
  /**
   * false は候補の存在を確認済みで宣言選択待ち、true は「発動する」を選択済み。
   * 未設定は lookup を持たない互換経路の判定。実際の発動宣言窓は、
   * 同じタイミングの非公開宣言キューが全て確定してから開く。
   */
  activationSelected?: boolean;
  /** 同時に誘発したバーストチェック群を識別する ID。
   * 同じ ID を持つ pendingTriggeredEffect / pendingBurstCheck は
   * stay_on_field 等の置換効果で連動撤回される。 */
  simultaneousGroupId?: string;
  /** suppressDestroyedEffects="all_opponent" のとき true。
   * バーストは発動できるが、バースト効果は発揮されない。 */
  effectSuppressed?: boolean;
}

export interface BurstSetState {
  playerId: string;
  cardInstanceId: string;
}

export interface MirageSetState {
  playerId: string;
  cardInstanceId: string;
}

export interface RevealedBurstState {
  playerId: string;
  cardInstanceId: string;
  checkId: string;
  /** 発動宣言への応答中。発動成立時に false へ移る（手札等からの直接発動を含む）。 */
  activationPending?: boolean;
}

export interface PlayerState {
  id: string;
  deckCount: number;
  handCount: number;
  lifeNormalCoreCount: number;
  reserveNormalCoreCount: number;
  trashNormalCoreCount: number;
  voidNormalCoreCount: number;
  /**
   * ソウルコア複数個対応 (P3-101)。単一ロケーション表現で、依然 ownership 判定
   * (どのプレイヤー自身のソウルか) の正源。`reserveSoulCoreCount` 等のロケーション別
   * カウント (S1新設) とは `moveSoulCore` (core-system.ts, S2) が dual-write で同期
   * する。旧 soulCoreLocation を直接読む経路 (14ファイル超) は本フィールドを
   * 読み続ける (S2 では移行しない、blast radius が大きいため別段階)。
   */
  soulCoreLocation: PlayerScopedSoulCoreLocation | null;
  /**
   * ソウルコア複数個対応 S2 (P3-101)。通常コアの `reserveNormalCoreCount` 等と対称な
   * ロケーション別カウント。ボイドは soul 不可（硬制約、10_rules/06「ボイドは常に不可。
   * explicit 指定でも soul をボイドに置けない」）のため void 相当のフィールドは持たない。
   * `moveSoulCore`/`isSoulCoreOn`/`getTotalCoresOnCardById` (core-system.ts) の SSOT。
   * `removed_from_game` 行き先はカウントフィールド未新設 (実カード0件) のため
   * soulCoreLocation のみで表現される。
   */
  reserveSoulCoreCount: number;
  trashSoulCoreCount: number;
  lifeSoulCoreCount: number;
  /** カウントエリアの値。契約カード関連で使用。 */
  countValue: number;
  /**
   * カウント保護（系統別）。「追加したカウントは系統：「X」を持たない効果で
   * 数えられず、その効果を受けない」(BSGE01 神喰 等)を表す。キー = 保護元系統、
   * 値 = 保護されている countValue の内訳。省略時は保護なし。
   * countValue は常に総量（表示値）で、protectedCounts はそのうち
   * 「指定系統を持たない効果から見えない/触れない」部分を示す。
   */
  protectedCounts?: Record<string, number>;
  /**
   * 魂���態のカードインスタンスIDリスト。
   * 魂状態のカードはスピリット等ではなく、アタック/ブロック/軽減/Lv効果不可。
   * 〖魂状態〗効果のみ発揮可能。コア配置不可（上のコアはリザーブへ）。
   */
  soulStateInstanceIds: string[];
  /** 契約カードの cardNo。デッキに1種のみ。ゲーム開始時に設定。 */
  contractCardNo: string | null;
}

export interface PendingLeaveEntity {
  instanceId: string;
  /** 同じ解決区間で生じた誘発の pending ID と宣言・派生チェーン。選択・実移動はこれらの完了後。 */
  reactionChainIds?: string[];
  /** この待機入りのバースト発動宣言候補を確認済み。実移動で再確認しない。 */
  burstDeclarationChecked?: boolean;
  kind: PendingLeaveKind;
  cause: PendingLeaveCause;
  /** フィールド離脱を引き起こしたプレイヤーID。魂状態置換判定に使用。 */
  causePlayerId: string | null;
  chainId: string;
  deferZoneMoveUntilChainEnd: boolean;
  leaveFieldCoreDestinationOverride?: LeaveFieldCoreDestinationOverride | null;
  /**
   * pending leave の最終移動先 intent。通常は kind 既定値を使うが、
   * field-origin send_to_deck は bounce 待機状態のまま deck top/bottom へ着地させる。
   */
  leaveDestination?: {
    zone: CardZone;
    position?: "top" | "bottom";
  };
  /**
   * true のとき、離脱者自身の stay_on_field 型残置反応を待たずに flush する。
   * 通常の leave_field 誘発は抑制しない。
   */
  preventStayOnField?: boolean;
  /**
   * この pending leave から生成する誘発 pending に注入する除外キー。
   * 待機入りで queue 済みの反応も保持し、実移動時の二重誘発を防ぐ。
   * 例: 転醒失敗で同一カードの離脱待機が作り直された場合、同じ転醒効果を再発火させない。
   */
  resolvedSourceRegistrationKeys?: string[];
  /** 破壊されたカードの効果抑制スコープ。
   * - "destroyed_only": 破壊されたカード自身の効果のみ抑制。
   * - "all_opponent": 破壊に起因する相手の一切の効果を抑制（バースト含む）。
   */
  suppressDestroyedEffects?: "destroyed_only" | "all_opponent";
  /** P3-74 Phase B: 相手の cannot_leave_field 効果耐性によって物理離脱が阻止されたが、
   * 破壊判定自体は成立した状態。Q16/Q17 準拠で内包 `conditional_result` から参照可能にするため
   * pendingLeaveEntities に積む。card.pendingLeaveKind はセットしない (フィールドに残るため)。
   * - flushPendingLeaves: zone 移動せず entries から除去のみ。
   * - trigger-system: card_destroyed / card_left_field event を emit しない (Q18 維持)。
   */
  blockedByResistance?: boolean;
  /** 離れない耐性は離脱結果を成立させるが、破壊されない等の耐性は成立させない。 */
  outcomeEstablished?: boolean;
  /**
   * 煌臨元への追加置換 (advent_source) で「トラッシュ」が選択済みであることを示すフラグ。
   * resolveAdventSourceReplacement(choice="trash") がセットする。これにより次回
   * flushPendingLeaves の checkAdventSourceReplacement が同じ離脱を再提示せず
   * (= 無限ループ防止)、元の離脱理由は保持したまま移動先だけトラッシュへ上書きする。
   */
  adventSourceReplacementDeclined?: boolean;
  /**
   * 契約カードの魂状態置換 (soul state) で「通常通り離れる」が選択済みであることを示すフラグ。
   * resolveSoulStateReplacement(accept=false) がセットする。これにより次回
   * flushPendingLeaves の checkSoulStateReplacement が同じ離脱を再提示せず
   * (= 無限ループ防止)、通常通りフィールドを離れる (08a_advent-rebirth-contract.md L126)。
   */
  soulStateReplacementDeclined?: boolean;
  /** 重なり全体の離脱時に選んだ各契約カードの魂状態化。全候補の選択後に一括適用する。 */
  soulStateReplacementChoices?: Record<string, boolean>;
  /**
   * 「この効果でブレイヴはフィールドに残せない」（vanish/destroy の二次プリミティブ）。
   * true のとき、ホスト離脱時の checkBraveLeaveChoice はブレイヴ残存の選択待ちを設けず、
   * 強制的に send_with_host（ブレイヴもホストと同じ場所へ移動）として解決する
   * （10_rules/05_brave-and-attack-special-cases.md L65-68 の選択肢2を強制）。
   */
  forceBraveSendWithHost?: boolean;
  /**
   * この離脱を引き起こした効果の発揮元カード instanceId
   * (ENGINE-generic-effect-activation-causal-trigger Step2: causal-tracking 層)。
   * host が自身の効果解決で引き起こした離脱を、明示 stepId 参照 (`{kind:"ref"}`) 無しで
   * 追跡できるようにする。現状 destroy/vanish/remove_from_game/効果の bp_compare_destroy/
   * hand-written resolver 経由の `queuePendingLeave` 呼び出し、効果 step 内の `pay_cost`
   * 由来コスト支払い消滅 (`applyCardCostPayments.causedByEffectSourceInstanceId`) が設定する。
   * 実バトル破壊は設計上対象外 (効果解決由来ではない)。未設定時は undefined のまま
   * (fail-closed、誤帰属しない)。
   */
  causedByEffectSourceInstanceId?: string | null;
  /**
   * この離脱を起こした structured effect の防止レベル。leave_field trigger を生成する
   * 境界まで保持し、発揮元の「防げない」状態を Timing gate で照合できるようにする。
   */
  causedByEffectSourcePreventionLevel?: EffectPreventionLevel;
  /**
   * 実バトルの BP 比べでこの離脱を成立させた相手側参加カード instanceId。
   * 効果 causal field とは分離し、triggerSourceFilter 用のイベント source へ転写する場合だけ使う。
   */
  causedByBattleSourceInstanceId?: string | null;
  /**
   * 実バトルの BP 比べでこの離脱を成立させた相手側参加カード instanceId 群。
   * 複数ブロッカーでは各ブロッカーと個別に BP 比較するため、複数 source を保持する。
   */
  causedByBattleSourceInstanceIds?: string[];
}

/**
 * 合体スピリット破壊時のブレイヴ選択待ち。
 * ホストがフィールドを離れるとき、ブレイヴを「フィールドに残す」か「一緒に移動させる」か選ぶ。
 * 鍵ブレイヴの魂状態継承時は、先に「合体状態で魂状態にする」選択も提示し、
 * 未選択の通常ブレイヴを後続 pending に引き継ぐ。
 */
export interface PendingBraveLeaveChoice {
  choosingPlayerId: string;
  hostInstanceId: string;
  braveInstanceIds: string[];
  /**
   * ホストが新 instance へ置換された後でも、分離したブレイヴが引き継ぐ直前の
   * 疲労状態。転醒 Q30232 / Q21697 の「疲労状態で分離」を保つために使う。
   */
  hostExhaustState?: CardInstance["exhaustState"];
  /** ホストの離脱先（トラッシュ等） */
  leaveKind: PendingLeaveKind;
  leaveCause: PendingLeaveCause;
  /** send_with_host 選択時にブレイヴへ引き継ぐホストの最終移動先 intent。 */
  leaveDestination?: PendingLeaveEntity["leaveDestination"];
  soulStateInheritance?: {
    remainingBraveInstanceIds: string[];
  };
}

/**
 * @deprecated 旧スナップショット/棋譜互換用。新しい対戦では継続可否を自動確定し生成しない。
 */
export interface PendingBraveAttackContinuation {
  choosingPlayerId: string;
  entityId: string;
  braveInstanceIds: string[];
}

/**
 * 契約カードの魂状態置換待ち。
 * 相手によってフィールドを離れるとき、魂状態で残す選択が可能（ルールであり効果ではない）。
 */
export interface PendingSoulStateReplacement {
  /** 選択するプレイヤーID（カードのコントローラー） */
  choosingPlayerId: string;
  /** 対象カードの instanceId */
  cardInstanceId: string;
  /** 煌臨元を含む重なりの離脱元。未指定は従来の単体カードの置換。 */
  leavingCardInstanceId?: string;
  /** 元の離脱種別 */
  originalLeaveKind: PendingLeaveKind;
  /** 元の離脱原因 */
  originalLeaveCause: PendingLeaveCause;
  /**
   * 鍵ブレイヴが `inherit_soul_state` を選んだ場合、その選択は
   * 「合体しているスピリットが魂状態になるとき」と不可分なので
   * 後続の魂状態置換では decline を提示しない。
   */
  forceKeepDueToSoulStateInheritance?: {
    braveInstanceIds: string[];
  };
}

/**
 * 煌臨元への追加置換待ち。
 * 「このスピリットが相手によって離れるとき、自分の『X』の煌臨元に追加するか、トラッシュに置く」
 * (BSSL01-C02/M01/M03/X03 ほか)。相手起因の離脱を捕捉し、コントローラーが
 * 「指定スピリットの煌臨元に追加」/「トラッシュに置く」を選択する。
 * 08a_advent-rebirth-contract.md L36「フィールド離脱時、煌臨元も全て同じ場所に移動」の逆操作。
 */
export interface PendingAdventSourceReplacement {
  /** 選択するプレイヤーID（離脱カードのコントローラー） */
  choosingPlayerId: string;
  /** 離脱して煌臨元になり得るカードの instanceId */
  cardInstanceId: string;
  /** 煌臨元の追加先候補スピリットの instanceId リスト (フィルタ一致・コントローラー所有)。 */
  candidateHostInstanceIds: string[];
  /** 元の離脱種別 */
  originalLeaveKind: PendingLeaveKind;
  /** 元の離脱原因 */
  originalLeaveCause: PendingLeaveCause;
}

/**
 * 手元 (set_aside) にあるカードが自分自身の効果で除外される (remove_from_game) とき、
 * `effect_resistance` の `replace_field_exit` 置換 (`replacement.kind:"move_to"|"pay_cost"`,
 * `source:"self"`) が一致した場合の「代わりに置換先へ移す/コスト支払って残す、または通常通り
 * 除外する」二択待ち (ENGINE-set-aside-exit-replacement-choice、BSTH08.5-M11/X04 手元常駐効果
 * 正源)。
 *
 * `queuePendingLeave`/`flushPendingLeaves` はフィールド専用 (対象 `zone==="field"` を要求し
 * それ以外は例外を投げる) のため経由できない。`executeRemoveFromGame` の非フィールド分岐
 * (`structured-card-replacement.ts`) が自己起因 (`actingPlayerId === card.controllerPlayerId`)
 * かつ一致 CE を持つ対象だけをここで捕捉し、当該カードの除外を保留する。
 */
export interface PendingSetAsideExitReplacementChoice {
  /** 選択するプレイヤーID（除外されるカードのコントローラー、常に actingPlayerId と一致） */
  choosingPlayerId: string;
  /** 除外され得る手元カードの instanceId */
  cardInstanceId: string;
  /** 同じ除外処理の未選択札。選択済み札を再処理せず、次の札は現在のCEで再判定する。 */
  remainingCardInstanceIds?: string[];
  /** 同じ処理の全対象。置換完了後の実除外数を本文のstep結果へ戻す。 */
  removalTargetInstanceIds?: string[];
  continuation?: LifeCoreSelectionContinuation;
  stepResultId?: string;
  /**
   * battle_end deferral 解決中に生成された場合の元 attackId。
   * scope:"battle" CE の失効は、この pending が解決されるまで待つ。
   */
  battleEndDeferralAttackId?: string;
  /**
   * 一致した置換の内容。`FieldExitReplacement.move_to.zone` は "hand" | "deck_bottom" だが、
   * 現行カード (BSTH08.5-M11) は "hand" のみ使用するため未使用の "deck_bottom" 分岐は設けない
   * (実カードが要求した時点で拡張する)。`pay_cost` は BSTH08.5-X04 正源 (ゾーン移動なし残留)。
   */
  replacement:
    | { kind: "move_to"; zone: "hand" }
    | { kind: "pay_cost"; amount: number };
}

/**
 * revealed 効果でカードに適用する処理の種別。
 * steps の先頭アクションから自動判定される。
 */
export type RevealedDisposition =
  | { kind: "move"; destination: CardZone }
  | { kind: "summon"; costModifier?: import("./dsl-types").CostModifier }
  | { kind: "steps_only" }
  /** 手札追加/入れ替えの受理候補から除外する。revealed の失敗分は破棄され得る。 */
  | { kind: "blocked" }
  /**
   * swap = このカードを手札に加えると同時に手札1枚を「このカード」の行き先へ送る入れ替え
   * （07b §鍵/星霊デッキオープン置換 line 40）。revealed 由来はデッキ下、trash 由来はトラッシュ。
   */
  | { kind: "swap" }
  /**
   * このカードを手札を経由せず直接バーストとしてセットする（BSTH09-M01 型）。
   * revealed_choice で受理されたら zone を "burst" にし setBurstStates へ追加する。
   */
  | { kind: "set_as_burst" }
  /**
   * このカードのミラージュコストを支払い、ミラージュとしてセットする。
   * card_event 由来で一時ゾーン（revealed/trash）にあるカードのみに用いる。
   */
  | { kind: "set_as_mirage" };

/**
 * デッキオープン効果のプレイヤー選択待ち状態。
 * 「デッキを���からN枚オープンできる。その中の〜を手札に加える。残りはデッキの下に戻す。」
 */
export interface PendingDeckReveal {
  /** 効果セットの追加/個別交換。決定済み値だけを保持し、後続の順序/支払い選択をまたぐ。 */
  mirageReplacementsByInstanceId?: Record<string, string[]>;
  /** コア選択の再開時に成功・不成立どちらの場入りも繰り返さない。 */
  attemptedFieldEntryIds?: string[];
  beforePickSteps?: import("./dsl-types").EffectStep[];
  beforeMoveSteps?: import("./dsl-types").EffectStep[];
  pendingId: string;
  /** 効果を選択・解決しているプレイヤー。 */
  actingPlayerId: string;
  /** 公開カード自身の任意効果を所有者が選んだ後、元のオープン効果の選択者へ戻す。 */
  revealedChoiceParentPlayerId?: string;
  /**
   * オープン対象デッキの所有者。省略時は従来互換で actingPlayerId。
   * `deck_reveal.player:"opponent"` のように、選択者と対象デッキ所有者が異なる場合に使う。
   */
  targetPlayerId?: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /**
   * オープンされたカードの instanceId リスト（公開情報）。
   * revealed_choice フェーズ完了時に mandatory/optional 消化分を除いた「残り」へ
   * 再代入される（picking/ordering フェーズ中の作業用リスト）。「revealed 全体」を
   * 変わらず参照したい場合は `originalRevealedCardInstanceIds` を使う。
   */
  revealedCardInstanceIds: string[];
  /**
   * pending 生成時点の revealed カード全体（mandatory 消化分を除く）。
   * `revealedCardInstanceIds` と異なりフェーズ遷移で再代入されない不変スナップショット。
   * 「その中の X カード1枚につき」型 (BSLH01-C14) の
   * `DynamicCountSource.cards_from_ref(result:"revealed")` が pick/revealed_choice の
   * 結果に関係なく revealed 全体を数えるために参照する。
   */
  originalRevealedCardInstanceIds: string[];
  /** revealedCardInstanceIds の可視範囲。省略時は従来互換で "both"。 */
  revealTo?: "self" | "opponent" | "both";
  /** deck reveal から field へ入れたカード自身の summon/place 効果を抑止する。 */
  suppressFieldEntryEffects?: boolean;
  /** 各ピックグループの定義 */
  picks: DeckRevealPick[];
  /** 残りカードの行き先。"top_or_bottom" は一括上下選択、"top_bottom_split" はカード別上下分配 */
  remainder:
    | "top"
    | "bottom"
    | "top_or_bottom"
    | "top_bottom_split"
    | "bottom_or_trash"
    | "trash";
  /** 現在のフェーズ */
  phase: "revealed_choice" | "picking" | "ordering_remainder";
  /** 現在処理中のピックグループインデックス */
  currentPickIndex: number;
  /** 同じ本文による手札増加の対価。カード自身の revealed/moved_to_trash 効果とは別イベント。 */
  handGainCostDecision?: "paid" | "declined";
  /** 既に選択されたカードの instanceId リスト */
  pickedCardInstanceIds: string[];
  /** revealed_choice フェーズ: 手札追加候補の instanceId リスト */
  revealedAutoAddCandidateIds?: string[];
  /** 同じ公開イベントの排他選択グループ（重複不可・同一所有者の空きバースト枠）。各グループ1枚まで。 */
  revealedUsageGroupByInstanceId?: Record<string, string>;
  /** カードごとの revealed 効果の処理種別。Key = instanceId */
  revealedDispositionMap?: Record<string, RevealedDisposition>;
  /**
   * `TrashOptionalAddEntry.bonusStepsByInstanceId` の持ち越し（trash 由来のみ現状使用）。
   * `resolve_pending_deck_reveal_pick`(revealed_choice フェーズ) が手札へ受理された候補にのみ
   * `core_move` 等のボーナスステップを実行する。
   */
  bonusStepsByInstanceId?: Record<
    string,
    ReadonlyArray<import("./dsl-types").EffectStep>
  >;
  /**
   * pending の発生源。
   * - `"deck"`（省略時のデフォルト）: デッキオープン由来。revealed_choice 後は picking/ordering へ進む。
   * - `"trash"`: トラッシュ移動由来（moved_to_trash の任意手札追加）。revealed_choice のみで完了し、
   *   非選択カードはトラッシュに据え置く（picks/remainder は無い）。
   */
  origin?: "deck" | "trash";
  /**
   * swap 型 disposition（「手札1枚と入れ替えられる」）受理時に、reveal 完了後へ
   * 持ち越す入れ替え用の手札選択 pending。revealed_choice で swap を受理した時点で組み立て、
   * deck reveal（picking/ordering）が finalize した時点で `pendingZoneSelection` として emit する。
   * trash 由来 / 残オープン 0 の即時完了経路では即 emit。
   */
  pendingSwapOut?: PendingZoneSelection;
  /**
   * pick 時点で記録した「この picked card を出した pick group の destination」。
   * Key = picked instanceId / Value = `DeckRevealPick.destination`。
   *
   * `"hand_swap"` / `"hand_or_set_aside_swap"` が混在する場合、finalize で
   * picked card 単位の swap-out 選択を per-pick 独立で生成するために必要。
   * 通常 (`"hand"` / `"field"`) のみのときは省略可。
   *
   * 正源: 10_rules/07b §BSTH09-C04/C05「手札/手元と入れ替えられる」(裁定 2026-06-17)。
   */
  pickedDestinationByInstance?: Record<
    string,
    | "hand"
    | "field"
    | "hand_swap"
    | "hand_or_set_aside_swap"
    | "mirage_set"
    | "set_aside"
    | "trash"
  >;
  /**
   * `remainder: "top_bottom_split"` の hand_swap で、先に選ばせた swap-out の結果。
   * Value が string のときは、その手札/手元カードを残りカードとして戻す。
   * Value が null のときは swap を諦め、picked card 自身を残りカードとして戻す。
   * どちらも後続の ordering フェーズで他の残りカードと同じ順序/上下分配に参加する。
   */
  swapOutByPickedInstanceId?: Record<string, string | null>;
  /**
   * この pending が閉じ、他の効果解決 pending が無い安定点で発火させる神託。
   * マジック効果の deck_reveal 等が選択待ちで中断した場合に使う。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * pending 提示前の state。picked destination:"field" が閉じた後、
   * 効果由来の summon/place trigger を production 経路で収集するために使う。
   */
  priorStateSnapshot?: GameState;
  /**
   * この pending の後続に元効果の steps が残っている場合の再開情報
   * (`ZoneSelectionContinuation` を再利用)。「デッキオープンで手札に加えなかったとき、
   * トラッシュから...戻せる」(BSTH02.7-C03 初出) のように、pick 結果 (実際に手札へ
   * 加わったか) 次第で後続 step の発揮可否が変わる効果を表現するために使う。
   * finalize 時、`recordStepId` の StepResult に `handAddedCardInstanceIds` を注入して
   * `resumeStepIndex` から executeEffect を再開する
   * (ENGINE-deck-reveal-hand-added-tracking)。
   */
  continuation?: ZoneSelectionContinuation;
}

/**
 * moved_to_trash の任意 disposition（「加えられる」/「配置できる」= 任意効果）の発火待ちエントリ。
 * `pendingTrashOptionalAdds` に積まれ、安定点で `pendingDeckReveal`(origin="trash") に変換される。
 */
export interface TrashOptionalAddEntry {
  /** disposition を受理するか選ぶプレイヤー（候補カードのオーナー）。 */
  actingPlayerId: string;
  /** トラッシュにある任意 disposition 候補の instanceId リスト。 */
  instanceIds: string[];
  /** 候補ごとの受理時 disposition。省略時は従来互換で hand へ移動する。 */
  dispositionByInstanceId?: Record<string, RevealedDisposition>;
  /**
   * swap 型（「手札1枚と入れ替えられる」）の候補 instanceId。
   * これに含まれる候補は revealed_choice で受理されると手札に加わり、手札1枚を
   * トラッシュへ送る入れ替えになる（07b §鍵/星霊デッキオープン置換 line 40）。
   * 省略時は全候補が add 型。
   */
  swapInstanceIds?: string[];
  /**
   * 候補ごとの受理時ボーナスステップ（`core_move` 等、move_self/remove_from_game 以外の
   * 追加アクション、例: BSTH02-R11/BSTH03-C11/C12「手札に加えたとき、ボイドからコア1個を
   * 〜ネクサスに置く」）。`resolve_pending_deck_reveal_pick`(revealed_choice フェーズ) が
   * 手札へ受理された候補にのみ実行する（`engine-trash-optional-bonus-steps`、従来は
   * `moved_to_trash:optional_bonus_unsupported` ログのみで silent drop していた）。
   */
  bonusStepsByInstanceId?: Record<
    string,
    ReadonlyArray<import("./dsl-types").EffectStep>
  >;
}

/**
 * 非公開ゾーン（デッキ/トラッシュ/手札）からのカード選択待ち状態。
 * search_deck, return_from_trash, discard_hand, move_to_set_aside で使用。
 */
export interface PendingZoneSelection {
  battleEndDeferralAttackId?: string;
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
  /** Rule-based capacity choice, resolved through the shared card selection UI. */
  braveCapacityHostInstanceId?: string;
  /** この効果で選択者に開示済みの候補。live手札を公開せず、選択UIだけで使う。 */
  revealedCardDefinitionIds?: Record<string, string>;
  /** フィールド対象の戻し先選択。離場は通常の bounce primitive に委ねる。 */
  bounceContext?: {
    action: BounceAction;
    sourceTargetLockBypass?: TargetLockBypassProfile;
    effectSourceInstanceId?: string;
    effectSourceDefinitionId?: string;
    pendingLeaveChainId?: string;
  };
  /** 煌臨前の追加選択。通常のゾーン選択と同じUI/継続経路を使う。 */
  adventPreparation?: {
    params: import("./mechanics/advent-system").AdventParams;
    declaredStack?: ActiveStack;
  };
  pendingId: string;
  /** 選択者。効果の発揮者と異なりうる。 */
  actingPlayerId: string;
  /**
   * 元の効果を発揮したプレイヤー。選択者と異なる pending 解決でも、effect immunity を
   * 元効果と同じ発揮者で再評価する。
   */
  effectActingPlayerId?: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** トリガーしたアクション種別 */
  actionKind:
    | "brave_separation"
    | "bounce"
    | "search_deck"
    | "return_from_trash"
    | "discard_hand"
    | "advent_source"
    | "move_to_set_aside";
  /** 選択元ゾーン */
  sourceZone: Zone;
  /** 選択候補のカード instanceId リスト */
  candidateCardInstanceIds: string[];
  /** 選択可能な最大枚数 */
  maxCount: number;
  /** 選択したカードの移動先 */
  destination:
    | "hand"
    | "field"
    | "trash"
    | "set_aside"
    | "hand_or_set_aside_choice"
    | "deck"
    | "deck_bottom"
    | "removed_from_game";
  /** destination が deck のときの元テキスト位置指定。現状 deck 順は保持しないが intent は保持する。 */
  destinationPosition?: "top" | "bottom";
  /**
   * 移動先カウントを更新する対象プレイヤー。通常は `actingPlayerId` だが、
   * 相手トラッシュを相手デッキへ戻す pending では効果使用者と対象ゾーン所有者が異なる。
   */
  targetPlayerId?: string;
  /** 元 ExecuteEffectOptions の sourcePreventionLevel (効果耐性貫通フラグ)。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** 発生源カテゴリ等で限定された防止貫通プロファイル。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /**
   * `destination:"trash"` の選択確定後、選ばれたカード自身の
   * `moved_to_trash` 自動効果を発揮させない。
   * `DiscardAction.suppressMovedToTrashEffects` の pending 越しの伝播先。
   */
  suppressMovedToTrashEffects?: boolean;
  /** 破棄時効果を後続の process_moved_to_trash まで遅延する指定。 */
  deferMovedToTrashEffects?: boolean;
  /** 残りアクション（pending 解決後に再実行） */
  remainingActions: EffectAction[];
  /** 残りアクションの実行コンテキスト情報 */
  effectTiming: EffectTiming;
  /** pending 提示前の state。選択解決後の差分 trigger collection / abort 用。 */
  priorStateSnapshot?: GameState;
  /**
   * スキップ可否。`false` の場合は強制効果のため空選択での解決を許可しない。
   * 省略時は `true`（既存挙動互換）。
   */
  canSkip?: boolean;
  /**
   * OR 形式の代替選択条件。各エントリは「`count` 枚を `candidateInstanceIds` から選んだ場合も確定可」を意味する。
   * 例 (BSTH01-C12 ヴワル魔法図書館): primary = カード3枚、alternate = 系統「紅魔」1枚。
   * 解決時はどれか一つの条件を満たした選択集合のみ受理する。
   *
   * `filter` は UI 表示専用 (人間可読ラベル自動生成のため)。runtime ロジックは `candidateInstanceIds`
   * に解決済みのため filter を再評価しない。`label` が指定されていればそちらを優先する。
   */
  alternateSelections?: Array<{
    count: number;
    candidateInstanceIds: string[];
    label?: string;
    filter?: import("./dsl-types").CardFilter;
  }>;
  /**
   * 解決後に元効果の後続ステップを再実行するための継続情報
   * (CoreDistributionContinuation / MultiPlacementContinuation と同形)。
   * 「手札N枚まで破棄→破棄1枚につき2枚ドロー」(BSSL01-C01) のように、ゾーン選択の
   * 結果枚数に後続ステップ (cards_from_ref) が依存する場合に設定する。`undefined` の
   * pending (後続ステップ無し) は従来どおり card 移動のみで完了する。
   */
  continuation?: ZoneSelectionContinuation;
  /**
   * deck_reveal の per-pick 「手札と入れ替え」/「手札/手元と入れ替え」
   * (DeckRevealPick.destination = "hand_swap" / "hand_or_set_aside_swap")
   * のスワップアウト選択用メタデータ。
   *
   * 設定時:
   * - `candidateCardInstanceIds` には手札 + 手元の両方の候補が混在する。
   * - 選択された 1 枚は `destination` / `destinationPosition`
   *   (deck top/bottom or trash) へ送られた後、
   *   そのカードの元ゾーン (hand / set_aside) がスワップ先となり、`swapPickedInstanceId`
   *   で参照される picked card が同ゾーンへ入る。
   * - 空選択 (canSkip=true) は「この pick について入れ替えを諦める」を意味し、
   *   picked card はオープンカードの remainder と同じ行き先 (deck top/bottom/trash) へ送る。
   *
   * 正源: 10_rules/07b §BSTH09-C04/C05「手札/手元と入れ替えられる」(裁定 2026-06-17)。
   */
  swapPickedInstanceId?: string;
  /**
   * `swapPickedInstanceId` 経路で、スワップを諦めた (空選択) 場合に
   * picked card を送る remainder 行き先。`remainder: "top"|"bottom"|"trash"` のいずれか。
   * 設定時のみ swap-out 諦めパスが有効。
   */
  swapPickedFallbackRemainder?: "top" | "bottom" | "trash";
  /**
   * true の場合、`swapPickedInstanceId` 経路で選んだ swap-out カードの
   * deck top/bottom 行き先を解決時に `deckRevealPlacement` で選べる。
   * `deck_reveal.remainder = "top_bottom_split"` の「入れ替え後に好きなように上/下へ戻す」型で使う。
   */
  swapAllowsPlacementChoice?: boolean;
  /**
   * `swapPickedInstanceId` 経路の候補ゾーン制約。
   * 省略時は BSTH09 系の既存挙動どおり hand + set_aside を動的候補にする。
   * `["hand"]` は「手札1枚と入れ替えられる」型の revealed/trash 自己回収で使う。
   */
  swapCandidateZones?: Array<"hand" | "set_aside">;
  /**
   * 同一 deck_reveal/revealed_choice 解決中に swap-out 候補から除外する instanceId。
   * 入れ替えで加わるカード自身や同時に手札化されるカードを、同じ効果内の
   * swap-out へ再利用しないための不活性セット。
   */
  swapOutExcludedInstanceIds?: string[];
  /**
   * true の場合、`top_or_bottom` の実選択が確定する `finalizeDeckReveal` 時点で
   * `destination` / `destinationPosition` / `swapPickedFallbackRemainder` を補正する。
   */
  swapPlacementFollowsDeckReveal?: boolean;
  /**
   * `deck_reveal.remainder = "top_bottom_split"` の hand_swap は、swap-out カードも
   * 残りカード全体の ordering に混ぜる必要があるため、ordering 前に一時的に
   * pendingDeckReveal を退避して手札選択を出す。選択後、この pending を
   * `swapOutByPickedInstanceId` 付きで復元する。
   */
  deckRevealResumeAfterSwapSelection?: PendingDeckReveal;
  /**
   * この pending が閉じ、他の効果解決 pending が無い安定点で発火させる神託。
   * deck_reveal から派生した swap-out 選択にも引き継ぐ。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
}

/**
 * pendingZoneSelection から元効果の後続ステップ実行を再開するための継続情報。
 * `CoreDistributionContinuation` と同形だが、選択結果 (= 移動したカード) が解決時まで
 * 確定しないため、解決時に `recordStepId` の StepResult を選択カードで記録してから
 * `resumeStepIndex` で executeEffect を再起動する点が異なる。
 */
export interface ZoneSelectionContinuation extends LifeCoreSelectionContinuation {
  chainId: string;
  /** 派生手順を中断した場合は元カード本文ではなく、その手順自体を再開する。 */
  resumeEffectOverride?: import("./dsl-types").Effect;
  /** 再起動対象 effect の所属カード definitionId。 */
  sourceDefinitionId: string;
  /** カード定義 effects[] 配列のインデックス (provenance を一致させるため必須)。 */
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は `sourceDefinitionId` カードの `grandwalkerData.divineSkills[
   * divineSkillIndex].effects[]` を指す（top-level `effects[]` ではない）。
   * 神技/導技等の deck_reveal/zone_selection/count_selection 中断からの再開は、
   * 効果本体がカードの top-level `effects[]` ではなく divineSkills 側に定義されるため、
   * 再開解決側 (pending-action-handlers.ts) がどちらの配列を参照すべきか判別するために必要
   * (ENGINE-divine-skill-nested-effect-continuation、BSLH01-X01「導技：2」初出)。
   * 省略時 = 従来通り top-level `effects[]` を参照する。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  /** 再起動時の sourceInstanceId (pending 発行時から不変)。 */
  sourceInstanceId: string;
  /** P3-76/redirect 等へ引き継ぐ効果発揮元 instanceId。 */
  effectSourceInstanceId?: string;
  /** P3-76/redirect 等へ引き継ぐ効果発揮元 definitionId。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  /** 元効果の発動プレイヤー (= 効果使用側)。 */
  actingPlayerId: string;
  /** 再起動するステップ index (= ゾーン選択ステップの次)。 */
  resumeStepIndex: number;
  /**
   * ゾーン選択ステップ自身の stepId。解決時にこの id で StepResult
   * (affectedCardInstanceIds = 選択カード) を記録し、後続ステップの
   * `cards_from_ref` がそれを参照できるようにする。
   */
  recordStepId: string;
  /** 中断時のステップコンテキスト (前ステップの結果を保持して連続性を維持)。 */
  stepContext: import("./step-execution-context").SerializedStepContext;
  /** 元 ExecuteEffectOptions の choiceIndex (choice ステップの再評価に必要)。 */
  choiceIndex?: number;
  /** 元 ExecuteEffectOptions の effectActionKind (burst/effect 召喚コスト条件の継承用)。 */
  effectActionKind?: EffectResolutionActionKind;
  /** 元 ExecuteEffectOptions の sourcePreventionLevel (効果耐性貫通フラグ)。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** 発生源カテゴリ等で限定された防止貫通プロファイル。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 元 ExecuteEffectOptions の costPaidThisEffect (DynamicCount 用)。 */
  costPaidThisEffect?: number;
  /**
   * 同一 step の repeat が deck_reveal などの選択 pending で中断したときの再開位置。
   * 基本発揮は再実行せず、発揮開始時に固定した追加回数の残りだけを続行する。
   */
  repeatResume?: EffectStepRepeatResume;
  /**
   * pending 選択が閉じ、元効果の解決が完了した後に発火させる神託。
   * マジック使用時神託は、マジック効果の選択 pending をすべて解決してから
   * 派生効果と同時にキューする必要がある。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * battle_end deferred 効果から生成された deck/zone pending であることを示す attackId。
   * pending 解決中は scope:"battle" CE 失効を遅延する。
   */
  battleEndDeferralAttackId?: string;
  /**
   * 対象開示応答 (`targeted` 反応、destroy宣言→pendingTargetedDisclosureContinuation→
   * resolve_pending_triggered_effect→反応stack pass→反応本体解決) の途中で
   * zone_selection/deck_reveal/count_decrease が中断を挟んだ場合の元 disclosure continuation。
   * `StepOptionalContinuation.targetedDisclosureContinuation` と同型・同目的で、
   * pending 生成時に `state.pendingTargetedDisclosureContinuation` を保持し、
   * resume 直前に復元する (deck_reveal 側にこれが無かったため、反応内
   * targeted+deck_reveal+条件付き effect_immunity(current_effect) 構成が
   * deck_reveal の一時停止/再開を跨ぐと後続 effect_immunity が no-op になっていた
   * ギャップの修正、needs-dsl.audit BSLH01-R06/BSLH01-C01)。
   */
  targetedDisclosureContinuation?: TargetedDisclosureContinuation;
}

export type PostResolutionOracleTrigger =
  | {
      triggerCardInstanceId: string;
      triggerKind: "use_magic";
      chainId: string;
      magicTiming: "main" | "flash" | "stack";
      /** マジック宣言時点の実効色。pending 解決後にカードが trash へ移動しても導域判定へ渡す。 */
      magicEffectiveColors?: readonly CardColor[] | undefined;
      /**
       * マジック本体解決が pending を挟んだ場合、使用時神託と同じ完了点で
       * 「効果を発揮したとき」観測も発火させる。
       */
      effectActivatedActivatorPlayerId?: string;
      /** 「効果を発揮したとき」観測用の発揮不能ログ検査開始位置。 */
      effectActivationLogStart?: number;
      /** effect_activated 観測元カードが使用時に実際に満たした軽減シンボル枠数。 */
      effectSourceSatisfiedReductionSymbolCount?: number;
      /** effect_activated 観測元カードが使用時に要求された軽減シンボル枠数。 */
      effectSourceRequiredReductionSymbolCount?: number;
      /** @deprecated コスト差分互換用。軽減シンボル充足判定には上の2フィールドを使う。 */
      effectSourceTotalReduction?: number;
      /** 使用時点で effect_activated latch source 候補だった instance/effect-source ids。 */
      eligibleSourceInstanceIds?: string[];
      /**
       * `life_damage_interception.useCostGate` が effect 内の life→X core_move を
       * 置換した場合に限り、無償マジックの全 pending 解決後に元 effect を再開する。
       * マジックの対象選択・配置選択を越えて既存の post-resolution carrier で運ぶため、
       * 単なる discard と誤って core_move を即時キャンセルすることを防ぐ。
       */
      useCostGateCoreMoveResume?: Pick<
        PendingLifeDamageDiscardChoice,
        | "pendingId"
        | "actingPlayerId"
        | "continuation"
        | "stepResultId"
        | "coreMoveResume"
      >;
    }
  | {
      triggerCardInstanceId: string;
      triggerKind: "effect_activated";
      chainId: string;
      activatorPlayerId: string;
      /** 「効果を発揮したとき」観測用の発揮不能ログ検査開始位置。 */
      effectActivationLogStart?: number;
      /** effect_activated 観測元カードが使用時に実際に満たした軽減シンボル枠数。 */
      effectSourceSatisfiedReductionSymbolCount?: number;
      /** effect_activated 観測元カードが使用時に要求された軽減シンボル枠数。 */
      effectSourceRequiredReductionSymbolCount?: number;
      /** @deprecated コスト差分互換用。軽減シンボル充足判定には上の2フィールドを使う。 */
      effectSourceTotalReduction?: number;
      /** 使用時点で effect_activated latch source 候補だった instance/effect-source ids。 */
      eligibleSourceInstanceIds?: string[];
    };

/**
 * `EffectStep.executionMode === "optional"` のステップに到達したときに発行する選択待ち。
 *
 * 「前段は強制実行、後段は任意」の effect (例 BSGE01-M03 effects[1] step1「戻せる」、
 * BSGE01-C06 effects[1] step2「戻せる」、BSFT01-TR10(B) effects[2] step1) を表現する。
 * effect 全体としては既に発揮中 (`effect.executionMode` は mandatory) のため、effect 単位の
 * 「発揮する/しない」窓 (effect-level optional) ではなく、step 単位の skip/execute 選択窓を開く。
 *
 * 解決時は `resolve_pending_step_optional_choice` アクションで execute / decline を選び、
 * 対応する `applyPendingStepOptionalChoiceAction` が `continuation.stepIndex` (execute) または
 * `continuation.stepIndex + 1` (decline) を `startFromStepIndex` として executeEffect を再起動する。
 *
 * ルール正源:
 *   - memory project_kuwaerareru_optional (「できる/られる」=任意)
 *   - 10_rules/03b §step-level optional / 03c §可能形語尾
 *   - dsl-types.ts §EffectStep.executionMode
 */
export interface PendingStepOptionalChoice {
  pendingId: string;
  /** 効果のオーナー (発動者)。usage / source tagging はこの ID を継続使用する。 */
  actingPlayerId: string;
  /**
   * execute / decline の判断を行うプレイヤー。
   * - 省略時/effect owner と同値 = `actingPlayerId` (chooser 未指定 = "self")。
   * - step.chooser='opponent' (= choice variant.chooser 上書き反映後) なら相手プレイヤーの ID。
   * current-actor / legal action prompt / apply 検証はこちらの ID を見る。
   *
   * 正源: needs-dsl.audit ENGINE-step-optional-choice-chooser-opponent。
   */
  choosingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  /** UI 表示用ラベル (省略時は step.id か `__step_<i>`)。 */
  stepLabel?: string;
  /** UI/API 表示用: 効果内のどの任意処理かを示す step 単位 prompt。 */
  prompt?: PendingStepPrompt;
  /** false の場合、対象不足などで execute は合法手として提示・適用しない。 */
  canExecute?: boolean;
  /**
   * false の場合、effect-level optional を「発揮する」と選んだ後にこの step を辞退すると
   * ここまで実行済み payload がなく、後続にも独立した実行機会が残らないため、
   * decline を合法手として提示・適用しない。
   * 「Nまで」型の 0 指定など、事実上の不発が本文上許される場合は true のまま。
   */
  canDecline?: boolean;
  /**
   * 「N につき1個/1枚まで」型の optional step で、execute/decline の二択ではなく
   * 0..N の数量選択として提示するためのメタデータ。
   *
   * 例: BSTS01-X01「破壊した対象1体につき、コア1個まで / 1枚まで」。
   * decline は 0、execute は selectedAmount (省略時 max) として解決する。
   */
  optionalQuantity?: {
    kind: "core_move" | "draw" | "discard";
    min: number;
    max: number;
  };
  /** execute 解決時に executeEffect を再開するための継続情報。 */
  continuation: StepOptionalContinuation;
  /** P3-76 targeted disclosure の元効果再開/cleanup を optional choice 解決後まで保持する。 */
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/** DSL authoring 側の表示メタ。label/question の人称は効果の実行者基準。 */
export interface EffectStepPrompt {
  /** ボタン/短縮表示用。例: "相手のバースト1つを破棄"。 */
  label?: string;
  /** overlay の主表示。例: "相手のバースト1つを破棄しますか？"。 */
  question?: string;
  /** 補助表示する該当原文。カード全体ではなく、この step/choice に対応する文だけを置く。 */
  sourceText?: string;
}

/** pending に載せる解決済み prompt。操作文は選択者視点、sourceText は原文のまま。 */
export interface PendingStepPrompt {
  label: string;
  question: string;
  sourceText?: string;
}

export interface PendingStepChoiceOption {
  choiceIndex: number;
  label: string;
  prompt?: PendingStepPrompt;
  /**
   * この分岐を選んだ後に支払う effect 内 `pay_cost` の合計。
   * stack 窓後の choice でも training/GUI が支払い元を選べるよう保持する。
   */
  requiredPayCostAmount?: number;
}

export interface PendingPaidEffectModifierChoice {
  kind: "paid_prevention_immunity" | "paid_leave_suppression";
  cost: { resource: "count"; amount: number };
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceTribes: readonly string[];
}

/**
 * `EffectStep.choice` を解決時に選ぶための選択待ち。
 *
 * 神技/導技など「発揮宣言 → スタック窓 → 効果本文の『AするかBする』を選択」
 * の流れで、宣言 action に choiceIndex を載せず、効果解決中に分岐選択を行う。
 * 解決時は `resolve_pending_step_choice` で choiceIndex を確定し、同じ step から
 * executeEffect を再開する。
 */
export interface PendingStepChoice {
  pendingId: string;
  actingPlayerId: string;
  choosingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  stepLabel?: string;
  /** UI/API 表示用: 効果内 choice 全体の問い。 */
  prompt?: PendingStepPrompt;
  choices: readonly PendingStepChoiceOption[];
  continuation: StepOptionalContinuation;
  /**
   * 宣言済み ActiveStack の EffectStep.choice を窓後に確定する場合の再開情報。
   * 設定時は continuation は表示サニタイズ互換のための最小情報であり、解決は
   * deferredStack に choiceIndex を反映して resolveDeferredStackAction を再開する。
   */
  deferredStack?: ActiveStack;
  remainingStacks?: ActiveStack[];
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
  paidEffectModifierChoice?: PendingPaidEffectModifierChoice;
  /** deck_revealを副作用前に中断したミラージュ交換選択。viewerへは公開しない。 */
  mirageSetChoice?: PendingMirageSetChoice;
}

export interface PendingMirageSetChoice {
  reveal: PendingDeckReveal;
  sourceInstanceIds: string[];
  sourceInstanceId: string;
  replacementChoices: string[][];
  replacementsByInstanceId: Record<string, string[]>;
  resume:
    | {
        kind: "revealed_choice";
        action: import("./legal/legal-actions-types").ResolvePendingDeckRevealPickLegalAction;
        selectedCardIds: string[];
        paymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
        miragePaymentSourcesByInstanceId?: Record<
          string,
          readonly import("./core/payment-system").CardCostPaymentSource[]
        >;
      }
    | {
        kind: "finalize";
        remainderOrder: string[];
        effectivePlacement?: PendingDeckReveal["remainder"];
        remainderPlacementById?: Record<string, "top" | "bottom">;
      };
}

/**
 * `PendingStepOptionalChoice` 解決時に executeEffect を再起動するための継続情報。
 * ZoneSelectionContinuation と同形だが、再起動ステップは「ゾーン選択の次」ではなく
 * 「optional step 自身」(execute) または「次ステップ」(decline) になる。
 */
export interface StepOptionalContinuation {
  sourceDefinitionId: string;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は `sourceDefinitionId` カードの `grandwalkerData.divineSkills[
   * divineSkillIndex].effects[]` を指す（top-level `effects[]` ではない）。
   * `ZoneSelectionContinuation.divineSkillIndex` と同目的
   * (ENGINE-divine-skill-nested-effect-continuation)。省略時 = top-level `effects[]`。
   */
  divineSkillIndex?: number;
  /**
   * 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す
   * (top-level `effects[]` ではない)。divineSkillIndex と同型パターン
   * (ENGINE-move-card-actual-count-amount)。省略時 = top-level `effects[]`。
   */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  sourceInstanceId: string;
  actingPlayerId: string;
  /** optional step 自身の index。execute なら resumeStepIndex=stepIndex、decline なら stepIndex+1。 */
  stepIndex: number;
  /**
   * 再発火など、カード定義上の effect をそのまま再開できない一時合成 Effect。
   * 通常は未設定で、sourceDefinitionId/effectIndex からカード定義の effect を使う。
   */
  resumeEffectOverride?: import("./dsl-types").Effect;
  /** 中断時のステップコンテキスト (前ステップ結果保持で連続性維持)。 */
  stepContext: import("./step-execution-context").SerializedStepContext;
  choiceIndex?: number;
  /**
   * 解決中の効果種別。on_step 対象選択で中断した optional step を再開するとき、
   * バースト効果由来の召喚を実行時にも `summonCause:"burst"` として保つ。
   */
  effectActionKind?: EffectResolutionActionKind;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 星霊衣など、実行 source とは別の effect provider instance を resume へ保持する。 */
  effectSourceInstanceId?: string;
  /** 星霊衣など、実行 source とは別の effect provider definition を resume へ保持する。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  chainId: string;
  /**
   * 宣言時に渡された対象 instanceId 群 (executeEffect options.targetInstanceIds)。
   * 後続 step の target step が選択対象を取り戻せるよう resume 時に再注入する。
   */
  targetInstanceIds?: readonly string[];
  /** targetInstanceIds を注入する DSL step id (executeEffect options.targetStepId)。 */
  targetStepId?: string;
  /** 複数stepの宣言対象は、先行groupを消費した後も元の割付を保持する。 */
  targetGroups?: readonly PendingEffectTargetGroup[];
  /** 未消費の宣言済み対象は任意手順を跨いでも再開示しない。新しい対象選択には適用しない。 */
  preservePreSelectedTargetRefs?: boolean;
  /**
   * `targetSelectionTiming:"on_step"` の反復中に対象選択 pending で中断した場合の
   * 再開位置。基本発揮は再実行せず、選ばれた 1 回分の追加発揮から続行する。
   */
  repeatResume?: EffectStepRepeatResume;
  /**
   * 対象開示応答内で optional step に入った場合の元効果継続。
   * optional 解決中だけ `pendingTargetedDisclosureContinuation` へ復元する。
   */
  targetedDisclosureContinuation?: TargetedDisclosureContinuation;
  /**
   * 宣言時に記録した usageLimit (P3-62 払い戻し用)。resume 後の conditional_cost
   * rollback で「発揮できません」になった際に refundAllRecordedUsage が
   * recordedUsage を必要とするため continuation に保持する。
   */
  recordedUsage?: RecordedEffectUsage;
  /**
   * 誘発イベントの量 (executeEffect options.eventAmount)。resume 後の
   * DynamicCount.event_amount 評価のため stepContext.eventAmount に復元する。
   */
  eventAmount?: number;
  /**
   * 同時誘発グループ ID (executeEffect options.pendingEffectSimultaneousGroupId)。
   * resume 後の stay_on_field 等が同グループ pending を撤回できるよう保持する。
   */
  pendingEffectSimultaneousGroupId?: string;
  /**
   * P3-129: 解決中の pending triggered effect 自身の pendingId (executeEffect
   * options.pendingEffectPendingId)。resume 後も `correlate_pending_trigger` が
   * 正しい pendingId を相関記録できるよう保持する。
   */
  pendingEffectPendingId?: string;
  /**
   * `fireBattleEndDeferrals` からの発火中に生成された optional pending であることを示す
   * attackId。battle_end deferred 効果が pendingStepOptionalChoice で中断した場合、
   * `executeBattleResolution` の scope:"battle" CE 失効判定 (`finalizeBattleEndScopeExpirations`)
   * を継続解決完了まで遅延させるために使う。
   *
   * 正源: needs-dsl.audit ENGINE-battle-end-deferred-yield-finalize。
   */
  battleEndDeferralAttackId?: string;
  /**
   * optionalQuantity 解決で選ばれた実行量。executeEffect 再開時に当該 step の
   * core_move.amount / draw.count / discard.count だけを一時的に上書きする。
   */
  selectedOptionalQuantityAmount?: number;
}

/**
 * `deck_reveal` action、または `discard` action (fromZone:deck、原文「デッキを破棄する」側)
 * を含む step の実行直前に、実行者が `grant_optional_deck_reveal_count_boost` CE
 * (BSLH01-X09【クォーツ：練刃】) を保持しているとき開く「枚数+1適用可否」の選択待ち。
 *
 * `PendingStepOptionalChoice` とは異なり、対象 step 自身の `executionMode` は
 * 通常どおり mandatory のまま（カード定義側で optional 化しない）。CE 所有プレイヤーが
 * 動的に「他カードの deck_reveal/discard(deck) 実行の都度」+1 適用可否を選べる継続修飾の
 * ため、トリガー条件が CE 存在チェック (実行時) である点が step-level optional 型と異なる。
 * continuation の形は同一 (`StepOptionalContinuation` を再利用)。
 *
 * 解決時は `resolve_pending_deck_reveal_count_boost` アクションで apply / decline を選び、
 * `applyPendingDeckRevealCountBoostChoiceAction` が `continuation.stepIndex` から
 * executeEffect を再起動する（`ExecuteEffectOptions.deckRevealCountBoostResolution` 経由で
 * revealCount への bonusAmount 加算可否を伝える）。
 *
 * 正源: needs-dsl.audit ENGINE-optional-deck-reveal-count-boost。
 */
export interface PendingDeckRevealCountBoostChoice {
  pendingId: string;
  /** CE 所有者 = deck_reveal 実行効果のオーナー (「自分のスピリットの効果」に限定されるため同一)。 */
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  /** apply 選択時に加算する枚数 (grant 元 CE の bonusAmount)。 */
  bonusAmount: number;
  /** battle_end deferred 効果由来の中断なら、scope:"battle" CE 失効を選択完了まで遅延する。 */
  battleEndDeferralAttackId?: string;
  /** apply 解決時に executeEffect を再開するための継続情報。 */
  continuation: StepOptionalContinuation;
  /** 対象開示の子効果が枚数追加選択で止まった場合、その子の完了まで保持する。 */
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/**
 * `connector:"after_triggers"` が前段由来の誘発を queue したとき、同一効果の後続 step を
 * 誘発解決後に再開するための内部 continuation。
 *
 * `after_triggers` は「この効果発揮後」より前に、その直前 step で発生した誘発・離脱置換
 * サブチェーンを先に全解決する境界。queue だけして同じ executeEffect ループで後続へ進むと、
 * 離脱置換で最終原因が変わるカードの `ref_left_field` 判定を早すぎる時点で消費してしまう。
 */
export interface PendingAfterTriggersContinuation {
  continuationId: string;
  /** この after_triggers 境界が queue した pending の chainId。子孫 chain も待機対象。 */
  waitChainId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は `sourceDefinitionId` カードの `grandwalkerData.divineSkills[
   * divineSkillIndex].effects[]` を指す（top-level `effects[]` ではない）。
   * `ZoneSelectionContinuation.divineSkillIndex` と同目的
   * (ENGINE-divine-skill-nested-effect-continuation)。省略時 = top-level `effects[]`。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  sourceInstanceId: string;
  /** 再発火など、カード定義上の effect をそのまま再開できない一時合成 Effect。 */
  resumeEffectOverride?: import("./dsl-types").Effect;
  actingPlayerId: string;
  /** `after_triggers` connector を持つ step index。再開時はこの step から connector を再実行せず進む。 */
  resumeStepIndex: number;
  stepContext: import("./step-execution-context").SerializedStepContext;
  effectResolutionBeforeState?: GameState;
  choiceIndex?: number;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  triggerFromZone?: Zone;
  triggerCause?: TriggerEventCause;
  triggerRelatedInstanceZone?: Zone;
  activationZone?: EffectActivationSourceZone;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  chainId: string;
  targetInstanceIds?: readonly string[];
  targetStepId?: string;
  targetSelectionResolved?: boolean;
  targetGroups?: readonly PendingEffectTargetGroup[];
  sequentialTargetConsumption?: boolean;
  recordedUsage?: RecordedEffectUsage;
  eventAmount?: number;
  pendingEffectSimultaneousGroupId?: string;
  /**
   * P3-129: 解決中の pending triggered effect 自身の pendingId (executeEffect
   * options.pendingEffectPendingId)。resume 後も `correlate_pending_trigger` が
   * 正しい pendingId を相関記録できるよう保持する。
   */
  pendingEffectPendingId?: string;
  battleEndDeferralAttackId?: string;
  rangeAutoResolveStrategy?: "min" | "max";
}

/**
 * `EffectStep.executionMode === "optional"` の execute resume で、当該 step が独自に
 * 対象 (`step.action.target`) を要求するときの「どのカードを対象に取るか」プレイヤー選択窓。
 *
 * 既存の `pendingEffectTargetSelection` は registration 経路 (ActiveStack) に紐付くため、
 * 効果途中の optional step 単独で別途開く target 選択は乗らない。本 pending は
 * `applyPendingStepOptionalChoiceAction` の `choice="execute"` 経路で step が自前の target を
 * 持つ場合に立て、解決時に `targetInstanceIds` + `targetStepId` (= optional step の id) を
 * 注入して executeEffect を当該 step から再開する。
 *
 * BSGE01-C06 effects[1] step2 (send_to_deck 疲労状態相手 1 体) のように「前段は強制実行、
 * 後段は任意で対象 1 体」の effect で、これまで engine が pool.slice(0,count) で機械選択して
 * いたものをプレイヤー選択に格上げする。
 *
 * 正源: needs-dsl.audit ENGINE-step-optional-target-step-pending-selection。
 */
export interface PendingStepOptionalTargetSelection {
  pendingId: string;
  /** 効果のオーナー (発動者)。usage / source tagging はこの ID を継続使用する。 */
  actingPlayerId: string;
  /**
   * 対象選択を行うプレイヤー。
   * - 省略時は `actingPlayerId` と同値 (= step.chooser 未指定 = "self")。
   * - step.chooser='opponent' なら相手プレイヤーの ID。
   * current-actor / legal action prompt resolver / apply 検証はこちらの ID を見る。
   *
   * 正源: needs-dsl.audit ENGINE-step-optional-target-chooser-opponent。
   */
  choosingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  /** UI 表示用ラベル (省略時は step.id か `__step_<i>`)。 */
  stepLabel?: string;
  /** 必要対象数 (= TargetSpec.count の下限解決)。 */
  requiredTargetCount: number;
  /** 上限対象数 (= TargetSpec.count の上限解決、"all" は候補数)。 */
  maxTargetCount: number;
  /**
   * 選択集合の合計 BP 上限（予算制、count とは独立の制約。ENGINE-cumulative-bp-budget-destroy）。
   * `TargetSpec`(filter variant) の `budget.amount` を解決時 (`resolveStepTargetCounts`) に
   * 数値化して保持する。未指定なら予算制約なし（従来挙動）。
   * 「自分のスピリットすべての合計BPまで、相手を好きなだけ破壊する」(BSAZ01-C11) 用。
   * 検証は `applyPendingStepOptionalTargetSelectionAction` (pending-action-handlers.ts) が
   * 選択済みカードの実効BP合計と比較する単一 chokepoint。
   */
  bpBudgetAmount?: number;
  /** 選択集合の合計コスト上限（予算制、count とは独立の制約）。 */
  costBudgetAmount?: number;
  /**
   * 選択集合の合計実効シンボル数上限（予算制、count とは独立の制約。
   * ENGINE-cumulative-symbol-budget-destroy）。`getCombinedUnitSymbolCount` と同基準。
   * 「シンボル合計N個まで」(BSLH01-X05) 用。
   */
  symbolBudgetAmount?: number;
  /** 候補 instanceId (TargetSpec.filter を解決したもの)。 */
  candidateInstanceIds: string[];
  /**
   * resume 時に executeEffect へ渡す `targetStepId`。当該 optional step の
   * `step.id ?? "__step_<i>"` を格納する (effect-interpreter は同 id でのみ
   * preSelectedIds を消費する)。
   */
  targetStepId: string;
  /** execute resume で実行する継続情報 (PendingStepOptionalChoice と同形)。 */
  continuation: StepOptionalContinuation;
}

/**
 * コスト先払い型ドロー枚数修正の「任意コストを支払って +N するか」プレイヤー選択待ち状態。
 *
 * 例: BSSL01-C03 カルテノン神殿 Lv2『自分のドローステップ』〔重複不可〕
 *   「手札の系統:「影」/「プレイヤー」カード1枚を破棄することで、ドロー枚数を+1する」。
 *
 * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正（裁定 2026-06-15, model A）。
 * システムドロー**より前に**任意コスト（破棄）の支払い判断を解決し、**支払えた場合のみ +N を
 * 確定**してからシステムドローを行う（コスト → ボーナス確定 → システムドロー）。
 *
 * 本 pending が立っている間ドローステップは中断され、解決（支払い or 辞退）後に
 * `resolvePendingDrawStepCostChoice` がシステムドローを bonus 付きで実行する。複数の
 * 適格コスト効果が同時に存在する場合は entries に並べ、1 件ずつ解決して次へ進む。
 */
export interface PendingDrawStepCostChoice {
  pendingId: string;
  /** ドローを行うアクティブプレイヤー（= コスト支払い側）。 */
  actingPlayerId: string;
  /** すでに確定した追加ドロー枚数（既に解決済みエントリの合算）。 */
  resolvedBonus: number;
  /** 未解決の任意コストエントリ（先頭から 1 件ずつ解決）。 */
  entries: PendingDrawStepCostEntry[];
}

/**
 * PendingDrawStepCostChoice の 1 効果分エントリ。
 * 「破棄できるカード 1 枚を選んで +N」型の任意コスト 1 件を表す。
 */
export interface PendingDrawStepCostEntry {
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** カード定義 effects[] のインデックス（usageLimit ラベル整合のため）。 */
  effectIndex: number;
  /** 破棄候補の手札カード instanceId（系統等のフィルタ適用済み）。 */
  candidateCardInstanceIds: string[];
  /** 支払い直前にも再検証する手札カードフィルタ。 */
  cardFilter: import("./dsl-types").CardFilter;
  /** 支払えた場合に確定する追加ドロー枚数。 */
  bonus: number;
  /** 破棄カードに応じた移動先置換（例: 特定名ならトラッシュのかわりに配置）。 */
  discardDisposition?: import("./dsl-types").DrawStepPrepaidDiscardDisposition;
}

/**
 * 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』の可変枚数コスト選択待ち状態。
 *
 * 例: BSTH02.7-M01 Lv1「このカードを召喚するとき、自分のトラッシュにあるカード2枚までを
 *   除外し、除外したカード1枚につきコストを-1する。」
 *
 * pendingDrawStepCostChoice (model A, 10_rules/02) と同型の「コストより前に任意選択を解決」
 * パターンを、召喚コスト計算の直前に適用する。0〜maxCount 枚を選び（0 も可＝辞退相当）、
 * 選んだカードは即座に removed_from_game へ移動し、選択枚数 × discountPerCard が
 * 通常のコスト軽減後 finalCost からさらに追加減算される (additionalCostModifiers 経由、
 * symbol 軽減とは独立に加算される点が baseCostOverride と異なる)。
 *
 * 解決後は同じ sourceInstanceId に対する通常の `summon` legal action を、確定した
 * additionalCostModifiers 付きで即時実行する（solver は 2 手に分割しない。除外は
 * 「召喚するとき」に不可分な選択のため、除外だけ確定して召喚を取りやめる余地を残さない）。
 */
export interface PendingSummonCostExcludeChoice {
  fullCostPaid?: boolean;
  pendingId: string;
  actingPlayerId: string;
  /** 割引対象＝召喚されるカード自身の instanceId。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** カード定義 effects[] のインデックス（usageLimit ラベル整合用、現状は未使用でも保持）。 */
  effectIndex: number;
  /** 除外候補（フィルタ適用済みの自分の対象ゾーン instanceId）。 */
  candidateCardInstanceIds: string[];
  /** 選択可能な最大除外枚数。 */
  maxCount: number;
  /** 除外1枚につきの追加コスト軽減量（正の整数）。 */
  discountPerCard: number;
  /**
   * 除外元ゾーン (engine-alt-cost-summon-multizone)。省略時は従来どおり "trash"
   * （素の moveCardZone で除外）。"field" 指定時は合体/コア/離脱誘発を伴うため
   * executeRemoveFromGame（フィールド離脱 SSOT）経由で除外する。"hand_or_set_aside"
   * (ENGINE-summon-self-exclude-alt-cost-full-reduction) は素の moveCardZone で除外する
   * ("field" 以外と同じ経路)。
   */
  sourceZone?: "trash" | "field" | "hand_or_set_aside";
  /**
   * true のとき、除外による支払いは線形割引 (`discountPerCard`) ではなく
   * `costModifier:"full_reduction"` 相当（軽減シンボルすべてを満たしたものとして扱う）に
   * 合流する (ENGINE-summon-self-exclude-alt-cost-full-reduction, BSTH11-M01 effects[0])。
   * このとき `discountPerCard` は無視される (0 固定)。
   */
  fullReduction?: boolean;
  /**
   * 必須除外枚数 (engine-alt-cost-summon-multizone)。省略時/0 は従来どおり任意
   * （0枚選択可）。1以上のときは resolveSummonCostExcludeChoiceSelection が
   * 選択数不足をエラーにする（「除外することで召喚コストを支払う」型の必須支払い）。
   */
  minCount?: number;
  /**
   * 「手札/手元にあるこのカードは召喚できる」自己召喚許可 (getHandSummonPermissionSpec) 経由の
   * 召喚のとき、その許可 effect の effects[] インデックス。設定時、解決時の
   * `useSummonInStackContextAsAction` に `allowNonMainStep:true` + `sourceEffectIndex` を渡し、
   * main step 以外（フラッシュ窓等）でもスタック窓を正しく開く
   * (BSTH02.7-X02 effects[0]/[1] 型: 許可効果と除外コスト軽減が別 effect の場合)。
   */
  summonPermissionEffectIndex?: number;
  /**
   * `summonPermissionEffectIndex` の usageLimit（`SummonLegalAction.summonPermissionUsageLimit`
   * と同一値）。設定時、解決時に `recordEffectUsageIfLimited` を呼び〔ターンに1回：同名〕等の
   * 使用制限を記録する（未設定なら記録なし＝従来挙動）。
   */
  summonPermissionUsageLimit?: EffectUsageLimit | EffectUsageLimit[];
  /** 共有使用制限グループ ID（`SummonLegalAction.summonPermissionLimitGroupId` と同一値）。 */
  summonPermissionLimitGroupId?: string;
  /**
   * `SummonAction.onBoardCoreSourceFilter` のスナップショット。pending 解決時も
   * 宣言時と同じ支払い元制約を維持する。
   */
  onBoardCoreSourceFilter?: import("./dsl-types").CardFilter;
  /**
   * フラッシュ/スタック見出しの即時型 hand effect 解決中に開いた pending。
   * 選択解決後は再度召喚スタックを開かず、元の効果解決として in_use の self summon へ戻す。
   */
  effectSummonActivationZone?: EffectActivationSourceZone;
  effectSummonChainId?: string;
  effectSummonSourceEffectIndex?: number;
  effectSummonEffectTiming?: EffectTiming;
}

/**
 * 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを支払わずに
 * 召喚する』代替コスト支払いの選択待ち状態 (BSSL01-M02 effects[0,1])。
 *
 * `PendingSummonCostExcludeChoice`（カード除外による線形割引）とは支払いの実体が異なる：
 * あちらは候補カード（トラッシュ/フィールド）を選ぶが、本 pending は支払いの実体が
 * コアのゾーン移動そのもの（トラッシュ→フィールド/リザーブ）であるため、候補は
 * 「移動可能なコア総数」と「移動先」の2軸になる。移動枚数は `minCount` 以上
 * `availableCoreCount` 以下から選び（超過分の追加割引は無い＝`costOffset` は固定額）、
 * 移動先は自分のフィールドカード1枚（`fieldDestinationCandidateInstanceIds` から選択）
 * または自分のリザーブのいずれか一括。解決は
 * `resolveSummonCostCoreMoveChoiceSelection`（mechanics/summon-cost-core-move-choice.ts）。
 */
export interface PendingSummonCostCoreMoveChoice {
  grantsFreeSummon?: boolean;
  pendingId: string;
  actingPlayerId: string;
  /** 召喚されるカード自身の instanceId。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** カード定義 effects[] のインデックス（cost_modify を持つ継続効果側）。 */
  effectIndex: number;
  /**
   * 選択時点で移動可能なトラッシュのコア総数（通常コア優先+ソウル自動補完、
   * SSOT: `partitionTrashMoveWithSoul`）。
   */
  availableCoreCount: number;
  /** 必須移動枚数下限。0 以下にはならない（`useCostPayment.core_move.minCount` 直写し）。 */
  minCount: number;
  /**
   * 相殺する追加コスト量（正の整数）。解決時 `additionalCostModifiers` には
   * `-costOffset` として渡す（`modifier.additionalCostValue` の絶対値）。
   */
  costOffset: number;
  /** 移動先「フィールド」候補の自分のフィールドカード instanceId（0件なら reserve のみ選択可）。 */
  fieldDestinationCandidateInstanceIds: string[];
  /**
   * 「手札/手元にあるこのカードは召喚できる」自己召喚許可経由の召喚のとき、
   * その許可 effect の effects[] インデックス（`PendingSummonCostExcludeChoice` と同用途）。
   */
  summonPermissionEffectIndex?: number;
  /** `PendingSummonCostExcludeChoice.summonPermissionUsageLimit` と同用途。 */
  summonPermissionUsageLimit?: EffectUsageLimit | EffectUsageLimit[];
  /** `PendingSummonCostExcludeChoice.summonPermissionLimitGroupId` と同用途。 */
  summonPermissionLimitGroupId?: string;
  /**
   * `SummonAction.onBoardCoreSourceFilter` のスナップショット。pending 解決時も
   * 宣言時と同じ支払い元制約を維持する。
   */
  onBoardCoreSourceFilter?: import("./dsl-types").CardFilter;
  /**
   * フラッシュ/スタック見出しの即時型 hand effect 解決中に開いた pending。
   * 選択解決後は再度召喚スタックを開かず、元の効果解決として in_use の self summon へ戻す。
   */
  effectSummonActivationZone?: EffectActivationSourceZone;
  effectSummonChainId?: string;
  effectSummonSourceEffectIndex?: number;
  effectSummonEffectTiming?: EffectTiming;
}

/**
 * 複数対象召喚 (target:"other"、from_zone) の「除外したカードN枚につき、召喚対象1体の
 * コストを0(overrideCost)にする」型グループ化コストオーバーライド選択待ち
 * (BSTH02.7-C06 branch2)。0〜maxCount 枚を trash から選び（0 も可）、選択枚数から
 * floor(選択枚数/groupSize) を算出し、summonTargetInstanceIds の先頭からその数だけ
 * コストを overrideCost にする。残りは印字コストのまま自動的に reserve から支払われる
 * (structured-summon.ts executeSummonOther の自動経路、interactive payment 不要)。
 *
 * `PendingSummonCostExcludeChoice` (自己召喚・線形割引専用) とは別の pending にした理由:
 * あちらは `sourceInstanceId` = 召喚される当該カード自身（コスト表示・支払いソース列挙が
 * その1枚基準）だが、本 pending は発動元カード（効果を持つマジック）1枚に対し、コストの
 * 異なる複数の召喚対象を扱うため、同じ struct を共用すると表示メタデータが対象不一致になる。
 */
export interface PendingGroupedSummonCostOverrideChoice {
  chainId: string;
  pendingId: string;
  actingPlayerId: string;
  /** 発動元（このグループ化オーバーライドを提供する効果を持つカード）。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 既に確定した召喚対象 instanceId（from_zone 選択済み、1件以上）。 */
  summonTargetInstanceIds: readonly string[];
  /** 除外候補（フィルタ適用済みの自分のトラッシュ instanceId）。 */
  candidateCardInstanceIds: string[];
  maxCount: number;
  groupSize: number;
  overrideCost: number;
  /**
   * グループ化オーバーライド対象外 (除外未達分) の召喚対象へ `fullReduction` (軽減シンボル
   * すべてを満たしたものとして扱うコスト計算) を適用するかどうか (BSTH02.7-C06 branch2
   * 「軽減シンボルすべてを満たして召喚できる」)。発動元 SummonAction の
   * `costModifier === "full_reduction"` から転写する。
   */
  nonOverrideFullReduction?: boolean;
}

/**
 * `life_damage_interception` の `discardCostGate` 付き CE がライフ減少に一致したときの
 * 「このカードを破棄して防ぐ/辞退する」プレイヤー選択待ち状態。
 *
 * 例: BSTH02.7-C05[1]「手札/手元にあるこのカードは、相手の効果で自分のライフが減るとき、
 *   破棄することで自分のライフは減らない」。
 *
 * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正（model A）と同じプレ判断モデル。
 * `pendingAmount`（this pending 生成時点までに他 CE で調整済みの実ダメージ量）を、
 * 支払い時は 0 に、辞退時はそのまま適用してダメージ解決を再開する
 * （`resolvePendingLifeDamageDiscardChoice`）。複数の discardCostGate CE が同時一致した
 * 場合は `entries` に並べ、1 件ずつ解決する（先頭が支払い確定した時点でダメージは 0 = 残り
 * entries は不要になるため畳む）。
 */
export interface PendingLifeDamageDiscardChoice {
  pendingId: string;
  /** ライフが減る側（=破棄コストを支払うかどうかを決める側）のプレイヤー。 */
  decidingPlayerId: string;
  /** ダメージの発生元プレイヤー（ログ/context 用）。 */
  actingPlayerId: string;
  /** LifeDamageContext.cause と同じ union（discardCostGate は cause:"any" 併用も許容）。 */
  cause: "opponent_effect" | "self_effect" | "battle";
  /** 辞退時に適用する実ダメージ量（他 CE で調整済み）。 */
  pendingAmount: number;
  /** 未解決の破棄コストエントリ（先頭から 1 件ずつ解決）。 */
  entries: PendingLifeDamageDiscardEntry[];
  /**
   * discardCostGate と turn_cap が同時に一致した場合、支払い (pay) なら
   * ライフ減少は発生しないため消費しない。最終的に全 entry を辞退したときだけ、
   * 実際に減った量をここに記録された bucket へ計上する。
   */
  turnCapConsumption?: PendingLifeDamageTurnCapConsumption;
  /**
   * `executeCoreMove` の life→X (trash/void/reserve/field_card/this_card) 経路で
   * この pending が生成された場合のみ設定される。解決 (pay/decline) 後、この記述で
   * 元の `executeCoreMove` 呼び出しを再開する（`pendingLifeCoreSelection` の
   * resume パターンと同型。resolveLifeDamage 経由の直接ダメージでは undefined）。
   */
  coreMoveResume?: CoreMoveDiscardResumeContext;
  battleEndDeferralAttackId?: string;
  /**
   * core_move が効果途中でこの pending を生成した場合、pay/decline 解決後に
   * 元効果の後続 step を再開する。core_move 自体は coreMoveResume で完了/キャンセルする。
   */
  continuation?: LifeCoreSelectionContinuation;
  /** continuation 再開前に完了扱いで記録する中断元 core_move stepId。 */
  stepResultId?: string;
  /**
   * P3-76 対象開示応答の resolutionCleanups 引き継ぎ用（他 pending 型と同型）。
   * `attachTargetedDisclosureResolutionCleanups` がこの pending 存命中に cleanup を
   * 追記でき、解決時に `applyOrDeferTargetedDisclosureResolutionCleanups` で処理する。
   */
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/** discardCostGate pending の decline 時に遅延消費する turn_cap bucket。 */
export interface PendingLifeDamageTurnCapConsumption {
  playerWide?: boolean;
  filteredEffectIds?: readonly string[];
}

/**
 * PendingLifeDamageDiscardChoice の 1 CE 分エントリ。
 * - costKind 省略 or "discard"（discardCostGate）: 破棄対象は sourceInstanceId 自身固定。
 * - costKind:"use"（useCostGate、BSLH01-M05[1]）: 支払いはこのカード自身の使用
 *   （コスト踏み倒し）。カードは discard と同じくトラッシュへ置かれるが、加えて
 *   `lifeDamageInterceptionUseCostGateUsedThisTurn` に記録される点が discard と異なる。
 * - costKind:"declare_gimmick"（declareGimmickGate、BSLH01-C12）: 支払いはカード破棄
 *   ではなく declare_gimmick アクション。ダメージは 0 ではなく `reduceBy` 分だけ軽減する。
 *   sourceInstanceId は CE の宣言元（ログ用、破棄対象ではない）。
 */
export type PendingLifeDamageDiscardEntry =
  | {
      costKind?: "discard";
      ceEffectId: string;
      sourceInstanceId: string;
      sourceDefinitionId: string;
      sourceZone: "hand" | "set_aside";
    }
  | {
      costKind: "use";
      ceEffectId: string;
      sourceInstanceId: string;
      sourceDefinitionId: string;
      sourceZone: "hand";
      /** useCostGate がコストなしで発揮する同一カードの activated effect index。 */
      useEffectIndex: number;
    }
  | {
      costKind: "declare_gimmick";
      ceEffectId: string;
      sourceInstanceId: string;
      sourceDefinitionId: string;
      reduceBy: number;
    };

/**
 * `executeCoreMove` の life→X 経路で `pendingLifeDamageDiscardChoice` が生成されたときの
 * resume 記述。辞退 (decline) 時に `executeCoreMove` を `skipLifeDamageInterception:true` +
 * `amount:pendingAmount` で再呼び出しし、元の core_move を完了させる
 * (`pendingLifeCoreSelection` の `applyPendingLifeCoreSelectionAction` と同型)。
 */
export interface CoreMoveDiscardResumeContext {
  /** コア候補で確定済みの通常/ソウル内訳を置換選択の前後で維持する。 */
  lifeCorePartitionOverride?: { normalChosen: number; soulChosen: number };
  actingPlayerId: string;
  fromLocation: EffectCoreLocation;
  toLocation: EffectCoreLocation;
  sourceInstanceId: string;
  coreShootDistribution?: Record<string, number>;
  coreShootSoulCoreInstanceId?: string;
  effectTiming?: EffectTiming;
  coreDistributionAllocations?: Record<string, number>;
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  coreDistributionSoulCoreSourceAllocations?: Record<string, number>;
  coreDistributionSoulCoreInstanceId?: string;
  sourcePreventionLevel?: EffectPreventionLevel;
  coreShootMinTotal?: number;
  coreSourceAllocations?: Record<string, number>;
  coreSourceSoulCoreInstanceId?: string;
  sourceEffectIndex?: number;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
  sourceTargetStepId?: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  effectKind?: LifeCoreMoveEffectKind;
  /**
   * core_move target で解決済みの field_card 配置先候補。
   * life damage / life gain replacement resume 後も候補集合を広げないため保持する。
   */
  coreMoveDestinationTargetIds?: readonly string[];
  battleEndDeferralAttackId?: string;
}

/**
 * `life_gain_replacement` CE (「自分の効果で自分のライフが増えるとき、増やす代わりに
 * [代替アクション]できる」、BSTH02.7-X03 effects[3]) 一致時のプレイヤー選択待ち状態。
 *
 * `resolve_life_gain_replacement_choice` アクションで replace/decline を解決する。
 * - replace: 元の増加をキャンセルし、相手のライフのコア1個をトラッシュに置く。
 * - decline: 元の増加を発生させたプリミティブを再開して増加を完了させる。
 *   `coreMoveResume` (executeCoreMove の to:life 経路。discardCostGate と共有・同型の resume)
 *   と `lifeFillResume` (executeLifeFill の targetValue まで増やす経路) のどちらか一方が
 *   設定される。「自分の効果で自分のライフが増える」を発生させるプリミティブが増えたら
 *   ここに resume バリアントを追加する。
 */
export interface PendingLifeGainReplacementChoice {
  continuation?: LifeCoreSelectionContinuation;
  stepResultId?: string;
  pendingId: string;
  /** 置換権を持つプレイヤー (=ライフが増える側、決定者)。 */
  decidingPlayerId: string;
  /** 置換元 CE のソースカード (代替アクションの発動者としても使う)。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 置換対象の増加量 (decline 時にそのまま適用する。表示用にも使う)。 */
  amount: number;
  coreMoveResume?: CoreMoveDiscardResumeContext;
  lifeFillResume?: {
    actingPlayerId: string;
    action: LifeFillAction;
    /** 元の効果の発生源カード (sourceColors 記録用)。executeLifeFill 呼び出し元が省略可。 */
    sourceInstanceId?: string;
    battleEndDeferralAttackId?: string;
  };
  battleEndDeferralAttackId?: string;
  /** P3-76 対象開示応答の resolutionCleanups 引き継ぎ用（他 pending 型と同型）。 */
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/**
 * core_move の splitDestinations による「複数移動先への分配」プレイヤー選択待ち状態。
 * 例: 「ボイドからコアX個をリザーブ/トラッシュに分配」(小悪魔アクセル)。
 *
 * destinations は順序通りに UI に表示される。各 destination の cap は省略時に
 * totalAmount（実質無制限）として扱われる。
 */
export interface PendingCoreSplitSelection {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** ソース CoreLocation（解決済み） */
  fromLocation: EffectCoreLocation;
  /** 配分対象の総コア数 */
  totalAmount: number;
  /** 配分先候補（順番が UI 表示順） */
  destinations: Array<{
    /** 解決済み EffectCoreLocation */
    location: EffectCoreLocation;
    /** この移動先への上限（省略時は totalAmount まで） */
    cap?: number;
  }>;
  effectTiming: EffectTiming;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  battleEndDeferralAttackId?: string;
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * splitDestinations 解決後に元 effect の後続ステップを再開するための継続情報。
   * `CoreDistributionContinuation` と同じ「次ステップ再開」型。
   */
  continuation?: CoreDistributionContinuation;
}

/**
 * `split_field_entry_choice` action の分配選択待ち状態 (ENGINE-sequential-slot-choice、
 * BSSL01-X01[5,6])。「合計N体まで、トークンを出すか通常召喚できる(対象ごとに独立択一)」を
 * 「トークン体数 + ゾーン具体カード集合」の単一複合選択へ還元した primitive。
 * 等価性の説明は `DSL.SplitFieldEntryChoiceAction` の docstring 参照。
 * `PendingCoreSplitSelection` / `applyPendingCoreSplitAction` と同型パターン。
 */
export interface PendingSplitSummonChoice {
  chainId: string;
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 選択総数上限（解決済み数値、tokenCount + zoneCardInstanceIds.length の上限）。 */
  totalCount: number;
  /** トークン側 action (from_token_pool)。解決時に executeTokenSummon へそのまま渡す。 */
  tokenAction: import("./dsl-types").DSL.SplitFieldEntryChoiceAction["tokenAction"];
  /** トークン側で実際に選べる最大数（maxTokenDeckCount 残数考慮済み、totalCount 込みではない）。 */
  maxTokenCount: number;
  /** ゾーン側 action (from_zone)。token-only 選択では省略。 */
  zoneAction?: import("./dsl-types").DSL.SplitFieldEntryChoiceAction["zoneAction"];
  /** ゾーン側候補カード instanceId 一覧（zone/filter/includeAdventSource 解決済み）。 */
  zoneCandidateInstanceIds: string[];
  /** この pending を生成した step result の ID。解決後に実 affected ids へ差し替える。 */
  stepResultId?: string;
  /**
   * 効果召喚の原因。split 選択をまたいでも追加コスト条件を再評価するため、
   * native action handler が effect / burst を保存する。
   */
  summonCause?: "effect" | "burst";
  effectTiming: EffectTiming;
  postResolutionOracle?: PostResolutionOracleTrigger;
  battleEndDeferralAttackId?: string;
  /**
   * 解決後に元 effect の後続ステップを再開するための継続情報。
   * `CoreDistributionContinuation` と同じ「次ステップ再開」型。
   */
  continuation?: CoreDistributionContinuation;
}

/**
 * P3-88: 「コアN個まで」プレイヤー数選択待ち状態。
 *
 * 用途: `core_move` の `amount` が `{ min, max }`（範囲）で単一移動先のとき、
 * プレイヤーが `min`〜`max` の範囲で**移動するコア数**を選ぶ。
 * 例: BSTH01-X08「相手のライフのコア2個までをボイドに置く」(min=0, max=2)。
 *
 * `splitDestinations`（固定 total の複数先分配）や `pendingCoreDistribution`
 * （カードへの配分）とは別系統。単一ソース→単一移動先の純粋な数選択。
 */
export interface PendingCoreCountSelection {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** ソース CoreLocation（解決済み） */
  fromLocation: EffectCoreLocation;
  /** 移動先 CoreLocation（解決済み） */
  toLocation: EffectCoreLocation;
  /** 選択可能な最小コア数（通常 0）。 */
  min: number;
  /** 選択可能な最大コア数（= min(印字 N, ソースの利用可能数)）。 */
  max: number;
  effectTiming: EffectTiming;
  /**
   * BSTH001-転醒R02(A) 「コア除去効果で移動するコアの数を+N」継続効果による bonus が
   * 既に min/max に反映済かどうか。`applyPendingCoreCountAction` の解決時に
   * `executeCoreMove(..., amountBonusOverride=0)` を渡して二重加算を防ぐ識別子。
   */
  coreMoveAmountBonusApplied?: number;
  /**
   * core_move target で解決済みの field_card 配置先候補。
   * 数選択 pending をまたいでも target/gate 済み候補を正源にする。
   */
  coreMoveDestinationTargetIds?: readonly string[];
  postResolutionOracle?: PostResolutionOracleTrigger;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourceEffectIndex?: number;
  sourceTargetStepId?: string;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  effectKind?: LifeCoreMoveEffectKind;
  battleEndDeferralAttackId?: string;
  /**
   * core_count 選択後に元 effect の後続 step を再開するための継続情報。
   * `PendingCountSelection` と同じく、選択結果は解決時に `recordStepId` の
   * `StepResult.numericAmount` として注入する。
   */
  continuation?: ZoneSelectionContinuation;
  /**
   * pending 生成直前の状態スナップショット。継続 resume 直後の最初の step にある
   * connector が、core_move 選択解決前後の差分を見られるようにする。
   */
  priorStateSnapshot?: GameState;
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/**
 * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2:
 * 「カウントを好きなだけ減らす」プレイヤー数選択待ち状態。
 *
 * 用途: `count_decrease` の `amount` が `{ min, max }`（範囲）のとき、プレイヤーが
 * `min`〜`max` の範囲で**自分のカウントを減らす数**を選ぶ。
 * 例: BSGE01-M02「自分のカウントを好きなだけ減らせる」(min=0, max=reducible な countValue)。
 *
 * `PendingCoreCountSelection` と同型パターン（コア資源ではなくカウント資源への適用）。
 * 後続ステップがある場合は `continuation`（`ZoneSelectionContinuation` を再利用。選択結果が
 * 解決時まで確定しない点が同型）で再開し、選択数を `recordStepId` の `StepResult.numericAmount`
 * として記録して `DynamicCountSource.step_numeric_amount` から後続 step が参照できるようにする。
 */
export interface PendingCountSelection {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** カウント減少以外の枚数選択。選んだ数をcountへ反映して同じアクションを実行する。 */
  selectionAction?:
    | import("./dsl-types").DSL.DrawAction
    | import("./dsl-types").DSL.MoveCardAction;
  /** 減少対象プレイヤー（解決済み ID、通常 actingPlayerId 自身。UI 表示用）。 */
  targetPlayerId: string;
  /** count_decrease action の player 参照（解決時に executeCountDecrease へそのまま渡す）。 */
  playerRef: EffectPlayerRef;
  /** 保護カウントの床値判定用の系統リスト（count_decrease と同じ SSOT）。 */
  sourceTribes: readonly string[];
  /** 選択可能な最小カウント減少数（通常 0）。 */
  min: number;
  /** 選択可能な最大カウント減少数（= min(印字上限, 現在の reducible countValue)）。 */
  max: number;
  effectTiming: EffectTiming;
  postResolutionOracle?: PostResolutionOracleTrigger;
  continuation?: ZoneSelectionContinuation;
  /**
   * battle_end deferred 効果から生成された count selection であることを示す attackId。
   * pending 解決中は scope:"battle" CE 失効を遅延する。
   */
  battleEndDeferralAttackId?: string;
  /**
   * pending 生成直前 (count_decrease 実行前) の状態スナップショット。
   * `PendingZoneSelection.priorStateSnapshot` と同じ役割で、解決時の継続 resume で
   * `resumePreviousStepPreState` として渡し、「継続 resume の最初の step も
   * connector 判定の対象にする」`effect-interpreter.ts` の step ループガード
   * (`i > startIndex || cursors.previousStepPreState !== null`) を満たす
   * (ENGINE-cost-modify-additional-cost-value-dynamic-amount Step3 で発見:
   * 継続再開直後の最初の step にある conditional_result 等の connector が
   * 無条件でスキップされ「そうしたとき」ゲートが効かなかった)。
   */
  priorStateSnapshot?: GameState;
}

/**
 * ENGINE-composite-heterogeneous-removal-budget: discard_set_burst の count が
 * {min,max}（範囲）で未解決のときのプレイヤー枚数選択待ち状態。
 *
 * 用途: バースト（裏向きセット中カード）は Q4185 非識別のためカード単体を target として
 * 選べず（resolveTargets discard_set_burst 分岐は常に setBurstStates 先頭から決定的に
 * 採用）、「何枚破棄するか」の数だけをプレイヤーに選ばせる。`PendingCountSelection`
 * (count_decrease 専用) と同型の continuation 再開パターンだが、解決対象は
 * discard_set_burst 実行そのもの。
 */
export interface PendingDiscardSetBurstCountSelection {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** バースト所有プレイヤー（解決済み ID）。 */
  targetPlayerId: string;
  /** 選択可能な最小破棄枚数（通常 0）。 */
  min: number;
  /** 選択可能な最大破棄枚数（= min(印字上限, 対象プレイヤーの setBurstStates 枚数)）。 */
  max: number;
  destination: "trash" | "hand" | "deck_bottom";
  unpreventable: boolean;
  effectTiming: EffectTiming;
  postResolutionOracle?: PostResolutionOracleTrigger;
  continuation?: ZoneSelectionContinuation;
  /**
   * battle_end deferred 効果から生成された数選択であることを示す attackId。
   * pending 解決中は scope:"battle" CE 失効を遅延する（PendingCountSelection と同じ役割）。
   */
  battleEndDeferralAttackId?: string;
  /**
   * pending 生成直前 (discard_set_burst 実行前) の状態スナップショット。
   * `PendingCountSelection.priorStateSnapshot` と同じ役割 (継続 resume の最初の step も
   * connector 判定の対象にするための resumePreviousStepPreState)。
   */
  priorStateSnapshot?: GameState;
}

/**
 * `core_move` の移動元に通常コア + ソウルコアが混在する場合の
 * 持ち主選択待ち状態 (10_rules/06 §41 + BS35 Q22728 「持ち主選択」)。
 * 型名は life 由来だが、生成元は `handleLifeTo*` (from:{kind:"life"}) に限らず
 * `handleTrashToLife` (from:{kind:"trash"}, BSSA01-C01 等) / `handleCardInstanceSource`
 * (from:{kind:"card_instance"}) もある。UI 側は `fromLocation.kind` を必ず参照し、
 * "life" 固定文言を出さないこと。
 *
 * 用途: 移動元に通常コアとソウルコアが両方あり、移動量が両者の合計未満で
 * 真の選択肢が存在するときに、ソウルコア所有者 (= actingPlayerId) へ
 * 「通常 N 個 + ソウル M 個 (N + M = totalAmount)」の分配を選ばせる。
 *
 * 既存 `partitionLifeMoveWithSoul`/`partitionTrashMoveWithSoul` の normal-first
 * auto-pick を player-choice へ昇格させる primitive
 * (deep-mode: ENGINE-core-move-from-life-owner-soul-choice)。
 * 解決時に `executeCoreMove` を継続再呼び出しし、選ばれた分配で移動を完了する。
 */
export interface PendingLifeCoreSelection {
  pendingId: string;
  /**
   * ソウルコア所有者 = 選択者 (BS35 Q22728)。`current-actor` がこの値を返し、resolve 行動の
   * 提示先を決める。元効果発動者と別人 (相手の源から取る効果) の場合あり。
   */
  actingPlayerId: string;
  /**
   * 元効果を発動したプレイヤー (executeCoreMove 再呼び出し時の actingPlayerId)。
   * `fromLocation.player` は "self"/"opponent" 相対値なので、resume 時の起点として必須。
   */
  effectSourcePlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 移動元 (kind:"life"/"trash"/"card_instance" 等。生成元 handler に依存) */
  fromLocation: EffectCoreLocation;
  /** 移動先 (解決済み) */
  toLocation: EffectCoreLocation;
  /** 移動元にある通常コア数 (取得可能上限)。 */
  normalAvailable: number;
  /** 移動元にあるソウルコア数 (0 or 1; 同一源のソウルコアは高々 1 個)。 */
  soulAvailable: number;
  /** 移動するコア総数 (normalChosen + soulChosen = totalAmount を要求)。 */
  totalAmount: number;
  effectTiming: EffectTiming;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourceEffectIndex?: number;
  sourceTargetStepId?: string;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  /**
   * core_move target で解決済みの field_card 配置先候補。
   * ライフ持ち主選択 pending 後も候補集合を広げないため保持する。
   */
  coreMoveDestinationTargetIds?: readonly string[];
  battleEndDeferralAttackId?: string;
  /**
   * core_move が効果途中（同一 step の repeat または後続 step の手前）で
   * 持ち主選択 pending を生成した場合、解決後に元 effect を再開する。
   */
  continuation?: LifeCoreSelectionContinuation;
  /** 別の選択からコア内訳へ移った場合も、実移動が完了してから結果を記録する。 */
  deferredCoreMoveChoice?: {
    stepResultId?: string;
    beforeState: GameState;
    originalMoveReplaced: boolean;
  };
  /** 軽減後に持ち主の内訳を選ぶ場合、実移動後に使用枠を消費する。 */
  lifeDamageInterception?: PendingLifeDamageDiscardChoice;
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/**
 * `pendingLifeCoreSelection` から元効果を再開するための継続情報。
 *
 * 通常の後続 step 再開に加え、同一 step の `repeat` 中断では
 * `repeatResume` により基本発揮を再実行せず、未実行の追加発揮だけを続ける。
 */
export interface ResolvedCoreMoveAmounts {
  stepIndex: number;
  amounts: Record<string, number>;
}

/**
 * 選択 pending をまたぐ `EffectStep.repeat` の再開状態。
 * `additionalCount` は発揮開始時に固定した追加発揮数で、未指定時は既存 pending の
 * 後方互換として再開時に動的に評価する。
 */
export interface EffectStepRepeatResume {
  stepIndex: number;
  nextAdditionalIndex: number;
  skipBaseAction: true;
  excludedTargetInstanceIds?: readonly string[];
  additionalCount?: number;
  /**
   * on_step 対象選択で中断した BP 反復の、それまでに 0 以下へ到達した対象。
   * 各再開は現在盤面を pre-state にするため、最終の `bp_became_zero` ref で失わない。
   */
  bpBecameZeroCardInstanceIds?: readonly string[];
  /**
   * 「この効果を追加で発揮」の on_step BP 修正で、各発揮ごとに確定した対象群。
   * 対象選択は各巡で独立だが、同型の公式裁定どおり BP 修正と BP0 判定は
   * 全巡の対象確定後に同時に行うため、継続効果を登録するまで保持する。
   */
  stagedBpTargetInstanceIdsByActivation?: readonly (readonly string[])[];
}

export interface LifeCoreSelectionContinuation {
  targetedDisclosureContinuation?: TargetedDisclosureContinuation;
  chainId: string;
  resolvedCoreMoveAmounts?: ResolvedCoreMoveAmounts;
  sourceDefinitionId: string;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  sourceInstanceId: string;
  resumeEffectOverride?: import("./dsl-types").Effect;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  actingPlayerId: string;
  resumeStepIndex: number;
  stepContext: import("./step-execution-context").SerializedStepContext;
  repeatResume?: EffectStepRepeatResume;
  choiceIndex?: number;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
  triggerFromZone?: Zone;
  triggerCause?: TriggerEventCause;
  triggerRelatedInstanceZone?: Zone;
  activationZone?: EffectActivationSourceZone;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  targetInstanceIds?: string[];
  targetStepId?: string;
  targetSelectionResolved?: boolean;
  targetGroups?: readonly PendingEffectTargetGroup[];
  sequentialTargetConsumption?: boolean;
  recordedUsage?: RecordedEffectUsage;
  eventAmount?: number;
  pendingEffectSimultaneousGroupId?: string;
  /**
   * P3-129: 解決中の pending triggered effect 自身の pendingId (executeEffect
   * options.pendingEffectPendingId)。resume 後も `correlate_pending_trigger` が
   * 正しい pendingId を相関記録できるよう保持する。
   */
  pendingEffectPendingId?: string;
  battleEndDeferralAttackId?: string;
  rangeAutoResolveStrategy?: "min" | "max";
  effectActionKind?: EffectResolutionActionKind;
  /**
   * 同一 step の途中で pending 中断した場合に、解決済み部分の StepResult を
   * resume 先の StepExecutionContext へ先に注入する。
   */
  initialStepResults?: readonly import("./step-execution-context").StepResult[];
  /** resume 入口が after_triggers の場合に使う直前 step 実行前スナップショット。 */
  resumePreviousStepPreState?: GameState;
}

/**
 * フィールドカードからのコアコスト支払い (`core_move from: {kind:"field_card"}`) の
 * 配分プレイヤー選択待ち状態 (P3-14 D-6 follow-up)。
 *
 * 用途: BSTH05-C11/C12「系統:「アシハラ」を持つ自分の緑の創界神ネクサスのコア3個を
 * ボイドに置くことで」型のコスト支払いで、候補カードが 2 枚以上かつ余剰コアがある
 * (= 配分が一意でない) とき、どのカードから何個取るかをプレイヤーが選ぶ。
 * 創界神のコア数は転醒閾値や Lv 条件に直結するため自動配分にしない。
 *
 * 生成: `executeCoreMove` の field_card ソース分岐が **state を変更せず** 本 pending を
 * 立てて中断する。解決: `resolve_core_source_allocation` legal action で
 * `coreSourceAllocations: Record<instanceId, number>` (合計 = requiredTotal) を渡し、
 * `continuation` をもとにコストステップ自体から `executeEffect` を再実行する
 * (支払い前中断 → 配分選択 → コストステップ再実行方式)。これにより再実行時の
 * conditional_cost スナップショット (stepCtx.originalState) がコスト支払い前の state に
 * なり、後段の効果側失敗時の「ことで」双方向ロールバックが自然に機能する。
 *
 * カードへ置く本文効果では generic「コア」がソウルコアを含むため、
 * 通常コア配分とソウルコア元を別入力として扱う。
 */
export interface PendingCoreSourceAllocation {
  /** 指定時は minimumTotal～requiredTotal の範囲で支払う。 */
  minimumTotal?: number;
  /** 効果本体より前の支払いを終えて再開する宣言。 */
  deferredStack?: ActiveStack;
  /** 外部の「支払わなければ」制限では、0個で辞退して手札増加だけを抑止できる。 */
  canDecline?: boolean;
  /** 通常コア移動と、自己除外置換を止めたまま行う効果コスト選択を区別する。 */
  purpose?: "core_move_bonus" | "core_move" | "set_aside_exit_replacement";
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 支払い元候補 (フィルタ一致のフィールドカード) と各カードの通常コア数 snapshot。 */
  candidates: Array<{
    instanceId: string;
    /** ゾーン横断候補の実体。旧 snapshot のカード候補は省略可。 */
    container?: NormalCoreContainer;
    /** 通常コア + 選択可能なソウルコア。後方互換の表示用合計。 */
    available: number;
    /** 通常コアとして取れる数。 */
    normalAvailable?: number;
    /** この候補カードにソウルコアがあり、今回の移動先へ選べるか。 */
    hasSoulCore?: boolean;
  }>;
  /** 支払い上限。minimumTotal省略時はこの個数ちょうどを支払う。 */
  requiredTotal: number;
  /** 移動先 (解決済み v1 EffectCoreLocation)。 */
  toLocation: EffectCoreLocation;
  effectTiming: EffectTiming;
  sourceEffectIndex?: number;
  sourceTargetStepId?: string;
  sourceTargetLockBypass?: TargetLockBypassProfile;
  sourcePreventionBypass?: TargetLockBypassProfile;
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
  /**
   * 配分解決後にコストステップ自体から元 effect を再実行するための継続情報。
   * `executeCoreMove` が pending を生成して中断した時点で effect-interpreter の
   * メインループが注入する (CoreDistributionContinuation と同パターン。ただし
   * redirect と同じく resumeStepIndex = 中断したステップ自身 = 同ステップ再実行)。
   */
  continuation?: CoreSourceAllocationContinuation;
}

export type EffectSummonCostPaymentContinuation =
  CoreSourceAllocationContinuation &
    Pick<
      LifeCoreSelectionContinuation,
      | "repeatResume"
      | "effectActionKind"
      | "targetStepId"
      | "targetSelectionResolved"
      | "targetGroups"
      | "sequentialTargetConsumption"
    >;

/**
 * 効果文内 summon のコスト支払い元選択待ち。
 *
 * 生成: 発揮応答スタック窓が閉じ、executeSummon がコストを支払う直前。
 * 解決: `resolve_pending_effect_summon_cost_payment` が `summonPaymentSources`
 * を渡して同じ summon step から effect を再実行し、維持コア配置は後続の
 * pendingMultiPlacement に委ねる。
 */
export interface PendingEffectSummonCostPayment {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  summonTargetInstanceId: string;
  summonTargetDefinitionId: string;
  requiredCost: number;
  availableReserveCoreAmount: number;
  availableReserveNormalCoreAmount: number;
  availableOnBoardCoreSources: import("./core/payment-system").AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: import("./core/payment-system").AvailableSoulCorePaymentSource[];
  effectTiming: EffectTiming;
  sourceEffectIndex?: number;
  /** 支払い前に配置済みの合体先。支払い再開時に再生成しない。 */
  preCostCombineHostInstanceId?: string;
  /** 対象選択済みの複合召喚は、同じ選択を保ったまま支払い後に再開する。 */
  splitSummonChoice?: {
    pending: PendingSplitSummonChoice;
    tokenCount: number;
    zoneCardInstanceIds: string[];
  };
  summonDeclaration?: DeferredSummonDeclaration;
  continuation?: EffectSummonCostPaymentContinuation;
}

export interface PendingLinkAidCostSourceCandidate {
  /** フィールドカード instanceId、または override 時のみリザーブのセンチネル `"reserve"`。 */
  costSourceInstanceId: string;
  /** costSourceInstanceId が `"reserve"` のときは省略。 */
  costSourceCardNo?: string;
  availableNormalCoreCount: number;
}

/**
 * 【リンクエイド】の効果文内コスト「1コスト支払うことで」の支払い元選択待ち。
 *
 * 発揮宣言は `link_aid` で一度だけ行い、スタック窓クローズ後に現在盤面から候補を再計算する。
 * 候補が複数ある場合のみこの pending を立てる。解決アクションは新しい宣言ではない。
 */
export interface PendingLinkAidCostSourceChoice {
  pendingId: string;
  actingPlayerId: string;
  soulStateCardInstanceId: string;
  soulStateCardNo: string;
  candidates: PendingLinkAidCostSourceCandidate[];
  deferredStack: ActiveStack;
}

/**
 * pendingCoreSourceAllocation からコストステップを再実行するための継続情報。
 *
 * `RedirectActionContinuation` と同じ「同ステップ再開 (action 未実行)」型。
 * 再実行時に `coreSourceAllocations` が `ExecuteEffectOptions` 経由で
 * `executeCoreMove` へ渡され、指定配分で支払いが行われる。
 */
export interface CoreSourceAllocationContinuation {
  chainId: string;
  /** 支払待ちに入る前に確定した対象のstepスコープ。 */
  targetStepId?: string;
  resumeEffectOverride?: import("./dsl-types").Effect;
  /** 再起動対象 effect の所属カード definitionId。 */
  sourceDefinitionId: string;
  /** カード定義 effects[] 配列のインデックス。 */
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  /** 再起動時の sourceInstanceId (pending 発行時から不変)。 */
  sourceInstanceId: string;
  /**
   * 効果本文の実 provider instance。star_garment under-card など、host source と
   * provider definition が分離する効果で provenance を保つ。
   */
  effectSourceInstanceId?: string;
  /** 効果本文の実 provider definition。省略時は sourceDefinitionId と同一扱い。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  /** 元効果の発動プレイヤー (= 効果使用側)。 */
  actingPlayerId: string;
  /** 再起動するステップ index (= core_move コストステップ自身)。 */
  resumeStepIndex: number;
  /**
   * step optional で既に "execute" を選択した後、summon のコスト支払いで中断した
   * 場合に、その optional prompt を再提示せず同じ step を続行するための index。
   * `ExecuteEffectOptions.optionalExecuteResumeStepIndex` へ引き継ぐ。
   */
  optionalExecuteResumeStepIndex?: number;
  /** 中断時のステップコンテキスト。 */
  stepContext: import("./step-execution-context").SerializedStepContext;
  /** 元 ExecuteEffectOptions の choiceIndex (choice ステップの再評価に必要)。 */
  choiceIndex?: number;
  /** 元 ExecuteEffectOptions の activationZone (手札/手元/トラッシュ発揮の再評価用)。 */
  activationZone?: EffectActivationSourceZone;
  /** 元 ExecuteEffectOptions の sourcePreventionLevel (効果耐性貫通フラグ)。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** 発生源カテゴリ等で限定された防止貫通プロファイル。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 元 ExecuteEffectOptions の costPaidThisEffect (DynamicCount 用)。 */
  costPaidThisEffect?: number;
  /**
   * 元 ExecuteEffectOptions の targetInstanceIds (スタック対象選択で確定済みの
   * 後段ステップ対象。コストステップでは未消費のため再実行時にそのまま渡す)。
   */
  targetInstanceIds?: string[];
  /**
   * 元 ExecuteEffectOptions の recordedUsage (P3-62 払い戻し情報)。
   * 再実行で conditional_cost ロールバックが発火した場合の usageLimit 払戻に必要。
   */
  recordedUsage?: RecordedEffectUsage;
  /**
   * pending 選択が閉じ、元効果の解決が完了した後に発火させる神託。
   * マジック効果由来の pending が選択で中断した場合に伝播する。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  battleEndDeferralAttackId?: string;
}

/**
 * P3-47 F-5: multi-source `core_distribute` の 1 ソースを表す識別子。
 *
 * key への対応:
 * - { kind: "reserve" }       → "reserve"
 * - { kind: "trash" }         → "trash"
 * - { kind: "life" }          → "life"
 * - { kind: "field"; ... }    → `field:<instanceId>`
 */
export type CoreDistributionAllowedSource =
  | { kind: "reserve" }
  | { kind: "trash" }
  | { kind: "life" }
  | { kind: "field"; instanceId: string };

/**
 * core_distribute(mode="player_choice") は実際の対象が pending 解決時まで未確定なため、
 * 配分確定時に P3-76 targeted disclosure / redirect_effect_target を評価するための
 * 再開文脈を pending に保持する。
 */
export interface CoreDistributionTargetInterruptionContext {
  chainId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  sourceInstanceId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  effectActionKind?: EffectResolutionActionKind;
  effectActivationTiming?: EffectActivationTiming;
  actingPlayerId: string;
  stepIndex: number;
  stepContext: import("./step-execution-context").SerializedStepContext;
  targetSpec?: import("./dsl-types").TargetSpec;
  targetStepId: string;
  choiceIndex?: number;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  effectResolutionBeforeState?: GameState;
  targetedDisclosureResolved?: boolean;
}

/**
 * コア配分プレイヤー選択待ち状態。
 *
 * 用途:
 * - BSTH01-M01「トラッシュにあるコアすべてをそれらのスピリットに置ける」(fromKind="trash")
 * - P3-47 フランドール【フォーオブアカインド】「自分のコア1個以上をそれらのカードに置く」
 *   (fromKind="reserve" + minTotal=1) — Phase 2-1 で追加
 * - P3-47 F-5: 同上、ただし「自分の通常移動可能な全ゾーン」を多元的に許容
 *   (fromKind="any_movable" + allowedSources)
 *
 * GUI 側で coreDistributionAllocations: Record<instanceId, number> と
 * 任意の coreDistributionSoulCoreAllocations: Record<instanceId, number> を渡す。
 * 単一ソウルコア向けの coreDistributionSoulCoreInstanceId は互換入力として残す。
 * multi-source 時は coreDistributionSourceAllocations: Record<sourceKey, number> も必須。
 * ソウルコアも multi-source なら coreDistributionSoulCoreSourceAllocations を渡す。
 * 配分通常コア合計 ≤ totalNormalCores、ソウル込み配置合計 ≤ maxTotal、配分合計 ≥ minTotal、
 * ソウルコア配置先 ∈ candidates。
 * opponent field redistribution など、効果使用者が「移動先ごとの個数」を決め、
 * コアの持ち主が通常/ソウル/source mapping を選ぶ場合は targetTotalSelection で二段階化する。
 */
/** 配分先にまたがる共有枠。各コアは該当する枠の1つだけを消費する。 */
export interface CoreDistributionAllocationGroup {
  candidateInstanceIds: string[];
  maxCount: number;
}

export interface PendingCoreDistribution {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 配分先候補（フィールド上の置ける対象カード） */
  candidates: Array<{
    instanceId: string;
    definitionId: string;
  }>;
  /**
   * 移動元の通常コア総数。
   * - 単一ソース (`fromKind: "trash" | "reserve"`): 該当ゾーンのコア数。
   * - multi-source (`fromKind: "any_movable"`, P3-47 F-5): `sourceAvailable` から
   *   field source→同一 recipient の no-op を除いて実際に配置できる通常コア上限。
   */
  totalNormalCores: number;
  /**
   * 配置可能なソウルコアがあるか。
   * - fromKind="trash": トラッシュのソウルコア。
   * - fromKind="any_movable": 通常移動可能な reserve/trash/life/field のソウルコア
   *   (field 上の同一 source→recipient no-op は配置可能数に含めない)。
   * - fromKind="reserve": リザーブのソウルコア。
   * - fromKind="void": false。
   */
  hasSoulCore: boolean;
  /**
   * 配置可能なソウルコア数。省略時は旧 pending 互換として 1 個扱い。
   *
   * `core_move amount:"all"` の reserve/trash/life 単一ソースでは、
   * `PlayerState.*SoulCoreCount` の全数を入れる。複数個は
   * `coreDistributionSoulCoreAllocations` で配置先別に配分できる。
   */
  totalSoulCores?: number;
  /**
   * ソース kind。
   * - "trash" / "reserve": 単一ソース (Phase 2-1)。generic な「コア」は soul も含む。
   * - "any_movable" (P3-47 F-5): reserve / trash / life / 自分 field カードの混合。
   *   `allowedSources` と `sourceAvailable` が必須。
   * - "void": ボイドからの単一ソース配置（「ボイドからコアN個を…に置く」）。
   *   player.voidNormalCoreCount を source として減算する。soul core 非対応 (hasSoulCore=false)。
   * - "life": ライフからの単一ソース配置 (ENGINE-core-move-from-life-to-field-card)。
   *   ライフの通常コア数を減算。ソウルは通常コアで不足する分のみ補う (shortfall-triggered)。
   * - "outside_game": ゲーム外から新規ソウルコアを生成して配置候補カードへ置く
   *   (BSLH01-X10「ゲーム外から<ソウルコア>1個を自分のスピリット/リザーブに置く」の
   *   スピリット側・候補2体以上の場合)。既存ソースから減算する他 fromKind と異なり
   *   `generateSoulCoreOutsideGame` で新規生成するため常に hasSoulCore=true・
   *   totalNormalCores=0 (通常コアは存在しない)。
   */
  fromKind:
    | "trash"
    | "reserve"
    | "any_movable"
    | "void"
    | "life"
    | "outside_game";
  /**
   * P3-47 F-5: multi-source 時 (fromKind="any_movable") の利用可能ソース一覧。
   * 単一ソース時は省略。
   */
  allowedSources?: ReadonlyArray<CoreDistributionAllowedSource>;
  /**
   * P3-47 F-5: 各 allowedSource の利用可能 通常コア数 snapshot。
   * key 規則:
   * - "reserve" / "trash" / "life": player ゾーンコア数
   * - "field:<instanceId>": 該当 field カードの normalCoreCount
   * 単一ソース時は省略。
   */
  sourceAvailable?: Record<string, number>;
  /**
   * P3-47 F-5: multi-source 時 (fromKind="any_movable") の利用可能ソウルコア数 snapshot。
   * key 規則は `sourceAvailable` と同じ。通常コア 0 / ソウルのみの source も表現する。
   */
  soulSourceAvailable?: Record<string, number>;
  /**
   * multi-source 時の同一 source 合算上限 snapshot。通常コアとソウルコアを別々に
   * 指定しても、同一カードの「残すコア数」制約を合算で超えないために使う。
   * key 規則は `sourceAvailable` と同じ。
   */
  sourceTotalAvailable?: Record<string, number>;
  /**
   * BS28 Q25359/Q25360 型: 効果使用者は「各移動先に何個置くか」だけを指定し、
   * コアの持ち主が、その指定に合うよう通常コア/ソウルコアと source mapping を選ぶ。
   *
   * fixedTargetTotals 未設定 = 1段目（targetChooserPlayerId が target totals を選択）。
   * fixedTargetTotals 設定済み = 2段目（sourceOwnerPlayerId が物理コア/source を選択）。
   */
  targetTotalSelection?: {
    mode: "target_totals_then_core_owner_sources";
    targetChooserPlayerId: string;
    sourceOwnerPlayerId: string;
    fixedTargetTotals?: Record<string, number>;
  };
  /**
   * 配分する最小コア数 (P3-47 Phase 2-1)。
   * - 0 (省略時): 配分合計 0 個も許容 (フランドール「コア1個以上」と並列の任意分配)
   * - 1+: 最低この数のコア配分が必須。フランドールのコスト効果「コア1個以上」の表現に使う。
   *
   * 注: `core_move` action で `amount: "all"` が指定された場合は、
   * 「コアすべてを置く」のルール解釈に従い `minTotal = totalNormalCores` を設定する
   * (= 通常コアの部分配分は不可)。
   */
  minTotal?: number;
  /**
   * 通常コア + ソウルコアの合計配置上限。
   *
   * finite amount の generic `fromKind:"trash"` では通常コアが足りていてもソウルコアを
   * 候補に出すため、`totalNormalCores` とは別に本文の「N個まで」を soul 込みで守る。
   * 省略時は従来どおり `totalNormalCores` と `hasSoulCore` の組み合わせだけで検証する。
   */
  maxTotal?: number;
  /**
   * トラッシュのソウルコアを必ず配置先カードに置く必要があるかを表す。
   *
   * - `core_move` action で `amount: "all"` の場合: `hasSoulCore` と同値を設定する。
   *   カード本文「コアすべてを置ける」は通常コアだけでなくソウルコアも含むため、
   *   ソウルコアをトラッシュに残したまま完了する partial 解決を engine が reject する。
   * - 任意分配（フランドール `minTotal=1` 等）の場合は省略 (= false)。
   *   ソウルコアの配置はプレイヤーの任意。
   */
  mustPlaceSoulCore?: boolean;
  /**
   * 任意コア配置そのものは 0 個を許容するが、配置結果がこの最低数未満なら
   * 転醒等の元処理を中断する。
   *
   * 例: BSFT01 TR 系「好きなだけ」転醒後配置。本文上は 0 個配置を選べるが、
   * その結果 Lv1 に必要なコアを満たせなければ転醒処理を成立させない。
   *
   * `rebirthCompletion` が無い旧経路では `priorStateSnapshot` へ戻す。
   * `rebirthCompletion` がある経路では、裏返った B 面を自分の効果による消滅待機にする。
   */
  rollbackIfBelowMinTotal?: {
    minTotal: number;
    reason: "rebirth_minimum_core";
  };
  /**
   * 直後のコア配置で B 面最低 Lv を満たせる転醒の完了保留情報。
   * コア配置が最低数を満たした時点で count 処理と転醒時誘発を完了し、
   * 満たさない場合は B 面状態から自分効果消滅として中断する。
   */
  rebirthCompletion?: PendingRebirthCompletion;
  /** 移動元プレイヤー ID */
  fromPlayerId: string;
  /** 移動先プレイヤー ID（フィールド側） */
  toPlayerId: string;
  effectTiming: EffectTiming;
  battleEndDeferralAttackId?: string;
  /**
   * この pending が閉じ、他の効果解決 pending が無い安定点で発火させる神託。
   * core split/count の解決中に core_move が二次的に配分 pending を出す場合に使う。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /** コア配置より前に成立した遷移を、配置完了時の誘発群へ合流させる。 */
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  /**
   * P3-47 Phase 2-2: 配分解決後に元 effect の後続ステップを再実行するための継続情報。
   * `mode="player_choice"` で executeCoreDistribute が pending を生成した時点で
   * effect-interpreter のメインループが injected する。`applyPendingCoreDistributionAction`
   * は pending を解決してコアを配置した後、この情報をもとに `executeEffect` を
   * `startFromStepIndex = continuation.resumeStepIndex` (= 次ステップ) で再起動する。
   * F-4 redirect の RedirectActionContinuation と同じパターンを再利用。
   */
  continuation?: CoreDistributionContinuation;
  /**
   * P3-48 follow-up: cancel/abort 用の事前状態スナップショット。
   *
   * `mode="player_choice"` で pending を生成する直前の `GameState` を保持する
   * (=この pending と continuation を含まない、prior effect step まで適用済みの状態)。
   * `abort_pending_core_distribution` legal action で pending 提示 *直前* の state に
   * 巻き戻すために使う。
   *
   * 注意:
   * - 自己参照を避けるため snapshot 自身は `pendingCoreDistribution` を持たない。
   * - serialize 時 (snapshot import/export) のサイズは pending 存在時のみ ~倍化する。
   */
  priorStateSnapshot?: GameState;
  /**
   * state-based action の合体条件喪失分離で、維持コアの移動元に選択余地がある場合の
   * 継続情報。配分解決後にブレイヴとホストの合体リンクを解除する。
   */
  stateBasedBraveSeparation?: {
    hostInstanceId: string;
    braveInstanceId: string;
    /** Already chosen by the owner; continue after the current core choice. */
    remainingBraveInstanceIds?: string[];
    /**
     * 逆転醒で host が新 instance へ変換された直後の分離では、新 host の回復状態で
     * 上書きせず、変換前 host の疲労状態を使う。複数のコア移動元から選ぶ SBA
     * pending をまたぐために保持する。
     */
    hostExhaustState?: CardInstance["exhaustState"];
  };
  /**
   * 候補1件あたりの配分上限（省略時は無制限）。
   *
   * BSSL01-X01「合計2体まで、自分のトークンをボイドからコア1個ずつまでを置いて出す」
   * (ENGINE-bssl01-x01-void-core-interactive-placement): トークン1体ごとに独立した上限
   * (voidCoreMaxPerCard) を表現するため、`totalNormalCores` (全候補合計の上限) とは別に
   * 候補ごとの上限を設ける。`trashCoreMax` のような召喚全体で共有する予算とは異なり、
   * 候補間で融通しない。
   */
  maxPerCandidate?: number;
  allocationGroups?: CoreDistributionAllocationGroup[];
  /**
   * player_choice 配分先の実確定後に対象割込み窓を評価するための文脈。
   * 旧 snapshot / 非対象 core_move pending では未設定。
   */
  targetInterruption?: CoreDistributionTargetInterruptionContext;
  /**
   * core_distribution pending 上で confirm/decline 済みの redirect CE。
   * 同じ配分を再確定したときに同じ CE を二重 prompt しない。
   */
  skippedTargetRedirectEffectIds?: string[];
  /** P3-76 対象開示応答の resolutionCleanups 引き継ぎ用（他 pending 型と同型）。 */
  targetedDisclosureResolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
}

/**
 * P3-47 Phase 2-2: pendingCoreDistribution から元効果の後続ステップ実行を再開するための継続情報。
 *
 * 元効果は core_distribute (mode="player_choice") の native 実行で `pendingCoreDistribution`
 * を生成して中断する。プレイヤーが配分を確定し `applyPendingCoreDistributionAction` が
 * コア配置を完了した後、`startFromStepIndex = resumeStepIndex` (= core_distribute の次ステップ)
 * で `executeEffect` を再起動して残りステップを実行するために必要な情報を保持する。
 *
 * F-4 RedirectActionContinuation と概ね同じ形だが、redirect は同ステップ再開 (action 未実行)、
 * 本 continuation は次ステップ再開 (action 完了済み) という違いがある。
 */
export interface CoreDistributionContinuation extends LifeCoreSelectionContinuation {
  chainId: string;
  resumeEffectOverride?: import("./dsl-types").Effect;
  /** 再起動対象 effect の所属カード definitionId。 */
  sourceDefinitionId: string;
  /** カード定義 effects[] 配列のインデックス (provenance を一致させるため必須)。 */
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  /** 再起動時の sourceInstanceId (pending 発行時から不変)。 */
  sourceInstanceId: string;
  /**
   * 効果本文の実 provider instance。star_garment under-card など、
   * host source と provider definition が分離する効果で provenance を保つ。
   */
  effectSourceInstanceId?: string;
  /** 効果本文の実 provider definition。省略時は sourceDefinitionId と同一扱い。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  /**
   * 解決中の効果種別。core_distribute で中断後に後続 on_step summon へ進む場合、
   * バースト効果由来の召喚を実行時にも `summonCause:"burst"` として保つ。
   */
  effectActionKind?: EffectResolutionActionKind;
  /** 元効果の発動プレイヤー (= 効果使用側)。 */
  actingPlayerId: string;
  /** 再起動するステップ index (= core_distribute ステップの次)。 */
  resumeStepIndex: number;
  /** 中断時のステップコンテキスト (前ステップの結果を保持して連続性を維持)。 */
  stepContext: import("./step-execution-context").SerializedStepContext;
  /** 元 ExecuteEffectOptions の choiceIndex (choice ステップの再評価に必要)。 */
  choiceIndex?: number;
  /** 元 ExecuteEffectOptions の sourcePreventionLevel (効果耐性貫通フラグ)。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** 発生源カテゴリ等で限定された防止貫通プロファイル。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 元 ExecuteEffectOptions の costPaidThisEffect (DynamicCount 用)。 */
  costPaidThisEffect?: number;
  /**
   * pending 選択が閉じ、元効果の解決が完了した後に発火させる神託。
   * マジック効果由来の pending が選択で中断した場合に伝播する。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  battleEndDeferralAttackId?: string;
}

/**
 * P3-49 placement_multi: 複数体同時召喚で per-target 配置選択を委ねる待ち状態。
 *
 * `executeSummonOther` が `count >= 2` でプレイヤー入力 (paymentSources / placements) を
 * 受け取った場合、各 summon された card を field=cores=0 で初期化 + 召喚側全体の
 * コスト支払いだけを先に確定し、本 pending を立てて effect 実行を中断する。
 *
 * GUI は `apply_pending_multi_placement` で `targets[].instanceId` ごとの
 * `EnterFieldCorePlacement[]` を渡して一括配置する。abort は `priorStateSnapshot` で
 * 巻き戻し + 後続 step スキップ (PendingCoreDistribution と同形)。
 */
export interface PendingMultiPlacement {
  /** 場入り時の合体可否を選択済みのブレイヴ。 */
  resolvedBraveCombineInstanceIds?: string[];
  /** 同時処理で既に配置を選んだ対象も、全所有者の完了まで通知を保留する。 */
  completedTargets?: PendingMultiPlacement["targets"];
  effectActingPlayerId?: string;
  pendingId: string;
  actingPlayerId: string;
  /** Already committed mandatory entries cannot roll back the originating effect. */
  canAbort?: boolean;
  /** Draw-step replacement placement completes before paying the next cost or drawing. */
  drawStepResume?: PendingDrawStepCostChoice;
  /** Finish this reveal only after field-entry cores have been chosen. */
  deckRevealResume?: {
    reveal: PendingDeckReveal;
    remainderOrder?: string[];
    placement?:
      | "top"
      | "bottom"
      | "top_or_bottom"
      | "top_bottom_split"
      | "bottom_or_trash"
      | "trash";
    remainderPlacementById?: Record<string, "top" | "bottom">;
  };
  /** 召喚効果のソースカード instanceId (GUI 表示用) */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 同時配置の全供給元・通常/ソウルの合計に適用する残数制約。 */
  fieldCoreSourceMinimum?: FieldCoreSourceMinimum;
  /** 同時召喚された各カードの placement 制約 */
  targets: Array<{
    instanceId: string;
    definitionId: string;
    minimumCoreCount: number;
    maximumCoreCount: number | null;
    /** 場入り完了時のイベント。省略は summon、null は分離など場入りを伴わない配置。 */
    enterFieldEventKind?: "summon" | "place" | "put" | null;
    /** 同一 eventKind 内の効果名/機構スコープ。例: put + genkai。 */
    effectScope?: EffectEventScope;
    /**
     * この target の維持コア配置で、ボイドから置ける通常コア上限。
     * 省略時は 0。BSSL01-X01[5,6] の token 1体ごとの「ボイドから1個まで」。
     */
    voidNormalCoreMax?: number;
  }>;
  /** 同時の場入りで配置する所有者が複数いる場合、各所有者のHUDを順に開く。 */
  remainingPlacements?: Array<{
    actingPlayerId: string;
    targets: PendingMultiPlacement["targets"];
  }>;
  /** 全所有者の配置対象は、各HUDでコアの供給元にできない。 */
  excludedFieldSourceIds?: string[];
  /** 配置後に強制合体を確定する。 */
  combineAfterPlacement?: { braveInstanceId: string; hostInstanceId: string };
  /** put により発生した、支払い前の召喚対象の直接合体義務。 */
  directCombineRequirement?: {
    braveInstanceId: string;
    hostInstanceId: string;
  };
  /** 中断された召喚へ戻る前に、支払い前効果自身を完了する。 */
  preCostEffectContinuation?: MultiPlacementContinuation;
  /** 支払い前の場入りを終えてから、元の召喚ステップを再実行する。 */
  resumeEffectSummon?: {
    combineHostInstanceId: string;
    paymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
  };
  summonDeclaration?: DeferredSummonDeclaration;
  /**
   * この pending 全体で、トラッシュから置ける通常コア上限。
   * 省略時は 0。BSSL01-C06 の「トラッシュのコアも1個まで」。
   */
  trashNormalCoreMax?: number;
  /**
   * この pending 全体で、トラッシュから置ける generic コア上限。
   * generic「コア」は通常/ソウルを含み、合計でこの数まで許容する。
   */
  trashCoreMax?: number;
  effectTiming: EffectTiming;
  /** enter_field event の sourceEffectIndex を pending 解決後まで保持する。 */
  sourceEffectIndex?: number;
  /**
   * battle_end deferred 効果から生成された pending であることを示す attackId。
   * continuation が無い summon 終端 pending でも battle scope CE 失効を配置完了まで待つ。
   */
  battleEndDeferralAttackId?: string;
  /**
   * 配分解決後に元 effect の後続ステップを再実行するための継続情報。
   * `mode="player_choice"` の core_distribute と同じパターン。
   */
  continuation?: MultiPlacementContinuation;
  /**
   * cancel/abort 用の事前状態スナップショット。
   * pending 提示直前の `GameState` (= cards in field cores=0 + cost 支払い済) を保持。
   */
  priorStateSnapshot?: GameState;
}

/** 宣言時の誘発・対象選択を繰り返さず、場入り前のコア選択から召喚支払いへ戻る。 */
export interface DeferredSummonDeclaration {
  action: import("./legal/legal-actions-types").SummonLegalAction;
  combineHostInstanceId: string;
  targetInstanceIds: readonly string[];
  permissionDeclarationConsumesTargets: boolean;
  originalState: GameState;
  inputs: Pick<
    import("./legal/legal-actions-types").ApplyLegalActionOptions,
    "paymentSources" | "enterFieldCorePlacements" | "chosenLifeCoreKind"
  >;
}

/**
 * P3-49 placement_multi: pendingMultiPlacement から元効果の後続ステップ実行を
 * 再開するための継続情報。`CoreDistributionContinuation` と同形。
 */
export interface MultiPlacementContinuation extends Pick<
  EffectSummonCostPaymentContinuation,
  | "activationZone"
  | "optionalExecuteResumeStepIndex"
  | "targetInstanceIds"
  | "targetStepId"
  | "targetSelectionResolved"
  | "targetGroups"
  | "sequentialTargetConsumption"
  | "recordedUsage"
> {
  chainId: string;
  triggerRelatedInstanceId?: string;
  summonPaymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
  summonEnterFieldCorePlacements?: readonly import("./zone/enter-field-placement-execution").EnterFieldCorePlacement[];
  /** 配置を待つ間も、効果の追加発揮回数を保持する。 */
  repeatResume?: EffectStepRepeatResume;
  resumeEffectOverride?: import("./dsl-types").Effect;
  sourceDefinitionId: string;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  sourceInstanceId: string;
  /** under-card / grant 等で sourceInstanceId と効果発揮元 metadata が異なる場合の発揮元 instanceId。 */
  effectSourceInstanceId?: string;
  /** under-card / grant 等で sourceDefinitionId と効果発揮元 metadata が異なる場合の発揮元 definitionId。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  effectActionKind?: EffectResolutionActionKind;
  actingPlayerId: string;
  resumeStepIndex: number;
  stepContext: import("./step-execution-context").SerializedStepContext;
  choiceIndex?: number;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  costPaidThisEffect?: number;
  /**
   * pending 選択が閉じ、元効果の解決が完了した後に発火させる神託。
   * マジック効果由来の pending が選択で中断した場合に伝播する。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * battle_end deferred 効果から生成された pending であることを示す attackId。
   * pending 解決中および resume 後の後続 pending へ scope:"battle" CE 失効遅延を引き継ぐ。
   */
  battleEndDeferralAttackId?: string;
  /**
   * 対象開示応答の途中で placement_multi/enter-field placement が中断を挟んだ場合の
   * 元 disclosure continuation。resume 直前に復元し、後続の `current_effect`
   * 耐性/無効化が元スタックを参照できるようにする。
   */
  targetedDisclosureContinuation?: TargetedDisclosureContinuation;
}

/**
 * 逆転醒 pattern2 の pending 配置解決後に元 effect を再開する情報。
 * フィールド進入配置の continuation と同じ復元項目を使うが、成功結果は置換後の A 面 instance を
 * 対象として記録するため、元 step の result id も保持する。継承/付与効果の effect-source
 * metadata も MultiPlacementContinuation から継承し、B 面を指すものだけ解決側で A 面へ対応付ける。
 */
export interface ReverseRebirthSummonContinuation extends MultiPlacementContinuation {
  stepResultId: string;
}

/**
 * P3-47 F-4: 効果対象リダイレクト待ち状態。
 *
 * 相手効果が `redirect_effect_target` CE の対象 (= フランドール本体) を取った瞬間に
 * 発行される。CE owner (= 本体所有者) に対して「対象を変更しますか?」のプロンプト。
 *
 * 解決:
 * - confirm: 同じ target slice 内の redirectable field targets を `withInstanceId`
 *   (candidateTokenIds の 1 体) に置き換え、重複を collapse して元効果の実行を再開する。
 * - decline: 元の対象集合のまま元効果の実行を再開する。
 *
 * 裁定 #7: redirectableInstanceIds と candidateTokenIds が `originalResolvedInstanceIds`
 * 集合と既に共通要素を持つ場合 (本体 + token 両方が既に対象) は redirect 不可なので、
 * pendingTargetRedirect 発行を skip する (本 type は発行された時点で必ず redirect 可)。
 */
/**
 * P3-47 F-4 Step 3b: pendingTargetRedirect から元効果実行を再開するための継続情報。
 *
 * 元効果は executeEffect ループの resolveTargets 直後に redirect 検出されて中断される。
 * confirm/decline 解決後に同じ effect / step から `targetInstanceIds = redirected ? 置換後 : 原集合`
 * で executeEffect を再起動するために、再起動に必要な最低限の引数を保持する。
 */
export interface RedirectActionContinuation {
  chainId: string;
  /** 再起動対象 effect の所属カード definitionId。 */
  sourceDefinitionId: string;
  /** カード定義 effects[] 配列のインデックス (provenance を一致させるため必須)。 */
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  /** 再起動時の sourceInstanceId (pending 発行時から不変)。 */
  sourceInstanceId: string;
  /** under-card など、sourceInstanceId と効果発揮元 metadata が異なる場合の発揮元 instanceId。 */
  effectSourceInstanceId?: string;
  /** under-card など、sourceDefinitionId と効果発揮元 metadata が異なる場合の発揮元 definitionId。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  /** 元効果の発動プレイヤー (= 効果使用側)。 */
  actingPlayerId: string;
  /** 再起動するステップ index (= redirect が発火したステップ)。 */
  resumeStepIndex: number;
  /** 中断時のステップコンテキスト (前ステップの結果を保持して連続性を維持)。 */
  stepContext: import("./step-execution-context").SerializedStepContext;
  /**
   * 元 ExecuteEffectOptions の対象列全体。
   * optional repeat では 1 step が複数回ぶんの対象を順序付きで消費するため、
   * redirect された slice だけ差し替えて残りの事前選択対象を保持する。
   */
  targetInstanceIds?: string[];
  /** targetGroups 経由の事前選択を再開時にも step 別へ再割当てするため保持する。 */
  targetGroups?: readonly PendingEffectTargetGroup[];
  /** targetInstanceIds のうち、今回 redirect 判定された対象 slice の開始位置。 */
  redirectTargetStart?: number;
  /** targetInstanceIds のうち、今回 redirect 判定された対象 slice の件数。 */
  redirectTargetCount?: number;
  /** targetGroups 経由など、差し替え対象が全体列内の非先頭 slice の場合の厳密な index。 */
  redirectTargetIndexes?: number[];
  /** 元 ExecuteEffectOptions の targetStepId。 */
  targetStepId?: string;
  /** 元 ExecuteEffectOptions の choiceIndex (choice ステップの再評価に必要)。 */
  choiceIndex?: number;
  /** 元 ExecuteEffectOptions の sourcePreventionLevel (効果耐性貫通フラグ)。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** 発生源カテゴリ等で限定された防止貫通プロファイル。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 元 ExecuteEffectOptions の costPaidThisEffect (DynamicCount 用)。 */
  costPaidThisEffect?: number;
  /** 元効果解決が完全に終わった後にキューする神託。 */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * Battle-sourced pending effects can resolve after activeAttack has been cleared.
   * Preserve the originating attack id for battle-end deferred steps and CE scope.
   */
  battleEndDeferralAttackId?: string;
}

export type TargetedDisclosureResolutionCleanup = {
  /** 親宣言へ復帰しても、子のcleanupをその親へ持ち越さない。 */
  resolutionChainId?: string;
} & (
  | {
      kind: "burst_activation_immunity";
      checkId: string;
      effectIds: readonly string[];
    }
  | {
      kind: "continuous_effects";
      effectIds: readonly string[];
    }
);

/**
 * P3-76: targeted disclosure で中断した効果を、開示誘発の解決後に同じ step から再開する。
 *
 * PC03 Q17625 により、同じ効果内でも対象指定タイミングが異なる対象は別タイミングとして
 * もう一度「対象になるとき」応答を発揮できる。したがって ActiveStack 全体ではなく、
 * executeEffect の resolveTargets 直後・native action 実行前を一時停止点にする。
 */
export interface TargetedDisclosureContinuation {
  chainId: string;
  pendingId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  sourceInstanceId: string;
  /** P3-76/redirect 等へ引き継ぐ効果発揮元 instanceId。 */
  effectSourceInstanceId?: string;
  /** P3-76/redirect 等へ引き継ぐ効果発揮元 definitionId。 */
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  effectActionKind?: EffectResolutionActionKind;
  effectActivationTiming?: EffectActivationTiming;
  actingPlayerId: string;
  resumeStepIndex: number;
  /**
   * optional step の execute 選択済み後に対象開示で中断した場合、その step を
   * 再開時に再提示せず実行するための index。`ExecuteEffectOptions` の同名 option
   * へ引き継ぐ。
   */
  optionalExecuteResumeStepIndex?: number;
  stepContext: import("./step-execution-context").SerializedStepContext;
  /**
   * `targetSelectionTiming:"on_step"` の追加反復で対象化開示に中断した場合の
   * 再開位置。基礎発揮を繰り返さず、開示済みの同じ追加巡を action 実行から続ける。
   */
  repeatResume?: EffectStepRepeatResume;
  targetInstanceIds: string[];
  /**
   * targeted disclosure で対象が確定した時点の zone。応答後にその zone を離れた
   * instance は acquisition bypass の前に対象から外す。
   */
  targetZonesByInstanceId?: Readonly<Record<string, Zone>>;
  /**
   * 対象開示で中断した元効果の合法対象候補。
   * 対象変更は元効果が指定できるカードへだけ移せるため、候補集合が復元できる経路ではここで保持する。
   */
  targetCandidateInstanceIds?: string[];
  /**
   * core_distribute(mode="player_choice") の配分確定後に targeted disclosure で中断した場合、
   * 配分済み pending と GUI 入力を保持する。開示応答後は step を再評価せず、この snapshot を
   * applyPendingCoreDistributionAction に戻して確定済み配分を適用する。
   */
  coreDistributionPending?: PendingCoreDistribution;
  coreDistributionAllocations?: Record<string, number>;
  coreDistributionSourceAllocations?: Record<string, number>;
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  coreDistributionSoulCoreSourceAllocations?: Record<string, number>;
  coreDistributionSoulCoreInstanceId?: string;
  targetGroups?: readonly PendingEffectTargetGroup[];
  sequentialTargetConsumption?: boolean;
  targetStepId: string;
  skipTargetedDisclosureTargetStart?: number;
  skipTargetedDisclosureTargetCount?: number;
  remainingStacks: ActiveStack[];
  /** 効果全体の finalization で delta 収集に使う、元効果開始時 state。 */
  effectResolutionBeforeState?: GameState;
  choiceIndex?: number;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 元 ExecuteEffectOptions の triggerFromZone (`trigger_from_zone` 再評価用)。 */
  triggerFromZone?: Zone;
  triggerCause?: TriggerEventCause;
  /**
   * 元 ExecuteEffectOptions の triggerRelatedInstanceZone
   * (`trigger_related_instance_off_field` 再評価用、ENGINE-targeted-disclosure-offfield-source)。
   */
  triggerRelatedInstanceZone?: Zone;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  /**
   * Battle-sourced pending effects can resolve after activeAttack has been cleared.
   * Preserve the originating attack id for battle-end deferred steps and CE scope.
   */
  battleEndDeferralAttackId?: string;
  /**
   * 本体効果が targeted disclosure で中断した間だけ延命する cleanup。
   * 例: バースト「発動中」耐性は disclosure 応答中も有効で、効果本体完了後に閉じる。
   */
  resolutionCleanups?: readonly TargetedDisclosureResolutionCleanup[];
  /** 本文の再開は済み、残る入力・派生処理の完了後にcleanupと親復帰だけを行う。 */
  bodyResolutionCompleted?: true;
  /**
   * Hand-written resolver 経路は DSL step index で再開できないため、対象開示窓後に
   * 同じ resolver context を復元して resolver 本体だけを実行する。
   */
  handWrittenResolution?: {
    chainId: string;
    resolutionKind:
      | "magic_action"
      | "field_card_effect_action"
      | "play_card_action"
      | "battle_immediate_effect"
      | "pending_triggered_effect"
      | "pending_burst_check";
    sourceKind: import("./source-kinds").EffectSourceKind;
    sourceCard: CardInstance;
    targetInstanceIds: string[];
    targetStepId?: string;
    targetGroups?: readonly PendingEffectTargetGroup[];
    sequentialTargetConsumption?: boolean;
    endLogs: string[];
    choiceIndex?: number;
    effectActionKind?: EffectResolutionActionKind;
    effectActivationTiming?: EffectActivationTiming;
    forceLevel?: EffectForceLevel;
    pendingEffectSimultaneousGroupId?: string;
    /**
     * P3-129: 解決中の pending triggered effect 自身の pendingId (executeEffect
     * options.pendingEffectPendingId)。resume 後も `correlate_pending_trigger` が
     * 正しい pendingId を相関記録できるよう保持する。
     */
    pendingEffectPendingId?: string;
    eventAmount?: number;
    effectFieldEntrySource?: "burst_follow_up";
    effectTimingFilter?: "main" | "flash" | "stack";
    effectEventAction?: string;
    divineSkillIndex?: number;
    isAccelData?: boolean;
    isChangeData?: boolean;
    sourcePreventionLevel?: EffectPreventionLevel;
    sourcePreventionBypass?: TargetLockBypassProfile;
    triggerFromZone?: Zone;
    triggerCause?: TriggerEventCause;
    triggerRelatedInstanceZone?: Zone;
    triggerRelatedCombinedHostInstanceId?: string;
    payCostPaymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
    summonPaymentSources?: readonly import("./core/payment-system").CardCostPaymentSource[];
    summonEnterFieldCorePlacements?: readonly import("./zone/enter-field-placement-execution").EnterFieldCorePlacement[];
  };
  /**
   * `pendingEffectTargetSelection` 経路の ActiveStack は DSL step index で再開できないため、
   * 対象開示窓後に対象注入済み deferredStack をそのまま解決再開する。
   */
  deferredStackResolution?: {
    deferredStack: ActiveStack;
  };
  /**
   * P3-131層2: step-continuation 形 (deferredStackResolution を持たない) の continuation で、
   * negate 応答 (pendingStackNegateRequests) を照合するための、元効果解決中 ActiveStack の
   * identity スナップショット。再開そのもの (executeEffect の resumeStepIndex) には使わず、
   * stackMatchesNegateAction への入力としてのみ使う。宣言元 (resolveDeferredMagicStack) が
   * 持つ activeStack をそのまま渡すため、resolveStackCascade 経由の本解決を再現しない。
   */
  negateIdentitySnapshot?: ActiveStack;
  /**
   * targeted 応答の解決中にさらに targeted disclosure が発生した場合の外側 continuation。
   * 内側を先に完了し、外側へ LIFO で復帰する。
   */
  previousTargetedDisclosureContinuation?: TargetedDisclosureContinuation | null;
}

export type TargetRedirectReplacementMode = "collapse" | "reselect";

export interface PendingTargetRedirect {
  pendingId: string;
  /** トリガーした redirect_effect_target CE の effectId。 */
  redirectEffectId: string;
  /** redirect 権を持つプレイヤー (= 本体 owner)。裁定 #8。 */
  promptedPlayerId: string;
  /**
   * replacement 候補を選ぶプレイヤー。省略時は promptedPlayerId と同じ。
   * 「変更でき」は自分が判断し、「相手が対象を選びなおす」型で分離する。
   */
  candidateChooserPlayerId?: string;
  /**
   * promptedPlayerId が対象変更を承諾済みで、candidateChooserPlayerId の候補選択待ち。
   * 旧 snapshot 互換のため省略時 false。
   */
  decisionConfirmed?: boolean;
  /** 元効果を発動した相手側カードの instanceId。 */
  sourceEffectInstanceId: string;
  sourceEffectDefinitionId: string;
  /** 元効果が解決時に取った対象集合 (instanceId)。 */
  originalResolvedInstanceIds: string[];
  /** 元集合の中で差し替え可能な代表対象 (既存 UI/ログ互換用)。 */
  redirectableInstanceId: string;
  /**
   * 元集合の中で同じ replacement へ差し替える全対象。
   * BS69 Q26982 / CB13 Q14170 により、保護対象だけでなく同時指定された場の
   * Spirit/Ultimate/Brave/Nexus 全体が対象変更される。
   * 旧 snapshot / テスト互換のため省略時は `redirectableInstanceId` 単体として扱う。
   */
  redirectableInstanceIds?: string[];
  /**
   * 対象変更の置換方式。
   * - collapse: 同時指定された場の対象を replacement 1 体へ畳む既存裁定。
   * - reselect: 元 TargetSpec の対象数を保ち、候補選択者が同数を選び直す。
   * 旧 snapshot 互換のため省略時は "collapse"。
   */
  replacementMode?: TargetRedirectReplacementMode;
  /** 差し替え候補 (token 集合)。 */
  candidateTokenInstanceIds: string[];
  /**
   * 再起動用継続情報。Step 3b で effect-interpreter 配線時に必須化。
   * 旧 Step 3a (continuation 未配線) のテストで省略可能なよう optional。
   */
  continuation?: RedirectActionContinuation;
  /**
   * core_distribute(mode="player_choice") の配分確定時に発行された redirect prompt。
   * 設定時は effect step 再実行ではなく、該当 PendingCoreDistribution の candidates を更新する。
   */
  coreDistributionPendingId?: string;
  /**
   * core distribution 配分確定後に redirect prompt が挟まった場合の通常コア割当。
   * confirm/decline 後に対象差し替えを反映して applyPendingCoreDistributionAction へ戻す。
   */
  coreDistributionAllocations?: Record<string, number>;
  /** multi-source core distribution のソース別割当。 */
  coreDistributionSourceAllocations?: Record<string, number>;
  /** core distribution でソウルコアを置く対象 instanceId ごとの個数。 */
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  /** multi-source core distribution のソウルコア source 別割当。 */
  coreDistributionSoulCoreSourceAllocations?: Record<string, number>;
  /** core distribution でソウルコアを置く対象 instanceId。 */
  coreDistributionSoulCoreInstanceId?: string;
}

/**
 * フィールドからのコアシュート対象選択待ち状態。
 * triggered effect / field card effect 経由の core_move で、
 * 複数のカードにコアがあり分配選択が必要な場合に設定される。
 */
export interface CoreSourceGroupMinimum {
  instanceIds: readonly string[];
  min: number;
}

/** Shared by REST validation, GUI and decision generation. */
export function satisfiesCoreSourceGroupMinimums(
  groups: readonly CoreSourceGroupMinimum[] | undefined,
  distribution: Readonly<Record<string, number>>,
  soulInstanceId?: string
): boolean {
  return (groups ?? []).every(
    (group) =>
      group.instanceIds.reduce(
        (sum, id) =>
          sum + (distribution[id] ?? 0) + (id === soulInstanceId ? 1 : 0),
        0
      ) >= group.min
  );
}

export interface PendingCoreShootSelection {
  /** 相手による除去数確定後、持ち主だけが通常/ソウルの内訳を選ぶ (Q31528)。 */
  ownerCoreChoice?: {
    /** サーバー内部の再開情報。表示用stateでは省略する。 */
    originalPending?: PendingCoreShootSelection;
    distribution?: Record<string, number>;
    soulSourceId: string;
  };
  /** コア移動後に同じ原因で本文を再開する。ライフコア選択と共通の継続。 */
  continuation?: LifeCoreSelectionContinuation;
  stepResultId?: string;
  sourceGroupMinimums?: CoreSourceGroupMinimum[];
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 解決後に duration:current_effect CE を該当 effect 単位で失効させるための効果 index。 */
  sourceEffectIndex?: number;
  /** コアシュート対象候補（フィールド上のコア保持カード） */
  candidates: Array<{
    instanceId: string;
    definitionId: string;
    availableCores: number;
  }>;
  /**
   * 効果本文で既に選択済みのため、分配から外せない候補。
   * 例: 「2体のコア1個ずつ」に core_move_amount_modifier が乗り、追加分だけ
   * 分配選択になっても、各対象は最低1個分含める必要がある。
   */
  mandatoryTargetInstanceIds?: string[];
  /** 移動するコア総数（上限） */
  totalAmount: number;
  /**
   * P3-88: 「コアN個まで」最低取得数。省略時は totalAmount（＝ちょうど totalAmount を強制）。
   * 0 等で totalAmount 未満なら、0〜totalAmount のプレイヤー選択（under-selection）。
   */
  minTotal?: number;
  /** コア移動先の kind */
  toKind: string;
  /** コア移動先のプレイヤー ID */
  toPlayerId: string;
  /**
   * toKind が field/field_card/card_instance のとき、コアを実際に置く単一カードの
   * instanceId (resolveCoreShootCardDestinationId で候補ちょうど1枚のときのみ解決)。
   * reserve/trash/void/life 宛では常に undefined。
   */
  toCardInstanceId?: string;
  /** コア移動元のプレイヤー ID */
  fromPlayerId: string;
  /**
   * 旧形式の予約フィールド（常に []）。本文の再開は continuation が保持する。
   */
  remainingActions: EffectAction[];
  /** remainingActions と同じく現状未使用（生成時に既定値が入るのみ）。 */
  effectTiming: EffectTiming;
  battleEndDeferralAttackId?: string;
  /**
   * この pending が閉じ、他の効果解決 pending が無い安定点で発火させる神託。
   * マジック効果の core_shoot が選択待ちで中断した場合に使う。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
}

export interface PendingEffectTargetGroup {
  requiredTargetCount: number;
  maxTargetCount?: number;
  targetStepId?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetInstanceIds: string[];
}

/**
 * 効果の対象選択待ち (コスト支払い + スタック窓クローズ後の解決時)。種別非依存。
 * `deferredStack` に対象を流し込んで `resolveDeferredStackAction` を再開し、
 * `remainingStacks` のカスケード残りを継続する。
 * ルール正源: 03a 標準パイプライン (2.コスト支払い → 3.対象の選択) + 08 スタック窓。
 */
export interface PendingEffectTargetSelection {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** under-card など、場の source card と効果提供 card が異なる場合の効果側 instanceId。 */
  effectSourceInstanceId?: string;
  /** under-card など、場の source card と効果提供 card が異なる場合の効果側 definitionId。 */
  effectSourceDefinitionId?: string;
  /** 解決を再開するための ActiveStack（targetInstanceIds 未確定）。 */
  deferredStack: ActiveStack;
  /**
   * 本 pending 解決後に継続するカスケードの残りスタック (LIFO)。
   * 多段カスケード (相手の応答効果など) で、各スタックを順に窓後対象選択するための退避先。
   */
  remainingStacks: ActiveStack[];
  requiredTargetCount: number;
  maxTargetCount: number;
  /** optional repeat など、同一 instanceId を複数回の対象選択として扱う場合に true。 */
  allowDuplicateTargets?: boolean;
  /** 対象指定元 DSL step id。targeted disclosure resume 用。 */
  targetStepId?: string;
  /** 現在の盤面（窓クローズ後）から算出した対象候補。 */
  candidateInstanceIds: string[];
  targetGroups?: readonly PendingEffectTargetGroup[];
  targetEffectFilterTags: readonly string[];
  /**
   * battle_end deferred 効果から生成された対象選択であることを示す attackId。
   * 対象選択およびそこから派生する targeted disclosure 中は scope:"battle" CE 失効を遅延する。
   */
  battleEndDeferralAttackId?: string;
}

export type PendingAsIfSoulCoreChoiceKind =
  | "contract_combine"
  | "declare_advent"
  | "declare_host_dual_advent";

export interface PendingAsIfSoulCoreChoiceOption {
  choiceId: string;
  label: string;
  useAlternateCost?: boolean;
  costWaived?: boolean;
  proxySourceInstanceId?: string;
  proxySourceDefinitionId?: string;
  proxySourceCardNo?: string;
  proxyTargetCardNames?: readonly import("./dsl-types").CardNameMatch[];
}

/**
 * 契約合体 / 煌臨系の「ソウルコアを置いたものとして」選択待ち。
 * ルール正源: 10_rules/02 §起動型キーワード効果。発揮宣言でスタック窓を開き、
 * 効果文内の擬制コスト選択は窓クローズ後・対象選択前に処理する。
 */
export interface PendingAsIfSoulCoreChoice {
  pendingId: string;
  actionKind: PendingAsIfSoulCoreChoiceKind;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  deferredStack: ActiveStack;
  remainingStacks: ActiveStack[];
  options: readonly PendingAsIfSoulCoreChoiceOption[];
}

export interface PendingEffectOptionalRepeatChoice {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  effectIndex: number;
  repeatStepIndex: number;
  targetStepId?: string;
  baseTargetCount: number;
  maxAdditionalCount: number;
  /**
   * 追加回数の確定 UI 種別。
   * `count_decrease` は「追加で自分のカウントを減らすことで」型で、既存のコア操作
   * UI からカウントエリアを仮想タップして減少数を選ぶ。
   */
  additionalCountSelectionMode: "repeat_count" | "count_decrease";
  choices: readonly PendingStepChoiceOption[];
  deferredStack: ActiveStack;
  remainingStacks: ActiveStack[];
  battleEndDeferralAttackId?: string;
}

export interface PendingEffectOptionalRepeatCountSelection {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  effectIndex: number;
  repeatStepIndex: number;
  targetStepId?: string;
  baseTargetCount: number;
  /**
   * 追加回数の確定 UI 種別。
   * `count_decrease` のときだけカウントエリアの仮想減少として扱う。
   */
  selectionMode: "repeat_count" | "count_decrease";
  /** 追加発揮回数 / 追加で減らすカウント数の下限。通常は 1 (0 は「追加発揮しない」側)。 */
  min: number;
  /** 追加発揮回数 / 追加で減らせるカウント数の上限。 */
  max: number;
  deferredStack: ActiveStack;
  remainingStacks: ActiveStack[];
  battleEndDeferralAttackId?: string;
}

export interface PendingBorrowedEffectChoice {
  chainId: string;
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  targetDefinitionId: string;
  borrowEvents: readonly CardEventType[];
  candidates: readonly {
    effectIndex: number;
    textRef?: readonly number[];
    grantedEffectCeId?: string;
    effectSourceInstanceId?: string;
    effectSourceDefinitionId?: string;
  }[];
  /** DSL.BorrowCardEventEffectAction.suppressBorrowedEffect の選択待ち中の引き継ぎ。 */
  suppressBorrowedEffect?: boolean;
  /** DSL.BorrowCardEventEffectAction.suppressResponseStack の選択待ち中の引き継ぎ。 */
  suppressResponseStack?: boolean;
  /** 借用効果本体・抑止 CE 登録へ引き継ぐ発生源側の防止レベル。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** suppressBorrowedEffect 登録時に使う発生源側の限定防止貫通。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** DSL.BorrowCardEventEffectAction.ignoreLevelCondition の選択待ち中の引き継ぎ。 */
  ignoreLevelCondition?: boolean;
  /** DSL.BorrowCardEventEffectAction.attributeToBorrowedCard の選択待ち中の引き継ぎ。 */
  attributeToBorrowedCard?: boolean;
  /**
   * battle_end deferral 解決中に生成された場合の元 attackId。
   * 借用効果の選択待ち中は scope:"battle" CE 失効を遅延する。
   */
  battleEndDeferralAttackId?: string;
}

export interface PendingBorrowedEffectTargetSelection {
  chainId: string;
  pendingId: string;
  actingPlayerId: string;
  choosingPlayerId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  targetDefinitionId: string;
  borrowedEffectIndex: number;
  grantedEffectCeId?: string;
  requiredTargetCount: number;
  maxTargetCount: number;
  bpBudgetAmount?: number;
  costBudgetAmount?: number;
  symbolBudgetAmount?: number;
  candidateInstanceIds: string[];
  targetStepId: string;
  targetStepIndex: number;
  stepContext: import("./step-execution-context").SerializedStepContext;
  recordedUsage?: RecordedEffectUsage;
  /** 借用先 host と効果テキスト元 donor が異なる場合の donor instanceId。 */
  effectSourceInstanceId?: string;
  /** 借用先 host と効果テキスト元 donor が異なる場合の donor definitionId。 */
  effectSourceDefinitionId?: string;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** DSL.BorrowCardEventEffectAction.attributeToBorrowedCard の選択待ち中の引き継ぎ。 */
  attributeToBorrowedCard?: boolean;
  /**
   * battle_end deferral 解決中に生成された場合の元 attackId。
   * 借用効果の対象選択待ち中は scope:"battle" CE 失効を遅延する。
   */
  battleEndDeferralAttackId?: string;
}

/**
 * 「相手は[ゾーン]のコア1個をトラッシュに置かなければフラッシュ/スタック効果を発揮できない」
 * (gate_flash_stack_core。BSTS01-M03 / 10_rules/03c §「○○しなければ△△を発揮できない」) の
 * 発揮前提コア除去待ち。
 *
 * 生成: `resolveDeferredStackAction` の前置フックが、相手のフラッシュ/スタック効果スタックを
 * 解決する直前 (対象選択前) に、活性 gate_flash_stack_core CE があり効果保持カードが耐性を
 * 持たず移動可能なコアがあるときに立てる。
 * 解決: `resolve_pay_to_act_core_gate` legal action。`sourceContainerId` に選んだコア源
 * (フィールドカード instanceId か reserve センチネル) を渡してコア1個をトラッシュへ移し、
 * `deferredStack`(payToActGateResolved=true) で解決を再開する。`decline=true` なら
 * その効果は発揮されず (空撃ち類似)、`remainingStacks` のカスケードへ進む。
 */
export interface PendingPayToActCoreGate {
  pendingId: string;
  /** コア除去を行う(=ゲートされた)プレイヤー = 発揮しようとする相手。 */
  actingPlayerId: string;
  /** ゲートを生んだ CE のソースカード (耐性判定・ログ用)。 */
  gateSourceInstanceId: string;
  gateSourceDefinitionId: string;
  /** コアを除去して解決を再開するための ActiveStack (フラッシュ/スタック効果)。 */
  deferredStack: ActiveStack;
  /** カスケード解決中に後続スタックがある場合の退避先。 */
  remainingStacks: ActiveStack[];
  /**
   * まだ支払っていないゲート数 (= コア除去残り個数)。粒度＝発揮1回ごとにコア1個だが、
   * 別カードの同型ゲートが複数あれば各効果分を支払う (合計複数個)。同名ゲートは
   * 〔重複不可〕で1つに集約される。本 pending は 1 回の解決でコア1個を取り、
   * remainingCount を1減らす。0 になったら deferredStack を payToActGateResolved=true で
   * 解決再開する。
   */
  remainingCount: number;
  /**
   * 選択可能なコア源。reserve はセンチネル `"reserve"`、フィールドカードは instanceId。
   * 各源の利用可能なコア総数 snapshot。内訳省略は旧snapshotの通常コアのみ。
   */
  candidates: Array<{
    containerId: string;
    available: number;
    normalAvailable?: number;
    soulAvailable?: number;
  }>;
  /**
   * false のとき、集計された全ゲートが holder 耐性①(defense_immune CE、または
   * 創界神/魂状態/ミラージュ等「○○を含む」opt-in 無しの構造的除外)による非拘束。
   * 拒否 (decline) または候補0でも不発にならず、そのまま解決へ進む
   * (pay-to-act-hand-discard-gate.ts の declineFizzles と同型)。
   */
  declineFizzles: boolean;
}

export interface PendingPayToActHandDiscardSlot {
  gateSourceInstanceId: string;
  gateSourceDefinitionId: string;
  candidateCardInstanceIds: string[];
  /**
   * 発揮するカード自身(holder)がこのゲート発揮元に耐性を持つ (10_rules/03d.md 耐性①)。
   * 耐性があっても「手札1枚破棄」の要求自体は変わらず提示される (任意で破棄できる) が、
   * このスロットの不充足は不発の原因にならない (PendingPayToActHandDiscardGate.declineFizzles 参照)。
   */
  holderImmune: boolean;
}

/**
 * 「相手は手札N枚を破棄しなければフラッシュ/スタック効果を発揮できない」
 * (gate_flash_stack_hand_discard) の発揮前提手札破棄待ち。
 *
 * 生成: `resolveDeferredStackAction` の前置フックが、対象フラッシュ/スタック効果の
 * 解決直前 (対象選択前) に立てる。複数 gate は必要枚数を合算し、候補割当は
 * `candidateSlots` で atomic に検証する。
 */
export interface PendingPayToActHandDiscardGate {
  pendingId: string;
  /** 手札を破棄する(=ゲートされた)プレイヤー。 */
  actingPlayerId: string;
  /** 代表 gate source。ログ/UI 用。 */
  gateSourceInstanceId: string;
  gateSourceDefinitionId: string;
  deferredStack: ActiveStack;
  remainingStacks: ActiveStack[];
  requiredCount: number;
  /** UI 用の候補 union。実解決時は candidateSlots で atomic 検証する。 */
  candidateCardInstanceIds: string[];
  candidateSlots: PendingPayToActHandDiscardSlot[];
  /**
   * false のとき、全スロットが holder 耐性による非拘束 (candidateSlots.every(holderImmune))。
   * 拒否 (decline) または候補0でも不発にならず、そのまま解決へ進む。
   */
  declineFizzles: boolean;
}

/**
 * 中断された use_magic legal action 呼び出しの再開に必要な、シリアライズ可能な
 * パラメータ一式。`ApplyLegalActionOptions` から state / callback 系
 * (getCardDefinitionById 等、関数のためシリアライズ不可) を除いたもの — これらは
 * resume 時に呼び出し側の DeferredStackResolverOptions (callback を全て含む) から
 * 都度渡し直して `ApplyLegalActionOptions` を再構築する。`action` (元の
 * UseMagicLegalAction 宣言そのもの) を含む。
 */
export type InterruptedMagicUse = Omit<
  import("./legal/legal-actions-types").ApplyLegalActionOptions,
  | "state"
  | "getCardDefinitionById"
  | "getRegisteredTriggeredEffectActions"
  | "getRegisteredBurstActions"
  | "getRegisteredBattleImmediateEffectActions"
  | "getRegisteredFieldCardEffectActions"
  | "getRegisteredHandActivatedEffectActions"
  | "getRegisteredMagicActions"
  | "getHandWrittenBurstPostResolutionPolicy"
  | "resolveFieldCardEffect"
  | "getHandWrittenEffectResolver"
  | "getConditionalCostCanExecuteCheck"
  | "getConditionalResultSuccessCheck"
  | "resolvePendingTriggeredEffect"
  | "getPendingTriggeredEffectResolver"
  | "resolvePendingBurstCheck"
  | "getPendingBurstCheckResolver"
>;

/**
 * 「自分が[tribeFilter]を持つマジックカードを使用するとき、そのコストを支払う前に、
 * ただちに[triggerEffectIndex]の効果を使用できる」(offer_magic_pre_cost_trigger CE。
 * engine-magic-field-pre-cost-payment-trigger, BSAZ01-C12「戦力投入」) の発揮可否待ち。
 *
 * 生成: `legal-actions-apply.ts` の use_magic 宣言経路 (main/flash/stack いずれも) が
 * コスト支払い呼び出し (`useMagicCardInFlashContextAsAction`) 直前に、対象マジックの
 * 系統が tribeFilter に合致し、かつ活性な offer_magic_pre_cost_trigger CE
 * (usageLimit 未消費) があるときに立てる。同時にコスト支払いそのものを延期する
 * (`interruptedMagicUse` に呼び出しパラメータを保存)。
 *
 * 解決: `resolve_field_magic_pre_cost_trigger` legal action。
 * - decline: `interruptedMagicUse` を共通のマジック使用経路へ再投入し、通常通り
 *   コストを支払う。
 * - trigger: usageLimit (per_card_name/turn) を消費し `triggered=true` にした上で
 *   `triggerEffectIndex` の効果 (BSAZ01-C12 effects[1]) を
 *   通常の `use_magic` として使用する。すなわち C12 自身のコスト支払い、応答窓、
 *   解決、後処理を共通経路で完了する。この効果自体が内部で pending
 *   (core_distribute 等) を生む場合は通常の汎用 pending 解決フローに委ねる。
 *   `resumeFieldMagicPreCostTriggerIfReady` はすべての pending が閉じた後に中断元の
 *   use_magic を現在の盤面で再提示し、支払い不能なら元カードを使用扱いにせず元ゾーンに残す。
 */
export interface PendingFieldMagicPreCostTrigger {
  pendingId: string;
  /** 発揮判断を行う(= マジックを使用しようとしている)プレイヤー。 */
  actingPlayerId: string;
  /** 権利を発揮しているカード (BSAZ01-C12 等)。 */
  triggerSourceInstanceId: string;
  triggerSourceDefinitionId: string;
  /** 発揮する効果の DSL effect index (= メイン効果)。 */
  triggerEffectIndex: number;
  /** true になったら「trigger」が選ばれ、C12 自身の通常使用と解決が完了するまで待つ。 */
  triggered: boolean;
  /** 中断された use_magic 呼び出しの再開パラメータ。 */
  interruptedMagicUse: InterruptedMagicUse;
}

/**
 * 通常召喚/配置の維持コア選択待ち。
 * コスト支払い後にスタック窓を先に開き、窓クローズ後に召喚/配置が通る場合だけ
 * ここで維持コアを選ぶ。
 */
export interface PendingEnterFieldPlacement {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 維持コアを注入して解決を再開するための ActiveStack。 */
  deferredStack?: ActiveStack;
  /** カスケード解決中に後続スタックがある場合の退避先。 */
  remainingStacks: ActiveStack[];
  minimumCoreCount: number;
  maximumCoreCount: number | null;
  /**
   * 効果ステップ `brave_combine_effect.asSummon` 由来の直接合体召喚。
   * 通常召喚スタックではないため `deferredStack` には戻さず、配置解決時に
   * コア配置 → 直接合体 → 元効果の後続 step 再開を行う。
   */
  effectBraveCombineAsSummon?: {
    braveInstanceId: string;
    braveDefinitionId: string;
    hostInstanceId: string;
    fromZone: Zone;
    effectSourceInstanceId: string;
    effectSourceDefinitionId: string;
    effectIndex: number;
    effectResolutionBeforeState: GameState;
    chainId: string;
    stepResultId: string;
    chosenChoiceIndex?: number;
    continuation?: MultiPlacementContinuation;
  };
  /**
   * この pending が閉じ、他の効果解決 pending が無い安定点で発火させる神託。
   * マジック効果が召喚/配置の維持コア選択で中断した場合に使う。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
}

/**
 * ブレイヴ召喚のスタック窓クローズ後の「合体する/スピリット状態」選択待ち。
 *
 * ルール正源: `10_rules/02_turn-flow-and-timing.md`「コスト支払い完了後に窓が開く」
 * ＋ `10_rules/05_brave-and-attack-special-cases.md`「召喚時にすぐに合体させることもできる」
 * (合体は場入り=解決の一部)。合体可否・合体先 host の選択はスタック窓より後 (解決時) に行う。
 *
 * 解決時点 (窓クローズ後の現在盤面) で合体条件を満たす生存ホストを `hostCandidateInstanceIds`
 * に列挙する。プレイヤーがホストを選べば `deferredStack.combineHostInstanceId` に書き込み、
 * スピリット状態を選べば未設定のまま `braveCombineChoiceResolved=true` にして解決を再開する。
 * その後は通常召喚と同じ `pendingEnterFieldPlacement` (合体時は min 0 / スピリット時は Lv1) へ続く。
 */
export interface PendingBraveCombineChoice {
  /** 共通場入り処理の合体選択。継続情報は元の配置 pending が保持する。 */
  multiPlacementPendingId?: string;
  pendingId: string;
  actingPlayerId: string;
  /** 召喚中のブレイヴ。 */
  braveInstanceId: string;
  braveDefinitionId: string;
  /** 合体選択を注入して解決を再開するための ActiveStack。通常召喚経路で使う。 */
  deferredStack?: ActiveStack;
  /** カスケード解決中に後続スタックがある場合の退避先。 */
  remainingStacks?: ActiveStack[];
  /**
   * battle_end deferred 効果から生成された合体選択であることを示す attackId。
   * 合体選択中は scope:"battle" CE 失効を遅延する。
   */
  battleEndDeferralAttackId?: string;
  /** 効果召喚ですでに field へ出たブレイヴの合体選択。 */
  effectSummon?: {
    sourceInstanceId: string;
    sourceDefinitionId: string;
    triggerBeforeState: GameState;
    /**
     * 多段階 summon step (2 体目以降の召喚等) が同一 effect 内に後続する場合の
     * 再開情報。`MultiPlacementContinuation` と同形 (summon 由来 pending 共通)。
     * 未設定なら従来通り解決時に finalizeEffectResolution のみで完了する
     * (単発 summon effect との後方互換)。
     */
    continuation?: MultiPlacementContinuation;
  };
  /**
   * この pending が閉じ、他の効果解決 pending が無い安定点で発火させる神託。
   * 合体選択後に維持コア選択へ進む場合は deferredStack 経由で引き継ぐ。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /** 解決時点で合体条件を満たす生存ホスト候補。空なら本 pending は生成しない。 */
  hostCandidateInstanceIds: string[];
  /**
   * スピリット状態 (合体しない) の場入りコア (Lv1) を支払えるか。
   * 合体は 0 コアで足りるが、スピリット状態は Lv1 必須。支払えない場合は
   * 合体選択でスピリット状態の選択肢を出さない (合体しか選べない soft-lock 回避)。
   * pending 生成時 (= スタック窓クローズ後・選択前) に算出して固定する。
   */
  spiritStateAffordable: boolean;
}

/**
 * 手札/手元 ⇔ トラッシュの1対1入替選択待ち (engine-atomic-hand-trash-swap-legal-action、
 * BSTH02.7-TR03(A)【神秘】等)。トリガー効果の `queue_hand_trash_swap` ステップが、
 * 手札/手元側・トラッシュ側の双方に候補が1体以上あるときだけ本 pending を生成する
 * （どちらか一方でも候補0なら生成せず不発＝2択とも成立しなければ発火自体させない）。
 * 候補一覧は queue 時点でスナップショットする（本 pending 解決中は他の legal action が
 * すべて閉じるため、解決前に候補が変化する心配はない）。実際のカード入替は
 * `swap_hand_trash` legal action の適用時に、出す側カードの**現在ゾーン**（手札/手元の
 * どちらか）を読み取って入る側カードの行き先に用いる（1対1物理交換、
 * [[project_swap_two_zone_extension]] と同じ「出る札の行き先に相乗り」原則）。
 * 任意性は effect/step の発揮選択で扱う。対象選択に辞退を重ねない（03c）。
 */
export interface PendingHandTrashSwapChoice {
  chainId: string;
  continuation?: LifeCoreSelectionContinuation;
  stepResultId?: string;
  pendingId: string;
  actingPlayerId: string;
  /** 効果の発動元カード（例: 「アリスの人形工房」）。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 手札/手元側の交換候補 instanceId 一覧（queue 時点でスナップショット）。 */
  outgoingCandidateInstanceIds: string[];
  /** 解決時にも要求する手札/手元側ゾーン。省略時は既存互換で hand + set_aside。 */
  outgoingZones?: ReadonlyArray<Extract<Zone, "hand" | "set_aside">>;
  /** トラッシュ側の交換候補 instanceId 一覧（queue 時点でスナップショット）。 */
  incomingCandidateInstanceIds: string[];
  /** 発生源耐性貫通レベル。解決時のトラッシュ戻し gate 再判定で使う。 */
  sourcePreventionLevel?: EffectPreventionLevel;
  /** 発生源単位の耐性 bypass profile。 */
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 実際の効果発生源 instance。省略時は sourceInstanceId を使う。 */
  effectSourceInstanceId?: string;
  /** 実際の効果発生源 definition。省略時は sourceDefinitionId を使う。 */
  effectSourceDefinitionId?: string;
}

/**
 * フィールドの発動元カード ⇔ 手札カードの1対1入替選択待ち。
 * 任意性は effect/step の発揮選択で扱い、ここでは必ず候補を選ぶ。
 */
export interface PendingFieldHandSwapChoice {
  continuation?: LifeCoreSelectionContinuation;
  stepResultId?: string;
  pendingId: string;
  chainId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  incomingCandidateInstanceIds: string[];
  enterRecovered: boolean;
  effectScope?: EffectEventScope;
}

/**
 * 転召（召喚手順内ステップ）の強制コア消費の対象選択待ち。
 *
 * ルール正源: 10_rules/07b 転召節 + 02:188「コスト支払い完了後にスタック窓」。
 * 転召はスタック窓クローズ後・場入り（維持コア配置）前に挿入される召喚手順内ステップで、
 * この転召ステップ専用のスタック窓は開かない（[[CardDefinition.tenshoSummon]]）。
 *
 * 召喚宣言時の適法性ゲート（`canSummonCard`）で「対象が居る」ことは保証されるが、
 * スタック窓中に盤面が変わり対象が消えうる。解決時に候補を再算出し、
 * 1 体以上あれば本 pending を立て、0 体なら強制不能として不発（場入りへ直行）。
 */
export interface PendingTenshoSummon {
  pendingId: string;
  actingPlayerId: string;
  /** 召喚中（場入り前）のスピリット。 */
  summoningInstanceId: string;
  summoningDefinitionId: string;
  /** 転召を注入して解決を再開するための ActiveStack。 */
  deferredStack: ActiveStack;
  /** カスケード解決中の後続スタック退避先。 */
  remainingStacks: ActiveStack[];
  /** 解決時点で転召対象になりうる自分のスピリット候補（送り先へ N 個以上動かせるコアを持つ）。 */
  targetCandidateInstanceIds: string[];
  /** コアの送り先ゾーン。 */
  destination: "void" | "trash" | "reserve";
}

/**
 * 逆転醒 pattern2（B面→A面の「裏返して配置/召喚する」, P3-98 / 08a §逆転醒）の解決待ち。
 *
 * 誘発（「裏返して配置できる」）なので宣言モーメントが無く、通常召喚の宣言時 paymentSources 収集に
 * 相乗りできない。本 pending で「支払いソース + 維持コア配置の選択が必要」を通知し、resolve
 * アクション（`resolve_reverse_rebirth_summon`）が `summonPaymentSources` / `summonEnterFieldCorePlacements`
 * を運ぶ（既存 summon 支払い / 場入りコア HUD を GUI で流用）。withoutCost のとき支払い 0。
 * count は不変（裁定 2026-06-14）。in-place 変換（離脱ではない）なので「離れたとき」誤発火なし。
 */
export interface PendingReverseRebirthSummon {
  pendingId: string;
  actingPlayerId: string;
  /** 逆転醒する場の B 面 instance（in-place で表面 def へ変換）。 */
  sourceInstanceId: string;
  /** 変換先の表面 def cardNo（= originalDefinitionId）。 */
  frontDefinitionId: string;
  /** 支払うべき軽減後コスト（自身シンボル軽減不可で算出済み）。withoutCost なら 0。 */
  costToPay: number;
  /** 維持コア最低数（表面 def の最低 Lv requiredCores）。 */
  minimumCoreCount: number;
  /** カスケード解決中の後続スタック退避先。 */
  remainingStacks: ActiveStack[];
  /**
   * 支払い・維持コア配置の確定後に、元 effect の後続 step を再開する継続情報。
   * pattern2 は新しい A 面 instance を作るため、解決側で B 面を参照していた source metadata
   * だけをその instance に差し替えてから resume する。
   */
  continuation?: ReverseRebirthSummonContinuation;
}

export interface PendingStackNegateRequest {
  requestId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  negateTarget: NegateAction["negateTarget"];
  duration?: NegateAction["duration"];
  targetFilter?: NegateAction["targetFilter"];
  targetController?: NegateAction["targetController"];
  targetEffectTiming?: NegateAction["targetEffectTiming"];
  targetEffectFilter?: NegateAction["targetEffectFilter"];
  suppressMatchedEffect?: NegateAction["suppressMatchedEffect"];
  /**
   * 生成時の step/turn。`duration` の期限切れ判定に使う
   * (ENGINE-single-target-burst-nullify: 従来 duration を一切参照せず対象一致有無に
   * 関わらず初回チェックで無条件消費していたため、直後に対象が無い request が
   * 無関係な将来スタックへ誤適用/機会損失する silent bug があった)。
   */
  createdAtStep: Step;
  createdAtTurn: number;
}

/**
 * `PendingStackNegateRequest.duration` の期限切れ判定 (SSOT)。
 * `scope:"turn"` は生成ターンを過ぎたら、`scope:"step"` は生成 step から離れたら期限切れ。
 * duration 未指定、または `scope` が上記以外 (permanent 系。while_on_field は
 * continuousStackNegate CE 経路に分岐済みでここへは到達しない) は期限切れにしない。
 */
export function isPendingStackNegateRequestExpired(
  request: PendingStackNegateRequest,
  state: { step: Step; turnNumber: number }
): boolean {
  const duration = request.duration;
  if (!duration) return false;
  switch (duration.scope) {
    case "turn":
      return state.turnNumber !== request.createdAtTurn;
    case "step":
      return state.step !== request.createdAtStep;
    default:
      return false;
  }
}

/** 期限切れでない pendingStackNegateRequests が1件以上あるか (turn-end blocker 等の判定用)。 */
export function hasActivePendingStackNegateRequests(state: {
  step: Step;
  turnNumber: number;
  pendingStackNegateRequests: readonly PendingStackNegateRequest[];
}): boolean {
  return state.pendingStackNegateRequests.some(
    (request) => !isPendingStackNegateRequestExpired(request, state)
  );
}

/**
 * `timing.deferredTo === "battle_end"` の効果を「このバトル終了時」へ予約する退避エントリ。
 *
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」
 * + R12「このバトル終了時、…アタックステップを終了する」(発揮即終了ではなく予約)。
 *
 * 発揮宣言・コスト支払い時点 (activeAttack が存在するバトル中) に積み、
 * 当該 `attackId` のバトルが解決し終わった時点 (`executeBattleResolution` 末尾) で
 * `executeEffect` を再起動して steps を実行する。条件 (例: 創界神/導界者ネクサスの有無) は
 * 予約時ではなく発火時 (= バトル終了時) に再評価する。
 *
 * activeAttack が無い (= メインステップ等バトル外) で deferredTo:battle_end 効果が解決された
 * 場合は「このバトル」が指す対象が無いため何も積まず不発にする (ユーザー裁定 2026-05-31)。
 */
export interface PendingBattleEndDeferral {
  deferralId: string;
  /** 予約対象のバトル。当該バトル終了時にのみ発火する。 */
  attackId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 実際の効果発生源 instance。省略時は sourceInstanceId を使う。 */
  effectSourceInstanceId?: string;
  /** 実際の効果発生源 definition。省略時は sourceDefinitionId を使う。 */
  effectSourceDefinitionId?: string;
  /**
   * `source_card` 参照だけを差し替える明示 override。
   * battle_end 再開時に合体状態が変化しても、予約時の「このブレイヴ」等を保持する。
   */
  sourceCardReferenceInstanceId?: string;
  /**
   * 手札/トラッシュ等から発揮した battle_end deferred 効果の元発揮ゾーン。
   * 未指定は従来どおり field source とみなし、battle_end 発火時に source の場残留を要求する。
   */
  activationZone?: EffectActivationSourceZone;
  /**
   * in_use/trash へ移った source の初回 applicability 再評価だけに用いる元ゾーン。
   * `activationZone` と違い、battle-end の source 場残留要件には影響しない。
   */
  applicabilityEvaluationZone?: EffectActivationSourceZone;
  /**
   * false のとき、battle_end 発火時に source の field + pendingLeaveKind:null を要求しない。
   * マジック等の in_use 維持や手札/トラッシュ発揮は場残留条件を持たない。
   */
  sourceOnFieldRequired?: boolean;
  /**
   * true のとき、battle_end 発火時に effectSourceInstanceId も field + pendingLeaveKind:null を要求する。
   * 予約時点で host の場効果として発揮した合体中ブレイヴの効果提供元を、発火時の現在の合体状態に依存せず fail-closed する。
   */
  effectSourceOnFieldRequired?: boolean;
  /**
   * true のとき、battle_end 発火時にも effectSourceInstanceId が sourceInstanceId に合体中であることを要求する。
   * `source_card` 自壊のように、予約済みの後段が効果源カード自身を参照するだけなら未指定/false にする。
   */
  effectSourceAttachmentRequired?: boolean;
  /** 再起動する効果の card 定義 effects[] 内インデックス。 */
  effectIndex: number;
  /**
   * アクセル/チェンジ等、宣言時に一時合成した Effect を再開する場合に保持する。
   * 通常は未設定で、sourceDefinitionId/effectIndex からカード定義の effect を使う。
   */
  resumeEffectOverride?: import("./dsl-types").Effect;
  /**
   * step 単位 defer (`EffectStep.deferTo`) 用: バトル終了時に再開する step インデックス。
   * 未指定 = effect 単位 defer (`timing.deferredTo`) で effect 全体を step 0 から再評価。
   */
  resumeFromStepIndex?: number;
  /**
   * step 単位 defer 予約時点の step context。`stepCondition:ref_succeeded` 等、
   * 前段 step 結果に依存する deferred step を battle_end 再開時にも同じ文脈で評価する。
   */
  restoredStepContext?: import("./step-execution-context").SerializedStepContext;
  /**
   * ENGINE-battle-end-deferral-target-carry: 予約時点 (宣言時、`ExecuteEffectOptions.
   * targetInstanceIds` が既に解決済みのとき) の対象選択を保持し、`fireBattleEndDeferrals`
   * 再発火時に同じ対象で再利用する。対象選択を要する cost (例: remove_from_game で
   * 手札/トラッシュから1枚選択) を持つ deferredTo:"battle_end" 効果は、バトル終了時の
   * 再実行では新規の対話的対象選択を開けない（宣言時の battle-immediate legal action で
   * 対象は既に確定済みという前提）ため、宣言時に解決済みの対象をここへ運ぶ。
   * 対象選択を伴わない効果 (BSTH03-転醒X01(B) の count_decrease 等) は未設定のままでよい。
   */
  targetInstanceIds?: readonly string[];
  /**
   * `targetInstanceIds` が空配列でも、対象選択を 0 件で確定済みとして再開する印。
   * 未指定の空配列は、予約時に対象選択がまだ行われていないことを表す。
   */
  targetSelectionResolved?: boolean;
  /** targetInstanceIds を注入する DSL step id。省略時は最初の対象 step へ全件を渡す。 */
  targetStepId?: string;
  /**
   * battle_end 発火開始後に pending で中断し、後続 deferral を再開キューへ戻す場合の
   * battle_was_blocked 文脈。未設定なら再開側で participantSnapshots から再算出する。
   */
  battleEndDeferralWasBlocked?: boolean;
  /**
   * battle_end 発火開始後に pending で中断し、後続 deferral を再開キューへ戻す場合の
   * battle_life_reduced 文脈。通常の battle 解決でだけ実ライフ減少寄与を算出できるため、
   * 再開時はこの値を優先する。
   */
  battleEndDeferralLifeReduced?: boolean;
}

/**
 * ENGINE-delayed-turn-end-captured-target-state-transition (BSTH11-C04):
 * `ExhaustAction.downgradeAtTurnEnd` で重疲労させた対象を、このターン終了時
 * (次回 end-step cleanup) に疲労状態へ引き下げる予約。「この効果で疲労した対象は、
 * このターン終了時、疲労状態になる」型。既存の exhaust/set_exhaust_state action は
 * `exhaustFilter`(structured-state-grants.ts executeExhaust) が「回復状態からのみ
 * 通常疲労へ遷移可」というゲートを持ち後退遷移を表現できないため、盤面への直接書き込み
 * (`finishEndStepEffects` 経由) で表現する。step 再開・対象再解決・コスト等は伴わない
 * 単純な state downgrade のため、`pendingBattleEndDeferrals` のような effect 再開機構
 * (attackId 紐付け・resumeFromStepIndex 等) は不要。
 */
export interface PendingTurnEndExhaustDowngrade {
  cardInstanceId: string;
  /** 予約時のフィールド個体。離場後に同じ物理カードが再登場しても適用しない。 */
  fieldInstanceGeneration?: number;
  /** 予約が成立したターン。同じターンの終了時にだけ適用する。 */
  createdAtTurn: number;
}

export interface PendingImmediateBattleEnd {
  attackId: string;
  participantInstanceIds: readonly string[];
  blockSideInstanceIds: readonly string[];
  participantSnapshots: readonly BattleResolutionParticipantSnapshot[];
  appliedLifeDamage?: number;
  participantOwnSymbols?: readonly {
    entityId: string;
    ownSymbols: number;
  }[];
  destroyedRecords?: readonly BattleDestroyedRecord[];
  battleEndEntryStarted?: boolean;
}

/**
 * 効果による「ターンを終了する」予約。
 *
 * 公式 Q30302/Q30304: ただちに終了ではなく、派生効果と解決待ち効果をすべて解決し終えた
 * 実際のターン終了時に一時効果を無効化してターンを終了する。エンドステップ自体は行わない。
 */
export interface PendingTurnEndFinalization {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  createdAtTurn: number;
  unaffectedByRestriction?: boolean;
  /**
   * `usageLimit.unlessAffectedByOpponent` 用の払い戻し情報。
   * ターン終了予約時には妨害されていなくても、実際の終了時に
   * `restrict_end_turn` が成立するとその時点で「相手の効果を受けなかった」
   * 扱いになるため、宣言時 usage 記録をここへ保持する。
   */
  refundableUsageEntries?: readonly RecordedEffectUsageEntry[];
}

export interface PendingAttackStepEndBlockedRetry {
  /**
   * 実際のアタックステップ終了確定時に相手効果でブロックされた扱いにする
   * 元 step。`ref_blocked_by_opponent_effect` の参照先へ StepResult を補完する。
   */
  blockedStepId: string;
  /** retry optional step の条件全体。補完 StepResult を入れたうえで再評価する。 */
  stepCondition: import("./dsl-types").StepCondition;
  choosingPlayerId: string;
  stepLabel?: string;
  continuation: StepOptionalContinuation;
}

/**
 * 効果による「アタックステップを終了する」予約。
 *
 * 公式 PC01 Q17596/Q17597: ただちにステップを離れるのではなく、バトル終了時効果などを
 * 解決し終えた実際のアタックステップ終了時に `restrict_end_step` /
 * `restrict_end_attack_step` を再判定する。
 */
export interface PendingAttackStepEndFinalization {
  pendingId: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  createdAtTurn: number;
  unaffectedByRestriction?: boolean;
  refundableUsageEntries?: readonly RecordedEffectUsageEntry[];
  /**
   * 「相手の効果を受けたとき、この効果をもう一度だけ発揮できる」型。
   * 予約時点では終了妨害が無くても、実際の step finalization 時に
   * 相手由来 `restrict_end_*` でブロックされた場合に後続 optional step を開く。
   */
  blockedByOpponentRetry?: PendingAttackStepEndBlockedRetry;
}

export type PendingAccelCleanup =
  | {
      kind?: "accel";
      chainId: string;
      cardInstanceId: string;
      outcome: "set_aside" | "trash";
    }
  | {
      kind: "change";
      chainId: string;
      cardInstanceId: string;
      outcome: "trash";
      changeData: ChangeData;
    }
  | {
      kind: "change";
      chainId: string;
      cardInstanceId: string;
      outcome: "choice";
      actingPlayerId: string;
      changeData: ChangeData;
    }
  | {
      kind: "change";
      chainId: string;
      cardInstanceId: string;
      outcome: "swap";
      swapTargetInstanceId: string;
      actingPlayerId: string;
      changeData: ChangeData;
    };

export interface PendingChangeCleanupChoice {
  pendingId: string;
  chainId: string;
  cardInstanceId: string;
  sourceDefinitionId: string;
  actingPlayerId: string;
  changeData: ChangeData;
  swapCandidateInstanceIds: string[];
}

export interface TurnSummonedCardRef {
  playerId: string;
  instanceId: string;
  definitionId: string;
  colors: CardColor[];
  category?: CardCategory;
  tribes: string[];
}

export interface PendingPromptLock {
  resolverPlayerIds: string[];
}

export interface GameState {
  /** 表示配送専用。engine/applyは参照せず、配送stateと同じversionで置換する。 */
  viewerLegalActions?: {
    actingPlayerId: string;
    actions: readonly import("./legal/legal-actions-types").LegalAction[];
  };
  /** Serializable operation facts and delivery receipts across pending/resume. */
  semanticTriggerSequence?: number;
  semanticTriggerEvents?: readonly SemanticTriggerEvent[];
  /** 基本処理の原因ID発行用通番。保存・同期して再実行時のIDを一致させる。 */
  nextRootTriggerChainId: number;
  /** 通常ステップ遷移の通番。同一ターンで再度入ったステップを区別する（旧snapshotは0）。 */
  stepSequence?: number;
  turnNumber: number;
  activePlayerId: string;
  playerOrder: string[];
  /** 中断ターンへ番号を復元しても、以後の新ターンに同じ番号を再発行しない。 */
  turnNumberHighWaterMark?: number;
  step: Step;
  window: Window;
  players: PlayerState[];
  cardInstances: CardInstance[];
  /** 実体を省略するテスト用盤面だけが指定する。省略時は全カード実体が正源。 */
  zoneCountMode?: "abstract";
  battleEntities: BattleEntity[];
  activeAttack: ActiveAttack | null;
  stackWindow: StackWindow | null;
  preDeclarationStackWindow: PreDeclarationStackWindow | null; // 宣言前スタック窓
  /**
   * preDeclarationStackWindow をパスクローズした後、応答スタック解決が対象選択等で
   * 中断した場合に、全 continuation 解決後に attack/block/join 確定へ戻るための内部予約。
   * 正源: manual/ai-reference/10_rules/02_turn-flow-and-timing.md:181-185
   * （宣言はスタック解決後に成立し、解決後に合法性を再チェックする）。
   */
  pendingPreDeclarationConfirmation: PreDeclarationStackWindow | null;
  battleResolutionGroup: BattleResolutionGroup | null;
  battleImmediateEffects: BattleImmediateEffect[];
  burstSetPlayerIdsThisTurn: string[];
  setBurstStates: BurstSetState[];
  revealedBurstStates: RevealedBurstState[];
  /**
   * ミラージュセット状態。各プレイヤー通常は最大1枚（同時セット数1、新規セットで入れ替え）。
   * mirageData.exemptSetCountLimits を持つ各個体は常に0枠。
   * 通常枠を数えるカードは最大1枚だが、免除個体は複数共存できる。
   */
  mirageSetStates: MirageSetState[];
  /** このターンにメインステップでミラージュをセットしたプレイヤーIDリスト（ターン1回制限）。効果セットはこの制限に含まない。 */
  mirageSetPlayerIdsThisTurn: string[];
  /**
   * ENGINE-mirage-set-count-exemption: mirageData.exemptSetCountLimits による
   * 手札からのセット行動数免除の使用記録。同一プレイヤー・同名(cardNo)につきターン1回。
   * セット済み各個体の0枠扱いとは独立する（BSTH002-C01）。
   * cardNo="*" は同名情報を持たない旧セーブの使用済み互換キー（ターン境界で消去）。
   */
  mirageSetCountExemptionsUsed: { playerId: string; cardNo: string }[];
  /** クォーツセット状態（P2-07 H-2 基盤）。host にセット中のクォーツを管理。 */
  quartzSetStates: QuartzSetState[];
  /**
   * このターンに使用された神技/導技/界放/契約技のキー。
   * ターン制限チェック用。形式: "{instanceId}:{skillIndex}" (once) /
   * "{controllerPlayerId}:{cardNo}:{skillIndex}" (once_per_name)。
   */
  usedDivineSkillKeysThisTurn: string[];
  /**
   * このターンに発動した〔ターンに1回:同名〕トラッシュ起点煌臨のキー。
   * 形式: "{cardNo}" (同名共有カウント、10_rules/08a §1)。
   * BSAZ01-C01/C02 のようなトラッシュ起点煌臨 (adventData.adventSourceZone:"trash") の
   * ターン1回:同名 制限を gate する。ターン遷移時にクリアする。
   */
  usedTrashAdventKeysThisTurn: string[];
  /**
   * このターンに発動した〔ターンに1回:同名〕代替コスト煌臨のキー。
   * 形式: "name:{printedName}" (同名共有カウント)。
   * AdventData.alternateCostAdvent を持つカードの〔ターンに1回:同名〕制限を
   * gate する（BSSL01-X01[3]）。ターン遷移時にクリアする。
   */
  usedAlternateCostAdventKeysThisTurn: string[];
  /**
   * このターンに発動した通常 declare_advent の〔ターンに1回:同名〕キー。
   * 形式: "name:{printedName}"。AdventData.declareUsageLimit で opt-in したカードのみ使う。
   */
  usedAdventDeclareKeysThisTurn: string[];
  /**
   * このターン、count-gain メタ修飾 (count_gain_modifier CE) の +N を既に
   * 消費した (受益プレイヤー, 修飾元カード) の組。形式: "{playerId}:{definitionId}"。
   * 〔ターンに1回:同名〕を first-opportunity で消費するためのトラッカー。
   * ターン遷移時にクリアする (BSTS01-C03、10_rules/08a §カウント＋ メタ修飾)。
   */
  countGainModifierConsumedThisTurn: string[];
  /**
   * `additional_attack` (ENGINE-additional-attack-mid-declare-attack-window-risk)
   * で付与された「疲労状態でもアタック宣言できる」一回限り grant。
   * 値は sourceInstanceId (複数回付与時は重複可、1 grant = 1 attack)。
   * `card_event:attack` (declare_attack 窓内) で additional_attack を実行しても
   * 現在進行中のバトルは破棄せず継続させ、代わりにここへ grant を積む。
   * 対象カードは grant を保持する間 exhaustState チェックをバイパスしてアタック宣言でき、
   * 宣言確定時に grant を1つ消費する (`confirmAttackDeclarationAsAction`)。
   * ターン遷移時にクリアする (未消費 grant は同ターン内のみ有効)。
   */
  pendingAdditionalAttackGrants: string[];
  /**
   * このターンに `allow_tapless_battle_declare` CE (BSTH09-C03「ターンに1回、
   * 疲労せずにアタック/ブロックできる」) の疲労遷移スキップを既に消費した
   * sourceInstanceId のリスト。値はカード instanceId (アタック/ブロックいずれか
   * 1 回で消費、両方には使えない同一予算)。ターン遷移時にクリアする。
   */
  usedTaplessBattleDeclareInstanceIdsThisTurn: string[];
  pendingTriggeredEffects: PendingTriggeredEffect[];
  pendingPrivateDeclarations: PendingPrivateDeclaration[];
  /**
   * 同時誘発した private declaration が「発揮する」を選ばれた後、
   * 同 simultaneousGroupId + 同 triggerPriority の他の declaration がまだ宣言処理中の間、
   * pendingTriggeredEffects に入れずにここで保留する。
   * 同優先度グループの最後の declaration が処理(declare/skip いずれか)された時点で、
   * 同 simultaneousGroupId + 同 triggerPriority の deferred 群を pendingTriggeredEffects に flush する。
   *
   * これによりリアルの「同時宣言」を再現し、宣言途中で先行 declaration が
   * declared-from-private な triggered として両プレイヤーの UI に
   * 順次出現する不整合(フォーカスズレ + UX 違和感) を防ぐ。
   *
   * 対象: simultaneousGroupId を持つ declaration から派生した triggered のみ。
   * 単独宣言 (simultaneousGroupId 無し) は従来通り即時 publish。
   */
  pendingDeferredTriggeredEffects: PendingTriggeredEffect[];
  pendingBurstChecks: PendingBurstCheck[];
  pendingLeaveEntities: PendingLeaveEntity[];
  /**
   * mode:summon の逆転醒で B 面から A 面へ新 instance を作った直後だけ使う、
   * 強制分離対象ブレイヴ別の旧 host 疲労 snapshot。離脱置換の
   * pendingBraveLeaveChoice とは別に、通常変換でも Q30232 / Q21697 の
   * 分離時疲労を保つための engine 内部 state である。
   */
  reverseRebirthBraveSeparationExhaustSnapshots?: Record<
    string,
    CardInstance["exhaustState"]
  >;
  /** 合体スピリット破壊時のブレイヴ選択待ち。 */
  pendingBraveLeaveChoice: PendingBraveLeaveChoice | null;
  /** @deprecated 旧スナップショット/棋譜互換用。新しい対戦では常に null。 */
  pendingBraveAttackContinuation: PendingBraveAttackContinuation | null;
  /** 契約カードの魂状態置換選択待ち。選択中はフラッシュ不可。 */
  pendingSoulStateReplacement: PendingSoulStateReplacement | null;
  /** 離脱カードを煌臨元に追加するか/トラッシュかの選択待ち。選択中はフラッシュ不可。 */
  pendingAdventSourceReplacement: PendingAdventSourceReplacement | null;
  /** 手元カードの自己除外置換 (move_to) 選択待ち。選択中は除外アクションの残りが停止する。 */
  pendingSetAsideExitReplacementChoice: PendingSetAsideExitReplacementChoice | null;
  /** 転醒内蔵 postRebirthChoice の合体/コア配置選択待ち。 */
  pendingStoneFlipCombine: PendingStoneFlipCombine | null;
  pendingDeckReveal: PendingDeckReveal | null;
  /**
   * moved_to_trash の任意手札追加（「加えられる」= 任意効果）の発火待ちキュー。
   *
   * 「トラッシュに置かれたとき手札に加えられる」は誘発効果であり、置いた効果（ソース効果）が
   * 完全に解決した後に発揮される。そのため move プリミティブ内で即座に `pendingDeckReveal` を
   * 生成すると、ソース効果（例: BSTH01-R05 アクセルの 2 ステップ目=コア取得）が中断されてしまう。
   * これを避けるため、optional 候補は一旦本フィールドに退避し、他の pending が無い安定点で
   * `materializeDeferredTrashOptionalAdds` が `pendingDeckReveal`(origin="trash") に変換する。
   * mandatory な moved_to_trash 効果は従来どおり move プリミティブ内で即時適用される。
   */
  pendingTrashOptionalAdds: TrashOptionalAddEntry[];
  pendingZoneSelection: PendingZoneSelection | null;
  /**
   * step.executionMode === "optional" のステップに到達したときの execute/decline 選択待ち。
   * 立っている間は effect 解決を中断し、解決後に executeEffect を `startFromStepIndex` で再開する。
   * 正源: model.ts §PendingStepOptionalChoice。
   */
  pendingStepOptionalChoice: PendingStepOptionalChoice | null;
  /**
   * EffectStep.choice の分岐選択待ち。神技など宣言後スタック窓を閉じてから本文分岐を選ぶ
   * 効果で使う。
   */
  pendingStepChoice: PendingStepChoice | null;
  /**
   * `grant_optional_deck_reveal_count_boost` CE 保持プレイヤーが、対象の `deck_reveal` step
   * 実行直前に+1適用可否を選ぶ選択待ち。立っている間は effect 解決を中断し、解決後に
   * executeEffect を `continuation.stepIndex` から再開する。
   * 正源: model.ts §PendingDeckRevealCountBoostChoice。
   */
  pendingDeckRevealCountBoostChoice: PendingDeckRevealCountBoostChoice | null;
  /**
   * optional step の execute resume で、step 自身が独自 target を要する場合の対象選択待ち。
   * 立っている間は effect 解決を中断し、解決後に executeEffect を `targetInstanceIds` +
   * `targetStepId` 注入付きで `startFromStepIndex` から再開する。
   * 正源: model.ts §PendingStepOptionalTargetSelection。
   */
  pendingStepOptionalTargetSelection: PendingStepOptionalTargetSelection | null;
  /** `connector:"after_triggers"` が誘発サブチェーン完了まで後続 step を保留する内部 continuation。 */
  pendingAfterTriggersContinuations: PendingAfterTriggersContinuation[];
  /** 通常の派生効果・内部の発揮後が閉じるまで保留する「その効果発揮後」。 */
  pendingEffectCompletions: Extract<
    PostResolutionOracleTrigger,
    { triggerKind: "effect_activated" }
  >[];
  /**
   * 同一イベントで複数 retrigger が一致し、autoResolveOptional:false の任意 step で
   * 解決が中断した場合の残り retrigger キュー。optional 解決後に同一イベント文脈で再開する。
   */
  pendingRetriggerContinuations: PendingRetriggerContinuation[];
  /**
   * deck_reveal の per-pick 「手札/手元と入れ替え」を解決するための pending zone selection 待機列。
   *
   * - 1 pick = 1 エントリ。複数 pick がそれぞれ swap を必要とする場合は順次 emit する。
   * - 1 件目は `pendingZoneSelection` として即時 emit、残りは本フィールドに退避し、
   *   各解決後に先頭を dequeue して emit する。
   * - 空配列 = 残 swap なし。
   *
   * 正源: 10_rules/07b §BSTH09-C04/C05「手札/手元と入れ替えられる」(裁定 2026-06-17)。
   */
  pendingDeckRevealSwapChain: PendingZoneSelection[];
  /**
   * コスト先払い型ドロー枚数修正の任意コスト支払い判断待ち（BSSL01-C03 等）。
   * 立っている間ドローステップは中断され、解決後にシステムドローを bonus 付きで行う。
   * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正（裁定 2026-06-15, model A）。
   */
  pendingDrawStepCostChoice: PendingDrawStepCostChoice | null;
  /**
   * 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』の可変枚数コスト選択待ち
   * （BSTH02.7-M01 effects[0] 等）。立っている間は当該 sourceInstanceId の召喚が中断され、
   * 解決（除外枚数確定）後に additionalCostModifiers 付きで即座に summon を実行する。
   * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正（model A）と同型の pre-cost 選択。
   */
  pendingSummonCostExcludeChoice: PendingSummonCostExcludeChoice | null;
  /**
   * 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを
   * 支払わずに召喚する』代替コスト支払いの選択待ち（BSSL01-M02 effects[0,1]）。立っている間は
   * 当該 sourceInstanceId の召喚が中断され、解決（移動コア数+移動先確定）後に
   * additionalCostModifiers 付きで即座に summon を実行する。
   * `PendingSummonCostExcludeChoice` とは支払いの実体が異なる（カード除外ではなくコアの
   * ゾーン移動）ため別 pending にした。正源: model.ts §PendingSummonCostCoreMoveChoice。
   */
  pendingSummonCostCoreMoveChoice: PendingSummonCostCoreMoveChoice | null;
  /**
   * 複数対象召喚のグループ化コストオーバーライド選択待ち（BSTH02.7-C06 branch2 等）。
   * 正源: model.ts §PendingGroupedSummonCostOverrideChoice。
   */
  pendingGroupedSummonCostOverrideChoice: PendingGroupedSummonCostOverrideChoice | null;
  /**
   * ライフダメージ発生時の破棄コストゲート選択待ち（`life_damage_interception`
   * の `discardCostGate` 付き CE、BSTH02.7-C05[1] 等）。
   * 立っている間はダメージ解決（resolveLifeDamage）を中断し、解決
   * （支払い=破棄して防ぐ / 辞退=通常通り受ける）後に damage を確定させる。
   * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正と同じ「プレ判断モデル」を
   * 適用（コスト→効果確定→システム処理）。
   */
  pendingLifeDamageDiscardChoice: PendingLifeDamageDiscardChoice | null;
  /**
   * 「自分の効果で自分のライフが増えるとき、増やす代わりに[代替アクション]できる」
   * (`life_gain_replacement` CE、BSTH02.7-X03 effects[3]) 一致時の任意選択待ち。
   * 立っている間は元の core_move (ライフ増加) を中断し、解決 (replace=相手のライフの
   * コア1個をトラッシュに置き増加をキャンセル / decline=通常通り増やす) 後に確定させる。
   */
  pendingLifeGainReplacementChoice: PendingLifeGainReplacementChoice | null;
  pendingCoreShootSelection: PendingCoreShootSelection | null;
  /**
   * 効果の対象選択待ち (種別非依存)。
   * ルール正源: 03a_cost-payment.md の標準パイプライン (2.コスト支払い → 3.対象の選択)
   * + 02_turn-flow-and-timing.md「コスト支払い完了後に窓が開く」。スタック窓はコスト
   * 支払い後・対象選択前に開くため、対象は窓クローズ後の解決時 (本 pending) に選ぶ。
   * deferredStack に解決を再開するための ActiveStack を、remainingStacks にカスケード
   * 残りを保持する。
   */
  pendingEffectTargetSelection: PendingEffectTargetSelection | null;
  pendingAsIfSoulCoreChoice: PendingAsIfSoulCoreChoice | null;
  /** optional repeat の「追加発揮する/しない」をスタック窓後に選ぶ pending。 */
  pendingEffectOptionalRepeatChoice: PendingEffectOptionalRepeatChoice | null;
  /** optional repeat の追加カウント減少数を、本文実行前に仮選択する pending。 */
  pendingEffectOptionalRepeatCountSelection: PendingEffectOptionalRepeatCountSelection | null;
  /** card_event 効果借用で、同一借用元に複数候補がある場合の効果1つ選択待ち。 */
  pendingBorrowedEffectChoice: PendingBorrowedEffectChoice | null;
  /** card_event 効果借用で、借用効果本体が対象選択を要求する場合の対象選択待ち。 */
  pendingBorrowedEffectTargetSelection: PendingBorrowedEffectTargetSelection | null;
  /**
   * P3-76: 効果対象が確定した直後、対象側の「相手の効果の対象になるとき」誘発を
   * 解決するために効果本体を中断している continuation。
   */
  pendingTargetedDisclosureContinuation: TargetedDisclosureContinuation | null;
  /**
   * 「相手はコア1個をトラッシュに置かなければフラッシュ/スタック効果を発揮できない」
   * (gate_flash_stack_core。BSTS01-M03) の発揮前提コア除去待ち。フラッシュ/スタック効果の
   * 解決直前 (対象選択前) に立て、コア除去 or 辞退を待ってから解決を再開する。
   */
  pendingPayToActCoreGate: PendingPayToActCoreGate | null;
  /**
   * 「相手は手札N枚を破棄しなければフラッシュ/スタック効果を発揮できない」
   * (gate_flash_stack_hand_discard) の発揮前提手札破棄待ち。
   */
  pendingPayToActHandDiscardGate: PendingPayToActHandDiscardGate | null;
  /**
   * 「自分が[tribeFilter]を持つマジックカードを使用するとき、そのコストを支払う前に、
   * ただちに[triggerEffectIndex]の効果を使用できる」(offer_magic_pre_cost_trigger CE。
   * BSAZ01-C12「戦力投入」) の発揮可否待ち。use_magic 宣言時にコスト支払いより前に立て、
   * decline/trigger の解決 (+ trigger 時は C12 の通常使用・解決完了) を待ってから、
   * 中断元の支払いを現在の盤面で再提示する。
   */
  pendingFieldMagicPreCostTrigger: PendingFieldMagicPreCostTrigger | null;
  /** 通常召喚/配置のスタック解決後、維持コア選択を待つ */
  pendingEnterFieldPlacement: PendingEnterFieldPlacement | null;
  /**
   * P3-86 案X: スタック窓クローズ後のカスケード解決を「発揮前無効化誘発」(咲夜 BSTH01-X05)
   * の declare/skip 決定待ちで中断したときの残スタック。declare で対象 ActiveStack に
   * isNullified 印を立て、宣言が消化されたら remainingStacks で `resolveStackCascade` を再開する。
   * 発揮前チェックポイント (対象フラッシュの発揮直前) を表現する。
   */
  pendingStackCascade: {
    remainingStacks: ActiveStack[];
    /**
     * 誘発解決まで本体効果を再開しない cascade。P3-73 flash-use nullify は declare 時点で
     * 対象スタックに印を立てるため、このフラグを付けず従来通り即再開する。
     */
    waitForTriggeredEffects?: boolean;
  } | null;
  /**
   * P3-97: `resolveStackCascade` のローカル `workingStacks` 解決中だけ、
   * pendingLeave flush 判定へ未解決 ActiveStack を見せる一時 guard。
   * `pendingStackCascade` と違い、汎用 continuation gate ではなく registered
   * stay_on_field leave reaction の検出だけに使う。
   */
  pendingStackCascadeFlushGuardStacks?: ActiveStack[];
  /**
   * P3-75: `negate` 解決がスタックカスケード中の後続 ActiveStack を無効化するための
   * 一時キュー。`resolveStackCascade` が対象 stack へ `isNullified` を付けたら消費する。
   */
  pendingStackNegateRequests: PendingStackNegateRequest[];
  /** ブレイヴ召喚のスタック解決後、「合体する/スピリット状態」選択を待つ */
  pendingBraveCombineChoice: PendingBraveCombineChoice | null;
  /** 手札/手元⇔トラッシュの1対1入替選択待ち（engine-atomic-hand-trash-swap-legal-action） */
  pendingHandTrashSwapChoice: PendingHandTrashSwapChoice | null;
  /** フィールドの発動元カード⇔手札カードの1対1入替選択待ち */
  pendingFieldHandSwapChoice: PendingFieldHandSwapChoice | null;
  /** 転召（召喚手順内ステップ）のスタック解決後・場入り前、強制コア消費の対象選択を待つ */
  pendingTenshoSummon: PendingTenshoSummon | null;
  /** 逆転醒 pattern2（裏返して配置/召喚）の、支払いソース + 維持コア配置の選択待ち（P3-98） */
  pendingReverseRebirthSummon: PendingReverseRebirthSummon | null;
  /** core_move splitDestinations によるリザーブ/トラッシュ等の配分選択待ち */
  pendingCoreSplitSelection: PendingCoreSplitSelection | null;
  /**
   * split_field_entry_choice action の分配選択待ち（ENGINE-sequential-slot-choice、
   * BSSL01-X01[5,6]「対象ごとに独立してトークンを出す or 通常召喚を選べる」）。
   */
  pendingSplitSummonChoice: PendingSplitSummonChoice | null;
  /** P3-88: 「コアN個まで」(amount {min,max} 単一移動先) の数選択待ち */
  pendingCoreCountSelection: PendingCoreCountSelection | null;
  /**
   * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: count_decrease の
   * amount が {min,max}（「好きなだけ減らせる」型）のときの数選択待ち。
   * PendingCoreCountSelection と同型パターン（コア資源ではなくカウント資源）。
   */
  pendingCountSelection: PendingCountSelection | null;
  /**
   * ENGINE-composite-heterogeneous-removal-budget: discard_set_burst の count が
   * {min,max}（「バーストN個まで」型）のときの数選択待ち。
   * PendingCountSelection と同型パターン（対象は discard_set_burst 実行）。
   */
  pendingDiscardSetBurstCountSelection: PendingDiscardSetBurstCountSelection | null;
  /**
   * ライフ → 任意先のコア移動で通常/ソウル混在時の持ち主選択待ち
   * (ENGINE-core-move-from-life-owner-soul-choice deep mode)。
   * iteration 1: foundation 配置のみ (interpreter 検出/解決は未配線、null 固定)。
   */
  pendingLifeCoreSelection: PendingLifeCoreSelection | null;
  /** field_card ソースのコアコスト支払い配分プレイヤー選択待ち (BSTH05-C11/C12 等) */
  pendingCoreSourceAllocation: PendingCoreSourceAllocation | null;
  /** 効果文内 summon のコスト支払い元プレイヤー選択待ち */
  pendingEffectSummonCostPayment: PendingEffectSummonCostPayment | null;
  /** 【リンクエイド】の効果文内コスト支払い元プレイヤー選択待ち */
  pendingLinkAidCostSourceChoice: PendingLinkAidCostSourceChoice | null;
  /** トラッシュ→フィールドのコア配分プレイヤー選択待ち（BSTH01-M01 等） */
  pendingCoreDistribution: PendingCoreDistribution | null;
  /** P3-49: 複数体同時召喚の per-target 配置選択待ち */
  pendingMultiPlacement: PendingMultiPlacement | null;
  /**
   * P3-47 F-4: 効果対象リダイレクト プロンプト待ち。
   * `redirect_effect_target` CE の triggerCondition がマッチした効果の解決を一時停止して
   * 対象差し替えの選択を CE owner に求める。複数の redirect が同時にマッチする場合は
   * 配列に複数個 push される (現状は本体が場に複数存在するケース等)。
   */
  pendingTargetRedirects: PendingTargetRedirect[];
  /** チェンジ効果発揮後の「破棄 or 入れ替え」選択待ち (08b §5)。 */
  pendingChangeCleanupChoice: PendingChangeCleanupChoice | null;
  /**
   * アクセル使用後のカード移動待ち。アクセルは派生効果と破壊/消滅待機の flush 後に
   * 手元へ置くため、同一 chain の pending trigger / pending leave が残る場合だけ遅延する。
   */
  pendingAccelCleanups?: PendingAccelCleanup[];
  /**
   * `timing.deferredTo === "battle_end"` の効果を「このバトル終了時」まで退避する予約キュー。
   * 発揮宣言時 (バトル中) に積み、当該バトルの解決完了時に発火・除去する。
   */
  pendingBattleEndDeferrals: PendingBattleEndDeferral[];
  /**
   * `ExhaustAction.downgradeAtTurnEnd` の予約キュー。`finishEndStepEffects`
   * (turn-system.ts) が end-step cleanup 時に無条件で消化・クリアする。
   */
  pendingTurnEndExhaustDowngrades: readonly PendingTurnEndExhaustDowngrade[];
  pendingImmediateBattleEnds: readonly PendingImmediateBattleEnd[];
  /** ENGINE-battle-connect-repeat: 連続バトル続行/終了の選択待ち。10_rules/05c_connect-battle.md */
  pendingConnectBattleDecision: PendingConnectBattleDecision | null;
  pendingAttackStepEndFinalizations: readonly PendingAttackStepEndFinalization[];
  pendingTurnEndFinalizations: readonly PendingTurnEndFinalization[];
  /**
   * ENGINE-battle-end-pending-triggered-vs-scope-battle-ce: `queueBattleEndTriggers` で
   * 積んだ battle_end 由来 `pendingTriggeredEffects` が残っている attackId の一覧。
   * `finalizeBattleEndScopeExpirations` (scope:"battle" CE 失効) は、当該 attackId の
   * pendingTriggeredEffects が尽きるまでここに予約されて遅延する
   * (`maybeFinalizeBattleEndScopeExpirations` が pendingTriggeredEffects の drain 時に発火判定する)。
   */
  pendingBattleEndFinalizeAttackIds: readonly string[];
  activeContinuousEffects: ContinuousEffect[];
  effectUsageRecords: EffectUsageRecord[];
  /**
   * 「ターンにN回目の観測でのみ発火する」型 (BSLH01-C05/R03 quartz set-effect 等) の
   * 累積 occurrence tally。`effectUsageRecords` (発動/宣言時にのみ加算) とは別軸で、
   * トリガー条件の検出成功のたび (発動可否に関わらず) 加算する。
   * レコード shape は `EffectUsageRecord` を再利用 (duration スコープ判定の SSOT 共有)。
   * 正源: ENGINE-nth-occurrence-trigger-gate。
   */
  effectOccurrenceRecords: EffectUsageRecord[];
  effectQueueEntries: EffectQueueEntry[];
  effectQueueSummary: string[];
  /** 公開情報通知・ログの構造化正源。旧 snapshot 互換のため未指定は空配列として扱う。 */
  publicDisclosures?: PublicDisclosure[];
  /** サニタイズ済み viewer の匿名スロット（旧 snapshot も読取可）。内部状態には保存しない。 */
  knownDeckCards?: KnownDeckCard[];
  illegalBurstRevealPlayerId: string | null;
  gameResult: GameResult | null;
  /** 同一原因の転醒済み窓。ログを除いた保存状態でも排他を保持する。 */
  resolvedRebirthTimingWindowIds?: string[];
  log: string[];
  /**
   * 現在適用中の legal action 開始時点の log 長。「転醒は同時に使えない」の
   * 同一タイミング判定窓（= 1 action 適用）に使う transient。applyLegalAction が
   * 入口で設定する。未設定（action 経由でない直呼び）は全 log 走査に fallback。
   */
  actionStartLogIndex?: number;

  /**
   * P3-108 Item3 (Stage 3, endLog 早期化の最小対処): mid-effect 継続でプレイヤー入力待ちに
   * 中断した効果解決の endLogs (`<kind>:resolve-main:end:<chainId>` 等) を、効果が真に閉じる
   * まで退避する transient キュー。`runActionMainResolution` が中断検知時に stash し、
   * `applyLegalAction` が継続なし (= 効果完了) で drain して log へ流す。誘発収集・神託の
   * タイミングには触れず、endLog 表示順だけを正す。未設定 (旧セーブ/直呼び) は空扱い。
   */
  pendingResolutionEndLogs?: string[];

  /** ターン内の相手効果によるライフ減少累積 (プレイヤーID → 累積量)。ターン遷移時にリセット。 */
  effectLifeReductionThisTurn: Record<string, number>;

  /**
   * ターン内の宣言ギミック累積回数 (プレイヤーID → 累積回数)。BSLH01「エンジョ〜イ、
   * みっしぃ！」正源: 「〇〇と宣言することで」型カードテキストを単発 optional cost の
   * 近似ではなく、他カード効果から参照可能な累積として扱う汎用 primitive
   * (`DSL.DeclareGimmickAction`, `executeDeclareGimmick`)。ターン遷移時にリセット。
   */
  declarationCountThisTurn: Record<string, number>;

  /**
   * ターン内の**全原因**ライフ減少累積 (プレイヤーID → 累積量)。バトル／効果／その他を
   * 合算し、ターン遷移時にリセットする。「このターン、自分のライフは N しか減らない」
   * (life_damage_interception mode:"turn_cap") のターン累積上限判定に使う
   * (10_rules/05 §ライフ減少の上限キャップ、裁定 2026-06-15)。旧セーブ互換のため optional。
   */
  lifeReductionCappedThisTurn?: Record<string, number>;

  /**
   * ターン内の**フィルタ付き turn_cap** ライフ減少累積
   * (`${protectedPlayerId}:${continuousEffectId}` → 累積量)。`life_damage_interception`
   * mode:"turn_cap" に attackerFilter / attackerInstanceIds が付く型で使い、一致する
   * 発生源由来のライフ減少を CE/filter バケット単位でターン合計 `cap` に頭打ちする。
   * 無印 turn_cap の player-wide 累積とは独立し、ターン遷移時にリセットする。
   * 旧セーブ互換のため optional。
   */
  filteredLifeReductionCappedThisTurn?: Record<string, number>;

  /**
   * ターン内の**BP 閾値以下アタッカー由来のバトルライフ減少**累積 (プレイヤーID → 累積量)。
   * 「BP6000 以下のスピリット/アルティメットのアタックでは、自分のライフは 1 ターンに
   * 2 以上減らない」(BSTH08.5-C21) 型の per-attacker-BP gate cap 判定に使う。基底
   * `lifeReductionCappedThisTurn` (mode:"turn_cap" 全原因合算) とは独立トラックで、閾値
   * 超え (>BP) や非バトル由来は枠外で無制限 (10_rules/05 §ライフ減少の上限キャップ、
   * 裁定 2026-06-16)。ターン遷移時にリセット。旧セーブ互換のため optional。
   */
  bpThresholdCappedLifeReductionThisTurn?: Record<string, number>;

  /**
   * `life_damage_interception` の `declareGimmickGate` が「ターンに1回」を消費済みかの
   * フラグ (`${protectedPlayerId}:${continuousEffectId}` → true)。BSLH01-C12
   * 【ミシュラムワンダーランド】: discardCostGate と異なりカードがゾーンを離れて
   * 自然消滅する仕組みが無いため、明示的な使用済みフラグで「ターンに1回」を管理する。
   * ターン遷移時にリセット。旧セーブ互換のため optional。
   */
  declareGimmickGateUsedThisTurn?: Record<string, boolean>;

  /**
   * `life_damage_interception` の `useCostGate` が今ターン中に支払われた（このカードが
   * コスト無しで使用された）かのフラグ (`${protectedPlayerId}:${sourceInstanceId}` →
   * true)。BSLH01-M05[1]。同名カードの他 effect が
   * `life_damage_interception_use_cost_gate_paid_this_turn` ConditionClause でこれを
   * 参照し、「このカードの効果で使用していたとき」型の条件無視を表現する。同名の
   * 別カードへ波及させないため definition 単位ではなく card instance 単位とする。
   * ターン遷移時にリセット。旧セーブ互換のため optional。
   */
  lifeDamageInterceptionUseCostGateUsedThisTurn?: Record<string, boolean>;

  /**
   * ターン内の**制限付きシンボル追加**累積 (`${restrictedPlayerId}:${continuousEffectId}` →
   * 累積個数)。`restrict_symbol_addition` CE (「(対象プレイヤーは)スピリット/アルティメットの
   * 効果で合計でN個以上シンボルを追加できない」BSTH03-C04 effects[2]) の cap 判定に使う。
   * ターン遷移時にリセット。旧セーブ互換のため optional。
   */
  symbolAdditionRestrictedCountThisTurn?: Record<string, number>;

  /**
   * このターン中に終了したバトル数 (P2-05 Phase 4b)。バトル解決完了
   * (`battle:end`) ごとに +1、ターン遷移時に 0 リセット。
   * 「ターンの最初のバトル終了時」(force_attack_step_end_after_first_battle CE)
   * の判定に使う。旧セーブデータ互換のため optional (未設定 = 0)。
   */
  battlesEndedThisTurn?: number;

  /**
   * 現在のアタックステップで終了したバトル数。追加アタックステップを含めて
   * アタックステップ開始時に 0 へ戻す。「このステップの最初のアタック」の
   * 判定に使う。旧セーブデータ互換のため optional (未設定 = 0)。
   */
  battlesEndedThisAttackStep?: number;

  /**
   * アタックステップ中の召喚履歴。ターン境界でリセットする。
   * 途中参加の選択権は pendingImmediateAttackJoins で別に管理し、この履歴だけでは与えない。
   * 旧セーブデータ互換のため optional (未設定 = 空)。
   */
  summonedDuringAttackStepInstanceIds?: string[];
  /** 召喚から派生する処理を終えた直後だけ選べる途中参加。履歴とは別に消費する。 */
  pendingImmediateAttackJoins?: {
    attackId: string;
    sourceInstanceId: string;
  }[];

  /**
   * このターン中に各プレイヤーが召喚したカードのスナップショット。召喚後に場を離れても
   * 「自分が召喚した」事実と召喚時点の実効色/カテゴリ/系統を参照できるよう保持する。
   * ターン遷移時にリセット。旧セーブデータ互換のため optional (未設定 = 空)。
   */
  turnSummonedCardRefs?: TurnSummonedCardRef[];

  /** 効果ドロー追跡。collectTriggerEventsFromStateDelta で after_draw イベントに変換・消費される。 */
  pendingDrawEvents?: { playerId: string; amount: number }[];

  /**
   * フラッシュ効果の「カードの使用」履歴。独自拡張「フラッシュ効果使用後以外で」系条件の参照元。
   * push タイミング: playMagicCardAsAction の cost 支払完了時（chosenTiming === "flash"）。
   * 打ち消し/無効化された使用も履歴に残す（裁定 2026-04-16）。
   * ゲーム終了まで累積し、scope ("step"/"battle"/"turn"/"game") はクエリ時に時点比較でフィルタする。
   */
  flashCardUsageLog: FlashCardUsageLogEntry[];

  /**
   * フラッシュ効果の「効果の発揮」履歴。カードの使用とは別軸で追跡する。
   * push タイミング: activated flash 効果の step 実行開始時。
   * 打ち消し/無効化された発揮も履歴に残す（裁定 2026-04-16）。
   */
  flashEffectActivationLog: FlashEffectActivationLogEntry[];

  /**
   * スピリット/アルティメットのアタック宣言履歴。「自分の系統：○○を持つスピリットが
   * アタックしたとき、下の効果を発揮できる」型の発揮解禁ゲート (`attack_occurred`
   * ConditionClause) の参照元。push タイミング: queueBattleDeclarationTriggers で
   * kind:"attack" イベントを検出した時点 (通常のアタック宣言 + 途中合流アタック)。
   * flashCardUsageLog と同様、ゲーム終了まで累積し scope はクエリ時にフィルタする。
   */
  attackDeclarationLog: AttackDeclarationLogEntry[];

  /**
   * 【セット中】(ミラージュ/バースト) 効果由来のドロー履歴。「このターン、自分がミラージュ効果で
   * ドローしていなければ」型の排他ゲート (`mirage_draw_occurred` ConditionClause) の参照元
   * (BSGE01-C03/C10 初出)。push タイミング: draw action 実行時、発揮元カードが mirage ゾーンに
   * 滞在中で実際に1枚以上ドローが成立したとき (executeDraw 内、attackDeclarationLog と同様に
   * ゲーム終了まで累積し scope はクエリ時にフィルタする)。
   */
  mirageSetDrawLog: MirageSetDrawLogEntry[];

  /** プレゲーム状態（じゃんけん・マリガン）。ゲーム開始後は null */
  preGame?: PreGameState | null;

  /** ルームのリセット申請。旧ルームで未設定なら第0ゲーム・双方未使用。 */
  roomReset?: {
    /** 承認または終局後の再戦で増加し、クライアントの対戦内表示も初期化する。 */
    gameNumber: number;
    requestedBy: string | null;
    usedBy: string[];
  };

  /**
   * Viewer-sanitized state only: preserves "someone must finish a pending UI
   * prompt" without exposing the hidden prompt payload to the other player.
   */
  pendingPromptLock?: PendingPromptLock | null;

  /**
   * P3-63: BSTH02-M01「[妖々夢]十六夜 咲夜」等の追加ターン効果用。
   *
   * - `null` 通常時 (追加ターン中ではない)
   * - 値ありのとき: 現在進行中の追加ターン情報。
   *   - `skipSteps`: 追加ターン中にスキップするステップ (coreStep/attackStep 等)
   *   - `returnContext`: 追加ターン取得時の元 (中断中) ターン状態のスナップショット。
   *     追加ターン終了時に復帰する。BSTH02-M01 は『相手のアタックステップのバトル中に戻る』
   *     ため、対応する `turnNumber` / `activePlayerId` / `step` / `window` / `activeAttack` を保持。
   */
  extraTurnState?: ExtraTurnState | null;

  /**
   * ENGINE-extra-turn-step-insertion: 同一ターン内で明示的に指定したステップを強制挿入する
   * FIFO キュー（BSLH01-X01【導技：7】「このステップ終了後、自分は、リフレッシュステップと
   * アタックステップを1回ずつ行える」等）。`extraTurnState`（ターン全体の追加取得、
   * スタートステップへジャンプ）とは異なり、こちらは**現在のターンを離れずに**指定した
   * ステップだけを STEP_ORDER の通常サイクルへ割り込ませる（メインステップ等の中間ステップは
   * 挟まない。原文が明示するステップのみを厳密に辿る）。
   * 現在のステップ終了時効果を解決してから消費する。挿入前の続きは
   * `stepContinuation` に保存し、追加された最後のステップから通常順を再計算しない。
   */
  pendingExtraSteps?: readonly Step[];

  /** 追加ステップの残りと、挿入前に予定されていた次ステップ。入れ子の挿入も先頭へ積む。 */
  stepContinuation?: readonly Step[];

  /** 現ターン終了後に1回行う追加ターン。同一ターンの重複予約は加算しない。 */
  pendingExtraTurn?: {
    ownerPlayerId: string;
    skipSteps: readonly Step[];
  } | null;

  /**
   * BSLH01-C07「ターンの最初の…【ソウルドライブ・S】でフィールドを離れる相手のスピリット/
   * アルティメットはフィールドに残せない」用の橋渡しフラグ
   * (ENGINE-soul-drive-departure-prevention-immunity)。
   * `executeEffect` が `soulDriveConsumption` を消費した効果の `sourceInstanceId` を保持し、
   * その `executeEffect` 呼び出しが (内部の `after_triggers` 連鎖含め) 完全に return する時点で
   * 自分自身の instanceId だけを取り除く (`finalizeEffectResolution` 呼び出し元 25 箇所超へ
   * 新規オプションを個別配線せず、GameState 経由の単一 producer/consumer に閉じるための SSOT
   * 選択)。`runStateBasedActions` はコア不足消滅 (`vanish_due_to_core_deficit`) の
   * `PendingLeaveEntity` 生成時、`causedByEffectSourceInstanceId` がこの配列に含まれる限り
   * (1回限りではなく) 何度でも `preventStayOnField` へ反映する — 単一の【ソウルドライブ・S】
   * 発動が複数対象 (X09 の Lv2/Lv3 型、対象ごとに個別 `after_triggers`) を及ぼす場合に、
   * 最初の対象だけでなく全対象へ一様に適用するため。boolean 単発フラグ + 呼び出し毎クリアだと
   * 2 体目以降の `after_triggers` 呼び出し時点で既にクリア済みとなり貫通が抜け落ちる
   * (adversarial verifier で実測、BSLH01-X09 Lv2 で再現)。
   * destroy 経路は action 単位で `sourceInstanceId` 一致を直接判定するため専用配線は不要。
   * 前提: 対象カードの選択が `executeEffect` 呼び出し内で（`on_step` 等の中断を挟まず）
   * 同期的に完結するカードのみ正しく機能する。現状の適用対象 (X09/X10) はいずれも該当。
   */
  pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds?: readonly string[];

  /**
   * ENGINE-opponent-turn-skip (BSAZ01-C03「相手は次のターンを行えない」)。
   * `skip_next_turn` action (dsl-types.ts DSL.SkipNextTurnAction) が積んだ playerId の
   * FIFO 配列。end→start 遷移 (turn-system.ts advanceFromEndStep) で計算した
   * `nextPlayerId` がここに含まれる場合、そのプレイヤーの番を1回飛ばしてさらに次の
   * プレイヤーへ進め、消費したエントリだけをこの配列から取り除く。
   */
  pendingTurnSkips?: readonly string[];
}

/**
 * P3-63: 追加ターン中の状態。GameState.extraTurnState から参照される。
 */
export interface ExtraTurnState {
  /** 追加ターン取得者 (このターン進行中のプレイヤー)。 */
  ownerPlayerId: string;
  /** 追加ターン中スキップするステップ。 */
  skipSteps: readonly Step[];
  /** 終了後に本来開始するプレイヤー。追加ターン所有者から逆算しない。 */
  nextPlayerId?: string;
  /**
   * 効果の解決中に別の応答窓が開いていたため、追加ターン本体の開始を
   * その窓と残り cascade の解決後まで遅延している。
   *
   * この間も `extraTurnState` は予約を表すが、現在の turn / active player は
   * まだ元の状態を保つ。開始時には安定化済みの盤面を returnContext として
   * 取り直すため、途中の stack window を復帰先へ持ち越さない。
   */
  deferredStart?: true;
  /**
   * 追加ターン終了時に復帰する元ターン状態。`null` の場合は通常通り次ターンへ進む
   * (BSTH02-M01 は `previous_attack_battle` 復帰のため返却必須)。
   */
  returnContext: {
    turnNumber: number;
    activePlayerId: string;
    step: Step;
    window: Window;
    activeAttack: ActiveAttack | null;
    /** 復帰先ターンでそれまでに召喚済みだったカード履歴。旧セーブ互換のため省略可。 */
    turnSummonedCardRefs?: TurnSummonedCardRef[];
    turnContext?: import("./turn-context").TurnContext;
    extraTurnState?: ExtraTurnState | null;
    effectUsageRecords?: EffectUsageRecord[];
    effectOccurrenceRecords?: EffectUsageRecord[];
    suspendedContinuousEffects?: ContinuousEffect[];
  } | null;
}

/**
 * main/flash/stack 効果の「カードの使用」履歴エントリ。
 * 使用タイミング＝コスト支払完了時（コスト 0・能力起動時も同扱い）。
 */
export interface FlashCardUsageLogEntry {
  chainId: string;
  playerId: string;
  cardInstanceId: string;
  cardDefinitionId: string;
  turnNumber: number;
  step: Step;
  /** バトル中の使用なら attackId、それ以外は null。scope="battle" で参照。 */
  attackId: string | null;
  /** 使用種別。未設定 (旧データ/既存テスト) は "flash" 扱い。 */
  mode?: "main" | "flash" | "stack" | "play";
  /** "completed" は効果本体と派生効果まで解決済みの使用履歴。未設定は宣言済み扱い。 */
  completion?: "declared" | "resolving" | "completed";
  /** 場入りの再収集による重複使用を避ける解決区間・場の個体識別子。 */
  resolutionKey?: string;
  /** 同じ効果で同時に使用したカードを1回の誘発としてまとめる。 */
  usageGroupId?: string;
}

/**
 * フラッシュ効果の「効果の発揮」履歴エントリ。
 * 発揮タイミング＝ activated flash 効果の step 実行開始時（usage_limit 消費と同タイミング）。
 */
export interface FlashEffectActivationLogEntry {
  playerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 同一カード内で複数の flash effect を区別する。Effect[] 配列内のインデックス。 */
  effectIndex: number;
  turnNumber: number;
  step: Step;
  /** バトル中の発揮なら attackId、それ以外は null。scope="battle" で参照。 */
  attackId: string | null;
}

/**
 * スピリット/アルティメットのアタック宣言履歴エントリ。
 * push タイミング＝ queueBattleDeclarationTriggers が kind:"attack" イベントを検出した時点
 * (通常のアタック宣言 + 途中合流アタックの主体側)。cardFilter 照合は flash_used と同様、
 * クエリ時に cardInstanceId/cardDefinitionId から現在の実効系統/状態を引き直して評価する
 * N回目のバトルを判定する場合だけ、実効系統は宣言時点の値を使う。
 */
export interface AttackDeclarationLogEntry {
  playerId: string;
  cardInstanceId: string;
  cardDefinitionId: string;
  /** 宣言時の実効系統。N回目のバトル判定は後から系統が変化しても巻き戻さない。 */
  effectiveTribesAtDeclaration?: string[];
  turnNumber: number;
  step: Step;
  /** バトル中の宣言なら attackId、それ以外は null。scope="battle" で参照。 */
  attackId: string | null;
  /**
   * 指定アタックの対象カード (ActiveAttack.designatedTargetInstanceId をスナップショット)。
   * 指定アタックでない通常のアタック宣言、または既存 (本フィールド追加以前の) テスト構築の
   * literal では省略され得るため optional。`attack_occurred.targetFilter` の参照元。
   */
  designatedTargetInstanceId?: string | null;
  /** 対象カードの定義ID (対象が後で場を離れても targetFilter 照合できるようスナップショット)。 */
  designatedTargetDefinitionId?: string | null;
  /**
   * 指定アタック対象カードのコントローラーのライフコア数を宣言時点でスナップショットする
   * (`attack_occurred.targetControllerLifeAtDeclaration` の参照元)。宣言後にライフが
   * 増減しても後続ステップでの判定は宣言時点の値を使う。指定アタックでない宣言は null。
   */
  designatedTargetControllerLifeAtDeclaration?: number | null;
}

/**
 * 【セット中】効果由来ドロー履歴エントリ。push タイミング＝ executeDraw が mirage ゾーン滞在中の
 * カードを発揮元とする draw で実際に1枚以上ドローを成立させた時点。
 */
export interface MirageSetDrawLogEntry {
  playerId: string;
  sourceInstanceId: string;
  turnNumber: number;
}

/**
 * プレゲーム状態（契約提示 → 契約確認 → じゃんけん → 先後選択 → マリガン → ゲーム開始）。
 * push/poll で同期される。
 */
export interface PreGameState {
  /** 現在のフェーズ */
  phase: PreGamePhase;
  /** 契約提示候補。キー = playerId、値 = 候補カードの instanceId。 */
  contractCandidateInstanceIds?: Record<string, string>;
  /** 契約提示候補の cardNo。sanitize 後も UI が候補表示に使う。 */
  contractCandidateCardNos?: Record<string, string>;
  /** 契約提示選択。true=提示する、false=提示しない。キーは playerId。 */
  contractPresentationChoices?: Record<string, boolean>;
  /** 契約確認画面を見終えたプレイヤー。キーは playerId。 */
  contractConfirmed?: Record<string, boolean>;
  /** 先攻プレイヤーID（決定後にセット） */
  firstPlayerId: string | null;
  /** 各プレイヤーのじゃんけんの手（現ラウンド分） */
  jankenHands: Record<string, "rock" | "scissors" | "paper">;
  /**
   * じゃんけんラウンドの epoch。あいこのたびにサーバが +1 する。
   * クライアントは手を提出するとき自分が見ているラウンドを添えて送り、
   * サーバは `jankenRound` 不一致の手（あいこ確定で破棄された旧ラウンドの
   * 遅延再送）を拒否する。これによりラウンド境界が識別でき、古い手が次ラウンドへ
   * 紛れ込む競合を防ぐ。
   */
  jankenRound: number;
  /** じゃんけん勝者（サーバが両者の手から導出する。クライアント宣言ではない） */
  jankenWinner: string | null;
  /** 各プレイヤーのマリガン選択（true=マリガンした） */
  mulliganDone: Record<string, boolean>;
}

/**
 * runtime zone だけでは判別できない「セット中」を判定する SSOT。
 * バーストは発動成立後も zone:"burst" に残るが setBurstStates から外れて
 * revealedBurstStates で追跡されるため、burst zone だけで【セット中】効果を判定してはならない。
 * ミラージュには表向き発動中へ遷移する別状態がなく、mirage zone に居ること自体がセット中を表す。
 */
export function isCardInSetState(
  state: GameState,
  card: CardInstance
): boolean {
  return (
    (card.zone === "burst" &&
      state.setBurstStates.some(
        (setState) => setState.cardInstanceId === card.instanceId
      )) ||
    card.zone === "mirage"
  );
}

export type PreGamePhase =
  | "waiting_contract"
  | "contract_confirm"
  | "waiting_janken"
  | "janken_resolved"
  | "waiting_order_pick"
  | "order_decided"
  | "waiting_mulligan_first"
  | "waiting_mulligan_second"
  | "pregame_complete";

/**
 * ゲーム終了結果。
 * - "player_loss": 特定プレイヤーの敗北 (不正バースト、ライフ 0 等)。
 * - "draw": 引き分け。
 */
export interface GameResult {
  kind: "player_loss" | "draw";
  losingPlayerId?: string;
  reason: string;
}

export const STEP_ORDER: readonly Step[] = [
  "start",
  "core",
  "draw",
  "refresh",
  "main",
  "attack",
  "end",
];
