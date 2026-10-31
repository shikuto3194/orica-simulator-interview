import { describe, expect, it } from "vitest";
import { applyPatch } from "fast-json-patch";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { queuePendingReactionsFromTriggerEvents } from "../../../packages/rules-core/src/effect/trigger-system";
import {
  __initializeGameApiLookupsForTest,
  prepareRoomViewerState,
  prepareViewerStateSyncPayloads,
  replayActionEvent,
} from "../server/game-api";

function fixture() {
  const observer: CardDefinition = {
    cardNo: "TEST-VIEW-OBSERVER",
    name: "公開観測元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 3, bp: 3000 },
    ],
    effects: [
      {
        timing: { kind: "game_event", event: "exhaust", player: "self" },
        executionMode: "optional",
        condition: [
          {
            kind: "any_of",
            groups: [
              [{ kind: "min_level", value: 2 }],
              [{ kind: "trigger_colors", colors: ["purple"] }],
            ],
          },
        ],
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
  const ready: CardDefinition = {
    ...observer,
    cardNo: "TEST-VIEW-READY",
    name: "先行効果",
    effects: [
      {
        ...observer.effects![0]!,
        condition: undefined,
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "card_instance", instanceId: "observer" },
              amount: 1,
            },
          },
        ],
      },
    ],
  };
  const definitions = [observer, ready];
  const deps = {
    getCardDefinitionById: (id: string) =>
      definitions.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
  };
  const state = queuePendingReactionsFromTriggerEvents(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, voidNormalCoreCount: 20 },
          {},
        ],
        cardInstances: [
          createCardInstance(observer, {
            instanceId: "observer",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          }),
          createCardInstance(ready, {
            instanceId: "ready",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(ready, {
            instanceId: "secret-bob",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "main",
      turnNumber: 3,
    },
    [
      {
        eventKind: "exhaust",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "view-test",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "observer",
        amount: null,
      },
    ],
    "view-group",
    deps
  );
  return { state, definitions, deps };
}
function resolve(state: GameState, source: string) {
  const view = prepareRoomViewerState(state, "alice");
  const action = view.viewerLegalActions!.actions.find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === source
  )!;
  expect(action).toBeDefined();
  state = replayActionEvent(state, "alice", { actionId: action.actionId });
  for (let i = 0; state.stackWindow && i < 12; i++) {
    const actor = state.stackWindow.priorityPlayerId;
    const pass = prepareRoomViewerState(
      state,
      actor
    ).viewerLegalActions!.actions.find((a) => a.kind === "pass_stack")!;
    state = replayActionEvent(state, actor, { actionId: pass.actionId });
  }
  expect(state.stackWindow).toBeNull();
  return state;
}
describe("同時誘発のviewer配送契約", () => {
  it("full stateは内部イベント真偽を伏せ、本人の元stateの合法手だけを同梱する", async () => {
    const { state, definitions, deps } = fixture();
    await __initializeGameApiLookupsForTest(definitions);
    const raw = JSON.stringify(state);
    for (const actor of ["alice", "bob"])
      expect(prepareRoomViewerState(state, actor).viewerLegalActions).toEqual({
        actingPlayerId: actor,
        actions: getLegalActions({ state, actingPlayerId: actor, ...deps }),
      });
    const alice = prepareRoomViewerState(state, "alice");
    expect(
      alice.cardInstances.find((c) => c.instanceId === "secret-bob")!
        .definitionId
    ).toBe("_hidden_card_");
    expect(
      alice
        .viewerLegalActions!.actions.filter(
          (a) => a.kind === "resolve_pending_triggered_effect"
        )
        .map((a) => a.sourceInstanceId)
    ).toEqual(["ready"]);
    for (const actor of ["alice", "bob", null]) {
      const view = prepareRoomViewerState(state, actor);
      expect(JSON.stringify(view)).not.toContain("eventConditionResults");
      if (actor === null) expect(view.viewerLegalActions).toBeUndefined();
    }
    expect(JSON.stringify(state)).toBe(raw);
  });
  it("配送合法手で先行効果からLv候補へ進み、元stateで1回だけ実解決する", async () => {
    const { state: initial, definitions } = fixture();
    await __initializeGameApiLookupsForTest(definitions);
    let state = resolve(
      JSON.parse(JSON.stringify(initial)) as GameState,
      "ready"
    );
    const actions = prepareRoomViewerState(state, "alice").viewerLegalActions!
      .actions;
    expect(
      actions
        .filter((a) => a.kind === "resolve_pending_triggered_effect")
        .map((a) => a.sourceInstanceId)
    ).toEqual(["observer"]);
    state = resolve(state, "observer");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(state.players[0]!.voidNormalCoreCount).toBe(17);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(
      prepareRoomViewerState(state, "alice").viewerLegalActions
    ).toBeUndefined();
  });
  it("SSE patch/fullは同じversionの合法手へ置換し、相手/観戦者には内部値を出さない", async () => {
    const { state: initial, definitions } = fixture();
    await __initializeGameApiLookupsForTest(definitions);
    const state = resolve(initial, "ready");
    const prepared = prepareViewerStateSyncPayloads(
      state,
      8,
      ["alice", "bob", null],
      initial,
      7,
      new Set(["alice", "bob", null])
    );
    for (const actor of ["alice", "bob", null]) {
      const sync = prepared.get(actor)!;
      const delivered =
        "state" in sync.payload
          ? sync.payload.state
          : applyPatch(
              JSON.parse(
                JSON.stringify(prepareRoomViewerState(initial, actor))
              ),
              sync.payload.patch
            ).newDocument;
      expect(sync.version).toBe(8);
      expect(delivered).toEqual(prepareRoomViewerState(state, actor));
      expect(JSON.stringify(delivered)).not.toContain("eventConditionResults");
    }
  });
  it("偽造された配送合法手はserverの元stateの照合を通らない", async () => {
    const { state, definitions } = fixture();
    await __initializeGameApiLookupsForTest(definitions);
    const fake = {
      actionId: "forged",
      kind: "resolve_pending_triggered_effect",
      actingPlayerId: "alice",
      sourceInstanceId: "observer",
    } as LegalAction;
    const forged = {
      ...state,
      viewerLegalActions: { actingPlayerId: "alice", actions: [fake] },
    };
    expect(() =>
      replayActionEvent(forged, "alice", { actionId: fake.actionId })
    ).toThrow("not in legal actions");
    expect(
      prepareRoomViewerState(forged, "alice").viewerLegalActions!.actions
    ).not.toContainEqual(fake);
  });
});
