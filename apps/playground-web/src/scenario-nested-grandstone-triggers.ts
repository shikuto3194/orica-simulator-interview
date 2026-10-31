import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-25 snapshot: 手札増加→2個体の解封→片方の転醒。 */
export function buildNestedGrandstoneTriggersScenario(
  definitions: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const lookups = {
    getCardDefinitionById: (id: string) =>
      definitions.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
  };
  const card = (
    cardNo: string,
    instanceId: string,
    zone: "field" | "deck",
    cores = 0
  ) =>
    createCardInstance(lookups.getCardDefinitionById(cardNo)!, {
      instanceId,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: 0,
        deckCount: id === owner ? 4 : 0,
        voidNormalCoreCount: 100,
        reserveNormalCoreCount: 5,
      })),
      cardInstances: [
        card("BSTH04-転醒R01(A)", "outer-stone", "field", 2),
        card("BSTH04-転醒R01(A)", "inner-stone", "field", 3),
        card("BSTH04-C03", "cause", "field", 1),
        ...Array.from({ length: 4 }, (_, i) =>
          card("BSTH04-C02", `deck-${i}`, "deck")
        ),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 5,
    step: "main",
  };
  const chainId = "snapshot-hand-increase";
  let state = collectAndQueueTriggerReactions({
    beforeState: before,
    afterState: executeEffect({
      state: before,
      actingPlayerId: owner,
      sourceInstanceId: "cause",
      chainId,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      ...lookups,
    }),
    source: "action_resolution",
    chainId,
    causedByPlayerId: owner,
    causedBySourceInstanceId: "cause",
    ...lookups,
  });
  if (params?.get("stage") === "unseal") return state;
  const innerPending = state.pendingTriggeredEffects.find(
    (p) => p.relatedInstanceId === "inner-stone"
  )!;
  const unseal = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find(
    (a) =>
      a.kind === "select_pending_to_resolve" &&
      a.pendingId === innerPending.pendingId
  );
  if (!unseal) throw new Error("Nested grandstone scenario: unseal missing");
  state = applyLegalAction({ state, action: unseal, ...lookups }).state;
  const pass = getLegalActions({
    state,
    actingPlayerId: opponent,
    ...lookups,
  }).find((a) => a.kind === "pass_stack");
  if (!pass) throw new Error("Nested grandstone scenario: stack pass missing");
  return applyLegalAction({ state, action: pass, ...lookups }).state;
}
