import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type Effect,
  type GameState,
} from "@orica/rules-core";

/** 合成効果によるエンジン回帰用。元カード本文の再現ではない。 */
export function buildBattleEndSelectionChainScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const burst = params?.get("selection") === "burst";
  const distribution = params?.get("selection") === "distribution";
  const shoot = params?.get("selection") === "shoot";
  const handSwap = params?.get("selection") === "hand-trash";
  const fieldSwap = params?.get("selection") === "field-hand";
  const source = cards.find((c) => c.cardNo === "BSTH01-C01")!;
  const lookups = {
    getCardDefinitionById: (id: string) => cards.find((c) => c.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBurstActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 3 : 0,
        ...(handSwap || fieldSwap ? { handCount: id === owner ? 1 : 0 } : {}),
      })),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "selection-source",
          ownerPlayerId: owner,
          zone: "field",
          cores: 1,
        }),
        ...(handSwap || fieldSwap
          ? [
              createCardInstance(source, {
                instanceId: "selection-watcher",
                ownerPlayerId: owner,
                zone: "field",
                cores: 1,
              }),
              createCardInstance(source, {
                instanceId: "selection-hand",
                ownerPlayerId: owner,
                zone: "hand",
              }),
              createCardInstance(source, {
                instanceId: "selection-trash",
                ownerPlayerId: owner,
                zone: "trash",
              }),
            ]
          : []),
        createCardInstance(source, {
          instanceId: "selection-burst",
          ownerPlayerId: opponent,
          zone: "burst",
        }),
        ...["victim", "other"].map((id) =>
          createCardInstance(source, {
            instanceId: `selection-${id}`,
            ownerPlayerId: opponent,
            zone: "field",
            cores: 1,
          })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(source, {
            instanceId: `selection-deck-${i}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
      setBurstStates: [
        { playerId: opponent, cardInstanceId: "selection-burst" },
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "attack",
    window: "battle_resolution",
  };
  const watcher: Effect = {
    timing: { kind: "game_event", event: "count_decrease", player: "self" },
    executionMode: "optional",
    steps: [
      { action: { kind: "draw", count: 1 } },
      {
        connector: "after_triggers",
        action: { kind: "count_increase", player: "self", amount: 3 },
      },
    ],
  };
  state = executeEffect({
    state,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: { kind: "self" },
            grantedEffect: watcher,
            duration: { scope: "turn" },
          },
        },
      ],
    },
    sourceInstanceId:
      handSwap || fieldSwap ? "selection-watcher" : "selection-source",
    actingPlayerId: owner,
    chainId: "scenario:selection:grant",
    ...lookups,
  });
  const attackId = "selection-attack";
  return executeEffect({
    state: { ...state, pendingBattleEndFinalizeAttackIds: [attackId] },
    effect: {
      timing: { kind: "card_event", event: "battle_end" },
      steps: [
        ...(handSwap
          ? [
              {
                action: {
                  kind: "queue_hand_trash_swap" as const,
                  outgoingFilter: {},
                  incomingFilter: {},
                },
                ...(params?.get("optionalSwap") === "1"
                  ? { executionMode: "optional" as const }
                  : {}),
              },
            ]
          : []),
        ...(fieldSwap
          ? [
              {
                action: {
                  kind: "queue_field_hand_swap" as const,
                  incomingFilter: {},
                },
                ...(params?.get("optionalSwap") === "1"
                  ? { executionMode: "optional" as const }
                  : {}),
              },
            ]
          : []),
        ...(distribution
          ? [
              {
                action: {
                  kind: "core_distribute" as const,
                  from: { kind: "void" as const, player: "self" as const },
                  to: { kind: "self" as const },
                  amount: 1,
                  mode: "player_choice" as const,
                  minTotal: 1,
                },
              },
            ]
          : []),
        ...(shoot
          ? [
              {
                action: {
                  kind: "core_move" as const,
                  from: { kind: "field" as const, player: "opponent" as const },
                  to: { kind: "trash" as const, player: "opponent" as const },
                  amount: { min: 0, max: 1 },
                },
              },
            ]
          : []),
        ...(burst
          ? [
              {
                action: {
                  kind: "discard_set_burst" as const,
                  player: "opponent" as const,
                  count: { min: 0, max: 1 },
                },
              },
            ]
          : []),
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount:
              burst || distribution || shoot || handSwap || fieldSwap
                ? 1
                : { min: 0, max: 1 },
          },
        },
        { connector: "after_triggers", action: { kind: "draw", count: 1 } },
      ],
    },
    effectIndex: 0,
    sourceInstanceId: "selection-source",
    actingPlayerId: owner,
    chainId: `battle-end-deferral:${attackId}:scenario:effect`,
    firingBattleEndDeferral: true,
    battleEndDeferralAttackId: attackId,
    ...lookups,
  });
}
