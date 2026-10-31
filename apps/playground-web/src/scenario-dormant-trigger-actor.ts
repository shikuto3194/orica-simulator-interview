import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** seed1498498078: 同BP破壊でヴァルドの休眠観測と切歌の残置反応が並ぶ。 */
export function buildDormantTriggerActorScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const turnPlayer = owner === "alice" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    definitions.find((d) => d.cardNo === id);
  const deps = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map(() => ({
        reserveNormalCoreCount: 5,
        voidNormalCoreCount: 20,
      })),
      cardInstances: [
        createCardInstance(getCardDefinitionById("BSLH01-TR04(A)")!, {
          instanceId: "dormant-vald",
          ownerPlayerId: turnPlayer,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(getCardDefinitionById("BSSG01-C03")!, {
          instanceId: "active-kirika",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    activePlayerId: turnPlayer,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
  state = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        eventKind: "summon",
        actingPlayerId: turnPlayer,
        source: "action_resolution",
        chainId: "dormant-trigger-summon",
        attackId: null,
        relatedPlayerId: turnPlayer,
        relatedInstanceId: "dormant-vald",
        amount: null,
      },
    ],
    undefined,
    deps
  );
  // 本文を改変せず召喚時BP比較まで進め、派生した残置反応の操作から開始する。
  for (let n = 0; n < 12; n++) {
    if (state.pendingTriggeredEffects.some((p) => p.eventKind === "destroy"))
      return state;
    const actions = [turnPlayer, owner].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...deps }).filter((a) => a.can)
    );
    const action = actions.find(
      (a) =>
        (a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "dormant-vald") ||
        a.kind === "pass_stack" ||
        a.kind === "resolve_pending_effect_target" ||
        a.kind === "resolve_pending_step_optional_target_selection" ||
        (a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute")
    );
    if (!action)
      throw new Error(
        "Dormant-trigger scenario could not reach BP comparison: " +
          actions.map((a) => a.kind).join(",")
      );
    state = applyLegalAction({
      state,
      action,
      ...deps,
      ...("candidateTargetInstanceIds" in action &&
      action.candidateTargetInstanceIds?.includes("active-kirika")
        ? { targetInstanceIds: ["active-kirika"] }
        : {}),
    }).state;
  }
  throw new Error("Dormant-trigger scenario did not produce leave reactions");
}
