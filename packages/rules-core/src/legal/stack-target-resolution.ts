// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).
import type {
  DeferredStackResolverOptions,
  StackRegistrationLookupOptions,
} from "./stack-resolution-types";

import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  GameState,
  PendingStepChoiceOption,
} from "../model";
import { getCardById } from "../card/card-lookup";
import type { Effect, EffectStep } from "../dsl-types";

import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { evaluateApplicability } from "../effect/effect-applicability";
import { resolveAffectSourceIdentity } from "../effect/effect-source-identity";

import { isCardInEffectZone } from "../effect/card-access-rules";
import {
  generateDivineSkillTargetRegistration,
  getChoiceStepCondition,
} from "../effect/structured-effect-registrations";

import {
  mergeRegistrationChoiceVariant,
  areLegalActionTargetGroupsSatisfiable,
  buildLegalActionTargetGroups,
  getCandidateTargetInstanceIds,
  getCandidateTargetZones,
  getRequiredTargetCount,
  getMaxTargetCount,
  getTargetEffectFilterTags,
  isCardUseRestricted,
  isAdventRestricted,
  resolveEmptyFireTargetCounts,
} from "./legal-actions-shared";
import { resolveCountBound } from "../effect/target-resolution";
import { getExpandEffectTargetCountBonusDeclarative } from "../effect/expand-effect-target-count";
import { createStepExecutionContext } from "../step-execution-context";
import type { CountBound } from "../dsl-types";
import type {
  LegalActionTargetGroup,
  RegisteredTargetedEffectActionBase,
} from "./legal-actions-types";
import {
  capTargetGroupsByRequiredSelectedTargetsCountCost,
  getRequiredCostSourceTribesForCard,
  getRequiredSelectedTargetsCountCostLimitedMaxTargetCount,
} from "./required-count-cost-gate";
import {
  adventTimingWindowAllowed,
  getAdventDeclareUsageKey,
  getAdventTargets,
  getContractAdventTargets,
  getFContractAdventTargets,
  hasSoulCoreAvailable,
} from "../mechanics/advent-system";
import {
  getHostGrantedAdventTargets,
  getHostGrantedAdventChoiceOptions,
  getHostDualAdventCandidateHandCards,
  getHostDualAdventOpenSlotIndices,
  isHostDualAdventGrantUsable,
} from "../mechanics/host-dual-advent";
import { getContractCombineCandidateTargets } from "../mechanics/contract-combine-system";

export function lookupRegistrationForStack(
  activeStack: ActiveStack,
  options: StackRegistrationLookupOptions
): RegisteredTargetedEffectActionBase | null {
  // choice 変種付き registration は top-level に対象系メタを持たない。
  // 宣言時に確定した choiceIndex の変種メタをマージして返し、
  // 窓後対象選択 (getStackTargetSelection) を変種基準で行えるようにする。
  const mergeVariantIfAny = <
    T extends RegisteredTargetedEffectActionBase & {
      choices?: readonly import("./legal-actions-shared").EffectChoiceVariantTargetMeta[];
    },
  >(
    registration: T | null | undefined,
    choiceIndex: number | undefined
  ): T | null => {
    if (!registration) return null;
    const variant =
      choiceIndex !== undefined
        ? registration.choices?.[choiceIndex]
        : undefined;
    return variant
      ? mergeRegistrationChoiceVariant(registration, variant)
      : registration;
  };
  switch (activeStack.actionKind) {
    case "magic":
      return mergeVariantIfAny(
        options
          .getRegisteredMagicActions?.(activeStack.cardDefinitionId)
          ?.find(
            (r) =>
              r.timing === (activeStack.chosenTiming ?? "flash") &&
              (activeStack.magicEffectIndex === undefined ||
                r.effectIndex === activeStack.magicEffectIndex)
          ),
        activeStack.magicChoiceIndex
      );
    case "field_card_effect":
      return activeStack.fieldEffectRegistrationIndex !== undefined
        ? mergeVariantIfAny(
            options.getRegisteredFieldCardEffectActions?.(
              activeStack.effectSourceDefinitionId ??
                activeStack.cardDefinitionId
            )?.[activeStack.fieldEffectRegistrationIndex],
            activeStack.fieldEffectChoiceIndex
          )
        : null;
    case "hand_card_effect":
      // registration は effectIndex で引く (handActivatedEffectIndex = DSL effect index)。
      return activeStack.handActivatedEffectIndex !== undefined
        ? mergeVariantIfAny(
            options
              .getRegisteredHandActivatedEffectActions?.(
                activeStack.cardDefinitionId
              )
              ?.find(
                (r) => r.effectIndex === activeStack.handActivatedEffectIndex
              ),
            activeStack.handActivatedChoiceIndex
          )
        : null;
    case "triggered_effect":
      return activeStack.triggeredSourceCardNo !== undefined &&
        activeStack.triggeredRegistrationIndex !== undefined
        ? mergeVariantIfAny(
            options.getRegisteredTriggeredEffectActions?.(
              activeStack.triggeredSourceCardNo
            )?.[activeStack.triggeredRegistrationIndex],
            activeStack.triggeredChoiceIndex
          )
        : null;
    case "battle_immediate_effect":
      return activeStack.battleImmediateSourceCardNo !== undefined &&
        activeStack.battleImmediateRegistrationIndex !== undefined
        ? mergeVariantIfAny(
            options.getRegisteredBattleImmediateEffectActions?.(
              activeStack.battleImmediateSourceCardNo
            )?.[activeStack.battleImmediateRegistrationIndex],
            activeStack.battleImmediateChoiceIndex
          )
        : null;
    case "burst_activation":
      return mergeVariantIfAny(
        activeStack.burstRegistrationIndex !== undefined
          ? options.getRegisteredBurstActions?.(activeStack.cardDefinitionId)?.[
              activeStack.burstRegistrationIndex
            ]
          : activeStack.burstSourceKind !== undefined
            ? options
                .getRegisteredBurstActions?.(activeStack.cardDefinitionId)
                ?.find((r) => r.sourceKind === activeStack.burstSourceKind)
            : undefined,
        activeStack.burstChoiceIndex
      );
    case "divine_skill": {
      // 神技/導技/界放/契約技の本体 effect が対象を要するなら、窓後対象選択用の
      // registration を skill.effects から合成する (effects[] 経路と同じ対象選択 UX)。
      if (activeStack.divineSkillIndex === undefined) return null;
      const def = options.getCardDefinitionById(activeStack.cardDefinitionId);
      const skill =
        def?.grandwalkerData?.divineSkills?.[activeStack.divineSkillIndex];
      if (
        activeStack.divineSkillChoiceIndex === undefined &&
        skill?.effects?.some((effect) =>
          effect.steps.some(
            (step) => step.choice !== undefined && step.choice.length > 0
          )
        )
      ) {
        return null;
      }
      return mergeVariantIfAny(
        generateDivineSkillTargetRegistration(skill?.effects),
        activeStack.divineSkillChoiceIndex
      );
    }
    default:
      return null;
  }
}

export function getBurstIgnoresOpponentCannotActivateBurst(
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

export function getActiveStackChoiceIndex(
  activeStack: ActiveStack
): number | undefined {
  switch (activeStack.actionKind) {
    case "magic":
      return activeStack.magicChoiceIndex;
    case "field_card_effect":
      return activeStack.fieldEffectChoiceIndex;
    case "hand_card_effect":
      return activeStack.handActivatedChoiceIndex;
    case "triggered_effect":
      return activeStack.triggeredChoiceIndex;
    case "battle_immediate_effect":
      return activeStack.battleImmediateChoiceIndex;
    case "burst_activation":
      return activeStack.burstChoiceIndex;
    case "divine_skill":
      return activeStack.divineSkillChoiceIndex;
    default:
      return undefined;
  }
}

export function clearActiveStackChoiceIndex(
  activeStack: ActiveStack
): ActiveStack {
  switch (activeStack.actionKind) {
    case "magic": {
      const { magicChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    case "field_card_effect": {
      const { fieldEffectChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    case "hand_card_effect": {
      const { handActivatedChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    case "triggered_effect": {
      const { triggeredChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    case "battle_immediate_effect": {
      const { battleImmediateChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    case "burst_activation": {
      const { burstChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    case "divine_skill": {
      const { divineSkillChoiceIndex: _choiceIndex, ...rest } = activeStack;
      return rest;
    }
    default:
      return activeStack;
  }
}

export function setActiveStackChoiceIndex(
  activeStack: ActiveStack,
  choiceIndex: number
): ActiveStack {
  switch (activeStack.actionKind) {
    case "magic":
      return { ...activeStack, magicChoiceIndex: choiceIndex };
    case "field_card_effect":
      return { ...activeStack, fieldEffectChoiceIndex: choiceIndex };
    case "hand_card_effect":
      return { ...activeStack, handActivatedChoiceIndex: choiceIndex };
    case "triggered_effect":
      return { ...activeStack, triggeredChoiceIndex: choiceIndex };
    case "battle_immediate_effect":
      return { ...activeStack, battleImmediateChoiceIndex: choiceIndex };
    case "burst_activation":
      return { ...activeStack, burstChoiceIndex: choiceIndex };
    case "divine_skill":
      return { ...activeStack, divineSkillChoiceIndex: choiceIndex };
    default:
      return activeStack;
  }
}

export function getActiveStackEffectIndex(
  activeStack: ActiveStack,
  registration: RegisteredTargetedEffectActionBase
): number | undefined {
  const registrationEffectIndex = (
    registration as RegisteredTargetedEffectActionBase & {
      effectIndex?: number;
    }
  ).effectIndex;
  if (registrationEffectIndex !== undefined) return registrationEffectIndex;
  switch (activeStack.actionKind) {
    case "magic":
      return activeStack.magicEffectIndex;
    case "hand_card_effect":
      return activeStack.handActivatedEffectIndex;
    default:
      return undefined;
  }
}

export function actionHasTargetSpec(action: EffectStep["action"]): boolean {
  return typeof action === "object" && action !== null && "target" in action;
}

export function findFirstTargetStepId(
  steps: readonly EffectStep[]
): string | undefined {
  for (const [index, step] of steps.entries()) {
    if (actionHasTargetSpec(step.action)) {
      return step.id ?? `__step_${index}`;
    }
    const nested = step.choice ? findFirstTargetStepId(step.choice) : undefined;
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function inferFirstTargetStepIdFromActiveStack(
  activeStack: ActiveStack,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  effectIndexOverride?: number
): string | undefined {
  const definition = getCardDefinitionById(
    activeStack.effectSourceDefinitionId ?? activeStack.cardDefinitionId
  );
  const effectIndex =
    effectIndexOverride ??
    activeStack.magicEffectIndex ??
    activeStack.handActivatedEffectIndex;
  if (effectIndex === undefined) return undefined;
  const effect = definition?.effects?.[effectIndex];
  return effect ? findFirstTargetStepId(effect.steps) : undefined;
}

export function createCountBoundResolver(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  // 範囲神技は窓後のコアHUDで確定・支払い済みの個数を対象数へ渡す。
  // 固定コストの既存経路もActiveStackから同じ値を受け取る。
  costPaidThisEffect?: number
): (bound: CountBound) => number {
  return (bound) => {
    const stepContext = createStepExecutionContext(state);
    stepContext.sourceInstanceId = sourceInstanceId;
    if (costPaidThisEffect !== undefined) {
      stepContext.costPaidThisEffect = costPaidThisEffect;
    }
    return resolveCountBound(
      bound,
      state,
      actingPlayerId,
      stepContext,
      getCardDefinitionById
    );
  };
}

export function getResolvedRequiredTargetCount(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  registration: RegisteredTargetedEffectActionBase,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  costPaidThisEffect?: number
): number {
  if (registration.requiredTargetCountDynamic === undefined) {
    return getRequiredTargetCount(registration);
  }
  return createCountBoundResolver(
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    costPaidThisEffect
  )(registration.requiredTargetCountDynamic);
}

export function getOptionalRepeatRegistrationForCurrentState(
  state: GameState,
  activeStack: ActiveStack,
  registration: RegisteredTargetedEffectActionBase,
  options: DeferredStackResolverOptions
): RegisteredTargetedEffectActionBase {
  const choiceIndex = getActiveStackChoiceIndex(activeStack);
  if (choiceIndex === undefined || choiceIndex <= 0) return registration;
  const effectIndex = getActiveStackEffectIndex(activeStack, registration);
  if (effectIndex === undefined) return registration;
  const definition = options.getCardDefinitionById(
    activeStack.effectSourceDefinitionId ?? activeStack.cardDefinitionId
  );
  const effect = definition?.effects?.[effectIndex];
  if (!definition || !effect) return registration;
  const hasOptionalRepeat = effect.steps.some(
    (step) => step.repeat?.optional === true
  );
  if (!hasOptionalRepeat) return registration;
  const defaultVariant = (
    registration as RegisteredTargetedEffectActionBase & {
      choices?: readonly import("./legal-actions-shared").EffectChoiceVariantTargetMeta[];
    }
  ).choices?.[0];
  const fallbackToDefault = () => {
    if (defaultVariant) {
      return mergeRegistrationChoiceVariant(registration, defaultVariant);
    }
    return (
      lookupRegistrationForStack(
        clearActiveStackChoiceIndex(activeStack),
        options
      ) ?? registration
    );
  };
  const condition = getChoiceStepCondition(
    definition,
    effectIndex,
    choiceIndex
  );
  if (condition && condition.length > 0) {
    const conditionMet = evaluateCondition(
      state,
      condition,
      activeStack.cardInstanceId,
      activeStack.actingPlayerId,
      options.getCardDefinitionById
    );
    if (!conditionMet) return fallbackToDefault();
  }
  if (registration.maxTargetCountDynamic !== undefined) {
    const resolveDynamicCount = createCountBoundResolver(
      state,
      activeStack.actingPlayerId,
      activeStack.cardInstanceId,
      options.getCardDefinitionById,
      activeStack.divineSkillCoreCost
    );
    const resolvedMaxTargetCount = resolveDynamicCount(
      registration.maxTargetCountDynamic
    );
    const resolvedRequiredTargetCount = getResolvedRequiredTargetCount(
      state,
      activeStack.actingPlayerId,
      activeStack.cardInstanceId,
      registration,
      options.getCardDefinitionById,
      activeStack.divineSkillCoreCost
    );
    if (resolvedMaxTargetCount < resolvedRequiredTargetCount) {
      return fallbackToDefault();
    }
  }
  return registration;
}

export interface StackTargetSelection {
  requiredTargetCount: number;
  maxTargetCount: number;
  allowDuplicateTargets?: boolean;
  candidateInstanceIds: string[];
  /** 解決時の stale 対象検証に使う候補ゾーン。choice 変種の選択後メタも含む。 */
  candidateTargetZones?: readonly import("../model").Zone[];
  targetGroups?: readonly LegalActionTargetGroup[];
  targetEffectFilterTags: readonly string[];
  targetStepId?: string;
}

function singleKeywordTargetSelection(
  candidateCards: readonly CardInstance[]
): StackTargetSelection | null {
  if (candidateCards.length === 0) return null;
  return {
    requiredTargetCount: 1,
    maxTargetCount: 1,
    candidateInstanceIds: candidateCards.map((card) => card.instanceId),
    targetEffectFilterTags: ["general"],
  };
}

function getAdventStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  if (isAdventRestricted(state, activeStack.actingPlayerId)) return null;
  if (activeStack.adventGrantSourceInstanceId !== undefined) {
    return singleKeywordTargetSelection(
      getHostGrantedAdventTargets(
        state,
        activeStack,
        options.getCardDefinitionById
      )
    );
  }
  const printed = getPrintedAdventStackTargetSelection(
    state,
    activeStack,
    options
  );
  if (activeStack.adventUseAlternateCost) return printed;
  const grantedIds = getHostGrantedAdventChoiceOptions(
    state,
    activeStack.cardInstanceId,
    activeStack.actingPlayerId,
    options.getCardDefinitionById
  )
    .filter((option) => !option.useAlternateCost)
    .map((option) => option.proxySourceInstanceId!);
  const ids = new Set([
    ...(printed?.candidateInstanceIds ?? []),
    ...grantedIds,
  ]);
  return singleKeywordTargetSelection(
    state.cardInstances.filter((card) => ids.has(card.instanceId))
  );
}

function getPrintedAdventStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  const sourceCard = getCardById(state, activeStack.cardInstanceId);
  const sourceDefinition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  const adventData = sourceDefinition?.adventData;
  if (!sourceCard || !sourceDefinition || !adventData) return null;
  const sourceZone = adventData.adventSourceZone ?? "hand";
  if (
    !isCardInEffectZone(
      state,
      sourceCard,
      [sourceZone],
      activeStack.actingPlayerId,
      options.getCardDefinitionById
    ) ||
    sourceCard.controllerPlayerId !== activeStack.actingPlayerId
  ) {
    return null;
  }
  const declareConditionMet =
    !adventData.declareCondition ||
    adventData.declareCondition.length === 0 ||
    evaluateCondition(
      state,
      adventData.declareCondition,
      sourceCard.instanceId,
      activeStack.actingPlayerId,
      options.getCardDefinitionById
    );
  if (!declareConditionMet) return null;

  const isActivePlayer = state.activePlayerId === activeStack.actingPlayerId;
  const inBattleFlashWindow = state.activeAttack?.flashWindowState != null;
  const timingContext = {
    sourceInMainTiming:
      state.step === "main" && isActivePlayer && !inBattleFlashWindow,
    sourceInFlashTiming: inBattleFlashWindow,
    inBattleFlashWindow,
    isActivePlayer,
  };
  if (activeStack.adventUseAlternateCost === true) {
    if (adventData.alternateCostAdvent === undefined) return null;
    if (
      !adventTimingWindowAllowed(
        adventData.alternateCostAdvent.timing,
        timingContext
      )
    ) {
      return null;
    }
    if (
      state.usedAlternateCostAdventKeysThisTurn.includes(
        getAdventDeclareUsageKey(sourceDefinition)
      )
    ) {
      return null;
    }
    if (
      !evaluateCondition(
        state,
        adventData.alternateCostAdvent.condition,
        sourceCard.instanceId,
        activeStack.actingPlayerId,
        options.getCardDefinitionById
      )
    ) {
      return null;
    }
  } else {
    if (!adventTimingWindowAllowed(adventData.adventTiming, timingContext)) {
      return null;
    }
    if (
      !hasSoulCoreAvailable(state, activeStack.actingPlayerId, {
        dest: adventData.soulCoreDest,
      })
    ) {
      return null;
    }
  }

  const adventMode = adventData.adventVariant ?? "normal";
  const candidates =
    adventMode === "f_contract"
      ? getFContractAdventTargets(
          state,
          activeStack.actingPlayerId,
          adventData,
          options.getCardDefinitionById,
          sourceDefinition,
          activeStack.adventUseAlternateCost === true
        )
      : adventMode === "contract"
        ? getContractAdventTargets(
            state,
            activeStack.actingPlayerId,
            adventData,
            options.getCardDefinitionById,
            sourceDefinition,
            activeStack.adventUseAlternateCost === true
          )
        : getAdventTargets(
            state,
            activeStack.actingPlayerId,
            adventData,
            options.getCardDefinitionById,
            sourceDefinition,
            activeStack.adventUseAlternateCost === true
          );
  return singleKeywordTargetSelection(candidates);
}

function getHostDualAdventStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  const hostCard = getCardById(state, activeStack.cardInstanceId);
  const hostDefinition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  const grant = hostDefinition?.hostDualAdventGrant;
  if (!hostCard || !hostDefinition || !grant) return null;
  if (
    !isHostDualAdventGrantUsable(
      state,
      activeStack.cardInstanceId,
      activeStack.actingPlayerId,
      activeStack.adventUseAlternateCost === true
    )
  ) {
    return null;
  }
  const hostIsActivePlayer =
    state.activePlayerId === activeStack.actingPlayerId;
  const hostInBattleFlashWindow = state.activeAttack?.flashWindowState != null;
  const hostTimingContext = {
    sourceInMainTiming:
      state.step === "main" && hostIsActivePlayer && !hostInBattleFlashWindow,
    sourceInFlashTiming: hostInBattleFlashWindow,
    inBattleFlashWindow: hostInBattleFlashWindow,
    isActivePlayer: hostIsActivePlayer,
  };
  if (activeStack.adventUseAlternateCost === true) {
    if (grant.alternateCost === undefined) return null;
    if (
      !adventTimingWindowAllowed(grant.alternateCost.timing, hostTimingContext)
    ) {
      return null;
    }
  } else if (
    grant.normalPathDisabled ||
    !adventTimingWindowAllowed(grant.timing, hostTimingContext) ||
    !hasSoulCoreAvailable(state, activeStack.actingPlayerId)
  ) {
    return null;
  }

  const openSlotIndices = getHostDualAdventOpenSlotIndices(
    state,
    activeStack.cardInstanceId,
    grant,
    options.getCardDefinitionById
  );
  let candidates = getHostDualAdventCandidateHandCards(
    state,
    activeStack.actingPlayerId,
    grant,
    openSlotIndices,
    options.getCardDefinitionById
  ).filter((card) => {
    const definition = options.getCardDefinitionById(card.definitionId);
    return (
      definition !== undefined &&
      !isCardUseRestricted(
        state,
        activeStack.actingPlayerId,
        card,
        definition,
        options.getCardDefinitionById,
        "advent"
      )
    );
  });
  if (
    activeStack.adventUseAlternateCost === true &&
    grant.alternateCost?.turnLimitDisabled !== true
  ) {
    candidates = candidates.filter((card) => {
      const definition = options.getCardDefinitionById(card.definitionId);
      if (!definition) return false;
      return !state.usedAlternateCostAdventKeysThisTurn.includes(
        getAdventDeclareUsageKey(hostDefinition)
      );
    });
  }
  return singleKeywordTargetSelection(candidates);
}

function getDualHostAdventStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  if (isAdventRestricted(state, activeStack.actingPlayerId)) return null;
  const sourceCard = getCardById(state, activeStack.cardInstanceId);
  const sourceDefinition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  const dualData = sourceDefinition?.dualHostAdventData;
  if (!sourceCard || !sourceDefinition || !dualData) return null;
  if (
    !isCardInEffectZone(
      state,
      sourceCard,
      ["hand"],
      activeStack.actingPlayerId,
      options.getCardDefinitionById
    ) ||
    sourceCard.controllerPlayerId !== activeStack.actingPlayerId
  ) {
    return null;
  }
  if (
    !hasSoulCoreAvailable(state, activeStack.actingPlayerId, {
      dest: dualData.soulCoreDest,
    })
  ) {
    return null;
  }

  const [slotA, slotB] = dualData.hostSlotConditions;
  if (!slotA || !slotB) return null;
  const slotATargets = getAdventTargets(
    state,
    activeStack.actingPlayerId,
    {
      adventCondition: slotA,
      adventTiming: dualData.adventTiming,
      soulCoreDest: dualData.soulCoreDest,
    },
    options.getCardDefinitionById,
    sourceDefinition
  );
  const slotBTargets = getAdventTargets(
    state,
    activeStack.actingPlayerId,
    {
      adventCondition: slotB,
      adventTiming: dualData.adventTiming,
      soulCoreDest: dualData.soulCoreDest,
    },
    options.getCardDefinitionById,
    sourceDefinition
  );
  if (slotATargets.length === 0 || slotBTargets.length === 0) return null;

  const candidateInstanceIds = [
    ...new Set([
      ...slotATargets.map((card) => card.instanceId),
      ...slotBTargets.map((card) => card.instanceId),
    ]),
  ];
  if (candidateInstanceIds.length < 2) return null;
  return {
    requiredTargetCount: 2,
    maxTargetCount: 2,
    candidateInstanceIds,
    targetGroups: [
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: slotATargets.map((card) => card.instanceId),
      },
      {
        requiredTargetCount: 1,
        candidateTargetInstanceIds: slotBTargets.map((card) => card.instanceId),
      },
    ],
    targetEffectFilterTags: ["general"],
  };
}

function getContractCombineStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  const braveCard = getCardById(state, activeStack.cardInstanceId);
  const braveDefinition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  if (!braveCard || !braveDefinition?.contractCombineData) return null;
  if (
    activeStack.contractCombineCostWaived !== true &&
    !hasSoulCoreAvailable(state, activeStack.actingPlayerId)
  ) {
    return null;
  }
  const candidates = getContractCombineCandidateTargets({
    state,
    actingPlayerId: activeStack.actingPlayerId,
    braveCard,
    braveDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(activeStack.contractCombineProxyTargetCardNames !== undefined
      ? {
          proxyTargetCardNames: activeStack.contractCombineProxyTargetCardNames,
        }
      : {}),
  });
  return singleKeywordTargetSelection(candidates);
}

function getKeywordStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  switch (activeStack.actionKind) {
    case "declare_advent":
      return getAdventStackTargetSelection(state, activeStack, options);
    case "declare_host_dual_advent":
      return getHostDualAdventStackTargetSelection(state, activeStack, options);
    case "declare_dual_host_advent":
      return getDualHostAdventStackTargetSelection(state, activeStack, options);
    case "contract_combine":
      return getContractCombineStackTargetSelection(
        state,
        activeStack,
        options
      );
    default:
      return null;
  }
}

export interface DeferredOptionalRepeatChoiceSelection {
  effectIndex: number;
  repeatStepIndex: number;
  targetStepId?: string;
  baseTargetCount: number;
  maxAdditionalCount: number;
  additionalCountSelectionMode: "repeat_count" | "count_decrease";
  choices: readonly PendingStepChoiceOption[];
}

function hasOnlyDeferredOptionalRepeatChoice(effect: Effect): boolean {
  const hasExplicitChoice = effect.steps.some(
    (step) => step.choice !== undefined && step.choice.length > 0
  );
  if (hasExplicitChoice) return false;
  return effect.steps.some((step) => step.repeat?.optional === true);
}

function getOptionalRepeatChoiceLabels(
  registration: RegisteredTargetedEffectActionBase
): readonly PendingStepChoiceOption[] {
  const choices = (
    registration as RegisteredTargetedEffectActionBase & {
      choices?: readonly import("./legal-actions-shared").EffectChoiceVariantTargetMeta[];
    }
  ).choices;
  return [
    {
      choiceIndex: 0,
      label: choices?.[0]?.label ?? "追加発揮しない",
    },
    {
      choiceIndex: 1,
      label: choices?.[1]?.label ?? "追加発揮する",
    },
  ];
}

function isSelectedTargetsCountDecreaseRepeatCost(
  effect: Effect,
  repeatStepIndex: number,
  targetStepId: string
): boolean {
  const repeatStep = effect.steps[repeatStepIndex];
  if (repeatStep?.connector !== "conditional_cost") return false;
  const costStep = effect.steps[repeatStepIndex - 1];
  if (costStep?.action.kind !== "count_decrease") return false;
  const amount = costStep.action.amount;
  if (typeof amount === "number" || "min" in amount) return false;
  return (
    amount.source.kind === "selected_targets" &&
    (amount.source.stepId === undefined ||
      amount.source.stepId === targetStepId) &&
    amount.subtract === undefined
  );
}

export function getDeferredOptionalRepeatChoiceSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): DeferredOptionalRepeatChoiceSelection | null {
  if (getActiveStackChoiceIndex(activeStack) !== undefined) return null;
  const registration = lookupRegistrationForStack(activeStack, options);
  if (!registration) return null;
  const effectIndex = getActiveStackEffectIndex(activeStack, registration);
  if (effectIndex === undefined) return null;
  const definition = options.getCardDefinitionById(
    activeStack.effectSourceDefinitionId ?? activeStack.cardDefinitionId
  );
  const effect = definition?.effects?.[effectIndex];
  if (!effect || !hasOnlyDeferredOptionalRepeatChoice(effect)) return null;

  const repeatStepIndex = effect.steps.findIndex(
    (step) => step.repeat?.optional === true
  );
  if (repeatStepIndex < 0) return null;
  const repeatStep = effect.steps[repeatStepIndex]!;
  const repeat = repeatStep.repeat;
  const selectsTargetPerRepeat = repeatStep.targetSelectionTiming === "on_step";
  if (repeat?.condition && repeat.condition.length > 0) {
    const conditionMet = evaluateCondition(
      state,
      repeat.condition,
      activeStack.cardInstanceId,
      activeStack.actingPlayerId,
      options.getCardDefinitionById
    );
    if (!conditionMet) return null;
  }

  const baseSelection = getStackTargetSelection(
    state,
    setActiveStackChoiceIndex(activeStack, 0),
    options
  );
  if (!baseSelection || baseSelection.requiredTargetCount <= 0) return null;

  const addSelection = getStackTargetSelection(
    state,
    setActiveStackChoiceIndex(activeStack, 1),
    options
  );
  if (!addSelection) return null;
  const baseTargetCount = baseSelection.requiredTargetCount;
  const additionalBound = repeat?.additional;
  const maxAdditionalByRepeat =
    additionalBound === undefined
      ? 0
      : typeof additionalBound === "number"
        ? Math.max(0, Math.floor(additionalBound))
        : Math.max(
            0,
            createCountBoundResolver(
              state,
              activeStack.actingPlayerId,
              activeStack.cardInstanceId,
              options.getCardDefinitionById,
              activeStack.divineSkillCoreCost
            )(additionalBound)
          );
  // on_step 反復は選択対象を一括確定しない。重複可なら現在 1 件以上の候補が
  // あれば反復回数の上限まで選べ、重複不可なら現在候補数だけを上限にする。
  const maxAdditionalByTargetSelection = selectsTargetPerRepeat
    ? addSelection.candidateInstanceIds.length === 0
      ? 0
      : repeat?.allowDuplicateTargets === false
        ? Math.max(
            0,
            Math.floor(
              addSelection.candidateInstanceIds.length / baseTargetCount
            ) - 1
          )
        : maxAdditionalByRepeat
    : Math.max(
        0,
        Math.floor(
          (addSelection.maxTargetCount - baseTargetCount) / baseTargetCount
        )
      );
  const maxAdditionalCount = Math.min(
    maxAdditionalByRepeat,
    maxAdditionalByTargetSelection
  );
  if (maxAdditionalCount <= 0) return null;

  return {
    effectIndex,
    repeatStepIndex,
    ...(repeatStep.id !== undefined ? { targetStepId: repeatStep.id } : {}),
    baseTargetCount,
    maxAdditionalCount,
    additionalCountSelectionMode: isSelectedTargetsCountDecreaseRepeatCost(
      effect,
      repeatStepIndex,
      repeatStep.id ?? `__step_${repeatStepIndex}`
    )
      ? "count_decrease"
      : "repeat_count",
    choices: getOptionalRepeatChoiceLabels(registration),
  };
}

/**
 * deferred stack が窓後の対象選択を要するか判定し、要するなら現在盤面からの候補メタデータを返す。
 * 要しない (対象なし効果 / 空撃ち / 対象外種別) なら null。
 */
export function getStackTargetSelection(
  state: GameState,
  activeStack: ActiveStack,
  options: DeferredStackResolverOptions
): StackTargetSelection | null {
  const keywordSelection = getKeywordStackTargetSelection(
    state,
    activeStack,
    options
  );
  if (keywordSelection) return keywordSelection;

  const rawRegistration = lookupRegistrationForStack(activeStack, options);
  const registration =
    rawRegistration &&
    getOptionalRepeatRegistrationForCurrentState(
      state,
      activeStack,
      rawRegistration,
      options
    );
  if (!registration) return null;
  const effectiveRegistration =
    activeStack.preventionLevel !== undefined
      ? { ...registration, preventionLevel: activeStack.preventionLevel }
      : registration;
  const stackAffectSourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId: activeStack.cardInstanceId,
    sourceDefinitionId: activeStack.cardDefinitionId,
    ...(activeStack.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: activeStack.effectSourceInstanceId }
      : {}),
    ...(activeStack.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: activeStack.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const candidateInstanceIds = getCandidateTargetInstanceIds(
    state,
    activeStack.actingPlayerId,
    effectiveRegistration,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      sourceInstanceId: activeStack.cardInstanceId,
      affectSourceIdentity: stackAffectSourceIdentity,
      ...(activeStack.preventionBypass !== undefined
        ? { sourcePreventionBypass: activeStack.preventionBypass }
        : {}),
      evaluateCondition: (condition, sourceInstanceId, actingPlayerId) =>
        evaluateCondition(
          state,
          condition,
          sourceInstanceId,
          actingPlayerId,
          options.getCardDefinitionById
        ),
      evaluateApplicability: (applicability, sourceInstanceId) =>
        evaluateApplicability(
          state,
          applicability,
          sourceInstanceId,
          options.getCardDefinitionById
        ),
    }
  );
  // 上限が DynamicCount（「自分のカウント2につき1体まで」）なら、deferred 解決の今この
  // 盤面で実効上限へ数値化する。静的 max（数値）はそのまま採用。
  const resolveDynamicCount = createCountBoundResolver(
    state,
    activeStack.actingPlayerId,
    activeStack.cardInstanceId,
    options.getCardDefinitionById,
    activeStack.divineSkillCoreCost
  );
  const effectSourceDefinition = options.getCardDefinitionById(
    activeStack.effectSourceDefinitionId ?? activeStack.cardDefinitionId
  );
  const sourceTribes = getRequiredCostSourceTribesForCard(
    state,
    getCardById(
      state,
      activeStack.effectSourceInstanceId ?? activeStack.cardInstanceId
    ),
    effectSourceDefinition,
    options.getCardDefinitionById
  );
  const targetGroups = buildLegalActionTargetGroups({
    state,
    actingPlayerId: activeStack.actingPlayerId,
    actionRegistration: effectiveRegistration,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: activeStack.cardInstanceId,
    affectSourceIdentity: stackAffectSourceIdentity,
    evaluateCondition: (condition, sourceInstanceId, actingPlayerId) =>
      evaluateCondition(
        state,
        condition,
        sourceInstanceId,
        actingPlayerId,
        options.getCardDefinitionById
      ),
    evaluateApplicability: (applicability, sourceInstanceId) =>
      evaluateApplicability(
        state,
        applicability,
        sourceInstanceId,
        options.getCardDefinitionById
      ),
    resolveCountBound: resolveDynamicCount,
  });
  const effectiveTargetGroups =
    capTargetGroupsByRequiredSelectedTargetsCountCost(
      state,
      activeStack.actingPlayerId,
      effectiveRegistration,
      targetGroups,
      sourceTribes
    );
  if (effectiveTargetGroups === null) {
    return null;
  }
  if (
    effectiveTargetGroups.length > 0 &&
    !areLegalActionTargetGroupsSatisfiable(
      effectiveTargetGroups,
      effectiveRegistration.allowDuplicateTargets === true
    )
  ) {
    return null;
  }
  const groupedTargetCount =
    effectiveTargetGroups.length > 0
      ? effectiveTargetGroups.reduce(
          (sum, group) => sum + group.requiredTargetCount,
          0
        )
      : null;
  const groupedMaxTargetCount =
    effectiveTargetGroups.length > 0
      ? effectiveTargetGroups.reduce(
          (sum, group) =>
            sum + (group.maxTargetCount ?? group.requiredTargetCount),
          0
        )
      : null;
  const rawRequiredTargetCount =
    groupedTargetCount ??
    getResolvedRequiredTargetCount(
      state,
      activeStack.actingPlayerId,
      activeStack.cardInstanceId,
      effectiveRegistration,
      options.getCardDefinitionById,
      activeStack.divineSkillCoreCost
    );
  const baseMaxTargetCount =
    groupedMaxTargetCount ??
    (effectiveRegistration.maxTargetCountDynamic !== undefined
      ? resolveDynamicCount(effectiveRegistration.maxTargetCountDynamic)
      : getMaxTargetCount(effectiveRegistration));
  // ENGINE-target-count-expand-modifier Step4: GUI 候補数上限への expand_effect_target_count
  // CE の楽観的加算 (legal-actions-availability.ts getResolvedMaxTargetCount と同じ意味論)。
  const resolvedMaxTargetCount =
    groupedMaxTargetCount !== null || baseMaxTargetCount <= 0
      ? baseMaxTargetCount
      : baseMaxTargetCount +
        getExpandEffectTargetCountBonusDeclarative({
          state,
          actingPlayerId: activeStack.actingPlayerId,
          sourceInstanceId: activeStack.cardInstanceId,
          registration: effectiveRegistration,
          getCardDefinitionById: options.getCardDefinitionById,
        });
  const costLimitedMaxTargetCount =
    effectiveTargetGroups.length > 0
      ? resolvedMaxTargetCount
      : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
          state,
          activeStack.actingPlayerId,
          effectiveRegistration,
          resolvedMaxTargetCount,
          sourceTribes
        );
  if (costLimitedMaxTargetCount < rawRequiredTargetCount) {
    return null;
  }
  const targetEffectIndex = getActiveStackEffectIndex(
    activeStack,
    effectiveRegistration
  );
  const targetEffect =
    targetEffectIndex !== undefined
      ? effectSourceDefinition?.effects?.[targetEffectIndex]
      : undefined;
  const targetStepUsesPerRepeatSelection =
    activeStack.optionalRepeatTargetCount !== undefined &&
    targetEffect?.steps.some(
      (step, stepIndex) =>
        step.targetSelectionTiming === "on_step" &&
        step.repeat?.optional === true &&
        (effectiveRegistration.targetStepId === undefined ||
          effectiveRegistration.targetStepId ===
            (step.id ?? `__step_${stepIndex}`))
    ) === true;
  const targetCountOverride =
    effectiveTargetGroups.length === 0 && !targetStepUsesPerRepeatSelection
      ? activeStack.optionalRepeatTargetCount
      : undefined;
  if (
    targetCountOverride !== undefined &&
    (resolvedMaxTargetCount < targetCountOverride ||
      costLimitedMaxTargetCount < targetCountOverride)
  ) {
    return null;
  }
  const effectiveResolvedMaxTargetCount =
    targetCountOverride !== undefined
      ? targetCountOverride
      : Math.min(resolvedMaxTargetCount, costLimitedMaxTargetCount);
  const counts = resolveEmptyFireTargetCounts({
    requiredTargetCount: targetCountOverride ?? rawRequiredTargetCount,
    maxTargetCount: effectiveResolvedMaxTargetCount,
    candidateCount:
      effectiveTargetGroups.length > 0
        ? effectiveTargetGroups.reduce(
            (sum, group) =>
              sum +
              (effectiveRegistration.allowDuplicateTargets === true &&
              group.candidateTargetInstanceIds.length > 0
                ? Math.max(
                    group.candidateTargetInstanceIds.length,
                    group.requiredTargetCount
                  )
                : group.candidateTargetInstanceIds.length),
            0
          )
        : effectiveRegistration.allowDuplicateTargets === true &&
            candidateInstanceIds.length > 0
          ? Math.max(
              candidateInstanceIds.length,
              targetCountOverride ?? rawRequiredTargetCount
            )
          : candidateInstanceIds.length,
    gatedByConditionalCost:
      effectiveRegistration.targetGatedByConditionalCost === true,
    requiresFullCount: effectiveRegistration.targetRequiresFullCount === true,
  });
  if (counts.block) {
    return null;
  }
  // 対象不要 (要求 0 かつ 上限 0 = 空撃ち含む) なら延期しない。
  if (
    effectiveTargetGroups.length === 0 &&
    counts.requiredTargetCount === 0 &&
    counts.maxTargetCount === 0
  ) {
    return null;
  }
  const effectiveCandidateInstanceIds =
    effectiveTargetGroups.length > 0
      ? Array.from(
          new Set(
            effectiveTargetGroups.flatMap(
              (group) => group.candidateTargetInstanceIds
            )
          )
        )
      : candidateInstanceIds;
  return {
    requiredTargetCount: groupedTargetCount ?? counts.requiredTargetCount,
    maxTargetCount: groupedMaxTargetCount ?? counts.maxTargetCount,
    ...(effectiveRegistration.allowDuplicateTargets === true
      ? { allowDuplicateTargets: true }
      : {}),
    candidateInstanceIds: effectiveCandidateInstanceIds,
    candidateTargetZones: getCandidateTargetZones(effectiveRegistration),
    ...(effectiveTargetGroups.length > 0
      ? { targetGroups: effectiveTargetGroups }
      : {}),
    targetEffectFilterTags: getTargetEffectFilterTags(effectiveRegistration),
    ...(effectiveRegistration.targetStepId !== undefined
      ? { targetStepId: effectiveRegistration.targetStepId }
      : {}),
  };
}

/**
 * gate_flash_stack_core の対象となる「フラッシュ/スタック効果」の actionKind 集合。
 *
 * 10_rules/03c: 対象は明示ラベルのフラッシュ/スタック効果のみ。誘発(triggered_effect)/
 * バースト(burst_activation)/召喚配置(summon/place_nexus)は含まない。マジック使用も
 * フラッシュタイミングで発揮するフラッシュ効果なので含む(使用は止めず発揮直前にコアを要する)。
 */
