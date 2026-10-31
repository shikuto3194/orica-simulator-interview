import { getCardById } from "../card/card-lookup";
import type { CardDefinition, CardInstance } from "../model";

interface HasCardInstances {
  readonly cardInstances: readonly CardInstance[];
}

export interface ResolveAffectSourceIdentityOptions {
  state: HasCardInstances;
  sourceInstanceId: string;
  sourceDefinition?: CardDefinition | undefined;
  sourceDefinitionId?: string | undefined;
  effectSourceInstanceId?: string | undefined;
  effectSourceDefinition?: CardDefinition | undefined;
  effectSourceDefinitionId?: string | undefined;
  getCardDefinitionById?:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined;
}

export interface ResolvedAffectSourceIdentity {
  instanceId: string;
  definitionId?: string | undefined;
  instance?: CardInstance | undefined;
  definition?: CardDefinition | undefined;
  /**
   * true when `effectSourceInstanceId` was intentionally kept as the affect
   * source (text-role under-card, quartz inheritance, etc.).
   */
  usedEffectSource: boolean;
  /**
   * true when a combined brave provides the text but the host remains the
   * affect source identity.
   */
  effectSourceIsCombinedBrave: boolean;
}

function resolveDefinition(options: {
  explicitDefinition?: CardDefinition | undefined;
  explicitDefinitionId?: string | undefined;
  instance?: CardInstance | undefined;
  getCardDefinitionById?:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined;
}): CardDefinition | undefined {
  return (
    options.explicitDefinition ??
    (options.explicitDefinitionId !== undefined
      ? options.getCardDefinitionById?.(options.explicitDefinitionId)
      : undefined) ??
    (options.instance
      ? options.getCardDefinitionById?.(options.instance.definitionId)
      : undefined)
  );
}

function isBraveLikeEffectSource(
  card: CardInstance,
  definition: CardDefinition | undefined
): boolean {
  return (
    card.zoneRoleName === "brave" ||
    definition?.printedCategory === "brave" ||
    definition?.braveCondition !== undefined ||
    definition?.combinedBoost !== undefined
  );
}

export function isCardCombinedWithHostAsBraveEffectSource(options: {
  hostCard: CardInstance;
  effectSourceCard: CardInstance;
}): boolean {
  const { hostCard, effectSourceCard } = options;
  return (
    (effectSourceCard.attachedToInstanceId === hostCard.instanceId &&
      hostCard.attachedChildrenIds.includes(effectSourceCard.instanceId)) ||
    effectSourceCard.imaginRightCombinedWith === hostCard.instanceId
  );
}

export function isCombinedBraveEffectSource(
  options: ResolveAffectSourceIdentityOptions
): boolean {
  const effectSourceInstanceId = options.effectSourceInstanceId;
  if (
    effectSourceInstanceId === undefined ||
    effectSourceInstanceId === options.sourceInstanceId
  ) {
    return false;
  }

  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  const effectSourceCard = getCardById(options.state, effectSourceInstanceId);
  if (!sourceCard || !effectSourceCard) return false;
  if (
    !isCardCombinedWithHostAsBraveEffectSource({
      hostCard: sourceCard,
      effectSourceCard,
    })
  ) {
    return false;
  }

  const effectSourceDefinition = resolveDefinition({
    explicitDefinition: options.effectSourceDefinition,
    explicitDefinitionId: options.effectSourceDefinitionId,
    instance: effectSourceCard,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return isBraveLikeEffectSource(effectSourceCard, effectSourceDefinition);
}

/**
 * Resolves the card identity used by affect/immunity/prevention gates.
 *
 * `effectSource*` identifies the text provider for under-card/quartz effects.
 * For a brave's 【合体中】 effect, however, the text provider is the attached
 * brave while the effect belongs to the combined host. In that case affect
 * source identity must stay on `sourceInstanceId`.
 */
export function resolveAffectSourceIdentity(
  options: ResolveAffectSourceIdentityOptions
): ResolvedAffectSourceIdentity {
  const effectSourceIsCombinedBrave = isCombinedBraveEffectSource(options);
  const instanceId =
    !effectSourceIsCombinedBrave && options.effectSourceInstanceId !== undefined
      ? options.effectSourceInstanceId
      : options.sourceInstanceId;
  const instance = getCardById(options.state, instanceId);
  const definition = effectSourceIsCombinedBrave
    ? resolveDefinition({
        explicitDefinition: options.sourceDefinition,
        explicitDefinitionId: options.sourceDefinitionId,
        instance,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    : (resolveDefinition({
        explicitDefinition: options.effectSourceDefinition,
        explicitDefinitionId: options.effectSourceDefinitionId,
        instance,
        getCardDefinitionById: options.getCardDefinitionById,
      }) ??
      resolveDefinition({
        explicitDefinition: options.sourceDefinition,
        explicitDefinitionId: options.sourceDefinitionId,
        instance,
        getCardDefinitionById: options.getCardDefinitionById,
      }));

  return {
    instanceId,
    ...(instance !== undefined ? { instance } : {}),
    ...(definition !== undefined
      ? { definition, definitionId: definition.cardNo }
      : instance !== undefined
        ? { definitionId: instance.definitionId }
        : {}),
    usedEffectSource:
      !effectSourceIsCombinedBrave &&
      options.effectSourceInstanceId !== undefined &&
      options.effectSourceInstanceId !== options.sourceInstanceId,
    effectSourceIsCombinedBrave,
  };
}

/** Matches one spirit and its combined brave text providers; under-cards are excluded. */
export function isSameCombinedEffectSource(
  state: HasCardInstances,
  leftInstanceId: string,
  rightInstanceId: string
): boolean {
  if (leftInstanceId === rightInstanceId) return true;
  const left = getCardById(state, leftInstanceId);
  const right = getCardById(state, rightInstanceId);
  if (!left || !right || left.zone !== "field" || right.zone !== "field")
    return false;
  return state.cardInstances.some(
    (host) =>
      host.zone === "field" &&
      (host.instanceId === leftInstanceId ||
        isCardCombinedWithHostAsBraveEffectSource({
          hostCard: host,
          effectSourceCard: left,
        })) &&
      (host.instanceId === rightInstanceId ||
        isCardCombinedWithHostAsBraveEffectSource({
          hostCard: host,
          effectSourceCard: right,
        }))
  );
}
