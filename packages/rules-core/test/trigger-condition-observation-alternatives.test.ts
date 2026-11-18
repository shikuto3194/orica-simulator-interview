import { describe, expect, it } from "vitest";
import { createEmptyGameState } from "../src/runtime";
import type {
  Condition,
  TriggerConditionObservationResults,
} from "../src/model";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import {
  applyTriggerConditionResults,
  getObservedTriggerConditionResults,
} from "../src/effect/trigger-condition-observation";

const eventAndCondition: Condition = [
  { kind: "trigger_colors", colors: ["red"] },
  { kind: "trigger_tribes", tribes: ["地霊"] },
  { kind: "count_value", player: "self", min: 2 },
];
function qualifies(
  results: TriggerConditionObservationResults,
  count = 2,
  condition = eventAndCondition
) {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue: count }, {}],
  });
  return evaluateCondition(
    state,
    applyTriggerConditionResults(condition, results),
    "source",
    "alice",
    () => undefined
  );
}

describe("合算事象の観測条件を別事象から合成しない", () => {
  it("赤だけの事象と地霊だけの事象を足して赤かつ地霊を成立させない", () => {
    expect(
      qualifies([
        { "0": true, "1": false },
        { "0": false, "1": true },
      ])
    ).toBe(false);
  });
  it("1つの事象で全イベント条件が成立しても、現在の動的条件は必要", () => {
    const recorded = [
      { "0": true, "1": true },
      { "0": false, "1": false },
    ];
    expect(qualifies(recorded, 1)).toBe(false);
    expect(qualifies(JSON.parse(JSON.stringify(recorded)), 2)).toBe(true);
  });
  it("入れ子のOR内でも元のAND構造を保存する", () => {
    const condition: Condition = [
      {
        kind: "any_of",
        groups: [
          eventAndCondition,
          [{ kind: "count_value", player: "self", min: 5 }],
        ],
      },
    ];
    const recorded = [
      { "0/0/0": true, "0/0/1": false },
      { "0/0/0": false, "0/0/1": true },
    ];
    expect(qualifies(recorded, 2, condition)).toBe(false);
    expect(qualifies(recorded, 5, condition)).toBe(true);
  });
  it.each(
    [[], [true], [{ "0": true, "1": "true" }], [null]].map((value) => ({
      value,
    }))
  )("不正または空の観測枝を事象成立として扱わない: $value", ({ value }) => {
    const results = getObservedTriggerConditionResults({
      eventConditionResults: value as TriggerConditionObservationResults,
    });
    expect(qualifies(results!)).toBe(false);
  });
});
