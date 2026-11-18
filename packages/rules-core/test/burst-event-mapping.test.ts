/**
 * burst イベントマッピングの回帰テスト。
 *
 * - place (ネクサス配置) を burst:place check に変換する mapTriggerEventToBurstCheck の検証。
 * - summon カテゴリースコープ (問題A burst 版): burst には triggerFilter 評価機構がないため、
 *   汎用 burst:summon responder はスピリット召喚のみに反応し、ブレイヴ/アルティメット召喚では
 *   burst:summon check を積まない (ブレイヴ/アルティメット召喚 ≠ スピリット召喚)。
 *
 * 注: burst の DSL→registration 自動 builder は未整備のため、ここでは check の生成
 * (mapTriggerEventToBurstCheck + summonResponderMatchesCategoryScope) のみを検証する。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import type { CardDefinition } from "../src/model";

function makeDef(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"]
): CardDefinition {
  return {
    cardNo,
    name: `Card ${cardNo}`,
    printedCategory,
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

// getRegisteredBurstActions: undefined → queueReactionsInternal の legacy 経路
// (per-player prune を行わず、mapTriggerEventToBurstCheck の単一 check を無条件で積む)。
// このテストは check 生成 (イベント→burstEventKind マッピング + category scope) の検証に絞るため legacy で確認する。
const emptyLookups = {
  getCardDefinitionById: () => undefined,
  getRegisteredTriggeredEffectActions: () => undefined,
  getRegisteredBurstActions: undefined,
};

function summonEvent(relatedInstanceId: string): CollectedTriggerEvent {
  return {
    actingPlayerId: "alice",
    eventKind: "summon",
    source: "action_resolution",
    chainId: "test:burst-event-mapping:50",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId,
    amount: null,
  };
}

function fieldInstance(
  printedCategory: CardDefinition["printedCategory"],
  zoneRoleName: string,
  instanceId: string
) {
  return createCardInstance(makeDef(instanceId, printedCategory), {
    instanceId,
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName,
  });
}

describe("burst イベントマッピング (place 追加 + summon カテゴリースコープ)", () => {
  it("ネクサス配置 (place イベント) で burst:place check が積まれる", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const placeEvent: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "place",
      source: "action_resolution",
      chainId: "test:burst-event-mapping:78",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "nexus-1",
      amount: null,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [placeEvent],
      undefined,
      emptyLookups
    );
    expect(result.pendingBurstChecks.some((c) => c.eventKind === "place")).toBe(
      true
    );
  });

  it("スピリット召喚で burst:summon check が積まれる", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [fieldInstance("spirit", "spirit", "sp-1")],
    });
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [summonEvent("sp-1")],
      undefined,
      emptyLookups
    );
    expect(
      result.pendingBurstChecks.some((c) => c.eventKind === "summon")
    ).toBe(true);
  });

  it("アルティメット召喚では burst:summon check が積まれない (問題A burst 版)", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [fieldInstance("ultimate", "ultimate", "ult-1")],
    });
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [summonEvent("ult-1")],
      undefined,
      emptyLookups
    );
    expect(
      result.pendingBurstChecks.some((c) => c.eventKind === "summon")
    ).toBe(false);
  });

  it("ブレイヴ召喚では burst:summon check が積まれない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [fieldInstance("brave", "brave", "br-1")],
    });
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [summonEvent("br-1")],
      undefined,
      emptyLookups
    );
    expect(
      result.pendingBurstChecks.some((c) => c.eventKind === "summon")
    ).toBe(false);
  });

  // 2026-07-19 (ENGINE-exhaust-third-party-opt-in-gap): exhaust は UNWIRED_BURST_FALLBACK_SKIP_KINDS
  // (queueReactionsInternal) に追加され、legacy/unwired path では check を積まなくなった
  // (step_timing と同じ理由: exhaust を OPT_IN_TRIGGER_EVENT_KINDS から除外した際、
  // burst lookup 未配線の呼び出しで vacuous check が量産される regression が判明したため)。
  // mapTriggerEventToBurstCheck 自体のマッピングは維持されるため、per-player pruning が働く
  // 配線済み経路 (burst 登録ありの player のみ check が残る) では従来どおり exhaust burst は機能する。
  it("疲労 (exhaust イベント) は legacy/unwired path では burst check を積まない [ENGINE-exhaust-third-party-opt-in-gap]", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [fieldInstance("spirit", "spirit", "sp-ex")],
    });
    const exhaustEvent: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "exhaust",
      source: "action_resolution",
      chainId: "test:burst-event-mapping:158",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "sp-ex",
      amount: null,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [exhaustEvent],
      undefined,
      emptyLookups
    );
    expect(
      result.pendingBurstChecks.some((c) => c.eventKind === "exhaust")
    ).toBe(false);
  });

  it("回復 (recover イベント) では burst check が積まれない [P3-67 Phase 4]", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [fieldInstance("spirit", "spirit", "sp-rc")],
    });
    const recoverEvent: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "recover",
      source: "action_resolution",
      chainId: "test:burst-event-mapping:184",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "sp-rc",
      amount: null,
    };
    const result = queuePendingReactionsFromTriggerEvents(
      state,
      [recoverEvent],
      undefined,
      emptyLookups
    );
    expect(result.pendingBurstChecks).toHaveLength(0);
  });
});
