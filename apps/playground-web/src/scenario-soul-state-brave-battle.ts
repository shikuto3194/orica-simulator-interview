import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  type ApplyLegalActionOptions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";

/** Actual R13 declaration, responses and destruction, up to leave choices. */
export function buildSoulStateBraveBattleScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getCardDefinitionById = (id: string) =>
    allCards.find((c) => c.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(allCards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(allCards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredBurstActions: () => [],
  };
  const host = createCardInstance(getCardDefinitionById("BSGE01-CX01")!, {
    instanceId: "sc-soul-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 1,
    attachedChildrenIds: ["sc-soul-brave"],
  });
  const brave = createCardInstance(getCardDefinitionById("BSGE01-TX01(A)")!, {
    instanceId: "sc-soul-brave",
    ownerPlayerId: owner,
    zone: "field",
    attachedToInstanceId: host.instanceId,
  });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        host,
        brave,
        createCardInstance(getCardDefinitionById("BSTH08.5-R13")!, {
          instanceId: "sc-soul-accel",
          ownerPlayerId: opponent,
          zone: "hand",
        }),
      ],
      playerOverrides: ["alice", "bob"].map((id) =>
        id === owner
          ? { contractCardNo: host.definitionId }
          : { reserveNormalCoreCount: 8 }
      ),
    }),
    turnNumber: 6,
    activePlayerId: owner,
    step: "attack",
    window: "none",
  };
  const actions = () =>
    [owner, opponent].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
  const apply = (
    predicate: (action: LegalAction) => boolean,
    extra: Partial<ApplyLegalActionOptions> = {}
  ) => {
    const action = actions().find((a) => a.can && predicate(a));
    if (!action) throw new Error("Missing soul battle scenario action");
    state = applyLegalAction({ state, action, ...lookups, ...extra }).state;
  };
  const respond = () => {
    for (let n = 0; n < 30; n++) {
      const response = actions().find(
        (a) =>
          a.can &&
          ([
            "pass_stack",
            "pass_pre_declaration_stack",
            "resolve_pending_burst_check",
          ].includes(a.kind) ||
            (a.kind === "pass_battle_flash" &&
              state.activeAttack?.flashWindowState?.pendingStackAction != null))
      );
      if (!response) return;
      state = applyLegalAction({ state, action: response, ...lookups }).state;
    }
    throw new Error("Soul battle scenario responses did not settle");
  };
  apply((a) => a.kind === "attack" && a.sourceInstanceId === host.instanceId);
  respond();
  for (let n = 0; n < 10; n++) {
    if (!actions().some((a) => a.kind === "resolve_battle_immediate_effect"))
      break;
    apply((a) => a.kind === "resolve_battle_immediate_effect");
    respond();
  }
  apply((a) => a.kind === "open_battle_flash");
  apply(
    (a) => a.kind === "use_accel" && a.sourceInstanceId === "sc-soul-accel",
    { paymentSources: [{ kind: "reserve", amount: 5 }] }
  );
  respond();
  if (state.pendingEffectTargetSelection) {
    apply((a) => a.kind === "resolve_pending_effect_target", {
      targetInstanceIds: [host.instanceId],
    });
    respond();
  }
  if (state.pendingSoulStateReplacement?.cardInstanceId !== host.instanceId)
    throw new Error("R13 did not produce the soul choice");
  return state;
}
