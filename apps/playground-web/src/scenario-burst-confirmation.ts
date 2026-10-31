import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** アリスのドロー後のソウエイと、発動禁止・発動中耐性・常時無効の対照盤面。 */
export function buildBurstConfirmationScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const definitions = new Map(
    expandCardDefinitionsWithBackFaces(cards).map((card) => [card.cardNo, card])
  );
  const getDefinition = (id: string) => definitions.get(id);
  const mode = params?.get("mode") ?? "nullify";
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const burstNo =
    mode === "immune"
      ? "BSTH01-X07"
      : ["bypass", "nullify-bypass", "continuous"].includes(mode)
        ? "BSTH01-M13"
        : "BSTS01-R02";
  const sourceNo =
    mode === "continuous"
      ? "BSTH09.2-転醒R03(B)"
      : mode === "bypass" || mode === "cannot"
        ? "BSTH07-転醒X01(A)"
        : "BSTH02-M02";
  const source = getDefinition(sourceNo)!;
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 8,
      cardInstances: [
        createCardInstance(source, {
          instanceId: "suppressor",
          ownerPlayerId: opponent,
          zone: "field",
          cores: 4,
        }),
        createCardInstance(getDefinition(burstNo)!, {
          instanceId: "burst",
          ownerPlayerId: owner,
          zone: "burst",
          faceDown: true,
        }),
        ...["alice", "bob"].flatMap((player) =>
          Array.from({ length: 8 }, (_, i) =>
            createCardInstance(getDefinition("BSRK01-C01")!, {
              instanceId: `${player}-deck-${i}`,
              ownerPlayerId: player,
              zone: "deck",
            })
          )
        ),
      ],
      setBurstStates: [{ playerId: owner, cardInstanceId: "burst" }],
    }),
    activePlayerId: opponent,
    turnNumber: 2,
    step: mode === "continuous" ? "attack" : "main",
    window: "none",
  };
  state.players = state.players.map((player) => ({ ...player, countValue: 2 }));
  if (mode === "continuous") {
    state = recomputeAndRebuildContinuousEffects(state, getDefinition);
  } else if (mode !== "normal") {
    // 先行効果の解決済み状態。アリスは提供snapshotと同じstep限定CE、ぬえはターン限定CE。
    const cannot = mode === "bypass" || mode === "cannot";
    state.activeContinuousEffects = [
      {
        effectId: "resolved-burst-suppressor",
        sourceInstanceId: "suppressor",
        sourceDefinitionId: sourceNo,
        actingPlayerId: opponent,
        duration: { scope: cannot ? "turn" : "step" },
        createdAtTurn: 2,
        createdAtAttackId: null,
        modifierTag: "negate_opponent_burst",
        metadata: { burstSuppressKind: cannot ? "cannot_activate" : "nullify" },
        provenance: { effectIndex: 0, stepIndex: cannot ? 2 : 4 },
      },
    ];
    if (mode === "forbidden") {
      state.activeContinuousEffects.push({
        effectId: "activation-forbidden",
        sourceInstanceId: "suppressor",
        sourceDefinitionId: sourceNo,
        actingPlayerId: opponent,
        duration: { scope: "step" },
        createdAtTurn: 2,
        createdAtAttackId: null,
        modifierTag: "cannot_activate_opponent_burst",
        targetInstanceId: owner,
      });
    }
  }
  const lifeBurst = burstNo !== "BSTS01-R02";
  return {
    ...state,
    pendingBurstChecks: [
      {
        checkId: "confirmation-burst",
        actingPlayerId: owner,
        eventKind: lifeBurst ? "reduce_life" : "hand_increase",
        event: lifeBurst
          ? { family: "life", validationMode: "snapshot_only" }
          : {
              family: "hand_increase",
              validationMode: "snapshot_only",
              cause: "self_effect",
            },
        source: "action_resolution",
        chainId: "scenario:scenario-burst-confirmation.ts:107",
        attackId: null,
        relatedPlayerId: lifeBurst ? owner : opponent,
        relatedInstanceId: "suppressor",
        amount: lifeBurst ? 1 : 3,
        step: state.step,
        window: "none",
        resolvedBurstCardInstanceIds: [],
        activationSelected: false,
      },
    ],
  };
}
