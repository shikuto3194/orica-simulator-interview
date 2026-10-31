import { createCardInstance, createEmptyGameState } from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** BSTH02.7-X03: C2はプレイヤー条件、対象コアは1個、維持コアはリザーブから。 */
export function buildManifestScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const count = params?.get("count") === "1" ? 1 : 2;
  const card = (no: string) => cards.find((entry) => entry.cardNo === no)!;
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(card("BSTH02.7-X03"), {
        instanceId: "manifest-source",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      createCardInstance(card("BSTH02.7-CX01"), {
        instanceId: "manifest-target",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      }),
      ...["alice", "bob"].flatMap((id) =>
        [0, 1, 2].map((index) =>
          createCardInstance(card("BSTH02.7-C01"), {
            instanceId: `manifest-deck-${id}-${index}`,
            ownerPlayerId: id,
            zone: "deck",
          })
        )
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: id === owner ? 1 : 0,
      deckCount: 3,
      countValue: id === owner ? count : 0,
      reserveNormalCoreCount: id === owner ? 1 : 0,
      reserveSoulCoreCount: 1,
      soulCoreLocation: { kind: "reserve" as const },
      lifeNormalCoreCount: 5,
    })),
    startingVoidNormalCoreCount: 0,
  });
  return {
    ...base,
    turnNumber: 2,
    activePlayerId: owner,
    step: "main",
    window: "none",
  };
}
