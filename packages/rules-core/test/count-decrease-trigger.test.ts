/**
 * カウント機構 drain: count_decrease トリガー event の検証（count_increase の対称版）。
 *
 * - collectTriggerEventsFromStateDelta が PlayerState.countValue 減少で
 *   count_decrease を発火し、cause / amount / relatedPlayerId を付与する。
 * - game_event:"count_decrease" の効果が eventKind "count_decrease" の
 *   triggered registration を生成する (CARD_EVENT_TO_TRIGGER / TRIGGER_EVENT_META 経由)。
 *
 * 逆転醒トリガー BSTH03-転醒R01(B)「自分のカウントが減ったとき」の基盤。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  collectTriggerEventsFromStateDelta,
  generateTriggeredEffectRegistrations,
} from "../src";
import type { CardDefinition, GameState } from "../src";

describe("collectTriggerEventsFromStateDelta: count_decrease", () => {
  function deltaWithCountDecrease(
    by: number,
    causedByPlayerId?: string | null
  ) {
    const before: GameState = (() => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      return {
        ...base,
        players: base.players.map((p) =>
          p.id === "bob" ? { ...p, countValue: 5 } : p
        ),
      };
    })();
    const after: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === "bob" ? { ...p, countValue: p.countValue - by } : p
      ),
    };
    return collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      ...(causedByPlayerId !== undefined ? { causedByPlayerId } : {}),
    }).filter((e) => e.eventKind === "count_decrease");
  }

  it("カウントが減ったとき count_decrease を 1 件発火 (amount/relatedPlayerId 付き)", () => {
    const events = deltaWithCountDecrease(2, "bob");
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(2);
    expect(events[0]!.relatedPlayerId).toBe("bob");
    expect(events[0]!.relatedInstanceId).toBeNull();
  });

  it("カウントが減ったプレイヤー自身が起因 → self_effect", () => {
    expect(deltaWithCountDecrease(1, "bob")[0]!.cause).toBe("self_effect");
  });

  it("別プレイヤー起因 (相手効果での減少) → opponent_effect", () => {
    expect(deltaWithCountDecrease(1, "alice")[0]!.cause).toBe(
      "opponent_effect"
    );
  });

  it("causedByPlayerId 未指定 → self_effect 既定 (fail-open)", () => {
    expect(deltaWithCountDecrease(1, undefined)[0]!.cause).toBe("self_effect");
  });

  it("カウント減少が無ければ発火しない（増加では発火しない）", () => {
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const after: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === "bob" ? { ...p, countValue: p.countValue + 3 } : p
      ),
    };
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
    }).filter((e) => e.eventKind === "count_decrease");
    expect(events).toHaveLength(0);
  });
});

describe("generateTriggeredEffectRegistrations: game_event count_decrease", () => {
  const countTriggerCard: CardDefinition = {
    cardNo: "TEST-COUNT-DECREASE-TRIGGER",
    name: "count decrease trigger",
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
        // 「自分のカウントが減ったとき」自分は1枚ドローできる。
        timing: { kind: "game_event", event: "count_decrease", player: "self" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };

  it("eventKind 'count_decrease' の triggered registration を生成する", () => {
    const regs = generateTriggeredEffectRegistrations(countTriggerCard);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("count_decrease");
  });
});
