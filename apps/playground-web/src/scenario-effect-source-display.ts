import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
} from "@orica/rules-core";

/** TR01(A) attack effect declared: Bob's response precedes the optional flip. */
export function buildEffectSourceDisplayScenario(
  allCards: CardDefinition[]
): GameState {
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const getDefinition = (id: string) =>
    definitions.find((card) => card.cardNo === id);
  const hostDefinition = getDefinition("BSGE01-CX01")!;
  const braveDefinition = getDefinition("BSGE01-TR01(A)")!;
  const host = createCardInstance(hostDefinition, {
    instanceId: "effect-display-host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    attachedChildrenIds: ["effect-display-brave"],
  });
  const brave = createCardInstance(braveDefinition, {
    instanceId: "effect-display-brave",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    attachedToInstanceId: host.instanceId,
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    }),
    turnNumber: 3,
    step: "main",
    window: "none",
    activePlayerId: "alice",
    battleEntities: [
      {
        entityId: "battle-entity:effect-display-host",
        memberInstanceIds: [host.instanceId, brave.instanceId],
        resolvedBp: 10000,
        resolvedSymbols: ["red", "red"],
        attackState: "attacking",
      },
    ],
  };
  const lookups = {
    getCardDefinitionById: getDefinition,
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
  };
  const queued = queueRegisteredBattleImmediateEffects({
    state,
    attackId: "effect-display-attack",
    participantEntityId: "battle-entity:effect-display-host",
    actingPlayerId: "alice",
    sourceCard: host,
    sourceDefinition: hostDefinition,
    timing: "attack",
    ...lookups,
  });
  const action = getLegalActions({
    state: queued,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (action) =>
      action.kind === "resolve_battle_immediate_effect" &&
      action.sourceEffectInstanceId === brave.instanceId &&
      !action.skipOnly
  );
  if (!action) throw new Error("TR01(A) attack effect is unavailable");
  return applyLegalAction({ state: queued, action, ...lookups }).state;
}
