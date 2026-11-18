import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-27 snapshot: ワジの抑止・デッキ下戻しの両対象が不在。 */
export function buildEmptyTargetSelectionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getCardDefinitionById = (id: string) =>
    cards.find((card) => card.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(cards),
    getRegisteredFieldCardEffectActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(getCardDefinitionById("BSLH01-X08")!, {
          instanceId: "empty-target-source",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
        ...(params?.get("target") === "present" ||
        params?.get("target") === "departed"
          ? [
              createCardInstance(getCardDefinitionById("BSTH01-C01")!, {
                instanceId: "empty-target-opponent",
                ownerPlayerId: opponent,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "attack",
    window: "none",
  };
  for (let i = 0; i < 10; i++) {
    if (state.pendingEffectTargetSelection) {
      // 保存された選択待ちに、既に離脱した候補が残るケースも再現する。
      if (params?.get("target") === "departed") {
        return {
          ...state,
          cardInstances: state.cardInstances.map((card) =>
            card.instanceId === "empty-target-opponent"
              ? { ...card, zone: "trash" as const }
              : card
          ),
        };
      }
      return state;
    }
    const actions = [owner, opponent].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const action = actions.find((candidate) =>
      [
        "attack",
        "pass_pre_declaration_stack",
        "resolve_battle_immediate_effect",
        "pass_stack",
      ].includes(candidate.kind)
    );
    if (!action)
      throw new Error(
        `Empty target scenario stalled: ${actions.map((a) => a.kind)}`
      );
    state = applyLegalAction({ state, action, ...lookups }).state;
  }
  throw new Error("Empty target scenario did not reach target selection");
}
