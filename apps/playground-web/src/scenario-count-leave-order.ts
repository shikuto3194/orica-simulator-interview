import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** BSGE01-TX01(B) の実際の宣言→応答→対象選択を経て、カウント誘発の直前へ。 */
export function buildCountLeaveOrderScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    definitions.find((d) => d.cardNo === id);
  const yu = getCardDefinitionById("BSGE01-CX01")!;
  const brave = getCardDefinitionById("BSGE01-TX01(B)")!;
  const mirage = getCardDefinitionById("BSGE01-C01")!;
  const lookups = {
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(definitions),
    getRegisteredBurstActions: buildBurstEffectLookup(definitions),
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        contractCardNo: yu.cardNo,
        countValue: id === owner ? 2 : 0,
        reserveNormalCoreCount: 6,
        deckCount: 10,
        handCount: id === owner ? 5 : 0,
      })),
      cardInstances: [
        createCardInstance(yu, {
          instanceId: "count-source",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
          attachedChildrenIds: ["count-brave"],
        }),
        createCardInstance(brave, {
          instanceId: "count-brave",
          ownerPlayerId: owner,
          zone: "field",
          attachedToInstanceId: "count-source",
        }),
        createCardInstance(mirage, {
          instanceId: "count-mirage",
          ownerPlayerId: owner,
          zone: "mirage",
        }),
        createCardInstance(yu, {
          instanceId: "count-victim",
          ownerPlayerId: opponent,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...Array.from({ length: 6 }, (_, i) =>
          createCardInstance(mirage, {
            instanceId: `count-card-${i}`,
            ownerPlayerId: owner,
            zone: i < 5 ? "hand" : "deck",
          })
        ),
      ],
    }),
    turnNumber: 3,
    activePlayerId: owner,
    step: "attack",
    window: "flash_before_block",
    mirageSetStates: [{ playerId: owner, cardInstanceId: "count-mirage" }],
    battleEntities: [
      {
        entityId: "count-attacker",
        memberInstanceIds: ["count-source", "count-brave"],
        attackState: "attacking",
        resolvedBp: 10000,
        resolvedSymbols: ["red", "yellow", "red"],
      },
    ],
    activeAttack: {
      attackId: "attack:count-leave",
      primaryEntityId: "count-attacker",
      participantEntityIds: ["count-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: opponent },
      blockAssignments: [
        { participantEntityId: "count-attacker", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["count-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
        consecutiveActiveUseCount: 0,
      },
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
    },
  };
  const actions = () =>
    [owner, opponent]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      )
      .filter((a) => a.can);
  const flash = actions().find(
    (a) =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === "count-source" &&
      a.sourceEffectInstanceId === "count-brave" &&
      a.registrationIndex === 1
  );
  if (!flash) throw new Error("Count-leave scenario: flash action missing");
  state = applyLegalAction({ state, action: flash, ...lookups }).state;
  for (let i = 0; i < 8; i++) {
    const action =
      actions().find((a) => a.kind === "resolve_pending_effect_target") ??
      actions().find(
        (a) => a.kind === "pass_battle_flash" || a.kind === "pass_stack"
      );
    if (!action) break;
    state = applyLegalAction({
      state,
      action,
      targetInstanceIds: ["count-victim"],
      ...lookups,
    }).state;
    if (
      state.pendingTriggeredEffects.some(
        (p) => p.eventKind === "count_decrease"
      ) ||
      state.pendingSoulStateReplacement
    )
      return state;
  }
  throw new Error("Count-leave scenario: count trigger missing");
}
