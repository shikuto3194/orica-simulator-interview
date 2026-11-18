import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";

/** 2026-09-27 の報告盤面を最小化。魂状態のENIGMA＋中央クォーツと通常2行。 */
export function buildQuartzLayoutScenario(
  definitions: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const lookup = new Map(definitions.map((def) => [def.cardNo, def]));
  const cards: CardInstance[] = [];
  const quartzSetStates: GameState["quartzSetStates"] = [];
  const full = params?.get("full") === "1";
  const overflow = params?.get("overflow") === "1";
  const attributes = params?.get("attributes");
  const mixedQuartz = [
    "BSLH01-C10",
    "BSLH01-C05",
    "BSLH01-R03",
    "BSLH01-X03",
    "BSLH01-C04",
    "BSLH01-M04",
    "BSLH01-C09",
  ];
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
    const host = make("BSLH01-CX01", `${owner}-quartz-host`, owner);
    let quartzIndex = 0;
    for (const slot of ["left", "center", "right"] as const) {
      if (attributes === "empty") continue;
      if (!full && attributes !== "mixed" && slot !== "center") continue;
      const count = slot === "center" ? 1 : 3;
      for (let index = 0; index < count; index++) {
        const quartz = make(
          attributes === "mixed" ? mixedQuartz[quartzIndex]! : "BSLH01-X03",
          `${owner}-quartz-${slot}-${index}`,
          owner
        );
        quartzIndex += 1;
        quartzSetStates.push({
          quartzInstanceId: quartz.instanceId,
          hostInstanceId: host.instanceId,
          ownerPlayerId: owner,
          slot,
        });
      }
    }
    for (let index = 0; index < (overflow ? 10 : 3); index++) {
      make("BSTH09-C01", `${owner}-spirit-${index}`, owner, 1);
    }
    for (let index = 0; index < (overflow ? 10 : 2); index++) {
      make("BSTH09-TR01(A)", `${owner}-nexus-${index}`, owner);
    }
  }
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    playerOverrides: ["alice", "bob"].map((owner) => ({
      reserveNormalCoreCount: 6,
      soulStateInstanceIds: cards
        .filter((card) => card.instanceId.startsWith(`${owner}-quartz-`))
        .map((card) => card.instanceId),
    })),
  });
  return {
    ...state,
    quartzSetStates,
    activePlayerId: "alice",
    step: "main",
    turnNumber: 5,
  };
}
