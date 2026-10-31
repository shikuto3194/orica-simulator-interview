import {
  applyLegalAction,
  getLegalActions,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 柱斧の転醒待ちと、報告盤面の魂状態/クォーツ/疲労合体を再現する。 */
export function buildRebirthCombinedLayoutScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  cards = expandCardDefinitionsWithBackFaces(cards);
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const lookups = {
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  };
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const make = (no: string, id: string, cores = 0) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make("BSTH09-TR01(A)", "pillar"),
      { ...make("BSTH09-X01", "host", 2), exhaustState: "exhausted" },
      make("BSLH01-CX01", "quartz-host"),
      make("BSLH01-C05", "quartz"),
      make("BSTH09-C01", "neighbor", 1),
      make("BSRK01-C02", "nexus-1"),
      make("BSRK01-C02", "nexus-2"),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      countValue: id === owner ? 7 : 0,
      soulStateInstanceIds: id === owner ? ["quartz-host", "quartz"] : [],
      reserveNormalCoreCount: 3,
    })),
  });
  state.activePlayerId = owner;
  state.step = "main";
  state.quartzSetStates = [
    {
      hostInstanceId: "quartz-host",
      quartzInstanceId: "quartz",
      ownerPlayerId: owner,
      slot: "center",
    },
  ];
  const pending = executeEffect({
    state,
    sourceInstanceId: "pillar",
    actingPlayerId: owner,
    chainId: "scenario:rebirth-combined-layout",
    effect: lookup("BSTH09-TR01(A)")!.effects![0]!,
    effectIndex: 0,
    ...lookups,
  });
  if (params?.get("combined") !== "1") return pending;
  const action = getLegalActions({
    state: pending,
    actingPlayerId: owner,
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_brave_combine_choice" &&
      a.chosenHostInstanceId === "host"
  )!;
  return applyLegalAction({ state: pending, action, ...lookups }).state;
}
