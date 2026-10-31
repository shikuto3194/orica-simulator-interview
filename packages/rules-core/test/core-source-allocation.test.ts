/**
 * field_card ソースのコアコスト支払い配分プレイヤー選択 (`pendingCoreSourceAllocation`)。
 *
 * P3-14 D-6 follow-up: BSTH05-C11/C12「系統:「アシハラ」を持つ自分の緑の創界神ネクサスの
 * コア3個をボイドに置くことで」型のコスト支払いで、候補カードが複数かつ余剰コアがある
 * (= 配分が一意でない) 場合に「支払い前中断 → 配分選択 → コストステップ再実行」方式で
 * プレイヤーがどのカードから何個取るかを選ぶ。
 *
 * - 一意の場合 (候補1枚 / 合計==必要数) は pending を立てず即時支払い (従来挙動)。
 * - 再実行時に conditional_cost スナップショットがコスト支払い前 state になるため、
 *   効果側 (bounce) 失敗時の「ことで」双方向ロールバックで配分支払い分が元に戻る。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { getCurrentActorPlayerIds } from "../src/current-actor";
import type { Effect } from "../src/dsl-types";

const COST_FILTER = {
  category: ["nexus"],
  colors: ["green"],
  tribesRequired: ["アシハラ", "創界神"],
} as const;

// BSTH05-C11 と同型: choice(基本=2体バウンス / 拡張=コア3個コスト) + ref_choice +
// conditional_cost で「ことで」を表現するフラッシュ効果。
const FLASH_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      id: "mode",
      action: {
        kind: "bounce",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 2,
        },
        maxPreventable: 1,
      },
      choice: [
        {
          action: {
            kind: "core_move",
            from: {
              kind: "field_card",
              player: "self",
              filter: COST_FILTER as never,
            },
            to: { kind: "void", player: "self" },
            amount: 3,
          },
        },
      ],
    },
    {
      action: {
        kind: "bounce",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit", "ultimate"] },
          count: 3,
        },
        maxPreventable: 1,
      },
      stepCondition: { kind: "ref_choice", stepId: "mode", choiceIndex: 1 },
      connector: "conditional_cost",
    },
  ],
} as Effect;

function makeMagicDef(): CardDefinition {
  return {
    cardNo: "CSA-MAGIC-01",
    name: "CSA テストマジック",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [FLASH_EFFECT],
  } as CardDefinition;
}

function makeNexusDef(): CardDefinition {
  return {
    cardNo: "CSA-NEXUS-01",
    name: "アシハラ創界神",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "アシハラ・創界神",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeSpiritDef(cardNo: string, category = "spirit"): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    keywordTags: [],
    textLines: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

/**
 * alice: マジック1枚 (手札) + 創界神ネクサス N 枚 (各コア数指定)。
 * bob: 対象スピリット/アルティメット opponentTargets 体。
 */
function buildState(options: {
  nexusCores: number[];
  opponentTargets: number;
}): {
  state: GameState;
  defs: Map<string, CardDefinition>;
} {
  const magicDef = makeMagicDef();
  const nexusDef = makeNexusDef();
  const spiritDef = makeSpiritDef("CSA-SPIRIT-01");
  const ultimateDef = makeSpiritDef("CSA-ULTIMATE-01", "ultimate");

  const cards = [
    createCardInstance(magicDef, {
      instanceId: "magic-1",
      ownerPlayerId: "alice",
      zone: "hand",
    }),
    ...options.nexusCores.map((cores, i) =>
      createCardInstance(nexusDef, {
        instanceId: `nexus-${i + 1}`,
        ownerPlayerId: "alice",
        zone: "field",
        cores,
      })
    ),
  ];
  const targetIds = ["bob-s1", "bob-s2", "bob-u1"];
  for (let i = 0; i < options.opponentTargets; i++) {
    const id = targetIds[i]!;
    cards.push(
      createCardInstance(id === "bob-u1" ? ultimateDef : spiritDef, {
        instanceId: id,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      })
    );
  }

  const defs = new Map<string, CardDefinition>([
    [magicDef.cardNo, magicDef],
    [nexusDef.cardNo, nexusDef],
    [spiritDef.cardNo, spiritDef],
    [ultimateDef.cardNo, ultimateDef],
  ]);
  const state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      startingVoidNormalCoreCount: 0,
    }),
    activePlayerId: "alice",
    step: "attack" as const,
  };
  return { state, defs };
}

function run(
  state: GameState,
  defs: Map<string, CardDefinition>,
  targetInstanceIds?: string[]
): GameState {
  return flushPendingLeaves(
    executeEffect({
      chainId: "test:core-source-allocation:199",
      state,
      effect: FLASH_EFFECT,
      effectIndex: 0,
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id: string) => defs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
      ...(targetInstanceIds ? { targetInstanceIds } : {}),
    }),
    (id) => defs.get(id)
  );
}

function resolveWith(
  state: GameState,
  defs: Map<string, CardDefinition>,
  allocations: Record<string, number>
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: () => [],
  });
  const action = actions.find(
    (a) => a.kind === "resolve_core_source_allocation"
  );
  expect(action).toBeDefined();
  const applied = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredTriggeredEffectActions: () => [],
    coreSourceAllocations: allocations,
  });
  return applied.state;
}

function coresOn(state: GameState, instanceId: string): number {
  return (
    state.cardInstances.find((c) => c.instanceId === instanceId)
      ?.normalCoreCount ?? 0
  );
}

function zoneOf(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === instanceId)?.zone;
}

function aliceVoid(state: GameState): number {
  return state.players.find((p) => p.id === "alice")!.voidNormalCoreCount;
}

describe("field_card コスト支払い配分: pending を立てない一意ケース", () => {
  it("候補1枚 → 即時支払い (従来挙動)", () => {
    const { state, defs } = buildState({
      nexusCores: [4],
      opponentTargets: 3,
    });
    const after = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(coresOn(after, "nexus-1")).toBe(1);
    expect(aliceVoid(after)).toBe(3);
    expect(zoneOf(after, "bob-s1")).toBe("hand");
  });

  it("候補2枚・合計==必要数 → 全取りで即時支払い", () => {
    const { state, defs } = buildState({
      nexusCores: [1, 2],
      opponentTargets: 3,
    });
    const after = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(coresOn(after, "nexus-1")).toBe(0);
    expect(coresOn(after, "nexus-2")).toBe(0);
    expect(aliceVoid(after)).toBe(3);
    expect(zoneOf(after, "bob-u1")).toBe("hand");
  });
});

describe("field_card コスト支払い配分: pending 生成 (候補2枚・余剰あり)", () => {
  it("pendingCoreSourceAllocation を生成し、state は不変 (コア未移動)", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 3,
    });
    const gen = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    const pending = gen.pendingCoreSourceAllocation;
    expect(pending).not.toBeNull();
    expect(pending!.actingPlayerId).toBe("alice");
    expect(pending!.requiredTotal).toBe(3);
    expect(pending!.toLocation.kind).toBe("void");
    expect(pending!.candidates).toEqual([
      { instanceId: "nexus-1", available: 2 },
      { instanceId: "nexus-2", available: 3 },
    ]);
    // 同ステップ再実行用 continuation が注入されている
    expect(pending!.continuation).toBeDefined();
    expect(pending!.continuation!.resumeStepIndex).toBe(0);
    expect(pending!.continuation!.choiceIndex).toBe(1);
    // state 不変: コアは一切移動していない
    expect(coresOn(gen, "nexus-1")).toBe(2);
    expect(coresOn(gen, "nexus-2")).toBe(3);
    expect(aliceVoid(gen)).toBe(0);
    expect(zoneOf(gen, "bob-s1")).toBe("field");
    expect(zoneOf(gen, "bob-u1")).toBe("field");
  });

  it("current-actor は pending 中 actingPlayerId を返す", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 3,
    });
    // bob 起点にして fallback (activePlayerId) と区別する
    const gen = run({ ...state, activePlayerId: "bob" }, defs, [
      "bob-s1",
      "bob-s2",
      "bob-u1",
    ]);
    expect(gen.pendingCoreSourceAllocation).not.toBeNull();
    expect(Array.from(getCurrentActorPlayerIds(gen))).toEqual(["alice"]);
  });

  it("legal action が candidates / requiredTotal を提示し、相手には返さない", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 3,
    });
    const gen = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    const aliceActions = getLegalActions({
      state: gen,
      actingPlayerId: "alice",
      getCardDefinitionById: (id: string) => defs.get(id),
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(aliceActions).toHaveLength(1);
    expect(aliceActions[0]).toMatchObject({
      kind: "resolve_core_source_allocation",
      actingPlayerId: "alice",
      requiredTotal: 3,
      toKind: "void",
    });
    const bobActions = getLegalActions({
      state: gen,
      actingPlayerId: "bob",
      getCardDefinitionById: (id: string) => defs.get(id),
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(bobActions).toHaveLength(0);
  });
});

describe("field_card コスト支払い配分: resolve_core_source_allocation", () => {
  it("A から1個 + B から2個 → 指定どおり移動し後段 bounce まで完走", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 3,
    });
    const gen = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    const after = resolveWith(gen, defs, { "nexus-1": 1, "nexus-2": 2 });
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(coresOn(after, "nexus-1")).toBe(1);
    expect(coresOn(after, "nexus-2")).toBe(1);
    expect(aliceVoid(after)).toBe(3);
    // 後段ステップ (拡張バウンス3体) まで完走
    expect(zoneOf(after, "bob-s1")).toBe("hand");
    expect(zoneOf(after, "bob-s2")).toBe("hand");
    expect(zoneOf(after, "bob-u1")).toBe("hand");
  });

  it("片側全取り (B から3個) も選べる (転醒/Lv 閾値の維持を選ぶ余地)", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 3,
    });
    const gen = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    const after = resolveWith(gen, defs, { "nexus-2": 3 });
    expect(coresOn(after, "nexus-1")).toBe(2);
    expect(coresOn(after, "nexus-2")).toBe(0);
    expect(aliceVoid(after)).toBe(3);
    expect(zoneOf(after, "bob-u1")).toBe("hand");
  });

  it("不正配分: 合計不一致 / available 超過 / 候補外カード は throw", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 3,
    });
    const gen = run(state, defs, ["bob-s1", "bob-s2", "bob-u1"]);
    // 合計不一致 (2 != 3)
    expect(() =>
      resolveWith(gen, defs, { "nexus-1": 1, "nexus-2": 1 })
    ).toThrow(/does not match required/);
    // available 超過 (nexus-1 は 2 個しか持たない)
    expect(() => resolveWith(gen, defs, { "nexus-1": 3 })).toThrow(
      /exceeds available/
    );
    // 候補外カード
    expect(() => resolveWith(gen, defs, { "magic-1": 3 })).toThrow(
      /not a candidate/
    );
    // throw 後も state 不変 (コア未移動)
    expect(coresOn(gen, "nexus-1")).toBe(2);
    expect(coresOn(gen, "nexus-2")).toBe(3);
    expect(aliceVoid(gen)).toBe(0);
  });

  it("resume 後に効果側失敗 (bounce 対象0) → コストがロールバックされ配分が元に戻る (ことで双方向)", () => {
    const { state, defs } = buildState({
      nexusCores: [2, 3],
      opponentTargets: 0,
    });
    // 対象 0 でもコスト配分の選択は先に発生する (支払い前中断方式)
    const gen = run(state, defs);
    expect(gen.pendingCoreSourceAllocation).not.toBeNull();
    const after = resolveWith(gen, defs, { "nexus-1": 1, "nexus-2": 2 });
    // 効果側 (bounce) が対象 0 で失敗 → conditional_cost ロールバックで
    // 配分支払い分のコアが元のカードに戻る
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(coresOn(after, "nexus-1")).toBe(2);
    expect(coresOn(after, "nexus-2")).toBe(3);
    expect(aliceVoid(after)).toBe(0);
  });
});
