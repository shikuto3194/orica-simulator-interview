import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingLeave,
  flushPendingLeaves,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 報告されたC16と、カード名ボタンが残っていた対象選択の再現。 */
export function buildChoiceContractScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const mode = params?.get("mode") ?? "mars";
  const getDefinition = (id: string) =>
    cards.find((card) => card.cardNo === id);
  const source = getDefinition(
    mode === "tensho"
      ? "BSTH004-X03"
      : mode === "advent"
        ? "BSSL01-C02"
        : "BSAZ02-C16"
  )!;
  const target = getDefinition(
    mode === "tensho"
      ? "BSTH004-X03"
      : mode === "advent"
        ? "BSSL01-C01"
        : "BSAZ02-M03"
  )!;
  const lookups = {
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: () => [],
  };
  const instance = (
    definition: CardDefinition,
    instanceId: string,
    zone: "hand" | "field" | "trash" | "set_aside",
    cores = 0
  ) =>
    createCardInstance(definition, {
      instanceId,
      ownerPlayerId: owner,
      zone,
      cores,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 20 },
        { reserveNormalCoreCount: 20 },
      ],
      cardInstances:
        mode === "mars"
          ? [
              instance(source, "choice-source", "trash"),
              instance(source, "choice-copy", "trash"),
              instance(target, "choice-hand-a", "hand"),
              instance(target, "choice-hand-b", "hand"),
              instance(target, "choice-aside", "set_aside"),
            ]
          : [
              instance(
                source,
                "choice-source",
                mode === "tensho" ? "hand" : "field",
                mode === "tensho" ? 0 : 1
              ),
              instance(target, "choice-host-a", "field", 3),
              instance(target, "choice-host-b", "field", 3),
            ],
    }),
    activePlayerId: owner,
    step: mode === "mars" ? "end" : "main",
    turnNumber: 3,
  };
  if (mode === "advent") {
    return flushPendingLeaves(
      queuePendingLeave({
        state: rebuildContinuousEffectsFromField(state, getDefinition),
        instanceId: "choice-source",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: owner === "alice" ? "bob" : "alice",
        chainId: "scenario:choice-contract",
      }),
      getDefinition
    );
  }
  if (mode === "tensho") {
    const summon = getLegalActions({
      state,
      actingPlayerId: owner,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "summon" && action.sourceInstanceId === "choice-source"
    );
    if (!summon || summon.kind !== "summon")
      throw new Error("転召の召喚候補がありません");
    state = applyLegalAction({
      state,
      action: summon,
      paymentSources: [{ kind: "reserve", amount: summon.finalCost }],
      ...lookups,
    }).state;
    for (let i = 0; i < 5 && !state.pendingTenshoSummon; i++) {
      const pass = ["alice", "bob"]
        .flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...lookups })
        )
        .find((action) => action.kind === "pass_stack");
      if (!pass) throw new Error("転召前のスタック窓を閉じられません");
      state = applyLegalAction({ state, action: pass, ...lookups }).state;
    }
    return state;
  }
  return executeEffect({
    state,
    effect: source.effects![0]!,
    sourceInstanceId: "choice-source",
    actingPlayerId: owner,
    chainId: "scenario:choice-contract",
    ...lookups,
  });
}
