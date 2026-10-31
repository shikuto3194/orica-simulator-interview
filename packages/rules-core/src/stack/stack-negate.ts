import { getCardById } from "../card/card-lookup";
import { matchesCardFilter } from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import type { CardFilter } from "../dsl-types";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import { resolveCardImmunityAffect } from "../effect/effect-affect-adapter";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  canEffectPenetrateDefense,
  buildEffectSourceIdentity,
  getEffectClassSourcePreventionBypass,
  getCombinedUnitCostFilterOptions,
  getEffectiveColors,
  matchesEffectTargetFilter,
} from "../legal/legal-actions-shared";
import type {
  ActiveStack,
  CardInstance,
  CardDefinition,
  GameState,
  NegateAction,
} from "../model";
import type { Effect } from "../dsl-types";
import type { EffectSourceKind } from "../source-kinds";
import { canBypassTargetLock } from "../effect/target-affect-gate";

function getDefinitionEffectForStack(
  definition: CardDefinition | undefined,
  stack: ActiveStack
): Effect | undefined {
  const effectIndex = stack.suppressionEffectDescriptor?.effectIndex;
  if (definition === undefined || effectIndex === undefined) {
    return undefined;
  }
  switch (stack.actionKind) {
    case "accel":
      return definition.accelData?.effects?.[effectIndex];
    case "change":
      return definition.changeData?.effects?.[effectIndex];
    default:
      return definition.effects?.[effectIndex];
  }
}

export function getStackNegatePreventionLevel(
  stack: ActiveStack
): NonNullable<ActiveStack["negatePreventionLevel"]> {
  // 公式エターナルQ1481: 「防げない」効果も発揮前に無効にできる。
  // 解決時の防止貫通 (preventionLevel) と明示的な無効化耐性を混同しない。
  return stack.negatePreventionLevel ?? "none";
}

function isEffectSourceKind(
  value: string | undefined
): value is EffectSourceKind {
  return (
    value === "magic" ||
    value === "spirit" ||
    value === "ultimate" ||
    value === "nexus" ||
    value === "system"
  );
}

function getStackEffectSourceKind(
  stack: ActiveStack
): EffectSourceKind | undefined {
  switch (stack.actionKind) {
    case "magic":
      return "magic";
    case "field_card_effect":
      return isEffectSourceKind(stack.fieldEffectSourceKind)
        ? stack.fieldEffectSourceKind
        : undefined;
    case "triggered_effect":
      return stack.triggeredSourceKind;
    case "battle_immediate_effect":
      return stack.battleImmediateSourceKind;
    case "burst_activation":
      return stack.burstSourceKind;
    default:
      return undefined;
  }
}

function getStackSuppressionEffectDescriptor(
  stack: ActiveStack
): ActiveStack["suppressionEffectDescriptor"] {
  if (!stack.suppressionEffectDescriptor) return undefined;
  const sourceKind =
    stack.suppressionEffectDescriptor.sourceKind ??
    getStackEffectSourceKind(stack);
  return {
    ...stack.suppressionEffectDescriptor,
    ...(sourceKind !== undefined ? { sourceKind } : {}),
  };
}

function getStackTargetFilterSubject(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): { card: CardInstance; definition: CardDefinition } {
  const hostInstanceId =
    card.zone === "field"
      ? (card.attachedToInstanceId ?? card.imaginRightCombinedWith)
      : null;
  if (hostInstanceId) {
    const hostCard = getCardById(state, hostInstanceId);
    const hostDefinition = hostCard
      ? getCardDefinitionById(hostCard.definitionId)
      : undefined;
    if (hostCard && hostDefinition) {
      return { card: hostCard, definition: hostDefinition };
    }
  }
  return { card, definition };
}

export type StackNegateActionLike = {
  negateTarget: NegateAction["negateTarget"] | "use";
  sourceInstanceId?: string;
  targetFilter?: CardFilter | undefined;
  targetController?: NegateAction["targetController"];
  targetEffectTiming?: NegateAction["targetEffectTiming"];
  targetEffectFilter?: NegateAction["targetEffectFilter"];
};

function getStackTimingForNegateRequest(
  stack: ActiveStack,
  request: StackNegateActionLike
): ActiveStack["chosenTiming"] | ActiveStack["activationLabel"] {
  if (
    normalizeNegateTarget(request.negateTarget) === "effect" &&
    stack.activationLabel === "none"
  ) {
    // effect negate matches the declaration window; "use" negate/gates still use the explicit label.
    return stack.chosenTiming;
  }
  return stack.activationLabel ?? stack.chosenTiming;
}

function normalizeNegateTarget(
  target: StackNegateActionLike["negateTarget"]
): NegateAction["negateTarget"] {
  return target === "use" ? "use_magic" : target;
}

function stackMatchesNegateTarget(
  stack: ActiveStack,
  request: StackNegateActionLike
): boolean {
  switch (normalizeNegateTarget(request.negateTarget)) {
    case "summon":
      return stack.actionKind === "summon";
    case "place":
      return stack.actionKind === "place_nexus";
    case "use_magic":
      return stack.actionKind === "magic";
    case "effect":
      return (
        (stack.actionKind === "burst_activation" &&
          stack.burstEffectDeclared === true) ||
        (request.targetEffectTiming !== undefined &&
          stack.actionKind === "magic") ||
        stack.actionKind === "field_card_effect" ||
        stack.actionKind === "hand_card_effect" ||
        stack.actionKind === "triggered_effect" ||
        stack.actionKind === "battle_immediate_effect" ||
        stack.actionKind === "divine_skill" ||
        stack.actionKind === "accel" ||
        stack.actionKind === "change"
      );
    case "opponent_burst":
      return stack.actionKind === "burst_activation";
  }
}

export function stackMatchesNegateAction(options: {
  state: GameState;
  stack: ActiveStack;
  request: StackNegateActionLike;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceCard?: CardInstance | undefined;
  sourceDefinition?: CardDefinition | undefined;
}): boolean {
  const {
    state,
    stack,
    request,
    actingPlayerId,
    getCardDefinitionById,
    sourceCard,
    sourceDefinition,
  } = options;
  if (
    request.targetController === "opponent" &&
    stack.actingPlayerId === actingPlayerId
  ) {
    return false;
  }
  if (stack.actingPlayerId === actingPlayerId) return false;
  if (!stackMatchesNegateTarget(stack, request)) return false;
  const effectTimingLabel = getStackTimingForNegateRequest(stack, request);
  if (
    request.targetEffectTiming !== undefined &&
    effectTimingLabel !== request.targetEffectTiming
  ) {
    return false;
  }
  if (
    request.targetEffectFilter !== undefined &&
    !matchesEffectTargetFilter(
      request.targetEffectFilter,
      getStackSuppressionEffectDescriptor(stack)
    )
  ) {
    return false;
  }
  if (
    !canEffectPenetrateDefense("none", getStackNegatePreventionLevel(stack))
  ) {
    return false;
  }

  const filter = request.targetFilter;

  const card = getCardById(state, stack.cardInstanceId);
  const definition = getCardDefinitionById(stack.cardDefinitionId);
  if (!card || !definition) return false;
  const resolvedSourceCard =
    sourceCard ??
    (request.sourceInstanceId !== undefined
      ? getCardById(state, request.sourceInstanceId)
      : undefined);
  const resolvedSourceDefinition =
    sourceDefinition ??
    (resolvedSourceCard
      ? getCardDefinitionById(resolvedSourceCard.definitionId)
      : undefined);
  const effectProtection = getEffectClassSourcePreventionBypass(
    state,
    getDefinitionEffectForStack(definition, stack),
    card.instanceId,
    card.controllerPlayerId,
    getCardDefinitionById,
    "stack_negate",
    getStackSuppressionEffectDescriptor(stack)
  );
  if (
    effectProtection &&
    canBypassTargetLock(
      { resistance: "none", targetLockBypass: effectProtection },
      resolvedSourceDefinition
        ? buildEffectSourceIdentity(
            state,
            resolvedSourceCard,
            resolvedSourceDefinition,
            getCardDefinitionById
          )
        : undefined
    )
  )
    return false;
  const filterSubject = getStackTargetFilterSubject(
    state,
    card,
    definition,
    getCardDefinitionById
  );
  const filterCard = filterSubject.card;
  const filterDefinition = filterSubject.definition;
  const targetAffect = resolveCardImmunityAffect(
    state,
    filterCard,
    actingPlayerId,
    "none",
    {
      instance: resolvedSourceCard,
      definition: resolvedSourceDefinition,
    },
    getCardDefinitionById
  );
  if (targetAffect.kind !== "allowed") {
    return false;
  }

  if (!filter) return true;
  return matchesCardFilter(filterCard, filterDefinition, filter, {
    state,
    ...getCombinedUnitCostFilterOptions(
      state,
      filterCard,
      filterDefinition,
      getCardDefinitionById
    ),
    ...(stack.costForFilter !== undefined
      ? { effectiveCost: stack.costForFilter }
      : {}),
    ...(filterCard.zone === "field"
      ? { fieldCategoryContext: true, getCardDefinitionById }
      : {
          effectiveCategory: getEffectiveCategory(
            state,
            filterCard,
            filterDefinition
          ),
        }),
    effectiveColors: getEffectiveColors(state, filterCard, filterDefinition),
    effectiveBp:
      filterCard.zone === "field"
        ? getCombinedUnitBp(
            state,
            filterCard,
            filterDefinition,
            getCardDefinitionById
          )
        : undefined,
    coreCount:
      filterCard.zone === "field"
        ? getTotalCoresOnCardById(state, filterCard.instanceId)
        : undefined,
    effectiveLevel:
      filterCard.zone === "field"
        ? getEffectiveLevel(
            state,
            filterCard,
            filterDefinition,
            getCardDefinitionById
          )
        : undefined,
    effectiveSymbolCount:
      filterCard.zone === "field"
        ? getCombinedUnitSymbolCount(
            state,
            filterCard,
            filterDefinition,
            getCardDefinitionById
          )
        : undefined,
  });
}
