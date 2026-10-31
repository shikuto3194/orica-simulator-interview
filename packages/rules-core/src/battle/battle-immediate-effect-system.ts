import { getCardById } from "../card/card-lookup";
import {
  runActionMainResolution,
  type EffectActionContext,
  type HandWrittenEffectResolver,
  type HandWrittenEffectResolverLookup,
} from "../effect/effect-resolution";
import type { ReevaluationConfig } from "../legal/legal-actions-shared";
import {
  canUseEffectByUsageLimit,
  executeReevaluationCheck,
  getBraveSelfReferenceRewriteStatus,
  getEffectSourceTribePreventionBypass,
  getPreventionBlockReason,
  getStableEffectLabel,
  getStepUsageLabel,
  mergeRegistrationChoiceVariant,
} from "../legal/legal-actions-shared";
import {
  getEffectFilterBlockReason,
  type EffectFilterTag,
} from "../state-based-actions";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import type { BattleImmediateEffectSourceKind } from "../source-kinds";
import { isCategoryCompatibleWithSourceKind } from "../source-kinds";
import { evaluateApplicability } from "../effect/effect-applicability";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import type { ConditionSourceContext } from "../effect/structured-condition-eval";
import {
  canExecuteRebirthEffectNow,
  getAttackDeclarationRebirthTimingWindowId,
  getRebirthEffectGate,
  hasRebirthResolvedInTimingWindow,
} from "../effect/structured-card-replacement";
import type {
  BattleImmediateEffect,
  BattleImmediateEffectTiming,
  CardDefinition,
  CardInstance,
  EffectCategory,
  EffectComposition,
  EffectExecutionMode,
  EffectForceLevel,
  EffectPreventionLevel,
  EffectReevaluationPoint,
  EffectUsageLimit,
  GameState,
  SupplementalTriggerEvent,
  SuppressionEffectDescriptor,
  Zone,
  PendingEffectTargetGroup,
} from "../model";
import { textRoleUnderCardIdsOf } from "../model";
import type { RegisteredTargetGroup } from "../legal/legal-actions-types";
import {
  isActiveCombinedBraveEffectSource,
  isTextRoleUnderActiveSpiritHost,
  isActiveTextRoleUnderEffectSource,
  type TextRoleUnderSourceRole,
} from "../mechanics/star-garment-utils";
import { isActiveQuartzInheritedEffectSource } from "../mechanics/quartz-system";
import {
  mergeTargetLockBypassProfiles,
  type TargetLockBypassProfile,
} from "../effect/target-affect-gate";
export type { BattleImmediateEffectSourceKind } from "../source-kinds";

export type BattleImmediateEffectTargetPlayerScope =
  | "any"
  | "acting_player"
  /** P3-52: 対象は acting_player の相手プレイヤーのカードに限定。 */
  | "opponent";

/**
 * P3-24 Phase 2: choice ステップの選択肢ごとのメタデータ（battle immediate）。
 * choices[0] = デフォルト action、choices[1+] = choice[N-1] 各エントリ。
 */
export interface BattleImmediateEffectChoiceVariant {
  /** choice 表示用の短いラベル（例: "手札に戻す", "ドロー"）。 */
  label: string;
  requiredTargetCount?: number;
  maxTargetCount?: number;
  maxTargetCountDynamic?: import("../dsl-types").CountBound;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: BattleImmediateEffectTargetPlayerScope;
  targetGroups?: readonly RegisteredTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  targetRequiresFullCount?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  chooser?: "self" | "opponent" | "either";
  /**
   * 変種ごとに独立した使用制限 (「これらの効果はターンに1回ずつしか使えない」)。
   * `getChoiceVariantUsageLabel` の変種別ラベルで検査・記録する (effect 共有制限とは別軸)。
   */
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
}

export interface RegisteredBattleImmediateEffectAction {
  timing: BattleImmediateEffectTiming;
  sourceKind: BattleImmediateEffectSourceKind;
  /**
   * choices[] から生成された擬似 registration の選択肢番号。
   * legal action / activeStack / EffectActionContext へ同じ値を伝搬する。
   */
  choiceIndex?: number;
  effectCategory?: EffectCategory;
  executionMode?: EffectExecutionMode;
  forceLevel?: EffectForceLevel;
  preventionLevel?: EffectPreventionLevel;
  targetLockBypass?: TargetLockBypassProfile;
  composition?: EffectComposition;
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  /**
   * 分岐・反復のない単一 step の使用制限。Effect interpreter が `__step:` ラベルで
   * 記録する実行回数を、battle-immediate の queue / legal availability でも同じ
   * ラベルで事前判定するための登録メタデータ。
   */
  declarationStepUsage?: {
    stepIndex: number;
    usageLimit: EffectUsageLimit | EffectUsageLimit[];
    usageGroupId?: string;
  };
  /** この registration を発揮できる source role。 */
  requiredSourceRole?: TextRoleUnderSourceRole;
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
  reason?: string;
  requiredTargetCount?: number;
  maxTargetCount?: number;
  maxTargetCountDynamic?: import("../dsl-types").CountBound;
  /**
   * 空撃ち制御: 対象が「ことで」コストの効果側 (connector:conditional_cost) か。
   * true なら対象 0 体での空撃ちを禁止する (10_rules/03b:34)。
   */
  targetGatedByConditionalCost?: boolean;
  targetRequiresFullCount?: boolean;
  targetStepId?: string;
  targetGroups?: readonly RegisteredTargetGroup[];
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: BattleImmediateEffectTargetPlayerScope;
  /**
   * D-2 Phase 2 chooser: 対象選択を行うプレイヤー（効果オーナー基準）。
   * - 省略時 / "self" = 効果オーナーが選ぶ（既存挙動）
   * - "opponent" = 効果オーナーの相手が選ぶ
   * 効果オーナー（actingPlayerId）は据え置き、prompt 相手のみ反転される。
   */
  chooser?: "self" | "opponent" | "either";
  /** effects 配列内のインデックス。 */
  effectIndex?: number;
  /**
   * P3-24 Phase 2: choice 変種メタデータ。
   * 存在する場合は choices.length 個の legal action に展開される (各々別 choiceIndex)。
   * 省略時は choice なしの単一 action effect（top-level の target 系メタを使用）。
   */
  choices?: readonly BattleImmediateEffectChoiceVariant[];
}

/**
 * P3-24 Phase 2: choice 変種メタを registration top-level にマージした擬似 registration を生成。
 * マージ規則の正源は `mergeRegistrationChoiceVariant` (legal-actions-shared, SSOT)。
 */
export function mergeBattleImmediateChoiceVariant(
  registration: RegisteredBattleImmediateEffectAction,
  variant: BattleImmediateEffectChoiceVariant,
  choiceIndex: number
): RegisteredBattleImmediateEffectAction {
  return {
    ...mergeRegistrationChoiceVariant(registration, variant),
    choiceIndex,
  };
}

export type BattleImmediateEffectActionRegistrationLookup = (
  cardNo: string
) => readonly RegisteredBattleImmediateEffectAction[] | undefined;

export function getBattleImmediateRebirthTimingWindowId(
  prompt: Pick<
    BattleImmediateEffect,
    "attackId" | "timing" | "simultaneousGroupId" | "actingPlayerId"
  >
): string {
  if (prompt.timing === "attack" && prompt.simultaneousGroupId !== undefined) {
    return getAttackDeclarationRebirthTimingWindowId(
      prompt.attackId,
      prompt.simultaneousGroupId,
      prompt.actingPlayerId
    );
  }
  return `battle_immediate:${prompt.attackId}:${prompt.timing}:${prompt.simultaneousGroupId ?? "ungrouped"}`;
}

/** 成立済みの同時転醒は辞退専用の待機項目も残さず除く。通常のアタック時効果は維持する。 */
export function pruneConsumedRebirthBattleImmediateEffects(
  state: GameState,
  options: {
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
    getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  }
): GameState {
  const remaining = state.battleImmediateEffects.filter((prompt) => {
    if (
      !hasRebirthResolvedInTimingWindow(
        state,
        getBattleImmediateRebirthTimingWindowId(prompt)
      )
    )
      return true;
    const definition = options.getCardDefinitionById(
      prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId
    );
    const registration = definition
      ? options.getRegisteredBattleImmediateEffectActions?.(
          definition.cardNo
        )?.[prompt.registrationIndex]
      : undefined;
    return (
      registration?.effectIndex === undefined ||
      getRebirthEffectGate(definition?.effects?.[registration.effectIndex]) ===
        null
    );
  });
  return remaining.length === state.battleImmediateEffects.length
    ? state
    : { ...state, battleImmediateEffects: remaining };
}

export type BattleImmediateEffectSourceUseBlockReason =
  | "source_not_controlled_by_acting_player"
  | "source_not_on_field"
  | "source_kind_category_mismatch";

export interface UseBattleImmediateEffectAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  promptId: string;
  sourceInstanceId: string;
  sourceKind: BattleImmediateEffectSourceKind;
  targetInstanceIds?: string[];
  targetStepId?: string;
  targetGroups?: readonly PendingEffectTargetGroup[];
  /**
   * targetGroups なし単一対象の宣言時候補 zone。省略時は従来通り ["field"] のみ有効
   * (ENGINE-battle-immediate-off-field-target-revalidation)。assertTargetIsAllowed の
   * staleness re-check に使う。
   */
  candidateTargetZones?: readonly Zone[];
  /**
   * 対象選択後に stack 応答を経て再開する場合は、対象取得の legality を再評価しない。
   * 宣言済み TargetRef は維持し、効果免疫 / prevention は effect 実行側の affect gate
   * に委ねる。field を離れた等、対象 zone にもう存在しないものだけは除外する。
   */
  targetRevalidationMode?: "strict" | "presence_only";
  /** targeted disclosure 後に復元した、宣言済み TargetRef の実行文脈。 */
  preservePreSelectedTargetRefs?: boolean;
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  choiceIndex?: number;
  /** optional repeat で事前確定した基礎+追加の総発揮回数。on_step 対象は各巡で別途選ぶ。 */
  optionalRepeatTargetCount?: number;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /**
   * battle immediate の structured effect が `borrow_magic_effect` で通常マジックの
   * 登録情報（condition / choice / cost 等）を再利用するための lookup。
   */
  getRegisteredMagicActions?: import("../legal/legal-actions-types").MagicActionRegistrationLookup;
  /** P3-39: action_resolution の trigger queue forward 用 (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  reevaluation?: ReevaluationConfig;
  /** P3-62: 発揮不能時の usageLimit 払戻情報。declaration 時に積んだ activeStack.recordedUsage を復元する。 */
  recordedUsage?: import("../model").RecordedEffectUsage;
  supplementalTriggerEvents?: readonly SupplementalTriggerEvent[];
  suppressCausedLeaveEffectsForSourceInstanceId?: string | null;
}

export interface BattleImmediateEffectActionResult {
  state: GameState;
  chainId: string;
  promptId: string;
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

function createBattleImmediateEffectPromptId(options: {
  attackId: string;
  sourceInstanceId: string;
  sourceEffectInstanceId: string;
  sourceEffectDefinitionId: string;
  timing: BattleImmediateEffectTiming;
  registrationIndex: number;
}): string {
  return `battle-immediate:${options.attackId}:${options.timing}:${options.sourceInstanceId}:${options.sourceEffectInstanceId}:${options.sourceEffectDefinitionId}:${options.registrationIndex}`;
}

function createBattleImmediateEffectChainId(options: {
  state: GameState;
  prompt: BattleImmediateEffect;
}): string {
  const ownChainId = `battle-immediate:${options.state.turnNumber}:${options.prompt.actingPlayerId}:${options.prompt.attackId}:${options.prompt.timing}:${options.prompt.sourceInstanceId}:${options.prompt.sourceEffectInstanceId ?? options.prompt.sourceInstanceId}:${options.prompt.sourceEffectDefinitionId ?? options.prompt.sourceDefinitionId}:${options.prompt.registrationIndex}`;
  return options.prompt.causedByChainId
    ? `${options.prompt.causedByChainId}:${ownChainId}`
    : ownChainId;
}

export function getBattleImmediateEffectSourceUseBlockReason(
  actingPlayerId: string,
  sourceKind: BattleImmediateEffectSourceKind,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  state?: GameState
): BattleImmediateEffectSourceUseBlockReason | null {
  if (sourceCard.controllerPlayerId !== actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (sourceCard.zone !== "field") {
    return "source_not_on_field";
  }

  if (sourceKind === "system") {
    return null;
  }

  const sourceCategory =
    state !== undefined
      ? getEffectiveCategory(state, sourceCard, sourceDefinition)
      : sourceDefinition.printedCategory;

  if (sourceCategory === undefined) {
    return "source_kind_category_mismatch";
  }

  if (!isCategoryCompatibleWithSourceKind(sourceCategory, sourceKind)) {
    return "source_kind_category_mismatch";
  }

  return null;
}

function validateBattleImmediateEffectSource(
  actingPlayerId: string,
  sourceKind: BattleImmediateEffectSourceKind,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  state: GameState
): void {
  const blockReason = getBattleImmediateEffectSourceUseBlockReason(
    actingPlayerId,
    sourceKind,
    sourceCard,
    sourceDefinition,
    state
  );

  if (blockReason === null) {
    return;
  }

  if (blockReason === "source_not_controlled_by_acting_player") {
    throw new Error(
      `Battle immediate effect source card is not controlled by ${actingPlayerId}`
    );
  }

  if (blockReason === "source_not_on_field") {
    throw new Error(
      `Battle immediate effect source card must be on the field: ${sourceCard.instanceId}`
    );
  }

  throw new Error(
    `Battle immediate effect source category does not match source kind: expected=${sourceKind} actual=${sourceDefinition.printedCategory}`
  );
}

/**
 * deferred stack の宣言済み target が、対象 zone にまだ存在するかを判定する。
 * 対象取得の legal 判定とは異なり、effect immunity / prevention / pending leave は
 * affect 側で処理するため、ここでは見ない。
 */
export function isTargetStillPresentInCandidateZones(
  state: GameState,
  targetInstanceId: string,
  candidateTargetZones: readonly Zone[] = ["field"]
): boolean {
  const targetCard = getCardById(state, targetInstanceId);
  return (
    targetCard !== undefined && candidateTargetZones.includes(targetCard.zone)
  );
}

/**
 * 宣言済み battle immediate の対象を解決時に再検証する zone を返す。
 *
 * 複数 step の targetGroups では、各グループが独自の候補 zone を持つ。例えば
 * 「相手の field を最大1枚 exhausted にし、相手の trash を1枚除外する」は、
 * field 候補がゼロでも trash の必須対象を選択できる。この場合に単一対象用の既定値
 * `['field']` へ戻ると、stack pass 後に宣言済みの trash 対象を誤って stale 扱いする。
 *
 * 同じ instance が複数 group の候補なら、いずれかの宣言時 zone に残っていればよい。
 * 実際の group への割当と required count は effect interpreter の
 * `allocateGroupedTargetsByStep` が検証する。
 */
export function getBattleImmediateTargetCandidateZones(
  targetInstanceId: string,
  targetGroups: readonly PendingEffectTargetGroup[] | undefined,
  candidateTargetZones: readonly Zone[] | undefined
): readonly Zone[] {
  const groupZones = targetGroups
    ?.filter((group) =>
      group.candidateTargetInstanceIds.includes(targetInstanceId)
    )
    .flatMap((group) => group.candidateTargetZones ?? []);
  if (groupZones && groupZones.length > 0) {
    return [...new Set(groupZones)];
  }
  return candidateTargetZones ?? ["field"];
}

/**
 * battle_immediate_effect の対象を、取得時点で選択可能か判定する (SSOT)。
 * legal-actions.ts の pendingEffectTargetSelection 候補の生存判定
 * (ENGINE-battle-immediate-stale-target-fizzle) からも同一関数を再利用する。
 *
 * `candidateTargetZones` (省略時 ["field"]、ENGINE-battle-immediate-off-field-target-revalidation):
 * 「手札/トラッシュのカード1枚を除外することで」型のコスト対象は field 以外が正しい候補 zone。
 * 非 field zone が一致するときは、pendingLeaveKind / effect filter block / prevention の
 * いずれも field 上のカードにのみ意味を持つ概念のため zone 一致のみで足りる (staleness =
 * 「宣言後に対象が別 zone へ動いた/消えた」の検出であり、field 限定の意味論を流用しない)。
 */
export function isTargetStillValid(
  state: GameState,
  targetInstanceId: string,
  effectFilterTags: readonly EffectFilterTag[],
  sourcePreventionLevel: EffectPreventionLevel = "none",
  candidateTargetZones: readonly Zone[] = ["field"]
): boolean {
  if (
    !isTargetStillPresentInCandidateZones(
      state,
      targetInstanceId,
      candidateTargetZones
    )
  ) {
    return false;
  }
  const targetCard = getCardById(state, targetInstanceId)!;
  if (targetCard.zone !== "field") {
    return true;
  }
  if (targetCard.pendingLeaveKind !== null) {
    return false;
  }
  const blockReason = getEffectFilterBlockReason(targetCard, effectFilterTags);
  if (blockReason !== null) return false;
  const preventionReason = getPreventionBlockReason(
    state,
    targetInstanceId,
    sourcePreventionLevel
  );
  if (preventionReason !== null) return false;
  return true;
}

/** @deprecated Use isTargetStillValid for soft check */
function assertTargetIsAllowed(
  state: GameState,
  targetInstanceId: string,
  effectFilterTags: readonly EffectFilterTag[],
  sourcePreventionLevel: EffectPreventionLevel = "none",
  candidateTargetZones: readonly Zone[] = ["field"]
): void {
  if (
    !isTargetStillValid(
      state,
      targetInstanceId,
      effectFilterTags,
      sourcePreventionLevel,
      candidateTargetZones
    )
  ) {
    throw new Error(
      `Target card cannot receive this battle immediate effect: target=${targetInstanceId}`
    );
  }
}

function getBattleImmediateEffectPromptOrThrow(
  state: GameState,
  promptId: string
): BattleImmediateEffect {
  const prompt = state.battleImmediateEffects.find(
    (currentPrompt) => currentPrompt.promptId === promptId
  );

  if (!prompt) {
    throw new Error(
      `Unknown battle immediate effect prompt: promptId=${promptId}`
    );
  }

  return prompt;
}

function collectBattleImmediateEffectSources(options: {
  state: GameState;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}) {
  const sourceEntries: Array<{
    sourceCard: CardInstance;
    sourceDefinition: CardDefinition;
    sourceEffectDefinition: CardDefinition;
    sourceEffectInstanceId: string;
    requiredSourceRole?: TextRoleUnderSourceRole;
  }> = [
    {
      sourceCard: options.sourceCard,
      sourceDefinition: options.sourceDefinition,
      sourceEffectDefinition: options.sourceDefinition,
      sourceEffectInstanceId: options.sourceCard.instanceId,
    },
  ];
  if (
    isTextRoleUnderActiveSpiritHost({
      state: options.state,
      hostCard: options.sourceCard,
      hostDefinition: options.sourceDefinition,
    })
  ) {
    for (const underId of textRoleUnderCardIdsOf(options.sourceCard)) {
      if (
        !isActiveTextRoleUnderEffectSource({
          state: options.state,
          hostCard: options.sourceCard,
          hostDefinition: options.sourceDefinition,
          effectSourceInstanceId: underId,
        })
      )
        continue;
      const underCard = getCardById(options.state, underId);
      if (!underCard) continue;
      if (underCard.attachedToInstanceId !== options.sourceCard.instanceId) {
        continue;
      }
      if (underCard.zone !== "field" || underCard.faceDown) continue;
      const underDefinition = options.getCardDefinitionById(
        underCard.definitionId
      );
      if (!underDefinition) continue;
      sourceEntries.push({
        sourceCard: options.sourceCard,
        sourceDefinition: options.sourceDefinition,
        sourceEffectDefinition: underDefinition,
        sourceEffectInstanceId: underCard.instanceId,
        requiredSourceRole: "text_role_under",
      });
    }
  }
  const combinedBraveIds = new Set(options.sourceCard.attachedChildrenIds);
  // 異魔神ブレイヴ(imaginBraveData)の右合体スロットは attachedChildrenIds に反映しない
  // 意図的な非対称設計 (10_rules/08c §7、model.ts CardInstance.imaginRightCombinedWith)。
  // 右ホストがアタック宣言主体のときも、【左右合体中】効果は combined_brave source
  // として host source / brave effectSource で dispatch する。
  for (const candidate of options.state.cardInstances) {
    if (candidate.imaginRightCombinedWith === options.sourceCard.instanceId) {
      combinedBraveIds.add(candidate.instanceId);
    }
  }
  for (const braveId of combinedBraveIds) {
    const braveCard = getCardById(options.state, braveId);
    if (!braveCard) continue;
    if (
      braveCard.attachedToInstanceId !== options.sourceCard.instanceId &&
      braveCard.imaginRightCombinedWith !== options.sourceCard.instanceId
    ) {
      continue;
    }
    if (braveCard.zone !== "field" || braveCard.faceDown) continue;
    const braveDefinition = options.getCardDefinitionById(
      braveCard.definitionId
    );
    if (!braveDefinition || braveDefinition.printedCategory !== "brave") {
      continue;
    }
    sourceEntries.push({
      sourceCard: options.sourceCard,
      sourceDefinition: options.sourceDefinition,
      sourceEffectDefinition: braveDefinition,
      sourceEffectInstanceId: braveCard.instanceId,
      requiredSourceRole: "combined_brave",
    });
  }

  return sourceEntries;
}

export function collectRegisteredBattleImmediateEffects(options: {
  state: GameState;
  attackId: string;
  participantEntityId: string;
  actingPlayerId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  timing: BattleImmediateEffectTiming;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  simultaneousGroupId?: string;
}): BattleImmediateEffect[] {
  const queuedPrompts: BattleImmediateEffect[] = [];

  for (const {
    sourceCard,
    sourceDefinition,
    sourceEffectDefinition,
    sourceEffectInstanceId,
    requiredSourceRole,
  } of collectBattleImmediateEffectSources(options)) {
    // P3-69: フィールド上の裏向きカードは印字の能力を持たない (素性なし)。
    // 付与でスピリット化されてアタックしても、印字のアタック時/バトル時効果は発揮しない。
    if (sourceCard.zone === "field" && sourceCard.faceDown) {
      continue;
    }

    const registrations =
      options.getRegisteredBattleImmediateEffectActions?.(
        sourceEffectDefinition.cardNo
      ) ?? [];

    // P3-24 Phase 2: choice 変種は registration.choices[] に集約済み (1 effect = 1 registration)
    registrations.forEach((registration, index) => {
      if (registration.timing !== options.timing) {
        return;
      }
      if (registration.requiredSourceRole !== requiredSourceRole) {
        return;
      }

      if (
        getBattleImmediateEffectSourceUseBlockReason(
          options.actingPlayerId,
          registration.sourceKind,
          sourceCard,
          sourceDefinition,
          options.state
        ) !== null
      ) {
        return;
      }

      const sourceEffect =
        registration.effectIndex !== undefined
          ? sourceEffectDefinition.effects?.[registration.effectIndex]
          : undefined;
      const effectSourceInstanceId =
        sourceEffectInstanceId ?? sourceCard.instanceId;
      const combinedBraveSource =
        requiredSourceRole === "combined_brave" &&
        sourceEffectInstanceId !== undefined;
      const applicabilitySourceInstanceId = combinedBraveSource
        ? effectSourceInstanceId
        : sourceCard.instanceId;
      const conditionSourceInstanceId = combinedBraveSource
        ? effectSourceInstanceId
        : sourceCard.instanceId;
      const conditionSourceContext: ConditionSourceContext | undefined =
        combinedBraveSource
          ? { combinedBraveHostSourceInstanceId: sourceCard.instanceId }
          : undefined;
      if (
        registration.requiredSourceRole === "text_role_under" &&
        sourceEffectInstanceId === sourceCard.instanceId
      ) {
        return;
      }
      if (
        sourceEffect?.applicability &&
        !evaluateApplicability(
          options.state,
          sourceEffect.applicability,
          applicabilitySourceInstanceId,
          options.getCardDefinitionById
        )
      ) {
        return;
      }
      if (
        sourceEffect?.condition &&
        sourceEffect.condition.length > 0 &&
        !evaluateCondition(
          options.state,
          sourceEffect.condition,
          conditionSourceInstanceId,
          options.actingPlayerId,
          options.getCardDefinitionById,
          undefined,
          conditionSourceContext
        )
      ) {
        return;
      }
      if (
        !canExecuteRebirthEffectNow(
          options.state,
          options.actingPlayerId,
          sourceEffect,
          sourceEffectInstanceId,
          options.getCardDefinitionById,
          getBattleImmediateRebirthTimingWindowId({
            actingPlayerId: options.actingPlayerId,
            attackId: options.attackId,
            timing: options.timing,
            ...(options.simultaneousGroupId !== undefined
              ? { simultaneousGroupId: options.simultaneousGroupId }
              : {}),
          })
        )
      ) {
        return;
      }

      const selfReferenceRewriteStatus = getBraveSelfReferenceRewriteStatus({
        state: options.state,
        sourceCard,
        sourceDefinition,
        sourceEffectDefinition,
        sourceEffectInstanceId,
        effect: sourceEffect,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      if (selfReferenceRewriteStatus === "blocked") {
        return;
      }

      const dynamicPreventionBypass = getEffectSourceTribePreventionBypass(
        options.state,
        effectSourceInstanceId,
        options.actingPlayerId,
        options.getCardDefinitionById
      );
      const sourcePreventionLevel =
        dynamicPreventionBypass?.kind === "all_effects"
          ? "unpreventable"
          : (registration.preventionLevel ?? "none");
      const sourcePreventionBypass =
        dynamicPreventionBypass?.kind === "all_effects"
          ? undefined
          : mergeTargetLockBypassProfiles(
              registration.targetLockBypass,
              dynamicPreventionBypass
            );
      if (
        registration.reevaluationPoints?.some((point) =>
          point.checks.includes("effect_suppression")
        ) &&
        !executeReevaluationCheck({
          state: options.state,
          checkKind: "effect_suppression",
          sourceInstanceId: sourceCard.instanceId,
          targetInstanceIds: [],
          sourcePreventionLevel,
          ...(sourcePreventionBypass !== undefined
            ? { sourcePreventionBypass }
            : {}),
          ...(registration.suppressionEffectDescriptor !== undefined
            ? {
                suppressionEffectDescriptor:
                  registration.suppressionEffectDescriptor,
              }
            : {}),
          getCardDefinitionById: options.getCardDefinitionById,
        })
      ) {
        return;
      }

      // 使用制限を超過済みの効果は queue しない（誘発側 getAvailableTriggeredEffectSourceChoices
      // と同じ「発揮不能な空 prompt を積まない」方針）。
      // queue したまま `getAvailableBattleImmediateEffectLegalActions` が usageLimit 超過で
      // legal action 生成を continue すると、発揮も skip もできない prompt が
      // battleImmediateEffects に滞留し、アタックが進行不能になる
      // （例: BSTH01-X03 レミリアが回復で同ターン複数回アタックし、2 回目以降の『アタック時』
      // 創界神破壊が「ターンに1回」で発揮済みのケース）。
      if (
        registration.usageLimit &&
        !canUseEffectByUsageLimit({
          sourceEffect: sourceEffect,
          state: options.state,
          sourceInstanceId: sourceEffectInstanceId,
          sourceDefinitionId: sourceEffectDefinition.cardNo,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: getStableEffectLabel(
            "battle_immediate",
            index,
            registration
          ),
          usageLimit: registration.usageLimit,
          ...(registration.limitGroupId
            ? { groupId: registration.limitGroupId }
            : {}),
        })
      ) {
        return;
      }

      // 単一 step の制限も解決後の skip にせず、次の battle-immediate prompt を
      // queue する前に判定する。step usage のラベルは interpreter と共有する。
      if (
        registration.declarationStepUsage &&
        !canUseEffectByUsageLimit({
          sourceEffect,
          state: options.state,
          sourceInstanceId: sourceEffectInstanceId,
          sourceDefinitionId: sourceEffectDefinition.cardNo,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: getStepUsageLabel(
            sourceEffectDefinition.cardNo,
            registration.effectIndex ?? index,
            registration.declarationStepUsage.stepIndex,
            registration.declarationStepUsage.usageGroupId
          ),
          usageLimit: registration.declarationStepUsage.usageLimit,
        })
      ) {
        return;
      }

      queuedPrompts.push({
        promptId: createBattleImmediateEffectPromptId({
          attackId: options.attackId,
          sourceInstanceId: sourceCard.instanceId,
          sourceEffectInstanceId,
          sourceEffectDefinitionId: sourceEffectDefinition.cardNo,
          timing: options.timing,
          registrationIndex: index,
        }),
        attackId: options.attackId,
        timing: options.timing,
        sourceKind: registration.sourceKind,
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceDefinition.cardNo,
        ...(sourceEffectDefinition.cardNo !== sourceDefinition.cardNo
          ? { sourceEffectDefinitionId: sourceEffectDefinition.cardNo }
          : {}),
        ...(sourceEffectInstanceId !== sourceCard.instanceId
          ? { sourceEffectInstanceId }
          : {}),
        sourceCardNo: sourceEffectDefinition.cardNo,
        actingPlayerId: options.actingPlayerId,
        participantEntityId: options.participantEntityId,
        registrationIndex: index,
        ...(selfReferenceRewriteStatus === "allowed_optional"
          ? { executionMode: "optional" as const }
          : {}),
        ...(options.simultaneousGroupId !== undefined
          ? { simultaneousGroupId: options.simultaneousGroupId }
          : {}),
      } satisfies BattleImmediateEffect);
    });
  }

  return queuedPrompts;
}

export function queueRegisteredBattleImmediateEffects(
  options: Parameters<typeof collectRegisteredBattleImmediateEffects>[0]
): GameState {
  const queuedPrompts = collectRegisteredBattleImmediateEffects(options);
  const activeAttack = options.state.activeAttack;
  const sources = activeAttack?.immediateTimingSources ?? [];
  const sourceIndex = sources.findIndex(
    (source) =>
      source.timing === options.timing &&
      source.sourceInstanceId === options.sourceCard.instanceId
  );
  const source = {
    timing: options.timing,
    sourceInstanceId: options.sourceCard.instanceId,
    sourceDefinitionId: options.sourceDefinition.cardNo,
    fieldInstanceGeneration: options.sourceCard.fieldInstanceGeneration ?? 0,
    participantEntityId: options.participantEntityId,
    effectSourceRefs:
      sources[sourceIndex]?.effectSourceRefs ??
      collectBattleImmediateEffectSources(options).map((entry) => ({
        instanceId: entry.sourceEffectInstanceId,
        definitionId: entry.sourceEffectDefinition.cardNo,
        fieldInstanceGeneration:
          getCardById(options.state, entry.sourceEffectInstanceId)
            ?.fieldInstanceGeneration ?? 0,
      })),
    queuedPromptIds: [
      ...new Set([
        ...(sources[sourceIndex]?.queuedPromptIds ?? []),
        ...queuedPrompts.map((prompt) => prompt.promptId),
      ]),
    ],
  };
  const immediateTimingSources =
    sourceIndex < 0
      ? [...sources, source]
      : sources.map((entry, index) => (index === sourceIndex ? source : entry));

  return {
    ...options.state,
    ...(activeAttack?.attackId === options.attackId
      ? { activeAttack: { ...activeAttack, immediateTimingSources } }
      : {}),
    battleImmediateEffects: [
      ...options.state.battleImmediateEffects,
      ...queuedPrompts,
    ],
    log: [
      ...options.state.log,
      ...queuedPrompts.map(
        (prompt) =>
          `battle:immediate:queued:${prompt.promptId}:${prompt.timing}:${prompt.sourceInstanceId}:${prompt.sourceCardNo}:${prompt.participantEntityId}`
      ),
    ],
  };
}

export function useBattleImmediateEffectAsAction(
  options: UseBattleImmediateEffectAsActionOptions
): BattleImmediateEffectActionResult {
  const prompt = getBattleImmediateEffectPromptOrThrow(
    options.state,
    options.promptId
  );

  if (prompt.actingPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Battle immediate effect prompt belongs to ${prompt.actingPlayerId}, not ${options.actingPlayerId}`
    );
  }

  if (prompt.sourceKind !== options.sourceKind) {
    throw new Error(
      `Battle immediate effect prompt source kind mismatch: prompt=${prompt.sourceKind} action=${options.sourceKind}`
    );
  }

  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown battle immediate effect source card"
  );
  const sourceDefinition = getCardDefinitionOrThrow(
    prompt.sourceDefinitionId,
    options.getCardDefinitionById
  );
  const sourceEffectDefinition = getCardDefinitionOrThrow(
    prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId,
    options.getCardDefinitionById
  );
  const battleRegistrations =
    options.getRegisteredBattleImmediateEffectActions?.(
      sourceEffectDefinition.cardNo
    );
  const targetRegistration = battleRegistrations?.[prompt.registrationIndex];
  const targetEffectIndex = targetRegistration?.effectIndex;
  const targetEffect =
    targetEffectIndex !== undefined
      ? sourceEffectDefinition.effects?.[targetEffectIndex]
      : undefined;

  if (
    getBraveSelfReferenceRewriteStatus({
      state: options.state,
      sourceCard,
      sourceDefinition,
      sourceEffectDefinition,
      ...(prompt.sourceEffectInstanceId !== undefined
        ? { sourceEffectInstanceId: prompt.sourceEffectInstanceId }
        : {}),
      effect: targetEffect,
      getCardDefinitionById: options.getCardDefinitionById,
    }) === "blocked"
  ) {
    return {
      state: {
        ...options.state,
        battleImmediateEffects: options.state.battleImmediateEffects.filter(
          (queued) => queued.promptId !== prompt.promptId
        ),
        log: [
          ...options.state.log,
          `effect:effect-fizzled:${prompt.promptId}:brave-self-reference-rewrite-inactive`,
        ],
      },
      chainId: createBattleImmediateEffectChainId({
        state: options.state,
        prompt,
      }),
      promptId: prompt.promptId,
    };
  }

  if (
    prompt.sourceEffectInstanceId !== undefined &&
    prompt.sourceEffectInstanceId !== sourceCard.instanceId &&
    !isActiveTextRoleUnderEffectSource({
      state: options.state,
      hostCard: sourceCard,
      hostDefinition: sourceDefinition,
      effectSourceInstanceId: prompt.sourceEffectInstanceId,
      ...(prompt.sourceEffectDefinitionId !== undefined
        ? { effectSourceDefinitionId: prompt.sourceEffectDefinitionId }
        : {}),
    }) &&
    !isActiveQuartzInheritedEffectSource({
      state: options.state,
      hostCard: sourceCard,
      hostDefinition: sourceDefinition,
      effectSourceInstanceId: prompt.sourceEffectInstanceId,
      ...(prompt.sourceEffectDefinitionId !== undefined
        ? { effectSourceDefinitionId: prompt.sourceEffectDefinitionId }
        : {}),
    }) &&
    !isActiveCombinedBraveEffectSource({
      state: options.state,
      hostCard: sourceCard,
      effectSourceInstanceId: prompt.sourceEffectInstanceId,
      ...(prompt.sourceEffectDefinitionId !== undefined
        ? { effectSourceDefinitionId: prompt.sourceEffectDefinitionId }
        : {}),
    })
  ) {
    return {
      state: {
        ...options.state,
        battleImmediateEffects: options.state.battleImmediateEffects.filter(
          (queued) => queued.promptId !== prompt.promptId
        ),
        log: [
          ...options.state.log,
          `effect:effect-fizzled:${prompt.promptId}:effect-source-not-star-garment-under`,
        ],
      },
      chainId: createBattleImmediateEffectChainId({
        state: options.state,
        prompt,
      }),
      promptId: prompt.promptId,
    };
  }

  validateBattleImmediateEffectSource(
    options.actingPlayerId,
    options.sourceKind,
    sourceCard,
    sourceDefinition,
    options.state
  );

  const targetEffectFilterTags = options.targetEffectFilterTags ?? ["general"];

  for (const targetInstanceId of options.targetInstanceIds ?? []) {
    const candidateTargetZones = getBattleImmediateTargetCandidateZones(
      targetInstanceId,
      options.targetGroups,
      options.candidateTargetZones
    );
    if (options.targetRevalidationMode === "presence_only") {
      if (
        !isTargetStillPresentInCandidateZones(
          options.state,
          targetInstanceId,
          candidateTargetZones
        )
      ) {
        throw new Error(
          `Target card is no longer in a candidate zone for this battle immediate effect: target=${targetInstanceId}`
        );
      }
    } else {
      assertTargetIsAllowed(
        options.state,
        targetInstanceId,
        targetEffectFilterTags,
        options.sourcePreventionLevel,
        candidateTargetZones
      );
    }
  }

  const chainId = createBattleImmediateEffectChainId({
    state: options.state,
    prompt,
  });
  // P3-51: prompt.registrationIndex から registration → effectIndex を引き出し、
  // tryExecuteEffects が同一 timing の他 effect を重複発動しないようにする。
  const context: EffectActionContext = {
    chainId,
    resolutionKind: "battle_immediate_effect",
    effectEventAction: prompt.timing,
    actingPlayerId: options.actingPlayerId,
    sourceKind: options.sourceKind,
    sourceCard,
    sourceDefinition,
    ...(sourceEffectDefinition.cardNo !== sourceDefinition.cardNo
      ? { effectSourceDefinition: sourceEffectDefinition }
      : {}),
    ...(prompt.sourceEffectInstanceId !== undefined
      ? { effectSourceInstanceId: prompt.sourceEffectInstanceId }
      : {}),
    ...(prompt.sourceEffectDefinitionId !== undefined
      ? { effectSourceDefinitionId: prompt.sourceEffectDefinitionId }
      : {}),
    targetInstanceIds: options.targetInstanceIds ?? [],
    ...(options.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    rebirthTimingWindowId: getBattleImmediateRebirthTimingWindowId(prompt),
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
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
    ...(options.getRegisteredMagicActions
      ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.optionalRepeatTargetCount !== undefined
      ? { optionalRepeatTargetCount: options.optionalRepeatTargetCount }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    // P3-43: registration.preventionLevel から伝搬。
    ...(options.sourcePreventionLevel
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(targetEffectIndex !== undefined ? { targetEffectIndex } : {}),
    // P3-62: 発揮不能時 (condition unmet / conditional_cost rollback) の usageLimit 払戻情報を伝搬。
    ...(options.recordedUsage ? { recordedUsage: options.recordedUsage } : {}),
  };

  const resolvedState = runActionMainResolution({
    state: options.state,
    chainId,
    context,
    startLogs: [
      `battle:immediate:declare:${prompt.promptId}:${prompt.timing}:${sourceCard.instanceId}:${sourceEffectDefinition.cardNo}:${options.sourceKind}`,
      `battle:immediate:targets:${prompt.promptId}:${context.targetInstanceIds.join(",")}`,
      `battle:immediate:resolve:start:${prompt.promptId}`,
    ],
    endLogs: [
      `battle:immediate:resolve:end:${prompt.promptId}`,
      `battle:immediate:derived:end:${prompt.promptId}`,
    ],
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
    ...(options.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: options.supplementalTriggerEvents }
      : {}),
    ...(options.suppressCausedLeaveEffectsForSourceInstanceId !== undefined
      ? {
          suppressCausedLeaveEffectsForSourceInstanceId:
            options.suppressCausedLeaveEffectsForSourceInstanceId,
        }
      : {}),
  });

  return {
    promptId: prompt.promptId,
    chainId,
    state: {
      ...resolvedState,
      battleImmediateEffects: resolvedState.battleImmediateEffects.filter(
        (currentPrompt) => currentPrompt.promptId !== prompt.promptId
      ),
      log: [
        ...resolvedState.log,
        `battle:immediate:consumed:${prompt.promptId}`,
      ],
    },
  };
}
