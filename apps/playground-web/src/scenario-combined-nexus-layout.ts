import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";

/** 合体ネクサスの2行占有・外側整列・状態による表示列の切替。 */
export function buildCombinedNexusLayoutScenario(
  definitions: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const lookup = new Map(definitions.map((def) => [def.cardNo, def]));
  const cards: CardInstance[] = [];
  const pose = params?.get("pose");
  const exhaustState =
    pose === "exhausted" || pose === "heavily_exhausted" ? pose : "recovered";
  const mode = params?.get("mode") ?? "nexus";
  const soul = params?.get("soul") === "1";
  const make = (no: string, id: string, owner: string, cores = 0) => {
    const card = createCardInstance(lookup.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: cores,
    });
    cards.push(card);
    return card;
  };
  for (const owner of ["alice", "bob"]) {
    const host = make("BSTH003-X01", `${owner}-nexus-host`, owner, 3);
    host.exhaustState = exhaustState;
    const count = params?.get("braves") === "2" ? 2 : 1;
    for (let index = 0; index < count; index++) {
      const brave = make(
        index === 0 ? "BSTH003-C31" : "BSTH003-C32",
        `${owner}-nexus-brave-${index}`,
        owner
      );
      brave.attachedToInstanceId = host.instanceId;
      brave.exhaustState = exhaustState;
      host.attachedChildrenIds.push(brave.instanceId);
    }
    if (params?.get("under") === "1") {
      const under = make("BSTH01-C01", `${owner}-nexus-under`, owner);
      under.attachedToInstanceId = host.instanceId;
      host.underCards = [
        { cardInstanceId: under.instanceId, role: "text_role" },
      ];
    }
    if (mode === "divine") {
      host.divineTransformState = {
        bpByLevel: [
          { level: 1, bp: 10000 },
          { level: 2, bp: 15000 },
        ],
        protectedFromNonGrandwalker: false,
      };
    }
    make("BSTH003-X01", `${owner}-nexus-neighbor`, owner, 1);
    make("BSTH09-C01", `${owner}-spirit-neighbor`, owner, 1);
  }
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    playerOverrides: ["alice", "bob"].map((owner) => ({
      reserveNormalCoreCount: 6,
      soulStateInstanceIds: soul ? [`${owner}-nexus-host`] : [],
    })),
  });
  if (mode === "spirit" || mode === "ultimate") {
    state.activeContinuousEffects = ["alice", "bob"].map((owner) => ({
      effectId: `layout-category-${owner}`,
      sourceInstanceId: `${owner}-nexus-host`,
      sourceDefinitionId: "BSTH003-X01",
      actingPlayerId: owner,
      duration: { scope: "turn" },
      createdAtTurn: 3,
      createdAtAttackId: null,
      targetInstanceId: `${owner}-nexus-host`,
      modifierTag: "override_properties",
      metadata: { properties: { treatAsCategory: mode } },
    }));
  }
  return { ...state, activePlayerId: "alice", step: "main", turnNumber: 3 };
}
