import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  queueBattleEndTriggers,
  queuePendingLeave,
  queuePendingReactionsFromTriggerEvents,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Lv2導域と、ブロックされたジャガーノートの契約域を実カードで再現する。 */
export function buildDomainAuditScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const defs = new Map(cards.map((c) => [c.cardNo, c]));
  const getCardDefinitionById = (id: string) => defs.get(id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const inst = (no: string, id: string, cores: number, player = owner) =>
    createCardInstance(defs.get(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone: "field",
      normalCoreCount: cores,
    });
  if (params?.get("mode") === "yuyuko") {
    const ids = ["domain-yuyuko-first", "domain-yuyuko-late"];
    const initial = recomputeAndRebuildContinuousEffects(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            inst("BSTH04-X01", "domain-yuyuko", 4),
            inst("BSTH04-X03", ids[0]!, 1),
          ],
        }),
        activePlayerId: owner,
        step: "attack",
        turnNumber: 3,
      },
      getCardDefinitionById
    );
    const entered = recomputeAndRebuildContinuousEffects(
      {
        ...initial,
        cardInstances: [
          ...initial.cardInstances,
          inst("BSTH04-X03", ids[1]!, 1),
        ],
      },
      getCardDefinitionById
    );
    const pending = ids.reduce(
      (state, instanceId) =>
        queuePendingLeave({
          state,
          instanceId,
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: opponent,
          chainId: "domain-yuyuko-destroy",
        }),
      entered
    );
    return queuePendingReactionsFromTriggerEvents(
      pending,
      ids.map((id) => ({
        actingPlayerId: owner,
        eventKind: "destroy" as const,
        source: "action_resolution" as const,
        chainId: "domain-yuyuko-destroy",
        attackId: null,
        relatedInstanceId: id,
        relatedPlayerId: owner,
        amount: 1,
        cause: "opponent_effect" as const,
        suppressedSourceInstanceIds: ids,
        preFlushLeaveEvent: true,
        suppressBurstCheck: true,
      })),
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
        getRegisteredBurstActions: () => [],
      }
    );
  }
  if (params?.get("mode") === "eiki") {
    const initial = recomputeAndRebuildContinuousEffects(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            inst(
              "BSTH04-XX01",
              "domain-eiki",
              params.get("low") === "1" ? 3 : 4
            ),
            inst("BSTH01-C01", "domain-blocker", 1, opponent),
            inst("BSTH04-R01", "domain-immune-blocker", 1, opponent),
          ],
        }),
        activePlayerId: owner,
        step: "attack",
        window: "none",
        turnNumber: 3,
      },
      getCardDefinitionById
    );
    // 導域登録後の場入りを再現する。最初から攻撃者を並べるだけでは不具合を検出できない。
    return recomputeAndRebuildContinuousEffects(
      {
        ...initial,
        cardInstances: [
          ...initial.cardInstances,
          {
            ...inst("BSTH04-X03", "domain-komachi", 1),
            exhaustState: "exhausted",
          },
        ],
        window: "declare_block",
        activeAttack: {
          attackId: "domain-eiki-attack",
          primaryEntityId: "domain-komachi-unit",
          participantEntityIds: ["domain-komachi-unit"],
          groupMode: "single",
          target: { kind: "player", playerId: opponent },
          blockAssignments: [
            {
              participantEntityId: "domain-komachi-unit",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["domain-komachi-unit"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "domain-komachi-unit",
            memberInstanceIds: ["domain-komachi"],
            resolvedBp: 7000,
            resolvedSymbols: ["purple"],
            attackState: "attacking",
          },
        ],
      },
      getCardDefinitionById
    );
  }
  const state = recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides:
          owner === "alice" ? [{ countValue: 4 }, {}] : [{}, { countValue: 4 }],
        cardInstances: [
          inst("BSES01-CX01", "domain-lena", 4),
          inst("BSES01-T01", "domain-juggernaut", 1),
          inst("BSTH01-C01", "domain-blocker", 1, opponent),
          inst(
            "BSTH08-XX01",
            "domain-miko",
            params?.get("low") === "1" ? 3 : 4
          ),
          inst("BSTH08-M01", "domain-futo", 1),
        ],
      }),
      step: "attack",
      window: "declare_attack",
      activePlayerId: owner,
      turnNumber: 3,
    },
    getCardDefinitionById
  );
  return queueBattleEndTriggers({
    state,
    participantInstanceIds: ["domain-juggernaut", "domain-blocker"],
    blockSideInstanceIds: ["domain-blocker"],
    attackId: "domain-audit-battle",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBurstActions: undefined,
  });
}
