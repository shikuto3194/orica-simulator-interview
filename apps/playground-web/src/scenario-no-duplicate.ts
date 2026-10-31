import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  buildTriggeredEffectLookup,
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingLeave,
  queuePendingReactionsFromTriggerEvents,
} from "@orica/rules-core";

/** 提供snapshotの魂状態/スピリット状態のリムルを最小盤面にした回帰。 */
export function buildNoDuplicateScenario(cards: CardDefinition[]): GameState {
  const rimuru = cards.find((c) => c.cardNo === "BSTS01-CX01")!;
  const summoned = cards.find((c) => c.cardNo === "BSTS01-C02")!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(rimuru, {
        instanceId: "rimuru-soul",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      }),
      createCardInstance(rimuru, {
        instanceId: "rimuru-spirit",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(summoned, {
        instanceId: "summoned",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        createCardInstance(summoned, {
          instanceId: `deck-${i}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      ),
    ],
    playerOverrides: [
      { soulStateInstanceIds: ["rimuru-soul"], countValue: 4 },
      {},
    ],
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...state, step: "main", turnNumber: 6, activePlayerId: "alice" },
    [
      {
        actingPlayerId: "alice",
        eventKind: "summon",
        source: "action_resolution",
        chainId: "no-duplicate-summon",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "summoned",
        amount: null,
        actionKind: "summon",
      },
    ],
    undefined,
    {
      getCardDefinitionById: (id) => cards.find((c) => c.cardNo === id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
      getRegisteredBurstActions: () => undefined,
    }
  );
}

/** 2026-09-22 snapshot: card-6 の召喚に消滅待機中の card-1 が誤反応した旧スタック。 */
export function buildRimuruPendingLeaveScenario(
  cards: CardDefinition[],
  legacyStack = true
): GameState {
  const rimuru = cards.find((card) => card.cardNo === "BSTS01-CX01")!;
  const options = {
    getCardDefinitionById: (id: string) =>
      cards.find((card) => card.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: ["card-1", "card-6"].map((instanceId) =>
      createCardInstance(rimuru, {
        instanceId,
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    ),
    playerOverrides: [{ countValue: 4 }, {}],
  });
  const markWaiting = (current: GameState) =>
    queuePendingLeave({
      state: current,
      instanceId: "card-1",
      kind: "vanish",
      cause: "state_based_action",
      causePlayerId: "alice",
      chainId: "snapshot-rimuru-vanish",
      causedByEffectSourceInstanceId: "card-6",
    });
  state = queuePendingReactionsFromTriggerEvents(
    legacyStack ? state : markWaiting(state),
    [
      {
        actingPlayerId: "alice",
        eventKind: "summon",
        source: "action_resolution",
        chainId: "snapshot-rimuru-summon",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "card-6",
        amount: null,
        fromZone: "trash",
        actionKind: "summon",
      },
    ],
    undefined,
    options
  );
  if (!legacyStack) return state;
  // 新規誘発は拒否するため、旧版が保存した状態を宣言後の待機入りで再現する。
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...options,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      candidate.sourceInstanceId === "card-1"
  )!;
  return markWaiting(applyLegalAction({ state, action, ...options }).state);
}
