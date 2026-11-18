import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildStarKingPaymentScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const getDef = (id: string) => allCards.find((card) => card.cardNo === id);
  const star = getDef("BSFT01-X01")!;
  const lucy = getDef("BSFT01-CX01")!;
  const key = getDef("BSFT01-TR01(A)")!;
  const lookups = {
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(allCards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredBurstActions: () => undefined,
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(star, {
          instanceId: "audit-star",
          ownerPlayerId: owner,
          zone: "trash",
        }),
        createCardInstance(lucy, {
          instanceId: "audit-lucy",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
          attachedChildrenIds: ["audit-key"],
        }),
        createCardInstance(key, {
          instanceId: "audit-key",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 2,
          attachedToInstanceId: "audit-lucy",
        }),
      ],
      playerOverrides: ["alice", "bob"].map((id) =>
        id === owner ? { countValue: 5, reserveNormalCoreCount: 3 } : {}
      ),
    }),
    activePlayerId: owner,
    step: "main",
    turnNumber: 3,
  };
  // 解決済みのコスト増加が残る盤面。印字12だけの差引きでは召喚できない。
  state = executeEffect({
    chainId: "scenario:scenario-star-king-payment.ts:61",
    state,
    sourceInstanceId: "audit-lucy",
    actingPlayerId: owner,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["ultimate"] },
            modifier: { additionalCostValue: 20 },
            duration: { scope: "turn" },
          },
        },
      ],
    },
    ...lookups,
  });
  const action = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find(
    (action) =>
      action.kind === "summon" &&
      action.sourceInstanceId === "audit-star" &&
      action.reason === "legal_summon_by_hand_permission"
  );
  if (!action) throw new Error("Star king alternative summon missing");
  return applyLegalAction({ state, action, ...lookups }).state;
}
