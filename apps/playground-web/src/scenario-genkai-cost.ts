import { createCardInstance, createEmptyGameState } from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** 2026-09-25 snapshot: 神ネクサス上のコアは現界の維持コアに使えない。 */
export function buildGenkaiCostScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const sourceNo =
    params?.get("card") === "BSTH10-X05" ? "BSTH10-X05" : "BSTH11-X02";
  const soul = params?.get("soul") === "reserve" ? "reserve" : "trash";
  const normal = params?.get("cores") === "1" ? 1 : 0;
  const make = (
    no: string,
    id: string,
    player: string,
    zone: "hand" | "field",
    cores: number
  ) =>
    createCardInstance(cards.find((card) => card.cardNo === no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make(sourceNo, "genkai-source", owner, "hand", 0),
      make(
        sourceNo === "BSTH11-X02" ? "BSTH11-X01" : "BSTH10-X01",
        "genkai-nexus",
        owner,
        "field",
        3
      ),
      {
        ...make("BSGE01-CX01", "genkai-attacker", opponent, "field", 1),
        exhaustState: "exhausted",
      },
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: id === owner ? 1 : 0,
      deckCount: 0,
      reserveNormalCoreCount: id === owner ? normal : 0,
      reserveSoulCoreCount: id === owner && soul === "reserve" ? 1 : 0,
      trashSoulCoreCount: id === owner && soul === "reserve" ? 0 : 1,
      soulCoreLocation: { kind: id === owner ? soul : "trash" },
      trashNormalCoreCount: 4,
      lifeNormalCoreCount: 5,
    })),
  });
  return {
    ...base,
    turnNumber: 2,
    step: "attack",
    activePlayerId: opponent,
    window: "flash_before_block",
    battleEntities: [
      {
        entityId: "genkai-attack",
        memberInstanceIds: ["genkai-attacker"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "genkai-battle",
      primaryEntityId: "genkai-attack",
      participantEntityIds: ["genkai-attack"],
      groupMode: "single",
      target: { kind: "player", playerId: owner },
      blockAssignments: [
        { participantEntityId: "genkai-attack", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["genkai-attack"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
      },
    },
  };
}
