/**
 * BSAZ02-C08「月面基地」effects[0,1] 検証。
 *
 * 原文 (textLines[0,1]):
 *   Lv1-Lv2
 *   相手の効果で自分のライフは0にならない。
 * 原文 (textLines[3,4]):
 *   Lv2『お互いのアタックステップ』
 *   自分がスピリットカード/アルティメットカードを召喚するとき、このネクサスを疲労できる。
 *   そうしたとき、そのアルティメットカードの召喚条件を無視し、そのカードの軽減シンボル
 *   すべてを満たす。
 *
 * 検証点:
 *  - effects[0]: life_damage_interception(cause:"opponent_effect", mode:"floor", floor:1,
 *    duration:{scope:"while_on_field"})。既存 flash-activated 版 (BSTH002-M01 等) と異なり
 *    継続効果として場にある間ずっと保護する (BSAZ01 continuous+while_on_field precedent 同型)。
 *  - cause の絞り込み: 相手起因の効果ダメージはクランプされるが、自分起因の効果ダメージや
 *    バトルダメージはクランプされない (opponent_effect のみが対象)。
 *  - effects[1]: 新設 grant_declared_summon_alt_cost CE
 *    (ENGINE-declared-summon-optional-exhaust-cost-bypass)。allow_ignore_summon_condition
 *    と異なり「発揮元(このネクサス)を疲労させる」per-summon 任意コストで初めて有効になる
 *    ため、getDeclaredSummonAltCostGrant が発揮元の exhaustState を確認する。
 *    getAvailableHandSummonPermissionLegalActions が declared-alt-cost 版の追加 legal
 *    action を生成し、通常経路 (このネクサスなし) では召喚条件不成立で1件も出ない
 *    ケースでも、疲労を選べば召喚条件無視+軽減シンボル全充足のコストで召喚できることを
 *    getLegalActions/applyLegalAction 経由で検証する。timingScope:{player:both,period:attack}
 *    のため main phase では一切現れない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { ActiveAttack, CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const C08 = card("BSAZ02-C08");

function player(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function runEffect(state: GameState): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c08-lunar-base:67",
    state,
    effect: C08.effects[0]!,
    effectIndex: 0,
    sourceInstanceId: "src-c08",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

describe("BSAZ02-C08 effects[0]（Lv1-2継続: 相手の効果でライフは0にならない）", () => {
  it("effect の shape: life_damage_interception(cause:opponent_effect, mode:floor, floor:1, while_on_field)", () => {
    expect(C08.effects[0]!.stub).toBeUndefined();
    const action = C08.effects[0]!.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.cause).toBe("opponent_effect");
      expect(action.mode).toBe("floor");
      expect(action.floor).toBe(1);
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("相手の効果によるダメージは floor:1 でクランプされる", () => {
    const src = createCardInstance(C08, {
      instanceId: "src-c08",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0, // Lv1
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state);
    const after = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    expect(getPlayerLifeCoreCount(player(after, ALICE))).toBe(1);
  });

  it("自分の効果によるダメージ / バトルダメージはクランプされない", () => {
    const src = createCardInstance(C08, {
      instanceId: "src-c08",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state);
    const afterSelf = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "self_effect",
      actingPlayerId: ALICE,
    });
    expect(getPlayerLifeCoreCount(player(afterSelf, ALICE))).toBe(0);

    const afterBattle = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(getPlayerLifeCoreCount(player(afterBattle, ALICE))).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// BSAZ02-C08 effects[1]（Lv2『お互いのアタックステップ』発揮元疲労で召喚条件無視+
// 軽減シンボル全充足の代替コストを選べる。ENGINE-declared-summon-optional-exhaust-cost-bypass）
// ════════════════════════════════════════════════════════════════

const TX01A = card("BSAZ02-TX01(A)");
const C01_CF_ULTIMATE = card("BSAZ02-C01");
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};

/**
 * C08 (Lv2, field, 指定の exhaustState) + TX01(A) (hand) + 召喚条件を破る自分の
 * CF アルティメット (field) を並べた状態を作る。attack ステップの flash_before_block
 * 窓（お互いのアタックステップ）で ALICE に優先権がある。
 */
function buildAttackWindowState(c08ExhaustState: "recovered" | "exhausted") {
  const c08 = createCardInstance(C08, {
    instanceId: "c08-field",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2, // Lv2
    exhaustState: c08ExhaustState,
  });
  const conditionBreaker = createCardInstance(C01_CF_ULTIMATE, {
    instanceId: "cf-ultimate-breaker",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv3
  });
  const tx01aInHand = createCardInstance(TX01A, {
    instanceId: "tx01a-hand",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  // rebuildContinuousEffectsFromField はゲーム進行中 (activeAttack 有) には実行できない
  // ("scenario initialization or save data restoration" 専用ガード) ため、CE を先に
  // 静止状態で導出してから activeAttack/step/window を後付けする。
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [c08, conditionBreaker, tx01aInHand],
    playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
  });
  const withCEs = rebuildContinuousEffectsFromField(base, getDef);
  return {
    ...withCEs,
    step: "attack" as const,
    window: "flash_before_block" as const,
    activePlayerId: ALICE,
    turnNumber: 2,
    battleEntities: [
      {
        entityId: "battle-entity:cf-ultimate-breaker",
        memberInstanceIds: ["cf-ultimate-breaker"],
        resolvedBp: 9000,
        resolvedSymbols: ["white"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:2:alice:battle-entity:cf-ultimate-breaker",
      primaryEntityId: "battle-entity:cf-ultimate-breaker",
      participantEntityIds: ["battle-entity:cf-ultimate-breaker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:cf-ultimate-breaker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:cf-ultimate-breaker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    } satisfies ActiveAttack,
  };
}

describe("BSAZ02-C08 effects[1]（Lv2 grant_declared_summon_alt_cost CE 登録）", () => {
  it("effect定義: continuous + applicability.level(2,2) + timingScope(both,attack) + grant_declared_summon_alt_cost(filter:spirit/ultimate, benefits:ignoreSummonCondition+fullReduction)", () => {
    const effect = C08.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.applicability).toEqual({ level: { min: 2, max: 2 } });
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "grant_declared_summon_alt_cost",
      player: "self",
      filter: { category: ["spirit", "ultimate"] },
      benefits: { ignoreSummonCondition: true, fullReduction: true },
      duration: { scope: "while_on_field" },
    });
  });

  it("Lv2で場にあるとき、grant_declared_summon_alt_cost CE が player(自分) に登録される", () => {
    const c08 = createCardInstance(C08, {
      instanceId: "c08-field",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [c08],
    });
    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    const grant = rebuilt.activeContinuousEffects.find(
      (ce) =>
        ce.targetInstanceId === ALICE &&
        ce.modifierTag === "grant_declared_summon_alt_cost"
    );
    expect(grant).toBeDefined();
    expect(grant!.sourceInstanceId).toBe("c08-field");
    expect(grant!.metadata?.filter).toEqual({
      category: ["spirit", "ultimate"],
    });
    expect(grant!.metadata?.benefits).toEqual({
      ignoreSummonCondition: true,
      fullReduction: true,
    });
  });

  it("Lv1 (level.min:2,max:2 の applicability 範囲外) では CE が登録されない", () => {
    const c08 = createCardInstance(C08, {
      instanceId: "c08-field",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0, // Lv1
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [c08],
    });
    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "grant_declared_summon_alt_cost"
      )
    ).toBe(false);
  });
});

describe("BSAZ02-C08 effects[1]（legal action 生成: 発揮元疲労の代替コスト召喚）", () => {
  it("お互いのアタックステップ窓で、召喚条件不成立の TX01(A) に declared-alt-cost 版の summon-permission が現れ、通常版は現れない", () => {
    const state = buildAttackWindowState("recovered");
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const summonActions = actions.filter(
      (a) =>
        a.kind === "summon" &&
        a.actionId.startsWith("legal:summon-permission:") &&
        a.sourceInstanceId === "tx01a-hand"
    ) as Extract<(typeof actions)[number], { kind: "summon" }>[];

    // 通常条件 (自分のCFアルティメット0体) は cf-ultimate-breaker により不成立のため、
    // declared-alt-cost 版以外は一切出ない。
    expect(summonActions).toHaveLength(1);
    const altCost = summonActions[0]!;
    expect(altCost.actionId).toContain(":declared-alt-cost");
    expect(altCost.declaredSummonAltCostGrantSourceInstanceId).toBe(
      "c08-field"
    );
    // cost:8, reductionSymbols 6枠 → 軽減シンボル全充足で 8-6=2。
    // fixedPaymentCost (baseCostOverride ではない): apply 時の二重軽減を防ぐため。
    expect(altCost.fixedPaymentCost).toBe(2);
    expect(altCost.finalCost).toBe(2);
  });

  it("main phase (timingScope 外) では declared-alt-cost 版が一切現れない", () => {
    const attackState = buildAttackWindowState("recovered");
    const mainState = {
      ...attackState,
      step: "main" as const,
      window: "none" as const,
      activeAttack: null,
    };
    const actions = getLegalActions({
      state: mainState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const altCost = actions.find(
      (a) =>
        a.kind === "summon" &&
        a.actionId.includes(":declared-alt-cost") &&
        a.sourceInstanceId === "tx01a-hand"
    );
    expect(altCost).toBeUndefined();
  });

  it("C08 が既に疲労済みのときは declared-alt-cost 版が現れない（発揮元が疲労可能でないと選べない）", () => {
    const state = buildAttackWindowState("exhausted");
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const altCost = actions.find(
      (a) =>
        a.kind === "summon" &&
        a.actionId.includes(":declared-alt-cost") &&
        a.sourceInstanceId === "tx01a-hand"
    );
    expect(altCost).toBeUndefined();
  });

  it("declared-alt-cost 版を適用すると、C08 が疲労し、召喚条件不成立のまま TX01(A) が場へ移る", () => {
    const state = buildAttackWindowState("recovered");
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const altCost = actions.find(
      (a) =>
        a.kind === "summon" &&
        a.actionId.includes(":declared-alt-cost") &&
        a.sourceInstanceId === "tx01a-hand"
    ) as Extract<(typeof actions)[number], { kind: "summon" }>;
    expect(altCost).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: altCost,
      getCardDefinitionById: getDef,
      ...effectLookups,
      paymentSources: [{ kind: "reserve", amount: altCost.finalCost }],
    }).state;

    const c08After = applied.cardInstances.find(
      (c) => c.instanceId === "c08-field"
    )!;
    expect(c08After.exhaustState).toBe("exhausted");

    const tx01aAfter = applied.cardInstances.find(
      (c) => c.instanceId === "tx01a-hand"
    )!;
    // 宣言後・解決前の中間ゾーン (BSAZ02-R03 effects[0] precedent と同じ in_use 経由)。
    expect(tx01aAfter.zone).toBe("in_use");
    expect(
      applied.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
    ).toBe(10 - altCost.finalCost);
  });
});
