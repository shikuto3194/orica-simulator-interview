import { replaceCardInstances } from "../zone/card-instance-state";
import { hasPendingEffectResolution } from "../effect/pending-resolution-policy";
import { getCardById } from "../card/card-lookup";
import { resolveDefinitionEffect } from "../effect/definition-effect-reference";
import { filterTargetsStillInSnapshottedZones } from "../effect/targeted-disclosure-target-snapshot";
import { isCardInEffectZone } from "../effect/card-access-rules";
import {
  calculateSpecialCostFinalCost,
  calculateReduction,
  getEffectiveCostFloor,
  type AdditionalCostModifier,
  type ReductionResult,
} from "../core/cost-system";
import type { BattleImmediateEffectActionRegistrationLookup } from "../battle/battle-immediate-effect-system";
import {
  type EffectActionContext,
  type HandWrittenEffectResolverLookup,
  runActionMainResolution,
} from "../effect/effect-resolution";
import type { ReevaluationConfig } from "../legal/legal-actions-shared";
import type { TargetLockBypassProfile } from "../effect/target-affect-gate";
import {
  DEFAULT_CANDIDATE_TARGET_ZONES,
  buildReevaluationConfig,
  getEffectiveColors,
  getEffectiveTribes,
  getPreventionBlockReason,
  isLegalActionTargetGroupSelectionSatisfied,
} from "../legal/legal-actions-shared";
import {
  getEffectFilterBlockReason,
  hasOutstandingEffectResolutionContinuation,
  type EffectFilterTag,
} from "../state-based-actions";
import { flushPendingLeavesAndRecomputeContinuousEffects } from "../zone/pending-leave-continuous-upkeep";
import { recomputeAndRebuildContinuousEffectsForSources } from "../effect/continuous-effect-rebuild";
import {
  checkAndQueueMagicStackDomain,
  checkAndQueueOracleChoices,
} from "./oracle-system";
import {
  applyCardCostPayments,
  assertMatchingPaymentAmount,
  assertPaymentSourcesAreAvailable,
  getAvailableCardCostPaymentSources,
  getTotalPaymentAmount,
  type AvailableCardCostPaymentSourcesResult,
  type AvailableOnBoardCorePaymentSource,
  type CardCostPaymentSource,
  type ExplicitIndependentCorePaymentSource,
} from "../core/payment-system";
import {
  hasIndependentCoreManagement,
  type ActiveStack,
  type ActivatedEffectLabel,
  type CardDefinition,
  type CardInstance,
  type ContinuousEffect,
  type EffectUsageLimit,
  type EffectPreventionLevel,
  type GameState,
  type LifeCoreKind,
  type PendingEffectTargetGroup,
  type PostResolutionOracleTrigger,
  type Zone,
} from "../model";
import type { CardFilter } from "../dsl-types";
import {
  getApplicableCostOverrideCEs,
  isCardDefinitionToken,
  isMagicLikeCardForm,
} from "../card/card-filter";
import { getEffectiveCategory } from "./act-as-spirit";
import {
  getTotalCoresOnCardById,
  moveCardZone,
  resolveCardLeavesFieldCores,
} from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import {
  collectEffectActivationStartLatchSourceInstanceIds,
  collectCostPaymentVanishTriggers,
  isLabeledStackEffectActivation,
  queueAfterCostPaidTriggers,
  queueEffectActivationTriggers,
  queueFlashUsedTriggers,
  queueStackEffectUsedTriggers,
} from "../effect/trigger-system";
import { didEffectActivationFail } from "../effect/effect-activation-observer";
import { processMovedToTrashEffects } from "../effect/structured-trash-ops";
import { moveTrashCardsToDeckTopBottom } from "../zone/zone-move-system";
import { executeSendToDeck } from "../effect/structured-zone-ops";

/**
 * マジック使用の 6 段階パイプライン。
 * ログプレフィックスは各段階を示す:
 *   ① declare  — magic:declare:...
 *   ② cost     — magic:reduction:... / magic:without-cost:... / magic:in-use:... / magic:payment:...
 *   ③ targets  — magic:targets:...
 *   ④ resolve  — magic:resolve-main:start/end:...
 *   ⑤ derived  — magic:resolve-derived:end:...
 *   ⑥ cleanup  — magic:trash:... / magic:token-pool:...
 */
export type MagicUsageStage =
  | "declare"
  | "cost"
  | "targets"
  | "resolve"
  | "derived"
  | "cleanup";

export type MagicPaymentSource = CardCostPaymentSource;

export interface MagicActionContext {
  chainId: string;
  actingPlayerId: string;
  magicCard: CardInstance;
  magicDefinition: CardDefinition;
  targetInstanceIds: string[];
  targetGroups?: readonly PendingEffectTargetGroup[];
  reduction: ReductionResult;
  /** resolveEffect が pending を生成する場合、executeEffect へ渡して神託を解決後まで遅延する。 */
  postResolutionOracle?: import("../model").PostResolutionOracleTrigger;
  /** stack 効果解決時、直下にある無効化候補 stack。 */
  pendingStackNegateCandidate?: ActiveStack | null;
  /**
   * 宣言時点で magicCard がいたゾーン (手札/手元/トラッシュ)。
   * `StepCondition.kind === "activation_zone"` の解決元 (ENGINE-magic-activation-source-zone-condition)。
   */
  activationZone?: "hand" | "set_aside" | "trash" | "field";
  /**
   * ENGINE-leave-field-free-use-stay-on-field-flush-gate: 三者観測 game_event の主語 Y を
   * use_magic_without_cost 経由の別 effectIndex 発揮まで引き継ぐ (tryExecuteEffects が
   * ctx.triggerRelatedInstanceId(s) として汎用的に読む、effect-resolution.ts 既存経路と同じ)。
   */
  triggerRelatedInstanceId?: string;
  triggerRelatedInstanceIds?: readonly string[];
}

export type MagicEffectResolver = (
  state: GameState,
  context: MagicActionContext
) => GameState;

export interface PlayMagicCardAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  /** 選択されたタイミング（"main" / "flash" / "stack"）。 */
  chosenTiming?: "main" | "flash" | "stack";
  /** 見出しラベル由来の起動効果カテゴリ。timing は使用窓、こちらは flash/stack 判定用。 */
  activationLabel?: ActivatedEffectLabel;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  paymentSources: readonly MagicPaymentSource[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /**
   * P3-37 follow-up + P3-39: action_resolution 経路でリスナー無し event (after_draw / increase_hand 等) が
   * 空 pending として残らないように EffectActionContext 経由で `collectAndQueueTriggerReactions` に
   * 転送する。 通常は applyLegalAction.options から同名フィールドを引き回すだけで良い。
   * P3-39 で必須化。
   */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: MagicEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  reevaluation?: ReevaluationConfig;
  /** コアシュート対象の事前選択。instanceId → 取る通常コア数。 */
  coreShootDistribution?: Record<string, number>;
  /** コアシュートでソウルコアを取るカードの instanceId。 */
  coreShootSoulCoreInstanceId?: string;
  /**
   * cost_override CE 等によりコストを支払わずに使用する場合 true。
   * 軽減計算と支払いをスキップ、reduction は finalCost=0 で構築する。
   * paymentSources は無視される (空配列を渡すこと推奨)。
   */
  withoutCost?: boolean;
  /**
   * cost_override CE (amount>0) による上書きコスト使用 (P2-05 Phase 4a,
   * 例: XX01「相手はマジックカードを1コストで使用できる」)。
   * 軽減計算をスキップし finalCost=この値で支払う。withoutCost とは排他。
   */
  costOverrideAmount?: number;
  /** 使用時ゾーンコスト等によるコスト修正。 */
  additionalCostModifiers?: readonly AdditionalCostModifier[];
  /** 使用時コストとしてデッキへ戻すカード。 */
  zoneCostPaymentCardIds?: readonly string[];
  /** choice ステップの選択肢インデックス。0=デフォルト action、1+=choice[N-1]。 */
  choiceIndex?: number;
  /** EffectStep.choice を宣言時に確定せず、スタック窓後に提示する候補。 */
  deferredChoiceIndexes?: readonly number[];
  /** 宣言時に選択した targetInstanceIds を消費する DSL step id。 */
  targetStepId?: string;
  /** 効果内 pay_cost step の支払いソース。 */
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /** フィールド上カードからの支払い元を明示的な対象フィルタに限定する。 */
  onBoardCoreSourceFilter?: CardFilter;
  /** P3-62: 宣言時に記録した usageLimit の払戻情報 (発揮不能時に消費を取り消す)。 */
  recordedUsage?: import("../model").RecordedEffectUsage;
  /** stack 効果解決時、直下にある無効化候補 stack。 */
  pendingStackNegateCandidate?: ActiveStack | null;
  /**
   * 使用元として許可するゾーン。未指定時は既定 (手札/手元) のまま
   * (engine-magic-trash-use-permission)。呼び出し元の registration.applicability
   * から導出した値を渡すことで、宣言していない registration 経由でのすり抜けを防ぐ。
   */
  allowedSourceZones?: readonly Zone[];
}

export interface MagicActionResult {
  state: GameState;
  chainId: string;
  reduction: ReductionResult;
}

export interface UseMagicCardWithoutPayingCostAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /** P3-37 follow-up + P3-39: コスト無料マジックの解決でも triggered effect lookup を引き回す (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: MagicEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  chainId?: string;
  allowedSourceZones?: readonly Zone[];
  activationZone?: "hand" | "set_aside" | "trash" | "field";
  paymentSources?: readonly MagicPaymentSource[];
  /** フィールド上カードからの支払い元を明示的な対象フィルタに限定する。 */
  onBoardCoreSourceFilter?: CardFilter;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  negatePreventionLevel?: EffectPreventionLevel;
  /**
   * 発揮する効果本体の timing.mode。省略時は既定 "main"（バースト follow-up の既存挙動を維持）。
   * ENGINE-conditional-free-magic-use-on-event: 手札にあるカードの条件付き無償使用は
   * 「フラッシュ」本体を発揮するカードが大半のため "flash" を明示できる。
   */
  magicTiming?: "main" | "flash" | "stack";
  /**
   * ENGINE-conditional-free-magic-use-target-selection: 効果本体が「N体まで」等の
   * 対象選択を要する場合に、synthetic ActiveStack を通常のスタック解決 (種別非依存の
   * resolveDeferredStackAction) へ渡すための窓口。指定時は対象選択が必要かどうかを
   * この関数自体で判定させず resolveDeferredStackAction に委譲する (getStackTargetSelection
   * が候補ゼロ/対象不要なら即座に解決まで進める、対象複数なら pendingEffectTargetSelection を
   * 生成して中断する、を種別非依存に行うため二重実装しない)。未指定時は従来通り
   * resolveMagicMainAndMoveToTrash を直接呼ぶ同期解決のみ (targetInstanceIds 未指定は空扱い)。
   */
  resolveDeferredStackForFreeMagicUse?: (
    state: GameState,
    stack: ActiveStack
  ) => GameState;
  /**
   * ENGINE-leave-field-free-use-stay-on-field-flush-gate: 三者観測 game_event
   * (leave_field 等) の主語 Y (BSAZ01-C03 の離脱スピリット/アルティメット等)。
   * use_magic_without_cost が発揮する別 effectIndex (flash 本体) の
   * TargetSpec.kind:"trigger_related_instance" 解決まで引き継ぐ (synthetic ActiveStack /
   * 直接解決の両経路で resolveMagicMainAndMoveToTrash まで伝播する)。
   */
  triggerRelatedInstanceId?: string;
  triggerRelatedInstanceIds?: readonly string[];
  /**
   * ENGINE-free-magic-use-target-selection-nonfield-candidate-zones: 通常の有償
   * flash 使用 (declare_magic) は RegisteredMagicAction.candidateTargetZones を
   * action.candidateTargetZones として ActiveStack へ引き継ぐが、コスト無し使用
   * (use_magic_without_cost) が組む synthetic ActiveStack はこれを未設定のまま
   * DEFAULT_CANDIDATE_TARGET_ZONES (=["field"]) にフォールバックしていたため、
   * 対象ゾーンが hand/set_aside を含む効果 (BSAZ01-C03 等) を無償使用経路で解決すると
   * legality re-check で missing target 判定され fizzle していた。指定時は
   * magicDefinition.cardNo + magicTiming に一致する RegisteredMagicAction の
   * candidateTargetZones を syntheticStack へ反映する。
   */
  getRegisteredMagicActions?: import("../legal/legal-actions-types").MagicActionRegistrationLookup;
}

export interface MagicWithoutCostActionResult {
  state: GameState;
  chainId: string;
}

export type AvailableMagicPaymentSourcesResult =
  AvailableCardCostPaymentSourcesResult;

function createEffectActionContext(
  context: MagicActionContext,
  options: {
    chosenLifeCoreKind?: LifeCoreKind | null;
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
    getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
    getRegisteredBurstActions:
      | import("../effect/trigger-system").BurstActionRegistrationLookup
      | undefined;
    sourcePreventionLevel?: EffectPreventionLevel;
    sourcePreventionBypass?: TargetLockBypassProfile;
    /** choice ステップの選択肢インデックス (宣言時確定)。 */
    choiceIndex?: number;
    targetStepId?: string;
    targetSelectionResolved?: boolean;
    skipTargetedDisclosureAtStartStep?: boolean;
    skipTargetedDisclosureStepId?: string;
    skipTargetedDisclosureTargetStartAtStartStep?: number;
    skipTargetedDisclosureTargetCountAtStartStep?: number;
    targetGroups?: readonly PendingEffectTargetGroup[];
    payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
    recordedUsage?: import("../model").RecordedEffectUsage;
    pendingStackNegateCandidate?: ActiveStack | null;
  }
): EffectActionContext {
  return {
    chainId: context.chainId,
    resolutionKind: "magic_action",
    actingPlayerId: context.actingPlayerId,
    sourceKind: "magic",
    sourceCard: context.magicCard,
    sourceDefinition: context.magicDefinition,
    targetInstanceIds: context.targetInstanceIds,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(context.activationZone !== undefined
      ? { activationZone: context.activationZone }
      : {}),
    ...(context.triggerRelatedInstanceId !== undefined
      ? { triggerRelatedInstanceId: context.triggerRelatedInstanceId }
      : {}),
    ...(context.triggerRelatedInstanceIds !== undefined
      ? { triggerRelatedInstanceIds: context.triggerRelatedInstanceIds }
      : {}),
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    // P3-43: registration.preventionLevel から伝搬。離脱系 executor で `cannot_*` 貫通判定に使用。
    ...(options.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    // choice 変種: executeEffect が step.choice[choiceIndex - 1] を選ぶ。
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetSelectionResolved === true
      ? { targetSelectionResolved: options.targetSelectionResolved }
      : {}),
    ...(options.skipTargetedDisclosureAtStartStep === true
      ? {
          skipTargetedDisclosureAtStartStep:
            options.skipTargetedDisclosureAtStartStep,
        }
      : {}),
    ...(options.skipTargetedDisclosureStepId !== undefined
      ? { skipTargetedDisclosureStepId: options.skipTargetedDisclosureStepId }
      : {}),
    ...(options.skipTargetedDisclosureTargetStartAtStartStep !== undefined
      ? {
          skipTargetedDisclosureTargetStartAtStartStep:
            options.skipTargetedDisclosureTargetStartAtStartStep,
        }
      : {}),
    ...(options.skipTargetedDisclosureTargetCountAtStartStep !== undefined
      ? {
          skipTargetedDisclosureTargetCountAtStartStep:
            options.skipTargetedDisclosureTargetCountAtStartStep,
        }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    // P3-62: 発揮不能時の usageLimit 払戻情報を伝搬。
    ...(options.recordedUsage !== undefined
      ? { recordedUsage: options.recordedUsage }
      : {}),
    ...(options.pendingStackNegateCandidate !== undefined
      ? { pendingStackNegateCandidate: options.pendingStackNegateCandidate }
      : {}),
  };
}

function getCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const cardInstance = getCardById(state, instanceId);

  if (!cardInstance) {
    throw new Error(`${detail}: ${instanceId}`);
  }

  return cardInstance;
}

function getCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CardDefinition {
  const definition = getCardDefinitionById(definitionId);

  if (!definition) {
    throw new Error(`Unknown card definition: ${definitionId}`);
  }

  return definition;
}

function createMagicChainId(
  state: GameState,
  actingPlayerId: string,
  magicInstanceId: string
): string {
  return `magic:${state.turnNumber}:${actingPlayerId}:${state.step}:${magicInstanceId}`;
}

function getMagicActivationZone(
  magicCard: CardInstance
): "hand" | "set_aside" | "trash" | "field" {
  if (magicCard.zone === "set_aside") return "set_aside";
  if (magicCard.zone === "trash") return "trash";
  if (magicCard.zone === "field") return "field";
  return "hand";
}

function getMagicEffectiveCategories(
  state: GameState,
  magicCard: CardInstance,
  magicDefinition: CardDefinition
): readonly CardDefinition["printedCategory"][] {
  const category = getEffectiveCategory(state, magicCard, magicDefinition);
  if (category === undefined) return [];
  const categories: CardDefinition["printedCategory"][] = [category];
  if (category !== "magic" && isMagicLikeCardForm(magicCard, magicDefinition)) {
    categories.push("magic");
  }
  return categories;
}

function validateMagicCardOwnershipAndCategory(
  state: GameState,
  actingPlayerId: string,
  magicCard: CardInstance,
  magicDefinition: CardDefinition
): void {
  if (magicCard.controllerPlayerId !== actingPlayerId) {
    throw new Error(`Magic card is not controlled by ${actingPlayerId}`);
  }

  if (
    !isMagicLikeCardForm(magicCard, magicDefinition) &&
    getEffectiveCategory(state, magicCard, magicDefinition) !== "magic"
  ) {
    throw new Error(`Card is not a magic card: ${magicDefinition.cardNo}`);
  }
}

function validateMagicCardZone(
  magicCard: CardInstance,
  allowedSourceZones: readonly Zone[],
  activationZone?: "hand" | "set_aside" | "trash" | "field"
): void {
  if (allowedSourceZones.includes(magicCard.zone)) {
    return;
  }
  if (
    magicCard.zone === "in_use" &&
    activationZone !== undefined &&
    allowedSourceZones.includes(activationZone)
  ) {
    return;
  }

  throw new Error(
    `Magic card must be in one of [${allowedSourceZones.join(",")}]: ${magicCard.instanceId}`
  );
}

function validateMagicUse(
  state: GameState,
  actingPlayerId: string,
  magicCard: CardInstance,
  magicDefinition: CardDefinition
): void {
  validateMagicCardOwnershipAndCategory(
    state,
    actingPlayerId,
    magicCard,
    magicDefinition
  );
  validateMagicCardZone(magicCard, ["hand"]);
}

function getMagicCardAndDefinition(options: {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  allowedSourceZones?: readonly Zone[];
  activationZone?: "hand" | "set_aside" | "trash" | "field";
}): {
  magicCard: CardInstance;
  magicDefinition: CardDefinition;
} {
  const magicCard = getCardInstanceOrThrow(
    options.state,
    options.magicInstanceId,
    "Unknown magic card"
  );
  const magicDefinition = getCardDefinitionOrThrow(
    magicCard.definitionId,
    options.getCardDefinitionById
  );

  // 手元 (set_aside) からのマジック通常使用も可能。
  // ref: manual/ai-reference/10_rules/08b_accel-change-zero-counter.md
  // トラッシュ許可は呼び出し元が該当 registration.applicability から導出した
  // allowedSourceZones を明示的に渡すことでのみ有効になる (engine-magic-trash-use-permission、
  // adversarial verifier round1 指摘反映)。既定 (未指定) を一律 trash 込みにすると、
  // トラッシュ許可を宣言していない registration の effectIndex を使って別ゾーンの
  // カードを実行時にすり抜けさせられてしまうため、既定は従来どおり手札/手元のみに戻す。
  const allowedSourceZones = options.allowedSourceZones ?? [
    "hand",
    "set_aside",
  ];

  if (
    isCardInEffectZone(
      options.state,
      magicCard,
      allowedSourceZones,
      options.actingPlayerId,
      options.getCardDefinitionById
    )
  ) {
    validateMagicCardOwnershipAndCategory(
      options.state,
      options.actingPlayerId,
      magicCard,
      magicDefinition
    );
  } else if (
    allowedSourceZones.length === 1 &&
    allowedSourceZones[0] === "hand"
  ) {
    validateMagicUse(
      options.state,
      options.actingPlayerId,
      magicCard,
      magicDefinition
    );
  } else {
    validateMagicCardOwnershipAndCategory(
      options.state,
      options.actingPlayerId,
      magicCard,
      magicDefinition
    );
    validateMagicCardZone(
      magicCard,
      allowedSourceZones,
      options.activationZone
    );
  }

  return {
    magicCard,
    magicDefinition,
  };
}

function assertMagicTargetIsAllowed(
  state: GameState,
  targetInstanceId: string,
  effectFilterTags: readonly EffectFilterTag[],
  sourcePreventionLevel: EffectPreventionLevel = "none",
  /**
   * zone-scoped effect_immunity (ENGINE-effect-immunity-hand-zone-scope) を拾うための
   * context。省略すると getPreventionBlockReason が zone-blind な getStrongestDefenseLevel
   * (per-instance CE のみ) にフォールバックし、手札/手元ゾーン全体への immunity CE
   * (targetFilter.zone) を見逃す (ENGINE-effect-immunity-hand-zone-scope-context-gap)。
   */
  context?: {
    actingPlayerId: string;
    effectSource?: { instance?: CardInstance; definition?: CardDefinition };
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
    sourcePreventionBypass?: TargetLockBypassProfile;
  }
): void {
  const targetCard = getCardInstanceOrThrow(
    state,
    targetInstanceId,
    "Unknown target card"
  );
  const blockReason = getEffectFilterBlockReason(targetCard, effectFilterTags);

  if (blockReason !== null) {
    throw new Error(
      `Target card cannot receive this effect: target=${targetInstanceId} reason=${blockReason}`
    );
  }

  const preventionReason = getPreventionBlockReason(
    state,
    targetInstanceId,
    sourcePreventionLevel,
    context
  );
  if (preventionReason !== null) {
    throw new Error(
      `Target card cannot receive this effect: target=${targetInstanceId} reason=${preventionReason}`
    );
  }
}

export function getAvailableMagicPaymentSources(options: {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  effectMode?: "main" | "flash" | "stack";
  additionalCostModifiers?: readonly AdditionalCostModifier[];
  onBoardCoreSourceFilter?: CardFilter;
  /** 呼び出し元の registration が許可するゾーン (engine-magic-trash-use-permission)。 */
  allowedSourceZones?: readonly Zone[];
}): AvailableMagicPaymentSourcesResult {
  const { magicCard, magicDefinition } = getMagicCardAndDefinition(options);
  const base = getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: magicDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: options.magicInstanceId,
    useKind: "magic",
    ...(options.effectMode !== undefined
      ? { effectMode: options.effectMode }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
  });
  const domainSources = getBlueMagicVoidPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    magicCard,
    magicDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (domainSources.length === 0) return base;

  const totalAvailableCoreAmount =
    base.totalAvailableCoreAmount +
    domainSources.reduce((sum, source) => sum + source.availableCoreAmount, 0);
  return {
    ...base,
    onBoardCoreSources: [...base.onBoardCoreSources, ...domainSources],
    totalAvailableCoreAmount,
    canFullyPay: totalAvailableCoreAmount >= base.reduction.finalCost,
  };
}

function isBlueMagicCard(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition
): boolean {
  return (
    isMagicLikeCardForm(card, definition) &&
    getEffectiveColors(state, card, definition).includes("blue")
  );
}

function hasBlueMagicVoidPaymentDomain(definition: CardDefinition): boolean {
  return (
    definition.grandwalkerData?.kind === "grandwalker" &&
    definition.grandwalkerData.domainHooks?.includes(
      "blue_magic_void_payment"
    ) === true
  );
}

function getBlueMagicVoidPaymentSources(options: {
  state: GameState;
  actingPlayerId: string;
  magicCard: CardInstance;
  magicDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): AvailableMagicPaymentSourcesResult["onBoardCoreSources"] {
  if (
    !isBlueMagicCard(options.state, options.magicCard, options.magicDefinition)
  ) {
    return [];
  }
  return options.state.cardInstances
    .filter(
      (card) =>
        card.zone === "field" &&
        card.controllerPlayerId === options.actingPlayerId
    )
    .map((card) => {
      const definition = options.getCardDefinitionById(card.definitionId);
      if (!definition || !hasBlueMagicVoidPaymentDomain(definition)) {
        return null;
      }
      const availableCoreAmount = getTotalCoresOnCardById(
        options.state,
        card.instanceId
      );
      if (availableCoreAmount <= 0) return null;
      return {
        kind: "card" as const,
        instanceId: card.instanceId,
        definitionId: card.definitionId,
        zoneRoleName: card.zoneRoleName,
        availableCoreAmount,
        soulCoreAvailable: false,
        destination: "void" as const,
      };
    })
    .filter((source): source is NonNullable<typeof source> => source !== null);
}

/**
 * パチュリー型「コストを支払わずに使用できる」CE が当該マジックに適用できるか判定する。
 * 適用可なら 1 件目の CE 情報 (UI のソース表示用) を返す。
 * 現状は costOverride === 0 (完全無料化) のみ扱う。
 * 「コストは X として扱う」型 (costOverride > 0) は別途対応する。
 */
export interface MagicFreeUseSource {
  canUseWithoutCost: boolean;
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
}

export function getMagicFreeUseSource(options: {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  effectMode?: "main" | "flash" | "stack";
  /** 呼び出し元の registration が許可するゾーン (engine-magic-trash-use-permission)。 */
  allowedSourceZones?: readonly Zone[];
}): MagicFreeUseSource {
  const { magicCard, magicDefinition } = getMagicCardAndDefinition(options);
  const ces = getApplicableCostOverrideCEs(
    options.state,
    options.actingPlayerId,
    magicDefinition,
    {
      card: magicCard,
      effectiveCategories: getMagicEffectiveCategories(
        options.state,
        magicCard,
        magicDefinition
      ),
      effectiveColors: getEffectiveColors(
        options.state,
        magicCard,
        magicDefinition
      ),
      effectiveTribes: getEffectiveTribes(
        options.state,
        magicCard,
        magicDefinition,
        options.getCardDefinitionById
      ),
      cardZone: magicCard.zone,
      ...(options.effectMode !== undefined
        ? { cardEffectMode: options.effectMode }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    }
  );
  const freeCe = ces.find((ce) => ce.modifierAmount === 0);
  if (!freeCe) return { canUseWithoutCost: false };
  return {
    canUseWithoutCost: true,
    sourceInstanceId: freeCe.sourceInstanceId,
    sourceDefinitionId: freeCe.sourceDefinitionId,
  };
}

/**
 * 「コストNで使用できる」型 (costOverride > 0) の CE が当該マジックに
 * 適用できるか判定する (P2-05 Phase 4a, XX01「相手はマジックカードを
 * 1コストで使用できる」)。複数あれば最小コストの CE を返す。
 * 完全無料化 (amount === 0) は getMagicFreeUseSource が担当する。
 */
export interface MagicCostOverrideSource {
  sourceEffect?: import("../dsl-types").Effect;
  overrideCost: number;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  limitGroupId?: string;
  effectLabel?: string;
}

export function getMagicCostOverrideSource(options: {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  effectMode?: "main" | "flash" | "stack";
  /** 呼び出し元の registration が許可するゾーン (engine-magic-trash-use-permission)。 */
  allowedSourceZones?: readonly Zone[];
}): MagicCostOverrideSource | null {
  const { magicCard, magicDefinition } = getMagicCardAndDefinition(options);
  const ces = getApplicableCostOverrideCEs(
    options.state,
    options.actingPlayerId,
    magicDefinition,
    {
      card: magicCard,
      effectiveCategories: getMagicEffectiveCategories(
        options.state,
        magicCard,
        magicDefinition
      ),
      effectiveColors: getEffectiveColors(
        options.state,
        magicCard,
        magicDefinition
      ),
      effectiveTribes: getEffectiveTribes(
        options.state,
        magicCard,
        magicDefinition,
        options.getCardDefinitionById
      ),
      cardZone: magicCard.zone,
      ...(options.effectMode !== undefined
        ? { cardEffectMode: options.effectMode }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    }
  );
  let best: MagicCostOverrideSource | null = null;
  for (const ce of ces) {
    if (
      ce.targetInstanceId === magicCard.instanceId &&
      ce.targetFilter?.usingEffectMode !== undefined
    ) {
      continue;
    }
    const amount = ce.modifierAmount;
    if (amount === undefined || amount <= 0) continue;
    if (best === null || amount < best.overrideCost) {
      best = {
        overrideCost: amount,
        sourceInstanceId: ce.sourceInstanceId,
        sourceDefinitionId: ce.sourceDefinitionId,
        ...(() => {
          const effect =
            ce.provenance?.effectIndex !== undefined
              ? resolveDefinitionEffect(
                  options.getCardDefinitionById(
                    ce.provenance.effectSourceDefinitionId ??
                      ce.sourceDefinitionId
                  ),
                  ce.provenance.effectIndex,
                  ce.provenance.definitionPath
                )
              : undefined;
          return {
            ...(effect ? { sourceEffect: effect } : {}),
            ...(effect?.usageLimit !== undefined
              ? { usageLimit: effect.usageLimit }
              : {}),
            ...(effect?.limitGroupId !== undefined
              ? { limitGroupId: effect.limitGroupId }
              : {}),
            ...(ce.provenance?.effectIndex !== undefined
              ? { effectLabel: `cost_override:${ce.provenance.effectIndex}` }
              : {}),
          };
        })(),
      };
    }
  }
  return best;
}

function getPaymentSourceKey(
  instanceId: string,
  destination: "trash" | "void" | undefined
): string {
  return `${instanceId}:${destination ?? "trash"}`;
}

function getExplicitIndependentCorePaymentSourcesFromAvailable(options: {
  availableOnBoardCoreSources: readonly AvailableOnBoardCorePaymentSource[];
  paymentSources: readonly MagicPaymentSource[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): readonly ExplicitIndependentCorePaymentSource[] {
  const requestedKeys = new Set(
    options.paymentSources
      .filter((source) => source.kind === "card")
      .map((source) =>
        getPaymentSourceKey(source.instanceId, source.destination)
      )
  );
  const explicitSources: ExplicitIndependentCorePaymentSource[] = [];
  const explicitKeys = new Set<string>();

  for (const source of options.availableOnBoardCoreSources) {
    const key = getPaymentSourceKey(source.instanceId, source.destination);
    if (!requestedKeys.has(key) || explicitKeys.has(key)) continue;

    const definition = options.getCardDefinitionById(source.definitionId);
    if (!definition || !hasIndependentCoreManagement(definition)) continue;

    explicitKeys.add(key);
    explicitSources.push({
      instanceId: source.instanceId,
      ...(source.destination !== undefined
        ? { destination: source.destination }
        : {}),
    });
  }

  return explicitSources;
}

function applyMagicPayments(
  state: GameState,
  actingPlayerId: string,
  chainId: string,
  paymentSources: readonly MagicPaymentSource[],
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  options?: {
    onBoardCoreSourceFilter?: CardFilter;
    explicitIndependentCorePaymentSources?: readonly ExplicitIndependentCorePaymentSource[];
  }
): GameState {
  const stateAfterPayments = applyCardCostPayments({
    state,
    actingPlayerId,
    chainId,
    paymentSources,
    getCardDefinitionById,
    ...(options?.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
    ...(options?.explicitIndependentCorePaymentSources !== undefined
      ? {
          explicitIndependentCorePaymentSources:
            options.explicitIndependentCorePaymentSources,
        }
      : {}),
  });

  return {
    ...stateAfterPayments,
    log: [
      ...stateAfterPayments.log,
      `magic:cost-paid:${chainId}:${actingPlayerId}:${getTotalPaymentAmount(
        paymentSources
      )}`,
    ],
  };
}

function applyMagicZoneCostPayment(
  state: GameState,
  actingPlayerId: string,
  chainId: string,
  cardIds: readonly string[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): GameState {
  if (cardIds.length === 0) return state;

  // BSAZ03-M01 effects[1b]: 手札破棄型のコスト支払い (discard_hand) は、
  // 対象カードが現時点で手札にあることで return_to_deck_top_bottom (常にトラッシュ由来)
  // と判別できる。moveCardZone を直接呼ぶため moved_to_trash 自動効果は発火しない
  // (pendingDrawStepCostChoice の手札破棄と同じ扱い。原文「破棄したカードの効果は
  // 発揮されない」と整合する)。
  const firstCard = state.cardInstances.find(
    (card) => card.instanceId === cardIds[0]
  );
  if (firstCard?.zone === "hand") {
    let next = state;
    for (const id of cardIds) {
      next = moveCardZone(next, id, "trash");
    }
    return {
      ...next,
      log: [
        ...next.log,
        `magic:zone-cost-payment:${chainId}:${actingPlayerId}:${cardIds.join(",")}:discard_hand`,
      ],
    };
  }

  // BSAZ01-C06 effects[2]: フィールドのマジックカードをデッキの下に戻す代替コスト
  // (useCostPayment.kind:"return_to_deck_bottom_field")。field 由来カードの離脱は
  // cannot_leave_field / cannot_be_sent_to_deck 耐性チェックを要するため、discard_hand の
  // moveCardZone 直呼びや return_to_deck_top_bottom の moveTrashCardsToDeckTopBottom
  // (trash 専用) は使えず、対象カード送り込みの既存汎用効果 `send_to_deck`
  // (executeSendToDeck) を再利用する。
  if (firstCard?.zone === "field") {
    const sentState = flushPendingLeavesAndRecomputeContinuousEffects(
      executeSendToDeck(
        state,
        actingPlayerId,
        {
          kind: "send_to_deck",
          target: {
            player: "self",
            category: ["magic"],
            count: cardIds.length,
          },
          position: "bottom",
        },
        getCardDefinitionById,
        undefined,
        [...cardIds]
      ),
      getCardDefinitionById
    );
    return {
      ...sentState,
      log: [
        ...sentState.log,
        `magic:zone-cost-payment:${chainId}:${actingPlayerId}:${cardIds.join(",")}:deck_bottom_field`,
      ],
    };
  }

  const movedState = moveTrashCardsToDeckTopBottom({
    state,
    actingPlayerId,
    cardIds,
  });
  return {
    ...movedState,
    log: [
      ...movedState.log,
      `magic:zone-cost-payment:${chainId}:${actingPlayerId}:${cardIds.join(",")}:deck_top_bottom`,
    ],
  };
}

/**
 * 使用を開始したマジックを共通の in_use 状態へ移す。
 *
 * 手札/手元からの通常使用だけでなく、フィールドに置かれた【タイプ：作戦】が
 * 「効果を使用」する場合にも同じライフサイクルを使う。単に効果を「発揮」する
 * field_card_effect はこの関数を通さない。
 */
export function moveMagicCardToInUse(
  state: GameState,
  magicInstanceId: string,
  chainId: string
): GameState {
  const magicCard = getCardById(state, magicInstanceId);
  const attachedHostId =
    magicCard?.zone === "field" ? magicCard.attachedToInstanceId : null;
  const noRecombineEffect: ContinuousEffect | undefined =
    magicCard?.zone === "field" && attachedHostId !== null
      ? {
          effectId: `magic:no-recombine:${chainId}:${magicInstanceId}`,
          sourceInstanceId: magicInstanceId,
          sourceDefinitionId: magicCard.definitionId,
          actingPlayerId: magicCard.controllerPlayerId,
          targetInstanceId: magicInstanceId,
          duration: { scope: "turn" },
          createdAtTurn: state.turnNumber,
          createdAtAttackId: state.activeAttack?.attackId ?? null,
          modifierTag: "override_properties",
          metadata: {
            properties: { keywords: ["cannot_combine"] },
            source: "magic_combined_brave_no_recombine",
          },
        }
      : undefined;

  state.log.push(`magic:in-use:${chainId}:${magicInstanceId}`);
  state = moveCardZone(state, magicInstanceId, "in_use", undefined);
  return replaceCardInstances(
    {
      ...state,
      activeContinuousEffects:
        noRecombineEffect !== undefined
          ? [...state.activeContinuousEffects, noRecombineEffect]
          : state.activeContinuousEffects,
    },
    state.cardInstances.map((cardInstance) =>
      cardInstance.instanceId === magicInstanceId
        ? {
            ...cardInstance,
            attachedToInstanceId: null,
          }
        : attachedHostId !== null && cardInstance.instanceId === attachedHostId
          ? {
              ...cardInstance,
              attachedChildrenIds: cardInstance.attachedChildrenIds.filter(
                (id) => id !== magicInstanceId
              ),
            }
          : cardInstance
    )
  );
}

/**
 * 使用を完了したマジックをトラッシュ（トークンならトークンプール）へ移す共通後始末。
 *
 * `moved_to_trash` のカード自身の置換/誘発は移動直後に処理する。これにより
 * 【タイプ：作戦】等の「使用後以外でトラッシュに置かれたこのカードはフィールドに置く」も
 * 手札・手元・フィールドのどの使用元でも同じ経路で評価される。
 */
export function moveMagicCardToTrash(
  state: GameState,
  magicInstanceId: string,
  chainId: string,
  options: {
    requireInUse?: boolean;
    getCardDefinitionById?: (
      definitionId: string
    ) => CardDefinition | undefined;
  } = {}
): GameState {
  const current = getCardById(state, magicInstanceId);
  if (options.requireInUse === true && current?.zone !== "in_use") return state;
  const currentDefinition = current
    ? options.getCardDefinitionById?.(current.definitionId)
    : undefined;
  const returnsToTokenPool =
    currentDefinition !== undefined && isCardDefinitionToken(currentDefinition);
  const destinationZone = returnsToTokenPool ? "removed_from_game" : "trash";
  const zoneRoleName = currentDefinition
    ? getDefaultZoneRoleName(currentDefinition, destinationZone)
    : "magic-card";

  // マジックの使用中にもソウルコアが載り得る。カードだけをトラッシュ／トークンプールへ
  // 動かすと player.soulCoreLocation が場にないカードを指したままになるため、通常の
  // カード離脱と同じ共通プリミティブで先にコアを退避する。
  const afterCoreRelease = current
    ? resolveCardLeavesFieldCores(
        state,
        magicInstanceId,
        null,
        options.getCardDefinitionById
      )
    : state;

  afterCoreRelease.log.push(
    `${returnsToTokenPool ? "magic:token-pool" : "magic:trash"}:${chainId}:${magicInstanceId}`
  );
  const movedState: GameState = replaceCardInstances(
    {
      ...afterCoreRelease,
    },
    afterCoreRelease.cardInstances.map((cardInstance) =>
      cardInstance.instanceId === magicInstanceId
        ? {
            ...cardInstance,
            zone: destinationZone,
            zoneRoleName,
            attachedToInstanceId: null,
          }
        : cardInstance
    )
  );
  if (options.getCardDefinitionById === undefined) return movedState;

  const afterMovedToTrashEffects =
    destinationZone === "trash"
      ? processMovedToTrashEffects(
          movedState,
          [magicInstanceId],
          options.getCardDefinitionById,
          { fromZone: "in_use" }
        )
      : movedState;

  return recomputeAndRebuildContinuousEffectsForSources(
    afterMovedToTrashEffects,
    options.getCardDefinitionById,
    [magicInstanceId]
  );
}

function hasPendingBattleEndDeferralForSource(
  state: GameState,
  sourceInstanceId: string
): boolean {
  return state.pendingBattleEndDeferrals.some(
    (deferral) => deferral.sourceInstanceId === sourceInstanceId
  );
}

function checkAndQueueMagicUseOracleIfReady(
  state: GameState,
  magicInstanceId: string,
  magicTiming: "main" | "flash" | "stack",
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  chainId: string,
  options: {
    includeStackDomain?: boolean;
    magicEffectiveColors?: readonly import("../model").CardColor[] | undefined;
  } = {}
): GameState {
  if (hasOpenEffectResolutionPending(state)) return state;
  const withOracle = checkAndQueueOracleChoices(
    state,
    magicInstanceId,
    "use_magic",
    getCardDefinitionById,
    chainId,
    { magicTiming }
  );
  if (options.includeStackDomain === false) {
    return withOracle;
  }
  return checkAndQueueMagicStackDomain(
    withOracle,
    magicInstanceId,
    magicTiming,
    getCardDefinitionById,
    chainId,
    { magicEffectiveColors: options.magicEffectiveColors }
  );
}

function withMagicEffectActivationPostResolution(
  oracle: PostResolutionOracleTrigger | undefined,
  activatorPlayerId: string,
  effectActivationLogStart: number,
  metadata: {
    chainId: string;
    effectSourceTotalReduction?: number;
    effectSourceSatisfiedReductionSymbolCount?: number;
    effectSourceRequiredReductionSymbolCount?: number;
    eligibleSourceInstanceIds?: readonly string[];
  }
): PostResolutionOracleTrigger | undefined {
  if (oracle?.triggerKind !== "use_magic") return oracle;
  return {
    ...oracle,
    effectActivatedActivatorPlayerId: activatorPlayerId,
    chainId: metadata.chainId,
    effectActivationLogStart,
    ...(metadata.effectSourceTotalReduction !== undefined
      ? { effectSourceTotalReduction: metadata.effectSourceTotalReduction }
      : {}),
    ...(metadata.effectSourceSatisfiedReductionSymbolCount !== undefined
      ? {
          effectSourceSatisfiedReductionSymbolCount:
            metadata.effectSourceSatisfiedReductionSymbolCount,
        }
      : {}),
    ...(metadata.effectSourceRequiredReductionSymbolCount !== undefined
      ? {
          effectSourceRequiredReductionSymbolCount:
            metadata.effectSourceRequiredReductionSymbolCount,
        }
      : {}),
    ...(metadata.eligibleSourceInstanceIds !== undefined
      ? { eligibleSourceInstanceIds: [...metadata.eligibleSourceInstanceIds] }
      : {}),
  };
}

function hasOpenEffectResolutionPending(state: GameState): boolean {
  return hasPendingEffectResolution(state, "effect");
}

function resolveMagicMainAndMoveToTrash(options: {
  state: GameState;
  actingPlayerId: string;
  chainId: string;
  magicCard: CardInstance;
  magicDefinition: CardDefinition;
  reduction: ReductionResult;
  targetInstanceIds?: readonly string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /** P3-39: collectAndQueueTriggerReactions の listener 解決に必須。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: MagicEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  reevaluation?: ReevaluationConfig;
  /** DSL effects のタイミングフィルタ（"main" / "flash" / "stack"）。省略時は全 effects 実行。 */
  effectTimingFilter?: "main" | "flash" | "stack";
  /** 解決対象の DSL effect index。 */
  targetEffectIndex?: number;
  /** コアシュート対象の事前選択。 */
  coreShootDistribution?: Record<string, number>;
  /** コアシュートでソウルコアを取るカードの instanceId。 */
  coreShootSoulCoreInstanceId?: string;
  /** choice ステップの選択肢インデックス (宣言時確定、executeEffect の分岐選択用)。 */
  choiceIndex?: number;
  targetStepId?: string;
  targetSelectionResolved?: boolean;
  /** targeted disclosure 後の再開では対象取得 gate を再適用しない。 */
  preservePreSelectedTargetRefs?: boolean;
  /** declaration/pending selection で対象可否を検証済み。解決時の affect 再検査を禁止する。 */
  targetsValidatedAtDeclaration?: boolean;
  skipTargetedDisclosureAtStartStep?: boolean;
  skipTargetedDisclosureStepId?: string;
  skipTargetedDisclosureTargetStartAtStartStep?: number;
  skipTargetedDisclosureTargetCountAtStartStep?: number;
  targetGroups?: readonly PendingEffectTargetGroup[];
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /** P3-62: 発揮不能 (condition unmet / conditional_cost rollback) 時の usageLimit 払戻情報。 */
  recordedUsage?: import("../model").RecordedEffectUsage;
  /** マジック効果中に pending 選択が立った場合、解決完了後に使用時神託をキューする。 */
  postResolutionOracle?: import("../model").PostResolutionOracleTrigger;
  /** stack 効果解決時、直下にある無効化候補 stack。 */
  pendingStackNegateCandidate?: ActiveStack | null;
  /**
   * P3-131層2: この解決を駆動している activeStack 自身のスナップショット。
   * queueTargetedDisclosureForStep が生成する continuation へ転写され、途中で targeted
   * disclosure が割り込んだ場合の negate 応答照合にのみ使う (再開経路には関与しない)。
   */
  targetedDisclosureNegateIdentity?: ActiveStack;
  /** 宣言時に effect_activated start-latch 条件を満たした source ids。 */
  eligibleSourceInstanceIdsAtEffectActivationStart?: readonly string[];
  /**
   * 宣言時点で magicCard がいたゾーン (手札/手元/トラッシュ)。
   * `StepCondition.kind === "activation_zone"` の解決元 (ENGINE-magic-activation-source-zone-condition)。
   */
  activationZone?: "hand" | "set_aside" | "trash" | "field";
  /**
   * ENGINE-leave-field-free-use-stay-on-field-flush-gate: 三者観測 game_event の主語 Y を
   * use_magic_without_cost 経由の別 effectIndex 発揮まで引き継ぐ。
   */
  triggerRelatedInstanceId?: string;
  triggerRelatedInstanceIds?: readonly string[];
}): GameState {
  const targetEffectFilterTags = options.targetEffectFilterTags ?? ["general"];
  const effectActivationLogStart = options.state.log.length;
  const effectActivationStartEligibleSourceIds =
    options.eligibleSourceInstanceIdsAtEffectActivationStart !== undefined
      ? [...options.eligibleSourceInstanceIdsAtEffectActivationStart]
      : collectEffectActivationStartLatchSourceInstanceIds({
          state: options.state,
          activatorPlayerId: options.actingPlayerId,
          relatedInstanceId: options.magicCard.instanceId,
          effectSourceTotalReduction: options.reduction.totalReduction,
          effectSourceSatisfiedReductionSymbolCount:
            options.reduction.satisfiedReductionSymbolCount,
          effectSourceRequiredReductionSymbolCount:
            options.reduction.requiredReductionSymbolCount,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        });
  const postResolutionOracle = withMagicEffectActivationPostResolution(
    options.postResolutionOracle,
    options.actingPlayerId,
    effectActivationLogStart,
    {
      chainId: options.chainId,
      effectSourceTotalReduction: options.reduction.totalReduction,
      effectSourceSatisfiedReductionSymbolCount:
        options.reduction.satisfiedReductionSymbolCount,
      effectSourceRequiredReductionSymbolCount:
        options.reduction.requiredReductionSymbolCount,
      eligibleSourceInstanceIds: effectActivationStartEligibleSourceIds,
    }
  );

  // 未検証の同期呼び出しだけ declaration-time の対象可否を検査する。deferred stack の
  // 対象は宣言または pending selection で検証済みであり、応答後の effect immunity を
  // ここで再検査すると acquisition と affect が混ざって全体 throw になる。解決時の耐性は
  // executor の shared affect gate に委ね、対象ごとに可能な限り解決する。
  if (
    !options.targetGroups?.length &&
    options.targetsValidatedAtDeclaration !== true
  ) {
    for (const targetInstanceId of options.targetInstanceIds ?? []) {
      assertMagicTargetIsAllowed(
        options.state,
        targetInstanceId,
        targetEffectFilterTags,
        options.sourcePreventionLevel,
        {
          actingPlayerId: options.actingPlayerId,
          effectSource: {
            instance: options.magicCard,
            definition: options.magicDefinition,
          },
          getCardDefinitionById: options.getCardDefinitionById,
          ...(options.sourcePreventionBypass !== undefined
            ? { sourcePreventionBypass: options.sourcePreventionBypass }
            : {}),
        }
      );
    }
  }

  const context: MagicActionContext = {
    chainId: options.chainId,
    actingPlayerId: options.actingPlayerId,
    magicCard: options.magicCard,
    magicDefinition: options.magicDefinition,
    targetInstanceIds: [...(options.targetInstanceIds ?? [])],
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    reduction: options.reduction,
    ...(options.activationZone !== undefined
      ? { activationZone: options.activationZone }
      : {}),
    ...(options.triggerRelatedInstanceId !== undefined
      ? { triggerRelatedInstanceId: options.triggerRelatedInstanceId }
      : {}),
    ...(options.triggerRelatedInstanceIds !== undefined
      ? { triggerRelatedInstanceIds: options.triggerRelatedInstanceIds }
      : {}),
  };
  const effectActionContext = createEffectActionContext(context, {
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.sourcePreventionLevel
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetSelectionResolved === true
      ? { targetSelectionResolved: options.targetSelectionResolved }
      : {}),
    ...(options.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(options.skipTargetedDisclosureAtStartStep === true
      ? {
          skipTargetedDisclosureAtStartStep:
            options.skipTargetedDisclosureAtStartStep,
        }
      : {}),
    ...(options.skipTargetedDisclosureStepId !== undefined
      ? { skipTargetedDisclosureStepId: options.skipTargetedDisclosureStepId }
      : {}),
    ...(options.skipTargetedDisclosureTargetStartAtStartStep !== undefined
      ? {
          skipTargetedDisclosureTargetStartAtStartStep:
            options.skipTargetedDisclosureTargetStartAtStartStep,
        }
      : {}),
    ...(options.skipTargetedDisclosureTargetCountAtStartStep !== undefined
      ? {
          skipTargetedDisclosureTargetCountAtStartStep:
            options.skipTargetedDisclosureTargetCountAtStartStep,
        }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    ...(options.recordedUsage ? { recordedUsage: options.recordedUsage } : {}),
    ...(options.pendingStackNegateCandidate !== undefined
      ? { pendingStackNegateCandidate: options.pendingStackNegateCandidate }
      : {}),
  });

  const startLogs = [
    `magic:targets:${options.chainId}:${(options.targetInstanceIds ?? []).join(",")}`,
    `magic:resolve-main:start:${options.chainId}`,
  ];
  const endLogs = [
    `magic:resolve-main:end:${options.chainId}`,
    `magic:resolve-derived:end:${options.chainId}`,
  ];

  const reevalSpread = options.reevaluation
    ? { reevaluation: options.reevaluation }
    : {};

  // P3-39: hand-written magic resolver は MagicActionContext で resolveEffect を呼ぶが、
  // runActionMainResolution は context から (effectActionContext と同じ) lookup フィールドを
  // 拾うため、両形を満たす merged context を構築する。
  // P3-43: sourcePreventionLevel も伝搬する。
  const mergedMagicContext: MagicActionContext &
    Pick<
      EffectActionContext,
      | "getCardDefinitionById"
      | "getRegisteredTriggeredEffectActions"
      | "getRegisteredBurstActions"
      | "sourcePreventionLevel"
      | "sourcePreventionBypass"
      | "postResolutionOracle"
      | "pendingStackNegateCandidate"
      | "targetedDisclosureNegateIdentity"
    > = {
    ...context,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.sourcePreventionLevel
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(postResolutionOracle ? { postResolutionOracle } : {}),
    ...(options.pendingStackNegateCandidate !== undefined
      ? { pendingStackNegateCandidate: options.pendingStackNegateCandidate }
      : {}),
    ...(options.targetedDisclosureNegateIdentity !== undefined
      ? {
          targetedDisclosureNegateIdentity:
            options.targetedDisclosureNegateIdentity,
        }
      : {}),
  };

  const resolvedState = options.resolveEffect
    ? runActionMainResolution({
        state: options.state,
        chainId: options.chainId,
        context: mergedMagicContext,
        startLogs,
        endLogs,
        resolveEffect: options.resolveEffect,
        ...reevalSpread,
      })
    : options.getHandWrittenEffectResolver
      ? runActionMainResolution({
          state: options.state,
          chainId: options.chainId,
          context: {
            ...effectActionContext,
            ...(postResolutionOracle ? { postResolutionOracle } : {}),
            ...(options.pendingStackNegateCandidate !== undefined
              ? {
                  pendingStackNegateCandidate:
                    options.pendingStackNegateCandidate,
                }
              : {}),
            ...(options.targetedDisclosureNegateIdentity !== undefined
              ? {
                  targetedDisclosureNegateIdentity:
                    options.targetedDisclosureNegateIdentity,
                }
              : {}),
          },
          startLogs,
          endLogs,
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
          ...reevalSpread,
        })
      : runActionMainResolution({
          state: options.state,
          chainId: options.chainId,
          context: {
            ...context,
            resolutionKind: "magic_action",
            sourceKind: "magic",
            sourceCard: options.magicCard,
            sourceDefinition: options.magicDefinition,
            effectActionKind: "magic",
            getCardDefinitionById: options.getCardDefinitionById,
            // P3-39: triggered effect lookup を context に積み、
            // runActionMainResolution の collectAndQueueTriggerReactions が
            // リスナー無し event を捨てられるようにする。
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            ...(options.effectTimingFilter
              ? { effectTimingFilter: options.effectTimingFilter }
              : {}),
            ...(options.targetEffectIndex !== undefined
              ? { targetEffectIndex: options.targetEffectIndex }
              : {}),
            ...(options.coreShootDistribution
              ? { coreShootDistribution: options.coreShootDistribution }
              : {}),
            ...(options.coreShootSoulCoreInstanceId
              ? {
                  coreShootSoulCoreInstanceId:
                    options.coreShootSoulCoreInstanceId,
                }
              : {}),
            // P3-43: registration.preventionLevel から伝搬。
            ...(options.sourcePreventionLevel
              ? { sourcePreventionLevel: options.sourcePreventionLevel }
              : {}),
            ...(options.sourcePreventionBypass
              ? { sourcePreventionBypass: options.sourcePreventionBypass }
              : {}),
            // choice 変種: executeEffect が step.choice[choiceIndex - 1] を選ぶ。
            ...(options.choiceIndex !== undefined
              ? { choiceIndex: options.choiceIndex }
              : {}),
            ...(options.targetStepId !== undefined
              ? { targetStepId: options.targetStepId }
              : {}),
            ...(options.targetSelectionResolved === true
              ? { targetSelectionResolved: options.targetSelectionResolved }
              : {}),
            ...(options.preservePreSelectedTargetRefs === true
              ? { preservePreSelectedTargetRefs: true }
              : {}),
            ...(options.skipTargetedDisclosureAtStartStep === true
              ? {
                  skipTargetedDisclosureAtStartStep:
                    options.skipTargetedDisclosureAtStartStep,
                }
              : {}),
            ...(options.skipTargetedDisclosureStepId !== undefined
              ? {
                  skipTargetedDisclosureStepId:
                    options.skipTargetedDisclosureStepId,
                }
              : {}),
            ...(options.skipTargetedDisclosureTargetStartAtStartStep !==
            undefined
              ? {
                  skipTargetedDisclosureTargetStartAtStartStep:
                    options.skipTargetedDisclosureTargetStartAtStartStep,
                }
              : {}),
            ...(options.skipTargetedDisclosureTargetCountAtStartStep !==
            undefined
              ? {
                  skipTargetedDisclosureTargetCountAtStartStep:
                    options.skipTargetedDisclosureTargetCountAtStartStep,
                }
              : {}),
            ...(options.targetGroups !== undefined
              ? { targetGroups: options.targetGroups }
              : {}),
            // P3-62: 発揮不能時の usageLimit 払戻情報を伝搬。
            ...(options.recordedUsage
              ? { recordedUsage: options.recordedUsage }
              : {}),
            ...(postResolutionOracle ? { postResolutionOracle } : {}),
            ...(options.pendingStackNegateCandidate !== undefined
              ? {
                  pendingStackNegateCandidate:
                    options.pendingStackNegateCandidate,
                }
              : {}),
            ...(options.targetedDisclosureNegateIdentity !== undefined
              ? {
                  targetedDisclosureNegateIdentity:
                    options.targetedDisclosureNegateIdentity,
                }
              : {}),
          },
          startLogs,
          endLogs,
          ...reevalSpread,
        });

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): マジック本体解決
  // (この関数の呼び出し元 3 経路: playMagicCardAsAction / useMagicCardWithoutPayingCostAsAction
  // フォールバック / resolveDeferredMagicStack を一括カバーする SSOT) が完了した後に
  // 非バースト「効果を発揮したとき」観測を発火する。isNullified 等の早期 return は
  // 呼び出し元 (resolveDeferredMagicStack 等) 側でこの関数自体を呼ばないため到達しない。
  if (hasOutstandingEffectResolutionContinuation(resolvedState)) {
    return resolvedState;
  }
  const effectDidNotActivate = didEffectActivationFail(
    resolvedState.log.slice(effectActivationLogStart),
    options.magicCard.instanceId
  );
  const withEffectActivation = effectDidNotActivate
    ? resolvedState
    : queueEffectActivationTriggers({
        chainId: options.chainId,
        state: resolvedState,
        activatorPlayerId: options.actingPlayerId,
        relatedInstanceId: options.magicCard.instanceId,
        effectSourceTotalReduction: options.reduction.totalReduction,
        effectSourceSatisfiedReductionSymbolCount:
          options.reduction.satisfiedReductionSymbolCount,
        effectSourceRequiredReductionSymbolCount:
          options.reduction.requiredReductionSymbolCount,
        eligibleSourceInstanceIds: effectActivationStartEligibleSourceIds,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });

  if (
    hasPendingBattleEndDeferralForSource(
      withEffectActivation,
      options.magicCard.instanceId
    )
  ) {
    return withEffectActivation;
  }
  return moveMagicCardToTrash(
    withEffectActivation,
    options.magicCard.instanceId,
    options.chainId,
    {
      requireInUse: true,
      getCardDefinitionById: options.getCardDefinitionById,
    }
  );
}

function createNoCostMagicReduction(
  magicDefinition: CardDefinition,
  additionalCost: number,
  additionalCostModifiers: readonly AdditionalCostModifier[],
  effectiveCost: number,
  costFloor: number,
  requiredReductionSymbolCount: number
): ReductionResult {
  const finalCost = calculateSpecialCostFinalCost(costFloor, 0, additionalCost);
  return {
    printedCost: magicDefinition.cost,
    effectiveCost,
    totalReduction: magicDefinition.cost,
    satisfiedReductionSymbolCount: 0,
    requiredReductionSymbolCount,
    reducedCost: 0,
    additionalCost,
    finalCost,
    reductionBreakdown: [],
    fieldSymbolSources: [],
    additionalCostModifiers,
  };
}

function chooseAutoMagicPaymentSources(
  availablePaymentSources: AvailableMagicPaymentSourcesResult,
  amount: number
): readonly MagicPaymentSource[] | null {
  if (amount === 0) return [];
  if (availablePaymentSources.totalAvailableCoreAmount < amount) return null;

  let remaining = amount;
  const sources: MagicPaymentSource[] = [];
  const reserveAmount = Math.min(
    availablePaymentSources.reserveSource.availableCoreAmount,
    remaining
  );
  if (reserveAmount > 0) {
    sources.push({ kind: "reserve", amount: reserveAmount });
    remaining -= reserveAmount;
  }

  for (const source of availablePaymentSources.onBoardCoreSources) {
    if (remaining <= 0) break;
    const take = Math.min(source.availableCoreAmount, remaining);
    if (take <= 0) continue;
    sources.push({
      kind: "card",
      instanceId: source.instanceId,
      amount: take,
      ...(source.destination !== undefined
        ? { destination: source.destination }
        : {}),
    });
    remaining -= take;
  }

  return remaining === 0 ? sources : null;
}

/**
 * cost_override CE (amount>0) による上書きコスト reduction (P2-05 Phase 4a)。
 * 「Nコストで使用できる」= 最終支払いが N に固定され、軽減は適用されない。
 */
function createOverrideCostMagicReduction(
  magicDefinition: CardDefinition,
  overrideCost: number,
  additionalCost: number,
  additionalCostModifiers: readonly AdditionalCostModifier[],
  costFloor: number,
  requiredReductionSymbolCount: number
): ReductionResult {
  return {
    printedCost: magicDefinition.cost,
    effectiveCost: overrideCost,
    totalReduction: Math.max(0, magicDefinition.cost - overrideCost),
    satisfiedReductionSymbolCount: 0,
    requiredReductionSymbolCount,
    reducedCost: overrideCost,
    additionalCost,
    finalCost: calculateSpecialCostFinalCost(
      costFloor,
      overrideCost,
      additionalCost
    ),
    reductionBreakdown: [],
    fieldSymbolSources: [],
    additionalCostModifiers,
  };
}

function resolveMagicReduction(options: {
  state: GameState;
  actingPlayerId: string;
  magicCard: CardInstance;
  magicDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  withoutCost?: boolean;
  costOverrideAmount?: number;
  effectMode?: "main" | "flash" | "stack";
  additionalCostModifiers?: readonly AdditionalCostModifier[];
}): ReductionResult {
  const baseline = calculateReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.magicDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: options.magicCard.instanceId,
    useKind: "magic",
    ...(options.effectMode !== undefined
      ? { effectMode: options.effectMode }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
  });
  if (options.withoutCost) {
    const costFloor = getEffectiveCostFloor(
      options.magicDefinition,
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById,
      options.magicCard.instanceId,
      options.effectMode
    );
    return createNoCostMagicReduction(
      options.magicDefinition,
      baseline.additionalCost,
      baseline.additionalCostModifiers,
      baseline.effectiveCost ?? baseline.printedCost,
      costFloor,
      baseline.requiredReductionSymbolCount
    );
  }
  if (options.costOverrideAmount !== undefined) {
    const costFloor = getEffectiveCostFloor(
      options.magicDefinition,
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById,
      options.magicCard.instanceId,
      options.effectMode
    );
    return createOverrideCostMagicReduction(
      options.magicDefinition,
      options.costOverrideAmount,
      baseline.additionalCost,
      baseline.additionalCostModifiers,
      costFloor,
      baseline.requiredReductionSymbolCount
    );
  }
  return baseline;
}

/**
 * P3-14 C-1 / engine-field-magic-self-placement: フラッシュ/スタック効果使用ログ push
 * （コスト支払完了時点、両 dispatch 経路 (playMagicCardAsAction /
 * useMagicCardInFlashContextAsAction) 共通の SSOT ヘルパー）。
 * activationLabel / chosenTiming が main/flash/stack の magic 使用を追跡する
 * (BSAZ01-C04/C07/C08/C09/C10/C11 の「フラッシュ/スタック効果使用後以外で」自己配置
 * トリガーが flash_used 条件句 (mode:"flash"|"stack") で参照する)。
 * 打ち消し/無効化されても履歴に残す（裁定 2026-04-16）。
 * export: card-effect-system.ts の useFieldCardEffectInFlashContextAsAction からも
 * 再利用する (BSAZ01-C10 のフィールド常駐フラッシュ = magic category の
 * use_field_card_effect dispatch。旧 magic-only dispatch 2経路だけでは
 * このカテゴリ組み合わせを見逃す、adversarial verifier 2026-07-09 round1 指摘反映)。
 */
export function pushFlashCardUsageLogIfApplicable(
  state: GameState,
  usedMode: ActivatedEffectLabel | "main" | "flash" | "stack" | undefined,
  actingPlayerId: string,
  magicCard: { instanceId: string },
  magicDefinition: { cardNo: string },
  chainId: string
): GameState {
  if (usedMode !== "main" && usedMode !== "flash" && usedMode !== "stack")
    return state;
  return {
    ...state,
    flashCardUsageLog: [
      ...state.flashCardUsageLog,
      {
        playerId: actingPlayerId,
        cardInstanceId: magicCard.instanceId,
        cardDefinitionId: magicDefinition.cardNo,
        turnNumber: state.turnNumber,
        step: state.step,
        attackId: state.activeAttack?.attackId ?? null,
        mode: usedMode,
        completion: "declared",
        chainId,
      },
    ],
    log: [
      ...state.log,
      `${usedMode}:card_used:${actingPlayerId}:${magicCard.instanceId}:${magicDefinition.cardNo}`,
    ],
  };
}

function markFlashCardUsageLogCompleted(
  state: GameState,
  actingPlayerId: string,
  magicCard: { instanceId: string },
  magicDefinition: { cardNo: string }
): GameState {
  const index = state.flashCardUsageLog.findLastIndex(
    (entry) =>
      entry.playerId === actingPlayerId &&
      entry.cardInstanceId === magicCard.instanceId &&
      entry.cardDefinitionId === magicDefinition.cardNo &&
      entry.mode !== "play"
  );
  if (index < 0) return state;
  return {
    ...state,
    flashCardUsageLog: state.flashCardUsageLog.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, completion: "resolving" } : entry
    ),
  };
}

export function playMagicCardAsAction(
  options: PlayMagicCardAsActionOptions
): MagicActionResult {
  const { magicCard, magicDefinition } = getMagicCardAndDefinition(options);
  // ENGINE-magic-activation-source-zone-condition: in_use へ移動する前の宣言時ゾーンを保持する。
  const activationZone = getMagicActivationZone(magicCard);
  const magicEffectiveColors = getEffectiveColors(
    options.state,
    magicCard,
    magicDefinition
  );

  const chainId = createMagicChainId(
    options.state,
    options.actingPlayerId,
    magicCard.instanceId
  );
  const magicTiming = options.chosenTiming ?? "main";
  const reduction = resolveMagicReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    magicCard,
    magicDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.withoutCost !== undefined
      ? { withoutCost: options.withoutCost }
      : {}),
    ...(options.costOverrideAmount !== undefined
      ? { costOverrideAmount: options.costOverrideAmount }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    effectMode: magicTiming,
  });

  const shouldProcessPayment = !options.withoutCost || reduction.finalCost > 0;
  let explicitIndependentCorePaymentSources:
    | readonly ExplicitIndependentCorePaymentSource[]
    | undefined;
  if (shouldProcessPayment) {
    assertMatchingPaymentAmount(reduction, options.paymentSources);
    const availablePaymentSources = getAvailableMagicPaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      magicInstanceId: magicCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      effectMode: magicTiming,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.allowedSourceZones !== undefined
        ? { allowedSourceZones: options.allowedSourceZones }
        : {}),
    });
    assertPaymentSourcesAreAvailable({
      paymentSources: options.paymentSources,
      availableReserveCoreAmount:
        availablePaymentSources.reserveSource.availableCoreAmount,
      availableOnBoardCoreSources: availablePaymentSources.onBoardCoreSources,
    });
    explicitIndependentCorePaymentSources =
      getExplicitIndependentCorePaymentSourcesFromAvailable({
        availableOnBoardCoreSources: availablePaymentSources.onBoardCoreSources,
        paymentSources: options.paymentSources,
        getCardDefinitionById: options.getCardDefinitionById,
      });
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `magic:declare:${chainId}:${magicCard.instanceId}:${magicDefinition.cardNo}`,
      options.withoutCost
        ? `magic:without-cost:${chainId}`
        : options.costOverrideAmount !== undefined
          ? `magic:cost-override:${chainId}:${options.costOverrideAmount}`
          : `magic:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  // 使用宣言でカードを hand → in_use へ移動
  currentState = moveMagicCardToInUse(
    currentState,
    magicCard.instanceId,
    chainId
  );

  const effectActivationStartEligibleSourceIds =
    collectEffectActivationStartLatchSourceInstanceIds({
      state: currentState,
      activatorPlayerId: options.actingPlayerId,
      relatedInstanceId: magicCard.instanceId,
      effectSourceTotalReduction: reduction.totalReduction,
      effectSourceSatisfiedReductionSymbolCount:
        reduction.satisfiedReductionSymbolCount,
      effectSourceRequiredReductionSymbolCount:
        reduction.requiredReductionSymbolCount,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    });

  if (shouldProcessPayment) {
    currentState = applyMagicZoneCostPayment(
      currentState,
      options.actingPlayerId,
      chainId,
      options.zoneCostPaymentCardIds ?? [],
      options.getCardDefinitionById
    );
    // P3-108: マジック使用でもコスト支払い消滅の「消滅したとき」誘発を支払い直後に収集する。
    const stateBeforeMagicPayment = currentState;
    currentState = applyMagicPayments(
      currentState,
      options.actingPlayerId,
      chainId,
      options.paymentSources,
      options.getCardDefinitionById,
      {
        ...(options.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
          : {}),
        ...(explicitIndependentCorePaymentSources !== undefined
          ? { explicitIndependentCorePaymentSources }
          : {}),
      }
    );
    currentState = collectCostPaymentVanishTriggers({
      beforeState: stateBeforeMagicPayment,
      afterState: currentState,
      chainId,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    currentState = queueAfterCostPaidTriggers({
      chainId: chainId,
      state: currentState,
      sourceInstanceId: magicCard.instanceId,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  currentState = pushFlashCardUsageLogIfApplicable(
    currentState,
    options.activationLabel ?? options.chosenTiming,
    options.actingPlayerId,
    magicCard,
    magicDefinition,
    chainId
  );

  currentState = resolveMagicMainAndMoveToTrash({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    magicCard,
    magicDefinition,
    reduction,
    activationZone,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    ...(options.sourcePreventionLevel
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    eligibleSourceInstanceIdsAtEffectActivationStart:
      effectActivationStartEligibleSourceIds,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
    ...(options.reevaluation ? { reevaluation: options.reevaluation } : {}),
    // メイン/フラッシュどちらか選んで実行。chosenTiming で指定されたタイミングの effects のみ実行。
    ...(options.chosenTiming
      ? { effectTimingFilter: options.chosenTiming }
      : {}),
    ...(options.coreShootDistribution
      ? { coreShootDistribution: options.coreShootDistribution }
      : {}),
    ...(options.coreShootSoulCoreInstanceId
      ? { coreShootSoulCoreInstanceId: options.coreShootSoulCoreInstanceId }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    ...(options.recordedUsage ? { recordedUsage: options.recordedUsage } : {}),
    postResolutionOracle: {
      triggerCardInstanceId: magicCard.instanceId,
      triggerKind: "use_magic",
      magicTiming,
      magicEffectiveColors,
      chainId,
    },
  });

  // マジック使用時の神託チェック（マジックはフィールドに入らないため runActionMainResolution 内の検出に掛からない）
  currentState = checkAndQueueMagicUseOracleIfReady(
    currentState,
    magicCard.instanceId,
    magicTiming,
    options.getCardDefinitionById,
    chainId,
    { magicEffectiveColors }
  );
  currentState = markFlashCardUsageLogCompleted(
    currentState,
    options.actingPlayerId,
    magicCard,
    magicDefinition
  );

  return {
    state: currentState,
    chainId,
    reduction,
  };
}

export function useMagicCardWithoutPayingCostAsAction(
  options: UseMagicCardWithoutPayingCostAsActionOptions
): MagicWithoutCostActionResult {
  const { magicCard, magicDefinition } = getMagicCardAndDefinition({
    ...options,
    allowedSourceZones: options.allowedSourceZones ?? ["hand", "set_aside"],
  });
  // ENGINE-magic-activation-source-zone-condition: in_use へ移動する前の宣言時ゾーンを保持する。
  const activationZone =
    options.activationZone ?? getMagicActivationZone(magicCard);
  const chainId =
    options.chainId ??
    createMagicChainId(
      options.state,
      options.actingPlayerId,
      magicCard.instanceId
    );
  const magicTiming: "main" | "flash" | "stack" = options.magicTiming ?? "main";
  const baseline = calculateReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: magicDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: magicCard.instanceId,
    useKind: "magic",
    effectMode: magicTiming,
  });
  const reduction = createNoCostMagicReduction(
    magicDefinition,
    baseline.additionalCost,
    baseline.additionalCostModifiers,
    baseline.effectiveCost ?? baseline.printedCost,
    getEffectiveCostFloor(
      magicDefinition,
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById,
      magicCard.instanceId,
      magicTiming
    ),
    baseline.requiredReductionSymbolCount
  );
  const shouldProcessPayment = reduction.finalCost > 0;
  let explicitIndependentCorePaymentSources:
    | readonly ExplicitIndependentCorePaymentSource[]
    | undefined;
  let paymentSources: readonly MagicPaymentSource[] =
    options.paymentSources ?? [];
  if (shouldProcessPayment) {
    const availablePaymentSources = getAvailableMagicPaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      magicInstanceId: magicCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      effectMode: magicTiming,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.allowedSourceZones !== undefined
        ? { allowedSourceZones: options.allowedSourceZones }
        : {}),
    });
    if (options.paymentSources === undefined) {
      const autoPaymentSources = chooseAutoMagicPaymentSources(
        availablePaymentSources,
        reduction.finalCost
      );
      if (autoPaymentSources === null) {
        return {
          state: {
            ...options.state,
            log: [
              ...options.state.log,
              `magic:without-cost:additional-cost-unpaid:${chainId}:${options.actingPlayerId}:${reduction.finalCost}`,
            ],
          },
          chainId,
        };
      }
      paymentSources = autoPaymentSources;
    }
    assertMatchingPaymentAmount(reduction, paymentSources);
    assertPaymentSourcesAreAvailable({
      paymentSources,
      availableReserveCoreAmount:
        availablePaymentSources.reserveSource.availableCoreAmount,
      availableOnBoardCoreSources: availablePaymentSources.onBoardCoreSources,
    });
    explicitIndependentCorePaymentSources =
      getExplicitIndependentCorePaymentSourcesFromAvailable({
        availableOnBoardCoreSources: availablePaymentSources.onBoardCoreSources,
        paymentSources,
        getCardDefinitionById: options.getCardDefinitionById,
      });
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `magic:declare:${chainId}:${magicCard.instanceId}:${magicDefinition.cardNo}`,
      `magic:without-cost:${chainId}`,
    ],
  };

  // 使用宣言でカードを in_use へ移動
  currentState = moveMagicCardToInUse(
    currentState,
    magicCard.instanceId,
    chainId
  );

  const effectActivationStartEligibleSourceIds =
    collectEffectActivationStartLatchSourceInstanceIds({
      state: currentState,
      activatorPlayerId: options.actingPlayerId,
      relatedInstanceId: magicCard.instanceId,
      effectSourceTotalReduction: reduction.totalReduction,
      effectSourceSatisfiedReductionSymbolCount:
        reduction.satisfiedReductionSymbolCount,
      effectSourceRequiredReductionSymbolCount:
        reduction.requiredReductionSymbolCount,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    });

  // withoutCost でも余分コストが残る場合は、その分だけ支払う（03a: 余分コストは軽減後に加算）。
  if (shouldProcessPayment) {
    const stateBeforeMagicPayment = currentState;
    currentState = applyMagicPayments(
      currentState,
      options.actingPlayerId,
      chainId,
      paymentSources,
      options.getCardDefinitionById,
      {
        ...(options.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
          : {}),
        ...(explicitIndependentCorePaymentSources !== undefined
          ? { explicitIndependentCorePaymentSources }
          : {}),
      }
    );
    currentState = collectCostPaymentVanishTriggers({
      beforeState: stateBeforeMagicPayment,
      afterState: currentState,
      chainId,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    currentState = queueAfterCostPaidTriggers({
      chainId: chainId,
      state: currentState,
      sourceInstanceId: magicCard.instanceId,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  // engine-field-magic-self-placement (adversarial verifier round2 指摘反映):
  // コスト無し使用 (BSAZ02-C15「隕石爆撃」等の use_magic_without_cost 経路) も
  // 「フラッシュ/スタック効果使用後以外で」判定の対象。「コスト 0・能力起動時も同扱い」
  // (FlashCardUsageLogEntry の doc comment) のため、通常のコスト支払い経路と同じく記録する。
  currentState = pushFlashCardUsageLogIfApplicable(
    currentState,
    magicTiming,
    options.actingPlayerId,
    magicCard,
    magicDefinition,
    chainId
  );

  if (options.resolveDeferredStackForFreeMagicUse) {
    // ENGINE-conditional-free-magic-use-target-selection: 通常の flash 使用と同じ
    // 種別非依存 (actionKind:"magic") スタック解決経路へ synthetic ActiveStack を渡す。
    // resolveDeferredStackAction が対象選択要否を getStackTargetSelection で判定し、
    // 必要なら pendingEffectTargetSelection を立てて中断、不要/確定済みならそのまま
    // resolveDeferredMagicStack (resolveMagicMainAndMoveToTrash と postResolutionOracle 相当の
    // checkAndQueueMagicUseOracleIfReady を内包) まで解決する。新たなスタック窓は開かない
    // (この関数自体が既に窓クローズ後の同期解決文脈のため)。
    const magicEffectiveColors = getEffectiveColors(
      options.state,
      magicCard,
      magicDefinition
    );
    // ENGINE-free-magic-use-target-selection-nonfield-candidate-zones:
    // magicTiming に一致する RegisteredMagicAction の candidateTargetZones を
    // 合成 (複数 effect が同一 timing を持つ場合は和集合)。一致無し/lookup 未指定時は
    // undefined のまま従来通り DEFAULT_CANDIDATE_TARGET_ZONES フォールバックへ委ねる。
    const matchingMagicRegistrations = options
      .getRegisteredMagicActions?.(magicDefinition.cardNo)
      ?.filter((registration) => registration.timing === magicTiming);
    const freeUseCandidateTargetZones =
      matchingMagicRegistrations !== undefined &&
      matchingMagicRegistrations.length > 0
        ? Array.from(
            new Set(
              matchingMagicRegistrations.flatMap(
                (registration) => registration.candidateTargetZones ?? []
              )
            )
          )
        : undefined;
    const syntheticStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "magic",
      chainId,
      actingPlayerId: options.actingPlayerId,
      cardInstanceId: magicCard.instanceId,
      cardDefinitionId: magicCard.definitionId,
      targetInstanceIds: [...(options.targetInstanceIds ?? [])],
      targetEffectFilterTags: options.targetEffectFilterTags ?? ["general"],
      reducedCost: reduction.reducedCost,
      totalReduction: reduction.totalReduction,
      satisfiedReductionSymbolCount: reduction.satisfiedReductionSymbolCount,
      requiredReductionSymbolCount: reduction.requiredReductionSymbolCount,
      additionalCost: reduction.additionalCost,
      finalCost: reduction.finalCost,
      costForFilter: reduction.effectiveCost ?? reduction.printedCost,
      chosenTiming: magicTiming,
      magicEffectiveColors,
      magicActivationZone: activationZone,
      sourceActivationZone: activationZone,
      ...(magicCard.zone === "deck"
        ? { sourcePhysicalZone: "deck" as const }
        : {}),
      eligibleSourceInstanceIdsAtEffectActivationStart:
        effectActivationStartEligibleSourceIds,
      ...(freeUseCandidateTargetZones !== undefined &&
      freeUseCandidateTargetZones.length > 0
        ? { candidateTargetZones: freeUseCandidateTargetZones }
        : {}),
      ...(options.sourcePreventionLevel !== undefined
        ? { preventionLevel: options.sourcePreventionLevel }
        : {}),
      ...(options.sourcePreventionBypass !== undefined
        ? { preventionBypass: options.sourcePreventionBypass }
        : {}),
      ...(options.negatePreventionLevel !== undefined
        ? { negatePreventionLevel: options.negatePreventionLevel }
        : {}),
      ...(options.chosenLifeCoreKind !== undefined
        ? { chosenLifeCoreKind: options.chosenLifeCoreKind }
        : {}),
      ...(options.triggerRelatedInstanceId !== undefined
        ? { magicTriggerRelatedInstanceId: options.triggerRelatedInstanceId }
        : {}),
      ...(options.triggerRelatedInstanceIds !== undefined
        ? { magicTriggerRelatedInstanceIds: options.triggerRelatedInstanceIds }
        : {}),
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    currentState = options.resolveDeferredStackForFreeMagicUse(
      currentState,
      syntheticStack
    );
    currentState = markFlashCardUsageLogCompleted(
      currentState,
      options.actingPlayerId,
      magicCard,
      magicDefinition
    );
    return {
      state: currentState,
      chainId,
    };
  }

  currentState = resolveMagicMainAndMoveToTrash({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    magicCard,
    magicDefinition,
    reduction,
    activationZone,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    ...(options.triggerRelatedInstanceId !== undefined
      ? { triggerRelatedInstanceId: options.triggerRelatedInstanceId }
      : {}),
    ...(options.triggerRelatedInstanceIds !== undefined
      ? { triggerRelatedInstanceIds: options.triggerRelatedInstanceIds }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    eligibleSourceInstanceIdsAtEffectActivationStart:
      effectActivationStartEligibleSourceIds,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
    effectTimingFilter: magicTiming,
    ...(options.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    postResolutionOracle: {
      triggerCardInstanceId: magicCard.instanceId,
      triggerKind: "use_magic",
      magicTiming,
      chainId,
    },
  });
  currentState = checkAndQueueMagicUseOracleIfReady(
    currentState,
    magicCard.instanceId,
    magicTiming,
    options.getCardDefinitionById,
    chainId
  );
  currentState = markFlashCardUsageLogCompleted(
    currentState,
    options.actingPlayerId,
    magicCard,
    magicDefinition
  );

  return {
    state: currentState,
    chainId,
  };
}

export interface UseMagicCardInFlashContextAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  magicInstanceId: string;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  paymentSources: readonly MagicPaymentSource[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: queueAfterCostPaidTriggers の listener 解決に使用 (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  /**
   * cost_override CE 等によりコストを支払わずに使用する場合 true。
   * 軽減計算と支払いを丸ごとスキップし、reducedCost / totalReduction とも 0 で宣言する。
   * paymentSources は無視される (空配列を渡すこと推奨)。
   */
  withoutCost?: boolean;
  /**
   * cost_override CE (amount>0) による上書きコスト使用 (P2-05 Phase 4a)。
   * 軽減計算をスキップし finalCost=この値で支払う。withoutCost とは排他。
   */
  costOverrideAmount?: number;
  /** 使用時ゾーンコスト等によるコスト修正。 */
  additionalCostModifiers?: readonly AdditionalCostModifier[];
  /** 使用時コストとしてデッキへ戻すカード。 */
  zoneCostPaymentCardIds?: readonly string[];
  /**
   * 宣言時に選んだタイミング (`main` / `flash` / `stack`)。
   * activeStack に保存し deferred 解決時の effectTimingFilter に使う。
   */
  chosenTiming?: "main" | "flash" | "stack";
  /** 見出しラベル由来の起動効果カテゴリ。timing は使用窓、こちらは flash/stack 判定用。 */
  activationLabel?: ActivatedEffectLabel;
  /** 解決対象の DSL effect index。 */
  effectIndex?: number;
  /**
   * choice ステップの選択肢インデックス (use_magic 宣言時に確定)。
   * activeStack.magicChoiceIndex に保存し、deferred 解決時の executeEffect 分岐選択と
   * 窓後対象選択 (lookupRegistrationForStack の変種マージ) に使う。
   */
  choiceIndex?: number;
  /** EffectStep.choice を宣言時に確定せず、スタック窓後に提示する候補。 */
  deferredChoiceIndexes?: readonly number[];
  targetStepId?: string;
  /** 単一 targetGroups なし対象の宣言時候補 zone。未指定時は従来通り field。 */
  candidateTargetZones?: readonly Zone[];
  targetGroups?: readonly PendingEffectTargetGroup[];
  allowDuplicateTargets?: boolean;
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /**
   * 使用が別の効果解決を中断した場合に、対象/配置 pending をまたいで保持する
   * post-resolution 処理。通常の magic 使用では未指定。
   */
  postResolutionOracle?: PostResolutionOracleTrigger;
  /** フィールド上カードからの支払い元を明示的な対象フィルタに限定する。 */
  onBoardCoreSourceFilter?: CardFilter;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  /**
   * 使用元として許可するゾーン。未指定時は既定 (手札/手元) のまま。
   * `getAvailableMagicLegalActions` 側の registration.applicability 判定が既に
   * トラッシュ使用の可否をゲート済みのため、ここでは静的に手札/手元/トラッシュを許可し
   * 二重の zone 限定はしない (engine-magic-trash-use-permission)。
   */
  allowedSourceZones?: readonly Zone[];
}

export interface MagicInFlashContextResult {
  state: GameState;
  activeStack: ActiveStack;
}

export function useMagicCardInFlashContextAsAction(
  options: UseMagicCardInFlashContextAsActionOptions
): MagicInFlashContextResult {
  const { magicCard, magicDefinition } = getMagicCardAndDefinition(options);
  // ENGINE-magic-activation-source-zone-condition: in_use へ移動する前の宣言時ゾーンを保持する。
  const activationZone = getMagicActivationZone(magicCard);
  const magicEffectiveColors = getEffectiveColors(
    options.state,
    magicCard,
    magicDefinition
  );

  const chainId = createMagicChainId(
    options.state,
    options.actingPlayerId,
    magicCard.instanceId
  );
  const reduction = resolveMagicReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    magicCard,
    magicDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.withoutCost !== undefined
      ? { withoutCost: options.withoutCost }
      : {}),
    ...(options.costOverrideAmount !== undefined
      ? { costOverrideAmount: options.costOverrideAmount }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    ...(options.chosenTiming !== undefined
      ? { effectMode: options.chosenTiming }
      : {}),
  });

  const shouldProcessPayment = !options.withoutCost || reduction.finalCost > 0;
  let explicitIndependentCorePaymentSources:
    | readonly ExplicitIndependentCorePaymentSource[]
    | undefined;
  if (shouldProcessPayment) {
    assertMatchingPaymentAmount(reduction, options.paymentSources);
    const availablePaymentSources = getAvailableMagicPaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      magicInstanceId: magicCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
        : {}),
      ...(options.allowedSourceZones !== undefined
        ? { allowedSourceZones: options.allowedSourceZones }
        : {}),
      ...(options.chosenTiming !== undefined
        ? { effectMode: options.chosenTiming }
        : {}),
    });
    assertPaymentSourcesAreAvailable({
      paymentSources: options.paymentSources,
      availableReserveCoreAmount:
        availablePaymentSources.reserveSource.availableCoreAmount,
      availableOnBoardCoreSources: availablePaymentSources.onBoardCoreSources,
    });
    explicitIndependentCorePaymentSources =
      getExplicitIndependentCorePaymentSourcesFromAvailable({
        availableOnBoardCoreSources: availablePaymentSources.onBoardCoreSources,
        paymentSources: options.paymentSources,
        getCardDefinitionById: options.getCardDefinitionById,
      });
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `magic:declare:${chainId}:${magicCard.instanceId}:${magicDefinition.cardNo}`,
      options.withoutCost
        ? `magic:without-cost:${chainId}`
        : options.costOverrideAmount !== undefined
          ? `magic:cost-override:${chainId}:${options.costOverrideAmount}`
          : `magic:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  // 使用宣言でカードを hand → in_use へ移動
  currentState = moveMagicCardToInUse(
    currentState,
    magicCard.instanceId,
    chainId
  );

  const effectActivationStartEligibleSourceIds =
    collectEffectActivationStartLatchSourceInstanceIds({
      state: currentState,
      activatorPlayerId: options.actingPlayerId,
      relatedInstanceId: magicCard.instanceId,
      effectSourceTotalReduction: reduction.totalReduction,
      effectSourceSatisfiedReductionSymbolCount:
        reduction.satisfiedReductionSymbolCount,
      effectSourceRequiredReductionSymbolCount:
        reduction.requiredReductionSymbolCount,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    });

  // withoutCost でも余分コストが残る場合は、その分だけ支払う。
  if (shouldProcessPayment) {
    currentState = applyMagicZoneCostPayment(
      currentState,
      options.actingPlayerId,
      chainId,
      options.zoneCostPaymentCardIds ?? [],
      options.getCardDefinitionById
    );
    // P3-108: マジック使用でもコスト支払い消滅の「消滅したとき」誘発を支払い直後に収集する。
    const stateBeforeMagicPayment = currentState;
    currentState = applyMagicPayments(
      currentState,
      options.actingPlayerId,
      chainId,
      options.paymentSources,
      options.getCardDefinitionById,
      {
        ...(options.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
          : {}),
        ...(explicitIndependentCorePaymentSources !== undefined
          ? { explicitIndependentCorePaymentSources }
          : {}),
      }
    );
    currentState = collectCostPaymentVanishTriggers({
      beforeState: stateBeforeMagicPayment,
      afterState: currentState,
      chainId,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    currentState = queueAfterCostPaidTriggers({
      chainId: chainId,
      state: currentState,
      sourceInstanceId: magicCard.instanceId,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  // engine-field-magic-self-placement (adversarial verifier round1 指摘反映):
  // legal-actions-apply.ts の use_magic dispatch (timing: main/flash/stack) は必ずこの
  // useMagicCardInFlashContextAsAction 経由で解決される (playMagicCardAsAction 側の同名 push は
  // use_magic アクションからは到達しない dead path)。BSAZ01-C04/C07/C08/C09/C10/C11 の
  // 「フラッシュ/スタック効果使用後以外で」自己配置トリガーは、この実ディスパッチ経路での push が
  // 無いと本番で常に「未使用」判定になり自己配置トリガーが機能しない。
  currentState = pushFlashCardUsageLogIfApplicable(
    currentState,
    options.activationLabel ?? options.chosenTiming,
    options.actingPlayerId,
    magicCard,
    magicDefinition,
    chainId
  );

  // P3-73: フラッシュ効果の使用（コスト支払い完了 / コスト無し問わず）を誘発として発火。
  // 咲夜 BSTH01-X05「相手がフラッシュ効果を使用したとき」が、未解決のこの ActiveStack を
  // 対象に非公開キュー経由で反応する。
  // flash は OPT_IN 対象外（game_event responder のため）なので、lookup 未スレッドのテスト経路で
  // queuePendingReactionsFromTriggerEvents の raw-push フォールバックに落ちると、リスナー解決を
  // 経ず orphan pending が積まれてスタック進行を阻害する。lookup が揃うときだけ発火する。
  if (
    (options.activationLabel ?? options.chosenTiming) === "flash" &&
    typeof options.getCardDefinitionById === "function" &&
    typeof options.getRegisteredTriggeredEffectActions === "function"
  ) {
    currentState = queueFlashUsedTriggers({
      chainId: chainId,
      state: currentState,
      flashSourceInstanceId: magicCard.instanceId,
      userPlayerId: options.actingPlayerId,
      flashSourceFromZone: magicCard.zone,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  const activeStack: ActiveStack = {
    stackId: `stack:${chainId}`,
    actionKind: "magic",
    chainId,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: magicCard.instanceId,
    cardDefinitionId: magicCard.definitionId,
    targetInstanceIds: [...(options.targetInstanceIds ?? [])],
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.candidateTargetZones !== undefined
      ? { candidateTargetZones: options.candidateTargetZones }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...(options.allowDuplicateTargets !== undefined
      ? { allowDuplicateTargets: options.allowDuplicateTargets }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? { chosenLifeCoreKind: options.chosenLifeCoreKind }
      : {}),
    targetEffectFilterTags: options.targetEffectFilterTags ?? ["general"],
    reducedCost: reduction.reducedCost,
    totalReduction: reduction.totalReduction,
    satisfiedReductionSymbolCount: reduction.satisfiedReductionSymbolCount,
    requiredReductionSymbolCount: reduction.requiredReductionSymbolCount,
    eligibleSourceInstanceIdsAtEffectActivationStart:
      effectActivationStartEligibleSourceIds,
    additionalCost: reduction.additionalCost,
    finalCost: reduction.finalCost,
    costForFilter: reduction.effectiveCost ?? reduction.printedCost,
    ...(options.chosenTiming !== undefined
      ? { chosenTiming: options.chosenTiming }
      : {}),
    ...(options.activationLabel !== undefined
      ? { activationLabel: options.activationLabel }
      : {}),
    ...(options.sourcePreventionLevel !== undefined
      ? { preventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { preventionBypass: options.sourcePreventionBypass }
      : {}),
    magicEffectiveColors,
    magicActivationZone: activationZone,
    sourceActivationZone: activationZone,
    ...(magicCard.zone === "deck"
      ? { sourcePhysicalZone: "deck" as const }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { magicChoiceIndex: options.choiceIndex }
      : {}),
    ...(options.deferredChoiceIndexes !== undefined
      ? { deferredChoiceIndexes: options.deferredChoiceIndexes }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    ...(options.effectIndex !== undefined
      ? { magicEffectIndex: options.effectIndex }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return {
    state: currentState,
    activeStack,
  };
}

export interface ResolveDeferredMagicStackOptions {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /**
   * P3-37 follow-up + P3-39: deferred 解決の magic effect 内で発火する after_draw /
   * increase_hand 等リスナー無し event を空 pending として残さないために forward する (必須)。
   */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}

export function resolveDeferredMagicStack(
  options: ResolveDeferredMagicStackOptions
): GameState {
  const { activeStack } = options;

  const magicCard = getCardById(options.state, activeStack.cardInstanceId);
  if (!magicCard) {
    throw new Error(
      `Deferred magic card not found: ${activeStack.cardInstanceId}`
    );
  }

  const magicDefinition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  if (!magicDefinition) {
    throw new Error(`Unknown card definition: ${activeStack.cardDefinitionId}`);
  }
  const magicTiming = activeStack.chosenTiming ?? "flash";

  if (activeStack.isNullified) {
    // 効果無効化: 効果解決をスキップし in_use → trash のみ。
    // 「使用した」事実は残る (宣言・コスト支払い済み、トラッシュ移動は通常通り)。
    // 「マジックを使用したとき」を条件とする誘発は発動しうる。
    const nullified = moveMagicCardToTrash(
      {
        ...options.state,
        log: [
          ...options.state.log,
          `magic:nullified:${activeStack.chainId}:${activeStack.cardInstanceId}`,
        ],
      },
      activeStack.cardInstanceId,
      activeStack.chainId,
      { getCardDefinitionById: options.getCardDefinitionById }
    );
    const withOracle = checkAndQueueMagicUseOracleIfReady(
      nullified,
      activeStack.cardInstanceId,
      magicTiming,
      options.getCardDefinitionById,
      activeStack.chainId,
      {
        includeStackDomain: false,
        magicEffectiveColors: activeStack.magicEffectiveColors,
      }
    );
    return markFlashCardUsageLogCompleted(
      withOracle,
      activeStack.actingPlayerId,
      magicCard,
      magicDefinition
    );
  }

  // acquisition re-check: 各 target が現在も宣言時 group の zone 条件を満たすかだけ確認。
  // effect filter / effect immunity / prevention は「対象にできるか」ではなく「効果を受けるか」
  // の解決時判定であり、ここで missing target に変換してはいけない。これらは各 executor の
  // shared affect gate が対象ごとに除外し、残りの対象には効果を可能な限り解決する。
  const missingTargets = getDeferredMagicMissingTargets(
    options.state,
    activeStack
  );

  if (missingTargets !== null) {
    // effect 不発: in_use → trash のみ (効果なし)
    const fizzled = moveMagicCardToTrash(
      {
        ...options.state,
        log: [
          ...options.state.log,
          `magic:effect-fizzled:${activeStack.chainId}:${missingTargets.length > 0 ? missingTargets.join(",") : "unselected-target-groups"}`,
        ],
      },
      activeStack.cardInstanceId,
      activeStack.chainId,
      { getCardDefinitionById: options.getCardDefinitionById }
    );
    const withOracle = checkAndQueueMagicUseOracleIfReady(
      fizzled,
      activeStack.cardInstanceId,
      magicTiming,
      options.getCardDefinitionById,
      activeStack.chainId,
      {
        includeStackDomain: false,
        magicEffectiveColors: activeStack.magicEffectiveColors,
      }
    );
    return markFlashCardUsageLogCompleted(
      withOracle,
      activeStack.actingPlayerId,
      magicCard,
      magicDefinition
    );
  }

  // 対象選択の延期 (窓クローズ後・解決前) は種別非依存に
  // `resolveDeferredStackAction` 冒頭 (legal-actions-apply.ts) の getStackTargetSelection で
  // 行うため、ここには無い。本関数到達時点では targetInstanceIds は確定済み。

  const reducedCost = activeStack.reducedCost ?? 0;
  const additionalCost = activeStack.additionalCost ?? 0;
  const reduction: ReductionResult = {
    printedCost: magicDefinition.cost,
    totalReduction: activeStack.totalReduction ?? 0,
    satisfiedReductionSymbolCount:
      activeStack.satisfiedReductionSymbolCount ?? 0,
    requiredReductionSymbolCount:
      activeStack.requiredReductionSymbolCount ??
      magicDefinition.reductionSymbols.length,
    reducedCost,
    additionalCost,
    finalCost:
      activeStack.finalCost ?? Math.max(0, reducedCost + additionalCost),
    reductionBreakdown: [],
    fieldSymbolSources: [],
    additionalCostModifiers: [],
  };

  const resolved = resolveMagicMainAndMoveToTrash({
    state: options.state,
    actingPlayerId: activeStack.actingPlayerId,
    chainId: activeStack.chainId,
    magicCard,
    magicDefinition,
    reduction,
    targetInstanceIds: activeStack.targetInstanceIds,
    targetsValidatedAtDeclaration: true,
    ...(activeStack.magicActivationZone !== undefined
      ? { activationZone: activeStack.magicActivationZone }
      : {}),
    ...(activeStack.magicTriggerRelatedInstanceId !== undefined
      ? { triggerRelatedInstanceId: activeStack.magicTriggerRelatedInstanceId }
      : {}),
    ...(activeStack.magicTriggerRelatedInstanceIds !== undefined
      ? {
          triggerRelatedInstanceIds: activeStack.magicTriggerRelatedInstanceIds,
        }
      : {}),
    ...(activeStack.chosenLifeCoreKind !== undefined
      ? { chosenLifeCoreKind: activeStack.chosenLifeCoreKind }
      : {}),
    ...(activeStack.eligibleSourceInstanceIdsAtEffectActivationStart !==
    undefined
      ? {
          eligibleSourceInstanceIdsAtEffectActivationStart:
            activeStack.eligibleSourceInstanceIdsAtEffectActivationStart,
        }
      : {}),
    targetEffectFilterTags:
      activeStack.targetEffectFilterTags as EffectFilterTag[],
    ...(activeStack.preventionLevel !== undefined
      ? { sourcePreventionLevel: activeStack.preventionLevel }
      : {}),
    ...(activeStack.preventionBypass !== undefined
      ? { sourcePreventionBypass: activeStack.preventionBypass }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
    ...(activeStack.reevaluationPoints?.length
      ? {
          reevaluation: buildReevaluationConfig(
            {
              reevaluationPoints: activeStack.reevaluationPoints,
              ...(activeStack.preventionLevel !== undefined
                ? { preventionLevel: activeStack.preventionLevel }
                : {}),
              ...(activeStack.suppressionEffectDescriptor
                ? {
                    suppressionEffectDescriptor:
                      activeStack.suppressionEffectDescriptor,
                  }
                : {}),
            },
            activeStack.cardInstanceId,
            activeStack.targetInstanceIds
          )!,
        }
      : {}),
    effectTimingFilter: magicTiming,
    ...(activeStack.magicEffectIndex !== undefined
      ? { targetEffectIndex: activeStack.magicEffectIndex }
      : {}),
    // choice 変種: 宣言時に確定した分岐を executeEffect へ復元。
    ...(activeStack.magicChoiceIndex !== undefined
      ? { choiceIndex: activeStack.magicChoiceIndex }
      : {}),
    ...(activeStack.targetStepId !== undefined
      ? { targetStepId: activeStack.targetStepId }
      : {}),
    ...(activeStack.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(activeStack.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(activeStack.targetSelectionResolved === true
      ? {
          skipTargetedDisclosureAtStartStep: true,
          ...(activeStack.targetStepId !== undefined
            ? { skipTargetedDisclosureStepId: activeStack.targetStepId }
            : {}),
          skipTargetedDisclosureTargetStartAtStartStep: 0,
          skipTargetedDisclosureTargetCountAtStartStep:
            activeStack.targetInstanceIds.length,
        }
      : {}),
    ...(activeStack.targetGroups !== undefined
      ? { targetGroups: activeStack.targetGroups }
      : {}),
    ...(activeStack.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: activeStack.payCostPaymentSources }
      : {}),
    // P3-62: 宣言時に積んだ usageLimit 払戻情報を deferred 解決へ復元。
    ...(activeStack.recordedUsage
      ? { recordedUsage: activeStack.recordedUsage }
      : {}),
    pendingStackNegateCandidate: activeStack.previousPendingStackAction,
    // P3-131層2: 途中で targeted disclosure が割り込んだ場合の negate 応答照合用に、
    // この解決を駆動している activeStack 自身を identity として渡す。
    targetedDisclosureNegateIdentity: activeStack,
    postResolutionOracle: {
      ...(activeStack.postResolutionOracle ?? {}),
      chainId: activeStack.chainId,
      triggerCardInstanceId: activeStack.cardInstanceId,
      triggerKind: "use_magic",
      magicTiming,
      magicEffectiveColors: activeStack.magicEffectiveColors,
    },
  });
  const withOracle = checkAndQueueMagicUseOracleIfReady(
    resolved,
    activeStack.cardInstanceId,
    magicTiming,
    options.getCardDefinitionById,
    activeStack.chainId,
    { magicEffectiveColors: activeStack.magicEffectiveColors }
  );
  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): 「効果を発揮したとき」
  // 観測 (game_event/card_event:"effect_activated") は resolveMagicMainAndMoveToTrash
  // (上の `resolved` の呼び出し元、SSOT) 内で一括発火するため、ここでは追加不要
  // (isNullified/対象不発の早期 return はこの関数の resolveMagicMainAndMoveToTrash 呼び出し
  // より前で完結しており、そちらは通過しない)。

  // ENGINE-stack-activation-reactivation-trigger: マジックのスタック効果が完全解決した
  // 後（無効化/対象不発ではない、この関数末尾の正常解決経路のみ）に「相手がスタック効果を
  // 発揮したとき」誘発 (BSTH02.7-X01 effects[2]) を発火する。flash と同じ lookup 揃い確認。
  // P3-114: 見出しラベル位置の【スタック】効果のみが対象。activationLabel:"none"(本文中で
  // スタックタイミングを実行窓として使うだけの非スタック効果)は isLabeledStackEffectActivation
  // で除外する（magicTiming 単体では判定できない）。
  if (
    isLabeledStackEffectActivation(activeStack) &&
    typeof options.getCardDefinitionById === "function" &&
    typeof options.getRegisteredTriggeredEffectActions === "function"
  ) {
    const withStackTriggers = queueStackEffectUsedTriggers({
      chainId: activeStack.chainId,
      state: withOracle,
      stackSourceInstanceId: activeStack.cardInstanceId,
      userPlayerId: activeStack.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    return markFlashCardUsageLogCompleted(
      withStackTriggers,
      activeStack.actingPlayerId,
      magicCard,
      magicDefinition
    );
  }
  return markFlashCardUsageLogCompleted(
    withOracle,
    activeStack.actingPlayerId,
    magicCard,
    magicDefinition
  );
}

function getDeferredMagicMissingTargets(
  state: GameState,
  activeStack: ActiveStack
): string[] | null {
  // Candidate acquisition already includes permitted soul-state/advent sources.
  // Keep each selected card's actual zone through continuation; the registration's
  // ordinary zone list cannot represent those extra sources. Affect gates remain
  // in the executors, and legacy stacks retain their original zone-list check.
  const snapshottedTargets = activeStack.targetZonesByInstanceId
    ? new Set(
        filterTargetsStillInSnapshottedZones(
          state,
          activeStack.targetInstanceIds,
          activeStack.targetZonesByInstanceId
        )
      )
    : undefined;
  const targetIsStillAddressable = (
    targetId: string,
    candidateTargetZones: readonly Zone[]
  ): boolean => {
    const target = getCardById(state, targetId);
    if (snapshottedTargets) return !!target && snapshottedTargets.has(targetId);
    return !!target && candidateTargetZones.includes(target.zone);
  };

  if (!activeStack.targetGroups?.length) {
    const candidateTargetZones =
      activeStack.candidateTargetZones ?? DEFAULT_CANDIDATE_TARGET_ZONES;
    const missingTargets = activeStack.targetInstanceIds.filter(
      (targetId) => !targetIsStillAddressable(targetId, candidateTargetZones)
    );
    return missingTargets.length > 0 ? missingTargets : null;
  }

  const currentTargetGroups = activeStack.targetGroups.map((group) => ({
    ...group,
    candidateTargetInstanceIds: group.candidateTargetInstanceIds.filter(
      (targetId) =>
        targetIsStillAddressable(
          targetId,
          group.candidateTargetZones ?? DEFAULT_CANDIDATE_TARGET_ZONES
        )
    ),
  }));

  // null means a valid selection. An empty array still represents failure when
  // required groups become unsatisfiable before targets are selected (e.g. a
  // stack response's use payment makes the last opposing target vanish).
  return isLegalActionTargetGroupSelectionSatisfied({
    targetInstanceIds: activeStack.targetInstanceIds,
    targetGroups: currentTargetGroups,
    ...(activeStack.allowDuplicateTargets !== undefined
      ? { allowDuplicateTargets: activeStack.allowDuplicateTargets }
      : {}),
  })
    ? null
    : [...activeStack.targetInstanceIds];
}
