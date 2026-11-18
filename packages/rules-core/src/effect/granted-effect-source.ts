import { getCardById } from "../card/card-lookup";
import type { CardDefinition, ContinuousEffect, GameState } from "../model";

/** 本文の取得元。効果の発揮元/失効管理を表す CE.sourceDefinitionId とは区別する。 */
export function resolveGrantedEffectSourceDefinition(
  state: GameState,
  ce: ContinuousEffect,
  lookup: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  const definitionId = ce.metadata?.grantedEffectSourceDefinitionId;
  if (typeof definitionId === "string") return lookup(definitionId);
  const instanceId = ce.metadata?.grantedEffectSourceInstanceId;
  if (typeof instanceId === "string") {
    const card = getCardById(state, instanceId);
    const def = card ? lookup(card.definitionId) : undefined;
    if (def) return def;
  }
  const childKey = ce.metadata?.grantedEffectChildKey as
    | { advSourceInstanceId?: unknown }
    | undefined;
  if (typeof childKey?.advSourceInstanceId === "string") {
    const card = getCardById(state, childKey.advSourceInstanceId);
    const def = card ? lookup(card.definitionId) : undefined;
    if (def) return def;
  }
  return lookup(ce.sourceDefinitionId);
}
