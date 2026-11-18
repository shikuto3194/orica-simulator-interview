/**
 * ENGINE-nth-occurrence-trigger-gate primitive 単体テスト。
 *
 * BSLH01-C05/R03 quartz set-effect「ターンにN回目の観測でのみ発火する」を表現するための
 * 観測 tally。共通の使用会計 `effectAccounting` の観測 (measure="observation") として記録し、
 * 効果の発動/宣言時にのみ加算する使用回数 (measure="use") とは別の枠で、トリガー検出のたび
 * (発動可否に関わらず) 無条件で加算する点が主眼。期間の判断は使用会計の時計だけが行う。
 * このテストは primitive 単体の検証。trigger-system.ts への実配線は
 * effect-occurrence-gate-wiring.test.ts、card-data 配線は quartz-system.test.ts。
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../src";
import { createEmptyGameState } from "../src/index";
import {
  getEffectOccurrenceCount,
  isExactOccurrenceMatch,
  recordEffectOccurrence,
} from "../src/effect/effect-occurrence-gate";
import { pruneEffectAccounting } from "../src/effect/effect-usage-accounting";
import {
  listOccurrenceTallies,
  occurrenceTallyOf,
} from "./helpers/quantity-usage-fixture";

function setupState(overrides?: Partial<GameState>): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return { ...base, turnNumber: 3, step: "main", ...overrides };
}

function observe(
  state: GameState,
  options: {
    sourceInstanceId?: string;
    sourceDefinitionId?: string;
    effectLabel?: string;
    duration?: "turn" | "game" | "step" | "battle";
    groupId?: string;
  } = {}
): GameState {
  return recordEffectOccurrence({
    state,
    sourceInstanceId: options.sourceInstanceId ?? "c05",
    sourceDefinitionId: options.sourceDefinitionId ?? "BSLH01-C05",
    effectLabel: options.effectLabel ?? "effect:2",
    duration: options.duration ?? "turn",
    playerId: "alice",
    ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
  });
}

const count = (
  state: GameState,
  options: {
    sourceInstanceId?: string;
    effectLabel?: string;
    duration?: "turn" | "game" | "step" | "battle";
    groupId?: string;
  } = {}
): number =>
  getEffectOccurrenceCount(state, {
    sourceInstanceId: options.sourceInstanceId ?? "c05",
    effectLabel: options.effectLabel ?? "effect:2",
    duration: options.duration ?? "turn",
    playerId: "alice",
    ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
  });

describe("effect-occurrence-gate: recordEffectOccurrence / getEffectOccurrenceCount", () => {
  it("初回検出で count:1 の観測を新規作成し、使用回数 (use) の枠は作らない", () => {
    const state = observe(setupState());
    expect(listOccurrenceTallies(state)).toEqual([
      {
        sourceInstanceId: "c05",
        label: "effect:2",
        count: 1,
        periodId: "turn:3",
      },
    ]);
    // 観測は measure="observation" だけ。回数制限の消費 (use) とは別の枠。
    expect(state.effectAccounting.buckets.map((b) => b.measure)).toEqual([
      "observation",
    ]);
  });

  it("同一scope内で複数回記録すると count が積み上がる (1→2→3)", () => {
    let state = setupState();
    for (let i = 0; i < 3; i++) state = observe(state);
    expect(count(state)).toBe(3);
  });

  it("観測は上限で止まらない (多数回でも無条件に加算する)", () => {
    let state = setupState();
    for (let i = 0; i < 50; i++) state = observe(state);
    expect(count(state)).toBe(50);
  });

  it("未記録の source/effectLabel は count 0", () => {
    const state = setupState();
    expect(count(state, { sourceInstanceId: "unknown" })).toBe(0);
  });

  it("入力 state は変更されない (純関数)", () => {
    const state = setupState();
    const before = JSON.stringify(state.effectAccounting);
    observe(state);
    expect(JSON.stringify(state.effectAccounting)).toBe(before);
  });

  it("異なる effectLabel / sourceInstanceId は独立してカウントされる", () => {
    let state = setupState();
    state = observe(state);
    state = observe(state, {
      sourceInstanceId: "r03",
      sourceDefinitionId: "BSLH01-R03",
    });
    state = observe(state, { effectLabel: "effect:3" });
    expect(count(state)).toBe(1);
    expect(count(state, { sourceInstanceId: "r03" })).toBe(1);
    expect(count(state, { effectLabel: "effect:3" })).toBe(1);
  });

  it("groupId を指定すると同一個体の別 effectLabel で 1 つの tally に合算し、個体が違えば別 tally", () => {
    let state = setupState();
    state = observe(state, { effectLabel: "effect:1", groupId: "G" });
    state = observe(state, { effectLabel: "effect:2", groupId: "G" });
    state = observe(state, { effectLabel: "effect:3", groupId: "G" });
    state = observe(state, {
      sourceInstanceId: "other",
      effectLabel: "effect:1",
      groupId: "G",
    });
    expect(count(state, { effectLabel: "effect:9", groupId: "G" })).toBe(3);
    expect(
      count(state, {
        sourceInstanceId: "other",
        effectLabel: "effect:9",
        groupId: "G",
      })
    ).toBe(1);
    // groupId 無しの label 単位 tally には混ざらない。
    expect(count(state, { effectLabel: "effect:1" })).toBe(0);
  });

  it("step 期間は同名の追加ステップでも別の期間として数える (ステップ序数で判断)", () => {
    let state = setupState();
    state = observe(state, { duration: "step" });
    state = observe(state, { duration: "step" });
    expect(count(state, { duration: "step" })).toBe(2);
    // 同じ名前のステップでも、ターン内のステップ序数が進めば別のステップ。
    const nextSameNamedStep = {
      ...state,
      stepOrdinalThisTurn: state.stepOrdinalThisTurn + 1,
    };
    expect(count(nextSameNamedStep, { duration: "step" })).toBe(0);
    state = observe(nextSameNamedStep, { duration: "step" });
    expect(count(state, { duration: "step" })).toBe(1);
  });

  it("battle 期間はバトル外では記録されない (対象バトルが無い)", () => {
    const state = observe(setupState(), { duration: "battle" });
    expect(count(state, { duration: "battle" })).toBe(0);
    expect(listOccurrenceTallies(state)).toEqual([]);
  });
});

describe("effect-occurrence-gate: isExactOccurrenceMatch (Nth-only gate)", () => {
  it("BSLH01-C05型: 1回目は false、2回目に true、3回目以降は false に戻る (ターン2回目のみ発火)", () => {
    let state = setupState();
    const gateParams = {
      sourceInstanceId: "c05",
      effectLabel: "effect:2",
      duration: "turn" as const,
      targetCount: 2,
      playerId: "alice",
    };

    state = observe(state);
    expect(isExactOccurrenceMatch(state, gateParams)).toBe(false);

    // 2回目の観測 → ゲートが開く
    state = observe(state);
    expect(isExactOccurrenceMatch(state, gateParams)).toBe(true);

    // 3回目の観測 → 厳密一致のみを見るためゲートは再び閉じる
    state = observe(state);
    expect(isExactOccurrenceMatch(state, gateParams)).toBe(false);
  });

  it("BSLH01-R03型: targetCount 4 は3回目まで閉じたまま", () => {
    let state = setupState();
    for (let i = 0; i < 3; i++) {
      state = observe(state, {
        sourceInstanceId: "r03",
        sourceDefinitionId: "BSLH01-R03",
      });
      expect(
        isExactOccurrenceMatch(state, {
          sourceInstanceId: "r03",
          effectLabel: "effect:2",
          duration: "turn",
          targetCount: 4,
          playerId: "alice",
        })
      ).toBe(false);
    }
  });
});

describe("effect-occurrence-gate: 期限切れの整理 (turn duration reset)", () => {
  it("ターンが進むと turn 期間の観測は整理され、次ターンの観測は 1 回目から再開する", () => {
    let state = setupState({ turnNumber: 3 });
    state = observe(state);
    expect(listOccurrenceTallies(state)).toHaveLength(1);

    const nextTurnState = pruneEffectAccounting({ ...state, turnNumber: 4 });
    expect(listOccurrenceTallies(nextTurnState)).toEqual([]);
    expect(count(nextTurnState)).toBe(0);
    expect(count(observe(nextTurnState))).toBe(1);
  });

  it("game 期間の観測はターンが進んでも整理されない", () => {
    let state = setupState({ turnNumber: 3 });
    state = observe(state, { duration: "game" });
    const nextTurnState = pruneEffectAccounting({ ...state, turnNumber: 10 });
    expect(listOccurrenceTallies(nextTurnState)).toHaveLength(1);
    expect(occurrenceTallyOf(nextTurnState, "c05")?.count).toBe(1);
    expect(count(nextTurnState, { duration: "game" })).toBe(1);
  });
});
