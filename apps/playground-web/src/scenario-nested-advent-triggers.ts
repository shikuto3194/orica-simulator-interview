import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";

/** BSTS01-C01 煌臨→CX01 カウント+1→ドロー誘発。 */
export function buildNestedAdventTriggersScenario(
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
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
  const card = (
    cardNo: string,
    instanceId: string,
    zone: "field" | "hand" | "deck"
  ) =>
    createCardInstance(lookups.getCardDefinitionById(cardNo)!, {
      instanceId,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 1 : 0,
        deckCount: id === owner ? 6 : 0,
        reserveNormalCoreCount: 5,
        soulCoreLocation: { kind: "reserve" },
      })),
      cardInstances: [
        card("BSTS01-CX01", "nested-host", "field"),
        card("BSTS01-C01", "nested-advent", "hand"),
        ...Array.from({ length: 6 }, (_, i) =>
          card("BSTS01-C01", `nested-deck-${i}`, "deck")
        ),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
  };
  const act = (
    player: string,
    predicate: (action: LegalAction) => boolean,
    extra = {}
  ) => {
    const available = getLegalActions({
      state,
      actingPlayerId: player,
      ...lookups,
    });
    const action = available.find(predicate);
    if (!action)
      throw new Error(
        `Nested advent scenario: ${available.map((a) => a.kind).join(",")}`
      );
    state = applyLegalAction({ state, action, ...lookups, ...extra }).state;
  };
  act(owner, (a) => a.kind === "declare_advent", {
    targetInstanceIds: ["nested-host"],
  });
  act(opponent, (a) => a.kind === "pass_stack");
  act(owner, (a) => a.kind === "resolve_pending_effect_target", {
    targetInstanceIds: ["nested-host"],
  });
  if (params?.get("stage") === "advent") return state;
  act(
    owner,
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "nested-host"
  );
  act(opponent, (a) => a.kind === "pass_stack");
  return state;
}
