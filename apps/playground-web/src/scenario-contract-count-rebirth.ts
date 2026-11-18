import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";

/** 契約合体→カウント+2→任意の裏返しを実行して同時誘発を再現する。 */
export function buildContractCountRebirthScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const turnPlayer = params?.get("turn") === "opponent" ? opponent : owner;
  const defender = turnPlayer === owner ? opponent : owner;
  const afterBlock = params?.get("flash") === "after_block";
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
    getRegisteredBurstActions: () => [],
  };
  const card = (
    cardNo: string,
    instanceId: string,
    player: string,
    zone: "field" | "mirage" | "hand" | "deck",
    cores = 0
  ) =>
    createCardInstance(getCardDefinitionById(cardNo)!, {
      instanceId,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 1 : 0,
        handCount: id === owner ? 1 : 0,
        deckCount: 10,
        reserveNormalCoreCount: 5,
        soulCoreLocation: { kind: "reserve" },
      })),
      cardInstances: [
        card("BSGE01-CX01", "cc-host", owner, "field", 1),
        card("BSGE01-TR01(A)", "cc-brave", owner, "hand"),
        card("BSGE01-C09", "cc-mirage", owner, "mirage"),
        card("BSSA01-C01", "cc-target", opponent, "field", 1),
        ...Array.from({ length: 10 }, (_, i) =>
          card("BSGE01-C09", "cc-deck-" + i, owner, "deck")
        ),
      ],
    }),
    activePlayerId: turnPlayer,
    turnNumber: 3,
    step: "attack",
    window: afterBlock ? "flash_after_block" : "flash_before_block",
    mirageSetStates: [{ playerId: owner, cardInstanceId: "cc-mirage" }],
    battleEntities: [
      {
        entityId: "cc-attacker",
        memberInstanceIds: [turnPlayer === owner ? "cc-host" : "cc-target"],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
      {
        entityId: "cc-defender",
        memberInstanceIds: [turnPlayer === owner ? "cc-target" : "cc-host"],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: afterBlock ? "blocking" : "idle",
      },
    ],
    activeAttack: {
      attackId: "attack:contract-count-rebirth",
      primaryEntityId: "cc-attacker",
      participantEntityIds: ["cc-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: defender },
      blockAssignments: [
        {
          participantEntityId: "cc-attacker",
          blockedByEntityIds: afterBlock ? ["cc-defender"] : [],
        },
      ],
      symbolResolutionOrder: ["cc-attacker"],
      flashBeforeBlockCompleted: afterBlock,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: afterBlock ? "after_block" : "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
      },
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
    },
  };
  if (params?.get("mode") === "shared") {
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === owner ? { ...p, lifeNormalCoreCount: 4 } : p
      ),
      cardInstances: [
        ...state.cardInstances,
        card("BSTH01-X03", "shared-remilia", owner, "field", 1),
        card("BSTH01-R21", "shared-mansion", owner, "field", 1),
      ],
    };
    return queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          actingPlayerId: owner,
          eventKind: "summon",
          source: "action_resolution",
          chainId: "shared-summon",
          attackId: state.activeAttack!.attackId,
          relatedPlayerId: owner,
          relatedInstanceId: "shared-remilia",
          amount: 1,
        },
      ],
      undefined,
      lookups
    );
  }
  const actions = () =>
    [owner, opponent].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
  const act = (predicate: (a: LegalAction) => boolean, extra = {}) => {
    const action = actions().find(predicate);
    if (!action)
      throw new Error(
        "Contract-count-rebirth scenario: missing action; " +
          actions()
            .map((a) => a.kind)
            .join(",")
      );
    state = applyLegalAction({ state, action, ...lookups, ...extra }).state;
  };
  act((a) => a.kind === "contract_combine");
  act((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
  if (state.pendingEffectTargetSelection)
    act((a) => a.kind === "resolve_pending_effect_target", {
      targetInstanceIds: ["cc-host"],
    });
  act(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.eventKind === "brave_combined"
  );
  act((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
  if (params?.get("stage") === "flip-choice") return state;
  act(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" &&
      a.choice === "execute"
  );
  return state;
}
