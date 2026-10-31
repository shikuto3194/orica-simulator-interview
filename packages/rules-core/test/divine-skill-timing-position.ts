import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { GameState } from "../src/model";
import { adventFlashPosition } from "./advent-flash-position";

export const divineTimingCard = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id)!;

/** 添付再現と同じ、アタック未宣言・導技4コア・疲労相手を持つ盤面。 */
export function divineSkillTimingPosition(
  cardNo = "BSTH04-X01",
  owner = "alice"
): GameState {
  const opponent = owner === "alice" ? "bob" : "alice";
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(divineTimingCard(cardNo), {
          instanceId: "timing-nexus",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 4,
        }),
        createCardInstance(divineTimingCard("BSDB01-C05"), {
          instanceId: "timing-target",
          ownerPlayerId: opponent,
          zone: "field",
          normalCoreCount: 2,
          exhaustState: "exhausted",
        }),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "attack",
    window: "none",
  };
}

export function divineSkillFlashPosition(
  state: GameState,
  priorityPlayerId: string,
  afterBlock = false
): GameState {
  const result = adventFlashPosition(state, state.activePlayerId);
  result.window = afterBlock ? "flash_after_block" : "flash_before_block";
  result.activeAttack!.flashWindowState!.kind = afterBlock
    ? "after_block"
    : "before_block";
  result.activeAttack!.flashWindowState!.priorityPlayerId = priorityPlayerId;
  result.activeAttack!.flashWindowState!.stackResponseSourcePlayerId =
    priorityPlayerId;
  return result;
}
