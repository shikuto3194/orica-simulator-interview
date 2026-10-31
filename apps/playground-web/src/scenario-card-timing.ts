import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildCardTimingScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const card = (no: string) => cards.find((c) => c.cardNo === no)!;
  const instance = (
    no: string,
    id: string,
    player: string,
    zone: "field" | "hand" | "deck" | "trash",
    cores = 0
  ) =>
    createCardInstance(card(no), {
      instanceId: id,
      ownerPlayerId: player,
      controllerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  if (params?.get("mode")?.startsWith("divine-")) {
    const stack = params.get("mode") === "divine-stack";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance(
            params.get("lock") === "king" ? "BSFT01-X01" : "BSTH04-転醒R02(A)",
            "timing-lock",
            owner,
            "field",
            1
          ),
          instance("BSTH04-C01", "timing-attacker", owner, "field", 1),
          instance("BSTH11-X01", "timing-okina", opponent, "field", 2),
          instance("BSRK01-C03", "timing-magic", owner, "hand"),
        ],
        activeAttack: {
          attackId: "timing-attack",
          primaryEntityId: "timing-entity",
          participantEntityIds: ["timing-entity"],
          groupMode: "single",
          target: { kind: "player", playerId: opponent },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: opponent,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: stack ? owner : opponent,
            pendingStackAction: stack
              ? {
                  stackId: "timing-magic-response",
                  chainId: "timing-magic-response",
                  actionKind: "magic",
                  actingPlayerId: owner,
                  cardInstanceId: "timing-magic",
                  cardDefinitionId: "BSRK01-C03",
                  targetInstanceIds: [],
                  targetEffectFilterTags: [],
                  previousResponseSourcePlayerId: null,
                  previousPendingStackAction: null,
                }
              : null,
          },
        },
        battleEntities: [
          {
            entityId: "timing-entity",
            memberInstanceIds: ["timing-attacker"],
            resolvedBp: 3000,
            resolvedSymbols: ["yellow"],
            attackState: "attacking",
          },
        ],
      }),
      step: "attack",
      window: stack ? "stack_before_block" : "flash_before_block",
      activePlayerId: owner,
      turnNumber: 3,
      attackDeclarationLog: [
        {
          playerId: owner,
          cardInstanceId: "timing-attacker",
          cardDefinitionId: "BSTH04-C01",
          turnNumber: 3,
          step: "attack",
          attackId: "timing-attack",
        },
      ],
    };
    return recomputeAndRebuildContinuousEffects(state, (id) =>
      cards.find((c) => c.cardNo === id)
    );
  }
  if (params?.get("mode") === "stack") {
    const robot = instance(
      "BSAZ02-TX01(A)",
      "timing-robot",
      opponent,
      "field",
      3
    );
    robot.underCards = [
      {
        cardInstanceId: "timing-drive",
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ];
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSTH04-転醒R02(A)", "timing-sun", owner, "field", 1),
          instance("BSTH04-C01", "timing-attacker", owner, "field", 1),
          instance("BSRK01-C06", "timing-stack-magic", opponent, "hand"),
          robot,
          {
            ...instance("BSAZ02-M01", "timing-drive", opponent, "field"),
            attachedToInstanceId: "timing-robot",
          },
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 20 },
          { reserveNormalCoreCount: 20 },
        ],
      }),
      step: "attack",
      window: "none",
      turnNumber: 3,
      activePlayerId: owner,
    };
  }
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance("BSRK01-C03", "timing-magic", owner, "trash"),
        ...Array.from({ length: 4 }, (_, i) =>
          instance("BSKB01-C01", `timing-hand-${i}`, owner, "hand")
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          instance("BSKB01-C02", `timing-deck-${i}`, owner, "deck")
        ),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 4 : 0,
        deckCount: id === owner ? 5 : 0,
      })),
    }),
    step: "main",
    window: "none",
    turnNumber: 3,
    activePlayerId: owner,
  };
  // 実カードのドロー後、選択待ちからGUIとRESTの両方で手札をデッキ下へ戻す。
  return executeEffect({
    chainId: "scenario:scenario-card-timing.ts:170",
    state,
    effect: card("BSRK01-C03").effects![1]!,
    sourceInstanceId: "timing-magic",
    actingPlayerId: owner,
    getCardDefinitionById: (id) => cards.find((c) => c.cardNo === id),
    getRegisteredTriggeredEffectActions: () => [],
  });
}
