/**
 * core_distribute mode="one_each" engine primitive 単体テスト。
 *
 * 「ボイドからコア1個ずつをN体に置く」型の正源モード:
 * - 各ターゲットに 1 個ずつ配置 (均等分配ではない)
 * - 実配置数 = min(amount, targetIds.length, available_cores)
 * - from=void/reserve/trash は available_cores キャップ + 減算
 *
 * structured-effect-registrations は core_distribute の field targeting を公開する。
 * 本テストは primitive の executeCoreDistribute 内部挙動 (候補==count /
 * 候補<count / 源不足 / 候補 0) を engine-isolated に検証する。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

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
    tribe: "CB",
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
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(
  cards: CardInstance[],
  opts: { reserve?: number; trash?: number } = {}
): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    activePlayerId: ALICE,
    players: state.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            reserveNormalCoreCount: opts.reserve ?? 0,
            trashNormalCoreCount: opts.trash ?? 0,
          }
        : p
    ),
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

describe('core_distribute mode="one_each"', () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  // engine primitive: 候補==count のとき各 1 個配置
  it("count=3 + 候補ちょうど 3 体: 各 1 個 (合計 3 個、均等分配の 1 ずつではない)", () => {
    const def = makeDef({ cardNo: "CB_SP", tribe: "幻想・風神" });
    registerDef(def);
    // 候補ちょうど 3 体 (filter は host を含まない: host tribe='CB' で対象外)
    const host = makeDef({ cardNo: "HOST", tribe: "CB" });
    registerDef(host);
    const hostInst = makeInstance(host, { instanceId: "host" });
    const s1 = makeInstance(def, { instanceId: "sp1" });
    const s2 = makeInstance(def, { instanceId: "sp2" });
    const s3 = makeInstance(def, { instanceId: "sp3" });
    const state = makeState([hostInst, s1, s2, s3]);

    const fixed3: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "void", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"], tribes: ["幻想", "風神"] },
              count: 3,
            },
            amount: 3,
            mode: "one_each",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-one-each:130",
      state,
      effect: fixed3,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    // 候補 3 体それぞれが +1 個 (元 1 個 + 1 = 2 個)。host は対象外で 1 個のまま。
    const cores = ["host", "sp1", "sp2", "sp3"]
      .map(
        (id) =>
          result.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount
      )
      .sort();
    expect(cores).toEqual([1, 2, 2, 2]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "host")!
        .everHadCorePlaced
    ).toBe(false);
    for (const id of ["sp1", "sp2", "sp3"]) {
      expect(
        result.cardInstances.find((c) => c.instanceId === id)!.everHadCorePlaced
      ).toBe(true);
    }
    // ボイド源は player の voidNormalCoreCount を減らし、reserve は不変
    expect(
      result.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
    ).toBe(state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount - 3);
    expect(
      result.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(0);
  });

  it("mode=even でもコア配置ラッチ everHadCorePlaced を更新する", () => {
    const def = makeDef({ cardNo: "CB_SP" });
    registerDef(def);
    const host = makeInstance(def, { instanceId: "host", normalCoreCount: 1 });
    const s1 = makeInstance(def, { instanceId: "sp1", normalCoreCount: 1 });
    const s2 = makeInstance(def, { instanceId: "sp2", normalCoreCount: 1 });
    const state = makeState([host, s1, s2]);

    const evenEffect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "void", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"], tribes: ["CB"] },
              count: 2,
            },
            amount: 2,
            mode: "even",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-one-each:192",
      state,
      effect: evenEffect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["sp1", "sp2"],
    });

    for (const id of ["sp1", "sp2"]) {
      const card = result.cardInstances.find((c) => c.instanceId === id)!;
      expect(card.normalCoreCount).toBe(2);
      expect(card.everHadCorePlaced).toBe(true);
    }
  });

  it("count=N でも候補が N 体未満なら available 体だけ配置 ('even' との差異検証)", () => {
    // amount=4 / count=4 だが候補 2 体: even なら 2 ずつ (合計 4 個 = 元意図と異なる)、
    // one_each なら 1 ずつ (合計 2 個 = 「1個ずつ」忠実)
    const def = makeDef({ cardNo: "CB_SP" });
    registerDef(def);
    const host = makeInstance(def, { instanceId: "host", normalCoreCount: 1 });
    const s1 = makeInstance(def, { instanceId: "sp1", normalCoreCount: 1 });
    const s2 = makeInstance(def, { instanceId: "sp2", normalCoreCount: 1 });
    const state = makeState([host, s1, s2]);

    const oneEach: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "void", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"], tribes: ["CB"] },
              count: 4,
            },
            amount: 4,
            mode: "one_each",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-one-each:238",
      state,
      effect: oneEach,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    // 候補 3 体それぞれが +1 = 各 2 個 ('even' なら +1.33 切り捨て=各1個or各2個に偏る挙動)
    const cores = ["host", "sp1", "sp2"]
      .map(
        (id) =>
          result.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount
      )
      .sort();
    expect(cores).toEqual([2, 2, 2]);
  });

  it("from=reserve: reserve コア不足時は配置数を available にキャップ", () => {
    const def = makeDef({ cardNo: "CB_SP" });
    registerDef(def);
    const host = makeInstance(def, { instanceId: "host", normalCoreCount: 1 });
    const s1 = makeInstance(def, { instanceId: "sp1", normalCoreCount: 1 });
    const s2 = makeInstance(def, { instanceId: "sp2", normalCoreCount: 1 });
    // 候補 3 体だが reserve=1 のみ
    const state = makeState([host, s1, s2], { reserve: 1 });

    const reserveEffect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"], tribes: ["CB"] },
              count: 3,
            },
            amount: 3,
            mode: "one_each",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-one-each:285",
      state,
      effect: reserveEffect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    // 配置数 = min(amount=3, targets=3, reserve=1) = 1 個
    const cores = ["host", "sp1", "sp2"]
      .map(
        (id) =>
          result.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount
      )
      .sort();
    // 1 個だけ配置: 一体が +1 になる
    expect(cores.filter((n) => n === 2).length).toBe(1);
    expect(cores.filter((n) => n === 1).length).toBe(2);
    // reserve は 1→0 に減る
    expect(
      result.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(0);
  });

  it("候補 0 体: 何も置かず state は不変", () => {
    const def = makeDef({ cardNo: "CB_SP", tribe: "他系統" });
    registerDef(def);
    // CB 系統を持たない host のみ
    const host = makeInstance(def, { instanceId: "host", normalCoreCount: 1 });
    const state = makeState([host]);

    const oneEach: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "void", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"], tribes: ["CB"] },
              count: 3,
            },
            amount: 3,
            mode: "one_each",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-one-each:336",
      state,
      effect: oneEach,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === "host")!.normalCoreCount
    ).toBe(1);
  });

  it("redirect_effect_target は one_each の複数対象を同じカード1体へ collapse する", () => {
    const sourceDef = makeDef({ cardNo: "CORE-SOURCE", tribe: "術者" });
    const targetDef = makeDef({ cardNo: "PROTECTED-CB", tribe: "CB" });
    const redirectDef = makeDef({ cardNo: "SHIELD-LIKE", tribe: "盾士" });
    registerDef(sourceDef);
    registerDef(targetDef);
    registerDef(redirectDef);

    const source = makeInstance(sourceDef, {
      instanceId: "source",
      normalCoreCount: 1,
    });
    const sp1 = makeInstance(targetDef, {
      instanceId: "sp1",
      normalCoreCount: 1,
    });
    const sp2 = makeInstance(targetDef, {
      instanceId: "sp2",
      normalCoreCount: 1,
    });
    const shield = makeInstance(redirectDef, {
      instanceId: "shield",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      normalCoreCount: 1,
    });
    const redirectCe: ContinuousEffect = {
      effectId: "ce-shield-like",
      sourceInstanceId: "shield",
      sourceDefinitionId: redirectDef.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "any",
          protectedTargetKind: "instances",
          protectedInstanceIds: ["sp1", "sp2"],
        },
        redirectCandidateSource: {
          kind: "explicit",
          instanceIds: ["shield"],
        },
        optional: true,
      } as Record<string, unknown>,
    };
    const state = {
      ...makeState([source, sp1, sp2, shield]),
      activeContinuousEffects: [redirectCe],
    };

    const effect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "void", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"], tribes: ["CB"] },
              count: 2,
            },
            amount: 2,
            mode: "one_each",
          },
        },
      ],
    };
    registerDef({ ...sourceDef, effects: [effect] });

    const beforeVoid = state.players.find(
      (p) => p.id === ALICE
    )!.voidNormalCoreCount;
    const stateAfterPending = executeEffect({
      chainId: "test:core-distribute-one-each:426",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    expect(pending.originalResolvedInstanceIds).toEqual(["sp1", "sp2"]);
    expect(pending.redirectableInstanceId).toBe("sp1");
    expect(pending.redirectableInstanceIds).toEqual(["sp1", "sp2"]);
    expect(pending.candidateTokenInstanceIds).toEqual(["shield"]);

    const confirmResult = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: BOB,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        redirectableInstanceIds: pending.redirectableInstanceIds,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: "shield",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in confirmResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }

    expect(confirmResult.resolvedAfterRedirect).toEqual(["shield"]);
    expect(
      confirmResult.state.cardInstances.find((c) => c.instanceId === "shield")!
        .normalCoreCount
    ).toBe(2);
    expect(
      confirmResult.state.cardInstances.find((c) => c.instanceId === "sp1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      confirmResult.state.cardInstances.find((c) => c.instanceId === "sp2")!
        .normalCoreCount
    ).toBe(1);
    expect(
      confirmResult.state.players.find((p) => p.id === ALICE)!
        .voidNormalCoreCount
    ).toBe(beforeVoid - 1);
  });
});

// engine primitive 単体テスト (cardNo 引用なし — card-data 利用は registration 配線後)。
