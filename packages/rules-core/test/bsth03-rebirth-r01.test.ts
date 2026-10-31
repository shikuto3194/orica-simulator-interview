/**
 * BSTH03-転醒R01 旧地獄街道／(裏)永夜の旧地獄 の転醒まわり回帰テスト。
 *
 * engine-drain 2026-06-14: 裏面[2,3]『このネクサスの転醒時』合体していない相手スピリット
 * 1体破壊の stale stub 解消を検証する。
 *  - 「合体していない」は CardFilter.combined:false で表現できる（card-filter.ts:159、
 *    "合体状態フィルタはDSL未対応" は誤記だった）。
 *  - 転醒時トリガーは card_event:"place" ではなく card_event:"rebirth"
 *    （executeRebirth が flip 後に発火。BSTH06-転醒R01(B) と同型）。
 * 表面[0,1] の rebirth には転醒条件（カウント3以下）= maxCount:3 を付与。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import type { CardDefinition, GameState, RebirthAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH03-転醒R01 旧地獄街道（転醒ネクサス）", () => {
  const front = cardNoMap.get("BSTH03-転醒R01(A)")!;

  it("表面[0]: 疲労トリガー(game_event:exhaust spirit/ultimate) で rebirth maxCount:3", () => {
    const eff = front.effects![0]!;
    expect(eff.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "exhaust",
      triggerFilter: { category: ["spirit", "ultimate"] },
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(eff.stub).toBeUndefined();
    const rebirth = eff.steps[0]!.action;
    expect(rebirth.kind).toBe("rebirth");
    if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(3);
  });

  it("表面[1]: 相手による離脱トリガー(card_event:leave_field cause:opponent_effect)", () => {
    const eff = front.effects![1]!;
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(eff.stub).toBeUndefined();
    expect(eff.steps[0]!.action.kind).toBe("rebirth");
  });

  it("裏面[0]: 転醒時(card_event:rebirth) 合体していない相手スピリット破壊 / stub 解消", () => {
    const back = front.backFace!;
    const destroyEffect = back.effects![0]!;
    // 転醒時 = card_event:"rebirth"（"place" ではない）
    expect(destroyEffect.timing).toEqual({
      kind: "card_event",
      event: "rebirth",
    });
    expect(destroyEffect.stub).toBeUndefined();
    const action = destroyEffect.steps[0]!.action;
    expect(action.kind).toBe("destroy");
    if (action.kind === "destroy" && action.target.kind === "filter") {
      expect(action.target.player).toBe("opponent");
      expect(action.target.filter?.combined).toBe(false);
      expect(action.target.filter?.category).toEqual(["spirit"]);
    }
  });

  it("flip(A→B) で転醒イベントが発火し、裏面の転醒時破壊効果が誘発キューに乗る", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const lookups = {
      getCardDefinitionById: (id: string) => map.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(expanded),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(expanded),
    };

    const frontDef = lookups.getCardDefinitionById("BSTH03-転醒R01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "nx-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });

    // カウント3以下（countValue=0）なので転醒条件成立。
    const action: RebirthAction = {
      kind: "rebirth",
      maxCount: 3,
      triggerDescription: "",
    };
    const after = executeRebirth(
      before,
      "alice",
      action,
      "nx-1",
      lookups.getCardDefinitionById,
      "test:bsth03-rebirth-r01:117"
    );

    // flip 成立: 裏面定義へ差し替わる。
    const flipped = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
    expect(flipped.definitionId).toBe("BSTH03-転醒R01(B)");

    // delta から rebirth イベントが 1 件。
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookups.getCardDefinitionById,
    });
    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(1);

    // 裏面[0]『転醒時』破壊効果が誘発キューに乗る（card_event:"place" のままなら 0 件だった）。
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth03-rebirth-r01:141",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "rebirth"
    );
    expect(rebirthPendings.length).toBe(1);
    expect(rebirthPendings[0]!.relatedInstanceId).toBe("nx-1");
  });

  it("相手による離脱トリガーでの転醒: 離脱待機を解除しフィールドに残す（置換）", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const frontDef = getDef("BSTH03-転醒R01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "nx-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    // 相手 (bob) の効果でフィールドを離れる待機状態にする。
    inst.pendingLeaveKind = "destroy";
    inst.pendingLeaveCause = "effect_resolution";
    inst.pendingLeaveChainId = "chain-1";

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    before.pendingLeaveEntities = [
      {
        instanceId: "nx-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
      },
    ];

    const after = executeRebirth(
      before,
      "alice",
      { kind: "rebirth", maxCount: 3, triggerDescription: "" },
      "nx-1",
      getDef,
      "test:bsth03-rebirth-r01:190"
    );

    const flipped = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
    // flip 成立 + フィールド残置。
    expect(flipped.definitionId).toBe("BSTH03-転醒R01(B)");
    expect(flipped.zone).toBe("field");
    // 離脱待機が解除されている。
    expect(flipped.pendingLeaveKind).toBeNull();
    expect(flipped.pendingLeaveCause).toBeNull();
    expect(flipped.pendingLeaveChainId).toBeNull();
    expect(
      after.pendingLeaveEntities.some((pl) => pl.instanceId === "nx-1")
    ).toBe(false);
    // カウント +1。
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(after.log.some((l) => l.endsWith(":stay-on-field"))).toBe(true);
  });
});
