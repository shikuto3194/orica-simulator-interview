/**
 * Phase 2 (P3-108): 効果解決継続 (continuation) が resume したら、Phase 1 で保留していた
 * 待機 (pending leave) を**その時点で**実移動 (flush) する。
 *
 * 背景: 待機 flush タイミングは「premature finalize で早期 flush（Phase 1 で gate 済）」+
 * 「resume 時の finalizeEffectResolution で flush」の二段構成。ところが継続 resume ハンドラの
 * うち `applyPendingCoreSplitAction` / `applyPendingCoreCountAction` は finalize を呼ばずに
 * return していたため、Phase 1 で早期 flush を止めた結果これらの経路では待機が resume 時に
 * flush されず、次アクションの finalize までトラッシュ移動が遅延していた。
 *
 * 修正: 両ハンドラに兄弟ハンドラ (applyResolveCoreSourceAllocationAction 等) と同じ
 * finalizeEffectResolution を通し、resume 完了時に flush する。
 */
import { describe, it, expect } from "vitest";
import type {
  CardDefinition,
  GameState,
  PendingCoreCountSelection,
  PendingCoreSplitSelection,
  PendingLeaveEntity,
} from "../src/model";
import { getLegalActions, applyLegalAction } from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { createCardInstance, createEmptyGameState } from "../src/factories";

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `Spirit ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    // 「このスピリットがフィールドを離れたとき」誘発。deferred flush 後に発火することを検証する。
    effects: [
      {
        timing: { kind: "card_event", event: "leave_field" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
}

const def = makeSpirit("V-VANISH");
const lookups = {
  getCardDefinitionById: (id: string) => (id === def.cardNo ? def : undefined),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([def]),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredHandCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
} as const;

/** コスト支払い消滅待機 (defer=true) のスピリット 1 体を持つ base state。 */
function baseStateWithVanish(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "field-V",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      }),
    ],
    playerOverrides: [{ voidNormalCoreCount: 5 }],
  });
  const chainId = "accel:4:alice:main:src";
  const cards = base.cardInstances.map((c) =>
    c.instanceId === "field-V"
      ? {
          ...c,
          pendingLeaveKind: "vanish" as const,
          pendingLeaveCause: "cost_payment" as const,
          pendingLeaveChainId: chainId,
          deferZoneMoveUntilChainEnd: true,
        }
      : c
  );
  const leave: PendingLeaveEntity = {
    instanceId: "field-V",
    kind: "vanish",
    cause: "cost_payment",
    causePlayerId: null,
    chainId,
    deferZoneMoveUntilChainEnd: true,
    leaveFieldCoreDestinationOverride: null,
  };
  return {
    ...base,
    step: "main",
    activePlayerId: "alice",
    cardInstances: cards,
    pendingLeaveEntities: [leave],
  };
}

function resolveOnly(
  state: GameState,
  extra: Record<string, unknown>
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  });
  const act =
    actions.find((a) => a.kind === "resolve_pending_core_split") ??
    actions.find((a) => a.kind === "resolve_pending_core_count");
  if (!act) throw new Error("expected continuation resolution action");
  return applyLegalAction({ state, action: act, ...lookups, ...extra }).state;
}

describe("継続 resume 時に Phase1 保留の待機を flush する (P3-108)", () => {
  it("CoreSplit resume: 配分解決と同時にコスト消滅カードがトラッシュへ移動", () => {
    const split: PendingCoreSplitSelection = {
      pendingId: "cms-0",
      actingPlayerId: "alice",
      sourceInstanceId: "src",
      sourceDefinitionId: "V-VANISH",
      fromLocation: { kind: "void", player: "self" },
      totalAmount: 2,
      destinations: [
        { location: { kind: "reserve", player: "self" }, cap: 2 },
        { location: { kind: "trash", player: "self" } },
      ],
      effectTiming: { kind: "phase", step: "main" },
    };
    const state: GameState = {
      ...baseStateWithVanish(),
      pendingCoreSplitSelection: split,
    };
    const after = resolveOnly(state, { coreSplitDistribution: [1, 1] });
    expect(after.pendingCoreSplitSelection).toBeNull();
    const v = after.cardInstances.find((c) => c.instanceId === "field-V");
    expect(v?.zone).toBe("trash");
    expect(v?.pendingLeaveKind).toBeNull();
    expect(after.pendingLeaveEntities).toHaveLength(0);
  });

  it("leave_field 誘発の発火は deferred flush でも即時 flush と一致する (regression parity)", () => {
    const hasLeaveTrigger = (s: GameState): boolean =>
      s.pendingTriggeredEffects.some(
        (p) =>
          p.relatedInstanceId === "field-V" &&
          (p.eventKind === "leave_field" || p.event?.kind === "leave_field")
      );

    // 即時 flush の基準: 継続なしで finalize すると field-V がどう扱われるか。
    const base = baseStateWithVanish();
    const immediate = finalizeEffectResolution({
      state: base,
      beforeState: base,
      chainId: "control",
      endLogs: [],
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lookups.getRegisteredBurstActions,
      causedBySourceInstanceId: null,
    });
    const immediateZone = immediate.cardInstances.find(
      (c) => c.instanceId === "field-V"
    )?.zone;
    const immediateLeave = hasLeaveTrigger(immediate);

    // deferred flush (継続 resume) 経路。
    const split: PendingCoreSplitSelection = {
      pendingId: "cms-0",
      actingPlayerId: "alice",
      sourceInstanceId: "src",
      sourceDefinitionId: "V-VANISH",
      fromLocation: { kind: "void", player: "self" },
      totalAmount: 2,
      destinations: [
        { location: { kind: "reserve", player: "self" }, cap: 2 },
        { location: { kind: "trash", player: "self" } },
      ],
      effectTiming: { kind: "phase", step: "main" },
    };
    const deferred = resolveOnly(
      { ...baseStateWithVanish(), pendingCoreSplitSelection: split },
      { coreSplitDistribution: [1, 1] }
    );
    const deferredZone = deferred.cardInstances.find(
      (c) => c.instanceId === "field-V"
    )?.zone;

    // どちらも trash へ移動し、leave_field 誘発の発火有無も一致する
    // (= 継続による flush 先送りが誘発挙動を変えない)。
    expect(immediateZone).toBe("trash");
    expect(deferredZone).toBe("trash");
    expect(hasLeaveTrigger(deferred)).toBe(immediateLeave);
  });

  it("CoreCount resume: 数選択解決と同時にコスト消滅カードがトラッシュへ移動", () => {
    const count: PendingCoreCountSelection = {
      pendingId: "ccs-0",
      actingPlayerId: "alice",
      sourceInstanceId: "src",
      sourceDefinitionId: "V-VANISH",
      fromLocation: { kind: "void", player: "self" },
      toLocation: { kind: "reserve", player: "self" },
      min: 0,
      max: 2,
      effectTiming: { kind: "phase", step: "main" },
    };
    const state: GameState = {
      ...baseStateWithVanish(),
      pendingCoreCountSelection: count,
    };
    const after = resolveOnly(state, { coreCountSelection: 1 });
    expect(after.pendingCoreCountSelection).toBeNull();
    const v = after.cardInstances.find((c) => c.instanceId === "field-V");
    expect(v?.zone).toBe("trash");
    expect(v?.pendingLeaveKind).toBeNull();
    expect(after.pendingLeaveEntities).toHaveLength(0);
  });
});
