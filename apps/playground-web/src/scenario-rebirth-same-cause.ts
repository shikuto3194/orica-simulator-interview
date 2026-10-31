import {
  createEmptyGameState,
  createCardInstance,
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  getLegalActions,
  applyLegalAction,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 同じ召喚でX01/X04が誘発。X04のコア配置を確定するとX01だけが候補から消える。 */
export function buildRebirthSameCauseScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const attackCause = params?.get("cause") === "attack";
  const kiritoCancel = params?.get("cause") === "kirito-cancel";
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const defs = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    defs.find((d) => d.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          ...(kiritoCancel ? { handCount: 0, deckCount: 2 } : {}),
        },
        {
          reserveNormalCoreCount: 5,
          ...(kiritoCancel ? { handCount: 0, deckCount: 2 } : {}),
        },
      ],
      cardInstances: (attackCause
        ? [
            ["BSTH07-転醒X01(A)", "same-attacker", 3],
            ["BSTH03-転醒R01(A)", "same-exhaust", 0],
            ["BSTH06-転醒R01(A)", "same-attack", 0],
          ]
        : kiritoCancel
          ? [
              ["BSSA01-転醒X01(A)", "same-x01", 0],
              ["BSSA01-C03", "same-host", 1],
            ]
          : [
              ["BSSA01-転醒X01(A)", "same-x01", 0],
              ["BSSA01-転醒X04(A)", "same-x04", 0],
              ["BSSA01-X02", "same-host", 2],
            ]
      ).map(([no, id, cores]) =>
        createCardInstance(getCardDefinitionById(String(no))!, {
          instanceId: String(id),
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: Number(cores),
        })
      ),
    }),
    step: attackCause ? "attack" : "main",
    turnNumber: 3,
    activePlayerId: owner,
  };
  if (kiritoCancel) {
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        ...["cancel-deck1", "cancel-deck2"].map((instanceId) =>
          createCardInstance(getCardDefinitionById("BSSA01-C01")!, {
            instanceId,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
    };
  }
  if (attackCause) {
    for (let i = 0; i < 4; i++) {
      const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      );
      const action = actions.find(
        (a) =>
          (a.kind === "attack" && a.sourceInstanceId === "same-attacker") ||
          a.kind === "pass_pre_declaration_stack"
      );
      if (!action) throw new Error("アタック宣言を進められません");
      state = applyLegalAction({ state, action, ...lookups }).state;
      if (state.activeAttack && !state.preDeclarationStackWindow) {
        return { ...state, pendingBurstChecks: [] };
      }
    }
    throw new Error("アタックの同時誘発まで到達しませんでした");
  }
  state = queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "same-summon",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "same-host",
        amount: null,
      },
    ],
    "same-cause",
    lookups
  );
  state = { ...state, pendingBurstChecks: [] };
  for (let i = 0; i < 10 && !state.pendingCoreDistribution; i++) {
    const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const action = actions.find(
      (a) =>
        (a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === (kiritoCancel ? "same-x01" : "same-x04")) ||
        a.kind === "pass_stack" ||
        (a.kind === "resolve_brave_combine_choice" &&
          a.chosenHostInstanceId === null)
    );
    if (!action) throw new Error("同時転醒シナリオの選択が見つかりません");
    state = applyLegalAction({ state, action, ...lookups }).state;
  }
  if (!state.pendingCoreDistribution)
    throw new Error("転醒コア配置まで到達しませんでした");
  return state;
}
