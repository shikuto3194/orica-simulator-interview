import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createActiveAttack,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  queuePendingLeave,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 相手による破壊 → ユージオの発揮 → 応答窓 → 煌臨元選択。 */
export function buildEugeoRebirthScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const waitingCoresOnly = params?.get("cores") === "waiting";
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    definitions.find((d) => d.cardNo === id);
  const card = (id: string) => {
    const def = getCardDefinitionById(id);
    if (!def) throw new Error(`Eugeo scenario card missing: ${id}`);
    return def;
  };
  const host = createCardInstance(card("BSSA01-転醒X03(A)"), {
    instanceId: "eugeo-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 2,
  });
  host.definitionId = "BSSA01-転醒X03(B)";
  host.exhaustState = "exhausted";
  host.underCards = [{ role: "advent_source", cardInstanceId: "eugeo-sword" }];
  const sword = createCardInstance(card("BSSA01-転醒X02(A)"), {
    instanceId: "eugeo-sword",
    ownerPlayerId: owner,
    zone: "field",
    zoneRoleName: "advent-source",
  });
  const otherHost = createCardInstance(card("BSSA01-転醒X03(A)"), {
    instanceId: "eugeo-other-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 1,
  });
  const otherSword = createCardInstance(card("BSSA01-転醒X02(A)"), {
    instanceId: "eugeo-other-sword",
    ownerPlayerId: owner,
    zone: "field",
    zoneRoleName: "advent-source",
  });
  otherHost.underCards = [
    { role: "advent_source", cardInstanceId: otherSword.instanceId },
  ];
  const looseSword = createCardInstance(card("BSSA01-転醒X02(A)"), {
    instanceId: "eugeo-loose-sword",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 1,
  });
  const enemy = createCardInstance(card("BSTH01-C04"), {
    instanceId: "eugeo-enemy",
    ownerPlayerId: opponent,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: waitingCoresOnly
      ? [host, sword, enemy]
      : [host, sword, otherHost, otherSword, looseSword, enemy],
    playerOverrides: ["alice", "bob"].map((id) => ({
      countValue: id === owner ? 3 : 0,
      reserveNormalCoreCount: waitingCoresOnly && id === owner ? 0 : 1,
      soulCoreLocation: { kind: "trash" as const },
    })),
  });
  const before: GameState = {
    ...base,
    step: "attack",
    window: "none",
    turnNumber: 5,
    activePlayerId: owner,
  };
  if (params?.get("battle") === "attacking") {
    const entityId = `battle-entity:${host.instanceId}`;
    before.battleEntities = [
      {
        entityId,
        memberInstanceIds: [host.instanceId],
        resolvedBp: 13000,
        resolvedSymbols: ["white"],
        attackState: "attacking",
      },
    ];
    before.activeAttack = createActiveAttack(before, entityId, owner);
  }
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  const leaving = queuePendingLeave({
    state: before,
    instanceId: host.instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId: opponent,
    chainId: "eugeo-destroy",
    causedByEffectSourceInstanceId: enemy.instanceId,
    deferZoneMoveUntilChainEnd: false,
  });
  let state = collectAndQueueTriggerReactions({
    beforeState: before,
    afterState: leaving,
    source: "action_resolution",
    chainId: "eugeo-destroy",
    ...lookups,
  });
  for (let i = 0; i < 12 && !state.pendingEffectTargetSelection; i++) {
    const actions = [owner, opponent].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const action =
      actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === host.instanceId
      ) ?? actions.find((a) => a.kind === "pass_stack");
    if (!action)
      throw new Error(
        `Eugeo scenario action missing: ${actions.map((a) => a.kind).join(",")}`
      );
    state = applyLegalAction({ state, action, ...lookups }).state;
  }
  if (!state.pendingEffectTargetSelection)
    throw new Error("Eugeo target selection missing");
  return state;
}
