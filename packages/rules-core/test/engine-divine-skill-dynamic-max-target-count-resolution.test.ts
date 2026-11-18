/**
 * ENGINE-divine-skill-dynamic-max-target-count-resolution:
 * 神技(divine skill) effects の対象選択で target.count = {min, max: DynamicCount} のとき、
 * max 側の DynamicCount ソース `cost_paid_this_effect` が常に 0 として解決され、
 * `costLimitedMaxTargetCount(0) < rawRequiredTargetCount` により getStackTargetSelection が
 * null を返して pendingEffectTargetSelection が一切開かず、min 分のみが機械選択される
 * (max 超過分は選択機会自体を与えられない) バグの repro。
 *
 * root cause: stack-target-resolution.ts の createCountBoundResolver は
 * StepExecutionContext.costPaidThisEffect を設定しないため「支払ったコア」が
 * 常に未定義=0 になっていた。窓後に支払いを確定し、その個数を
 * ActiveStack.divineSkillCoreCost から costPaidThisEffect として渡す。
 *
 * BSTH11-X01「減らしたコア2個につき、...1つを手札/手元に戻せる」型を最小合成テストカードで再現する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const SPIRIT: CardDefinition = {
  cardNo: "TEST-DIVINE-SKILL-BOUNCE-SPIRIT",
  name: "テストスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

// 「減らしたコア2個につき、自分のスピリット1つを手札に戻せる (最大 floor(支払コア/2) 体)」型。
const NEXUS: CardDefinition = {
  cardNo: "TEST-DIVINE-SKILL-BOUNCE-NEXUS",
  name: "テスト創界神(範囲神技バウンス)",
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
                action: {
                  kind: "bounce",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: { category: ["spirit"] },
                    count: {
                      min: 1,
                      max: {
                        source: { kind: "cost_paid_this_effect" },
                        divisor: 2,
                      },
                    },
                  },
                  destination: "hand",
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
  id === NEXUS.cardNo ? NEXUS : id === SPIRIT.cardNo ? SPIRIT : undefined;

function baseState(normalCoreCount: number): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const nexus = createCardInstance(NEXUS, {
    instanceId: "nexus-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount,
  });
  const spirit1 = createCardInstance(SPIRIT, {
    instanceId: "spirit-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    level: 1,
    normalCoreCount: 0,
  });
  const spirit2 = createCardInstance(SPIRIT, {
    instanceId: "spirit-2",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    level: 1,
    normalCoreCount: 0,
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [nexus, spirit1, spirit2],
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
  return current;
}

describe("ENGINE-divine-skill-dynamic-max-target-count-resolution: max超過分のdestination解決", () => {
  it("コア4個支払い(max=2)で候補2体とも手札へ戻る", () => {
    const state = baseState(4);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
    const declare = actions[0];

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    let current = passStackUntilClosed(declared.state);
    expect(current.pendingEffectTargetSelection).toBeNull();
    expect(current.cardInstances[0]!.normalCoreCount).toBe(4);
    const payment = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_core_source_allocation");
    expect(payment).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: payment!,
      getCardDefinitionById,
      coreSourceAllocations: { "nexus-1": 4 },
    }).state;
    expect(current.cardInstances[0]!.normalCoreCount).toBe(0);

    // pendingEffectTargetSelection が開けば、要求数(min=1)分だけ選び maxまで追加選択できる。
    if (current.pendingEffectTargetSelection) {
      const pending = current.pendingEffectTargetSelection;
      const targetActions = getLegalActions({
        state: current,
        actingPlayerId: pending.actingPlayerId,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const chosen = targetActions.find(
        (a) => a.kind === "resolve_pending_effect_target"
      );
      expect(chosen, "resolve_pending_effect_target action").toBeDefined();
      expect(
        (chosen as { maxTargetCount?: number }).maxTargetCount,
        "resolved maxTargetCount"
      ).toBe(2);
      current = applyLegalAction({
        state: current,
        action: chosen!,
        getCardDefinitionById,
        targetInstanceIds: pending.candidateInstanceIds,
      }).state;
    }

    const spirit1 = current.cardInstances.find(
      (c) => c.instanceId === "spirit-1"
    )!;
    const spirit2 = current.cardInstances.find(
      (c) => c.instanceId === "spirit-2"
    )!;
    expect(spirit1.zone, "spirit-1 zone").toBe("hand");
    expect(spirit2.zone, "spirit-2 zone").toBe("hand");
  });
});
