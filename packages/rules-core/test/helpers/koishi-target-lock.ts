import { ALL_CARDS } from "../../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
  type Effect,
  type GameState,
} from "../../src";

export const koishiDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);

/** 添付盤面の攻撃可否に必要な実カード・コア数・相手カウントを再現する。 */
export function koishiTargetLockState(
  owner = "alice",
  count = 5,
  effect: Effect = koishiDefinition("BSTH04-C11")!.effects![2]!
): GameState {
  const opponent = owner === "alice" ? "bob" : "alice";
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === opponent ? count : 2,
      })),
      cardInstances: [
        createCardInstance(koishiDefinition("BSTH06-X02")!, {
          instanceId: "koishi",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(koishiDefinition("BSTH06-X03")!, {
          instanceId: "yuugi",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(koishiDefinition("BSTH04-C11")!, {
          instanceId: "judgment",
          ownerPlayerId: opponent,
          zone: "trash",
        }),
      ],
    }),
    activePlayerId: owner,
    step: "attack",
    window: "none",
    turnNumber: 8,
  };
  state = rebuildContinuousEffectsFromField(state, koishiDefinition);
  return executeEffect({
    chainId: "test:koishi-judgment",
    state,
    effect,
    sourceInstanceId: "judgment",
    actingPlayerId: opponent,
    getCardDefinitionById: koishiDefinition,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
