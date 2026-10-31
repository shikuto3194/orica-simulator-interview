import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import snapshot from "../../../packages/rules-core/test/fixtures/field-symbol-extension-snapshot.json" with { type: "json" };

export function buildFieldSymbolExtensionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  if (params?.get("snapshot") === "1")
    return structuredClone(snapshot.state) as GameState;
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const make = (no: string, id: string, zone: "set_aside" | "hand") =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
    });
  const instances = [
    make("BSTH08.5-C20", "extension-c20", "set_aside"),
    make("BSTH08.5-C21", "extension-c21", "set_aside"),
    make("BSTH08.5-X01", "extension-x01", "hand"),
  ];
  if (params?.get("duplicate") === "1")
    instances.push(make("BSTH08.5-C20", "extension-c20-second", "set_aside"));
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: instances,
        playerOverrides: [
          { reserveNormalCoreCount: 9 },
          { reserveNormalCoreCount: 9 },
        ],
      }),
      activePlayerId: owner,
      turnNumber: 3,
      step: "main",
    },
    lookup
  );
}
