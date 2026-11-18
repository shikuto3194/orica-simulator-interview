import {
  getDefaultZoneRoleName,
  stripUnderCardReferences,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 分離転醒のコア配置先を独立したB面カードとして仮表示する。実状態は確定まで保持する。 */
export function projectRebirthCorePlacementPreview(
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingCoreDistribution;
  const completion = pending?.rebirthCompletion;
  if (!completion?.deferredAction?.separatesFromHost) return state;
  const candidate = pending?.candidates.find(
    (c) => c.instanceId === completion.sourceInstanceId
  );
  const definition = candidate && getDefinition(candidate.definitionId);
  if (!candidate || !definition) return state;
  const cards = stripUnderCardReferences(
    state.cardInstances,
    new Set([candidate.instanceId])
  );
  return {
    ...state,
    cardInstances: cards.map((card) =>
      card.instanceId === candidate.instanceId
        ? {
            ...card,
            definitionId: definition.cardNo,
            zoneRoleName: getDefaultZoneRoleName(definition, "field"),
            attachedToInstanceId: null,
          }
        : {
            ...card,
            attachedChildrenIds: card.attachedChildrenIds.filter(
              (id) => id !== candidate.instanceId
            ),
          }
    ),
  };
}
