import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";

/** Actual card effects: deck discard self-placement followed by optional magic placement. */
export function buildFieldCardStateScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const layout = params?.get("layout") === "1";
  const flash = params?.get("flash") === "1";
  const definitions = new Map(allCards.map((c) => [c.cardNo, c]));
  const cards: CardInstance[] = [];
  const add = (
    cardNo: string,
    id: string,
    player: string,
    zone: CardInstance["zone"],
    normalCoreCount = 0
  ) => {
    const definition = definitions.get(cardNo);
    if (!definition)
      throw new Error(`Missing field-card scenario definition: ${cardNo}`);
    cards.push(
      createCardInstance(definition, {
        instanceId: id,
        ownerPlayerId: player,
        zone,
        normalCoreCount,
      })
    );
  };
  add("BSAZ03-C01", "field-card-source", owner, "hand");
  add("BSAZ01-C04", "field-card-deck-operation", owner, "deck");
  if (flash) {
    add("BSAZ01-C01", "field-card-attacker", owner, "field", 1);
    add("BSAZ01-C10", "field-card-operation-front", owner, "field");
    add("BSAZ01-C10", "field-card-operation-back", owner, "field");
  }
  for (const player of ["alice", "bob"]) {
    for (let i = 0; i < 6; i++)
      add("BSTH01-C01", `${player}-deck-${i}`, player, "deck");
    if (!layout) continue;
    for (let i = 0; i < 12; i++)
      add("BSTH01-C01", `${player}-spirit-${i}`, player, "field", 1);
    for (let i = 0; i < 4; i++)
      add("BSAZ01-C17", `${player}-nexus-${i}`, player, "field");
    for (let i = 0; i < 5; i++)
      add("BSAZ01-C10", `${player}-field-magic-${i}`, player, "field");
    if (params?.get("noSetAside") !== "1") {
      for (let i = 0; i < 3; i++)
        add("BSTH01-C01", `${player}-set-aside-${i}`, player, "set_aside");
    }
  }
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: cards.filter(
          (c) => c.ownerPlayerId === id && c.zone === "hand"
        ).length,
        deckCount: cards.filter(
          (c) => c.ownerPlayerId === id && c.zone === "deck"
        ).length,
        reserveNormalCoreCount: 30,
        lifeNormalCoreCount: 6,
      })),
    }),
    activePlayerId: owner,
    step: flash ? "attack" : "main",
    turnNumber: 3,
    ...(flash
      ? {
          window: "flash_before_block" as const,
          activeAttack: {
            attackId: "field-card-attack",
            primaryEntityId: "field-card-entity",
            participantEntityIds: ["field-card-entity"],
            groupMode: "single" as const,
            target: {
              kind: "player" as const,
              playerId: owner === "alice" ? "bob" : "alice",
            },
            blockAssignments: [],
            symbolResolutionOrder: ["field-card-entity"],
            flashBeforeBlockCompleted: false,
            flashAfterBlockCompleted: false,
            flashWindowState: {
              kind: "before_block" as const,
              priorityPlayerId: owner,
              consecutivePassCount: 0,
              stackResponseSourcePlayerId: owner,
              pendingStackAction: null,
            },
          },
          battleEntities: [
            {
              entityId: "field-card-entity",
              memberInstanceIds: ["field-card-attacker"],
              resolvedBp: 3000,
              resolvedSymbols: ["yellow" as const],
              attackState: "attacking" as const,
            },
          ],
        }
      : {}),
  };
}
