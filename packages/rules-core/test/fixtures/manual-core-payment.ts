import { ALL_CARDS } from "../../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  type GameState,
} from "../../src";

export const paymentCardDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);

/** 添付盤面のR03召喚前を再構成。現界用のソウルはリザーブ、通常コアは場にある。 */
export function manualPaymentBoard(
  owner = "bob",
  zone: "hand" | "set_aside" = "hand"
): GameState {
  const opponent = owner === "alice" ? "bob" : "alice";
  const card = (no: string, id: string, cores: number) =>
    createCardInstance(paymentCardDefinition(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: cores,
    });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 0,
        reserveSoulCoreCount: id === owner ? 1 : 0,
        soulCoreLocation: id === owner ? { kind: "reserve" as const } : null,
        handCount: id === owner && zone === "hand" ? 1 : 0,
      })),
      cardInstances: [
        card("BSTH11-R01", "donor", 4),
        card("BSTH11-C02", "symbol", 1),
        card("BSTH11-X01", "grandwalker", 5),
        createCardInstance(paymentCardDefinition("BSTH11-R03")!, {
          instanceId: "aun",
          ownerPlayerId: owner,
          zone,
        }),
      ],
      battleEntities: [
        {
          entityId: "attacker",
          memberInstanceIds: ["donor"],
          resolvedBp: 6000,
          resolvedSymbols: ["green"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "manual-payment-attack",
        primaryEntityId: "attacker",
        participantEntityIds: ["attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: opponent },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: owner,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: owner,
          pendingStackAction: null,
        },
      },
    }),
    step: "attack",
    window: "flash_before_block",
    activePlayerId: owner,
    turnNumber: 3,
  };
}
