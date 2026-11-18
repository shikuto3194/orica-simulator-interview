import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** BSRK01-C06: バースト発動宣言へのスタック。source/step/active/stageで境界を確認する。 */
export function buildC06StackScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const getCardDefinitionById = (id: string) =>
    allCards.find((c) => c.cardNo === id);
  const c06 = getCardDefinitionById("BSRK01-C06")!;
  const burst = getCardDefinitionById("BSTS01-M01")!;
  const target = getCardDefinitionById("BSTH01-C04")!;
  const source = params?.get("source") === "set_aside" ? "set_aside" : "hand";
  const burstSource = params?.get("burstSource") === "hand" ? "hand" : "burst";
  const step = params?.get("step") === "main" ? "main" : "attack";
  const lookups = {
    getCardDefinitionById,
    getRegisteredMagicActions: buildMagicLookup(allCards),
    getRegisteredBurstActions: buildBurstEffectLookup(allCards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10, countValue: 5 },
      ],
      cardInstances: [
        createCardInstance(c06, {
          instanceId: "c06",
          ownerPlayerId: "alice",
          zone: source,
        }),
        createCardInstance(burst, {
          instanceId: "c06-burst",
          ownerPlayerId: "bob",
          zone: burstSource,
        }),
        createCardInstance(target, {
          instanceId: "c06-alice-target",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(target, {
          instanceId: "c06-bob-target",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    turnNumber: 3,
    step,
    activePlayerId: params?.get("active") === "bob" ? "bob" : "alice",
    setBurstStates:
      burstSource === "burst"
        ? [{ playerId: "bob", cardInstanceId: "c06-burst" }]
        : [],
    // 候補タイミングの境界検証では main に同じ応答窓を置く。
    pendingBurstChecks: [
      {
        checkId: "c06-check",
        actingPlayerId: "bob",
        eventKind: "attack_after",
        source: "action_resolution",
        chainId: "scenario:scenario-bsrk01-c06.ts:76",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "c06-alice-target",
        amount: 0,
        step,
        window: "none",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
  const action = getLegalActions({
    state,
    actingPlayerId: "bob",
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_pending_burst_check" &&
      a.sourceInstanceId === "c06-burst"
  );
  if (!action) throw new Error("C06 burst declaration missing");
  state = applyLegalAction({ state, action, ...lookups }).state;
  if (params?.get("stage") === "effect") {
    const pass = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    if (!pass) throw new Error("C06 activation response missing");
    state = applyLegalAction({ state, action: pass, ...lookups }).state;
  }
  return state;
}
