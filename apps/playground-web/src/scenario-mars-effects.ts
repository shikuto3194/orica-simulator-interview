import {
  collectAndQueueTriggerReactions,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  createMechanicPendingTriggeredEffect,
  expandCardDefinitionsWithBackFaces,
  rebuildContinuousEffectsFromField,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** ユーザー報告: スレインの配置、ヘラス由来の転醒、大量の同時誘発。 */
export function buildMarsEffectsScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(cards);
  const getDefinition = (id: string) =>
    definitions.find((card) => card.cardNo === id);
  const card = (
    no: string,
    instanceId: string,
    zone: "field" | "deck" | "trash" | "hand",
    normalCoreCount = 0
  ) =>
    createCardInstance(getDefinition(no)!, {
      instanceId,
      ownerPlayerId: owner,
      zone,
      normalCoreCount,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 9 },
        { reserveNormalCoreCount: 9 },
      ],
    }),
    step: "main",
    activePlayerId: owner,
  };
  if (params?.get("mode") === "moon-girl") {
    state.cardInstances = [
      card("BSAZ02-M04", "moon-magic", "hand"),
      card("BSTH01-C12", "moon-core-holder", "field", 1),
      card("BSAZ02-X04", "moon-mars-nexus", "trash"),
    ];
    state.players = state.players.map((p) =>
      p.id === owner
        ? {
            ...p,
            reserveNormalCoreCount: 1,
            lifeNormalCoreCount: 3,
            handCount: 1,
            soulCoreLocation: { kind: "trash" },
          }
        : p
    );
    state = rebuildContinuousEffectsFromField(state, getDefinition);
    // 実カードの配置解決から任意の後段へ。pendingを手作りしない。
    return executeEffect({
      state,
      effect: getDefinition("BSAZ02-M04")!.effects![1]!,
      sourceInstanceId: "moon-magic",
      actingPlayerId: owner,
      chainId: "scenario:moon-girl",
      targetInstanceIds:
        params?.get("empty") === "1" ? [] : ["moon-mars-nexus"],
      targetSelectionResolved: true,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });
  } else if (params?.get("mode") === "trash-leave") {
    const host = card("BSAZ02-R02", "mars-niro", "field", 1);
    host.underCards = [
      {
        cardInstanceId: "mars-drive",
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ];
    const drive = {
      ...card("BSAZ02-C10", "mars-drive", "field"),
      attachedToInstanceId: host.instanceId,
    };
    state.cardInstances = [
      host,
      drive,
      card("BSAZ02-X04", "mars-vers", "field"),
      card("BSAZ02-M04", "mars-moon", "trash"),
      ...Array.from({ length: 6 }, (_, i) =>
        card("BSAZ02-M01", `mars-deck-${i}`, "deck")
      ),
    ];
    state.players = state.players.map((p) =>
      p.id === owner ? { ...p, deckCount: 6, handCount: 0 } : p
    );
    state = rebuildContinuousEffectsFromField(state, getDefinition);
    return collectAndQueueTriggerReactions({
      beforeState: {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === host.instanceId
            ? { ...c, zone: "hand", zoneRoleName: "ultimate-card" }
            : c
        ),
      },
      afterState: state,
      source: "action_resolution",
      chainId: "scenario:mars-trash-leave",
      attackId: null,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: undefined,
    });
  } else if (params?.get("mode") === "queue") {
    const nexuses = Array.from({ length: 18 }, (_, i) =>
      card("BSAZ02-X04", `mars-nexus-${i}`, "field")
    );
    const trigger = card("BSAZ02-C01", "mars-trigger", "field", 1);
    state.cardInstances = [...nexuses, trigger];
    state = rebuildContinuousEffectsFromField(state, getDefinition);
    state.pendingTriggeredEffects = nexuses.map((nexus) =>
      createMechanicPendingTriggeredEffect({
        state,
        pendingId: `mars-oracle-${nexus.instanceId}`,
        actingPlayerId: owner,
        relatedInstanceId: nexus.instanceId,
        chainId: "scenario:mars-oracles",
        mechanic: {
          kind: "oracle",
          grandwalkerInstanceId: nexus.instanceId,
          triggerCardInstanceId: trigger.instanceId,
          triggerKind: "summon",
        },
      })
    );
    return state;
  } else if (params?.get("mode") === "dioscuria") {
    const host = {
      ...card("BSAZ02-TX01(B)", "mars-dioscuria", "field", 5),
      originalDefinitionId: "BSAZ02-TX01(A)",
      underCards: [
        {
          cardInstanceId: "mars-drive",
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
        {
          cardInstanceId: "mars-hellas",
          role: "text_role" as const,
          roleTag: "ＣＦアルティメット",
        },
      ],
    };
    state.cardInstances = [
      host,
      {
        ...card("BSAZ02-C10", "mars-drive", "field"),
        attachedToInstanceId: host.instanceId,
      },
      {
        ...card("BSAZ02-TR01(A)", "mars-hellas", "field"),
        attachedToInstanceId: host.instanceId,
      },
    ];
    state.step = "attack";
  } else {
    state.cardInstances = [
      card("BSAZ02-C11", "mars-slaine", "field"),
      card("BSAZ02-X04", "mars-nexus-a", "deck"),
      card("BSAZ02-X05", "mars-nexus-b", "deck"),
      ...Array.from({ length: 12 }, (_, i) =>
        card("BSAZ02-M01", `mars-filler-${i}`, "deck")
      ),
      card("BSAZ02-X04", "mars-old-trash", "trash"),
    ];
    state.players = state.players.map((player) =>
      player.id === owner ? { ...player, deckCount: 14 } : player
    );
  }
  return rebuildContinuousEffectsFromField(state, getDefinition);
}
