import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Actual attack triggers: X02 Lv2 + M02 mill, or M04 direct exclusion with X02 Lv1. */
export function buildDeckExclusionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const direct = params?.get("mode") === "direct";
  const lookup = (id: string) => cards.find((card) => card.cardNo === id)!;
  const getDef = (id: string) => cards.find((card) => card.cardNo === id);
  const replacementPayment = params?.get("mode") === "replacement-payment";
  if (params?.get("mode") === "replacement" || replacementPayment) {
    const make = (
      no: string,
      id: string,
      zone: "set_aside" | "hand" | "field" | "in_use"
    ) =>
      createCardInstance(lookup(no), {
        instanceId: id,
        ownerPlayerId: owner,
        zone,
        ...(zone === "field"
          ? { normalCoreCount: replacementPayment ? 3 : 1 }
          : {}),
      });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          make("BSAZ01-C03", "exclude-source", "in_use"),
          make(
            replacementPayment ? "BSTH08.5-X04" : "BSTH08.5-M11",
            "mask-1",
            "set_aside"
          ),
          make(
            replacementPayment ? "BSTH08.5-X04" : "BSTH08.5-M11",
            "mask-2",
            "set_aside"
          ),
          make("BSTH01-C01", "ordinary-1", "hand"),
          make("BSTH01-C01", "ordinary-2", "hand"),
          make("BSTH01-C01", "attacker", "field"),
        ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          handCount: id === owner ? 2 : 0,
          deckCount: 0,
          ...(replacementPayment && id === owner
            ? { reserveNormalCoreCount: 0, reserveSoulCoreCount: 0 }
            : {}),
        })),
      }),
      activePlayerId: owner,
      turnNumber: 4,
      step: "attack",
      window: "declare_attack",
      activeAttack: {
        attackId: "exclusion-replacement",
        primaryEntityId: "attacker-be",
        participantEntityIds: ["attacker-be"],
        groupMode: "single",
        target: { kind: "player", playerId: opponent },
        blockAssignments: [
          { participantEntityId: "attacker-be", blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: ["attacker-be"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "attacker-be",
          memberInstanceIds: ["attacker"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
    // Actual C03 payload, paused at its first mask replacement input.
    return executeEffect({
      state: recomputeAndRebuildContinuousEffects(initial, getDef),
      effect: lookup("BSAZ01-C03").effects![1]!,
      effectIndex: 1,
      chainId: "scenario:exclusion-replacement",
      sourceInstanceId: "exclude-source",
      actingPlayerId: owner,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["mask-1", "mask-2", "ordinary-1", "ordinary-2"],
      targetStepId: "exclude-cards",
      targetSelectionResolved: true,
    });
  }
  const instances = [
    createCardInstance(lookup("BSTH05.5-X02"), {
      instanceId: "iku",
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: direct ? 0 : 5,
    }),
    createCardInstance(lookup(direct ? "BSTH05.5-M04" : "BSTH05.5-M02"), {
      instanceId: "attacker",
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: direct ? 1 : 3,
    }),
    ...Array.from({ length: 8 }, (_, index) =>
      createCardInstance(lookup("BSTH01-C01"), {
        instanceId: `deck-${index + 1}`,
        ownerPlayerId: opponent,
        zone: "deck",
      })
    ),
  ];
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: instances,
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: 0,
        deckCount: id === opponent ? 8 : 0,
        reserveNormalCoreCount: 4,
        reserveSoulCoreCount: 0,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 4,
    step: "attack",
    window: "none",
  };
  // Both the REST seed and App's scenario initializer must see the same field
  // continuous effects. Directly placed cards have not gone through summoning.
  return recomputeAndRebuildContinuousEffects(state, (id) =>
    cards.find((card) => card.cardNo === id)
  );
}
