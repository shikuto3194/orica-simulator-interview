import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Actual summon/advent → declaration → stack → optional choice, with one target. */
export function buildPartialTargetResolutionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const no = params?.get("card") ?? "BSTH06-C03";
  if (!["BSTH06-C03", "BSTH05-R01", "BSSG01-X01"].includes(no))
    throw new Error("Unsupported partial-target card: " + no);
  const own = no !== "BSSG01-X01";
  const count = params?.get("count") === "2" ? 2 : 1;
  const getCardDefinitionById = (id: string) =>
    cards.find((c) => c.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBurstActions: () => undefined,
  };
  const instance = (cardNo: string, id: string, player: string) =>
    createCardInstance(getCardDefinitionById(cardNo)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone: "field",
      normalCoreCount: 2,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance(no, "partial-source", owner),
        ...Array.from({ length: own ? count - 1 : count }, (_, i) =>
          instance(
            own ? no : "BSTH06-C03",
            "partial-target-" + i,
            own ? owner : owner === "alice" ? "bob" : "alice"
          )
        ),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 5, voidNormalCoreCount: 50 },
        { reserveNormalCoreCount: 5, voidNormalCoreCount: 50 },
      ],
    }),
    step: "main",
    activePlayerId: owner,
    turnNumber: 3,
  };
  state = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: owner,
        eventKind: own ? "summon" : "advent",
        source: "action_resolution",
        chainId: "partial-scenario",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "partial-source",
        amount: null,
      },
    ],
    undefined,
    lookups
  );
  const declaration = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly);
  if (!declaration) throw new Error("Missing real-card trigger");
  state = applyLegalAction({ state, action: declaration, ...lookups }).state;
  for (let i = 0; state.stackWindow && i < 6; i++) {
    const pass = getLegalActions({
      state,
      actingPlayerId: state.stackWindow.priorityPlayerId,
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    if (!pass) throw new Error("Missing stack pass");
    state = applyLegalAction({ state, action: pass, ...lookups }).state;
  }
  if (!state.pendingStepOptionalChoice)
    throw new Error("Missing optional choice");
  return state;
}
