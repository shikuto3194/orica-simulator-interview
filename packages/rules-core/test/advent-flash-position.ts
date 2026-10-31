import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance } from "../src/factories";
import type { GameState } from "../src/model";

/** 実在する攻撃スピリットと前半フラッシュ窓を持つ煌臨監査用盤面。 */
export function adventFlashPosition(
  state: GameState,
  activePlayerId = "alice"
): GameState {
  const attacker = createCardInstance(
    ALL_CARDS.find((c) => c.cardNo === "BSDB01-C05")!,
    {
      instanceId: "audit-attacker",
      ownerPlayerId: activePlayerId,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    }
  );
  return {
    ...state,
    step: "attack",
    window: "flash_before_block",
    activePlayerId,
    cardInstances: [
      ...state.cardInstances.filter(
        (c) => c.instanceId !== attacker.instanceId
      ),
      attacker,
    ],
    battleEntities: [
      {
        entityId: "audit-entity",
        memberInstanceIds: [attacker.instanceId],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "audit-attack",
      primaryEntityId: "audit-entity",
      participantEntityIds: ["audit-entity"],
      groupMode: "single",
      target: {
        kind: "player",
        playerId: activePlayerId === "alice" ? "bob" : "alice",
      },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: activePlayerId,
        pendingStackAction: null,
      },
    },
  };
}
