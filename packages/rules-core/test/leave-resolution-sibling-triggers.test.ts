import type { TargetSpec } from "../src/dsl-types";
import { sanitizeStateForViewer } from "../src/state-sanitize";
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  finalizeEffectResolution,
  getLegalActions,
  queuePendingLeave,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
  type Effect,
  type LegalAction,
} from "../src";

const target: TargetSpec = {
  kind: "filter",
  player: "opponent",
  filter: { category: ["spirit"] },
  count: 1,
};
const baseDef: CardDefinition = {
  cardNo: "TEST-SIBLING-SOURCE",
  name: "原因効果",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const hostDef: CardDefinition = {
  ...baseDef,
  cardNo: "TEST-SIBLING-HOST",
  name: "被離脱契約",
  keywordTags: ["contract"],
};
const observerDef: CardDefinition = {
  ...baseDef,
  cardNo: "TEST-SIBLING-OBSERVER",
  name: "増減誘発",
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: ["count_increase", "count_decrease", "increase_hand"],
      },
      executionMode: "optional",
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
    },
  ],
};
const privateDef: CardDefinition = {
  ...observerDef,
  cardNo: "TEST-SIBLING-PRIVATE",
  effects: observerDef.effects!.map((effect) => ({
    ...effect,
    applicability: { zone: "hand" },
  })),
};
const defs = [baseDef, hostDef, observerDef, privateDef];
const lookups = {
  getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function setup(
  action: Effect["steps"][number]["action"],
  event: "count_increase" | "count_decrease" | "draw" = "count_decrease",
  afterTriggers = false,
  options: { privateCount?: number; plain?: boolean; pause?: boolean } = {}
) {
  const before = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue: 2 }, { contractCardNo: hostDef.cardNo }],
    cardInstances: [
      createCardInstance(baseDef, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      ...(options.privateCount
        ? Array.from({ length: options.privateCount }, (_, i) =>
            createCardInstance(privateDef, {
              instanceId: `private-${i}`,
              ownerPlayerId: "alice",
              zone: "hand",
            })
          )
        : [
            createCardInstance(observerDef, {
              instanceId: "observer",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
              exhaustState: "exhausted",
            }),
          ]),
      createCardInstance(baseDef, {
        instanceId: "draw-card",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
      createCardInstance(hostDef, {
        instanceId: "victim",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  if (options.plain) {
    before.players[1]!.contractCardNo = null;
    before.cardInstances.find((c) => c.instanceId === "victim")!.definitionId =
      baseDef.cardNo;
  }
  const chainId = "sibling-effect";
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action:
          event === "draw"
            ? { kind: "draw", player: "self", count: 1 }
            : { kind: event, player: "self", amount: 1 },
      },
      {
        action,
        connector: "sequential",
        ...(options.pause ? { executionMode: "optional" as const } : {}),
      },
    ],
  };
  if (afterTriggers)
    effect.steps.push({
      connector: "after_triggers",
      action: { kind: "recover", target: { kind: "self" } },
    });
  baseDef.effects = [effect];
  const after = executeEffect({
    state: before,
    effect,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    chainId,
    ...lookups,
  });
  return finalizeEffectResolution({
    state: after,
    beforeState: before,
    chainId,
    endLogs: [],
    actingPlayerId: "alice",
    causedBySourceInstanceId: "source",
    ...lookups,
  });
}
const actions = (state: GameState) =>
  ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    )
    .filter((a) => a.can);
function act(
  state: GameState,
  kind: LegalAction["kind"],
  skipOptionalEffect = false
) {
  const action = actions(state).find(
    (a) => a.kind === kind && !("skipOnly" in a && a.skipOnly)
  );
  expect(action, JSON.stringify(actions(state))).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    skipOptionalEffect,
    ...lookups,
  }).state;
}
describe("同じ効果の別処理から生じた誘発も離脱選択の前に解決する (04/04d)", () => {
  it("複数 step の派生誘発は、この効果発揮後の境界でも離脱より先に解決する", () => {
    let state = setup({ kind: "destroy", target }, "count_decrease", true);
    expect(state.pendingSoulStateReplacement).toBeNull();
    expect(
      state.pendingTriggeredEffects.some(
        (p) => p.eventKind === "count_decrease"
      )
    ).toBe(true);
    state = act(state, "resolve_pending_triggered_effect");
    state = act(state, "pass_stack");
    expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe("victim");
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")?.exhaustState
    ).toBe("exhausted");
    const decline = actions(state).find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" && a.choice === "decline"
    )!;
    state = applyLegalAction({ state, action: decline, ...lookups }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "victim")?.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")?.exhaustState
    ).toBe("recovered");
  });
  it.each([false, true])(
    "途中の任意選択をJSON保存・復元しても区間を保持し、誘発を二重化しない (辞退=%s)",
    (skip) => {
      let state = setup({ kind: "destroy", target }, "count_decrease", true, {
        pause: true,
      });
      expect(state.pendingStepOptionalChoice).not.toBeNull();
      expect(
        state.pendingStepOptionalChoice?.continuation.stepContext
          .resolutionSegmentBeforeState
      ).toBeDefined();
      expect(
        JSON.stringify(sanitizeStateForViewer(state, "alice"))
      ).not.toContain("resolutionSegmentBeforeState");
      state = JSON.parse(JSON.stringify(state));
      const accept = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      )!;
      expect(accept, JSON.stringify(actions(state))).toBeDefined();
      state = applyLegalAction({ state, action: accept, ...lookups }).state;
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(
        state.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "count_decrease"
        )
      ).toHaveLength(1);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")?.exhaustState
      ).toBe("exhausted");
      state = act(state, "resolve_pending_triggered_effect", skip);
      if (!skip) {
        expect(state.pendingSoulStateReplacement).toBeNull();
        expect(
          state.cardInstances.find((c) => c.instanceId === "source")
            ?.exhaustState
        ).toBe("exhausted");
        state = act(state, "pass_stack");
      }
      expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe("victim");
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")?.exhaustState
      ).toBe("exhausted");
      const decline = actions(state).find(
        (a) =>
          a.kind === "resolve_soul_state_replacement" && a.choice === "decline"
      )!;
      state = applyLegalAction({ state, action: decline, ...lookups }).state;
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(state.pendingAfterTriggersContinuations).toHaveLength(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")?.exhaustState
      ).toBe("recovered");
    }
  );
  for (const event of ["count_increase", "count_decrease", "draw"] as const) {
    it.each([false, true])(
      `${event}: 誘発の宣言・解決／辞退まで待つ (辞退=%s)`,
      (skip) => {
        let state = setup({ kind: "destroy", target }, event);
        expect(state.pendingTriggeredEffects.length).toBeGreaterThan(0);
        expect(state.pendingSoulStateReplacement).toBeNull();
        expect(state.pendingLeaveEntities).toHaveLength(1);
        state = act(state, "resolve_pending_triggered_effect", skip);
        if (!skip) expect(state.pendingSoulStateReplacement).toBeNull();
        if (state.stackWindow) state = act(state, "pass_stack");
        expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe(
          "victim"
        );
      }
    );
  }
});

describe("離脱の種類・非公開宣言・無関係な離脱の境界", () => {
  const leaves: [string, Effect["steps"][number]["action"], string][] = [
    ["破壊", { kind: "destroy", target }, "trash"],
    ["手札戻し", { kind: "bounce", target, destination: "hand" }, "hand"],
    ["除外", { kind: "remove_from_game", target }, "removed_from_game"],
    [
      "コア不足消滅",
      {
        kind: "core_move",
        from: { kind: "field", target },
        to: { kind: "reserve", player: "opponent" },
        amount: 1,
      },
      "trash",
    ],
  ];
  it.each(leaves)(
    "%s: 契約カードでなくても誘発の辞退まで実移動しない",
    (_name, action, destination) => {
      let state = setup(action, "count_decrease", false, { plain: true });
      expect(
        state.cardInstances.find((c) => c.instanceId === "victim")?.zone
      ).toBe("field");
      expect(state.pendingLeaveEntities).toHaveLength(1);
      state = act(state, "resolve_pending_triggered_effect", true);
      expect(
        state.cardInstances.find((c) => c.instanceId === "victim")?.zone
      ).toBe(destination);
      expect(state.pendingLeaveEntities).toHaveLength(0);
    }
  );
  it("複数の非公開宣言を待ち、宣言済みの deferred が解決するまで魂状態を選ばない", () => {
    let state = setup({ kind: "destroy", target }, "count_decrease", false, {
      privateCount: 2,
    });
    expect(state.pendingPrivateDeclarations).toHaveLength(2);
    expect(state.pendingSoulStateReplacement).toBeNull();
    state = act(state, "declare_private_triggered_effect");
    expect(state.pendingSoulStateReplacement).toBeNull();
    expect(state.pendingDeferredTriggeredEffects).toHaveLength(1);
    state = act(state, "skip_private_triggered_effect");
    expect(state.pendingSoulStateReplacement).toBeNull();
    state = act(state, "resolve_pending_triggered_effect");
    expect(state.pendingSoulStateReplacement).toBeNull();
    state = act(state, "pass_stack");
    expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe("victim");
  });
  it("別の解決区間の離脱は、既存のカウント誘発を待たない", () => {
    const before = setup({ kind: "destroy", target });
    const chainId = "unrelated-effect";
    const state = finalizeEffectResolution({
      state: queuePendingLeave({
        state: before,
        instanceId: "source",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId,
      }),
      beforeState: before,
      chainId,
      actingPlayerId: "bob",
      endLogs: [],
      ...lookups,
    });
    expect(state.pendingTriggeredEffects).toHaveLength(1);
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")?.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((c) => c.instanceId === "victim")?.zone
    ).toBe("field");
    expect(state.pendingSoulStateReplacement).toBeNull();
  });
});
