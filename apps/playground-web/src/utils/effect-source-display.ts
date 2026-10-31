import type {
  CardDefinition,
  GameState,
  ResolutionSource,
} from "@orica/rules-core";

interface EffectProvider {
  effectSourceInstanceId?: string | undefined;
  effectSourceDefinitionId?: string | undefined;
}

interface EffectDisplaySource extends EffectProvider {
  sourceInstanceId?: string | undefined;
  sourceDefinitionId: string;
  // LegalAction uses sourceEffect*, while continuations use effectSource*.
  sourceEffectInstanceId?: string | undefined;
  sourceEffectDefinitionId?: string | undefined;
  continuation?: EffectProvider | undefined;
  deferredStack?: EffectProvider | undefined;
}

/** Queue and in-effect choices display the text provider, even when the host resolves the effect. */
export function getEffectSourceDisplay(
  state: Pick<GameState, "cardInstances">,
  source: EffectDisplaySource,
  getDefinition: (id: string) => CardDefinition | undefined
) {
  const effectDefinitionId =
    source.effectSourceDefinitionId ??
    source.sourceEffectDefinitionId ??
    source.continuation?.effectSourceDefinitionId ??
    source.deferredStack?.effectSourceDefinitionId;
  const effectInstanceId =
    source.effectSourceInstanceId ??
    source.sourceEffectInstanceId ??
    source.continuation?.effectSourceInstanceId ??
    source.deferredStack?.effectSourceInstanceId;
  const instanceId = effectInstanceId ?? source.sourceInstanceId;
  const instance = state.cardInstances.find(
    (card) => card.instanceId === instanceId
  );
  // Keep the declared face when the live card has since flipped or left play.
  const definition =
    (effectDefinitionId ? getDefinition(effectDefinitionId) : undefined) ??
    (effectInstanceId && instance
      ? getDefinition(instance.definitionId)
      : undefined) ??
    getDefinition(source.sourceDefinitionId) ??
    (instance ? getDefinition(instance.definitionId) : undefined);
  return {
    definition,
    instanceId,
    definitionId:
      definition?.cardNo ?? effectDefinitionId ?? source.sourceDefinitionId,
    imagePath: definition?.image ? `/${definition.image}` : null,
    cardName: definition?.name ?? "?",
  };
}

/** Adapt the engine queue's source names to the same display resolver. */
export function getResolutionSourceDisplay(
  state: Pick<GameState, "cardInstances">,
  source: ResolutionSource,
  getDefinition: (id: string) => CardDefinition | undefined
) {
  return getEffectSourceDisplay(
    state,
    {
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: source.definitionId,
      effectSourceInstanceId: source.effectInstanceId,
      effectSourceDefinitionId: source.effectDefinitionId,
    },
    getDefinition
  );
}
