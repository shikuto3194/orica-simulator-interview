import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "@orica/rules-core";
import { createCardInstance, createEmptyGameState } from "@orica/rules-core";

/** 2026-09-18T10:44:32 snapshot: 同名使用済みの反逆者アリスと神託のボタン混在。 */
export function buildQueueFrontUsageScenario(
  cards: CardDefinition[]
): GameState {
  const field = [
    ["card-69", "BSSA01-XX01", 3],
    ["card-70", "BSSA01-転醒X04(A)", 0],
    ["card-77", "BSSA01-X02", 2],
    ["card-59", "BSSA01-C03", 1],
    ["card-54", "BSSA01-X02", 2],
    ["card-80", "BSSA01-XX01", 2],
  ] as const;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: field.map(([instanceId, cardNo, normalCoreCount]) =>
      createCardInstance(cards.find((c) => c.cardNo === cardNo)!, {
        instanceId,
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount,
      })
    ),
  });
  const summon: PendingTriggeredEffect = {
    pendingId: "snapshot-summon",
    actingPlayerId: "bob",
    eventKind: "summon",
    event: {
      family: "enter_field",
      actionKind: "summon",
      validationMode: "require_related_instance_on_field",
      cause: "self_effect",
      effectSourceInstanceId: "card-59",
      sourceEffectIndex: 1,
    },
    source: "action_resolution",
    chainId: "multi-placement:mp-12",
    attackId: null,
    relatedPlayerId: "bob",
    relatedInstanceId: "card-77",
    amount: null,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: [],
    cause: "self_effect",
    fromZone: "hand",
    simultaneousGroupId: "sim-group:36",
    effectSourceInstanceId: "card-59",
    sourceEffectIndex: 1,
    triggerPriority: "normal",
    relatedInstanceIds: ["card-77", "card-59"],
    relatedInstanceIdsBySourceRegistrationKey: {
      "card-70#0": ["card-77"],
      "card-77#0": ["card-77"],
      "card-59#0": ["card-59"],
    },
  };
  return {
    ...state,
    step: "main",
    turnNumber: 6,
    activePlayerId: "bob",
    effectUsageRecords: [
      {
        sourceInstanceId: "card-54",
        sourceDefinitionId: "BSSA01-X02",
        playerId: "bob",
        effectLabel: "effect:1",
        turnNumber: 6,
        step: "main",
        duration: "turn",
        count: 1,
      },
    ],
    pendingTriggeredEffects: [
      summon,
      {
        ...summon,
        pendingId: "snapshot-summon-second",
        relatedInstanceId: "card-59",
        resolvedSourceRegistrationKeys: ["card-70#0", "card-77#0"],
      },
      ...["card-69", "card-80"].map(
        (id): PendingTriggeredEffect => ({
          pendingId: `oracle-${id}`,
          actingPlayerId: "bob",
          eventKind: "oracle",
          source: "action_resolution",
          chainId: "scenario:scenario-queue-front-usage.ts:91",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: id,
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          mechanic: {
            kind: "oracle",
            grandwalkerInstanceId: id,
            triggerCardInstanceId: "card-77",
            triggerKind: "summon",
          },
        })
      ),
    ],
  };
}
