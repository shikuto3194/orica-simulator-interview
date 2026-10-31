/**
 * ENGINE-nth-occurrence-trigger-gate primitive 単体テスト。
 *
 * BSLH01-C05/R03 quartz set-effect「ターンにN回目の観測でのみ発火する」を表現するための
 * 累積 occurrence tally。既存 `effectUsageRecords`(発動/宣言時にのみ加算)とは別に、
 * トリガー検出のたび (発動可否に関わらず) 無条件で加算する点が主眼。
 * このテストは primitive 単体の検証のみで、trigger-system.ts への実配線・card-data 配線は
 * 別 iteration の対象 (未着手)。
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../src";
import { createEmptyGameState } from "../src/index";
import {
  clearExpiredEffectOccurrenceRecords,
  getEffectOccurrenceCount,
  isExactOccurrenceMatch,
  recordEffectOccurrence,
} from "../src/effect/effect-occurrence-gate";

function setupState(overrides?: Partial<GameState>): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return { ...base, turnNumber: 3, step: "main", ...overrides };
}

describe("effect-occurrence-gate: recordEffectOccurrence / getEffectOccurrenceCount", () => {
  it("初回検出でcount:1のレコードを新規作成する", () => {
    const state = setupState();
    const records = recordEffectOccurrence({
      state,
      sourceInstanceId: "c05",
      sourceDefinitionId: "BSLH01-C05",
      effectLabel: "effect:2",
      duration: "turn",
    });
    expect(records).toEqual([
      {
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        turnNumber: 3,
        step: "main",
        duration: "turn",
        count: 1,
      },
    ]);
  });

  it("同一scope内で複数回記録するとcountが積み上がる (1→2→3)", () => {
    let state = setupState();
    for (let i = 0; i < 3; i++) {
      state = {
        ...state,
        effectOccurrenceRecords: recordEffectOccurrence({
          state,
          sourceInstanceId: "c05",
          sourceDefinitionId: "BSLH01-C05",
          effectLabel: "effect:2",
          duration: "turn",
        }),
      };
    }
    expect(
      getEffectOccurrenceCount(state, {
        sourceInstanceId: "c05",
        effectLabel: "effect:2",
        duration: "turn",
      })
    ).toBe(3);
  });

  it("未記録のsource/effectLabelはcount 0", () => {
    const state = setupState();
    expect(
      getEffectOccurrenceCount(state, {
        sourceInstanceId: "unknown",
        effectLabel: "effect:2",
        duration: "turn",
      })
    ).toBe(0);
  });

  it("異なるeffectLabel/sourceInstanceIdは独立してカウントされる", () => {
    let state = setupState();
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "r03",
        sourceDefinitionId: "BSLH01-R03",
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    expect(
      getEffectOccurrenceCount(state, {
        sourceInstanceId: "c05",
        effectLabel: "effect:2",
        duration: "turn",
      })
    ).toBe(1);
    expect(
      getEffectOccurrenceCount(state, {
        sourceInstanceId: "r03",
        effectLabel: "effect:2",
        duration: "turn",
      })
    ).toBe(1);
  });
});

describe("effect-occurrence-gate: isExactOccurrenceMatch (Nth-only gate)", () => {
  it("BSLH01-C05型: 1回目はfalse、2回目にtrue、3回目以降はfalseに戻る (ターン2回目のみ発火)", () => {
    let state = setupState();
    const gateParams = {
      sourceInstanceId: "c05",
      effectLabel: "effect:2",
      duration: "turn" as const,
      targetCount: 2,
    };

    // 1回目の観測
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    expect(isExactOccurrenceMatch(state, gateParams)).toBe(false);

    // 2回目の観測 → ゲートが開く
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    expect(isExactOccurrenceMatch(state, gateParams)).toBe(true);

    // 3回目の観測 → 厳密一致のみを見るためゲートは再び閉じる
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    expect(isExactOccurrenceMatch(state, gateParams)).toBe(false);
  });

  it("BSLH01-R03型: targetCount 4 は3回目まで閉じたまま", () => {
    let state = setupState();
    for (let i = 0; i < 3; i++) {
      state = {
        ...state,
        effectOccurrenceRecords: recordEffectOccurrence({
          state,
          sourceInstanceId: "r03",
          sourceDefinitionId: "BSLH01-R03",
          effectLabel: "effect:2",
          duration: "turn",
        }),
      };
      expect(
        isExactOccurrenceMatch(state, {
          sourceInstanceId: "r03",
          effectLabel: "effect:2",
          duration: "turn",
          targetCount: 4,
        })
      ).toBe(false);
    }
  });
});

describe("effect-occurrence-gate: clearExpiredEffectOccurrenceRecords (turn duration reset)", () => {
  it("ターンが進むとturn-scopedレコードは除去され、次ターンの観測は1回目から再開する", () => {
    let state = setupState({ turnNumber: 3 });
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        duration: "turn",
      }),
    };
    expect(state.effectOccurrenceRecords).toHaveLength(1);

    // 次ターンへ (turnNumber が変わっただけの state で clear を呼ぶ想定 = turn-system.ts の
    // ステップ遷移フックと同じ呼び出しパターン)。
    const nextTurnState = { ...state, turnNumber: 4 };
    const cleared = clearExpiredEffectOccurrenceRecords(nextTurnState);
    expect(cleared).toEqual([]);
  });

  it("game durationのレコードはターンが進んでも除去されない", () => {
    let state = setupState({ turnNumber: 3 });
    state = {
      ...state,
      effectOccurrenceRecords: recordEffectOccurrence({
        state,
        sourceInstanceId: "c05",
        sourceDefinitionId: "BSLH01-C05",
        effectLabel: "effect:2",
        duration: "game",
      }),
    };
    const nextTurnState = { ...state, turnNumber: 10 };
    const cleared = clearExpiredEffectOccurrenceRecords(nextTurnState);
    expect(cleared).toHaveLength(1);
  });
});
