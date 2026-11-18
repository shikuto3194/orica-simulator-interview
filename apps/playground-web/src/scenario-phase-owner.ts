import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 添付再現: 同じBobの鈴仙（相手開始時）とパチュリー（自分開始時）。 */
export function buildPhaseOwnerScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const active = params?.get("active") === "bob" ? "bob" : "alice";
  const definitions = new Map(allCards.map((d) => [d.cardNo, d]));
  const card = (no: string, id: string, owner: string, cores: number) =>
    createCardInstance(definitions.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: cores,
    });
  const patchouli = card("BSTH01-M01", "phase-patchouli", "bob", 2);
  patchouli.exhaustState = "exhausted";
  const base: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        patchouli,
        card("BSTH03-R01", "phase-reisen", "bob", 1),
        card("BSTH01-C01", "phase-target-a", "alice", 2),
        card("BSTH01-C02", "phase-target-b", "alice", 2),
        card("BSTH01-C04", "phase-target-c", "alice", 2),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        deckCount: 20,
        trashNormalCoreCount: id === "bob" ? 2 : 0,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      })),
    }),
    activePlayerId: active,
    turnNumber: 6,
    step: "attack",
    window: "none",
  };
  return queuePendingReactionsFromTriggerEvents(
    recomputeAndRebuildContinuousEffects(base, (id) => definitions.get(id)),
    [
      {
        eventKind: "start_step",
        actingPlayerId: active,
        relatedPlayerId: active,
        relatedInstanceId: null,
        amount: null,
        attackId: null,
        chainId: "phase-owner-scenario",
        source: "step_transition",
        step: "attack",
        subPhase: "start",
      },
    ],
    undefined,
    {
      getCardDefinitionById: (id) => definitions.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
      getRegisteredBurstActions: () => [],
    }
  );
}
