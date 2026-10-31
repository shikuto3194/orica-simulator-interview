import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 提供snapshotの直前: チルノの全コアで鏡を配置し、配置時効果を選ぶ。 */
export function buildCostLeaveCompletionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getCardDefinitionById = (id: string) =>
    cards.find((c) => c.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandCardEffectActions: () => undefined,
    getRegisteredMagicActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
  };
  const fixtures = [
    ["payer", "BSTH04-C01", "field", 2],
    ["mirror", "BSTH04-転醒R01(A)", "hand", 0],
    ["pick", "BSTH04-M01", "deck", 0],
    ["other", "BSTH04-X03", "deck", 0],
  ] as const;
  let state: GameState = rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: ["alice", "bob"].map((id) => ({
          reserveNormalCoreCount: 0,
          handCount: id === owner ? 1 : 0,
          deckCount: id === owner ? 2 : 0,
        })),
        cardInstances: fixtures.map(([instanceId, no, zone, normalCoreCount]) =>
          createCardInstance(getCardDefinitionById(no)!, {
            instanceId,
            ownerPlayerId: owner,
            zone,
            normalCoreCount,
          })
        ),
      }),
      step: "main",
      activePlayerId: owner,
      turnNumber: 2,
    },
    getCardDefinitionById
  );
  const place = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find((a) => a.kind === "place_nexus")!;
  state = applyLegalAction({
    state,
    action: place,
    ...lookups,
    paymentSources: [{ kind: "card", instanceId: "payer", amount: 2 }],
  }).state;
  const pass = getLegalActions({
    state,
    actingPlayerId: opponent,
    ...lookups,
  }).find((a) => a.kind === "pass_stack")!;
  return applyLegalAction({ state, action: pass, ...lookups }).state;
}
