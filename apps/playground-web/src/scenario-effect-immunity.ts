import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
  rebuildContinuousEffectsFromField,
} from "@orica/rules-core";

/** 最古の金木犀の配置時。回復/疲労パチュリーを同時に並べて対象耐性を確認する。 */
export function buildEffectImmunityScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getDef = (id: string) => cards.find((card) => card.cardNo === id);
  const nexus = getDef("BSSA01-転醒X04(A)")!;
  const patchouli = getDef("BSTH01-M01")!;
  const source = createCardInstance(nexus, {
    instanceId: "immunity-nexus",
    ownerPlayerId: owner,
    zone: "field",
  });
  const state = rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { lifeNormalCoreCount: 5 },
          { lifeNormalCoreCount: 5 },
        ],
        cardInstances: [
          source,
          ...["immune", "vulnerable", "vulnerable-2"].map((id) =>
            createCardInstance(patchouli, {
              instanceId: `immunity-${id}`,
              ownerPlayerId: opponent,
              zone: "field",
              normalCoreCount: 1,
              exhaustState: id === "immune" ? "recovered" : "exhausted",
            })
          ),
        ],
      }),
      activePlayerId: owner,
      step: "main",
      turnNumber: 3,
    },
    getDef
  );
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        eventKind: "place",
        actingPlayerId: owner,
        relatedPlayerId: owner,
        relatedInstanceId: source.instanceId,
        source: "action_resolution",
        chainId: "immunity-place",
        attackId: null,
        amount: null,
      },
    ],
    undefined,
    {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
      getRegisteredBurstActions: () => undefined,
    }
  );
}
