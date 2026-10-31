import {
  createCardInstance,
  createEmptyGameState,
  playSummonAsAction,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** 2026-10-02: 手札からin_useを経由する通常召喚と界放の回帰盤面。 */
export function buildFairyUseOriginScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const cost = params?.get("mode") === "cost";
  const lookup = (id: string) => cards.find((c) => c.cardNo === id);
  const make = (
    no: string,
    id: string,
    zone: "hand" | "field" | "deck",
    cores = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const ids = ["fairy-0", "fairy-1", "fairy-2"];
  const base: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make("BSTH07.8-XX01", "lily", "field", 5),
        make(cost ? "BSTH07.8-X01" : "BSTH07.8-C01", "source", "hand"),
        ...Array.from({ length: 5 }, (_, i) =>
          make("BSTH07.8-C01", `draw-${i}`, "deck")
        ),
        ...(cost
          ? ids.map((id) => ({
              ...make("BSTH07.8-C01", id, "field", 1),
              exhaustState: "exhausted" as const,
            }))
          : []),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 1 : 0,
        deckCount: id === owner ? 5 : 0,
        reserveNormalCoreCount: id === owner && !cost ? 2 : 0,
        reserveSoulCoreCount: 0,
        trashSoulCoreCount: 1,
        soulCoreLocation: { kind: "trash" },
      })),
    }),
    activePlayerId: owner,
    step: "main",
    turnNumber: 3,
  };
  if (!cost)
    return playSummonAsAction({
      state: base,
      actingPlayerId: owner,
      cardInstanceId: "source",
      paymentSources: [{ kind: "reserve", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredBurstActions: buildBurstEffectLookup(cards),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    }).state;
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    battleEntities: ids.map((id) => ({
      entityId: `be-${id}`,
      memberInstanceIds: [id],
      resolvedBp: 1000,
      resolvedSymbols: ["green"],
      attackState: "attacking",
    })),
    activeAttack: {
      attackId: "fairy-battle",
      primaryEntityId: "be-fairy-0",
      participantEntityIds: ids.map((id) => `be-${id}`),
      groupMode: "simultaneous",
      target: { kind: "player", playerId: opponent },
      blockAssignments: ids.map((id) => ({
        participantEntityId: `be-${id}`,
        blockedByEntityIds: [],
      })),
      symbolResolutionOrder: ids.map((id) => `be-${id}`),
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
      blockerCapacity: "participant_count",
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
