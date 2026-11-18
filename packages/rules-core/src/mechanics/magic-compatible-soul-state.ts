import { isMagicCompatibleDefinition } from "../card/card-filter";
import type { CardDefinition, GameState } from "../model";

const TRIBE_SEPARATOR = "\u30fb";
const KEY_TRIBE = "\u9375";

export function isSoulStateInheritingKeyBraveDefinition(
  def: CardDefinition
): boolean {
  return (
    isMagicCompatibleDefinition(def) &&
    (def.tribe?.split(TRIBE_SEPARATOR).includes(KEY_TRIBE) ?? false)
  );
}

export function collectMagicCompatibleAttachedBraveIds(
  state: GameState,
  hostIds: Iterable<string>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  const hostIdSet = new Set(hostIds);
  if (hostIdSet.size === 0) return [];

  const cardById = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  const attachedIds: string[] = [];
  for (const hostId of hostIdSet) {
    const host = cardById.get(hostId);
    if (!host) continue;
    for (const attachedId of host.attachedChildrenIds) {
      const card = cardById.get(attachedId);
      if (!card || card.attachedToInstanceId !== host.instanceId) continue;
      const def = getCardDefinitionById(card.definitionId);
      if (!def || !isMagicCompatibleDefinition(def)) continue;
      attachedIds.push(card.instanceId);
    }
  }
  return attachedIds;
}

export function expandWithMagicCompatibleAttachedBraves(
  state: GameState,
  hostIds: Iterable<string>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  const expanded = new Set(hostIds);
  for (const id of collectMagicCompatibleAttachedBraveIds(
    state,
    expanded,
    getCardDefinitionById
  )) {
    expanded.add(id);
  }
  return [...expanded];
}

export function expandWithSoulStateInheritingKeyBraves(
  state: GameState,
  hostIds: Iterable<string>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  const expanded = new Set(hostIds);
  const cardById = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  for (const hostId of expanded) {
    const host = cardById.get(hostId);
    if (!host) continue;
    for (const attachedId of host.attachedChildrenIds) {
      const card = cardById.get(attachedId);
      if (!card || card.attachedToInstanceId !== host.instanceId) continue;
      const def = getCardDefinitionById(card.definitionId);
      if (!def || !isSoulStateInheritingKeyBraveDefinition(def)) continue;
      expanded.add(card.instanceId);
    }
  }
  return [...expanded];
}

export function getEffectiveSoulStateIds(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Set<string> {
  return new Set(
    expandWithSoulStateInheritingKeyBraves(
      state,
      state.players.flatMap((player) => player.soulStateInstanceIds),
      getCardDefinitionById
    )
  );
}

export function createMagicCompatibleSoulStateCostDefinition(
  state: GameState,
  hostDefinition: CardDefinition,
  attachedIds: Iterable<string>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition {
  const cardById = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  let cost = hostDefinition.cost;
  const reductionSymbols = [...hostDefinition.reductionSymbols];
  for (const attachedId of attachedIds) {
    const card = cardById.get(attachedId);
    if (!card) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    cost += def.cost;
    reductionSymbols.push(...def.reductionSymbols);
  }
  return {
    ...hostDefinition,
    cost,
    reductionSymbols,
  };
}
