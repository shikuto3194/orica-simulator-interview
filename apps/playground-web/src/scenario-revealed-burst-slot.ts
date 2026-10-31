import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** M01 competes for one burst slot; C21 additionally requires its owner's effect. */
export function buildRevealedBurstSlotScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const openerPlayer =
    params?.get("foreign") === "1"
      ? owner === "alice"
        ? "bob"
        : "alice"
      : owner;
  const source = allCards.find(
    (card) =>
      card.colors.includes("yellow") &&
      (card.tribe?.includes("勇傑") || card.tribe?.includes("妖戒"))
  );
  const byNo = new Map(allCards.map((card) => [card.cardNo, card]));
  const boundary = params?.get("boundary") === "1";
  if (!source || !byNo.has("BSTH09-M01") || !byNo.has("BSTH01-C21"))
    throw new Error("Missing revealed burst slot fixture cards");
  const state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: 0,
        deckCount: id === owner ? 3 : 0,
      })),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "reveal-source",
          ownerPlayerId: openerPlayer,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...(boundary
          ? [
              createCardInstance(byNo.get("BSTH09-C03")!, {
                instanceId: "reveal-cause-victim",
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
        ...[
          byNo.get("BSTH09-M01")!,
          byNo.get("BSTH09-M01")!,
          byNo.get("BSTH01-C21")!,
        ].map((card, index) =>
          createCardInstance(card, {
            instanceId: `reveal-${index}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
    }),
    activePlayerId: openerPlayer,
    turnNumber: 3,
    step: "main" as const,
  };
  return executeEffect({
    state,
    chainId: "scenario:revealed-burst-slot",
    sourceInstanceId: "reveal-source",
    actingPlayerId: openerPlayer,
    getCardDefinitionById: (id) => byNo.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 3,
            player: owner === openerPlayer ? "self" : "opponent",
            picks: [],
            remainder: "bottom",
            ...(boundary
              ? {
                  beforePickSteps: [
                    {
                      action: {
                        kind: "core_move" as const,
                        from: {
                          kind: "field_card" as const,
                          player:
                            owner === openerPlayer
                              ? ("self" as const)
                              : ("opponent" as const),
                          filter: {
                            cardName: { exact: byNo.get("BSTH09-C03")!.name },
                          },
                        },
                        to: { kind: "void" as const, player: "self" as const },
                        amount: 1,
                      },
                    },
                  ],
                }
              : {}),
          },
        },
      ],
    },
  });
}
