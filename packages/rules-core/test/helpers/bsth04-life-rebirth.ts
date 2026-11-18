import { ALL_CARDS } from "../../../card-data/src/generated-index";
import {
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  type GameState,
} from "../../src";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
export const lifeRebirthLookups = {
  getCardDefinitionById: (id: string) =>
    cards.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredBurstActions: () => [],
};

/** 実際のコア移動からライフ増減イベントを収集する。 */
export function lifeRebirthState(
  owner: string,
  changedPlayer: string,
  change: "increase" | "decrease",
  count = 3
): GameState {
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? count : 9,
      })),
      cardInstances: [
        createCardInstance(
          lifeRebirthLookups.getCardDefinitionById("BSTH04-転醒R02(A)")!,
          { instanceId: "sun-field", ownerPlayerId: owner, zone: "field" }
        ),
      ],
    }),
    activePlayerId: owner,
    step: "main",
    turnNumber: 3,
  };
  const after = executeEffect({
    chainId: "test:bsth04-life-change",
    state: before,
    effect: {
      timing: { kind: "immediate" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: {
              kind: change === "increase" ? "void" : "life",
              player: "self",
            },
            to: {
              kind: change === "increase" ? "life" : "reserve",
              player: "self",
            },
            amount: 1,
          },
        },
      ],
    },
    sourceInstanceId: "life-change",
    actingPlayerId: changedPlayer,
    getCardDefinitionById: lifeRebirthLookups.getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
  return collectAndQueueTriggerReactions({
    chainId: "test:bsth04-life-change",
    beforeState: before,
    afterState: after,
    source: "action_resolution",
    causedByPlayerId: changedPlayer,
    ...lifeRebirthLookups,
  });
}
