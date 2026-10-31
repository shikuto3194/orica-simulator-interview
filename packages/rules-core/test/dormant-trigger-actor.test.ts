import { describe, expect, it } from "vitest";
import {
  advanceStep,
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getCurrentActorPlayerIds,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  pruneIllegalPendingTriggeredEffects,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";
import { getPendingTriggeredEffectsForResolution } from "../src/legal/legal-actions-availability";

function fixture(turnPlayer: string, ready = true, mixedPriorities = false) {
  const otherPlayer = turnPlayer === "alice" ? "bob" : "alice";
  const observer: CardDefinition = {
    cardNo: "TEST-DORMANT-OBSERVER",
    name: "休眠観測",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 3, bp: 3000 },
    ],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    effects: [
      {
        timing: { kind: "game_event", event: "exhaust", player: "self" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      },
    ],
  };
  if (mixedPriorities) {
    observer.effects = [
      observer.effects![0]!,
      {
        ...observer.effects![0]!,
        condition: undefined,
        triggerPriority: "immediate",
      },
    ];
  }
  const active: CardDefinition = {
    ...observer,
    cardNo: "TEST-DORMANT-ACTIVE",
    name: "先行反応",
    effects: [
      {
        ...observer.effects![0]!,
        triggerPriority: "normal",
        condition: undefined,
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "card_instance", instanceId: "observed" },
              amount: 1,
            },
          },
        ],
      },
    ],
  };
  const defs = [observer, active];
  const deps = {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  const initial: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map(() => ({
        reserveNormalCoreCount: 0,
        voidNormalCoreCount: 20,
      })),
      cardInstances: [
        createCardInstance(observer, {
          instanceId: "observed",
          ownerPlayerId: turnPlayer,
          zone: "field",
          normalCoreCount: 2,
          exhaustState: "exhausted",
        }),
        ...(ready
          ? [
              createCardInstance(active, {
                instanceId: "ready",
                ownerPlayerId: otherPlayer,
                zone: "field",
                normalCoreCount: 1,
                exhaustState: "exhausted",
              }),
            ]
          : []),
      ],
    }),
    activePlayerId: turnPlayer,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
  const state = queuePendingReactionsFromTriggerEvents(
    initial,
    initial.cardInstances.map((card) => ({
      eventKind: "exhaust" as const,
      actingPlayerId: card.controllerPlayerId,
      source: "action_resolution" as const,
      chainId: "dormant-actor-group",
      attackId: null,
      relatedPlayerId: card.controllerPlayerId,
      relatedInstanceId: card.instanceId,
      amount: null,
    })),
    "dormant-actor-group",
    deps
  );
  return { state, deps, otherPlayer };
}
type Deps = ReturnType<typeof fixture>["deps"];
function actions(state: GameState, deps: Deps, player: string) {
  return getLegalActions({ state, actingPlayerId: player, ...deps }).filter(
    (a) => a.can
  );
}
function act(
  state: GameState,
  deps: Deps,
  player: string,
  kind: LegalAction["kind"]
) {
  const action = actions(state, deps, player).find((a) => a.kind === kind);
  expect(action, JSON.stringify(state.log.slice(-5))).toBeDefined();
  expect(getCurrentActorPlayerIds(state, deps).has(player)).toBe(true);
  return applyLegalAction({ state, action: action!, ...deps }).state;
}
function passStacks(state: GameState, deps: Deps) {
  for (let n = 0; state.stackWindow && n < 8; n++) {
    state = act(state, deps, state.stackWindow.priorityPlayerId, "pass_stack");
  }
  expect(state.stackWindow).toBeNull();
  return state;
}

describe("休眠観測と解決可能誘発の操作権", () => {
  it.each(["alice", "bob"])(
    "turn=%s: 相手の単独解決後に休眠観測が発揮資格を得る",
    (turnPlayer) => {
      const { state: initial, deps, otherPlayer } = fixture(turnPlayer);
      expect(initial.pendingTriggeredEffects).toHaveLength(2);
      const dormant = initial.pendingTriggeredEffects.find(
        (p) => p.actingPlayerId === turnPlayer
      )!;
      expect(dormant.dormantSourceRegistrationKeys).toEqual(["observed#0"]);
      expect(
        getPendingTriggeredEffectsForResolution({ state: initial }).map(
          (p) => p.actingPlayerId
        )
      ).toEqual([otherPlayer]);
      expect(actions(initial, deps, turnPlayer)).toEqual([]);
      expect(actions(initial, deps, otherPlayer).map((a) => a.kind)).toEqual([
        "resolve_pending_triggered_effect",
      ]);
      expect(getCurrentActorPlayerIds(initial).has(otherPlayer)).toBe(true);
      const restored = JSON.parse(JSON.stringify(initial)) as GameState;
      let state = passStacks(
        act(restored, deps, otherPlayer, "resolve_pending_triggered_effect"),
        deps
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "observed")
          ?.normalCoreCount
      ).toBe(3);
      expect(
        getPendingTriggeredEffectsForResolution({ state }).map(
          (p) => p.actingPlayerId
        )
      ).toEqual([turnPlayer]);
      expect(
        state.pendingTriggeredEffects.find(
          (p) => p.actingPlayerId === turnPlayer
        )?.dormantSourceRegistrationKeys ?? []
      ).toEqual([]);
      state = passStacks(
        act(state, deps, turnPlayer, "resolve_pending_triggered_effect"),
        deps
      );
      expect(
        state.players.find((p) => p.id === turnPlayer)?.reserveNormalCoreCount
      ).toBe(2);
      expect(state.pendingTriggeredEffects).toEqual([]);
      expect(initial.pendingTriggeredEffects).toHaveLength(2);
    }
  );

  it.each(["alice", "bob"])(
    "turn=%s: 発揮可能候補0の群は通常pruneで空になり進行する",
    (turnPlayer) => {
      const { state, deps } = fixture(turnPlayer, false);
      expect(getPendingTriggeredEffectsForResolution({ state })).toEqual([]);
      expect(state.pendingTriggeredEffects).toEqual([]);
      expect([...getCurrentActorPlayerIds(state)]).toEqual([turnPlayer]);
      expect(
        advanceStep(
          state,
          deps.getCardDefinitionById,
          deps.getRegisteredTriggeredEffectActions
        ).step
      ).toBe("attack");
    }
  );

  it("休眠だけの即時誘発は通常優先度の有効な相手誘発を遮らない", () => {
    const { state, deps, otherPlayer } = fixture("alice");
    state.pendingTriggeredEffects = state.pendingTriggeredEffects.map((p) =>
      p.dormantSourceRegistrationKeys?.length
        ? { ...p, triggerPriority: "immediate" }
        : p
    );
    expect(getCurrentActorPlayerIds(state).has(otherPlayer)).toBe(true);
    expect(actions(state, deps, otherPlayer).map((a) => a.kind)).toEqual([
      "resolve_pending_triggered_effect",
    ]);
  });

  it.each(["registration", "whole-source", "host", "under-source"])(
    "%sの解決済み登録を活動中として数えない",
    (mode) => {
      const { state } = fixture("alice");
      const dormant = state.pendingTriggeredEffects.find(
        (p) => p.actingPlayerId === "alice"
      )!;
      const source = Object.values(dormant.timingSourceRegistrations!)[0]!;
      const key = mode === "under-source" ? "under#7" : "used#0";
      state.pendingTriggeredEffects = [
        {
          ...dormant,
          timingSourceRegistrations: {
            ...dormant.timingSourceRegistrations,
            [key]: { ...source, sourceInstanceId: "host" },
          },
          resolvedSourceRegistrationKeys:
            mode === "host"
              ? []
              : [
                  mode === "registration"
                    ? key
                    : mode === "under-source"
                      ? "under"
                      : "used",
                ],
          resolvedSourceInstanceIds: mode === "host" ? ["host"] : [],
        },
      ];
      expect(getPendingTriggeredEffectsForResolution({ state })).toEqual([]);
      expect(
        state.pendingTriggeredEffects[0]?.dormantSourceRegistrationKeys
      ).toEqual(["observed#0"]);
    }
  );

  it("同じpendingに活動中の未解決登録があれば休眠登録と一緒に保持する", () => {
    const { state } = fixture("alice");
    const dormant = state.pendingTriggeredEffects.find(
      (p) => p.actingPlayerId === "alice"
    )!;
    state.pendingTriggeredEffects = [
      {
        ...dormant,
        timingSourceRegistrations: {
          ...dormant.timingSourceRegistrations,
          "observed#1": Object.values(dormant.timingSourceRegistrations!)[0]!,
        },
      },
    ];
    expect(getPendingTriggeredEffectsForResolution({ state })).toHaveLength(1);
  });

  it("登録snapshotを持たない旧stateのキューを推測で除外しない", () => {
    const { state } = fixture("alice");
    state.pendingTriggeredEffects = state.pendingTriggeredEffects.map((p) => ({
      ...p,
      timingSourceRegistrations: undefined,
    }));
    expect(getPendingTriggeredEffectsForResolution({ state })).toHaveLength(2);
    expect([...getCurrentActorPlayerIds(state)]).toEqual(["alice"]);
  });

  it("休眠観測が途中で資格を得ても共通pruneが登録状態を更新する", () => {
    const { state, deps } = fixture("alice");
    state.cardInstances = state.cardInstances.map((c) =>
      c.instanceId === "observed" ? { ...c, normalCoreCount: 3 } : c
    );
    // prune前にも実条件を読む経路は新しい資格を反映する。
    expect(
      getPendingTriggeredEffectsForResolution({ state, ...deps })
    ).toHaveLength(2);
    expect([...getCurrentActorPlayerIds(state, deps)]).toEqual(["alice"]);
    expect(actions(state, deps, "alice")).toHaveLength(2);
    const updated = pruneIllegalPendingTriggeredEffects({ state, ...deps });
    expect(
      getPendingTriggeredEffectsForResolution({ state: updated })
    ).toHaveLength(2);
    expect(
      actions(updated, deps, "alice").every(
        (a) => a.kind === "select_pending_to_resolve"
      )
    ).toBe(true);
    expect(actions(updated, deps, "alice")).not.toHaveLength(0);
    expect([...getCurrentActorPlayerIds(updated)]).toEqual(["alice"]);
  });

  it.each(["alice", "bob"])(
    "turn=%s: 同一カードの別優先度登録を休眠bucketの候補に数えない",
    (turnPlayer) => {
      const { state, deps } = fixture(turnPlayer, true, true);
      expect(state.pendingTriggeredEffects).toHaveLength(3);
      const immediate = state.pendingTriggeredEffects.find(
        (p) => p.triggerPriority === "immediate"
      )!;
      expect(Object.keys(immediate.timingSourceRegistrations!)).toEqual([
        "observed#1",
      ]);
      const dormant = state.pendingTriggeredEffects.find(
        (p) => p.dormantSourceRegistrationKeys?.length
      )!;
      expect(Object.keys(dormant.timingSourceRegistrations!)).toEqual([
        "observed#0",
      ]);
      const candidates = getPendingTriggeredEffectsForResolution({ state });
      expect(candidates).toHaveLength(2);
      expect(candidates).not.toContain(dormant);
      expect(
        getPendingTriggeredEffectsForResolution({ state, ...deps })
      ).toEqual(candidates);
      expect(getCurrentActorPlayerIds(state, deps).has(turnPlayer)).toBe(true);
      expect(
        actions(state, deps, turnPlayer === "alice" ? "bob" : "alice")
      ).toEqual([]);
      expect(actions(state, deps, turnPlayer).map((a) => a.kind)).toEqual([
        "resolve_pending_triggered_effect",
      ]);

      // 旧保存形式は全bucketの登録表を共有していた。定義参照経路は旧stateも再評価する。
      const legacy = {
        ...state,
        pendingTriggeredEffects: state.pendingTriggeredEffects.map((p) => ({
          ...p,
          timingSourceRegistrations: Object.assign(
            {},
            ...state.pendingTriggeredEffects.map(
              (other) => other.timingSourceRegistrations
            )
          ),
        })),
      };
      expect(
        getPendingTriggeredEffectsForResolution({ state: legacy, ...deps })
      ).toHaveLength(2);
      expect(getCurrentActorPlayerIds(legacy, deps).has(turnPlayer)).toBe(true);
      expect(
        actions(legacy, deps, turnPlayer === "alice" ? "bob" : "alice")
      ).toEqual([]);
      const afterImmediate = passStacks(
        act(state, deps, turnPlayer, "resolve_pending_triggered_effect"),
        deps
      );
      expect(
        getPendingTriggeredEffectsForResolution({
          state: afterImmediate,
          ...deps,
        }).map((p) => p.actingPlayerId)
      ).toEqual([turnPlayer === "alice" ? "bob" : "alice"]);
    }
  );
});
