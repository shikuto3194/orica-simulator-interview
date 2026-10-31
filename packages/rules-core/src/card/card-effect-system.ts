import { moveCardZone } from "../core/core-system";
import type { BattleImmediateEffectActionRegistrationLookup } from "../battle/battle-immediate-effect-system";
import { getCardById } from "./card-lookup";
import {
  type EffectActionContext,
  type HandWrittenEffectResolver,
  type HandWrittenEffectResolverLookup,
  runActionMainResolution,
} from "../effect/effect-resolution";
import type { ReevaluationConfig } from "../legal/legal-actions-shared";
import {
  buildReevaluationConfig,
  getPreventionBlockReason,
} from "../legal/legal-actions-shared";
import {
  getEffectFilterBlockReason,
  hasOutstandingEffectResolutionContinuation,
  type EffectFilterTag,
} from "../state-based-actions";
import type {
  ActiveStack,
  ActivatedEffectLabel,
  CardDefinition,
  CardInstance,
  EffectPreventionLevel,
  GameState,
  LifeCoreKind,
} from "../model";
import type { TargetLockBypassProfile } from "../effect/target-affect-gate";
import type { FieldEffectSourceKind } from "../source-kinds";
import { isCategoryCompatibleWithSourceKind } from "../source-kinds";
import {
  isActiveCombinedBraveEffectSource,
  isActiveTextRoleUnderEffectSource,
} from "../mechanics/star-garment-utils";
import { isActiveQuartzInheritedEffectSource } from "../mechanics/quartz-system";
import {
  moveMagicCardToInUse,
  moveMagicCardToTrash,
  pushFlashCardUsageLogIfApplicable,
} from "../mechanics/magic-system";
import { recomputeAndRebuildContinuousEffectsForSources } from "../effect/continuous-effect-rebuild";
import {
  isLabeledStackEffectActivation,
  queueEffectActivationTriggers,
  queueStackEffectUsedTriggers,
} from "../effect/trigger-system";
export type { FieldEffectSourceKind } from "../source-kinds";

export interface UseFieldCardEffectAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceKind: FieldEffectSourceKind;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  targetInstanceIds?: string[];
  targetStepId?: string;
  targetGroups?: readonly import("../model").PendingEffectTargetGroup[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /** P3-39: action_resolution の trigger queue forward 用 (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  reevaluation?: ReevaluationConfig;
  /**
   * 解決対象の DSL effect を絞り込むタイミングフィルタ ("main" / "flash")。
   * 省略時は全 effects が実行されるため、card_event / game_event / continuous の
   * effects がメイン効果発揮で誤発動する可能性がある。activated 効果のみを
   * 走らせたい場合は明示的に指定する。
   */
  effectTimingFilter?: "main" | "flash" | "stack";
  /**
   * 解決対象の DSL effect index。同一カードに複数の activated 効果がある場合に
   * 宣言された 1 効果のみを実行する (deferred 経路と同思想)。
   */
  targetEffectIndex?: number;
  /** choice / optional repeat の選択肢インデックス。 */
  choiceIndex?: number;
  /**
   * P3-30: 効果内 `pay_cost` step の支払いソース。EffectActionContext に伝播する。
   */
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /**
   * P3-34 B: 効果起点 summon のコスト支払い元 / コア配置。EffectActionContext に伝播する。
   */
  summonPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  summonEnterFieldCorePlacements?: readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[];
}

export interface FieldEffectActionResult {
  state: GameState;
  chainId: string;
}

export type FieldEffectSourceUseBlockReason =
  | "source_not_controlled_by_acting_player"
  | "source_not_on_field"
  | "source_kind_category_mismatch";

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

function createFieldEffectChainId(
  state: GameState,
  actingPlayerId: string,
  sourceKind: FieldEffectSourceKind,
  sourceInstanceId: string
): string {
  return `effect:${state.turnNumber}:${actingPlayerId}:${state.step}:${sourceKind}:${sourceInstanceId}`;
}

/**
 * 【タイプ：作戦】は field-card effect のうち「効果を発揮する」一般経路ではなく、
 * 場のマジックそのものを「使用する」経路であることを表す既存の keyword metadata。
 *
 * 直接発揮する契約ブレイヴ効果や、条件を満たす間フィールドに残るトークンマジックには
 * この tag を付けないため、通常の field_card_effect として場に残る。
 */
function isOperationMagicDefinition(definition: CardDefinition): boolean {
  return (
    definition.printedCategory === "magic" &&
    definition.keywordTags.includes("operation")
  );
}

/**
 * 場から使用した【タイプ：作戦】だけを通常の magic cleanup に接続する。
 * `move_self(destination:"field")` 済みなら source は in_use ではなくなるため、
 * 明示的な残置指定を上書きしない。
 */
function finishOperationMagicFieldUseIfReady(options: {
  state: GameState;
  activeStack: ActiveStack;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  if (!isOperationMagicDefinition(options.sourceDefinition))
    return options.state;
  const sourceCard = getCardById(
    options.state,
    options.activeStack.cardInstanceId
  );
  if (sourceCard?.zone !== "in_use") return options.state;
  return moveMagicCardToTrash(
    options.state,
    sourceCard.instanceId,
    options.activeStack.chainId,
    {
      requireInUse: true,
      getCardDefinitionById: options.getCardDefinitionById,
    }
  );
}

export function getFieldEffectSourceUseBlockReason(
  actingPlayerId: string,
  sourceKind: FieldEffectSourceKind,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition
): FieldEffectSourceUseBlockReason | null {
  if (sourceCard.controllerPlayerId !== actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (
    sourceCard.zone !== "field" &&
    sourceCard.zone !== "mirage" &&
    sourceCard.zone !== "burst"
  ) {
    return "source_not_on_field";
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

function validateFieldEffectSource(
  actingPlayerId: string,
  sourceKind: FieldEffectSourceKind,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition
): void {
  const blockReason = getFieldEffectSourceUseBlockReason(
    actingPlayerId,
    sourceKind,
    sourceCard,
    sourceDefinition
  );

  if (blockReason === null) {
    return;
  }

  if (blockReason === "source_not_controlled_by_acting_player") {
    throw new Error(
      `Effect source card is not controlled by ${actingPlayerId}`
    );
  }

  if (blockReason === "source_not_on_field") {
    throw new Error(
      `Effect source card must be in an active source zone: ${sourceCard.instanceId}`
    );
  }

  throw new Error(
    `Effect source category does not match source kind: expected=${sourceKind} actual=${sourceDefinition.printedCategory}`
  );
}

function assertTargetIsAllowed(
  state: GameState,
  targetInstanceId: string,
  effectFilterTags: readonly EffectFilterTag[],
  sourcePreventionLevel: EffectPreventionLevel = "none"
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
    sourcePreventionLevel
  );
  if (preventionReason !== null) {
    throw new Error(
      `Target card cannot receive this effect: target=${targetInstanceId} reason=${preventionReason}`
    );
  }
}

export function useFieldCardEffectAsAction(
  options: UseFieldCardEffectAsActionOptions
): FieldEffectActionResult {
  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown effect source card"
  );
  const sourceDefinition = getCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const effectSourceDefinition =
    options.effectSourceDefinitionId !== undefined
      ? getCardDefinitionOrThrow(
          options.effectSourceDefinitionId,
          options.getCardDefinitionById
        )
      : undefined;

  // category 両立性は物理カード (sourceCard, 例: quartz host ENIGMA=brave) ではなく
  // 効果の発揮元定義 (effectSourceDefinition, quartz card 自身) で判定する
  // (legal-actions-availability.ts の getAvailableFieldCardEffectLegalActions と同じ修正、
  // ENGINE-quartz-host-identity-propagation activated 側。declare 時にも揃えないと
  // 列挙は通るが宣言時に source_kind_category_mismatch で throw する)。
  validateFieldEffectSource(
    options.actingPlayerId,
    options.sourceKind,
    sourceCard,
    effectSourceDefinition ?? sourceDefinition
  );

  const targetEffectFilterTags = options.targetEffectFilterTags ?? ["general"];

  for (const targetInstanceId of options.targetInstanceIds ?? []) {
    assertTargetIsAllowed(
      options.state,
      targetInstanceId,
      targetEffectFilterTags,
      options.sourcePreventionLevel
    );
  }

  const chainId = createFieldEffectChainId(
    options.state,
    options.actingPlayerId,
    options.sourceKind,
    sourceCard.instanceId
  );
  const context: EffectActionContext = {
    chainId,
    resolutionKind: "field_card_effect_action",
    actingPlayerId: options.actingPlayerId,
    sourceKind: options.sourceKind,
    sourceCard,
    sourceDefinition,
    ...(effectSourceDefinition !== undefined ? { effectSourceDefinition } : {}),
    targetInstanceIds: options.targetInstanceIds ?? [],
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
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
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.effectTimingFilter
      ? { effectTimingFilter: options.effectTimingFilter }
      : {}),
    ...(options.targetEffectIndex !== undefined
      ? { targetEffectIndex: options.targetEffectIndex }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    ...(options.summonPaymentSources !== undefined
      ? { summonPaymentSources: options.summonPaymentSources }
      : {}),
    ...(options.summonEnterFieldCorePlacements !== undefined
      ? {
          summonEnterFieldCorePlacements:
            options.summonEnterFieldCorePlacements,
        }
      : {}),
    // P3-43: registration.preventionLevel から伝搬。
    ...(options.sourcePreventionLevel
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
  };

  const currentState = runActionMainResolution({
    state: options.state,
    chainId,
    context,
    startLogs: [
      `effect:declare:${chainId}:${sourceCard.instanceId}:${sourceDefinition.cardNo}:${options.sourceKind}`,
      `effect:targets:${chainId}:${context.targetInstanceIds.join(",")}`,
      `effect:resolve-main:start:${chainId}`,
    ],
    endLogs: [
      `effect:resolve-main:end:${chainId}`,
      `effect:resolve-derived:end:${chainId}`,
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
  });

  return {
    state: currentState,
    chainId,
  };
}

export interface UseFieldCardEffectInFlashContextAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceKind: FieldEffectSourceKind;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  targetInstanceIds?: string[];
  targetStepId?: string;
  targetGroups?: readonly import("../model").PendingEffectTargetGroup[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** deferred 解決時の DSL effects タイミングフィルタ。activeStack に保持して resolveDeferredFieldEffectStack が利用する。 */
  effectTimingFilter?: "main" | "flash" | "stack";
  /** 見出しラベル由来の起動効果カテゴリ。未指定時は effectTimingFilter 相当。 */
  activationLabel?: ActivatedEffectLabel;
  /**
   * 起動された field card effect の registration index。
   * 同一カードに複数の `activated/flash` 効果がある場合 (例: BSTH01-X04 フランドール) に
   * どの効果が宣言されたかを GUI 表示・debug 用に保持する。
   * `effectIndex` ではなく `RegisteredFieldCardEffectAction[]` 内の index を保持する。
   */
  registrationIndex?: number;
  /** 起動された field card effect が指す DSL `effects[]` index。 */
  fieldEffectIndex?: number;
  /**
   * P3-30: 効果内 `pay_cost` step の支払いソース。
   * 宣言時に activeStack に保持し、deferred 解決時に EffectActionContext へ復元する。
   */
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  /**
   * ことで構文 (`conditional_cost`) の `pay_cost` コア源選択を窓後へ遅延させる意思表示。
   * 宣言時に activeStack へ保持し、deferred 解決で
   * `allowPendingPayCostSourceAllocation` に橋渡しする。
   */
  deferPayCostSourceSelection?: boolean;
  /**
   * P3-34 B: 効果起点 summon のコスト支払い元 / コア配置。
   * 宣言時に activeStack に保持し、deferred 解決時に EffectActionContext へ復元する。
   */
  summonPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[];
  summonEnterFieldCorePlacements?: readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[];
}

export interface FieldEffectInFlashContextResult {
  state: GameState;
  activeStack: ActiveStack;
}

export function useFieldCardEffectInFlashContextAsAction(
  options: UseFieldCardEffectInFlashContextAsActionOptions
): FieldEffectInFlashContextResult {
  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown effect source card"
  );
  const sourceDefinition = getCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const effectSourceDefinition =
    options.effectSourceDefinitionId !== undefined
      ? getCardDefinitionOrThrow(
          options.effectSourceDefinitionId,
          options.getCardDefinitionById
        )
      : undefined;

  // category 両立性は物理カード (sourceCard, 例: quartz host ENIGMA=brave) ではなく
  // 効果の発揮元定義 (effectSourceDefinition, quartz card 自身) で判定する
  // (legal-actions-availability.ts の getAvailableFieldCardEffectLegalActions と同じ修正、
  // ENGINE-quartz-host-identity-propagation activated 側。列挙は通っても宣言時に
  // source_kind_category_mismatch で throw していた欠落を解消)。
  validateFieldEffectSource(
    options.actingPlayerId,
    options.sourceKind,
    sourceCard,
    effectSourceDefinition ?? sourceDefinition
  );

  const targetEffectFilterTags = options.targetEffectFilterTags ?? ["general"];

  for (const targetInstanceId of options.targetInstanceIds ?? []) {
    assertTargetIsAllowed(
      options.state,
      targetInstanceId,
      targetEffectFilterTags,
      options.sourcePreventionLevel
    );
  }

  const chainId = createFieldEffectChainId(
    options.state,
    options.actingPlayerId,
    options.sourceKind,
    sourceCard.instanceId
  );

  const declaredState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:declare:${chainId}:${sourceCard.instanceId}:${sourceDefinition.cardNo}:${options.sourceKind}`,
      `effect:targets:${chainId}:${(options.targetInstanceIds ?? []).join(",")}`,
    ],
  };

  // 【タイプ：作戦】の「このカードは、…効果を使用できる」は場のカードからの
  // magic use。解決中は in_use とし、通常の使用完了後処理で trash へ進める。
  // 「発揮する」だけの field effect はここを通らない。
  const stateWithOperationMagicInUse = isOperationMagicDefinition(
    sourceDefinition
  )
    ? recomputeAndRebuildContinuousEffectsForSources(
        moveMagicCardToInUse(declaredState, sourceCard.instanceId, chainId),
        options.getCardDefinitionById,
        [sourceCard.instanceId]
      )
    : declaredState;

  // engine-field-magic-self-placement (adversarial verifier 2026-07-09 round1 指摘反映):
  // magic category の field-card-effect 起動 (BSAZ01-C10「フィールドに置かれている間、
  // 次の効果を発揮する」等の field 常駐フラッシュ/スタック) も、magic-system.ts の
  // 2 dispatch 経路 (playMagicCardAsAction / useMagicCardInFlashContextAsAction) と同じ
  // flashCardUsageLog SSOT を通す。無いと BSAZ01-C04/C06/C07/C10/C11 等の
  // 自己配置トリガー (effects[0], flash_used 条件) が「フィールド常駐フラッシュ使用済み」を
  // 検知できない。
  const currentState: GameState =
    sourceDefinition.printedCategory === "magic"
      ? pushFlashCardUsageLogIfApplicable(
          stateWithOperationMagicInUse,
          options.activationLabel ?? options.effectTimingFilter,
          options.actingPlayerId,
          sourceCard,
          sourceDefinition,
          chainId
        )
      : stateWithOperationMagicInUse;

  const activeStack: ActiveStack = {
    stackId: `stack:${chainId}`,
    actionKind: "field_card_effect",
    chainId,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: sourceCard.instanceId,
    cardDefinitionId: sourceCard.definitionId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    targetInstanceIds: [...(options.targetInstanceIds ?? [])],
    ...(options.targetStepId !== undefined
      ? { targetStepId: options.targetStepId }
      : {}),
    ...(options.targetGroups !== undefined
      ? { targetGroups: options.targetGroups }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? { chosenLifeCoreKind: options.chosenLifeCoreKind }
      : {}),
    targetEffectFilterTags,
    fieldEffectSourceKind: options.sourceKind,
    ...(options.effectTimingFilter
      ? { chosenTiming: options.effectTimingFilter }
      : {}),
    // 【セット中】起動効果は field_card_effect として宣言されるが、発揮元は
    // フィールドではなくミラージュゾーンに残る。窓後解決でも同じセット中の
    // 発揮元であることを再検証できるよう、宣言時ゾーンを固定する。
    ...(sourceCard.zone === "mirage"
      ? { sourceActivationZone: "mirage" as const }
      : {}),
    ...(isOperationMagicDefinition(sourceDefinition)
      ? { applicabilityEvaluationZone: "field" as const }
      : {}),
    ...(options.activationLabel
      ? { activationLabel: options.activationLabel }
      : {}),
    ...(options.registrationIndex !== undefined
      ? { fieldEffectRegistrationIndex: options.registrationIndex }
      : {}),
    ...(options.fieldEffectIndex !== undefined
      ? { fieldEffectIndex: options.fieldEffectIndex }
      : {}),
    ...(options.sourcePreventionLevel !== undefined
      ? { preventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { preventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(options.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: options.payCostPaymentSources }
      : {}),
    ...(options.deferPayCostSourceSelection === true
      ? { deferPayCostSourceSelection: true }
      : {}),
    ...(options.summonPaymentSources !== undefined
      ? { summonPaymentSources: options.summonPaymentSources }
      : {}),
    ...(options.summonEnterFieldCorePlacements !== undefined
      ? {
          summonEnterFieldCorePlacements:
            options.summonEnterFieldCorePlacements,
        }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return {
    state: currentState,
    activeStack,
  };
}

export interface ResolveDeferredFieldEffectStackOptions {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  /** P3-39: action_resolution の trigger queue forward 用 (必須)。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  /**
   * field_card_effect の解決対象 DSL effect index。
   * 宣言された registration の `effectIndex` を caller が解決して渡す。
   * 同一カードに複数の activated 効果がある場合 (例: BSTH01-X04 フォーオブアカインド)、
   * これを `targetEffectIndex` として効果解決へ渡し、宣言された 1 効果のみを実行する。
   * hand_card_effect は `activeStack.handActivatedEffectIndex` を使う (そちらが優先)。
   */
  targetEffectIndex?: number;
}

export function resolveDeferredFieldEffectStack(
  options: ResolveDeferredFieldEffectStackOptions
): GameState {
  const { activeStack } = options;

  const sourceCard = getCardById(options.state, activeStack.cardInstanceId);
  if (!sourceCard) {
    throw new Error(
      `Deferred field effect source card not found: ${activeStack.cardInstanceId}`
    );
  }

  const sourceDefinition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  if (!sourceDefinition) {
    throw new Error(`Unknown card definition: ${activeStack.cardDefinitionId}`);
  }
  const effectSourceDefinition =
    activeStack.effectSourceDefinitionId !== undefined
      ? options.getCardDefinitionById(activeStack.effectSourceDefinitionId)
      : undefined;
  if (
    activeStack.effectSourceDefinitionId !== undefined &&
    !effectSourceDefinition
  ) {
    throw new Error(
      `Unknown effect source definition: ${activeStack.effectSourceDefinitionId}`
    );
  }

  // legality re-check: source card must still be on the field。
  // ただし手札起動効果 (hand_card_effect) はソースが手札/トラッシュ等の場外ゾーンに
  // あるため（summon 特化型は解決中に自己召喚する）、フィールド在席を要求しない。
  const isHandActivatedEffect = activeStack.actionKind === "hand_card_effect";
  const isOperationMagicInUse =
    isOperationMagicDefinition(sourceDefinition) &&
    sourceCard.zone === "in_use";
  const isMirageSetFieldEffect =
    activeStack.actionKind === "field_card_effect" &&
    activeStack.sourceActivationZone === "mirage" &&
    sourceCard.zone === "mirage";
  if (
    !isHandActivatedEffect &&
    sourceCard.zone !== "field" &&
    !isOperationMagicInUse &&
    !isMirageSetFieldEffect
  ) {
    return finishOperationMagicFieldUseIfReady({
      state: {
        ...options.state,
        log: [
          ...options.state.log,
          `effect:effect-fizzled:${activeStack.chainId}:source-not-on-field`,
        ],
      },
      activeStack,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  if (
    activeStack.effectSourceInstanceId !== undefined &&
    activeStack.effectSourceInstanceId !== activeStack.cardInstanceId &&
    !isActiveTextRoleUnderEffectSource({
      state: options.state,
      hostCard: sourceCard,
      hostDefinition: sourceDefinition,
      effectSourceInstanceId: activeStack.effectSourceInstanceId,
      ...(activeStack.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: activeStack.effectSourceDefinitionId }
        : {}),
    }) &&
    !isActiveQuartzInheritedEffectSource({
      state: options.state,
      hostCard: sourceCard,
      hostDefinition: sourceDefinition,
      effectSourceInstanceId: activeStack.effectSourceInstanceId,
      ...(activeStack.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: activeStack.effectSourceDefinitionId }
        : {}),
    }) &&
    !isActiveCombinedBraveEffectSource({
      state: options.state,
      hostCard: sourceCard,
      effectSourceInstanceId: activeStack.effectSourceInstanceId,
      ...(activeStack.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: activeStack.effectSourceDefinitionId }
        : {}),
    })
  ) {
    return finishOperationMagicFieldUseIfReady({
      state: {
        ...options.state,
        log: [
          ...options.state.log,
          `effect:effect-fizzled:${activeStack.chainId}:effect-source-not-star-garment-under`,
        ],
      },
      activeStack,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  if (activeStack.isNullified) {
    // 03d 発揮前提 / 01 使用: 使用は取り消さず、不発の手札起動カードも
    // in_use → trash へ片付ける。場の直接発揮や、既に移動したカードは動かさない。
    const nullifiedState =
      isHandActivatedEffect && sourceCard.zone === "in_use"
        ? moveCardZone(options.state, sourceCard.instanceId, "trash")
        : options.state;
    return finishOperationMagicFieldUseIfReady({
      state: {
        ...nullifiedState,
        log: [
          ...options.state.log,
          `effect:nullified:${activeStack.chainId}:${activeStack.cardInstanceId}`,
        ],
      },
      activeStack,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  const sourceKind = (activeStack.fieldEffectSourceKind ??
    "system") as FieldEffectSourceKind;

  const context: EffectActionContext = {
    chainId: activeStack.chainId,
    resolutionKind: "field_card_effect_action",
    actingPlayerId: activeStack.actingPlayerId,
    sourceKind,
    sourceCard,
    sourceDefinition,
    ...(effectSourceDefinition !== undefined ? { effectSourceDefinition } : {}),
    effectSourceInstanceId:
      activeStack.effectSourceInstanceId ?? sourceCard.instanceId,
    effectSourceDefinitionId:
      activeStack.effectSourceDefinitionId ?? sourceDefinition.cardNo,
    targetInstanceIds: activeStack.targetInstanceIds,
    ...(activeStack.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(activeStack.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(activeStack.targetStepId !== undefined
      ? { targetStepId: activeStack.targetStepId }
      : {}),
    ...(activeStack.targetGroups !== undefined
      ? { targetGroups: activeStack.targetGroups }
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
    ...(activeStack.chosenLifeCoreKind !== undefined
      ? { chosenLifeCoreKind: activeStack.chosenLifeCoreKind }
      : {}),
    ...(activeStack.handActivatedChoiceIndex !== undefined
      ? { choiceIndex: activeStack.handActivatedChoiceIndex }
      : activeStack.fieldEffectChoiceIndex !== undefined
        ? { choiceIndex: activeStack.fieldEffectChoiceIndex }
        : {}),
    ...(activeStack.chosenTiming
      ? { effectTimingFilter: activeStack.chosenTiming }
      : {}),
    ...(activeStack.sourceActivationZone !== undefined
      ? { activationZone: activeStack.sourceActivationZone }
      : {}),
    ...(activeStack.applicabilityEvaluationZone !== undefined
      ? { applicabilityEvaluationZone: activeStack.applicabilityEvaluationZone }
      : {}),
    ...(activeStack.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: activeStack.payCostPaymentSources }
      : {}),
    ...(activeStack.deferPayCostSourceSelection === true
      ? { allowPendingPayCostSourceAllocation: true }
      : {}),
    ...(activeStack.summonPaymentSources !== undefined
      ? { summonPaymentSources: activeStack.summonPaymentSources }
      : {}),
    ...(activeStack.summonEnterFieldCorePlacements !== undefined
      ? {
          summonEnterFieldCorePlacements:
            activeStack.summonEnterFieldCorePlacements,
        }
      : {}),
    // P3-62: 宣言時に積んだ usageLimit 払戻情報を deferred 解決へ復元。
    ...(activeStack.recordedUsage
      ? { recordedUsage: activeStack.recordedUsage }
      : {}),
    ...(activeStack.preventionLevel !== undefined
      ? { sourcePreventionLevel: activeStack.preventionLevel }
      : {}),
    ...(activeStack.preventionBypass !== undefined
      ? { sourcePreventionBypass: activeStack.preventionBypass }
      : {}),
    pendingStackNegateCandidate: activeStack.previousPendingStackAction,
    // 手札起動効果 / フィールド起動効果: 宣言された 1 効果 (effectIndex) のみを実行する。
    // これが無いと同一カードの同 timing 効果がすべて束ねて実行され、片方の
    // conditional_cost 不発で共有 recordedUsage ラベルが誤って払い戻される
    // (BSTH01-X04 フォーオブアカインド再発火バグ)。hand は activeStack 由来を優先。
    ...(activeStack.handActivatedEffectIndex !== undefined
      ? { targetEffectIndex: activeStack.handActivatedEffectIndex }
      : options.targetEffectIndex !== undefined
        ? { targetEffectIndex: options.targetEffectIndex }
        : {}),
  };

  const resolved = runActionMainResolution({
    state: options.state,
    chainId: activeStack.chainId,
    context,
    ...(activeStack.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: activeStack.supplementalTriggerEvents }
      : {}),
    ...(activeStack.suppressCausedLeaveEffects === true
      ? {
          suppressCausedLeaveEffectsForSourceInstanceId:
            activeStack.cardInstanceId,
        }
      : {}),
    startLogs: [`effect:resolve-main:start:${activeStack.chainId}`],
    endLogs: [
      `effect:resolve-main:end:${activeStack.chainId}`,
      `effect:resolve-derived:end:${activeStack.chainId}`,
    ],
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
  });

  // step-targeting 等の元効果 continuation が残る場合は、同じ activeStack の resume が
  // 完結させるまで in_use のまま待つ。誘発キューだけが追加された後は通常の magic と同じく
  // 即時に cleanup する。
  if (
    isOperationMagicDefinition(sourceDefinition) &&
    hasOutstandingEffectResolutionContinuation(resolved)
  ) {
    return resolved;
  }

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): field/hand
  // 起動効果 (main/flash/stack いずれのラベルも含む) が完全解決した後に非バースト
  // 「効果を発揮したとき」観測 (game_event/card_event:"effect_activated") を発火する。
  // 上の各早期 return (isNullified / source-not-on-field 等) を通過済みの経路
  // (= 実際に解決された経路) でのみ到達する。
  const withEffectActivation = queueEffectActivationTriggers({
    chainId: activeStack.chainId,
    state: resolved,
    activatorPlayerId: activeStack.actingPlayerId,
    relatedInstanceId: activeStack.cardInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  // ENGINE-stack-activation-reactivation-trigger: スピリット/ネクサス/ブレイヴの
  // 【スタック】キーワード効果 (見出しラベル位置の "stack") が完全解決した後にも、
  // magic-system.ts resolveDeferredMagicStack と同じ「相手がスタック効果を発揮した
  // とき」誘発 (BSTH02.7-X01 effects[1]) を発火する。この関数は isNullified /
  // source-not-on-field / star-garment-under 不成立の各早期 return を上で既に
  // 通過済みの経路 (= 実際に解決された経路) でのみ到達するため、無効化された発揮を
  // 誤って誘発しない。P3-114: activationLabel:"none"(本文中でスタックタイミングを
  // 実行窓として使うだけの非スタック効果)は isLabeledStackEffectActivation で除外する。
  const afterStackEffectUsed = isLabeledStackEffectActivation(activeStack)
    ? queueStackEffectUsedTriggers({
        chainId: activeStack.chainId,
        state: withEffectActivation,
        stackSourceInstanceId: activeStack.cardInstanceId,
        userPlayerId: activeStack.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      })
    : withEffectActivation;
  return finishOperationMagicFieldUseIfReady({
    state: afterStackEffectUsed,
    activeStack,
    sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}
