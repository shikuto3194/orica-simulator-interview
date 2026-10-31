import {
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 同じアリサ2枚のBP比較を実行し、相打ち後の魂状態選択へ進む。 */
export function buildMutualSoulStateScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const cardNo = params?.get("contract") === "1" ? "BSGE01-CX01" : "BSGE01-R01";
  const getCardDefinitionById = (id: string) =>
    allCards.find((d) => d.cardNo === id);
  const definition = getCardDefinitionById(cardNo)!;
  let state = rebuildContinuousEffectsFromField(
    createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map(() => ({
        contractCardNo: "BSGE01-CX01",
        reserveNormalCoreCount: 3,
      })),
      cardInstances: [owner, opponent].map((playerId) =>
        createCardInstance(definition, {
          instanceId: `mutual-${playerId}`,
          ownerPlayerId: playerId,
          zone: "field",
          normalCoreCount: 2,
          exhaustState: "exhausted",
        })
      ),
    }),
    getCardDefinitionById
  );
  const bp = [...definition.levelDefs!]
    .reverse()
    .find((level) => level.requiredCores <= 2)!.bp!;
  state = {
    ...state,
    turnNumber: 3,
    step: "attack",
    window: "battle_resolution",
    activePlayerId: owner,
    battleEntities: [owner, opponent].map((playerId) => ({
      entityId: `entity-${playerId}`,
      memberInstanceIds: [`mutual-${playerId}`],
      attackState: playerId === owner ? "attacking" : "blocking",
      resolvedBp: bp,
      resolvedSymbols: ["red"],
    })),
    activeAttack: {
      attackId: "attack:mutual-soul-state",
      primaryEntityId: `entity-${owner}`,
      participantEntityIds: [`entity-${owner}`],
      groupMode: "single",
      target: { kind: "player", playerId: opponent },
      blockAssignments: [
        {
          participantEntityId: `entity-${owner}`,
          blockedByEntityIds: [`entity-${opponent}`],
        },
      ],
      symbolResolutionOrder: [`entity-${owner}`],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
  };
  return executeBattleResolution({
    state,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredBurstActions: buildBurstEffectLookup(allCards),
  }).state;
}
