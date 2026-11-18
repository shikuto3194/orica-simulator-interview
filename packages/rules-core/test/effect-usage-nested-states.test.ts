/**
 * P3-170 W5: 旧形式 migration が訪問する「GameState を内包する型の型グラフ」(src/effect-usage/nested-states.ts) が、
 * model.ts の型から導出した結果と一致していること。生JSONの汎用再帰ではなく型から列挙した訪問であることの機械的強制。
 * 食い違ったら `node scripts/generate-effect-usage-nested-states.mjs` で再生成して差分を確認する。
 */
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNestedStateGraph } from "../../../scripts/lib/nested-state-graph.mjs";
import { NESTED_STATE_GRAPH } from "../src/effect-usage/nested-states";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("入れ子の GameState 型グラフ", () => {
  const derived = buildNestedStateGraph(root) as Record<
    string,
    {
      edges: { prop: string; array: boolean; targets: string[] }[];
      carriers: string[];
    }
  >;

  it("生成物は model.ts の型から再導出した型グラフと一致する", () => {
    expect(NESTED_STATE_GRAPH).toEqual(derived);
  }, 60_000);

  it("設計が参照する親型とフィールドを含む (priorStateSnapshot / effectResolutionBeforeState / 追加ターン退避)", () => {
    const direct = (type: string, prop: string): boolean =>
      NESTED_STATE_GRAPH[type]?.edges.some(
        (e) => e.prop === prop && e.targets.includes("GameState")
      ) ?? false;
    expect(direct("PendingZoneSelection", "priorStateSnapshot")).toBe(true);
    expect(direct("PendingDeckReveal", "priorStateSnapshot")).toBe(true);
    expect(direct("PendingStoneFlipCombine", "priorStateSnapshot")).toBe(true);
    expect(direct("PendingCoreCountSelection", "priorStateSnapshot")).toBe(
      true
    );
    expect(direct("PendingCountSelection", "priorStateSnapshot")).toBe(true);
    expect(
      direct("PendingDiscardSetBurstCountSelection", "priorStateSnapshot")
    ).toBe(true);
    expect(direct("PendingCoreDistribution", "priorStateSnapshot")).toBe(true);
    expect(direct("PendingMultiPlacement", "priorStateSnapshot")).toBe(true);
    expect(
      direct("PendingAfterTriggersContinuation", "effectResolutionBeforeState")
    ).toBe(true);
    expect(
      direct("TargetedDisclosureContinuation", "effectResolutionBeforeState")
    ).toBe(true);
    expect(
      direct(
        "CoreDistributionTargetInterruptionContext",
        "effectResolutionBeforeState"
      )
    ).toBe(true);
    expect(
      direct("LifeCoreSelectionContinuation", "resumePreviousStepPreState")
    ).toBe(true);
    expect(
      direct("ZoneSelectionContinuation", "resumePreviousStepPreState")
    ).toBe(true);
    expect(
      direct("CoreDistributionContinuation", "resumePreviousStepPreState")
    ).toBe(true);
    expect(direct("DeferredSummonDeclaration", "originalState")).toBe(true);
    expect(direct("PendingConditionalCostRollback", "originalState")).toBe(
      true
    );
    expect(
      direct("SerializedStepContext", "conditionalCostOriginalState")
    ).toBe(true);
    expect(
      direct("SerializedStepContext", "resolutionSegmentBeforeState")
    ).toBe(true);
    expect(direct("StepResult", "stateSnapshot")).toBe(true);
    expect(
      direct("PendingLifeCoreSelection.deferredCoreMoveChoice", "beforeState")
    ).toBe(true);
    expect(
      direct("PendingBraveCombineChoice.effectSummon", "triggerBeforeState")
    ).toBe(true);
    expect(
      NESTED_STATE_GRAPH["GameState"]?.edges.some(
        (e) => e.prop === "extraTurnState"
      )
    ).toBe(true);
    expect(
      NESTED_STATE_GRAPH["ExtraTurnState.returnContext"]?.edges.some(
        (e) => e.prop === "extraTurnState"
      )
    ).toBe(true);
  });

  it("使用会計の運搬フィールド (receipt) を持つ型を含む", () => {
    expect(NESTED_STATE_GRAPH["ActiveStack"]?.carriers).toEqual([
      "normalHandPlayRollback",
      "recordedUsage",
    ]);
    expect(NESTED_STATE_GRAPH["PendingTurnEndFinalization"]?.carriers).toEqual([
      "refundableUsage",
    ]);
    expect(
      NESTED_STATE_GRAPH["PendingAttackStepEndFinalization"]?.carriers
    ).toEqual(["refundableUsage"]);
  });
});
