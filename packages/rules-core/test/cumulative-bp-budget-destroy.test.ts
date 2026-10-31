/**
 * ENGINE-cumulative-bp-budget-destroy: 「自分のスピリットすべての合計BPまで、相手を
 * 好きなだけ破壊する」型 (BSAZ01-C11) の予算制対象選択の検証。
 *
 * 設計: `TargetSpec`(filter variant) に `budget:{metric:"bp", amount:Amount}` を追加し、
 * 解決時 (`resolveStepTargetCounts`) に `DynamicCountSource` 新種 `field_bp_total`
 * (自分の場カードの実効BP合計、SSOT `getEffectiveBp` の総和) で数値化して
 * `PendingStepOptionalTargetSelection.bpBudgetAmount` に保持する。検証は選択確定時
 * (`applyPendingStepOptionalTargetSelectionAction`) の単一 chokepoint で、選択済み
 * カードの実効BP合計が予算を超えないかを count 範囲チェックとは独立に行う。
 *
 * BSAZ01-C11 相当の4step構成 (第三者ブレイヴ合体→BP+4000→予算制破壊) を通し、
 * 複数候補からの選択が3回連続する effect でも `targetSelectionTiming:"on_step"` の
 * 逐次 break/resume が正しく合成されることも合わせて検証する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import type { Effect } from "../src/dsl-types";

function makeCardDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

const braveDef = makeCardDef("BRAVE-BUDGET", { printedCategory: "brave" });
const host1Def = makeCardDef("HOST-1", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
});
const host2Def = makeCardDef("HOST-2", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
});
const enemy3kDef = makeCardDef("ENEMY-3K", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
});
const enemy5kDef = makeCardDef("ENEMY-5K", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
});
const enemy10kDef = makeCardDef("ENEMY-10K", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 10000 }],
});

/** BSAZ01-C11 effects[2] 相当: 第三者ブレイヴ合体 → BP+4000 → 予算制破壊 (4 step)。 */
const budgetDestroyEffect: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      id: "select_brave",
      targetSelectionTiming: "on_step",
      action: {
        kind: "noop",
        target: {
          kind: "filter",
          player: "self",
          filter: { category: ["brave"], combined: false },
          count: 1,
        },
      },
    },
    {
      id: "combine_host",
      targetSelectionTiming: "on_step",
      stepCondition: { kind: "ref_succeeded", stepId: "select_brave" },
      action: {
        kind: "brave_combine_effect",
        source: { stepId: "select_brave" },
        target: {
          kind: "filter",
          player: "self",
          filter: { category: ["spirit"] },
          count: 1,
        },
      },
    },
    {
      action: {
        kind: "bp_modify",
        target: {
          kind: "filter",
          player: "self",
          filter: { category: ["spirit"] },
          count: "all",
        },
        amount: 4000,
        duration: { scope: "turn" },
      },
    },
    {
      id: "budget_destroy",
      targetSelectionTiming: "on_step",
      action: {
        kind: "destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: {
            filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
          },
          count: { min: 0 },
          budget: {
            metric: "bp",
            amount: {
              source: {
                kind: "field_bp_total",
                player: "self",
                filter: { category: ["spirit"] },
              },
            },
          },
        },
      },
    },
  ],
};

const sourceMagicDef = makeCardDef("SRC-BUDGET", {
  printedCategory: "magic",
  effects: [budgetDestroyEffect],
});

const defs = [
  sourceMagicDef,
  braveDef,
  host1Def,
  host2Def,
  enemy3kDef,
  enemy5kDef,
  enemy10kDef,
];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => map.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};

function baseState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [
      createCardInstance(sourceMagicDef, {
        instanceId: "src",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(braveDef, {
        instanceId: "brave-a",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 2,
      }),
      createCardInstance(braveDef, {
        instanceId: "brave-b",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 2,
      }),
      createCardInstance(host1Def, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(host2Def, {
        instanceId: "host-2",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemy3kDef, {
        instanceId: "enemy-3k",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemy5kDef, {
        instanceId: "enemy-5k",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(enemy10kDef, {
        instanceId: "enemy-10k",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  };
}

function zoneOf(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === instanceId)?.zone;
}

/** select_brave / combine_host の2連続 on_step pending を解決し、budget_destroy 直前まで進める。 */
function resolveThroughCombine(
  state: GameState,
  braveInstanceId: string,
  hostInstanceId: string
): GameState {
  const pendingState = executeEffect({
    chainId: "test:cumulative-bp-budget-destroy:237",
    state,
    effect: budgetDestroyEffect,
    effectIndex: 0,
    sourceInstanceId: "src",
    actingPlayerId: "alice",
    ...lookups,
  });
  const bravePending = pendingState.pendingStepOptionalTargetSelection!;
  expect(bravePending.targetStepId).toBe("select_brave");
  const afterBrave = applyLegalAction({
    state: pendingState,
    action: {
      kind: "resolve_pending_step_optional_target_selection",
      actionId: `psots-${bravePending.pendingId}`,
      can: true,
      reason: "test",
      actingPlayerId: bravePending.actingPlayerId,
      pendingId: bravePending.pendingId,
      sourceInstanceId: bravePending.sourceInstanceId,
      sourceDefinitionId: bravePending.sourceDefinitionId,
      effectIndex: bravePending.effectIndex,
      stepIndex: bravePending.stepIndex,
      requiredTargetCount: bravePending.requiredTargetCount,
      maxTargetCount: bravePending.maxTargetCount,
      candidateTargetInstanceIds: bravePending.candidateInstanceIds,
    },
    targetInstanceIds: [braveInstanceId],
    ...lookups,
  }).state;
  const hostPending = afterBrave.pendingStepOptionalTargetSelection!;
  expect(hostPending.targetStepId).toBe("combine_host");
  const afterCombine = applyLegalAction({
    state: afterBrave,
    action: {
      kind: "resolve_pending_step_optional_target_selection",
      actionId: `psots-${hostPending.pendingId}`,
      can: true,
      reason: "test",
      actingPlayerId: hostPending.actingPlayerId,
      pendingId: hostPending.pendingId,
      sourceInstanceId: hostPending.sourceInstanceId,
      sourceDefinitionId: hostPending.sourceDefinitionId,
      effectIndex: hostPending.effectIndex,
      stepIndex: hostPending.stepIndex,
      requiredTargetCount: hostPending.requiredTargetCount,
      maxTargetCount: hostPending.maxTargetCount,
      candidateTargetInstanceIds: hostPending.candidateInstanceIds,
    },
    targetInstanceIds: [hostInstanceId],
    ...lookups,
  }).state;
  return afterCombine;
}

describe("cumulative-bp-budget-destroy (ENGINE-cumulative-bp-budget-destroy, BSAZ01-C11)", () => {
  it("3連続 on_step pending が合成される: select_brave → combine_host → budget_destroy", () => {
    const afterCombine = resolveThroughCombine(
      baseState(),
      "brave-a",
      "host-1"
    );
    // 合体 + BP+4000 まで実行済み: brave-a は host-1 に合体している。
    const brave = afterCombine.cardInstances.find(
      (c) => c.instanceId === "brave-a"
    )!;
    expect(brave.attachedToInstanceId).toBe("host-1");
    // budget_destroy の on_step pending が立つ。
    const destroyPending = afterCombine.pendingStepOptionalTargetSelection!;
    expect(destroyPending.targetStepId).toBe("budget_destroy");
    expect(destroyPending.requiredTargetCount).toBe(0);
    expect(destroyPending.maxTargetCount).toBe(3);
    // 予算 = host-1(3000+bp_modify4000+合体ブレイヴbrave-aのBP+3000=10000) + host-2(1000+4000=5000)
    // = 15000。getCombinedUnitBp (10_rules/05 合体スピリットはブレイヴのBP＋加算込み) で算出。
    expect(destroyPending.bpBudgetAmount).toBe(15000);
    expect(destroyPending.candidateInstanceIds.sort()).toEqual(
      ["enemy-10k", "enemy-3k", "enemy-5k"].sort()
    );
  });

  it("予算以内の複数選択は成功し、選んだ対象のみ破壊される", () => {
    const afterCombine = resolveThroughCombine(
      baseState(),
      "brave-a",
      "host-1"
    );
    const destroyPending = afterCombine.pendingStepOptionalTargetSelection!;
    // enemy-3k(3000) + enemy-5k(5000) = 8000 <= 15000。
    const resolved = applyLegalAction({
      state: afterCombine,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${destroyPending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: destroyPending.actingPlayerId,
        pendingId: destroyPending.pendingId,
        sourceInstanceId: destroyPending.sourceInstanceId,
        sourceDefinitionId: destroyPending.sourceDefinitionId,
        effectIndex: destroyPending.effectIndex,
        stepIndex: destroyPending.stepIndex,
        requiredTargetCount: destroyPending.requiredTargetCount,
        maxTargetCount: destroyPending.maxTargetCount,
        candidateTargetInstanceIds: destroyPending.candidateInstanceIds,
      },
      targetInstanceIds: ["enemy-3k", "enemy-5k"],
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolved, "enemy-3k")).toBe("trash");
    expect(zoneOf(resolved, "enemy-5k")).toBe("trash");
    expect(zoneOf(resolved, "enemy-10k")).toBe("field");
  });

  it("予算超過の選択は reject される (enemy-3k+enemy-5k+enemy-10k=18000 > 15000)", () => {
    const afterCombine = resolveThroughCombine(
      baseState(),
      "brave-a",
      "host-1"
    );
    const destroyPending = afterCombine.pendingStepOptionalTargetSelection!;
    expect(() =>
      applyLegalAction({
        state: afterCombine,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${destroyPending.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: destroyPending.actingPlayerId,
          pendingId: destroyPending.pendingId,
          sourceInstanceId: destroyPending.sourceInstanceId,
          sourceDefinitionId: destroyPending.sourceDefinitionId,
          effectIndex: destroyPending.effectIndex,
          stepIndex: destroyPending.stepIndex,
          requiredTargetCount: destroyPending.requiredTargetCount,
          maxTargetCount: destroyPending.maxTargetCount,
          candidateTargetInstanceIds: destroyPending.candidateInstanceIds,
        },
        targetInstanceIds: ["enemy-3k", "enemy-5k", "enemy-10k"],
        ...lookups,
      })
    ).toThrow(/exceeds budget/);
  });

  it("0体選択 (好きなだけ=0体も可) は成功し、誰も破壊されない", () => {
    const afterCombine = resolveThroughCombine(
      baseState(),
      "brave-a",
      "host-1"
    );
    const destroyPending = afterCombine.pendingStepOptionalTargetSelection!;
    const resolved = applyLegalAction({
      state: afterCombine,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${destroyPending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: destroyPending.actingPlayerId,
        pendingId: destroyPending.pendingId,
        sourceInstanceId: destroyPending.sourceInstanceId,
        sourceDefinitionId: destroyPending.sourceDefinitionId,
        effectIndex: destroyPending.effectIndex,
        stepIndex: destroyPending.stepIndex,
        requiredTargetCount: destroyPending.requiredTargetCount,
        maxTargetCount: destroyPending.maxTargetCount,
        candidateTargetInstanceIds: destroyPending.candidateInstanceIds,
      },
      targetInstanceIds: [],
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolved, "enemy-3k")).toBe("field");
    expect(zoneOf(resolved, "enemy-5k")).toBe("field");
    expect(zoneOf(resolved, "enemy-10k")).toBe("field");
  });
});
