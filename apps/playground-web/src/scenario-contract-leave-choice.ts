import {
  createCardInstance,
  createEmptyGameState,
  queuePendingLeave,
  finalizeEffectResolution,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** 実際の破壊待機から契約カード/合体ブレイヴの選択を開く。owner=bob でREST側を検証。 */
export function buildContractLeaveChoiceScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getCardDefinitionById = (id: string) =>
    allCards.find((card) => card.cardNo === id);
  const hostDef = getCardDefinitionById("BSGE01-CX01")!;
  const braveDef = getCardDefinitionById("BSGE01-TX01(A)")!;
  const host = createCardInstance(hostDef, {
    instanceId: "contract-leave-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 2,
    exhaustState: "heavily_exhausted",
    attachedChildrenIds: ["contract-leave-brave"],
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "contract-leave-brave",
    ownerPlayerId: owner,
    zone: "field",
    attachedToInstanceId: host.instanceId,
  });
  const beforeState: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 6,
        ...(id === owner ? { contractCardNo: hostDef.cardNo } : {}),
      })),
    }),
    turnNumber: 3,
    activePlayerId: owner,
    step: "main",
    window: "none",
  };
  const chainId = "scenario-contract-leave";
  return finalizeEffectResolution({
    beforeState,
    state: queuePendingLeave({
      state: beforeState,
      instanceId: host.instanceId,
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
