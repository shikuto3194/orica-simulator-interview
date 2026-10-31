/**
 * BSLH01-X01「[導界者]キーア」【導技：7】Lv2『自分のアタックステップ終了時』:
 * 「〔ターンに1回：同名〕〔このネクサスのコア-7する〕自分のスピリットが4体になるまで、
 * 手札/トラッシュの系統：「S.S.S」を持つスピリットカードをコストを支払わずに自分の
 * スピリット/アルティメットのコアを0個にせずに召喚できる。このステップ終了後、
 * 自分は、リフレッシュステップとアタックステップを1回ずつ行える。」
 *
 * 「終了時」節は DivineSkillTiming.subPhase=end と step_end 窓で限定する。
 * grant_extra_steps の GameState.pendingExtraSteps を advanceStep が消費する。
 * 召喚 count は BSLH01-X04【ソウルドライブ・S】と同型の動的上限
 * (multiplier:-1, offset:4 = 「4 − 現在フィールドスピリット数」)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import { advanceStep } from "../src/turn-system";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const X01 = card("BSLH01-X01");
// BSLH01-C01: printedCategory:"spirit", tribe:"CB・S.S.S" (X04 test fixture と同型)。
const C01 = card("BSLH01-C01");
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const noTriggeredLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

function skill() {
  return X01.grandwalkerData!.divineSkills![1]!;
}

/** 開いたスタック窓を responder のパスで閉じる (BSLH01-X02 divine skill test と同型)。 */
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
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

describe("BSLH01-X01 【導技：7】: divineSkills(guided_skill) + free summon(up to 4) + grant_extra_steps", () => {
  it("通常のアタックステップでは導技7を提示せず、ステップを終えると終了時窓に提示する", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(X01, {
          instanceId: "x01",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 7,
        }),
      ],
    });
    state.step = "attack";
    const actions = (s: GameState) =>
      getAvailableDivineSkillLegalActions({
        state: s,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => undefined,
      });
    expect(actions(state).some((a) => a.skillIndex === 1)).toBe(false);
    const ended = advanceStep(state, getCardDefinitionById, noTriggeredLookup);
    expect(ended.step).toBe("attack");
    expect(ended.window).toBe("step_end");
    expect(actions(ended).some((a) => a.skillIndex === 1)).toBe(true);
  });
  it("card-data: coreCost=7 / timing={step:attack,whose:own} / Lv2 / ターン1回:同名、steps は free summon → grant_extra_steps", () => {
    const s = skill();
    expect(s.label).toBe("guided_skill");
    expect(s.coreCost).toBe(7);
    expect(s.timing).toEqual({ step: "attack", whose: "own", subPhase: "end" });
    expect(s.minLevel).toBe(2);
    expect(s.maxLevel).toBe(2);
    expect(s.turnLimit).toBe("once_per_name");

    const steps = s.effects![0]!.steps;
    expect(steps).toHaveLength(2);

    const summon = steps[0]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind !== "summon") throw new Error("unreachable");
    expect(summon.costModifier).toBe("free");
    expect(summon.target).toEqual({
      kind: "from_zone",
      zone: ["hand", "trash"],
      filter: { category: ["spirit"], tribes: ["S.S.S"] },
      count: {
        min: 0,
        max: {
          source: {
            kind: "cards_in_zone",
            zone: "field",
            player: "self",
            filter: { category: ["spirit"] },
          },
          multiplier: -1,
          offset: 4,
        },
      },
    });

    // 原文「行える」= 任意 (project_kuwaerareru_optional)。強制実行にしない。
    expect(steps[1]!.executionMode).toBe("optional");
    const grantSteps = steps[1]!.action;
    expect(grantSteps).toEqual({
      kind: "grant_extra_steps",
      steps: ["refresh", "attack"],
    });
  });

  it("実行: 自分のスピリットが4体になるまで手札/トラッシュのS.S.Sを無償召喚し、リフレッシュ+アタックステップを挿入する", () => {
    const x01Instance = createCardInstance(X01, {
      instanceId: "x01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 7,
    });
    const ally1 = createCardInstance(C01, {
      instanceId: "ally-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      // Lv1 requiredCores:1 未満は state-based action で消滅する。
      normalCoreCount: 1,
    });
    const hand1 = createCardInstance(C01, {
      instanceId: "sss-hand-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const hand2 = createCardInstance(C01, {
      instanceId: "sss-hand-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const trash1 = createCardInstance(C01, {
      instanceId: "sss-trash-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });

    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      window: "step_end",
      cardInstances: [x01Instance, ally1, hand1, hand2, trash1],
    };

    // 実プレイ経路: use_divine_skill 宣言 → 相手 pass でスタック窓解決 →
    // resolve_pending_effect_target で対象選択 (BSLH01-X04 board test と同型、
    // 単体 step 抽出の近道実行ではなく宣言〜対象選択〜解決までの実パイプラインを通す)。
    const declareActions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const declare = declareActions.find(
      (a) => a.sourceInstanceId === "x01" && a.skillIndex === 1
    );
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(declared.state.stackWindow).not.toBeNull();

    const afterStack = passStackUntilClosed(declared.state);

    // 既存フィールドスピリット1体 → 残り3体分 (4-1) の選択待ち。
    const resolveTargetAction = getLegalActions({
      state: afterStack,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTargetAction).toBeDefined();
    expect(
      (resolveTargetAction as { maxTargetCount?: number }).maxTargetCount
    ).toBe(3);

    const resolved = applyLegalAction({
      state: afterStack,
      action: resolveTargetAction!,
      targetInstanceIds: ["sss-hand-1", "sss-hand-2", "sss-trash-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });

    const placementAction = getLegalActions({
      state: resolved.state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    const afterSummon = applyLegalAction({
      state: resolved.state,
      action: placementAction!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "sss-hand-1",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "sss-hand-2",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "sss-trash-1",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
    const x01AfterCost = afterSummon.cardInstances.find(
      (c) => c.instanceId === "x01"
    )!;
    expect(x01AfterCost.normalCoreCount).toBe(0);
    for (const id of ["sss-hand-1", "sss-hand-2", "sss-trash-1"]) {
      const c = afterSummon.cardInstances.find((x) => x.instanceId === id)!;
      expect(c.zone).toBe("field");
    }
    const fieldSpirits = afterSummon.cardInstances.filter(
      (c) =>
        c.zone === "field" &&
        c.controllerPlayerId === ALICE &&
        cardNoMap.get(c.definitionId)?.printedCategory === "spirit"
    );
    expect(fieldSpirits).toHaveLength(4);

    // grant_extra_steps step は executionMode:"optional" のため自動継続せず、
    // execute/decline の pending choice が開く (原文「行える」= 任意)。
    const optionalChoiceActions = getLegalActions({
      state: afterSummon,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).filter(
      (a) => a.kind === "resolve_pending_step_optional_choice"
    ) as Array<{ choice: "execute" | "decline" } & Record<string, unknown>>;
    const executeChoice = optionalChoiceActions.find(
      (a) => a.choice === "execute"
    );
    const declineChoice = optionalChoiceActions.find(
      (a) => a.choice === "decline"
    );
    expect(executeChoice).toBeDefined();
    expect(declineChoice).toBeDefined();
    expect(afterSummon.pendingExtraSteps ?? []).toEqual([]);

    // decline: 追加ステップを取らない選択でも pendingExtraSteps は積まれない。
    const declined = applyLegalAction({
      state: afterSummon,
      action: declineChoice as never,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(declined.state.pendingExtraSteps ?? []).toEqual([]);

    // execute: リフレッシュ+アタックステップの挿入キューが積まれる。
    const executed = applyLegalAction({
      state: afterSummon,
      action: executeChoice as never,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(executed.state.pendingExtraSteps).toEqual(["refresh", "attack"]);
  });
});

describe("ENGINE-extra-turn-step-insertion primitive: pendingExtraSteps を advanceStep が消費する", () => {
  it("attack ステップ終了時に pendingExtraSteps=[refresh,attack] があれば、main を挟まず refresh→attack→end の順に進行する", () => {
    const src = createCardInstance(card("BSLH01-C01"), {
      instanceId: "exhausted-src",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "exhausted",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      turnNumber: 2,
      step: "attack",
      window: "none",
      cardInstances: [src],
      pendingExtraSteps: ["refresh", "attack"],
    };

    const step1 = advanceStep(state, getCardDefinitionById, noTriggeredLookup);
    expect(step1.step).toBe("refresh");
    expect(step1.pendingExtraSteps).toEqual([]);
    expect(step1.stepContinuation).toEqual(["attack", "end"]);
    // 挿入されたリフレッシュステップも通常のリフレッシュ処理 (疲労回復) を受ける。
    expect(
      step1.cardInstances.find((c) => c.instanceId === "exhausted-src")!
        .exhaustState
    ).toBe("recovered");

    const step2 = advanceStep(step1, getCardDefinitionById, noTriggeredLookup);
    // main を挟まず、挿入キューの次要素である attack へ直接進む。
    expect(step2.step).toBe("attack");
    expect(step2.pendingExtraSteps).toEqual([]);

    const step3 = advanceStep(step2, getCardDefinitionById, noTriggeredLookup);
    // キューが尽きたので通常の STEP_ORDER 計算へ復帰し、end ステップへ進む。
    expect(step3.step).toBe("end");
  });
});
