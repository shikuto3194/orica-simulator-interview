/**
 * BSTH002-R02「ふらわ～戦車」effects[1,2] (旧 stub, textRef:[1,3,4]) 検証。
 *
 * カード本文:
 * 【ミラージュ：コスト3<白><紫>（このカードは手札からセットできる）】
 * 【セット中】
 * 「お互い、ライフは増やせず、1ターンに1つしか減らない。自分のライフが減ったターンの
 *   エンドステップにこのカードを破棄する。」
 *
 * 実装:
 * - 「お互いライフは増やせず」= `life_gain_prevention` CE を self/opponent の2entry分割で
 *   登録 (BSLH01-C11「お互い」先例、ENGINE 新設プリミティブ)。
 * - 「1ターンに1つしか減らない」= 既存 `life_damage_interception` mode:"turn_cap" cap:1
 *   (裁定2026-06-15、BSTH08-C01 先例) を self/opponent 双方に登録。
 * - 「自分のライフが減ったターンのエンドステップに破棄」= 新設 ConditionClause
 *   `life_reduced_this_turn` (turn_cap CE の `lifeReductionCappedThisTurn` 累積を
 *   「1点でも減れば true」の判定として再利用、SSOT) + `timing:{phase,step:end,whose:self}`。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { advanceStep } from "../src/turn-system";
import {
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition, Effect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const getRegisteredFieldCardEffectActions =
  buildFieldCardEffectLookup(ALL_CARDS);

const R02 = cardNoMap.get("BSTH002-R02")!;

const ALICE = "alice";
const BOB = "bob";

function lifeCores(state: GameState, playerId: string): number {
  return state.players.find((p) => p.id === playerId)!.lifeNormalCoreCount;
}

const coreMoveToLife = (
  fromKind: "void" | "reserve",
  player: "self" | "opponent",
  amount: number
): Effect => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: fromKind, player },
        to: { kind: "life", player },
        amount,
      },
    },
  ],
});

const coreMoveFromLife = (
  player: "self" | "opponent",
  amount: number
): Effect => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "life", player },
        to: { kind: "void", player },
        amount,
      },
    },
  ],
});

function runEffect(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:bsth002-r02-mirage-life-lock:92",
    state,
    effect,
    sourceInstanceId: "runner",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function setupBoard(mirageZone: "mirage" | "hand" | "field" = "mirage") {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        voidNormalCoreCount: 5,
        reserveNormalCoreCount: 5,
        lifeNormalCoreCount: 3,
      },
      {
        voidNormalCoreCount: 5,
        reserveNormalCoreCount: 5,
        lifeNormalCoreCount: 3,
      },
    ],
    cardInstances: [
      createCardInstance(R02, {
        instanceId: "r02-instance",
        ownerPlayerId: ALICE,
        zone: mirageZone,
      }),
    ],
  });
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

describe("BSTH002-R02 effects[1,2] shape (継続: 【セット中】life_gain_prevention + turn_cap)", () => {
  it("stub 解消済み、self/opponent 2entry で mirage_set 束縛", () => {
    const selfEntry = R02.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 1 &&
        e.steps.some(
          (s) =>
            s.action.kind === "life_gain_prevention" &&
            s.action.player === "self"
        )
    )!;
    expect(selfEntry.stub).toBeUndefined();
    expect(selfEntry.applicability).toEqual({ zone: ["mirage_set"] });
    expect(selfEntry.steps[0]!.action).toEqual({
      kind: "life_gain_prevention",
      player: "self",
      duration: { scope: "while_set" },
    });
    expect(selfEntry.steps[1]!.action).toEqual({
      kind: "life_damage_interception",
      player: "self",
      cause: "any",
      mode: "turn_cap",
      cap: 1,
      duration: { scope: "while_set" },
    });

    const opponentEntry = R02.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 1 &&
        e.steps.some(
          (s) =>
            s.action.kind === "life_gain_prevention" &&
            s.action.player === "opponent"
        )
    )!;
    expect(opponentEntry.steps[0]!.action).toEqual({
      kind: "life_gain_prevention",
      player: "opponent",
      duration: { scope: "while_set" },
    });
  });

  it("エンドステップ破棄 effect: phase(step:end,whose:either) + condition:life_reduced_this_turn + move_card(mirage→trash)", () => {
    const discardEntry = R02.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 4
    )!;
    expect(discardEntry.stub).toBeUndefined();
    expect(discardEntry.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "either",
    });
    expect(discardEntry.applicability).toEqual({ zone: ["mirage_set"] });
    expect(discardEntry.condition).toEqual([
      { kind: "life_reduced_this_turn", player: "self" },
    ]);
    expect(discardEntry.steps[0]!.action).toEqual({
      kind: "move_card",
      target: { kind: "self" },
      from: { zone: "mirage", player: "self" },
      to: { zone: "trash" },
      count: 1,
      requireFullCount: true,
    });
  });
});

describe("BSTH002-R02 盤面変化: 【セット中】お互いライフ増加禁止", () => {
  it("ミラージュセット中は、自分のライフはボイド/リザーブからも増えない", () => {
    let state = setupBoard("mirage");
    state = runEffect(state, coreMoveToLife("void", "self", 2));
    expect(lifeCores(state, ALICE)).toBe(3);
    state = runEffect(state, coreMoveToLife("reserve", "self", 2));
    expect(lifeCores(state, ALICE)).toBe(3);
  });

  it("ミラージュセット中は、相手のライフも増えない", () => {
    let state = setupBoard("mirage");
    state = runEffect(state, coreMoveToLife("void", "opponent", 2));
    expect(lifeCores(state, BOB)).toBe(3);
  });

  it("ミラージュゾーンを離れると増加禁止は登録されない (手札/フィールド)", () => {
    for (const zone of ["hand", "field"] as const) {
      const state = setupBoard(zone);
      const after = runEffect(state, coreMoveToLife("void", "self", 2));
      expect(lifeCores(after, ALICE)).toBe(5);
    }
  });
});

describe("BSTH002-R02 盤面変化: 【セット中】お互い1ターンに1つしかライフが減らない", () => {
  it("自分のライフ減少は1ターン累積で1に頭打ちされる (2回目以降はブロック)", () => {
    let state = setupBoard("mirage");
    state = runEffect(state, coreMoveFromLife("self", 1));
    expect(lifeCores(state, ALICE)).toBe(2);
    // 2回目の減少はターン内累積上限 (cap:1) に達しておりブロックされる。
    state = runEffect(state, coreMoveFromLife("self", 1));
    expect(lifeCores(state, ALICE)).toBe(2);
    expect(state.lifeReductionCappedThisTurn?.[ALICE]).toBe(1);
  });

  it("相手のライフ減少も同様に1ターン1個へ頭打ちされる", () => {
    let state = setupBoard("mirage");
    state = runEffect(state, coreMoveFromLife("opponent", 3));
    expect(lifeCores(state, BOB)).toBe(2);
    expect(state.lifeReductionCappedThisTurn?.[BOB]).toBe(1);
  });
});

describe("BSTH002-R02 盤面変化: 自分のライフが減ったターンのエンドステップに破棄", () => {
  it("ライフが減っていれば、自分のエンドステップにこのカードが破棄される", () => {
    let state = setupBoard("mirage");
    // mirageSetStates も登録しないと本カード自身が mirage_set のターゲットとして
    // 正しく解決されない経路 (mirage 除去/破棄の bookkeeping) があるため揃える。
    state = {
      ...state,
      mirageSetStates: [{ playerId: ALICE, cardInstanceId: "r02-instance" }],
      activePlayerId: ALICE,
      turnNumber: 1,
      step: "attack",
      window: "none",
    };
    state = runEffect(state, coreMoveFromLife("self", 1));
    expect(lifeCores(state, ALICE)).toBe(2);
    expect(state.lifeReductionCappedThisTurn?.[ALICE]).toBe(1);

    const queued = advanceStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.step).toBe("end");
    expect(queued.window).toBe("end_step_effects");

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "end_step"
    );
    expect(pending).toBeDefined();

    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "r02-instance"
    );
    expect(resolve).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: resolve!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const applied = applyLegalAction({
      state: declared,
      action: passAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(
      applied.cardInstances.find((c) => c.instanceId === "r02-instance")?.zone
    ).toBe("trash");
    expect(applied.mirageSetStates).not.toContainEqual({
      playerId: ALICE,
      cardInstanceId: "r02-instance",
    });
  });

  it("相手のターン中に自分のライフが減っていれば、相手のエンドステップにこのカードが破棄される (whose:either)", () => {
    let state = setupBoard("mirage");
    state = {
      ...state,
      mirageSetStates: [{ playerId: ALICE, cardInstanceId: "r02-instance" }],
      activePlayerId: BOB,
      turnNumber: 2,
      step: "attack",
      window: "none",
    };
    state = runEffect(state, coreMoveFromLife("self", 1));
    expect(lifeCores(state, ALICE)).toBe(2);
    expect(state.lifeReductionCappedThisTurn?.[ALICE]).toBe(1);

    const queued = advanceStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.step).toBe("end");

    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "r02-instance"
    );
    expect(resolve).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: resolve!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const applied = applyLegalAction({
      state: declared,
      action: passAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(
      applied.cardInstances.find((c) => c.instanceId === "r02-instance")?.zone
    ).toBe("trash");
  });

  it("ライフが減っていなければ、自分のエンドステップにこのカードは破棄されない", () => {
    let state = setupBoard("mirage");
    state = {
      ...state,
      mirageSetStates: [{ playerId: ALICE, cardInstanceId: "r02-instance" }],
      activePlayerId: ALICE,
      turnNumber: 1,
      step: "attack",
      window: "none",
    };

    const queued = advanceStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.step).toBe("end");

    // 汎用の end_step pending window 自体は毎ターン生成されるが (turn-system の
    // step_transition マーカー)、`life_reduced_this_turn` 条件を満たさないこのカードは
    // getAvailableTriggeredEffectSourceChoices の候補から除外される
    // (trigger-system.ts の条件評価: 条件不成立ソースは sourceChoices に入らない)。
    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "r02-instance"
    );
    expect(resolve).toBeUndefined();
    expect(
      queued.cardInstances.find((c) => c.instanceId === "r02-instance")?.zone
    ).toBe("mirage");
  });
});
