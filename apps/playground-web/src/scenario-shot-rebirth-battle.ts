import { createCardInstance, createEmptyGameState } from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** ユウのショットで減ったライフに手札のグランギニョルを提示する実対戦回帰。 */
export function buildShotRebirthBattleScenario(
  allCards: CardDefinition[]
): GameState {
  const card = (
    cardNo: string,
    instanceId: string,
    ownerPlayerId: string,
    zone: "field" | "hand",
    normalCoreCount = 0
  ) => {
    const definition = allCards.find((entry) => entry.cardNo === cardNo);
    if (!definition) throw new Error(`Missing scenario card: ${cardNo}`);
    return createCardInstance(definition, {
      instanceId,
      ownerPlayerId,
      zone,
      normalCoreCount,
    });
  };
  const yu = card("BSGE01-CX01", "shot-yu", "bob", "field", 1);
  const gun = card("BSGE01-TX01(A)", "shot-gun", "bob", "field");
  const shot = card("BSGE01-R03", "shot-bullet", "bob", "field");
  yu.attachedChildrenIds = [gun.instanceId];
  gun.attachedToInstanceId = yu.instanceId;
  yu.underCards = [
    {
      role: "text_role",
      roleTag: "バレットエディット",
      cardInstanceId: shot.instanceId,
    },
  ];
  shot.attachedToInstanceId = yu.instanceId;
  shot.zoneRoleName = "bullet-edit";
  return {
    ...createEmptyGameState({
      playerIds: ["bob", "alice"],
      cardInstances: [
        yu,
        gun,
        shot,
        card("BSTH02.7-TX01(A)", "shot-tx01", "alice", "hand"),
        card("BSGE01-R05", "shot-kota", "bob", "field", 1),
      ],
      playerOverrides: [
        { countValue: 4, contractCardNo: "BSGE01-CX01" },
        { reserveNormalCoreCount: 6, trashNormalCoreCount: 1 },
      ],
    }),
    turnNumber: 3,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
  };
}
