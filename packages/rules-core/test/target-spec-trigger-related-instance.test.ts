import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
/**
 * TargetSpec.kind="trigger_related_instance" engine extension (2026-06-22)。
 *
 * 第三者 game_event 観測効果 (battle_end / advent / rebirth / brave_combined / state_change 系)
 * の主語 Y 自身を 1 体だけ対象に取る TargetSpec 変種。`pendingTriggeredEffect.relatedInstanceId`
 * を `executeEffect` の `triggerRelatedInstanceId` 経由で `stepCtx.triggerRelatedInstanceId`
 * に注入し、`resolveTargetSpec` が `zone === "field"` かつ `pendingLeaveKind === null` のときだけ
 * その 1 体を返す。
 *
 * 関連 audit row: ENGINE-target-spec-trigger-related-instance (resolved 2026-06-22)。
 * 未着地 follow-up: BSTH05-X02 (per-Y ターン1回 + grandwalker-only filter の 2 件 blocker
 * のため card-data 側は stub 据置)。
 *
 * 本テストは engine 拡張そのものを合成 effect で検証する (実カードの効果着地は別件)。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, Effect, GameState } from "../src";
import {
  collectTriggerEventsFromStateDelta,
  queuePendingReactionsRawForTesting,
} from "../src/effect/trigger-system";

const PROBE: CardDefinition = {
  cardNo: "TEST-PROBE-SOURCE",
  name: "テストプローブソース",
  printedCategory: "nexus",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: ["green"],
  tribe: "テスト",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

const TARGET: CardDefinition = {
  cardNo: "TEST-PROBE-TARGET",
  name: "テストプローブ対象",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: ["green"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  tribe: "テスト",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

const BRAVE: CardDefinition = {
  cardNo: "TEST-PROBE-BRAVE",
  name: "テストプローブブレイヴ",
  printedCategory: "brave",
  colors: ["green"],
  cost: 1,
  reductionSymbols: ["green"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  tribe: "テスト",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

const DEFS = new Map<string, CardDefinition>([
  [PROBE.cardNo, PROBE],
  [TARGET.cardNo, TARGET],
  [BRAVE.cardNo, BRAVE],
]);
const getCardDefinitionById = (id: string) => DEFS.get(id);

const RECOVER_TRIGGER_RELATED_EFFECT: Effect = {
  timing: {
    kind: "game_event",
    player: "self",
    event: "battle_end",
  },
  steps: [
    {
      action: {
        kind: "recover",
        target: { kind: "trigger_related_instance" },
      },
    },
  ],
};

const RECOVER_TRIGGER_RELATED_COMBINED_HOST_EFFECT: Effect = {
  timing: {
    kind: "game_event",
    player: "self",
    event: "brave_combined",
  },
  steps: [
    {
      action: {
        kind: "recover",
        target: { kind: "trigger_related_combined_host" },
      },
    },
  ],
};

const RECOVER_SELF_SPIRIT_TRIGGER_RELATED_COMBINED_HOST_EFFECT: Effect = {
  timing: {
    kind: "game_event",
    player: "self",
    event: "brave_combined",
  },
  steps: [
    {
      action: {
        kind: "recover",
        target: {
          kind: "trigger_related_combined_host",
          player: "self",
          filter: { category: ["spirit"] },
        },
      },
    },
  ],
};

function setupState(opts?: {
  targetZone?: "field" | "trash";
  pendingLeave?: boolean;
}): { state: GameState; sourceId: string; targetId: string; otherId: string } {
  const source = createCardInstance(PROBE, {
    instanceId: "probe-source",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 0,
  });
  const target = createCardInstance(TARGET, {
    instanceId: "probe-target",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: opts?.targetZone ?? "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
    ...(opts?.pendingLeave ? { pendingLeaveKind: "destroy" as const } : {}),
  });
  const other = createCardInstance(TARGET, {
    instanceId: "probe-other",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
  });
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [source, target, other],
  };
  return {
    state,
    sourceId: source.instanceId,
    targetId: target.instanceId,
    otherId: other.instanceId,
  };
}

function setupCombinedHostState(opts?: {
  relatedAttached?: boolean;
  relatedAttachedToOther?: boolean;
  hostPendingLeave?: boolean;
  hostControllerPlayerId?: "alice" | "bob";
}): {
  state: GameState;
  sourceId: string;
  hostId: string;
  relatedBraveId: string;
  otherId: string;
} {
  const source = createCardInstance(PROBE, {
    instanceId: "probe-source",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 0,
  });
  const host = createCardInstance(TARGET, {
    instanceId: "probe-host",
    ownerPlayerId: opts?.hostControllerPlayerId ?? "alice",
    controllerPlayerId: opts?.hostControllerPlayerId ?? "alice",
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
    attachedChildrenIds:
      opts?.relatedAttached === false || opts?.relatedAttachedToOther === true
        ? []
        : ["probe-related-brave"],
    ...(opts?.hostPendingLeave ? { pendingLeaveKind: "destroy" as const } : {}),
  });
  const relatedBrave = createCardInstance(BRAVE, {
    instanceId: "probe-related-brave",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "brave",
    normalCoreCount: 0,
    exhaustState: "exhausted",
    attachedToInstanceId:
      opts?.relatedAttached === false
        ? null
        : opts?.relatedAttachedToOther === true
          ? "probe-other"
          : host.instanceId,
  });
  const other = createCardInstance(TARGET, {
    instanceId: "probe-other",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    exhaustState: "exhausted",
    attachedChildrenIds:
      opts?.relatedAttachedToOther === true ? ["probe-related-brave"] : [],
  });
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [source, host, relatedBrave, other],
  };
  return {
    state,
    sourceId: source.instanceId,
    hostId: host.instanceId,
    relatedBraveId: relatedBrave.instanceId,
    otherId: other.instanceId,
  };
}

describe("TargetSpec.trigger_related_instance — engine 拡張", () => {
  it("triggerRelatedInstanceId が場の Y を指すと Y のみが解決される", () => {
    const ctx = setupState();
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:252",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.targetId,
    });
    const t = result.cardInstances.find((c) => c.instanceId === ctx.targetId);
    const o = result.cardInstances.find((c) => c.instanceId === ctx.otherId);
    expect(t?.exhaustState).toBe("recovered");
    // 他の同条件カードは主語 Y ではないため回復されない
    expect(o?.exhaustState).toBe("exhausted");
  });

  it("triggerRelatedInstanceId 未指定では誰も解決されない (誤ターゲットガード)", () => {
    const ctx = setupState();
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:269",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      // triggerRelatedInstanceId 未指定
    });
    const t = result.cardInstances.find((c) => c.instanceId === ctx.targetId);
    const o = result.cardInstances.find((c) => c.instanceId === ctx.otherId);
    expect(t?.exhaustState).toBe("exhausted");
    expect(o?.exhaustState).toBe("exhausted");
  });

  it("Y がフィールド外 (trash) なら解決されない", () => {
    const ctx = setupState({ targetZone: "trash" });
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:285",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.targetId,
    });
    const t = result.cardInstances.find((c) => c.instanceId === ctx.targetId);
    expect(t?.exhaustState).toBe("exhausted");
    expect(t?.zone).toBe("trash");
  });

  it("Y が pendingLeave 中 (場離脱予定) なら解決されない", () => {
    const ctx = setupState({ pendingLeave: true });
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:300",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.targetId,
    });
    const t = result.cardInstances.find((c) => c.instanceId === ctx.targetId);
    expect(t?.exhaustState).toBe("exhausted");
  });
});

describe("TargetSpec.trigger_related_combined_host — engine 拡張", () => {
  it("triggerRelatedInstanceId が合体中ブレイヴを指すと、その合体スピリットが回復する", () => {
    const ctx = setupCombinedHostState();
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:316",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_COMBINED_HOST_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.relatedBraveId,
      triggerRelatedCombinedHostInstanceId: ctx.hostId,
    });
    const host = result.cardInstances.find((c) => c.instanceId === ctx.hostId);
    const brave = result.cardInstances.find(
      (c) => c.instanceId === ctx.relatedBraveId
    );
    const other = result.cardInstances.find(
      (c) => c.instanceId === ctx.otherId
    );
    expect(host?.exhaustState).toBe("recovered");
    expect(brave?.exhaustState).toBe("recovered");
    expect(other?.exhaustState).toBe("exhausted");
  });

  it("関連ブレイヴが未合体なら host を誤解決しない", () => {
    const ctx = setupCombinedHostState({ relatedAttached: false });
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:339",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_COMBINED_HOST_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.relatedBraveId,
    });
    const host = result.cardInstances.find((c) => c.instanceId === ctx.hostId);
    expect(host?.exhaustState).toBe("exhausted");
  });

  it("host が pendingLeave 中なら解決されない", () => {
    const ctx = setupCombinedHostState({ hostPendingLeave: true });
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:353",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_COMBINED_HOST_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.relatedBraveId,
      triggerRelatedCombinedHostInstanceId: ctx.hostId,
    });
    const host = result.cardInstances.find((c) => c.instanceId === ctx.hostId);
    expect(host?.exhaustState).toBe("exhausted");
  });

  it("関連ブレイヴの現在 host が変わっていても event 時点の host を解決する", () => {
    const ctx = setupCombinedHostState({ relatedAttachedToOther: true });
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:368",
      state: ctx.state,
      effect: RECOVER_TRIGGER_RELATED_COMBINED_HOST_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.relatedBraveId,
      triggerRelatedCombinedHostInstanceId: ctx.hostId,
    });
    const host = result.cardInstances.find((c) => c.instanceId === ctx.hostId);
    const other = result.cardInstances.find(
      (c) => c.instanceId === ctx.otherId
    );
    expect(host?.exhaustState).toBe("recovered");
    expect(other?.exhaustState).toBe("exhausted");
  });

  it("player/filter 指定があると acting player の host だけを解決する", () => {
    const ctx = setupCombinedHostState({ hostControllerPlayerId: "bob" });
    const result = executeEffect({
      chainId: "test:target-spec-trigger-related-instance:387",
      state: ctx.state,
      effect: RECOVER_SELF_SPIRIT_TRIGGER_RELATED_COMBINED_HOST_EFFECT,
      sourceInstanceId: ctx.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: ctx.relatedBraveId,
      triggerRelatedCombinedHostInstanceId: ctx.hostId,
    });
    const host = result.cardInstances.find((c) => c.instanceId === ctx.hostId);
    expect(host?.exhaustState).toBe("exhausted");
  });

  it("brave_combined 収集時の host snapshot が pending に転写される", () => {
    const before = setupCombinedHostState({ relatedAttached: false });
    const after = setupCombinedHostState();
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before.state,
      afterState: recordSemanticTriggerEvent(after.state, {
        eventKind: "brave_combined",
        relatedInstanceId: after.relatedBraveId,
        triggerRelatedCombinedHostInstanceId: after.hostId,
      }),
      source: "action_resolution",
      chainId: "chain-1",
      attackId: null,
    }).filter((event) => event.eventKind === "brave_combined");

    expect(events).toHaveLength(1);
    expect(events[0]!.relatedInstanceId).toBe(after.relatedBraveId);
    expect(events[0]!.triggerRelatedCombinedHostInstanceId).toBe(after.hostId);

    const queued = queuePendingReactionsRawForTesting(after.state, events);
    expect(
      queued.pendingTriggeredEffects[0]?.triggerRelatedCombinedHostInstanceId
    ).toBe(after.hostId);
  });
});
