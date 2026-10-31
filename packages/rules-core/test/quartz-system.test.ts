import { collectAfterPhysicalLeave } from "./physical-leave-test-helper";
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  setQuartz,
  canSetQuartz,
  releaseQuartzOnHostLeave,
  getQuartzAttributeSum,
  getQuartzSlotCounts,
  useSetQuartzAsAction,
  canPayQuartzCountCost,
} from "../src/mechanics/quartz-system";
import {
  getAvailableSetQuartzLegalActions,
  getAvailableActivateSoulStateLegalActions,
  getAvailableFieldCardEffectLegalActions,
} from "../src/legal/legal-actions-availability";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  getHandCardLegalActionKind,
  getSoulStateActivationEffectIndex,
} from "../src/legal/legal-actions-shared";
import {
  queuePendingLeave,
  flushPendingLeaves,
  runStateBasedActions,
} from "../src/state-based-actions";
import { refreshExhaustStates } from "../src/core/core-system";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import {
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  generateFieldCardEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  finalizeCardUsageAndQueueTriggers,
  queuePendingReactionsFromTriggerEvents,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import type { CollectedTriggerEvent } from "../src/effect/trigger-system";
import {
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src/effect/continuous-effect-rebuild";
import { collectContinuousEffectInvariantIssues } from "../src/invariants/game-state-invariants-continuous";
import { getEffectiveSymbols } from "../src/battle/battle-shared";
import { getApplicableAdditionalCostDelta } from "../src/card/card-filter";
import {
  runReevaluationAtTiming,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import { resolveTargets } from "../src/effect/native-target-resolution";
import { getExpandEffectTargetCountBonusDeclarative } from "../src/effect/expand-effect-target-count";
import { createStepExecutionContext } from "../src/step-execution-context";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  Step,
} from "../src/model";
import type { Effect } from "../src/dsl-types";
import type { GameStateInvariantIssue } from "../src/invariants/game-state-invariant-types";
import type { GetLegalActionsOptions } from "../src/legal/legal-actions-types";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テスト",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

const hostDef = makeDef({
  cardNo: "ENIGMA-TEST",
  name: "ENIGMA[戦術オーブメント]",
  printedCategory: "brave",
  quartzHostData: {
    slots: { left: 3, center: 1, right: 3 },
    inheritsSetQuartzEffects: true,
  },
  relatedTokenCardNos: ["ARTS-AUTO"],
});
const automaticArtsTokenDef = makeDef({
  cardNo: "ARTS-AUTO",
  name: "自動配置アーツ",
  printedCategory: "magic",
  continuousSummonCondition: true,
  summonCondition: [
    { kind: "quartz_attribute", player: "self", attribute: "時", min: 5 },
  ],
  maxTokenDeckCount: 1,
});
const q1Def = makeDef({
  cardNo: "Q1",
  name: "双魚珠カード",
  quartzData: {
    quartzName: "双魚珠",
    cost: 0,
    reduction: [],
    attributeValues: { 時: 5 },
  },
});
const q2Def = makeDef({
  cardNo: "Q2",
  name: "処女珠カード",
  quartzData: {
    quartzName: "処女珠",
    cost: 0,
    reduction: [],
    attributeValues: { 風: 3, 時: 2 },
  },
});
const q3Def = makeDef({
  cardNo: "Q3",
  name: "双魚珠（別カード同名）",
  quartzData: { quartzName: "双魚珠", cost: 0, reduction: [] },
});

const q4Def = makeDef({
  cardNo: "Q4",
  name: "カウント消費珠",
  quartzData: {
    quartzName: "機功",
    cost: 0,
    countCost: 2,
    reduction: [],
    attributeValues: { 地: 3 },
  },
});

const DEFS: Record<string, CardDefinition> = {
  "ENIGMA-TEST": hostDef,
  "ARTS-AUTO": automaticArtsTokenDef,
  Q1: q1Def,
  Q2: q2Def,
  Q3: q3Def,
  Q4: q4Def,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

/** host を魂状態でフィールドに、q1/q2/q3 を alice の手札に置いた初期状態。 */
function setup(hostInSoulState = true): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const host = createCardInstance(hostDef, {
    ownerPlayerId: ALICE,
    zone: "field",
    instanceId: "host",
  });
  const mk = (def: CardDefinition, id: string) =>
    createCardInstance(def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: id,
    });
  return {
    ...base,
    cardInstances: [host, mk(q1Def, "q1"), mk(q2Def, "q2"), mk(q3Def, "q3")],
    players: base.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            handCount: 3,
            soulStateInstanceIds: hostInSoulState ? ["host"] : [],
          }
        : p
    ),
  };
}

describe("quartz-system F2.1 状態プリミティブ", () => {
  it("setQuartz: 魂状態 host にセット → QuartzSetState 追加・セット中=魂状態・field(quartz)へ", () => {
    const next = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    );
    expect(next).not.toBeNull();
    const s = next!;
    expect(s.quartzSetStates).toHaveLength(1);
    expect(s.quartzSetStates[0]).toMatchObject({
      quartzInstanceId: "q1",
      hostInstanceId: "host",
      slot: "center",
    });
    const alice = s.players.find((p) => p.id === ALICE)!;
    expect(alice.soulStateInstanceIds).toContain("q1");
    const q1 = s.cardInstances.find((c) => c.instanceId === "q1")!;
    expect(q1.zone).toBe("field");
    expect(q1.zoneRoleName).toBe("quartz");
    expect(q1.normalCoreCount).toBe(0);
  });

  it("canSetQuartz: host が魂状態でなければ host_not_soul_state", () => {
    const r = canSetQuartz(setup(false), "q1", "host", "center", getDef);
    expect(r).toEqual({ ok: false, reason: "host_not_soul_state" });
  });

  it("スロット上限: center=1 が埋まると slot_full（同名異種で2枚目）", () => {
    const afterFirst = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    expect(getQuartzSlotCounts(afterFirst, "host").center).toBe(1);
    const r = canSetQuartz(afterFirst, "q2", "host", "center", getDef);
    expect(r.reason).toBe("slot_full");
    // 別スロット(left)には置ける
    expect(canSetQuartz(afterFirst, "q2", "host", "left", getDef).ok).toBe(
      true
    );
  });

  it("異名: 同名クォーツ2枚目は duplicate_name（qa-029）", () => {
    const afterFirst = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getDef
    )!;
    // q3 は q1 と同じクォーツ名「双魚珠」
    const r = canSetQuartz(afterFirst, "q3", "host", "right", getDef);
    expect(r.reason).toBe("duplicate_name");
  });

  it("同一クォーツ instance は二重にセットできない", () => {
    const afterFirst = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;

    expect(canSetQuartz(afterFirst, "q1", "host", "left", getDef)).toEqual({
      ok: false,
      reason: "already_set",
    });
  });

  it("getQuartzAttributeSum: セット中クォーツの属性値を合計（qa-033）", () => {
    let s = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    s = setQuartz(
      s,
      {
        quartzInstanceId: "q2",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getDef
    )!;
    expect(getQuartzAttributeSum(s, "host", "時", getDef)).toBe(7); // 5 + 2
    expect(getQuartzAttributeSum(s, "host", "風", getDef)).toBe(3);
    expect(getQuartzAttributeSum(s, "host", "火", getDef)).toBe(0);
  });

  it("releaseQuartzOnHostLeave: host 離脱でクォーツを destZone へ追従・セット解除", () => {
    const set = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    const released = releaseQuartzOnHostLeave(set, "host", "trash");
    expect(released.quartzSetStates).toHaveLength(0);
    const alice = released.players.find((p) => p.id === ALICE)!;
    expect(alice.soulStateInstanceIds).not.toContain("q1");
    const q1 = released.cardInstances.find((c) => c.instanceId === "q1")!;
    expect(q1.zone).toBe("trash");
  });

  it("セット中クォーツ自身が離脱すると binding と魂状態を解除する", () => {
    const set = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    const queued = queuePendingLeave({
      state: set,
      instanceId: "q1",
      kind: "bounce",
      cause: "effect_resolution",
      chainId: "test-chain:quartz-self-bounce",
      leaveDestination: { zone: "hand" },
    });
    const after = flushPendingLeaves(queued, getDef);

    expect(after.quartzSetStates).toEqual([]);
    expect(
      after.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).not.toContain("q1");
    expect(after.cardInstances.find((c) => c.instanceId === "q1")!.zone).toBe(
      "hand"
    );
  });
});

/** メインステップ・alice 手番・q4(countCost2) も手札に追加した初期状態。 */
function setupAction(countValue = 5): GameState {
  const base = setup();
  const q4 = createCardInstance(q4Def, {
    ownerPlayerId: ALICE,
    zone: "hand",
    instanceId: "q4",
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    cardInstances: [...base.cardInstances, q4],
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, countValue, handCount: 4 } : p
    ),
  };
}

const buildOptions = (state: GameState): GetLegalActionsOptions =>
  ({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
  }) as GetLegalActionsOptions;

function passOpenStack(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: GetLegalActionsOptions["getRegisteredTriggeredEffectActions"] = () => []
): GameState {
  expect(state.stackWindow).not.toBeNull();
  const actingPlayerId = state.stackWindow!.priorityPlayerId;
  const pass = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredFieldCardEffectActions: () => undefined,
  } as GetLegalActionsOptions).find((action) => action.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).state;
}

describe("quartz-system F2.2 アクション層", () => {
  it("getAvailableSetQuartzLegalActions: 手札クォーツ×空きスロットを列挙（4枚×3スロット）", () => {
    const actions = getAvailableSetQuartzLegalActions(
      buildOptions(setupAction())
    );
    expect(actions).toHaveLength(12);
    expect(actions.every((a) => a.kind === "set_quartz")).toBe(true);
    const q1center = actions.find(
      (a) => a.sourceInstanceId === "q1" && a.slot === "center"
    );
    expect(q1center).toBeDefined();
    expect(q1center!.hostInstanceId).toBe("host");
  });

  it("相手の手札クォーツはセット候補にせず、直接 action 実行も拒否する", () => {
    const base = setupAction();
    const opponentQuartz = createCardInstance(q1Def, {
      ownerPlayerId: BOB,
      zone: "hand",
      instanceId: "bob-q1",
    });
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, opponentQuartz],
      players: base.players.map((player) =>
        player.id === BOB ? { ...player, handCount: 1 } : player
      ),
    };
    const actions = getAvailableSetQuartzLegalActions(buildOptions(state));

    expect(actions.some((action) => action.sourceInstanceId === "bob-q1")).toBe(
      false
    );
    expect(() =>
      useSetQuartzAsAction({
        state,
        actingPlayerId: ALICE,
        quartzInstanceId: "bob-q1",
        hostInstanceId: "host",
        slot: "left",
        getCardDefinitionById: getDef,
      })
    ).toThrow("source_unavailable");
  });

  it("useSetQuartzAsAction: セット実行（countCost 0 はカウント不変）", () => {
    const { state } = useSetQuartzAsAction({
      state: setupAction(),
      actingPlayerId: ALICE,
      quartzInstanceId: "q1",
      hostInstanceId: "host",
      slot: "center",
      getCardDefinitionById: getDef,
    });
    expect(state.quartzSetStates).toHaveLength(1);
    const alice = state.players.find((p) => p.id === ALICE)!;
    expect(alice.soulStateInstanceIds).toContain("q1");
    expect(alice.countValue).toBe(5); // q1 は countCost なし
  });

  it("カウントコスト: countCost2 を払うとカウントが減る", () => {
    expect(canPayQuartzCountCost(setupAction(5), ALICE, 2)).toBe(true);
    const { state } = useSetQuartzAsAction({
      state: setupAction(5),
      actingPlayerId: ALICE,
      quartzInstanceId: "q4",
      hostInstanceId: "host",
      slot: "left",
      getCardDefinitionById: getDef,
    });
    expect(state.players.find((p) => p.id === ALICE)!.countValue).toBe(3);
  });

  it("qa-039: 神喰の保護カウントだけでもクォーツコストを支払える", () => {
    const base = setupAction(2);
    const before = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, countValue: 2, protectedCounts: { 神喰: 2 } }
          : p
      ),
    };
    const actions = getAvailableSetQuartzLegalActions(buildOptions(before));
    expect(actions.some((a) => a.sourceInstanceId === "q4")).toBe(true);

    const { state } = useSetQuartzAsAction({
      state: before,
      actingPlayerId: ALICE,
      quartzInstanceId: "q4",
      hostInstanceId: "host",
      slot: "left",
      getCardDefinitionById: getDef,
    });

    const alice = state.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    expect(alice.protectedCounts).toBeUndefined();
  });

  it("applyLegalAction: クォーツセットはカウント支払い後にスタック窓を開き、pass 後にセットされる", () => {
    const before = setupAction(5);
    const action = getAvailableSetQuartzLegalActions(buildOptions(before)).find(
      (candidate) => candidate.sourceInstanceId === "q4"
    )!;
    const { state: declared } = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "set_quartz"
    );
    expect(declared.players.find((p) => p.id === ALICE)!.countValue).toBe(3);
    expect(declared.quartzSetStates).toHaveLength(0);
    expect(
      declared.cardInstances.find((c) => c.instanceId === "q4")!.zone
    ).toBe("hand");

    const after = passOpenStack(declared, getDef);
    expect(after.stackWindow).toBeNull();
    expect(after.quartzSetStates).toHaveLength(1);
    expect(after.quartzSetStates[0]).toMatchObject({
      quartzInstanceId: "q4",
      hostInstanceId: "host",
    });
    expect(
      after.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).toContain("q4");
  });

  it("applyLegalAction: クォーツセットのスタック解決後に【アーツ】を状態ベースで自動配置する", () => {
    const before = setupAction(5);
    const action = getAvailableSetQuartzLegalActions(buildOptions(before)).find(
      (candidate) =>
        candidate.sourceInstanceId === "q1" && candidate.slot === "center"
    )!;
    const { state: declared } = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const after = passOpenStack(declared, getDef);
    expect(after.quartzSetStates).toContainEqual(
      expect.objectContaining({
        quartzInstanceId: "q1",
        hostInstanceId: "host",
      })
    );
    expect(after.cardInstances).toContainEqual(
      expect.objectContaining({
        definitionId: "ARTS-AUTO",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "arts",
      })
    );
    expect(after.log).toContainEqual(
      expect.stringMatching(/^sba:place_arts_token_due_to_condition:/)
    );
  });

  it("カウント不足: 払えない countCost のクォーツは列挙されない", () => {
    const actions = getAvailableSetQuartzLegalActions(
      buildOptions(setupAction(1))
    );
    // q4(countCost2) は除外、cost0 の q1/q2/q3 のみ（3枚×3スロット=9）
    expect(actions.some((a) => a.sourceInstanceId === "q4")).toBe(false);
    expect(actions).toHaveLength(9);
  });
});

describe("quartz-system F2.3 条件: quartz_attribute（アーツ解放ゲート）", () => {
  it("セット中クォーツの属性値合計を ConditionClause で評価（qa-033）", () => {
    let s = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!; // 時:5
    s = setQuartz(
      s,
      {
        quartzInstanceId: "q2",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getDef
    )!; // 風:3 時:2
    const cond = (attribute: "時" | "風" | "火", min: number) =>
      evaluateCondition(
        s,
        [{ kind: "quartz_attribute", player: "self", attribute, min }],
        "host",
        ALICE,
        getDef
      );
    expect(cond("時", 7)).toBe(true); // 5 + 2
    expect(cond("時", 8)).toBe(false);
    expect(cond("風", 3)).toBe(true);
    expect(cond("火", 1)).toBe(false);
  });
});

describe("quartz-system F2.3 トリガー: quartz_set / enter_soul_state", () => {
  const hostTrigDef = makeDef({
    cardNo: "ENIGMA-TRIG",
    name: "ENIGMA(trigger)",
    printedCategory: "brave",
    quartzHostData: {
      slots: { left: 3, center: 1, right: 3 },
      inheritsSetQuartzEffects: true,
    },
    effects: [
      {
        timing: { kind: "game_event", player: "self", event: "quartz_set" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      {
        timing: { kind: "card_event", event: "enter_soul_state" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 2 } },
        ],
      },
    ],
  });
  const trigDefs: Record<string, CardDefinition> = {
    "ENIGMA-TRIG": hostTrigDef,
    Q1: q1Def,
  };
  const getD = (id: string): CardDefinition | undefined => trigDefs[id];
  const lookup = buildTriggeredEffectLookup([hostTrigDef, q1Def]);

  function baseState(hostSoul: boolean): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(hostTrigDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const q1 = createCardInstance(q1Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "q1",
    });
    return {
      ...base,
      cardInstances: [host, q1],
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              handCount: 1,
              soulStateInstanceIds: hostSoul ? ["host"] : [],
            }
          : p
      ),
    };
  }

  it("quartz_set: クォーツセットで host に quartz_set 誘発が積まれる", () => {
    const before = baseState(true);
    const after = setQuartz(
      before,
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getD
    )!;
    const res = collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:639",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      res.pendingTriggeredEffects.filter((p) => p.eventKind === "quartz_set")
    ).toHaveLength(1);
  });

  it("enter_soul_state: host が魂状態になると enter_soul_state 誘発が積まれる", () => {
    const before = baseState(false);
    const after = {
      ...before,
      players: before.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    const res = collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:660",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      res.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "enter_soul_state"
      )
    ).toHaveLength(1);
  });
});

describe("quartz-system F2.4b④ SBA host 離脱でクォーツ追従", () => {
  it("host 破壊時、セット中クォーツがトラッシュへ追従しセット解除される", () => {
    const set = setQuartz(
      setup(),
      {
        quartzInstanceId: "q1",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    expect(set.quartzSetStates).toHaveLength(1);

    const queued = queuePendingLeave({
      state: set,
      instanceId: "host",
      kind: "destroy",
      cause: "self_effect",
      chainId: "test-chain",
    });
    const after = flushPendingLeaves(queued, getDef);

    // host はトラッシュへ、セット中クォーツ q1 も追従してトラッシュへ・セット解除。
    expect(after.quartzSetStates).toHaveLength(0);
    expect(after.cardInstances.find((c) => c.instanceId === "host")!.zone).toBe(
      "trash"
    );
    expect(after.cardInstances.find((c) => c.instanceId === "q1")!.zone).toBe(
      "trash"
    );
    expect(
      after.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).not.toContain("q1");
  });
});

describe("quartz-system F2.4b 魂状態化アクション: activate_soul_state", () => {
  // 手札からの魂状態化 + 「魂状態になったとき」count+2 トリガーを持つ host。
  const enigmaActDef = makeDef({
    cardNo: "ENIGMA-ACT",
    name: "ENIGMA(activate)",
    printedCategory: "brave",
    quartzHostData: {
      slots: { left: 3, center: 1, right: 3 },
      inheritsSetQuartzEffects: true,
    },
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          { action: { kind: "enter_soul_state", target: { kind: "self" } } },
        ],
      },
      {
        timing: { kind: "card_event", event: "enter_soul_state" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 2 } },
        ],
      },
    ],
  });
  const defs: Record<string, CardDefinition> = { "ENIGMA-ACT": enigmaActDef };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([enigmaActDef]);

  function handState(): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const enigma = createCardInstance(enigmaActDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "enigma",
    });
    return {
      ...base,
      step: "main",
      activePlayerId: ALICE,
      cardInstances: [enigma],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1, countValue: 0 } : p
      ),
    };
  }

  const listActions = (state: GameState) =>
    getAvailableActivateSoulStateLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    } as GetLegalActionsOptions);

  it("getAvailableActivateSoulStateLegalActions: 手札の ENIGMA を1件列挙", () => {
    const actions = listActions(handState());
    expect(actions).toHaveLength(1);
    expect(actions[0]!.sourceInstanceId).toBe("enigma");
    expect(actions[0]!.kind).toBe("activate_soul_state");
  });

  it("メインステップ外/相手手番では列挙されない", () => {
    const s = handState();
    expect(listActions({ ...s, step: "attack" })).toHaveLength(0);
    expect(listActions({ ...s, activePlayerId: BOB })).toHaveLength(0);
  });

  it("「魂状態以外で存在不可」: 魂状態化起動効果を持つカードは通常召喚されない", () => {
    // ENIGMA-ACT は activate_soul_state を持つ → getHandCardLegalActionKind は null。
    expect(getSoulStateActivationEffectIndex(enigmaActDef)).toBe(0);
    expect(getHandCardLegalActionKind(enigmaActDef)).toBeNull();
    // 通常の brave/spirit は summon のまま（回帰防止）。
    expect(getSoulStateActivationEffectIndex(hostDef)).toBeNull();
    expect(getHandCardLegalActionKind(q1Def)).toBe("summon");
  });

  it("applyLegalAction: 手札 ENIGMA は宣言窓を開き、pass 後に field へ移動し魂状態化 + enter_soul_state 誘発", () => {
    const before = handState();
    const action = listActions(before)[0]!;
    const { state: declared } = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "activate_soul_state"
    );
    expect(
      declared.cardInstances.find((c) => c.instanceId === "enigma")!.zone
    ).toBe("hand");

    const after = passOpenStack(declared, getD, lookup);
    const enigma = after.cardInstances.find((c) => c.instanceId === "enigma")!;
    expect(enigma.zone).toBe("field");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.soulStateInstanceIds).toContain("enigma");
    expect(alice.handCount).toBe(0);
    // 「魂状態になったとき」count+2 が誘発キューに積まれる
    expect(
      after.pendingTriggeredEffects.some(
        (p) => p.eventKind === "enter_soul_state"
      )
    ).toBe(true);
  });

  // BSLH01-CX01「手札/手元にあるこのカードは…魂状態にできる」の手元(set_aside)経路。
  // applicability.zone:["hand","set_aside"] を持つ ENIGMA は set_aside からでも列挙され、
  // field へ移動して魂状態化される。
  const enigmaBothDef = makeDef({
    cardNo: "ENIGMA-BOTH",
    name: "ENIGMA(hand+set_aside)",
    printedCategory: "brave",
    quartzHostData: {
      slots: { left: 3, center: 1, right: 3 },
      inheritsSetQuartzEffects: true,
    },
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        steps: [
          { action: { kind: "enter_soul_state", target: { kind: "self" } } },
        ],
      },
      {
        timing: { kind: "card_event", event: "enter_soul_state" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 2 } },
        ],
      },
    ],
  });
  const bothDefs: Record<string, CardDefinition> = {
    "ENIGMA-BOTH": enigmaBothDef,
  };
  const getDBoth = (id: string): CardDefinition | undefined => bothDefs[id];
  const lookupBoth = buildTriggeredEffectLookup([enigmaBothDef]);

  function setAsideState(): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const enigma = createCardInstance(enigmaBothDef, {
      ownerPlayerId: ALICE,
      zone: "set_aside",
      instanceId: "enigma",
    });
    return {
      ...base,
      step: "main",
      activePlayerId: ALICE,
      cardInstances: [enigma],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 0, countValue: 0 } : p
      ),
    };
  }

  it("BSLH01-CX01: applicability.zone=['hand','set_aside'] の ENIGMA は手元からも列挙される", () => {
    const actions = getAvailableActivateSoulStateLegalActions({
      state: setAsideState(),
      actingPlayerId: ALICE,
      getCardDefinitionById: getDBoth,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    } as GetLegalActionsOptions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.sourceInstanceId).toBe("enigma");
    expect(actions[0]!.kind).toBe("activate_soul_state");
  });

  it("BSLH01-CX01: 手元 ENIGMA は宣言窓を開き、pass 後に field へ移動し魂状態化 + enter_soul_state 誘発", () => {
    const before = setAsideState();
    const actions = getAvailableActivateSoulStateLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDBoth,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    } as GetLegalActionsOptions);
    const { state: declared } = applyLegalAction({
      state: before,
      action: actions[0]!,
      getCardDefinitionById: getDBoth,
      getRegisteredTriggeredEffectActions: lookupBoth,
    });
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "activate_soul_state"
    );
    expect(
      declared.cardInstances.find((c) => c.instanceId === "enigma")!.zone
    ).toBe("set_aside");

    const after = passOpenStack(declared, getDBoth, lookupBoth);
    const enigma = after.cardInstances.find((c) => c.instanceId === "enigma")!;
    expect(enigma.zone).toBe("field");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.soulStateInstanceIds).toContain("enigma");
    expect(
      after.pendingTriggeredEffects.some(
        (p) => p.eventKind === "enter_soul_state"
      )
    ).toBe(true);
  });

  it("BSLH01-CX01: applicability.zone:['hand','set_aside'] の activate 効果は field-card registry に漏れない", () => {
    // verifier 反証: 配列 zone がスカラ "hand" マッチを bypass し field 登録される
    // silent gap を防止 (structured-effect-registrations.ts:2403 の SSOT 修正)。
    const regs = generateFieldCardEffectRegistrations(enigmaBothDef);
    expect(regs).toHaveLength(0);
  });

  it("BSLH01-CX01: getSoulStateActivationEffectIndex は sourceZone ごとに判定する", () => {
    // applicability.zone=['hand','set_aside'] → 両 zone で同じ effect index
    expect(getSoulStateActivationEffectIndex(enigmaBothDef, "hand")).toBe(0);
    expect(getSoulStateActivationEffectIndex(enigmaBothDef, "set_aside")).toBe(
      0
    );
    // hand 限定 (ENIGMA-ACT) → set_aside では null（既存挙動の回帰防止）
    expect(getSoulStateActivationEffectIndex(enigmaActDef, "hand")).toBe(0);
    expect(getSoulStateActivationEffectIndex(enigmaActDef, "set_aside")).toBe(
      null
    );
  });

  it("BSLH01-CX01: 魂状態でない field ENIGMA は SBA で存在できず trash へ送られる", () => {
    const enigmaDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-CX01");
    if (!enigmaDef) throw new Error("BSLH01-CX01 not found in ALL_CARDS");
    const getRealDef = (id: string): CardDefinition | undefined =>
      ALL_CARDS.find((c) => c.cardNo === id);
    const enigma = createCardInstance(enigmaDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "enigma-cx01",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enigma],
      playerOverrides: [{ soulStateInstanceIds: [] }, {}],
    });

    const result = runStateBasedActions(base, getRealDef);

    expect(result.checks).toContainEqual({
      kind: "vanish_due_to_soul_state_only_field",
      instanceId: "enigma-cx01",
      detail: "soul-state-only-card-on-field-without-soul-state",
    });
    const pending = result.state.cardInstances.find(
      (c) => c.instanceId === "enigma-cx01"
    )!;
    expect(pending.pendingLeaveKind).toBe("rule_cleanup");
    const flushed = flushPendingLeaves(result.state, getRealDef);
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "enigma-cx01")!.zone
    ).toBe("trash");
  });

  it("BSLH01-CX01: 魂状態の field ENIGMA は soul-state-only SBA の対象外", () => {
    const enigmaDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-CX01");
    if (!enigmaDef) throw new Error("BSLH01-CX01 not found in ALL_CARDS");
    const getRealDef = (id: string): CardDefinition | undefined =>
      ALL_CARDS.find((c) => c.cardNo === id);
    const enigma = createCardInstance(enigmaDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "enigma-cx01",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enigma],
      playerOverrides: [{ soulStateInstanceIds: ["enigma-cx01"] }, {}],
    });

    const result = runStateBasedActions(base, getRealDef);

    expect(
      result.checks.some(
        (check) => check.kind === "vanish_due_to_soul_state_only_field"
      )
    ).toBe(false);
    expect(
      result.state.cardInstances.find((c) => c.instanceId === "enigma-cx01")!
        .zone
    ).toBe("field");
  });

  it("BSLH01-CX01: 魂状態以外で存在不可の SBA は cannot_leave_field で阻止されない", () => {
    const enigmaDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-CX01");
    if (!enigmaDef) throw new Error("BSLH01-CX01 not found in ALL_CARDS");
    const getRealDef = (id: string): CardDefinition | undefined =>
      ALL_CARDS.find((c) => c.cardNo === id);
    const enigma = createCardInstance(enigmaDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "enigma-cx01",
    });
    const cannotLeave: ContinuousEffect = {
      effectId: "ce-cannot-leave-enigma",
      sourceInstanceId: "resistance-source",
      sourceDefinitionId: "TEST-RESISTANCE",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_leave_field",
      targetInstanceId: "enigma-cx01",
      metadata: { source: "opponent_effect" },
    };
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enigma],
      playerOverrides: [{ soulStateInstanceIds: [] }, {}],
    });

    const result = runStateBasedActions(
      { ...base, activeContinuousEffects: [cannotLeave] },
      getRealDef,
      BOB,
      "bob-effect-source"
    );

    const pending = result.state.cardInstances.find(
      (c) => c.instanceId === "enigma-cx01"
    )!;
    expect(pending.pendingLeaveKind).toBe("rule_cleanup");
    const entry = result.state.pendingLeaveEntities.find(
      (e) => e.instanceId === "enigma-cx01"
    );
    expect(entry?.blockedByResistance).toBeUndefined();
    expect(entry?.causePlayerId).toBeNull();
    expect(entry?.causedByEffectSourceInstanceId).toBeUndefined();
    const flushed = flushPendingLeaves(result.state, getRealDef);
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "enigma-cx01")!.zone
    ).toBe("trash");
  });

  it("BSLH01-CX01: 魂状態以外で存在不可の cleanup は replace_field_exit で置換されない", () => {
    const enigmaDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-CX01");
    if (!enigmaDef) throw new Error("BSLH01-CX01 not found in ALL_CARDS");
    const getRealDef = (id: string): CardDefinition | undefined =>
      ALL_CARDS.find((c) => c.cardNo === id);
    const enigma = createCardInstance(enigmaDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "enigma-cx01",
    });
    const replaceToHand: ContinuousEffect = {
      effectId: "ce-replace-enigma-cleanup",
      sourceInstanceId: "replacement-source",
      sourceDefinitionId: "TEST-REPLACEMENT",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "replace_field_exit",
      targetInstanceId: "enigma-cx01",
      metadata: {
        trigger: "leave_field",
        source: "all",
        replacement: { kind: "move_to", zone: "hand" },
      },
    };
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enigma],
      playerOverrides: [{ soulStateInstanceIds: [], handCount: 0 }, {}],
    });

    const result = runStateBasedActions(
      { ...base, activeContinuousEffects: [replaceToHand] },
      getRealDef
    );
    const flushed = flushPendingLeaves(result.state, getRealDef);

    expect(
      flushed.cardInstances.find((c) => c.instanceId === "enigma-cx01")!.zone
    ).toBe("trash");
    expect(flushed.players.find((p) => p.id === ALICE)!.handCount).toBe(0);
    expect(flushed.log.some((entry) => entry.startsWith("replacement:"))).toBe(
      false
    );
  });

  it("BSLH01-CX01: 魂状態以外で存在不可の cleanup は消滅誘発をキューしない", () => {
    const enigmaDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-CX01");
    if (!enigmaDef) throw new Error("BSLH01-CX01 not found in ALL_CARDS");
    const watcherDef = makeDef({
      cardNo: "TEST-VANISH-WATCHER",
      name: "消滅監視",
      effects: [
        {
          timing: { kind: "card_event", event: "vanish" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0],
        },
      ],
    });
    const getDef = (id: string): CardDefinition | undefined =>
      id === watcherDef.cardNo
        ? watcherDef
        : ALL_CARDS.find((c) => c.cardNo === id);
    const enigma = createCardInstance(enigmaDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "enigma-cx01",
    });
    const watcher = createCardInstance(watcherDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "watcher-1",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enigma, watcher],
      playerOverrides: [{ soulStateInstanceIds: [] }, {}],
    });
    const afterSba = runStateBasedActions(base, getDef).state;

    const queued = collectAndQueueTriggerReactions({
      beforeState: base,
      afterState: afterSba,
      source: "action_resolution",
      chainId: "test:soul-state-only-cleanup",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        watcherDef,
      ]),
      getRegisteredBurstActions: undefined,
    });

    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    const flushed = flushPendingLeaves(afterSba, getDef);
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "enigma-cx01")!.zone
    ).toBe("trash");
  });
});

describe("quartz-system F2.4b① set-effect: 機功（phase end + quartz_attribute + applicability.soulState）", () => {
  // 機功: セット中、自分エンドステップに <地>合計10以上でボイド→リザーブにコア2。
  const jikoDef = makeDef({
    cardNo: "JIKO",
    name: "機功カード",
    quartzData: {
      quartzName: "機功",
      cost: 0,
      reduction: [],
      attributeValues: { 地: 3 },
    },
    effects: [
      {
        timing: { kind: "phase", step: "end", whose: "self", subPhase: "end" },
        applicability: { soulState: true },
        condition: [
          {
            kind: "quartz_attribute",
            player: "self",
            attribute: "地",
            min: 10,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      },
    ],
  });
  const earthDef = makeDef({
    cardNo: "EARTH",
    name: "土珠",
    quartzData: {
      quartzName: "土珠",
      cost: 0,
      reduction: [],
      attributeValues: { 地: 7 },
    },
  });
  const host2 = { ...hostDef, cardNo: "HOST2" };
  const defs: Record<string, CardDefinition> = {
    HOST2: host2,
    JIKO: jikoDef,
    EARTH: earthDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([jikoDef]);

  /** host を魂状態で field に、jiko/earth を手札に置いた初期状態（attack ステップ）。 */
  function base(): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host2, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const jiko = createCardInstance(jikoDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "jiko",
    });
    const earth = createCardInstance(earthDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "earth",
    });
    return {
      ...b,
      step: "attack",
      activePlayerId: ALICE,
      cardInstances: [host, jiko, earth],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
  }

  // phase 効果は step 遷移で明示的な end_step イベント経由で発火する（delta 検出ではない）。
  const fireEndStep = (s: GameState) => {
    const endEvent: CollectedTriggerEvent = {
      actingPlayerId: ALICE,
      eventKind: "end_step",
      source: "step_transition",
      chainId: "test:quartz-system:1245",
      attackId: null,
      relatedPlayerId: ALICE,
      relatedInstanceId: null,
      amount: null,
      step: "end",
      subPhase: "end",
    };
    return queuePendingReactionsFromTriggerEvents(
      { ...s, step: "end" },
      [endEvent],
      undefined,
      {
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      }
    );
  };

  it("セット中 + <地>合計10以上で機功効果が end step に誘発される", () => {
    let s = base();
    s = setQuartz(
      s,
      {
        quartzInstanceId: "jiko",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getD
    )!;
    s = setQuartz(
      s,
      {
        quartzInstanceId: "earth",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "right",
      },
      getD
    )!;
    expect(getQuartzAttributeSum(s, "host", "地", getD)).toBe(10);
    const res = fireEndStep(s);
    expect(res.pendingTriggeredEffects.length).toBeGreaterThan(0);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    // jiko/earth を手札に残したまま end step。魂状態でないので機功は誘発しない。
    const s = base();
    const res = fireEndStep(s);
    expect(res.pendingTriggeredEffects.length).toBe(0);
  });
});

describe("quartz-system F2.4b① set-effect: 耀脈（count_increase + timingScope attack）", () => {
  // 耀脈: セット中、アタックステップ中ターン1回、自分のカウント増加でボイド→リザーブにコア1。
  const yomyakuDef = makeDef({
    cardNo: "YOMYAKU",
    name: "耀脈カード",
    quartzData: {
      quartzName: "耀脈",
      cost: 0,
      reduction: [],
      attributeValues: { 地: 3, 水: 2 },
    },
    effects: [
      {
        timing: { kind: "game_event", player: "self", event: "count_increase" },
        applicability: { soulState: true },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
      },
    ],
  });
  const host3 = { ...hostDef, cardNo: "HOST3" };
  const defs: Record<string, CardDefinition> = {
    HOST3: host3,
    YOMYAKU: yomyakuDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([yomyakuDef]);

  /** host を魂状態で field に、耀脈をセット済みの状態（step 指定）。 */
  function setYomyaku(step: GameState["step"]): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host3, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const yom = createCardInstance(yomyakuDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "yom",
    });
    const s: GameState = {
      ...b,
      step,
      activePlayerId: ALICE,
      cardInstances: [host, yom],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    return setQuartz(
      s,
      {
        quartzInstanceId: "yom",
        hostInstanceId: "host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getD
    )!;
  }

  const fireCountUp = (s: GameState) =>
    collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:1378",
      beforeState: s,
      afterState: {
        ...s,
        players: s.players.map((p) =>
          p.id === ALICE ? { ...p, countValue: p.countValue + 1 } : p
        ),
      },
      source: "action_resolution",
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

  it("セット中 + アタックステップでカウント増加 → 耀脈が誘発される", () => {
    const res = fireCountUp(setYomyaku("attack"));
    expect(
      res.pendingTriggeredEffects.some((p) => p.eventKind === "count_increase")
    ).toBe(true);
  });

  it("メインステップ（timingScope:attack 外）では不発", () => {
    const res = fireCountUp(setYomyaku("main"));
    expect(res.pendingTriggeredEffects.length).toBe(0);
  });
});

describe("quartz-system F2.4b① set-effect: 攻撃2（continuous symbol_add from role=quartz）", () => {
  // 攻撃2: セット中、合体していない本来コスト6以上の CB 自スピリットに赤シンボル追加。
  const atk2Def = makeDef({
    cardNo: "ATK2",
    name: "攻撃2カード",
    quartzData: {
      quartzName: "攻撃2",
      cost: 0,
      reduction: [],
      attributeValues: { 火: 3 },
    },
    effects: [
      {
        timing: { kind: "continuous" },
        applicability: { soulState: true },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "filter",
                player: "self",
                filter: { tribes: ["CB"], minCost: 6, combined: false },
                count: "all",
              },
              symbol: "red",
              duration: { scope: "while_on_field" },
            },
          },
        ],
      },
    ],
  });
  const cbBig = makeDef({
    cardNo: "CBBIG",
    name: "CB大",
    tribe: "CB",
    cost: 6,
    symbolColors: [],
  });
  const cbSmall = makeDef({
    cardNo: "CBSMALL",
    name: "CB小",
    tribe: "CB",
    cost: 3,
    symbolColors: [],
  });
  const host4 = { ...hostDef, cardNo: "HOST4" };
  const defs: Record<string, CardDefinition> = {
    HOST4: host4,
    ATK2: atk2Def,
    CBBIG: cbBig,
    CBSMALL: cbSmall,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];

  function setupAtk2(setIt: boolean): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host4, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const big = createCardInstance(cbBig, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "big",
      cores: 1,
    });
    const small = createCardInstance(cbSmall, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "small",
      cores: 1,
    });
    const atk2 = createCardInstance(atk2Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "atk2",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, big, small, atk2],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (setIt) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "atk2",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return rebuildContinuousEffectsFromField(s, getD, {
      unsafeAllowDuringBattle: true,
    });
  }

  it("セット中: CB 本来コスト6スピリットに赤シンボルが追加される（continuous-on-quartz 実証）", () => {
    const s = setupAtk2(true);
    const big = s.cardInstances.find((c) => c.instanceId === "big")!;
    expect(getEffectiveSymbols(s, big, cbBig, getD)).toContain("red");
  });

  it("条件外（コスト3）の CB スピリットには追加されない", () => {
    const s = setupAtk2(true);
    const small = s.cardInstances.find((c) => c.instanceId === "small")!;
    expect(getEffectiveSymbols(s, small, cbSmall, getD)).not.toContain("red");
  });

  it("未セット（魂状態でない）なら追加されない（applicability.soulState）", () => {
    const s = setupAtk2(false);
    const big = s.cardInstances.find((c) => c.instanceId === "big")!;
    expect(getEffectiveSymbols(s, big, cbBig, getD)).not.toContain("red");
  });
});

describe("quartz-system ENGINE-quartz-host-identity-propagation continuous 系統: host 継承発揮の source identity", () => {
  // 「【クォーツ：...】」ヘッダー系 continuous 効果 (isQuartzSetHeaderLine) は host が
  // 「セット中のカードの【クォーツ】すべてを得て、発揮する」ため、CE の sourceInstanceId は
  // host 自身になる (quartzInheritedContinuousEffectEntries、クォーツカード自身のネイティブ CE
  // としては二重登録されない、cluster135 継承の activated/continuous スコープ)。
  const hostIdDef = { ...hostDef, cardNo: "HOST-ID" };
  const quartzIdDef = makeDef({
    cardNo: "QID",
    name: "identity珠",
    quartzData: {
      quartzName: "identity",
      cost: 0,
      reduction: [],
      attributeValues: { 地: 1 },
    },
    textLines: [
      "【クォーツ：identity】",
      "自分のスピリットの BP を+1000する。",
    ],
    effects: [
      {
        timing: { kind: "continuous" },
        applicability: { soulState: true },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: "all",
              },
              amount: 1000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  });
  const defs: Record<string, CardDefinition> = {
    "HOST-ID": hostIdDef,
    QID: quartzIdDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];

  function setupRaw(setIt: boolean): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(hostIdDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host-id",
    });
    const q = createCardInstance(quartzIdDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "qid",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, q],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host-id"] } : p
      ),
    };
    if (setIt) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "qid",
          hostInstanceId: "host-id",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function setup(setIt: boolean): GameState {
    return rebuildContinuousEffectsFromField(setupRaw(setIt), getD, {
      unsafeAllowDuringBattle: true,
    });
  }

  it("セット中: bp_modifier CE の sourceInstanceId は host、effectSourceInstanceId は quartz card 自身（二重登録なし）", () => {
    const s = setup(true);
    const ces = s.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.sourceInstanceId).toBe("host-id");
    expect(ces[0]?.provenance).toMatchObject({
      effectSourceInstanceId: "qid",
      effectSourceDefinitionId: "QID",
    });
  });

  it("host 離脱でクォーツがセット解除されると CE も消える", () => {
    const s = setup(true);
    const released = releaseQuartzOnHostLeave(s, "host-id", "trash");
    const recomputed = recomputeAndRebuildContinuousEffects(released, getD);
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "bp_modifier"
      )
    ).toHaveLength(0);
  });

  it("pending leave 中のクォーツ provider から新規 host 継承 CE を登録しない", () => {
    const setState = setupRaw(true);
    const pendingProvider: GameState = {
      ...setState,
      cardInstances: setState.cardInstances.map((card) =>
        card.instanceId === "qid"
          ? { ...card, pendingLeaveKind: "destroy" }
          : card
      ),
    };

    const rebuilt = recomputeAndRebuildContinuousEffects(pendingProvider, getD);
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.sourceInstanceId === "host-id" &&
          ce.provenance?.effectSourceInstanceId === "qid"
      )
    ).toHaveLength(0);

    const alreadyRegistered = setup(true);
    const pendingWithExistingCe: GameState = {
      ...alreadyRegistered,
      cardInstances: alreadyRegistered.cardInstances.map((card) =>
        card.instanceId === "qid"
          ? { ...card, pendingLeaveKind: "destroy" }
          : card
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      pendingWithExistingCe,
      getD
    );
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.sourceInstanceId === "host-id" &&
          ce.provenance?.effectSourceInstanceId === "qid"
      )
    ).toHaveLength(1);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: recomputed,
      issues,
      getCardDefinitionById: getD,
    });
    expect(
      issues.filter((issue) => issue.code === "stale_continuous_effect")
    ).toEqual([]);
  });

  it("未セット（魂状態でない）なら CE 未登録", () => {
    const s = setup(false);
    expect(
      s.activeContinuousEffects.filter((ce) => ce.modifierTag === "bp_modifier")
    ).toHaveLength(0);
  });
});

describe("quartz-system F2.4b① set-effect: 脱兎（activated flash from role=quartz）", () => {
  // 脱兎: セット中、ターン1回フラッシュで自スピリット1体をデッキ下へ。
  const dattoDef = makeDef({
    cardNo: "DATTO",
    name: "脱兎カード",
    printedCategory: "spirit",
    quartzData: {
      quartzName: "脱兎",
      cost: 0,
      reduction: [],
      attributeValues: { 風: 3 },
    },
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { soulState: true },
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
      },
    ],
  });
  const host5 = { ...hostDef, cardNo: "HOST5" };
  const defs: Record<string, CardDefinition> = {
    HOST5: host5,
    DATTO: dattoDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const fieldLookup = buildFieldCardEffectLookup([dattoDef]);

  function setupDatto(setIt: boolean): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host5, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const datto = createCardInstance(dattoDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "datto",
    });
    let s: GameState = {
      ...b,
      step: "attack",
      activePlayerId: ALICE,
      cardInstances: [host, datto],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (setIt) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "datto",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  const listFlash = (s: GameState) =>
    getAvailableFieldCardEffectLegalActions(
      {
        state: s,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredFieldCardEffectActions: fieldLookup,
      } as GetLegalActionsOptions,
      "flash"
    );

  it("セット中: 脱兎のフラッシュ効果が use_field_card_effect として列挙される（activated-on-quartz 実証）", () => {
    const actions = listFlash(setupDatto(true));
    expect(actions.some((a) => a.sourceInstanceId === "datto")).toBe(true);
  });

  it("未セット（手札のまま=field 外）なら列挙されない", () => {
    const actions = listFlash(setupDatto(false));
    expect(actions.some((a) => a.sourceInstanceId === "datto")).toBe(false);
  });
});

describe("quartz-system ENGINE-quartz-host-identity-propagation activated 系統: host 継承発揮の source identity (BSLH01-R01/M03/TR03(A)/X04)", () => {
  // 「【クォーツ：...】」ヘッダー系 activated 効果 (isQuartzSetHeaderLine) は host が
  // 「セット中のカードの【クォーツ】すべてを得て、発揮する」ため use_field_card_effect の
  // sourceInstanceId は host 自身になる (quartz_inherited source entry、cluster135 継承の
  // activated スコープ、continuous 版 quartzInheritedContinuousEffectEntries と対)。
  function realCard(cardNo: string): CardDefinition {
    const def = ALL_CARDS.find((c) => c.cardNo === cardNo);
    if (!def) throw new Error(`card not found: ${cardNo}`);
    return def;
  }
  const hostD = realCard("BSLH01-CX01");
  const getD = (id: string): CardDefinition | undefined =>
    ALL_CARDS.find((c) => c.cardNo === id);

  function seatOnHost(
    quartzDef: CardDefinition,
    timing: "normal" | "flash" | "stack"
  ) {
    const host = createCardInstance(hostD, {
      instanceId: "host-activated",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const quartz = createCardInstance(quartzDef, {
      instanceId: "quartz-activated",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    let s: GameState = {
      ...b,
      cardInstances: [host, quartz],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host-activated"] } : p
      ),
    };
    s = setQuartz(
      s,
      {
        quartzInstanceId: quartz.instanceId,
        hostInstanceId: host.instanceId,
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getD
    )!;
    const lookup = buildFieldCardEffectLookup([quartzDef, hostD]);
    const actions = getAvailableFieldCardEffectLegalActions(
      {
        state: s,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredFieldCardEffectActions: lookup,
      } as GetLegalActionsOptions,
      timing
    );
    return {
      hostInstanceId: host.instanceId,
      quartzInstanceId: quartz.instanceId,
      actions,
    };
  }

  it.each([
    ["BSLH01-R01", "駆動", "stack"],
    ["BSLH01-M03", "双児珠", "stack"],
    ["BSLH01-TR03(A)", "情報", "normal"],
    ["BSLH01-X04", "脱兎", "flash"],
  ] as const)(
    "%s（%s）: セット中は host が source として use_field_card_effect を列挙し、クォーツ自身のネイティブ登録としては二重登録されない",
    (cardNo, _name, timing) => {
      const def = realCard(cardNo);
      const { hostInstanceId, quartzInstanceId, actions } = seatOnHost(
        def,
        timing
      );
      const matched = actions.filter(
        (a) => a.sourceEffectInstanceId === quartzInstanceId
      );
      expect(matched).toHaveLength(1);
      expect(matched[0]!.sourceInstanceId).toBe(hostInstanceId);
      expect(actions.some((a) => a.sourceInstanceId === quartzInstanceId)).toBe(
        false
      );
    }
  );

  it.each([
    ["BSLH01-R01", "駆動", "stack"],
    ["BSLH01-M03", "双児珠", "stack"],
    ["BSLH01-TR03(A)", "情報", "normal"],
    ["BSLH01-X04", "脱兎", "flash"],
  ] as const)(
    "%s（%s）: host 経由の use_field_card_effect を applyLegalAction で宣言しても " +
      "category 両立性チェックで throw しない (declare 側は quartz card 自身の printedCategory " +
      "で判定、host の printedCategory=brave 越しでも通る。TR03(A)=nexus は brave 非互換で" +
      "列挙のみ直した回帰が declare 時に再現する退行検知)",
    (cardNo, _name, timing) => {
      const def = realCard(cardNo);
      const { hostInstanceId, quartzInstanceId, actions } = seatOnHost(
        def,
        timing
      );
      const declareAction = actions.find(
        (a) => a.sourceEffectInstanceId === quartzInstanceId
      );
      expect(declareAction).toBeDefined();

      const host = createCardInstance(hostD, {
        instanceId: hostInstanceId,
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const quartz = createCardInstance(def, {
        instanceId: quartzInstanceId,
        ownerPlayerId: ALICE,
        zone: "hand",
      });
      const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
      let s: GameState = {
        ...b,
        cardInstances: [host, quartz],
        players: b.players.map((p) =>
          p.id === ALICE ? { ...p, soulStateInstanceIds: [hostInstanceId] } : p
        ),
      };
      s = setQuartz(
        s,
        {
          quartzInstanceId,
          hostInstanceId,
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
      const lookup = buildFieldCardEffectLookup([def, hostD]);

      expect(() =>
        applyLegalAction({
          state: s,
          action: declareAction!,
          getCardDefinitionById: getD,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredFieldCardEffectActions: lookup,
        })
      ).not.toThrow();

      const declared = applyLegalAction({
        state: s,
        action: declareAction!,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: lookup,
      }).state;
      expect(
        declared.log.some(
          (line) =>
            line.startsWith(`effect:declare:`) && line.includes(hostInstanceId)
        )
      ).toBe(true);
    }
  );
});

describe("quartz-system F2.4b① set-effect: BSLH01-X03 行動力（game_event exhaust + trigger_related_instance recover）", () => {
  // 行動力: セット中、ターンに1回、自分のスピリットが疲労したとき、その対象1体を回復できる。
  // 第三者 game_event:exhaust 観測 (BSTH03-転醒R01(A) 同型 triggerFilter) +
  // target:trigger_related_instance で主語 Y (疲労した自スピリット) 自身を回復する
  // (BSTH05-X02 と同系統パターン)。
  const x03Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-X03");
  if (!x03Def) throw new Error("BSLH01-X03 not found in ALL_CARDS");
  const allyDef = makeDef({
    cardNo: "ALLY-SPIRIT",
    name: "疲労対象テスト",
    printedCategory: "spirit",
  });
  const host6 = { ...hostDef, cardNo: "HOST6" };
  const defs: Record<string, CardDefinition> = {
    HOST6: host6,
    "BSLH01-X03": x03Def,
    "ALLY-SPIRIT": allyDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([x03Def]);

  /** host を field に、行動力(x03) を手札に、疲労済み自スピリット(ally-1) を field に置いた初期状態。 */
  function base(soulSet: boolean): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host6, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const x03 = createCardInstance(x03Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "x03",
    });
    const ally = createCardInstance(allyDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "ally-1",
      exhaustState: "exhausted",
    });
    let s: GameState = {
      ...b,
      step: "attack",
      activePlayerId: ALICE,
      cardInstances: [host, x03, ally],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "x03",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  const fireExhaust = (s: GameState) => {
    const exhaustEvent: CollectedTriggerEvent = {
      actingPlayerId: ALICE,
      eventKind: "exhaust",
      source: "action_resolution",
      chainId: "test:quartz-system:2034",
      attackId: null,
      relatedPlayerId: ALICE,
      relatedInstanceId: "ally-1",
      amount: null,
    };
    return queuePendingReactionsFromTriggerEvents(
      s,
      [exhaustEvent],
      undefined,
      {
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      }
    );
  };

  it("セット中 + 自分のスピリット疲労で行動力の回復トリガーが誘発される", () => {
    const res = fireExhaust(base(true));
    expect(res.pendingTriggeredEffects.length).toBeGreaterThan(0);
  });

  it("未セット（手札のまま）なら applicability.soulState で不発", () => {
    const res = fireExhaust(base(false));
    expect(res.pendingTriggeredEffects.length).toBe(0);
  });

  it("解決すると主語 Y (疲労した対象) 自身が回復する (trigger_related_instance)", () => {
    const setEffect = x03Def.effects?.[3];
    if (!setEffect) throw new Error("BSLH01-X03 effects[3] missing");
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("recover");
    expect(
      (setEffect.steps[0]!.action as { target: { kind: string } }).target.kind
    ).toBe("trigger_related_instance");

    const state = base(true);
    const result = executeEffect({
      chainId: "test:quartz-system:2076",
      state,
      effect: setEffect,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "ally-1",
    });
    const ally = result.cardInstances.find((c) => c.instanceId === "ally-1");
    expect(ally?.exhaustState).toBe("recovered");
  });
});

describe("quartz-system engine-exhaust-provenance-skip-refresh: BSLH01-C04 処女珠（game_event exhaust + triggerSourceFilter tribes OR + prevent_next_recovery）", () => {
  // 処女珠: セット中、系統「CB」/「導力器」を持つ自分の効果で疲労した相手のスピリット/
  // アルティメット/ネクサス/創界神ネクサスは、次の相手のリフレッシュステップでは
  // 回復できない。BSLH01-C08 天秤珠と同じ第三者 player:"opponent" + triggerSourceFilter +
  // cause:["opponent_effect"] + sourceWhose:"either" パターンだが、発生源は
  // exhaust event (leave_field ではなく)、triggerSourceFilter は tribes OR (CB/導力器)。
  const c04Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-C04");
  if (!c04Def) throw new Error("BSLH01-C04 not found in ALL_CARDS");
  const setEffectIndex = 2;
  const host4 = { ...hostDef, cardNo: "HOST4" };
  const cbSourceDef = makeDef({
    cardNo: "CB-SRC",
    name: "CB系統発生源テスト",
    printedCategory: "spirit",
    tribe: "CB",
  });
  const dorikikiSourceDef = makeDef({
    cardNo: "DORIKIKI-SRC",
    name: "導力器系統発生源テスト",
    printedCategory: "spirit",
    tribe: "導力器",
  });
  const unrelatedSourceDef = makeDef({
    cardNo: "UNRELATED-SRC",
    name: "無関係系統発生源テスト",
    printedCategory: "spirit",
    tribe: "星竜",
  });
  const oppTargetDef = makeDef({
    cardNo: "C04-OPP-TARGET",
    name: "疲労対象テスト",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    HOST4: host4,
    "BSLH01-C04": c04Def,
    "CB-SRC": cbSourceDef,
    "DORIKIKI-SRC": dorikikiSourceDef,
    "UNRELATED-SRC": unrelatedSourceDef,
    "C04-OPP-TARGET": oppTargetDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([c04Def]);

  function base(options: {
    soulSet: boolean;
    sourceDef: CardDefinition;
    sourceOwnerPlayerId?: string;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host4, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const c04 = createCardInstance(c04Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "c04",
    });
    const sourceOwnerPlayerId = options.sourceOwnerPlayerId ?? ALICE;
    const source = createCardInstance(options.sourceDef, {
      ownerPlayerId: sourceOwnerPlayerId,
      controllerPlayerId: sourceOwnerPlayerId,
      zone: "field",
      instanceId: "exhaust-source",
    });
    const target = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-target",
      exhaustState: "recovered",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, c04, source, target],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "c04",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireOpponentExhaustViaSource(
    state: GameState,
    causePlayerId: string
  ): GameState {
    const afterExhaust: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "opp-target"
          ? { ...c, exhaustState: "exhausted" as const }
          : c
      ),
    };
    return collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:2197",
      beforeState: state,
      afterState: afterExhaust,
      source: "action_resolution",
      causedByPlayerId: causePlayerId,
      causedBySourceInstanceId: "exhaust-source",
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("セット中 + CB系統の自分の効果で相手が疲労すると誘発する", () => {
    const state = base({ soulSet: true, sourceDef: cbSourceDef });
    const after = fireOpponentExhaustViaSource(state, ALICE);
    expect(
      after.pendingTriggeredEffects.some(
        (p) => p.eventKind === "exhaust" && p.relatedInstanceId === "opp-target"
      )
    ).toBe(true);
  });

  it("導力器系統の自分の効果でも誘発する (tribes OR)", () => {
    const state = base({ soulSet: true, sourceDef: dorikikiSourceDef });
    const after = fireOpponentExhaustViaSource(state, ALICE);
    expect(
      after.pendingTriggeredEffects.some(
        (p) => p.eventKind === "exhaust" && p.relatedInstanceId === "opp-target"
      )
    ).toBe(true);
  });

  it("未セット（手札のまま）なら applicability.soulState で不発", () => {
    const state = base({ soulSet: false, sourceDef: cbSourceDef });
    const after = fireOpponentExhaustViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("無関係な系統の発生源なら triggerSourceFilter で除外され不発", () => {
    const state = base({ soulSet: true, sourceDef: unrelatedSourceDef });
    const after = fireOpponentExhaustViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("相手自身のCB系統カードで相手が自壊(自分のカードを疲労)させたとき cause:opponent_effect で除外され不発", () => {
    const state = base({
      soulSet: true,
      sourceDef: cbSourceDef,
      sourceOwnerPlayerId: BOB,
    });
    const after = fireOpponentExhaustViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("解決すると疲労した対象 (trigger_related_instance) に skipNextRefreshRecovery が付与され、次のリフレッシュで回復しない", () => {
    const setEffect = c04Def.effects?.[setEffectIndex];
    if (!setEffect)
      throw new Error("BSLH01-C04 set-effect (effects[2]) missing");
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("prevent_next_recovery");
    expect(
      (setEffect.steps[0]!.action as { target: { kind: string } }).target.kind
    ).toBe("trigger_related_instance");

    let state = base({ soulSet: true, sourceDef: cbSourceDef });
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "opp-target"
          ? { ...c, exhaustState: "exhausted" as const }
          : c
      ),
    };
    const result = executeEffect({
      chainId: "test:quartz-system:2270",
      state,
      effect: setEffect,
      sourceInstanceId: "c04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "opp-target",
    });
    const marked = result.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(marked?.exhaustState).toBe("exhausted");
    expect(marked?.skipNextRefreshRecovery).toBe(true);

    // 対象コントローラ (BOB) の次のリフレッシュステップでは回復せず、1回消費してマーカーが外れる。
    const afterFirstRefresh = refreshExhaustStates(result, BOB);
    const afterFirst = afterFirstRefresh.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(afterFirst?.exhaustState).toBe("exhausted");
    expect(afterFirst?.skipNextRefreshRecovery).toBe(false);

    // マーカー消費後、2回目のリフレッシュでは通常どおり回復する。
    const afterSecondRefresh = refreshExhaustStates(afterFirstRefresh, BOB);
    const afterSecond = afterSecondRefresh.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(afterSecond?.exhaustState).toBe("recovered");
  });

  it("次回リフレッシュ禁止は重疲労の一段階回復も止めて消費される", () => {
    let state = base({ soulSet: true, sourceDef: cbSourceDef });
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "opp-target"
          ? { ...c, exhaustState: "heavily_exhausted" as const }
          : c
      ),
    };
    const setEffect = c04Def.effects![setEffectIndex]!;
    const result = executeEffect({
      chainId: "test:quartz-system:2311",
      state,
      effect: setEffect,
      sourceInstanceId: "c04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "opp-target",
    });
    const marked = result.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(marked?.exhaustState).toBe("heavily_exhausted");
    expect(marked?.skipNextRefreshRecovery).toBe(true);

    // 1回目のリフレッシュ: 重疲労→疲労を禁止してマーカーを消費する。
    const afterFirstRefresh = refreshExhaustStates(result, BOB);
    const afterFirst = afterFirstRefresh.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(afterFirst?.exhaustState).toBe("heavily_exhausted");
    expect(afterFirst?.skipNextRefreshRecovery).toBe(false);

    // 2回目のリフレッシュ: 禁止は消費済みなので重疲労→疲労に回復する。
    const afterSecondRefresh = refreshExhaustStates(afterFirstRefresh, BOB);
    const afterSecond = afterSecondRefresh.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(afterSecond?.exhaustState).toBe("exhausted");
    expect(afterSecond?.skipNextRefreshRecovery).toBe(false);

    // 3回目のリフレッシュ: マーカー消費済みなので通常通り回復する。
    const afterThirdRefresh = refreshExhaustStates(afterSecondRefresh, BOB);
    const afterThird = afterThirdRefresh.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    );
    expect(afterThird?.exhaustState).toBe("recovered");
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-C08 天秤珠（game_event leave_field + triggerSourceFilter + applicability.soulState）", () => {
  // 天秤珠: セット中、自分のマジックの効果で相手のカードがフィールドを離れるとき、
  // ボイドからコア1個を自分のリザーブに置ける。BSDB01-CX01 effects[1] 同型
  // (ENGINE-leave-field-third-party-opponent-source-whose): player:"opponent"
  // (離脱カード=相手所有) + triggerSourceFilter(category:magic) +
  // cause:["opponent_effect"](離脱カード=相手のコントローラ視点で「相手以外由来」=
  // 自分由来と同値) + sourceWhose:"either"。
  const c08Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-C08");
  if (!c08Def) throw new Error("BSLH01-C08 not found in ALL_CARDS");
  const setEffectIndex = c08Def.effects!.findIndex(
    (effect) =>
      effect.applicability?.soulState === true &&
      effect.timing.kind === "game_event" &&
      effect.timing.event === "leave_field"
  );
  if (setEffectIndex < 0) {
    throw new Error("BSLH01-C08 quartz set-effect not found");
  }
  const host8 = { ...hostDef, cardNo: "HOST8" };
  const magicSourceDef = makeDef({
    cardNo: "MAGIC-SRC",
    name: "マジック発生源テスト",
    printedCategory: "magic",
  });
  const spiritSourceDef = makeDef({
    cardNo: "SPIRIT-SRC",
    name: "スピリット発生源テスト",
    printedCategory: "spirit",
  });
  const oppTargetDef = makeDef({
    cardNo: "OPP-TARGET",
    name: "離脱対象テスト",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    HOST8: host8,
    "BSLH01-C08": c08Def,
    "MAGIC-SRC": magicSourceDef,
    "SPIRIT-SRC": spiritSourceDef,
    "OPP-TARGET": oppTargetDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([c08Def]);

  function base(options: {
    soulSet: boolean;
    sourceDef: CardDefinition;
    sourceOwnerPlayerId?: string;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host8, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const c08 = createCardInstance(c08Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "c08",
    });
    const sourceOwnerPlayerId = options.sourceOwnerPlayerId ?? ALICE;
    const source = createCardInstance(options.sourceDef, {
      ownerPlayerId: sourceOwnerPlayerId,
      controllerPlayerId: sourceOwnerPlayerId,
      zone: "field",
      instanceId: "leave-source",
    });
    const target = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-target",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, c08, source, target],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "c08",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireOpponentLeaveViaSource(
    state: GameState,
    causePlayerId: string
  ): GameState {
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "opp-target",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:c08-leave",
      causePlayerId,
      causedByEffectSourceInstanceId: "leave-source",
    });
    return collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:2458",
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: causePlayerId,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("セット中 + 自分のマジックの効果で相手のカードが離れると誘発する", () => {
    const state = base({ soulSet: true, sourceDef: magicSourceDef });
    const after = fireOpponentLeaveViaSource(state, ALICE);
    expect(
      after.pendingTriggeredEffects.some(
        (p) => p.eventKind === "destroy" && p.relatedInstanceId === "opp-target"
      )
    ).toBe(true);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    const state = base({ soulSet: false, sourceDef: magicSourceDef });
    const after = fireOpponentLeaveViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("発生源がマジックでない（スピリット）なら triggerSourceFilter で除外され不発", () => {
    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const after = fireOpponentLeaveViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("相手自身のマジックで相手が自分のカードを自壊させたとき cause:opponent_effect で除外され不発", () => {
    // leave-source (マジック) の所有者も BOB にする (BSDB01-CX01 の同型テストに倣う)。
    // triggerSourceFilter は発生源カードの内在属性 (category 等) しか見ずコントローラは
    // 判定しないため、「自分の」を保証するのは cause:["opponent_effect"] のみ。
    // 相手所有のマジックで相手が自壊させた場合でも cause:"self_effect" になり除外される
    // ことを、発生源カードの所有者を BOB に変えた状態で直接検証する。
    const state = base({
      soulSet: true,
      sourceDef: magicSourceDef,
      sourceOwnerPlayerId: BOB,
    });
    const after = fireOpponentLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("解決するとボイドのコア1個が自分のリザーブへ移動する", () => {
    const setEffect = c08Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("core_move");

    const state = base({ soulSet: true, sourceDef: magicSourceDef });
    const before = state.players.find((p) => p.id === ALICE)!;
    const result = executeEffect({
      chainId: "test:quartz-system:2513",
      state,
      effect: setEffect,
      sourceInstanceId: "c08",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
    });
    const after = result.players.find((p) => p.id === ALICE)!;
    expect(after.voidNormalCoreCount).toBe(before.voidNormalCoreCount - 1);
    expect(after.reserveNormalCoreCount).toBe(
      before.reserveNormalCoreCount + 1
    );
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-M04 龍眼（game_event leave_field 第三者 + triggerSourceFilter:spirit + deck_reveal(peek+reorder) + applicability.soulState）", () => {
  // 龍眼: セット中、自分のスピリットの効果で相手のスピリット/アルティメットがフィールドを
  // 離れたとき、相手のデッキ上1枚の内容を見て、好きなように上か下に戻す。BSLH01-C08 天秤珠と
  // 同型の第三者離脱観測 (player:"opponent"(離脱カード=相手所有) + triggerSourceFilter
  // (category:spirit) + cause:["opponent_effect"] + sourceWhose:"either"
  // + condition:trigger_source_player self)。「デッキ1枚を見て
  // 上か下に戻す」は deck_reveal(picks:[], remainder:"top_bottom_split") で表現
  // (BSTS01-C?? / BSTH05.5 系 picks:[] precedent)。「対象1体につき」は
  // 同時離脱は同一効果解決につき1回だけ誘発し、trigger_related_instances_count が
  // 対象数を保持する（2体なら revealCount=2）。誘発単位と「ターンに1回」は独立。
  // 根拠: 10_rules/03e「同時発生イベントの誘発単位」。
  const m04Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-M04");
  if (!m04Def) throw new Error("BSLH01-M04 not found in ALL_CARDS");
  const setEffectIndex = 2;
  const host04 = { ...hostDef, cardNo: "HOST04" };
  const spiritSourceDef = makeDef({
    cardNo: "M04-SPIRIT-SRC",
    name: "スピリット発生源テスト",
    printedCategory: "spirit",
  });
  const magicSourceDef = makeDef({
    cardNo: "M04-MAGIC-SRC",
    name: "マジック発生源テスト",
    printedCategory: "magic",
  });
  const oppTargetDef = makeDef({
    cardNo: "M04-OPP-TARGET",
    name: "離脱対象テスト",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    HOST04: host04,
    "BSLH01-M04": m04Def,
    "M04-SPIRIT-SRC": spiritSourceDef,
    "M04-MAGIC-SRC": magicSourceDef,
    "M04-OPP-TARGET": oppTargetDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([m04Def]);

  function base(options: {
    soulSet: boolean;
    sourceDef: CardDefinition;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host04, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host04",
    });
    const m04 = createCardInstance(m04Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "m04",
    });
    const source = createCardInstance(options.sourceDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "m04-leave-source",
    });
    const target = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "m04-opp-target",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, m04, source, target],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host04"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "m04",
          hostInstanceId: "host04",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireOpponentLeaveViaSource(state: GameState): GameState {
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "m04-opp-target",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:m04-leave",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "m04-leave-source",
    });
    return collectAfterPhysicalLeave({
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("セット中 + 自分のスピリットの効果で相手のカードが離れると誘発する", () => {
    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const after = fireOpponentLeaveViaSource(state);
    expect(
      after.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "leave_field" &&
          p.relatedInstanceId === "m04-opp-target"
      )
    ).toBe(true);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    const state = base({ soulSet: false, sourceDef: spiritSourceDef });
    const after = fireOpponentLeaveViaSource(state);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("発生源がスピリットでない（マジック）なら triggerSourceFilter で除外され不発", () => {
    const state = base({ soulSet: true, sourceDef: magicSourceDef });
    const after = fireOpponentLeaveViaSource(state);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("相手自身のスピリット効果で相手カードが離れても trigger_source_player で除外され不発", () => {
    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const opponentSource = createCardInstance(spiritSourceDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "m04-opponent-leave-source",
    });
    const withOpponentSource: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, opponentSource],
    };
    const afterLeave = queuePendingLeave({
      state: withOpponentSource,
      instanceId: "m04-opp-target",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:m04-opponent-source",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "m04-opponent-leave-source",
    });
    const after = collectAfterPhysicalLeave({
      beforeState: withOpponentSource,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("原文「見る。」「戻す。」は終止形(可能形ではない)のため発揮は強制 (executionMode 省略)", () => {
    const setEffect = m04Def.effects![setEffectIndex]!;
    expect(setEffect.executionMode).toBeUndefined();
  });

  it("解決すると相手のデッキ上1枚をオープンし、上か下に戻す選択が発生する", () => {
    const setEffect = m04Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    expect(setEffect.timing).toMatchObject({ sourceWhose: "either" });
    expect(setEffect.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
    ]);
    expect(setEffect.steps[0]!.action).toEqual({
      kind: "deck_reveal",
      player: "opponent",
      revealCount: { source: { kind: "trigger_related_instances_count" } },
      revealTo: "self",
      picks: [],
      remainder: "top_bottom_split",
    });

    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const bobDeckCard = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
      instanceId: "m04-bob-deck-top",
    });
    const withDeck: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, bobDeckCard],
    };
    const result = executeEffect({
      chainId: "test:quartz-system:2732",
      state: withDeck,
      effect: setEffect,
      sourceInstanceId: "m04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: () => [],
      // 実運用では pending triggered effect 解決時に relatedInstanceId (離脱した対象)
      // と triggerSourcePlayerId (その対象を離した効果の発生源プレイヤー) が伝搬される
      // (legal-actions-apply.ts)。直接 executeEffect を呼ぶこのテストでも同じ文脈を
      // 明示的に渡す。
      triggerRelatedInstanceId: "m04-opp-target",
      triggerSourcePlayerId: ALICE,
    });
    expect(result.pendingDeckReveal).toMatchObject({
      origin: "deck",
      targetPlayerId: BOB,
      revealTo: "self",
      remainder: "top_bottom_split",
      revealedCardInstanceIds: ["m04-bob-deck-top"],
    });
    const orderAction = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    const resolved = applyLegalAction({
      state: result,
      action: orderAction!,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: () => [],
      deckRevealRemainderOrder: ["m04-bob-deck-top"],
      deckRevealRemainderPlacements: { "m04-bob-deck-top": "bottom" },
    }).state;
    expect(resolved.pendingDeckReveal).toBeNull();
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "m04-bob-deck-top")
        ?.zone
    ).toBe("deck");
  });

  it("練刃の枚数+1は revealTo:self の「見る」型 deck_reveal には適用されない", () => {
    const source = createCardInstance(spiritSourceDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "x09-peek-source",
    });
    const bobDeckCard = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
      instanceId: "m04-bob-deck-top",
    });
    const boost: ContinuousEffect = {
      effectId: "x09-boost",
      sourceInstanceId: "x09",
      sourceDefinitionId: "BSLH01-X09",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "grant_optional_deck_reveal_count_boost",
      targetInstanceId: ALICE,
      metadata: {
        bonusAmount: 1,
        sourceFilter: { category: ["spirit"] },
      },
    };
    const peekEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            player: "opponent",
            revealCount: 1,
            revealTo: "self",
            picks: [],
            remainder: "top_bottom_split",
          },
        },
      ],
    };
    const empty = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const result = executeEffect({
      chainId: "test:quartz-system:2818",
      state: {
        ...empty,
        activeContinuousEffects: [boost],
        cardInstances: [source, bobDeckCard],
      },
      effect: peekEffect,
      sourceInstanceId: "x09-peek-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.pendingDeckRevealCountBoostChoice).toBeNull();
    expect(result.pendingDeckReveal?.revealTo).toBe("self");
    expect(result.pendingDeckReveal?.revealedCardInstanceIds).toEqual([
      "m04-bob-deck-top",
    ]);
  });

  it("練刃の枚数+1は公開 deck_reveal には従来どおり適用選択を出す", () => {
    const source = createCardInstance(spiritSourceDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "x09-open-source",
    });
    const bobDeckCard = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
      instanceId: "x09-bob-deck-top",
    });
    const boost: ContinuousEffect = {
      effectId: "x09-boost-open",
      sourceInstanceId: "x09",
      sourceDefinitionId: "BSLH01-X09",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "grant_optional_deck_reveal_count_boost",
      targetInstanceId: ALICE,
      metadata: {
        bonusAmount: 1,
        sourceFilter: { category: ["spirit"] },
      },
    };
    const openEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            player: "opponent",
            revealCount: 1,
            picks: [],
            remainder: "bottom",
          },
        },
      ],
    };
    const empty = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const result = executeEffect({
      chainId: "test:quartz-system:2881",
      state: {
        ...empty,
        activeContinuousEffects: [boost],
        cardInstances: [source, bobDeckCard],
      },
      effect: openEffect,
      sourceInstanceId: "x09-open-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.pendingDeckReveal).toBeNull();
    expect(result.pendingDeckRevealCountBoostChoice).toMatchObject({
      sourceInstanceId: "x09-open-source",
      bonusAmount: 1,
    });
  });

  it("自分のスピリットの単一効果による2体同時離場は、関連対象2体を保持して1回だけ誘発する", () => {
    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const target2 = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "m04-opp-target-2",
    });
    const withSecondTarget: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, target2],
    };
    const afterBothLeave = queuePendingLeave({
      state: queuePendingLeave({
        state: withSecondTarget,
        instanceId: "m04-opp-target",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "test-chain:m04-simultaneous",
        causePlayerId: ALICE,
        causedByEffectSourceInstanceId: "m04-leave-source",
      }),
      instanceId: "m04-opp-target-2",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:m04-simultaneous",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "m04-leave-source",
    });
    const after = collectAfterPhysicalLeave({
      beforeState: withSecondTarget,
      afterState: afterBothLeave,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    // 同じ解決境界の第三者効果は1回だけ誘発する。
    const m04Pendings = after.pendingTriggeredEffects.filter(
      (p) =>
        p.eventKind === "leave_field" &&
        (p.relatedInstanceId === "m04-opp-target" ||
          p.relatedInstanceId === "m04-opp-target-2")
    );
    expect(m04Pendings).toHaveLength(1);
    expect(m04Pendings[0]!.relatedInstanceIds?.sort()).toEqual([
      "m04-opp-target",
      "m04-opp-target-2",
    ]);

    // 合体先へ継承された m04 の効果を選択できる。
    for (const pending of m04Pendings) {
      const choice = getAvailableTriggeredEffectSourceChoices({
        state: after,
        pendingEffect: pending,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
      });
      // ENGINE-quartz-host-identity-propagation: quartz_inherited 経由の発見では
      // sourceCard は host (host04) に、実効果ソースは sourceEffectInstanceId (m04) に載る。
      expect(
        choice.some(
          (c) => (c.sourceEffectInstanceId ?? c.sourceCard.instanceId) === "m04"
        )
      ).toBe(true);
    }
  });

  it("同時離脱2体は1回の発揮で対象数(2)のデッキを確認し、2件目の誘発は作らない", () => {
    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const target2 = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "m04-opp-target-2",
    });
    const bobDeckTop = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
      instanceId: "m04-bob-deck-top",
    });
    const bobDeckSecond = createCardInstance(oppTargetDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
      instanceId: "m04-bob-deck-second",
    });
    const withSecondTargetAndDeck: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        target2,
        bobDeckTop,
        bobDeckSecond,
      ],
    };
    const afterBothLeave = queuePendingLeave({
      state: queuePendingLeave({
        state: withSecondTargetAndDeck,
        instanceId: "m04-opp-target",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "test-chain:m04-simultaneous-scale",
        causePlayerId: ALICE,
        causedByEffectSourceInstanceId: "m04-leave-source",
      }),
      instanceId: "m04-opp-target-2",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:m04-simultaneous-scale",
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "m04-leave-source",
    });
    const after = collectAfterPhysicalLeave({
      beforeState: withSecondTargetAndDeck,
      afterState: afterBothLeave,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    // 離脱イベントの汎用バースト確認を先に閉じる。
    let triggerReady = after;
    while (triggerReady.pendingBurstChecks.length > 0) {
      const actingPlayerId = triggerReady.pendingBurstChecks[0]!.actingPlayerId;
      const burstCheckAction = getLegalActions({
        state: triggerReady,
        actingPlayerId,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => undefined,
      }).find(
        (action) =>
          action.kind === "resolve_pending_burst_check" ||
          action.kind === "decline_pending_burst_check"
      );
      expect(burstCheckAction).toBeDefined();
      triggerReady = applyLegalAction({
        state: triggerReady,
        action: burstCheckAction!,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => undefined,
      }).state;
    }

    expect(triggerReady.pendingTriggeredEffects).toHaveLength(1);

    const resolveM04 = getLegalActions({
      state: triggerReady,
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "m04"
    );
    expect(resolveM04).toBeDefined();

    const declared = applyLegalAction({
      state: triggerReady,
      action: resolveM04!,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    // 誘発効果の宣言はスタック窓を開く（相手パスで即解決）。P3-105/project_stack_timing_all_steps:
    // 両者パスするまで steps は実行されない。
    const fieldCardLookup = buildFieldCardEffectLookup([m04Def]);
    let resolved = declared;
    for (let guard = 0; guard < 4 && resolved.stackWindow !== null; guard++) {
      const passAction =
        getLegalActions({
          state: resolved,
          actingPlayerId: ALICE,
          getCardDefinitionById: getD,
          getRegisteredTriggeredEffectActions: lookup,
          getRegisteredFieldCardEffectActions: fieldCardLookup,
        }).find((action) => action.kind === "pass_stack") ??
        getLegalActions({
          state: resolved,
          actingPlayerId: BOB,
          getCardDefinitionById: getD,
          getRegisteredTriggeredEffectActions: lookup,
          getRegisteredFieldCardEffectActions: fieldCardLookup,
        }).find((action) => action.kind === "pass_stack");
      if (!passAction) break;
      resolved = applyLegalAction({
        state: resolved,
        action: passAction,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredFieldCardEffectActions: fieldCardLookup,
      }).state;
    }
    expect(resolved.stackWindow).toBeNull();

    // 対象2体ぶん revealCount がスケールし、1回の発揮で両方の内容を確認する。
    expect(resolved.pendingDeckReveal?.revealedCardInstanceIds).toEqual(
      expect.arrayContaining(["m04-bob-deck-top", "m04-bob-deck-second"])
    );
    expect(resolved.pendingDeckReveal?.revealedCardInstanceIds.length).toBe(2);

    // 1回の誘発を解決したら同時離場由来の pending は残らない。
    const remainingM04Pending = resolved.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "leave_field" &&
        (p.relatedInstanceId === "m04-opp-target" ||
          p.relatedInstanceId === "m04-opp-target-2")
    );
    expect(remainingM04Pending).toBeUndefined();
    const legalActionsForRemaining = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: fieldCardLookup,
    });
    expect(
      legalActionsForRemaining.some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "m04"
      )
    ).toBe(false);
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-X06 封技の刃（continuous cost_modify + condition:step_phase + applicability.soulState）", () => {
  // 封技の刃 (X06): セット中、自分のアタックステップ中、相手の手札のマジックカードのコストを+1する。
  // cost_modify(player:"opponent", cardFilter:{category:magic, zone:hand}) + condition:step_phase
  // (attack, self) の live ゲート (BSAZ02-C12 effects[3] 同型)。applicability.soulState でセット中のみ。
  const x06Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-X06");
  if (!x06Def) throw new Error("BSLH01-X06 not found in ALL_CARDS");
  // P3-125 Step2 で effects[2] (SD flash stub) を flash/stack 2 entry に分割したため
  // quartz continuous 効果は effects[4] へシフト。
  const setEffectIndex = 4;
  const host6 = { ...hostDef, cardNo: "HOST6" };
  const opponentMagicDef = makeDef({
    cardNo: "OPP-MAGIC-X06",
    name: "相手手札マジックテスト",
    printedCategory: "magic",
  });
  const defs: Record<string, CardDefinition> = {
    HOST6: host6,
    "BSLH01-X06": x06Def,
    "OPP-MAGIC-X06": opponentMagicDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];

  function base(options: {
    soulSet: boolean;
    activePlayerId: string;
    step: GameState["step"];
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host6, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const x06 = createCardInstance(x06Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "x06",
    });
    let s: GameState = {
      ...b,
      activePlayerId: options.activePlayerId,
      step: options.step,
      cardInstances: [host, x06],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "x06",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return rebuildContinuousEffectsFromField(s, getD);
  }

  function opponentMagicDelta(state: GameState): number {
    const magicCardInstance = createCardInstance(opponentMagicDef, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    return getApplicableAdditionalCostDelta(state, BOB, opponentMagicDef, {
      card: magicCardInstance,
      cardZone: "hand",
      getCardDefinitionById: getD,
    });
  }

  it("セット中 + 自分のアタックステップ中は相手手札のマジックカードのコストが+1される", () => {
    const setEffect = x06Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("cost_modify");

    const state = base({
      soulSet: true,
      activePlayerId: ALICE,
      step: "attack",
    });
    expect(opponentMagicDelta(state)).toBe(1);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で+0", () => {
    const state = base({
      soulSet: false,
      activePlayerId: ALICE,
      step: "attack",
    });
    expect(opponentMagicDelta(state)).toBe(0);
  });

  it("セット中でも自分のアタックステップ以外(メインステップ)では+0", () => {
    const state = base({ soulSet: true, activePlayerId: ALICE, step: "main" });
    expect(opponentMagicDelta(state)).toBe(0);
  });

  it("セット中でも相手のアタックステップ(自分のアタックステップでない)では+0", () => {
    const state = base({ soulSet: true, activePlayerId: BOB, step: "attack" });
    expect(opponentMagicDelta(state)).toBe(0);
  });

  it("セット中+自分のアタックステップ中でも、手札以外(フィールド)のマジックカードのコストは変わらない", () => {
    const state = base({
      soulSet: true,
      activePlayerId: ALICE,
      step: "attack",
    });
    const fieldMagicInstance = createCardInstance(opponentMagicDef, {
      instanceId: "bob-magic-field",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const delta = getApplicableAdditionalCostDelta(
      state,
      BOB,
      opponentMagicDef,
      {
        card: fieldMagicInstance,
        cardZone: "field",
        getCardDefinitionById: getD,
      }
    );
    expect(delta).toBe(0);
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-TR04(A) 封技の刃（phase start + suppress_effect(effectFilter:eventAction) + applicability.soulState）", () => {
  // 封技の刃 (TR04(A)): セット中、相手のアタックステップ開始時、相手のスピリット1体を
  // 指定できる。このターンの間、指定した対象の『このスピリットのアタック時』効果は発揮されない。
  // timing:{kind:"phase", step:"attack", whose:"opponent", subPhase:"start"} (BSLH01-C10 機功と
  // 同じ phase+applicability.soulState 型) + suppress_effect(effectFilter:{timingKind:"card_event",
  // eventAction:"attack"}) で「アタック時」効果だけを絞って抑止する
  // (BSTH08-X01 導域/BSES01-R01 precedent、BSES01-R01 は blanket effectFilter:{} 版)。
  const tr04aDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-TR04(A)");
  if (!tr04aDef) throw new Error("BSLH01-TR04(A) not found in ALL_CARDS");
  const setEffectIndex = 2;
  const hostTR = { ...hostDef, cardNo: "HOSTTR" };
  const oppSpiritDef = makeDef({
    cardNo: "OPP-SPIRIT-TR04A",
    name: "対象スピリットテスト",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    HOSTTR: hostTR,
    "BSLH01-TR04(A)": tr04aDef,
    "OPP-SPIRIT-TR04A": oppSpiritDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([tr04aDef]);

  function base(soulSet: boolean): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(hostTR, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const tr04a = createCardInstance(tr04aDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "tr04a",
    });
    const oppSpirit = createCardInstance(oppSpiritDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-spirit",
    });
    let s: GameState = {
      ...b,
      activePlayerId: BOB,
      step: "attack",
      cardInstances: [host, tr04a, oppSpirit],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "tr04a",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireAttackStepStart(
    state: GameState,
    turnPlayerId: string
  ): GameState {
    const event: CollectedTriggerEvent = {
      actingPlayerId: turnPlayerId,
      eventKind: "start_step",
      source: "step_transition",
      chainId: "test:quartz-system:3338",
      attackId: null,
      relatedPlayerId: turnPlayerId,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      subPhase: "start",
    };
    return queuePendingReactionsFromTriggerEvents(
      { ...state, activePlayerId: turnPlayerId, step: "attack" },
      [event],
      undefined,
      {
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      }
    );
  }

  it("セット中 + 相手のアタックステップ開始時に誘発する", () => {
    const state = base(true);
    const res = fireAttackStepStart(state, BOB);
    expect(res.pendingTriggeredEffects.length).toBeGreaterThan(0);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    const state = base(false);
    const res = fireAttackStepStart(state, BOB);
    expect(res.pendingTriggeredEffects.length).toBe(0);
  });

  it("自分のアタックステップ開始時（相手のではない）では誘発しない（whose:opponent）", () => {
    const state = base(true);
    const res = fireAttackStepStart(state, ALICE);
    expect(res.pendingTriggeredEffects.length).toBe(0);
  });

  it("解決すると指定した相手スピリットの『アタック時』効果を抑止するCEが登録され、『召喚時』効果は抑止しない", () => {
    const setEffect = tr04aDef.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("suppress_effect");

    const state = base(true);
    const result = executeEffect({
      chainId: "test:quartz-system:3386",
      state,
      effect: setEffect,
      sourceInstanceId: "tr04a",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
    });

    const registration = {
      reevaluationPoints: [
        {
          timing: "before_each_step" as const,
          checks: ["effect_suppression" as const],
          failurePolicy: "abort_remaining" as const,
        },
      ],
    };

    expect(
      runReevaluationAtTiming({
        state: result,
        registration,
        timing: "before_each_step",
        sourceInstanceId: "opp-spirit",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          eventAction: "attack",
        },
        getCardDefinitionById: getD,
      })
    ).toMatchObject({
      passed: false,
      failedChecks: ["effect_suppression"],
    });

    expect(
      runReevaluationAtTiming({
        state: result,
        registration,
        timing: "before_each_step",
        sourceInstanceId: "opp-spirit",
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById: getD,
      }).passed
    ).toBe(true);
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-C06 魔防2（game_event leave_field 第三者 + stay_on_field(trigger_related_instance) + applicability.soulState）", () => {
  // 魔防2: セット中、相手のアルティメット/マジックの効果で系統：「CB」を持つ自分のスピリットが
  // フィールドを離れるとき、ターンに1回、対象を同じ状態でフィールドに残せる。
  // BSLH01-C08 天秤珠の game_event 第三者観測 (triggerSourceFilter+cause) と
  // BSLH01-R01 駆動の card_event(leave_field)+stay_on_field(self) を組み合わせ、
  // 対象を trigger_related_instance に差し替えた第三者版。
  const c06Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-C06");
  if (!c06Def) throw new Error("BSLH01-C06 not found in ALL_CARDS");
  const setEffectIndex = 2;
  const host9 = { ...hostDef, cardNo: "HOST9" };
  const ultimateSourceDef = makeDef({
    cardNo: "ULT-SRC",
    name: "アルティメット発生源テスト",
    printedCategory: "ultimate",
  });
  const spiritSourceDef = makeDef({
    cardNo: "SPIRIT-SRC2",
    name: "スピリット発生源テスト2",
    printedCategory: "spirit",
  });
  const cbAllyDef = makeDef({
    cardNo: "CB-ALLY",
    name: "CB離脱対象テスト",
    tribe: "CB",
    printedCategory: "spirit",
  });
  const nonCbAllyDef = makeDef({
    cardNo: "NONCB-ALLY",
    name: "非CB離脱対象テスト",
    tribe: "星竜",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    HOST9: host9,
    "BSLH01-C06": c06Def,
    "ULT-SRC": ultimateSourceDef,
    "SPIRIT-SRC2": spiritSourceDef,
    "CB-ALLY": cbAllyDef,
    "NONCB-ALLY": nonCbAllyDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([c06Def]);

  function base(options: {
    soulSet: boolean;
    allyDef: CardDefinition;
    sourceDef: CardDefinition;
    sourceOwnerPlayerId?: string;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host9, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const c06 = createCardInstance(c06Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "c06",
    });
    const sourceOwnerPlayerId = options.sourceOwnerPlayerId ?? BOB;
    const source = createCardInstance(options.sourceDef, {
      ownerPlayerId: sourceOwnerPlayerId,
      controllerPlayerId: sourceOwnerPlayerId,
      zone: "field",
      instanceId: "leave-source",
    });
    const ally = createCardInstance(options.allyDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "cb-ally-1",
      exhaustState: "exhausted",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, c06, source, ally],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "c06",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireSelfLeaveViaSource(
    state: GameState,
    causePlayerId: string
  ): GameState {
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-1",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:c06-leave",
      causePlayerId,
      causedByEffectSourceInstanceId: "leave-source",
    });
    return collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:3548",
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: causePlayerId,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("セット中 + 相手のアルティメットの効果で自分の CB スピリットが離れると誘発する", () => {
    const state = base({
      soulSet: true,
      allyDef: cbAllyDef,
      sourceDef: ultimateSourceDef,
    });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(
      after.pendingTriggeredEffects.some(
        (p) => p.eventKind === "destroy" && p.relatedInstanceId === "cb-ally-1"
      )
    ).toBe(true);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    const state = base({
      soulSet: false,
      allyDef: cbAllyDef,
      sourceDef: ultimateSourceDef,
    });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("離脱対象が CB を持たないなら triggerFilter で除外され不発", () => {
    const state = base({
      soulSet: true,
      allyDef: nonCbAllyDef,
      sourceDef: ultimateSourceDef,
    });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("発生源がアルティメット/マジックでない（スピリット）なら triggerSourceFilter で除外され不発", () => {
    const state = base({
      soulSet: true,
      allyDef: cbAllyDef,
      sourceDef: spiritSourceDef,
    });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("自分自身のアルティメットの効果で自壊させたときは cause:opponent_effect で除外され不発", () => {
    const state = base({
      soulSet: true,
      allyDef: cbAllyDef,
      sourceDef: ultimateSourceDef,
      sourceOwnerPlayerId: ALICE,
    });
    const after = fireSelfLeaveViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("解決すると対象が pendingLeave から外れ、疲労状態を維持したままフィールドに残る (trigger_related_instance)", () => {
    const setEffect = c06Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("stay_on_field");
    expect(
      (setEffect.steps[0]!.action as { target: { kind: string } }).target.kind
    ).toBe("trigger_related_instance");

    const state = base({
      soulSet: true,
      allyDef: cbAllyDef,
      sourceDef: ultimateSourceDef,
    });
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-1",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:c06-resolve",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: "leave-source",
    });
    const result = executeEffect({
      chainId: "test:quartz-system:3636",
      state: afterLeave,
      effect: setEffect,
      sourceInstanceId: "c06",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "cb-ally-1",
    });
    const ally = result.cardInstances.find((c) => c.instanceId === "cb-ally-1");
    expect(ally?.zone).toBe("field");
    expect(ally?.exhaustState).toBe("exhausted");
    expect(ally?.pendingLeaveKind).toBeFalsy();
    expect(
      result.pendingLeaveEntities.some((pl) => pl.instanceId === "cb-ally-1")
    ).toBe(false);
  });

  it("実プレイの flush 経路 (queuePendingLeave→collectAndQueueTriggerReactions→flushPendingLeaves) でも対象が trash へ先行 flush されず、stay_on_field 解決後にフィールドへ残る (ENGINE-game-event-stay-on-field-flush-gate 回帰テスト)", () => {
    const state = base({
      soulSet: true,
      allyDef: cbAllyDef,
      sourceDef: ultimateSourceDef,
    });
    const afterReactions = fireSelfLeaveViaSource(state, BOB);

    // flush 前: 誘発がまだ未解決のうちは trash へ物理移動してはいけない
    // (registeredLeaveFieldStayOnFieldSourceKeys が game_event 効果にも配布され、
    // canFlushPendingLeaveEntity が flush をブロックする)。
    const flushedTooEarly = flushPendingLeaves(afterReactions, getD);
    const allyBeforeResolve = flushedTooEarly.cardInstances.find(
      (c) => c.instanceId === "cb-ally-1"
    );
    expect(allyBeforeResolve?.zone).toBe("field");
    expect(
      flushedTooEarly.pendingLeaveEntities.some(
        (pl) => pl.instanceId === "cb-ally-1"
      )
    ).toBe(true);

    // 誘発を解決 (stay_on_field) → 改めて flush しても対象は trash へ行かず field に残る。
    const setEffect = c06Def.effects![setEffectIndex]!;
    const resolved = executeEffect({
      chainId: "test:quartz-system:3677",
      state: flushedTooEarly,
      effect: setEffect,
      sourceInstanceId: "c06",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "cb-ally-1",
    });
    const finalFlush = flushPendingLeaves(resolved, getD);
    const allyAfterResolve = finalFlush.cardInstances.find(
      (c) => c.instanceId === "cb-ally-1"
    );
    expect(allyAfterResolve?.zone).toBe("field");
    expect(allyAfterResolve?.exhaustState).toBe("exhausted");
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-R05 丹精（game_event leave_field 第三者 + set_exhaust_state(conditional_cost) + stay_on_field(trigger_related_instance) + applicability.soulState）", () => {
  // 丹精: セット中、ターンに1回、系統：「CB」を持つ自分のスピリットが相手によって
  // フィールドを離れるとき、自分のスピリット1体を疲労させることで、対象を同じ状態で
  // フィールドに残せる。BSLH01-C06 魔防2の第三者観測(triggerSourceFilter を絞らず
  // cause:opponent_effect のみ)＋疲労コストを「ことで」構文(conditional_cost)で前置した版。
  const r05Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-R05");
  if (!r05Def) throw new Error("BSLH01-R05 not found in ALL_CARDS");
  const setEffectIndex = 2;
  const host9 = { ...hostDef, cardNo: "HOST9-R05" };
  const spiritSourceDef = makeDef({
    cardNo: "SPIRIT-SRC-R05",
    name: "スピリット発生源テスト(R05)",
    printedCategory: "spirit",
  });
  const cbAllyDef = makeDef({
    cardNo: "CB-ALLY-R05",
    name: "CB離脱対象テスト(R05)",
    tribe: "CB",
    printedCategory: "spirit",
  });
  const otherAllyDef = makeDef({
    cardNo: "OTHER-ALLY-R05",
    name: "疲労コスト用スピリット(R05)",
    tribe: "星竜",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    "HOST9-R05": host9,
    "BSLH01-R05": r05Def,
    "SPIRIT-SRC-R05": spiritSourceDef,
    "CB-ALLY-R05": cbAllyDef,
    "OTHER-ALLY-R05": otherAllyDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([r05Def]);

  function base(options: {
    soulSet: boolean;
    includeOtherAlly: boolean;
    sourceOwnerPlayerId?: string;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host9, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const r05 = createCardInstance(r05Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "r05",
    });
    const sourceOwnerPlayerId = options.sourceOwnerPlayerId ?? BOB;
    const source = createCardInstance(spiritSourceDef, {
      ownerPlayerId: sourceOwnerPlayerId,
      controllerPlayerId: sourceOwnerPlayerId,
      zone: "field",
      instanceId: "leave-source",
    });
    const ally = createCardInstance(cbAllyDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "cb-ally-r05",
      exhaustState: "exhausted",
    });
    const cardInstances = [host, r05, source, ally];
    if (options.includeOtherAlly) {
      cardInstances.push(
        createCardInstance(otherAllyDef, {
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          instanceId: "other-ally-r05",
        })
      );
    }
    let s: GameState = {
      ...b,
      cardInstances,
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "r05",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireSelfLeaveViaSource(
    state: GameState,
    causePlayerId: string
  ): GameState {
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-r05",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:r05-leave",
      causePlayerId,
      causedByEffectSourceInstanceId: "leave-source",
    });
    return collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:3806",
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: causePlayerId,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("セット中 + 相手の効果で自分の CB スピリットが離れると誘発する（発生源がスピリットでも triggerSourceFilter を絞らないため誘発）", () => {
    const state = base({ soulSet: true, includeOtherAlly: true });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(
      after.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "destroy" && p.relatedInstanceId === "cb-ally-r05"
      )
    ).toBe(true);
  });

  it("未セットなら applicability.soulState で不発", () => {
    const state = base({ soulSet: false, includeOtherAlly: true });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("自分自身の効果で自壊させたときは cause:opponent_effect で除外され不発", () => {
    const state = base({
      soulSet: true,
      includeOtherAlly: true,
      sourceOwnerPlayerId: ALICE,
    });
    const after = fireSelfLeaveViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("疲労コストを支払える自分のスピリットがいれば解決し、対象は疲労状態を維持したまま残り、コスト対象は疲労する", () => {
    const setEffect = r05Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("set_exhaust_state");
    expect(setEffect.steps[1]!.connector).toBe("conditional_cost");
    expect(setEffect.steps[1]!.action.kind).toBe("stay_on_field");

    const state = base({ soulSet: true, includeOtherAlly: true });
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-r05",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:r05-resolve",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: "leave-source",
    });
    const result = executeEffect({
      chainId: "test:quartz-system:3861",
      state: afterLeave,
      effect: setEffect,
      sourceInstanceId: "r05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "cb-ally-r05",
    });
    const ally = result.cardInstances.find(
      (c) => c.instanceId === "cb-ally-r05"
    );
    expect(ally?.zone).toBe("field");
    expect(ally?.exhaustState).toBe("exhausted");
    expect(ally?.pendingLeaveKind).toBeFalsy();
    const costTarget = result.cardInstances.find(
      (c) => c.instanceId === "other-ally-r05"
    );
    expect(costTarget?.exhaustState).toBe("exhausted");
  });

  it("疲労コストを支払える自分のスピリットがいない（離脱対象以外に own spirit なし）なら conditional_cost で全体ロールバックし対象は残せない", () => {
    const setEffect = r05Def.effects![setEffectIndex]!;
    const state = base({ soulSet: true, includeOtherAlly: false });
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-r05",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:r05-no-cost",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: "leave-source",
    });
    const result = executeEffect({
      chainId: "test:quartz-system:3893",
      state: afterLeave,
      effect: setEffect,
      sourceInstanceId: "r05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "cb-ally-r05",
    });
    const ally = result.cardInstances.find(
      (c) => c.instanceId === "cb-ally-r05"
    );
    expect(ally?.pendingLeaveKind).toBeTruthy();
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-X07 防御3（game_event leave_field 第三者 + triggerSourceFilter:spirit/nexus + stay_on_field(trigger_related_instance) + applicability.soulState）", () => {
  // 防御3: セット中、ターンに1回、系統：「CB」を持つ自分のスピリットが相手の
  // スピリット/ネクサスの効果でフィールドを離れるとき、対象を同じ状態で残せる。
  // triggerSourceFilter を spirit/nexus に絞る以外は BSLH01-C06 魔防2と同型。
  const x07Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-X07");
  if (!x07Def) throw new Error("BSLH01-X07 not found in ALL_CARDS");
  const setEffectIndex = 3;
  const host9 = { ...hostDef, cardNo: "HOST9-X07" };
  const spiritSourceDef = makeDef({
    cardNo: "SPIRIT-SRC-X07",
    name: "スピリット発生源テスト(X07)",
    printedCategory: "spirit",
  });
  const nexusSourceDef = makeDef({
    cardNo: "NEXUS-SRC-X07",
    name: "ネクサス発生源テスト(X07)",
    printedCategory: "nexus",
  });
  const ultimateSourceDef = makeDef({
    cardNo: "ULT-SRC-X07",
    name: "アルティメット発生源テスト(X07)",
    printedCategory: "ultimate",
  });
  const cbAllyDef = makeDef({
    cardNo: "CB-ALLY-X07",
    name: "CB離脱対象テスト(X07)",
    tribe: "CB",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    "HOST9-X07": host9,
    "BSLH01-X07": x07Def,
    "SPIRIT-SRC-X07": spiritSourceDef,
    "NEXUS-SRC-X07": nexusSourceDef,
    "ULT-SRC-X07": ultimateSourceDef,
    "CB-ALLY-X07": cbAllyDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([x07Def]);

  function base(options: {
    soulSet: boolean;
    sourceDef: CardDefinition;
    sourceOwnerPlayerId?: string;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host9, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const x07 = createCardInstance(x07Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "x07",
    });
    const sourceOwnerPlayerId = options.sourceOwnerPlayerId ?? BOB;
    const source = createCardInstance(options.sourceDef, {
      ownerPlayerId: sourceOwnerPlayerId,
      controllerPlayerId: sourceOwnerPlayerId,
      zone: "field",
      instanceId: "leave-source",
    });
    const ally = createCardInstance(cbAllyDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "cb-ally-x07",
      exhaustState: "exhausted",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, x07, source, ally],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "x07",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireSelfLeaveViaSource(
    state: GameState,
    causePlayerId: string
  ): GameState {
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-x07",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:x07-leave",
      causePlayerId,
      causedByEffectSourceInstanceId: "leave-source",
    });
    return collectAndQueueTriggerReactions({
      chainId: "test:quartz-system:4013",
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: causePlayerId,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("セット中 + 相手のスピリットの効果で自分の CB スピリットが離れると誘発する", () => {
    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(
      after.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "destroy" && p.relatedInstanceId === "cb-ally-x07"
      )
    ).toBe(true);
  });

  it("相手のネクサスの効果でも誘発する", () => {
    const state = base({ soulSet: true, sourceDef: nexusSourceDef });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(
      after.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "destroy" && p.relatedInstanceId === "cb-ally-x07"
      )
    ).toBe(true);
  });

  it("未セットなら applicability.soulState で不発", () => {
    const state = base({ soulSet: false, sourceDef: spiritSourceDef });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("発生源がスピリット/ネクサスでない（アルティメット）なら triggerSourceFilter で除外され不発", () => {
    const state = base({ soulSet: true, sourceDef: ultimateSourceDef });
    const after = fireSelfLeaveViaSource(state, BOB);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("自分自身のスピリットの効果で自壊させたときは cause:opponent_effect で除外され不発", () => {
    const state = base({
      soulSet: true,
      sourceDef: spiritSourceDef,
      sourceOwnerPlayerId: ALICE,
    });
    const after = fireSelfLeaveViaSource(state, ALICE);
    expect(after.pendingTriggeredEffects.length).toBe(0);
  });

  it("解決すると対象が pendingLeave から外れ、疲労状態を維持したままフィールドに残る (trigger_related_instance)", () => {
    const setEffect = x07Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe("stay_on_field");

    const state = base({ soulSet: true, sourceDef: spiritSourceDef });
    const afterLeave = queuePendingLeave({
      state,
      instanceId: "cb-ally-x07",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:x07-resolve",
      causePlayerId: BOB,
      causedByEffectSourceInstanceId: "leave-source",
    });
    const result = executeEffect({
      chainId: "test:quartz-system:4083",
      state: afterLeave,
      effect: setEffect,
      sourceInstanceId: "x07",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      triggerRelatedInstanceId: "cb-ally-x07",
    });
    const ally = result.cardInstances.find(
      (c) => c.instanceId === "cb-ally-x07"
    );
    expect(ally?.zone).toBe("field");
    expect(ally?.exhaustState).toBe("exhausted");
    expect(ally?.pendingLeaveKind).toBeFalsy();
  });
});

describe("quartz-system F2.4b① set-effect: BSLH01-R02 美臭（register_redirect_effect_target owned_filter + usageLimit + applicability.soulState）", () => {
  // 美臭: セット中、ターンに1回、自分のスピリットが相手のスピリットの効果の対象になるとき、
  // その対象を自分が選ぶ自分のスピリット1体のみに変更できる。P3-47 F-4 redirect_effect_target CE
  // (フランドール【フォーオブアカインド】先例) を拡張した owned_filter kind (保護対象・候補とも
  // 「自分の現在のスピリット全体」を matchtime に動的解決) + usageLimit (redirect 自体への
  // 初導入) で表現する。
  const r02Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-R02");
  if (!r02Def) throw new Error("BSLH01-R02 not found in ALL_CARDS");
  const setEffectIndex = 3;
  const host10 = { ...hostDef, cardNo: "HOST10-R02" };
  const allyDef = makeDef({
    cardNo: "ALLY-R02",
    name: "自スピリットテスト(R02)",
    printedCategory: "spirit",
  });
  // host は quartzHostData を持つ brave カード (printedCategory:"brave") で「自分のスピリット」
  // フィルタに一致しないため、redirect 候補には ally2 (printedCategory:"spirit") が必要。
  const ally2Def = makeDef({
    cardNo: "ALLY2-R02",
    name: "自スピリット候補テスト(R02)",
    printedCategory: "spirit",
  });
  const oppSpiritDef = makeDef({
    cardNo: "OPP-SPIRIT-R02",
    name: "相手発生源スピリットテスト(R02)",
    printedCategory: "spirit",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
              amount: -1000,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    ],
  });
  // adversarial verifier round2 指摘: 原文「相手の**スピリット**の効果」を反映するため、
  // 相手のマジック由来の同型効果では redirect が発動しないことを確認する対照カード。
  const oppMagicDef = makeDef({
    cardNo: "OPP-MAGIC-R02",
    name: "相手発生源マジックテスト(R02)",
    printedCategory: "magic",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
              amount: -1000,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    ],
  });
  const defs: Record<string, CardDefinition> = {
    "HOST10-R02": host10,
    "BSLH01-R02": r02Def,
    "ALLY-R02": allyDef,
    "ALLY2-R02": ally2Def,
    "OPP-SPIRIT-R02": oppSpiritDef,
    "OPP-MAGIC-R02": oppMagicDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];

  function base(options: {
    soulSet: boolean;
    oppSourceDef?: CardDefinition;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host10, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const r02 = createCardInstance(r02Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "r02",
    });
    const ally = createCardInstance(allyDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "ally",
      normalCoreCount: 1,
    });
    const ally2 = createCardInstance(ally2Def, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "ally2",
      normalCoreCount: 1,
    });
    const oppSource = createCardInstance(options.oppSourceDef ?? oppSpiritDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-source",
      normalCoreCount: 1,
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, r02, ally, ally2, oppSource],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "r02",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return rebuildContinuousEffectsFromField(s, getD);
  }

  function fireOpponentAttackTargetingAlly(
    state: GameState,
    oppSourceDef: CardDefinition = oppSpiritDef
  ): GameState {
    const effect = oppSourceDef.effects![0]!;
    return executeEffect({
      chainId: "test:quartz-system:4247",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "opp-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getD,
    });
  }

  it("セット中 + 相手スピリットの効果が自分のスピリットを対象にすると redirect pending が発行される", () => {
    const setEffect = r02Def.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action.kind).toBe(
      "register_redirect_effect_target"
    );

    const state = base({ soulSet: true });
    const after = fireOpponentAttackTargetingAlly(state);
    expect(after.pendingTargetRedirects).toHaveLength(1);
    const pending = after.pendingTargetRedirects[0]!;
    expect(pending.redirectableInstanceId).toBe("ally");
    expect(pending.promptedPlayerId).toBe(ALICE);
    // ally2 も自分のスピリットなので候補に入る (host は printedCategory:"brave" で対象外、
    // r02 自身はクォーツスロットなので候補に入らない)
    expect(pending.candidateTokenInstanceIds).toEqual(["ally2"]);
  });

  it("セット中でも相手のマジックの効果 (スピリットでない) が対象にした場合は redirect pending が発行されない (sourceFilter:category=spirit)", () => {
    const state = base({ soulSet: true, oppSourceDef: oppMagicDef });
    const after = fireOpponentAttackTargetingAlly(state, oppMagicDef);
    expect(after.pendingTargetRedirects).toHaveLength(0);
    const bpCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    expect(bpCEs[0]?.targetInstanceId).toBe("ally");
  });

  it("未セット（手札のまま）なら applicability.soulState で CE 未登録 → redirect 不発", () => {
    const state = base({ soulSet: false });
    const after = fireOpponentAttackTargetingAlly(state);
    expect(after.pendingTargetRedirects).toHaveLength(0);
    const bpCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    expect(bpCEs[0]?.targetInstanceId).toBe("ally");
  });

  it("confirm すると対象が ally2 に差し替わり、decline すると ally のまま bp_modify が適用される", () => {
    const state = base({ soulSet: true });
    const afterPending = fireOpponentAttackTargetingAlly(state);
    const pending = afterPending.pendingTargetRedirects[0]!;

    const confirmResult = applyLegalAction({
      state: afterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: "ally2",
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in confirmResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(confirmResult.redirected).toBe(true);
    const bpCEs = confirmResult.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    expect(bpCEs[0]?.targetInstanceId).toBe("ally2");
  });

  it("〔ターンに1回〕: confirm で1回消費すると、同ターン内の再度の対象化では redirect pending が発行されない", () => {
    const state = base({ soulSet: true });
    const afterPending = fireOpponentAttackTargetingAlly(state);
    const pending = afterPending.pendingTargetRedirects[0]!;
    const confirmResult = applyLegalAction({
      state: afterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: "ally2",
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in confirmResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    // host 継承発揮 (ENGINE-quartz-host-identity-propagation continuous 側) により、
    // usageLimit 消費記録は host (ENIGMA 相当) の instanceId で記録される (r02 自身ではない)。
    expect(
      confirmResult.state.effectUsageRecords.some(
        (r) =>
          r.sourceInstanceId === "host" &&
          r.effectLabel === "redirect_effect_target"
      )
    ).toBe(true);

    // 同じ相手効果がもう一度 ally を対象にした場合 (2 回目のアタック相当)、usageLimit 消費済みで
    // 今度は redirect pending が出ず ally に直接 bp_modify が適用される。
    const secondFire = fireOpponentAttackTargetingAlly(confirmResult.state);
    expect(secondFire.pendingTargetRedirects).toHaveLength(0);
    const bpCEs = secondFire.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier" && ce.targetInstanceId === "ally"
    );
    expect(bpCEs.length).toBeGreaterThan(0);
  });
});

describe.each([
  { cardNo: "BSLH01-M03", quartzName: "双児珠", maxCost: 6 },
  { cardNo: "BSLH01-R01", quartzName: "駆動", maxCost: 5 },
])(
  "quartz-system F2.4b① set-effect: $cardNo（フィールド上トークンマジックのフラッシュ効果を borrow_magic_effect でスタック発揮）",
  ({ cardNo, maxCost }) => {
    // 双児珠/駆動: ターンに1回、自分は、フィールドにあるコストN以下のトークンマジックカードの
    // フラッシュ効果を、スタックタイミングにスタック効果として使用できる。
    // adversarial verifier round1 の指摘 (needs-dsl park は誤りで、既存 borrow_magic_effect
    // primitive + BSAZ03-M01 precedent で表現可能) を受けて実装。BSAZ03-M01 は zone:"trash" から
    // 借用するが、本カードは「フィールドにある」トークンマジックが対象のため zone:"field"。
    const hostQuartzDef = ALL_CARDS.find((c) => c.cardNo === cardNo);
    if (!hostQuartzDef) throw new Error(`${cardNo} not found in ALL_CARDS`);

    function stackBorrowEffect() {
      return hostQuartzDef!.effects!.find(
        (e) =>
          e.timing.kind === "activated" &&
          e.timing.mode === "stack" &&
          e.steps.some((s) => s.action.kind === "borrow_magic_effect")
      )!;
    }

    function tokenMagicDonor(
      donorCardNo: string,
      overrides: Partial<CardDefinition> = {}
    ): CardDefinition {
      return makeDef({
        cardNo: donorCardNo,
        name: `テストトークンマジック(${donorCardNo})`,
        printedCategory: "magic",
        maxTokenDeckCount: 10,
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
            textRef: [0],
          },
        ],
        ...overrides,
      });
    }

    it("card-data: 非stub・applicability.soulState・zone:field・isToken/maxCost/hasActivatedEffectMode で絞り込む borrow_magic_effect", () => {
      const effect = stackBorrowEffect();
      expect(effect.stub).toBeUndefined();
      expect(effect.applicability).toEqual({ soulState: true });
      expect(effect.usageLimit).toEqual({
        kind: "per_instance",
        duration: "turn",
        maxCount: 1,
      });
      const action = effect.steps[0]!.action;
      expect(action.kind).toBe("borrow_magic_effect");
      if (action.kind !== "borrow_magic_effect") throw new Error("unreachable");
      expect(action.borrowModes).toEqual(["flash"]);
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        zone: "field",
        filter: {
          category: ["magic"],
          isToken: true,
          maxCost,
          hasActivatedEffectMode: ["flash"],
        },
        count: 1,
      });
    });

    // applicability.soulState は quartz セット中カードが owner の soulStateInstanceIds に
    // 加わることで満たされる (quartz-system.ts setQuartz)。低レベル executeEffect 呼び出しでも
    // この前提が無いと effect:applicability-unmet で no-op になるため、setQuartz で実際に
    // ENIGMA host へセットしてから発火させる (R02 美臭テストの base() と同型)。
    function setQuartzState(
      quartzDef: CardDefinition,
      donorDefs: CardDefinition[]
    ): {
      state: GameState;
      quartzInstanceId: string;
      getD: (id: string) => CardDefinition | undefined;
    } {
      const host = createCardInstance(hostDef, {
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        instanceId: `host-${quartzDef.cardNo}`,
      });
      const quartzCard = createCardInstance(quartzDef, {
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
        instanceId: `quartz-${quartzDef.cardNo}`,
      });
      const donorInstances = donorDefs.map((d, i) =>
        createCardInstance(d, {
          instanceId: `donor-${quartzDef.cardNo}-${i}-${d.cardNo}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        })
      );
      const donorDefMap = new Map(donorDefs.map((d) => [d.cardNo, d]));
      const getD: (id: string) => CardDefinition | undefined = (id) =>
        ALL_CARDS.find((c) => c.cardNo === id) ??
        donorDefMap.get(id) ??
        (id === hostDef.cardNo ? hostDef : undefined);

      let s = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, quartzCard, ...donorInstances],
      });
      s = {
        ...s,
        players: s.players.map((p) =>
          p.id === ALICE ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
        ),
      };
      const set = setQuartz(
        s,
        {
          quartzInstanceId: quartzCard.instanceId,
          hostInstanceId: host.instanceId,
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      );
      if (!set) throw new Error("setQuartz failed");
      return { state: set, quartzInstanceId: quartzCard.instanceId, getD };
    }

    it("実行: フィールドの適格トークンマジック(cost<=上限)のflash効果(draw 1)が実際に発揮され、借用元はフィールドに残る(thenMove無し)", () => {
      const donorDef = tokenMagicDonor(`TEST-${cardNo}-DONOR`, {
        cost: maxCost,
      });
      const { state, quartzInstanceId, getD } = setQuartzState(hostQuartzDef, [
        donorDef,
      ]);
      const donorId = `donor-${cardNo}-0-${donorDef.cardNo}`;
      const before = state.players.find((p) => p.id === ALICE)!.handCount;

      const after = executeEffect({
        chainId: "test:quartz-system:4521",
        state,
        effect: stackBorrowEffect(),
        sourceInstanceId: quartzInstanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: () => [],
        targetInstanceIds: [donorId],
      });

      const alice = after.players.find((p) => p.id === ALICE)!;
      expect(alice.handCount).toBe(before + 1); // 借用した draw 1 が実際に発揮された
      const donor = after.cardInstances.find((c) => c.instanceId === donorId)!;
      expect(donor.zone).toBe("field"); // thenMove 無しなのでフィールドに残ったまま
    });

    it("対象フィルタ: コスト超過のトークンマジックや非トークンマジックは候補から除外される", () => {
      const eligibleDef = tokenMagicDonor(`TEST-${cardNo}-FILTER-ELIGIBLE`, {
        cost: maxCost,
      });
      const tooExpensiveDef = tokenMagicDonor(
        `TEST-${cardNo}-FILTER-EXPENSIVE`,
        { cost: maxCost + 1 }
      );
      const nonTokenDef = tokenMagicDonor(`TEST-${cardNo}-FILTER-NONTOKEN`, {
        cost: maxCost,
        maxTokenDeckCount: undefined,
      });
      const { state, quartzInstanceId, getD } = setQuartzState(hostQuartzDef, [
        eligibleDef,
        tooExpensiveDef,
        nonTokenDef,
      ]);
      const before = state.players.find((p) => p.id === ALICE)!.handCount;

      // preSelectedIds を渡さず自動解決させ、唯一の適格候補が選ばれることを確認する。
      const after = executeEffect({
        chainId: "test:quartz-system:4557",
        state,
        effect: stackBorrowEffect(),
        sourceInstanceId: quartzInstanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: () => [],
      });

      const alice = after.players.find((p) => p.id === ALICE)!;
      expect(alice.handCount).toBe(before + 1); // 適格候補1枚分のdrawのみ発揮
    });
  }
);

describe("quartz-system ENGINE-nth-occurrence-trigger-gate Step3: BSLH01-C05 獅子珠（game_event leave_field 第三者 + occurrenceGate(turn,targetCount:2) + core_move outside_game→reserve + applicability.soulState）", () => {
  // 獅子珠: セット中、系統「CB」を持つ自分のスピリットの効果で、ターンに2回目に相手のカードが
  // フィールドを離れたとき、ゲーム外から<ソウルコア>1個を自分のリザーブに置ける。
  // BSDB01-CX01[2,3](b) 「自分の系統サイヤ人によって相手のカードがフィールドを離れるとき」と
  // 同型の第三者観測 (triggerSourceFilter+cause:opponent_effect+sourceWhose:either) に
  // occurrenceGate(duration:turn, targetCount:2) を重ねた版。
  const c05Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-C05");
  if (!c05Def) throw new Error("BSLH01-C05 not found in ALL_CARDS");
  const setEffectIndex = 2;
  const host9 = { ...hostDef, cardNo: "HOST9-C05" };
  const cbSpiritSourceDef = makeDef({
    cardNo: "CB-SPIRIT-SRC-C05",
    name: "CBスピリット発生源テスト(C05)",
    tribe: "CB",
    printedCategory: "spirit",
  });
  const nonCbSpiritSourceDef = makeDef({
    cardNo: "NONCB-SPIRIT-SRC-C05",
    name: "非CBスピリット発生源テスト(C05)",
    tribe: "星竜",
    printedCategory: "spirit",
  });
  const oppLeaverDef = makeDef({
    cardNo: "OPP-LEAVER-C05",
    name: "相手離脱対象テスト(C05)",
    printedCategory: "spirit",
  });
  const defs: Record<string, CardDefinition> = {
    "HOST9-C05": host9,
    "BSLH01-C05": c05Def,
    "CB-SPIRIT-SRC-C05": cbSpiritSourceDef,
    "NONCB-SPIRIT-SRC-C05": nonCbSpiritSourceDef,
    "OPP-LEAVER-C05": oppLeaverDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([c05Def]);

  function base(options: {
    soulSet: boolean;
    sourceDef: CardDefinition;
  }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host9, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host-c05",
    });
    const c05 = createCardInstance(c05Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "c05",
    });
    const source = createCardInstance(options.sourceDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "cb-source",
    });
    const leaver1 = createCardInstance(oppLeaverDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-leaver-1",
    });
    const leaver2 = createCardInstance(oppLeaverDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-leaver-2",
    });
    const leaver3 = createCardInstance(oppLeaverDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      instanceId: "opp-leaver-3",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, c05, source, leaver1, leaver2, leaver3],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host-c05"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "c05",
          hostInstanceId: "host-c05",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireOpponentLeave(state: GameState, instanceId: string): GameState {
    const afterLeave = queuePendingLeave({
      state,
      instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: `test-chain:c05-leave-${instanceId}`,
      causePlayerId: ALICE,
      causedByEffectSourceInstanceId: "cb-source",
    });
    return collectAfterPhysicalLeave({
      beforeState: state,
      afterState: afterLeave,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
  }

  it("[board] セット中 + CBスピリットの効果で相手カードが2回離れると2回目でのみ発火し、解決するとゲーム外から<ソウルコア>1個がリザーブに置かれる", () => {
    let state = base({ soulSet: true, sourceDef: cbSpiritSourceDef });

    // 1回目: tally=1 (targetCount=2 と不一致) → 発火しない
    state = fireOpponentLeave(state, "opp-leaver-1");
    expect(state.pendingTriggeredEffects.length).toBe(0);
    expect(state.pendingPrivateDeclarations.length).toBe(0);
    expect(
      state.effectOccurrenceRecords.find((r) => r.sourceInstanceId === "c05")
        ?.count
    ).toBe(1);

    // 2回目: tally=2 (targetCount と一致) → 発火する
    state = fireOpponentLeave(state, "opp-leaver-2");
    const queuedCount =
      state.pendingTriggeredEffects.length +
      state.pendingPrivateDeclarations.length;
    expect(queuedCount).toBeGreaterThan(0);
    expect(
      state.effectOccurrenceRecords.find((r) => r.sourceInstanceId === "c05")
        ?.count
    ).toBe(2);

    // 解決: ゲーム外から<ソウルコア>1個が自分のリザーブに置かれる (盤面変化検証)。
    const before = state.players.find((p) => p.id === ALICE)!;
    const setEffect = c05Def.effects![setEffectIndex]!;
    const resolved = executeEffect({
      chainId: "test:quartz-system:4717",
      state,
      effect: setEffect,
      sourceInstanceId: "c05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
    });
    const after = resolved.players.find((p) => p.id === ALICE)!;
    expect(after.reserveSoulCoreCount).toBe(before.reserveSoulCoreCount + 1);

    // 3回目は「ターンに2回目」ではない。2回目の既存キューを残したままでも、
    // 新たな宣言を追加せず、発生回数だけ3へ進める。
    const queuedAtSecond =
      resolved.pendingTriggeredEffects.length +
      resolved.pendingPrivateDeclarations.length;
    const afterThirdLeave = fireOpponentLeave(resolved, "opp-leaver-3");
    expect(
      afterThirdLeave.pendingTriggeredEffects.length +
        afterThirdLeave.pendingPrivateDeclarations.length
    ).toBe(queuedAtSecond);
    expect(
      afterThirdLeave.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "c05"
      )?.count
    ).toBe(3);
  });

  it("セット中でも系統CBでない自分のスピリットの効果では triggerSourceFilter で除外され不発", () => {
    let state = base({ soulSet: true, sourceDef: nonCbSpiritSourceDef });
    state = fireOpponentLeave(state, "opp-leaver-1");
    state = fireOpponentLeave(state, "opp-leaver-2");
    expect(state.pendingTriggeredEffects.length).toBe(0);
    expect(state.pendingPrivateDeclarations.length).toBe(0);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発 (tally も加算されない)", () => {
    let state = base({ soulSet: false, sourceDef: cbSpiritSourceDef });
    state = fireOpponentLeave(state, "opp-leaver-1");
    expect(state.pendingTriggeredEffects.length).toBe(0);
    expect(
      state.effectOccurrenceRecords.find((r) => r.sourceInstanceId === "c05")
    ).toBeUndefined();
  });
});

describe("quartz-system BSLH01-R03 練気: 召喚/配置/マジックの使用完了をcard_usedで一度ずつ数える", () => {
  // 練気: セット中、相手のメインステップ中、相手がカードを召喚/配置/使用したとき、4回目なら
  // ゲーム外から<ソウルコア>1個を自分のリザーブに置ける。用語「使用」は召喚/配置も含む。
  // 場入り観測は通常の使用履歴を作り、その本体・派生処理完了後の card_used だけで数える。
  const r03Def = ALL_CARDS.find((c) => c.cardNo === "BSLH01-R03");
  if (!r03Def) throw new Error("BSLH01-R03 not found in ALL_CARDS");
  const usageEffectIndex = 2;
  const host9 = { ...hostDef, cardNo: "HOST9-R03" };
  const opponentSpiritDef = makeDef({
    cardNo: "OPP-SPIRIT-R03",
    name: "相手スピリット発生源テスト(R03)",
    printedCategory: "spirit",
  });
  // 「配置」はネクサスの場出し (spirit は「召喚」)。summonResponderMatchesCategoryScope の
  // eventKind==="place" 分岐は zoneRoleName が "nexus"(または未設定) のカードのみ許可する
  // (trigger-system.ts:1079-1082)。place テストで spirit 定義を使うと本文上ありえない組み合わせ
  // (ネクサス以外の place) となり除外され不発になる。
  const opponentNexusDef = makeDef({
    cardNo: "OPP-NEXUS-R03",
    name: "相手ネクサス発生源テスト(R03)",
    printedCategory: "nexus",
  });
  const opponentMagicSourceDef = makeDef({
    cardNo: "OPP-MAGIC-R03",
    name: "相手マジック発生源テスト(R03)",
    printedCategory: "magic",
  });
  const defs: Record<string, CardDefinition> = {
    "HOST9-R03": host9,
    "BSLH01-R03": r03Def,
    "OPP-SPIRIT-R03": opponentSpiritDef,
    "OPP-NEXUS-R03": opponentNexusDef,
    "OPP-MAGIC-R03": opponentMagicSourceDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([r03Def]);

  function base(options: { soulSet: boolean; step: Step }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host9, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host-r03",
    });
    const r03 = createCardInstance(r03Def, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "r03",
    });
    let s: GameState = {
      ...b,
      step: options.step,
      activePlayerId: BOB,
      cardInstances: [host, r03],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host-r03"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "r03",
          hostInstanceId: "host-r03",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return s;
  }

  function fireOpponentEnterField(
    state: GameState,
    eventKind: "summon" | "place",
    index: number
  ): GameState {
    // event:"summon"/"place" は require_related_instance_on_field 検証があり、
    // relatedInstanceId が実在するフィールド上カードでないと候補から除外される
    // (trigger-system.ts triggerEventKindToStructuredEvent の validationMode)。
    // 「配置」はネクサス限定 (summonResponderMatchesCategoryScope) のため定義を使い分ける。
    const enteredInstanceId = `opp-${eventKind}-${index}`;
    const entered = createCardInstance(
      eventKind === "place" ? opponentNexusDef : opponentSpiritDef,
      {
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        instanceId: enteredInstanceId,
      }
    );
    const stateWithEntered: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, entered],
    };
    const event: CollectedTriggerEvent = {
      actingPlayerId: BOB,
      eventKind,
      source: "action_resolution",
      chainId: `test-chain:r03-${eventKind}-${index}`,
      attackId: null,
      relatedPlayerId: BOB,
      relatedInstanceId: enteredInstanceId,
      amount: null,
      step: state.step,
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      stateWithEntered,
      [event],
      undefined,
      {
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
      }
    );
    return finalizeCardUsageAndQueueTriggers(queued, {
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    });
  }

  function fireOpponentMagicUse(state: GameState, index: number): GameState {
    const usedId = `opp-magic-source-${index}`;
    const resolving: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(opponentMagicSourceDef, {
          instanceId: usedId,
          ownerPlayerId: BOB,
          zone: "trash",
        }),
      ],
      flashCardUsageLog: [
        ...state.flashCardUsageLog,
        {
          chainId: "test:quartz-system:4900",
          playerId: BOB,
          cardInstanceId: usedId,
          cardDefinitionId: opponentMagicSourceDef.cardNo,
          turnNumber: state.turnNumber,
          step: state.step,
          attackId: null,
          mode: "flash",
          completion: "resolving",
        },
      ],
    };
    return finalizeCardUsageAndQueueTriggers(resolving, {
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    });
  }

  it("[board] セット中 + 相手のメインステップ中、召喚1回＋配置1回＋使用2回の合算(groupId共有tally)が4回目でのみ発火し、解決するとゲーム外から<ソウルコア>1個がリザーブに置かれる", () => {
    let state = base({ soulSet: true, step: "main" });

    // 1回目 (召喚): tally=1
    state = fireOpponentEnterField(state, "summon", 1);
    expect(
      state.pendingTriggeredEffects.length +
        state.pendingPrivateDeclarations.length
    ).toBe(0);

    // 2回目（マジック使用完了）: tally=2。
    state = fireOpponentMagicUse(state, 1);
    expect(
      state.pendingTriggeredEffects.length +
        state.pendingPrivateDeclarations.length
    ).toBe(0);

    // 3回目（配置完了）: tally=3。
    state = fireOpponentEnterField(state, "place", 1);
    expect(
      state.pendingTriggeredEffects.length +
        state.pendingPrivateDeclarations.length
    ).toBe(0);

    // 4回目（マジック使用完了）: tally=4 → 発火する。
    state = fireOpponentMagicUse(state, 2);
    const queuedCount =
      state.pendingTriggeredEffects.length +
      state.pendingPrivateDeclarations.length;
    expect(queuedCount).toBeGreaterThan(0);

    const before = state.players.find((p) => p.id === ALICE)!;
    const setEffect = r03Def.effects![usageEffectIndex]!;
    const resolved = executeEffect({
      chainId: "test:quartz-system:4952",
      state,
      effect: setEffect,
      sourceInstanceId: "r03",
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
    });
    const after = resolved.players.find((p) => p.id === ALICE)!;
    expect(after.reserveSoulCoreCount).toBe(before.reserveSoulCoreCount + 1);
  });

  it("単発の召喚は場入り観測と使用完了で二重集計されず tally=1 のまま", () => {
    let state = base({ soulSet: true, step: "main" });
    state = fireOpponentEnterField(state, "summon", 1);
    expect(
      state.effectOccurrenceRecords.find((r) => r.sourceInstanceId === "r03")
        ?.count
    ).toBe(1);
  });

  it("単発の配置(ネクサス)観測も二重集計されず tally=1 のまま", () => {
    let state = base({ soulSet: true, step: "main" });
    state = fireOpponentEnterField(state, "place", 1);
    expect(
      state.effectOccurrenceRecords.find((r) => r.sourceInstanceId === "r03")
        ?.count
    ).toBe(1);
  });

  it("相手のアタックステップ中の召喚/配置は timingScope(period:main) で除外され tally も加算されない", () => {
    let state = base({ soulSet: true, step: "attack" });
    state = fireOpponentEnterField(state, "summon", 1);
    expect(
      state.pendingTriggeredEffects.length +
        state.pendingPrivateDeclarations.length
    ).toBe(0);
    expect(
      state.effectOccurrenceRecords.find((r) => r.sourceInstanceId === "r03")
    ).toBeUndefined();
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    let state = base({ soulSet: false, step: "main" });
    state = fireOpponentEnterField(state, "summon", 1);
    state = fireOpponentMagicUse(state, 1);
    state = fireOpponentEnterField(state, "place", 1);
    state = fireOpponentMagicUse(state, 2);
    expect(
      state.pendingTriggeredEffects.length +
        state.pendingPrivateDeclarations.length
    ).toBe(0);
  });

  it("card-data DSL: 単一card_usedで4回目の使用を観測する", () => {
    const effect = r03Def.effects![usageEffectIndex]!;
    const expectedGate = {
      duration: "turn" as const,
      targetCount: 4,
      groupId: "BSLH01-R03:quartz-nth-summon-place-use",
    };
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ soulState: true });
    expect(effect.occurrenceGate).toEqual(expectedGate);
    expect(effect.timingScope).toEqual({
      player: "opponent",
      period: "main",
    });
    expect(effect.timing).toMatchObject({ event: "card_used" });
    expect(
      r03Def.effects!.filter((e) => e.timing.kind === "game_event")
    ).toHaveLength(1);
  });
});

describe("quartz-system ENGINE-target-count-expand-modifier Step1: BSLH01-TR02(A) 範囲（register_expand_effect_target_count CE 登録 + applicability.soulState）", () => {
  // 範囲: セット中、自分がトークンマジックの効果で相手のスピリット/アルティメット/
  // ネクサスを対象にするとき、ターンに1回、その対象を+1する。Step1 時点では CE 登録のみ
  // 検証する (対象数解決 target-resolution.ts resolveCount の消費側は未配線、Step2以降)。
  const tr02aDef = ALL_CARDS.find((c) => c.cardNo === "BSLH01-TR02(A)");
  if (!tr02aDef) throw new Error("BSLH01-TR02(A) not found in ALL_CARDS");
  const setEffectIndex = 2;
  const host10 = { ...hostDef, cardNo: "HOST10-TR02A" };
  const defs: Record<string, CardDefinition> = {
    "HOST10-TR02A": host10,
    "BSLH01-TR02(A)": tr02aDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];

  function base(options: { soulSet: boolean }): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(host10, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "host",
    });
    const tr02a = createCardInstance(tr02aDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "tr02a",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, tr02a],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["host"] } : p
      ),
    };
    if (options.soulSet) {
      s = setQuartz(
        s,
        {
          quartzInstanceId: "tr02a",
          hostInstanceId: "host",
          ownerPlayerId: ALICE,
          slot: "left",
        },
        getD
      )!;
    }
    return rebuildContinuousEffectsFromField(s, getD);
  }

  it("card-data DSL 形状: register_expand_effect_target_count + applicability.soulState", () => {
    const setEffect = tr02aDef.effects![setEffectIndex]!;
    expect(setEffect.applicability).toEqual({ soulState: true });
    expect(setEffect.steps[0]!.action).toMatchObject({
      kind: "register_expand_effect_target_count",
      player: "self",
      sourceFilter: { category: ["magic"], isToken: true },
      targetFilter: { category: ["spirit", "ultimate", "nexus"] },
      targetPlayer: "opponent",
      bonusAmount: 1,
      usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
    });
  });

  it("セット中: expand_effect_target_count CE が player-scoped で登録される", () => {
    const state = base({ soulSet: true });
    const ces = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "expand_effect_target_count"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.targetInstanceId).toBe(ALICE);
    expect(ces[0]?.actingPlayerId).toBe(ALICE);
    expect(ces[0]?.metadata).toMatchObject({
      sourceFilter: { category: ["magic"], isToken: true },
      targetFilter: { category: ["spirit", "ultimate", "nexus"] },
      targetPlayer: "opponent",
      bonusAmount: 1,
      usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
    });
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で CE 未登録", () => {
    const state = base({ soulSet: false });
    const ces = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "expand_effect_target_count"
    );
    expect(ces).toHaveLength(0);
  });

  it("expand_effect_target_count CE は recomputeAndRebuildContinuousEffects を跨いで生存する (targetInstanceId=playerId の player-scoped CE を card-id 検査で誤除去する pre-existing バグの回帰テスト、adversarial verifier round4 指摘)", () => {
    const state = base({ soulSet: true });
    const before = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "expand_effect_target_count"
    );
    expect(before).toHaveLength(1);

    const after = recomputeAndRebuildContinuousEffects(state, getD);
    const survived = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "expand_effect_target_count"
    );
    // 修正前は isPlayerScopedCETag allowlist 漏れにより 0 (誤除去→再登録の往復)。
    expect(survived).toHaveLength(1);
    expect(survived[0]?.targetInstanceId).toBe(ALICE);
  });

  describe("Step2: target-resolution.ts resolveTargetSpec (auto-resolve 経路) での消費", () => {
    const tokenMagicDef = makeDef({
      cardNo: "TOKEN-MAGIC-TR02A",
      name: "トークンマジック（テスト）",
      printedCategory: "magic",
      maxTokenDeckCount: 1, // isCardDefinitionToken の SSOT 判定用
    });
    const nonTokenMagicDef = makeDef({
      cardNo: "PLAIN-MAGIC-TR02A",
      name: "通常マジック（テスト）",
      printedCategory: "magic",
    });
    const opponentSpiritDef = makeDef({
      cardNo: "OPP-SPIRIT-TR02A",
      name: "相手スピリット（テスト）",
      printedCategory: "spirit",
    });

    function stateWithTargets(): GameState {
      const s = base({ soulSet: true });
      const tokenMagic = createCardInstance(tokenMagicDef, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: "token-magic",
      });
      const nonTokenMagic = createCardInstance(nonTokenMagicDef, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: "plain-magic",
      });
      const opp1 = createCardInstance(opponentSpiritDef, {
        ownerPlayerId: BOB,
        zone: "field",
        instanceId: "opp1",
      });
      const opp2 = createCardInstance(opponentSpiritDef, {
        ownerPlayerId: BOB,
        zone: "field",
        instanceId: "opp2",
      });
      const ally1 = createCardInstance(opponentSpiritDef, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: "ally1",
      });
      const ally2 = createCardInstance(opponentSpiritDef, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: "ally2",
      });
      return {
        ...s,
        cardInstances: [
          ...s.cardInstances,
          tokenMagic,
          nonTokenMagic,
          opp1,
          opp2,
          ally1,
          ally2,
        ],
      };
    }
    const getD2 = (id: string): CardDefinition | undefined =>
      ({
        ...defs,
        "TOKEN-MAGIC-TR02A": tokenMagicDef,
        "PLAIN-MAGIC-TR02A": nonTokenMagicDef,
        "OPP-SPIRIT-TR02A": opponentSpiritDef,
      })[id];

    it("トークンマジックの効果が相手スピリットを対象にするとき、count が+1される", () => {
      const state = stateWithTargets();
      const resolved = resolveTargetSpec({
        state,
        targetSpec: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic",
        getCardDefinitionById: getD2,
        stepContext: createStepExecutionContext(),
      });
      expect(resolved.map((c) => c.instanceId).sort()).toEqual([
        "opp1",
        "opp2",
      ]);
    });

    it("targetPlayer:opponent のため、トークンマジックの効果が自分のスピリットを対象にするとき (player:self) は bonus が乗らない (adversarial verifier 2026-07-20 round1 で検出した scope leak の回帰テスト)", () => {
      const state = stateWithTargets();
      const resolved = resolveTargetSpec({
        state,
        targetSpec: {
          kind: "filter",
          player: "self",
          filter: { category: ["spirit"] },
          count: 1,
        },
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic",
        getCardDefinitionById: getD2,
        stepContext: createStepExecutionContext(),
      });
      expect(resolved.map((c) => c.instanceId).sort()).toEqual(["ally1"]);
    });

    it("トークンマジックでない (isToken:false) 効果元では bonus は乗らない", () => {
      const state = stateWithTargets();
      const resolved = resolveTargetSpec({
        state,
        targetSpec: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
        actingPlayerId: ALICE,
        sourceInstanceId: "plain-magic",
        getCardDefinitionById: getD2,
        stepContext: createStepExecutionContext(),
      });
      expect(resolved).toHaveLength(1);
    });

    it("CE 未セット (魂状態でない) なら bonus は乗らない", () => {
      const state = { ...stateWithTargets() };
      const unsetState = base({ soulSet: false });
      const merged: GameState = {
        ...unsetState,
        cardInstances: [
          ...unsetState.cardInstances,
          ...state.cardInstances.filter(
            (c) =>
              !unsetState.cardInstances.some(
                (u) => u.instanceId === c.instanceId
              )
          ),
        ],
      };
      const resolved = resolveTargetSpec({
        state: merged,
        targetSpec: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic",
        getCardDefinitionById: getD2,
        stepContext: createStepExecutionContext(),
      });
      expect(resolved).toHaveLength(1);
    });

    describe("Step3: usageLimit(ターンに1回)の実消費記録", () => {
      it("bonus 適用時、stepContext.pendingExpandTargetCountUsage へ消費予約が push され、drain 後は同ターン内で bonus が乗らなくなる", () => {
        const state = stateWithTargets();
        const stepContext1 = createStepExecutionContext(state);
        const targetSpec = {
          kind: "filter" as const,
          player: "opponent" as const,
          filter: { category: ["spirit"] as const },
          count: 1,
        };
        const resolved1 = resolveTargetSpec({
          state,
          targetSpec,
          actingPlayerId: ALICE,
          sourceInstanceId: "token-magic",
          getCardDefinitionById: getD2,
          stepContext: stepContext1,
        });
        expect(resolved1).toHaveLength(2); // bonus 適用済み (+1)
        expect(stepContext1.pendingExpandTargetCountUsage).toHaveLength(1);
        const pending = stepContext1.pendingExpandTargetCountUsage![0]!;
        expect(pending.usageLimit).toMatchObject({
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        });

        // effect-interpreter.ts の step ループが行う drain を模擬する。
        const stateAfterUsage = recordEffectUsageIfLimited({
          state,
          sourceInstanceId: pending.sourceInstanceId,
          sourceDefinitionId: pending.sourceDefinitionId,
          effectLabel: "expand_effect_target_count",
          usageLimit: pending.usageLimit,
        });

        const stepContext2 = createStepExecutionContext(stateAfterUsage);
        const resolved2 = resolveTargetSpec({
          state: stateAfterUsage,
          targetSpec,
          actingPlayerId: ALICE,
          sourceInstanceId: "token-magic",
          getCardDefinitionById: getD2,
          stepContext: stepContext2,
        });
        expect(resolved2).toHaveLength(1); // 消費済みのため bonus なし
        expect(stepContext2.pendingExpandTargetCountUsage ?? []).toHaveLength(
          0
        );
      });

      it("effect-interpreter 統合: 1回目のトークンマジック破壊効果は+1体多く破壊し、同ターン2回目の別インスタンスは usageLimit 消費済みで+1が乗らない", () => {
        const state = stateWithTargets();
        const destroyEffect = {
          timing: { kind: "main" as const },
          steps: [
            {
              action: {
                kind: "destroy" as const,
                target: {
                  kind: "filter" as const,
                  player: "opponent" as const,
                  filter: { category: ["spirit"] as const },
                  count: 1,
                },
              },
            },
          ],
        };

        const result1 = executeEffect({
          chainId: "test:quartz-system:5358",
          state,
          effect: destroyEffect,
          sourceInstanceId: "token-magic",
          actingPlayerId: ALICE,
          getCardDefinitionById: getD2,
        });
        const destroyedAfterFirst = result1.cardInstances.filter(
          (c) => c.pendingLeaveKind !== null
        ).length;
        expect(destroyedAfterFirst).toBe(2); // bonus 適用で opp1/opp2 の2体破壊

        const tokenMagic2 = createCardInstance(tokenMagicDef, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "token-magic-2",
        });
        const opp3 = createCardInstance(opponentSpiritDef, {
          ownerPlayerId: BOB,
          zone: "field",
          instanceId: "opp3",
        });
        const opp4 = createCardInstance(opponentSpiritDef, {
          ownerPlayerId: BOB,
          zone: "field",
          instanceId: "opp4",
        });
        const state2: GameState = {
          ...result1,
          cardInstances: [...result1.cardInstances, tokenMagic2, opp3, opp4],
        };
        const result2 = executeEffect({
          chainId: "test:quartz-system:5389",
          state: state2,
          effect: destroyEffect,
          sourceInstanceId: "token-magic-2",
          actingPlayerId: ALICE,
          getCardDefinitionById: getD2,
        });
        const destroyedAmongNewTargets = result2.cardInstances.filter(
          (c) =>
            c.pendingLeaveKind !== null &&
            (c.instanceId === "opp3" || c.instanceId === "opp4")
        ).length;
        expect(destroyedAmongNewTargets).toBe(1); // 消費済みのため1体のみ破壊
      });
    });
  });

  describe("Step4: GUI 手動選択経路 (getResolvedMaxTargetCount / getStackTargetSelection) への配線", () => {
    const tokenMagicDef = makeDef({
      cardNo: "TOKEN-MAGIC-TR02A-S4",
      name: "トークンマジック（テスト・Step4）",
      printedCategory: "magic",
      maxTokenDeckCount: 1,
    });
    const opponentSpiritDef = makeDef({
      cardNo: "OPP-SPIRIT-TR02A-S4",
      name: "相手スピリット（テスト・Step4）",
      printedCategory: "spirit",
    });
    const getD4 = (id: string): CardDefinition | undefined =>
      ({
        ...defs,
        "TOKEN-MAGIC-TR02A-S4": tokenMagicDef,
        "OPP-SPIRIT-TR02A-S4": opponentSpiritDef,
      })[id];

    function soulSetStateWithSourceAndTargets(): GameState {
      const s = base({ soulSet: true });
      const tokenMagic = createCardInstance(tokenMagicDef, {
        ownerPlayerId: ALICE,
        zone: "field",
        instanceId: "token-magic-s4",
      });
      const opp1 = createCardInstance(opponentSpiritDef, {
        ownerPlayerId: BOB,
        zone: "field",
        instanceId: "opp1-s4",
      });
      const opp2 = createCardInstance(opponentSpiritDef, {
        ownerPlayerId: BOB,
        zone: "field",
        instanceId: "opp2-s4",
      });
      return {
        ...s,
        cardInstances: [...s.cardInstances, tokenMagic, opp1, opp2],
      };
    }

    it("getExpandEffectTargetCountBonusDeclarative: 登録済み action の targetCardFilter/candidateTargetPlayerScope がトークンマジック側の CE と重なるとき bonus を返す (GUI 候補数上限の楽観的見積り)", () => {
      const state = soulSetStateWithSourceAndTargets();
      const bonus = getExpandEffectTargetCountBonusDeclarative({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic-s4",
        registration: {
          targetCardFilter: { category: ["spirit"] },
          candidateTargetPlayerScope: "opponent",
        },
        getCardDefinitionById: getD4,
      });
      expect(bonus).toBe(1);
    });

    it("getExpandEffectTargetCountBonusDeclarative: candidateTargetPlayerScope が acting_player (自分対象) だと bonus は乗らない (targetPlayer:opponent の CE のため scope 不一致)", () => {
      const state = soulSetStateWithSourceAndTargets();
      const bonus = getExpandEffectTargetCountBonusDeclarative({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic-s4",
        registration: {
          targetCardFilter: { category: ["spirit"] },
          candidateTargetPlayerScope: "acting_player",
        },
        getCardDefinitionById: getD4,
      });
      expect(bonus).toBe(0);
    });

    it("getExpandEffectTargetCountBonusDeclarative: targetCardFilter の category が重ならない (CE の targetFilter は spirit/ultimate/nexus、registration 側が magic のみ) と bonus は乗らない", () => {
      const state = soulSetStateWithSourceAndTargets();
      const bonus = getExpandEffectTargetCountBonusDeclarative({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic-s4",
        registration: {
          targetCardFilter: { category: ["magic"] },
          candidateTargetPlayerScope: "opponent",
        },
        getCardDefinitionById: getD4,
      });
      expect(bonus).toBe(0);
    });

    it("getExpandEffectTargetCountBonusDeclarative: usageLimit(ターンに1回) 消費済みなら bonus は乗らない (読み取りゲートのみ、消費はしない)", () => {
      const state = soulSetStateWithSourceAndTargets();
      const ceEntry = state.activeContinuousEffects.find(
        (ce) => ce.modifierTag === "expand_effect_target_count"
      );
      if (!ceEntry) throw new Error("expand_effect_target_count CE not found");
      const usedState = recordEffectUsageIfLimited({
        state,
        sourceInstanceId: ceEntry.sourceInstanceId,
        sourceDefinitionId: ceEntry.sourceDefinitionId,
        effectLabel: "expand_effect_target_count",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
      });
      const bonus = getExpandEffectTargetCountBonusDeclarative({
        state: usedState,
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic-s4",
        registration: {
          targetCardFilter: { category: ["spirit"] },
          candidateTargetPlayerScope: "opponent",
        },
        getCardDefinitionById: getD4,
      });
      expect(bonus).toBe(0);

      // 読み取りゲートのみ（消費はしていない）ことの確認: 直接 usage 記録していない
      // 元の state では引き続き bonus が乗る。
      const bonusOnOriginal = getExpandEffectTargetCountBonusDeclarative({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic-s4",
        registration: {
          targetCardFilter: { category: ["spirit"] },
          candidateTargetPlayerScope: "opponent",
        },
        getCardDefinitionById: getD4,
      });
      expect(bonusOnOriginal).toBe(1);
    });

    it("手動選択 (preSelectedIds) 経路の実行時確定: resolveTargetSpec が bonus 分の usageLimit 消費予約を push する (Step2/3 の auto-resolve 経路と同じ意味論を manual 経路にも揃える)", () => {
      const state = soulSetStateWithSourceAndTargets();
      const stepContext = createStepExecutionContext(state);
      const resolved = resolveTargetSpec({
        state,
        targetSpec: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
        actingPlayerId: ALICE,
        sourceInstanceId: "token-magic-s4",
        getCardDefinitionById: getD4,
        stepContext,
        // GUI が既に2体選択済み (getResolvedMaxTargetCount による +1 込みの上限内選択)。
        preSelectedIds: ["opp1-s4", "opp2-s4"],
      });
      expect(resolved.map((c) => c.instanceId).sort()).toEqual([
        "opp1-s4",
        "opp2-s4",
      ]);
      // preSelectedIds 経路も auto-resolve 経路と同じく usageLimit 消費予約を push する。
      expect(stepContext.pendingExpandTargetCountUsage).toHaveLength(1);
    });

    it("標準アクション (destroy 等) の resolveTargets() 経由での手動選択確定でも usageLimit 消費予約が push される (adversarial verifier round1 lens2 指摘: resolveTargets は preSelectedIds ありのとき shouldGateFullPool=false で resolveTargetSpec の preSelectedIds 分岐を通るため applyActionTargetCount 自体の早期 return とは無関係に消費される)", () => {
      const state = soulSetStateWithSourceAndTargets();
      const stepContext = createStepExecutionContext(state);
      const destroyAction = {
        kind: "destroy" as const,
        target: {
          kind: "filter" as const,
          player: "opponent" as const,
          filter: { category: ["spirit"] as const },
          count: 1,
        },
      };
      const resolvedIds = resolveTargets(
        destroyAction,
        state,
        ALICE,
        "token-magic-s4",
        getD4,
        stepContext,
        ["opp1-s4", "opp2-s4"]
      );
      expect((resolvedIds ?? []).slice().sort()).toEqual([
        "opp1-s4",
        "opp2-s4",
      ]);
      expect(stepContext.pendingExpandTargetCountUsage).toHaveLength(1);
    });
  });
});
