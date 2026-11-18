/**
 * P3-88 (field 源): 「相手のフィールドのコアN個まで」の under-selection。
 *
 * core_move から field 源 + amount {min,max} で pendingCoreShootSelection を生成し、
 * minTotal〜totalAmount の範囲でプレイヤーが取得数を選べる（N 未満も可）。
 * 代表カード: BSLH01-TR04(A)「相手のフィールドのコア2個までをトラッシュに置く」。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

const fieldToTrashUpTo2: Effect = {
  timing: { kind: "activated", mode: "main" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "field", player: "opponent" },
        to: { kind: "trash", player: "opponent" },
        amount: { min: 0, max: 2 },
      },
    },
  ],
};

function setup(): {
  state: GameState;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const srcDef = spiritDef("SRC");
  const tgtDef = spiritDef("TGT");
  const src = createCardInstance(srcDef, {
    instanceId: "src",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  // bob のフィールドスピリット（3 コア）。under-selection なので候補1つでも pending 化。
  const tgt = createCardInstance(tgtDef, {
    instanceId: "tgt",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 3,
  });
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [src, tgt],
  });
  const defs = new Map([
    ["SRC", srcDef],
    ["TGT", tgtDef],
  ]);
  return { state, getDef: (id) => defs.get(id) };
}

function generate(): {
  state: GameState;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const ctx = setup();
  const result = executeEffect({
    chainId: "test:core-shoot-under-selection:88",
    state: ctx.state,
    effect: fieldToTrashUpTo2,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: ctx.getDef,
  });
  return { state: result, getDef: ctx.getDef };
}

function resolveWith(
  ctx: { state: GameState; getDef: (id: string) => CardDefinition | undefined },
  distribution: Record<string, number>
): GameState {
  const actions = getLegalActions({
    state: ctx.state,
    actingPlayerId: ALICE,
    getCardDefinitionById: ctx.getDef,
  });
  const action = actions.find((a) => a.kind === "resolve_pending_core_shoot");
  expect(action).toBeDefined();
  return applyLegalAction({
    state: ctx.state,
    action: action!,
    getCardDefinitionById: ctx.getDef,
    coreShootDistribution: distribution,
  }).state;
}

function bobTrash(state: GameState): number {
  return state.players.find((p) => p.id === BOB)!.trashNormalCoreCount;
}
function tgtCores(state: GameState): number {
  return state.cardInstances.find((c) => c.instanceId === "tgt")!
    .normalCoreCount;
}

describe("P3-88 field 源 core_shoot under-selection の生成", () => {
  it("amount {min:0,max:2} で minTotal0/totalAmount2 の pending を生成", () => {
    const ctx = generate();
    expect(ctx.state.pendingCoreShootSelection).not.toBeNull();
    expect(ctx.state.pendingCoreShootSelection!.totalAmount).toBe(2);
    expect(ctx.state.pendingCoreShootSelection!.minTotal).toBe(0);
  });

  it("legal action が minTotal/totalAmount を提示する", () => {
    const ctx = generate();
    const actions = getLegalActions({
      state: ctx.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: ctx.getDef,
    });
    const a = actions.find((x) => x.kind === "resolve_pending_core_shoot");
    expect(a).toMatchObject({ totalAmount: 2, minTotal: 0 });
  });
});

describe("P3-88 field 源 core_shoot under-selection の解決（盤面変化）", () => {
  it("2 個取得（上限）→ 相手スピリット 3→1、相手トラッシュ +2", () => {
    const after = resolveWith(generate(), { tgt: 2 });
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(tgtCores(after)).toBe(1);
    expect(bobTrash(after)).toBe(2);
  });

  it("1 個だけ取得（中間選択）→ 相手スピリット 3→2、相手トラッシュ +1", () => {
    const after = resolveWith(generate(), { tgt: 1 });
    expect(tgtCores(after)).toBe(2);
    expect(bobTrash(after)).toBe(1);
  });

  it("0 個取得（『まで』の最小）→ 盤面不変", () => {
    const after = resolveWith(generate(), { tgt: 0 });
    expect(tgtCores(after)).toBe(3);
    expect(bobTrash(after)).toBe(0);
  });

  it("上限超過 (3) はエラー", () => {
    const ctx = generate();
    const actions = getLegalActions({
      state: ctx.state,
      actingPlayerId: ALICE,
      getCardDefinitionById: ctx.getDef,
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    )!;
    expect(() =>
      applyLegalAction({
        state: ctx.state,
        action,
        getCardDefinitionById: ctx.getDef,
        coreShootDistribution: { tgt: 3 },
      })
    ).toThrow();
  });
});
