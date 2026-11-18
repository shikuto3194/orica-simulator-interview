import {
  createCardInstance,
  createEmptyGameState,
  runStateBasedActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-10-19 source correction: mandatory self-reference rewrite. */
export function buildMarisaBraveRewriteScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const make = (no: string, id: string, player: string) =>
    createCardInstance(cards.find((c) => c.cardNo === no)!, {
      instanceId: id,
      ownerPlayerId: player,
      controllerPlayerId: player,
      zone: "field",
      normalCoreCount: 1,
    });
  if (params?.get("mode") === "capacity") {
    const host = {
      ...make("BSTH02-X04", "marisa-host", owner),
      normalCoreCount: 2,
      attachedChildrenIds: ["marisa-brave", "marisa-broom"],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          host,
          {
            ...make("BSTH01-R03", "marisa-brave", owner),
            normalCoreCount: 0,
            attachedToInstanceId: host.instanceId,
          },
          {
            ...make("BSTH01-R02", "marisa-broom", owner),
            normalCoreCount: 0,
            attachedToInstanceId: host.instanceId,
          },
          make("BSTH01-C01", "marisa-target", opponent),
        ],
      }),
      activePlayerId: opponent,
      turnNumber: 3,
      step: "main",
      window: "none",
      activeContinuousEffects: [
        {
          effectId: "capacity-suppression",
          sourceInstanceId: "marisa-target",
          sourceDefinitionId: "BSTH01-C01",
          targetInstanceId: host.instanceId,
          actingPlayerId: opponent,
          modifierTag: "effect_suppression",
          metadata: { effectFilter: { effectIndex: 1 } },
          duration: { scope: "turn" },
          createdAtTurn: 3,
          createdAtAttackId: null,
        },
      ],
    };
    return runStateBasedActions(state, (id) =>
      cards.find((c) => c.cardNo === id)
    ).state;
  }
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make("BSTH03-M05", "marisa-host", owner),
        make("BSTH01-R03", "marisa-brave", owner),
        make("BSTH01-C01", "marisa-target", opponent),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
}
