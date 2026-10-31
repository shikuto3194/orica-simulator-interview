import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** C10 の通常召喚。合体可能なホストを置き、独立場入りを検査する。 */
export function buildAldnoahNoCombineScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const getDef = (id: string) => cards.find((card) => card.cardNo === id)!;
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 6,
        handCount: id === owner ? 1 : 0,
        deckCount: 4,
      })),
      cardInstances: [
        createCardInstance(getDef("BSTH01-X04"), {
          instanceId: "host",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(getDef("BSAZ02-C10"), {
          instanceId: "drive",
          ownerPlayerId: owner,
          zone: "hand",
        }),
        ...["alice", "bob"].flatMap((player) =>
          Array.from({ length: 4 }, (_, i) =>
            createCardInstance(getDef("BSTH01-C01"), {
              instanceId: `${player}-deck-${i}`,
              ownerPlayerId: player,
              zone: "deck",
            })
          )
        ),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
}

/** 原文監査: 攻撃中の手札制限と、最初のバトル終了後までのスタック制限。 */
export function buildBsaz02FidelityScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const solis = params?.get("mode") === "solis";
  const getDef = (id: string) => cards.find((c) => c.cardNo === id);
  const host = createCardInstance(
    getDef(solis ? "BSAZ02-X02" : "BSAZ02-R01")!,
    {
      instanceId: "host",
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: solis ? 4 : 1,
    }
  );
  host.underCards = [
    {
      cardInstanceId: "drive",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    },
  ];
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          host,
          createCardInstance(getDef("BSAZ02-C10")!, {
            instanceId: "drive",
            ownerPlayerId: owner,
            zone: "field",
            attachedToInstanceId: "host",
          }),
          ...(solis
            ? [
                createCardInstance(getDef("BSAZ02-C06")!, {
                  instanceId: "attacker",
                  ownerPlayerId: owner,
                  zone: "field",
                  normalCoreCount: 1,
                }),
              ]
            : []),
          createCardInstance(getDef("BSAZ02-C05")!, {
            instanceId: "hand-spirit",
            ownerPlayerId: opponent,
            zone: "hand",
          }),
          createCardInstance(getDef("BSAZ02-C15")!, {
            instanceId: "hand-magic",
            ownerPlayerId: opponent,
            zone: "hand",
          }),
        ],
      }),
      activePlayerId: owner,
      turnNumber: 3,
      step: "attack",
      window: "none",
    },
    getDef
  );
}
