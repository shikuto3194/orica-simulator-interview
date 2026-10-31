/**
 * カウント機構 drain (B-A): count_increase トリガー event の検証。
 *
 * - collectTriggerEventsFromStateDelta が PlayerState.countValue 増加で
 *   count_increase を発火し、grower-relative cause / amount / relatedPlayerId を付与する
 *   (increase_hand と同型, p3-68-cause-attribution.test.ts のカウント版)。
 * - game_event:"count_increase" の効果が eventKind "count_increase" の
 *   triggered registration を生成する (CARD_EVENT_TO_TRIGGER / TRIGGER_EVENT_META 経由)。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  collectTriggerEventsFromStateDelta,
  generateTriggeredEffectRegistrations,
} from "../src";
import type { CardDefinition, GameState } from "../src";

describe("collectTriggerEventsFromStateDelta: count_increase", () => {
  function deltaWithCountIncrease(
    by: number,
    causedByPlayerId?: string | null
  ) {
    const before = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const after: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === "bob" ? { ...p, countValue: p.countValue + by } : p
      ),
    };
    return collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      ...(causedByPlayerId !== undefined ? { causedByPlayerId } : {}),
    }).filter((e) => e.eventKind === "count_increase");
  }

  it("カウントが増えたとき count_increase を 1 件発火 (amount/relatedPlayerId 付き)", () => {
    const events = deltaWithCountIncrease(2, "bob");
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(2);
    expect(events[0]!.relatedPlayerId).toBe("bob");
    expect(events[0]!.relatedInstanceId).toBeNull();
  });

  it("カウントが増えたプレイヤー自身が起因 → self_effect", () => {
    expect(deltaWithCountIncrease(1, "bob")[0]!.cause).toBe("self_effect");
  });

  it("別プレイヤー起因 (相手効果での増加) → opponent_effect", () => {
    expect(deltaWithCountIncrease(1, "alice")[0]!.cause).toBe(
      "opponent_effect"
    );
  });

  it("causedByPlayerId 未指定 → self_effect 既定 (fail-open)", () => {
    expect(deltaWithCountIncrease(1, undefined)[0]!.cause).toBe("self_effect");
  });

  it("カウント増加が無ければ発火しない", () => {
    const before = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: before,
      source: "action_resolution",
    }).filter((e) => e.eventKind === "count_increase");
    expect(events).toHaveLength(0);
  });
});

describe("generateTriggeredEffectRegistrations: game_event count_increase", () => {
  const countTriggerCard: CardDefinition = {
    cardNo: "TEST-COUNT-TRIGGER",
    name: "count trigger",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // 「自分のカウントが増えたとき」自分は1枚ドローできる。
        timing: { kind: "game_event", event: "count_increase", player: "self" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };

  it("eventKind 'count_increase' の triggered registration を生成する", () => {
    const regs = generateTriggeredEffectRegistrations(countTriggerCard);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("count_increase");
  });
});
