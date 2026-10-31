/**
 * P3-88 汎用「コアN個まで」プレイヤー数選択の基盤テスト。
 *
 * core_move の amount が {min, max}（範囲）かつ単一ソース→単一移動先のとき、
 * pendingCoreCountSelection を生成し、applyLegalAction(resolve_pending_core_count)
 * で移動コア数 (min〜max) を確定する。
 *
 * 代表カード: BSTH01-X08「相手のライフのコア2個までをボイドに置く」(min=0, max=2)。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeHandWrittenEffectResolver,
  type EffectActionContext,
} from "../src/effect/effect-resolution";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function lifeToVoidUpTo2(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "life", player: "opponent" },
          to: { kind: "void", player: "opponent" },
          amount: { min: 0, max: 2 },
        },
      },
    ],
  };
}

function lifeToVoidUpTo2Flash(): Effect {
  return {
    ...lifeToVoidUpTo2(),
    timing: { kind: "activated", mode: "flash" },
  };
}

function increaseCountFlash(amount: number): Effect {
  return {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: { kind: "count_increase", player: "self", amount },
      },
    ],
  };
}

function multiEffectDispatchDefinition(): CardDefinition {
  return {
    cardNo: "TEST-CORE-COUNT-DISPATCH",
    name: "core count selection dispatch test",
    printedCategory: "spirit",
    colors: [],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: [],
    textLines: [],
    tribe: "",
    effects: [lifeToVoidUpTo2Flash(), increaseCountFlash(9)],
  } as unknown as CardDefinition;
}

function stateWithBobLife(life: number): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {},
      { lifeNormalCoreCount: life, voidNormalCoreCount: 0 },
    ],
  });
}

function generate(life: number): GameState {
  return executeEffect({
    chainId: "test:core-count-selection:86",
    state: stateWithBobLife(life),
    effect: lifeToVoidUpTo2(),
    sourceInstanceId: "s1",
    actingPlayerId: ALICE,
    getCardDefinitionById: () => undefined,
  });
}

function resolveWith(state: GameState, chosen: number): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: () => undefined,
  });
  const action = actions.find((a) => a.kind === "resolve_pending_core_count");
  expect(action).toBeDefined();
  const applied = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: () => undefined,
    coreCountSelection: chosen,
  });
  return applied.state;
}

function bob(state: GameState) {
  return state.players.find((p) => p.id === BOB)!;
}

const SOUL_SOURCE_DEF: CardDefinition = {
  cardNo: "TEST-CORE-COUNT-EXPLICIT-SOUL",
  name: "明示ソウルコア数選択源",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

function explicitSoulFromThisCardUpTo1(): Effect {
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "trash", player: "self" },
          to: { kind: "this_card" },
          amount: { min: 0, max: 1 },
          effectKind: "explicit_soul_core",
        },
      },
    ],
  };
}

function stateWithSourceNormalAndSoul(): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      { trashNormalCoreCount: 1, reserveNormalCoreCount: 0 },
      {},
    ],
    cardInstances: [
      createCardInstance(SOUL_SOURCE_DEF, {
        instanceId: "soul-src",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            soulCoreLocation: { kind: "trash" },
          }
        : p
    ),
  };
}

describe("P3-88 コア数選択 pending の生成", () => {
  it("amount {min:0,max:2} かつ available>=2 で pending を生成 (min0/max2)", () => {
    const gen = generate(5);
    expect(gen.pendingCoreCountSelection).not.toBeNull();
    expect(gen.pendingCoreCountSelection!.min).toBe(0);
    expect(gen.pendingCoreCountSelection!.max).toBe(2);
    expect(gen.pendingCoreCountSelection!.actingPlayerId).toBe(ALICE);
    // 生成時点では盤面未変化
    expect(bob(gen).lifeNormalCoreCount).toBe(5);
    expect(bob(gen).voidNormalCoreCount).toBe(0);
  });

  it("legal action が min/max と from/to を提示する", () => {
    const gen = generate(5);
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const a = actions.find((x) => x.kind === "resolve_pending_core_count");
    expect(a).toMatchObject({
      kind: "resolve_pending_core_count",
      min: 0,
      max: 2,
      fromKind: "life",
      toKind: "void",
    });
  });

  it("available<max なら max を available に丸める (life=1 → 直接移動、pending 無し)", () => {
    // effectiveMax(1) <= effectiveMin(0)? いいえ → pending(min0,max1)
    const gen = generate(1);
    expect(gen.pendingCoreCountSelection).not.toBeNull();
    expect(gen.pendingCoreCountSelection!.max).toBe(1);
  });

  it("available=0 なら noop で pending を生成しない", () => {
    const gen = generate(0);
    expect(gen.pendingCoreCountSelection).toBeNull();
    expect(bob(gen).lifeNormalCoreCount).toBe(0);
    expect(bob(gen).voidNormalCoreCount).toBe(0);
  });
});

describe("ENGINE-core-count-selection-dispatch 後続 effect dispatch 停止", () => {
  it("pendingCoreCountSelection が残る間は同一カードの後続 activated effect を dispatch しない", () => {
    const sourceDefinition = multiEffectDispatchDefinition();
    const sourceCard = createCardInstance(sourceDefinition, {
      instanceId: "core-count-selection-dispatch-source",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const getDefinitionById = (id: string) =>
      id === sourceDefinition.cardNo ? sourceDefinition : undefined;
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { countValue: 0 },
        { lifeNormalCoreCount: 5, voidNormalCoreCount: 0 },
      ],
      cardInstances: [sourceCard],
    });
    const context: EffectActionContext = {
      chainId: "core-count-selection-dispatch-chain",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: ALICE,
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition,
      targetInstanceIds: [],
      getCardDefinitionById: getDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      effectTimingFilter: "flash",
    };

    const after = executeHandWrittenEffectResolver({
      state,
      context,
      getResolver: () => undefined,
    });

    expect(after.pendingCoreCountSelection).not.toBeNull();
    expect(after.players.find((p) => p.id === ALICE)?.countValue).toBe(0);
    expect(after.log).not.toContain("effect:count_increase:alice:9");
    expect(after.flashEffectActivationLog).toEqual([
      expect.objectContaining({
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceDefinition.cardNo,
        effectIndex: 0,
      }),
    ]);
  });
});

describe("P3-88 コア数選択の解決（盤面変化）", () => {
  it("2 を選ぶと相手ライフ2コアがボイドへ", () => {
    const after = resolveWith(generate(5), 2);
    expect(after.pendingCoreCountSelection).toBeNull();
    expect(bob(after).lifeNormalCoreCount).toBe(3);
    expect(bob(after).voidNormalCoreCount).toBe(2);
  });

  it("1 を選ぶと1コアだけ移動（中間選択が機能）", () => {
    const after = resolveWith(generate(5), 1);
    expect(bob(after).lifeNormalCoreCount).toBe(4);
    expect(bob(after).voidNormalCoreCount).toBe(1);
  });

  it("0 を選ぶと移動しない（『まで』の最小選択）", () => {
    const after = resolveWith(generate(5), 0);
    expect(bob(after).lifeNormalCoreCount).toBe(5);
    expect(bob(after).voidNormalCoreCount).toBe(0);
  });

  it("範囲外 (3) はエラー", () => {
    const gen = generate(5);
    const actions = getLegalActions({
      state: gen,
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_core_count"
    )!;
    expect(() =>
      applyLegalAction({
        state: gen,
        action,
        getCardDefinitionById: () => undefined,
        coreCountSelection: 3,
      })
    ).toThrow();
  });

  it("explicit_soul_core は pendingCoreCountSelection 経由でも通常トラッシュコアではなくソウルコアを動かす", () => {
    const gen = executeEffect({
      chainId: "test:core-count-selection:315",
      state: stateWithSourceNormalAndSoul(),
      effect: explicitSoulFromThisCardUpTo1(),
      sourceInstanceId: "soul-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === SOUL_SOURCE_DEF.cardNo ? SOUL_SOURCE_DEF : undefined,
    });
    expect(gen.pendingCoreCountSelection).toMatchObject({
      min: 0,
      max: 1,
      effectKind: "explicit_soul_core",
    });

    const after = resolveWith(gen, 1);
    const alice = after.players.find((p) => p.id === ALICE)!;
    const source = after.cardInstances.find(
      (card) => card.instanceId === "soul-src"
    )!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "soul-src",
    });
    expect(source.normalCoreCount).toBe(1);
    expect(source.soulCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
  });
});
