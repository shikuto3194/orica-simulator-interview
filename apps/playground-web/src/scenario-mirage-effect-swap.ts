import {
  applyLegalAction,
  createCardInstance,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { replaceCardInstances } from "../../../packages/rules-core/src/zone/card-instance-state";
import { buildMirageIndividualSwapScenario } from "./scenario-mirage-individual-swap";

/** 実カードの効果解決を進め、追加/個別交換の入力直前からGUI+RESTを検証する。 */
export function buildMirageEffectSwapScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const mode = params?.get("effect") ?? "self";
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const settings = new URLSearchParams({
    owner,
    multiple: "1",
    incoming: "exempt",
  });
  let state: GameState = buildMirageIndividualSwapScenario(allCards, settings);
  const getCardDefinitionById = (id: string) =>
    allCards.find((card) => card.cardNo === id);
  const incomingNo =
    mode === "self"
      ? "BSTH002-C01"
      : mode === "paid"
        ? "BSES01-R02"
        : "BSGE01-C02";
  const sourceNo =
    mode === "self"
      ? "BSTH002-X01"
      : mode === "paid"
        ? "BSTH002-C02"
        : "BSGE01-M04";
  const source = getCardDefinitionById(sourceNo)!;
  state = replaceCardInstances(state, [
    ...state.cardInstances.filter(
      (card) =>
        card.instanceId !== "payment-source" &&
        card.instanceId !== "mirage-incoming"
    ),
    createCardInstance(getCardDefinitionById(incomingNo)!, {
      instanceId: "mirage-incoming",
      ownerPlayerId: owner,
      zone: mode === "self" ? "hand" : "deck",
    }),
    createCardInstance(source, {
      instanceId: "effect-source",
      ownerPlayerId: owner,
      zone: mode === "free" ? "burst" : "field",
      normalCoreCount: mode === "free" ? 0 : 2,
      exhaustState: "exhausted",
    }),
    ...(mode === "free"
      ? [
          createCardInstance(getCardDefinitionById("BSTH002-C02")!, {
            instanceId: "effect-enemy",
            ownerPlayerId: owner === "alice" ? "bob" : "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ]
      : []),
  ]);
  // deck_revealの先頭を固定する。相手のデッキ順は参照しない。
  state = replaceCardInstances(state, [
    state.cardInstances.find((card) => card.instanceId === "mirage-incoming")!,
    ...state.cardInstances.filter(
      (card) => card.instanceId !== "mirage-incoming"
    ),
  ]);
  state = {
    ...state,
    mirageSetPlayerIdsThisTurn: [owner],
    players: state.players.map((player) => ({
      ...player,
      handCount: player.id === owner && mode === "self" ? 1 : 0,
      deckCount: player.id === owner && mode !== "self" ? 4 : 3,
    })),
  };
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => undefined,
  };
  if (mode === "self") {
    return executeEffect({
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "effect-source",
      actingPlayerId: owner,
      chainId: "scenario:mirage-effect-self",
      targetInstanceIds: ["mirage-incoming"],
      targetGroups: [
        {
          targetStepId: "selectMirage",
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateTargetInstanceIds: ["mirage-incoming"],
          candidateTargetZones: ["hand"],
        },
        {
          targetStepId: "rika-ex-bottom-deck-targets",
          requiredTargetCount: 0,
          maxTargetCount: 2,
          candidateTargetInstanceIds: [],
          candidateTargetZones: ["field"],
        },
      ],
      ...lookups,
    });
  }
  state = executeEffect({
    state,
    sourceInstanceId: "effect-source",
    actingPlayerId: owner,
    chainId: `scenario:mirage-effect-${mode}`,
    effect:
      mode === "free"
        ? source.effects![2]!
        : {
            timing: { kind: "continuous" },
            textRef: [],
            steps: [
              {
                action: {
                  kind: "deck_reveal",
                  revealCount: 1,
                  picks: [],
                  remainder: "bottom",
                },
              },
            ],
          },
    ...(mode === "free" ? { targetInstanceIds: ["effect-enemy"] } : {}),
    ...lookups,
  });
  for (let i = 0; i < 12 && !state.pendingStepChoice; i++) {
    const actions = getLegalActions({
      state,
      actingPlayerId: owner,
      ...lookups,
    });
    const pick = actions.find(
      (action) => action.kind === "resolve_pending_deck_reveal_pick"
    );
    if (pick?.kind === "resolve_pending_deck_reveal_pick") {
      const selected = pick.candidateCardInstanceIds.includes("mirage-incoming")
        ? ["mirage-incoming"]
        : [];
      state = applyLegalAction({
        state,
        action: pick,
        selectedDeckRevealCardIds: selected,
        ...(mode === "paid"
          ? {
              deckRevealMiragePaymentSourcesByInstanceId: {
                "mirage-incoming": [{ kind: "reserve" as const, amount: 1 }],
              },
            }
          : {}),
        ...lookups,
      }).state;
      continue;
    }
    const order = actions.find(
      (action) => action.kind === "resolve_pending_deck_reveal_order"
    );
    if (order?.kind !== "resolve_pending_deck_reveal_order")
      throw new Error(`Mirage effect scenario cannot advance: ${mode}`);
    state = applyLegalAction({
      state,
      action: order,
      deckRevealRemainderOrder: order.remainingCardInstanceIds,
      ...lookups,
    }).state;
  }
  if (!state.pendingStepChoice)
    throw new Error(`Mirage effect scenario has no individual choice: ${mode}`);
  return state;
}
