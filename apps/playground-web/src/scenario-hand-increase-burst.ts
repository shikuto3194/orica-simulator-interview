import {
  createCardInstance,
  createEmptyGameState,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** ソウエイ対ユウの初回挿入。stage=hand-burst はセット中ソウエイ＋手札ランガ。 */
export function buildHandIncreaseBurstScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const handBurst = params?.get("stage") === "hand-burst";
  const open = params?.get("stage") === "open";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  if (params?.get("stage") === "unseal") {
    // owner はバーストと創界石の所有者。添付盤面の M02 自分3ドローを再現する。
    const entries = [
      ["source", "BSRK01-CX01", opponent, "field", 1],
      ["burst", "BSTH02-M02", owner, "burst", 0],
      ["stone", "BSTH04-転醒R01(A)", owner, "field", 0],
      ...[1, 2, 3, 4].map(
        (i) => [`hand${i}`, "BSTH01-C04", owner, "hand", 0] as const
      ),
      ...[1, 2, 3].map(
        (i) => [`deck${i}`, "BSTH01-C04", owner, "deck", 0] as const
      ),
    ] as const;
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: entries.map(
          ([instanceId, cardNo, ownerPlayerId, zone, normalCoreCount]) =>
            createCardInstance(definitions.get(cardNo)!, {
              instanceId,
              ownerPlayerId,
              zone,
              normalCoreCount,
            })
        ),
        setBurstStates: [{ playerId: owner, cardInstanceId: "burst" }],
        playerOverrides: ["alice", "bob"].map((id) => ({
          handCount: id === owner ? 4 : 0,
          deckCount: id === owner ? 3 : 0,
          reserveNormalCoreCount: 10,
          voidNormalCoreCount: 100,
        })),
      }),
      activePlayerId: opponent,
      step: "main",
      turnNumber: 2,
    };
    return queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          actingPlayerId: opponent,
          eventKind: "increase_hand",
          source: "action_resolution",
          chainId: "scenario-unseal",
          attackId: null,
          relatedPlayerId: opponent,
          relatedInstanceId: "source",
          amount: 1,
          cause: "self_effect",
        },
      ],
      undefined,
      {
        getCardDefinitionById: (id) => definitions.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(allCards),
        getRegisteredBurstActions: buildBurstEffectLookup(allCards),
      }
    );
  }
  if (params?.get("stage") === "self-recovery") {
    const entries = [
      ["soltiliena", "BSSA01-R01", owner, "field", 1],
      ["blazing", "BSTH01-C21", owner, "deck", 0],
      ...[1, 2, 3].map(
        (i) => [`night${i}`, "BSSA01-C01", owner, "deck", 0] as const
      ),
      ...[1, 2, 3, 4].map(
        (i) => [`rest${i}`, "BSSA01-C03", owner, "deck", 0] as const
      ),
      ["souei", "BSTS01-R02", opponent, "burst", 0],
    ] as const;
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: entries.map(
          ([instanceId, cardNo, ownerPlayerId, zone, normalCoreCount]) =>
            createCardInstance(definitions.get(cardNo)!, {
              instanceId,
              ownerPlayerId,
              zone,
              normalCoreCount,
            })
        ),
        setBurstStates: [{ playerId: opponent, cardInstanceId: "souei" }],
        playerOverrides: ["alice", "bob"].map((id) => ({
          handCount: 0,
          deckCount: id === owner ? 8 : 0,
          reserveNormalCoreCount: 10,
        })),
      }),
      activePlayerId: owner,
      step: "main",
      turnNumber: 4,
    };
  }
  const entries = [
    ["yu", open ? "BSSA01-C02" : "BSGE01-CX01", owner, "field", 1],
    ["insert", "BSSL01-C02", owner, "hand", 0],
    ["draw", open ? "BSSA01-C01" : "BSSL01-C02", owner, "deck", 0],
    ...(open
      ? ([
          ["remainder1", "BSSA01-C03", owner, "deck", 0],
          ["remainder2", "BSSA01-C04", owner, "deck", 0],
        ] as const)
      : []),
    ["souei", "BSTS01-R02", opponent, "burst", 0],
    ...(handBurst
      ? [["ranga", "BSTS01-M01", opponent, "hand", 0] as const]
      : []),
  ] as const;
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: entries.map(
      ([instanceId, cardNo, ownerPlayerId, zone, normalCoreCount]) =>
        createCardInstance(definitions.get(cardNo)!, {
          instanceId,
          ownerPlayerId,
          zone,
          normalCoreCount,
        })
    ),
    setBurstStates: [{ playerId: opponent, cardInstanceId: "souei" }],
    playerOverrides: ["alice", "bob"].map((id) => ({
      handCount: id === owner || handBurst ? 1 : 0,
      deckCount: id === owner ? (open ? 3 : 1) : 0,
      reserveNormalCoreCount: 10,
      countValue: 5,
    })),
  });
  const state: GameState = {
    ...base,
    activePlayerId: owner,
    step: "main",
    turnNumber: 3,
    ...(handBurst
      ? {
          pendingBurstChecks: [
            {
              checkId: "ranga-attack",
              actingPlayerId: opponent,
              eventKind: "attack_after" as const,
              source: "action_resolution" as const,
              chainId: "scenario:scenario-hand-increase-burst.ts:160",
              attackId: null,
              relatedPlayerId: owner,
              relatedInstanceId: "yu",
              amount: 1,
              step: "main" as const,
              window: base.window,
              resolvedBurstCardInstanceIds: [],
            },
          ],
        }
      : {}),
  };
  return open
    ? queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: owner,
            eventKind: "summon",
            source: "action_resolution",
            chainId: "scenario-eugeo",
            attackId: null,
            relatedPlayerId: owner,
            relatedInstanceId: "yu",
            amount: 1,
          },
        ],
        undefined,
        {
          getCardDefinitionById: (id) => definitions.get(id),
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(allCards),
          getRegisteredBurstActions: buildBurstEffectLookup(allCards),
        }
      )
    : state;
}
