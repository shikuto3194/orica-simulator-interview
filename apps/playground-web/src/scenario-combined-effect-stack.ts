import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** TR01(B)転醒時の宣言→BSTH08-C01のスタック→バウンスを実行し、離脱選択へ。 */
export function buildCombinedEffectStackScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    definitions.find((d) => d.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
  const card = (
    cardNo: string,
    instanceId: string,
    player: string,
    zone: "field" | "hand",
    normalCoreCount = 0
  ) =>
    createCardInstance(getCardDefinitionById(cardNo)!, {
      instanceId,
      ownerPlayerId: player,
      zone,
      normalCoreCount,
    });
  const baseState = rebuildContinuousEffectsFromField(
    createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 4 : 0,
        reserveNormalCoreCount: 6,
      })),
      cardInstances: [
        {
          ...card("BSGE01-R01", "combined-host", owner, "field", 1),
          attachedChildrenIds: ["combined-brave"],
        },
        {
          ...card("BSGE01-TR01(B)", "combined-brave", owner, "field"),
          originalDefinitionId: "BSGE01-TR01(A)",
          attachedToInstanceId: "combined-host",
        },
        card("BSTH08-C01", "stack-response", opponent, "hand"),
        card("BSTH01-C01", "target-a", opponent, "field", 1),
        card("BSTH01-C01", "target-b", opponent, "field", 1),
      ],
    }),
    getCardDefinitionById
  );
  let state: GameState = {
    ...baseState,
    turnNumber: 6,
    activePlayerId: opponent,
    step: "attack",
    window: "flash_before_block",
    battleEntities: [
      {
        entityId: "attacker",
        memberInstanceIds: ["target-a"],
        attackState: "attacking",
        resolvedBp: 1000,
        resolvedSymbols: ["red"],
      },
    ],
    activeAttack: {
      attackId: "combined-stack-attack",
      primaryEntityId: "attacker",
      participantEntityIds: ["attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: owner },
      blockAssignments: [
        { participantEntityId: "attacker", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
      },
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
    },
    pendingTriggeredEffects: [
      {
        pendingId: "combined-brave-rebirth",
        actingPlayerId: owner,
        eventKind: "rebirth",
        event: {
          family: "state_change",
          actionKind: "rebirth",
          validationMode: "require_related_instance_on_field",
        },
        source: "action_resolution",
        chainId: "scenario:scenario-combined-effect-stack.ts:112",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "combined-brave",
        amount: null,
        step: "attack",
        window: "flash_before_block",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
  const act = (kind: string, player: string) => {
    const action = getLegalActions({
      state,
      actingPlayerId: player,
      ...lookups,
    }).find(
      (a) =>
        a.kind === kind &&
        a.can &&
        (a.kind !== "use_magic" || a.timing === "stack")
    );
    if (!action) throw new Error(`Combined-effect scenario: missing ${kind}`);
    state = applyLegalAction({
      state,
      action,
      ...(action.kind === "use_magic"
        ? {
            paymentSources: [
              { kind: "reserve" as const, amount: action.finalCost },
            ],
          }
        : {}),
      ...(action.kind === "resolve_pending_effect_target"
        ? { targetInstanceIds: ["combined-host"] }
        : {}),
      ...lookups,
    }).state;
  };
  act("resolve_pending_triggered_effect", owner);
  act("use_magic", opponent);
  act("pass_battle_flash", owner);
  act("resolve_pending_effect_target", opponent);
  return state;
}
