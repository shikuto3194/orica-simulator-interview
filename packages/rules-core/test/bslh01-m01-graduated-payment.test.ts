/**
 * BSLH01-M01「[碧の軌跡]リーシャ・マオ」effects[1] graduated/tiered payment 検証。
 *
 * カード text (Lv1-3 フラッシュ『お互いのアタックステップ』):
 *   「3コストまで支払うことで、支払ったコストにより以下の効果を発揮する。
 *    1コスト以上：支払ったコスト1につき、相手のスピリット/アルティメットのコア1個をリザーブに置く。
 *    2コスト以上：相手の創界神ネクサス1つのコアすべてをボイドに置く。
 *    3コスト：〔ターンに1回：同名〕このスピリットを手札に戻し、
 *    自分のトラッシュにある系統：「CB」を持つカード1枚を手札に戻す。」
 *
 * 実装: choice を steps[0] のみに置く固定4分岐 (choiceIndex 0=支払わない/1/2/3=Nコスト支払う)。
 * 「N以上」は ref_choice.not の合成 (choiceIndex に一致しない) で閾値ゲートを組む
 * (BSSL01-T01 の RequiredDiscardCost pre-gate と同型の requiredPayCostAmount 自動 pre-gate)。
 * P3-62-koumakan-end-to-end.test.ts (BSTH01-R21 同型 timing:{kind:"activated",mode:"flash"})
 * と同じ end-to-end パターンで盤面変化を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";
import { applyPendingStepChoiceAction } from "../src/legal/pending-action-handlers";

const M01原本 = ALL_CARDS.find((c) => c.cardNo === "BSLH01-M01")!;
// timingScope（『お互いのアタックステップ』）を外し main step で起動可能にする
// (P3-62-koumakan-end-to-end.test.ts と同じ簡略化。timingScope 自体の検証は別関心事)。
const M01: CardDefinition = {
  ...M01原本,
  effects: M01原本.effects?.map((e, i) =>
    i === 1 ? { ...e, timingScope: undefined } : e
  ),
};

const 対戦相手スピリット = ALL_CARDS.find(
  (c) =>
    c.printedCategory === "spirit" &&
    c.grandwalkerData == null &&
    (c.levelDefs?.[0]?.bp ?? 0) > 0
)!;

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
cardNoMap.set(M01.cardNo, M01);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const TEST_CARDS = ALL_CARDS.map((c) => (c.cardNo === M01.cardNo ? M01 : c));

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
};

function buildScenario(options: {
  aliceReserve: number;
  oppCores: number;
}): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ reserveNormalCoreCount: options.aliceReserve }, {}],
  });
  const m01 = createCardInstance(M01, {
    instanceId: "m01-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    level: 1,
    normalCoreCount: 1,
  });
  const oppSpirit = createCardInstance(対戦相手スピリット, {
    instanceId: "opp-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: options.oppCores,
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [m01, oppSpirit],
  };
}

function findM01Flash(
  state: GameState,
  choiceIndex: number,
  sourceInstanceId = "m01-1"
): Extract<LegalAction, { kind: "use_field_card_effect" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...effectLookups,
  });
  const action = actions.find(
    (a): a is Extract<LegalAction, { kind: "use_field_card_effect" }> =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === sourceInstanceId &&
      a.registrationIndex === 0 &&
      a.choiceIndex === undefined &&
      (a.deferredChoiceIndexes ?? []).includes(choiceIndex)
  );
  if (!action) {
    throw new Error(
      `expected use_field_card_effect(choiceIndex=${choiceIndex}) for m01 to be legal`
    );
  }
  return action;
}

function findAllM01FlashChoiceIndexes(
  state: GameState,
  sourceInstanceId = "m01-1"
): number[] {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...effectLookups,
  });
  const declarations = actions.filter(
    (a): a is Extract<LegalAction, { kind: "use_field_card_effect" }> =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === sourceInstanceId &&
      a.registrationIndex === 0
  );
  expect(declarations).toHaveLength(1);
  expect(declarations[0]?.choiceIndex).toBeUndefined();
  return [...(declarations[0]?.deferredChoiceIndexes ?? [])].sort(
    (a, b) => a - b
  );
}

function passUntilStackClosed(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 8 && cur.stackWindow !== null; i++) {
    const priority = cur.stackWindow.priorityPlayerId;
    const turn = getLegalActions({
      state: cur,
      actingPlayerId: priority,
      getCardDefinitionById,
      ...effectLookups,
    });
    const pass = turn.find((a) => a.kind === "pass_stack");
    if (!pass) break;
    cur = applyLegalAction({
      state: cur,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return cur;
}

/**
 * 効果解決に伴って積まれる未セットのバースト確認/誘発を消化する。
 * 宣言可能性の確認は、これらの必須割り込みを通過した通常の優先権へ戻してから行う。
 */
function drainPostResolutionPendings(state: GameState): GameState {
  let cur = state;
  for (let guard = 0; guard < 16; guard++) {
    let progressed = false;
    for (const actingPlayerId of ["alice", "bob"]) {
      const action = getLegalActions({
        state: cur,
        actingPlayerId,
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (candidate) =>
          candidate.kind === "decline_pending_burst_check" ||
          candidate.kind === "resolve_pending_burst_check" ||
          candidate.kind === "resolve_pending_triggered_effect"
      );
      if (!action) continue;
      cur = applyLegalAction({
        state: cur,
        action,
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) return cur;
  }
  throw new Error("post-resolution pending drain exceeded guard");
}

function payPendingCost(state: GameState): GameState {
  if (state.pendingCoreSourceAllocation) {
    const required = state.pendingCoreSourceAllocation.requiredTotal;
    const payment = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_core_source_allocation");
    expect(payment).toBeDefined();
    expect(
      state.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBeGreaterThanOrEqual(required);
    state = applyLegalAction({
      state,
      action: payment!,
      coreSourceAllocations: { reserve: required },
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(state.pendingCoreSourceAllocation).toBeNull();
  }
  return state;
}

function declareAndResolveM01Choice(
  state: GameState,
  choiceIndex: number,
  targetInstanceIds?: string[],
  sourceInstanceId = "m01-1"
): GameState {
  const declaration = findM01Flash(state, choiceIndex, sourceInstanceId);
  const declared = applyLegalAction({
    state,
    action: declaration,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
  expect(declared.pendingStepChoice).toBeNull();

  const afterStack = passUntilStackClosed(declared);
  expect(
    afterStack.pendingStepChoice?.choices.map((choice) => choice.choiceIndex)
  ).toEqual(expect.arrayContaining([choiceIndex]));
  const choosingPlayerId = afterStack.pendingStepChoice!.choosingPlayerId;
  const choiceAction = getLegalActions({
    state: afterStack,
    actingPlayerId: choosingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  }).find(
    (
      action
    ): action is Extract<
      LegalAction,
      { kind: "resolve_pending_step_choice" }
    > =>
      action.kind === "resolve_pending_step_choice" &&
      action.choiceIndex === choiceIndex
  );
  expect(choiceAction).toBeDefined();
  expect(choiceAction?.sourceDefinitionId).toBe("BSLH01-M01");
  let afterChoice = applyLegalAction({
    state: afterStack,
    action: choiceAction!,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
  afterChoice = payPendingCost(afterChoice);
  if (targetInstanceIds === undefined) {
    return afterChoice;
  }
  const pendingTarget = afterChoice.pendingEffectTargetSelection;
  expect(pendingTarget).not.toBeNull();
  const targetAction = getLegalActions({
    state: afterChoice,
    actingPlayerId: pendingTarget!.actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  }).find(
    (
      action
    ): action is Extract<
      LegalAction,
      { kind: "resolve_pending_effect_target" }
    > => action.kind === "resolve_pending_effect_target"
  );
  expect(targetAction).toBeDefined();
  return payPendingCost(
    applyLegalAction({
      state: afterChoice,
      action: targetAction!,
      targetInstanceIds,
      getCardDefinitionById,
      ...effectLookups,
    }).state
  );
}

describe("BSLH01-M01 graduated payment (choice 4分岐 + ref_choice not合成)", () => {
  it.each([
    { mode: "flash", reserve: 0, payable: false },
    { mode: "stack", reserve: 0, payable: true },
    { mode: "flash", reserve: 1, payable: true },
    {
      mode: "flash",
      reserve: 0,
      payable: true,
      overrideMode: "stack" as const,
    },
  ])(
    "窓後choiceは $mode 制限とreserve=$reserveを再評価する ($overrideMode)",
    ({ mode, reserve, payable, overrideMode }) => {
      const initial = buildScenario({ aliceReserve: reserve, oppCores: 3 });
      const declared = applyLegalAction({
        state: initial,
        action: findM01Flash(initial, 1),
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      const afterStack = passUntilStackClosed(declared);
      const staleChoice = getLegalActions({
        state: afterStack,
        actingPlayerId: "alice",
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_step_choice" &&
          action.choiceIndex === 1
      )!;
      expect(staleChoice).toBeDefined();
      const restricted: GameState = {
        ...afterStack,
        ...(overrideMode
          ? {
              pendingStepChoice: {
                ...afterStack.pendingStepChoice!,
                continuation: {
                  ...afterStack.pendingStepChoice!.continuation,
                  resumeEffectOverride: {
                    ...M01.effects![1]!,
                    timing: { kind: "activated", mode: overrideMode },
                  },
                },
              },
            }
          : {}),
        activeContinuousEffects: [
          ...afterStack.activeContinuousEffects,
          {
            effectId: "choice-field-payment-restriction",
            sourceDefinitionId: 対戦相手スピリット.cardNo,
            sourceInstanceId: "opp-1",
            actingPlayerId: "bob",
            targetInstanceId: "alice",
            duration: { scope: "permanent" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "restrict_field_cost_payment",
            metadata: { effectModes: [mode] },
          },
        ],
      };
      const choices = getLegalActions({
        state: restricted,
        actingPlayerId: "alice",
        getCardDefinitionById,
        ...effectLookups,
      }).filter((action) => action.kind === "resolve_pending_step_choice");
      expect(choices.some((action) => action.choiceIndex === 1)).toBe(payable);
      expect(choices.some((action) => action.choiceIndex === 0)).toBe(true);
      const options = {
        state: restricted,
        action: staleChoice,
        getCardDefinitionById,
        ...effectLookups,
      };
      if (!payable) {
        const before = structuredClone(restricted);
        expect(() => applyLegalAction(options)).toThrow();
        expect(() => applyPendingStepChoiceAction(options)).toThrow(
          /not available/
        );
        expect(restricted).toEqual(before);
      } else {
        const resolved = applyLegalAction(options).state;
        // 許可された分岐は窓後の対象選択へ進む。支払いはその後に行う。
        expect(resolved.pendingStepChoice).toBeNull();
        expect(resolved.pendingEffectTargetSelection).not.toBeNull();
      }
    }
  );

  it("構造: steps[0] が choiceIndex 0/1/2/3 の4分岐、pay_cost amount 1/2/3", () => {
    const eff = M01原本.effects![1]!;
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.stub).toBeUndefined();
    const choiceStep = eff.steps[0]!;
    expect(choiceStep.id).toBe("m01-pay-choice");
    expect(choiceStep.action.kind).toBe("noop");
    expect(choiceStep.choice).toHaveLength(3);
    const amounts = choiceStep.choice!.map((v) =>
      v.action.kind === "pay_cost" ? v.action.amount : undefined
    );
    expect(amounts).toEqual([1, 2, 3]);
  });

  it("reserve=0でも場の1コアで払える1コスト以下の choice だけを宣言候補にする", () => {
    const state = buildScenario({ aliceReserve: 0, oppCores: 3 });
    const available = findAllM01FlashChoiceIndexes(state);
    expect(available).toEqual([0, 1]);
  });

  it("reserve=1 と場の1コアでは 2コスト以下の choice だけを宣言候補にする", () => {
    const state = buildScenario({ aliceReserve: 1, oppCores: 3 });
    const available = findAllM01FlashChoiceIndexes(state);
    expect(available).toEqual([0, 1, 2]);
  });

  it("継続 choice 中に発生源が観測から離れても、legal action は定義 ID を保持する", () => {
    const initial = buildScenario({ aliceReserve: 3, oppCores: 2 });
    const declared = applyLegalAction({
      state: initial,
      action: findM01Flash(initial, 1),
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const afterStack = passUntilStackClosed(declared);
    expect(afterStack.pendingStepChoice?.sourceDefinitionId).toBe("BSLH01-M01");

    // 盤面から既に離れた sourceInstanceId には観測カードが無い。effect-debug の
    // resolve_pending_step_choice と同じ状況でも、replay/coverage 用の provenance は
    // pending に保存済みの sourceDefinitionId から取得できなければならない。
    const sourceLeftField = {
      ...afterStack,
      cardInstances: afterStack.cardInstances.filter(
        (card) => card.instanceId !== "m01-1"
      ),
    };
    const action = getLegalActions({
      state: sourceLeftField,
      actingPlayerId: afterStack.pendingStepChoice!.choosingPlayerId,
      getCardDefinitionById,
      ...effectLookups,
    }).find(
      (
        candidate
      ): candidate is Extract<
        LegalAction,
        { kind: "resolve_pending_step_choice" }
      > =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === 1
    );

    expect(action).toMatchObject({
      sourceInstanceId: "m01-1",
      sourceDefinitionId: "BSLH01-M01",
      effectIndex: 1,
      stepIndex: 0,
    });
  });

  it("choiceIndex=1 (1コスト支払い): 相手のコア1個を相手のリザーブへ、2/3コスト段の効果は発火しない", () => {
    const initial = buildScenario({ aliceReserve: 5, oppCores: 1 });
    const resolved = declareAndResolveM01Choice(initial, 1, ["opp-1"]);

    const oppAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    )!;
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    const m01After = resolved.cardInstances.find(
      (c) => c.instanceId === "m01-1"
    )!;

    // 相手のコア1個は相手のリザーブへ。自分は指定1コストを支払う。
    expect(oppAfter.normalCoreCount).toBe(0);
    expect(aliceAfter.reserveNormalCoreCount).toBe(4);
    expect(aliceAfter.trashNormalCoreCount).toBe(1);

    // 1コストのみ支払いのため、このカード自身は手札に戻らずフィールドに残る。
    expect(m01After.zone).toBe("field");
  });

  it("choiceIndex=2 (2コスト支払い、境界値): コアシュート2回+創界神ネクサス全ボイド、3コスト限定効果(bounce/CB戻し)は発火しない", () => {
    const 創界神ネクサス = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "nexus" &&
        c.grandwalkerData?.kind === "grandwalker"
    )!;
    const CBカード = ALL_CARDS.find(
      (c) => c.cardNo === "BSLH01-C02" && c.tribe?.includes("CB")
    )!;

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });
    const m01 = createCardInstance(M01, {
      instanceId: "m01-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 1,
      normalCoreCount: 1,
    });
    const oppSpirit = createCardInstance(対戦相手スピリット, {
      instanceId: "opp-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const oppGW = createCardInstance(創界神ネクサス, {
      instanceId: "opp-gw-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const cbInTrash = createCardInstance(CBカード, {
      instanceId: "cb-trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const initial: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [m01, oppSpirit, oppGW, cbInTrash],
    };

    const resolved = declareAndResolveM01Choice(initial, 2);

    const oppSpiritAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    )!;
    const oppGWAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-gw-1"
    )!;
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    const m01After = resolved.cardInstances.find(
      (c) => c.instanceId === "m01-1"
    )!;
    const cbAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "cb-trash-1"
    )!;

    // 相手スピリットの2コアは相手のリザーブへ。自分は2コストを支払う。
    expect(oppSpiritAfter.normalCoreCount).toBe(0);
    // 支払い2個トラッシュ + リザーブ2個獲得(相手から) で純増減0、trashは支払い分の+2。
    expect(aliceAfter.reserveNormalCoreCount).toBe(0);
    expect(aliceAfter.trashNormalCoreCount).toBe(2);
    // 相手の創界神ネクサスのコアが全てボイドへ。
    expect(oppGWAfter.normalCoreCount).toBe(0);
    // 3コストちょうど限定の効果(自身の手札戻し/トラッシュCB戻し)は発火しない。
    expect(m01After.zone).toBe("field");
    expect(cbAfter.zone).toBe("trash");
  });

  it("choiceIndex=2: 相手に創界神ネクサスが無く導界者ネクサスのみのとき、導界者ネクサスのコアがボイドへ (qa-002/P3-134、コア移動系は導界者ネクサスも無条件で受ける)", () => {
    const 導界者ネクサス単独 = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "nexus" && c.grandwalkerData?.kind === "guided"
    )!;
    expect(導界者ネクサス単独).toBeDefined();

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });
    const m01 = createCardInstance(M01, {
      instanceId: "m01-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 1,
      normalCoreCount: 1,
    });
    const oppSpirit = createCardInstance(対戦相手スピリット, {
      instanceId: "opp-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const oppGuided = createCardInstance(導界者ネクサス単独, {
      instanceId: "opp-guided-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const initial: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [m01, oppSpirit, oppGuided],
    };

    const resolved = declareAndResolveM01Choice(initial, 2);

    const oppGuidedAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-guided-1"
    )!;
    // 創界神ネクサスが不在でも、導界者ネクサス単独が「創界神ネクサス対象」の
    // コア移動効果を受け、コアが全てボイドへ移動する。
    expect(oppGuidedAfter.normalCoreCount).toBe(0);
  });

  it("choiceIndex=3 (3コスト全額支払い): 3回のコアシュート + 創界神ネクサスのコア全ボイド + 自身の手札戻し + トラッシュCBの手札戻し", () => {
    const 創界神ネクサス = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "nexus" &&
        c.grandwalkerData?.kind === "grandwalker"
    )!;
    const CBカード = ALL_CARDS.find(
      (c) => c.cardNo === "BSLH01-C02" && c.tribe?.includes("CB")
    )!;
    expect(創界神ネクサス).toBeDefined();
    expect(CBカード).toBeDefined();

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    const m01 = createCardInstance(M01, {
      instanceId: "m01-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 1,
      normalCoreCount: 1,
    });
    const oppSpirit = createCardInstance(対戦相手スピリット, {
      instanceId: "opp-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const oppGW = createCardInstance(創界神ネクサス, {
      instanceId: "opp-gw-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const cbInTrash = createCardInstance(CBカード, {
      instanceId: "cb-trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    // 導界者ネクサス (grandwalkerData.kind:"guided") も qa-002/P3-134 (2026-08-02修正) により
    // 「創界神ネクサス対象」のコア移動系効果を無条件で受ける正当な候補。本ケースでは
    // count:1 に対し oppGW/oppGuided の2候補が並立するため自動解決は候補群先頭
    // (oppGW、cardInstances 順で先) を選び、oppGuided は未選択のまま残る
    // (単独候補時に確実に選ばれることは後続の別 it で検証)。
    const 導界者ネクサス = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "nexus" && c.grandwalkerData?.kind === "guided"
    )!;
    expect(導界者ネクサス).toBeDefined();
    const oppGuided = createCardInstance(導界者ネクサス, {
      instanceId: "opp-guided-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const initial: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [m01, oppSpirit, oppGW, oppGuided, cbInTrash],
    };

    const resolved = declareAndResolveM01Choice(initial, 3, ["opp-1"]);

    const oppSpiritAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    )!;
    const oppGWAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-gw-1"
    )!;
    const oppGuidedAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "opp-guided-1"
    )!;
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    const m01After = resolved.cardInstances.find(
      (c) => c.instanceId === "m01-1"
    )!;
    const cbAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "cb-trash-1"
    )!;

    // 相手スピリットの3コアは相手のリザーブへ。自分の場の維持コアは離脱時に戻る。
    expect(oppSpiritAfter.normalCoreCount).toBe(0);
    // 支払い3個トラッシュ + リザーブ3個獲得(相手から) + 1個獲得(m01自身が場を離れ手元の
    // コアがリザーブへ還元) で純増減+1、trashは支払い分の+3。
    expect(aliceAfter.reserveNormalCoreCount).toBe(1);
    expect(aliceAfter.trashNormalCoreCount).toBe(3);
    // 相手の創界神ネクサスのコアが全てボイドへ。
    expect(oppGWAfter.normalCoreCount).toBe(0);
    // oppGW が候補群先頭として自動選択されるため oppGuided は今回未選択のまま残る
    // (排他ではなく単なる選択結果、上のコメント参照)。
    expect(oppGuidedAfter.normalCoreCount).toBe(2);
    // このスピリット自身が手札へ戻る。
    expect(m01After.zone).toBe("hand");
    // トラッシュのCBカードが手札へ戻る。
    expect(cbAfter.zone).toBe("hand");
  });

  it("[board] 3コスト段の同名ターン制限後も、同名の別個体は前段を解決し、制限されたバウンス枝だけ実行しない", () => {
    const CBカード = ALL_CARDS.find(
      (c) => c.cardNo === "BSLH01-C02" && c.tribe?.includes("CB")
    )!;
    const initial = buildScenario({ aliceReserve: 5, oppCores: 6 });
    const secondM01 = createCardInstance(M01, {
      instanceId: "m01-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 1,
      normalCoreCount: 1,
    });
    const firstCb = createCardInstance(CBカード, {
      instanceId: "cb-trash-first",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const secondCb = createCardInstance(CBカード, {
      instanceId: "cb-trash-second",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const withSameName = {
      ...initial,
      cardInstances: [...initial.cardInstances, secondM01, firstCb, secondCb],
    };

    const first = drainPostResolutionPendings(
      declareAndResolveM01Choice(withSameName, 3, ["opp-1"], "m01-1")
    );
    expect(
      first.cardInstances.find((c) => c.instanceId === "m01-1")?.zone
    ).toBe("hand");
    expect(
      first.cardInstances.find((c) => c.instanceId === "cb-trash-first")?.zone
    ).toBe("hand");

    // 〔ターンに1回:同名〕は「このスピリットを手札に戻す」枝だけの制限。
    // したがって同名の2枚目も3コストを選択でき、1/2コスト以上の前段は解決する。
    expect(findAllM01FlashChoiceIndexes(first, "m01-2")).toEqual([0, 1, 2, 3]);

    const second = declareAndResolveM01Choice(first, 3, ["opp-1"], "m01-2");
    // 2枚目も3コスト支払いで前段のコア移動を行う。一方、同名共有で消費済みの
    // 手札戻しは実行されず、その成功に従属するCB回収も起きない。
    expect(
      second.cardInstances.find((c) => c.instanceId === "m01-2")?.zone
    ).toBe("field");
    expect(
      second.cardInstances.find((c) => c.instanceId === "cb-trash-second")?.zone
    ).toBe("trash");
    expect(
      second.cardInstances.find((c) => c.instanceId === "opp-1")
        ?.normalCoreCount
    ).toBe(0);
  });
});
