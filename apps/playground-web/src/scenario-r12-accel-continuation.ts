import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { moveCardZone } from "../../../packages/rules-core/src/core/core-system";

/** R12を手元へ置いた直後。実カード2枚のアクセルで別々の4枚オープンを解決する。 */
export function buildR12AccelContinuationScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const defs = new Map(cards.map((c) => [c.cardNo, c]));
  const card = (no: string, id: string, zone: "hand" | "deck") =>
    createCardInstance(defs.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
    });
  const initial: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 10,
        lifeNormalCoreCount: 5,
        handCount: id === owner ? 3 : 0,
        deckCount: id === owner ? 12 : 0,
      })),
      cardInstances: [
        card("BSTH08.5-R12", "r12", "hand"),
        card("BSTH08.5-C20", "accel-a", "hand"),
        card("BSTH08.5-C20", "accel-b", "hand"),
        ...Array.from({ length: 12 }, (_, i) =>
          card("BSTH001-C01", `deck-${i}`, "deck")
        ),
      ],
    }),
    activePlayerId: owner,
    step: "main",
    window: "none",
    turnNumber: 4,
  };
  return rebuildContinuousEffectsFromField(
    moveCardZone(initial, "r12", "set_aside"),
    (id) => defs.get(id)
  );
}
