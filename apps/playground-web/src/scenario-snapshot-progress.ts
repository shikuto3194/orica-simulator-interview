import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  sanitizeStateForViewer,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { expandCardDefinitionsWithBackFaces } from "../../../packages/rules-core/src/effect/structured-effect-registrations";
import { queuePendingReactionsFromTriggerEvents } from "../../../packages/rules-core/src/effect/trigger-system";

/** 2026-10-03 の2件を、実カードと操作経路で再現する。 */
export function buildSnapshotProgressScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(cards);
  const getCardDefinitionById = (id: string) =>
    definitions.find((c) => c.cardNo === id);
  const deps = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  const make = (
    no: string,
    instanceId: string,
    zone: "hand" | "field" | "deck",
    normalCoreCount = 0,
    player = owner
  ) =>
    createCardInstance(getCardDefinitionById(no)!, {
      instanceId,
      ownerPlayerId: player,
      zone,
      normalCoreCount,
    });
  let state: GameState;
  const actions = (player = owner) =>
    getLegalActions({ state, actingPlayerId: player, ...deps });
  const act = (predicate: (a: LegalAction) => boolean, player = owner) => {
    const action = actions(player).find(predicate);
    if (!action)
      throw new Error(
        `snapshot-progress: action missing (${actions(player)
          .map((a) => a.kind)
          .join(",")})`
      );
    state = applyLegalAction({ state, action, ...deps }).state;
  };
  if (params?.get("mode") === "drives") {
    const fullAfterFirst = params?.get("host") === "siren";
    const host = make(
      fullAfterFirst ? "BSAZ02-C03" : "BSAZ02-TX01(B)",
      "host",
      "field",
      3
    );
    const oldDrive = make("BSAZ02-C10", "old-drive", "field");
    host.underCards = fullAfterFirst
      ? []
      : [
          {
            cardInstanceId: oldDrive.instanceId,
            role: "text_role",
            roleTag: "アルドノアドライブ",
          },
        ];
    oldDrive.attachedToInstanceId = host.instanceId;
    oldDrive.zoneRoleName = "aldnoah-drive";
    state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            host,
            ...(fullAfterFirst ? [] : [oldDrive]),
            ...(fullAfterFirst
              ? []
              : [make("BSAZ02-X05", "nexus", "field", 1)]),
            make("BSAZ02-C10", "drive-1", "hand"),
            make("BSAZ02-C10", "drive-2", "hand"),
            make("BSAZ02-C01", "deck-1", "deck"),
            make("BSAZ02-C01", "deck-2", "deck"),
          ],
          playerOverrides: ["alice", "bob"].map((id) => ({
            reserveNormalCoreCount: 0,
            voidNormalCoreCount: 10,
            handCount: id === owner ? 2 : 0,
            deckCount: id === owner ? 2 : 0,
          })),
        }),
        activePlayerId: owner,
        turnNumber: 9,
        step: "main",
      },
      getCardDefinitionById
    );
    state = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          eventKind: fullAfterFirst ? "summon" : "rebirth",
          actingPlayerId: owner,
          relatedPlayerId: owner,
          relatedInstanceId: "host",
          amount: null,
          chainId: "scenario:drive-rebirth",
          attackId: null,
          source: "action_resolution",
        },
      ],
      undefined,
      deps
    );
    for (let i = 0; i < 2; i++)
      act((a) => a.kind === "declare_private_triggered_effect");
    if (params?.get("stage") === "select") return state;
    const firstId = state.pendingTriggeredEffects.find(
      (p) => p.declaredSourceInstanceId === "drive-1"
    )!.pendingId;
    act(
      (a) => a.kind === "select_pending_to_resolve" && a.pendingId === firstId
    );
    act(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "drive-1"
    );
    if (params?.get("stage") !== "respond")
      act((a) => a.kind === "pass_stack", opponent);
  } else {
    const host = make("BSGE01-R02", "payer", "field", 4);
    const brave = make("BSGE01-C05", "brave", "field");
    host.attachedChildrenIds = ["brave"];
    brave.attachedToInstanceId = "payer";
    brave.zoneRoleName = "brave";
    state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          host,
          brave,
          make("BSTH01-C21", "magic", "hand"),
          make("BSTH01-C01", "attacker", "field", 1, opponent),
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 0 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      activePlayerId: opponent,
      turnNumber: 7,
      step: "attack",
      window: "flash_before_block",
      battleEntities: [
        {
          entityId: "attack-entity",
          memberInstanceIds: ["attacker"],
          attackState: "attacking",
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
        },
      ],
      activeAttack: {
        attackId: "snapshot-attack",
        primaryEntityId: "attack-entity",
        participantEntityIds: ["attack-entity"],
        groupMode: "single",
        target: { kind: "player", playerId: owner },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: owner,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: owner,
          pendingStackAction: null,
        },
      },
    };
    const use = actions().find((a) => a.kind === "use_magic");
    if (use?.kind !== "use_magic")
      throw new Error("snapshot-progress: magic missing");
    state = applyLegalAction({
      state,
      action: use,
      ...deps,
      paymentSources: [
        { kind: "card", instanceId: "payer", amount: use.finalCost },
      ],
    }).state;
    act((a) => a.kind === "pass_battle_flash", opponent);
    act((a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1);
  }
  return params?.get("delivered") === "1"
    ? sanitizeStateForViewer(state, owner)
    : state;
}
