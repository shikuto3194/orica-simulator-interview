import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-10報告: 見出しのフラッシュ効果と、本文のフラッシュタイミングを区別する。 */
export function buildFlashEffectCategoryScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = new Map(
    allCards.map((definition) => [definition.cardNo, definition])
  );
  const card = (
    no: string,
    id: string,
    zone: "field" | "hand" | "deck",
    cores = 0,
    player = owner
  ) =>
    createCardInstance(definitions.get(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  const soul = params?.get("soul") === "1";
  const host = card(
    params?.get("host") ?? "BSGE01-CX01",
    "category-host",
    "field",
    soul ? 0 : 1
  );
  const under = card("BSGE01-R01", "category-under", "field");
  host.underCards = [
    {
      cardInstanceId: under.instanceId,
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];
  under.attachedToInstanceId = host.instanceId;
  under.zoneRoleName = "bullet-edit";
  const gate = params?.get("gate") ?? "both";
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        host,
        under,
        card("BSGE01-R01", "category-summon", "hand"),
        card("BSGE01-R02", "category-payment", "hand"),
        card("BSGE01-R03", "category-draw", "deck"),
        card("BSGE01-R04", "category-deck", "deck"),
        ...(gate !== "core"
          ? [card("BSSA01-X01", "category-hand-gate", "field", 1, opponent)]
          : []),
        ...(gate !== "hand"
          ? [card("BSTS01-M03", "category-core-gate", "field", 2, opponent)]
          : []),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        handCount: id === owner ? 2 : 0,
        deckCount: id === owner ? 2 : 0,
        soulStateInstanceIds: id === owner && soul ? [host.instanceId] : [],
        reserveNormalCoreCount: 5,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      })),
    }),
    activePlayerId: opponent,
    turnNumber: 4,
    step: "attack",
    window: "flash_before_block",
  };
  const rebuilt = recomputeAndRebuildContinuousEffects(state, (id) =>
    definitions.get(id)
  );
  const attackerId =
    gate === "core" ? "category-core-gate" : "category-hand-gate";
  const attacker = {
    entityId: "category-attacker",
    memberInstanceIds: [attackerId],
    resolvedBp: 10000,
    resolvedSymbols: ["purple" as const],
    attackState: "attacking" as const,
  };
  return {
    ...rebuilt,
    battleEntities: [attacker],
    activeAttack: {
      attackId: "category-attack",
      primaryEntityId: attacker.entityId,
      participantEntityIds: [attacker.entityId],
      groupMode: "single",
      target: { kind: "player", playerId: owner },
      blockAssignments: [
        { participantEntityId: attacker.entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [attacker.entityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
        consecutiveActiveUseCount: 0,
      },
    },
  };
}
