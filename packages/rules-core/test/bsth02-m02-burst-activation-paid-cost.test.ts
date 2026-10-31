/**
 * BSTH02-M02「[妖々夢]アリス・マーガトロイド」effects[2] 検証
 * (engine-burst-activation-paid-cost-gate)。
 *
 * 原文 textLines[6,7]:
 *   Lv2-Lv3『お互いのアタックステップ』
 *   相手はライフのコア2個をボイドに置かなければ、バーストを発動できない。
 *
 * 実装: restrict_burst_activation の cost:{resource:"life_core",amount:2} 拡張。
 * isBurstActivationRestricted は対価未指定時は無条件禁止 (既存挙動、BSTH08.5-M11 等)、
 * 対価指定時は「ライフの通常コアが対価に満たないときのみ禁止」(資力判定)。
 * resolve_pending_burst_check 宣言時 (stack window を開く前) に対価を強制支払いする。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, Step } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const M02 = cardNoMap.get("BSTH02-M02")!;
// 【バースト：自分のライフ減少後】自己召喚。P3-71 と同じ簡潔な burst 精度で bob 側に使う。
const X07 = cardNoMap.get("BSTH01-X07")!;

const lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

function buildScenario(opts: {
  bobLifeNormalCoreCount: number;
  step?: Step;
}): GameState {
  const m02 = createCardInstance(M02, {
    instanceId: "m02-alice",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    // levelDefs: L1=1, L2=3, L3=4 required cores → 3 で Lv2。
    normalCoreCount: 3,
  });
  const x07 = createCardInstance(X07, {
    instanceId: "x07-bob",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "burst",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{}, { lifeNormalCoreCount: opts.bobLifeNormalCoreCount }],
  });
  const step = opts.step ?? "attack";
  const withCe = executeEffect({
    chainId: "test:bsth02-m02-burst-activation-paid-cost:71",
    state: { ...base, cardInstances: [m02, x07] },
    effect: M02.effects![2]!,
    sourceInstanceId: "m02-alice",
    actingPlayerId: "alice",
    getCardDefinitionById,
  });
  return {
    ...withCe,
    activePlayerId: "alice",
    step,
    window: "none",
    setBurstStates: [{ playerId: "bob", cardInstanceId: "x07-bob" }],
    pendingBurstChecks: [
      {
        checkId: "c1",
        actingPlayerId: "bob",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:bsth02-m02-burst-activation-paid-cost:85",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: null,
        amount: 1,
        step,
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

/**
 * 2枚目の BSTH02-M02 (別 instance) からも同じ effects[2] を適用し、対価付き CE が
 * 2 ソース(別カード)存在する状態を作る。合算裁定 (04b_burst-rules.md 複数ソース対価の扱い)
 * の検証用。
 */
function buildTwoSourceScenario(opts: {
  bobLifeNormalCoreCount: number;
}): GameState {
  const base = buildScenario({
    bobLifeNormalCoreCount: opts.bobLifeNormalCoreCount,
  });
  const m02Second = createCardInstance(M02, {
    instanceId: "m02-alice-2",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 3,
  });
  return executeEffect({
    chainId: "test:bsth02-m02-burst-activation-paid-cost:122",
    state: { ...base, cardInstances: [...base.cardInstances, m02Second] },
    effect: M02.effects![2]!,
    sourceInstanceId: "m02-alice-2",
    actingPlayerId: "alice",
    getCardDefinitionById,
  });
}

describe("バースト発動へのライフコア対価ゲート: 複数ソース(別カード)合算", () => {
  it("対価付きCEが2ソース: 4個未満(3個)では resolve が提供されない(合算判定)", () => {
    const state = buildTwoSourceScenario({ bobLifeNormalCoreCount: 3 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      false
    );
    expect(actions.some((a) => a.kind === "decline_pending_burst_check")).toBe(
      true
    );
  });

  it("対価付きCEが2ソース: 4個ちょうどなら resolve できる、適用で4個支払われる(2+2合算)", () => {
    const state = buildTwoSourceScenario({ bobLifeNormalCoreCount: 4 });
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    const resolve = actions.find(
      (a) => a.kind === "resolve_pending_burst_check"
    )!;
    expect(resolve).toBeDefined();

    const after = applyLegalAction({
      state,
      action: resolve,
      getCardDefinitionById,
      ...lookups,
    }).state;
    const bobAfter = after.players.find((p) => p.id === "bob")!;

    expect(bobAfter.lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount - 4
    );
    expect(bobAfter.voidNormalCoreCount).toBe(
      bobBefore.voidNormalCoreCount + 4
    );
  });
});

describe("BSTH02-M02 effects[2] shape (バースト発動 対価ゲート)", () => {
  it("continuous + timingScope(both/attack) + min_level>=2 + restrict_burst_activation cost", () => {
    const effect = M02.effects![2]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "restrict_burst_activation",
      player: "opponent",
      duration: { scope: "while_on_field" },
      cost: { resource: "life_core", amount: 2 },
    });
  });
});

describe("BSTH02-M02 効果耐性 CE 登録 (cost metadata)", () => {
  it("CE.metadata.cost に resource:life_core, amount:2 が入る", () => {
    const state = buildScenario({ bobLifeNormalCoreCount: 5 });
    const ce = state.activeContinuousEffects.find(
      (c) => c.modifierTag === "cannot_activate_opponent_burst"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("bob");
    expect(ce!.metadata).toEqual({
      cost: { resource: "life_core", amount: 2 },
    });
  });
});

describe("バースト発動へのライフコア2個対価ゲート (資力判定)", () => {
  it("bob のライフ通常コアが2個以上: resolve_pending_burst_check が提供される (禁止されない)", () => {
    const state = buildScenario({ bobLifeNormalCoreCount: 5 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      true
    );
  });

  it("bob のライフ通常コアが1個 (対価未満): resolve は提供されず decline のみ", () => {
    const state = buildScenario({ bobLifeNormalCoreCount: 1 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      false
    );
    expect(actions.some((a) => a.kind === "decline_pending_burst_check")).toBe(
      true
    );
  });

  it("bob のライフ通常コアが0個: resolve は提供されず decline のみ", () => {
    const state = buildScenario({ bobLifeNormalCoreCount: 0 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      false
    );
    expect(actions.some((a) => a.kind === "decline_pending_burst_check")).toBe(
      true
    );
  });

  it("お互いのアタックステップ外 (main): timingScope 外のため資力に関わらず禁止されない", () => {
    const state = buildScenario({ bobLifeNormalCoreCount: 0, step: "main" });
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      true
    );
  });
});

describe("宣言時強制支払い (life core 2 個 → void)", () => {
  it("resolve 適用でライフ通常コアが2個減りボイドが2個増える", () => {
    const state = buildScenario({ bobLifeNormalCoreCount: 5 });
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...lookups,
    });
    const resolve = actions.find(
      (a) => a.kind === "resolve_pending_burst_check"
    )!;
    expect(resolve).toBeDefined();

    const after = applyLegalAction({
      state,
      action: resolve,
      getCardDefinitionById,
      ...lookups,
    }).state;
    const bobAfter = after.players.find((p) => p.id === "bob")!;

    expect(bobAfter.lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount - 2
    );
    expect(bobAfter.voidNormalCoreCount).toBe(
      bobBefore.voidNormalCoreCount + 2
    );
    expect(
      after.log.some((l) => l === "burst:paid-activation-cost:bob:life_core:2")
    ).toBe(true);
  });
});
