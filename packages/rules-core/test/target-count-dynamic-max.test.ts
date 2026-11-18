/**
 * 対象選択数の動的*上限* (TargetSpec.count = { min, max: DynamicCount }) の解決テスト。
 *
 * 「自分のカウント2につき相手スピリット1体までを破壊」= count: { min: 0,
 * max: { source: count_value, divisor: 2 } }（端数切捨）の動的上限レンジ
 * (BSTS01-X01 / BSFT01-C01 系統)。
 *
 * 登録時は盤面が無く数値化できないため raw bound を `maxTargetCountDynamic` に保持し、
 * 対象選択を deferred 解決する段階 (スタック窓クローズ後 = `getStackTargetSelection`) で
 * その時点の盤面から `resolveCountBound` により実効上限へ数値化する。
 *
 * ルール正源: 対象選択はコスト支払い + スタック窓クローズ後の解決時
 * (10_rules/08_stack-window-and-priority-loop.md / magic-target-after-stack-window)。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

// 「自分のカウント2につき相手のスピリット1体までを破壊」フラッシュマジック。
const flashDynamicDestroyMagic: CardDefinition = {
  cardNo: "TEST-FLASH-DYN-DESTROY",
  name: "テスト・カウント連動破壊",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [
    "フラッシュ",
    "自分のカウント2につき相手のスピリット1体までを破壊する。",
  ],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: {
                min: 0,
                max: {
                  source: { kind: "count_value", player: "self" },
                  divisor: 2,
                },
              },
            },
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const bobSpirit: CardDefinition = {
  cardNo: "TEST-BOB-SPIRIT-DYN",
  name: "ボブスピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [flashDynamicDestroyMagic, bobSpirit];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => map.get(id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

/** alice の countValue と bob のフィールドスピリット体数を指定して盤面を作る。 */
function baseState(countValue: number, bobSpiritCount: number): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue }, {}],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(flashDynamicDestroyMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      ...Array.from({ length: bobSpiritCount }, (_, i) =>
        createCardInstance(bobSpirit, {
          instanceId: `bob-${i}`,
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        })
      ),
    ],
  };
}

/** use_magic (対象なし) → bob パス で対象選択 pending まで進める。 */
function driveToPending(state: GameState): GameState {
  const useMagic = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1");
  expect(useMagic).toBeDefined();
  const afterUse = applyLegalAction({
    state,
    action: useMagic!,
    ...lookups,
  }).state;
  const pass = getLegalActions({
    state: afterUse,
    actingPlayerId: "bob",
    ...lookups,
  }).find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({ state: afterUse, action: pass!, ...lookups }).state;
}

describe("対象選択数の動的上限 (max = floor(count/2)) を窓クローズ後に解決", () => {
  it("カウント5 → max=floor(5/2)=2 の対象選択 pending (min=0)", () => {
    const afterPass = driveToPending(baseState(5, 4));
    const pending = afterPass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actingPlayerId).toBe("alice");
    expect(pending!.requiredTargetCount).toBe(0);
    expect(pending!.maxTargetCount).toBe(2);
    // 候補は bob の場のスピリット全体。
    expect(pending!.candidateInstanceIds.length).toBe(4);
  });

  it("カウント7 → max=floor(7/2)=3", () => {
    const pending = driveToPending(
      baseState(7, 4)
    ).pendingEffectTargetSelection;
    expect(pending!.maxTargetCount).toBe(3);
  });

  it("動的 max が候補数を上回っても pending は立ち、上限まで選べる", () => {
    // カウント10 → floor=5 だが候補スピリットは2体。上限まで (2体) 選んで破壊できる。
    const afterPass = driveToPending(baseState(10, 2));
    const pending = afterPass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.maxTargetCount).toBe(5);
    expect(pending!.candidateInstanceIds.length).toBe(2);

    const resolve = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolve).toBeDefined();
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolve!,
      targetInstanceIds: ["bob-0", "bob-1"],
      ...lookups,
    }).state;
    // 選んだ2体が破壊されフィールドを離れている。
    expect(
      resolved.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "field"
      ).length
    ).toBe(0);
  });

  it("カウント1 → max=floor(1/2)=0、min=0 で選択余地なし → pending を立てない (空撃ち)", () => {
    const afterPass = driveToPending(baseState(1, 4));
    expect(afterPass.pendingEffectTargetSelection).toBeNull();
    // bob のスピリットは破壊されず全て残る。
    expect(
      afterPass.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "field"
      ).length
    ).toBe(4);
  });
});
