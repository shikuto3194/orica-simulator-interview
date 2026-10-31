/**
 * Engine batch2-5: コアシュート (相手カードのコアをトラッシュ/リザーブ等へ) の対象を
 * CardFilter で限定する。
 *
 * field 源 core_move (`from.kind === "field"`) に optional `filter` (CardFilter) と
 * `minRemainingPerCandidate` (「コアを0個にできない」残数下限) を追加し、
 * analyzeCoreShootCandidates / executeCoreMove の auto-fallback の双方で
 * matchesCardFilter (battleState / maxCost / category / maxCores) を適用する。
 *
 * 代表カード:
 * - BSTS01-M03 / BSTH001-転醒R02(B): category (spirit/ult 限定)
 * - BSSL01-C04: battleState(in_battle) + maxCost
 * - BSTH04-転醒R02(B): battleState(attacking) + 残数下限 (0個にできない)
 *
 * テストは production path（executeEffect → 必要なら getLegalActions/applyLegalAction で
 * pending を最終状態まで解決）で盤面変化を検証する。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { BattleEntity, CardDefinition, GameState } from "../src/model";
import type { Effect, CardFilter } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function makeDef(
  cardNo: string,
  category: CardDefinition["printedCategory"],
  cost: number
): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: category,
    colors: ["red"],
    cost,
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

/** field 源 core_move 効果（filter / minRemaining / amount を可変に組み立てる）。 */
function coreShootEffect(opts: {
  to?: "trash" | "reserve";
  filter?: CardFilter;
  minRemainingPerCandidate?: number;
  amount: number | "all" | { min: number; max: number };
}): Effect {
  const toKind = opts.to ?? "trash";
  return {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: {
            kind: "field",
            player: "opponent",
            ...(opts.filter ? { filter: opts.filter } : {}),
            ...(opts.minRemainingPerCandidate !== undefined
              ? { minRemainingPerCandidate: opts.minRemainingPerCandidate }
              : {}),
          },
          to: { kind: toKind, player: "opponent" },
          amount: opts.amount,
        },
      },
    ],
  };
}

function fieldCard(
  def: CardDefinition,
  instanceId: string,
  owner: string,
  normalCoreCount: number
) {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone: "field",
    normalCoreCount,
  });
}

function cores(state: GameState, id: string): number {
  return state.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount;
}
function bobTrash(state: GameState): number {
  return state.players.find((p) => p.id === BOB)!.trashNormalCoreCount;
}

/** alice の発動元スピリット (常に 1 コア) を含む defs/getter を組み立てる。 */
function defsWithSource(extra: Array<[string, CardDefinition]>): {
  srcDef: CardDefinition;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const srcDef = makeDef("SRC", "spirit", 3);
  const map = new Map<string, CardDefinition>([["SRC", srcDef], ...extra]);
  return { srcDef, getDef: (id) => map.get(id) };
}

function run(
  effect: Effect,
  cardInstances: GameState["cardInstances"],
  getDef: (id: string) => CardDefinition | undefined,
  battleEntities: BattleEntity[] = []
): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    battleEntities,
  });
  return executeEffect({
    chainId: "test:coreshoot-filtered-target:124",
    state,
    effect,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

// ─────────────────────────────────────────────────────────────
// category filter (BSTS01-M03 / BSTH001-転醒R02(B))
// ─────────────────────────────────────────────────────────────
describe("coreshoot category filter: spirit/ult のみ対象", () => {
  it("nexus はフィルタで除外され、spirit のみがコアを取られる (auto-resolve, 単一候補)", () => {
    const spiritDef = makeDef("SP", "spirit", 4);
    const nexusDef = makeDef("NX", "nexus", 4);
    const { srcDef, getDef } = defsWithSource([
      ["SP", spiritDef],
      ["NX", nexusDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spiritDef, "sp", BOB, 3);
    const nx = fieldCard(nexusDef, "nx", BOB, 3);
    const after = run(
      coreShootEffect({
        amount: 3,
        filter: { category: ["spirit", "ultimate"] },
      }),
      [src, sp, nx],
      getDef
    );
    // フィルタ後の候補は spirit 1 つ (合計3=amount) → pending 不要で自動解決。
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "sp")).toBe(0); // spirit から 3 個
    expect(cores(after, "nx")).toBe(3); // nexus は不変
    expect(bobTrash(after)).toBe(3);
  });

  it("spirit と ultimate の 2 候補 → pending 化、nexus は候補に含まれない", () => {
    const spiritDef = makeDef("SP", "spirit", 4);
    const ultDef = makeDef("UL", "ultimate", 6);
    const nexusDef = makeDef("NX", "nexus", 4);
    const { srcDef, getDef } = defsWithSource([
      ["SP", spiritDef],
      ["UL", ultDef],
      ["NX", nexusDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spiritDef, "sp", BOB, 3);
    const ul = fieldCard(ultDef, "ul", BOB, 3);
    const nx = fieldCard(nexusDef, "nx", BOB, 3);
    const generated = run(
      coreShootEffect({
        amount: 3,
        filter: { category: ["spirit", "ultimate"] },
      }),
      [src, sp, ul, nx],
      getDef
    );
    const pending = generated.pendingCoreShootSelection;
    expect(pending).not.toBeNull();
    const candidateIds = pending!.candidates.map((c) => c.instanceId).sort();
    expect(candidateIds).toEqual(["sp", "ul"]); // nexus 除外
  });
});

// ─────────────────────────────────────────────────────────────
// battleState filter (BSSL01-C04 / BSTH04-転醒R02(B))
// ─────────────────────────────────────────────────────────────
describe("coreshoot battleState filter: バトル中のカードのみ対象", () => {
  function battleSetup() {
    const inBattleDef = makeDef("IB", "spirit", 3);
    const idleDef = makeDef("ID", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([
      ["IB", inBattleDef],
      ["ID", idleDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const ib = fieldCard(inBattleDef, "ib", BOB, 3);
    const id = fieldCard(idleDef, "id", BOB, 3);
    // ib のみブロック中の battle entity に所属させる。
    const entities: BattleEntity[] = [
      {
        entityId: "be-ib",
        memberInstanceIds: ["ib"],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "blocking",
      },
    ];
    return { srcDef, getDef, src, ib, id, entities };
  }

  it("in_battle: バトル中 (ブロック中) のスピリットのみコアを取られる", () => {
    const s = battleSetup();
    const after = run(
      coreShootEffect({ amount: 3, filter: { battleState: "in_battle" } }),
      [s.src, s.ib, s.id],
      s.getDef,
      s.entities
    );
    expect(after.pendingCoreShootSelection).toBeNull(); // 候補 1 → 自動解決
    expect(cores(after, "ib")).toBe(0); // バトル中 → 全取り
    expect(cores(after, "id")).toBe(3); // 非バトル → 不変
  });

  it("attacking: ブロック中カードは attacking フィルタにマッチせず候補0 (盤面不変)", () => {
    const s = battleSetup();
    const after = run(
      coreShootEffect({ amount: 1, filter: { battleState: "attacking" } }),
      [s.src, s.ib, s.id],
      s.getDef,
      s.entities
    );
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "ib")).toBe(3);
    expect(cores(after, "id")).toBe(3);
    expect(bobTrash(after)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// maxCost filter (BSSL01-C04: 本来コスト3以下)
// ─────────────────────────────────────────────────────────────
describe("coreshoot maxCost filter: 本来コストN以下のみ対象", () => {
  it("maxCost:3 → コスト3以下のみコアを取られ、高コストは不変", () => {
    const lowDef = makeDef("LO", "spirit", 3);
    const highDef = makeDef("HI", "spirit", 6);
    const { srcDef, getDef } = defsWithSource([
      ["LO", lowDef],
      ["HI", highDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const lo = fieldCard(lowDef, "lo", BOB, 2);
    const hi = fieldCard(highDef, "hi", BOB, 2);
    const after = run(
      coreShootEffect({ amount: "all", filter: { maxCost: 3 } }),
      [src, lo, hi],
      getDef
    );
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "lo")).toBe(0); // コスト3 → all 取り
    expect(cores(after, "hi")).toBe(2); // コスト6 → 不変
    expect(bobTrash(after)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// amount = all vs N
// ─────────────────────────────────────────────────────────────
describe("coreshoot amount = all vs N (フィルタ付き)", () => {
  it("amount:'all' → 単一候補スピリットのコア全部を取る (BSSL01-C04 コアすべて)", () => {
    const spDef = makeDef("SP", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([["SP", spDef]]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spDef, "sp", BOB, 4);
    const after = run(
      coreShootEffect({
        amount: "all",
        filter: { category: ["spirit", "ultimate"] },
      }),
      [src, sp],
      getDef
    );
    expect(cores(after, "sp")).toBe(0);
    expect(bobTrash(after)).toBe(4);
  });

  it("amount:N (2) → フィルタ後単一候補から N 個だけ取る (BSTH001-R02(B) コア2個)", () => {
    const spDef = makeDef("SP", "spirit", 3);
    const nxDef = makeDef("NX", "nexus", 3);
    const { srcDef, getDef } = defsWithSource([
      ["SP", spDef],
      ["NX", nxDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spDef, "sp", BOB, 4);
    const nx = fieldCard(nxDef, "nx", BOB, 4);
    const after = run(
      coreShootEffect({
        amount: 2,
        to: "reserve",
        filter: { category: ["spirit", "ultimate"] },
      }),
      [src, sp, nx],
      getDef
    );
    expect(after.pendingCoreShootSelection).toBeNull(); // 候補1 (合計4>2 だが単一) → 自動
    expect(cores(after, "sp")).toBe(2); // 4→2
    expect(cores(after, "nx")).toBe(4); // nexus 不変
    // BOB の初期リザーブ 4 + 取得 2 = 6。
    expect(bobReserve(after)).toBe(STARTING_RESERVE + 2);
  });
});

const STARTING_RESERVE = 4;
function bobReserve(state: GameState): number {
  return state.players.find((p) => p.id === BOB)!.reserveNormalCoreCount;
}

// ─────────────────────────────────────────────────────────────
// min-remaining ガード (BSTH04-転醒R02(B): 0個にできない)
// ─────────────────────────────────────────────────────────────
describe("coreshoot minRemainingPerCandidate: コアを0個にできない", () => {
  it("minRemaining:1 + amount:1 → コア1個のカードは候補外、コア2個のカードのみ対象 (auto)", () => {
    const oneCoreDef = makeDef("ONE", "spirit", 3);
    const twoCoreDef = makeDef("TWO", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([
      ["ONE", oneCoreDef],
      ["TWO", twoCoreDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const one = fieldCard(oneCoreDef, "one", BOB, 1); // 取ると 0 → 除外
    const two = fieldCard(twoCoreDef, "two", BOB, 2); // 取っても 1 残る → 対象
    const after = run(
      coreShootEffect({
        amount: 1,
        filter: { battleState: undefined },
        minRemainingPerCandidate: 1,
      }),
      [src, one, two],
      getDef
    );
    // 取れる候補は two のみ (合計 takeable=1=amount) → 自動解決。
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "one")).toBe(1); // 不変 (候補外)
    expect(cores(after, "two")).toBe(1); // 2→1 (1個取得、1個残す)
    expect(bobTrash(after)).toBe(1);
  });

  it("minRemaining:1 + amount:1 + 全カードがコア1個 → 候補0で盤面不変", () => {
    const aDef = makeDef("A", "spirit", 3);
    const bDef = makeDef("B", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([
      ["A", aDef],
      ["B", bDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const a = fieldCard(aDef, "a", BOB, 1);
    const b = fieldCard(bDef, "b", BOB, 1);
    const after = run(
      coreShootEffect({ amount: 1, minRemainingPerCandidate: 1 }),
      [src, a, b],
      getDef
    );
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "a")).toBe(1);
    expect(cores(after, "b")).toBe(1);
    expect(bobTrash(after)).toBe(0);
  });

  it("minRemaining:1 pending: 2候補とも availableCores が残数下限を反映 (3コア→takeable2)", () => {
    const aDef = makeDef("A", "spirit", 3);
    const bDef = makeDef("B", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([
      ["A", aDef],
      ["B", bDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const a = fieldCard(aDef, "a", BOB, 3);
    const b = fieldCard(bDef, "b", BOB, 3);
    // amount 1, 候補2 (合計 takeable=4>1) → pending。
    const generated = run(
      coreShootEffect({ amount: 1, minRemainingPerCandidate: 1 }),
      [src, a, b],
      getDef
    );
    const pending = generated.pendingCoreShootSelection;
    expect(pending).not.toBeNull();
    for (const cand of pending!.candidates) {
      expect(cand.availableCores).toBe(2); // 3 - minRemaining(1)
    }
    // pending 解決: a から 1 個取る → a 3→2 (残数下限 1 を満たす)。
    const actions = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const action = actions.find(
      (x) => x.kind === "resolve_pending_core_shoot"
    )!;
    const after = applyLegalAction({
      state: generated,
      action,
      getCardDefinitionById: getDef,
      coreShootDistribution: { a: 1 },
    }).state;
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "a")).toBe(2);
    expect(cores(after, "b")).toBe(3);
    expect(bobTrash(after)).toBe(1);
  });

  it("minRemaining:1 pending: 残数下限を割る分配 (availableCores 超過) はエラー", () => {
    const aDef = makeDef("A", "spirit", 3);
    const bDef = makeDef("B", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([
      ["A", aDef],
      ["B", bDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const a = fieldCard(aDef, "a", BOB, 3);
    const b = fieldCard(bDef, "b", BOB, 3);
    // amount 3, 候補2 (takeable 各2, 合計4>3) → pending。
    const generated = run(
      coreShootEffect({ amount: 3, minRemainingPerCandidate: 1 }),
      [src, a, b],
      getDef
    );
    expect(generated.pendingCoreShootSelection).not.toBeNull();
    const actions = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const action = actions.find(
      (x) => x.kind === "resolve_pending_core_shoot"
    )!;
    // a から 3 個 (= 全部、残 0) は availableCores(2) 超過 → エラー。
    expect(() =>
      applyLegalAction({
        state: generated,
        action,
        getCardDefinitionById: getDef,
        coreShootDistribution: { a: 3 },
      })
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// 回帰: フィルタ無しは従来挙動
// ─────────────────────────────────────────────────────────────
describe("coreshoot no-filter 回帰: 従来挙動を維持", () => {
  it("filter 無し → nexus も含め全フィールドカードが対象 (auto, 合計=amount)", () => {
    const spDef = makeDef("SP", "spirit", 3);
    const nxDef = makeDef("NX", "nexus", 3);
    const { srcDef, getDef } = defsWithSource([
      ["SP", spDef],
      ["NX", nxDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spDef, "sp", BOB, 2);
    const nx = fieldCard(nxDef, "nx", BOB, 1);
    // 合計3=amount → 自動で全カードから取る。
    const after = run(coreShootEffect({ amount: 3 }), [src, sp, nx], getDef);
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "sp") + cores(after, "nx")).toBe(0); // 両方から取る
    expect(bobTrash(after)).toBe(3);
  });

  it("filter 無し + 2候補で合計>amount → 従来どおり pending 化", () => {
    const aDef = makeDef("A", "spirit", 3);
    const bDef = makeDef("B", "spirit", 3);
    const { srcDef, getDef } = defsWithSource([
      ["A", aDef],
      ["B", bDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const a = fieldCard(aDef, "a", BOB, 3);
    const b = fieldCard(bDef, "b", BOB, 3);
    const generated = run(coreShootEffect({ amount: 2 }), [src, a, b], getDef);
    const pending = generated.pendingCoreShootSelection;
    expect(pending).not.toBeNull();
    expect(pending!.candidates.map((c) => c.instanceId).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(pending!.candidates.every((c) => c.availableCores === 3)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// end-to-end: getLegalActions / applyLegalAction で 2 候補から選択
// ─────────────────────────────────────────────────────────────
describe("coreshoot end-to-end: フィルタ後 2 候補から分配選択", () => {
  it("category フィルタ後 spirit/ult の 2 候補から amount 個を分配し最終盤面まで解決", () => {
    const spDef = makeDef("SP", "spirit", 4);
    const ulDef = makeDef("UL", "ultimate", 6);
    const nxDef = makeDef("NX", "nexus", 4);
    const { srcDef, getDef } = defsWithSource([
      ["SP", spDef],
      ["UL", ulDef],
      ["NX", nxDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spDef, "sp", BOB, 3);
    const ul = fieldCard(ulDef, "ul", BOB, 3);
    const nx = fieldCard(nxDef, "nx", BOB, 3);
    const generated = run(
      coreShootEffect({
        amount: 3,
        filter: { category: ["spirit", "ultimate"] },
      }),
      [src, sp, ul, nx],
      getDef
    );
    expect(generated.pendingCoreShootSelection).not.toBeNull();

    const actions = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const action = actions.find((x) => x.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();

    // sp から 2、ul から 1 (合計 3 = amount)。nexus は触れない。
    const after = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById: getDef,
      coreShootDistribution: { sp: 2, ul: 1 },
    }).state;

    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "sp")).toBe(1); // 3→1
    expect(cores(after, "ul")).toBe(2); // 3→2
    expect(cores(after, "nx")).toBe(3); // 不変 (フィルタ外)
    expect(bobTrash(after)).toBe(3);
  });

  it("候補外 (nexus) への分配はエラー", () => {
    const spDef = makeDef("SP", "spirit", 4);
    const ulDef = makeDef("UL", "ultimate", 6);
    const nxDef = makeDef("NX", "nexus", 4);
    const { srcDef, getDef } = defsWithSource([
      ["SP", spDef],
      ["UL", ulDef],
      ["NX", nxDef],
    ]);
    const src = fieldCard(srcDef, "src", ALICE, 1);
    const sp = fieldCard(spDef, "sp", BOB, 3);
    const ul = fieldCard(ulDef, "ul", BOB, 3);
    const nx = fieldCard(nxDef, "nx", BOB, 3);
    const generated = run(
      coreShootEffect({
        amount: 3,
        filter: { category: ["spirit", "ultimate"] },
      }),
      [src, sp, ul, nx],
      getDef
    );
    const actions = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const action = actions.find(
      (x) => x.kind === "resolve_pending_core_shoot"
    )!;
    expect(() =>
      applyLegalAction({
        state: generated,
        action,
        getCardDefinitionById: getDef,
        coreShootDistribution: { nx: 3 },
      })
    ).toThrow();
  });
});
