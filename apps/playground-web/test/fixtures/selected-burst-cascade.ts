import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../../../../packages/rules-core/src";
import { ALL_CARDS } from "../../../../packages/card-data/src/generated-index";

const cards = ALL_CARDS as CardDefinition[];
const expandedCards = expandCardDefinitionsWithBackFaces(cards);
const definitions = new Map(expandedCards.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredBurstActions: buildBurstEffectLookup(expandedCards),
  getRegisteredMagicActions: buildMagicLookup(expandedCards),
  getRegisteredFieldCardEffectActions:
    buildFieldCardEffectLookup(expandedCards),
  getRegisteredTriggeredEffectActions:
    buildTriggeredEffectLookup(expandedCards),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(expandedCards),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(expandedCards),
};

export interface SelectedBurstCascadeIds {
  workingBurstCheckId: string;
  parentBurstCheckId: string;
  workingBurstInstanceId: string;
  parentBurstInstanceId: string;
  negateSourceInstanceId: string;
  attackerInstanceId: string;
}

export interface SelectedBurstCascadeFixture {
  /** State after Alice declares the real C14 stack effect; Bob has priority. */
  state: GameState;
  ids: SelectedBurstCascadeIds;
}

export interface SelectedBurstCascadeFixtureOptions {
  /** Omit Alice's suspended parent burst to exercise the one-stack control. */
  includeParent?: boolean;
  /** Swap Alice and Bob while preserving working/parent relative order. */
  reversePlayers?: boolean;
}

function card(cardNo: string): CardDefinition {
  const result = definitions.get(cardNo);
  if (!result) throw new Error(`Missing selected-burst fixture card ${cardNo}`);
  return result;
}

/**
 * Minimal attack-boundary fixture for seed 3391842970's interrupted cascade.
 * The attack, burst selection and both declaration windows use real legal actions,
 * so card kind, pending snapshots and registration metadata come from the engine.
 * It is not a full historical snapshot of the seeded game.
 */
export function buildSelectedBurstCascadeFixture(
  options: SelectedBurstCascadeFixtureOptions = {}
): SelectedBurstCascadeFixture {
  const alice = options.reversePlayers ? "bob" : "alice";
  const bob = options.reversePlayers ? "alice" : "bob";
  const includeParent = options.includeParent ?? true;
  const ids: SelectedBurstCascadeIds = {
    workingBurstCheckId: "fixture:burst:attack-after:working",
    parentBurstCheckId: "fixture:burst:own-attack:parent",
    workingBurstInstanceId: "fixture-working-bslh01-m03",
    parentBurstInstanceId: "fixture-parent-bsge01-m03",
    negateSourceInstanceId: "fixture-negate-bsge01-c14",
    attackerInstanceId: "fixture-attacker-bsth003-r01",
  };

  const initial = createEmptyGameState({
    playerIds: [alice, bob],
    playerOverrides: [
      { deckCount: 30, handCount: 1, reserveNormalCoreCount: 8 },
      { deckCount: 30, handCount: 0, reserveNormalCoreCount: 8 },
    ],
    cardInstances: [
      createCardInstance(card("BSLH01-M03"), {
        instanceId: ids.workingBurstInstanceId,
        ownerPlayerId: bob,
        zone: "burst",
      }),
      ...(includeParent
        ? [
            createCardInstance(card("BSGE01-M03"), {
              instanceId: ids.parentBurstInstanceId,
              ownerPlayerId: alice,
              zone: "burst",
            }),
          ]
        : []),
      createCardInstance(card("BSGE01-C14"), {
        instanceId: ids.negateSourceInstanceId,
        ownerPlayerId: alice,
        zone: "hand",
      }),
      createCardInstance(card("BSTH003-R01"), {
        instanceId: ids.attackerInstanceId,
        ownerPlayerId: alice,
        zone: "field",
        normalCoreCount: 5,
      }),
    ],
  });

  let current: GameState = {
    ...initial,
    turnNumber: 31,
    activePlayerId: alice,
    step: "attack",
    window: "none",
    setBurstStates: [
      { playerId: bob, cardInstanceId: ids.workingBurstInstanceId },
      ...(includeParent
        ? [{ playerId: alice, cardInstanceId: ids.parentBurstInstanceId }]
        : []),
    ],
  };
  current = applySelectedBurstCascadeAction(current, alice, "attack");
  if (current.preDeclarationStackWindow) {
    current = applySelectedBurstCascadeAction(
      current,
      bob,
      "pass_pre_declaration_stack"
    );
  }
  const workingCheck = current.pendingBurstChecks.find(
    (check) =>
      check.actingPlayerId === bob && check.eventKind === "attack_after"
  );
  const parentCheck = current.pendingBurstChecks.find(
    (check) =>
      check.actingPlayerId === alice && check.eventKind === "own_attack"
  );
  if (!workingCheck || (includeParent && !parentCheck))
    throw new Error("Attack did not produce expected burst checks");
  ids.workingBurstCheckId = workingCheck.checkId;
  if (parentCheck) ids.parentBurstCheckId = parentCheck.checkId;

  for (const [actor, checkId] of [
    [bob, ids.workingBurstCheckId],
    ...(includeParent ? [[alice, ids.parentBurstCheckId]] : []),
  ]) {
    const action = getLegalActions({
      state: current,
      actingPlayerId: actor!,
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" &&
        candidate.checkId === checkId
    );
    if (!action) throw new Error(`Burst selection not legal: ${checkId}`);
    current = applyLegalAction({ state: current, action, ...lookups }).state;
  }
  for (let i = 0; i < 12; i += 1) {
    if (
      current.stackWindow?.burstWindowKind === "effect_declaration" &&
      current.stackWindow.pendingStackAction?.cardInstanceId ===
        ids.workingBurstInstanceId &&
      current.stackWindow.priorityPlayerId === alice
    )
      break;
    const actor = current.stackWindow?.priorityPlayerId;
    if (!actor)
      throw new Error(
        `No priority before working burst declaration: ${JSON.stringify({ window: current.window, checks: current.pendingBurstChecks, cascade: current.pendingStackCascade })}`
      );
    current = applySelectedBurstCascadeAction(current, actor, "pass_stack");
  }
  const working = current.stackWindow?.pendingStackAction;
  const parent = current.pendingStackCascade?.remainingStacks[0];
  if (
    current.stackWindow?.burstWindowKind !== "effect_declaration" ||
    working?.cardInstanceId !== ids.workingBurstInstanceId ||
    working.burstSourceKind !== "spirit" ||
    working.burstPendingSnapshot?.checkId !== ids.workingBurstCheckId ||
    (includeParent &&
      (parent?.cardInstanceId !== ids.parentBurstInstanceId ||
        parent.burstSourceKind !== "spirit" ||
        parent.burstPendingSnapshot?.checkId !== ids.parentBurstCheckId))
  ) {
    throw new Error(
      `Unexpected legal burst declaration boundary: ${JSON.stringify({ working, parent })}`
    );
  }

  const actions = getLegalActions({
    state: current,
    actingPlayerId: alice,
    ...lookups,
  });
  const negateAction = actions.find(
    (action) =>
      action.kind === "use_magic" &&
      action.sourceInstanceId === ids.negateSourceInstanceId &&
      action.timing === "stack"
  );
  if (!negateAction) {
    throw new Error(
      `C14 stack response not legal: ${actions.map((action) => action.actionId).join(",")}`
    );
  }
  const declared = applyLegalAction({
    state: current,
    action: negateAction,
    ...lookups,
    // The minimal board has fewer reduction symbols than the full seeded game.
    // Pay its legal cost from the attacker to reproduce the same last-core
    // removal and pending-leave boundary, without copying unrelated seed state.
    paymentSources: [
      { kind: "card", instanceId: ids.attackerInstanceId, amount: 5 },
    ],
  }).state;
  if (
    declared.stackWindow?.pendingStackAction?.cardInstanceId !==
    ids.negateSourceInstanceId
  ) {
    throw new Error("C14 did not open the expected nested response stack");
  }
  return { state: declared, ids };
}

export function applySelectedBurstCascadeAction(
  state: GameState,
  playerId: string,
  kind: LegalAction["kind"]
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: playerId,
    ...lookups,
  }).find((candidate) => candidate.kind === kind);
  if (!action)
    throw new Error(
      `Missing ${kind} for ${playerId}; window=${state.window}; stack=${state.stackWindow?.priorityPlayerId ?? "none"}; actions=${getLegalActions(
        { state, actingPlayerId: playerId, ...lookups }
      )
        .map((candidate) => candidate.kind)
        .join(",")}`
    );
  return applyLegalAction({ state, action, ...lookups }).state;
}
