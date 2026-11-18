import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  moveNormalCores,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** ライフ減少 → 手札宣言 → 応答 → バウンス → 転醒を実際のアクションで進める。 */
export function buildTx01RebirthScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const fieldPayment = ["field", "mixed", "mixed-low"].includes(
    params?.get("payment") ?? ""
  );
  const stopBeforePayment = params?.has("payment");
  const soulInReserve = params?.get("soul") === "reserve";
  const paymentReserve =
    params?.get("payment") === "mixed"
      ? 3
      : params?.get("payment") === "mixed-low"
        ? 1
        : 0;
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    definitions.find((d) => d.cardNo === id);
  const front = getCardDefinitionById("BSTH02.7-TX01(A)");
  const attacker = getCardDefinitionById("BSTH01-C04");
  if (!front || !attacker) throw new Error("TX01 scenario card missing");
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: buildBurstEffectLookup(definitions),
  };
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      ...(fieldPayment
        ? [
            createCardInstance(attacker, {
              instanceId: "tx01-payment-source",
              ownerPlayerId: owner,
              zone: "field",
              normalCoreCount: 3,
            }),
          ]
        : []),
      createCardInstance(front, {
        instanceId: "tx01-rebirth",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      createCardInstance(attacker, {
        instanceId: "tx01-bounce-target",
        ownerPlayerId: opponent,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  let state: GameState = {
    ...base,
    turnNumber: 4,
    activePlayerId: opponent,
    step: "attack",
    window: "battle_resolution",
    players: base.players.map((p) =>
      p.id === owner
        ? {
            ...p,
            countValue: 0,
            reserveNormalCoreCount: fieldPayment
              ? paymentReserve
              : params?.get("payment") === "reserve"
                ? 15
                : 6,
            trashNormalCoreCount: 3,
            reserveSoulCoreCount: soulInReserve ? 1 : 0,
            trashSoulCoreCount: soulInReserve ? 0 : 1,
            soulCoreLocation: { kind: soulInReserve ? "reserve" : "trash" },
          }
        : p
    ),
    activeAttack: {
      attackId: "attack:tx01-rebirth",
      primaryEntityId: "tx01-attacker",
      participantEntityIds: ["tx01-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: owner },
      blockAssignments: [
        { participantEntityId: "tx01-attacker", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["tx01-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
    battleEntities: [
      {
        entityId: "tx01-attacker",
        memberInstanceIds: ["tx01-bounce-target"],
        attackState: "attacking",
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
      },
    ],
  };
  state = executeBattleResolution({ state, ...lookups }).state;
  if (fieldPayment) {
    // ライフ減少で受け取った1個を支払い済みにし、報告盤面のリザーブ0を再現する。
    state = moveNormalCores(
      state,
      { kind: "reserve", playerId: owner },
      { kind: "trash", playerId: owner },
      1,
      getCardDefinitionById
    );
  }
  for (let i = 0; i < 30 && state.pendingCoreDistribution === null; i++) {
    if (stopBeforePayment && state.pendingStepOptionalChoice) return state;
    const actions = [owner, opponent].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const action =
      actions.find(
        (a) =>
          a.can &&
          (a.kind === "resolve_pending_burst_check" || a.kind === "pass_stack")
      ) ??
      actions.find(
        (a) =>
          a.can &&
          (a.kind === "declare_private_triggered_effect" ||
            a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "resolve_pending_effect_target" ||
            (a.kind === "resolve_pending_step_optional_choice" &&
              a.choice === "execute"))
      );
    if (!action) throw new Error("TX01 scenario action missing");
    state = applyLegalAction({
      state,
      action,
      ...lookups,
      ...(action.kind === "resolve_pending_effect_target"
        ? { targetInstanceIds: ["tx01-bounce-target"] }
        : {}),
    }).state;
  }
  const pending = state.pendingCoreDistribution;
  if (!pending?.targetTotalSelection)
    throw new Error("TX01 core placement missing");
  if (params?.get("fixed") === "4") {
    state = {
      ...state,
      pendingCoreDistribution: {
        ...pending,
        targetTotalSelection: {
          ...pending.targetTotalSelection,
          fixedTargetTotals: { "tx01-rebirth": 4 },
        },
      },
    };
  }
  return state;
}
