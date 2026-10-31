import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** React側の原文訂正: 金龍の任意回復、サグメ/ドレミーのLv2神域。 */
export function buildReactCardCorrectionsScenario(
  definitions: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const cards = expandCardDefinitionsWithBackFaces(definitions);
  const getCardDefinitionById = (id: string) =>
    cards.find((c) => c.cardNo === id);
  const options = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBurstActions: () => [],
  };
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const mode = params?.get("mode") ?? "kinryu";
  const low = params?.get("low") === "1";
  const no =
    mode === "sagume"
      ? "BSTH10-X03"
      : mode === "doremy"
        ? "BSTH10-X04"
        : "BSTH04-転醒R01(B)";
  const source = createCardInstance(getCardDefinitionById(no)!, {
    instanceId: "correction-source",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: mode === "sagume" ? (low ? 4 : 5) : low ? 2 : 3,
    exhaustState: mode === "kinryu" ? "exhausted" : "recovered",
  });
  const hands =
    mode === "doremy"
      ? ["alice", "bob"].flatMap((player) =>
          Array.from({ length: 6 }, (_, i) =>
            createCardInstance(getCardDefinitionById("BSTH10-C03")!, {
              instanceId: `correction-${player}-hand-${i}`,
              ownerPlayerId: player,
              zone: "hand",
            })
          )
        )
      : [];
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        source,
        ...hands,
        ...["alice", "bob"].flatMap((player) =>
          Array.from({ length: 8 }, (_, i) =>
            createCardInstance(getCardDefinitionById("BSTH10-C03")!, {
              instanceId: `correction-${player}-deck-${i}`,
              ownerPlayerId: player,
              zone: "deck",
            })
          )
        ),
        ...(mode === "sagume"
          ? [
              createCardInstance(getCardDefinitionById("BSTH10-X02")!, {
                instanceId: "correction-ultimate",
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        lifeNormalCoreCount: 5,
        trashNormalCoreCount: id === owner ? 2 : 0,
        voidNormalCoreCount: 10,
        handCount: mode === "doremy" ? 6 : 0,
        deckCount: 8,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      })),
    }),
    step: mode === "sagume" ? "start" : mode === "doremy" ? "end" : "attack",
    activePlayerId: owner,
    turnNumber: 3,
    window: "none",
  };
  if (mode === "kinryu")
    return executeEffect({
      state,
      ...options,
      chainId: "react-card-corrections",
      sourceInstanceId: source.instanceId,
      effect: getCardDefinitionById(no)!.effects![0]!,
      effectIndex: 0,
      actingPlayerId: owner,
    });
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        eventKind: mode === "doremy" ? "end_step" : "start_step",
        actingPlayerId: owner,
        relatedPlayerId: owner,
        relatedInstanceId: null,
        amount: null,
        attackId: null,
        chainId: "react-card-corrections",
        source: "step_transition",
        step: state.step,
        subPhase: "start",
      },
    ],
    undefined,
    options
  );
}
