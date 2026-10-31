import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  buildBurstEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 添付再現: カウント14・Lv3リムルが創界神を破壊し、Lv2ベニマルで離脱を参照する。 */
export function buildSpecialNexusReferenceScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getCardDefinitionById = (id: string) =>
    allCards.find((c) => c.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(allCards),
    getRegisteredBurstActions: buildBurstEffectLookup(allCards),
  };
  const rimuru = getCardDefinitionById("BSTS01-X02")!;
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 14 : 1,
        lifeNormalCoreCount: 6,
        reserveNormalCoreCount: 3,
      })),
      cardInstances: [
        createCardInstance(rimuru, {
          instanceId: "reference-rimuru",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(getCardDefinitionById("BSTS01-M02")!, {
          instanceId: "reference-benimaru",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(getCardDefinitionById("BSSA01-XX01")!, {
          instanceId: "reference-victim",
          ownerPlayerId: opponent,
          zone: "field",
        }),
      ],
    }),
    turnNumber: 5,
    activePlayerId: owner,
    step: "attack",
    window: "declare_attack",
  };
  const after = executeEffect({
    chainId: "scenario:scenario-special-nexus-reference.ts:64",
    state: before,
    effect: rimuru.effects![1]!,
    sourceInstanceId: "reference-rimuru",
    actingPlayerId: owner,
    targetInstanceIds: ["reference-victim"],
    ...lookups,
  });
  let state = collectAndQueueTriggerReactions({
    beforeState: before,
    afterState: after,
    source: "action_resolution",
    chainId: null,
    causedByPlayerId: owner,
    ...lookups,
  });
  const burst = getLegalActions({
    state,
    actingPlayerId: opponent,
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_burst_check" && a.can);
  if (burst)
    state = applyLegalAction({ state, action: burst, ...lookups }).state;
  return state;
}
