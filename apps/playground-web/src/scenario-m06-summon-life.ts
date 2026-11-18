import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Real M06 normal summon / burst entry, before its summon-time optional effect. */
export function buildM06SummonLifeScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const normal = params?.get("mode") === "normal";
  const getDefinition = (id: string) => cards.find((c) => c.cardNo === id);
  const base: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 20,
        lifeNormalCoreCount: 5,
        voidNormalCoreCount: 10,
        handCount: id === owner ? 1 : 0,
      })),
      cardInstances: [
        createCardInstance(getDefinition("BSTH03-M06")!, {
          instanceId: "m06",
          ownerPlayerId: owner,
          zone: "hand",
        }),
        createCardInstance(getDefinition("BSTH01-C01")!, {
          instanceId: "opponent",
          ownerPlayerId: opponent,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...(params?.get("eirentei") === "1"
          ? [
              createCardInstance(getDefinition("BSTH03-C31")!, {
                instanceId: "eirentei",
                ownerPlayerId: opponent,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
      ],
    }),
    activePlayerId: owner,
    step: "main",
    turnNumber: 4,
  };
  const ready = recomputeAndRebuildContinuousEffects(base, getDefinition);
  if (normal) return ready;
  const lookups = {
    getCardDefinitionById: getDefinition,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  };
  // Set through the public action path. Burst concealment uses setBurstStates,
  // while faceDown denotes an identity-less field card and must stay false.
  const set = getLegalActions({
    state: ready,
    actingPlayerId: owner,
    ...lookups,
  }).find((a) => a.kind === "set_burst" && a.sourceInstanceId === "m06");
  if (!set) throw new Error("M06 scenario cannot set its burst");
  return {
    ...applyLegalAction({
      state: ready,
      action: set,
      ...lookups,
    }).state,
    activePlayerId: opponent,
    turnNumber: 5,
  };
}
