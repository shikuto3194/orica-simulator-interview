/**
 * トラッシュ→フィールドのコア配分テスト（BSTH01-M01 パチュリー Lv2-Lv3 効果対応）。
 *
 * - 候補が複数 / ソウルコアがトラッシュにある場合 → pendingCoreDistribution に遷移する
 * - applyLegalAction(resolve_pending_core_distribution) で配分を確定
 * - ソウルコアもトラッシュにあれば配置可能（≪ソウルコア≫以外指定なし）
 * - 候補が 1 枚かつソウルコア無しの場合は自動配置（pending 不要）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "紅魔",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

const trashToFieldAllEffect: Effect = {
  timing: { kind: "phase", step: "attack", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "trash", player: "self" },
        to: { kind: "field", player: "self" },
        amount: "all",
      },
    },
  ],
};

const trashToFieldOneEffect: Effect = {
  timing: { kind: "phase", step: "attack", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "trash", player: "self" },
        to: { kind: "field", player: "self" },
        amount: 1,
      },
    },
  ],
};

describe("core_move trash→field 配分", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("フィールドに 1 枚 + ソウルコア無し → 自動配置（pending 不要）", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const card = makeInstance(def, {
      instanceId: "p1",
      everHadCorePlaced: false,
    });
    let state = makeState([card]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 3 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:112",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
    const after = result.cardInstances.find((c) => c.instanceId === "p1")!;
    expect(after.normalCoreCount).toBe(1 + 3);
    expect(after.everHadCorePlaced).toBe(true);
    const aliceAfter = result.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
  });

  it("フィールドに 2 枚 → pendingCoreDistribution に遷移", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    const c2 = makeInstance(def, { instanceId: "p2" });
    let state = makeState([c1, c2]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 4 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:141",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.totalNormalCores).toBe(4);
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(false);
    expect(result.pendingCoreDistribution!.candidates).toHaveLength(2);

    // applyLegalAction で配分を解決
    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    );
    expect(cdAction).toBeDefined();

    const applied = applyLegalAction({
      state: result,
      action: cdAction!,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { p1: 3, p2: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const ap1 = applied.state.cardInstances.find((c) => c.instanceId === "p1")!;
    const ap2 = applied.state.cardInstances.find((c) => c.instanceId === "p2")!;
    expect(ap1.normalCoreCount).toBe(1 + 3);
    expect(ap2.normalCoreCount).toBe(1 + 1);
    expect(ap1.everHadCorePlaced).toBe(true);
    expect(ap2.everHadCorePlaced).toBe(true);
    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
  });

  it("ソウルコアがトラッシュにある場合 hasSoulCore=true で pending に遷移し、配置先を選択できる", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    let state = makeState([c1]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              trashNormalCoreCount: 2,
              reserveSoulCoreCount: 0,
              trashSoulCoreCount: 1,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:203",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(true);
    expect(result.pendingCoreDistribution!.totalNormalCores).toBe(2);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { p1: 2 },
      coreDistributionSoulCoreInstanceId: "p1",
    });

    const ap1 = applied.state.cardInstances.find((c) => c.instanceId === "p1")!;
    expect(ap1.normalCoreCount).toBe(1 + 2);
    expect(ap1.everHadCorePlaced).toBe(true);
    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "p1",
    });
  });

  it("finite generic は通常コアが足りていてもソウルコアを候補に含め、合計上限を守る", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    let state = makeState([c1]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              trashNormalCoreCount: 1,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:261",
      state,
      effect: trashToFieldOneEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.totalNormalCores).toBe(1);
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(true);
    expect(result.pendingCoreDistribution!.maxTotal).toBe(1);
    const cdAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 1 },
        coreDistributionSoulCoreInstanceId: "p1",
      })
    ).toThrow(/exceeds maximum 1/);

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreInstanceId: "p1",
    });
    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(1);
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "p1",
    });
  });

  it("direct coreDistributionAllocations でも amount='all' は通常コア全数未満を拒否する", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    const c2 = makeInstance(def, { instanceId: "p2" });
    let state = makeState([c1, c2]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 3 } : p
      ),
    };

    expect(() =>
      executeEffect({
        chainId: "test:core-distribution-trash-to-field:317",
        state,
        effect: trashToFieldAllEffect,
        sourceInstanceId: "p1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 1, p2: 0 },
      })
    ).toThrow(/below minimum 3/);

    const applied = executeEffect({
      chainId: "test:core-distribution-trash-to-field:327",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { p1: 2, p2: 1 },
    });
    expect(applied.pendingCoreDistribution).toBeNull();
    expect(
      applied.cardInstances.find((c) => c.instanceId === "p1")!.normalCoreCount
    ).toBe(3);
    expect(
      applied.cardInstances.find((c) => c.instanceId === "p2")!.normalCoreCount
    ).toBe(2);
    expect(
      applied.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(0);
  });

  it("direct coreDistributionAllocations でも amount='all' はソウルコア未配置を拒否する", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    const c2 = makeInstance(def, { instanceId: "p2" });
    let state = makeState([c1, c2]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              trashNormalCoreCount: 2,
              reserveSoulCoreCount: 0,
              trashSoulCoreCount: 1,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };

    expect(() =>
      executeEffect({
        chainId: "test:core-distribution-trash-to-field:368",
        state,
        effect: trashToFieldAllEffect,
        sourceInstanceId: "p1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 2, p2: 0 },
      })
    ).toThrow(/Soul core in trash must be placed/);

    const applied = executeEffect({
      chainId: "test:core-distribution-trash-to-field:379",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { p1: 2, p2: 0 },
      coreDistributionSoulCoreInstanceId: "p2",
    });
    expect(applied.pendingCoreDistribution).toBeNull();
    expect(
      applied.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(0);
    expect(
      applied.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({
      kind: "card",
      instanceId: "p2",
    });
  });

  it("amount='all' で部分配分 (合計 < totalNormalCores) はエラー（コアすべて配置義務）", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    const c2 = makeInstance(def, { instanceId: "p2" });
    let state = makeState([c1, c2]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 3 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:413",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(result.pendingCoreDistribution?.minTotal).toBe(3);
    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    // 0 配分は minTotal=3 を満たさずエラー
    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 0, p2: 0 },
      })
    ).toThrow(/below minimum/);

    // 合計 2 (< 3) もエラー
    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 2, p2: 0 },
      })
    ).toThrow(/below minimum/);

    // 全数 (3) なら通る
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { p1: 2, p2: 1 },
    });
    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
  });

  it("amount='all' + ソウルコアあり: soulCoreInstanceId 未指定で完了するとエラー", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    const c2 = makeInstance(def, { instanceId: "p2" });
    let state = makeState([c1, c2]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              trashNormalCoreCount: 2,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:480",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(result.pendingCoreDistribution?.hasSoulCore).toBe(true);
    expect(result.pendingCoreDistribution?.mustPlaceSoulCore).toBe(true);
    expect(result.pendingCoreDistribution?.minTotal).toBe(2);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    // 通常コアは全数置いたがソウルコア配置先未指定 → エラー
    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 2, p2: 0 },
      })
    ).toThrow(/Soul core in trash must be placed/);

    // ソウルコアを置いても、通常コアを残す部分解決は「コアすべて」を満たさない
    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 1, p2: 0 },
        coreDistributionSoulCoreInstanceId: "p1",
      })
    ).toThrow(/all-normal total 2/);

    // ソウルコア配置先を指定すれば通る
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { p1: 2, p2: 0 },
      coreDistributionSoulCoreInstanceId: "p1",
    });
    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "p1",
    });
    expect(
      applied.state.cardInstances.find((c) => c.instanceId === "p1")!
        .everHadCorePlaced
    ).toBe(true);
  });

  it("配分合計が totalNormalCores を超えるとエラー", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    const c2 = makeInstance(def, { instanceId: "p2" });
    let state = makeState([c1, c2]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 2 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:554",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { p1: 2, p2: 1 },
      })
    ).toThrow(/exceeds available/);
  });

  it("to=field_card フィルタ指定で候補が絞り込まれる（系統:紅魔のみ）", () => {
    const koumaDef = makeDef({ cardNo: "KOUMA", tribe: "紅魔" });
    const otherDef = makeDef({ cardNo: "OTHER", tribe: "界渡" });
    const nexusDef = makeDef({
      cardNo: "NEXUS",
      printedCategory: "nexus",
      tribe: "紅魔",
    });
    registerDef(koumaDef);
    registerDef(otherDef);
    registerDef(nexusDef);
    const kouma = createCardInstance(koumaDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const other = createCardInstance(otherDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const nexus = createCardInstance(nexusDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const koumaInst: CardInstance = { ...kouma, instanceId: "kouma" };
    const otherInst: CardInstance = { ...other, instanceId: "other" };
    const nexusInst: CardInstance = { ...nexus, instanceId: "nexus" };
    let state = makeState([koumaInst, otherInst, nexusInst]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 3 } : p
      ),
    };

    const filteredEffect: Effect = {
      timing: { kind: "phase", step: "attack", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: {
              kind: "field_card",
              player: "self",
              filter: { category: ["spirit"], tribes: ["紅魔"] },
            },
            amount: "all",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:635",
      state,
      effect: filteredEffect,
      sourceInstanceId: "kouma",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // 紅魔スピリット 1 枚のみ → pending 不要で自動配置
    expect(result.pendingCoreDistribution).toBeNull();
    const koumaAfter = result.cardInstances.find(
      (c) => c.instanceId === "kouma"
    )!;
    const otherAfter = result.cardInstances.find(
      (c) => c.instanceId === "other"
    )!;
    const nexusAfter = result.cardInstances.find(
      (c) => c.instanceId === "nexus"
    )!;
    expect(koumaAfter.normalCoreCount).toBe(1 + 3);
    expect(otherAfter.normalCoreCount).toBe(1);
    expect(nexusAfter.normalCoreCount).toBe(1);
    const aliceAfter = result.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.trashNormalCoreCount).toBe(0);
  });

  it("to=field_card フィルタ指定で複数候補 → pendingCoreDistribution に絞り込んだ候補のみ", () => {
    const koumaDef = makeDef({ cardNo: "KOUMA", tribe: "紅魔" });
    const otherDef = makeDef({ cardNo: "OTHER", tribe: "界渡" });
    registerDef(koumaDef);
    registerDef(otherDef);
    const k1 = createCardInstance(koumaDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const k2 = createCardInstance(koumaDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const o1 = createCardInstance(otherDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const k1Inst: CardInstance = { ...k1, instanceId: "k1" };
    const k2Inst: CardInstance = { ...k2, instanceId: "k2" };
    const o1Inst: CardInstance = { ...o1, instanceId: "o1" };
    let state = makeState([k1Inst, k2Inst, o1Inst]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 4 } : p
      ),
    };

    const filteredEffect: Effect = {
      timing: { kind: "phase", step: "attack", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "trash", player: "self" },
            to: {
              kind: "field_card",
              player: "self",
              filter: { category: ["spirit"], tribes: ["紅魔"] },
            },
            amount: "all",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:710",
      state,
      effect: filteredEffect,
      sourceInstanceId: "k1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    const candidateIds = result.pendingCoreDistribution!.candidates.map(
      (c) => c.instanceId
    );
    expect(candidateIds).toEqual(expect.arrayContaining(["k1", "k2"]));
    expect(candidateIds).not.toContain("o1");
    expect(candidateIds).toHaveLength(2);
  });

  it("ソウルコアのみトラッシュ・通常コア 0 でも配置できる", () => {
    const def = makeDef({ cardNo: "P1" });
    registerDef(def);
    const c1 = makeInstance(def, { instanceId: "p1" });
    let state = makeState([c1]);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              trashNormalCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribution-trash-to-field:745",
      state,
      effect: trashToFieldAllEffect,
      sourceInstanceId: "p1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.totalNormalCores).toBe(0);
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(true);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreInstanceId: "p1",
    });

    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "p1",
    });
  });
});
