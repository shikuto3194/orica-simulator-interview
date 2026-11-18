import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
  expandCardDefinitionsWithBackFaces,
} from "@orica/rules-core";
/** 夜空の剣とTX01の実効果から、追加コアの分配待ちを作る。 */
export function buildNightSwordScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  if (params?.get("mode") === "vanish")
    return buildNightSwordVanishScenario(cards, params);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const face = params?.get("mode") === "b" ? "B" : "A";
  const defs = expandCardDefinitionsWithBackFaces(cards);
  const getDef = (id: string) => defs.find((c) => c.cardNo === id);
  const hostDef = getDef("BSKB01-TX01(" + face + ")")!;
  const host = createCardInstance(hostDef, {
    instanceId: "night-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 10,
  });
  const brave = createCardInstance(getDef("BSSA01-転醒X01(B)")!, {
    instanceId: "night-sword",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 0,
  });
  host.attachedChildrenIds = [brave.instanceId];
  brave.attachedToInstanceId = host.instanceId;
  const targets = ["target-a", "target-b"].map((instanceId) =>
    createCardInstance(getDef("BSSA01-C01")!, {
      instanceId,
      ownerPlayerId: opponent,
      zone: "field",
      normalCoreCount: 5,
    })
  );
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave, ...targets],
      playerOverrides: ["alice", "bob"].map(() => ({
        countValue: 10,
        lifeNormalCoreCount: 10,
        reserveNormalCoreCount: 5,
        soulCoreLocation: { kind: "trash" },
      })),
    }),
    activePlayerId: owner,
    step: "attack",
    turnNumber: 5,
  };
  if (params?.get("soul") === "reserve")
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === opponent
          ? {
              ...p,
              reserveNormalCoreCount: 0,
              soulCoreLocation: { kind: "reserve" },
            }
          : p
      ),
    };
  state = rebuildContinuousEffectsFromField(state, getDef);
  const index = face === "A" ? 2 : 1;
  return executeEffect({
    chainId: "scenario:scenario-night-sword.ts:79",
    state,
    effect: hostDef.effects![index]!,
    effectIndex: index,
    sourceInstanceId: host.instanceId,
    actingPlayerId: owner,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

/** 修剣士キリトの実アタック効果を宣言・応答パスし、2体のコア除去選択まで進める。 */
function buildNightSwordVanishScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const defs = expandCardDefinitionsWithBackFaces(cards);
  const lookups = {
    getCardDefinitionById: (id: string) =>
      defs.find((card) => card.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => undefined,
  };
  const hostDef = lookups.getCardDefinitionById("BSSA01-X01")!;
  const withSoulChoices = params?.get("targets") === "soul";
  const host = createCardInstance(hostDef, {
    instanceId: "night-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: params?.get("cores") === "3" ? 3 : 2,
    exhaustState: "exhausted",
  });
  const brave = createCardInstance(
    lookups.getCardDefinitionById("BSSA01-転醒X01(B)")!,
    {
      instanceId: "night-sword",
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    }
  );
  host.attachedChildrenIds = [brave.instanceId];
  brave.attachedToInstanceId = host.instanceId;
  const targets = ["target-a", "target-b"].map((instanceId) =>
    createCardInstance(
      lookups.getCardDefinitionById(
        withSoulChoices ? "BSGE01-R01" : "BSSA01-C01"
      )!,
      {
        instanceId,
        ownerPlayerId: opponent,
        zone: "field",
        normalCoreCount: 1,
      }
    )
  );
  const entityId = "battle-entity:night-host";
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave, ...targets],
      playerOverrides: ["alice", "bob"].map(() => ({
        countValue: 3,
        lifeNormalCoreCount: 5,
        reserveNormalCoreCount: 0,
        soulCoreLocation: { kind: "trash" },
      })),
    }),
    activePlayerId: owner,
    step: "attack",
    window: "declare_attack",
    turnNumber: 5,
    battleEntities: [
      {
        entityId,
        memberInstanceIds: [host.instanceId, brave.instanceId],
        resolvedBp: 13000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "night-sword-vanish",
      primaryEntityId: entityId,
      participantEntityIds: [entityId],
      groupMode: "single",
      target: { kind: "player", playerId: opponent },
      blockAssignments: [
        { participantEntityId: entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [entityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
  };
  const activeAttack = state.activeAttack;
  state = {
    ...rebuildContinuousEffectsFromField(
      { ...state, activeAttack: null },
      lookups.getCardDefinitionById
    ),
    activeAttack,
  };
  state = queueRegisteredBattleImmediateEffects({
    state,
    attackId: "night-sword-vanish",
    participantEntityId: entityId,
    actingPlayerId: owner,
    sourceCard: host,
    sourceDefinition: hostDef,
    timing: "attack",
    ...lookups,
  });
  for (let step = 0; step < 6; step++) {
    if (state.pendingCoreShootSelection) return state;
    const actions = getLegalActions({
      state,
      actingPlayerId: state.stackWindow?.priorityPlayerId ?? owner,
      ...lookups,
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "resolve_battle_immediate_effect" ||
        candidate.kind === "resolve_pending_step_choice"
    );
    if (!action)
      throw new Error(
        "キリトのコア除去選択へ進めません: " +
          actions.map((a) => a.kind).join(",")
      );
    state = applyLegalAction({
      state,
      action,
      ...lookups,
    }).state;
  }
  throw new Error("キリトのコア除去選択に到達しませんでした");
}
