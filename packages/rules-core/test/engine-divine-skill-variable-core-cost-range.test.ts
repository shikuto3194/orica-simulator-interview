/**
 * ENGINE-divine-skill-variable-core-cost-range:
 * DivineSkillEntry.coreCost が固定 number ではなく範囲 (`{min,max}`) のとき、窓後に
 * min~max の任意整数値をプレイヤーが選べる primitive の検証（BSTH11-X01「【神技：2～6】」型、
 * 裁定2026-08-03 needs-ruling.jsonl 案B: 連続範囲・全整数値選択可）。
 *
 * 「減らしたコアN個につき1回」型のスケールは、宣言額を deferred 解決 (`resolveDeferredDivineSkillStack`)
 * が `costPaidThisEffect` として `executeEffect` へ渡すことで、既存の
 * `DynamicCount.cost_paid_this_effect` + `divisor`(既存 primitive, target-resolution.ts)
 * だけで表現できる。専用フィールドは追加しない。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import { coreSourceAllocationChoices } from "../src/action-input-choices";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

// 「【神技：2～6】〔このネクサスのコアを-2~-6する〕減らしたコア2個につき、カウントを+1する」型
// (BSTH11-X01 相当) の合成テストカード。coreCost は範囲 {min:2, max:6}。
const NEXUS: CardDefinition = {
  cardNo: "TEST-DIVINE-SKILL-CORE-COST-RANGE-NEXUS",
  name: "テスト創界神(範囲神技)",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
    divineSkills: [
      {
        label: "divine_skill",
        coreCost: { min: 2, max: 6 },
        timing: "main",
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: { kind: "count_increase", player: "self", amount: 1 },
                // 基本1回 + additional 回。additional = floor(支払コア/2) - 1
                // → 総実行回数 = floor(支払コア/2)（「減らしたコア2個につき1回」端数切り捨て）。
                repeat: {
                  additional: {
                    source: { kind: "cost_paid_this_effect" },
                    divisor: 2,
                    offset: -1,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  },
};

const getCardDefinitionById = (id: string) =>
  id === NEXUS.cardNo ? NEXUS : undefined;

function baseState(normalCoreCount: number): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const nexus = createCardInstance(NEXUS, {
    instanceId: "nexus-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount,
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [nexus],
  };
}

/** 開いたスタック窓を responder のパスで閉じ、deferred 解決まで進める。 */
function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find((a) => a.kind === "pass_stack");
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById,
    }).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

describe("ENGINE-divine-skill-variable-core-cost-range: 神技コア消費数の範囲選択", () => {
  function pay(state: GameState, amount: number): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      coreSourceAllocations: { "nexus-1": amount },
    }).state;
  }

  it("コア4個でも宣言は1件で、応答後に2～4個の支払いを選ぶ", () => {
    const state = baseState(4);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
    const declared = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById,
    }).state;
    expect(declared.pendingCoreSourceAllocation).toBeNull();
    expect(declared.cardInstances[0]!.normalCoreCount).toBe(4);
    const choosing = passStackUntilClosed(declared);
    expect(choosing.pendingCoreSourceAllocation).toMatchObject({
      minimumTotal: 2,
      requiredTotal: 4,
    });
    expect(choosing.cardInstances[0]!.normalCoreCount).toBe(4);
    for (const amount of [0, 1, 5, 1.5])
      expect(() => pay(choosing, amount)).toThrow();
    const choiceAction = getLegalActions({
      state: choosing,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    if (choiceAction.kind !== "resolve_core_source_allocation")
      throw new Error("payment action");
    expect(
      coreSourceAllocationChoices(choiceAction, 20).values.map(
        (choice) => choice.coreSourceAllocations?.["nexus-1"]
      )
    ).toEqual([2, 3, 4]);
    for (const amount of [2, 3, 4]) {
      const paid = pay(choosing, amount);
      expect(paid.cardInstances[0]!.normalCoreCount).toBe(4 - amount);
      expect(paid.players[0]!.countValue).toBe(Math.floor(amount / 2));
    }
  });

  it("legal action 生成: コア0個ではmin(2)未満のため神技を宣言できない", () => {
    const state = baseState(1);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(0);
  });

  it.each(["nullified", "source-left", "insufficient"])(
    "応答後の%sでは支払いや効果を実行しない",
    (reason) => {
      const state = baseState(6);
      const action = getAvailableDivineSkillLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      })[0]!;
      const declared = applyLegalAction({
        state,
        action,
        getCardDefinitionById,
      }).state;
      if (reason === "nullified")
        declared.stackWindow!.pendingStackAction!.isNullified = true;
      if (reason === "source-left") declared.cardInstances[0]!.zone = "hand";
      if (reason === "insufficient")
        declared.cardInstances[0]!.normalCoreCount = 1;
      const after = passStackUntilClosed(declared);
      expect(after.pendingCoreSourceAllocation).toBeNull();
      expect(after.cardInstances[0]!.normalCoreCount).toBe(
        reason === "insufficient" ? 1 : 6
      );
      expect(after.players[0]!.countValue).toBe(0);
    }
  );

  it("応答中に減ったコア数でHUD上限を再計算する", () => {
    const state = baseState(6);
    const action = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    })[0]!;
    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
    }).state;
    declared.cardInstances[0]!.normalCoreCount = 3;
    const choosing = passStackUntilClosed(declared);
    expect(choosing.pendingCoreSourceAllocation).toMatchObject({
      minimumTotal: 2,
      requiredTotal: 3,
    });
    expect(() => pay(choosing, 4)).toThrow();
    expect(pay(choosing, 3).players[0]!.countValue).toBe(1);
  });

  it("実行: 偶数6個を支払うと3回発揮され、カウントが+3される", () => {
    const state = baseState(6);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const declare = actions[0];
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(declared.state.stackWindow).not.toBeNull();

    const finalState = pay(passStackUntilClosed(declared.state), 6);

    const nexusAfter = finalState.cardInstances.find(
      (c) => c.instanceId === "nexus-1"
    )!;
    expect(nexusAfter.normalCoreCount).toBe(0);
    expect(finalState.players.find((p) => p.id === ALICE)!.countValue).toBe(3);
  });

  it("実行: 奇数3個を支払うと端数切り捨てで1回のみ発揮され、カウントが+1される", () => {
    const state = baseState(3);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const declare = actions[0];
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    const finalState = pay(passStackUntilClosed(declared.state), 3);

    const nexusAfter = finalState.cardInstances.find(
      (c) => c.instanceId === "nexus-1"
    )!;
    expect(nexusAfter.normalCoreCount).toBe(0);
    expect(finalState.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });

  it("実行: 最小2個を支払うと1回のみ発揮され、カウントが+1される", () => {
    const state = baseState(2);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const declare = actions.find((a) => a.coreCost === 2);
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    const finalState = pay(passStackUntilClosed(declared.state), 2);

    expect(finalState.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });
});
