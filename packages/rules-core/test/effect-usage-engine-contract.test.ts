/**
 * P3-170: GameState 上の時計 (turnNumber / stepOrdinalThisTurn / activeAttack) を通した使用枠の契約。
 * 台帳の純粋な契約 (effect-usage-accounting.test.ts) とは別に、配線 (時計の導出・世代・使用者) を見る。
 * ルール根拠: 10_rules/03e (期間と共有範囲は独立した軸) / 02d (ステップ限定は同名の別ステップで更新)。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type EffectUsageLimit,
  type GameState,
} from "../src";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import {
  canUseEffectUsage,
  effectUsageAmount,
  refundEffectUsageForTest,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";

const def = (cardNo: string, name = cardNo): CardDefinition => ({
  cardNo,
  name,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
});

function board(): GameState {
  const a1 = createCardInstance(def("T-A"), {
    instanceId: "a1",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const a2 = createCardInstance(def("T-A"), {
    instanceId: "a2",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const b1 = createCardInstance(def("T-A"), {
    instanceId: "b1",
    ownerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [a1, a2, b1],
    }),
    turnNumber: 5,
    step: "main",
    activePlayerId: "alice",
  };
}

const nextTurn = (state: GameState): GameState => ({
  ...state,
  turnNumber: state.turnNumber + 1,
  stepOrdinalThisTurn: 0,
});
const nextStep = (state: GameState): GameState => ({
  ...state,
  stepOrdinalThisTurn: state.stepOrdinalThisTurn + 1,
});

describe("V04 turn と game の複数制限 (エンジンAPI経由, H3)", () => {
  const limits: EffectUsageLimit[] = [
    { kind: "per_instance", duration: "game", maxCount: 3 },
    { kind: "per_card_name", duration: "turn", maxCount: 2 },
  ];
  const opts = {
    sourceInstanceId: "a1",
    effectLabel: "effect:0",
    usageLimit: limits,
  };

  it("同名turn=2は2回目まで可、3回目は不可。次ターンはgame残1で可", () => {
    let state = board();
    state = seedEffectUsage(state, opts);
    expect(canUseEffectUsage(state, opts)).toBe(true);
    state = seedEffectUsage(state, opts);
    expect(canUseEffectUsage(state, opts)).toBe(false);
    state = nextTurn(state);
    expect(canUseEffectUsage(state, opts)).toBe(true);
    state = seedEffectUsage(state, opts);
    // game=3 を使い切った。turn枠は残っていても不可。
    expect(canUseEffectUsage(state, opts)).toBe(false);
  });

  it("refundは両枠を1ずつ戻す", () => {
    let state = board();
    state = seedEffectUsage(state, opts);
    state = seedEffectUsage(state, opts);
    state = refundEffectUsageForTest(state, opts);
    expect(canUseEffectUsage(state, opts)).toBe(true);
  });
});

describe("V02 同名共有は使用者ごとに独立 (H1 基盤)", () => {
  const limit: EffectUsageLimit = { kind: "per_card_name", duration: "turn" };
  it("Aが使用 → Aの別個体は不可、Bの同名は可", () => {
    let state = board();
    state = seedEffectUsage(state, {
      sourceInstanceId: "a1",
      effectLabel: "effect:0",
      usageLimit: limit,
    });
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: "a2",
        effectLabel: "effect:0",
        usageLimit: limit,
      })
    ).toBe(false);
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: "b1",
        effectLabel: "effect:0",
        usageLimit: limit,
      })
    ).toBe(true);
  });
});

describe("V05 ステップ枠は各ステップで更新し、ターン枠は維持する (H4)", () => {
  it("同ターン内でステップ序数が進むとstep枠は更新、turn枠は維持", () => {
    const stepOpts = {
      sourceInstanceId: "a1",
      effectLabel: "effect:0",
      usageLimit: {
        kind: "per_instance",
        duration: "step",
      } as EffectUsageLimit,
    };
    const turnOpts = {
      sourceInstanceId: "a1",
      effectLabel: "effect:1",
      usageLimit: {
        kind: "per_instance",
        duration: "turn",
      } as EffectUsageLimit,
    };
    let state = board();
    state = seedEffectUsage(state, stepOpts);
    state = seedEffectUsage(state, turnOpts);
    expect(canUseEffectUsage(state, stepOpts)).toBe(false);
    state = nextStep(state); // 同名の追加ステップ (stepSequence は増えない経路でも序数は進む)
    expect(canUseEffectUsage(state, stepOpts)).toBe(true);
    expect(canUseEffectUsage(state, turnOpts)).toBe(false);
  });
});

describe("V06 個体の寿命: 実離脱で新個体、同名共有履歴は保持", () => {
  it("fieldInstanceGeneration が進むと個体枠は更新され、同名枠は維持される", () => {
    const instOpts = {
      sourceInstanceId: "a1",
      effectLabel: "effect:0",
      usageLimit: {
        kind: "per_instance",
        duration: "game",
      } as EffectUsageLimit,
    };
    const nameOpts = {
      sourceInstanceId: "a1",
      effectLabel: "effect:1",
      usageLimit: {
        kind: "per_card_name",
        duration: "game",
      } as EffectUsageLimit,
    };
    let state = board();
    state = seedEffectUsage(state, instOpts);
    state = seedEffectUsage(state, nameOpts);
    state = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "a1"
          ? { ...card, fieldInstanceGeneration: 1 }
          : card
      ),
    };
    expect(canUseEffectUsage(state, instOpts)).toBe(true);
    expect(canUseEffectUsage(state, nameOpts)).toBe(false);
  });

  it("game枠は別ターンでも残り、効果ラベルごとに独立して数える", () => {
    const opts = {
      sourceInstanceId: "a1",
      effectLabel: "effect:0",
      usageLimit: {
        kind: "per_instance",
        duration: "game",
      } as EffectUsageLimit,
    };
    let state = seedEffectUsage(board(), opts);
    state = nextTurn(nextTurn(state));
    expect(effectUsageAmount(state, "effect:0")).toBe(1);
    expect(canUseEffectUsage(state, opts)).toBe(false);
  });
});

describe("V09 上限の条件付き上書きは既存の条件評価と一致する", () => {
  // 〔ターンに1回〕だが、自分のカウント5以上なら〔ターンに2回〕(BSFT01-CX01 型)。
  const limit: EffectUsageLimit = {
    kind: "per_instance",
    duration: "turn",
    maxCount: 1,
    maxCountOverrides: [
      { when: [{ kind: "count_value", player: "self", min: 5 }], maxCount: 2 },
    ],
  };
  const opts = {
    sourceInstanceId: "a1",
    effectLabel: "effect:0",
    usageLimit: limit,
  };
  const withCount = (state: GameState, countValue: number): GameState => ({
    ...state,
    players: state.players.map((p) =>
      p.id === "alice" ? { ...p, countValue } : p
    ),
  });
  const getDef = (id: string) => (id === "T-A" ? def("T-A") : undefined);

  it("条件不成立なら基本の1回、成立すれば2回。使用済みは切り詰めない", () => {
    let state = withCount(board(), 0);
    state = seedEffectUsage(state, { ...opts, getCardDefinitionById: getDef });
    expect(
      canUseEffectUsage(state, { ...opts, getCardDefinitionById: getDef })
    ).toBe(false);
    const boosted = withCount(state, 5);
    expect(
      canUseEffectUsage(boosted, { ...opts, getCardDefinitionById: getDef })
    ).toBe(true);
    const used2 = seedEffectUsage(boosted, {
      ...opts,
      getCardDefinitionById: getDef,
    });
    expect(
      canUseEffectUsage(used2, { ...opts, getCardDefinitionById: getDef })
    ).toBe(false);
    // 条件が失われても使用済み(2)は残り、上限1に対して残0のまま。
    expect(
      canUseEffectUsage(withCount(used2, 0), {
        ...opts,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
    expect(effectUsageAmount(used2, "effect:0")).toBe(2);
  });
});

describe("V02b 同名・別cardNo・同一本文は同じ枠を共有する (printed name 共有)", () => {
  const limit: EffectUsageLimit = { kind: "per_card_name", duration: "turn" };
  const variantA = def("T-NAME-A", "同名カード");
  const variantB = def("T-NAME-B", "同名カード");
  const lookup = (id: string): CardDefinition | undefined =>
    id === "T-NAME-A" ? variantA : id === "T-NAME-B" ? variantB : undefined;
  const build = (): GameState => {
    const a = createCardInstance(variantA, {
      instanceId: "na",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const b = createCardInstance(variantB, {
      instanceId: "nb",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [a, b],
      }),
      turnNumber: 5,
      step: "main",
      activePlayerId: "alice",
    };
  };
  it("別cardNoの同名カードで使うと、もう一方も不可", () => {
    const opts = (id: string) => ({
      sourceInstanceId: id,
      effectLabel: "effect:0",
      usageLimit: limit,
      getCardDefinitionById: lookup,
    });
    const state = seedEffectUsage(build(), opts("na"));
    expect(canUseEffectUsage(state, opts("nb"))).toBe(false);
  });
});

describe("V06c 【魂状態】効果の個体枠は、記録と照会で同じ寿命キーになる", () => {
  // 列挙(効果を渡して照会)と宣言・解決(ラベルしか持たず記録)で、soul 世代を寿命に含めるかがずれると、
  // 魂状態に入った後に記録した枠が照会で見えず、〔ターンに1回〕が効かなくなる。
  const soulEffect = {
    timing: { kind: "game_event", player: "self", event: "summon" },
    applicability: { soulState: true },
    executionMode: "optional",
    usageLimit: { kind: "per_instance", duration: "turn" },
    steps: [],
  } as unknown as NonNullable<CardDefinition["effects"]>[number];
  const soulDef: CardDefinition = {
    ...def("T-SOUL", "魂状態カード"),
    effects: [soulEffect],
  };
  const lookup = (id: string): CardDefinition | undefined =>
    id === "T-SOUL" ? soulDef : undefined;

  const build = (): GameState => {
    const card = {
      ...createCardInstance(soulDef, {
        instanceId: "s1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      soulStateGeneration: 1,
    };
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      }),
      turnNumber: 5,
      step: "main",
      activePlayerId: "alice",
    };
  };
  const base = (state: GameState) => ({
    state,
    sourceInstanceId: "s1",
    sourceDefinitionId: "T-SOUL",
    getCardDefinitionById: lookup,
    effectLabel: "effect:0",
    usageLimit: soulEffect.usageLimit,
  });

  it("効果を渡さない記録(宣言・解決の呼出)の後、効果を渡す照会(列挙)でも使用済みと見える", () => {
    // 対照: 記録前は(効果を渡す・渡さないのどちらでも)使える。記録後の false が使い切りによることを確定する。
    expect(canUseEffectByUsageLimit(base(build()))).toBe(true);
    expect(
      canUseEffectByUsageLimit({ ...base(build()), sourceEffect: soulEffect })
    ).toBe(true);
    const recorded = recordEffectUsageIfLimited(base(build()));
    expect(canUseEffectByUsageLimit(base(recorded))).toBe(false);
    expect(
      canUseEffectByUsageLimit({ ...base(recorded), sourceEffect: soulEffect })
    ).toBe(false);
  });

  it("選択肢の変種ラベルでも同じ効果から判定する", () => {
    const options = { ...base(build()), effectLabel: "effect:0:choice:1" };
    expect(
      canUseEffectByUsageLimit({ ...options, sourceEffect: soulEffect })
    ).toBe(true);
    const recorded = recordEffectUsageIfLimited(options);
    expect(
      canUseEffectByUsageLimit({
        ...options,
        state: recorded,
        sourceEffect: soulEffect,
      })
    ).toBe(false);
  });
});
