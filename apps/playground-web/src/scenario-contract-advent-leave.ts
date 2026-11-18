import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeAdvent,
  finalizeEffectResolution,
  queuePendingLeave,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-15 の報告: 煌臨中のリムルを破壊し、契約リムルの魂状態を選ぶ。 */
export function buildContractAdventLeaveScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getCardDefinitionById = (id: string) =>
    allCards.find((definition) => definition.cardNo === id);
  const top = getCardDefinitionById("BSTS01-C01")!;
  const contract = getCardDefinitionById("BSTS01-CX01")!;
  const initial: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(top, {
          instanceId: "rimuru-top",
          ownerPlayerId: owner,
          zone: "hand",
        }),
        createCardInstance(contract, {
          instanceId: "rimuru-contract",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 1 : 0,
        deckCount: 0,
        reserveNormalCoreCount: 4,
        ...(id === owner
          ? {
              contractCardNo: contract.cardNo,
              soulCoreLocation: { kind: "reserve" as const },
            }
          : {}),
      })),
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
  const beforeState = executeAdvent(
    initial,
    owner,
    {
      adventCardInstanceId: "rimuru-top",
      targetInstanceId: "rimuru-contract",
      adventData: top.adventData!,
      isContractAdvent: true,
    },
    getCardDefinitionById
  );
  const chainId = "scenario-rimuru-destroy";
  return finalizeEffectResolution({
    beforeState,
    state: queuePendingLeave({
      state: beforeState,
      instanceId: "rimuru-top",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: opponent,
      chainId,
    }),
    actingPlayerId: opponent,
    chainId,
    endLogs: [],
    causedBySourceInstanceId: null,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredBurstActions: buildBurstEffectLookup(allCards),
  });
}
