import { getCardUseSourceZone } from "../card/card-lookup";
import { checkAndQueueOracleChoicesForTriggerBatch } from "../mechanics/oracle-system";
import { isAwaitingEffectEntryCores } from "../zone/enter-field-placement-pending";
import {
  hasPendingEffectResolution,
  updateCommittedContinuousEffects,
} from "./pending-resolution-policy";
import { isPrivateTriggeredDeclarationConditionMet } from "./private-triggered-eligibility";
import { createEffectResolutionScope } from "./effect-resolution-scope";
import { getOwnEffectSourceZone } from "./card-access-rules";
import { getTriggeredMechanicActivationState } from "./triggered-mechanic-eligibility";
import { isTriggeredSourceUsageAvailable } from "./triggered-source-usage";
import { scopeInnermostTriggerReactions } from "./trigger-resolution-scope";
import { collectPendingStacks } from "../legal/stack-collection-helpers";
import {
  assertTriggerChainId,
  allocateRootTriggerChain,
  getTriggerEventChainKey,
  requireTriggerChainId,
} from "../chain-id";
import { isCausedReactionNegated } from "./caused-reaction-negation";
import { evaluateEffectApplicabilityForCard } from "./effect-applicability-core";
import {
  collectHandIncreases,
  getPendingHandReturnEffectPlayerId,
} from "../zone/hand-increase";
import {
  getRebirthEffectGate,
  hasRebirthResolvedInTimingWindow,
  getPendingTriggeredRebirthTimingWindowId,
} from "./structured-card-replacement";
import { queueNewlyEnabledBattleImmediateEffects } from "../battle/battle-timing-reevaluation";
import { getCardById, getStackSourceActivationZone } from "../card/card-lookup";
import { isInstanceInOpenResponseWindowOrPendingCascade } from "../stack/stack-window-shared";
import { matchesCardReferenceFilter } from "../card/card-filter";
import { isTimingScopeActive } from "../card/ce-lookup";
import { matchesDeclaredCardEventKind } from "../zone/leave-field-event-matching";
import { getPlayerLifeCoreCount } from "../core/core-system";
import {
  getEffectiveCategory,
  isAttachedCombinedChild,
} from "../mechanics/act-as-spirit";
import {
  expandWithSoulStateInheritingKeyBraves,
  getEffectiveSoulStateIds,
} from "../mechanics/magic-compatible-soul-state";
import {
  createChainResolveEffectQueueEntry,
  setEffectQueueEntries,
} from "./effect-queue";
import {
  flushPendingLeaves,
  hasOutstandingEffectResolutionContinuation,
  hasPendingLeaveIdentityChanged,
  trackPendingLeaveResolutionReactions,
  runStateBasedActions,
} from "../state-based-actions";
import {
  canTriggerFromPendingLeaveSource,
  pendingLeaveKindToTriggerEventKind,
} from "../zone/pending-leave-trigger-event-kind";
import type { EffectFilterTag } from "../state-based-actions";
import {
  canUseEffectByUsageLimit,
  getBraveSelfReferenceRewriteStatus,
  getEffectExecutionMode,
  getCombinedUnitCostFilterOptions,
  getEffectiveColors,
  getEffectiveTribes,
  getMidBattleJoinGrant,
  getEffectSourceTribePreventionBypass,
  getStableEffectLabel,
  isBurstEffectNullifiedByOpponent,
  isCardManifestRestricted,
  mergeRegistrationChoiceVariant,
  executeReevaluationCheck,
  runReevaluationAtTiming,
} from "../legal/legal-actions-shared";
import type { ReevaluationConfig } from "../legal/legal-actions-shared";
import { recomputeAndRebuildContinuousEffects } from "./continuous-effect-rebuild";
import {
  recomputeBattleEntityBp,
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  getBattleEndDeferralChainId,
  getBattleEndFinalizeAttackIdForPending,
  isBattleEndDeferralChainForAttack,
  maybeFinalizeBattleEndScopeExpirations,
} from "../battle/battle-end-scope-finalize";
import type { EffectSourceKind, FieldEffectSourceKind } from "../source-kinds";
import { isCategoryCompatibleWithSourceKind } from "../source-kinds";
import type {
  BurstEventKind,
  CardColor,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ActiveStack,
  EffectCategory,
  EffectComposition,
  EffectEventScope,
  EffectExecutionMode,
  EffectActivationSourceZone,
  EffectActivationTiming,
  ActivatedEffectLabel,
  EffectForceLevel,
  EffectPreventionLevel,
  EffectReevaluationPoint,
  EffectUsageLimit,
  GameState,
  LifeCoreMoveEffectKind,
  SuppressionEffectDescriptor,
  PendingBurstCheck,
  PendingLeaveEntity,
  PendingPrivateDeclaration,
  PendingTriggeredEffect,
  StructuredTriggerEvent,
  StructuredTriggerEventActionKind,
  StructuredTriggerEventCauseKind,
  StructuredTriggerEventFamily,
  SupplementalTriggerEvent,
  TriggerEventCause,
  TriggerEventKind,
  TriggerPriority,
  TriggerEventSource,
  TurnSummonedCardRef,
  Zone,
} from "../model";
import {
  adventSourceIdsOf,
  collectUnderCardScopeIds,
  getQuartzSetStatesByHost,
  hasIndependentCoreManagement,
  isCardInSetState,
  isTextRoleUnderCard,
  textRoleUnderCardIdsOf,
} from "../model";
import type {
  Applicability,
  ApplicabilityZone,
  Effect,
  EffectStep,
} from "../dsl-types";
import {
  mapZoneToApplicabilityZone,
  matchesApplicabilityZoneList,
} from "../dsl-types";
import {
  evaluateCondition,
  getCardCurrentLevel,
  getEffectTribeGrants,
  type TriggerContext,
} from "./structured-effect-interpreter";
import type { ConditionSourceContext } from "./structured-condition-eval";
import {
  applyTriggerConditionResults,
  collectTriggerConditionResults,
  getObservedTriggerConditionResults,
} from "./trigger-condition-observation";
import {
  checkAndQueueStoneRebirthChoices,
  queueUnsealChoicesFromTriggerEvents,
} from "../mechanics/grandstone-system";
import { rebuildContinuousEffectsAfterPendingLeaveFlush } from "../zone/pending-leave-continuous-upkeep";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../mechanics/grant-effect-system";
import {
  isTextRoleUnderActiveSpiritHost,
  isActiveTextRoleUnderEffectSource,
  isTextRoleUnderHeaderLine,
  type TextRoleUnderSourceRole,
} from "../mechanics/star-garment-utils";
import {
  mergeTargetLockBypassProfiles,
  type TargetLockBypassProfile,
} from "./target-affect-gate";
import { executeSuppressPendingLeaveEffects } from "./native-move-core-handlers";
import { triggerCauseListMatches } from "./trigger-cause-match";
import {
  isExactOccurrenceMatch,
  recordEffectOccurrence,
} from "./effect-occurrence-gate";
import {
  canPayRequiredEffectCosts,
  type RequiredEffectCostFilterOptions,
} from "../legal/required-effect-cost-gate";

export type TriggeredEffectTargetPlayerScope =
  | "any"
  | "acting_player"
  /** P3-52: 対象は acting_player の相手プレイヤーのカードに限定。 */
  | "opponent";

export interface TriggeredEffectLifeCoreChoice {
  effectKind?: LifeCoreMoveEffectKind;
  destinationKind: "source_card" | "target_card";
  targetIndex?: number;
}

/**
 * P3-24 Phase 2: choice ステップの選択肢ごとのメタデータ。
 * 1 effect = 1 registration の原則に従い、choice 変種は registration.choices に集約する。
 * choices[0] = デフォルト action、choices[1+] = choice[N-1] 各エントリ。
 */
export interface TriggeredEffectChoiceVariant {
  /** choice 表示用の短いラベル（例: "手札に戻す", "ドロー"）。 */
  label: string;
  /** choice variant が対象にする、トリガー元効果の発揮タイミング。 */
  triggerEffectTiming?: EffectActivationTiming;
  requiredTargetCount?: number;
  /** D-2 Phase 2: 可変選択時の上限。省略時 = requiredTargetCount。 */
  maxTargetCount?: number;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: TriggeredEffectTargetPlayerScope;
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  sourceUnderCardRole?: "advent_source" | "text_role";
  targetRequiresFullCount?: boolean;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  targetSelectionBypassesAffectGate?: boolean;
  targetCandidatesRequireSetBurstState?: boolean;
  targetGroups?: readonly import("../legal/legal-actions-types").RegisteredTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  /**
   * D-2 Phase 2 chooser: 対象選択を行うプレイヤー（効果オーナー基準）。
   * - 省略時 / "self" = 効果オーナーが選ぶ（既存挙動）
   * - "opponent" = 効果オーナーの相手が選ぶ
   */
  chooser?: "self" | "opponent" | "either";
  /**
   * 変種ごとに独立した使用制限 (「これらの効果はターンに1回ずつしか使えない」)。
   * EffectStep.usageLimit (choices[0]) / choice[k].usageLimit (choices[k+1]) 由来。
   * effect 単位の registration.usageLimit (共有制限) とは別軸で、
   * `getChoiceVariantUsageLabel` の変種別ラベルで検査・記録する。
   */
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
}

export interface RegisteredTriggeredEffectAction {
  sourceKind: FieldEffectSourceKind;
  eventKind: TriggerEventKind;
  eventMatcher?: TriggerEventMatcher;
  /** game_event registration で pending.eventKind と完全一致させる。 */
  exactGameEventKind?: boolean;
  /** この registration を発揮できる source role。 */
  requiredSourceRole?: TextRoleUnderSourceRole;
  /** phase timing の「自分の/相手の/お互いの」プレイヤー限定 */
  whose?: import("../model").EffectPlayerRef;
  effectCategory?: EffectCategory;
  executionMode?: EffectExecutionMode;
  triggerPriority?: TriggerPriority;
  forceLevel?: EffectForceLevel;
  preventionLevel?: EffectPreventionLevel;
  targetLockBypass?: TargetLockBypassProfile;
  composition?: EffectComposition;
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  /**
   * 共有使用制限グループ ID。`Effect.limitGroupId` から伝搬。
   * 同一 instance 内で異なる timing に分離された effect が
   * 「ターンに1回」等の usage 制限を共有するためのキー。
   * 設定時は effectLabel ではなく groupId でレコードをマッチする。
   */
  limitGroupId?: string;
  /**
   * `Effect.occurrenceGate` から伝搬。詳細は model.ts `EffectOccurrenceGate` を参照。
   * `queueReactionsInternal` が source choice 列挙直後（private/public 分岐前）に
   * 一律で tally + ゲート判定する。
   */
  occurrenceGate?: import("../model").EffectOccurrenceGate;
  reevaluationPoints?: readonly EffectReevaluationPoint[];
  /** `suppress_effect` の effectFilter 突き合わせ用記述子（登録時に効果から導出）。 */
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
  requiredTargetCount?: number;
  /** D-2 Phase 2: 可変選択時の上限。省略時 = requiredTargetCount。 */
  maxTargetCount?: number;
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  /**
   * 空撃ち制御: 対象が「ことで」コストの効果側 (connector:conditional_cost) か。
   * true なら対象 0 体での空撃ちを禁止する (10_rules/03b:34)。
   */
  targetGatedByConditionalCost?: boolean;
  sourceUnderCardRole?: "advent_source" | "text_role";
  targetRequiresFullCount?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: TriggeredEffectTargetPlayerScope;
  actingPlayerLifeCoreChoice?: TriggeredEffectLifeCoreChoice;
  /**
   * D-2 Phase 2 chooser: 対象選択を行うプレイヤー（効果オーナー基準）。
   * - 省略時 / "self" = 効果オーナーが選ぶ（既存挙動）
   * - "opponent" = 効果オーナーの相手が選ぶ
   * 効果オーナー（actingPlayerId）は据え置き、prompt 相手のみ反転される。
   */
  chooser?: "self" | "opponent" | "either";
  reason?: string;
  /** effects 配列内のインデックス。 */
  effectIndex?: number;
  /**
   * P3-24 Phase 2: choice 変種メタデータ。
   * 存在する場合は choices.length 個の legal action に展開される (各々別 choiceIndex)。
   * 省略時は choice なしの単一 action effect（top-level の target 系メタを使用）。
   */
  choices?: readonly TriggeredEffectChoiceVariant[];
  /** 効果発動元カードが存在すべきゾーン（applicability.zone 由来）。省略時 = "field"。 */
  sourceZone?:
    | import("../dsl-types").ApplicabilityZone
    | readonly import("../dsl-types").ApplicabilityZone[];
  /**
   * Effect.applicability をそのまま保持。誘発候補列挙時に
   * `evaluateTriggeredApplicability` で level / combined / soulState を再評価する。
   * (zone は sourceZone 経由で別途扱うため、ここでは zone 以外も含めて素のまま保存し、
   * 重複検査になっても挙動は不変。)
   * 型は RegisteredTargetedEffectActionBase.applicability と揃えて、
   * `extractFieldTargetingMetadata` の戻り値 Partial<...> をそのまま spread できるようにする。
   */
  applicability?: import("../dsl-types").Effect["applicability"];
  /**
   * P3-73: timing と直交する『誰のいつ』スコープ (`Effect.timingScope` から伝搬)。
   * 誘発効果でも『自分のアタックステップ』等を強制するため、source 候補列挙時に
   * `isTimingScopeActive` で current `state.step` / `state.activePlayerId` と照合する。
   * eventMatcher は period→step しか持たず player（自分の/相手の）を見ないため必須。
   */
  timingScope?: import("../model").TimingScope;
}

function getTriggerPriority(value: {
  triggerPriority?: TriggerPriority;
}): TriggerPriority {
  return value.triggerPriority ?? "normal";
}

/**
 * P3-24 Phase 2: choice 変種メタを registration top-level にマージした擬似 registration を生成。
 * 既存の getRequiredTargetCount / getCandidateTargetInstanceIds 等のアクセサが
 * actionRegistration を直接読む前提のため、変種ごとにマージ済みオブジェクトを渡せるようにする。
 *
 * choices に上書き対象フィールドが存在しない場合は、registration の top-level の値ではなく
 * variant 由来の undefined にする (top-level は choices 不在時のデフォルトであり、
 * choices 持ちの effect では variant 単独の値だけが意味を持つ)。
 * マージ規則の正源は `mergeRegistrationChoiceVariant` (legal-actions-shared, SSOT)。
 */
export function mergeTriggeredChoiceVariant(
  registration: RegisteredTriggeredEffectAction,
  variant: TriggeredEffectChoiceVariant
): RegisteredTriggeredEffectAction {
  return mergeRegistrationChoiceVariant(registration, variant);
}

export type BurstEffectChoiceVariant = TriggeredEffectChoiceVariant;

export interface RegisteredBurstAction {
  sourceKind: EffectSourceKind;
  eventKind: BurstEventKind;
  eventMatcher?: TriggerEventMatcher;
  /**
   * P3-67 Phase 1: バースト発動条件の「誰の」プレイヤー絞り。
   * - "self" = イベントの対象がバースト所有者自身 (例: 自分のライフ減少後 / 相手によって自分のスピリットが離れた後)
   * - "opponent" = イベントの対象が相手 (例: 相手のスピリットのアタック後)
   * - "either" / 省略 = フィルタなし
   *
   * 評価は `pendingBurstCheck.relatedPlayerId`（イベントの対象プレイヤー）と
   * バースト所有者 (`sourceCard.controllerPlayerId`) の一致で行う。triggered の
   * `whose` と異なり、burst は responder が actingPlayerId で先に絞られているため、
   * これは relatedPlayer_id 軸での厳密化として働く。
   */
  whose?: import("../model").EffectPlayerRef;
  /**
   * P3-67 Phase 2: 発動条件のカードフィルタ (色・系統・カテゴリ等)。
   * `pendingBurstCheck.relatedInstanceId` のカードが満たすべき条件。
   * 例: 「相手のアルティメットの…」→ category: ["ultimate"]。
   * relatedInstanceId が無いイベント (reduce_life 等) では評価不能のため fail-closed。
   */
  triggerFilter?: import("../dsl-types").CardFilter;
  /**
   * P3-67: 離脱原因 (cause) フィルタ。「相手によって自分のスピリットが離れた後」等の
   * leave_field 系バーストで、自分効果由来の離脱 (self_effect) では発動しないよう絞る。
   * 指定時は `pendingBurstCheck.event.cause` がこの集合に含まれる場合のみ発動。
   * cause を持たないイベント (event.cause === undefined) では fail-closed (発動しない)。
   * 省略時は cause を問わず発動 (後方互換)。
   */
  cause?: readonly TriggerEventCause[];
  effectCategory?: EffectCategory;
  executionMode?: EffectExecutionMode;
  forceLevel?: EffectForceLevel;
  preventionLevel?: EffectPreventionLevel;
  targetLockBypass?: TargetLockBypassProfile;
  composition?: EffectComposition;
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  reevaluationPoints?: readonly EffectReevaluationPoint[];
  /** `suppress_effect` の effectFilter 突き合わせ用記述子（登録時に効果から導出）。 */
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
  requiredTargetCount?: number;
  /** D-2 Phase 2: 可変選択時の上限。省略時 = requiredTargetCount。 */
  maxTargetCount?: number;
  maxTargetCountDynamic?: import("../dsl-types").CountBound;
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: TriggeredEffectTargetPlayerScope;
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  sourceUnderCardRole?: "advent_source" | "text_role";
  targetRequiresFullCount?: boolean;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  targetGroups?: readonly import("../legal/legal-actions-types").RegisteredTargetGroup[];
  actingPlayerLifeCoreChoice?: TriggeredEffectLifeCoreChoice;
  chooser?: "self" | "opponent" | "either";
  /**
   * P3-24 Phase 2: choice 変種メタデータ。
   * 存在する場合は pending burst legal action を choices.length 個に展開する
   * (各々別 choiceIndex)。
   */
  choices?: readonly BurstEffectChoiceVariant[];
  playSourceCardWithoutCostAfterResolve?: boolean;
  useSourceCardWithoutCostAfterResolve?: boolean;
  playTargetCardWithoutCostAfterResolve?: boolean;
  useTargetCardWithoutCostAfterResolve?: boolean;
  /**
   * 手札からの直接バースト発動（裁定 2026-06-16, 10_rules/04b §手札からの直接バースト発動）。
   * true のとき発動源を手札ゾーンに許可する（バーストエリア事前セット不要）。
   */
  handSource?: boolean;
  /** 手札ソースバーストの追加発動条件（発動宣言時に評価）。 */
  handSourceCondition?: readonly import("../model").ConditionClause[];
  reason?: string;
  /** effects 配列内のインデックス。choice 条件・解決対象識別に使う。 */
  effectIndex?: number;
}

export type TriggeredEffectActionRegistrationLookup = (
  cardNo: string
) => readonly RegisteredTriggeredEffectAction[] | undefined;

export type BurstActionRegistrationLookup = (
  cardNo: string
) => readonly RegisteredBurstAction[] | undefined;

export const EMPTY_TRIGGERED_EFFECT_ACTION_REGISTRATION_LOOKUP: TriggeredEffectActionRegistrationLookup =
  () => [];

export function getTriggeredEffectActionRegistrationLookupOrEmpty(
  lookup: TriggeredEffectActionRegistrationLookup | null | undefined
): TriggeredEffectActionRegistrationLookup {
  return typeof lookup === "function"
    ? lookup
    : EMPTY_TRIGGERED_EFFECT_ACTION_REGISTRATION_LOOKUP;
}

function getBurstIgnoresOpponentCannotActivateBurst(
  burstDefinition: CardDefinition | undefined,
  effectIndex: number | undefined,
  allowLegacyWholeCardScan: boolean
): boolean {
  if (burstDefinition === undefined) return false;
  const effects = burstDefinition.effects ?? [];
  if (effectIndex !== undefined) {
    const effect = effects[effectIndex];
    return (
      effect?.timing.kind === "burst" &&
      effect.ignoresOpponentCannotActivateBurst === true
    );
  }
  if (!allowLegacyWholeCardScan) return false;
  return effects.some(
    (effect) =>
      effect.timing.kind === "burst" &&
      effect.ignoresOpponentCannotActivateBurst === true
  );
}

export interface TriggeredEffectSourceChoice {
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceEffectDefinition: CardDefinition;
  sourceEffectInstanceId?: string;
  sourceEffectDefinitionId?: string;
  sourceKind: FieldEffectSourceKind;
  registrationIndex: number;
  actionRegistration: RegisteredTriggeredEffectAction;
  /** 収集専用。公開登録のイベント述語だけを記録する。 */
  eventConditionResults?: Record<string, boolean>;
}

export interface BurstSourceChoice {
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceKind: EffectSourceKind;
  registrationIndex: number;
  actionRegistration: RegisteredBurstAction;
}

export interface CollectedTriggerEvent {
  semanticEventId?: number;
  resolvedActionKinds?: readonly import("../dsl-types").Action["kind"][];
  actingPlayerId: string;
  eventKind: TriggerEventKind;
  source: TriggerEventSource;
  chainId: string | null;
  attackId: string | null;
  relatedPlayerId: string | null;
  relatedInstanceId: string | null;
  /** brave_combined event 時点の合体先 host snapshot。 */
  triggerRelatedCombinedHostInstanceId?: string;
  amount: number | null;
  /**
   * P3-14 C-5: イベントの行為種別。battle_end でアタック側/ブロック側参加カードを
   * 区別する (`Timing.action` → eventMatcher.actionKind の絞り込み元)。
   */
  actionKind?: import("../model").StructuredTriggerEventActionKind;
  /** step_timing 系イベントでどのステップの開始/終了かを識別 */
  step?: import("../model").Step;
  /** ステップ開始時 / 終了時 を区別 */
  subPhase?: "start" | "end";
  /** leave_field 系イベントの離脱原因（PendingLeaveEntity から導出） */
  cause?: TriggerEventCause;
  /** `Timing.triggerCausedBy` 用の、イベントを直接引き起こしたプレイヤー。 */
  causedByPlayerId?: string;
  /**
   * enter_field 系イベント (summon / place / advent) で被誘発カードが場入り前にいたゾーン。
   * `trigger_from_zone` 条件評価に注入する。
   */
  fromZone?: import("../model").Zone;
  /** P3-130: targeted event で relatedInstance がフィールド外での応答窓 (isInstanceInOpenResponseWindow) を
   * queue 時点で満たしていたかのスナップショット。`PendingTriggeredEffect.relatedInstanceOffFieldActivating` 参照。 */
  relatedInstanceOffFieldActivating?: boolean;
  /** suppressDestroyedEffects="destroyed_only" で抑制された破壊カードの instanceId リスト。 */
  suppressedSourceInstanceIds?: string[];
  /** suppressDestroyedEffects="all_opponent" のとき true。全ソースの効果発揮を抑制。 */
  effectSuppressed?: boolean;
  /** triggerSourceFilter 用のイベント source。pendingLeave 内部では効果由来/実バトル由来を分けて保持する。 */
  effectSourceInstanceId?: string;
  /** 複数の実バトル source がある leave-field event 用。 */
  effectSourceInstanceIds?: readonly string[];
  effectSourceDefinitionId?: string;
  /** leave_field 等を起こした効果の防止レベル。 */
  effectSourcePreventionLevel?: import("../model").EffectPreventionLevel;
  effectActionKind?: import("../model").EffectResolutionActionKind;
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
  eligibleSourceInstanceIds?: readonly string[];
  /** enter_field event を起こした効果 index。通常召喚/配置では undefined。 */
  sourceEffectIndex?: number;
  /** 同一 eventKind 内の効果名/機構スコープ。例: put + genkai。 */
  effectScope?: EffectEventScope;
  /** 同じ trigger に紐づく追加主語。`TargetSpec.trigger_related_instances` が参照する。 */
  relatedInstanceIds?: readonly string[];
  /**
   * leave_field イベントで離脱したカードが保持していた煌臨元 (`underCards` role="advent_source")
   * の instanceId スナップショット。host の物理離脱で `underCards` がクリアされる前
   * (`beforeState`) に `adventSourceIdsOf` で捕捉する。第三者 `game_event` 効果が離脱後の
   * このチェーンを召喚対象として参照するための保持領域 (BSSG01-C08 Lv2、
   * engine-advent-source-leave-summon)。
   */
  adventSourceInstanceIds?: readonly string[];
  /** game_event も eventKind exact で照合する。原因別先行収集用。 */
  exactGameEventKind?: boolean;
  /** pendingLeave 生成時点に収集した pre-flush leave event。 */
  preFlushLeaveEvent?: boolean;
  /** 登録済み source を pre-flush で直接 queue した leave event。 */
  registeredPreFlushLeaveEvent?: boolean;
  /** この収集境界では burst check を作らない。物理 leave_field 境界へ委ねる。 */
  suppressBurstCheck?: boolean;
  /** このイベントの pending に最初から注入する解決済み/除外済み source key。 */
  resolvedSourceRegistrationKeys?: readonly string[];
  /**
   * engine-suppress-third-party-summon-observation (BSTH11-X02【現界】): true のとき
   * game_event (第三者観測) リスナーへこのイベントを配送しない。card_event (このカード
   * 自身) は relatedInstanceId===self でのみ反応するため影響を受けない。
   */
  suppressThirdPartyObservation?: boolean;
}

export interface TriggerEventMatcher {
  family: StructuredTriggerEventFamily;
  actionKind?: StructuredTriggerEventActionKind;
  causeKind?: StructuredTriggerEventCauseKind;
  /** step_timing 系: どのステップのイベントにマッチするか */
  step?: import("../model").Step;
  /** ステップ開始時 / 終了時 を区別 */
  subPhase?: "start" | "end";
  /**
   * leave_field 系: 離脱原因の絞り込み。指定時はイベントの cause がこの値
   * (単一) または集合 (配列) に含まれる場合のみマッチ。
   * 省略時は cause を問わず全件マッチ（後方互換）。
   * 配列指定は「バトル討ち取り or 自分の破壊効果」(BSTH01-X08) のように
   * 複数の自分起因 cause をまとめて受ける用途 (burst の cause[] と同様)。
   */
  cause?: TriggerEventCause | readonly TriggerEventCause[];
  effectActionKind?:
    | import("../model").EffectResolutionActionKind
    | readonly import("../model").EffectResolutionActionKind[];
  effectActivationLabel?:
    | ActivatedEffectLabel
    | readonly ActivatedEffectLabel[];
  effectActivationTiming?: EffectActivationTiming;
  /** ENGINE-effect-immunity-own-pending-resolution: `Timing.triggerActivationZone` 由来。 */
  triggerActivationZone?:
    | EffectActivationSourceZone
    | readonly EffectActivationSourceZone[];
  effectScope?: EffectEventScope | readonly EffectEventScope[];
}

export function matchesTriggerEvent(
  matcher: TriggerEventMatcher,
  event: StructuredTriggerEvent
): boolean {
  if (matcher.family !== event.family) {
    return false;
  }

  if (
    matcher.actionKind !== undefined &&
    matcher.actionKind !== event.actionKind
  ) {
    return false;
  }

  if (
    matcher.causeKind !== undefined &&
    matcher.causeKind !== event.causeKind
  ) {
    return false;
  }

  // step_timing: マッチャーが特定ステップを指定している場合、
  // イベントのステップと一致しなければマッチしない
  if (
    matcher.step !== undefined &&
    event.step !== undefined &&
    matcher.step !== event.step
  ) {
    return false;
  }

  // subPhase: マッチャーが開始時/終了時を指定している場合、
  // イベントの subPhase と一致しなければマッチしない
  if (
    matcher.subPhase !== undefined &&
    event.subPhase !== undefined &&
    matcher.subPhase !== event.subPhase
  ) {
    return false;
  }

  // cause: マッチャーが離脱原因を指定している場合、イベントの cause が
  // マッチャーの値 (単一) または集合 (配列) に含まれる必要がある（未設定なら不一致）。
  // "bp_compare" は既存 DSL の互換用総称として、opponent/self 帰属版も受ける。
  if (matcher.cause !== undefined) {
    const allowedCauses = Array.isArray(matcher.cause)
      ? matcher.cause
      : [matcher.cause];
    if (
      event.cause === undefined ||
      !triggerCauseListMatches(allowedCauses, event.cause)
    ) {
      return false;
    }
  }

  if (matcher.effectActionKind !== undefined) {
    const allowedActionKinds = Array.isArray(matcher.effectActionKind)
      ? matcher.effectActionKind
      : [matcher.effectActionKind];
    if (
      event.effectActionKind === undefined ||
      !allowedActionKinds.includes(event.effectActionKind)
    ) {
      return false;
    }
  }

  if (
    matcher.effectActivationTiming !== undefined &&
    matcher.effectActivationTiming !== event.effectActivationTiming
  ) {
    return false;
  }

  if (matcher.effectActivationLabel !== undefined) {
    const allowedLabels = Array.isArray(matcher.effectActivationLabel)
      ? matcher.effectActivationLabel
      : [matcher.effectActivationLabel];
    if (
      event.effectActivationLabel === undefined ||
      !allowedLabels.includes(event.effectActivationLabel)
    ) {
      return false;
    }
  }

  if (matcher.triggerActivationZone !== undefined) {
    const allowedZones = Array.isArray(matcher.triggerActivationZone)
      ? matcher.triggerActivationZone
      : [matcher.triggerActivationZone];
    if (
      event.triggerActivationZone === undefined ||
      !allowedZones.includes(event.triggerActivationZone)
    ) {
      return false;
    }
  }

  if (matcher.effectScope !== undefined) {
    const allowedScopes = Array.isArray(matcher.effectScope)
      ? matcher.effectScope
      : [matcher.effectScope];
    if (
      event.effectScope === undefined ||
      !allowedScopes.includes(event.effectScope)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * PendingLeaveEntity から TriggerEventCause を導出する。
 * - battle 由来 → "battle"（通常バトル破壊は破壊される側の相手が causePlayerId）
 * - bp_compare 由来 → 勝者帰属があれば opponent/self_bp_compare、無ければ "bp_compare"
 *   （効果 BP比べは opponent_effect / 実バトル cause に潰さない）
 * - causePlayerId が相手 (!== カードコントローラー) → "opponent_effect"
 *   (P3-68: state-based のコア不足消滅でも、相手のコア奪取由来で causePlayerId が
 *    帰属していれば opponent_effect。「相手によって離れた」に該当させる裁定 2026-05-29)
 * - state-based-action 由来で causePlayerId が所有者自身 → "state_based_self"
 *   (「自分による消滅では発揮されない」型 triggerFilter で除外するため state_based と分離。
 *    matcher が `state_based` だけ許可する場合、self 帰属の state-based vanish は発火しない)
 * - state-based-action 由来で causePlayerId 未帰属 → "state_based"
 * - それ以外（自分効果由来 / cost_payment 由来等）→ "self_effect"
 */
export function deriveTriggerEventCauseFromPendingLeave(
  pendingLeave: Pick<PendingLeaveEntity, "cause" | "causePlayerId">,
  cardControllerPlayerId: string
): TriggerEventCause {
  if (pendingLeave.cause === "battle") {
    return "battle";
  }
  if (pendingLeave.cause === "bp_compare") {
    if (pendingLeave.causePlayerId !== null) {
      return pendingLeave.causePlayerId !== cardControllerPlayerId
        ? "opponent_bp_compare"
        : "self_bp_compare";
    }
    return "bp_compare";
  }
  if (
    pendingLeave.causePlayerId !== null &&
    pendingLeave.causePlayerId !== cardControllerPlayerId
  ) {
    return "opponent_effect";
  }
  if (pendingLeave.cause === "state_based_action") {
    if (pendingLeave.causePlayerId === cardControllerPlayerId) {
      return "state_based_self";
    }
    return "state_based";
  }
  return "self_effect";
}

export function getPendingLeaveTriggerSourceInstanceIds(
  pendingLeave: Pick<
    PendingLeaveEntity,
    | "causedByEffectSourceInstanceId"
    | "causedByBattleSourceInstanceId"
    | "causedByBattleSourceInstanceIds"
  >
): string[] {
  const sourceIds = new Set<string>();
  if (pendingLeave.causedByEffectSourceInstanceId) {
    sourceIds.add(pendingLeave.causedByEffectSourceInstanceId);
  }
  if (pendingLeave.causedByBattleSourceInstanceId) {
    sourceIds.add(pendingLeave.causedByBattleSourceInstanceId);
  }
  for (const sourceId of pendingLeave.causedByBattleSourceInstanceIds ?? []) {
    sourceIds.add(sourceId);
  }
  return [...sourceIds];
}

export function getPendingLeaveTriggerSourceInstanceId(
  pendingLeave: Parameters<typeof getPendingLeaveTriggerSourceInstanceIds>[0]
): string | undefined {
  return getPendingLeaveTriggerSourceInstanceIds(pendingLeave)[0];
}

function getPendingEffectTriggerSourceInstanceIds(
  pendingEffect: Pick<
    PendingTriggeredEffect,
    "effectSourceInstanceId" | "effectSourceInstanceIds"
  >
): string[] {
  const sourceIds = new Set<string>();
  if (pendingEffect.effectSourceInstanceId !== undefined) {
    sourceIds.add(pendingEffect.effectSourceInstanceId);
  }
  for (const sourceId of pendingEffect.effectSourceInstanceIds ?? []) {
    sourceIds.add(sourceId);
  }
  return [...sourceIds];
}

function deriveTriggerEventCauseFromEffectController(
  causedByPlayerId: string | null | undefined,
  cardControllerPlayerId: string
): TriggerEventCause | undefined {
  if (causedByPlayerId === null || causedByPlayerId === undefined) {
    return undefined;
  }
  return causedByPlayerId === cardControllerPlayerId
    ? "self_effect"
    : "opponent_effect";
}

function pendingLeaveSuppressionBatchKey(
  pendingLeave: PendingLeaveEntity,
  fallbackChainId: string | null | undefined
): string {
  return pendingLeave.chainId ?? fallbackChainId ?? pendingLeave.instanceId;
}

function collectSuppressedDestroyedIdsByPendingLeaveBatch(
  pendingLeaves: readonly PendingLeaveEntity[],
  fallbackChainId: string | null | undefined
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const pendingLeave of pendingLeaves) {
    if (
      pendingLeave.blockedByResistance === true ||
      pendingLeave.suppressDestroyedEffects !== "destroyed_only"
    ) {
      continue;
    }
    const chainKey = pendingLeaveSuppressionBatchKey(
      pendingLeave,
      fallbackChainId
    );
    const ids = result.get(chainKey) ?? [];
    ids.push(pendingLeave.instanceId);
    result.set(chainKey, ids);
  }
  return result;
}

function collectPendingLeaveTriggerEvents(
  state: GameState,
  fallbackChainId: string | null,
  attackId: string | null = null,
  pendingLeaveFilter?: (pendingLeave: PendingLeaveEntity) => boolean
): CollectedTriggerEvent[] {
  const eligiblePendingLeaves = state.pendingLeaveEntities.filter(
    (pendingLeave) =>
      !(pendingLeaveFilter && !pendingLeaveFilter(pendingLeave)) &&
      pendingLeave.blockedByResistance !== true
  );
  const suppressedDestroyedIdsByChain =
    collectSuppressedDestroyedIdsByPendingLeaveBatch(
      eligiblePendingLeaves,
      fallbackChainId
    );
  return state.pendingLeaveEntities.flatMap((pendingLeave) => {
    if (pendingLeaveFilter && !pendingLeaveFilter(pendingLeave)) return [];
    if (pendingLeave.blockedByResistance === true) return [];
    const targetCard = getCardById(state, pendingLeave.instanceId);
    if (!targetCard || targetCard.zone !== "field") return [];
    const eventKind = pendingLeaveKindToTriggerEventKind(pendingLeave.kind);
    if (eventKind === null) return [];
    const triggerSourceInstanceIds =
      getPendingLeaveTriggerSourceInstanceIds(pendingLeave);
    const triggerSourceInstanceId = triggerSourceInstanceIds[0];
    return [
      {
        actingPlayerId: targetCard.controllerPlayerId,
        eventKind,
        source: "action_resolution" as const,
        chainId: pendingLeave.chainId ?? fallbackChainId,
        attackId,
        relatedPlayerId: targetCard.controllerPlayerId,
        relatedInstanceId: targetCard.instanceId,
        amount: null,
        cause: deriveTriggerEventCauseFromPendingLeave(
          pendingLeave,
          targetCard.controllerPlayerId
        ),
        ...(pendingLeave.suppressDestroyedEffects === "destroyed_only"
          ? {
              suppressedSourceInstanceIds: suppressedDestroyedIdsByChain.get(
                pendingLeaveSuppressionBatchKey(pendingLeave, fallbackChainId)
              ) ?? [pendingLeave.instanceId],
            }
          : {}),
        ...(pendingLeave.suppressDestroyedEffects === "all_opponent"
          ? { effectSuppressed: true }
          : {}),
        ...(triggerSourceInstanceId
          ? { effectSourceInstanceId: triggerSourceInstanceId }
          : {}),
        ...(triggerSourceInstanceIds.length > 0
          ? { effectSourceInstanceIds: triggerSourceInstanceIds }
          : {}),
        preFlushLeaveEvent: true,
      },
    ];
  });
}

/**
 * pending leave の pre-flush で既に queue した registration key を返す。
 *
 * `game_event:leave_field` は destroy / vanish 等の pre-flush event にも一致するため、
 * そのまま物理離脱後の leave_field 差分を配送すると同じ source が二重に pending 化される。
 * 物理境界の event にこの key を注入して、同一離脱で既に queue 済みの source だけを除外する。
 */
function getPreFlushQueuedSourceRegistrationKeysForPhysicalLeave(
  state: GameState,
  relatedInstanceId: string
): string[] {
  const keys = new Set<string>();
  for (const pendingEffect of state.pendingTriggeredEffects) {
    if (
      pendingEffect.registeredPreFlushLeaveEvent !== true ||
      pendingEffect.relatedInstanceId !== relatedInstanceId
    ) {
      continue;
    }
    for (const [sourceKey, relatedInstanceIds] of Object.entries(
      pendingEffect.relatedInstanceIdsBySourceRegistrationKey ?? {}
    )) {
      if (relatedInstanceIds.includes(relatedInstanceId)) {
        keys.add(sourceKey);
      }
    }
  }
  for (const declaration of state.pendingPrivateDeclarations) {
    if (
      declaration.registeredPreFlushLeaveEvent !== true ||
      declaration.relatedInstanceId !== relatedInstanceId
    ) {
      continue;
    }
    keys.add(
      makeResolvedTriggeredSourceKey(
        declaration.sourceInstanceId,
        declaration.registrationIndex
      )
    );
  }
  return [...keys];
}

export function queuePreFlushGrantedEffectsAndFlushPendingLeaves(options: {
  state: GameState;
  chainId?: string | null;
  attackId?: string | null;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions?: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
  sourceColors?: Parameters<typeof flushPendingLeaves>[2];
  sourceCategory?: Parameters<typeof flushPendingLeaves>[3];
  queueGrantedEffects?: boolean;
  queueRegisteredPreFlush?: boolean;
  /** battle_end 以外で明示的に pre-flush 登録する pending leave の範囲。 */
  registeredPreFlushPendingLeaveInstanceIds?: ReadonlySet<string>;
}): GameState {
  const shouldQueueGrantedEffects = options.queueGrantedEffects ?? true;
  const shouldQueueRegisteredPreFlush =
    options.queueRegisteredPreFlush ?? false;
  const battleEndFlushChainId =
    options.chainId !== null &&
    options.chainId !== undefined &&
    options.attackId !== null &&
    options.attackId !== undefined &&
    isBattleEndDeferralChainForAttack(options.chainId, options.attackId)
      ? getBattleEndDeferralChainId(options.attackId)
      : undefined;
  const battleEndPendingLeaveFilter =
    battleEndFlushChainId !== undefined && options.attackId !== undefined
      ? (pendingLeave: PendingLeaveEntity) =>
          isBattleEndDeferralChainForAttack(
            pendingLeave.chainId,
            options.attackId!
          )
      : undefined;
  const leaveEvents = shouldQueueGrantedEffects
    ? collectPendingLeaveTriggerEvents(
        options.state,
        options.chainId ?? null,
        options.attackId ?? null,
        battleEndPendingLeaveFilter
      )
    : [];
  // 通常は granted effect だけを pre-flush で扱い、登録済み誘発は state 差分から
  // 後続収集する。既に pendingLeave に入ったカードを後段の選択解決で flush する
  // 場合は差分側に「新規 pending」が残らないため、呼出側が明示したときだけ
  // 登録済み card_event / burst も同じ pre-flush 窓で queue する。
  // battle_end deferral は自身の chain に絞る。その他の経路は、既存の
  // queueRegisteredPreFlush 呼出を広げないため instanceId の明示指定を必須にする。
  const registeredPreFlushLeaveEvents = shouldQueueRegisteredPreFlush
    ? battleEndFlushChainId !== undefined && options.attackId !== undefined
      ? leaveEvents.filter((event) =>
          isBattleEndDeferralChainForAttack(event.chainId, options.attackId!)
        )
      : options.registeredPreFlushPendingLeaveInstanceIds !== undefined
        ? leaveEvents.filter(
            (event) =>
              event.relatedInstanceId !== null &&
              options.registeredPreFlushPendingLeaveInstanceIds!.has(
                event.relatedInstanceId
              )
          )
        : []
    : [];
  const beforeFlushWithRegistered =
    registeredPreFlushLeaveEvents.length === 0 ||
    options.getRegisteredTriggeredEffectActions === undefined
      ? options.state
      : queuePendingReactionsFromTriggerEvents(
          options.state,
          registeredPreFlushLeaveEvents.map((event) => ({
            ...event,
            registeredPreFlushLeaveEvent: true,
            // 発動宣言は待機入り時。離脱 intent の確認済み印で再提示を防ぐ (Q480)。
          })),
          undefined,
          {
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
          }
        );
  const beforeFlushWithGranted =
    leaveEvents.length === 0
      ? beforeFlushWithRegistered
      : queueGrantedEffectTriggersFromTriggerEvents(
          beforeFlushWithRegistered,
          leaveEvents,
          options.getCardDefinitionById
        );
  const afterFlush = flushPendingLeaves(
    beforeFlushWithGranted,
    options.getCardDefinitionById,
    options.sourceColors,
    options.sourceCategory,
    battleEndFlushChainId !== undefined
      ? { ownerChainId: battleEndFlushChainId }
      : undefined
  );
  return rebuildContinuousEffectsAfterPendingLeaveFlush({
    beforeFlushState: beforeFlushWithGranted,
    afterFlushState: afterFlush,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

export function flushPendingLeavesAndQueueReactions(options: {
  beforeFlushState: GameState;
  chainId: string;
  source?: TriggerEventSource;
  simultaneousGroupId?: string;
  causedByPlayerId?: string | null;
  causedBySourceInstanceId?: string | null;
  attackId?: string | null;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  sourceColors?: Parameters<typeof flushPendingLeaves>[2];
  sourceCategory?: Parameters<typeof flushPendingLeaves>[3];
  queueRegisteredPreFlush?: boolean;
}): GameState {
  const afterFlush = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
    state: options.beforeFlushState,
    chainId: options.chainId,
    attackId: options.attackId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    queueRegisteredPreFlush: options.queueRegisteredPreFlush ?? false,
    sourceColors: options.sourceColors,
    sourceCategory: options.sourceCategory,
  });
  if (afterFlush === options.beforeFlushState) return afterFlush;
  return collectAndQueueTriggerReactions({
    beforeState: options.beforeFlushState,
    afterState: afterFlush,
    source: options.source ?? "action_resolution",
    ...(options.simultaneousGroupId !== undefined
      ? { simultaneousGroupId: options.simultaneousGroupId }
      : {}),
    chainId: options.chainId,
    attackId: options.attackId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: options.causedByPlayerId ?? null,
    causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
  });
}

function triggerEventKindToMatcher(
  eventKind: TriggerEventKind
): TriggerEventMatcher {
  switch (eventKind) {
    case "game_start":
      return { family: "game_start" };
    case "reduce_life":
      return { family: "life" };
    case "destroy":
      return { family: "leave_field", causeKind: "destroy" };
    case "vanish":
      return { family: "leave_field", causeKind: "vanish" };
    case "bounce":
      return { family: "leave_field", causeKind: "bounce" };
    case "remove_from_game":
      return { family: "leave_field", causeKind: "remove_from_game" };
    case "leave_field":
      return { family: "leave_field" };
    case "summon":
      return { family: "enter_field", actionKind: "summon" };
    case "place":
      return { family: "enter_field", actionKind: "placement" };
    case "put":
      return { family: "enter_field", actionKind: "put" };
    case "increase_hand":
      return { family: "hand_increase" };
    case "start_step":
      return { family: "step_timing" };
    case "end_step":
      return { family: "step_timing" };
    case "exhaust":
      // P3-14 C-2: state_change family 内は actionKind で種別判別 (exhaust/recover/rebirth
      // のリスナー相互誤マッチ防止)。
      return { family: "state_change", actionKind: "exhaust" };
    case "recover":
      return { family: "state_change", actionKind: "recover" };
    case "advent":
      return { family: "enter_field", actionKind: "advent" };
    case "rebirth":
      // 転醒は state_change ファミリ (exhaust/recover と同類)。triggerEventKindToStructuredEvent
      // の rebirth マッピングと整合させる。
      return { family: "state_change", actionKind: "rebirth" };
    case "after_draw":
      return { family: "after_draw" };
    case "pre_declaration_attack":
      return { family: "declaration_timing", actionKind: "attack" };
    case "pre_declaration_block":
      return { family: "declaration_timing", actionKind: "block" };
    case "after_cost_paid":
      return { family: "payment_timing" };
    case "flash":
      return { family: "flash_use" };
    case "stack":
      return { family: "stack_use" };
    case "effect_declaration":
      return { family: "effect_declaration" };
    case "targeted":
      return { family: "targeting" };
    case "battle_destroy_opponent_only":
      return { family: "battle_destroy_opponent_only" };
    case "battle_end":
      return { family: "battle_end" };
    case "count_increase":
      return { family: "count_increase" };
    case "count_decrease":
      return { family: "count_decrease" };
    case "attack":
      // P3-14 C-2: アタック宣言成立後 (game_event 観測用)。
      return { family: "battle_declaration", actionKind: "attack" };
    case "attack_declared":
      return { family: "action_declared", actionKind: "attack" };
    case "block":
      return { family: "battle_declaration", actionKind: "block" };
    case "brave_combined":
      return { family: "brave_link" };
    case "trash_increase":
      return { family: "trash_change" };
    case "core_placed_on_life":
      return { family: "core_change" };
    case "text_role_under_card_placed":
      return { family: "under_card_change" };
    case "void_core_decrease":
      return { family: "void_core_change" };
    case "enter_soul_state":
      return { family: "soul_state_change", actionKind: "enter_soul_state" };
    case "soul_state_to_spirit_state":
      return {
        family: "soul_state_change",
        actionKind: "soul_state_to_spirit_state",
      };
    case "quartz_set":
      return { family: "quartz_set" };
    case "mirage_set":
      return { family: "mirage_set" };
    case "field_hand_swap":
      return { family: "field_hand_swap" };
    case "soul_drive_activated":
      return { family: "soul_drive_activation" };
    case "effect_activated":
      // actionKind (発揮された timing) を問わない wildcard matcher (BurstEventKind の
      // "effect_activated" と同じ family を共有)。
      return { family: "effect_activation" };
    case "effect_completed":
      return { family: "effect_completed" };
    case "effect_steps_resolved":
      return { family: "effect_steps_resolved" };
    case "card_used":
      return { family: "card_used" };
    case "oracle":
    case "placement_oracle":
    case "unseal":
    case "stone_rebirth":
    case "magic_stack_domain":
    case "granted_effect":
      // P3-92 / P3-99: mechanic 付き pending 専用の eventKind。カード効果 registration の
      // eventKind には現れない (mechanic pending は registration スキャンを経由しない)。
      throw new Error(
        `triggerEventKindToMatcher: mechanic eventKind "${eventKind}" has no card-effect matcher`
      );
  }
}

function burstEventKindToMatcher(
  eventKind: BurstEventKind
): TriggerEventMatcher {
  switch (eventKind) {
    case "reduce_life":
      return { family: "life" };
    case "attack_after":
      return { family: "action_after", actionKind: "attack" };
    case "summon":
      return { family: "enter_field", actionKind: "summon" };
    case "place":
      return { family: "enter_field", actionKind: "placement" };
    case "leave_field":
      return { family: "leave_field" };
    case "exhaust":
      return { family: "state_change" };
    case "effect_activated":
      // actionKind (発揮された timing) は registration の eventMatcher で個別指定する。
      return { family: "effect_activation" };
    case "hand_increase":
      return { family: "hand_increase" };
    case "step_timing":
      // step / subPhase は registration の eventMatcher で個別指定する。
      return { family: "step_timing" };
    case "own_attack":
      // action_after (attack_finished) とは別 family。将来 attack_finished に
      // player:"self" 型が追加されても matcher レベルで own_attack と混線しない
      // (adversarial verifier 2026-07-23 指摘、model.ts の action_declared 参照)。
      return { family: "action_declared", actionKind: "attack" };
    case "enter_soul_state":
      // card_event 版 (line ~746) と同じ family を共有。
      return { family: "soul_state_change" };
  }
}

function getEffectiveTriggeredEffectMatcher(
  registration: RegisteredTriggeredEffectAction
): TriggerEventMatcher {
  return (
    registration.eventMatcher ??
    triggerEventKindToMatcher(registration.eventKind)
  );
}

function getEffectiveBurstMatcher(
  registration: RegisteredBurstAction
): TriggerEventMatcher {
  return (
    registration.eventMatcher ?? burstEventKindToMatcher(registration.eventKind)
  );
}

export function triggerEventKindToStructuredEvent(
  eventKind: TriggerEventKind
): StructuredTriggerEvent {
  switch (eventKind) {
    case "game_start":
      return { family: "game_start", validationMode: "snapshot_only" };
    case "reduce_life":
      return { family: "life", validationMode: "snapshot_only" };
    case "destroy":
      return {
        family: "leave_field",
        causeKind: "destroy",
        validationMode: "snapshot_only",
      };
    case "vanish":
      return {
        family: "leave_field",
        causeKind: "vanish",
        validationMode: "snapshot_only",
      };
    case "bounce":
      return {
        family: "leave_field",
        causeKind: "bounce",
        validationMode: "snapshot_only",
      };
    case "remove_from_game":
      return {
        family: "leave_field",
        causeKind: "remove_from_game",
        validationMode: "snapshot_only",
      };
    case "leave_field":
      return {
        family: "leave_field",
        validationMode: "snapshot_only",
      };
    case "summon":
      return {
        family: "enter_field",
        actionKind: "summon",
        validationMode: "require_related_instance_on_field",
      };
    case "place":
      return {
        family: "enter_field",
        actionKind: "placement",
        validationMode: "require_related_instance_on_field",
      };
    case "put":
      return {
        family: "enter_field",
        actionKind: "put",
        validationMode: "require_related_instance_on_field",
      };
    case "increase_hand":
      return { family: "hand_increase", validationMode: "snapshot_only" };
    case "start_step":
      return { family: "step_timing", validationMode: "snapshot_only" };
    case "end_step":
      return { family: "step_timing", validationMode: "snapshot_only" };
    case "exhaust":
      // P3-14 C-2: state_change family 内は actionKind で種別判別。
      return {
        family: "state_change",
        actionKind: "exhaust",
        validationMode: "require_related_instance_on_field",
      };
    case "recover":
      return {
        family: "state_change",
        actionKind: "recover",
        validationMode: "require_related_instance_on_field",
      };
    case "advent":
      return {
        family: "enter_field",
        actionKind: "advent",
        validationMode: "require_related_instance_on_field",
      };
    case "rebirth":
      // 転醒は「場の既存カードが B 面へ裏返る状態変化」なので enter_field ではなく
      // state_change ファミリ (exhaust/recover と同類)。裏返ったカードは場に残るため
      // require_related_instance_on_field で検証する (転醒後に消滅していたら不発)。
      return {
        family: "state_change",
        actionKind: "rebirth",
        validationMode: "require_related_instance_on_field",
      };
    case "after_draw":
      return { family: "after_draw", validationMode: "snapshot_only" };
    case "pre_declaration_attack":
      return {
        family: "declaration_timing",
        actionKind: "attack",
        validationMode: "require_related_instance_on_field",
      };
    case "pre_declaration_block":
      return {
        family: "declaration_timing",
        actionKind: "block",
        validationMode: "require_related_instance_on_field",
      };
    case "after_cost_paid":
      return {
        family: "payment_timing",
        validationMode: "snapshot_only",
      };
    case "flash":
      // P3-73: 相手フラッシュ効果使用。発揮前に反応するため snapshot_only
      // (使用カードが in_use/trash へ移っていても誘発を許す)。
      return {
        family: "flash_use",
        validationMode: "snapshot_only",
      };
    case "stack":
      // ENGINE-stack-activation-reactivation-trigger: 相手のスタック効果は完全解決後に
      // 発火するため、発揮元カードは既に trash 等へ移動済み。snapshot_only で許容する。
      return {
        family: "stack_use",
        validationMode: "snapshot_only",
      };
    case "effect_declaration":
      // P3-75: 未解決 ActiveStack の発揮前イベント。対象効果はまだ解決前のため
      // snapshot_only とし、発揮元カードが後続コストで離れても応答宣言を維持する。
      return {
        family: "effect_declaration",
        validationMode: "snapshot_only",
      };
    case "targeted":
      // P3-76: 対象集合の開示。対象側が応答するため、対象カードがまだフィールド上に
      // 存在する場合だけ発火する。
      return {
        family: "targeting",
        validationMode: "require_related_instance_on_field",
      };
    case "battle_destroy_opponent_only":
      return {
        family: "battle_destroy_opponent_only",
        validationMode: "require_related_instance_on_field",
      };
    case "battle_end":
      // バトル終了時。バトル中に破壊された参加カードの自己誘発は発火させない
      // (バトル終了時点でフィールドに残っている参加カードのみ) → require_related_instance_on_field。
      return {
        family: "battle_end",
        validationMode: "require_related_instance_on_field",
      };
    case "count_increase":
      // カウントは player 値で関連インスタンスを持たない → snapshot_only。
      return { family: "count_increase", validationMode: "snapshot_only" };
    case "count_decrease":
      // count_increase 同様 player 値イベント → snapshot_only。
      return { family: "count_decrease", validationMode: "snapshot_only" };
    case "attack":
      // P3-14 C-2: アタック宣言成立後。「〜がアタックしたとき」観測 (game_event)。
      // アタッカー自身が解決時にフィールドを離れていたら不発。
      return {
        family: "battle_declaration",
        actionKind: "attack",
        validationMode: "require_related_instance_on_field",
      };
    case "attack_declared":
      return {
        family: "action_declared",
        actionKind: "attack",
        validationMode: "require_related_instance_on_field",
      };
    case "block":
      return {
        family: "battle_declaration",
        actionKind: "block",
        validationMode: "require_related_instance_on_field",
      };
    case "brave_combined":
      // P3-14 C-2: 合体成立。relatedInstanceId = 合体したブレイヴ。
      return {
        family: "brave_link",
        validationMode: "require_related_instance_on_field",
      };
    case "trash_increase":
      return { family: "trash_change", validationMode: "snapshot_only" };
    case "core_placed_on_life":
      // P3-14 C-2: ライフへのコア配置。player 値イベントで関連インスタンスなし。
      return { family: "core_change", validationMode: "snapshot_only" };
    case "text_role_under_card_placed":
      // ENGINE-c09-text-role-under-card-third-party-trigger: 配置先 host が
      // イベント時点でフィールドに残っていること (brave_combined と同型)。
      return {
        family: "under_card_change",
        validationMode: "require_related_instance_on_field",
      };
    case "void_core_decrease":
      // ENGINE-void-core-decrease-trigger: ボイドのコア減少。player 値イベントで
      // 関連インスタンスなし。
      return { family: "void_core_change", validationMode: "snapshot_only" };
    case "enter_soul_state":
      // F2: 魂状態化。relatedInstanceId=該当カードがフィールド(魂状態)に在ること。
      return {
        family: "soul_state_change",
        actionKind: "enter_soul_state",
        validationMode: "require_related_instance_on_field",
      };
    case "soul_state_to_spirit_state":
      // F2: 魂状態からスピリット状態になったカードがフィールドに残っていること。
      return {
        family: "soul_state_change",
        actionKind: "soul_state_to_spirit_state",
        validationMode: "require_related_instance_on_field",
      };
    case "quartz_set":
      // F2: クォーツセット。player 値ルーティング (「自分のクォーツがセットされたとき」)。
      return { family: "quartz_set", validationMode: "snapshot_only" };
    case "mirage_set":
      // ENGINE-mirage-set-card-event-trigger: ミラージュセット。セットされたカードの
      // zone は "field" ではなく "mirage" のため、require_related_instance_on_field
      // (zone==="field" 必須) を使うと常に不発火になる (quartz_set と同様の理由)。
      return { family: "mirage_set", validationMode: "snapshot_only" };
    case "field_hand_swap":
      // ENGINE-field-hand-swap-trigger: 入れ替えで場に入ったカードは即座に field 上に
      // 存在するため、brave_combined と同様 require_related_instance_on_field を使う。
      return {
        family: "field_hand_swap",
        validationMode: "require_related_instance_on_field",
      };
    case "soul_drive_activated":
      // ENGINE-soul-drive-activation-observable-event (P3-125): 【ソウルドライブ・S】発動。
      // player 値イベントで関連インスタンスなし。
      return {
        family: "soul_drive_activation",
        validationMode: "snapshot_only",
      };
    case "effect_activated":
      // 発揮はすでに完了した過去イベント (BurstEventKind の effect_activated と同じ裁定)。
      // 発揮元カードが場を離れていてもリスナーは反応できる前提で snapshot_only。
      return { family: "effect_activation", validationMode: "snapshot_only" };
    case "effect_completed":
      return { family: "effect_completed", validationMode: "snapshot_only" };
    case "effect_steps_resolved":
      return {
        family: "effect_steps_resolved",
        validationMode: "snapshot_only",
      };
    case "card_used":
      return { family: "card_used", validationMode: "snapshot_only" };
    case "oracle":
    case "placement_oracle":
    case "unseal":
    case "stone_rebirth":
    case "magic_stack_domain":
    case "granted_effect":
      // P3-92 / P3-99: mechanic 付き pending 専用の eventKind。structured event へは変換しない
      // (mechanic pending は event フィールドを持たず、collectTriggerEvents も経由しない)。
      throw new Error(
        `triggerEventKindToStructuredEvent: mechanic eventKind "${eventKind}" has no structured event`
      );
  }
}

export function burstEventKindToStructuredEvent(
  eventKind: BurstEventKind
): StructuredTriggerEvent {
  switch (eventKind) {
    case "reduce_life":
      return { family: "life", validationMode: "snapshot_only" };
    case "attack_after":
      return {
        family: "action_after",
        actionKind: "attack",
        validationMode: "require_related_instance_on_field",
      };
    case "summon":
      return {
        family: "enter_field",
        actionKind: "summon",
        validationMode: "require_related_instance_on_field",
      };
    case "place":
      return {
        family: "enter_field",
        actionKind: "placement",
        validationMode: "require_related_instance_on_field",
      };
    case "leave_field":
      return { family: "leave_field", validationMode: "snapshot_only" };
    case "exhaust":
      return {
        family: "state_change",
        validationMode: "require_related_instance_on_field",
      };
    case "effect_activated":
      // 発揮はすでに完了した過去イベント。発揮元カードが場を離れていても
      // バーストは発動できる前提で snapshot_only。
      return { family: "effect_activation", validationMode: "snapshot_only" };
    case "hand_increase":
      return { family: "hand_increase", validationMode: "snapshot_only" };
    case "step_timing":
      return { family: "step_timing", validationMode: "snapshot_only" };
    case "own_attack":
      return {
        family: "action_declared",
        actionKind: "attack",
        validationMode: "require_related_instance_on_field",
      };
    case "enter_soul_state":
      // BSGE01-M04: card_event 版 (line ~997) と同じ family/validationMode を共有。
      return {
        family: "soul_state_change",
        validationMode: "require_related_instance_on_field",
      };
  }
}

export interface ResolvePendingTriggeredEffectResult {
  state: GameState;
  pendingId: string;
  skipped?: boolean;
}

export interface ResolvePendingBurstCheckResult {
  state: GameState;
  checkId: string;
}

export interface PendingTriggeredEffectActionContext {
  chainId: string;
  pendingEffect: PendingTriggeredEffect;
}

export interface PendingBurstCheckActionContext {
  chainId: string;
  pendingBurstCheck: PendingBurstCheck;
}

export type PendingTriggeredEffectResolver = (
  state: GameState,
  context: PendingTriggeredEffectActionContext
) => GameState;

export type PendingTriggeredEffectResolverLookup = (
  pendingEffect: PendingTriggeredEffect
) => PendingTriggeredEffectResolver | undefined;

export type PendingBurstCheckResolver = (
  state: GameState,
  context: PendingBurstCheckActionContext
) => GameState;

export type PendingBurstCheckResolverLookup = (
  pendingBurstCheck: PendingBurstCheck
) => PendingBurstCheckResolver | undefined;

export type TriggeredEffectSourceUseBlockReason =
  | "source_not_controlled_by_acting_player"
  | "source_not_on_field"
  | "source_kind_category_mismatch";

export type BurstSourceUseBlockReason =
  | "source_not_controlled_by_acting_player"
  | "source_not_in_burst_zone"
  | "source_kind_category_mismatch"
  | "missing_burst_set_state";

/**
 * 汎用の召喚 responder (game_event:summon / burst:summon) が、被召喚カードの
 * カテゴリーに反応すべきかを判定する。
 *
 * 公式ルール: 「召喚」の基本対象はスピリット召喚。ブレイヴ召喚・アルティメット召喚は
 * 「スピリット召喚として扱わない」(ブレイヴ: source-findings-official-battle-brave-burst.md
 * page09 / アルティメット: 別カテゴリのためユーザー裁定で確定)。したがって triggerFilter が
 * category を明示しない汎用 responder (「スピリットが召喚されたとき」) は
 * ブレイヴ/アルティメット被召喚に反応しない。category を明示する responder
 * (「アルティメットが召喚されたとき」等) や、【アルドノアドライブ】のように
 * category ではなく host 側の印字スロットを明示する responder は、後段の
 * matchesCardFilter に委ねるため true を返す。
 *
 * ブレイヴ/アルティメット自身の「召喚時」は card_event:summon (self 判定) で別途発火する。
 * zoneRoleName は場入りパイプラインがカテゴリ由来で設定 (スピリット→"spirit" /
 * ブレイヴ→"brave" / アルティメット→"ultimate")。
 * summon 以外のイベントには影響しない (true を返す)。
 */
function summonResponderMatchesCategoryScope(
  state: GameState,
  event: {
    eventKind: TriggerEventKind | BurstEventKind;
    relatedInstanceId: string | null;
  },
  triggerFilter: import("../dsl-types").CardFilter | undefined
): boolean {
  if (event.eventKind === "place" && event.relatedInstanceId !== null) {
    const role = getCardById(state, event.relatedInstanceId)?.zoneRoleName;
    return role === undefined || role === "nexus";
  }
  if (event.eventKind !== "summon" || event.relatedInstanceId === null) {
    return true;
  }
  const role = getCardById(state, event.relatedInstanceId)?.zoneRoleName;
  if (role === "spirit") {
    return true;
  }
  // ブレイヴ / アルティメット召喚: category 明示、または category-independent な
  // host 印字スロット指定時のみ許可 (後段 matchesCardFilter で判定)。
  return (
    (triggerFilter?.category !== undefined &&
      triggerFilter.category.length > 0) ||
    triggerFilter?.declaresUnderCardSlot !== undefined
  );
}

/**
 * queueReactionsInternal の burst lookup 未配線 (raw テスト経路等) fallback で、
 * 単一 legacy check を積まず skip する burstEventKind。per-player routing 前提
 * (step_timing) や high-frequency event (exhaust) はここに積むと解決不能な
 * vacuous check が量産される。
 */
const UNWIRED_BURST_FALLBACK_SKIP_KINDS = new Set<BurstEventKind>([
  "step_timing",
  "exhaust",
]);

function mapTriggerEventToBurstCheck(event: CollectedTriggerEvent): {
  burstEventKind: BurstEventKind;
  actingPlayerId: string;
  relatedPlayerId: string;
  amount: number;
} | null {
  // engine-suppress-third-party-summon-observation (BSTH11-X02【現界】): バースト
  // (「相手が召喚したとき」等) も第三者観測の一種のため、game_event と同様に不可視化する。
  if (event.suppressThirdPartyObservation === true) {
    return null;
  }
  if (
    event.eventKind === "reduce_life" &&
    event.relatedPlayerId !== null &&
    event.amount !== null
  ) {
    return {
      burstEventKind: "reduce_life",
      actingPlayerId: event.relatedPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: event.amount,
    };
  }

  if (event.eventKind === "summon" && event.relatedPlayerId !== null) {
    return {
      burstEventKind: "summon",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: 1,
    };
  }

  // ネクサス配置後バースト (例: 「相手がネクサスを配置した後」)。
  // place イベントはネクサス (zoneRoleName="nexus") の場入りでのみ発行されるため、
  // summon のようなカテゴリースコープ判定は不要。
  if (event.eventKind === "place" && event.relatedPlayerId !== null) {
    return {
      burstEventKind: "place",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: 1,
    };
  }

  if (
    (event.eventKind === "destroy" ||
      event.eventKind === "vanish" ||
      event.eventKind === "bounce" ||
      event.eventKind === "remove_from_game" ||
      event.eventKind === "leave_field") &&
    event.relatedPlayerId !== null
  ) {
    return {
      burstEventKind: "leave_field",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: 1,
    };
  }

  // spirit_exhausted バースト (P3-67 Phase 4)。疲労 (exhaust) のみ対象。
  // recover は burst の対象外なので burst check を作らない。
  if (event.eventKind === "exhaust" && event.relatedPlayerId !== null) {
    return {
      burstEventKind: "exhaust",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: 1,
    };
  }

  // hand_increase バースト (P3-67)。「相手の効果によって相手の手札が増えた後」等。
  // relatedPlayerId = 手札が増えたプレイヤー。whose:opponent でその相手の burst が拾う
  // (per-player routing)。原因は発生側からの相対値を保持し、登録の cause で絞る。
  if (event.eventKind === "increase_hand" && event.relatedPlayerId !== null) {
    return {
      burstEventKind: "hand_increase",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: event.amount ?? 1,
    };
  }

  // step_timing バースト (P3-67)。「相手のアタックステップ開始後」等。
  // relatedPlayerId = ステップを行うプレイヤー (= 通常ターンプレイヤー)。
  // どのステップ/開始終了かは buildBurstCheck が event.step / subPhase を check.event に
  // 載せ、registration の eventMatcher (step + subPhase) で絞る。
  if (
    (event.eventKind === "start_step" || event.eventKind === "end_step") &&
    event.relatedPlayerId !== null
  ) {
    return {
      burstEventKind: "step_timing",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: 1,
    };
  }

  // enter_soul_state バースト (BSGE01-M04)。card_event 検出ブロック (line ~3516) が push する
  // イベントを burst check にも変換するが、原文「フィールドを離れた…が魂状態になった後」に
  // 合わせ fromZone==="field" (field-exit-replacement 経由、zone 不変) のときのみ発火する。
  // fromZone が hand/set_aside (BSLH01-CX01 activate_soul_state 型、field 外から直接魂状態化)
  // のときは対象外 (adversarial verifier 2026-07-23 指摘)。relatedPlayerId = 魂状態owner。
  if (
    event.eventKind === "enter_soul_state" &&
    event.relatedPlayerId !== null &&
    event.fromZone === "field"
  ) {
    return {
      burstEventKind: "enter_soul_state",
      actingPlayerId: event.actingPlayerId,
      relatedPlayerId: event.relatedPlayerId,
      amount: 1,
    };
  }

  return null;
}

function effectUsesTriggerRelatedInstances(
  sourceDefinition: CardDefinition | undefined,
  actionRegistration: { effectIndex?: number }
): boolean {
  const effectIndex = actionRegistration.effectIndex;
  if (effectIndex === undefined) return false;
  const effect = sourceDefinition?.effects?.[effectIndex];
  if (!effect) return false;
  return JSON.stringify(effect).includes('"trigger_related_instances"');
}

function effectStepsContainActionKind(
  steps: readonly EffectStep[],
  actionKind: string
): boolean {
  return steps.some(
    (step) =>
      step.action.kind === actionKind ||
      (step.choice !== undefined &&
        effectStepsContainActionKind(step.choice, actionKind))
  );
}

/**
 * stay_on_field/rebirth の action.target が「離脱している主語 (trigger_related_instance)」
 * を指しているかどうか。rebirth は target 省略時 sourceInstanceId (＝リスナー自身) を flip
 * するため、第三者観測 (game_event) の効果ではこれは離脱対象と無関係 (BSTH001-転醒R02(A) 等の
 * 「相手のカードが destroy/vanish したのを見て自分自身が転醒する」型)。card_event 自己観測は
 * sourceInstanceId が離脱カード自身と一致することが保証されるため対象外 (呼び出し側で分岐)。
 */
function actionTargetsTriggerRelatedInstance(
  action: EffectStep["action"]
): boolean {
  if (action.kind !== "stay_on_field" && action.kind !== "rebirth")
    return false;
  const target = action.target;
  if (!target) return false;
  return (
    target.kind === "trigger_related_instance" ||
    target.kind === "trigger_related_combined_host" ||
    target.kind === "trigger_related_instances"
  );
}

function effectStepsContainRelatedInstanceStayOrRebirth(
  steps: readonly EffectStep[]
): boolean {
  return steps.some(
    (step) =>
      actionTargetsTriggerRelatedInstance(step.action) ||
      (step.choice !== undefined &&
        effectStepsContainRelatedInstanceStayOrRebirth(step.choice))
  );
}

function actionTargetsPendingLeaveRelatedInstance(
  action: EffectStep["action"]
): boolean {
  if (action.kind === "stay_on_field" || action.kind === "rebirth") {
    return actionTargetsTriggerRelatedInstance(action);
  }
  if (action.kind === "summon") {
    const target = action.target;
    return (
      target.kind === "from_zone" &&
      target.restrictToTriggerLeaveAdventSource === true
    );
  }
  if (action.kind !== "send_to_deck" && action.kind !== "bounce") return false;
  const target = action.target;
  return (
    (target.kind === "trigger_related_instance" ||
      target.kind === "trigger_related_combined_host" ||
      target.kind === "trigger_related_instances") &&
    target.includePendingLeave === true
  );
}

function effectStepsContainPendingLeaveRelatedInstanceAction(
  steps: readonly EffectStep[]
): boolean {
  return steps.some(
    (step) =>
      actionTargetsPendingLeaveRelatedInstance(step.action) ||
      (step.choice !== undefined &&
        effectStepsContainPendingLeaveRelatedInstanceAction(step.choice))
  );
}

export function isRegisteredLeaveFieldPreFlushEffect(
  effect: Effect,
  eventKind: TriggerEventKind
): boolean {
  if (
    effect.timing.kind !== "card_event" &&
    effect.timing.kind !== "game_event"
  )
    return false;
  const declaredEvents = Array.isArray(effect.timing.event)
    ? effect.timing.event
    : [effect.timing.event];
  if (!matchesDeclaredCardEventKind(declaredEvents, eventKind)) return false;
  return effectStepsContainPendingLeaveRelatedInstanceAction(effect.steps);
}

function getRegisteredLeaveFieldStayOnFieldSourceKeys(
  sourceChoices: readonly TriggeredEffectSourceChoice[],
  eventKind: TriggerEventKind
): string[] {
  const keys: string[] = [];
  for (const sourceChoice of sourceChoices) {
    const effectIndex =
      sourceChoice.actionRegistration.effectIndex ??
      sourceChoice.registrationIndex;
    const effect = sourceChoice.sourceEffectDefinition.effects?.[effectIndex];
    if (!effect) continue;
    if (
      effect.timing.kind !== "card_event" &&
      effect.timing.kind !== "game_event"
    )
      continue;
    const declaredEvents = Array.isArray(effect.timing.event)
      ? effect.timing.event
      : [effect.timing.event];
    if (!matchesDeclaredCardEventKind(declaredEvents, eventKind)) continue;
    if (effect.timing.kind === "card_event") {
      // 自己観測: sourceInstanceId は離脱カード自身と一致するため、target 省略の
      // rebirth/stay_on_field(self) でも安全にゲート対象にできる (従来どおり target 非依存)。
      if (
        !effectStepsContainActionKind(effect.steps, "stay_on_field") &&
        !effectStepsContainActionKind(effect.steps, "rebirth")
      ) {
        continue;
      }
    } else {
      // 第三者観測 (game_event): BSLH01-C06 のような stay_on_field/rebirth も
      // flush-blocking gate に含めないと離脱対象の物理 flush が誘発解決より先に走って
      // no-op になる (ENGINE-game-event-stay-on-field-flush-gate、adversarial verifier 発見)。
      // ただし BSTH001-転醒R02(A) のように「離脱対象とは無関係な第三者が自分自身を
      // 転醒させる」型 (target 省略 = sourceInstanceId 自身) まで含めると、無関係な
      // 離脱対象の flush を誤ってブロックする regression になる (round2 adversarial
      // verifier 発見)。action.target が trigger_related_instance(s) を明示的に指す
      // 場合のみ対象にする。
      //
      // ENGINE-leave-field-free-use-stay-on-field-flush-gate: BSAZ01-C03 のように
      // 「無償使用トリガー effect (steps: [use_magic_without_cost] のみ)」と
      // 「除外/閾値分岐フラッシュ本体 (別 effectIndex、timing.kind:"activated")」が
      // 分かれているカードは、登録された trigger effect 自身の steps に
      // stay_on_field/rebirth が無い。この場合、同一 sourceEffectDefinition 内の
      // sibling activated effects (フラッシュ本体) が trigger_related_instance 付き
      // stay_on_field/rebirth を持つかどうかも確認する (無償使用が発揮解決する対象は
      // magic-system.ts の triggerRelatedInstanceId 引き継ぎにより同じ主語 Y を
      // 参照できるため、flush-gate も同様に両 effectIndex をまたいで検知する必要がある)。
      const usesFreeMagicWithoutCost = effectStepsContainActionKind(
        effect.steps,
        "use_magic_without_cost"
      );
      if (usesFreeMagicWithoutCost) {
        const siblingHasRelatedInstanceStayOrRebirth = (
          sourceChoice.sourceEffectDefinition.effects ?? []
        ).some(
          (siblingEffect) =>
            siblingEffect.timing.kind === "activated" &&
            effectStepsContainRelatedInstanceStayOrRebirth(siblingEffect.steps)
        );
        if (!siblingHasRelatedInstanceStayOrRebirth) continue;
      } else if (
        !effectStepsContainRelatedInstanceStayOrRebirth(effect.steps)
      ) {
        continue;
      }
    }
    keys.push(
      makeResolvedTriggeredSourceKey(
        getTriggeredSourceRegistrationInstanceId(sourceChoice),
        sourceChoice.registrationIndex
      )
    );
  }
  return keys;
}

function getRegisteredLeaveFieldPreFlushSourceKeys(
  sourceChoices: readonly TriggeredEffectSourceChoice[],
  eventKind: TriggerEventKind,
  preFlushLeaveEvent = false
): string[] {
  const keys: string[] = [];
  for (const sourceChoice of sourceChoices) {
    const effectIndex =
      sourceChoice.actionRegistration.effectIndex ??
      sourceChoice.registrationIndex;
    const effect = sourceChoice.sourceEffectDefinition.effects?.[effectIndex];
    if (!effect) continue;
    // Q1501: 待機入りから誘発した効果はドロー/カウント等もすべて解決し、
    // その後に魂状態/ブレイヴ残留を選んで実移動する。
    if (
      !preFlushLeaveEvent &&
      !isRegisteredLeaveFieldPreFlushEffect(effect, eventKind)
    )
      continue;
    keys.push(
      makeResolvedTriggeredSourceKey(
        getTriggeredSourceRegistrationInstanceId(sourceChoice),
        sourceChoice.registrationIndex
      )
    );
  }
  return keys;
}

let simultaneousGroupSequence = 1;

export function createSimultaneousGroupId(): string {
  const seq = simultaneousGroupSequence;
  simultaneousGroupSequence += 1;
  return `sim-group:${seq}`;
}

function createPendingTriggeredEffectId(
  state: GameState,
  event: CollectedTriggerEvent,
  index: number
): string {
  return [
    "trigger",
    event.source,
    getTriggerEventChainKey(state, event),
    event.eventKind,
    event.actingPlayerId,
    event.relatedPlayerId ?? "none",
    event.relatedInstanceId ?? "none",
    event.amount ?? "none",
    state.pendingTriggeredEffects.length + index,
  ].join(":");
}

function createPendingBurstCheckId(
  state: GameState,
  event: CollectedTriggerEvent,
  index: number
): string {
  return [
    "burst",
    event.source,
    getTriggerEventChainKey(state, event),
    event.eventKind,
    event.actingPlayerId,
    event.relatedPlayerId ?? "none",
    event.amount ?? "none",
    state.pendingBurstChecks.length + index,
  ].join(":");
}

function getPrimaryApplicabilityZone(
  sourceCard: CardInstance,
  sourceZone: ApplicabilityZone | readonly ApplicabilityZone[] | undefined
): ApplicabilityZone | null {
  const explicitZones = sourceZone
    ? Array.isArray(sourceZone)
      ? sourceZone
      : [sourceZone]
    : [];
  const cardApplicabilityZone = mapZoneToApplicabilityZone(sourceCard.zone);
  const mappedZone =
    explicitZones.length > 0
      ? cardApplicabilityZone !== null &&
        explicitZones.includes(cardApplicabilityZone)
        ? cardApplicabilityZone
        : explicitZones[0]
      : cardApplicabilityZone;
  return mappedZone && mappedZone !== "anywhere"
    ? (mappedZone as ApplicabilityZone)
    : null;
}

function isPrivateTriggeredEffectSourceChoice(
  state: GameState,
  sourceChoice: TriggeredEffectSourceChoice
): boolean {
  const zone = getPrimaryApplicabilityZone(
    sourceChoice.sourceCard,
    sourceChoice.actionRegistration.sourceZone
  );

  switch (zone) {
    case "hand":
    case "deck":
      return true;
    case "mirage_set":
      // ミラージュは手札から表向きでセットする（10_rules/08c §8）。
      return false;
    case "burst_set":
      return !state.revealedBurstStates.some(
        (revealed) =>
          revealed.cardInstanceId === sourceChoice.sourceCard.instanceId
      );
    case "set_aside":
      // 現行モデルでは手元カードは表向き運用。将来 face-down 属性が入ったらここで判定する。
      return false;
    default:
      return false;
  }
}

/**
 * ENGINE-void-core-decrease-trigger-whose-gap: actingPlayerId に「値が変化した
 * プレイヤー」(イベント主体) を積む player 値イベント。getAvailableTriggeredEffectSourceChoices
 * の whose 既定判定でのみ参照する（同じ書き換えを attack/block/battle_end 等の他 game_event
 * に広げると既存の self/either 判定を壊すため対象を限定する）。
 */
const PLAYER_VALUE_EVENT_KINDS_FOR_WHOSE_GAP = new Set<TriggerEventKind>([
  // 使用後イベントは使用した本人を主体にする。相手の使用を観測するリスナーも許可する。
  "card_used",
  "count_increase",
  "count_decrease",
  "core_placed_on_life",
  "void_core_decrease",
  // BSLH01-C10: "increase_hand" も actingPlayerId/relatedPlayerId に
  // 手札が増えたプレイヤーを積む player 値イベント。player:"opponent" の
  // 第三者リスナーが whose 既定 self で落ちないよう補正対象に含める。
  "increase_hand",
  // ENGINE-battle-reduce-life-source-instance (BSLH01-C09): reduce_life も
  // actingPlayerId に「ライフが減った側 (victim)」を積む同型の player 値イベント。
  // 既存 precedent は全て player:"self" (victim 自身が listener) のみだったため
  // 顕在化しなかったが、「自分の効果で相手のライフを減らしたとき」型
  // (player:"opponent"、listener=加害側) では同じ whose-gap を踏む。
  "reduce_life",
  // engine-exhaust-provenance-skip-refresh (BSLH01-C04): "exhaust" も
  // actingPlayerId に「疲労した側 (対象カードのコントローラ)」を積む同型イベント
  // (collectTriggerEventsFromStateDelta の card_exhausted 検出、
  // `actingPlayerId: afterCard.controllerPlayerId`)。既存 precedent (BSLH01-X03)
  // は全て player:"self" (疲労した自分のスピリット自身を listener の対象にする) のみ
  // だったため顕在化しなかったが、「自分の…効果で疲労した相手の…」型
  // (player:"opponent"、listener=疲労させた側) では同じ whose-gap を踏み、
  // 対象が常に第三者リスナーの相手カードになるため必ずブロックされていた
  // (2026-07-19 発見)。
  "exhaust",
  // ENGINE-soul-drive-activation-observable-event (P3-125): "soul_drive_activated" も
  // actingPlayerId に「発動した本人」を積む同型の player 値イベント。quartz_set/
  // void_core_decrease と同じ理由で先回りして含める。
  "soul_drive_activated",
  // ENGINE-effect-immunity-own-pending-resolution: "effect_declaration" も
  // actingPlayerId に「応答側 (相手の発揮前無効化用の responder)」を積む同型の
  // player 値イベント (queueEffectDeclarationTriggers、relatedPlayerId=宣言者本人)。
  // 既存 precedent (BSKB01-C04 戦艦ハルバード等) は全て player:"opponent"
  // (= 応答側=リスナー自身のコントローラ、既定 whose="self" とたまたま整合) のみ
  // だったため顕在化しなかったが、「自分がこのカードでフラッシュ効果を宣言したとき」型
  // (player:"self"、listener=宣言者自身のカード) では宣言者とリスナー controller が
  // 一致していても actingPlayerId=responder のため既定 whose="self" 判定
  // (sourceCard.controllerPlayerId===actingPlayerId) が必ず false になり
  // ブロックされる (2026-07-30 BSKB01-R04 発見)。
  "effect_declaration",
]);

/** 離脱前に待機した自身の離脱誘発だけは、移動後も発揮元の場の状態を参照する。 */
export function getTriggeredEffectSourceCardForUse(
  sourceCard: CardInstance,
  pendingEffect: PendingTriggeredEffect,
  effect: Effect | undefined
): CardInstance {
  if (
    pendingEffect.preFlushLeaveEvent !== true ||
    effect?.timing.kind !== "card_event" ||
    pendingEffect.relatedInstanceId !== sourceCard.instanceId ||
    pendingEffect.eventKind === "leave_field" ||
    sourceCard.zone === "field"
  )
    return sourceCard;
  return {
    ...sourceCard,
    zone: "field",
    pendingLeaveKind:
      pendingEffect.eventKind === "destroy" ||
      pendingEffect.eventKind === "vanish" ||
      pendingEffect.eventKind === "bounce" ||
      pendingEffect.eventKind === "remove_from_game"
        ? pendingEffect.eventKind
        : sourceCard.pendingLeaveKind,
  };
}

export function getTriggeredEffectSourceUseBlockReason(
  actingPlayerId: string,
  sourceKind: FieldEffectSourceKind,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  whose?: import("../model").EffectPlayerRef,
  sourceZone?:
    | import("../dsl-types").ApplicabilityZone
    | readonly import("../dsl-types").ApplicabilityZone[],
  state?: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): TriggeredEffectSourceUseBlockReason | null {
  const isSelf = sourceCard.controllerPlayerId === actingPlayerId;
  const effectiveWhose = whose ?? "self";
  if (effectiveWhose === "self" && !isSelf) {
    return "source_not_controlled_by_acting_player";
  }
  if (effectiveWhose === "opponent" && isSelf) {
    return "source_not_controlled_by_acting_player";
  }
  // effectiveWhose === "either" → プレイヤーフィルタなし

  const allowedZones: readonly ApplicabilityZone[] = sourceZone
    ? Array.isArray(sourceZone)
      ? sourceZone
      : [sourceZone]
    : ["field"];
  if (state !== undefined && getCardDefinitionById !== undefined) {
    const isAdventSource = collectUnderCardScopeIds(state).adventSource.has(
      sourceCard.instanceId
    );
    const isSoulState = getEffectiveSoulStateIds(
      state,
      getCardDefinitionById
    ).has(sourceCard.instanceId);
    const isBurstSet = isCardInSetState(state, sourceCard);
    const ownSourceZone = getOwnEffectSourceZone(
      state,
      sourceCard,
      sourceCard.controllerPlayerId,
      getCardDefinitionById
    );
    if (
      !matchesApplicabilityZoneList(
        allowedZones,
        sourceCard.zone,
        isAdventSource,
        isSoulState,
        isBurstSet
      ) &&
      !matchesApplicabilityZoneList(
        allowedZones,
        ownSourceZone,
        isAdventSource,
        isSoulState,
        isBurstSet
      )
    ) {
      return "source_not_on_field";
    }
  } else {
    const cardApplicabilityZone = mapZoneToApplicabilityZone(sourceCard.zone);
    if (
      !cardApplicabilityZone ||
      (!allowedZones.includes("anywhere") &&
        !allowedZones.includes(cardApplicabilityZone))
    ) {
      return "source_not_on_field";
    }
  }

  if (sourceKind === "system") {
    return null;
  }

  if (
    !isCategoryCompatibleWithSourceKind(
      sourceDefinition.printedCategory,
      sourceKind
    )
  ) {
    return "source_kind_category_mismatch";
  }

  return null;
}

/**
 * Triggered effect 候補列挙時の発揮条件を共通評価器へ渡す。
 * zone は `getTriggeredEffectSourceUseBlockReason` (sourceZone 経由) で別途検査済みのため
 * ここでは扱わない。循環依存しない effect-applicability-core を正源とする。
 */
function evaluateTriggeredApplicability(
  state: GameState,
  applicability: Applicability,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  const nonZoneApplicability = { ...applicability };
  delete nonZoneApplicability.zone;
  return evaluateEffectApplicabilityForCard({
    state,
    applicability: nonZoneApplicability,
    card: sourceCard,
    definition: sourceDefinition,
    getCardDefinitionById:
      getCardDefinitionById ??
      ((id) => (id === sourceDefinition.cardNo ? sourceDefinition : undefined)),
    getCurrentLevel: getCardCurrentLevel,
  });
}

function triggeredCostGateFilterOptions(options: {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): RequiredEffectCostFilterOptions {
  return {
    evaluateCondition: (condition, conditionSourceInstanceId, actingPlayerId) =>
      evaluateCondition(
        options.state,
        condition,
        conditionSourceInstanceId,
        actingPlayerId,
        options.getCardDefinitionById
      ),
    evaluateApplicability: (applicability, applicabilitySourceInstanceId) => {
      const card = getCardById(options.state, applicabilitySourceInstanceId);
      if (!card) return false;
      const def = options.getCardDefinitionById(card.definitionId);
      if (!def) return false;
      return evaluateTriggeredApplicability(
        options.state,
        applicability,
        card,
        def,
        options.getCardDefinitionById
      );
    },
  };
}

function getStarGarmentTriggeredSourceEntries(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): Array<{
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceEffectDefinition: CardDefinition;
  sourceEffectInstanceId?: string;
  sourceEffectDefinitionId?: string;
  requiredSourceRole?: TextRoleUnderSourceRole;
}> {
  if (!isTextRoleUnderActiveSpiritHost(options)) {
    return [];
  }

  const entries: Array<{
    sourceCard: CardInstance;
    sourceDefinition: CardDefinition;
    sourceEffectDefinition: CardDefinition;
    sourceEffectInstanceId?: string;
    sourceEffectDefinitionId?: string;
    requiredSourceRole?: TextRoleUnderSourceRole;
  }> = [];
  for (const underId of textRoleUnderCardIdsOf(options.hostCard)) {
    if (
      !isActiveTextRoleUnderEffectSource({
        ...options,
        effectSourceInstanceId: underId,
      })
    )
      continue;
    const underCard = getCardById(options.state, underId);
    if (!underCard) continue;
    if (underCard.attachedToInstanceId !== options.hostCard.instanceId) {
      continue;
    }
    if (underCard.zone !== "field" || underCard.faceDown) continue;

    const underDefinition = options.getCardDefinitionById(
      underCard.definitionId
    );
    if (!underDefinition) continue;

    entries.push({
      sourceCard: options.hostCard,
      sourceDefinition: options.hostDefinition,
      sourceEffectDefinition: underDefinition,
      sourceEffectInstanceId: underCard.instanceId,
      sourceEffectDefinitionId: underDefinition.cardNo,
      requiredSourceRole: "text_role_under",
    });
  }
  return entries;
}

/**
 * クォーツ host 継承発揮 (ENGINE-quartz-host-identity-propagation, qa-030) のソース発見。
 * `hostDefinition.quartzHostData.inheritsSetQuartzEffects` を持つ host のみ、
 * `quartzSetStates` 経由でセット中クォーツ (field かつ非裏向き) を継承ソースとして返す。
 * star garment (getStarGarmentTriggeredSourceEntries) と異なり host のカテゴリ制限は無い
 * (ENIGMA は printedCategory:"brave")。scope: triggered (card_event/game_event/phase) のみ
 * (generateTriggeredEffectRegistrations の inferRequiredQuartzInheritedSourceRole と対)。
 * activated/continuous のクォーツ効果は別 scope (未着手、applicability.soulState 自己発火のまま)。
 */
function getQuartzInheritedTriggeredSourceEntries(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): Array<{
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceEffectDefinition: CardDefinition;
  sourceEffectInstanceId?: string;
  sourceEffectDefinitionId?: string;
  requiredSourceRole?: TextRoleUnderSourceRole;
}> {
  if (
    options.hostDefinition.quartzHostData?.inheritsSetQuartzEffects !== true
  ) {
    return [];
  }
  if (options.hostCard.zone !== "field" || options.hostCard.faceDown) {
    return [];
  }

  const entries: Array<{
    sourceCard: CardInstance;
    sourceDefinition: CardDefinition;
    sourceEffectDefinition: CardDefinition;
    sourceEffectInstanceId?: string;
    sourceEffectDefinitionId?: string;
    requiredSourceRole?: TextRoleUnderSourceRole;
  }> = [];
  for (const setState of getQuartzSetStatesByHost(
    options.state,
    options.hostCard.instanceId
  )) {
    const quartzCard = getCardById(options.state, setState.quartzInstanceId);
    if (!quartzCard) continue;
    if (quartzCard.zone !== "field" || quartzCard.faceDown) continue;

    const quartzDefinition = options.getCardDefinitionById(
      quartzCard.definitionId
    );
    if (!quartzDefinition) continue;

    entries.push({
      sourceCard: options.hostCard,
      sourceDefinition: options.hostDefinition,
      sourceEffectDefinition: quartzDefinition,
      sourceEffectInstanceId: quartzCard.instanceId,
      sourceEffectDefinitionId: quartzDefinition.cardNo,
      requiredSourceRole: "quartz_inherited",
    });
  }
  return entries;
}

/**
 * ブレイヴの【合体中】誘発効果は合体先 host が発揮主体になる。
 * sourceCard は host、sourceEffectDefinition/Instance は合体中ブレイヴとして保持し、
 * registration 側の requiredSourceRole:"combined_brave" とだけ照合する。
 */
function getCombinedBraveTriggeredSourceEntries(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): Array<{
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceEffectDefinition: CardDefinition;
  sourceEffectInstanceId?: string;
  sourceEffectDefinitionId?: string;
  requiredSourceRole?: TextRoleUnderSourceRole;
}> {
  if (options.hostCard.zone !== "field" || options.hostCard.faceDown) {
    return [];
  }

  const entries: Array<{
    sourceCard: CardInstance;
    sourceDefinition: CardDefinition;
    sourceEffectDefinition: CardDefinition;
    sourceEffectInstanceId?: string;
    sourceEffectDefinitionId?: string;
    requiredSourceRole?: TextRoleUnderSourceRole;
  }> = [];
  const combinedBraveIds = new Set(options.hostCard.attachedChildrenIds);
  for (const candidate of options.state.cardInstances) {
    if (candidate.imaginRightCombinedWith === options.hostCard.instanceId) {
      combinedBraveIds.add(candidate.instanceId);
    }
  }
  for (const braveId of combinedBraveIds) {
    const braveCard = getCardById(options.state, braveId);
    if (!braveCard) continue;
    if (braveCard.zone !== "field" || braveCard.faceDown) continue;
    if (
      braveCard.attachedToInstanceId !== options.hostCard.instanceId &&
      braveCard.imaginRightCombinedWith !== options.hostCard.instanceId
    ) {
      continue;
    }
    const braveDefinition = options.getCardDefinitionById(
      braveCard.definitionId
    );
    if (!braveDefinition || braveDefinition.printedCategory !== "brave") {
      continue;
    }
    entries.push({
      sourceCard: options.hostCard,
      sourceDefinition: options.hostDefinition,
      sourceEffectDefinition: braveDefinition,
      sourceEffectInstanceId: braveCard.instanceId,
      sourceEffectDefinitionId: braveDefinition.cardNo,
      requiredSourceRole: "combined_brave",
    });
  }
  return entries;
}

/**
 * 解決/辞退済み誘発ソースの除外キー。registrationIndex まで含めることで、
 * 同一カードが同タイミングの誘発効果を複数持つ場合も effect 単位で除外できる。
 * registrationIndex 不明時は素の instanceId（= 旧来の instance 単位除外）にフォールバック。
 */
export function makeResolvedTriggeredSourceKey(
  instanceId: string,
  registrationIndex: number | undefined
): string {
  return registrationIndex === undefined
    ? instanceId
    : `${instanceId}#${registrationIndex}`;
}

function getTriggeredSourceRegistrationInstanceId(
  sourceChoice: TriggeredEffectSourceChoice
): string {
  return (
    sourceChoice.sourceEffectInstanceId ?? sourceChoice.sourceCard.instanceId
  );
}

function sourceChoiceRequiresEffectActivationStartLatch(
  sourceChoice: TriggeredEffectSourceChoice
): boolean {
  const effectIndex = sourceChoice.actionRegistration.effectIndex;
  if (effectIndex === undefined) return false;
  const timing =
    sourceChoice.sourceEffectDefinition.effects?.[effectIndex]?.timing;
  if (timing?.kind !== "game_event") return false;
  if (timing.latchSourceAtEffectActivationStart !== true) return false;
  const events = Array.isArray(timing.event) ? timing.event : [timing.event];
  return (
    events.includes("effect_activated") || events.includes("effect_completed")
  );
}

function isTriggeredSourceChoiceSuppressedByEffectSuppression(
  state: GameState,
  sourceChoice: TriggeredEffectSourceChoice,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  if (
    isCardManifestRestricted(
      state,
      sourceChoice.sourceCard.controllerPlayerId,
      sourceChoice.sourceCard,
      sourceChoice.sourceEffectDefinition,
      getCardDefinitionById,
      sourceChoice.actionRegistration.suppressionEffectDescriptor
    )
  )
    return true;
  if (
    !sourceChoice.actionRegistration.reevaluationPoints?.some((point) =>
      point.checks.includes("effect_suppression")
    )
  ) {
    return false;
  }
  const effectSuppressionState = state.activeContinuousEffects.some(
    (ce) => ce.modifierTag === "effect_suppression"
  )
    ? state
    : null;
  if (!effectSuppressionState) {
    return false;
  }
  const dynamicPreventionBypass = getEffectSourceTribePreventionBypass(
    state,
    sourceChoice.sourceEffectInstanceId ?? sourceChoice.sourceCard.instanceId,
    sourceChoice.sourceCard.controllerPlayerId,
    getCardDefinitionById
  );
  const sourcePreventionLevel =
    dynamicPreventionBypass?.kind === "all_effects"
      ? "unpreventable"
      : (sourceChoice.actionRegistration.preventionLevel ?? "none");
  const sourcePreventionBypass =
    dynamicPreventionBypass?.kind === "all_effects"
      ? undefined
      : mergeTargetLockBypassProfiles(
          sourceChoice.actionRegistration.targetLockBypass,
          dynamicPreventionBypass
        );
  return !executeReevaluationCheck({
    state: effectSuppressionState,
    checkKind: "effect_suppression",
    sourceInstanceId: sourceChoice.sourceCard.instanceId,
    targetInstanceIds: [],
    sourcePreventionLevel,
    ...(sourcePreventionBypass !== undefined ? { sourcePreventionBypass } : {}),
    ...(sourceChoice.actionRegistration.suppressionEffectDescriptor !==
    undefined
      ? {
          suppressionEffectDescriptor:
            sourceChoice.actionRegistration.suppressionEffectDescriptor,
        }
      : {}),
    getCardDefinitionById,
  });
}

function isPreResolvedRelatedTokenForcedCombineSourceChoice(options: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceEffectDefinition: CardDefinition;
  actionRegistration: RegisteredTriggeredEffectAction;
}): boolean {
  if (options.pendingEffect.eventKind !== "summon") return false;
  if (
    options.pendingEffect.relatedInstanceId !== options.sourceCard.instanceId
  ) {
    return false;
  }
  if (options.actionRegistration.effectIndex === undefined) return false;
  const sourceEffect =
    options.sourceEffectDefinition.effects?.[
      options.actionRegistration.effectIndex
    ];
  if (!sourceEffect) return false;
  if (
    sourceEffect.timing.kind !== "card_event" ||
    sourceEffect.timing.event !== "summon" ||
    sourceEffect.executionMode !== "mandatory"
  ) {
    return false;
  }
  const tokenStep = sourceEffect.steps[0];
  const combineStep = sourceEffect.steps[1];
  if (!tokenStep?.id || !combineStep) return false;
  if (
    tokenStep.action.kind !== "put" ||
    tokenStep.action.target.kind !== "from_token_pool"
  ) {
    return false;
  }
  if (
    combineStep.action.kind !== "brave_combine_effect" ||
    combineStep.action.target.kind !== "ref" ||
    combineStep.action.target.stepId !== tokenStep.id ||
    combineStep.action.target.result !== "affected"
  ) {
    return false;
  }

  const hostId = options.sourceCard.attachedToInstanceId;
  if (!hostId) return false;
  const host = getCardById(options.state, hostId);
  if (!host || host.zone !== "field") return false;
  if (!host.attachedChildrenIds.includes(options.sourceCard.instanceId)) {
    return false;
  }
  return (
    options.sourceDefinition.relatedTokenCardNos?.includes(host.definitionId) ??
    false
  );
}

export function getAvailableTriggeredEffectSourceChoices(options: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  ignoreEffectActivationStartLatch?: boolean;
  /** 収集・除去専用。先行する「ただちに」待ちの公開通常誘発は条件を後判定する。 */
  deferNormalPublicConditions?: boolean;
  deferredConditionSourceKeys?: readonly string[];
  /** イベント収集専用。公開登録のLv・盤面条件だけを後の同時誘発解決へ残す。 */
  captureTimingObservers?: boolean;
}): TriggeredEffectSourceChoice[] {
  // P3-39: 型システムは options.getCardDefinitionById / getRegisteredTriggeredEffectActions
  // を必須にしているが、テストが部分的な options を渡してくるケースに備えて runtime defense。
  // どちらかが関数でなければ「リスナー登録が無い世界」と等価とみなして空配列を返す。
  if (
    typeof options.getCardDefinitionById !== "function" ||
    typeof options.getRegisteredTriggeredEffectActions !== "function"
  ) {
    return [];
  }
  // P3-92: mechanic 付き pending (神託/解封/創界石転醒) はカード効果 registration を
  // 持たないためスキャン対象外 (legal-actions の mechanic 分岐が resolve/skip を提示する)。
  if (options.pendingEffect.mechanic) {
    return [];
  }
  const pendingTriggerPriority = options.pendingEffect.triggerPriority;
  const resolvedSourceInstanceIds = new Set(
    options.pendingEffect.resolvedSourceInstanceIds
  );
  // effect 単位の除外キー。同一カード・同タイミングの複数効果を独立に解決/辞退するため、
  // instanceId 単位の resolvedSourceInstanceIds とは別に (instanceId, registrationIndex) を見る。
  const resolvedSourceRegistrationKeys = new Set(
    options.pendingEffect.resolvedSourceRegistrationKeys ?? []
  );
  // 「このカードを場に出したとき、その召喚/配置時効果を発揮させない」等で
  // event に紐付けて渡された個別 source 抑止。これは入場時効果だけを候補化前に除外する。
  // `destroyed_only` も同じフィールドで source を渡すが、そちらは候補を残したまま
  // queue 内で suppression log を積む契約なので、ここで先に除外してはならない。
  const suppressedSourceInstanceIds = new Set(
    options.pendingEffect.suppressedSourceInstanceIds ?? []
  );
  const isSuppressedFieldEntryEvent =
    options.pendingEffect.eventKind === "summon" ||
    options.pendingEffect.eventKind === "place" ||
    options.pendingEffect.eventKind === "put";
  const eligibleSourceInstanceIds =
    options.pendingEffect.eligibleSourceInstanceIds !== undefined
      ? new Set(options.pendingEffect.eligibleSourceInstanceIds)
      : undefined;
  const sourceChoices: TriggeredEffectSourceChoice[] = [];
  const underCardScopes = collectUnderCardScopeIds(options.state);

  for (const scannedCard of options.state.cardInstances) {
    if (resolvedSourceInstanceIds.has(scannedCard.instanceId)) {
      continue;
    }

    // P3-69: フィールド上の裏向きカードは印字の能力を持たない (素性なし)。
    // 印字 definitionId 由来の誘発効果 (card_event / game_event) を発揮させない。
    // 非公開ゾーンで働く能力 (手札誘発=zone:"hand", バースト=zone:"burst") は対象外。
    if (scannedCard.zone === "field" && scannedCard.faceDown) {
      continue;
    }

    const scannedDefinition = options.getCardDefinitionById(
      scannedCard.definitionId
    );

    if (!scannedDefinition) {
      continue;
    }

    const sourceEntries: Array<{
      sourceCard: CardInstance;
      sourceDefinition: CardDefinition;
      sourceEffectDefinition: CardDefinition;
      sourceEffectInstanceId?: string;
      sourceEffectDefinitionId?: string;
      requiredSourceRole?: TextRoleUnderSourceRole;
    }> = isTextRoleUnderCard(options.state, scannedCard)
      ? []
      : [
          {
            sourceCard: scannedCard,
            sourceDefinition: scannedDefinition,
            sourceEffectDefinition: scannedDefinition,
          },
        ];
    sourceEntries.push(
      ...getStarGarmentTriggeredSourceEntries({
        state: options.state,
        hostCard: scannedCard,
        hostDefinition: scannedDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
      ...getQuartzInheritedTriggeredSourceEntries({
        state: options.state,
        hostCard: scannedCard,
        hostDefinition: scannedDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
      ...getCombinedBraveTriggeredSourceEntries({
        state: options.state,
        hostCard: scannedCard,
        hostDefinition: scannedDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    );

    for (const {
      sourceCard,
      sourceDefinition,
      sourceEffectDefinition,
      sourceEffectInstanceId,
      sourceEffectDefinitionId,
      requiredSourceRole,
    } of sourceEntries) {
      if (
        !canTriggerFromPendingLeaveSource(
          options.state,
          sourceCard,
          options.pendingEffect
        )
      ) {
        continue;
      }
      const resolvedRegistrationInstanceId =
        sourceEffectInstanceId ?? sourceCard.instanceId;
      if (
        isSuppressedFieldEntryEvent &&
        suppressedSourceInstanceIds.has(resolvedRegistrationInstanceId)
      ) {
        continue;
      }
      const actionRegistrations =
        options.getRegisteredTriggeredEffectActions(
          sourceEffectDefinition.cardNo
        ) ?? [];

      for (const [
        registrationIndex,
        actionRegistration,
      ] of actionRegistrations.entries()) {
        if (actionRegistration.requiredSourceRole !== requiredSourceRole) {
          continue;
        }
        const sourceKey = makeResolvedTriggeredSourceKey(
          resolvedRegistrationInstanceId,
          registrationIndex
        );
        const capturedSource =
          options.pendingEffect.timingSourceRegistrations?.[sourceKey];
        if (
          options.pendingEffect.timingSourceRegistrations !== undefined &&
          (!capturedSource ||
            capturedSource.sourceInstanceId !== sourceCard.instanceId ||
            capturedSource.sourceDefinitionId !== sourceCard.definitionId ||
            capturedSource.sourceFieldInstanceGeneration !==
              (sourceCard.fieldInstanceGeneration ?? 0) ||
            capturedSource.effectDefinitionId !==
              sourceEffectDefinition.cardNo ||
            capturedSource.effectFieldInstanceGeneration !==
              (getCardById(options.state, resolvedRegistrationInstanceId)
                ?.fieldInstanceGeneration ?? 0))
        )
          continue;
        // イベント収集時の対応表がある場合、後の分離や状態変化で新たに適用可能に
        // なった発揮元を過去のイベントへ追加しない。関連カードを持たないイベントや
        // 対応表の無い旧保存データは従来の評価を維持する。
        const capturedRelatedIds =
          options.pendingEffect.relatedInstanceIdsBySourceRegistrationKey;
        if (
          options.pendingEffect.relatedInstanceId !== null &&
          capturedRelatedIds !== undefined &&
          !Object.hasOwn(
            capturedRelatedIds,
            makeResolvedTriggeredSourceKey(
              resolvedRegistrationInstanceId,
              registrationIndex
            )
          )
        ) {
          continue;
        }
        // effect 単位の解決済み除外: この registration が解決/辞退済みならスキップ。
        // 素の instanceId キー (registrationIndex 不明時のフォールバック) も whole-instance
        // 除外として尊重する。
        if (
          resolvedSourceRegistrationKeys.has(
            makeResolvedTriggeredSourceKey(
              resolvedRegistrationInstanceId,
              registrationIndex
            )
          ) ||
          resolvedSourceRegistrationKeys.has(resolvedRegistrationInstanceId)
        ) {
          continue;
        }
        if (
          pendingTriggerPriority !== undefined &&
          getTriggerPriority(actionRegistration) !== pendingTriggerPriority
        ) {
          continue;
        }
        const effectEvent =
          options.pendingEffect.event ??
          triggerEventKindToStructuredEvent(options.pendingEffect.eventKind);
        if (
          !matchesTriggerEvent(
            getEffectiveTriggeredEffectMatcher(actionRegistration),
            effectEvent
          )
        ) {
          continue;
        }

        const sourceChoice: TriggeredEffectSourceChoice = {
          sourceCard,
          sourceDefinition,
          sourceEffectDefinition,
          ...(sourceEffectInstanceId !== undefined
            ? { sourceEffectInstanceId }
            : {}),
          ...(sourceEffectDefinitionId !== undefined
            ? { sourceEffectDefinitionId }
            : {}),
          sourceKind: actionRegistration.sourceKind,
          registrationIndex,
          actionRegistration,
        };
        const captureDynamicEligibility =
          options.captureTimingObservers === true &&
          getTriggerPriority(actionRegistration) === "normal" &&
          !isPrivateTriggeredEffectSourceChoice(options.state, sourceChoice);
        let eventConditionResults: Readonly<Record<string, boolean>> =
          getObservedTriggerConditionResults(capturedSource) ?? {};

        if (
          options.ignoreEffectActivationStartLatch !== true &&
          sourceChoiceRequiresEffectActivationStartLatch(sourceChoice) &&
          (eligibleSourceInstanceIds === undefined ||
            !eligibleSourceInstanceIds.has(resolvedRegistrationInstanceId))
        ) {
          continue;
        }

        // P3-73: timingScope（『自分の/相手の』＋ステップ）を誘発効果でも強制する。
        // eventMatcher は period→step フィルタしか持たず player（自分の/相手の）を見ないため、
        // 「自分のアタックステップ中」型（咲夜 BSTH01-X05）が相手ターンでも誤発火していた。
        if (
          actionRegistration.timingScope &&
          !isTimingScopeActive(
            actionRegistration.timingScope,
            options.state.step,
            options.state.activePlayerId,
            sourceCard.controllerPlayerId
          )
        ) {
          continue;
        }

        // P3-26 / P3-27: timing 種別ごとのフィルタ。
        // - card_event: このカード自身のイベントのみ反応 (relatedInstanceId === sourceCard.instanceId)
        // - game_event: timing.player と timing.triggerFilter を pendingEffect に対して評価
        // 文脈 (relatedInstanceId / relatedPlayerId) が欠落している pending では
        // 各 timing の不変条件が確認できないため fail-closed (= 候補から除外)。
        const effectIndex = actionRegistration.effectIndex;
        const originalEffect =
          effectIndex !== undefined
            ? sourceEffectDefinition.effects?.[effectIndex]
            : undefined;
        const originalTiming = originalEffect?.timing;
        if (
          originalTiming?.kind === "game_event" &&
          originalTiming.afterPhysicalLeave === true &&
          options.pendingEffect.eventKind !== "leave_field"
        )
          continue;
        const selfReferenceRewriteStatus = getBraveSelfReferenceRewriteStatus({
          state: options.state,
          sourceCard,
          sourceDefinition,
          sourceEffectDefinition,
          ...(sourceEffectInstanceId !== undefined
            ? { sourceEffectInstanceId }
            : {}),
          effect: originalEffect,
          getCardDefinitionById: options.getCardDefinitionById,
        });
        if (effectIndex !== undefined) {
          const usesEffectSourceSubject =
            originalTiming?.kind === "card_event" &&
            originalTiming.effectSourceEvents?.some(
              (eventKind) => eventKind === options.pendingEffect.eventKind
            ) === true;
          const eventSubjectInstanceId = usesEffectSourceSubject
            ? (sourceEffectInstanceId ?? sourceCard.instanceId)
            : sourceCard.instanceId;
          if (
            originalTiming?.kind === "card_event" &&
            options.pendingEffect.relatedInstanceId !== eventSubjectInstanceId
          ) {
            // 継承元自身と明示されたイベントを host や他の合体カードへ広げない。
            if (usesEffectSourceSubject) continue;
            const relatedToAttachedHost =
              sourceCard.attachedToInstanceId !== null &&
              options.pendingEffect.relatedInstanceId ===
                sourceCard.attachedToInstanceId;
            const relatedToCombinedBraveHost =
              requiredSourceRole === "combined_brave" &&
              options.pendingEffect.triggerRelatedCombinedHostInstanceId ===
                sourceCard.instanceId &&
              (sourceEffectInstanceId === undefined ||
                options.pendingEffect.relatedInstanceId ===
                  sourceEffectInstanceId);
            if (
              !relatedToCombinedBraveHost &&
              (!relatedToAttachedHost ||
                (selfReferenceRewriteStatus !== "allowed_optional" &&
                  selfReferenceRewriteStatus !== "allowed_mandatory"))
            ) {
              // null は self ではないので弾く (after_draw 等 relatedInstanceId を持たないイベントも安全側)
              continue;
            }
          }
          if (selfReferenceRewriteStatus === "blocked") {
            // attached host の event に相乗りできそうでも、rewrite 許可が inactive
            // または見出し側で host 種別が合わない場合は fail-closed。
            continue;
          }

          // card_event 効果は登録が宣言したイベント文字列にのみ反応する。
          // eventMatcher の family が同じだと別イベントを拾い得る (state_change ファミリの
          // exhaust / recover / rebirth は同一 family で actionKind 無しのため相互マッチする)。
          // CARD_EVENT_TO_TRIGGER は恒等写像 (DSL event 文字列 === TriggerEventKind) なので
          // 効果の event 文字列と pending.eventKind を直接照合して同タイミング誤発火を防ぐ。
          // ただし「召喚/契約合体時」のように登録生成で追加 eventKind へ展開したものは、
          // actionRegistration.eventKind も宣言済みイベントとして扱う。
          //
          // ENGINE-leave-field-trigger-during-pending (2026-06-25):
          // `event:"leave_field"` 宣言は「フィールドを離れるとき」の umbrella term。
          // pendingLeave 生成時 (pre-flush) に emit される eventKind ∈ {destroy, vanish, bounce, remove_from_game}
          // も leave_field 宣言に match させる。これにより `stay_on_field` / `rebirth` 等の
          // pre-flush 必須アクション (BSLH01-R01, BSLH01-TR01(A), BSGE01-R01..R05, BSTH03-M08
          // 等の既存カード群) が正しく発火する。
          // post-flush eventKind="leave_field" は宣言と直接 match するが、その時点で sourceCard.zone
          // は "trash" となり sourceZone="field" check (L1144) で別途弾かれる (burst 専用経路へ)。
          // event:"bounce" の自己宣言も可能。leave_field は全離脱種をまとめて観測する。
          if (originalTiming?.kind === "card_event") {
            const declaredEvents: readonly string[] = Array.isArray(
              originalTiming.event
            )
              ? originalTiming.event
              : [originalTiming.event];
            const registeredDeclaredEvents = declaredEvents.includes(
              actionRegistration.eventKind
            )
              ? declaredEvents
              : [...declaredEvents, actionRegistration.eventKind];
            if (
              !matchesDeclaredCardEventKind(
                registeredDeclaredEvents,
                options.pendingEffect.eventKind
              )
            ) {
              continue;
            }
            if (originalTiming.sourceEffectIndex !== undefined) {
              const allowed = Array.isArray(originalTiming.sourceEffectIndex)
                ? originalTiming.sourceEffectIndex
                : [originalTiming.sourceEffectIndex];
              if (
                options.pendingEffect.sourceEffectIndex === undefined ||
                !allowed.includes(options.pendingEffect.sourceEffectIndex) ||
                (options.pendingEffect.effectSourceInstanceId !== undefined &&
                  options.pendingEffect.effectSourceInstanceId !==
                    sourceCard.instanceId)
              ) {
                continue;
              }
            }
            if (originalTiming.effectScope !== undefined) {
              const allowed = Array.isArray(originalTiming.effectScope)
                ? originalTiming.effectScope
                : [originalTiming.effectScope];
              if (
                options.pendingEffect.effectScope === undefined ||
                !allowed.includes(options.pendingEffect.effectScope)
              ) {
                continue;
              }
            }
            if (
              isPreResolvedRelatedTokenForcedCombineSourceChoice({
                state: options.state,
                pendingEffect: options.pendingEffect,
                sourceCard,
                sourceDefinition,
                sourceEffectDefinition,
                actionRegistration,
              })
            ) {
              continue;
            }
          }

          // `leave_field` physical boundary is after the card has actually left.
          // 別効果の離脱誘発は現在の待機状態を参照する。先に「残る」が解決したら、
          // 収集時のスナップショットだけで発揮できない（qa-018、2026-09-22確認）。
          if (options.pendingEffect.preFlushLeaveEvent === true) {
            const relatedIds = capturedRelatedIds?.[
              makeResolvedTriggeredSourceKey(
                resolvedRegistrationInstanceId,
                registrationIndex
              )
            ] ?? [
              options.pendingEffect.relatedInstanceId,
              ...(options.pendingEffect.relatedInstanceIds ?? []),
            ];
            const hasWaitingSubject = options.state.pendingLeaveEntities.some(
              (leave) =>
                !leave.blockedByResistance &&
                relatedIds.includes(leave.instanceId) &&
                leave.kind === options.pendingEffect.eventKind
            );
            if (!hasWaitingSubject) continue;
          }

          // `leave_field` physical boundary is after the card has actually left.
          // Effects whose steps manipulate `trigger_related_instance` as a
          // pending leave replacement are "フィールドを離れるとき" reactions, so
          // they must only use the pre-flush destroy/vanish/bounce/remove event.
          if (
            originalEffect !== undefined &&
            options.pendingEffect.eventKind === "leave_field" &&
            isRegisteredLeaveFieldPreFlushEffect(
              originalEffect,
              options.pendingEffect.eventKind
            )
          ) {
            continue;
          }

          // phase timing は start_step / end_step が同じ step_timing family に写る。
          // eventMatcher だけだと「各ステップ終了時」の wildcard 登録が End Step 終了で
          // start_step/end_step の両登録を拾うため、登録時 eventKind でも exact に絞る。
          if (
            originalTiming?.kind === "phase" &&
            actionRegistration.eventKind !== options.pendingEffect.eventKind
          ) {
            continue;
          }

          // require_related_instance_on_field のイベント (battle_end / advent / rebirth /
          // brave_combined 等) は、関連カード (= 観測対象) がイベント時点でフィールドに残って
          // いる場合のみリスナーを誘発する。card_event (自己 X) でも game_event (第三者 Y) でも
          // 同じ規約。特に battle_end はバトル中に破壊され trash に落ちた / pendingLeave で離脱
          // 予定の参加カードを getCardById では拾えてしまうため、ここで zone と pendingLeaveKind
          // を検査する。10_rules/02 §バトル終了時 効果の発火条件 形式3 「X が場残留必要」(裁定
          // 2026-06-22) と TargetSpec.trigger_related_instance 側の pendingLeaveKind===null
          // 検査と同 SSOT。verifier 2026-06-22 round 8/9 lens 6 補正で card_event を含む全 kind
          // に適用 (旧コードは game_event ブロック内限定)。
          //
          // 形式4 (裁定 2026-06-22): 「Lv1-Lv2『お互いのアタックステップ』...バトル終了時、〜」
          // (BSDB01-M01[2]) 型は game_event:battle_end + requireRelatedInstanceOnField:false で
          // opt-out し、関連カード on-field 検査をスキップする。効果ソース自身の場残留は
          // sourceZone 既定 (field-only) で別軸で保証される。
          // verifier 2026-06-23 round 6 lens 2 補正: opt-out は event === "battle_end" に限定
          // (advent/rebirth/brave_combined 等の他 require_related_instance_on_field event の
          // 検査を意図せず外さない)。queue ENGINE-battle-end-form4-bystander-while-on-field の
          // 仕様も「timing.kind === game_event + event === battle_end のとき opt-out」と限定済み。
          {
            const relatedEvent = triggerEventKindToStructuredEvent(
              options.pendingEffect.eventKind
            );
            const relatedValidationMode = relatedEvent.validationMode;
            const optedOutOfRelatedOnField =
              originalTiming?.kind === "game_event" &&
              originalTiming.requireRelatedInstanceOnField === false &&
              (Array.isArray(originalTiming.event)
                ? originalTiming.event.includes("battle_end")
                : originalTiming.event === "battle_end") &&
              options.pendingEffect.eventKind === "battle_end";
            if (
              relatedValidationMode === "require_related_instance_on_field" &&
              options.pendingEffect.relatedInstanceId !== null &&
              !optedOutOfRelatedOnField
            ) {
              const relatedCard = getCardById(
                options.state,
                options.pendingEffect.relatedInstanceId
              );
              // 保存済みの旧キューも発揮資格の正源で除去する。
              // 下カードの所属を召喚/配置/煌臨・合体の成立と扱わない。
              if (
                (relatedEvent.family === "enter_field" ||
                  relatedEvent.family === "brave_link") &&
                (underCardScopes.textRole.has(
                  options.pendingEffect.relatedInstanceId
                ) ||
                  underCardScopes.adventSource.has(
                    options.pendingEffect.relatedInstanceId
                  ))
              )
                continue;
              // ENGINE-targeted-disclosure-offfield-source: 「フィールド以外で発揮中」の
              // 対象 (例 BSLH01-T14「フィールド以外で発揮中の自分の系統CBスピリット」) は
              // zone==="field" を満たさないが、開いている応答窓の保留 ActiveStack 鎖に
              // 自身の instanceId が (発揮宣言の cardInstanceId として) 乗っている。
              // targeted イベント限定でこのケースを field-only 検査の代替として通す
              // (isInstanceInOpenResponseWindowOrPendingCascade は P3-131 の targeted
              // disclosure SSOT family 専用拡張版、SSOT のため新規の並行スキャンを書かず流用する)。
              // P3-130: この関数は queue 時点 (窓が開いている) と declare 時点
              // (resolve_pending_triggered_effect の宣言可否判定、P3-34 により窓
              // クローズ後にしか呼ばれない) の両方から呼ばれる。
              // isInstanceInOpenResponseWindowOrPendingCascade を都度re-deriveすると、
              // declare 時点では窓が必ず閉じているため恒久的に false になり宣言候補が消える
              // (queue と declare が構造的に両立不能)。
              // pendingEffect.relatedInstanceOffFieldActivating に queue 時点のスナップ
              // ショットがあれば優先し、無ければ (未queue経路の probe 呼び出し等) 従来通り
              // 都度導出する。
              const isOffFieldActivatingTarget =
                options.pendingEffect.eventKind === "targeted" &&
                relatedCard !== undefined &&
                relatedCard.zone !== "field" &&
                (options.pendingEffect.relatedInstanceOffFieldActivating ===
                  true ||
                  isInstanceInOpenResponseWindowOrPendingCascade(
                    options.state,
                    options.pendingEffect.relatedInstanceId
                  ));
              if (
                !isOffFieldActivatingTarget &&
                (!relatedCard ||
                  relatedCard.zone !== "field" ||
                  relatedCard.pendingLeaveKind !== null)
              ) {
                continue;
              }
            }
          }

          if (originalTiming?.kind === "game_event") {
            // engine-suppress-third-party-summon-observation (BSTH11-X02【現界】):
            // 「召喚ではない」場入りは第三者 (game_event) 観測から不可視。card_event
            // (このカード自身) は上の self 一致判定で既に処理済みのため影響しない。
            if (options.pendingEffect.suppressThirdPartyObservation === true) {
              continue;
            }
            if (
              options.pendingEffect.exactGameEventKind === true ||
              actionRegistration.exactGameEventKind === true
            ) {
              const declaredEvents: readonly string[] = Array.isArray(
                originalTiming.event
              )
                ? originalTiming.event
                : [originalTiming.event];
              if (!declaredEvents.includes(options.pendingEffect.eventKind)) {
                continue;
              }
            }

            // 「相手によって/自分によって」: cause（battle 等の行為種別）とは別に、
            // 実際にイベントを直接起こしたプレイヤーを listener の controller 基準で照合する。
            // causePlayer のない旧イベントは安全側で候補にしない。
            if (originalTiming.triggerCausedBy !== undefined) {
              const causedByPlayerId = options.pendingEffect.causedByPlayerId;
              if (causedByPlayerId === undefined) {
                continue;
              }
              const isSelfCaused =
                causedByPlayerId === sourceCard.controllerPlayerId;
              if (
                (originalTiming.triggerCausedBy === "self" && !isSelfCaused) ||
                (originalTiming.triggerCausedBy === "opponent" && isSelfCaused)
              ) {
                continue;
              }
            }

            // 「このスピリットの召喚以外で」型の自己除外: イベントを起こしたカードが
            // このリスナー自身の instance なら誘発しない（自召喚/自煌臨/自配置で誤発火しない）。
            if (
              originalTiming.excludeTriggerSelf === true &&
              options.pendingEffect.relatedInstanceId === sourceCard.instanceId
            ) {
              continue;
            }
            // excludeTriggerSelf の逆: 自カード自身の効果が起こしたイベントだけに反応する。
            // 例: BSTS01-CX01[5,6,7]「この『リムル』の効果で自分のカウントが増えたとき」。
            // count_increase 等 player 値イベントでは relatedInstanceId に
            // causedBySourceInstanceId (=効果発揮元カード) が乗るため、自カード instance
            // との一致で「自分のこの効果由来か」を判定できる。
            if (
              originalTiming.requireTriggerSelf === true &&
              options.pendingEffect.relatedInstanceId !== sourceCard.instanceId
            ) {
              continue;
            }
            // 召喚 responder のカテゴリースコープ: スピリット召喚のみが汎用「召喚されたとき」の
            // 対象。ブレイヴ/アルティメット召喚は「スピリット召喚ではない」ため、triggerFilter が
            // category を明示しない限り反応しない (明示時は下の triggerFilter で判定)。
            // ブレイヴ/アルティメット自身の「召喚時」は card_event:summon (上の self 判定) で発火する。
            if (
              !capturedSource &&
              !summonResponderMatchesCategoryScope(
                options.state,
                options.pendingEffect,
                originalTiming.triggerFilter
              )
            ) {
              continue;
            }
            // P3-27: player フィルタ ("self" / "opponent" / "either")
            if (
              originalTiming.player !== undefined &&
              originalTiming.player !== "either"
            ) {
              if (options.pendingEffect.relatedPlayerId === null) {
                // player フィルタが指定されているが文脈 (relatedPlayerId) がない → 評価不能 → fail-closed
                continue;
              }
              const isOwnEvent =
                options.pendingEffect.relatedPlayerId ===
                sourceCard.controllerPlayerId;
              if (originalTiming.player === "self" && !isOwnEvent) continue;
              if (originalTiming.player === "opponent" && isOwnEvent) continue;
            }

            // P3-27: triggerFilter — 召喚されたカード等が指定 filter にマッチするか
            // 公開観測登録は収集時に対象/発生元filterへ一致済み。後の属性変更で
            // イベントの意味を再判定しない。private/旧snapshotは従来の照合を維持する。
            if (originalTiming.triggerFilter !== undefined && !capturedSource) {
              if (options.pendingEffect.relatedInstanceId === null) {
                // triggerFilter が指定されているが対象カードが特定できない → fail-closed
                continue;
              }
              const triggerCard = getCardById(
                options.state,
                options.pendingEffect.relatedInstanceId
              );
              if (!triggerCard) continue;
              const triggerDef = options.getCardDefinitionById(
                triggerCard.definitionId
              );
              if (!triggerDef) continue;
              if (
                !matchesCardReferenceFilter(
                  triggerCard,
                  triggerDef,
                  originalTiming.triggerFilter,
                  {
                    soulStateIds: getEffectiveSoulStateIds(
                      options.state,
                      options.getCardDefinitionById
                    ),
                    sourceDefinition,
                    effectiveColors: getEffectiveColors(
                      options.state,
                      triggerCard,
                      triggerDef
                    ),
                    effectiveTribes: getEffectiveTribes(
                      options.state,
                      triggerCard,
                      triggerDef,
                      options.getCardDefinitionById
                    ),
                    // override_properties.cost / 合体ブレイヴ / additional_cost を
                    // triggerFilter の minCost/maxCost 評価に反映し、場の target-resolution
                    // と同じ cost SSOT を使う。
                    ...getCombinedUnitCostFilterOptions(
                      options.state,
                      triggerCard,
                      triggerDef,
                      options.getCardDefinitionById
                    ),
                    satisfiedReductionSymbolCount:
                      options.pendingEffect
                        .effectSourceSatisfiedReductionSymbolCount,
                    requiredReductionSymbolCount:
                      options.pendingEffect
                        .effectSourceRequiredReductionSymbolCount,
                    // 合体ユニット (host+attached brave) と symbol_addition CE 由来の
                    // 実効シンボル数を triggerFilter の symbolCount/minSymbolCount 判定へ注入
                    // (ENGINE-card-filter-effective-symbol-count 2026-06-27 着地)。
                    effectiveSymbolCount:
                      triggerCard.zone === "field"
                        ? getCombinedUnitSymbolCount(
                            options.state,
                            triggerCard,
                            triggerDef,
                            options.getCardDefinitionById
                          )
                        : undefined,
                    effectiveLevel:
                      triggerCard.zone === "field"
                        ? getEffectiveLevel(
                            options.state,
                            triggerCard,
                            triggerDef,
                            options.getCardDefinitionById
                          )
                        : undefined,
                    // 合体ユニット BP (bp_modify・合体ブースト等反映後) を triggerFilter の
                    // minBp/maxBp 判定へ注入する。未注入だと card-filter.ts の
                    // フォールバックで印字 Lv1 BP のみ見てしまう (SSOT gap、verifier 指摘)。
                    effectiveBp:
                      triggerCard.zone === "field"
                        ? getCombinedUnitBp(
                            options.state,
                            triggerCard,
                            triggerDef,
                            options.getCardDefinitionById
                          )
                        : undefined,
                    // state を渡して act_as_spirit 等の実効 category を category 判定へ反映
                    // (verifier 2026-06-22 round 11 lens 3 補正)。
                    state: options.state,
                  }
                )
              ) {
                continue;
              }
            }

            // P3-76: triggerSourceFilter — targeting/leave-field などのイベント source に
            // CardFilter を適用する。relatedInstanceId は対象カードなので triggerFilter と混ぜず、
            // 専用の effectSourceInstanceId carrier を fail-closed で見る。
            if (
              originalTiming.triggerSourceFilter !== undefined &&
              !capturedSource
            ) {
              const triggerSourceFilter = originalTiming.triggerSourceFilter;
              const effectSourceInstanceIds =
                getPendingEffectTriggerSourceInstanceIds(options.pendingEffect);
              if (effectSourceInstanceIds.length === 0) {
                continue;
              }
              const hasMatchingEffectSource = effectSourceInstanceIds.some(
                (effectSourceInstanceId) => {
                  const effectSourceCard = getCardById(
                    options.state,
                    effectSourceInstanceId
                  );
                  if (!effectSourceCard) return false;
                  const effectSourceDef = options.getCardDefinitionById(
                    effectSourceInstanceIds.length === 1
                      ? (options.pendingEffect.effectSourceDefinitionId ??
                          effectSourceCard.definitionId)
                      : effectSourceCard.definitionId
                  );
                  if (!effectSourceDef) return false;
                  return matchesCardReferenceFilter(
                    effectSourceCard,
                    effectSourceDef,
                    triggerSourceFilter,
                    {
                      soulStateIds: getEffectiveSoulStateIds(
                        options.state,
                        options.getCardDefinitionById
                      ),
                      sourceDefinition,
                      effectiveColors: getEffectiveColors(
                        options.state,
                        effectSourceCard,
                        effectSourceDef
                      ),
                      effectiveTribes: getEffectiveTribes(
                        options.state,
                        effectSourceCard,
                        effectSourceDef,
                        options.getCardDefinitionById
                      ),
                      ...getCombinedUnitCostFilterOptions(
                        options.state,
                        effectSourceCard,
                        effectSourceDef,
                        options.getCardDefinitionById
                      ),
                      effectiveSymbolCount:
                        effectSourceCard.zone === "field"
                          ? getCombinedUnitSymbolCount(
                              options.state,
                              effectSourceCard,
                              effectSourceDef,
                              options.getCardDefinitionById
                            )
                          : undefined,
                      effectiveLevel:
                        effectSourceCard.zone === "field"
                          ? getEffectiveLevel(
                              options.state,
                              effectSourceCard,
                              effectSourceDef,
                              options.getCardDefinitionById
                            )
                          : undefined,
                      // 合体ユニット BP を注入 (上記 triggerFilter 経路と同じ SSOT gap 修正)。
                      effectiveBp:
                        effectSourceCard.zone === "field"
                          ? getCombinedUnitBp(
                              options.state,
                              effectSourceCard,
                              effectSourceDef,
                              options.getCardDefinitionById
                            )
                          : undefined,
                      state: options.state,
                    }
                  );
                }
              );
              if (!hasMatchingEffectSource) {
                continue;
              }
            }

            if (originalTiming.triggerSourcePreventionLevels !== undefined) {
              const sourcePreventionLevel =
                options.pendingEffect.effectSourcePreventionLevel;
              if (
                sourcePreventionLevel === undefined ||
                !originalTiming.triggerSourcePreventionLevels.includes(
                  sourcePreventionLevel
                )
              ) {
                continue;
              }
            }
            if (
              originalTiming.actionKinds !== undefined &&
              !originalTiming.actionKinds.some((kind) =>
                options.pendingEffect.resolvedActionKinds?.includes(kind)
              )
            ) {
              continue;
            }
          }
        }

        // ENGINE-triggered-effect-chooser-default-source-controller:
        // actionRegistration.whose は phase timing 専用 (structured-effect-registrations.ts
        // whoseField は effect.timing.kind==="phase" でのみ設定)。ENGINE-phase-whose-either-
        // source-controller-actingplayerid (2026-06-25) により pendingEffect.actingPlayerId は
        // 構築時に「そのステップのターンプレイヤー」から「候補カードの controller」へ
        // 上書き済みのため、resolve 時の再スキャンで isSelf 判定に actingPlayerId を使うと
        // 常に sourceCard.controllerPlayerId と一致し isSelf=true に固定される
        // (whose:"opponent" が常に自己ブロックする、whose:"self" は偶然一致で無症状)。
        // whose 判定は「そのイベント発生時のターンプレイヤー」基準を保つ必要があるため、
        // fork の影響を受けない relatedPlayerId (turn-system.ts の各 phase イベントで
        // activePlayerId として設定され、fork 時も上書きされない) を使う。
        // actionRegistration.whose が未設定 (= phase timing 以外、または whose 省略の
        // card_event/game_event 系) では従来どおり actingPlayerId を使う。relatedPlayerId は
        // event 種別ごとに意味が異なる (「対象カードのプレイヤー」等) ため phase timing 以外に
        // 流用すると self 判定を破壊する (P3-28 / P3-73 系の private declaration 回帰で実証済み)。
        // ただし pre-flush 離脱 card_event は relatedInstanceId === sourceCard.instanceId
        // を検査済みなので、event の caused-by/acting player と source controller の一致は
        // 要求しない。要求すると自分の効果で相手カードが消滅した場合の
        // 「このスピリットの消滅時」が候補から落ちる。
        //
        // ENGINE-void-core-decrease-trigger-whose-gap (2026-07-10): player 値イベント
        // (count_increase/count_decrease/core_placed_on_life/void_core_decrease) は
        // actingPlayerId に「値が変化したプレイヤー」(=イベント主体) を積む規約
        // (queueFlashUsedTriggers のコメント参照: 「pending.actingPlayerId = 応答側」が
        // 本来の規約だが、これら player 値イベントは event 生成時点でどの候補カードが
        // 応答するか分からないため actingPlayerId=afterPlayer.id で妥協している)。
        // これまで `timing.player:"self"` の登録しか存在しなかったため
        // isSelf=(sourceCard.controller===actingPlayerId) が偶然常に true で無症状だった。
        // BSSL01-C02[0]「相手が相手の効果でボイドからコアを増やしたとき」のような
        // `timing.player:"opponent"` の game_event 登録では isSelf が常に false になり
        // whose 既定 "self" で誤ブロックされる。timing.player を whose と同じ意味論
        // (self/opponent/either) として扱い、relatedPlayerId (イベント主体、上の player
        // フィルタと同じ SSOT) を基準にする。
        // 適用は PLAYER_VALUE_EVENT_KINDS_FOR_WHOSE_GAP (下記) の player 値イベントに限定する。
        // attack/block/battle_end/leave_field 等は actingPlayerId が別の意味論 (アクティブ
        // プレイヤー・被トリガーカードの controller 等) を持ち、同じ書き換えを適用すると
        // 既存の "self"/"either" 判定を壊す (c2-trigger-events.test.ts / bses01-cards.test.ts
        // で実証済みの回帰。試行してrevert)。
        const isQueuedPreFlushCardLeaveEvent =
          options.pendingEffect.preFlushLeaveEvent === true &&
          originalTiming?.kind === "card_event" &&
          options.pendingEffect.relatedInstanceId === sourceCard.instanceId &&
          options.pendingEffect.eventKind !== "leave_field";
        const effectiveWhose =
          actionRegistration.whose ??
          (isQueuedPreFlushCardLeaveEvent
            ? "either"
            : originalTiming?.kind === "game_event" &&
                PLAYER_VALUE_EVENT_KINDS_FOR_WHOSE_GAP.has(
                  options.pendingEffect.eventKind
                )
              ? originalTiming.player
              : undefined);
        const sourceCardForPreFlushLeave = getTriggeredEffectSourceCardForUse(
          sourceCard,
          options.pendingEffect,
          originalEffect
        );
        const blockReason = getTriggeredEffectSourceUseBlockReason(
          effectiveWhose !== undefined
            ? (options.pendingEffect.relatedPlayerId ??
                options.pendingEffect.actingPlayerId)
            : options.pendingEffect.actingPlayerId,
          actionRegistration.sourceKind,
          sourceCardForPreFlushLeave,
          sourceDefinition,
          effectiveWhose,
          actionRegistration.sourceZone,
          options.state,
          options.getCardDefinitionById
        );

        if (blockReason !== null) {
          continue;
        }

        // applicability (level / combined / soulState) を満たさないカードは候補から除外。
        // sourceZone の検査は blockReason 経由で済んでいる。
        // この検査が無いと、例えば Lv2 制限の game_event:summon トリガを Lv1 のネクサスが
        // 拾ってしまい、本来空であるべき pending が queue に積まれる
        // (BSTH01-R21 紅魔館 Lv1 で 8 コスト夜族赤スピリット召喚等)。
        if (actionRegistration.applicability) {
          const shouldEvaluateApplicabilityOnEffectSource =
            requiredSourceRole === "quartz_inherited";
          const sourceEffectCardForApplicability =
            shouldEvaluateApplicabilityOnEffectSource &&
            sourceEffectInstanceId !== undefined
              ? getCardById(options.state, sourceEffectInstanceId)
              : sourceCardForPreFlushLeave;
          if (sourceEffectCardForApplicability === undefined) {
            continue;
          }
          if (
            !evaluateTriggeredApplicability(
              options.state,
              captureDynamicEligibility
                ? { ...actionRegistration.applicability, level: {} }
                : actionRegistration.applicability,
              sourceEffectCardForApplicability,
              shouldEvaluateApplicabilityOnEffectSource
                ? sourceEffectDefinition
                : sourceDefinition,
              options.getCardDefinitionById
            )
          ) {
            continue;
          }
        }

        // P3-57: Effect レベルの condition (`field_lacks` / `min_level` / `field_has` 等)
        // を listing 段階で評価する。実行時の evaluateCondition と同じ汎用パイプライン
        // を使い、専用検査ロジックは書かない。
        // 例: BSTH01-M01 パチュリー (手札 start_step トリガ + condition.field_lacks
        // cardName="self") は同名スピリットが自場にいる時に listing 0 件であるべきだが、
        // この検査が無いと「発揮する」prompt → コスト支払い UI まで進んでしまう。
        if (effectIndex !== undefined) {
          const sourceEffect = sourceEffectDefinition.effects?.[effectIndex];
          if (
            getRebirthEffectGate(sourceEffect) !== null &&
            hasRebirthResolvedInTimingWindow(
              options.state,
              getPendingTriggeredRebirthTimingWindowId(
                options.pendingEffect,
                sourceCard.controllerPlayerId
              )
            )
          )
            continue;
          const effectCondition =
            sourceEffect?.condition &&
            applyTriggerConditionResults(
              sourceEffect.condition,
              getObservedTriggerConditionResults(capturedSource),
              captureDynamicEligibility
            );
          if (
            effectCondition &&
            effectCondition.length > 0 &&
            !(
              (options.deferNormalPublicConditions === true ||
                options.deferredConditionSourceKeys?.includes(
                  makeResolvedTriggeredSourceKey(
                    resolvedRegistrationInstanceId,
                    registrationIndex
                  )
                )) &&
              getTriggerPriority(actionRegistration) === "normal" &&
              !isPrivateTriggeredEffectSourceChoice(
                options.state,
                sourceChoice
              ) &&
              !captureDynamicEligibility
            )
          ) {
            const conditionSourceContext: ConditionSourceContext | undefined =
              requiredSourceRole === "combined_brave" &&
              sourceEffectInstanceId !== undefined
                ? { combinedBraveHostSourceInstanceId: sourceCard.instanceId }
                : undefined;
            const triggerContext: TriggerContext = {};
            // 「手札から召喚したとき」等の trigger_from_zone 評価用に、被誘発カードの
            // 場入り前ゾーンを注入する (enter_field 系イベントのみ存在)。未注入だと
            // trigger_from_zone が常に fail-closed になり listing 0 件になる。
            if (options.pendingEffect.fromZone !== undefined) {
              triggerContext.fromZone = options.pendingEffect.fromZone;
            }
            const triggerSourceInstanceIds =
              getPendingEffectTriggerSourceInstanceIds(options.pendingEffect);
            if (
              options.pendingEffect.relatedInstanceId !== null ||
              triggerSourceInstanceIds.length > 0
            ) {
              const triggerCard =
                options.pendingEffect.relatedInstanceId !== null
                  ? getCardById(
                      options.state,
                      options.pendingEffect.relatedInstanceId
                    )
                  : undefined;
              // ENGINE-targeted-disclosure-offfield-source:
              // ConditionClause.kind:"trigger_related_instance_off_field" 評価用に
              // 対象カードの現在ゾーンを注入する (BSLH01-T14「フィールド以外で発揮中の…」)。
              if (triggerCard !== undefined) {
                triggerContext.relatedInstanceZone = triggerCard.zone;
              }
              const triggerSourceCard =
                triggerSourceInstanceIds.length > 0
                  ? getCardById(options.state, triggerSourceInstanceIds[0]!)
                  : undefined;
              const triggerSourceDef = triggerSourceCard
                ? options.getCardDefinitionById(
                    triggerSourceInstanceIds.length === 1
                      ? (options.pendingEffect.effectSourceDefinitionId ??
                          triggerSourceCard.definitionId)
                      : triggerSourceCard.definitionId
                  )
                : undefined;
              const sourceContextCard = triggerSourceCard ?? triggerCard;
              const sourceContextDef = triggerSourceDef
                ? triggerSourceDef
                : sourceContextCard
                  ? options.getCardDefinitionById(
                      sourceContextCard.definitionId
                    )
                  : undefined;
              if (sourceContextCard && sourceContextDef) {
                triggerContext.sourceColors = getEffectiveColors(
                  options.state,
                  sourceContextCard,
                  sourceContextDef
                );
                // engine-effect-tribe-tag-life-increase-trigger: trigger_source_player
                // 評価用に、原因カードのコントローラーを注入する (BSTH03-X02「自分の」
                // 効果に限定する検証。系統一致だけでは相手の蓬莱タグ付き効果による
                // ライフ増加まで誤検知するため必須)。
                triggerContext.sourcePlayerId =
                  sourceContextCard.controllerPlayerId;
                // BSTH07-転醒R01(A)「このネクサス以外の」等、trigger_tribes.excludeSelfSource
                // 評価用に発生源カードの instanceId を注入する。
                triggerContext.sourceInstanceId = sourceContextCard.instanceId;
                // engine-effect-tribe-tag-life-increase-trigger: trigger_tribes/
                // trigger_source_match 評価用に、原因カードの実効系統 + 効果メタ系統タグ
                // (Effect.effectTribes) を union する (BSTH03-X02)。
                const effectiveTribes = getEffectiveTribes(
                  options.state,
                  sourceContextCard,
                  sourceContextDef,
                  options.getCardDefinitionById
                );
                const tribeGrants = getEffectTribeGrants(
                  options.state,
                  sourceContextCard.instanceId,
                  sourceContextDef,
                  sourceContextCard.controllerPlayerId,
                  options.getCardDefinitionById
                );
                triggerContext.sourceTribes =
                  tribeGrants.length === 0
                    ? effectiveTribes
                    : [
                        ...effectiveTribes,
                        ...tribeGrants.filter(
                          (t) => !effectiveTribes.includes(t)
                        ),
                      ];
              }
            }
            const evaluate = (condition: NonNullable<typeof effectCondition>) =>
              evaluateCondition(
                options.state,
                condition,
                sourceEffectInstanceId ?? sourceCard.instanceId,
                // P3-73: condition の「自分」は効果オーナー (= source 管理者) を指す。
                // game_event の pendingEffect.actingPlayerId はイベント実行者 (相手の
                // フラッシュ使用者) になり得るため、source 管理者を渡す。
                // 既存の card_event / phase / game_event:self では actingPlayerId ===
                // source 管理者のため挙動不変。
                sourceCard.controllerPlayerId,
                options.getCardDefinitionById,
                triggerContext,
                conditionSourceContext
              );
            if (
              options.captureTimingObservers &&
              capturedSource === undefined &&
              sourceEffect?.condition &&
              !isPrivateTriggeredEffectSourceChoice(options.state, sourceChoice)
            )
              eventConditionResults = collectTriggerConditionResults(
                sourceEffect.condition,
                evaluate
              );
            if (!evaluate(effectCondition)) {
              continue;
            }
          }
        }

        if (
          actionRegistration.requiredCoreMoveCost !== undefined &&
          !canPayRequiredEffectCosts(
            options.state,
            sourceCard.controllerPlayerId,
            { requiredCoreMoveCost: actionRegistration.requiredCoreMoveCost },
            options.getCardDefinitionById,
            [],
            triggeredCostGateFilterOptions(options),
            {
              sourceInstanceId: sourceEffectInstanceId ?? sourceCard.instanceId,
              sourceDefinition: sourceEffectDefinition,
              sourceDefinitionId:
                sourceEffectDefinitionId ?? sourceEffectDefinition.cardNo,
              ...(effectIndex !== undefined ? { effectIndex } : {}),
              ...(actionRegistration.preventionLevel !== undefined
                ? { sourcePreventionLevel: actionRegistration.preventionLevel }
                : {}),
              ...(actionRegistration.targetLockBypass !== undefined
                ? {
                    sourceTargetLockBypass: actionRegistration.targetLockBypass,
                    sourcePreventionBypass: actionRegistration.targetLockBypass,
                  }
                : {}),
            }
          )
        ) {
          continue;
        }

        if (selfReferenceRewriteStatus === "blocked") {
          continue;
        }

        sourceChoices.push({
          ...sourceChoice,
          ...(options.captureTimingObservers &&
          !isPrivateTriggeredEffectSourceChoice(options.state, sourceChoice)
            ? { eventConditionResults }
            : {}),
          ...(selfReferenceRewriteStatus === "allowed_optional"
            ? {
                actionRegistration: {
                  ...sourceChoice.actionRegistration,
                  executionMode: "optional" as const,
                },
              }
            : {}),
        });
      }
    }
  }

  return sourceChoices;
}

export function pruneIllegalPendingTriggeredEffects(options: {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}): GameState {
  // lookup を持たない低水準の呼出しでは「不明」を「発揮不能」にしない。
  // 本番の共通出口は登録 lookup を必ず渡す。
  if (typeof options.getRegisteredTriggeredEffectActions !== "function")
    return options.state;
  const state = options.state;
  const scoped = scopeInnermostTriggerReactions(state);
  const immediatePending = [
    ...state.pendingTriggeredEffects,
    ...state.pendingPrivateDeclarations,
    ...state.pendingDeferredTriggeredEffects,
    ...collectPendingStacks(state).flatMap((stack) =>
      stack.triggeredPendingSnapshot ? [stack.triggeredPendingSnapshot] : []
    ),
  ].filter((pending) => getTriggerPriority(pending) === "immediate");
  const awaitsImmediate = (pending: PendingTriggeredEffect) =>
    getTriggerPriority(pending) === "normal" &&
    immediatePending.some((other) =>
      pending.simultaneousGroupId !== undefined
        ? pending.simultaneousGroupId === other.simultaneousGroupId
        : pending.chainId === other.chainId
    );
  const sourceChoices = (
    pendingEffect: PendingTriggeredEffect,
    defer = false
  ) =>
    getAvailableTriggeredEffectSourceChoices({
      ...options,
      pendingEffect,
      ...(defer
        ? {
            deferredConditionSourceKeys:
              pendingEffect.deferredConditionSourceKeys,
          }
        : {}),
    }).filter((choice) =>
      isTriggeredSourceUsageAvailable({ ...options, pendingEffect, choice })
    );
  const prunedPrivate: PendingPrivateDeclaration[] = [];
  const privateKept = state.pendingPrivateDeclarations.filter((declaration) => {
    const pendingEffect: PendingTriggeredEffect = {
      ...declaration,
      resolvedSourceInstanceIds: [],
    };
    const sourceDefinition = options.getCardDefinitionById(
      declaration.sourceDefinitionId
    );
    const available =
      sourceDefinition !== undefined &&
      isPrivateTriggeredDeclarationConditionMet({
        ...options,
        declaration,
        sourceDefinition,
      }) &&
      sourceChoices(pendingEffect).some(
        (choice) =>
          getTriggeredSourceRegistrationInstanceId(choice) ===
            declaration.sourceInstanceId &&
          choice.registrationIndex === declaration.registrationIndex
      );
    if (!available) prunedPrivate.push(declaration);
    return available;
  });
  const pruned: PendingTriggeredEffect[] = [];
  let checkpointChanged = false;
  const kept = state.pendingTriggeredEffects.flatMap((pending) => {
    // 宣言済みは不発を含め通常の解決経路へ渡す。
    if (pending.declaredFromPrivateZone === true) return [pending];
    const deferredKeys = pending.deferredConditionSourceKeys;
    const defer =
      !!deferredKeys?.length &&
      (awaitsImmediate(pending) ||
        !scoped.pendingTriggeredEffects.includes(pending) ||
        hasPendingEffectResolution(state, "body"));
    const choices = pending.mechanic ? [] : sourceChoices(pending, defer);
    const currentChoices =
      defer && !pending.mechanic ? sourceChoices(pending) : choices;
    const availableKeys = new Set(
      currentChoices.map((choice) =>
        makeResolvedTriggeredSourceKey(
          getTriggeredSourceRegistrationInstanceId(choice),
          choice.registrationIndex
        )
      )
    );
    const dormant = pending.dormantSourceRegistrationKeys ?? [];
    const sameTiming = (other: { simultaneousGroupId?: string }) =>
      pending.simultaneousGroupId !== undefined &&
      other.simultaneousGroupId === pending.simultaneousGroupId;
    const timingInProgress =
      defer ||
      currentChoices.length > 0 ||
      privateKept.some(sameTiming) ||
      state.pendingDeferredTriggeredEffects.some(
        (other) =>
          sameTiming(other) &&
          (other.declaredFromPrivateZone === true ||
            sourceChoices(other).length > 0)
      ) ||
      state.battleImmediateEffects.some(sameTiming) ||
      collectPendingStacks(state, { includeFlushGuards: false }).some(
        (stack) =>
          (stack.battleImmediatePromptSnapshot &&
            sameTiming(stack.battleImmediatePromptSnapshot)) ||
          (stack.triggeredPendingSnapshot &&
            sameTiming(stack.triggeredPendingSnapshot) &&
            (stack.triggeredPendingSnapshot.pendingId !== pending.pendingId ||
              !pending.resolvedSourceRegistrationKeys?.includes(
                makeResolvedTriggeredSourceKey(
                  stack.effectSourceInstanceId ?? stack.cardInstanceId,
                  stack.triggeredRegistrationIndex
                )
              )))
      ) ||
      state.pendingTriggeredEffects.some(
        (other) =>
          other !== pending &&
          sameTiming(other) &&
          (other.declaredFromPrivateZone === true ||
            (other.mechanic
              ? getTriggeredMechanicActivationState(
                  state,
                  other.mechanic,
                  options.getCardDefinitionById
                ).canActivate
              : sourceChoices(other).length > 0))
      );
    if (pending.timingSourceRegistrations !== undefined) {
      const remainingDormant = timingInProgress
        ? dormant.filter((key) => !availableKeys.has(key))
        : [];
      const unavailable = Object.keys(pending.timingSourceRegistrations).filter(
        (key) => !availableKeys.has(key) && !remainingDormant.includes(key)
      );
      const resolved = new Set(pending.resolvedSourceRegistrationKeys ?? []);
      const newlyResolved = unavailable.filter((key) => !resolved.has(key));
      if (newlyResolved.length || remainingDormant.length !== dormant.length) {
        pending = {
          ...pending,
          dormantSourceRegistrationKeys: remainingDormant,
          resolvedSourceRegistrationKeys: [...resolved, ...newlyResolved],
          registeredLeaveFieldPreFlushSourceKeys: [
            ...new Set([
              ...(pending.registeredLeaveFieldPreFlushSourceKeys ?? []),
              ...getRegisteredLeaveFieldPreFlushSourceKeys(
                currentChoices,
                pending.eventKind,
                pending.preFlushLeaveEvent
              ),
            ]),
          ],
          registeredLeaveFieldStayOnFieldSourceKeys: [
            ...new Set([
              ...(pending.registeredLeaveFieldStayOnFieldSourceKeys ?? []),
              ...getRegisteredLeaveFieldStayOnFieldSourceKeys(
                currentChoices,
                pending.eventKind
              ),
            ]),
          ],
        };
        checkpointChanged = true;
      }
    }
    if (deferredKeys?.length && !defer) {
      const availableKeys = new Set(
        choices.map((choice) =>
          makeResolvedTriggeredSourceKey(
            getTriggeredSourceRegistrationInstanceId(choice),
            choice.registrationIndex
          )
        )
      );
      const { deferredConditionSourceKeys: _keys, ...checked } = pending;
      pending = {
        ...checked,
        resolvedSourceRegistrationKeys: [
          ...new Set([
            ...(pending.resolvedSourceRegistrationKeys ?? []),
            ...deferredKeys.filter(
              (key) =>
                !availableKeys.has(key) &&
                !pending.dormantSourceRegistrationKeys?.includes(key)
            ),
          ]),
        ],
      };
      checkpointChanged = true;
    }
    const available = pending.mechanic
      ? getTriggeredMechanicActivationState(
          state,
          pending.mechanic,
          options.getCardDefinitionById
        ).canActivate
      : choices.length > 0 ||
        (timingInProgress &&
          (pending.dormantSourceRegistrationKeys?.length ?? 0) > 0);
    if (!available) pruned.push(pending);
    return available ? [pending] : [];
  });
  if (!pruned.length && !prunedPrivate.length && !checkpointChanged)
    return state;
  const sameBucket = (
    a: PendingTriggeredEffect,
    b: PendingPrivateDeclaration
  ) =>
    a.simultaneousGroupId === b.simultaneousGroupId &&
    getTriggerPriority(a) === getTriggerPriority(b);
  // 最後の未宣言 sibling を除去したら、既に宣言した効果の保留を解く。
  const publish = state.pendingDeferredTriggeredEffects.filter(
    (pending) =>
      prunedPrivate.some((declaration) => sameBucket(pending, declaration)) &&
      !privateKept.some((declaration) => sameBucket(pending, declaration))
  );
  const publishedIds = new Set(publish.map((p) => p.pendingId));
  const nextState = {
    ...state,
    pendingTriggeredEffects: [...publish, ...kept],
    pendingPrivateDeclarations: privateKept,
    pendingDeferredTriggeredEffects:
      state.pendingDeferredTriggeredEffects.filter(
        (p) => !publishedIds.has(p.pendingId)
      ),
    log: [
      ...state.log,
      ...pruned.map(
        (p) => `trigger:pruned-illegal:${p.pendingId}:${p.eventKind}`
      ),
      ...prunedPrivate.map(
        (p) => `trigger:private-declaration:pruned-illegal:${p.declarationId}`
      ),
    ],
  };
  // 先行候補や内側の誘発を除去したら、待機していた通常候補を再評価する。
  // 候補が減った場合だけ繰り返し、空の解決操作を同じ呼出し内で取り除く。
  return pruned.length > 0 || prunedPrivate.length > 0
    ? pruneIllegalPendingTriggeredEffects({ ...options, state: nextState })
    : nextState;
}

export function getBurstSourceUseBlockReason(
  actingPlayerId: string,
  sourceKind: EffectSourceKind,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  burstSetCardInstanceIds: ReadonlySet<string>,
  // 手札からの直接バースト発動（裁定 2026-06-16, 10_rules/04b）。
  // true のとき発動源を手札ゾーンに許可し、burst-set 要求を免除する。
  handSource = false
): BurstSourceUseBlockReason | null {
  if (sourceCard.controllerPlayerId !== actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (handSource) {
    // 手札ソースバーストは手札ゾーンの自カードのみ発動可（事前セット不要）。
    if (sourceCard.zone !== "hand") {
      return "source_not_in_burst_zone";
    }
  } else {
    if (sourceCard.zone !== "burst") {
      return "source_not_in_burst_zone";
    }

    if (!burstSetCardInstanceIds.has(sourceCard.instanceId)) {
      return "missing_burst_set_state";
    }
  }

  if (sourceKind === "system") {
    return null;
  }

  if (
    !isCategoryCompatibleWithSourceKind(
      sourceDefinition.printedCategory,
      sourceKind
    )
  ) {
    return "source_kind_category_mismatch";
  }

  return null;
}

/**
 * `require_related_instance_on_field` バーストイベント (attack_after / own_attack 等) で、
 * 関連カード (アタックしたスピリット等) が判定時点でまだフィールドに存在するかを検査する。
 * true = 関連カードが場を離れている (バーストは発動/発揮できない、裁定
 * 04b_burst-rules.md §セット中バーストの追加発動条件)。
 *
 * 宣言可能アクション列挙 (getAvailableBurstSourceChoices) と実解決直前
 * (stack-resolution-core.ts resolveDeferredStackAction) の両方から同一判定を使うための
 * SSOT。旧実装は宣言時のみ検査し、宣言後スタック窓を経て解決に至るまでの間に関連カードが
 * 場を離れた場合を見逃していた (ENGINE-burst-activation-resolution-time-revalidation)。
 */
export function isBurstRelatedInstanceOffField(
  state: GameState,
  pendingBurstCheck: Pick<
    PendingBurstCheck,
    "event" | "eventKind" | "relatedInstanceId"
  >
): boolean {
  const resolvedBurstEvent =
    pendingBurstCheck.event ??
    burstEventKindToStructuredEvent(pendingBurstCheck.eventKind);
  if (
    resolvedBurstEvent.validationMode !== "require_related_instance_on_field" ||
    pendingBurstCheck.relatedInstanceId == null
  ) {
    return false;
  }
  const relatedCard = getCardById(state, pendingBurstCheck.relatedInstanceId);
  return !relatedCard || relatedCard.zone !== "field";
}

export function getAvailableBurstSourceChoices(options: {
  state: GameState;
  pendingBurstCheck: PendingBurstCheck;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBurstActions: BurstActionRegistrationLookup;
}): BurstSourceChoice[] {
  if (
    isBurstRelatedInstanceOffField(options.state, options.pendingBurstCheck)
  ) {
    return [];
  }

  const resolvedBurstCardInstanceIds = new Set(
    options.pendingBurstCheck.resolvedBurstCardInstanceIds
  );
  // 発動宣言済みのカードは、別の条件事象から重ねて宣言できない。
  // 宣言への応答中は setBurstStates に残るため、セット判定だけでは防げない。
  const declaredBurstCardInstanceIds = new Set(
    options.state.revealedBurstStates.map((burst) => burst.cardInstanceId)
  );
  const burstSetCardInstanceIds = new Set(
    options.state.setBurstStates
      .filter(
        (setBurstState) =>
          setBurstState.playerId === options.pendingBurstCheck.actingPlayerId
      )
      .map((setBurstState) => setBurstState.cardInstanceId)
  );
  const sourceChoices: BurstSourceChoice[] = [];

  for (const sourceCard of options.state.cardInstances) {
    if (
      sourceCard.controllerPlayerId !==
        options.pendingBurstCheck.actingPlayerId ||
      resolvedBurstCardInstanceIds.has(sourceCard.instanceId) ||
      declaredBurstCardInstanceIds.has(sourceCard.instanceId)
    ) {
      continue;
    }

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }

    const actionRegistrations =
      options.getRegisteredBurstActions(sourceDefinition.cardNo) ?? [];

    for (const [
      registrationIndex,
      actionRegistration,
    ] of actionRegistrations.entries()) {
      const burstEvent =
        options.pendingBurstCheck.event ??
        burstEventKindToStructuredEvent(options.pendingBurstCheck.eventKind);
      if (
        !matchesTriggerEvent(
          getEffectiveBurstMatcher(actionRegistration),
          burstEvent
        )
      ) {
        continue;
      }

      // P3-67 Phase 1: player フィルタ (whose)。イベント対象プレイヤー
      // (relatedPlayerId) がバースト所有者自身か相手かを厳密に絞る。
      // - self:     relatedPlayerId === 所有者 (自分のライフ減少後 等)
      // - opponent: relatedPlayerId !== 所有者 (相手のアタック後 等)
      if (
        actionRegistration.whose !== undefined &&
        actionRegistration.whose !== "either"
      ) {
        const relatedIsOwner =
          options.pendingBurstCheck.relatedPlayerId ===
          sourceCard.controllerPlayerId;
        if (actionRegistration.whose === "self" && !relatedIsOwner) {
          continue;
        }
        if (actionRegistration.whose === "opponent" && relatedIsOwner) {
          continue;
        }
      }

      // P3-67 Phase 2: triggerFilter。イベント対象カード (relatedInstanceId)
      // が色・系統・カテゴリ条件を満たすか。relatedInstanceId が無いイベント
      // (reduce_life 等) では評価不能のため fail-closed。
      if (
        !summonResponderMatchesCategoryScope(
          options.state,
          {
            eventKind: options.pendingBurstCheck.eventKind,
            relatedInstanceId:
              options.pendingBurstCheck.relatedInstanceId ?? null,
          },
          actionRegistration.triggerFilter
        )
      )
        continue;
      if (actionRegistration.triggerFilter !== undefined) {
        const relatedInstanceId = options.pendingBurstCheck.relatedInstanceId;
        if (relatedInstanceId == null) {
          continue;
        }
        const triggerCard = getCardById(options.state, relatedInstanceId);
        if (!triggerCard) continue;
        const triggerDef = options.getCardDefinitionById(
          triggerCard.definitionId
        );
        if (!triggerDef) continue;
        if (
          !matchesCardReferenceFilter(
            triggerCard,
            triggerDef,
            actionRegistration.triggerFilter,
            {
              soulStateIds: getEffectiveSoulStateIds(
                options.state,
                options.getCardDefinitionById
              ),
              sourceDefinition,
              effectiveColors: getEffectiveColors(
                options.state,
                triggerCard,
                triggerDef
              ),
              ...getCombinedUnitCostFilterOptions(
                options.state,
                triggerCard,
                triggerDef,
                options.getCardDefinitionById
              ),
              effectiveSymbolCount:
                triggerCard.zone === "field"
                  ? getCombinedUnitSymbolCount(
                      options.state,
                      triggerCard,
                      triggerDef,
                      options.getCardDefinitionById
                    )
                  : undefined,
              effectiveLevel:
                triggerCard.zone === "field"
                  ? getEffectiveLevel(
                      options.state,
                      triggerCard,
                      triggerDef,
                      options.getCardDefinitionById
                    )
                  : undefined,
              // 合体ユニット BP を注入 (上記 triggerFilter 経路と同じ SSOT gap 修正)。
              effectiveBp:
                triggerCard.zone === "field"
                  ? getCombinedUnitBp(
                      options.state,
                      triggerCard,
                      triggerDef,
                      options.getCardDefinitionById
                    )
                  : undefined,
              state: options.state,
            }
          )
        ) {
          continue;
        }
      }

      // P3-67: cause フィルタ。「相手によって自分のスピリットが離れた後」等の
      // leave_field 系バーストで、自分効果由来の離脱 (self_effect) や state-based
      // 消滅では発動しないよう絞る。イベントが cause を持たない場合は評価不能のため
      // fail-closed (発動しない)。
      if (
        actionRegistration.cause !== undefined &&
        actionRegistration.cause.length > 0
      ) {
        const eventCause = burstEvent.cause;
        if (eventCause === undefined) {
          continue;
        }
        if (!triggerCauseListMatches(actionRegistration.cause, eventCause)) {
          continue;
        }
      }

      const blockReason = getBurstSourceUseBlockReason(
        options.pendingBurstCheck.actingPlayerId,
        actionRegistration.sourceKind,
        sourceCard,
        sourceDefinition,
        burstSetCardInstanceIds,
        actionRegistration.handSource === true
      );

      if (blockReason !== null) {
        continue;
      }

      // 手札ソースバーストの追加発動条件（カウント閾値等）を発動宣言時に評価する
      // （裁定 2026-06-16, 10_rules/04b §手札からの直接バースト発動: 条件判定は発動宣言時）。
      if (
        actionRegistration.handSource === true &&
        actionRegistration.handSourceCondition !== undefined &&
        actionRegistration.handSourceCondition.length > 0 &&
        !actionRegistration.handSourceCondition.every((clause) =>
          evaluateCondition(
            options.state,
            [clause],
            sourceCard.instanceId,
            sourceCard.controllerPlayerId,
            options.getCardDefinitionById
          )
        )
      ) {
        continue;
      }

      sourceChoices.push({
        sourceCard,
        sourceDefinition,
        sourceKind: actionRegistration.sourceKind,
        registrationIndex,
        actionRegistration,
      });
    }
  }

  return sourceChoices;
}

function getDeltaLogEntries(beforeState: GameState, afterState: GameState) {
  // 同じ配列を共有する状態にはログの追加がない。全履歴を返すと、
  // 差分なしのステップ確認で過去の配置等を再び誘発させてしまう。
  return afterState.log.slice(beforeState.log.length);
}

function collectEffectSummonedInstanceIds(logEntries: readonly string[]) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match = /^effect:summon:([^:]+):/.exec(entry);
    if (match?.[1] && match[1] !== "multi") ids.add(match[1]);
  }
  return ids;
}

function collectSuppressThirdPartySummonInstanceIds(
  logEntries: readonly string[]
) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match = /^effect:summon-suppress-third-party:([^:]+)$/.exec(entry);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function collectSuppressFieldEntryEffectSourceInstanceIds(
  logEntries: readonly string[]
) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match =
      /^effect:field-entry-suppress-triggered-effects:([^:]+)$/.exec(entry);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

/** 入替による場入りは召喚・配置ではない。イベントと神託の両方で同じ判定を使う。 */
export function collectFieldHandSwappedInstanceIds(
  logEntries: readonly string[]
) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match = /^swap_field_hand:.+<->(.+)$/.exec(entry);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

export function collectEffectFieldPlacedInstanceIds(
  logEntries: readonly string[]
) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match = /^effect:field_place:[^:]+:[^:]+:([^:]+)(?::|$)/.exec(entry);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

export function collectEffectFieldPutInstanceIds(
  logEntries: readonly string[]
) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match = /^effect:field_put:[^:]+:[^:]+:([^:]+)(?::|$)/.exec(entry);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function parseEffectEventScope(entry: string): EffectEventScope | undefined {
  const match = /(?:^|:)scope=([^:]+)(?::|$)/.exec(entry);
  return match?.[1] === "genkai" ? "genkai" : undefined;
}

function collectEffectFieldPutScopeByInstanceId(logEntries: readonly string[]) {
  const scopes = new Map<string, EffectEventScope>();
  for (const entry of logEntries) {
    const match = /^effect:field_put:[^:]+:[^:]+:([^:]+)(?::|$)/.exec(entry);
    const scope = parseEffectEventScope(entry);
    if (match?.[1] && scope !== undefined) scopes.set(match[1], scope);
  }
  return scopes;
}

/**
 * engine-move-self-field-departure-leave-trigger (BSAZ02-C06): move_self が pendingLeave
 * 経路を経由せず場を離れたカードの instanceId を、native-action-registry.ts move_self
 * ハンドラが積む `effect:move_self:field_departure:` ログから拾う。destroy/vanish/bounce/
 * remove_from_game のいずれでもない (causeKind 不問の) 汎用 leave_field イベントの生成源。
 */
function collectEffectMoveSelfFieldDepartureInstanceIds(
  logEntries: readonly string[]
) {
  const ids = new Set<string>();
  for (const entry of logEntries) {
    const match = /^effect:move_self:field_departure:([^:]+):/.exec(entry);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function collectEffectSoulDriveActivatedPlayerIds(
  logEntries: readonly string[]
) {
  const playerIds = new Set<string>();
  for (const entry of logEntries) {
    const match = /^effect:core_move:soul_drive_activated:([^:]+)$/.exec(entry);
    if (match?.[1]) playerIds.add(match[1]);
  }
  return playerIds;
}

export function collectTriggerEventsFromStateDelta(options: {
  beforeState: GameState;
  afterState: GameState;
  source: TriggerEventSource;
  chainId?: string | null;
  attackId?: string | null;
  /**
   * P3-68 ギャップ 1: この差分を引き起こした効果のコントローラ (chain acting player)。
   * increase_hand イベントの cause を grower-relative に導出するために使う
   * (controller === 手札が増えたプレイヤー → self_effect / それ以外 → opponent_effect)。
   * 「相手の効果によって相手の手札が増えた後」バーストが、所有者自身のバウンス等で
   * 相手手札が増えた場合に誤発火しないよう絞る。原因未指定を自分の効果と推定しない。
   */
  causedByPlayerId?: string | null;
  /**
   * P3-14 C-2: この差分を引き起こした効果の発揮元カード。
   * core_placed_on_life イベントの relatedInstanceId に載せ、リスナーの
   * trigger_colors 条件 (「自分の黄/紫の効果で」BSTH03-C21) を、source-choice
   * スキャンの既存 TriggerContext 導出 (relatedInstanceId の実効色) で評価可能にする。
   */
  causedBySourceInstanceId?: string | null;
  /**
   * Effect-resolution paths set this for enter_field events caused by an effect.
   * Normal summon/place/advent actions leave this undefined, so `Timing.cause`
   * filters can distinguish "summoned by an effect" from ordinary play.
   */
  enterFieldCausedByPlayerId?: string | null;
  /** 通常プレイの発揮元など、同じ diff 内でも効果由来 cause を付けない場入り。 */
  enterFieldCauseExcludedInstanceIds?: readonly string[];
  /** 煌臨の実際の宣言種別。借用・上書きした煌臨も印字ではなく宣言を参照する。 */
  adventVariant?: "normal" | "contract" | "f_contract";
  /** enter_field event を起こした効果 index。通常召喚/配置では undefined。 */
  sourceEffectIndex?: number;
  /**
   * 転醒 (rebirth) 検出に使用するカード定義ルックアップ。
   * 場の既存カードの definitionId が A 面 → A 面定義の backFace.cardNo へ変化したか
   * (= B 面へ裏返ったか) を判定するために必要。省略時は転醒イベントを emit しない
   * (後方互換: 既存のユニットテストは lookup なしで他イベントのみ検証する)。
   * 煌臨元カードの A 面復帰 (definitionId → originalDefinitionId) を誤検出しないよう、
   * 「変化後の definitionId が変化前定義の backFace.cardNo に一致する front→back 遷移」
   * のみを転醒と判定する。
   */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}): CollectedTriggerEvent[] {
  const events: CollectedTriggerEvent[] = [];
  const deltaLogEntries = getDeltaLogEntries(
    options.beforeState,
    options.afterState
  );
  const effectSummonedInstanceIds =
    collectEffectSummonedInstanceIds(deltaLogEntries);
  const suppressThirdPartySummonInstanceIds =
    collectSuppressThirdPartySummonInstanceIds(deltaLogEntries);
  const suppressFieldEntryEffectSourceInstanceIds =
    collectSuppressFieldEntryEffectSourceInstanceIds(deltaLogEntries);
  const effectFieldPlacedInstanceIds =
    collectEffectFieldPlacedInstanceIds(deltaLogEntries);
  const effectFieldPutInstanceIds =
    collectEffectFieldPutInstanceIds(deltaLogEntries);
  const fieldHandSwappedInstanceIds =
    collectFieldHandSwappedInstanceIds(deltaLogEntries);
  const effectFieldPutScopeByInstanceId =
    collectEffectFieldPutScopeByInstanceId(deltaLogEntries);
  const effectSoulDriveActivatedPlayerIds =
    collectEffectSoulDriveActivatedPlayerIds(deltaLogEntries);
  const handIncreases = collectHandIncreases(
    options.beforeState,
    options.afterState
  );
  const beforePlayerById = new Map(
    options.beforeState.players.map((player) => [player.id, player])
  );
  const getPlayerSoulStateIds = (
    state: GameState,
    playerId: string
  ): Set<string> => {
    const player = state.players.find((p) => p.id === playerId);
    const rawIds = player?.soulStateInstanceIds ?? [];
    return new Set(
      options.getCardDefinitionById
        ? expandWithSoulStateInheritingKeyBraves(
            state,
            rawIds,
            options.getCardDefinitionById
          )
        : rawIds
    );
  };
  const afterCardById = new Map(
    options.afterState.cardInstances.map((cardInstance) => [
      cardInstance.instanceId,
      cardInstance,
    ])
  );
  const beforeCardById = new Map(
    options.beforeState.cardInstances.map((cardInstance) => [
      cardInstance.instanceId,
      cardInstance,
    ])
  );
  const semanticEntryIds = new Set<string>();
  for (const entry of options.afterState.semanticTriggerEvents ?? []) {
    if (entry.delivered) continue;
    if (
      entry.relatedInstanceId === null ||
      isAwaitingEffectEntryCores(options.afterState, entry.relatedInstanceId)
    )
      continue;
    // The operation already happened. Current zone affects responder eligibility,
    // not fact existence/delivery; otherwise a later entry resurrects an old fact.
    const isEntry =
      entry.eventKind === "summon" ||
      entry.eventKind === "place" ||
      entry.eventKind === "put";
    if (isEntry) semanticEntryIds.add(entry.relatedInstanceId);
    const cause =
      entry.cause ??
      (isEntry &&
      options.enterFieldCausedByPlayerId != null &&
      !options.enterFieldCauseExcludedInstanceIds?.includes(
        entry.relatedInstanceId
      )
        ? options.enterFieldCausedByPlayerId === entry.relatedPlayerId
          ? "self_effect"
          : "opponent_effect"
        : undefined);
    events.push({
      ...entry,
      source: options.source,
      chainId: options.chainId ?? entry.chainId,
      attackId: options.attackId ?? entry.attackId,
      ...(cause !== undefined ? { cause } : {}),
      ...(options.causedBySourceInstanceId != null
        ? { effectSourceInstanceId: options.causedBySourceInstanceId }
        : {}),
      ...(options.sourceEffectIndex !== undefined
        ? { sourceEffectIndex: options.sourceEffectIndex }
        : {}),
      ...(entry.eventKind === "summon" &&
      suppressThirdPartySummonInstanceIds.has(entry.relatedInstanceId)
        ? { suppressThirdPartyObservation: true }
        : {}),
      ...(suppressFieldEntryEffectSourceInstanceIds.has(entry.relatedInstanceId)
        ? { suppressedSourceInstanceIds: [entry.relatedInstanceId] }
        : {}),
    });
  }
  const beforePendingLeaveByInstanceId = new Map(
    options.beforeState.pendingLeaveEntities.map((pendingLeave) => [
      pendingLeave.instanceId,
      pendingLeave,
    ])
  );
  const beforePendingLeaveIds = new Set(beforePendingLeaveByInstanceId.keys());
  const afterPendingLeaveIds = new Set(
    options.afterState.pendingLeaveEntities.map(
      (pendingLeave) => pendingLeave.instanceId
    )
  );
  const newPendingLeaves = options.afterState.pendingLeaveEntities.filter(
    (pendingLeave) => {
      const beforePending = beforePendingLeaveByInstanceId.get(
        pendingLeave.instanceId
      );
      return hasPendingLeaveIdentityChanged(beforePending, pendingLeave);
    }
  );
  const pendingLeaveBatchKey = (pendingLeave: PendingLeaveEntity): string =>
    pendingLeave.chainId ?? options.chainId ?? pendingLeave.instanceId;
  // engine-generic-effect-activation-causal-trigger round2 fix: kind を
  // "destroy" に限定せず、suppressDestroyedEffects がタグ付けされた全ての離脱
  // (destroy/vanish/bounce/remove_from_game) をバッチ集約する。
  // executeSuppressPendingLeaveEffects (native-move-core-handlers.ts) 側は
  // kind 非依存でタグ付けするようになったため、ここで destroy に限定すると
  // vanish 等の同一 chain 内複数体同時抑制で suppressedSourceInstanceIds が
  // 自分自身のみにフォールバックし、他の同時抑制対象を含まなくなる。
  const collectSuppressedDestroyedIdsByChain = (
    pendingLeaves: readonly PendingLeaveEntity[]
  ): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const pendingLeave of pendingLeaves) {
      if (
        pendingLeave.blockedByResistance === true ||
        pendingLeave.suppressDestroyedEffects !== "destroyed_only"
      ) {
        continue;
      }
      const chainKey = pendingLeaveBatchKey(pendingLeave);
      const ids = result.get(chainKey) ?? [];
      ids.push(pendingLeave.instanceId);
      result.set(chainKey, ids);
    }
    return result;
  };
  const suppressedDestroyedIdsByChain =
    collectSuppressedDestroyedIdsByChain(newPendingLeaves);
  const beforeSuppressedDestroyedIdsByChain =
    collectSuppressedDestroyedIdsByChain(
      options.beforeState.pendingLeaveEntities
    );

  for (const afterPlayer of options.afterState.players) {
    const beforePlayer = beforePlayerById.get(afterPlayer.id);

    if (!beforePlayer) {
      continue;
    }

    const lifeReducedBy =
      getPlayerLifeCoreCount(beforePlayer) -
      getPlayerLifeCoreCount(afterPlayer);

    // P3-14 C-2: ライフ増加 (「ライフにコアを置いたとき」core_placed_on_life)。
    // relatedInstanceId には原因効果の発揮元カードを載せる (trigger_colors 用)。
    // リスナー不在は queueReactionsInternal の source スキャンで吸収される。
    if (lifeReducedBy < 0) {
      events.push({
        actingPlayerId: afterPlayer.id,
        eventKind: "core_placed_on_life",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterPlayer.id,
        relatedInstanceId: options.causedBySourceInstanceId ?? null,
        amount: -lifeReducedBy,
      });
    }

    // ENGINE-void-core-decrease-trigger: 「ボイドからコアを増やしたとき」
    // (voidNormalCoreCount 減少 = ボイドを起点に他ゾーンへコアが増える)。
    // reduce_life と同型の自己ソース判定 (「相手が相手の効果でボイドからコアを増やした
    // とき」型、BSSL01-C02 effects[0])。ライフ増減と独立のイベントのため、
    // 下の lifeReducedBy<=0 continue より前で判定する。
    const voidReducedBy =
      beforePlayer.voidNormalCoreCount - afterPlayer.voidNormalCoreCount;
    if (voidReducedBy > 0) {
      // ENGINE-void-core-decrease-independent-management-exclusion (2026-08-02,
      // ユーザー確認): 創界神/導界者/創界石は「独立コア管理」(hasIndependentCoreManagement、
      // 08d_grandwalker-nexus.md「汎用コア移動ソース除外」) のため、神託等でボイド→これらの
      // ネクサスへコアが移っても「ボイドからコアを増やした」に数えない。(契約)カウント+N も
      // 「ボイドからカウントエリアへ概念的に移動」(executeCountIncrease が
      // voidNormalCoreCount を直接減算、structured-modifiers.ts) なため同様に除外する。
      // 裁定: 「自分のスピリット/創界神ネクサスにコア1個ずつまで置く」効果でスピリット0個・
      // 創界神1個を選んだ場合、BSSL01-C02 は反応しない。
      const independentCoreManagementGain = options.getCardDefinitionById
        ? options.afterState.cardInstances.reduce((sum, afterCard) => {
            if (afterCard.controllerPlayerId !== afterPlayer.id) return sum;
            const def = options.getCardDefinitionById!(afterCard.definitionId);
            if (!def || !hasIndependentCoreManagement(def)) return sum;
            const beforeCard = beforeCardById.get(afterCard.instanceId);
            const delta =
              afterCard.normalCoreCount - (beforeCard?.normalCoreCount ?? 0);
            return delta > 0 ? sum + delta : sum;
          }, 0)
        : 0;
      const countValueGain = Math.max(
        0,
        afterPlayer.countValue - beforePlayer.countValue
      );
      const genuineVoidReducedBy =
        voidReducedBy - independentCoreManagementGain - countValueGain;

      if (genuineVoidReducedBy > 0) {
        const voidCoreDecreaseCause: TriggerEventCause | undefined =
          options.causedByPlayerId != null
            ? options.causedByPlayerId !== afterPlayer.id
              ? "opponent_effect"
              : "self_effect"
            : undefined;

        events.push({
          actingPlayerId: afterPlayer.id,
          eventKind: "void_core_decrease",
          source: options.source,
          chainId: options.chainId ?? null,
          attackId: options.attackId ?? null,
          relatedPlayerId: afterPlayer.id,
          relatedInstanceId: options.causedBySourceInstanceId ?? null,
          amount: genuineVoidReducedBy,
          ...(voidCoreDecreaseCause !== undefined
            ? { cause: voidCoreDecreaseCause }
            : {}),
        });
      }
    }

    // ENGINE-soul-drive-activation-observable-event (P3-125): 【ソウルドライブ・S】発動
    // コスト（自分のフィールド/リザーブの<ソウルコア>1個を除外）の観測。
    // soulCoreLocation.kind→"removed_from_game" への遷移は
    // handleFieldOrReserveExplicitSoulToRemovedFromGame (structured-core-move.ts、
    // effectKind:"explicit_soul_core") だけが起こす一意な状態変化 (他の soulCoreLocation
    // 遷移先は trash/reserve/life/card のみ)。追加ソウルの count-only 支払いは primary
    // pointer が除外へ遷移しないため、structured-core-move の marker log でも検出する。
    // ライフ/ボイド増減と独立のイベントのため、下の lifeReducedBy<=0 continue より前で判定する。
    const soulDriveActivated =
      (beforePlayer.soulCoreLocation?.kind !== "removed_from_game" &&
        afterPlayer.soulCoreLocation?.kind === "removed_from_game") ||
      effectSoulDriveActivatedPlayerIds.has(afterPlayer.id);
    if (soulDriveActivated) {
      events.push({
        actingPlayerId: afterPlayer.id,
        eventKind: "soul_drive_activated",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterPlayer.id,
        relatedInstanceId: options.causedBySourceInstanceId ?? null,
        amount: null,
        cause: "self_effect",
      });
    }

    if (lifeReducedBy <= 0) {
      continue;
    }

    // count_increase/count_decrease と同型の自己ソース判定 (P3-14 C-2)。
    // 「相手によって自分のライフが減ったとき」型は、cause（battle/effect）に加え
    // `Timing.triggerCausedBy` がこの直接加害者を listener 基準で照合する。battle-actions.ts
    // の実バトル経路は stateBeforeResolution.activePlayerId（アタッカー）を thread 済み。
    // 原因未指定の通常効果は既存の cause 互換を保ち、triggerCausedBy 側で fail-closed になる。
    const reduceLifeCause: TriggerEventCause | undefined =
      options.source === "battle_resolution"
        ? "battle"
        : options.causedByPlayerId != null
          ? options.causedByPlayerId !== afterPlayer.id
            ? "opponent_effect"
            : "self_effect"
          : undefined;

    events.push({
      actingPlayerId: afterPlayer.id,
      eventKind: "reduce_life",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: afterPlayer.id,
      relatedInstanceId: options.causedBySourceInstanceId ?? null,
      amount: lifeReducedBy,
      ...(reduceLifeCause !== undefined ? { cause: reduceLifeCause } : {}),
      ...(options.causedByPlayerId != null
        ? { causedByPlayerId: options.causedByPlayerId }
        : {}),
    });
  }

  for (const pendingLeave of newPendingLeaves) {
    // P3-74 Phase B: cannot_leave_field 耐性で阻止された entries は物理的にフィールドを離れないため、
    // card_destroyed / card_left_field 等の triggered event を emit しない (Q18 維持)。
    // 破壊判定の成立は内包 conditional_result からは参照できるが、別効果 triggered には伝播しない。
    if (pendingLeave.blockedByResistance === true) {
      continue;
    }

    const targetCard = afterCardById.get(pendingLeave.instanceId);

    if (!targetCard) {
      continue;
    }

    const leaveEventKind = pendingLeaveKindToTriggerEventKind(
      pendingLeave.kind
    );

    if (leaveEventKind === null) {
      continue;
    }

    const cause = deriveTriggerEventCauseFromPendingLeave(
      pendingLeave,
      targetCard.controllerPlayerId
    );
    const triggerSourceInstanceIds =
      getPendingLeaveTriggerSourceInstanceIds(pendingLeave);
    const triggerSourceInstanceId = triggerSourceInstanceIds[0];
    // engine-advent-source-leave-summon (BSSG01-C08 Lv2): 「フィールドを離れるとき」
    // の pending leave 境界で、host がまだ underCards を保持している間に煌臨元を捕捉する。
    // flush 後の physical leave_field ではなく、この pre-flush event が正規の参照元。
    const adventSourceInstanceIdsAtPendingLeave = adventSourceIdsOf(targetCard);

    events.push({
      actingPlayerId: targetCard.controllerPlayerId,
      eventKind: leaveEventKind,
      source: options.source,
      chainId: options.chainId ?? pendingLeave.chainId,
      attackId: options.attackId ?? null,
      relatedPlayerId: targetCard.controllerPlayerId,
      relatedInstanceId: targetCard.instanceId,
      amount: null,
      cause,
      // 効果抑制: 発動は通常通り行うが発揮を抑制（resolver スキップで実現）
      ...(pendingLeave.suppressDestroyedEffects === "destroyed_only"
        ? {
            suppressedSourceInstanceIds: suppressedDestroyedIdsByChain.get(
              pendingLeaveBatchKey(pendingLeave)
            ) ?? [pendingLeave.instanceId],
          }
        : {}),
      ...(pendingLeave.suppressDestroyedEffects === "all_opponent"
        ? { effectSuppressed: true }
        : {}),
      // 「系統:Xによってフィールドを離れるとき」型。効果 causal source と実バトル source は
      // PendingLeaveEntity 内で分け、triggerSourceFilter 用イベント source へここでだけ合流させる。
      ...(triggerSourceInstanceId
        ? { effectSourceInstanceId: triggerSourceInstanceId }
        : {}),
      ...(triggerSourceInstanceIds.length > 0
        ? { effectSourceInstanceIds: triggerSourceInstanceIds }
        : {}),
      ...(pendingLeave.causedByEffectSourcePreventionLevel !== undefined
        ? {
            effectSourcePreventionLevel:
              pendingLeave.causedByEffectSourcePreventionLevel,
          }
        : {}),
      ...(adventSourceInstanceIdsAtPendingLeave.length > 0
        ? { adventSourceInstanceIds: adventSourceInstanceIdsAtPendingLeave }
        : {}),
      preFlushLeaveEvent: true,
      ...(pendingLeave.resolvedSourceRegistrationKeys?.length
        ? {
            resolvedSourceRegistrationKeys: [
              ...pendingLeave.resolvedSourceRegistrationKeys,
            ],
          }
        : {}),
    });
  }

  // engine-move-self-field-departure-leave-trigger: move_self (pendingLeave 非経由) で
  // 場を離れたカードは causeKind 不問の汎用 leave_field イベントのみ生成する
  // ("destroy"/"vanish" 等の専用リスナーは対象外、「破壊/消滅」ではないため誤発火させない)。
  const moveSelfFieldDepartureIds =
    collectEffectMoveSelfFieldDepartureInstanceIds(deltaLogEntries);
  for (const instanceId of moveSelfFieldDepartureIds) {
    const targetCard = afterCardById.get(instanceId);
    if (!targetCard || targetCard.zone === "field") {
      continue;
    }
    events.push({
      actingPlayerId: targetCard.controllerPlayerId,
      eventKind: "leave_field",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: targetCard.controllerPlayerId,
      relatedInstanceId: targetCard.instanceId,
      amount: null,
    });
  }

  // トラッシュの純増だけでなく入れ替えも観測する（TR01(A)）。各新規カードを filter に渡す。
  for (const afterCard of options.afterState.cardInstances) {
    if (afterCard.zone !== "trash") continue;
    const beforeCard = beforeCardById.get(afterCard.instanceId);
    if (!beforeCard || beforeCard.zone === "trash") continue;
    events.push({
      actingPlayerId: afterCard.ownerPlayerId,
      eventKind: "trash_increase",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: afterCard.ownerPlayerId,
      relatedInstanceId: afterCard.instanceId,
      fromZone: beforeCard.zone,
      amount: 1,
    });
  }

  // enter_field 検出: before で field 以外 → after で field に移動したカード
  const beforeSoulStateIds = options.getCardDefinitionById
    ? getEffectiveSoulStateIds(
        options.beforeState,
        options.getCardDefinitionById
      )
    : new Set(
        options.beforeState.players.flatMap(
          (player) => player.soulStateInstanceIds
        )
      );
  const afterSoulStateIds = options.getCardDefinitionById
    ? getEffectiveSoulStateIds(
        options.afterState,
        options.getCardDefinitionById
      )
    : new Set(
        options.afterState.players.flatMap(
          (player) => player.soulStateInstanceIds
        )
      );

  // Operation facts above are the only source of brave_combined.
  const afterUnderCardScopes = collectUnderCardScopeIds(options.afterState);
  const afterUnderCardIds = new Set([
    ...afterUnderCardScopes.textRole,
    ...afterUnderCardScopes.adventSource,
  ]);

  // ENGINE-c09-text-role-under-card-third-party-trigger: text_role アンダーカード
  // (【アルドノアドライブ】等) の実配置検出（「〜の下に「X」が置かれたとき」第三者観測）。
  // host (afterCard) の underCards に新規 text_role エントリが増分したら発火する。roleTag の
  // 絞り込みは CardFilter.hasUnderCardRoleTag (triggerFilter) 側で行うため、ここでは
  // role="text_role" の増分をすべて拾う (BSAZ02-C09 初出)。
  for (const afterCard of options.afterState.cardInstances) {
    if (afterCard.zone !== "field") continue;
    const beforeCard = beforeCardById.get(afterCard.instanceId);
    const beforeTextRoleIds = new Set(
      (beforeCard?.underCards ?? [])
        .filter((uc) => uc.role === "text_role")
        .map((uc) => uc.cardInstanceId)
    );
    const hasNewTextRoleUnderCard = afterCard.underCards.some(
      (uc) =>
        uc.role === "text_role" && !beforeTextRoleIds.has(uc.cardInstanceId)
    );
    if (!hasNewTextRoleUnderCard) continue;
    events.push({
      actingPlayerId: afterCard.controllerPlayerId,
      eventKind: "text_role_under_card_placed",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: afterCard.controllerPlayerId,
      relatedInstanceId: afterCard.instanceId,
      amount: null,
    });
  }

  for (const afterCard of options.afterState.cardInstances) {
    if (afterCard.zone !== "field") {
      continue;
    }

    // 効果召喚は維持コア選択のために仮の field 状態を持つ。対象選択から
    // 再開する誘発解決もここを通るので、呼び出し元の finalize guard に頼らず
    // 召喚/配置の未確定対象を除外する。確定時に priorStateSnapshot から収集する。
    if (isAwaitingEffectEntryCores(options.afterState, afterCard.instanceId))
      continue;
    // 下へ加える移動は field の内部表現を使うだけで召喚/配置/煌臨ではない。
    if (afterUnderCardIds.has(afterCard.instanceId)) continue;

    const beforeCard = beforeCardById.get(afterCard.instanceId);
    const isEffectFieldPlacement = effectFieldPlacedInstanceIds.has(
      afterCard.instanceId
    );
    const isEffectFieldPut = effectFieldPutInstanceIds.has(
      afterCard.instanceId
    );
    if (fieldHandSwappedInstanceIds.has(afterCard.instanceId)) continue;

    const isEffectSoulStateSummon =
      beforeCard?.zone === "field" &&
      effectSummonedInstanceIds.has(afterCard.instanceId) &&
      beforeSoulStateIds.has(afterCard.instanceId) &&
      !afterSoulStateIds.has(afterCard.instanceId);

    if (
      !beforeCard ||
      (beforeCard.zone === "field" &&
        !isEffectSoulStateSummon &&
        !isEffectFieldPlacement &&
        !isEffectFieldPut)
    ) {
      continue;
    }

    // Brave summon/combine semantics are issued by their operation, never inferred
    // from field/attachment changes or display logs. Other entry kinds retain
    // their existing delta path until their own operation migration.
    if (
      afterCard.zoneRoleName === "brave" ||
      options.getCardDefinitionById?.(afterCard.definitionId)
        ?.printedCategory === "brave" ||
      semanticEntryIds.has(afterCard.instanceId)
    )
      continue;
    const isEffectEnterField =
      isEffectFieldPlacement ||
      isEffectFieldPut ||
      effectSummonedInstanceIds.has(afterCard.instanceId);
    const enterFieldEventKind: TriggerEventKind | null = isEffectFieldPut
      ? "put"
      : isEffectFieldPlacement
        ? "place"
        : effectSummonedInstanceIds.has(afterCard.instanceId)
          ? "summon"
          : afterCard.zoneRoleName === "spirit" ||
              afterCard.zoneRoleName === "ultimate"
            ? adventSourceIdsOf(afterCard).length > 0 &&
              (!beforeCard || adventSourceIdsOf(beforeCard).length === 0)
              ? "advent"
              : "summon"
            : afterCard.zoneRoleName === "nexus"
              ? "place"
              : null;
    const effectScope = isEffectFieldPut
      ? effectFieldPutScopeByInstanceId.get(afterCard.instanceId)
      : enterFieldEventKind === "advent" && options.adventVariant === "contract"
        ? ("contract_advent" as const)
        : enterFieldEventKind === "advent" &&
            options.adventVariant === "f_contract"
          ? ("f_contract_advent" as const)
          : undefined;

    if (enterFieldEventKind !== null) {
      const isEnterFieldCauseExcluded =
        options.enterFieldCauseExcludedInstanceIds?.includes(
          afterCard.instanceId
        ) ?? false;
      const enterFieldCause =
        options.enterFieldCausedByPlayerId !== undefined &&
        options.enterFieldCausedByPlayerId !== null &&
        isEffectEnterField &&
        !isEnterFieldCauseExcluded
          ? options.enterFieldCausedByPlayerId === afterCard.controllerPlayerId
            ? ("self_effect" as const)
            : ("opponent_effect" as const)
          : undefined;
      events.push({
        actingPlayerId: afterCard.controllerPlayerId,
        eventKind: enterFieldEventKind,
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterCard.controllerPlayerId,
        relatedInstanceId: afterCard.instanceId,
        amount: null,
        ...(enterFieldCause !== undefined ? { cause: enterFieldCause } : {}),
        ...(options.causedBySourceInstanceId != null
          ? { effectSourceInstanceId: options.causedBySourceInstanceId }
          : {}),
        ...(options.sourceEffectIndex !== undefined
          ? { sourceEffectIndex: options.sourceEffectIndex }
          : {}),
        ...(effectScope !== undefined ? { effectScope } : {}),
        // 「手札から召喚したとき」等の発生源ゾーン判別 (trigger_from_zone) 用に
        // in_useは中間ゾーンなので、記録された実際の元ゾーンを使う。
        fromZone: getCardUseSourceZone(beforeCard),
        ...(enterFieldEventKind === "summon" &&
        suppressThirdPartySummonInstanceIds.has(afterCard.instanceId)
          ? { suppressThirdPartyObservation: true }
          : {}),
        ...(suppressFieldEntryEffectSourceInstanceIds.has(afterCard.instanceId)
          ? { suppressedSourceInstanceIds: [afterCard.instanceId] }
          : {}),
      });
    }
  }

  // direct field leave 検出: move_self / 特殊な入れ替え等で pending leave を経由せず
  // field から移動済みのカードは、post physical leave の leave_field として扱う。
  // pending leave 由来の通常 flush は下の card_left_field 検出が拾うため、重複を避ける。
  const directLeaveDestinationZones = new Set<Zone>([
    "hand",
    "deck",
    "trash",
    "set_aside",
    "removed_from_game",
  ]);
  for (const beforeCard of options.beforeState.cardInstances) {
    if (beforeCard.zone !== "field") {
      continue;
    }
    if (beforePendingLeaveIds.has(beforeCard.instanceId)) {
      continue;
    }
    if (afterPendingLeaveIds.has(beforeCard.instanceId)) {
      continue;
    }

    const afterCard = afterCardById.get(beforeCard.instanceId);
    if (!afterCard || !directLeaveDestinationZones.has(afterCard.zone)) {
      continue;
    }

    // Q367: a separated brave lacking Lv1 cores goes straight to trash,
    // without becoming a spirit or producing leave effects. Only this physical
    // departure is excluded; an earlier discard must not mask a later leave.
    const beforeGeneration = beforeCard.fieldInstanceGeneration ?? 0;
    const afterGeneration = afterCard.fieldInstanceGeneration ?? 0;
    if (
      afterCard.zone === "trash" &&
      afterGeneration === beforeGeneration + 1 &&
      deltaLogEntries.includes(
        `sba:brave-rule-discard:${JSON.stringify([beforeCard.instanceId, afterGeneration])}`
      )
    ) {
      continue;
    }

    const cause = deriveTriggerEventCauseFromEffectController(
      options.causedByPlayerId,
      beforeCard.controllerPlayerId
    );
    events.push({
      actingPlayerId: beforeCard.controllerPlayerId,
      eventKind: "leave_field",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: beforeCard.controllerPlayerId,
      relatedInstanceId: beforeCard.instanceId,
      amount: null,
      ...(cause !== undefined ? { cause } : {}),
    });
  }

  // card_left_field 検出: before で pending leave 済みのカードが、
  // after で field 以外に移動した場合に発火する「離れたとき」誘発。
  // pending leave に入った時点で card_destroyed/vanished/bounced (離れるとき) が
  // 既に発火済みなので、card_left_field は flush 後の実離脱時のみ発火する。
  for (const pendingLeaveId of beforePendingLeaveIds) {
    const beforeCard = getCardById(options.beforeState, pendingLeaveId);
    if (!beforeCard || beforeCard.zone !== "field") {
      continue;
    }

    const afterCard = afterCardById.get(pendingLeaveId);

    // after で field 以外に移動した (flush された)
    if (afterCard && afterCard.zone !== "field") {
      const beforePending = beforePendingLeaveByInstanceId.get(pendingLeaveId);
      const preFlushQueuedSourceRegistrationKeys = [
        ...new Set([
          ...(beforePending?.resolvedSourceRegistrationKeys ?? []),
          ...getPreFlushQueuedSourceRegistrationKeysForPhysicalLeave(
            options.afterState,
            pendingLeaveId
          ),
        ]),
      ];
      const cause = beforePending
        ? deriveTriggerEventCauseFromPendingLeave(
            beforePending,
            beforeCard.controllerPlayerId
          )
        : undefined;
      const triggerSourceInstanceIds = beforePending
        ? getPendingLeaveTriggerSourceInstanceIds(beforePending)
        : [];
      const triggerSourceInstanceId = triggerSourceInstanceIds[0];
      // Physical `leave_field` snapshot for true 「離れたとき」 consumers.
      // BSSG01-C08 Lv2 uses the pre-flush pendingLeave snapshot above instead.
      const adventSourceInstanceIdsAtLeave = adventSourceIdsOf(beforeCard);
      events.push({
        actingPlayerId: beforeCard.controllerPlayerId,
        eventKind: "leave_field",
        // 待機入りですでに発動宣言済み。実移動では再宣言しない (Q480)。
        ...(beforePending ? { suppressBurstCheck: true } : {}),
        source: options.source,
        chainId: options.chainId ?? beforePending?.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: beforeCard.controllerPlayerId,
        relatedInstanceId: beforeCard.instanceId,
        amount: null,
        ...(cause !== undefined ? { cause } : {}),
        ...(adventSourceInstanceIdsAtLeave.length > 0
          ? { adventSourceInstanceIds: adventSourceInstanceIdsAtLeave }
          : {}),
        ...(beforePending?.suppressDestroyedEffects === "destroyed_only"
          ? {
              suppressedSourceInstanceIds:
                beforeSuppressedDestroyedIdsByChain.get(
                  pendingLeaveBatchKey(beforePending)
                ) ?? [beforeCard.instanceId],
            }
          : {}),
        ...(beforePending?.suppressDestroyedEffects === "all_opponent"
          ? { effectSuppressed: true }
          : {}),
        ...(triggerSourceInstanceId
          ? { effectSourceInstanceId: triggerSourceInstanceId }
          : {}),
        ...(triggerSourceInstanceIds.length > 0
          ? { effectSourceInstanceIds: triggerSourceInstanceIds }
          : {}),
        ...(preFlushQueuedSourceRegistrationKeys.length > 0
          ? {
              resolvedSourceRegistrationKeys:
                preFlushQueuedSourceRegistrationKeys,
            }
          : {}),
      });
    }
  }

  // card_exhausted / card_recovered 検出:
  // フィールド上のカードの exhaustState が疲労方向 / 回復方向に変化した場合
  for (const afterCard of options.afterState.cardInstances) {
    if (afterCard.zone !== "field") {
      continue;
    }

    const beforeCard = beforeCardById.get(afterCard.instanceId);

    if (!beforeCard || beforeCard.zone !== "field") {
      continue;
    }

    // 魂状態に疲労/回復の区別はなく、魂状態化・復帰時の中立値への変更は
    // 疲労/回復イベントではない。魂状態を引き継ぐ合体子も同じ扱い。
    if (
      beforeSoulStateIds.has(afterCard.instanceId) ||
      afterSoulStateIds.has(afterCard.instanceId)
    )
      continue;

    // 合体子の疲労値はホストからの派生値。合体を維持した同期では
    // 独立した疲労/回復イベントを作らず、合体スピリットの1回だけを観測する。
    if (
      isAttachedCombinedChild(options.beforeState, beforeCard) &&
      isAttachedCombinedChild(options.afterState, afterCard)
    )
      continue;

    const becameMoreExhausted =
      (beforeCard.exhaustState === "recovered" &&
        (afterCard.exhaustState === "exhausted" ||
          afterCard.exhaustState === "heavily_exhausted")) ||
      (beforeCard.exhaustState === "exhausted" &&
        afterCard.exhaustState === "heavily_exhausted");

    if (becameMoreExhausted) {
      // engine-exhaust-provenance-skip-refresh (BSLH01-C04): 「自分の系統X(効果)によって
      // 相手のカードが疲労したとき」型 (BSDB01-CX01 leave_field 型と同型) を表現可能にする。
      // options.causedByPlayerId/causedBySourceInstanceId は finalizeEffectResolution が
      // 効果解決ごとに常時スレッドする値 (効果の発揮元コントローラ/カード) なので、
      // 追加の provenance ストレージなしでそのまま cause/effectSourceInstanceId へ転写できる。
      const cause = deriveTriggerEventCauseFromEffectController(
        options.causedByPlayerId,
        afterCard.controllerPlayerId
      );
      events.push({
        actingPlayerId: afterCard.controllerPlayerId,
        eventKind: "exhaust",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterCard.controllerPlayerId,
        relatedInstanceId: afterCard.instanceId,
        amount: null,
        ...(cause !== undefined ? { cause } : {}),
        ...(options.causedBySourceInstanceId
          ? { effectSourceInstanceId: options.causedBySourceInstanceId }
          : {}),
      });
    }

    const becameMoreRecovered =
      (beforeCard.exhaustState === "exhausted" &&
        afterCard.exhaustState === "recovered") ||
      (beforeCard.exhaustState === "heavily_exhausted" &&
        (afterCard.exhaustState === "exhausted" ||
          afterCard.exhaustState === "recovered"));

    if (becameMoreRecovered) {
      events.push({
        actingPlayerId: afterCard.controllerPlayerId,
        eventKind: "recover",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterCard.controllerPlayerId,
        relatedInstanceId: afterCard.instanceId,
        amount: null,
      });
    }
  }

  // rebirth (転醒) 検出: 場の既存カードが A 面 → B 面へ裏返ったとき、B 面の『転醒時』
  // (card_event:"rebirth") 効果を誘発する。executeRebirth は card.definitionId を
  // A 面 → backFace.cardNo へ swap するだけ (zone は field のまま、originalDefinitionId は
  // A 面のまま維持) なので、enter_field / leave_field のどちらにも該当しない。
  // 煌臨元カードの A 面復帰 (definitionId → originalDefinitionId) を誤検出しないよう、
  // 「変化前の定義がダブルフェイスで、変化後 definitionId がその backFace.cardNo に一致する
  // front→back 遷移」のみを転醒と判定する (B→A の復帰は before 定義が back face なので
  // isDoubleSided=false で弾かれる)。lookup 未提供時 (一部ユニットテスト) は検出をスキップ。
  if (options.getCardDefinitionById) {
    for (const afterCard of options.afterState.cardInstances) {
      if (afterCard.zone !== "field") {
        continue;
      }

      const beforeCard = beforeCardById.get(afterCard.instanceId);

      if (!beforeCard || beforeCard.zone !== "field") {
        continue;
      }

      if (beforeCard.definitionId === afterCard.definitionId) {
        continue;
      }

      const beforeDef = options.getCardDefinitionById(beforeCard.definitionId);
      if (
        !beforeDef?.isDoubleSided ||
        !beforeDef.backFace ||
        beforeDef.backFace.cardNo === undefined ||
        beforeDef.backFace.cardNo !== afterCard.definitionId
      ) {
        continue;
      }

      const rebirthLvDeficitChainId = `effect:rebirth:${afterCard.instanceId}:lv-deficit`;
      const interruptedByMinimumCoreDeficit =
        (afterCard.pendingLeaveKind === "vanish" &&
          afterCard.pendingLeaveChainId === rebirthLvDeficitChainId) ||
        options.afterState.pendingLeaveEntities.some(
          (pendingLeave) =>
            pendingLeave.instanceId === afterCard.instanceId &&
            pendingLeave.kind === "vanish" &&
            pendingLeave.chainId === rebirthLvDeficitChainId
        );
      if (interruptedByMinimumCoreDeficit) {
        continue;
      }

      events.push({
        actingPlayerId: afterCard.controllerPlayerId,
        eventKind: "rebirth",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterCard.controllerPlayerId,
        relatedInstanceId: afterCard.instanceId,
        amount: null,
      });
    }
  }

  // hand_increase 検出: プレイヤーの手札が増加した場合
  for (const increase of handIncreases) {
    const beforePlayer = beforePlayerById.get(increase.playerId);

    if (!beforePlayer) {
      continue;
    }

    const handIncreasedBy = increase.amount;

    if (handIncreasedBy <= 0) {
      continue;
    }

    // P3-68 ギャップ 1: grower-relative cause。手札が増えたプレイヤー自身の効果で
    // 増えたなら self_effect、別プレイヤー (例: 相手のバウンスで手札に戻った) なら
    // opponent_effect。原因未指定の通常ドロー等は効果と判定しない。
    const handIncreaseCausePlayerId =
      increase.source?.playerId ??
      options.causedByPlayerId ??
      getPendingHandReturnEffectPlayerId(
        options.beforeState,
        options.afterState,
        increase.playerId
      );
    const handIncreaseCause: TriggerEventCause =
      handIncreaseCausePlayerId == null
        ? "state_based"
        : handIncreaseCausePlayerId !== increase.playerId
          ? "opponent_effect"
          : "self_effect";

    events.push({
      actingPlayerId: increase.playerId,
      eventKind: "increase_hand",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: increase.playerId,
      // ENGINE-triggered-hand-zone-immunity: count_increase/reduce_life と同型
      // (grower-relative cause と対称)。relatedInstanceId に増加を引き起こした効果の
      // 発揮元カードを載せ、trigger_tribes/trigger_source_player 評価を可能にする
      // (BSTH07-転醒X02(A)「自分が系統：「星蓮」/「闘神」を持つ効果で手札を増やしたとき」)。
      relatedInstanceId:
        increase.source?.sourceInstanceId ??
        options.causedBySourceInstanceId ??
        null,
      ...(increase.source?.sourceDefinitionId
        ? {
            effectSourceInstanceId: increase.source.sourceInstanceId,
            effectSourceDefinitionId: increase.source.sourceDefinitionId,
          }
        : {}),
      amount: handIncreasedBy,
      cause: handIncreaseCause,
    });
  }

  // count_increase 検出: プレイヤーの(契約)カウントが増加した場合。
  // increase_hand と同型 (grower-relative cause)。countValue は PlayerState 値だが、
  // relatedInstanceId には causedBySourceInstanceId (=この差分を引き起こした効果の
  // 発揮元カード) を載せ、requireTriggerSelf / excludeTriggerSelf の自己ソース判定
  // (BSTS01-CX01[5,6,7]「この『リムル』の効果で自分のカウントが増えたとき」)を可能にする。
  // life_reduce 同型 (L1953)。リスナー無し時は queue で drop される。
  for (const afterPlayer of options.afterState.players) {
    const beforePlayer = beforePlayerById.get(afterPlayer.id);

    if (!beforePlayer) {
      continue;
    }

    const countIncreasedBy = afterPlayer.countValue - beforePlayer.countValue;

    if (countIncreasedBy <= 0) {
      continue;
    }

    const countIncreaseCause: TriggerEventCause =
      options.causedByPlayerId != null &&
      options.causedByPlayerId !== afterPlayer.id
        ? "opponent_effect"
        : "self_effect";

    events.push({
      actingPlayerId: afterPlayer.id,
      eventKind: "count_increase",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: afterPlayer.id,
      relatedInstanceId: options.causedBySourceInstanceId ?? null,
      amount: countIncreasedBy,
      cause: countIncreaseCause,
    });
  }

  // count_decrease 検出: count_increase の対称版（自己ソース判定も同様に対応する）。
  for (const afterPlayer of options.afterState.players) {
    const beforePlayer = beforePlayerById.get(afterPlayer.id);

    if (!beforePlayer) {
      continue;
    }

    const countDecreasedBy = beforePlayer.countValue - afterPlayer.countValue;

    if (countDecreasedBy <= 0) {
      continue;
    }

    const countDecreaseCause: TriggerEventCause =
      options.causedByPlayerId != null &&
      options.causedByPlayerId !== afterPlayer.id
        ? "opponent_effect"
        : "self_effect";

    events.push({
      actingPlayerId: afterPlayer.id,
      eventKind: "count_decrease",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: afterPlayer.id,
      relatedInstanceId: options.causedBySourceInstanceId ?? null,
      amount: countDecreasedBy,
      cause: countDecreaseCause,
    });
  }

  // F2 enter_soul_state 検出: 新たに魂状態になったカード（ENIGMA「魂状態になったとき」）。
  // relatedInstanceId=該当カード（card_event 自己誘発）。リスナー無し時は queue で drop。
  for (const afterPlayer of options.afterState.players) {
    const beforePlayer = beforePlayerById.get(afterPlayer.id);
    if (!beforePlayer) continue;
    const beforeSoul = getPlayerSoulStateIds(
      options.beforeState,
      afterPlayer.id
    );
    const afterSoul = getPlayerSoulStateIds(options.afterState, afterPlayer.id);
    for (const id of afterSoul) {
      if (beforeSoul.has(id)) continue;
      // fromZone: 魂状態化直前の zone。BurstTrigger.enter_soul_state (BSGE01-M04) が
      // 「フィールドを離れた…が魂状態になった」(field-exit-replacement 経由、zone は
      // "field" のまま不変) と「手札/手元から直接魂状態化」(BSLH01-CX01 activate_soul_state、
      // hand/set_aside→field へ zone が変わる) を区別するために使う (card_event 側の
      // 自己誘発 (BSLH01-CX01「このカードが魂状態になったとき」) は fromZone を問わず従来通り発火)。
      const beforeCard = options.beforeState.cardInstances.find(
        (c) => c.instanceId === id
      );
      events.push({
        actingPlayerId: afterPlayer.id,
        eventKind: "enter_soul_state",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterPlayer.id,
        relatedInstanceId: id,
        amount: null,
        cause: "self_effect",
        ...(beforeCard ? { fromZone: beforeCard.zone } : {}),
      });
    }
  }

  // F2 soul_state_to_spirit_state 検出: 魂状態からスピリット状態になったカード。
  // 合体処理でも soulStateInstanceIds から外れるが、その場合は attachedToInstanceId が
  // 入るため除外し、未合体の field 上に残った state-change だけを拾う。
  for (const afterPlayer of options.afterState.players) {
    const beforePlayer = beforePlayerById.get(afterPlayer.id);
    if (!beforePlayer) continue;
    const beforeSoul = getPlayerSoulStateIds(
      options.beforeState,
      afterPlayer.id
    );
    const afterSoul = getPlayerSoulStateIds(options.afterState, afterPlayer.id);
    for (const id of beforeSoul) {
      if (afterSoul.has(id)) continue;
      const afterCard = afterCardById.get(id);
      if (
        !afterCard ||
        afterCard.zone !== "field" ||
        afterCard.attachedToInstanceId !== null ||
        afterCard.pendingLeaveKind !== null
      ) {
        continue;
      }
      events.push({
        actingPlayerId: afterPlayer.id,
        eventKind: "soul_state_to_spirit_state",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: afterPlayer.id,
        relatedInstanceId: id,
        amount: null,
        cause: "self_effect",
      });
    }
  }

  // F2 quartz_set 検出: 新たにセットされたクォーツ（ENIGMA「クォーツがセットされたとき」）。
  // player 値ルーティング (relatedPlayerId=owner)。リスナー無し時は queue で drop。
  {
    const beforeQuartz = new Set(
      (options.beforeState.quartzSetStates ?? []).map((q) => q.quartzInstanceId)
    );
    for (const q of options.afterState.quartzSetStates ?? []) {
      if (beforeQuartz.has(q.quartzInstanceId)) continue;
      events.push({
        actingPlayerId: q.ownerPlayerId,
        eventKind: "quartz_set",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: q.ownerPlayerId,
        relatedInstanceId: q.quartzInstanceId,
        amount: null,
        cause: "self_effect",
      });
    }
  }

  // ENGINE-mirage-set-card-event-trigger: 新たにセットされたミラージュ
  // （「このカードのセット時」card_event 自己誘発）。relatedInstanceId=セットされたカード。
  // リスナー無し時は queue で drop (quartz_set 同様)。
  {
    const beforeMirage = new Set(
      (options.beforeState.mirageSetStates ?? []).map((m) => m.cardInstanceId)
    );
    for (const m of options.afterState.mirageSetStates ?? []) {
      if (beforeMirage.has(m.cardInstanceId)) continue;
      events.push({
        actingPlayerId: m.playerId,
        eventKind: "mirage_set",
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        relatedPlayerId: m.playerId,
        relatedInstanceId: m.cardInstanceId,
        amount: null,
        cause: "self_effect",
      });
    }
  }

  // after_draw 検出: 効果ドローで pendingDrawEvents に記録されたものをイベント化。
  // 同じ収集境界内の複数 draw step は「ドローしたとき」1 回として扱い、
  // 「1枚につき」系が参照できるよう amount に合算枚数を残す。
  // 対象はドローしたプレイヤー。原因カードは effectSourceInstanceId で別に運ぶ。
  const pendingDrawAmountByPlayerId = new Map<string, number>();
  for (const drawEvent of options.afterState.pendingDrawEvents ?? []) {
    pendingDrawAmountByPlayerId.set(
      drawEvent.playerId,
      (pendingDrawAmountByPlayerId.get(drawEvent.playerId) ?? 0) +
        drawEvent.amount
    );
  }
  for (const [playerId, amount] of pendingDrawAmountByPlayerId.entries()) {
    if (amount <= 0) continue;
    events.push({
      actingPlayerId: playerId,
      eventKind: "after_draw",
      source: options.source,
      chainId: options.chainId ?? null,
      attackId: options.attackId ?? null,
      relatedPlayerId: playerId,
      relatedInstanceId: null,
      ...(options.causedBySourceInstanceId != null
        ? { effectSourceInstanceId: options.causedBySourceInstanceId }
        : {}),
      amount,
      step: options.afterState.step,
    });
  }

  return events;
}

/**
 * P3-36 Phase A: pendingPrivateDeclarations を「非ターンプレイヤー先頭・同一プレイヤー内挿入順」
 * の順に並べ直す stable sort。
 *
 * 公式裁定（2026-05-02）に基づき、両者誘発の private declaration は非ターンプレイヤーが先に
 * 「発揮する/しない」を決定する。`queuePendingReactionsFromTriggerEvents` から呼ぶほか、
 * 不変条件チェックや state migration からも参照する。
 */
export function sortPendingPrivateDeclarationsByTurnPriority(
  declarations: readonly PendingPrivateDeclaration[],
  turnPlayerId: string
): PendingPrivateDeclaration[] {
  return declarations
    .map((decl, index) => ({ decl, index }))
    .sort((a, b) => {
      const aIsTurn = a.decl.ownerPlayerId === turnPlayerId ? 1 : 0;
      const bIsTurn = b.decl.ownerPlayerId === turnPlayerId ? 1 : 0;
      if (aIsTurn !== bIsTurn) return aIsTurn - bIsTurn;
      return a.index - b.index;
    })
    .map((entry) => entry.decl);
}

/**
 * P3-36 Phase A: pendingPrivateDeclarations が turn-priority sort 順に並んでいるか検証する。
 * 不変条件 assert / invariants check で利用する。
 */
export function isPendingPrivateDeclarationsSortedByTurnPriority(
  declarations: readonly PendingPrivateDeclaration[],
  turnPlayerId: string
): boolean {
  let seenTurn = false;
  for (const decl of declarations) {
    const isTurn = decl.ownerPlayerId === turnPlayerId;
    if (!isTurn && seenTurn) return false;
    if (isTurn) seenTurn = true;
  }
  return true;
}

type EffectEnterFieldEventIdentity = {
  eventKind: TriggerEventKind | BurstEventKind;
  source: TriggerEventSource;
  chainId: string | null;
  attackId: string | null;
  actingPlayerId?: string | null | undefined;
  relatedPlayerId: string | null;
  relatedInstanceId: string | null | undefined;
  amount: number | null;
  cause?: TriggerEventCause | undefined;
  causedByPlayerId?: string | undefined;
  fromZone?: Zone | undefined;
  step?: StructuredTriggerEvent["step"] | undefined;
  subPhase?: StructuredTriggerEvent["subPhase"] | undefined;
  actionKind?: StructuredTriggerEventActionKind | undefined;
  sourceEffectIndex?: number | undefined;
  effectScope?: EffectEventScope | undefined;
};

function isEffectEnterFieldEvent(event: CollectedTriggerEvent): boolean {
  return (
    (event.eventKind === "summon" ||
      event.eventKind === "place" ||
      event.eventKind === "put" ||
      event.eventKind === "advent") &&
    (event.cause === "self_effect" || event.cause === "opponent_effect")
  );
}

function isChainDedupeEvent(event: CollectedTriggerEvent): boolean {
  return (
    isEffectEnterFieldEvent(event) ||
    event.eventKind === "destroy" ||
    event.eventKind === "vanish" ||
    event.eventKind === "bounce" ||
    event.eventKind === "remove_from_game" ||
    event.eventKind === "leave_field"
  );
}

function getStructuredEventStep(
  event: StructuredTriggerEvent | undefined
): StructuredTriggerEvent["step"] | undefined {
  return event && "step" in event ? event.step : undefined;
}

function getStructuredEventSubPhase(
  event: StructuredTriggerEvent | undefined
): StructuredTriggerEvent["subPhase"] | undefined {
  return event && "subPhase" in event ? event.subPhase : undefined;
}

function getStructuredEventActionKind(
  event: StructuredTriggerEvent | undefined
): StructuredTriggerEventActionKind | undefined {
  return event && "actionKind" in event ? event.actionKind : undefined;
}

function enterFieldChainIdsMatch(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.startsWith(`${b}:after_triggers:`) || b.startsWith(`${a}:after_triggers:`)
  );
}

function identitiesMatch(
  a: EffectEnterFieldEventIdentity,
  b: EffectEnterFieldEventIdentity
): boolean {
  return (
    a.eventKind === b.eventKind &&
    a.source === b.source &&
    enterFieldChainIdsMatch(a.chainId, b.chainId) &&
    a.attackId === b.attackId &&
    (a.actingPlayerId === undefined ||
      b.actingPlayerId === undefined ||
      a.actingPlayerId === b.actingPlayerId) &&
    a.relatedPlayerId === b.relatedPlayerId &&
    a.relatedInstanceId === b.relatedInstanceId &&
    a.amount === b.amount &&
    a.cause === b.cause &&
    a.causedByPlayerId === b.causedByPlayerId &&
    (a.fromZone === undefined ||
      b.fromZone === undefined ||
      a.fromZone === b.fromZone) &&
    a.step === b.step &&
    a.subPhase === b.subPhase &&
    a.actionKind === b.actionKind &&
    a.sourceEffectIndex === b.sourceEffectIndex &&
    a.effectScope === b.effectScope
  );
}

function collectedEventIdentity(
  event: CollectedTriggerEvent,
  eventActionKind: StructuredTriggerEventActionKind | undefined
): EffectEnterFieldEventIdentity {
  return {
    eventKind: event.eventKind,
    source: event.source,
    chainId: event.chainId,
    attackId: event.attackId,
    actingPlayerId: event.actingPlayerId,
    relatedPlayerId: event.relatedPlayerId,
    relatedInstanceId: event.relatedInstanceId,
    amount: event.amount,
    cause: event.cause,
    causedByPlayerId: event.causedByPlayerId,
    fromZone: event.fromZone,
    step: event.step,
    subPhase: event.subPhase,
    actionKind: eventActionKind,
    sourceEffectIndex: event.sourceEffectIndex,
    effectScope: event.effectScope,
  };
}

function collectedBurstEventIdentity(
  event: CollectedTriggerEvent,
  eventActionKind: StructuredTriggerEventActionKind | undefined
): EffectEnterFieldEventIdentity | null {
  const burst = mapTriggerEventToBurstCheck(event);
  if (burst === null) return null;
  return {
    eventKind: burst.burstEventKind,
    source: event.source,
    chainId: event.chainId,
    attackId: event.attackId,
    relatedPlayerId: burst.relatedPlayerId,
    relatedInstanceId: event.relatedInstanceId,
    amount:
      burst.burstEventKind === "summon" || burst.burstEventKind === "place"
        ? null
        : burst.amount,
    cause: event.cause,
    causedByPlayerId: event.causedByPlayerId,
    fromZone: event.fromZone,
    step: event.step,
    subPhase: event.subPhase,
    actionKind: eventActionKind,
    sourceEffectIndex: event.sourceEffectIndex,
    effectScope: event.effectScope,
  };
}

function pendingTriggeredIdentity(
  pending: PendingTriggeredEffect
): EffectEnterFieldEventIdentity {
  return {
    eventKind: pending.eventKind,
    source: pending.source,
    chainId: pending.chainId,
    attackId: pending.attackId,
    actingPlayerId: pending.actingPlayerId,
    relatedPlayerId: pending.relatedPlayerId,
    relatedInstanceId: pending.relatedInstanceId,
    amount: pending.amount,
    cause: pending.cause,
    causedByPlayerId: pending.causedByPlayerId,
    fromZone: pending.fromZone,
    step: getStructuredEventStep(pending.event),
    subPhase: getStructuredEventSubPhase(pending.event),
    actionKind: getStructuredEventActionKind(pending.event),
    sourceEffectIndex: pending.sourceEffectIndex,
    effectScope: pending.effectScope,
  };
}

function pendingPrivateIdentity(
  pending: PendingPrivateDeclaration
): EffectEnterFieldEventIdentity {
  return {
    eventKind: pending.eventKind,
    source: pending.source,
    chainId: pending.chainId,
    attackId: pending.attackId,
    actingPlayerId: pending.actingPlayerId,
    relatedPlayerId: pending.relatedPlayerId,
    relatedInstanceId: pending.relatedInstanceId,
    amount: pending.amount,
    cause: pending.cause,
    step: getStructuredEventStep(pending.event),
    subPhase: getStructuredEventSubPhase(pending.event),
    actionKind: getStructuredEventActionKind(pending.event),
  };
}

function pendingBurstIdentity(
  pending: PendingBurstCheck
): EffectEnterFieldEventIdentity {
  const amount =
    pending.eventKind === "summon" || pending.eventKind === "place"
      ? null
      : pending.amount;
  return {
    eventKind: pending.eventKind,
    source: pending.source,
    chainId: pending.chainId,
    attackId: pending.attackId,
    // Burst checks are owner-routed, so actingPlayerId is not part of the
    // originating event identity.
    relatedPlayerId: pending.relatedPlayerId,
    relatedInstanceId: pending.relatedInstanceId,
    amount,
    cause:
      pending.event && "cause" in pending.event
        ? pending.event.cause
        : undefined,
    step: getStructuredEventStep(pending.event),
    subPhase: getStructuredEventSubPhase(pending.event),
    actionKind: getStructuredEventActionKind(pending.event),
  };
}

function hasQueuedTriggerEventIdentity(
  state: GameState,
  pendingTriggeredEffects: readonly PendingTriggeredEffect[],
  pendingPrivateDeclarations: readonly PendingPrivateDeclaration[],
  pendingBurstChecks: readonly PendingBurstCheck[],
  identities: readonly EffectEnterFieldEventIdentity[],
  adoptParentSegmentOnly = false,
  includeBurstChecks = true
): boolean {
  const matchesAny = (candidate: EffectEnterFieldEventIdentity): boolean =>
    identities.some(
      (identity) =>
        (!adoptParentSegmentOnly ||
          (candidate.chainId !== null &&
            identity.chainId?.startsWith(
              candidate.chainId + ":after_triggers:"
            ))) &&
        identitiesMatch(identity, candidate)
    );
  return (
    [
      ...state.pendingTriggeredEffects,
      ...state.pendingDeferredTriggeredEffects,
      ...pendingTriggeredEffects,
    ].some((pending) => matchesAny(pendingTriggeredIdentity(pending))) ||
    [...state.pendingPrivateDeclarations, ...pendingPrivateDeclarations].some(
      (pending) => matchesAny(pendingPrivateIdentity(pending))
    ) ||
    (includeBurstChecks &&
      [...state.pendingBurstChecks, ...pendingBurstChecks].some((pending) =>
        matchesAny(pendingBurstIdentity(pending))
      ))
  );
}

/**
 * 途中選択の finalize で既に収集したイベントを、after_triggers の解決区間へ引き継ぐ。
 * pending ID と解決済み source は保持する。同じ chain 内の別発生は重複除去しない。
 */
function adoptQueuedEventsIntoResolutionSegment(
  state: GameState,
  chainId: string | null,
  identities: readonly EffectEnterFieldEventIdentity[]
): GameState {
  if (chainId === null || !chainId.includes(":after_triggers:")) return state;
  const adopt = <T extends { chainId: string | null }>(
    pending: T,
    identity: EffectEnterFieldEventIdentity
  ): T =>
    pending.chainId !== null &&
    chainId.startsWith(pending.chainId + ":after_triggers:") &&
    identities.some((candidate) => identitiesMatch(candidate, identity))
      ? { ...pending, chainId }
      : pending;
  return {
    ...state,
    pendingTriggeredEffects: state.pendingTriggeredEffects.map((p) =>
      adopt(p, pendingTriggeredIdentity(p))
    ),
    pendingDeferredTriggeredEffects: state.pendingDeferredTriggeredEffects.map(
      (p) => adopt(p, pendingTriggeredIdentity(p))
    ),
    pendingPrivateDeclarations: state.pendingPrivateDeclarations.map((p) =>
      adopt(p, pendingPrivateIdentity(p))
    ),
    pendingBurstChecks: state.pendingBurstChecks.map((p) =>
      adopt(p, pendingBurstIdentity(p))
    ),
  };
}

/**
 * P3-39: queue function の options モード。
 * - "production": source 解決を行い、リスナー無しイベントを捨てる。production 経路はこちら。
 * - null: raw push (リスナー判定をスキップして pendingEffect をそのまま積む)。
 *   `queuePendingReactionsRawForTesting` 経由でのみ使用。production では使わない。
 */
type QueueReactionsOptions = {
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
} | null;

function queueReactionsInternal(
  state: GameState,
  events: readonly CollectedTriggerEvent[],
  externalSimultaneousGroupId: string | undefined,
  options: QueueReactionsOptions
): GameState {
  if (events.length === 0) {
    return state;
  }

  for (const event of events)
    assertTriggerChainId(
      event.chainId,
      `${event.eventKind}:${event.relatedInstanceId ?? event.relatedPlayerId}`
    );

  // 同一バッチで 2 件以上の pending が生成される場合、同時誘発グループとして扱う
  const groupId =
    externalSimultaneousGroupId ??
    (events.length >= 2 ? createSimultaneousGroupId() : undefined);

  const pendingTriggeredEffects: PendingTriggeredEffect[] = [];
  const pendingPrivateDeclarations: PendingPrivateDeclaration[] = [];
  const pendingBurstChecks: PendingBurstCheck[] = [];
  // ENGINE-nth-occurrence-trigger-gate: occurrenceGate tally はバッチ内の複数 event に
  // またがって単調加算する (state.effectOccurrenceRecords は関数末尾でまとめて反映)。
  let occurrenceRecords = state.effectOccurrenceRecords;
  const suppressedTriggerLogs: string[] = [];
  const relatedIdsBySourceRegistrationKey = new Map<string, string[]>();
  const addRelatedIdForSourceChoice = (
    key: string,
    relatedInstanceId: string | null
  ) => {
    if (!relatedInstanceId) return;
    const current = relatedIdsBySourceRegistrationKey.get(key) ?? [];
    if (!current.includes(relatedInstanceId)) {
      current.push(relatedInstanceId);
      relatedIdsBySourceRegistrationKey.set(key, current);
    }
  };

  // ENGINE-battle-end-multi-participant-responder-dedup (2026-06-23):
  // queueBattleEndTriggers は participants × players の二重ループで event を fan-out するため、
  // ブロック成立 2 参加者バトルでは同一 responder × 同一 source に対し複数 event が積まれ、
  // form4 (game_event:battle_end + player:'either' + requireRelatedInstanceOnField:false) listener が
  // 同 source で 2 回発火する (count+1 が二重発火する原因)。
  // 形式1 (card_event:battle_end 自己) と形式3 (game_event:battle_end + player:'self') は
  // relatedInstanceId / timing.player の per-participant 制約で sourceChoices 集合が participant 毎に
  // 自然に分かれ重複しないが、形式4 は relatedInstanceId/player 非依存のため同 source が複数 event
  // に同居する → dedup が必要。
  // dedup key = (actingPlayerId, attackId, sourceInstanceId, registrationIndex)。
  // 後発 event の pending には pre-claim 済 source key を resolvedSourceRegistrationKeys に注入し、
  // getAvailableTriggeredEffectSourceChoices が execute-time に再除外する。
  // 形式1/3 は sourceChoices が participant 毎に独立 → 同 key 競合無し → 影響なし。
  // 注意 (将来検討): 各 event は queueBattleEndTriggers で
  // `amount=countDestroyedOpponentSpiritsFor(participant.controller)` を持つ。dedup は先発 event の
  // amount だけを残し後発を捨てるため、per-participant amount を集計する form4 効果が将来現れた場合は
  // 捨てる前に amount を merge する拡張が必要 (現行 form4 候補は固定値 amount で問題なし)。
  const aggregateClaimedKeys = new Map<string, Set<string>>();
  const EFFECT_RESOLUTION_AGGREGATE_PREFIX = "effect_resolution|";
  const shouldPreClaimAggregateKey = (key: string | null): boolean =>
    key !== null &&
    (key.startsWith("battle_end|") ||
      key.startsWith(EFFECT_RESOLUTION_AGGREGATE_PREFIX));
  const effectResolutionAggregateKey = (
    event: CollectedTriggerEvent,
    eventActionKind: StructuredTriggerEventActionKind | undefined
  ): string | null => {
    // 同じ効果解決境界の離場も召喚と同様に、各効果ソースにつき1回だけ誘発する。
    if (
      event.source !== "action_resolution" ||
      event.chainId === null ||
      event.eventKind === "after_draw" ||
      event.eventKind === "targeted" ||
      event.eventKind === "battle_end" ||
      (event.relatedInstanceId === null &&
        (event.relatedInstanceIds?.length ?? 0) === 0)
    ) {
      return null;
    }
    return [
      EFFECT_RESOLUTION_AGGREGATE_PREFIX,
      event.source,
      event.chainId,
      event.attackId ?? "",
      event.eventKind,
      eventActionKind ?? "",
      event.actingPlayerId,
      event.relatedPlayerId,
      event.cause ?? "",
      event.causedByPlayerId ?? "",
      event.effectSourceInstanceId ?? "",
      event.effectSourceDefinitionId ?? "",
      event.effectSourcePreventionLevel ?? "",
      event.effectActionKind ?? "",
      event.effectActivationLabel ?? "",
      event.effectActivationTiming === undefined
        ? ""
        : JSON.stringify(event.effectActivationTiming),
      event.triggerActivationZone ?? "",
      event.sourceEffectIndex ?? "",
      event.effectScope ?? "",
      (event.effectSourceInstanceIds ?? []).join(","),
    ].join("|");
  };
  const getAggregateClaimKey = (
    event: CollectedTriggerEvent,
    eventActionKind: StructuredTriggerEventActionKind | undefined
  ): string | null => {
    if (event.eventKind === "card_used" && event.chainId !== null) {
      return `${EFFECT_RESOLUTION_AGGREGATE_PREFIX}card_used|${event.chainId}|${event.actingPlayerId}`;
    }
    if (event.eventKind === "battle_end") {
      return `battle_end|${event.actingPlayerId}|${event.attackId ?? ""}`;
    }
    if (
      event.eventKind === "targeted" &&
      event.effectSourceInstanceId !== undefined
    ) {
      return [
        "targeted",
        event.actingPlayerId,
        event.effectSourceInstanceId,
        event.effectSourceDefinitionId ?? "",
        event.effectActionKind ?? "",
        event.effectActivationTiming === undefined
          ? ""
          : JSON.stringify(event.effectActivationTiming),
      ].join("|");
    }
    return effectResolutionAggregateKey(event, eventActionKind);
  };

  for (const [index, event] of events.entries()) {
    const structuredEvent = triggerEventKindToStructuredEvent(event.eventKind);
    const eventActionKind =
      event.actionKind ??
      ("actionKind" in structuredEvent
        ? structuredEvent.actionKind
        : undefined);
    const eventIdentities = [
      collectedEventIdentity(event, eventActionKind),
      collectedBurstEventIdentity(event, eventActionKind),
    ].filter(
      (identity): identity is EffectEnterFieldEventIdentity => identity !== null
    );
    const alreadyQueued = hasQueuedTriggerEventIdentity(
      state,
      pendingTriggeredEffects,
      pendingPrivateDeclarations,
      pendingBurstChecks,
      eventIdentities,
      !isChainDedupeEvent(event),
      // 待機入りのバースト確認と、実移動後の「離れたとき」は別の発揮境界。
      event.suppressBurstCheck !== true
    );
    if (alreadyQueued) {
      state = adoptQueuedEventsIntoResolutionSegment(
        state,
        event.chainId,
        eventIdentities
      );
      continue;
    }

    // 召喚・配置は効果で行う場合も使用。通常行動の宣言履歴は再利用し、
    // 場入りの再収集では同じ解決区間・場の個体の履歴を増やさない。
    if (
      (event.eventKind === "summon" || event.eventKind === "place") &&
      event.source === "action_resolution" &&
      event.relatedInstanceId !== null
    ) {
      const card = state.cardInstances.find(
        (candidate) => candidate.instanceId === event.relatedInstanceId
      );
      if (card) {
        const group = `${state.turnNumber}|${event.chainId ?? "field-entry"}|${event.effectSourceInstanceId ?? ""}|${event.sourceEffectIndex ?? ""}`;
        const key = `${group}|${event.eventKind}|${card.instanceId}|${card.fieldInstanceGeneration ?? 0}`;
        if (
          !state.flashCardUsageLog.some((usage) => usage.resolutionKey === key)
        ) {
          const existingIndex = state.flashCardUsageLog.findLastIndex(
            (usage) =>
              usage.cardInstanceId === card.instanceId &&
              usage.mode === "play" &&
              usage.completion === "declared"
          );
          const usage = {
            playerId: card.controllerPlayerId,
            cardInstanceId: card.instanceId,
            cardDefinitionId: card.definitionId,
            turnNumber: state.turnNumber,
            step: state.step,
            attackId: event.attackId,
            mode: "play" as const,
            completion: "resolving" as const,
            resolutionKey: key,
            usageGroupId: group,
            chainId: requireTriggerChainId(event.chainId),
          };
          state = {
            ...state,
            flashCardUsageLog:
              existingIndex < 0
                ? [...state.flashCardUsageLog, usage]
                : state.flashCardUsageLog.map((entry, index) =>
                    index === existingIndex ? { ...entry, ...usage } : entry
                  ),
          };
        }
      }
    }

    const aggregateClaimKey = getAggregateClaimKey(event, eventActionKind);
    const eventResolvedSourceRegistrationKeys = [
      ...(event.resolvedSourceRegistrationKeys ?? []),
    ];
    const preClaimedRegistrationKeys: string[] = shouldPreClaimAggregateKey(
      aggregateClaimKey
    )
      ? Array.from(aggregateClaimedKeys.get(aggregateClaimKey!) ?? [])
      : [];
    const initialResolvedSourceRegistrationKeys = Array.from(
      new Set([
        ...eventResolvedSourceRegistrationKeys,
        ...preClaimedRegistrationKeys,
      ])
    );

    let pendingEffect: PendingTriggeredEffect = {
      pendingId: createPendingTriggeredEffectId(state, event, index),
      actingPlayerId: event.actingPlayerId,
      eventKind: event.eventKind,
      event: {
        ...structuredEvent,
        ...(event.step !== undefined ? { step: event.step } : {}),
        ...(event.subPhase !== undefined ? { subPhase: event.subPhase } : {}),
        ...(event.cause !== undefined ? { cause: event.cause } : {}),
        // P3-14 C-5: battle_end のアタック側/ブロック側区別等。
        ...(event.actionKind !== undefined
          ? { actionKind: event.actionKind }
          : {}),
        ...(event.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: event.effectSourceInstanceId }
          : {}),
        ...(event.effectSourceInstanceIds !== undefined
          ? { effectSourceInstanceIds: [...event.effectSourceInstanceIds] }
          : {}),
        ...(event.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: event.effectSourceDefinitionId }
          : {}),
        ...(event.effectSourcePreventionLevel !== undefined
          ? {
              effectSourcePreventionLevel: event.effectSourcePreventionLevel,
            }
          : {}),
        ...(event.effectActionKind !== undefined
          ? { effectActionKind: event.effectActionKind }
          : {}),
        ...(event.effectActivationLabel !== undefined
          ? { effectActivationLabel: event.effectActivationLabel }
          : {}),
        ...(event.effectActivationTiming !== undefined
          ? { effectActivationTiming: event.effectActivationTiming }
          : {}),
        ...(event.triggerActivationZone !== undefined
          ? { triggerActivationZone: event.triggerActivationZone }
          : {}),
        ...(event.effectSourceTotalReduction !== undefined
          ? { effectSourceTotalReduction: event.effectSourceTotalReduction }
          : {}),
        ...(event.effectSourceSatisfiedReductionSymbolCount !== undefined
          ? {
              effectSourceSatisfiedReductionSymbolCount:
                event.effectSourceSatisfiedReductionSymbolCount,
            }
          : {}),
        ...(event.effectSourceRequiredReductionSymbolCount !== undefined
          ? {
              effectSourceRequiredReductionSymbolCount:
                event.effectSourceRequiredReductionSymbolCount,
            }
          : {}),
        ...(event.eligibleSourceInstanceIds !== undefined
          ? { eligibleSourceInstanceIds: [...event.eligibleSourceInstanceIds] }
          : {}),
        ...(event.sourceEffectIndex !== undefined
          ? { sourceEffectIndex: event.sourceEffectIndex }
          : {}),
        ...(event.effectScope !== undefined
          ? { effectScope: event.effectScope }
          : {}),
      },
      source: event.source,
      chainId: getTriggerEventChainKey(state, event),
      attackId: event.attackId,
      relatedPlayerId: event.relatedPlayerId,
      relatedInstanceId: event.relatedInstanceId,
      ...(event.triggerRelatedCombinedHostInstanceId !== undefined
        ? {
            triggerRelatedCombinedHostInstanceId:
              event.triggerRelatedCombinedHostInstanceId,
          }
        : {}),
      ...(event.relatedInstanceIds !== undefined
        ? { relatedInstanceIds: [...event.relatedInstanceIds] }
        : {}),
      ...(event.adventSourceInstanceIds !== undefined
        ? { adventSourceInstanceIds: [...event.adventSourceInstanceIds] }
        : {}),
      amount: event.amount,
      ...(event.causedByPlayerId !== undefined
        ? { causedByPlayerId: event.causedByPlayerId }
        : {}),
      step: state.step,
      window: state.window,
      resolvedSourceInstanceIds: [],
      ...(event.cause !== undefined ? { cause: event.cause } : {}),
      ...(event.fromZone !== undefined ? { fromZone: event.fromZone } : {}),
      ...(event.suppressThirdPartyObservation
        ? { suppressThirdPartyObservation: true }
        : {}),
      ...(event.relatedInstanceOffFieldActivating !== undefined
        ? {
            relatedInstanceOffFieldActivating:
              event.relatedInstanceOffFieldActivating,
          }
        : {}),
      ...(groupId !== undefined ? { simultaneousGroupId: groupId } : {}),
      ...(event.suppressedSourceInstanceIds?.length
        ? { suppressedSourceInstanceIds: event.suppressedSourceInstanceIds }
        : {}),
      ...(event.effectSuppressed ? { effectSuppressed: true } : {}),
      ...(event.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: event.effectSourceInstanceId }
        : {}),
      ...(event.effectSourceInstanceIds !== undefined
        ? { effectSourceInstanceIds: [...event.effectSourceInstanceIds] }
        : {}),
      ...(event.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: event.effectSourceDefinitionId }
        : {}),
      ...(event.effectSourcePreventionLevel !== undefined
        ? {
            effectSourcePreventionLevel: event.effectSourcePreventionLevel,
          }
        : {}),
      ...(event.effectActionKind !== undefined
        ? { effectActionKind: event.effectActionKind }
        : {}),
      ...(event.effectActivationLabel !== undefined
        ? { effectActivationLabel: event.effectActivationLabel }
        : {}),
      ...(event.effectActivationTiming !== undefined
        ? { effectActivationTiming: event.effectActivationTiming }
        : {}),
      ...(event.triggerActivationZone !== undefined
        ? { triggerActivationZone: event.triggerActivationZone }
        : {}),
      ...(event.effectSourceTotalReduction !== undefined
        ? { effectSourceTotalReduction: event.effectSourceTotalReduction }
        : {}),
      ...(event.effectSourceSatisfiedReductionSymbolCount !== undefined
        ? {
            effectSourceSatisfiedReductionSymbolCount:
              event.effectSourceSatisfiedReductionSymbolCount,
          }
        : {}),
      ...(event.effectSourceRequiredReductionSymbolCount !== undefined
        ? {
            effectSourceRequiredReductionSymbolCount:
              event.effectSourceRequiredReductionSymbolCount,
          }
        : {}),
      ...(event.eligibleSourceInstanceIds !== undefined
        ? { eligibleSourceInstanceIds: [...event.eligibleSourceInstanceIds] }
        : {}),
      ...(event.resolvedActionKinds !== undefined
        ? { resolvedActionKinds: [...event.resolvedActionKinds] }
        : {}),
      ...(event.sourceEffectIndex !== undefined
        ? { sourceEffectIndex: event.sourceEffectIndex }
        : {}),
      ...(event.effectScope !== undefined
        ? { effectScope: event.effectScope }
        : {}),
      ...(event.exactGameEventKind === true
        ? { exactGameEventKind: true }
        : {}),
      ...(event.preFlushLeaveEvent === true
        ? { preFlushLeaveEvent: true }
        : {}),
      ...(event.registeredPreFlushLeaveEvent === true
        ? { registeredPreFlushLeaveEvent: true }
        : {}),
      ...(initialResolvedSourceRegistrationKeys.length > 0
        ? {
            resolvedSourceRegistrationKeys:
              initialResolvedSourceRegistrationKeys,
          }
        : {}),
    };

    if (options === null) {
      // テスト専用 raw 経路: source 解決を行わず raw pending を積む。
      // burst check は当ブロックの外（下方）で別途 queue されるため共通。
      pendingTriggeredEffects.push(pendingEffect);
    } else {
      let rawSourceChoicesBeforeSuppression =
        getAvailableTriggeredEffectSourceChoices({
          state,
          pendingEffect,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        });
      // 02b「ただちに誘発」: 通常の発揮条件を判定する前に先行効果を解決する。
      // イベントの主語・発揮場所・Lv・使用制限は通常通り照合し、カード固有条件は
      // evaluateCondition による宣言前の再評価へ残す。過去イベントの再発行はしない。
      const initiallyAvailableSourceKeys = new Set(
        rawSourceChoicesBeforeSuppression.map((choice) =>
          makeResolvedTriggeredSourceKey(
            getTriggeredSourceRegistrationInstanceId(choice),
            choice.registrationIndex
          )
        )
      );
      const deferNormalPublicConditions =
        rawSourceChoicesBeforeSuppression.some(
          (choice) =>
            getTriggerPriority(choice.actionRegistration) === "immediate"
        );
      if (deferNormalPublicConditions) {
        rawSourceChoicesBeforeSuppression =
          getAvailableTriggeredEffectSourceChoices({
            state,
            pendingEffect,
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            deferNormalPublicConditions: true,
          });
      }
      // Q30857: 観測できた登録を固定し、同じ群の解決中のLv/条件変化は再評価する。
      // privateの申告資格・イベント主語・timing/filter/場所は緩めない。
      const timingObservers = getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        captureTimingObservers: true,
      }).filter(
        (choice) => !isPrivateTriggeredEffectSourceChoice(state, choice)
      );
      const observerKeys = new Set(
        rawSourceChoicesBeforeSuppression.map((choice) =>
          makeResolvedTriggeredSourceKey(
            getTriggeredSourceRegistrationInstanceId(choice),
            choice.registrationIndex
          )
        )
      );
      rawSourceChoicesBeforeSuppression = [
        ...rawSourceChoicesBeforeSuppression,
        ...timingObservers.filter(
          (choice) =>
            groupId !== undefined &&
            !observerKeys.has(
              makeResolvedTriggeredSourceKey(
                getTriggeredSourceRegistrationInstanceId(choice),
                choice.registrationIndex
              )
            )
        ),
      ];
      const eventResultsBySourceKey = new Map(
        timingObservers.map((choice) => [
          makeResolvedTriggeredSourceKey(
            getTriggeredSourceRegistrationInstanceId(choice),
            choice.registrationIndex
          ),
          choice.eventConditionResults ?? {},
        ])
      );
      pendingEffect = {
        ...pendingEffect,
        timingSourceRegistrations: Object.fromEntries(
          rawSourceChoicesBeforeSuppression
            .filter(
              (choice) => !isPrivateTriggeredEffectSourceChoice(state, choice)
            )
            .map((choice) => {
              const effectId = getTriggeredSourceRegistrationInstanceId(choice);
              return [
                makeResolvedTriggeredSourceKey(
                  effectId,
                  choice.registrationIndex
                ),
                {
                  sourceInstanceId: choice.sourceCard.instanceId,
                  sourceDefinitionId: choice.sourceCard.definitionId,
                  sourceFieldInstanceGeneration:
                    choice.sourceCard.fieldInstanceGeneration ?? 0,
                  effectDefinitionId: choice.sourceEffectDefinition.cardNo,
                  effectFieldInstanceGeneration:
                    getCardById(state, effectId)?.fieldInstanceGeneration ?? 0,
                  eventConditionResults:
                    eventResultsBySourceKey.get(
                      makeResolvedTriggeredSourceKey(
                        effectId,
                        choice.registrationIndex
                      )
                    ) ??
                    choice.eventConditionResults ??
                    {},
                },
              ];
            })
        ),
      };
      const claimedRegistrationKeys =
        aggregateClaimKey !== null
          ? aggregateClaimedKeys.get(aggregateClaimKey)
          : undefined;
      const sourceChoicesBeforeSuppression =
        claimedRegistrationKeys !== undefined &&
        aggregateClaimKey?.startsWith("targeted|")
          ? rawSourceChoicesBeforeSuppression.filter((sourceChoice) => {
              const sourceKey = makeResolvedTriggeredSourceKey(
                getTriggeredSourceRegistrationInstanceId(sourceChoice),
                sourceChoice.registrationIndex
              );
              return (
                !claimedRegistrationKeys.has(sourceKey) ||
                !effectUsesTriggerRelatedInstances(
                  sourceChoice.sourceEffectDefinition,
                  sourceChoice.actionRegistration
                )
              );
            })
          : rawSourceChoicesBeforeSuppression;
      const aggregationPending = {
        ...pendingEffect,
        resolvedSourceRegistrationKeys: [],
      };
      delete aggregationPending.timingSourceRegistrations;
      const sourceChoicesForRelatedAggregation =
        getAvailableTriggeredEffectSourceChoices({
          state,
          deferNormalPublicConditions,
          captureTimingObservers: true,
          pendingEffect: aggregationPending,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        });
      for (const sourceChoice of sourceChoicesForRelatedAggregation) {
        const sourceKey = makeResolvedTriggeredSourceKey(
          getTriggeredSourceRegistrationInstanceId(sourceChoice),
          sourceChoice.registrationIndex
        );
        const effectIndex = sourceChoice.actionRegistration.effectIndex;
        const timing =
          effectIndex === undefined
            ? undefined
            : sourceChoice.sourceEffectDefinition.effects?.[effectIndex]
                ?.timing;
        // バトル終了イベントの追加IDは「バトルした相手」。第三者観測の主語
        // （例: 契約域の自分のジャガーノート）へ流用すると相手を戻してしまう。
        // game_event は照合済みの主語を集約し、card_event の相手参照は保持する。
        if (event.eventKind === "battle_end" && timing?.kind === "game_event") {
          addRelatedIdForSourceChoice(sourceKey, event.relatedInstanceId);
        } else if (event.relatedInstanceIds !== undefined) {
          for (const relatedId of event.relatedInstanceIds) {
            addRelatedIdForSourceChoice(sourceKey, relatedId);
          }
        } else {
          addRelatedIdForSourceChoice(sourceKey, event.relatedInstanceId);
        }
      }
      // ENGINE-nth-occurrence-trigger-gate: occurrenceGate を持つ registration は、
      // 検出成功のたび (発動可否に関わらず) tally を無条件加算する。suppression
      // (effectSuppressed / suppressedSourceInstanceIds) はこの回の反応を止めるだけで
      // 「観測されたこと」自体は取り消さないため、tally は suppression filter の**前**の
      // `sourceChoicesBeforeSuppression` に対して行う (verifier 2026-07-19 round1 lens3:
      // suppression 後に tally すると suppressDestroyedEffects:"all_opponent" 下で
      // 第三者観測側の occurrence が丸ごと欠落し、ドキュメント契約と矛盾する under-count に
      // なる指摘を受けて修正)。
      // tally キーは sourceCard (declared/host) ではなく effect-attributed instance
      // (getTriggeredSourceRegistrationInstanceId = sourceEffectInstanceId ?? sourceCard)
      // を使う。star garment / quartz host 継承 (requiredSourceRole 経由) では sourceCard が
      // host になるため、host 直下で複数の異なる効果が occurrenceGate を持つ場合に
      // host instanceId 共有で tally が誤って合算されるのを防ぐ
      // (ENGINE-quartz-host-identity-propagation で発覚)。
      for (const sourceChoice of sourceChoicesBeforeSuppression) {
        const occurrenceGate = sourceChoice.actionRegistration.occurrenceGate;
        if (!occurrenceGate) continue;
        const effectLabel = getStableEffectLabel(
          "triggered",
          sourceChoice.registrationIndex,
          sourceChoice.actionRegistration as { effectIndex?: number }
        );
        occurrenceRecords = recordEffectOccurrence({
          state: { ...state, effectOccurrenceRecords: occurrenceRecords },
          sourceInstanceId:
            getTriggeredSourceRegistrationInstanceId(sourceChoice),
          sourceDefinitionId:
            sourceChoice.sourceEffectDefinitionId ??
            sourceChoice.sourceCard.definitionId,
          effectLabel,
          duration: occurrenceGate.duration,
          ...(occurrenceGate.groupId !== undefined
            ? { groupId: occurrenceGate.groupId }
            : {}),
        });
      }

      const suppressedSourceIds = new Set(
        pendingEffect.suppressedSourceInstanceIds ?? []
      );
      const suppressedRegistrationKeys = new Set<string>();
      for (const sourceChoice of sourceChoicesBeforeSuppression) {
        if (
          isCausedReactionNegated(
            state,
            event.chainId,
            sourceChoice.sourceCard.controllerPlayerId,
            "effect"
          ) ||
          isTriggeredSourceChoiceSuppressedByEffectSuppression(
            state,
            sourceChoice,
            options.getCardDefinitionById
          )
        ) {
          suppressedRegistrationKeys.add(
            makeResolvedTriggeredSourceKey(
              getTriggeredSourceRegistrationInstanceId(sourceChoice),
              sourceChoice.registrationIndex
            )
          );
        }
      }
      if (suppressedRegistrationKeys.size > 0) {
        pendingEffect = {
          ...pendingEffect,
          resolvedSourceRegistrationKeys: [
            ...(pendingEffect.resolvedSourceRegistrationKeys ?? []),
            ...suppressedRegistrationKeys,
          ],
        };
      }
      const sourceChoicesAfterSuppression =
        sourceChoicesBeforeSuppression.filter((sourceChoice) => {
          const suppressed =
            pendingEffect.effectSuppressed === true ||
            suppressedSourceIds.has(sourceChoice.sourceCard.instanceId) ||
            suppressedRegistrationKeys.has(
              makeResolvedTriggeredSourceKey(
                getTriggeredSourceRegistrationInstanceId(sourceChoice),
                sourceChoice.registrationIndex
              )
            );
          if (suppressed) {
            suppressedTriggerLogs.push(
              `trigger:effect-suppressed:${pendingEffect.pendingId}:${sourceChoice.sourceCard.instanceId}`
            );
          }
          return !suppressed;
        });
      // tally 済みの occurrenceRecords を読み取り専用で参照し、加算後の値が targetCount と
      // 厳密一致したときだけ後続キュー処理 (private/public 分岐) へ通す。
      const sourceChoices = sourceChoicesAfterSuppression.filter(
        (sourceChoice) => {
          const occurrenceGate = sourceChoice.actionRegistration.occurrenceGate;
          if (!occurrenceGate) return true;
          const effectLabel = getStableEffectLabel(
            "triggered",
            sourceChoice.registrationIndex,
            sourceChoice.actionRegistration as { effectIndex?: number }
          );
          return isExactOccurrenceMatch(
            { ...state, effectOccurrenceRecords: occurrenceRecords },
            {
              sourceInstanceId:
                getTriggeredSourceRegistrationInstanceId(sourceChoice),
              effectLabel,
              duration: occurrenceGate.duration,
              targetCount: occurrenceGate.targetCount,
              ...(occurrenceGate.groupId !== undefined
                ? { groupId: occurrenceGate.groupId }
                : {}),
            }
          );
        }
      );
      // ENGINE-battle-end-multi-participant-responder-dedup: resolved source key を batch claim 集合
      // に登録し、後続 event の pendingEffect が同 source を再選択しないよう resolvedSourceRegistrationKeys
      // 経由で除外させる。pre-claim 注入で既に excluded だった source はここに来ない (再 add しても idempotent)。
      if (aggregateClaimKey !== null && sourceChoices.length > 0) {
        const claimedSet =
          aggregateClaimedKeys.get(aggregateClaimKey) ?? new Set<string>();
        for (const choice of sourceChoices) {
          const usageLimits = choice.actionRegistration.usageLimit;
          // 「各個体が1回ずつ」の観測効果は、同時バトルでも主語ごとに
          // 任意発揮と使用記録を持つ。同一発揮元だけをキーに畳むと2体目が消える。
          if (
            (Array.isArray(usageLimits) ? usageLimits : [usageLimits]).some(
              (limit) => limit?.kind === "per_trigger_related_instance"
            )
          )
            continue;
          if (
            aggregateClaimKey.startsWith("targeted|") &&
            !effectUsesTriggerRelatedInstances(
              choice.sourceEffectDefinition,
              choice.actionRegistration
            )
          ) {
            continue;
          }
          claimedSet.add(
            makeResolvedTriggeredSourceKey(
              getTriggeredSourceRegistrationInstanceId(choice),
              choice.registrationIndex
            )
          );
        }
        aggregateClaimedKeys.set(aggregateClaimKey, claimedSet);
      }
      // 待機入りで queue 済みの反応を実移動時に重ねて誘発させない。
      // pending が解決されて消えた後も、離脱 intent 側に除外キーを保持する。
      const preFlushClaimedSourceKeys = sourceChoicesForRelatedAggregation
        .map((choice) =>
          makeResolvedTriggeredSourceKey(
            getTriggeredSourceRegistrationInstanceId(choice),
            choice.registrationIndex
          )
        )
        .filter((key) => preClaimedRegistrationKeys.includes(key));
      if (
        pendingEffect.preFlushLeaveEvent &&
        (sourceChoices.length > 0 || preFlushClaimedSourceKeys.length > 0)
      ) {
        const relatedIds = new Set([
          pendingEffect.relatedInstanceId,
          ...(pendingEffect.relatedInstanceIds ?? []),
        ]);
        // 同時離場の先行対象で誘発済みのソースも、後続対象の実離場へ引き継ぐ。
        const sourceKeys = [
          ...preFlushClaimedSourceKeys,
          ...sourceChoices.map((choice) =>
            makeResolvedTriggeredSourceKey(
              getTriggeredSourceRegistrationInstanceId(choice),
              choice.registrationIndex
            )
          ),
        ];
        state = {
          ...state,
          pendingLeaveEntities: state.pendingLeaveEntities.map((leave) =>
            relatedIds.has(leave.instanceId)
              ? {
                  ...leave,
                  resolvedSourceRegistrationKeys: [
                    ...new Set([
                      ...(leave.resolvedSourceRegistrationKeys ?? []),
                      ...sourceKeys,
                    ]),
                  ],
                }
              : leave
          ),
        };
      }
      const privateDeclarationChoices = sourceChoices.filter(
        (sourceChoice) =>
          getEffectExecutionMode(sourceChoice.actionRegistration) ===
            "optional" &&
          isPrivateTriggeredEffectSourceChoice(state, sourceChoice)
      );
      const privateSourceIds = new Set(
        privateDeclarationChoices.map(
          (sourceChoice) => sourceChoice.sourceCard.instanceId
        )
      );
      const publicSourceChoices = sourceChoices.filter(
        (sourceChoice) =>
          !privateSourceIds.has(sourceChoice.sourceCard.instanceId)
      );

      if (sourceChoices.length === 0) {
        // どのカードも応答しないイベント（リスナー無し）は解決対象が無いため queue しない。
        // これを残すと resolve 不能な空 pending が step 遷移ごとに累積し、
        // `select_pending_to_resolve` が無限に積まれる。
      } else {
        // ENGINE-phase-whose-either-source-controller-actingplayerid (2026-06-25):
        // pendingEffect.actingPlayerId は event.actingPlayerId (= ステップ active player)
        // で固定されていたが、whose:"either" / whose:"opponent" 経路で sourceCard.controllerPlayerId
        // が event.actingPlayerId と乖離する場合、resolvePlayerRef("self") が source の真の
        // owner を返さず self/opponent が反転する。対策: source choice を controllerPlayerId で
        // 分割し fork した pendingEffect の actingPlayerId を controller に合わせる。
        // 単一 controller 集合 (whose:"self" / 単方向 whose:"opponent") は pendingId を温存して
        // actingPlayerId のみ書き換え、whose:"either" で両 controller が混在する場合のみ
        // suffix 付きで分割する。
        // 排他は `resolvedSourceRegistrationKeys` (純粋な exclusion list、
        // getAvailableTriggeredEffectSourceChoices L1294-1301 が instanceId キーで対応) に積む。
        // `resolvedSourceInstanceIds` を流用すると sourceColors (trigger-system L4184) や
        // resolution-items の表示ソース解決が他 controller のカードを誤参照する。
        if (publicSourceChoices.length > 0) {
          type PublicSourceChoice = (typeof publicSourceChoices)[number];
          const publicBuckets = new Map<
            string,
            {
              controllerId: string;
              triggerPriority: TriggerPriority;
              choices: PublicSourceChoice[];
            }
          >();
          for (const choice of publicSourceChoices) {
            const controllerId = choice.sourceCard.controllerPlayerId;
            const triggerPriority = getTriggerPriority(
              choice.actionRegistration
            );
            const key = `${controllerId}\0${triggerPriority}`;
            const bucket = publicBuckets.get(key) ?? {
              controllerId,
              triggerPriority,
              choices: [],
            };
            bucket.choices.push(choice);
            publicBuckets.set(key, bucket);
          }
          const publicBucketEntries = Array.from(publicBuckets.values());
          for (const {
            controllerId,
            triggerPriority,
            choices: controllerSourceChoices,
          } of publicBucketEntries) {
            const bucketSourceKeys = controllerSourceChoices.map((choice) =>
              makeResolvedTriggeredSourceKey(
                getTriggeredSourceRegistrationInstanceId(choice),
                choice.registrationIndex
              )
            );
            const deferredConditionSourceKeys = bucketSourceKeys.filter(
              (key) =>
                deferNormalPublicConditions &&
                !initiallyAvailableSourceKeys.has(key)
            );
            const dormantSourceRegistrationKeys = bucketSourceKeys.filter(
              (key) => !initiallyAvailableSourceKeys.has(key)
            );
            const registeredLeaveFieldStayOnFieldSourceKeys =
              getRegisteredLeaveFieldStayOnFieldSourceKeys(
                controllerSourceChoices.filter((choice) =>
                  initiallyAvailableSourceKeys.has(
                    makeResolvedTriggeredSourceKey(
                      getTriggeredSourceRegistrationInstanceId(choice),
                      choice.registrationIndex
                    )
                  )
                ),
                pendingEffect.eventKind
              );
            const registeredLeaveFieldPreFlushSourceKeys =
              getRegisteredLeaveFieldPreFlushSourceKeys(
                controllerSourceChoices.filter((choice) =>
                  initiallyAvailableSourceKeys.has(
                    makeResolvedTriggeredSourceKey(
                      getTriggeredSourceRegistrationInstanceId(choice),
                      choice.registrationIndex
                    )
                  )
                ),
                pendingEffect.eventKind,
                pendingEffect.preFlushLeaveEvent
              );
            const otherControllerInstanceIds = Array.from(
              new Set(
                publicSourceChoices
                  .filter(
                    (sourceChoice) =>
                      sourceChoice.sourceCard.controllerPlayerId !==
                      controllerId
                  )
                  .map((sourceChoice) => sourceChoice.sourceCard.instanceId)
              )
            );
            const forkedPendingId =
              publicBucketEntries.length > 1
                ? `${pendingEffect.pendingId}:ctrl:${controllerId}:priority:${triggerPriority}`
                : pendingEffect.pendingId;
            pendingTriggeredEffects.push({
              ...pendingEffect,
              pendingId: forkedPendingId,
              actingPlayerId: controllerId,
              triggerPriority,
              // 操作権も読む登録記録は、このowner/優先度の候補だけに限定する。
              // 別bucketの登録が休眠観測を活動中に見せないようにする。
              ...(pendingEffect.timingSourceRegistrations !== undefined
                ? {
                    timingSourceRegistrations: Object.fromEntries(
                      Object.entries(
                        pendingEffect.timingSourceRegistrations
                      ).filter(([key]) => bucketSourceKeys.includes(key))
                    ),
                  }
                : {}),
              ...(dormantSourceRegistrationKeys.length
                ? { dormantSourceRegistrationKeys }
                : {}),
              ...(deferredConditionSourceKeys.length
                ? { deferredConditionSourceKeys }
                : {}),
              resolvedSourceInstanceIds: [
                ...pendingEffect.resolvedSourceInstanceIds,
                ...privateSourceIds,
              ],
              ...(registeredLeaveFieldStayOnFieldSourceKeys.length > 0
                ? {
                    registeredLeaveFieldStayOnFieldSourceKeys,
                  }
                : {}),
              ...(registeredLeaveFieldPreFlushSourceKeys.length > 0
                ? {
                    registeredLeaveFieldPreFlushSourceKeys,
                  }
                : {}),
              ...(otherControllerInstanceIds.length > 0
                ? {
                    resolvedSourceRegistrationKeys: [
                      ...(pendingEffect.resolvedSourceRegistrationKeys ?? []),
                      // raw instanceId は whole-instance 除外として扱われる
                      // (getAvailableTriggeredEffectSourceChoices L1300)。
                      ...otherControllerInstanceIds,
                    ],
                  }
                : {}),
            });
          }
        }

        // usageLimit が消費済み・あるいは同バッチ内で既に同 effect の declaration が積まれた
        // 場合は、追加の private declaration を queue から除外する。
        // 例: 手札に同名カード 2 枚 (M01「パチュリー・ノーレッジ」) が同時に
        // start_step を private 誘発するケースで、usageLimit per_card_name=1 が
        // 反映されていなかったため両方 declare 可能になっていた問題への対処。
        const consumedLabelsThisBatch = new Set<string>();
        const isSourceChoiceUsageBlocked = (sourceChoice: {
          sourceCard: { instanceId: string; definitionId: string };
          registrationIndex: number;
          actionRegistration: {
            effectIndex?: number;
            usageLimit?:
              | import("../model").EffectUsageLimit
              | import("../model").EffectUsageLimit[];
            limitGroupId?: string;
          };
        }): boolean => {
          const usageLimit = sourceChoice.actionRegistration.usageLimit;
          if (!usageLimit) return false;
          const effectLabel = getStableEffectLabel(
            "triggered",
            sourceChoice.registrationIndex,
            sourceChoice.actionRegistration as { effectIndex?: number }
          );
          const limitGroupId = sourceChoice.actionRegistration.limitGroupId;
          if (
            !canUseEffectByUsageLimit({
              sourceEffect: options.getCardDefinitionById(
                sourceChoice.sourceCard.definitionId
              )?.effects?.[sourceChoice.actionRegistration.effectIndex ?? -1],
              state,
              sourceInstanceId: sourceChoice.sourceCard.instanceId,
              sourceDefinitionId: sourceChoice.sourceCard.definitionId,
              getCardDefinitionById: options.getCardDefinitionById,
              effectLabel,
              usageLimit,
              ...(limitGroupId ? { groupId: limitGroupId } : {}),
              // ENGINE-no-duplicate-per-event-scope: 〔重複不可〕は per-event scope
              // (10_rules/03c 裁定 2026-06-24)。queue 時の private declaration 排除は
              // 親 pending の pendingId を scope key として渡し、別 trigger event で
              // 記録されたレコードと混同しない。
              triggerEventScopeKey: pendingEffect.pendingId,
              // ENGINE-trigger-per-effect-activation-dedup: per_trigger_activation chainId キー。
              // 同 activation (= 同 chainId) で発火した複数 emit を 1 回に dedup する。
              ...(pendingEffect.chainId
                ? { triggerActivationKey: pendingEffect.chainId }
                : {}),
            })
          ) {
            return true;
          }
          // batch 重複排除: 配列の場合は最も厳しいスコープ（per_card_name > per_instance）で判定。
          // limitGroupId が設定されている場合は groupId をキーに含めて、
          // 同 group の異 effect でも 1 回しか declare できないようにする。
          const limits = Array.isArray(usageLimit) ? usageLimit : [usageLimit];
          const hasNameScope = limits.some(
            (l) => l.kind === "per_card_name" || l.kind === "no_duplicate"
          );
          const labelKey = limitGroupId ?? effectLabel;
          const batchKey = hasNameScope
            ? `def:${sourceChoice.sourceCard.definitionId}:${labelKey}`
            : `inst:${sourceChoice.sourceCard.instanceId}:${labelKey}`;
          if (consumedLabelsThisBatch.has(batchKey)) return true;
          consumedLabelsThisBatch.add(batchKey);
          return false;
        };

        for (const [
          privateIndex,
          sourceChoice,
        ] of privateDeclarationChoices.entries()) {
          if (isSourceChoiceUsageBlocked(sourceChoice)) {
            continue;
          }
          const sourceZone =
            getPrimaryApplicabilityZone(
              sourceChoice.sourceCard,
              sourceChoice.actionRegistration.sourceZone
            ) ?? "hand";
          const registeredLeaveFieldStayOnFieldSourceKeys =
            getRegisteredLeaveFieldStayOnFieldSourceKeys(
              [sourceChoice],
              pendingEffect.eventKind
            );
          const registeredLeaveFieldPreFlushSourceKeys =
            getRegisteredLeaveFieldPreFlushSourceKeys(
              [sourceChoice],
              pendingEffect.eventKind,
              pendingEffect.preFlushLeaveEvent
            );
          const triggerPriority = getTriggerPriority(
            sourceChoice.actionRegistration
          );
          pendingPrivateDeclarations.push({
            declarationId: [
              pendingEffect.pendingId,
              "private",
              sourceChoice.sourceCard.instanceId,
              sourceChoice.registrationIndex,
            ].join(":"),
            ownerPlayerId: sourceChoice.sourceCard.controllerPlayerId,
            // ENGINE-phase-whose-either-source-controller-actingplayerid (2026-06-25):
            // private declaration の actingPlayerId は source 本人の controller。
            // whose:"either" / whose:"opponent" で event.actingPlayerId と乖離するケースを是正。
            actingPlayerId: sourceChoice.sourceCard.controllerPlayerId,
            sourceInstanceId: sourceChoice.sourceCard.instanceId,
            sourceDefinitionId: sourceChoice.sourceCard.definitionId,
            sourceKind: sourceChoice.sourceKind,
            sourceZone,
            registrationIndex: sourceChoice.registrationIndex,
            pendingId: `${pendingEffect.pendingId}:declared:${privateIndex}`,
            eventKind: pendingEffect.eventKind,
            ...(pendingEffect.preFlushLeaveEvent
              ? { preFlushLeaveEvent: true }
              : {}),
            ...(pendingEffect.event ? { event: pendingEffect.event } : {}),
            ...(pendingEffect.registeredPreFlushLeaveEvent === true
              ? { registeredPreFlushLeaveEvent: true }
              : {}),
            source: pendingEffect.source,
            chainId: pendingEffect.chainId,
            attackId: pendingEffect.attackId,
            ...(registeredLeaveFieldStayOnFieldSourceKeys.length > 0
              ? { registeredLeaveFieldStayOnFieldSourceKeys }
              : {}),
            ...(registeredLeaveFieldPreFlushSourceKeys.length > 0
              ? { registeredLeaveFieldPreFlushSourceKeys }
              : {}),
            relatedPlayerId: pendingEffect.relatedPlayerId,
            relatedInstanceId: pendingEffect.relatedInstanceId,
            ...(pendingEffect.triggerRelatedCombinedHostInstanceId !== undefined
              ? {
                  triggerRelatedCombinedHostInstanceId:
                    pendingEffect.triggerRelatedCombinedHostInstanceId,
                }
              : {}),
            ...(pendingEffect.relatedInstanceIds !== undefined
              ? { relatedInstanceIds: [...pendingEffect.relatedInstanceIds] }
              : {}),
            amount: pendingEffect.amount,
            step: pendingEffect.step,
            window: pendingEffect.window,
            ...(pendingEffect.fromZone !== undefined
              ? { fromZone: pendingEffect.fromZone }
              : {}),
            ...(pendingEffect.cause !== undefined
              ? { cause: pendingEffect.cause }
              : {}),
            ...(pendingEffect.simultaneousGroupId !== undefined
              ? { simultaneousGroupId: pendingEffect.simultaneousGroupId }
              : {}),
            triggerPriority,
            ...(pendingEffect.suppressedSourceInstanceIds?.length
              ? {
                  suppressedSourceInstanceIds:
                    pendingEffect.suppressedSourceInstanceIds,
                }
              : {}),
            ...(pendingEffect.effectSuppressed
              ? { effectSuppressed: pendingEffect.effectSuppressed }
              : {}),
            ...(pendingEffect.effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId: pendingEffect.effectSourceInstanceId }
              : {}),
            ...(pendingEffect.effectSourceInstanceIds !== undefined
              ? {
                  effectSourceInstanceIds: [
                    ...pendingEffect.effectSourceInstanceIds,
                  ],
                }
              : {}),
            ...(pendingEffect.effectSourceDefinitionId !== undefined
              ? {
                  effectSourceDefinitionId:
                    pendingEffect.effectSourceDefinitionId,
                }
              : {}),
            ...(pendingEffect.effectSourcePreventionLevel !== undefined
              ? {
                  effectSourcePreventionLevel:
                    pendingEffect.effectSourcePreventionLevel,
                }
              : {}),
            ...(pendingEffect.effectActionKind !== undefined
              ? { effectActionKind: pendingEffect.effectActionKind }
              : {}),
            ...(pendingEffect.resolvedActionKinds !== undefined
              ? { resolvedActionKinds: [...pendingEffect.resolvedActionKinds] }
              : {}),
            ...(pendingEffect.effectActivationTiming !== undefined
              ? { effectActivationTiming: pendingEffect.effectActivationTiming }
              : {}),
            ...(pendingEffect.effectSourceTotalReduction !== undefined
              ? {
                  effectSourceTotalReduction:
                    pendingEffect.effectSourceTotalReduction,
                }
              : {}),
            ...(pendingEffect.effectSourceSatisfiedReductionSymbolCount !==
            undefined
              ? {
                  effectSourceSatisfiedReductionSymbolCount:
                    pendingEffect.effectSourceSatisfiedReductionSymbolCount,
                }
              : {}),
            ...(pendingEffect.effectSourceRequiredReductionSymbolCount !==
            undefined
              ? {
                  effectSourceRequiredReductionSymbolCount:
                    pendingEffect.effectSourceRequiredReductionSymbolCount,
                }
              : {}),
            ...(pendingEffect.eligibleSourceInstanceIds !== undefined
              ? {
                  eligibleSourceInstanceIds: [
                    ...pendingEffect.eligibleSourceInstanceIds,
                  ],
                }
              : {}),
          });
        }
      }
    }

    const burstMapping =
      event.suppressBurstCheck === true ||
      (event.preFlushLeaveEvent &&
        state.pendingLeaveEntities.some(
          (leave) =>
            leave.instanceId === event.relatedInstanceId &&
            leave.burstDeclarationChecked
        ))
        ? null
        : mapTriggerEventToBurstCheck(event);

    // Category scope is evaluated per burst registration (explicit brave/
    // ultimate filters must survive). The unwired fallback keeps spirit scope.
    if (burstMapping !== null) {
      const structuredEvent = triggerEventKindToStructuredEvent(
        event.eventKind
      );
      const buildBurstCheck = (ownerPlayerId: string): PendingBurstCheck => ({
        // owner ごとに一意な checkId (同一イベントで両プレイヤー分を作るため suffix を付与)。
        checkId: `${createPendingBurstCheckId(state, event, index)}:${ownerPlayerId}`,
        actingPlayerId: ownerPlayerId,
        eventKind: burstMapping.burstEventKind,
        event: {
          ...burstEventKindToStructuredEvent(burstMapping.burstEventKind),
          ...(structuredEvent.causeKind !== undefined
            ? { causeKind: structuredEvent.causeKind }
            : {}),
          ...(event.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: event.effectSourceInstanceId }
            : {}),
          ...(event.effectSourceDefinitionId !== undefined
            ? { effectSourceDefinitionId: event.effectSourceDefinitionId }
            : {}),
          // step_timing 等: イベントの step / subPhase を check に載せ、
          // registration の eventMatcher (step + subPhase) で絞れるようにする。
          ...(event.step !== undefined ? { step: event.step } : {}),
          ...(event.subPhase !== undefined ? { subPhase: event.subPhase } : {}),
          // P3-67: 離脱原因 (cause) を check に載せ、registration.cause で
          // 「相手によって離れた後」等を絞れるようにする (leave_field 系)。
          ...(event.cause !== undefined ? { cause: event.cause } : {}),
        },
        source: event.source,
        chainId: getTriggerEventChainKey(state, event),
        attackId: event.attackId,
        relatedPlayerId: burstMapping.relatedPlayerId,
        relatedInstanceId: event.relatedInstanceId,
        amount: burstMapping.amount,
        step: state.step,
        window: state.window,
        resolvedBurstCardInstanceIds: [],
        ...(groupId !== undefined ? { simultaneousGroupId: groupId } : {}),
        ...(event.effectSuppressed ||
        isCausedReactionNegated(
          state,
          event.chainId,
          ownerPlayerId,
          "opponent_burst"
        )
          ? { effectSuppressed: true }
          : {}),
      });

      const burstLookup = options?.getRegisteredBurstActions;
      const burstDefLookup = options?.getCardDefinitionById;

      if (burstLookup === undefined || burstDefLookup === undefined) {
        // P3-67: lookup 未提供 (raw テスト経路 / 未配線呼び出し) は prune 不能。
        // 従来どおり owner = イベント当事者 (relatedPlayerId 軸) の単一 check を積む。
        // ただし UNWIRED_BURST_FALLBACK_SKIP_KINDS に含まれる kind は per-event 頻発 or
        // per-player routing 前提で、legacy 単一 check では正しく振れず vacuous check を
        // 量産するため skip (step_timing: 全ステップ遷移毎、exhaust: ENGINE-exhaust-
        // third-party-opt-in-gap で exhaust を OPT_IN 除外した際に同種の量産が判明)。
        if (
          !UNWIRED_BURST_FALLBACK_SKIP_KINDS.has(burstMapping.burstEventKind) &&
          summonResponderMatchesCategoryScope(state, event, undefined)
        ) {
          pendingBurstChecks.push(buildBurstCheck(burstMapping.actingPlayerId));
        }
      } else {
        // P3-67 routing 一般化: 各プレイヤーを候補 owner として check を作り、
        // whose / triggerFilter / eventMatcher を満たす set burst を持つ player のみ残す。
        // - responder 不在の check は積まない → 空 pass プロンプト解消。
        // - whose:opponent の burst が「相手の」イベントを拾える (opponent-routing)。
        // - whose:self / no-whose は subject (=relatedPlayerId) 側でのみ残る (従来挙動)。
        for (const player of state.players) {
          const candidate = buildBurstCheck(player.id);
          const sources = getAvailableBurstSourceChoices({
            state,
            pendingBurstCheck: candidate,
            getCardDefinitionById: burstDefLookup,
            getRegisteredBurstActions: burstLookup,
          });
          if (sources.length > 0) {
            pendingBurstChecks.push({
              ...candidate,
              activationSelected: false,
            });
          }
        }
      }
    }
    if (event.preFlushLeaveEvent && !event.suppressBurstCheck) {
      state = {
        ...state,
        pendingLeaveEntities: state.pendingLeaveEntities.map((leave) =>
          leave.instanceId === event.relatedInstanceId
            ? { ...leave, burstDeclarationChecked: true }
            : leave
        ),
      };
    }
  }

  const relatedIdsBySourceRegistrationKeyObject =
    relatedIdsBySourceRegistrationKey.size > 0
      ? Object.fromEntries(
          Array.from(relatedIdsBySourceRegistrationKey.entries()).map(
            ([key, ids]) => [key, [...ids]]
          )
        )
      : undefined;
  const attachRelatedIds = <
    T extends {
      relatedInstanceId: string | null;
      relatedInstanceIds?: string[];
      relatedInstanceIdsBySourceRegistrationKey?: Record<string, string[]>;
    },
  >(
    pending: T
  ): T => {
    const allRelatedIds = Array.from(
      new Set([
        ...(pending.relatedInstanceIds ?? []),
        ...(relatedIdsBySourceRegistrationKeyObject
          ? Object.values(relatedIdsBySourceRegistrationKeyObject).flat()
          : []),
      ])
    );
    if (!relatedIdsBySourceRegistrationKeyObject && allRelatedIds.length === 0)
      return pending;
    return {
      ...pending,
      ...(allRelatedIds.length > 0
        ? { relatedInstanceIds: allRelatedIds }
        : {}),
      ...(relatedIdsBySourceRegistrationKeyObject
        ? {
            relatedInstanceIdsBySourceRegistrationKey:
              relatedIdsBySourceRegistrationKeyObject,
          }
        : {}),
    };
  };
  const enrichedPendingTriggeredEffects =
    pendingTriggeredEffects.map(attachRelatedIds);
  const enrichedPendingPrivateDeclarations = pendingPrivateDeclarations
    .map(attachRelatedIds)
    .filter((declaration) => {
      if (options === null) return true;
      const sourceDefinition = options.getCardDefinitionById(
        declaration.sourceDefinitionId
      );
      return (
        sourceDefinition !== undefined &&
        isPrivateTriggeredDeclarationConditionMet({
          state,
          declaration,
          sourceDefinition,
          ...options,
        })
      );
    });

  state.log.push(
    ...enrichedPendingTriggeredEffects.map(
      (pendingEffect) =>
        `trigger:queued:${pendingEffect.pendingId}:${pendingEffect.eventKind}:${pendingEffect.actingPlayerId}`
    ),
    ...suppressedTriggerLogs,
    ...enrichedPendingPrivateDeclarations.map(
      (declaration) =>
        `trigger:private-declaration:queued:${declaration.declarationId}:${declaration.eventKind}:${declaration.ownerPlayerId}`
    ),
    ...pendingBurstChecks.map(
      (pendingBurstCheck) =>
        `burst:queued:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${pendingBurstCheck.relatedPlayerId}`
    )
  );
  // P3-36 Phase A: 非ターンプレイヤーの private declaration を先頭に並べる。
  // 同一プレイヤー内の挿入順は維持（stable sort）。
  const sortedPrivateDeclarations =
    sortPendingPrivateDeclarationsByTurnPriority(
      [
        ...state.pendingPrivateDeclarations,
        ...enrichedPendingPrivateDeclarations,
      ],
      state.activePlayerId
    );

  const queuedState = {
    ...state,
    pendingTriggeredEffects: [
      ...state.pendingTriggeredEffects,
      ...enrichedPendingTriggeredEffects,
    ],
    pendingPrivateDeclarations: sortedPrivateDeclarations,
    pendingBurstChecks: [...state.pendingBurstChecks, ...pendingBurstChecks],
    effectOccurrenceRecords: occurrenceRecords,
  };
  if (options === null) return queuedState;
  // 新しい未成立観測だけを空群から除く。既存の宣言/因果継続は収集途中にpruneしない。
  const dormantOnlyIds = new Set(
    enrichedPendingTriggeredEffects
      .filter(
        (pendingEffect) =>
          !!pendingEffect.dormantSourceRegistrationKeys?.length &&
          getAvailableTriggeredEffectSourceChoices({
            state: queuedState,
            pendingEffect,
            ...options,
          }).length === 0
      )
      .map((pending) => pending.pendingId)
  );
  if (dormantOnlyIds.size === 0) return queuedState;
  const checked = pruneIllegalPendingTriggeredEffects({
    state: queuedState,
    ...options,
  });
  const retainedIds = new Set(
    checked.pendingTriggeredEffects.map((pending) => pending.pendingId)
  );
  return {
    ...queuedState,
    pendingTriggeredEffects: queuedState.pendingTriggeredEffects.filter(
      (pending) =>
        !dormantOnlyIds.has(pending.pendingId) ||
        retainedIds.has(pending.pendingId)
    ),
  };
}

/**
 * ENGINE-effect-immunity-own-pending-resolution: `duration.scope ===
 * "while_own_declaration_pending"` は、宣言者自身の `effect_completed`
 * (効果発揮完了直後 hook、queueEffectActivationTriggers が relatedInstanceId=
 * 発揮元カード自身で emit する) を暗黙の untilEvents として扱う。カード DSL 側が
 * `untilEvents` を明示しなくても、このスコープを選ぶだけで「効果発揮後まで」の
 * 期限管理が完結する (current_effect が `pendingTargetedDisclosureContinuation`
 * 専用の別経路であるのとは対照的に、この scope は既存 untilEvents 除去 funnel に
 * 相乗りする)。
 */
function effectiveUntilEvents(
  duration: ContinuousEffect["duration"]
): readonly TriggerEventKind[] | undefined {
  if (duration.scope === "while_own_declaration_pending") {
    return duration.untilEvents
      ? [...duration.untilEvents, "effect_completed"]
      : ["effect_completed"];
  }
  return duration.untilEvents;
}

/**
 * ENGINE-continuous-effect-until-event-duration: `duration.untilEvents` を持つ
 * 継続効果を、集約された `CollectedTriggerEvent[]` に対して1回で判定・除去する。
 * イベントの `relatedInstanceId` が CE 自身の `targetInstanceId` と一致し、かつ
 * `eventKind` が `untilEvents` のいずれかに含まれれば早期終了する（OR結合）。
 * `targetInstanceId` 未設定の CE（player-scoped 等）は対象外。
 */
function removeUntilEventContinuousEffects(
  state: GameState,
  events: readonly CollectedTriggerEvent[]
): GameState {
  if (events.length === 0) {
    return state;
  }
  return updateCommittedContinuousEffects(state, (effects) => {
    const filtered = effects.filter((effect) => {
      const untilEvents = effectiveUntilEvents(effect.duration);
      if (
        !untilEvents ||
        untilEvents.length === 0 ||
        !effect.targetInstanceId
      ) {
        return true;
      }
      const expired = events.some(
        (event) =>
          untilEvents.includes(event.eventKind) &&
          event.relatedInstanceId === effect.targetInstanceId
      );
      return !expired;
    });

    return filtered.length === effects.length ? effects : filtered;
  });
}

/**
 * P3-39: production 経路で誘発イベントを pending キューへ積む正本関数。
 *
 * `options` を必須化することで、lookup を渡し忘れた呼び出し側を **TypeScript コンパイル時に**
 * 検出する。これを optional にしていた頃、production 側で渡し忘れが起きるたびに
 * リスナー無し event が空 pending として永久残留するバグを 3 回繰り返した:
 * P3-37 (step_transition) / 743cc69 (end_attack_step) / 8ccc731 (action_resolution)。
 *
 * テストで lookup 解決を行わず raw pending を直接積みたい場合は
 * `queuePendingReactionsRawForTesting` を使うこと。
 */
export function queuePendingReactionsFromTriggerEvents(
  rawState: GameState,
  inputEvents: readonly CollectedTriggerEvent[],
  externalSimultaneousGroupId: string | undefined,
  options: {
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
    getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  }
): GameState {
  // ENGINE-continuous-effect-until-event-duration: 全 production 経路が集約する
  // 単一 funnel のため、ここで duration.untilEvents 早期終了判定を行う
  // (BSLH01-T17 想定)。raw fallback / production 分岐どちらにも適用するため
  // 分岐より前で処理する。
  const delivered = new Set(
    (rawState.semanticTriggerEvents ?? [])
      .filter((entry) => entry.delivered)
      .map((entry) => entry.semanticEventId)
  );
  const acceptedIds = new Set<number>();
  const events = inputEvents.filter((event) => {
    if (event.semanticEventId === undefined) return true;
    if (
      delivered.has(event.semanticEventId) ||
      acceptedIds.has(event.semanticEventId)
    )
      return false;
    acceptedIds.add(event.semanticEventId);
    return true;
  });
  const withReceipts =
    acceptedIds.size === 0
      ? rawState
      : {
          ...rawState,
          semanticTriggerEvents: (rawState.semanticTriggerEvents ?? []).map(
            (entry) =>
              acceptedIds.has(entry.semanticEventId)
                ? { ...entry, delivered: true }
                : entry
          ),
        };
  const state = removeUntilEventContinuousEffects(withReceipts, events);
  // P3-39: TS が必須化済みなので production はここを通らない。
  // テストが TS を bypass して `undefined as never` 等を渡してきた場合は raw fallback で
  // 互換挙動を維持しつつ console.warn で気づけるようにする。
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.getCardDefinitionById !== "function" ||
    typeof options.getRegisteredTriggeredEffectActions !== "function"
  ) {
    const g = globalThis as { console?: { warn?: (msg: string) => void } };
    if (typeof g.console?.warn === "function") {
      g.console.warn(
        "[orica/rules-core] queuePendingReactionsFromTriggerEvents was called " +
          "with missing lookup options; falling back to raw push. " +
          "Production code must thread getCardDefinitionById and " +
          "getRegisteredTriggeredEffectActions. Use queuePendingReactionsRawForTesting() " +
          "explicitly in tests."
      );
    }
    return queueReactionsInternal(
      state,
      events,
      externalSimultaneousGroupId,
      null
    );
  }
  return queueReactionsInternal(
    state,
    events,
    externalSimultaneousGroupId,
    options
  );
}

/** カード使用の本体と派生効果が閉じた安定点で、使用後の誘発を通知する。 */
export function finalizeCardUsageAndQueueTriggers(
  state: GameState,
  options: {
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
    getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
  }
): GameState {
  const usages = state.flashCardUsageLog.filter(
    (entry) => entry.completion === "resolving"
  );
  if (
    usages.length === 0 ||
    hasOutstandingEffectResolutionContinuation(state) ||
    state.stackWindow !== null ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingBurstChecks.length > 0 ||
    state.battleImmediateEffects.length > 0
  )
    return state;
  // 本体・派生・選択を解決した後で一度だけ使用後を通知する。使用時の定義は転醒後も保持する。
  const completed: GameState = {
    ...state,
    flashCardUsageLog: state.flashCardUsageLog.map((entry) =>
      entry.completion === "resolving"
        ? { ...entry, completion: "completed" }
        : entry
    ),
  };
  return queuePendingReactionsFromTriggerEvents(
    completed,
    usages.map((usage) => ({
      eventKind: "card_used",
      source: "action_resolution",
      actingPlayerId: usage.playerId,
      relatedPlayerId: usage.playerId,
      relatedInstanceId: usage.cardInstanceId,
      effectSourceInstanceId: usage.cardInstanceId,
      effectSourceDefinitionId: usage.cardDefinitionId,
      chainId: usage.chainId,
      attackId: usage.attackId,
      amount: 1,
    })),
    undefined,
    {
      ...options,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ??
        EMPTY_TRIGGERED_EFFECT_ACTION_REGISTRATION_LOOKUP,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * @internal テスト専用: source 解決をスキップして raw pending を直接積む。
 * production コードでは絶対に使わないこと。リスナー判定が走らないため、
 * `pendingTriggeredEffects` に空 pending（resolve 不能）が残留する。
 *
 * 既存テストの「state を直接組み立て、lookup を渡さずに raw pending を生成して
 * 別の機能（sort 順、simultaneousGroupId 付与など）を検証する」用途のために残す。
 */
export function queuePendingReactionsRawForTesting(
  state: GameState,
  events: readonly CollectedTriggerEvent[],
  externalSimultaneousGroupId?: string
): GameState {
  return queueReactionsInternal(
    state,
    events,
    externalSimultaneousGroupId,
    null
  );
}

/**
 * 未解決の pending triggered effects を simultaneousGroupId でグループ化して返す。
 * - groupId を持つ効果は Map のキー (groupId → effects[]) にまとめられる。
 * - groupId を持たない効果はキー "ungrouped" にまとめられる。
 *
 * 将来の UI で同時誘発グループの解決順選択に使う。
 */
export function getSimultaneousGroups(
  state: GameState
): Map<string, PendingTriggeredEffect[]> {
  const groups = new Map<string, PendingTriggeredEffect[]>();
  for (const pe of state.pendingTriggeredEffects) {
    const key = pe.simultaneousGroupId ?? "ungrouped";
    const group = groups.get(key);
    if (group) {
      group.push(pe);
    } else {
      groups.set(key, [pe]);
    }
  }
  return groups;
}

/**
 * P3-108: コスト支払いによるコア不足消滅の離脱誘発（「消滅したとき / 離れたとき」/
 * 相手の消滅バースト）を、支払い直後（消滅待機中・flush 前）に収集する。
 *
 * 背景: コスト支払い消滅は `runActionMainResolution` の差分窓より前に発生し、かつチェーン
 * 終端で flush されるため、後段 finalize の collect（before=支払い後 / after=flush 前）では
 * 「消滅待機への遷移」も「物理離脱」も境界に現れず取りこぼす。支払い前 state を before に、
 * 支払い後（消滅待機中）state を after にして収集すると `card_vanished`（消滅したとき）が
 * 境界（not-pending → pending または pending kind 遷移）で検出される。コスト支払いの
 * コア移動はトリガー対象イベントを生成しないため、消滅以外の誘発は増えない。
 * 新規 cost_payment 待機が無ければ no-op。
 */
export function collectCostPaymentVanishTriggers(options: {
  beforeState: GameState;
  afterState: GameState;
  chainId: string;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const beforePendingByInstanceId = new Map(
    options.beforeState.pendingLeaveEntities.map((p) => [p.instanceId, p])
  );
  const newCostVanishIds = new Set(
    options.afterState.pendingLeaveEntities
      .filter((p) => {
        if (p.kind !== "vanish" || p.cause !== "cost_payment") return false;
        const beforePending = beforePendingByInstanceId.get(p.instanceId);
        return (
          beforePending === undefined ||
          beforePending.kind !== p.kind ||
          beforePending.cause !== p.cause
        );
      })
      .map((p) => p.instanceId)
  );
  if (newCostVanishIds.size === 0) return options.afterState;

  const events = collectTriggerEventsFromStateDelta({
    beforeState: options.beforeState,
    afterState: options.afterState,
    source: "action_resolution",
    chainId: options.chainId,
    causedByPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
  })
    .filter(
      (event) =>
        event.eventKind === "vanish" &&
        event.relatedInstanceId !== null &&
        newCostVanishIds.has(event.relatedInstanceId)
    )
    .map((event) => ({
      ...event,
      exactGameEventKind: true,
      suppressBurstCheck: true,
    }));
  const filtered = filterOptInTriggerEvents(
    events,
    options.afterState,
    options.getCardDefinitionById
  );
  return queuePendingReactionsFromTriggerEvents(
    options.afterState,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

function mergeUniqueColors(
  base: readonly CardColor[],
  extra: readonly CardColor[]
): CardColor[] {
  const colors = [...base];
  for (const color of extra) {
    if (!colors.includes(color)) colors.push(color);
  }
  return colors;
}

function recordTurnSummonedCardsFromEvents(
  state: GameState,
  events: readonly CollectedTriggerEvent[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  const summonEvents = events.filter(
    (event) =>
      event.eventKind === "summon" &&
      event.relatedPlayerId !== null &&
      event.relatedInstanceId !== null
  );
  if (summonEvents.length === 0) return state;

  const refsByKey = new Map<string, TurnSummonedCardRef>();
  const attackStepSummonedIds = new Set(
    state.summonedDuringAttackStepInstanceIds ?? []
  );
  for (const ref of state.turnSummonedCardRefs ?? []) {
    refsByKey.set(`${ref.playerId}:${ref.instanceId}`, { ...ref });
  }

  const immediateJoins = [...(state.pendingImmediateAttackJoins ?? [])];
  let changed = false;
  for (const event of summonEvents) {
    const instanceId = event.relatedInstanceId;
    const playerId = event.relatedPlayerId;
    if (instanceId === null || playerId === null) continue;
    const card = getCardById(state, instanceId);
    if (!card) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;

    // 通常プレイ・効果・維持コア選択後の全召喚で同じ確定イベントを使う。
    // 合体先の部品や未成立の場入りを、独立してアタックできる召喚体にしない。
    if (
      state.step === "attack" &&
      card.zone === "field" &&
      card.attachedToInstanceId === null &&
      !isAwaitingEffectEntryCores(state, instanceId) &&
      !attackStepSummonedIds.has(instanceId)
    ) {
      attackStepSummonedIds.add(instanceId);
      changed = true;
    }

    const attack = state.activeAttack;
    if (
      state.step === "attack" &&
      attack !== null &&
      playerId === state.activePlayerId &&
      card.zone === "field" &&
      card.attachedToInstanceId === null &&
      !isAwaitingEffectEntryCores(state, instanceId) &&
      !attack.blockDeclarationCompleted &&
      !attack.blockAssignments.some(
        (assignment) => assignment.blockedByEntityIds.length > 0
      ) &&
      getMidBattleJoinGrant(state, playerId) !== null &&
      !immediateJoins.some(
        (entry) =>
          entry.attackId === attack.attackId &&
          entry.sourceInstanceId === instanceId
      )
    ) {
      immediateJoins.push({
        attackId: attack.attackId,
        sourceInstanceId: instanceId,
      });
      changed = true;
    }

    const key = `${playerId}:${instanceId}`;
    const colors = getEffectiveColors(state, card, def);
    const existing = refsByKey.get(key);
    if (existing) {
      const mergedColors = mergeUniqueColors(existing.colors, colors);
      if (mergedColors.length !== existing.colors.length) {
        refsByKey.set(key, { ...existing, colors: mergedColors });
        changed = true;
      }
      continue;
    }

    const category = getEffectiveCategory(state, card, def);
    refsByKey.set(key, {
      playerId,
      instanceId,
      definitionId: card.definitionId,
      colors,
      ...(category !== undefined ? { category } : {}),
      tribes: getEffectiveTribes(state, card, def, getCardDefinitionById),
    });
    changed = true;
  }

  if (!changed) return state;
  return {
    ...state,
    turnSummonedCardRefs: Array.from(refsByKey.values()),
    pendingImmediateAttackJoins: immediateJoins,
    ...(attackStepSummonedIds.size > 0
      ? { summonedDuringAttackStepInstanceIds: [...attackStepSummonedIds] }
      : {}),
  };
}

/**
 * collect + queue を 1 ステップにまとめた共通節目ヘルパー。
 *
 * P3-39: lookup を型レベルで必須化。lookup を渡さずに call すると TypeScript エラーになる
 * (production で渡し忘れた場合に空 pending が累積するバグの再発防止)。
 * runtime で lookup が undefined のときは raw push に fallback する (テスト互換)。
 */
export function collectAndQueueTriggerReactions(options: {
  beforeState: GameState;
  afterState: GameState;
  source: TriggerEventSource;
  /** 差分収集の対象原因。null は複数の離脱原因を各 PendingLeaveEntity から読む指定で、生成する誘発の空IDではない。 */
  chainId: string | null;
  attackId?: string | null;
  simultaneousGroupId?: string;
  /** card_exhausted 等、登録がなければ空振りするイベントのフィルタ用 */
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  /** P3-68 ギャップ 1: increase_hand cause の grower-relative 導出用 (効果コントローラ)。 */
  causedByPlayerId?: string | null;
  /**
   * この差分を引き起こした効果の発揮元カード。創界石の解封条件
   * 「〜を持つ自分の効果による自分の手札の増加」の原因カード判定に使う。
   * 未 thread の経路では null （causeFilter 付き解封条件は fail-closed）。
   */
  causedBySourceInstanceId?: string | null;
  /**
   * 効果解決由来の場入りイベントにだけ cause を付ける。通常召喚/配置/煌臨は undefined。
   */
  enterFieldCausedByPlayerId?: string | null;
  /** 通常プレイの発揮元など、cause 付与から除外する場入り instance。 */
  enterFieldCauseExcludedInstanceIds?: readonly string[];
  /** 煌臨の実際の宣言種別。借用・上書きした煌臨も印字ではなく宣言を参照する。 */
  adventVariant?: "normal" | "contract" | "f_contract";
  /** enter_field event を起こした効果 index。通常召喚/配置では undefined。 */
  sourceEffectIndex?: number;
  /** 支払いchoiceなど、同じ誘発タイミング束に合流させる補助イベント。 */
  supplementalEvents?: readonly SupplementalTriggerEvent[];
}): GameState {
  // after_triggers で解決区間を収集して中断済みなら、外側 finalize で同じ差分を再収集しない。
  const segmentAlreadyCollected =
    options.chainId != null &&
    options.afterState.pendingAfterTriggersContinuations.some(
      (continuation) => continuation.chainId === options.chainId
    );
  const collectedEvents = segmentAlreadyCollected
    ? []
    : collectTriggerEventsFromStateDelta({
        beforeState: options.beforeState,
        afterState: options.afterState,
        source: options.source,
        chainId: options.chainId ?? null,
        attackId: options.attackId ?? null,
        causedByPlayerId: options.causedByPlayerId ?? null,
        // P3-14 C-2: core_placed_on_life の原因カード (trigger_colors 評価用) を forward。
        causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
        ...(options.enterFieldCausedByPlayerId !== undefined
          ? { enterFieldCausedByPlayerId: options.enterFieldCausedByPlayerId }
          : {}),
        ...(options.enterFieldCauseExcludedInstanceIds !== undefined
          ? {
              enterFieldCauseExcludedInstanceIds:
                options.enterFieldCauseExcludedInstanceIds,
            }
          : {}),
        ...(options.sourceEffectIndex !== undefined
          ? { sourceEffectIndex: options.sourceEffectIndex }
          : {}),
        ...(options.adventVariant !== undefined
          ? { adventVariant: options.adventVariant }
          : {}),
        // 転醒検出に必要なカード定義ルックアップを forward (front→back flip 判定用)。
        getCardDefinitionById: options.getCardDefinitionById,
      });
  const events = [...collectedEvents, ...(options.supplementalEvents ?? [])];

  const afterStateWithTurnSummonRecords = recordTurnSummonedCardsFromEvents(
    options.afterState,
    events,
    options.getCardDefinitionById
  );

  // P3-39: filter は getCardDefinitionById のみで動作するため、それが function なら適用。
  // 旧 wrapper は `options.getCardDefinitionById ? filter : skip` だったので互換性維持。
  const filtered =
    typeof options.getCardDefinitionById === "function"
      ? filterOptInTriggerEvents(
          events,
          afterStateWithTurnSummonRecords,
          options.getCardDefinitionById
        )
      : events;

  // pendingDrawEvents を消費済みとしてクリア（二重発火防止）
  const semanticIds = new Set(
    events.flatMap((e) =>
      e.semanticEventId === undefined ? [] : [e.semanticEventId]
    )
  );
  // Unobserved facts are consumed too, so listeners entering later cannot see an old operation.
  // Queue receives the pre-delivery state and writes receipts for observed facts itself.
  const unobservedIds = new Set(
    [...semanticIds].filter(
      (id) => !filtered.some((e) => e.semanticEventId === id)
    )
  );
  let stateForQueue =
    unobservedIds.size === 0
      ? afterStateWithTurnSummonRecords
      : {
          ...afterStateWithTurnSummonRecords,
          semanticTriggerEvents: (
            afterStateWithTurnSummonRecords.semanticTriggerEvents ?? []
          ).map((e) =>
            unobservedIds.has(e.semanticEventId) ? { ...e, delivered: true } : e
          ),
        };
  if (stateForQueue.pendingDrawEvents?.length) {
    const { pendingDrawEvents: _, ...rest } = stateForQueue;
    stateForQueue = rest as GameState;
  }

  // 途中の任意選択等で区切られても、同じ原因効果から生じる反応は同じ束に保つ。
  let derivedGroupId =
    options.simultaneousGroupId ??
    stateForQueue.battleImmediateEffects.find(
      (prompt) =>
        options.chainId != null && prompt.causedByChainId === options.chainId
    )?.simultaneousGroupId;
  const withNewBattleEffects = segmentAlreadyCollected
    ? stateForQueue
    : queueNewlyEnabledBattleImmediateEffects({
        beforeState: options.beforeState,
        afterState: stateForQueue,
        getCardDefinitionById: options.getCardDefinitionById,
        chainId: options.chainId ?? null,
        getSimultaneousGroupId: () =>
          (derivedGroupId ??= createSimultaneousGroupId()),
      });
  let queuedState = queuePendingReactionsFromTriggerEvents(
    withNewBattleEffects,
    filtered,
    derivedGroupId,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );

  // Typed summon facts reach oracle at the same boundary as ordinary reactions,
  // including after_triggers segments that are consumed before outer finalize.
  const semanticSummons = events.filter(
    (event) =>
      event.semanticEventId !== undefined &&
      event.eventKind === "summon" &&
      event.relatedInstanceId !== null
  );
  if (semanticSummons.length > 0) {
    queuedState = checkAndQueueOracleChoicesForTriggerBatch(
      queuedState,
      semanticSummons.map((event) => ({
        triggerCardInstanceId: event.relatedInstanceId!,
        triggerKind: "summon",
      })),
      options.getCardDefinitionById,
      options.chainId ?? `semantic-entry:${semanticSummons[0]!.semanticEventId}`
    );
  }

  // 創界石: 解封トリガー（summon / rebirth / increase_hand）の検出。
  // filterOptInTriggerEvents はリスナー未登録イベントを落とすため、
  // フィルタ前の events を渡す（解封は自前でマッチングする）。
  if (typeof options.getCardDefinitionById === "function") {
    queuedState = queueUnsealChoicesFromTriggerEvents(
      queuedState,
      events,
      options.getCardDefinitionById
    );
    // 創界石: コア数が転醒閾値を下から跨いだ遷移を検出（創界石対象効果による
    // コア追加もここで捕捉する。解封受諾分は resolveUnsealChoice 側で検出済み）。
    queuedState = checkAndQueueStoneRebirthChoices(
      options.beforeState,
      queuedState,
      options.getCardDefinitionById,
      options.chainId
    );
    // P3-99 §3: grant_effect で付与された誘発効果の発火検出（被付与カードのイベント）。
    // active な granted_effect CE が無ければ早期 return（hot-path 保護）。
    // unseal と同じく filter 前 events を渡す（自前でイベントマッチングする）。
    queuedState = queueGrantedEffectTriggersFromTriggerEvents(
      queuedState,
      events,
      options.getCardDefinitionById
    );
  }

  // lookup を省略した低水準テストの raw event は、実在する誘発効果を表さない。
  return typeof options.getRegisteredTriggeredEffectActions === "function"
    ? trackPendingLeaveResolutionReactions(
        options.beforeState,
        queuedState,
        options.chainId ?? null
      )
    : queuedState;
}

/**
 * pre_declaration_stack 窓に入った直後に呼び、
 * アタック/ブロック宣言前トリガー（`pre_declaration_attack` / `pre_declaration_block`）を pending キューに積む。
 *
 * - `windowKind === "attack"` → eventKind `"pre_declaration_attack"`
 * - `windowKind === "block" | "forced_block"` → eventKind `"pre_declaration_block"`
 * - `sourceInstanceId` が null の場合（forced_block 等）は card_event 経由の発火は起きず、
 *   game_event 経由でのみ発火する（relatedInstanceId=null）。
 * - `getCardDefinitionById` が渡されると OPT_IN_TRIGGER_EVENT_KINDS フィルタを適用し、
 *   該当カードに `pre_declaration_{attack,block}` の card_event timing 効果がなければ pending を作らない。
 */
export function queuePreDeclarationStackTriggers(options: {
  state: GameState;
  windowKind: "attack" | "block" | "forced_block";
  sourceInstanceId: string | null;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const eventKind: TriggerEventKind =
    options.windowKind === "attack"
      ? "pre_declaration_attack"
      : "pre_declaration_block";

  const relatedInstanceId = options.sourceInstanceId;
  const relatedPlayerId = relatedInstanceId
    ? (getCardById(options.state, relatedInstanceId)?.controllerPlayerId ??
      null)
    : null;

  const root = allocateRootTriggerChain(options.state);
  const event: CollectedTriggerEvent = {
    actingPlayerId: options.actingPlayerId,
    eventKind,
    source: "action_resolution",
    chainId: root.chainId,
    attackId: null,
    relatedPlayerId,
    relatedInstanceId,
    amount: null,
  };

  const filtered = filterOptInTriggerEvents(
    [event],
    options.state,
    options.getCardDefinitionById
  );

  return queuePendingReactionsFromTriggerEvents(
    root.state,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * 召喚 / ネクサス配置 / マジック使用のコスト支払い直後に呼び、
 * `after_cost_paid` トリガーを pending キューに積む。
 *
 * - `sourceInstanceId` は支払いを完了したカード (使用中カード)。
 * - card_event 経由の発火は支払いを完了したカード自身の `after_cost_paid` timing のみ対象。
 *   他カードが反応する場合は game_event timing で個別に対応 (現状は OPT_IN フィルタで card_event のみ通過)。
 * - `getCardDefinitionById` が渡されると OPT_IN_TRIGGER_EVENT_KINDS フィルタを適用し、
 *   該当カードに `after_cost_paid` の card_event timing 効果がなければ pending を作らない。
 */
export function queueAfterCostPaidTriggers(options: {
  chainId: string;
  state: GameState;
  sourceInstanceId: string | null;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const relatedInstanceId = options.sourceInstanceId;
  const relatedPlayerId = relatedInstanceId
    ? (getCardById(options.state, relatedInstanceId)?.controllerPlayerId ??
      null)
    : null;

  const event: CollectedTriggerEvent = {
    actingPlayerId: options.actingPlayerId,
    eventKind: "after_cost_paid",
    source: "action_resolution",
    chainId: options.chainId,
    attackId: null,
    relatedPlayerId,
    relatedInstanceId,
    amount: null,
  };

  const filtered = filterOptInTriggerEvents(
    [event],
    options.state,
    options.getCardDefinitionById
  );

  return queuePendingReactionsFromTriggerEvents(
    options.state,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * バトルが解決し終えた時点で、バトル参加カード自身の「バトル終了時」
 * (`card_event: "battle_end"`) 効果を pending キューに積む。
 *
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」。
 * `アタックステップ終了時` (step_timing) とは区別する。
 *
 * - `participantInstanceIds` はバトル参加カード (攻撃側メンバー + ブロック側メンバー)。
 *   呼び出し元 (`executeBattleResolution`) が battleResolutionGroup の snapshot から収集する。
 * - OPT_IN_TRIGGER_EVENT_KINDS フィルタにより、`battle_end` の card_event timing 効果を
 *   持たない参加カードでは pending を作らない。
 * - structured event は require_related_instance_on_field 検証のため、バトル中に破壊された
 *   参加カードの自己誘発は解決時に弾かれる (バトル終了時にフィールド残存する参加カードのみ)。
 */
export function queueBattleEndTriggers(options: {
  state: GameState;
  participantInstanceIds: readonly string[];
  attackId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  /**
   * P3-14 C-5: このバトル中の破壊記録 (ActiveAttack.battleDestroyedRecords)。
   * 各参加カードの battle_end イベント amount に「そのカードのコントローラが
   * このバトルで破壊した相手のスピリット/アルティメット数」を載せる
   * (BSTH01-R02「このバトルで破壊した相手のスピリット/アルティメット1体につき」)。
   */
  destroyedRecords?: readonly import("../model").BattleDestroyedRecord[];
  /**
   * P3-14 C-5: ブロック側参加カードの instanceId 集合。
   * 含まれる参加カードのイベントは actionKind:"block"、それ以外は "attack" になる。
   */
  blockSideInstanceIds?: readonly string[];
}): GameState {
  const countDestroyedOpponentSpiritsFor = (playerId: string): number => {
    if (!options.destroyedRecords) return 0;
    return options.destroyedRecords.filter((record) => {
      if (record.causePlayerId !== playerId) return false;
      if (record.ownerPlayerId === playerId) return false;
      const def = options.getCardDefinitionById(record.definitionId);
      return (
        def?.printedCategory === "spirit" || def?.printedCategory === "ultimate"
      );
    }).length;
  };

  const blockSide = new Set(options.blockSideInstanceIds ?? []);
  const events: CollectedTriggerEvent[] = [];
  // 形式4 (game_event:battle_end + player:"either", BSDB01-M01[2] 想定) を成立させる
  // ため per-responder × per-participant に展開する (queueBattleDeclarationTriggers と
  // 同パターン)。pending.actingPlayerId = 応答側 (= source 管理者) とすることで、
  // getTriggeredEffectSourceUseBlockReason の whose 既定 "self" が
  // 「相手側参加バトルの第三者観測」を弾かないようにする。
  // - 形式1 (card_event:battle_end 自己) は relatedInstanceId===source 制約で
  //   非応答側 responder からは source 候補が空になり二重発火しない (回帰なし)。
  // - 形式3 (game_event:battle_end + player:"self") は timing.player による
  //   relatedPlayer ≠ source.controller 棄却で非応答側 responder の event は弾かれる
  //   (回帰なし)。
  // - relatedPlayerId は依然として参加カード controller。
  //   timing.player ("self" / "opponent") はこの relatedPlayerId と source.controller で
  //   判定するため意味が変わらない。
  // - amount (countDestroyedOpponentSpiritsFor) は引き続き参加カード controller 基準
  //   (形式1/3 の従来意味と整合。BSTH01-R02『このバトルで破壊した相手の…』は形式1/3 のみ)。
  // 「このカードとバトルした」対戦相手側参加体 (BSAZ02-R02「ニロケラス」「このアルティメットと
  // バトルしたスピリット/アルティメットは、ただちに除外される」等) を relatedInstanceIds に
  // 積む。アタック側/ブロック側の反対サイド = 自分の対戦相手。`TargetSpec.trigger_related_instances`
  // が stepContext.triggerRelatedInstanceIds 経由でこの一覧を対象解決に使う
  // (dsl-types.ts:593 コメント「同じ trigger に紐づく追加主語」)。既存カードは
  // relatedInstanceIds 未設定のまま battle_end を消費しており、このフィールドの追加は
  // 純粋加算 (回帰なし)。
  const opponentSideOf = (participantInstanceId: string): readonly string[] => {
    const onBlockSide = blockSide.has(participantInstanceId);
    return options.participantInstanceIds.filter(
      (id) => blockSide.has(id) !== onBlockSide
    );
  };

  for (const participantInstanceId of options.participantInstanceIds) {
    const card = getCardById(options.state, participantInstanceId);
    if (!card) continue;
    const relatedInstanceIds = opponentSideOf(participantInstanceId);
    for (const player of options.state.players) {
      events.push({
        actingPlayerId: player.id,
        eventKind: "battle_end",
        source: "battle_resolution",
        chainId: options.attackId,
        attackId: options.attackId,
        relatedPlayerId: card.controllerPlayerId,
        relatedInstanceId: participantInstanceId,
        ...(relatedInstanceIds.length > 0 ? { relatedInstanceIds } : {}),
        amount: countDestroyedOpponentSpiritsFor(card.controllerPlayerId),
        // P3-14 C-5: アタック側/ブロック側を actionKind で区別し、
        // 『このスピリットのアタック時』スコープの battle_end (BSTH01-R02) を
        // Timing.action:"attack" + eventMatcher.actionKind で絞れるようにする。
        actionKind: blockSide.has(participantInstanceId) ? "block" : "attack",
      });
    }
  }

  if (events.length === 0) return options.state;

  const filtered = filterOptInTriggerEvents(
    events,
    options.state,
    options.getCardDefinitionById
  );

  return queuePendingReactionsFromTriggerEvents(
    options.state,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * P3-73: 相手フラッシュ効果使用の誘発イベントを発火する。
 * 咲夜 BSTH01-X05「相手が手札/手元のフラッシュ効果を使用したとき」が
 * 非公開キュー経由で反応するための入口。relatedPlayerId にフラッシュ使用者を載せ、
 * game_event の player:"opponent" フィルタで「使用者 ≠ ソース管理者」を判定させる。
 * 発揮前に反応する誘発のため、使用者が ActiveStack へ積んだ（未解決の）フラッシュに対して
 * 呼ぶ。リスナーが居なければ filterOptInTriggerEvents で空振り除外される。
 */
export function queueFlashUsedTriggers(options: {
  chainId: string;
  state: GameState;
  flashSourceInstanceId: string;
  userPlayerId: string;
  flashSourceFromZone?: import("../model").Zone;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  // 誘発候補列挙の規約: pending.actingPlayerId = 応答側 (= source 管理者)、
  // relatedPlayerId = イベントの主体 (フラッシュ使用者)。getTriggeredEffectSourceUseBlockReason
  // が whose 既定 "self" で「source は actingPlayerId が管理」を要求するため、相手の
  // フラッシュに反応する効果 (咲夜 BSTH01-X05, player:"opponent") の source 管理者を
  // actingPlayerId に据える。player:"opponent" フィルタは relatedPlayer(主体) ≠ source管理者で判定。
  const responderPlayerId =
    options.state.players.find((player) => player.id !== options.userPlayerId)
      ?.id ?? options.userPlayerId;
  const flashSourceFromZone =
    options.flashSourceFromZone ??
    getCardById(options.state, options.flashSourceInstanceId)?.zone;
  const event: CollectedTriggerEvent = {
    actingPlayerId: responderPlayerId,
    eventKind: "flash",
    source: "action_resolution",
    chainId: options.chainId,
    attackId: options.state.activeAttack?.attackId ?? null,
    relatedPlayerId: options.userPlayerId,
    relatedInstanceId: options.flashSourceInstanceId,
    amount: null,
    ...(flashSourceFromZone !== undefined
      ? { fromZone: flashSourceFromZone }
      : {}),
  };

  const filtered = filterOptInTriggerEvents(
    [event],
    options.state,
    options.getCardDefinitionById
  );

  return queuePendingReactionsFromTriggerEvents(
    options.state,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * ENGINE-stack-activation-reactivation-trigger: 相手のスタック効果 (mode:"stack") の
 * 完全解決後に誘発イベントを発火する。BSTH02.7-X01 effects[2]「相手がスタック効果を
 * 発揮したとき」が非公開キュー経由で反応するための入口。queueFlashUsedTriggers と同じ
 * private declaration 基盤を使うが、magic_stack_domain (10_rules/08c) と同じ「効果解決が
 * 完全に終わった後」の裁定に合わせ、無効化/対象不発で発揮そのものが成立しなかった
 * ケースでは呼ばない (呼び出し元 resolveDeferredMagicStack が isNullified / 対象不発の
 * 早期 return では呼ばず、実解決が完了した経路でのみ呼ぶ)。
 */
/**
 * P3-114 / ENGINE-stack-activation-reactivation-trigger: 呼び出し元が実際に見出しラベル
 * 位置の【スタック】効果を解決したか (= queueStackEffectUsedTriggers を呼んでよいか) を判定する。
 * 03c:44-47 のフラッシュ側裁定と同型 — `activationLabel:"none"`(本文中でスタックタイミングを
 * 実行可能窓として使うだけの非スタック効果、例: 転醒/裏返し) は除外し、`activationLabel` 未指定
 * のときのみ `chosenTiming` にフォールバックする。
 * `effectActivationTimingForStack()` は "none" を常に `chosenTiming` へ畳み込むため
 * (`effect_declaration` の timing マッチャー値生成専用でその畳み込みが正しい)、"none" ラベルの
 * スタック実行窓利用を除外できずこの判定には使えない。
 */
export function isLabeledStackEffectActivation(stack: {
  chosenTiming?: ActiveStack["chosenTiming"];
  activationLabel?: ActiveStack["activationLabel"];
}): boolean {
  return (stack.activationLabel ?? stack.chosenTiming) === "stack";
}

export function queueStackEffectUsedTriggers(options: {
  chainId: string;
  state: GameState;
  stackSourceInstanceId: string;
  userPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  // queueFlashUsedTriggers と同じ規約: pending.actingPlayerId = 応答側 (= source 管理者)、
  // relatedPlayerId = イベントの主体 (スタック効果使用者)。
  const responderPlayerId =
    options.state.players.find((player) => player.id !== options.userPlayerId)
      ?.id ?? options.userPlayerId;
  const event: CollectedTriggerEvent = {
    actingPlayerId: responderPlayerId,
    eventKind: "stack",
    source: "action_resolution",
    chainId: options.chainId,
    attackId: options.state.activeAttack?.attackId ?? null,
    relatedPlayerId: options.userPlayerId,
    relatedInstanceId: options.stackSourceInstanceId,
    amount: null,
  };

  const filtered = filterOptInTriggerEvents(
    [event],
    options.state,
    options.getCardDefinitionById
  );

  return queuePendingReactionsFromTriggerEvents(
    options.state,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

export function createEffectActivationTriggerEvent(options: {
  eventKind?: "effect_activated" | "effect_completed";
  chainId: string;
  state: GameState;
  activatorPlayerId: string;
  relatedInstanceId: string;
  effectSourceTotalReduction?: number;
  effectSourceSatisfiedReductionSymbolCount?: number;
  effectSourceRequiredReductionSymbolCount?: number;
  eligibleSourceInstanceIds?: readonly string[];
}): CollectedTriggerEvent {
  return {
    actingPlayerId: options.activatorPlayerId,
    eventKind: options.eventKind ?? "effect_activated",
    source: "action_resolution",
    chainId: options.chainId,
    attackId: options.state.activeAttack?.attackId ?? null,
    relatedPlayerId: options.activatorPlayerId,
    relatedInstanceId: options.relatedInstanceId,
    amount: null,
    ...(options.effectSourceTotalReduction !== undefined
      ? { effectSourceTotalReduction: options.effectSourceTotalReduction }
      : {}),
    ...(options.effectSourceSatisfiedReductionSymbolCount !== undefined
      ? {
          effectSourceSatisfiedReductionSymbolCount:
            options.effectSourceSatisfiedReductionSymbolCount,
        }
      : {}),
    ...(options.effectSourceRequiredReductionSymbolCount !== undefined
      ? {
          effectSourceRequiredReductionSymbolCount:
            options.effectSourceRequiredReductionSymbolCount,
        }
      : {}),
    ...(options.eligibleSourceInstanceIds !== undefined
      ? { eligibleSourceInstanceIds: options.eligibleSourceInstanceIds }
      : {}),
  };
}

export function collectEffectActivationStartLatchSourceInstanceIds(
  options: Parameters<typeof collectEffectActivationLatchForEvent>[0]
): string[] {
  return [
    ...new Set(
      ["effect_activated", "effect_completed"].flatMap((eventKind) =>
        collectEffectActivationLatchForEvent(
          options,
          eventKind as "effect_activated" | "effect_completed"
        )
      )
    ),
  ];
}

function collectEffectActivationLatchForEvent(
  options: {
    state: GameState;
    activatorPlayerId: string;
    relatedInstanceId: string | null;
    effectSourceTotalReduction?: number;
    effectSourceSatisfiedReductionSymbolCount?: number;
    effectSourceRequiredReductionSymbolCount?: number;
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  },
  eventKind: "effect_activated" | "effect_completed"
): string[] {
  if (options.relatedInstanceId === null) return [];
  if (
    typeof options.getCardDefinitionById !== "function" ||
    typeof options.getRegisteredTriggeredEffectActions !== "function"
  ) {
    return [];
  }

  const event = createEffectActivationTriggerEvent({
    eventKind,
    chainId: `activation-probe:${options.relatedInstanceId}`,
    state: options.state,
    activatorPlayerId: options.activatorPlayerId,
    relatedInstanceId: options.relatedInstanceId,
    ...(options.effectSourceTotalReduction !== undefined
      ? { effectSourceTotalReduction: options.effectSourceTotalReduction }
      : {}),
    ...(options.effectSourceSatisfiedReductionSymbolCount !== undefined
      ? {
          effectSourceSatisfiedReductionSymbolCount:
            options.effectSourceSatisfiedReductionSymbolCount,
        }
      : {}),
    ...(options.effectSourceRequiredReductionSymbolCount !== undefined
      ? {
          effectSourceRequiredReductionSymbolCount:
            options.effectSourceRequiredReductionSymbolCount,
        }
      : {}),
  });
  const structuredEvent = triggerEventKindToStructuredEvent(event.eventKind);
  const pendingEffect: PendingTriggeredEffect = {
    pendingId: createPendingTriggeredEffectId(options.state, event, 0),
    actingPlayerId: event.actingPlayerId,
    eventKind: event.eventKind,
    event: {
      ...structuredEvent,
      ...(event.effectSourceTotalReduction !== undefined
        ? { effectSourceTotalReduction: event.effectSourceTotalReduction }
        : {}),
      ...(event.effectSourceSatisfiedReductionSymbolCount !== undefined
        ? {
            effectSourceSatisfiedReductionSymbolCount:
              event.effectSourceSatisfiedReductionSymbolCount,
          }
        : {}),
      ...(event.effectSourceRequiredReductionSymbolCount !== undefined
        ? {
            effectSourceRequiredReductionSymbolCount:
              event.effectSourceRequiredReductionSymbolCount,
          }
        : {}),
    },
    source: event.source,
    chainId: getTriggerEventChainKey(options.state, event),
    attackId: event.attackId,
    relatedPlayerId: event.relatedPlayerId,
    relatedInstanceId: event.relatedInstanceId,
    amount: event.amount,
    step: options.state.step,
    window: options.state.window,
    resolvedSourceInstanceIds: [],
    ...(event.effectSourceTotalReduction !== undefined
      ? { effectSourceTotalReduction: event.effectSourceTotalReduction }
      : {}),
    ...(event.effectSourceSatisfiedReductionSymbolCount !== undefined
      ? {
          effectSourceSatisfiedReductionSymbolCount:
            event.effectSourceSatisfiedReductionSymbolCount,
        }
      : {}),
    ...(event.effectSourceRequiredReductionSymbolCount !== undefined
      ? {
          effectSourceRequiredReductionSymbolCount:
            event.effectSourceRequiredReductionSymbolCount,
        }
      : {}),
  };

  return getAvailableTriggeredEffectSourceChoices({
    state: options.state,
    pendingEffect,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ignoreEffectActivationStartLatch: true,
  })
    .filter(sourceChoiceRequiresEffectActivationStartLatch)
    .filter(
      (sourceChoice) =>
        !isTriggeredSourceChoiceSuppressedByEffectSuppression(
          options.state,
          sourceChoice,
          options.getCardDefinitionById
        )
    )
    .map(getTriggeredSourceRegistrationInstanceId);
}

/**
 * ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A) 柱斧):
 * 「(tribe filter付き)自分のカードが召喚されたか、任意の効果を発揮したとき」を
 * card_event/game_event timing (TriggerEventKind:"effect_activated") で観測する
 * 非バースト入口。maybeQueueAnyEffectActivationBurstCheck (burst wildcard 版) と同じ
 * 「効果発揮完了直後」の hook point に相乗りし、通常の PendingTriggeredEffect キューへ積む。
 * count_increase/core_placed_on_life と同じ規約 (自己観測が主用途のため actingPlayerId=
 * relatedPlayerId=発揮した本人) を採用し、queueFlashUsedTriggers/queueStackEffectUsedTriggers
 * (opponent 観測=responder 規約) とは主体が逆になる。
 */
export function queueEffectActivationTriggers(options: {
  chainId: string;
  state: GameState;
  activatorPlayerId: string;
  relatedInstanceId: string | null;
  effectSourceTotalReduction?: number;
  effectSourceSatisfiedReductionSymbolCount?: number;
  effectSourceRequiredReductionSymbolCount?: number;
  eligibleSourceInstanceIds?: readonly string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  // triggerFilter (tribes/category 等) は relatedInstanceId から発揮元カードを解決して
  // 評価するため、発揮元が特定できない呼び出し (resolvedSourceInstanceId 未確定) では
  // どの card_event/game_event:"effect_activated" リスナーも原理的にマッチし得ない。
  // ここで早期 return し、raw fallback 経由の空 pending 生成 (queuePendingReactionsFromTriggerEvents
  // が options 不備を検知したときの互換パス) を予防する。
  if (options.relatedInstanceId === null) return options.state;
  // P3-39 と同じ runtime defense: options が TS 型どおり揃っていない呼び出し (test harness が
  // getRegisteredTriggeredEffectActions を省略するケース等) では
  // queuePendingReactionsFromTriggerEvents の raw fallback (options 不備を検知して無条件 push
  // する互換パス) に落ちて resolve 不能な空 pending が残留する。ここで自前ガードし、
  // production 経路 (常に揃っている) の挙動は変えずに noop にする。
  if (
    typeof options.getCardDefinitionById !== "function" ||
    typeof options.getRegisteredTriggeredEffectActions !== "function"
  ) {
    return options.state;
  }

  const event = createEffectActivationTriggerEvent({
    chainId: options.chainId,
    state: options.state,
    activatorPlayerId: options.activatorPlayerId,
    relatedInstanceId: options.relatedInstanceId,
    ...(options.effectSourceTotalReduction !== undefined
      ? { effectSourceTotalReduction: options.effectSourceTotalReduction }
      : {}),
    ...(options.effectSourceSatisfiedReductionSymbolCount !== undefined
      ? {
          effectSourceSatisfiedReductionSymbolCount:
            options.effectSourceSatisfiedReductionSymbolCount,
        }
      : {}),
    ...(options.effectSourceRequiredReductionSymbolCount !== undefined
      ? {
          effectSourceRequiredReductionSymbolCount:
            options.effectSourceRequiredReductionSymbolCount,
        }
      : {}),
    ...(options.eligibleSourceInstanceIds !== undefined
      ? { eligibleSourceInstanceIds: options.eligibleSourceInstanceIds }
      : {}),
  });

  const filtered = filterOptInTriggerEvents(
    [event],
    options.state,
    options.getCardDefinitionById
  );

  const queued = queuePendingReactionsFromTriggerEvents(
    options.state,
    filtered,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
  return {
    ...queued,
    pendingEffectCompletions: [
      ...(queued.pendingEffectCompletions ?? []),
      {
        triggerKind: "effect_activated",
        triggerCardInstanceId: options.relatedInstanceId,
        activatorPlayerId: options.activatorPlayerId,
        chainId: options.chainId ?? null,
        ...(options.effectSourceTotalReduction !== undefined
          ? { effectSourceTotalReduction: options.effectSourceTotalReduction }
          : {}),
        ...(options.effectSourceSatisfiedReductionSymbolCount !== undefined
          ? {
              effectSourceSatisfiedReductionSymbolCount:
                options.effectSourceSatisfiedReductionSymbolCount,
            }
          : {}),
        ...(options.effectSourceRequiredReductionSymbolCount !== undefined
          ? {
              effectSourceRequiredReductionSymbolCount:
                options.effectSourceRequiredReductionSymbolCount,
            }
          : {}),
        ...(options.eligibleSourceInstanceIds !== undefined
          ? {
              eligibleSourceInstanceIds: [...options.eligibleSourceInstanceIds],
            }
          : {}),
      },
    ],
  };
}

function effectActivationTimingForStack(
  stack: ActiveStack
): EffectActivationTiming | undefined {
  if (stack.activationLabel !== undefined) {
    if (stack.activationLabel === "none") return stack.chosenTiming;
    return stack.activationLabel;
  }
  return stack.chosenTiming;
}

function effectActivationLabelForStack(
  stack: ActiveStack
): ActivatedEffectLabel | undefined {
  return stack.activationLabel ?? stack.chosenTiming;
}

/**
 * P3-75: 未解決 ActiveStack の発揮前誘発イベントを発火する。
 * X05 の flash-use 専用入口と同じ private declaration 基盤へ流し、
 * stack-first の発揮前チェックポイントで declare/skip を処理する。
 */
export function queueEffectDeclarationTriggers(options: {
  state: GameState;
  stack: ActiveStack;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  if (typeof options.getRegisteredTriggeredEffectActions !== "function") {
    return options.state;
  }
  const hasEffectDeclarationRegistration = options.state.cardInstances.some(
    (card) =>
      options
        .getRegisteredTriggeredEffectActions(card.definitionId)
        ?.some(
          (registration) =>
            registration.eventKind === "effect_declaration" ||
            registration.eventMatcher?.family === "effect_declaration"
        ) === true
  );
  if (!hasEffectDeclarationRegistration) {
    return options.state;
  }

  const responderPlayerId =
    options.state.players.find(
      (player) => player.id !== options.stack.actingPlayerId
    )?.id ?? options.stack.actingPlayerId;
  const timing = effectActivationTimingForStack(options.stack);
  const label = effectActivationLabelForStack(options.stack);
  const event: CollectedTriggerEvent = {
    actingPlayerId: responderPlayerId,
    eventKind: "effect_declaration",
    source: "action_resolution",
    chainId: options.stack.chainId,
    attackId: options.state.activeAttack?.attackId ?? null,
    relatedPlayerId: options.stack.actingPlayerId,
    relatedInstanceId: options.stack.cardInstanceId,
    amount: null,
    effectSourceInstanceId:
      options.stack.effectSourceInstanceId ?? options.stack.cardInstanceId,
    effectSourceDefinitionId:
      options.stack.effectSourceDefinitionId ?? options.stack.cardDefinitionId,
    effectActionKind: options.stack.actionKind,
    ...(label !== undefined ? { effectActivationLabel: label } : {}),
    ...(timing !== undefined ? { effectActivationTiming: timing } : {}),
    ...(() => {
      const zone = getStackSourceActivationZone(options.state, options.stack);
      return zone !== undefined ? { triggerActivationZone: zone } : {};
    })(),
  };

  return queuePendingReactionsFromTriggerEvents(
    options.state,
    [event],
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * attack_occurred ConditionClause (BSSL01-M01 等「他カードのアタックを発火点にした
 * 発揮解禁ゲート」) の SSOT ログへ 1 件 push する。「アタックしたとき」の game_event 観測
 * トリガー (Q26342: 同時アタック宣言グループでは 1 回のみ発火) とは別軸の記録であり、
 * 「誰が物理的にアタックを宣言したか」は同時アタックの各参加体ごとに漏れなく記録する必要が
 * あるため、queueBattleDeclarationTriggers から独立して呼べる関数として切り出す
 * (simultaneous_declaration 経路は observation trigger をスキップするが、この記録はスキップしない)。
 */
export function pushAttackDeclarationLog(
  state: GameState,
  options: {
    declaringInstanceId: string;
    declaringPlayerId: string;
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): GameState {
  const declaringCard = state.cardInstances.find(
    (c) => c.instanceId === options.declaringInstanceId
  );
  if (!declaringCard) return state;
  const declaringDefinition = options.getCardDefinitionById?.(
    declaringCard.definitionId
  );
  const designatedTargetInstanceId =
    state.activeAttack?.designatedTargetInstanceId ?? null;
  const designatedTargetCard =
    designatedTargetInstanceId !== null
      ? state.cardInstances.find(
          (c) => c.instanceId === designatedTargetInstanceId
        )
      : undefined;
  const designatedTargetDefinitionId =
    designatedTargetCard?.definitionId ?? null;
  const designatedTargetControllerLifeAtDeclaration = designatedTargetCard
    ? (() => {
        const controller = state.players.find(
          (p) => p.id === designatedTargetCard.controllerPlayerId
        );
        return controller ? getPlayerLifeCoreCount(controller) : null;
      })()
    : null;
  return {
    ...state,
    attackDeclarationLog: [
      ...state.attackDeclarationLog,
      {
        playerId: options.declaringPlayerId,
        cardInstanceId: options.declaringInstanceId,
        cardDefinitionId: declaringCard.definitionId,
        ...(declaringDefinition
          ? {
              effectiveTribesAtDeclaration: getEffectiveTribes(
                state,
                declaringCard,
                declaringDefinition,
                options.getCardDefinitionById
              ),
            }
          : {}),
        turnNumber: state.turnNumber,
        step: state.step,
        attackId: state.activeAttack?.attackId ?? null,
        designatedTargetInstanceId,
        designatedTargetDefinitionId,
        designatedTargetControllerLifeAtDeclaration,
      },
    ],
  };
}

/**
 * P3-14 C-2: アタック/ブロック宣言成立後の game_event 観測トリガー
 * (「自分の「ルーシィ」がアタック/ブロックしたとき」BSFT01-C04 等)。
 *
 * 自カードの『アタック時/ブロック時』は battle immediate 系で処理されるため、ここで
 * 発火するのは他カード上の game_event リスナー専用。flash (P3-73) と同じく、両プレイヤーを
 * responder とする 2 イベントを積み、リスナー不在側は queueReactionsInternal の source
 * スキャンで吸収される (空 pending は積まれない)。
 */
export function queueBattleDeclarationTriggers(options: {
  chainId: string;
  state: GameState;
  kind: "attack" | "block";
  /** アタック/ブロックを宣言したカード (イベント主体)。 */
  declaringInstanceId: string;
  /** 宣言カードのコントローラ (イベント主体プレイヤー)。 */
  declaringPlayerId: string;
  simultaneousGroupId?: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  const events: CollectedTriggerEvent[] = options.state.players.map(
    (player) => ({
      // pending.actingPlayerId = 応答側 (= source 管理者)。自分側/相手側それぞれの
      // リスナー (player:"self" / player:"opponent") を拾うため両プレイヤー分を積む。
      actingPlayerId: player.id,
      eventKind: options.kind,
      source: "action_resolution",
      chainId: options.chainId,
      attackId: options.state.activeAttack?.attackId ?? null,
      relatedPlayerId: options.declaringPlayerId,
      relatedInstanceId: options.declaringInstanceId,
      amount: null,
    })
  );
  // attack のみ attackDeclarationLog に記録する (block は対象外)。
  const stateWithLog: GameState =
    options.kind === "attack"
      ? pushAttackDeclarationLog(options.state, {
          declaringInstanceId: options.declaringInstanceId,
          declaringPlayerId: options.declaringPlayerId,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      : options.state;
  return queuePendingReactionsFromTriggerEvents(
    stateWithLog,
    events,
    options.simultaneousGroupId,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
}

/**
 * card_exhausted / card_recovered など、バースト対象外で登録がなければ空振りするイベントを除外する。
 * 該当カードに対応する card_event timing の effect がない場合はキューイングしない。
 */
const OPT_IN_TRIGGER_EVENT_KINDS = new Set<TriggerEventKind>([
  // 注: "exhaust" は OPT_IN に入れない (2026-07-19, engine-claude
  // ENGINE-exhaust-third-party-opt-in-gap / BSLH01-C04 処女珠)。recover/battle_end/
  // rebirth/flash と同じ理由 (下記) に加え、opt-in フィルタは
  // OPT_IN_TRIGGER_EVENT_KINDS_FOR_UNWIRED_BURST_FALLBACK (queueReactionsInternal) 側で
  // lookup 未配線時の vacuous burst check 量産を別途 skip している。
  // 注: "recover" は OPT_IN に入れない (P3-14 C-3 拡張)。opt-in フィルタは
  // relatedInstanceId カード自身の card_event リスナーしか見ないが、recover は
  // BSTH08-転醒R02(A)「起幻の白/青スピリットが疲労/効果で回復したとき、このネクサスを
  // 裏返せる」のような game_event 観測 (他カード上のリスナー) を持つ。flash と同様、
  // リスナー不在は queueReactionsInternal の source スキャンで吸収する。
  "pre_declaration_attack",
  "pre_declaration_block",
  "after_cost_paid",
  // 注: "battle_end" は OPT_IN に入れない (recover と同じ理由)。opt-in フィルタは
  // relatedInstanceId (= バトル参加カード) 自身の card_event リスナーしか見ないが、
  // battle_end は「自分の〔系統/コスト〕スピリットのバトル終了時」(BSTH001-C04 地獄 等) の
  // ような第三者 game_event 観測リスナーを持つ。これも他 game_event 同様 source スキャンで
  // リスナー不在を吸収する (空 pending は積まれない)。参加カード自身の card_event:battle_end
  // は source==relatedInstanceId のオンフィールド一致で従来どおり発火する。バトル中に破壊され
  // trash に落ちた参加カードを観測する第三者誘発は、game_event 経路の
  // require_related_instance_on_field 検査 (getAvailableTriggeredEffectSourceChoices) で弾く。
  // 注: "rebirth" も OPT_IN に入れない (2026-07-07, engine-claude BSTH02.7-X01)。当初は
  // 「B 面に『転醒時』card_event 効果を持つカードだけが反応する」前提で opt-in にしていたが、
  // 「自分の系統Xスピリットが転醒したとき、手札のこのカードを1コストで召喚できる」型
  // (BSTH02.7-X01 effects[0], precedent BSLH01-M01 stub) は手札の別カード上の game_event
  // リスナーであり、opt-in フィルタが relatedInstanceId (裏返ったカード自身) の card_event
  // しか見ないため誤って弾かれていた (ENGINE-rebirth-third-party-game-event-opt-in-gap)。
  // recover/battle_end/flash と同じく、他 game_event 同様 source スキャン
  // (queueReactionsInternal → getAvailableTriggeredEffectSourceChoices) でリスナー不在を
  // 吸収する (空 pending は積まれない) ため opt-in で先回りフィルタする必要がない。
  // 注: "flash" は OPT_IN に入れない。opt-in フィルタは relatedInstanceId カード自身の
  // card_event リスナーを見るが、flash 誘発の listener (咲夜 BSTH01-X05) は手札の別カード上の
  // game_event。他の game_event 同様、queueReactionsInternal の source スキャンで
  // リスナー不在を吸収する（空 pending は積まれない）。
]);

function filterOptInTriggerEvents(
  events: readonly CollectedTriggerEvent[],
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CollectedTriggerEvent[] {
  const matchesEventKind =
    (eventKind: TriggerEventKind) =>
    (event: string | string[]): boolean =>
      Array.isArray(event) ? event.includes(eventKind) : event === eventKind;
  const isStarGarmentUnderCardEvent = (
    definition: CardDefinition,
    effect: NonNullable<CardDefinition["effects"]>[number],
    eventKind: TriggerEventKind
  ): boolean => {
    if (
      effect.timing.kind !== "card_event" ||
      !matchesEventKind(eventKind)(effect.timing.event)
    ) {
      return false;
    }
    const textLines = effect.textRef
      ?.map((lineIndex) => definition.textLines[lineIndex])
      .filter((line): line is string => line !== undefined);
    return textLines?.some(isTextRoleUnderHeaderLine) ?? false;
  };
  const hostHasStarGarmentUnderCardEvent = (
    card: CardInstance,
    definition: CardDefinition | undefined,
    eventKind: TriggerEventKind
  ): boolean => {
    if (!definition) return false;
    if (getEffectiveCategory(state, card, definition) !== "spirit") {
      return false;
    }
    for (const underId of textRoleUnderCardIdsOf(card)) {
      const underCard = getCardById(state, underId);
      if (
        !underCard ||
        underCard.attachedToInstanceId !== card.instanceId ||
        underCard.zone !== "field" ||
        underCard.faceDown
      ) {
        continue;
      }
      const underDefinition = getCardDefinitionById(underCard.definitionId);
      if (
        underDefinition?.effects?.some((effect) =>
          isStarGarmentUnderCardEvent(underDefinition, effect, eventKind)
        )
      ) {
        return true;
      }
    }
    return false;
  };
  return events.filter((e) => {
    if (!OPT_IN_TRIGGER_EVENT_KINDS.has(e.eventKind)) return true;
    if (!e.relatedInstanceId) return false;
    const card = getCardById(state, e.relatedInstanceId);
    if (!card) return false;
    const def = getCardDefinitionById(card.definitionId);
    const hostOwnCardEvent =
      def?.effects?.some(
        (eff) =>
          eff.timing.kind === "card_event" &&
          matchesEventKind(e.eventKind)(eff.timing.event)
      ) ?? false;
    return (
      hostOwnCardEvent ||
      hostHasStarGarmentUnderCardEvent(card, def, e.eventKind)
    );
  });
}

function getRelatedInstanceIdsForPendingStayChoice(
  pendingEffect: PendingTriggeredEffect
): string[] {
  if (
    pendingEffect.relatedInstanceIds !== undefined &&
    pendingEffect.relatedInstanceIds.length > 0
  ) {
    return [...pendingEffect.relatedInstanceIds];
  }
  return pendingEffect.relatedInstanceId
    ? [pendingEffect.relatedInstanceId]
    : [];
}

function getPendingStayChoiceFlushSourceContext(
  state: GameState,
  pendingEffect: PendingTriggeredEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): {
  sourceColors?: readonly CardColor[];
  sourceCategory?: CardDefinition["printedCategory"];
} {
  const sourceKeys = pendingEffect.registeredLeaveFieldStayOnFieldSourceKeys;
  if (!sourceKeys || sourceKeys.length === 0) return {};
  const relatedInstanceIds = new Set(
    getRelatedInstanceIdsForPendingStayChoice(pendingEffect)
  );
  if (relatedInstanceIds.size === 0) return {};
  const pendingLeaves = state.pendingLeaveEntities.filter((pendingLeave) =>
    relatedInstanceIds.has(pendingLeave.instanceId)
  );
  const sourceInstanceIds = Array.from(
    new Set(
      pendingLeaves
        .map((pendingLeave) => pendingLeave.causedByEffectSourceInstanceId)
        .filter(
          (sourceInstanceId): sourceInstanceId is string =>
            typeof sourceInstanceId === "string" && sourceInstanceId.length > 0
        )
    )
  );
  if (sourceInstanceIds.length !== 1) return {};
  const sourceCard = getCardById(state, sourceInstanceIds[0]!);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (!sourceCard || !sourceDefinition) return {};
  return {
    sourceColors: getEffectiveColors(state, sourceCard, sourceDefinition),
    sourceCategory: sourceDefinition.printedCategory,
  };
}

function runPendingReactionMainResolution<Context>(options: {
  state: GameState;
  chainId: string;
  battleEndDeferralAttackId?: string;
  startLogs: readonly string[];
  endLogs: readonly string[];
  context: Context;
  resolveEffect?: (state: GameState, context: Context) => GameState;
  reevaluation?: ReevaluationConfig;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  /**
   * P3-37 follow-up + P3-39: 解決中に生じる二次イベント (after_draw / increase_hand 等) の
   * リスナー判定に使用。 P3-39 で必須化 (空 pending 累積バグの再発防止)。
   */
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  sourceColors?: readonly CardColor[];
  sourceCategory?: CardDefinition["printedCategory"];
  /** P3-68 ギャップ 2: コア不足消滅の causePlayerId 帰属用 (解決中効果のコントローラ)。 */
  causedByPlayerId?: string | null;
  /** 効果解決由来のコア不足消滅に残す causal source instanceId。 */
  causedBySourceInstanceId?: string | null;
  /** 効果解決由来の場入りイベントにだけ cause を付ける。 */
  enterFieldCausedByPlayerId?: string | null;
  /**
   * engine-generic-effect-activation-causal-trigger: 宣言時に離脱誘発抑制の対価を
   * 支払っていれば、この host (この effect の source card) の instanceId を渡す。
   * flush 直前に `causedByEffectSourceInstanceId` が一致する pendingLeave の
   * destroy/vanish 誘発効果を抑制する (BSGE01-R02【毒牙：モルター】)。
   */
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
}): GameState {
  // 「離れたとき」は実移動後の差分で配送する。通常完了だけでなく再評価中断も同じ境界を通す。
  const flushLeavesAndQueueReactions = (state: GameState): GameState =>
    flushPendingLeavesAndQueueReactions({
      beforeFlushState: state,
      chainId: options.chainId,
      attackId: options.battleEndDeferralAttackId ?? null,
      causedByPlayerId: options.causedByPlayerId ?? null,
      causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      sourceColors: options.sourceColors,
      sourceCategory: options.sourceCategory,
    });
  const stateBeforeResolution = options.state;
  let currentState = setEffectQueueEntries(
    {
      ...options.state,
      log: [...options.state.log, ...options.startLogs],
    },
    [createChainResolveEffectQueueEntry(options.chainId)]
  );

  if (options.reevaluation) {
    const preReeval = runReevaluationAtTiming({
      state: currentState,
      registration: options.reevaluation.registration,
      timing: "before_each_step",
      sourceInstanceId: options.reevaluation.sourceInstanceId,
      targetInstanceIds: options.reevaluation.targetInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.reevaluation.suppressionEffectDescriptor !== undefined
        ? {
            suppressionEffectDescriptor:
              options.reevaluation.suppressionEffectDescriptor,
          }
        : {}),
    });
    if (!preReeval.passed) {
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `reevaluation:before_each_step:failed:${preReeval.failedChecks.join(",")}:${preReeval.failurePolicy}:source=${options.reevaluation.sourceInstanceId}`,
        ],
      };
      currentState = pruneIllegalPendingTriggeredEffects({
        state: currentState,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
      });
      return flushLeavesAndQueueReactions(
        setEffectQueueEntries(
          {
            ...currentState,
            log: [...currentState.log, ...options.endLogs],
          },
          []
        )
      );
    }
  }

  currentState = options.resolveEffect
    ? options.resolveEffect(currentState, options.context)
    : currentState;
  // P3-47 F-2: getCardDefinitionById を渡さないと act_as_spirit (分身) 付与の裏向きトークンが
  // SBA の faceDown スキップに落ち、コア不足消滅を取りこぼす (実効最低コアは override levelDefs 由来)。
  // 任意手順や対象を選択している間は同じ効果の解決途中。
  // 例: 聖詠でコア0のまま入ったカードが、この召喚時効果でコアを置く前に消滅しない。
  // after_triggers は効果の解決境界なので、他の continuation まで一括で除外しない。
  if (
    !currentState.pendingStepOptionalChoice &&
    !currentState.pendingStepOptionalTargetSelection
  ) {
    currentState = runStateBasedActions(
      currentState,
      options.getCardDefinitionById,
      options.causedByPlayerId,
      options.causedBySourceInstanceId ?? null
      // P3-84 注: ここで owningChainId を渡して消滅を束縛してはならない。誘発効果が
      // 「この効果発揮後」を含む場合、消滅したカードは自分の leave サブチェーンが閉じた
      // 時点で発揮後より前に実移動する (04_state-based-rules.md 例2)。束縛は過剰遅延。
    ).state;
  }
  // P3-20 ギャップ B: continuous 効果の condition / applicability を動的再評価。
  currentState = recomputeAndRebuildContinuousEffects(
    currentState,
    options.getCardDefinitionById
  );

  // bp_modifier CE を BattleEntity.resolvedBp に反映
  currentState = recomputeBattleEntityBp(
    currentState,
    options.getCardDefinitionById
  );

  // after_sba 再評価ポイント
  if (options.reevaluation) {
    const reeval = runReevaluationAtTiming({
      state: currentState,
      registration: options.reevaluation.registration,
      timing: "after_sba",
      sourceInstanceId: options.reevaluation.sourceInstanceId,
      targetInstanceIds: options.reevaluation.targetInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.reevaluation.suppressionEffectDescriptor !== undefined
        ? {
            suppressionEffectDescriptor:
              options.reevaluation.suppressionEffectDescriptor,
          }
        : {}),
    });
    if (!reeval.passed) {
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `reevaluation:after_sba:failed:${reeval.failedChecks.join(",")}:${reeval.failurePolicy}`,
        ],
      };
      // failurePolicy に基づく runtime 動作:
      // abort_remaining / skip_step: 誘発効果の収集をスキップして早期 return
      // remove_target: 単ステップでは abort 同等 (将来の多段解決で対象除外に拡張)
      // pending leave の flush は行う (SBA でフィールドを離れたカードを正しく処理)
      currentState = pruneIllegalPendingTriggeredEffects({
        state: currentState,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
      });
      return flushLeavesAndQueueReactions(
        setEffectQueueEntries(
          {
            ...currentState,
            log: [...currentState.log, ...options.endLogs],
          },
          []
        )
      );
    }
  }

  currentState = setEffectQueueEntries(
    {
      ...currentState,
      log: [...currentState.log, ...options.endLogs],
    },
    []
  );
  currentState = collectAndQueueTriggerReactions({
    beforeState: stateBeforeResolution,
    afterState: currentState,
    source: "action_resolution",
    chainId: options.chainId,
    attackId: options.battleEndDeferralAttackId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: options.causedByPlayerId ?? null,
    causedBySourceInstanceId: options.causedBySourceInstanceId ?? null,
    ...(options.enterFieldCausedByPlayerId !== undefined
      ? { enterFieldCausedByPlayerId: options.enterFieldCausedByPlayerId }
      : {}),
    ...(options.supplementalTriggerEvents !== undefined
      ? { supplementalEvents: options.supplementalTriggerEvents }
      : {}),
  });

  // engine-generic-effect-activation-causal-trigger: flush (実離脱・実移動) の
  // 前に、この host 自身の効果解決で発生した pendingLeave のうち抑制対象を
  // suppressDestroyedEffects でタグ付けし、既に queue 済みの destroy/vanish
  // 誘発効果を除去する。flush 後では pendingLeaveEntities が既に消費されて
  // しまうため、必ず flush 前に行う (BSGE01-R02【毒牙：モルター】)。
  if (options.suppressCausedLeaveEffectsForSourceInstanceId) {
    const suppressSourceInstanceId =
      options.suppressCausedLeaveEffectsForSourceInstanceId;
    const suppressTargetIds = currentState.pendingLeaveEntities
      .filter(
        (pendingLeave) =>
          pendingLeave.causedByEffectSourceInstanceId ===
            suppressSourceInstanceId &&
          pendingLeave.blockedByResistance !== true
      )
      .map((pendingLeave) => pendingLeave.instanceId);
    currentState = executeSuppressPendingLeaveEffects(
      currentState,
      suppressTargetIds,
      "destroyed_only",
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions
    );
  }

  currentState = pruneIllegalPendingTriggeredEffects({
    state: currentState,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = {
      ...currentState,
      activeContinuousEffects: currentState.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag !== "negate_caused_reaction" ||
          ce.metadata?.chainId !== options.chainId
      ),
    };
  }
  return flushLeavesAndQueueReactions(currentState);
}

export function useResolvePendingTriggeredEffectAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  pendingId: string;
  resolveEffect?: PendingTriggeredEffectResolver;
  getResolver?: PendingTriggeredEffectResolverLookup;
  reevaluation?: ReevaluationConfig;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  /**
   * P3-37 follow-up + P3-39: triggered effect 解決中の二次イベント (after_draw / increase_hand 等)
   * のリスナー判定に使用する (必須)。
   */
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  /**
   * Deferred stack resolution removes the pending effect before declaration and
   * keeps the declared source on ActiveStack, not on resolvedSourceInstanceIds.
   * Pass it explicitly so effect-caused SBA leaves retain their causal source.
   */
  causedBySourceInstanceId?: string | null;
  /**
   * engine-generic-effect-activation-causal-trigger: 宣言時に離脱誘発抑制の
   * 対価を支払っていれば、この host の instanceId を渡す (BSGE01-R02)。
   */
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
}): ResolvePendingTriggeredEffectResult {
  const pendingEffect = options.state.pendingTriggeredEffects.find(
    (currentPendingEffect) =>
      currentPendingEffect.pendingId === options.pendingId
  );

  if (!pendingEffect) {
    throw new Error(
      `Unknown pending triggered effect: pendingId=${options.pendingId}`
    );
  }

  if (pendingEffect.actingPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Pending triggered effect belongs to ${pendingEffect.actingPlayerId}, not ${options.actingPlayerId}`
    );
  }

  const battleEndDeferralAttackId =
    getBattleEndFinalizeAttackIdForPending(pendingEffect);
  const resolution = createEffectResolutionScope(
    { chainId: `trigger:${pendingEffect.pendingId}` },
    battleEndDeferralAttackId
  );
  const chainId = resolution.chainId;
  const resolveEffect =
    options.resolveEffect ?? options.getResolver?.(pendingEffect);
  const resolvedSourceInstanceId =
    pendingEffect.resolvedSourceInstanceIds[0] ?? null;
  const causedBySourceInstanceId =
    options.causedBySourceInstanceId !== undefined
      ? options.causedBySourceInstanceId
      : resolvedSourceInstanceId;
  const stayChoiceFlushSourceContext = getPendingStayChoiceFlushSourceContext(
    options.state,
    pendingEffect,
    options.getCardDefinitionById
  );
  const fallbackSourceColors: readonly CardColor[] | undefined = (() => {
    if (causedBySourceInstanceId === null) {
      return undefined;
    }
    const srcInst = getCardById(options.state, causedBySourceInstanceId);
    const srcDef = srcInst
      ? options.getCardDefinitionById(srcInst.definitionId)
      : undefined;
    return getEffectiveColors(options.state, srcInst, srcDef);
  })();
  const sourceColors =
    stayChoiceFlushSourceContext.sourceColors ?? fallbackSourceColors;
  const currentState = runPendingReactionMainResolution({
    state: {
      ...options.state,
      pendingTriggeredEffects: options.state.pendingTriggeredEffects.filter(
        (currentPendingEffect) =>
          currentPendingEffect.pendingId !== options.pendingId
      ),
    },
    chainId,
    startLogs: [
      `trigger:resolve-main:start:${pendingEffect.pendingId}:${pendingEffect.eventKind}:${options.actingPlayerId}`,
    ],
    ...(battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId }
      : {}),
    endLogs: [
      `trigger:resolve-main:end:${pendingEffect.pendingId}:${pendingEffect.eventKind}:${options.actingPlayerId}`,
    ],
    context: {
      chainId,
      pendingEffect,
    },
    ...(resolveEffect ? { resolveEffect } : {}),
    ...(options.reevaluation ? { reevaluation: options.reevaluation } : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(sourceColors ? { sourceColors } : {}),
    ...(stayChoiceFlushSourceContext.sourceCategory
      ? { sourceCategory: stayChoiceFlushSourceContext.sourceCategory }
      : {}),
    causedByPlayerId: options.actingPlayerId,
    causedBySourceInstanceId,
    enterFieldCausedByPlayerId: options.actingPlayerId,
    ...(options.suppressCausedLeaveEffectsForSourceInstanceId
      ? {
          suppressCausedLeaveEffectsForSourceInstanceId:
            options.suppressCausedLeaveEffectsForSourceInstanceId,
        }
      : {}),
    ...(options.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: options.supplementalTriggerEvents }
      : {}),
  });

  // ENGINE-battle-end-pending-triggered-vs-scope-battle-ce: この解決で battle_end 由来の
  // pendingTriggeredEffects が尽きた attackId があれば、予約されていた scope:"battle" CE
  // 失効をここで発火する。
  const drainedState = maybeFinalizeBattleEndScopeExpirations(
    currentState,
    options.getCardDefinitionById,
    {
      flushBeforeFinalize: (state, attackId) =>
        flushPendingLeavesAndQueueReactions({
          beforeFlushState: state,
          chainId: getBattleEndDeferralChainId(attackId),
          attackId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
          queueRegisteredPreFlush: true,
        }),
    }
  );

  return {
    pendingId: pendingEffect.pendingId,
    state: {
      ...drainedState,
      log: [
        ...drainedState.log,
        `trigger:resolved:${pendingEffect.pendingId}:${pendingEffect.eventKind}:${options.actingPlayerId}`,
      ],
    },
  };
}

/**
 * P3-77 節②: バースト発動カードが「効果耐性」常在効果 (continuous effect_immunity
 * target self) を持つ場合、発動成立〜メイン効果「解決後」までの窓で、カード
 * (defense_immune) とコントローラ (player_effect_immunity) に相手効果耐性を付与する。
 *
 * BSTH01-X07 EXルーミア「このカードが発動している間、このカードと自分は相手の効果を
 * 受けない」。窓は本関数の resolution 完了で閉じ、登録した CE を除去する。バースト解決が
 * 誘発させた後続効果は pendingTriggeredEffects に積まれ後で解決されるため、この窓の外
 * (耐性対象外) となる (確定裁定 2026-06-01)。
 *
 * 返り値: 付与した CE を追加した state と、除去用の effectId 群。
 */
export function applyBurstActivationImmunity(
  state: GameState,
  checkId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): { state: GameState; immunityEffectIds: string[] } {
  const cardCeId = `burst-window-immune-card:${checkId}`;
  const playerCeId = `burst-window-immune-player:${checkId}`;

  // 冪等: 効果発揮宣言窓 open 時と resolution 開始時の二重登録を防ぐ (P3-77 Step A)。
  // 既に当該 checkId の窓 CE があれば再登録しない。
  if (state.activeContinuousEffects.some((ce) => ce.effectId === cardCeId)) {
    return { state, immunityEffectIds: [cardCeId, playerCeId] };
  }

  const revealed = state.revealedBurstStates.find((r) => r.checkId === checkId);
  if (!revealed) return { state, immunityEffectIds: [] };

  const card = getCardById(state, revealed.cardInstanceId);
  if (!card) return { state, immunityEffectIds: [] };

  const def = getCardDefinitionById(card.definitionId);
  // 節②(発動中受けない)を表す明示 DSL フラグを持つときのみ窓免疫を合成する。
  // while_set の effect_immunity はセット中の節①だけを表し、発動中の節②とは別軸。
  const hasActivationImmunity = (def?.effects ?? []).some((e) => {
    if (e.timing.kind !== "continuous") return false;
    if (e.burstActivationWindowImmunity !== "self_and_controller") {
      return false;
    }
    const hasSelfImmunityStep = e.steps.some(
      (s) =>
        s.action.kind === "effect_immunity" &&
        (s.action as { target?: { kind?: string } }).target?.kind === "self"
    );
    if (!hasSelfImmunityStep) return false;
    const zone = e.applicability?.zone;
    if (zone === undefined) return true;
    const zoneList = Array.isArray(zone) ? zone : [zone];
    const coversActiveZone =
      zoneList.length === 0 ||
      zoneList.some((z) => z === "field" || z === "anywhere");
    return coversActiveZone;
  });
  if (!hasActivationImmunity) return { state, immunityEffectIds: [] };
  const base = {
    sourceInstanceId: revealed.cardInstanceId,
    sourceDefinitionId: card.definitionId,
    actingPlayerId: revealed.playerId,
    duration: { scope: "permanent" as const },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    metadata: { burstActivationWindow: checkId },
  };
  const cardImmunity: ContinuousEffect = {
    ...base,
    effectId: cardCeId,
    modifierTag: "defense_immune",
    targetInstanceId: revealed.cardInstanceId,
  };
  const playerImmunity: ContinuousEffect = {
    ...base,
    effectId: playerCeId,
    modifierTag: "player_effect_immunity",
    targetInstanceId: revealed.playerId,
  };
  return {
    state: {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        cardImmunity,
        playerImmunity,
      ],
      log: [
        ...state.log,
        `burst:activation-immunity:registered:${checkId}:${revealed.cardInstanceId}:${revealed.playerId}`,
      ],
    },
    immunityEffectIds: [cardCeId, playerCeId],
  };
}

/** 発動中ウィンドウの効果耐性 CE を除去する (メイン効果解決後 = 窓を閉じる)。 */
export function removeBurstActivationImmunity(
  state: GameState,
  checkId: string,
  immunityEffectIds: string[]
): GameState {
  if (immunityEffectIds.length === 0) return state;
  const idSet = new Set(immunityEffectIds);
  return {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (ce) => !idSet.has(ce.effectId)
    ),
    log: [...state.log, `burst:activation-immunity:cleared:${checkId}`],
  };
}

export function useResolvePendingBurstCheckAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  checkId: string;
  resolveEffect?: PendingBurstCheckResolver;
  getResolver?: PendingBurstCheckResolverLookup;
  reevaluation?: ReevaluationConfig;
  /** source-backed burst 解決時、宣言済み registration が指す effects[] index。 */
  burstEffectIndex?: number;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  /** P3-39: pending burst check 解決中の二次 trigger event 用 (必須)。 */
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): ResolvePendingBurstCheckResult {
  const pendingBurstCheck = options.state.pendingBurstChecks.find(
    (currentPendingBurstCheck) =>
      currentPendingBurstCheck.checkId === options.checkId
  );

  if (!pendingBurstCheck) {
    throw new Error(`Unknown pending burst check: checkId=${options.checkId}`);
  }

  if (pendingBurstCheck.actingPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Pending burst check belongs to ${pendingBurstCheck.actingPlayerId}, not ${options.actingPlayerId}`
    );
  }

  const chainId = `burst:${pendingBurstCheck.checkId}`;
  const resolveEffectRaw =
    options.resolveEffect ?? options.getResolver?.(pendingBurstCheck);

  // P3-77 節②: 発動成立〜メイン効果解決後の窓でカード/コントローラに相手効果耐性を付与。
  // 無効/発揮できない判定より「前」に登録し、節②(発動中受けない)が「無効」も回避できるようにする。
  const { state: stateWithImmunity, immunityEffectIds } =
    applyBurstActivationImmunity(
      options.state,
      options.checkId,
      options.getCardDefinitionById
    );

  // P3-77 Step C: 相手の「バースト効果を無効/発揮できない」(negate_opponent_burst) が
  // 効いている場合、バーストは発動するが効果は発揮されない (resolveEffect をスキップ)。
  // 発揮(解決)時点で評価するため窓免疫登録後の stateWithImmunity 上で判定する。
  //   - 節②(発動中受けない=burstActivationWindow 付き defense_immune): 無効/発揮できない 両方を回避。
  //   - 節①(セット束縛 defense_immune): 発揮時点では「セット中」を脱しており回避源にならない。
  //   - Effect.ignoresOpponentCannotActivateBurst: 「発揮できない」のみ能動的にバイパス (BSTH01-M13)。
  // 全解決経路 (attack step 即解決 / main step 窓経由) を本関数でカバーする。
  const revealedForNullify = stateWithImmunity.revealedBurstStates.find(
    (r) => r.checkId === options.checkId
  );
  let burstNullified = false;
  if (revealedForNullify !== undefined) {
    const burstCardForNullify = getCardById(
      stateWithImmunity,
      revealedForNullify.cardInstanceId
    );
    const burstDef = burstCardForNullify
      ? options.getCardDefinitionById(burstCardForNullify.definitionId)
      : undefined;
    const ignoresOpponentCannotActivateBurst =
      getBurstIgnoresOpponentCannotActivateBurst(
        burstDef,
        options.burstEffectIndex,
        options.burstEffectIndex === undefined
      );
    burstNullified = isBurstEffectNullifiedByOpponent(
      stateWithImmunity,
      revealedForNullify.cardInstanceId,
      revealedForNullify.playerId,
      {
        ignoresOpponentCannotActivateBurst,
        getCardDefinitionById: options.getCardDefinitionById,
      }
    );
  }
  const resolveEffect = burstNullified ? undefined : resolveEffectRaw;

  let currentState = runPendingReactionMainResolution({
    state: {
      ...stateWithImmunity,
      pendingBurstChecks: stateWithImmunity.pendingBurstChecks.filter(
        (currentPendingBurstCheck) =>
          currentPendingBurstCheck.checkId !== options.checkId
      ),
    },
    chainId,
    startLogs: [
      `burst:resolve-main:start:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${options.actingPlayerId}`,
    ],
    endLogs: [
      `burst:resolve-main:end:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${options.actingPlayerId}`,
    ],
    context: {
      chainId,
      pendingBurstCheck,
    },
    ...(resolveEffect ? { resolveEffect } : {}),
    ...(options.reevaluation ? { reevaluation: options.reevaluation } : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: options.actingPlayerId,
    enterFieldCausedByPlayerId: options.actingPlayerId,
  });

  // P3-77 節②: メイン効果解決後に窓を閉じる。以降の後続誘発効果は耐性対象外。
  if (
    immunityEffectIds.length > 0 &&
    currentState.pendingTargetedDisclosureContinuation !== null
  ) {
    const continuation = currentState.pendingTargetedDisclosureContinuation;
    currentState = {
      ...currentState,
      pendingTargetedDisclosureContinuation: {
        ...continuation,
        resolutionCleanups: [
          ...(continuation.resolutionCleanups ?? []),
          {
            kind: "burst_activation_immunity",
            checkId: options.checkId,
            effectIds: immunityEffectIds,
          },
        ],
      },
    };
  } else {
    currentState = removeBurstActivationImmunity(
      currentState,
      options.checkId,
      immunityEffectIds
    );
  }

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): バースト効果が
  // 完全解決した (burstNullified で発揮自体が止められていない、かつ発揮元カードが
  // revealedBurstStates から特定できる) 後に非バースト「効果を発揮したとき」観測を発火する。
  // useResolvePendingBurstCheckAsAction は全バースト解決経路 (attack step 即解決 /
  // main step 窓経由 / resolve_pending_burst_check ハンドラ) が通る唯一の関数のため、
  // ここ 1 箇所への追加で全経路をカバーする。
  if (!burstNullified && revealedForNullify !== undefined) {
    currentState = queueEffectActivationTriggers({
      chainId,
      state: currentState,
      activatorPlayerId: options.actingPlayerId,
      relatedInstanceId: revealedForNullify.cardInstanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  return {
    checkId: pendingBurstCheck.checkId,
    state: {
      ...currentState,
      log: [
        ...currentState.log,
        `burst:resolved:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${options.actingPlayerId}`,
      ],
    },
  };
}
