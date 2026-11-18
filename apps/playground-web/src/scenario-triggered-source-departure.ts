import {
  createCardInstance,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { buildRecoveryDegreeScenario } from "./scenario-recovery-degree";

/** X04召喚時の発揮宣言にC01のスタックで応答し、発揮元を手札へ戻す。 */
export function buildTriggeredSourceDepartureScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const state = buildRecoveryDegreeScenario(cards, params);
  state.cardInstances = [
    createCardInstance(cards.find((card) => card.cardNo === "BSTH11-X04")!, {
      instanceId: "departure-source",
      ownerPlayerId: owner,
      zone: "field",
      cores: 1,
    }),
    ...state.cardInstances.filter(
      (card) => card.instanceId === "recovery-attacker"
    ),
    createCardInstance(cards.find((card) => card.cardNo === "BSTH08-C01")!, {
      instanceId: "departure-response",
      ownerPlayerId: opponent,
      zone: "hand",
    }),
  ];
  state.players = state.players.map((player) =>
    player.id === opponent
      ? { ...player, handCount: 1, reserveNormalCoreCount: 8 }
      : player
  );
  state.pendingTriggeredEffects = [
    {
      pendingId: "departure-summon",
      eventKind: "summon",
      actingPlayerId: owner,
      source: "action_resolution",
      chainId: "scenario:scenario-triggered-source-departure.ts:38",
      attackId: state.activeAttack!.attackId,
      relatedPlayerId: owner,
      relatedInstanceId: "departure-source",
      amount: null,
      step: "attack",
      window: "flash_before_block",
      resolvedSourceInstanceIds: [],
    },
  ];
  return state;
}
