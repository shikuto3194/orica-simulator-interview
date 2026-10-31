import type {
  BattleImmediateEffectActionRegistrationLookup,
  BattleImmediateEffectActionResult,
  BattleImmediateEffectSourceKind,
} from "../battle/battle-immediate-effect-system";
import type {
  AttackDeclarationResult,
  BlockDeclarationResult,
  DeclineBlockResult,
  OpenBattleFlashResult,
  PassBattleFlashResult,
  PassPreDeclarationStackResult,
} from "../battle/battle-system";
import type {
  HandWrittenBurstPostResolutionPolicyLookup,
  SetBurstActionResult,
} from "../mechanics/burst-system";
import type {
  FieldEffectActionResult,
  FieldEffectSourceKind,
} from "../card/card-effect-system";
import type {
  CanExecuteCheckAccessor,
  HandWrittenEffectResolver,
  HandWrittenEffectResolverLookup,
  SuccessCheckAccessor,
} from "../effect/effect-resolution";
import type {
  BattleImmediateEffectTiming,
  BurstEventKind,
  CardDefinition,
  EffectCategory,
  EffectComposition,
  EffectExecutionMode,
  EffectForceLevel,
  EffectPreventionLevel,
  EffectReevaluationPoint,
  EffectUsageLimit,
  GameState,
  PendingStepPrompt,
  LifeCoreKind,
  SuppressionEffectDescriptor,
  LifeCoreMoveEffectKind,
  Zone,
} from "../model";
import type { CardFilter } from "../dsl-types";
import type { EffectSourceKind } from "../source-kinds";
import type { MagicActionResult } from "../mechanics/magic-system";
import type { TextRoleUnderSourceRole } from "../mechanics/star-garment-utils";
import type {
  AccelActionResult,
  ChangeActionResult,
} from "../mechanics/accel-change-system";
import type {
  AvailableOnBoardCorePaymentSource,
  AvailableSoulCorePaymentSource,
  CardCostPaymentSource,
} from "../core/payment-system";
import type { EnterFieldCorePlacementRule } from "../zone/enter-field-placement-policy";
import type { EnterFieldCorePlacement } from "../zone/enter-field-placement-execution";
import type { EffectFilterTag } from "../state-based-actions";
import type {
  BurstActionRegistrationLookup,
  PendingBurstCheckResolver,
  PendingBurstCheckResolverLookup,
  PendingTriggeredEffectResolver,
  PendingTriggeredEffectResolverLookup,
  TriggeredEffectActionRegistrationLookup,
  ResolvePendingBurstCheckResult,
  ResolvePendingTriggeredEffectResult,
} from "../effect/trigger-system";
import type { TriggerEventKind } from "../model";

export type LegalActionKind =
  | "resolve_pending_triggered_effect"
  | "select_pending_to_resolve"
  | "declare_private_triggered_effect"
  | "skip_private_triggered_effect"
  | "resolve_pending_burst_check"
  | "decline_pending_burst_check"
  | "use_field_card_effect"
  | "use_hand_card_effect"
  | "resolve_battle_immediate_effect"
  | "use_magic"
  | "use_accel"
  | "use_change"
  | "declare_advent"
  | "declare_host_dual_advent"
  | "declare_dual_host_advent"
  | "declare_manifest"
  | "set_burst"
  | "set_mirage"
  | "set_quartz"
  | "activate_soul_state"
  | "summon"
  | "place_nexus"
  | "attack"
  | "flip_instead_of_attack"
  | "join_active_attack"
  | "decline_immediate_attack_join"
  | "block"
  | "open_battle_flash"
  | "pass_battle_flash"
  | "pass_stack"
  | "pass_pre_declaration_stack"
  | "decline_block"
  | "end_attack_step"
  | "resolve_pending_deck_reveal_pick"
  | "resolve_pending_deck_reveal_order"
  | "resolve_pending_step_optional_choice"
  | "resolve_pending_step_choice"
  | "resolve_connect_battle_decision"
  | "resolve_pending_deck_reveal_count_boost_choice"
  | "resolve_pending_step_optional_target_selection"
  | "resolve_pending_core_shoot"
  | "resolve_pending_effect_target"
  | "resolve_pending_as_if_soul_core_choice"
  | "resolve_pending_effect_optional_repeat_choice"
  | "resolve_pending_effect_optional_repeat_count"
  | "resolve_borrowed_effect_choice"
  | "resolve_borrowed_effect_target"
  | "resolve_pay_to_act_core_gate"
  | "resolve_pay_to_act_hand_discard_gate"
  | "resolve_field_magic_pre_cost_trigger"
  | "resolve_pending_core_split"
  | "resolve_pending_split_summon_choice"
  | "resolve_core_source_allocation"
  | "resolve_pending_link_aid_cost_source_choice"
  | "resolve_pending_effect_summon_cost_payment"
  | "resolve_pending_core_distribution"
  | "abort_pending_core_distribution"
  | "resolve_pending_change_cleanup_choice"
  | "resolve_pending_enter_field_placement"
  | "resolve_pending_multi_placement"
  | "abort_pending_multi_placement"
  | "resolve_oracle_choice"
  | "resolve_unseal_choice"
  | "resolve_stone_rebirth_choice"
  | "use_divine_skill"
  | "swap_field_hand"
  | "decline_field_hand_swap"
  | "confirm_target_redirect"
  | "decline_target_redirect";

export type LegalActionTargetMode = "none" | "manual";
export type LegalActionTargetPlayerScope =
  | "any"
  | "acting_player"
  /**
   * P3-52: 対象選択候補は acting_player の相手プレイヤーが所有するカードに限定。
   * `target.player === "opponent"` 由来。
   */
  | "opponent";
export type RegisteredActionTiming = "normal" | "flash" | "stack";
export type RegisteredEffectLifeCoreChoiceDestinationKind =
  | "source_card"
  | "target_card";

export interface RegisteredEffectLifeCoreChoice {
  effectKind?: LifeCoreMoveEffectKind;
  destinationKind: RegisteredEffectLifeCoreChoiceDestinationKind;
  targetIndex?: number;
}

export interface RegisteredSourceUnderCardRequirement {
  role: "advent_source" | "text_role";
  roleTag?: string;
}

export interface RegisteredSourceUnderCardSlotRequirement {
  role: "text_role";
  roleTag: string;
  maxCount: number;
}

/**
 * 選択肢を発揮するための代替コスト「自分の <filter> カードのコア N 個を
 * <destination> に置く(ことで)」を pre-gate するためのメタデータ。
 * - `core_move from:field_card filter amount:N` 型 conditional cost を choice /
 *   triggered variant 単位で gating する。`canPayRequiredEffectCosts` がフィルタ一致カードの
 *   可動コア合計が `amount` 以上か検査し、不足する variant の legal action を抑止する。
 * - 配分や soul/normal の選好は executeCoreMove / pendingCoreSourceAllocation が解決する。
 *   ここで持つのは「払えるか」の事前判定のみ。
 */
export interface RequiredCoreMoveCost {
  sourcePlayer: import("../model").EffectPlayerRef;
  sourceFilter: import("../dsl-types").CardFilter;
  destination: import("../dsl-types").CoreLocation;
  amount: number;
}

/**
 * 選択肢を発揮するための「自分の手札にある <filter> カード N 枚を破棄する(ことで)」
 * 代替コストを pre-gate するためのメタデータ。`RequiredCoreMoveCost` の破棄版。
 * - `discard from:hand filter count:N` 型 conditional_cost の cost 側 step を choice
 *   variant 単位で gating する。`canPayRequiredEffectCosts` が filter 一致する手札枚数が
 *   `amount` 以上か検査し、不足する variant の legal action を抑止する
 *   （BSSL01-T01「手札の系統:影/プレイヤー1枚を破棄することで1ドロー」等）。
 * - 破棄候補の選択自体は既存 discard pending が解決する。ここで持つのは「払えるか」の
 *   事前判定のみ。
 */
export interface RequiredDiscardCost {
  sourcePlayer: import("../model").EffectPlayerRef;
  sourceFilter?: import("../dsl-types").CardFilter;
  amount: number;
}

export interface RequiredSelectedTargetsCountCost {
  amount: import("../dsl-types").DynamicCount;
  targetStepId: string;
  player?: import("../model").EffectPlayerRef;
}

export interface RegisteredTargetGroup {
  requiredTargetCount: number;
  requiredTargetCountDynamic?: import("../dsl-types").CountBound;
  maxTargetCount?: number;
  maxTargetCountDynamic?: import("../dsl-types").CountBound;
  targetStepId?: string;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  /** Operation aspect used by the shared immunity gate. */
  targetEffectAspect?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: LegalActionTargetPlayerScope;
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  sourceUnderCardRole?: "advent_source" | "text_role";
  /** 対象候補を効果発動元 host に合体中の child card だけに絞る。 */
  sourceAttachedChildrenOnly?: boolean;
  /** 星霊衣で下に置ける B面持ちブレイヴだけを対象候補にする。 */
  starGarmentTargetEligibleOnly?: boolean;
  /** 発揮元 instance 自身の text_role under-card slot に空きがあることを要求する。 */
  sourceRequiredOpenUnderCardSlot?: RegisteredSourceUnderCardSlotRequirement;
  targetRequiresFullCount?: boolean;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
}

export interface LegalActionTargetGroup {
  requiredTargetCount: number;
  maxTargetCount?: number;
  targetStepId?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetInstanceIds: string[];
}

export interface RegisteredTargetedEffectActionBase {
  effectCategory?: EffectCategory;
  activationLabel?: import("../model").ActivatedEffectLabel;
  executionMode?: EffectExecutionMode;
  forceLevel?: EffectForceLevel;
  preventionLevel?: EffectPreventionLevel;
  preventionRestriction?: unknown;
  targetLockBypass?: import("../effect/target-affect-gate").TargetLockBypassProfile;
  composition?: EffectComposition;
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  /**
   * 共有使用制限グループ ID。`Effect.limitGroupId` から伝搬。
   * 同一 instance 内で異なる timing に分離された effect が
   * 「ターンに1回」等の usage 制限を共有するためのキー。
   * 設定時は effectLabel ではなく groupId でレコードをマッチする。
   */
  limitGroupId?: string;
  reevaluationPoints?: readonly EffectReevaluationPoint[];
  /** `suppress_effect` の effectFilter 突き合わせ用記述子（登録時に効果から導出）。 */
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
  requiredTargetCount?: number;
  /**
   * 対象選択の下限が実行時の盤面で決まる場合の raw 境界。
   * mandatory repeat のように required/max が同じ動的値になる効果で使う。
   */
  requiredTargetCountDynamic?: import("../dsl-types").CountBound;
  /**
   * 対象選択数の上限。省略時は requiredTargetCount と等しい（固定数）。
   * requiredTargetCount より大きい値を設定すると
   * 「N 体まで（min=requiredTargetCount, max=maxTargetCount）」の可変選択になる。
   * D-2 Phase 2 - 複数選択（multi-select）対応。
   */
  maxTargetCount?: number;
  /**
   * 上限が `DynamicCount`（「自分のカウント2につき1体まで」= max が動的レンジ）の場合の
   * 未解決境界。登録時は盤面が無く数値化できないため raw `CountBound` を保持し、
   * 対象選択を deferred 解決する段階 (`getStackTargetSelection`) で `resolveCountBound`
   * により実効上限へ解決する。静的な `maxTargetCount`（数値）とは排他的に使う。
   */
  maxTargetCountDynamic?: import("../dsl-types").CountBound;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  /** Operation aspect used by the shared immunity gate. */
  targetEffectAspect?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: LegalActionTargetPlayerScope;
  /**
   * `summon.target.from_zone.includeAdventSource` 由来 (BSSL01-X01[5,6])。
   * true のとき、`candidateTargetZones` 由来の通常ゾーン候補に加えて、
   * `collectUnderCardScopeIds(state).adventSource` (煌臨元アンダーカード) も
   * legal action 候補へ union する。煌臨元は runtime Zone 上 "field" のまま
   * ホストの下に重なるため `candidateTargetZones` (Zone 列挙) では表現できず、
   * orthogonal な union フラグとして分離する
   * (`sourceUnderCardRole` は単一ホストへの narrowing 専用で意味が異なるため流用不可)。
   */
  candidateIncludeAdventSource?: boolean;
  /**
   * `summon.target.from_zone.includeSoulState` 由来。魂状態カードは runtime Zone 上 "field" のまま
   * `soulStateInstanceIds` に登録されるため、通常ゾーン候補とは独立して union する。
   */
  candidateIncludeSoulState?: boolean;
  /**
   * P3-52: `target.filter` 由来の CardFilter。
   * legal action 候補絞り込みで `matchesCardFilter` に渡し、effect 個別の
   * カテゴリ / 系統 / colors / maxBp / 創界神フラグ等を反映する。
   * 未指定時は category-aware フィルタを通さず全候補を返す（従来挙動）。
   */
  targetCardFilter?: import("../dsl-types").CardFilter;
  /**
   * P3-52: `target.excludeSelf` 由来。true の場合、効果発動元カード自身を
   * 候補から除外する。`getCandidateTargetInstanceIds` の `sourceInstanceId`
   * 指定と組み合わせて適用される。
   */
  targetExcludeSelf?: boolean;
  /**
   * `move_card.from.sourceUnderCardRole` 由来。対象候補を効果発動元 instance の
   * underCards のうち指定 role のカードだけに絞る。
   */
  sourceUnderCardRole?: "advent_source" | "text_role";
  /**
   * `place_star_garment` / `swap_star_garment` 由来。対象候補を効果発動元
   * host に合体中のブレイヴだけに絞り、「このスピリットのブレイヴ1つ」を
   * legal action 候補段階で満たす。
   */
  sourceAttachedChildrenOnly?: boolean;
  /** `place_star_garment` / `swap_star_garment` 対象候補の B面/置けないタグ gate。 */
  starGarmentTargetEligibleOnly?: boolean;
  /**
   * `brave_combine_effect` 由来。対象候補を「発動元カード自身が braveCondition/
   * 多重合体上限/cannot_combine 制約を満たして合体できるスピリット/アルティメット」
   * だけに絞る (ENGINE-bsft01-tr-rebirth-brave-combine-branch)。`sourceDefinition`
   * が braveCondition の源になるため、呼び出し側 (`getCandidateTargetInstanceIds`) に
   * `options.sourceDefinition` の指定が必須。
   */
  braveCombineHostOnly?: boolean;
  /**
   * 発揮元 instance 自身の underCards に指定 role/tag のカードがあることを
   * legal action 列挙の前提にする。`swap_star_garment` のように under-card を
   * 対象選択しないが、存在しなければ実行時 no-op になる効果で使う。
   */
  sourceRequiredUnderCard?: RegisteredSourceUnderCardRequirement;
  /** 発揮元 instance 自身の text_role under-card slot に空きがあることを要求する。 */
  sourceRequiredOpenUnderCardSlot?: RegisteredSourceUnderCardSlotRequirement;
  /**
   * `move_card.requireFullCount` 由来。候補が requiredTargetCount に満たない場合、
   * 空撃ち/部分撃ちへ縮退せず legal action を生成しない。
   */
  targetRequiresFullCount?: boolean;
  /**
   * P3-14 A-7: registration を生成した DSL action の kind。
   * `effect_param_override` CE による動的なフィルタ拡張 (`maxBp` +α / `category` 拡張)
   * を listing 経路でも適用するために使用する。
   * 現在は destroy / vanish / bounce のみが override 対象。
   */
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  /**
   * 裏向きセット中バーストのように、対象選択時はカード内容/耐性を見ず、選択後の
   * 実行 gate で reveal 確認する効果で使用する。true の場合、候補列挙では
   * defense_immune / leave resistance 等の affect gate を適用しない。
   */
  targetSelectionBypassesAffectGate?: boolean;
  /**
   * 対象候補の取得時に defense_immune / leave resistance 等の affect gate だけを遅延し、
   * target acquisition gate は通常通り適用する。効果途中の step 到達時 target selection で、
   * 選択後の実行直前 gate と候補列挙を分離するために使う。
   */
  targetSelectionBypassesPreventionGate?: boolean;
  /**
   * `discard_set_burst` 専用。zone:"burst" のカード全体ではなく、現在
   * `state.setBurstStates` に登録されているセット中バーストだけを候補にする。
   */
  targetCandidatesRequireSetBurstState?: boolean;
  /**
   * 1 legal action が複数の対象ロールを順に要求する場合のロール別候補制約。
   * 単一 filterOr に潰すと player/zone/filter の対応が壊れるため、group ごとに候補を union する。
   */
  targetGroups?: readonly RegisteredTargetGroup[];
  /**
   * 宣言時に選択した targetInstanceIds を消費する DSL step id。
   * choice の後続 step が対象を要求する場合に、先行 step へ対象 ID が誤注入されないようにする。
   */
  targetStepId?: string;
  /** optional repeat など、同じ instanceId を複数回の対象選択として受け取る action。 */
  allowDuplicateTargets?: boolean;
  /**
   * 空撃ち制御フラグ。この対象が「○○することで△△する」(ことで構文 =
   * `connector: "conditional_cost"` の効果側 △△) かどうか。
   * - true: 対象 0 体のときは「コストだけ払って効果なし」を禁ずる双方向ルール
   *   (10_rules/03b_resolution-and-interrupts.md:34) により legal action を生成しない。
   * - false / 未指定: 対象 0 体でも空撃ち可能 (同 131「空撃ちは原則可能」)。
   * 判定は `resolveEmptyFireTargetCounts()` に集約。
   */
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  /**
   * @deprecated 旧registration互換用。pay_cost は常に通常の支払い元を使う。
   */
  allowFieldCorePayment?: true;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: RequiredCoreMoveCost;
  requiredDiscardCost?: RequiredDiscardCost;
  actingPlayerLifeCoreChoice?: RegisteredEffectLifeCoreChoice;
  /**
   * D-2 Phase 2 chooser: 対象選択を行うプレイヤー（効果オーナー基準）。
   * - 省略時 / "self" = 効果オーナーが選ぶ（既存挙動）
   * - "opponent" = 効果オーナーの相手が選ぶ
   * 効果オーナー（actingPlayerId）は据え置き、prompt 相手のみ反転される。
   */
  chooser?: "self" | "opponent" | "either";
  /**
   * 効果の適用条件 (CardDefinition.effects[i].applicability)。
   * legal-action availability で `evaluateApplicability` 呼び出して、
   * 不成立な状態 (例: Lv2 効果なのに Lv1) では legal action を生成しないために使う。
   */
  applicability?: import("../dsl-types").Effect["applicability"];
  /**
   * timing と直交する『誰のいつ』スコープ (`Effect.timingScope` から伝搬)。
   * activated/flash 効果で `フラッシュ『お互いのアタックステップ』` 等の
   * ステップ限定を表現するため、legal-action availability で current
   * `state.step` / `state.activePlayerId` と照合し、不一致なら legal action を出さない。
   */
  timingScope?: import("../model").TimingScope;
  /**
   * 効果発揮の前提条件 (`Effect.condition` から伝搬)。
   * `field_lacks` / `field_has` 等の ConditionClause 配列。
   * legal-action availability で `evaluateCondition` を呼び、未充足なら legal
   * action を出さない。「ことで」コストや「〜のとき」条件の事前ガードに使う。
   * 例: フランドール【フォーオブアカインド】の "創界神なし + デッキ ≥ 3 枚"。
   */
  condition?: import("../model").Condition;
}

export interface RegisteredFieldCardEffectAction extends RegisteredTargetedEffectActionBase {
  sourceKind: FieldEffectSourceKind;
  timing?: RegisteredActionTiming;
  choices?: readonly MagicChoiceVariant[];
  /** この registration を発揮できる source role。 */
  requiredSourceRole?: TextRoleUnderSourceRole;
  /**
   * 解決対象の DSL effect index（`targetEffectIndex` として効果解決へ渡す）。
   * 同一カードに複数の activated 効果がある場合 (例: BSTH01-X04 フォーオブアカインド)、
   * 宣言された 1 効果のみを実行するために必要。これが無いと同 timing の全効果が
   * 束ねて実行され、共有 recordedUsage ラベルで usageLimit が誤って払い戻される。
   * 非 activated effect を skip するため registration 配列 index とは一致しない。
   */
  effectIndex: number;
  reason?: string;
}

export interface RegisteredHandCardEffectAction extends RegisteredTargetedEffectActionBase {
  reason?: string;
}

/**
 * 手札/手元起動効果（`timing.kind === "activated"` かつ `applicability.zone === "hand" | "set_aside"`）。
 * 「手札にあるこのカードは…『自分のスタートステップ』に…召喚できる」のように、
 * 常時効果が通常召喚をメインステップ外で許可する B 型を、プレイヤー能動の起動効果として表す。
 * 解決中の召喚（`fixedPayment` 等）は通常召喚として扱い、コスト支払い後にスタック窓が開く。
 */
export interface RegisteredHandActivatedEffectAction extends RegisteredTargetedEffectActionBase {
  /** 解決対象の DSL effect index（`targetEffectIndex` として効果解決へ渡す）。 */
  effectIndex: number;
  /** 実行窓。activationLabel と分離して pay-to-act / negate の timing 照合に使う。 */
  timing: "main" | "flash" | "stack";
  choices?: readonly MagicChoiceVariant[];
  reason?: string;
}

/**
 * P3-24 Phase 2 / per-choice usageLimit: magic の choice ステップ変種メタデータ。
 * choices[0] = デフォルト action、choices[1+] = choice[N-1] 各エントリ。
 * 形は `EffectChoiceVariantTargetMeta` (legal-actions-shared) と同一。
 */
export interface MagicChoiceVariant {
  /** choice 表示用の短いラベル（例: "ブロックされない", "アタック終了"）。 */
  label: string;
  requiredTargetCount?: number;
  maxTargetCount?: number;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  /** Operation aspect used by the shared immunity gate. */
  targetEffectAspect?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: LegalActionTargetPlayerScope;
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  starGarmentTargetEligibleOnly?: boolean;
  sourceRequiredUnderCard?: RegisteredSourceUnderCardRequirement;
  sourceRequiredOpenUnderCardSlot?: RegisteredSourceUnderCardSlotRequirement;
  targetSelectionBypassesAffectGate?: boolean;
  targetCandidatesRequireSetBurstState?: boolean;
  targetGroups?: readonly RegisteredTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: RequiredCoreMoveCost;
  requiredDiscardCost?: RequiredDiscardCost;
  chooser?: "self" | "opponent" | "either";
  /**
   * 変種ごとに独立した使用制限 (「これらの効果は…1回ずつしか使えない」BSTH01-C21)。
   * effect 単位の registration.usageLimit (共有制限・ラベル "magic") とは別軸で、
   * `getChoiceVariantUsageLabel("magic", choiceIndex)` のラベルで検査・記録する。
   */
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
}

export interface RegisteredMagicAction extends RegisteredTargetedEffectActionBase {
  timing: "main" | "flash" | "stack";
  /** 解決対象の DSL effect index（choice 条件 `getChoiceStepCondition` の参照用）。 */
  effectIndex?: number;
  /**
   * choice ステップを持つ effect の変種メタデータ。
   * 存在する場合、use_magic legal action は choices.length 個に展開される
   * (各々別 choiceIndex)。top-level の対象系メタは未設定になり、変種側だけが意味を持つ。
   */
  choices?: readonly MagicChoiceVariant[];
  reason?: string;
  /**
   * `Effect.applicability` から伝搬。未指定時は従来どおり手札/手元からのみ使用可能
   * （デフォルトゾーン）。`zone` にトラッシュを含む場合のみ、
   * `getAvailableMagicLegalActions` がトラッシュのカードもソースとして走査する
   * (engine-magic-trash-use-permission、BSDB01-R03「トラッシュからも使用できる」)。
   */
  applicability?: import("../dsl-types").Effect["applicability"];
}

export type FieldCardEffectActionRegistrationLookup = (
  cardNo: string
) => readonly RegisteredFieldCardEffectAction[] | undefined;

export type HandCardEffectActionRegistrationLookup = (
  cardNo: string
) => RegisteredHandCardEffectAction | undefined;

export type HandActivatedEffectActionRegistrationLookup = (
  cardNo: string
) => readonly RegisteredHandActivatedEffectAction[] | undefined;

export type MagicActionRegistrationLookup = (
  cardNo: string
) => readonly RegisteredMagicAction[] | undefined;

export interface FieldCardEffectLegalAction {
  kind: "use_field_card_effect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceKind: FieldEffectSourceKind;
  timing: RegisteredActionTiming;
  /** 実行窓と分離した起動効果カテゴリ。本文「フラッシュタイミングで」は "none"。 */
  activationLabel?: import("../model").ActivatedEffectLabel;
  choiceIndex?: number;
  choiceLabel?: string;
  /** 単一効果内 choice を宣言時に分岐させず、スタック窓後に選ぶための候補 index。 */
  deferredChoiceIndexes?: readonly number[];
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceEffectDefinitionId?: string;
  sourceEffectInstanceId?: string;
  sourceCardNo: string;
  registrationIndex: number;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  /**
   * D-2 Phase 2 chooser メタデータ: 対象選択を委ねるプレイヤー ID。
   * field card effect は直接起動型のため、actingPlayerId はソース管理者のまま据え置きで
   * GUI が target prompt を chooserPlayerId 宛にルーティングする想定 (metadata-only)。
   * 省略時 = actingPlayerId と同じ (自分が選ぶ)。
   */
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  /**
   * P3-99 起動権 variant: 設定時、この legal action は registration ではなく
   * grant_effect で付与された CE (effectId) の metadata.grantedEffect を、被付与カード
   * (sourceInstanceId = grantee) を source として発揮する。usageLimit は CE スコープ
   * (effectLabel `granted_activated:<ceId>`) で消費する。
   */
  grantedEffectCeId?: string;
}

/**
 * 手札/手元起動効果の legal action。プレイヤーが非フィールド公開前ゾーンのカードの起動効果を能動的に発揮する。
 * `use_field_card_effect` の手札版だが、解決中にソースカード自身を召喚し得るため
 * 効果解決はフィールド在席を要求しない（hand_card_effect スタックで処理）。
 */
export interface HandActivatedEffectLegalAction {
  kind: "use_hand_card_effect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** hand-activated registration の index。 */
  registrationIndex: number;
  /** 解決対象 DSL effect index。 */
  effectIndex: number;
  /** 実行窓。activationLabel と分離して pay-to-act / negate の timing 照合に使う。 */
  chosenTiming: "main" | "flash" | "stack";
  /** 見出しラベル由来の効果カテゴリ。未指定時は chosenTiming 相当。 */
  activationLabel?: import("../model").ActivatedEffectLabel;
  /** 宣言時点の source zone snapshot。 */
  sourceActivationZone: import("../model").EffectActivationSourceZone;
  choiceIndex?: number;
  choiceLabel?: string;
  /** 単一効果内 choice を宣言時に分岐させず、スタック窓後に選ぶための候補 index。 */
  deferredChoiceIndexes?: readonly number[];
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  maxTargetCount?: number;
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
}

export interface ResolvePendingTriggeredEffectLegalAction {
  /** 同一イベントの重複不可の別個体を残して、この発揮元をスキップできる。 */
  canSkipDuplicate?: true;
  kind: "resolve_pending_triggered_effect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  eventKind: TriggerEventKind;
  executionMode: EffectExecutionMode;
  sourceKind?: FieldEffectSourceKind;
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
  sourceEffectDefinitionId?: string;
  sourceEffectInstanceId?: string;
  sourceCardNo?: string;
  registrationIndex?: number;
  /** choice ステップの選択肢インデックス。0=デフォルト action、1+=choice[N-1]。 */
  choiceIndex?: number;
  /** choice 表示用の短いラベル（例: "手札に戻す", "ドロー"）。 */
  choiceLabel?: string;
  /** 単一効果内 choice を宣言時に分岐させず、スタック窓後に選ぶための候補 index。 */
  deferredChoiceIndexes?: readonly number[];
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  /**
   * D-2 Phase 2 chooser: 対象選択を行うプレイヤーの ID。
   * 省略時は actingPlayerId と同じ（効果オーナーが選ぶ）。
   * "opponent" chooser が指定された場合のみ、opponent の player ID が設定される。
   * 効果オーナー（actingPlayerId）は据え置き、prompt の宛先のみ反転される。
   */
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  /**
   * P3-91/P3-92: 全 variant が caller 非依存の理由 (usageLimit / 空撃ち禁止 / 条件未達 /
   * mechanic ソース消失) で発揮不能な pending を drain するための専用 action。
   * apply は resolver を実行せず pending を除去する (BIE の skipOnly と同型)。
   */
  skipOnly?: true;
  /**
   * `resource:"card"` の scoped paid prevention 用の既存宣言 variant。
   * BSGE01-R04 型の count cost は stack 窓後・対象選択前の pendingStepChoice で扱う。
   */
  payPreventionImmunityCost?: true;
  /**
   * ENGINE-paid-prevention-immunity-card-cost Step3: `payPreventionImmunityCost` variant
   * かつ cost.resource が `"card"` のとき、この対価の除外候補カード instanceId 一覧
   * (`cost.zone` 内 `cost.filter` 一致、actingPlayerId 所有分)。候補数が
   * `paidPreventionImmunityCardCostAmount` と一致するときも常に付与する
   * (候補数===amount: GUI は自動確定してよい。候補数>amount: player がこの中から
   * `paidPreventionImmunityCardCostAmount` 枚を選び、apply に
   * `paidPreventionImmunityCardSelection` として渡す必要がある)。
   */
  paidPreventionImmunityCardCostCandidateInstanceIds?: string[];
  /** 上記候補から選択すべき枚数 (= cost.amount)。候補提示時のみ設定。 */
  paidPreventionImmunityCardCostAmount?: number;
  /**
   * 旧宣言 variant 互換フィールド。BSGE01-R02 型の count cost は
   * stack 窓後・対象選択前の pendingStepChoice で扱う。
   */
  payLeaveSuppressionCost?: true;
}

/**
 * P3-36 Phase C: ターンプレイヤーが公開キューから「次に解決する pending」を選ぶアクション。
 * 選択後、対象 pending の `selectedByTurnPlayer` flag が true になり、
 * `resolve_pending_triggered_effect` が legal になる。
 */
export interface SelectPendingToResolveLegalAction {
  /** 同一イベントの重複不可の別個体を残して、この発揮元をスキップできる。 */
  canSkipDuplicate?: true;
  kind: "select_pending_to_resolve";
  actionId: string;
  can: true;
  reason: string;
  /** 常に turn player */
  actingPlayerId: string;
  /** 選択対象の pending */
  pendingId: string;
  /** owner 情報（GUI 表示用） */
  ownerPlayerId: string;
  eventKind: TriggerEventKind;
  /**
   * 選択対象 pending または source/effect registration の発揮任意性。
   * 複数 source/effect が同じ pending に乗り、残っている候補がすべて同じ
   * executionMode なら原則 pending 全体の metadata として扱う。ただし owner 側の
   * optional は「発揮する」選択が source の発揮宣言を兼ねるため、source metadata
   * 付きの action に分解される。mandatory/optional が混ざる場合も同様に分解される。
   * GUI は owner === actingPlayerId かつ optional のとき、「解決」ではなく
   * 「発揮する / 発揮しない」として表示できる。
   */
  executionMode?: EffectExecutionMode;
  /**
   * mandatory/optional が同じ pending 内で混ざる場合、どの source/effect registration
   * を選択するかを示す metadata。省略時は pending 全体の選択を表す。
   */
  sourceInstanceId?: string;
  sourceEffectInstanceId?: string;
  registrationIndex?: number;
}

export interface PrivateTriggeredEffectDeclarationLegalAction {
  kind: "declare_private_triggered_effect" | "skip_private_triggered_effect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  declarationId: string;
  eventKind: TriggerEventKind;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  registrationIndex: number;
}

export interface ResolvePendingBurstCheckLegalAction {
  kind: "resolve_pending_burst_check";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  checkId: string;
  eventKind: BurstEventKind;
  relatedPlayerId: string;
  sourceKind?: EffectSourceKind;
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
  sourceCardNo?: string;
  registrationIndex?: number;
  /** choice ステップの選択肢インデックス。0=デフォルト action、1+=choice[N-1]。 */
  choiceIndex?: number;
  /** choice 表示用の短いラベル（例: "手札に戻す", "ドロー"）。 */
  choiceLabel?: string;
  /** 単一効果内 choice を宣言時に分岐させず、スタック窓後に選ぶための候補 index。 */
  deferredChoiceIndexes?: readonly number[];
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  playsSourceCardWithoutCostAfterResolve: boolean;
  usesSourceCardWithoutCostAfterResolve: boolean;
  playsTargetCardWithoutCostAfterResolve: boolean;
  usesTargetCardWithoutCostAfterResolve: boolean;
  enterFieldCorePlacementRule: EnterFieldCorePlacementRule;
  minimumEnterFieldCoreCount: number;
  maximumEnterFieldCoreCount: number | null;
  requiresEnterFieldCorePlacements: boolean;
  targetFollowUpMagicOptions: Array<{
    targetInstanceId: string;
    targetMode: LegalActionTargetMode;
    requiredTargetCount: number;
    /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
    maxTargetCount?: number;
    targetEffectFilterTags: readonly EffectFilterTag[];
    candidateTargetInstanceIds: string[];
    availableChosenLifeCoreKinds: LifeCoreKind[];
    requiresChosenLifeCoreKind: boolean;
  }>;
  targetEnterFieldCorePlacementOptions: Array<{
    targetInstanceId: string;
    enterFieldCorePlacementRule: EnterFieldCorePlacementRule;
    minimumEnterFieldCoreCount: number;
    maximumEnterFieldCoreCount: number | null;
    requiresEnterFieldCorePlacements: boolean;
  }>;
}

/**
 * P3-71: バースト発動は任意（ルール上「発動宣言」）。発動可能なバーストが
 * あっても「発動しない」を選べるよう、resolve とは別にこの decline を提供する。
 * 適用時は当該 pendingBurstCheck を発火せず破棄し、バーストはセットされたまま残す。
 */
export interface DeclinePendingBurstCheckLegalAction {
  kind: "decline_pending_burst_check";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  checkId: string;
  eventKind: BurstEventKind;
  relatedPlayerId: string;
}

export interface BattleImmediateEffectLegalAction {
  /** 同一イベントの重複不可の別個体を残して、この発揮元をスキップできる。 */
  canSkipDuplicate?: true;
  kind: "resolve_battle_immediate_effect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  promptId: string;
  attackId: string;
  timing: BattleImmediateEffectTiming;
  sourceKind: BattleImmediateEffectSourceKind;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceEffectDefinitionId?: string;
  sourceEffectInstanceId?: string;
  sourceCardNo: string;
  participantEntityId: string;
  executionMode: EffectExecutionMode;
  /** choice ステップの選択肢インデックス。0=デフォルト action、1+=choice[N-1]。 */
  choiceIndex?: number;
  /** choice 表示用の短いラベル（例: "手札に戻す", "ドロー"）。 */
  choiceLabel?: string;
  /** 単一効果内 choice を宣言時に分岐させず、スタック窓後に選ぶための候補 index。 */
  deferredChoiceIndexes?: readonly number[];
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  /**
   * D-2 Phase 2 chooser: 対象選択を行うプレイヤーの ID。
   * 省略時は actingPlayerId と同じ（効果オーナーが選ぶ）。
   * "opponent" chooser が指定された場合のみ、opponent の player ID が設定される。
   * pending triggered と同様に、battle immediate prompt も queue 経由で公開され、
   * legal-actions-availability が呼び出し側 player を chooserPlayerId と一致するもののみに絞る。
   * 効果オーナー（actingPlayerId）は据え置き、prompt の宛先のみ反転される。
   */
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  /**
   * targetGroups なし単一対象の宣言時候補 zone。未指定時は従来通り field 限定
   * (ENGINE-battle-immediate-off-field-target-revalidation)。宣言時候補列挙
   * (getCandidateTargetInstanceIds) は zone-aware だが、declare→stack→resolve
   * の staleness re-check (isTargetStillValid) は本フィールド未配線だと field 固定になり、
   * 手札/トラッシュ等の非 field 対象 (例: 「手札/トラッシュのカード1枚を除外することで」)
   * を declare 時に選んでも pass_stack 解決時に必ず reject される。
   */
  candidateTargetZones?: readonly Zone[];
  targetGroups?: readonly LegalActionTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  /**
   * P3-91: 全 variant が caller 非依存の理由 (usageLimit / 空撃ち禁止 (03b:34) /
   * choice 条件未達) でブロックされ、効果を発揮できない prompt の drain 専用 action。
   * apply は resolver を実行せず prompt を除去する (skipOptionalEffect と同経路)。
   * これが無いと発揮も skip もできない prompt が battleImmediateEffects に滞留し、
   * アタックが進行不能になる (queueRegisteredBattleImmediateEffects の usageLimit
   * 事前 skip と同じ方針の解決時版)。
   */
  skipOnly?: true;
}

interface HandCardCostLegalActionBase {
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  /**
   * D-2 Phase 2 chooser メタデータ: 対象選択を委ねるプレイヤー ID。
   * 召喚 / ネクサス配置は手札からの直接起動型のため、actingPlayerId は
   * 起動プレイヤー (= ソース管理者) のまま据え置きで GUI が target prompt を
   * chooserPlayerId 宛にルーティングする想定 (metadata-only)。
   * 省略時 = actingPlayerId と同じ (自分が選ぶ)。
   */
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  reducedCost: number;
  additionalCost: number;
  finalCost: number;
  totalReduction: number;
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
  enterFieldCorePlacementRule: EnterFieldCorePlacementRule;
  maximumEnterFieldCoreCount: number | null;
}

export interface UseMagicLegalAction {
  kind: "use_magic";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  timing: "main" | "flash" | "stack";
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /**
   * 通常の use_magic 宣言に先立ち、別カードの pre-cost 使用権が現在有効であることを
   * engine が示す metadata。UI はこの印を見た場合、元マジックの支払い選択を先行させず
   * action を engine へ渡して pending decision を開く。実際の対象判定・中断は apply 側の
   * SSOT が再検証するため、この情報自体は許可を与えない。
   */
  preCostTriggerOffer?: {
    sourceInstanceId: string;
    sourceDefinitionId: string;
    effectIndex: number;
  };
  /** 宣言時 registration から導出した使用元ゾーン。apply 側の zone 検証にも使う。 */
  allowedSourceZones?: readonly Zone[];
  /** 解決対象の DSL effect index（deferred magic 解決で targetEffectIndex として渡す）。 */
  effectIndex?: number;
  /** choice ステップの選択肢インデックス。0=デフォルト action、1+=choice[N-1]。 */
  choiceIndex?: number;
  /** choice 表示用の短いラベル（例: "ブロックされない", "アタック終了"）。 */
  choiceLabel?: string;
  /** 単一効果内 choice を宣言時に分岐させず、スタック窓後に選ぶための候補 index。 */
  deferredChoiceIndexes?: readonly number[];
  targetStepId?: string;
  targetGroups?: readonly LegalActionTargetGroup[];
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  /**
   * D-2 Phase 2 chooser メタデータ: 対象選択を委ねるプレイヤー ID。
   * magic は手札 / set_aside からの直接使用型のため、actingPlayerId は
   * 使用プレイヤー (= ソース管理者) のまま据え置きで GUI が target prompt を
   * chooserPlayerId 宛にルーティングする想定 (metadata-only)。
   * 省略時 = actingPlayerId と同じ (自分が選ぶ)。
   */
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetZones?: readonly Zone[];
  candidateTargetInstanceIds: string[];
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  reducedCost: number;
  additionalCost: number;
  finalCost: number;
  totalReduction: number;
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
  onBoardCoreSourceFilter?: CardFilter;
  /**
   * "paid": 通常コスト支払い、"free": cost_override CE による無料使用 (パチュリー型)、
   * "override": cost_override CE (amount>0) による上書きコスト使用
   * (P2-05 Phase 4a, XX01「相手はマジックカードを1コストで使用できる」)。
   * 同一マジック × 同一 timing で複数モードが push される場合があり、
   * GUI ではコストモード選択モーダルで分岐させる。
   */
  costMode:
    | "paid"
    | "free"
    | "override"
    | "zone_discount"
    | "zone_discount_variable";
  /** costMode === "free" / "override" のとき、根拠 CE のソースカード instanceId (UI 表示用)。 */
  costOverrideSourceInstanceId?: string;
  /** costMode === "override" の根拠 CE が usageLimit を持つ場合、宣言時に消費する。 */
  costOverrideUsageLimit?:
    | import("../model").EffectUsageLimit
    | import("../model").EffectUsageLimit[];
  costOverrideLimitGroupId?: string;
  costOverrideEffectLabel?: string;
  /** costMode === "override" のときの上書きコスト (= finalCost)。 */
  overrideCost?: number;
  /** costMode === "zone_discount" のときのコスト減少量（負数）。 */
  zoneCostDiscountAmount?: number;
  /** costMode === "zone_discount" | "zone_discount_variable" のとき、対象候補カード。 */
  zoneCostPaymentCandidateIds?: string[];
  /** costMode === "zone_discount" のとき、戻す必要枚数（固定）。 */
  zoneCostPaymentCount?: number;
  /**
   * costMode === "zone_discount_variable" のとき、1枚あたりのコスト減少量（負数）
   * (BSAZ03-M01 effects[1b]「破棄1枚につきコストを-1する」)。
   */
  zoneCostDiscountPerCard?: number;
  /** costMode === "zone_discount_variable" のとき、選択可能な最大枚数。 */
  zoneCostPaymentMaxCount?: number;
}

export interface UseAccelLegalAction {
  kind: "use_accel";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  timing: "main" | "flash";
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  reducedCost: number;
  additionalCost: number;
  finalCost: number;
  totalReduction: number;
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
  /**
   * "paid": 通常コスト支払い、"free": cost_override CE による無料使用
   * (ENGINE-accel-tribe-cost-override、BSTH08.5-R12「自分の系統：面霊のアクセルコストを0に
   * できる」型)。省略時は "paid" と同義 (UseMagicLegalAction.costMode と対称)。
   * 通常コストを払えなくても free が使えるカードは "free" のみが push される。
   */
  costMode?: "paid" | "free";
  /** costMode === "free" のとき、根拠 CE のソースカード instanceId (UI 表示用)。 */
  costOverrideSourceInstanceId?: string;
  /** costMode === "free" の根拠 CE が usageLimit を持つ場合、宣言時に消費する。 */
  costOverrideUsageLimit?:
    | import("../model").EffectUsageLimit
    | import("../model").EffectUsageLimit[];
  costOverrideLimitGroupId?: string;
  costOverrideEffectLabel?: string;
}

export interface UseChangeLegalAction {
  kind: "use_change";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  reducedCost: number;
  additionalCost: number;
  finalCost: number;
  totalReduction: number;
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
  /** 入れ替え候補のスピリット instanceId 群 */
  swapCandidateInstanceIds: string[];
}

/**
 * 煌臨宣言 (declare_advent)。手札からソウルコアを消費してフィールドの
 * スピリット/アルティメット (契約/F契約煌臨では魂状態/ネクサス含む) の上に
 * カードを重ねる。召喚ではない。
 *
 * 増分2: 通常煌臨 + 契約煌臨 + F契約煌臨 の宣言を配線する。
 * `adventMode` はカードの adventData.adventVariant 由来で、availability が
 * 列挙器 (getAdventTargets / getContractAdventTargets /
 * getFContractAdventTargets) を選んで candidateTargetInstanceIds を埋める。
 * apply 側はこの値で executeAdvent の isContractAdvent / isFContractAdvent を立てる。
 * 宣言時には対象を選ばず、スタック窓クローズ後に
 * `resolve_pending_effect_target` で単体を選ぶ (requiredTargetCount: 1)。
 * `candidateTargetInstanceIds` は宣言可否/UI表示用の宣言時スナップショット。
 */
export interface DeclareAdventLegalAction {
  kind: "declare_advent";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  candidateTargetInstanceIds: string[];
  targetMode: "manual";
  requiredTargetCount: 1;
  /**
   * 煌臨種別。
   * - "normal": 通常煌臨 (getAdventTargets)。
   * - "contract": 契約煌臨 (getContractAdventTargets、魂状態の契約カード含む)。
   * - "f_contract": F契約煌臨 (getFContractAdventTargets、魂状態+ネクサス含む)。
   */
  adventMode: "normal" | "contract" | "f_contract";
  /**
   * ソウルコア消費先 (スピリット→trash、アルティメット→removed_from_game、
   * カード固有効果による上書きは this_card)。
   */
  soulCoreDest: "trash" | "removed_from_game" | "this_card";
  /**
   * 煌臨元 (このカード) を取り出すゾーン (08a §1 手順1)。
   * - "hand" (既定): 通常の手札からの煌臨。
   * - "trash": トラッシュ起点煌臨 (BSAZ01-C01/C02)。apply 側で
   *   〔ターンに1回:同名〕の usedTrashAdventKeysThisTurn 記録と
   *   chargeCoresOnAdvent の任意コア配置を gate する。
   */
  adventSourceZone: "hand" | "trash";
  /**
   * 煌臨後にフィールド/リザーブのコアを好きなだけ置けるか
   * (adventData.chargeCoresOnAdvent、BSAZ01「コアを好きなだけ置く」)。
   */
  chargeCoresOnAdvent: boolean;
  /** 互換フィールド。通常/代替コスト経路の選択は窓後 pending で行う。 */
  useAlternateCost: boolean;
}

/**
 * 煌臨宣言の結果。増分1 は即時解決のため state のみを返す
 * (accel/change のような deferred ActiveStack 窓は後続増分で導入)。
 */
export interface DeclareAdventResult {
  state: GameState;
}

/**
 * host 側同時2体煌臨の単体宣言 (declare_host_dual_advent、BSDB01-CX01【真バディ】)。
 * 1宣言=1体 (裁定確定 2026-07-13、issues/P3-117): `sourceInstanceId` は許可を持つ
 * host 側カード (このカード自身、魂状態/煌臨元を含む)、`candidateTargetInstanceIds` は
 * host の `hostDualAdventGrant.slots` のうち **まだ埋まっていないスロット** いずれかを
 * 満たす手札カードの union (targetMode:"manual", requiredTargetCount:1、単一選択)。
 * host は2枚の occupant を並行/分岐で保持するため、片方のスロットが埋まっていても
 * 反対側スロットが空なら emit され続ける。
 */
export interface DeclareHostDualAdventLegalAction {
  kind: "declare_host_dual_advent";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  candidateTargetInstanceIds: string[];
  candidateTargetZones: readonly Zone[];
  targetMode: "manual";
  requiredTargetCount: 1;
  hostCoreDistributionOnAdvent: boolean;
  /** 互換フィールド。通常/代替コスト経路の選択は窓後 pending で行う。 */
  useAlternateCost: boolean;
}

/**
 * 多重煌臨宣言 (declare_dual_host_advent、BSSG01-X03「暁 切歌＆月読 調『アマルガム』」、
 * 裁定確定 2026-08-01)。`declare_host_dual_advent`（host 側が2枚の occupant を分岐で
 * 保持する逆方向パターン）とは別軸: 本アクションは「煌臨する側」1枚 (sourceInstanceId)
 * が、2つの host スロット条件 (`CardDefinition.dualHostAdventData.hostSlotConditions`)
 * を同時に満たす自分のフィールドカード2体を対象に選ぶ (targetMode:"manual",
 * requiredTargetCount:2)。`candidateTargetInstanceIds` は両スロットのいずれかを満たす
 * host 候補の union。選択順序が状態引き継ぎの優先度を表す:
 * `targetInstanceIds[0]` = 「上」(直接の煌臨先、状態引き継ぎ側)、
 * `targetInstanceIds[1]` = 「下」(単純に畳まれる、コアのみ統合先へ合算)。
 * 実際にどちらが2つのスロット条件を満たす有効な組み合わせかの検証は、宣言時点ではなく
 * スタック窓クローズ後の deferred 解決 (`resolveDeferredDualHostAdventStack`) で行う
 * (declare_advent と同型、宣言後の窓中の state 変化を許容するため)。
 */
export interface DeclareDualHostAdventLegalAction {
  kind: "declare_dual_host_advent";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  candidateTargetInstanceIds: string[];
  targetMode: "manual";
  requiredTargetCount: 2;
  /** ソウルコア消費先 (dualHostAdventData.soulCoreDest、両スロット共通・1回のみ消費)。 */
  soulCoreDest: "trash" | "removed_from_game" | "this_card";
}

/**
 * 顕現宣言 (declare_manifest)。手札のカードを、自分のソウルコア(トラッシュへ)+対象で
 * 指定されたネクサスのコア1個を召喚コストとして支払うことで手札から召喚する。
 * declare_advent と同型のスタック窓化パターン (P3-112) だが、召喚の一種であり
 * adventMode のような種別分岐は無い (対象は単体、requiredTargetCount: 1)。
 */
export interface DeclareManifestLegalAction {
  kind: "declare_manifest";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  candidateTargetInstanceIds: string[];
  targetMode: "manual";
  requiredTargetCount: 1;
  /** ソウルコア消費先（顕現の代替コスト）。 */
  soulCoreDest: "trash" | "removed_from_game" | "this_card";
}

export interface SetBurstLegalAction {
  kind: "set_burst";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  replacedBurstInstanceId: string | null;
}

export interface SetMirageLegalAction {
  kind: "set_mirage";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** 選択済みの交換対象。0件で追加、1件でその個体との交換。 */
  replacedMirageInstanceIds: string[];
  mirageCost: number;
  mirageReduction: import("../model").SymbolColor[];
  /**
   * P3-128: GUI コスト支払い配線に必要な支払い候補。summon/use_magic と同型
   * (`getAvailableCardCostPaymentSources` 由来)。mirageCost の軽減後実コスト。
   */
  finalCost: number;
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
}

export interface SetQuartzLegalAction {
  kind: "set_quartz";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** セットするクォーツカード（手札）。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** セット先 host（魂状態）。 */
  hostInstanceId: string;
  hostCardNo: string;
  /** 入れ替えるセット中クォーツ。省略時は空き位置へ追加。 */
  replacedQuartzInstanceId?: string;
  replacedQuartzName?: string;
  /** セット位置（左右3＋中央1）。 */
  slot: "left" | "center" | "right";
  /** カウント消費コスト（C2 等）。 */
  quartzCountCost: number;
}

/**
 * 契約/魂状態カードを手札から魂状態化するアクション（ENIGMA「手札/手元にあるこのカードは
 * 自分のメインステップに魂状態にできる」）。enter_soul_state action を field 移動付きで実行する。
 */
export interface ActivateSoulStateLegalAction {
  kind: "activate_soul_state";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** 魂状態化するカード（手札/手元）。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** 魂状態化の起動効果の effect index。 */
  effectIndex: number;
}

export interface SummonLegalAction extends HandCardCostLegalActionBase {
  kind: "summon";
  minimumRequiredCores: number;
  minimumEnterFieldCoreCount: number;
  requiresEnterFieldCorePlacements: boolean;
  fixedPaymentCost?: number;
  baseCostOverride?: number;
  onBoardCoreSourceFilter?: CardFilter;
  summonPermissionEffectIndex?: number;
  summonPermissionUsageLimit?: EffectUsageLimit | EffectUsageLimit[];
  summonPermissionLimitGroupId?: string;
  /**
   * true のとき、この summon action を選ぶと即座には召喚せず
   * pendingSummonCostExcludeChoice を開く（トラッシュ除外による可変コスト軽減選択、
   * BSTH02.7-M01 effects[0] 等）。選択解決後、additionalCostModifiers 付きで召喚を実行する。
   */
  opensCostExcludeChoice?: boolean;
  /** opensCostExcludeChoice のとき: 割引を提供する継続効果の effects[] インデックス。 */
  costExcludeEffectIndex?: number;
  /** opensCostExcludeChoice のとき: 選択可能な最大除外枚数。 */
  costExcludeMaxCount?: number;
  /** opensCostExcludeChoice のとき: 除外1枚につきの追加コスト軽減量。 */
  costExcludeDiscountPerCard?: number;
  /** opensCostExcludeChoice のとき: 除外候補（フィルタ適用済みの自分の対象ゾーン instanceId）。 */
  costExcludeCandidateInstanceIds?: string[];
  /**
   * opensCostExcludeChoice のとき: 除外元ゾーン (engine-alt-cost-summon-multizone)。
   * 省略時は従来どおり "trash"。
   */
  costExcludeSourceZone?: "trash" | "field" | "hand_or_set_aside";
  /**
   * opensCostExcludeChoice のとき: 必須除外枚数 (engine-alt-cost-summon-multizone)。
   * 0/省略時は任意（従来挙動）。
   */
  costExcludeMinCount?: number;
  /**
   * true のとき、opensCostExcludeChoice の除外は線形割引ではなく
   * `costModifier:"full_reduction"` 相当に合流する
   * (ENGINE-summon-self-exclude-alt-cost-full-reduction, BSTH11-M01 effects[0])。
   */
  costExcludeFullReduction?: boolean;
  costExcludeFullCostPaid?: boolean;
  /**
   * true のとき、この summon action を選ぶと即座には召喚せず
   * pendingSummonCostCoreMoveChoice を開く（トラッシュのコアをフィールド/リザーブに
   * 置く代替コスト支払い選択、BSSL01-M02 effects[0,1]）。選択解決後、
   * additionalCostModifiers 付きで召喚を実行する。
   */
  opensCostCoreMoveChoice?: boolean;
  /** opensCostCoreMoveChoice のとき: 支払いを提供する継続効果の effects[] インデックス。 */
  costCoreMoveEffectIndex?: number;
  /** opensCostCoreMoveChoice のとき: 必須移動枚数下限。 */
  costCoreMoveMinCount?: number;
  /** opensCostCoreMoveChoice のとき: 選択時点で移動可能なトラッシュのコア総数。 */
  costCoreMoveAvailableCoreCount?: number;
  /** opensCostCoreMoveChoice のとき: 相殺する追加コスト量（正の整数）。 */
  costCoreMoveOffset?: number;
  costCoreMoveGrantsFreeSummon?: boolean;
  /** opensCostCoreMoveChoice のとき: 移動先「フィールド」候補の自分のフィールドカード instanceId。 */
  costCoreMoveFieldDestinationCandidateInstanceIds?: string[];
  /**
   * BSAZ02-C08【月面基地】: 発揮元(このネクサス自身)を疲労させることで召喚条件無視/
   * 軽減シンボル全充足を選べる代替コスト (grant_declared_summon_alt_cost CE)。
   * 設定時、この summon action を選ぶと baseCostOverride の代替コストで召喚を実行し、
   * 同時にこの instanceId のカードを疲労させる (legal-actions-apply.ts 側で処理)。
   */
  declaredSummonAltCostGrantSourceInstanceId?: string;
}

export interface PlaceNexusLegalAction extends HandCardCostLegalActionBase {
  kind: "place_nexus";
  minimumEnterFieldCoreCount: number;
  requiresEnterFieldCorePlacements: boolean;
  /** 固定コスト配置（「コスト N として配置」）。summon 許可と同型。 */
  fixedPaymentCost?: number;
  /** 総コスト上書き後に軽減を適用する配置許可（「コストNにする」）。 */
  baseCostOverride?: number;
  /** 効果由来の配置コストで、場のコア支払い元を対象カードへ限定する。 */
  onBoardCoreSourceFilter?: CardFilter;
  /**
   * 自己配置許可効果（「手札/手元にあるこのネクサスは配置できる」）由来の場合の
   * 効果インデックス。summon 許可（SummonLegalAction.summonPermissionEffectIndex）の
   * ネクサス版。usageLimit 記録のキーに使う。
   */
  placePermissionEffectIndex?: number;
  placePermissionUsageLimit?: EffectUsageLimit | EffectUsageLimit[];
  placePermissionLimitGroupId?: string;
}

export interface AttackLegalAction {
  kind: "attack";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  battleEntityId: string;
  targetInstanceId?: string; // 指定アタック対象のインスタンスID (未設定=通常アタック)
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
   * 同時アタック宣言オプション (P2-05)。allow_simultaneous_attack CE が有効で、
   * このアタッカー自身が filter に合致し、他に合流可能な候補がいる場合のみ付与される。
   * 通常アタック (targetInstanceId 未設定) のみ。
   */
  simultaneousAttackOption?: {
    /** 合流候補 (このアタッカー自身は含まない)。 */
    candidateInstanceIds: string[];
    /** 最大同時アタック数 (このアタッカー自身を含む)。 */
    maxCount: number;
    /** 許可を発揮しているカード (UI のソース表示用)。 */
    grantSourceInstanceId: string;
  };
  /**
   * 入力: 同時アタック宣言時にクライアントが設定する追加参加カード
   * (candidateInstanceIds から maxCount - 1 体まで)。
   */
  additionalSourceInstanceIds?: string[];
}

/**
 * アタック宣言の代替宣言 (BSDB01-TX01(A) 型、CardDefinition.attackAlternativeFlip)。
 * `attack` と同じ legality (`getAttackDeclarationBlockReason`) を共有する自身完結型の
 * 宣言で、targetInstanceId/コスト源選択等は持たない (対象・コストが無いカード本文のため)。
 */
export interface FlipInsteadOfAttackLegalAction {
  kind: "flip_instead_of_attack";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
}

/**
 * 途中合流アタック宣言 (P2-05 Phase 5)。allow_mid_battle_join CE が有効で、自分の
 * アタックステップ中に召喚され filter に合致するカードが、進行中のアタック
 * (window:"declare_attack" = 相手のブロック宣言前) へただちに参加できるときに付与される。
 * apply は既存 `joinActiveAttackAsAction` (joinMode:"mid_battle") を呼ぶ。
 */
export interface JoinActiveAttackLegalAction {
  kind: "join_active_attack";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  attackId: string;
  /** 許可を発揮しているカード (UI のソース表示用)。 */
  grantSourceInstanceId: string;
  /** attack_exhaust_cost_gate の支払いに疲労させるカード。 */
  attackExhaustCostSourceInstanceId?: string;
  /** attack_exhaust_cost_gate が重複したときの支払い元一覧。 */
  attackExhaustCostSourceInstanceIds?: string[];
  /** battle_destroy_cost_gate_attack/both の支払いに破壊するカード (BSDB01-C09)。 */
  battleDestroyCostSourceInstanceId?: string;
  /** battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
}

export interface DeclineImmediateAttackJoinLegalAction {
  kind: "decline_immediate_attack_join";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  attackId: string;
}

export interface BlockLegalAction {
  kind: "block";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  blockerEntityId: string;
  participantEntityId: string;
  attackId: string;
  /** battle_destroy_cost_gate_block/both の支払いに破壊するカード (BSDB01-C09)。 */
  battleDestroyCostSourceInstanceId?: string;
  /** battle_destroy_cost_gate が重複したときの支払い元一覧。 */
  battleDestroyCostSourceInstanceIds?: string[];
}

export interface OpenBattleFlashLegalAction {
  kind: "open_battle_flash";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  attackId: string;
  flashKind: "before_block" | "after_block";
}

export interface PassBattleFlashLegalAction {
  kind: "pass_battle_flash";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  attackId: string;
  flashKind: "before_block" | "after_block";
  /**
   * このパスがフラッシュ本体のパスか、内側スタックサブ窓への応答パスかの判別。
   * `pass_battle_flash` は両者で共用されるため、GUI ラベル ("フラッシュパス" /
   * "スタックパス") を出し分けるために窓状態 (pendingStackAction 有無) から導出する。
   * 判定ロジックは `getResponseWindowActionTimings()` に一元化。
   */
  responseTiming: "flash" | "stack";
}

export interface PassStackLegalAction {
  kind: "pass_stack";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
}

export interface PassStackResult {
  state: GameState;
}

export interface PassPreDeclarationStackLegalAction {
  kind: "pass_pre_declaration_stack";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  declarationKind: "attack" | "block" | "forced_block" | "join_active_attack";
}

/**
 * P3-55 Phase B: 防御側プレイヤーが「ブロックしない」を意思表示する legal action。
 * before_block flash 終了直後に防御側のみ available。apply 時に直接 battle resolution
 * (group 生成 + BP 比較 + ライフ減少 + entity 破壊 + listener pending) まで完了する。
 *
 * 旧 `start_battle_resolution` (active 側 trigger) を「ブロックしない」表現に置き換え、
 * after_block close からの解決は `pass_battle_flash` apply の auto-chain で行う。
 */
export interface DeclineBlockLegalAction {
  kind: "decline_block";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  attackId: string;
}

export interface EndAttackStepLegalAction {
  kind: "end_attack_step";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
}

export interface BraveCombineLegalAction {
  kind: "brave_combine";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** ブレイヴの instanceId */
  braveInstanceId: string;
  braveCardNo: string;
  /** 合体先スピリットの instanceId */
  targetInstanceId: string;
  targetCardNo: string;
}

/**
 * 契約合体（フラッシュ【契約合体：<条件>】、P3-111 S2 自己完結型）。
 * `brave_combine`（フィールド上の未合体ブレイヴの直接合体、main 限定・コスト無し）とは別経路:
 * - 発動元は手札（召喚コストは支払わない）。
 * - 起動コストは自分のソウルコアをトラッシュに置くこと（`CardDefinition.contractCombineData`
 *   の `braveCondition` で対象ホストを、`timingScope` で発動可能な窓を規定）。
 * - 対象ホストに既に合体中のブレイヴがいれば、そのブレイヴはトラッシュへ送られてから
 *   このブレイヴが合体する（「合体していたブレイヴは破棄する」）。
 */
export interface ContractCombineLegalAction {
  kind: "contract_combine";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** 手札のブレイヴの instanceId */
  braveInstanceId: string;
  braveCardNo: string;
  /** 宣言時点で契約合体先になりうる候補。解決時に現在盤面から再計算される。 */
  candidateTargetInstanceIds: string[];
  targetMode: "manual";
  requiredTargetCount: 1;
  /**
   * 旧クライアント/テスト互換フィールド。apply 側では宣言時対象として採用せず、
   * スタック後 pendingEffectTargetSelection の選択だけを解決対象にする。
   */
  targetInstanceId?: string;
  targetCardNo?: string;
  /** 互換フィールド。プロキシ起動の選択は窓後 pending で行う。 */
  costWaived?: boolean;
  /** プロキシ起動元カードの instanceId（使用制限記録キー。costWaived のときのみ設定）。 */
  proxySourceInstanceId?: string;
  /** プロキシ起動元の対象カード名制限（窓後 pending で固定して deferred 解決へ渡す）。 */
  proxyTargetCardNames?: import("../dsl-types").CardNameMatch[];
}

/**
 * リンクエイド（【リンクエイド】、P3-111 S6、BSGE01-CX01〜CX04/R01〜R05）。
 * 魂状態のカードが発揮宣言し、スタック窓クローズ後に効果文内コストの支払い元を選んで
 * リザーブのコアを好きなだけ置いてスピリット状態になる。
 * 召喚扱いではない state-change（召喚時効果は誘発しない、10_rules/07b §リンクエイド）。
 */
export interface LinkAidLegalAction {
  kind: "link_aid";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** 魂状態のカード（起動対象）の instanceId。 */
  soulStateCardInstanceId: string;
  soulStateCardNo: string;
  /** 旧クライアント/保存状態互換。現行 action では宣言時に支払い元を持たない。 */
  costSourceInstanceId?: string;
  costSourceCardNo?: string;
}

export interface ResolvePendingLinkAidCostSourceChoiceLegalAction {
  kind: "resolve_pending_link_aid_cost_source_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  soulStateCardInstanceId: string;
  soulStateCardNo: string;
  /** フィールドカード instanceId、または override 時のみリザーブのセンチネル `"reserve"`。 */
  costSourceInstanceId: string;
  costSourceCardNo?: string;
  availableNormalCoreCount: number;
}

/**
 * 手札/手元⇔トラッシュの1対1入替（engine-atomic-hand-trash-swap-legal-action、
 * BSTH02.7-TR03(A)【神秘】等）。`PendingHandTrashSwapChoice` が立っている間だけ、
 * その候補一覧の cross product として列挙される（両側とも候補が確定済みのため、
 * このアクション自体は常に atomic に成立する）。適用時、出す側カードの現在ゾーン
 * （手札/手元のどちら）をそのまま入る側カードの行き先にする。
 */
export interface SwapHandTrashLegalAction {
  kind: "swap_hand_trash";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 効果の発動元カード（例: 「アリスの人形工房」）。 */
  sourceInstanceId: string;
  sourceCardNo: string;
  /** 手札/手元から出すカードの instanceId。 */
  outgoingCardInstanceId: string;
  outgoingCardNo: string;
  /** トラッシュから入れるカードの instanceId。 */
  incomingCardInstanceId: string;
  incomingCardNo: string;
}

/** `PendingHandTrashSwapChoice` を辞退する（「入れ替えられる」＝任意のため）。 */
export interface DeclineHandTrashSwapLegalAction {
  kind: "decline_hand_trash_swap";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
}

/**
 * フィールドの発動元カード⇔手札カードの1対1入替。
 * 入るカードは回復状態でフィールドに置かれ、召喚イベントは発火しない。
 */
export interface SwapFieldHandLegalAction {
  kind: "swap_field_hand";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceCardNo: string;
  incomingCardInstanceId: string;
  incomingCardNo: string;
}

/** `PendingFieldHandSwapChoice` を辞退する。 */
export interface DeclineFieldHandSwapLegalAction {
  kind: "decline_field_hand_swap";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
}

/**
 * ブレイヴ召喚のスタック窓クローズ後の「合体する/スピリット状態」選択を解決するアクション。
 *
 * ルール正源: `10_rules/02_turn-flow-and-timing.md`「コスト支払い完了後に窓が開く」
 * ＋ `10_rules/05_brave-and-attack-special-cases.md`「召喚時にすぐに合体させることもできる」。
 * 合体可否・合体先 host の選択はスタック窓より後 (解決時) に行う。コストは召喚宣言時に支払い済み。
 * - `chosenHostInstanceId` 指定 = その host へ直接合体 (以後の場入りコアは任意 0+)。
 * - `chosenHostInstanceId: null` = スピリット状態で場入り (場入りコアは Lv1)。
 * 各候補 host ＋ スピリット状態を別アクションとして列挙する。
 */
export interface ResolveBraveCombineChoiceLegalAction {
  kind: "resolve_brave_combine_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  braveInstanceId: string;
  braveCardNo: string;
  /** 合体先ホスト instanceId。null = スピリット状態 (合体しない)。 */
  chosenHostInstanceId: string | null;
  /** 合体先カードの cardNo (host 選択時のみ)。GUI 表示用。 */
  hostCardNo?: string;
}

/**
 * 転召（召喚手順内ステップ）のスタック窓クローズ後・場入り前、強制コア消費の対象を選ぶアクション。
 *
 * ルール正源: `10_rules/07b_card-observed-mechanics.md` 転召節 + `10_rules/02`:188。
 * 対象1体の上のコアすべてが送り先（ボイド等）へ移る。対象候補は pending 生成時に確定する。
 * コストは召喚宣言時に支払い済み。この転召ステップ専用のスタック窓は開かない。
 */
export interface ResolveTenshoSummonLegalAction {
  kind: "resolve_tensho_summon";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 召喚中（場入り前）のスピリット instanceId。 */
  summoningInstanceId: string;
  /** 強制コア消費の対象 instanceId。 */
  chosenTargetInstanceId: string;
  /** 対象カードの cardNo（GUI 表示用）。 */
  targetCardNo?: string;
}

/**
 * 逆転醒 pattern2（裏返して配置/召喚）の解決アクション（P3-98）。
 *
 * 支払いソース + 維持コア配置はオプションの `summonPaymentSources` /
 * `summonEnterFieldCorePlacements`（既存 summon と同経路、GUI は同 HUD を流用）で渡す。
 * withoutCost のとき支払い 0。
 */
export interface ResolveReverseRebirthSummonLegalAction {
  kind: "resolve_reverse_rebirth_summon";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 逆転醒する場の B 面 instance。 */
  sourceInstanceId: string;
  /** 変換先の表面 def cardNo（GUI 表示用）。 */
  frontDefinitionId: string;
  /** 支払うべき軽減後コスト（GUI 表示用）。 */
  costToPay: number;
  /** 維持コア最低数（GUI 表示用）。 */
  minimumCoreCount: number;
}

export interface BraveSeparateLegalAction {
  kind: "brave_separate";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** 合体スピリット（ホスト）の instanceId */
  hostInstanceId: string;
  /** ブレイヴの instanceId */
  braveInstanceId: string;
}

export interface BraveSwapLegalAction {
  kind: "brave_swap";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** 元のホストの instanceId */
  fromHostInstanceId: string;
  /** ブレイヴの instanceId */
  braveInstanceId: string;
  /** 新しいホストの instanceId */
  toHostInstanceId: string;
}

// ─── DeckReveal pending ───

/** デッキオープン効果: ピックグループ選択 */
export interface ResolvePendingDeckRevealPickLegalAction {
  kind: "resolve_pending_deck_reveal_pick";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 現在のピックグループインデックス */
  pickIndex: number;
  /** このグループで選択可能なカード instanceId */
  candidateCardInstanceIds: string[];
  /** このグループで選択できる最大枚数 */
  maxPickCount: number;
  /** スキップ可能か（"〜枚まで" は常に true） */
  canSkip: boolean;
  /** 本文の手札増加1イベントの対価。revealed_choice は効果元カードごとに必要。 */
  handGainCost?: number;
  /**
   * 排他選択グループ（`DeckRevealPick.exclusiveGroup`）のブランチ一覧。
   * 設定時、`candidateCardInstanceIds`/`maxPickCount` は全ブランチの合算（union/max）。
   * 実際に確定できるのは、いずれか1ブランチの `count`（`candidateCardInstanceIds`
   * の部分集合）を過不足なく満たす選択のみ（「AすべてかB1枚」BSTH08.5-X03 型）。
   */
  exclusiveGroupBranches?: Array<{
    count: number;
    candidateCardInstanceIds: string[];
    /** このブランチ選択に要求される追加コスト（`DeckRevealPick.costGate`）。表示用。 */
    costGate?: number;
  }>;
  /**
   * true の場合、確定 (resolve) 時に `ApplyLegalActionOptions.deckRevealPickFreeDestination`
   * (`"hand"|"set_aside"`) が必要 (`DeckRevealPick.destination === "hand_or_set_aside_choice"`、
   * BSTH08.5-C23)。swap 型と異なり交換相手が不要なため、別 pending を起こさず同一アクションの
   * 追加入力として解決する。0 枚選択 (skip) 時は省略可。
   */
  requiresFreeDestinationChoice?: boolean;
  /**
   * `hand_or_set_aside_choice` のうち現在実際に選べる行き先。手札増加禁止 CE が
   * 効果発揮者自身に掛かる場合は、純増しない `"set_aside"` だけを公開する。
   * 省略時は従来どおり両方 (`"hand" | "set_aside"`) を選べる。
   */
  freeDestinationChoices?: Array<"hand" | "set_aside">;
}

/** デッキオープン効果: 残りカードの順番指定 */
export interface ResolvePendingDeckRevealOrderLegalAction {
  kind: "resolve_pending_deck_reveal_order";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 順番を指定すべき残りカードの instanceId */
  remainingCardInstanceIds: string[];
  /** 残りカードの行き先。"top_or_bottom" は一括上下選択、"top_bottom_split" はカード別上下分配 */
  remainder:
    | "top"
    | "bottom"
    | "top_or_bottom"
    | "top_bottom_split"
    | "bottom_or_trash"
    | "trash";
}

/**
 * 非公開ゾーン（デッキ/トラッシュ/手札）からのカード選択を解決するアクション。
 */
export interface ResolvePendingZoneSelectionLegalAction {
  /** 課税される手札回収には任意の支払い/拒否を提示する。枚数の上限/強制性とは独立。 */
  handGainCost?: number;
  kind: "resolve_pending_zone_selection";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** トリガーしたアクション種別 */
  actionKind:
    | "brave_separation"
    | "bounce"
    | "search_deck"
    | "return_from_trash"
    | "discard_hand"
    | "advent_source"
    | "move_to_set_aside";
  /** 選択候補のカード instanceId リスト */
  candidateCardInstanceIds: string[];
  /** 選択できる最大枚数 */
  maxCount: number;
  /** スキップ可能か */
  canSkip: boolean;
  /** deck_reveal swap-out が top/bottom を選べる場合の選択肢 */
  swapPlacementOptions?: Array<"top" | "bottom">;
  /**
   * true の場合、確定 (resolve) 時に選択カードごとの
   * `ApplyLegalActionOptions.zoneSelectionDestinationByCardId`
   * (`"hand"|"set_aside"`) が必要。
   */
  requiresPerCardDestinationChoice?: boolean;
  /**
   * `requiresPerCardDestinationChoice` の各カードに対して現在選べる行き先。
   * `hand_gain_prevention` / `hand_gain_cost_gate` のように、手札だけを禁止または
   * 課税する継続効果があるときも、手元を選ぶ正当な経路は残す。
   */
  perCardDestinationChoices?: Record<string, Array<"hand" | "set_aside">>;
  /**
   * OR 形式の代替選択条件。例: primary=3枚, alt=紅魔1枚。
   * いずれかの条件を満たせば確定可能。`filter` は UI 表示用 (人間可読ラベル自動生成)。
   */
  alternateSelections?: Array<{
    count: number;
    candidateInstanceIds: string[];
    label?: string;
    filter?: import("../dsl-types").CardFilter;
  }>;
}

/**
 * `EffectStep.executionMode === "optional"` ステップの execute / decline 選択を解決するアクション。
 *
 * 「前段は強制実行、後段は任意」効果 (memory project_kuwaerareru_optional) で頻出。
 * execute 時は当該 step から executeEffect を再開、decline 時は次 step から再開する。
 */
export interface ResolvePendingStepOptionalChoiceLegalAction {
  kind: "resolve_pending_step_optional_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  /**
   * Provenance for replays/training coverage. Unlike sourceInstanceId, this
   * remains usable after the source has left the visible observation.
   */
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  /** SSOT: execute=実行, decline=辞退。GUI/server passthrough は本フィールドのみ参照する。 */
  choice: "execute" | "decline";
  /**
   * optionalQuantity 付き pending で execute する数量。省略時は pending 側 max (=従来 execute)。
   * decline は常に 0 として扱う。
   */
  selectedAmount?: number;
  /** optionalQuantity 付き pending の UI/API 表示用範囲。 */
  minAmount?: number;
  maxAmount?: number;
  quantityKind?: "core_move" | "draw" | "discard";
  /** UI 表示用 (省略時 fallback は step.id か `__step_<i>`)。 */
  stepLabel?: string;
  /** UI/API 表示用: 効果内のどの任意処理かを示す step 単位 prompt。 */
  prompt?: PendingStepPrompt;
}

/**
 * `EffectStep.choice` の分岐選択を解決するアクション。
 * choiceIndex は 0=デフォルト action、1+=choice[N-1]。
 */
export interface ResolvePendingStepChoiceLegalAction {
  kind: "resolve_pending_step_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  /**
   * Provenance for replays/training coverage. Unlike sourceInstanceId, this
   * remains usable after the source has left the visible observation.
   */
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  choiceIndex: number;
  choiceLabel: string;
  /**
   * 選択した枝で必要になる effect 内 `pay_cost` の合計。
   * training input が `deferPayCostSourceSelection` を提示するために使う。
   */
  requiredPayCostAmount?: number;
  stepLabel?: string;
  /** UI/API 表示用: choice 全体の問い。 */
  prompt?: PendingStepPrompt;
  /** UI/API 表示用: この choice option の意味。 */
  choicePrompt?: PendingStepPrompt;
}

/**
 * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): 連続バトル (BSTH06-X03【三歩必殺】)
 * の続行/終了選択を解決するアクション。Q9095「1回のバトルが終わるたびに続けてバトルするか、
 * バトルを終了するかを選ぶ」。
 * `choice:"continue"` はブロック前フラッシュタイミングへ戻り `remainingUses` を 1 消費、
 * `choice:"end"` は通常の battle_end 誘発経路へ進む。
 */
export interface ResolveConnectBattleDecisionLegalAction {
  kind: "resolve_connect_battle_decision";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  remainingUses: number;
  /** SSOT: continue=続行, end=終了。GUI/server passthrough は本フィールドのみ参照する。 */
  choice: "continue" | "end";
}

/**
 * `grant_optional_deck_reveal_count_boost` CE (BSLH01-X09) 保持プレイヤーが、
 * deck_reveal 実行の都度 revealCount+bonusAmount の適用可否を選ぶアクション。
 *
 * SSOT: choice のみを参照する。apply=bonusAmount 加算、decline=無加算で
 * continuation.stepIndex から executeEffect を再開する。
 */
export interface ResolvePendingDeckRevealCountBoostChoiceLegalAction {
  kind: "resolve_pending_deck_reveal_count_boost_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  effectIndex: number;
  stepIndex: number;
  /** SSOT: apply=bonusAmount 加算, decline=無加算。 */
  choice: "apply" | "decline";
  bonusAmount: number;
}

/**
 * optional step が独自 target を要求するときの「どのカードを取るか」選択を解決するアクション。
 * `applyLegalAction` 経由で渡された `options.targetInstanceIds` を pending の候補・件数で
 * 検証し、当該 step を `targetStepId` + `targetInstanceIds` 注入付きで再開する。
 */
export interface ResolvePendingStepOptionalTargetSelectionLegalAction {
  kind: "resolve_pending_step_optional_target_selection";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  stepIndex: number;
  requiredTargetCount: number;
  maxTargetCount: number;
  /**
   * 選択集合の合計 BP 上限（予算制、ENGINE-cumulative-bp-budget-destroy）。
   * 未指定なら予算制約なし。GUI が「あと使える予算」を表示する用途。
   */
  bpBudgetAmount?: number;
  /**
   * 選択集合の合計コスト上限（予算制）。未指定なら予算制約なし。
   */
  costBudgetAmount?: number;
  /**
   * 選択集合の合計実効シンボル数上限（予算制）。未指定なら予算制約なし。
   */
  symbolBudgetAmount?: number;
  candidateTargetInstanceIds: string[];
  /** UI 表示用 (省略時 fallback は step.id か `__step_<i>`)。 */
  stepLabel?: string;
  /**
   * forced_target_inclusion タウント (可能なら含めなければならない対象) の instanceId。
   * 非空のときクライアントは選択集合からこれらを除外してはならない
   * (apply 時に `getMandatoryForcedTargetInclusionIds` で再検証・拒否される)。
   */
  mandatoryTargetInstanceIds?: string[];
}

/**
 * コスト先払い型ドロー枚数修正（BSSL01-C03 等）の任意コスト支払い判断を解決するアクション。
 *
 * actionKind="pay" のとき discardCardInstanceId に破棄する手札カードを指定して +N を確定し、
 * "decline" のとき支払わずに次へ進む。ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正
 * （裁定 2026-06-15, model A: コスト → ボーナス確定 → システムドロー）。
 */
export interface ResolvePendingDrawStepCostChoiceLegalAction {
  kind: "resolve_pending_draw_step_cost_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 解決中エントリのソースカード（複数同時時の識別用）。 */
  sourceInstanceId: string;
  /** 破棄候補の手札カード instanceId（支払い時にここから 1 枚選ぶ）。 */
  candidateCardInstanceIds: string[];
  /** 支払えた場合に確定する追加ドロー枚数。 */
  bonus: number;
}

/**
 * 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』（BSTH02.7-M01 effects[0] 等）の
 * 可変枚数選択を解決するアクション。0〜maxCount 枚を選ぶ（0 枚選択 = 辞退相当）。
 * 選択した候補は即座に removed_from_game へ移動し、選択枚数 × discountPerCard を
 * additionalCostModifiers として反映した上で、同じ sourceInstanceId の召喚を即座に実行する。
 * 支払いソースは通常の summon action と同じ形式 (paymentSources) で同一呼び出しに含める。
 */
export interface ResolvePendingSummonCostExcludeChoiceLegalAction {
  kind: "resolve_pending_summon_cost_exclude_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** 除外候補（フィルタ適用済みの自分のトラッシュ instanceId）。 */
  candidateCardInstanceIds: string[];
  /** 選択可能な最大除外枚数。 */
  maxCount: number;
  /** 必須除外枚数。省略時は 0（任意選択）。 */
  minCount?: number;
  /** 除外1枚につきの追加コスト軽減量。 */
  discountPerCard: number;
  /** 印字コスト（表示用）。 */
  printedCost: number;
  /** 通常軽減後・除外割引適用前のコスト（0 枚選択時の支払い額）。 */
  reducedCost: number;
  /**
   * true のとき、1 枚以上選択した場合の支払い額は discountPerCard による線形割引ではなく
   * `fullReductionCost` に固定される (ENGINE-summon-self-exclude-alt-cost-full-reduction,
   * BSTH11-M01 effects[0])。
   */
  fullReduction?: boolean;
  /** fullReduction:true のとき: 1 枚以上選択した場合の支払い額 (calculateFullReductionSummonCost)。 */
  fullReductionCost?: number;
  fullCostPaid?: boolean;
  remainingPaymentCost?: number;
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
  onBoardCoreSourceFilter?: CardFilter;
}

/**
 * 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを支払わずに
 * 召喚する』(BSSL01-M02 effects[0,1]) の移動枚数+移動先選択を解決するアクション。
 * minCount 以上 availableCoreCount 以下を選び、自分のフィールドカード/リザーブへ配分する。
 * 移動直後に同じ sourceInstanceId の召喚へ続行し、無償でも下限/余分支払いは残す。
 */
export interface ResolvePendingSummonCostCoreMoveChoiceLegalAction {
  grantsFreeSummon?: boolean;
  remainingPaymentCost?: number;
  kind: "resolve_pending_summon_cost_core_move_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** 必須移動枚数下限。 */
  minCount: number;
  /** 選択時点で移動可能なトラッシュのコア総数。 */
  availableCoreCount: number;
  /** 相殺する追加コスト量（正の整数）。 */
  costOffset: number;
  /** 印字コスト（表示用）。 */
  printedCost: number;
  /** 通常軽減後・コア移動割引適用前のコスト。 */
  reducedCost: number;
  /** 移動先「フィールド」候補の自分のフィールドカード instanceId。 */
  fieldDestinationCandidateInstanceIds: string[];
  onBoardCoreSourceFilter?: CardFilter;
}

/**
 * GroupedSummonCostOverrideChoice（複数対象召喚の「除外N枚につき召喚対象1体のコストを
 * 0にする」グループ化コストオーバーライド、BSTH02.7-C06 branch2 等）を解決するアクション。
 * 0〜maxCount 枚を選ぶ（0枚選択 = 辞退相当）。選択した候補は即座に removed_from_game へ
 * 移動し、floor(選択枚数/groupSize) 体分の召喚対象のコストを overrideCost にした上で、
 * 自動 reserve 経路（interactive payment 不要）で即座に召喚を実行する。
 */
export interface ResolvePendingGroupedSummonCostOverrideChoiceLegalAction {
  kind: "resolve_pending_grouped_summon_cost_override_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** 除外候補（フィルタ適用済みの自分のトラッシュ instanceId）。 */
  candidateCardInstanceIds: string[];
  /** 選択可能な最大除外枚数。 */
  maxCount: number;
  /** 何枚除外すると召喚対象1体のコストが0になるか。 */
  groupSize: number;
  /** グループ達成時に適用するコスト。 */
  overrideCost: number;
  /** 既に確定した召喚対象 instanceId。 */
  summonTargetInstanceIds: string[];
}

/**
 * ライフダメージ破棄/使用コストゲート（discardCostGate、BSTH02.7-C05[1] /
 * useCostGate、BSLH01-M05[1] 等）の pay/decline を解決するアクション。
 * 対象は sourceInstanceId 自身固定（候補選択は無い）。ルール正源: 10_rules/02
 * §コスト先払い型ドロー枚数修正と同じプレ判断モデル。
 */
export interface ResolvePendingLifeDamageDiscardChoiceLegalAction {
  kind: "resolve_pending_life_damage_discard_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 解決中エントリのソースカード（= discard/use 型の対象。declare_gimmick 型では宣言元）。 */
  sourceInstanceId: string;
  /** 辞退した場合に適用される実ダメージ量（表示用）。 */
  pendingAmount: number;
  /** 解決中エントリのコスト種別（表示ラベル分岐用）。省略時は discard 扱い。 */
  costKind?: "discard" | "use" | "declare_gimmick";
}

/**
 * `life_gain_replacement` CE (BSTH02.7-X03 effects[3]) 一致時の replace/decline を
 * 解決するアクション。
 */
export interface ResolvePendingLifeGainReplacementChoiceLegalAction {
  kind: "resolve_pending_life_gain_replacement_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 置換元 CE のソースカード（表示用）。 */
  sourceInstanceId: string;
  /** 辞退した場合に適用される元の増加量（表示用）。 */
  amount: number;
}

/**
 * フィールドからのコアシュート対象選択を解決するアクション。
 */
export interface ResolvePendingCoreShootLegalAction {
  sourceGroupMinimums?: import("../model").CoreSourceGroupMinimum[];
  kind: "resolve_pending_core_shoot";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** コアシュート対象候補 */
  candidates: Array<{
    instanceId: string;
    definitionId: string;
    availableCores: number;
  }>;
  /** 移動するコア総数（上限） */
  totalAmount: number;
  /** P3-88: 「コアN個まで」最低取得数。省略時は totalAmount ちょうど。 */
  minTotal?: number;
  /** コア移動元のプレイヤー ID */
  fromPlayerId: string;
  /**
   * forced_target_inclusion タウント (可能なら含めなければならない対象) の instanceId。
   * 非空のときクライアントは配分先からこれらを除外する分配を組んではならない
   * (apply 時に `getMandatoryForcedTargetInclusionIds` で再検証・拒否される)。
   */
  mandatoryTargetInstanceIds?: string[];
}

/**
 * 効果の対象選択を解決するアクション (コスト支払い + スタック窓クローズ後)。種別非依存。
 * 通常の対象選択 UI (highlight + 決定) で扱えるよう、targetMode / requiredTargetCount /
 * candidateTargetInstanceIds など他の対象付きアクションと同じフィールドを持つ。
 */
export interface ResolvePendingEffectTargetLegalAction {
  kind: "resolve_pending_effect_target";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  maxTargetCount?: number;
  allowDuplicateTargets?: boolean;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  /**
   * forced_target_inclusion タウント (可能なら含めなければならない対象) の instanceId。
   * 非空のときクライアントは選択集合からこれらを除外してはならない
   * (apply 時に `getMandatoryForcedTargetInclusionIds` で再検証・拒否される)。
   */
  mandatoryTargetInstanceIds?: string[];
}

export interface ResolvePendingAsIfSoulCoreChoiceLegalAction {
  kind: "resolve_pending_as_if_soul_core_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  choiceId: string;
  choiceLabel: string;
}

export interface ResolvePendingEffectOptionalRepeatChoiceLegalAction {
  kind: "resolve_pending_effect_optional_repeat_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  repeatStepIndex: number;
  choiceIndex: number;
  choiceLabel: string;
  maxAdditionalCount: number;
}

export interface ResolvePendingEffectOptionalRepeatCountLegalAction {
  kind: "resolve_pending_effect_optional_repeat_count";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
  repeatStepIndex: number;
  targetPlayerId: string;
  selectionMode: "repeat_count" | "count_decrease";
  min: number;
  max: number;
}

export interface ResolveBorrowedEffectChoiceLegalAction {
  kind: "resolve_borrowed_effect_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  targetDefinitionId: string;
  borrowedEffectIndex: number;
  grantedEffectCeId?: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  candidateEffects: readonly {
    effectIndex: number;
    textRef?: readonly number[];
    grantedEffectCeId?: string;
    effectSourceInstanceId?: string;
    effectSourceDefinitionId?: string;
  }[];
}

export interface ResolveBorrowedEffectTargetLegalAction {
  kind: "resolve_borrowed_effect_target";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  targetDefinitionId: string;
  borrowedEffectIndex: number;
  grantedEffectCeId?: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  maxTargetCount?: number;
  bpBudgetAmount?: number;
  costBudgetAmount?: number;
  symbolBudgetAmount?: number;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  mandatoryTargetInstanceIds?: string[];
}

/**
 * 発揮前提コア除去ゲート (gate_flash_stack_core。BSTS01-M03) を解決するアクション。
 *
 * 相手のフラッシュ/スタック効果の解決直前に、ゲートされた側がフィールド/リザーブのコア1個を
 * トラッシュへ送る (payToActCoreSourceContainerId)。あるいは支払いを拒否し
 * (payToActCoreGateDecline=true) その効果を不発にする。コア源が無い場合は decline のみ可。
 */
export interface ResolvePayToActCoreGateLegalAction {
  kind: "resolve_pay_to_act_core_gate";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** トラッシュへ送るコアを選べる候補コンテナ (field card instanceId / "reserve")。 */
  candidateContainerIds: string[];
}

/**
 * 発揮前提手札破棄ゲート (gate_flash_stack_hand_discard) を解決するアクション。
 */
export interface ResolvePayToActHandDiscardGateLegalAction {
  kind: "resolve_pay_to_act_hand_discard_gate";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  requiredCount: number;
  candidateCardInstanceIds: string[];
}

/**
 * offer_magic_pre_cost_trigger (engine-magic-field-pre-cost-payment-trigger,
 * BSAZ01-C12「戦力投入」) の発揮可否を解決するアクション。
 *
 * `fieldMagicPreCostTriggerDecision: "trigger"` で、ネストした通常 `use_magic` action を
 * コスト支払い前に宣言する。
 * `"decline"` (省略時既定) なら中断していたマジック使用のコスト支払いをそのまま再開する。
 */
export interface ResolveFieldMagicPreCostTriggerLegalAction {
  kind: "resolve_field_magic_pre_cost_trigger";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 発揮権を持つカード (BSAZ01-C12 等)。 */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /**
   * `trigger` を選んだときに実行する通常の use_magic action。
   * 支払い・スタック・後処理はこの action の共通経路へ委ねる。
   * undefined の action は、発揮権を辞退するためだけの選択肢である。
   */
  triggerMagicUse?: UseMagicLegalAction;
}

/**
 * コア配分（複数フィールドカードへの分配）を解決するアクション。
 *
 * 用途:
 * - BSTH01-M01「トラッシュにあるコアすべてをそれらのスピリットに置ける」(fromKind="trash")
 * - P3-47 フランドール「コア1個以上をそれらのカードに置く」(fromKind="reserve" + minTotal>=1)
 *
 * GUI 側で coreDistributionAllocations: Record<instanceId, number> を渡す。
 * ソウルコアを含む場合は coreDistributionSoulCoreAllocations: Record<instanceId, number>
 * を渡す。単一ソウルコア向けの coreDistributionSoulCoreInstanceId は互換入力として残す。
 * maxTotal がある場合、通常コア + ソウルコアの合計配置数はその値以下。
 */
export interface ResolvePendingCoreDistributionLegalAction {
  kind: "resolve_pending_core_distribution";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 配分先候補（フィールド上のカード） */
  candidates: Array<{
    instanceId: string;
    definitionId: string;
  }>;
  /**
   * 移動元の通常コア総数。
   * - 単一ソース: 該当ゾーンのコア数
   * - multi-source (P3-47 F-5): allowedSources/sourceAvailable から field source→同一
   *   recipient の no-op を除いて実際に配置できる通常コア上限
   */
  totalNormalCores: number;
  /**
   * 配置可能なソウルコアがあるか。
   * fromKind="trash" ではトラッシュ、fromKind="any_movable" では通常移動可能な
   * reserve/trash/life/field のソウルコアを表す (field 同一 source→recipient は除外)。
   */
  hasSoulCore: boolean;
  /**
   * 配置可能なソウルコア数。省略時は旧 pending 互換として 1 個。
   * 複数個は apply 時の `coreDistributionSoulCoreAllocations` で配置先別に配分できる。
   */
  totalSoulCores?: number;
  /**
   * ソース種別。
   * - "trash" / "reserve": 単一ソース
   * - "any_movable" (P3-47 F-5): 自分の通常移動可能な全ゾーン混合
   *   (`allowedSources` / `sourceAvailable` 必須)
   * - "void": ボイドからの単一ソース配置（player.voidNormalCoreCount を減算、soul core 非対応）
   * - "life": ライフからの単一ソース配置 (ENGINE-core-move-from-life-to-field-card)
   * - "outside_game": ゲーム外からの新規ソウルコア生成配置 (BSLH01-X10 等)
   */
  fromKind:
    | "trash"
    | "reserve"
    | "any_movable"
    | "void"
    | "life"
    | "outside_game";
  /**
   * P3-47 F-5: multi-source 時の利用可能ソース一覧 (fromKind="any_movable")。
   */
  allowedSources?: ReadonlyArray<
    import("../model").CoreDistributionAllowedSource
  >;
  /**
   * P3-47 F-5: 各 allowedSource の利用可能コア数 snapshot (key = "reserve" /
   * "trash" / "life" / `field:<instanceId>`)。
   */
  sourceAvailable?: Record<string, number>;
  /**
   * P3-47 F-5: 各 source の利用可能ソウルコア数 snapshot。key 規則は
   * `sourceAvailable` と同じ。通常コア 0 / ソウルのみの source も含み得る。
   */
  soulSourceAvailable?: Record<string, number>;
  /**
   * multi-source 時の同一 source 合算上限 snapshot。通常コアとソウルコアを別々に
   * 指定しても、同一 source の残数下限を合算で越えないために使う。
   */
  sourceTotalAvailable?: Record<string, number>;
  /**
   * 効果使用者が移動先ごとの個数を先に決め、コアの持ち主が物理コア/source を選ぶ二段階 pending。
   * fixedTargetTotals 未設定なら 1段目、設定済みなら 2段目。
   */
  targetTotalSelection?: {
    mode: "target_totals_then_core_owner_sources";
    targetChooserPlayerId: string;
    sourceOwnerPlayerId: string;
    fixedTargetTotals?: Record<string, number>;
  };
  /**
   * 配分する最小コア数 (省略時 0、フランドールのコスト効果は 1)。
   * `core_move` の `amount: "all"` (= 「コアすべて」) では `totalNormalCores` と同値が
   * 自動設定され、通常コアの部分配分は不可となる。
   */
  minTotal?: number;
  /**
   * 通常コア + ソウルコアの合計配置上限。
   * generic な有限 `fromKind:"trash"` でソウルコアも候補に出しつつ「N個まで」を守る。
   */
  maxTotal?: number;
  /**
   * トラッシュのソウルコアの配置を強制するか。
   * `core_move` の `amount: "all"` で、かつ `hasSoulCore` のときに `true`。
   * `true` のとき `coreDistributionSoulCoreInstanceId` 未指定で完了するとエラー。
   */
  mustPlaceSoulCore?: boolean;
  /**
   * 候補1件あたりの配分上限 (省略時は無制限)。
   * BSSL01-X01「トークン1体ごとにボイドからコア1個ずつまで」のような per-candidate 上限
   * (ENGINE-bssl01-x01-void-core-interactive-placement)。
   */
  maxPerCandidate?: number;
  allocationGroups?: import("../model").CoreDistributionAllocationGroup[];
  /** 移動元プレイヤー ID */
  fromPlayerId: string;
  /** 移動先プレイヤー ID */
  toPlayerId: string;
}

/**
 * P3-48 follow-up: pendingCoreDistribution の player_choice 配分を中止して、
 * pending 提示 *直前* の state に巻き戻すアクション。
 *
 * 用途: HUD「キャンセル」ボタン経由。`PendingCoreDistribution.priorStateSnapshot`
 * が存在する場合のみ available。effect chain の resume (continuation) は呼ばれない
 * (= 該当 effect の以降のステップは実行されない)。
 *
 * spec: `25_gui/11_core-selection-hud.md` の「キャンセル」規則。
 */
export interface AbortPendingCoreDistributionLegalAction {
  kind: "abort_pending_core_distribution";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
}

/**
 * チェンジ効果解決後の「このカードを破棄するか、条件を満たす自分のスピリットと
 * 回復状態で入れ替える」選択を解決するアクション。
 */
export interface ResolvePendingChangeCleanupChoiceLegalAction {
  kind: "resolve_pending_change_cleanup_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  outcome: "trash" | "swap";
  swapCandidateInstanceIds: string[];
  swapTargetInstanceId?: string;
}

export interface ResolvePendingEnterFieldPlacementLegalAction {
  kind: "resolve_pending_enter_field_placement";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** effect-debug / training trace 用の発揮元カード番号。 */
  sourceCardNo: string;
  minimumCoreCount: number;
  maximumCoreCount: number | null;
}

/**
 * P3-49 placement_multi: 複数体同時召喚の per-target 配置を解決するアクション。
 *
 * GUI 側で `multiPlacementAllocations: Array<{ destinationInstanceId; placements }>`
 * を渡す。各 entry は対象カード instanceId と該当カードへの
 * `EnterFieldCorePlacement[]` を含む。
 */
export interface ResolvePendingMultiPlacementLegalAction {
  kind: "resolve_pending_multi_placement";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  fieldCoreSourceMinimum?: import("../model").FieldCoreSourceMinimum;
  /** 同時召喚されたカード一覧と各カードの placement 制約 */
  targets: ReadonlyArray<{
    instanceId: string;
    definitionId: string;
    minimumCoreCount: number;
    maximumCoreCount: number | null;
    voidNormalCoreMax?: number;
  }>;
  /** pending 全体でトラッシュから置ける通常コア上限。 */
  trashNormalCoreMax?: number;
  /** pending 全体でトラッシュから置ける generic コア上限（通常/ソウル合計）。 */
  trashCoreMax?: number;
}

/**
 * P3-49 placement_multi: 複数体同時召喚の placement を中止して、pending 提示直前の
 * state に巻き戻すアクション。`PendingMultiPlacement.priorStateSnapshot` がある場合のみ available。
 */
export interface AbortPendingMultiPlacementLegalAction {
  kind: "abort_pending_multi_placement";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
}

/**
 * core_move の splitDestinations による複数移動先への配分を解決するアクション。
 * GUI 側で coreSplitDistribution: number[] を渡す（destinations と同じ順序、合計 = totalAmount）。
 */
export interface ResolvePendingCoreSplitLegalAction {
  kind: "resolve_pending_core_split";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 配分対象の総コア数 */
  totalAmount: number;
  /** 移動先候補（destinations と同順、UI 表示順） */
  destinations: Array<{
    locationKind: string;
    locationPlayerId?: string;
    cap?: number;
  }>;
}

/**
 * `split_field_entry_choice` の分配選択を解決するアクション (ENGINE-sequential-slot-choice、
 * BSSL01-X01[5,6])。GUI 側で `splitSummonTokenCount: number`
 * (0..maxTokenCount) と `splitSummonZoneCardInstanceIds: string[]`
 * (zoneCandidateInstanceIds の部分集合、重複不可) を渡す。
 * `splitSummonTokenCount + splitSummonZoneCardInstanceIds.length <= totalCount`。
 */
export interface ResolvePendingSplitSummonChoiceLegalAction {
  kind: "resolve_pending_split_summon_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 選択総数上限 (tokenCount + zoneCardInstanceIds.length の上限)。 */
  totalCount: number;
  /** トークン側で実際に選べる最大数。 */
  maxTokenCount: number;
  /** ゾーン側候補カード instanceId 一覧。 */
  zoneCandidateInstanceIds: string[];
}

/**
 * field_card ソースのコアコスト支払い配分を解決するアクション (BSTH05-C11/C12 等)。
 *
 * 用途: 「系統:「アシハラ」を持つ自分の緑の創界神ネクサスのコア3個をボイドに置くことで」で
 * 候補カードが複数かつ余剰コアがあるとき、どのカードから何個取るかを選ぶ。
 * GUI 側で `coreSourceAllocations: Record<instanceId, number>` と、必要なら
 * `coreSourceSoulCoreInstanceId` を渡す。
 */
export interface ResolveCoreSourceAllocationLegalAction {
  /** 指定時は minimumTotal～requiredTotal の範囲で支払う。 */
  minimumTotal?: number;
  canDecline?: boolean;
  kind: "resolve_core_source_allocation";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 支払い元候補 (フィールド上のカード) と各カードの可動コア数。 */
  candidates: Array<{
    instanceId: string;
    available: number;
    normalAvailable?: number;
    hasSoulCore?: boolean;
  }>;
  /** ちょうど支払うコア数。 */
  requiredTotal: number;
  /** 移動先 CoreLocation 種別 (UI 表示用)。 */
  toKind: string;
}

/**
 * 効果文内 summon のコスト支払い元選択を解決するアクション。
 *
 * 宣言時ではなく、発揮応答スタック窓が閉じて executeSummon がコストを
 * 支払う直前に生成される。GUI 側で `summonPaymentSources` を渡す。
 */
export interface ResolvePendingEffectSummonCostPaymentLegalAction {
  kind: "resolve_pending_effect_summon_cost_payment";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  summonTargetInstanceId: string;
  summonTargetDefinitionId: string;
  requiredCost: number;
  availableReserveCoreAmount: number;
  availableReserveNormalCoreAmount: number;
  availableOnBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  availableSoulCoreOnlySources: AvailableSoulCorePaymentSource[];
}

/**
 * ENGINE-core-move-from-life-owner-soul-choice: ライフ→任意先のコア移動で
 * 通常 / ソウル混在の真の選択肢があるときに、ライフ持ち主が partition を選ぶアクション。
 * GUI 側で `lifeCorePartitionChoice: { normalChosen, soulChosen }` を渡す
 * (normalChosen + soulChosen == totalAmount、各値は available 以下)。
 * BS35 Q22728「通常コアとソウルコアの選択は持ち主」。
 */
export interface ResolvePendingLifeCoreSelectionLegalAction {
  kind: "resolve_pending_life_core_selection";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** ライフの通常コア取得可能上限 (= player.lifeNormalCoreCount snapshot)。 */
  normalAvailable: number;
  /** ライフのソウルコア取得可能上限 (0 or 1)。 */
  soulAvailable: number;
  /** 移動するコア総数 = normalChosen + soulChosen 制約値。 */
  totalAmount: number;
  /** ソース CoreLocation 種別 (UI 表示用、常に "life")。 */
  fromKind: string;
  fromPlayerId?: string;
  /** 移動先 CoreLocation 種別 ("reserve" / "trash")。 */
  toKind: string;
  toPlayerId?: string;
}

/**
 * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2:
 * 「カウントを好きなだけ減らす」の数選択を解決するアクション。
 * GUI 側で `countDecreaseSelection: number`（min〜max）を渡す。
 */
export interface ResolvePendingCountSelectionLegalAction {
  kind: "resolve_pending_count_decrease";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 減少対象プレイヤー（UI 表示用）。 */
  targetPlayerId: string;
  /** 選択可能な最小カウント減少数 */
  min: number;
  /** 選択可能な最大カウント減少数 */
  max: number;
}

/**
 * ENGINE-composite-heterogeneous-removal-budget: discard_set_burst の count が
 * {min,max}（「バーストN個まで」型）のときの枚数選択待ちを解決する legal action。
 * GUI 側で `discardSetBurstCountSelection: number`（min〜max）を渡す。
 */
export interface ResolvePendingDiscardSetBurstCountSelectionLegalAction {
  kind: "resolve_pending_discard_set_burst_count";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** バースト所有プレイヤー（UI 表示用）。 */
  targetPlayerId: string;
  /** 選択可能な最小破棄枚数 */
  min: number;
  /** 選択可能な最大破棄枚数 */
  max: number;
}

/**
 * P3-88: 「コアN個まで」の数選択を解決するアクション。
 * GUI 側で `coreCountSelection: number`（min〜max）を渡す。
 */
export interface ResolvePendingCoreCountSelectionLegalAction {
  kind: "resolve_pending_core_count";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 選択可能な最小コア数 */
  min: number;
  /** 選択可能な最大コア数 */
  max: number;
  /** ソース CoreLocation 種別（UI 表示用） */
  fromKind: string;
  fromPlayerId?: string;
  /** 移動先 CoreLocation 種別（UI 表示用） */
  toKind: string;
  toPlayerId?: string;
}

/**
 * P3-47 F-4: 効果対象リダイレクトを承諾するアクション。
 *
 * `redirect_effect_target` CE が発火し pendingTargetRedirects に prompt が積まれた時、
 * CE owner (= 本体所有者) が「対象を変更する」を選択する。
 * GUI 側で `redirectTargetReplacement: { withInstanceId }` を渡し、候補集合の中から
 * 1 体を指定する。
 */
export interface ConfirmTargetRedirectLegalAction {
  kind: "confirm_target_redirect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
  /** 元効果が解決時に取った対象集合 (instanceId)。 */
  originalResolvedInstanceIds: string[];
  /** 元集合の中で差し替え可能な代表対象 (既存 UI 互換用)。 */
  redirectableInstanceId: string;
  /** 元集合の中で同じ replacement へ差し替える全対象。 */
  redirectableInstanceIds?: string[];
  /** 差し替え候補 (token 集合)。confirm 時に GUI から 1 体を指定。 */
  candidateTokenInstanceIds: string[];
  /** 対象変更の置換方式。省略時は "collapse"。 */
  replacementMode?: import("../model").TargetRedirectReplacementMode;
  /** confirm 時に必要な replacement 数。collapse は 1、reselect は元対象数。 */
  replacementTargetCount?: number;
  /** confirm 時に選べる replacement 数の上限。現状は replacementTargetCount と同じ。 */
  maxReplacementTargetCount?: number;
  /** replacement 候補を選ぶプレイヤー。省略時は actingPlayerId と同じ。 */
  candidateChooserPlayerId?: string;
  /**
   * true のとき redirectTargetReplacementInstanceId が必要。
   * false のときは「対象を変更する」承諾のみで、候補選択は次 pending stage に委譲する。
   */
  replacementSelectionRequired?: boolean;
  /** 元効果を発動した相手側カードの instanceId (UI 表示用)。 */
  sourceEffectInstanceId: string;
  sourceEffectDefinitionId: string;
}

/**
 * P3-47 F-4: 効果対象リダイレクトを辞退するアクション。
 * 元の対象集合のまま元効果の解決を続行する。
 */
export interface DeclineTargetRedirectLegalAction {
  kind: "decline_target_redirect";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  pendingId: string;
}

/**
 * 神技/導技/界放/契約技 — 創界神/導界者のコア消費起動効果を使用するアクション。
 */
export interface UseDivineSkillLegalAction {
  kind: "use_divine_skill";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  /** 対象の創界神/導界者ネクサスの instanceId */
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceCardNo: string;
  /** divineSkills 配列内のインデックス */
  skillIndex: number;
  /** 種別ラベル */
  label: import("../model").DivineSkillEntry["label"];
  /**
   * 宣言に必要な最小コア数。範囲コストの実際の支払い数はスタック窓後に選ぶ。
   */
  coreCost: number;
  /** 現在のネクサス上コア数 */
  availableCores: number;
}

/** アタック中ホスト離脱: ブレイヴでアタック継続するか終了するか */
export interface ResolveBraveAttackContinuationLegalAction {
  kind: "resolve_brave_attack_continuation";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  entityId: string;
  braveInstanceIds: string[];
  choice: "continue" | "end_attack";
}

/** 合体スピリット破壊時: ブレイヴをフィールドに残す / ホストと一緒に移動 */
export interface ResolveBraveLeaveChoiceLegalAction {
  kind: "resolve_brave_leave_choice";
  actionId: string;
  can: true;
  reason: string;
  actingPlayerId: string;
  hostInstanceId: string;
  braveInstanceIds: string[];
  choice: "keep" | "send_with_host" | "inherit_soul_state";
}

/**
 * 煌臨元への追加置換 (advent_source) の選択を解決するアクション。
 *
 * 「このスピリットが相手によって離れるとき、自分の『X』の煌臨元に追加するか、
 *  トラッシュに置く」(BSSL01-C02/M01/M03/X03 ほか, 08a_advent-rebirth-contract.md L36 の逆操作)。
 *
 * `pendingAdventSourceReplacement` が立っている間、コントローラー (choosingPlayerId) のみが
 * これを行える。enumeration は `choice="advent_source"` を host 候補ごとに 1 つ + `choice="trash"`
 * を 1 つ列挙する (ブレイヴ離脱選択 `resolve_brave_leave_choice` と同じ「選択肢ごとに 1 アクション」方式)。
 * dispatch は `resolveAdventSourceReplacement(state, choice, hostInstanceId)` を呼ぶ。
 */
export interface ResolveAdventSourceReplacementLegalAction {
  kind: "resolve_advent_source_replacement";
  actionId: string;
  can: true;
  reason: string;
  /** 選択するプレイヤー (= 離脱カードのコントローラー)。 */
  actingPlayerId: string;
  /** 離脱して煌臨元になり得るカードの instanceId。 */
  cardInstanceId: string;
  /** "advent_source": host の煌臨元へ追加 / "trash": トラッシュへ。 */
  choice: "advent_source" | "trash";
  /**
   * choice="advent_source" のとき、追加先 host スピリットの instanceId。
   * choice="trash" のときは undefined。
   */
  hostInstanceId?: string;
  /** 追加先候補スピリットの instanceId 全リスト (UI で複数 host を提示するため)。 */
  candidateHostInstanceIds: string[];
}

/**
 * 契約カードの魂状態置換 (soul state) の選択を解決するアクション。
 *
 * 「契約カードが**相手によって**フィールドを離れるとき、魂状態で残す**選択**ができる
 *  (**ルールであり効果ではない**)」(08a_advent-rebirth-contract.md L126)。
 *
 * `pendingSoulStateReplacement` が立っている間、コントローラー (choosingPlayerId) のみが
 * これを行える。enumeration は二択 (host 選択を伴わない): `choice="keep"` (魂状態で残す) を
 * 1 つ + `choice="decline"` (通常通りフィールドを離れる) を 1 つ列挙する。煌臨元置換
 * `resolve_advent_source_replacement` と同形だが host 候補を取らないバイナリ選択。
 * dispatch は `resolveSoulStateReplacement(state, accept)` を呼ぶ (keep→accept=true /
 * decline→accept=false)。
 */
export interface ResolveSoulStateReplacementLegalAction {
  kind: "resolve_soul_state_replacement";
  actionId: string;
  can: true;
  reason: string;
  /** 選択するプレイヤー (= 離脱契約カードのコントローラー)。 */
  actingPlayerId: string;
  /** 魂状態で残し得る契約カードの instanceId。 */
  cardInstanceId: string;
  /** "keep": 魂状態で残す (コア→リザーブ) / "decline": 通常通りフィールドを離れる。 */
  choice: "keep" | "decline";
}

/**
 * 手元 (set_aside) カード自己除外の置換選択を解決するアクション
 * (ENGINE-set-aside-exit-replacement-choice、BSTH08.5-M11「自分がこのカードを除外するとき、
 * かわりに手札に戻せる」正源)。
 *
 * `pendingSetAsideExitReplacementChoice` が立っている間、コントローラー
 * (choosingPlayerId) のみがこれを行える。二択: `choice="replace"` (置換先へ移動、除外しない) /
 * `choice="decline"` (通常通り除外する)。dispatch は
 * `resolveSetAsideExitReplacementChoice(state, accept)` を呼ぶ
 * (replace→accept=true / decline→accept=false)。
 */
export interface ResolveSetAsideExitReplacementChoiceLegalAction {
  kind: "resolve_set_aside_exit_replacement_choice";
  actionId: string;
  can: true;
  reason: string;
  /** 選択するプレイヤー (= 除外され得る手元カードのコントローラー)。 */
  actingPlayerId: string;
  /** 置換先へ移動し得る手元カードの instanceId。 */
  cardInstanceId: string;
  /** "replace": 置換 (手札へ移動 / コスト支払い) する / "decline": 通常通り除外する。 */
  choice: "replace" | "decline";
  /**
   * "replace" 選択時の置換種別 (GUI ラベル分岐用、BSTH08.5-M11=move_to /
   * X04=pay_cost)。"decline" アクションには付与しない。
   */
  replacementKind?: "move_to" | "pay_cost";
}

export type LegalAction =
  | ResolvePendingTriggeredEffectLegalAction
  | SelectPendingToResolveLegalAction
  | PrivateTriggeredEffectDeclarationLegalAction
  | ResolvePendingBurstCheckLegalAction
  | DeclinePendingBurstCheckLegalAction
  | FieldCardEffectLegalAction
  | HandActivatedEffectLegalAction
  | BattleImmediateEffectLegalAction
  | UseMagicLegalAction
  | UseAccelLegalAction
  | UseChangeLegalAction
  | DeclareAdventLegalAction
  | DeclareHostDualAdventLegalAction
  | DeclareDualHostAdventLegalAction
  | DeclareManifestLegalAction
  | SetBurstLegalAction
  | SetMirageLegalAction
  | SetQuartzLegalAction
  | ActivateSoulStateLegalAction
  | SummonLegalAction
  | PlaceNexusLegalAction
  | AttackLegalAction
  | FlipInsteadOfAttackLegalAction
  | JoinActiveAttackLegalAction
  | DeclineImmediateAttackJoinLegalAction
  | BlockLegalAction
  | OpenBattleFlashLegalAction
  | PassBattleFlashLegalAction
  | PassStackLegalAction
  | PassPreDeclarationStackLegalAction
  | DeclineBlockLegalAction
  | EndAttackStepLegalAction
  | BraveCombineLegalAction
  | ContractCombineLegalAction
  | LinkAidLegalAction
  | ResolvePendingLinkAidCostSourceChoiceLegalAction
  | SwapHandTrashLegalAction
  | DeclineHandTrashSwapLegalAction
  | SwapFieldHandLegalAction
  | DeclineFieldHandSwapLegalAction
  | ResolveBraveCombineChoiceLegalAction
  | ResolveTenshoSummonLegalAction
  | ResolveReverseRebirthSummonLegalAction
  | BraveSeparateLegalAction
  | BraveSwapLegalAction
  | ResolveBraveLeaveChoiceLegalAction
  | ResolveAdventSourceReplacementLegalAction
  | ResolveSoulStateReplacementLegalAction
  | ResolveSetAsideExitReplacementChoiceLegalAction
  | ResolveBraveAttackContinuationLegalAction
  | ResolvePendingDeckRevealPickLegalAction
  | ResolvePendingDeckRevealOrderLegalAction
  | ResolvePendingZoneSelectionLegalAction
  | ResolvePendingStepOptionalChoiceLegalAction
  | ResolvePendingStepChoiceLegalAction
  | ResolveConnectBattleDecisionLegalAction
  | ResolvePendingDeckRevealCountBoostChoiceLegalAction
  | ResolvePendingStepOptionalTargetSelectionLegalAction
  | ResolvePendingDrawStepCostChoiceLegalAction
  | ResolvePendingSummonCostExcludeChoiceLegalAction
  | ResolvePendingSummonCostCoreMoveChoiceLegalAction
  | ResolvePendingGroupedSummonCostOverrideChoiceLegalAction
  | ResolvePendingLifeDamageDiscardChoiceLegalAction
  | ResolvePendingLifeGainReplacementChoiceLegalAction
  | ResolvePendingCoreShootLegalAction
  | ResolvePendingEffectTargetLegalAction
  | ResolvePendingAsIfSoulCoreChoiceLegalAction
  | ResolvePendingEffectOptionalRepeatChoiceLegalAction
  | ResolvePendingEffectOptionalRepeatCountLegalAction
  | ResolveBorrowedEffectChoiceLegalAction
  | ResolveBorrowedEffectTargetLegalAction
  | ResolvePayToActCoreGateLegalAction
  | ResolvePayToActHandDiscardGateLegalAction
  | ResolveFieldMagicPreCostTriggerLegalAction
  | ResolvePendingCoreSplitLegalAction
  | ResolvePendingSplitSummonChoiceLegalAction
  | ResolvePendingCoreCountSelectionLegalAction
  | ResolvePendingCountSelectionLegalAction
  | ResolvePendingDiscardSetBurstCountSelectionLegalAction
  | ResolvePendingLifeCoreSelectionLegalAction
  | ResolveCoreSourceAllocationLegalAction
  | ResolvePendingEffectSummonCostPaymentLegalAction
  | ResolvePendingCoreDistributionLegalAction
  | AbortPendingCoreDistributionLegalAction
  | ResolvePendingChangeCleanupChoiceLegalAction
  | ResolvePendingEnterFieldPlacementLegalAction
  | ResolvePendingMultiPlacementLegalAction
  | AbortPendingMultiPlacementLegalAction
  | UseDivineSkillLegalAction
  | ConfirmTargetRedirectLegalAction
  | DeclineTargetRedirectLegalAction;

export interface GetAvailableFieldCardEffectLegalActionsOptions {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredFieldCardEffectActions: FieldCardEffectActionRegistrationLookup;
  /** P3-39: ApplyLegalActionOptions と同じく必須化 (空 lookup で渡すことは可)。 */
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: BurstActionRegistrationLookup;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getRegisteredHandCardEffectActions?: HandCardEffectActionRegistrationLookup;
  getRegisteredHandActivatedEffectActions?: HandActivatedEffectActionRegistrationLookup;
  getRegisteredMagicActions?: MagicActionRegistrationLookup;
  getConditionalCostCanExecuteCheck?: CanExecuteCheckAccessor;
}

export type GetLegalActionsOptions =
  GetAvailableFieldCardEffectLegalActionsOptions;

export interface ApplyLegalActionOptions {
  state: GameState;
  action: LegalAction;
  skipOptionalEffect?: boolean;
  targetInstanceIds?: string[];
  /**
   * P2-05: 同時アタック宣言の追加参加カード (attack action 専用)。
   * options-level 入力 (REST /action の passthrough 対応)。
   * action.additionalSourceInstanceIds より優先される。
   */
  additionalSourceInstanceIds?: string[];
  /** P2-05: 同時アタック追加参加体ごとの attack_exhaust_cost_gate 支払い元。 */
  additionalAttackExhaustCostSourceInstanceIds?: Record<
    string,
    string | string[]
  >;
  chosenLifeCoreKind?: LifeCoreKind | null;
  followUpTargetInstanceIds?: string[];
  followUpChosenLifeCoreKind?: LifeCoreKind | null;
  followUpPerTargetInputs?: Array<{
    targetInstanceId: string;
    enterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
    followUpTargetInstanceIds?: string[];
    followUpChosenLifeCoreKind?: LifeCoreKind | null;
  }>;
  paymentSources?: readonly CardCostPaymentSource[];
  /**
   * P3-30: 効果コスト「N コスト支払う」(pay_cost step) の支払いソース。
   * 効果起動時に GUI / 呼び出し側がプレイヤー選択結果を渡す。
   * `paymentSources` (カード使用コスト) とは別経路で、effect-interpreter の
   * pay_cost ハンドラが消費する。未指定時はリザーブのみで自動支払い。
   */
  payCostPaymentSources?: readonly CardCostPaymentSource[];
  /**
   * ことで構文 (`conditional_cost`) の `pay_cost` コア源選択を窓後へ遅延する意思表示。
   * GUI が窓前のコア源モーダルを抑止して効果を起動したとき true で渡す。宣言時に
   * ActiveStack へ保持し、deferred 解決で executeEffect の
   * `allowPendingPayCostSourceAllocation` に橋渡しする。
   */
  deferPayCostSourceSelection?: boolean;
  /**
   * P3-34 B: 効果起点 summon (summon_self / from_zone) のコスト支払い元。
   * 通常召喚 (paymentSources) と同じ CardCostPaymentSource[] 形式で別経路。
   * structured-effect-interpreter の executeSummon が consume する。
   * 未指定時は `executeSummon` が reserve から自動支払い (後方互換 fallback)。
   */
  summonPaymentSources?: readonly CardCostPaymentSource[];
  /**
   * P3-34 B: 効果起点 summon のフィールド進入時コア配置。
   * 通常召喚 (enterFieldCorePlacements) と同じ EnterFieldCorePlacement[] 形式で別経路。
   * Lv2/Lv3 を狙う多コア配置や `天渡` 等 placement policy 検証を効果召喚にも適用。
   * 未指定時は最小要求コアを reserve から自動配置する fallback。
   */
  summonEnterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
  enterFieldCorePlacements?: readonly EnterFieldCorePlacement[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /**
   * P3-39: trigger event のリスナー判定に使用 (必須)。
   * 未指定だとリスナー無し event が空 pending として残るため、必ず渡す。
   * テストで効果登録が不要なら `() => []` の空 lookup を渡す。
   */
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: BurstActionRegistrationLookup;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getRegisteredFieldCardEffectActions?: FieldCardEffectActionRegistrationLookup;
  getRegisteredHandActivatedEffectActions?: HandActivatedEffectActionRegistrationLookup;
  getRegisteredMagicActions?: MagicActionRegistrationLookup;
  getHandWrittenBurstPostResolutionPolicy?: HandWrittenBurstPostResolutionPolicyLookup;
  resolveFieldCardEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  getConditionalCostCanExecuteCheck?: CanExecuteCheckAccessor;
  getConditionalResultSuccessCheck?: SuccessCheckAccessor;
  resolvePendingTriggeredEffect?: PendingTriggeredEffectResolver;
  getPendingTriggeredEffectResolver?: PendingTriggeredEffectResolverLookup;
  resolvePendingBurstCheck?: PendingBurstCheckResolver;
  getPendingBurstCheckResolver?: PendingBurstCheckResolverLookup;
  /** ブレイヴ分離時のコア移動先指定。キー = ソースID ("reserve" or instanceId)、値 = コア数 */
  separateCoreDistribution?: Record<string, number>;
  /** DeckReveal pick フェーズ: プレイヤーが選択したカード instanceId 群 */
  selectedDeckRevealCardIds?: string[];
  /**
   * DeckReveal/revealed_choice の効果由来ミラージュセットで支払うコア。
   * キーは受理する revealed/trash カードの instanceId。通常の手札セットではなく
   * card_event 解決内のセットなので paymentSources と分離する。
   */
  deckRevealMiragePaymentSourcesByInstanceId?: Record<
    string,
    readonly CardCostPaymentSource[]
  >;
  /** DeckReveal order フェーズ: 残りカードの順番（デッキ下から順） */
  deckRevealRemainderOrder?: string[];
  /** DeckReveal order フェーズ: top_or_bottom 時のプレイヤー選択 */
  deckRevealPlacement?: "top" | "bottom" | "trash";
  /** DeckReveal order フェーズ: top_bottom_split 時のカード別上下配置 */
  deckRevealRemainderPlacements?: Record<string, "top" | "bottom">;
  /**
   * DeckReveal pick フェーズ: `DeckRevealPick.destination === "hand_or_set_aside_choice"`
   * (BSTH08.5-C23「手札に加えるまたは手元に置く」) の行き先選択。1 枚以上選択するときは必須。
   */
  deckRevealPickFreeDestination?: "hand" | "set_aside";
  /** ZoneSelection: プレイヤーが選択したカード instanceId 群 */
  selectedZoneCardIds?: string[];
  /**
   * ZoneSelection: `PendingZoneSelection.destination === "hand_or_set_aside_choice"`
   * のカード別行き先。キー = 選択カード instanceId、値 = `"hand"|"set_aside"`。
   */
  zoneSelectionDestinationByCardId?: Record<string, "hand" | "set_aside">;
  /**
   * ENGINE-paid-prevention-immunity-card-cost Step3: `payPreventionImmunityCost` variant で
   * `cost.resource: "card"` を支払うとき、実際に除外するカード instanceId 群
   * (`paidPreventionImmunityCardCostCandidateInstanceIds` の部分集合、要
   * `length === cost.amount`、重複不可)。候補数が `cost.amount` と一致するときは省略可
   * (全候補を自動確定、後方互換)。候補数がそれを超えるときは必須
   * (省略/枚数不一致/非候補選択はエラー)。
   */
  paidPreventionImmunityCardSelection?: string[];
  /**
   * DrawStepCostChoice (コスト先払い型ドロー枚数修正 model A) 解決: 支払う or 辞退。
   * "pay" のとき drawStepCostDiscardCardInstanceId に破棄する手札カードを指定して +N 確定、
   * "decline" のとき支払わずスキップ（次エントリへ／全消化後システムドロー再開）。
   */
  drawStepCostChoice?: "pay" | "decline";
  /** DrawStepCostChoice の "pay" で破棄する手札カード instanceId。 */
  drawStepCostDiscardCardInstanceId?: string;
  /**
   * SummonCostExcludeChoice (トラッシュ除外による可変召喚コスト軽減) 解決:
   * 除外するトラッシュカード instanceId 群（0〜pending.maxCount 枚、candidateCardInstanceIds
   * の部分集合）。未指定 / 空配列 = 除外なし（辞退相当、通常コストで召喚）。
   */
  summonCostExcludeSelectedCardInstanceIds?: readonly string[];
  /**
   * SummonCostCoreMoveChoice（トラッシュのコアをフィールド/リザーブに置く代替コスト支払い、
   * BSSL01-M02 effects[0,1]）解決: 移動する総コア数（pending.minCount 以上
   * pending.availableCoreCount 以下）。未指定時は解決側が throw する（除外型と異なり
   * 辞退不可＝必須支払い）。
   */
  summonCostCoreMoveSelectedCount?: number;
  /**
   * SummonCostCoreMoveChoice の移動先。"reserve" で自分のリザーブへ一括、
   * `{ fieldCardInstanceId }` で自分のフィールドカード1枚
   * （pending.fieldDestinationCandidateInstanceIds の部分集合）へ一括。未指定時は
   * "reserve" 扱い。
   */
  summonCostCoreMoveDestination?: "reserve" | { fieldCardInstanceId: string };
  /** 代替支払いのコアを複数のフィールドカード/リザーブへ配分する。 */
  summonCostCoreMoveAllocations?: Array<{
    destination: "reserve" | { fieldCardInstanceId: string };
    normalCount: number;
    soulCount?: 0 | 1;
  }>;
  /**
   * GroupedSummonCostOverrideChoice（複数対象召喚のグループ化コストオーバーライド、
   * BSTH02.7-C06 branch2 等）解決: 除外するトラッシュカード instanceId 群
   * （0〜pending.maxCount 枚、candidateCardInstanceIds の部分集合）。
   * 未指定 / 空配列 = 除外なし（辞退相当、通常コストで召喚）。
   */
  groupedSummonCostOverrideSelectedCardInstanceIds?: readonly string[];
  /**
   * LifeDamageDiscardChoice (discardCostGate 破棄コストゲート) 解決: 支払う or 辞退。
   * "pay" のとき pending.entries[0].sourceInstanceId (このカード自身) を破棄してダメージを
   * 0 に置換、"decline" のとき破棄せず次エントリへ／全消化後 pendingAmount を適用する。
   * 破棄候補はソースカード自身固定のため候補選択は無い。
   */
  lifeDamageDiscardChoice?: "pay" | "decline";
  /**
   * LifeGainReplacementChoice (`life_gain_replacement` CE、BSTH02.7-X03 effects[3]) 解決:
   * 置換する (相手のライフのコア1個をトラッシュに置き増加をキャンセル) か辞退する
   * (通常通り増やす) か。
   */
  lifeGainReplacementChoice?: "replace" | "decline";
  /** CoreShoot: プレイヤーが選択したコア分配。instanceId → 取る通常コア数 */
  coreShootDistribution?: Record<string, number>;
  /** CoreShoot: ソウルコアを取るカードの instanceId */
  coreShootSoulCoreInstanceId?: string;
  /**
   * PayToActCoreGate (gate_flash_stack_core。BSTS01-M03) 解決: トラッシュへ送る
   * コア源コンテナ。reserve はセンチネル `"reserve"`、フィールドカードは instanceId。
   * pending.candidates のいずれかでなければならない。
   */
  payToActCoreSourceContainerId?: string;
  /** 発揮前提のコア移動で持ち主が選ぶ種類。省略時は通常コア。 */
  payToActCoreKind?: "normal" | "soul";
  /**
   * PayToActCoreGate 解決: 支払いを拒否する (= そのフラッシュ/スタック効果を発揮しない)。
   * true のとき payToActCoreSourceContainerId は無視され、対象効果は不発になる
   * (カードはトラッシュへ＝空撃ち類似)。コア源が無い場合の唯一の選択肢。
   */
  payToActCoreGateDecline?: boolean;
  /**
   * PayToActHandDiscardGate 解決: 破棄する手札カード instanceId 群。
   * requiredCount と同数で、pending.candidateSlots に atomic に割当可能でなければならない。
   */
  payToActHandDiscardCardInstanceIds?: readonly string[];
  /**
   * PayToActHandDiscardGate 解決: 支払い拒否 (= 対象効果を発揮しない)。
   */
  payToActHandDiscardGateDecline?: boolean;
  /**
   * FieldMagicPreCostTrigger (offer_magic_pre_cost_trigger。BSAZ01-C12「戦力投入」) 解決:
   * `"trigger"` でメイン効果をコスト支払い前に発揮する。省略時・`"decline"` は中断していた
   * マジック使用のコスト支払いをそのまま再開する。
   */
  fieldMagicPreCostTriggerDecision?: "trigger" | "decline";
  /**
   * CoreSplit (core_move splitDestinations 解決): 各 destination index への配分。
   * destinations と同じ順序、合計 = pending.totalAmount。
   */
  coreSplitDistribution?: number[];
  /**
   * split_field_entry_choice 解決 (ENGINE-sequential-slot-choice、BSSL01-X01[5,6]):
   * 出すトークン体数 (0..maxTokenCount)。省略時 0。
   */
  splitSummonTokenCount?: number;
  /**
   * split_field_entry_choice 解決: ゾーン召喚する具体カード instanceId 集合
   * (zoneCandidateInstanceIds の部分集合、重複不可)。省略時 []。
   * `splitSummonTokenCount + splitSummonZoneCardInstanceIds.length <= pending.totalCount`。
   */
  splitSummonZoneCardInstanceIds?: string[];
  /**
   * P3-88 CoreCount (「コアN個まで」解決): 移動するコア数 (min〜max)。
   */
  coreCountSelection?: number;
  /**
   * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2 CountSelection
   * (「カウントを好きなだけ減らす」解決): 減らすカウント数 (min〜max)。
   */
  countDecreaseSelection?: number;
  /**
   * ENGINE-composite-heterogeneous-removal-budget DiscardSetBurstCountSelection
   * (「バーストN個まで」解決): 破棄するバースト枚数 (min〜max)。
   */
  discardSetBurstCountSelection?: number;
  /**
   * ENGINE-core-move-from-life-owner-soul-choice の解決時 partition。
   * `normalChosen + soulChosen == pending.totalAmount`、
   * 0 ≤ normalChosen ≤ pending.normalAvailable、0 ≤ soulChosen ≤ pending.soulAvailable。
   * soulChosen は実装上 0 or 1 (ソウルコアは 1 個前提)。
   */
  lifeCorePartitionChoice?: { normalChosen: number; soulChosen: number };
  /**
   * CoreSourceAllocation (field_card コスト支払い配分解決): 候補カード instanceId →
   * 取る通常コア数。候補内 / available 以下 / 合計 == pending.requiredTotal が必須
   * (違反は throw)。
   */
  coreSourceAllocations?: Record<string, number>;
  /** CoreSourceAllocation: ソウルコアを取るフィールドカードの instanceId（任意） */
  coreSourceSoulCoreInstanceId?: string;
  /**
   * CoreDistribution (トラッシュ→フィールド): カード instanceId → 置く通常コア数。
   * 合計 ≤ pending.totalNormalCores（0 配分も可）。
   */
  coreDistributionAllocations?: Record<string, number>;
  /**
   * CoreDistribution: ソウルコアを置くカード instanceId ごとの個数（任意）。
   * 合計 ≤ pending.totalSoulCores。旧 UI 互換の
   * `coreDistributionSoulCoreInstanceId` と同時指定した場合はこちらを優先する。
   */
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  /** CoreDistribution: ソウルコアを置くカードの instanceId（任意） */
  coreDistributionSoulCoreInstanceId?: string;
  /**
   * P3-47 F-5: multi-source CoreDistribution (fromKind="any_movable") 用の
   * ソウルコア source 別取得数。key = "reserve" / "trash" / "life" / `field:<instanceId>`。
   * 合計は `coreDistributionSoulCoreAllocations` の合計と一致する必要がある。
   * 各値は `pending.soulSourceAvailable[key]` を超えてはならない。
   */
  coreDistributionSoulCoreSourceAllocations?: Record<string, number>;
  /**
   * P3-47 F-5: multi-source CoreDistribution (fromKind="any_movable") 用の
   * ソース別取得コア数。key = "reserve" / "trash" / "life" / `field:<instanceId>`。
   * 合計は `coreDistributionAllocations` の合計と一致する必要がある。
   * 各値は `pending.sourceAvailable[key]` を超えてはならない。
   * `fromKind="any_movable"` の場合は必須。単一ソース時は無視される。
   */
  coreDistributionSourceAllocations?: Record<string, number>;
  /**
   * P3-49 placement_multi: 複数体同時召喚の per-target 配置入力。
   * 各 entry は `destinationInstanceId` (pending.targets[].instanceId のいずれか) と
   * 該当カードへの `EnterFieldCorePlacement[]`。pending.targets の各 instanceId につき
   * 1 entry までで minimumCoreCount を満たす必要がある。
   */
  multiPlacementAllocations?: ReadonlyArray<{
    destinationInstanceId: string;
    placements: ReadonlyArray<
      import("../zone/enter-field-placement-execution").EnterFieldCorePlacement
    >;
  }>;
  /** チェンジ: プレイヤーが選択した入れ替え対象の instanceId */
  swapTargetInstanceId?: string;
  /**
   * P3-47 F-4: confirm_target_redirect 時に GUI から渡す差し替え先 instanceId。
   * pending.candidateTokenInstanceIds の中から 1 体を指定する (裁定 #5)。
   */
  redirectTargetReplacementInstanceId?: string;
  /**
   * reselect 型 redirect の confirm 時に GUI から渡す差し替え先 instanceId 群。
   * 元 TargetSpec の対象数を保つため、pending.redirectableInstanceIds と同数が必須。
   */
  redirectTargetReplacementInstanceIds?: readonly string[];
}

/** DeckReveal pending 解決結果 */
export interface ResolvePendingDeckRevealResult {
  state: GameState;
}

/** ZoneSelection pending 解決結果 */
export interface ResolvePendingZoneSelectionResult {
  state: GameState;
}

/** StepOptionalChoice (EffectStep.executionMode === "optional") 解決結果 */
export interface ResolvePendingStepOptionalChoiceResult {
  state: GameState;
}

/** EffectStep.choice 分岐選択 pending 解決結果 */
export interface ResolvePendingStepChoiceResult {
  state: GameState;
}

/** ConnectBattleDecision (BSTH06-X03【三歩必殺】等の連続バトル続行/終了選択) 解決結果 */
export interface ResolveConnectBattleDecisionResult {
  state: GameState;
}

/** DeckRevealCountBoostChoice (grant_optional_deck_reveal_count_boost CE) 解決結果 */
export interface ResolvePendingDeckRevealCountBoostChoiceResult {
  state: GameState;
}

/** StepOptionalTargetSelection (optional step 自身の target 選択) 解決結果。 */
export interface ResolvePendingStepOptionalTargetSelectionResult {
  state: GameState;
}

/** DrawStepCostChoice pending 解決結果（コスト先払い型ドロー枚数修正 model A）。 */
export interface ResolvePendingDrawStepCostChoiceResult {
  state: GameState;
}

/**
 * SummonCostExcludeChoice pending 解決結果。除外選択を確定した上で通常の summon を
 * 即座に実行するため、通常の summon action と同じく `chainId`（main step 以外で
 * スタック窓が開いた場合）を持ちうる。
 */
export interface ResolvePendingSummonCostExcludeChoiceResult {
  state: GameState;
  chainId?: string;
}

/**
 * SummonCostCoreMoveChoice pending 解決結果。移動枚数+移動先を確定した上で通常の summon を
 * 実行する（同一 chokepoint、除外型と同型）。
 */
export interface ResolvePendingSummonCostCoreMoveChoiceResult {
  state: GameState;
  chainId?: string;
}

/** GroupedSummonCostOverrideChoice pending 解決結果 (BSTH02.7-C06 branch2)。 */
export interface ResolvePendingGroupedSummonCostOverrideChoiceResult {
  state: GameState;
}

/** LifeDamageDiscardChoice pending 解決結果（discardCostGate 破棄コストゲート）。 */
export interface ResolvePendingLifeDamageDiscardChoiceResult {
  state: GameState;
}

/** LifeGainReplacementChoice pending 解決結果（life_gain_replacement CE）。 */
export interface ResolvePendingLifeGainReplacementChoiceResult {
  state: GameState;
}

/** CoreShoot pending 解決結果 */
export interface ResolvePendingCoreShootResult {
  state: GameState;
}

/** 効果対象選択 pending 解決結果 */
export interface ResolvePendingEffectTargetResult {
  state: GameState;
}

/** card_event 効果借用の「効果1つ」選択 pending 解決結果 */
export interface ResolveBorrowedEffectChoiceResult {
  state: GameState;
}

/** card_event 効果借用の借用効果内対象選択 pending 解決結果 */
export interface ResolveBorrowedEffectTargetResult {
  state: GameState;
}

export interface ResolvePendingCoreSplitResult {
  state: GameState;
}

/** ENGINE-sequential-slot-choice (BSSL01-X01[5,6]) split_field_entry_choice pending 解決結果 */
export interface ResolvePendingSplitSummonChoiceResult {
  state: GameState;
}

/** P3-88 CoreCount pending 解決結果 */
export interface ResolvePendingCoreCountResult {
  state: GameState;
}

/**
 * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2:
 * 「カウントを好きなだけ減らす」pending 解決結果。
 */
export interface ResolvePendingCountSelectionResult {
  state: GameState;
}

export interface ResolvePendingEffectOptionalRepeatChoiceResult {
  state: GameState;
}

export interface ResolvePendingEffectOptionalRepeatCountResult {
  state: GameState;
}

/**
 * ENGINE-composite-heterogeneous-removal-budget: 「バーストN個まで」pending 解決結果。
 */
export interface ResolvePendingDiscardSetBurstCountSelectionResult {
  state: GameState;
}

/** ENGINE-core-move-from-life-owner-soul-choice pending 解決結果 */
export interface ResolvePendingLifeCoreSelectionResult {
  state: GameState;
}

/** field_card コスト支払い配分 pending 解決結果 */
export interface ResolveCoreSourceAllocationResult {
  state: GameState;
}

/** 効果文内 summon コスト支払い pending 解決結果 */
export interface ResolvePendingEffectSummonCostPaymentResult {
  state: GameState;
}

/** 【リンクエイド】効果文内コスト支払い元選択 pending 解決結果 */
export interface ResolvePendingLinkAidCostSourceChoiceResult {
  state: GameState;
}

/** 煌臨元への追加置換 (advent_source) pending 解決結果。 */
export interface ResolveAdventSourceReplacementResult {
  state: GameState;
}

/** 魂状態置換 (soul state) pending 解決結果。 */
export interface ResolveSoulStateReplacementResult {
  state: GameState;
}

/** CoreDistribution pending 解決結果 */
export interface ResolvePendingCoreDistributionResult {
  state: GameState;
}

export interface ResolvePendingEnterFieldPlacementResult {
  state: GameState;
}

/** ブレイヴ合体選択 pending 解決結果 */
export interface ResolveBraveCombineChoiceResult {
  state: GameState;
}

/** P3-49 placement_multi pending 解決結果 */
export interface ResolvePendingMultiPlacementResult {
  state: GameState;
}

/** 転召（召喚手順内ステップ）の強制コア消費の解決結果。 */
export interface ResolveTenshoSummonResult {
  state: GameState;
}

/** 神技/界放/契約技/導技（use_divine_skill）の発揮宣言結果。発揮宣言でスタック窓を開く。 */
export interface DivineSkillActionResult {
  ok: true;
  state: GameState;
}

export interface ResolvePrivateTriggeredEffectDeclarationResult {
  state: GameState;
  declarationId: string;
  declared: boolean;
}

/**
 * P3-47 F-4: 効果対象リダイレクト解決結果。
 * - confirm: redirected = true、resolvedAfterRedirect に置換後 instanceId 列が入る
 * - decline: redirected = false、resolvedAfterRedirect は元の集合と同一
 *
 * 呼び出し側 (元効果の continuation) は本結果を受けて、redirected に応じて
 * 置換後の対象集合で元アクションを再実行する。Step 3a (本実装) では continuation
 * 部分は未配線なので、結果は `state.pendingTargetRedirects` を消費するのみで終了する。
 */
export interface ResolveTargetRedirectResult {
  state: GameState;
  pendingId: string;
  redirected: boolean;
  resolvedAfterRedirect: string[];
}

export interface SetQuartzActionResult {
  state: import("../model").GameState;
  quartzInstanceId: string;
  hostInstanceId: string;
  slot: "left" | "center" | "right";
}

/**
 * flip_instead_of_attack (BSDB01-TX01(A) 型) の適用結果。declare_manifest 同様、
 * ここでは preDeclarationStackWindow を開くところまでで、実際の疲労/面反転/カウント
 * 増加は窓クローズ後の deferred 解決 (resolveDeferredFlipInsteadOfAttackStack) が行う。
 */
export interface FlipInsteadOfAttackResult {
  state: import("../model").GameState;
}

export type ApplyLegalActionResult =
  | SetQuartzActionResult
  | FlipInsteadOfAttackResult
  | ResolvePendingTriggeredEffectResult
  | ResolvePrivateTriggeredEffectDeclarationResult
  | ResolvePendingBurstCheckResult
  | FieldEffectActionResult
  | BattleImmediateEffectActionResult
  | MagicActionResult
  | AccelActionResult
  | ChangeActionResult
  | DeclareAdventResult
  | SetBurstActionResult
  | AttackDeclarationResult
  | BlockDeclarationResult
  | OpenBattleFlashResult
  | PassBattleFlashResult
  | PassStackResult
  | PassPreDeclarationStackResult
  | DeclineBlockResult
  | ResolvePendingDeckRevealResult
  | ResolvePendingZoneSelectionResult
  | ResolvePendingStepChoiceResult
  | ResolvePendingDrawStepCostChoiceResult
  | ResolvePendingSummonCostExcludeChoiceResult
  | ResolvePendingSummonCostCoreMoveChoiceResult
  | ResolvePendingGroupedSummonCostOverrideChoiceResult
  | ResolvePendingLifeDamageDiscardChoiceResult
  | ResolvePendingLifeGainReplacementChoiceResult
  | ResolvePendingCoreShootResult
  | ResolvePendingEffectTargetResult
  | ResolvePendingEffectOptionalRepeatChoiceResult
  | ResolvePendingEffectOptionalRepeatCountResult
  | ResolveBorrowedEffectChoiceResult
  | ResolveBorrowedEffectTargetResult
  | ResolvePendingCoreSplitResult
  | ResolvePendingSplitSummonChoiceResult
  | ResolvePendingCoreCountResult
  | ResolvePendingCountSelectionResult
  | ResolvePendingDiscardSetBurstCountSelectionResult
  | ResolvePendingLifeCoreSelectionResult
  | ResolveCoreSourceAllocationResult
  | ResolvePendingLinkAidCostSourceChoiceResult
  | ResolvePendingEffectSummonCostPaymentResult
  | ResolveAdventSourceReplacementResult
  | ResolveSoulStateReplacementResult
  | ResolvePendingCoreDistributionResult
  | ResolvePendingEnterFieldPlacementResult
  | ResolveBraveCombineChoiceResult
  | ResolveTenshoSummonResult
  | ResolvePendingMultiPlacementResult
  | DivineSkillActionResult
  | ResolveTargetRedirectResult;

/**
 * `tryApplyLegalAction` の戻り値。
 * - `ok: true` — アクション成功。`result` に通常の結果が入る。
 * - `ok: false` — 実行不能。`state` は元の状態 + ロールバックログ。
 */
export type SafeActionResult =
  | { ok: true; result: ApplyLegalActionResult }
  | { ok: false; state: GameState; error: string };
