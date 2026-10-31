/**
 * P3-47 Phase 2-1: core_distribute mode="player_choice" のテスト。
 *
 * 既存 mode (= "even" 既定) は均等分配。新 mode "player_choice" では
 * pendingCoreDistribution を生成し、player に分配を委ねる。
 * フランドール【フォーオブアカインド】「自分のコア1個以上をそれらのカードに置く」用。
 *
 * - from.kind="reserve" + mode="player_choice" → pending 発生 (fromKind="reserve")
 * - minTotal 制約: 配分合計が下限を満たさないと apply エラー
 * - reserve のコア数が minTotal 未満 → pending 生成せず state 不変 (cost 不足、conditional_cost で fail 判定)
 * - resolve 後 reserveNormalCoreCount が減り、各 token の normalCoreCount が増加
 * - hasSoulCore=false の pending では soulCoreInstanceId 指定はエラー
 * - mode="even" (既定) は player_choice 経路を通らない (regression)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import type { Effect, TargetSpec } from "../src/dsl-types";

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
    cores: 0,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[], aliceReserve = 0): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === "alice" ? { ...p, reserveNormalCoreCount: aliceReserve } : p
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

const playerChoiceFromReserve: Effect = {
  timing: { kind: "phase", step: "main", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_distribute",
        from: { kind: "reserve", player: "self" },
        to: {
          kind: "filter",
          player: "self",
          filter: { tribes: ["token"] },
          count: "all",
        },
        amount: "all",
        mode: "player_choice",
        minTotal: 1,
      },
    },
  ],
};

function playerChoiceFromTrash(effectKind?: "generic" | "normal_only"): Effect {
  return {
    timing: { kind: "phase", step: "main", subPhase: "start" },
    steps: [
      {
        action: {
          kind: "core_distribute",
          from: { kind: "trash", player: "self" },
          to: {
            kind: "filter",
            player: "self",
            filter: { tribes: ["token"] },
            count: "all",
          },
          amount: 1,
          mode: "player_choice",
          ...(effectKind ? { effectKind } : {}),
        },
      },
    ],
  };
}

function playerChoiceFromFieldReserveAndTrash(
  trashCoreKind?: "generic" | "normal_only"
): Effect {
  return {
    timing: { kind: "phase", step: "main", subPhase: "start" },
    steps: [
      {
        action: {
          kind: "core_distribute",
          from: {
            kind: "field_reserve_and_trash_self",
            trashCoreLimit: 1,
            ...(trashCoreKind ? { trashCoreKind } : {}),
          },
          to: {
            kind: "filter",
            player: "self",
            filter: { tribes: ["token"] },
            count: "all",
          },
          amount: "all",
          mode: "player_choice",
        },
      },
    ],
  };
}

describe("P3-47 Phase 2-1: core_distribute mode=player_choice", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("from=reserve + minTotal=1 で pendingCoreDistribution が生成される (fromKind='reserve')", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const t3 = makeInstance(tokenDef, { instanceId: "tok3" });
    const state = makeState([host, t1, t2, t3], 5);

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:171",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    const pending = result.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("reserve");
    expect(pending.minTotal).toBe(1);
    expect(pending.totalNormalCores).toBe(5);
    expect(pending.hasSoulCore).toBe(false);
    expect(pending.candidates.map((c) => c.instanceId).sort()).toEqual([
      "tok1",
      "tok2",
      "tok3",
    ]);
    expect(pending.fromPlayerId).toBe("alice");
  });

  it("getLegalActions が fromKind / minTotal を含めて返す", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 3);

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:203",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const cd = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    );
    expect(cd).toBeDefined();
    if (cd?.kind === "resolve_pending_core_distribution") {
      expect(cd.fromKind).toBe("reserve");
      expect(cd.minTotal).toBe(1);
      expect(cd.totalNormalCores).toBe(3);
    }
  });

  it("from=trash generic は通常コアが足りていてもソウルコアを候補に含め、合計上限を守る", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const baseState = makeState([host, t1], 0);
    const state = {
      ...baseState,
      players: baseState.players.map((p) =>
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
      chainId: "test:core-distribute-player-choice:248",
      state,
      effect: playerChoiceFromTrash(),
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution?.totalNormalCores).toBe(1);
    expect(result.pendingCoreDistribution?.hasSoulCore).toBe(true);
    expect(result.pendingCoreDistribution?.maxTotal).toBe(1);
    const cdAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    if (cdAction.kind !== "resolve_pending_core_distribution") {
      throw new Error("expected pending core distribution action");
    }
    expect(cdAction.maxTotal).toBe(1);
    expect(() =>
      applyLegalAction({
        state: result,
        action: cdAction,
        getCardDefinitionById: getDef,
        coreDistributionAllocations: { tok1: 1 },
        coreDistributionSoulCoreInstanceId: "tok1",
      })
    ).toThrow(/exceeds maximum 1/);

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreInstanceId: "tok1",
    }).state;

    expect(
      applied.players.find((p) => p.id === "alice")?.trashNormalCoreCount
    ).toBe(1);
    expect(
      applied.players.find((p) => p.id === "alice")?.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "tok1" });
  });

  it("field_reserve_and_trash_self は trash 通常コアを上限1で field/reserve と同じ pending に載せる", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const donorDef = makeDef({ cardNo: "DONOR" });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(donorDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const token = makeInstance(tokenDef, { instanceId: "tok1" });
    const donor = makeInstance(donorDef, {
      instanceId: "donor",
      normalCoreCount: 2,
    });
    const baseState = makeState([host, token, donor], 2);
    const state = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 3 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:316",
      state,
      effect: playerChoiceFromFieldReserveAndTrash("normal_only"),
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const pending = result.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("any_movable");
    expect(pending.sourceAvailable).toMatchObject({
      reserve: 2,
      trash: 1,
      "field:donor": 2,
    });
    expect(pending.sourceTotalAvailable).toMatchObject({
      reserve: 2,
      trash: 1,
      "field:donor": 2,
    });
    expect(pending.soulSourceAvailable?.trash).toBeUndefined();

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
        coreDistributionAllocations: { tok1: 2 },
        coreDistributionSourceAllocations: { trash: 2 },
      })
    ).toThrow(/trash amount 2 exceeds available 1/);

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { tok1: 3 },
      coreDistributionSourceAllocations: { trash: 1, reserve: 2 },
    }).state;

    expect(
      applied.cardInstances.find((c) => c.instanceId === "tok1")!
        .normalCoreCount
    ).toBe(3);
    expect(
      applied.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(2);
    expect(
      applied.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(0);
    expect(
      applied.cardInstances.find((c) => c.instanceId === "donor")!
        .normalCoreCount
    ).toBe(2);
  });

  it("field_reserve_and_trash_self generic は trash ソウルコアも同じ上限1の中で選べる", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const token = makeInstance(tokenDef, { instanceId: "tok1" });
    const baseState = makeState([host, token], 0);
    const state = {
      ...baseState,
      players: baseState.players.map((p) =>
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
      chainId: "test:core-distribute-player-choice:398",
      state,
      effect: playerChoiceFromFieldReserveAndTrash(),
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const pending = result.pendingCoreDistribution!;
    expect(pending.sourceAvailable?.trash).toBe(1);
    expect(pending.soulSourceAvailable?.trash).toBe(1);
    expect(pending.sourceTotalAvailable?.trash).toBe(1);

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
        coreDistributionAllocations: { tok1: 1 },
        coreDistributionSourceAllocations: { trash: 1 },
        coreDistributionSoulCoreAllocations: { tok1: 1 },
        coreDistributionSoulCoreSourceAllocations: { trash: 1 },
      })
    ).toThrow(/trash total 2 exceeds combined available 1/);

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
      coreDistributionSoulCoreAllocations: { tok1: 1 },
      coreDistributionSoulCoreSourceAllocations: { trash: 1 },
    }).state;

    expect(
      applied.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(1);
    expect(
      applied.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "tok1" });
  });

  it("resolve で reserveNormalCoreCount が減り、各 token に分配される", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const t3 = makeInstance(tokenDef, { instanceId: "tok3" });
    const state = makeState([host, t1, t2, t3], 5);

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:457",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
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

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { tok1: 1, tok2: 2, tok3: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const tok1 = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok1"
    )!;
    const tok2 = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok2"
    )!;
    const tok3 = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok3"
    )!;
    expect(tok1.normalCoreCount).toBe(1);
    expect(tok2.normalCoreCount).toBe(2);
    expect(tok3.normalCoreCount).toBe(1);
    expect(tok1.everHadCorePlaced).toBe(true);
    expect(tok2.everHadCorePlaced).toBe(true);
    expect(tok3.everHadCorePlaced).toBe(true);
    expect(
      applied.state.cardInstances.find((c) => c.instanceId === "host")!
        .everHadCorePlaced
    ).toBe(false);
    const alice = applied.state.players.find((p) => p.id === "alice")!;
    // 1+2+1=4 が reserve から減り、1 残る
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("配分合計が minTotal 未満 → apply はエラー", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 3);

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:516",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
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
        coreDistributionAllocations: { tok1: 0 },
      })
    ).toThrow(/below minimum/);
  });

  it("reserve のコアが 0 個 (minTotal=1) → pending 生成せず state 不変", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 0);

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:552",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
    const t1After = result.cardInstances.find((c) => c.instanceId === "tok1")!;
    expect(t1After.normalCoreCount).toBe(0);
  });

  it("hasSoulCore=false の reserve pending で soulCoreInstanceId 指定はエラー", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 2);

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:574",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
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
        coreDistributionAllocations: { tok1: 1 },
        coreDistributionSoulCoreInstanceId: "tok1",
      })
    ).toThrow(/No soul core to distribute/);
  });

  it("from=trash generic は通常コア不足時にトラッシュのソウルコアを配分候補にする", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const baseState = makeState([host, t1], 0);
    const state = {
      ...baseState,
      players: baseState.players.map((p) =>
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
      chainId: "test:core-distribute-player-choice:623",
      state,
      effect: playerChoiceFromTrash(),
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution?.fromKind).toBe("trash");
    expect(result.pendingCoreDistribution?.totalNormalCores).toBe(0);
    expect(result.pendingCoreDistribution?.hasSoulCore).toBe(true);
    expect(result.pendingCoreDistribution?.maxTotal).toBe(1);
    const cdAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: {},
      coreDistributionSoulCoreInstanceId: "tok1",
    }).state;

    expect(applied.pendingCoreDistribution).toBeNull();
    expect(
      applied.players.find((p) => p.id === "alice")?.soulCoreLocation
    ).toEqual({
      kind: "card",
      instanceId: "tok1",
    });
  });

  it("from=trash effectKind='normal_only' はトラッシュのソウルコアだけでは pending を生成しない", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const baseState = makeState([host, t1], 0);
    const state = {
      ...baseState,
      players: baseState.players.map((p) =>
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
      chainId: "test:core-distribute-player-choice:679",
      state,
      effect: playerChoiceFromTrash("normal_only"),
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
    expect(
      result.players.find((p) => p.id === "alice")?.soulCoreLocation
    ).toEqual({
      kind: "trash",
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "tok1")?.normalCoreCount
    ).toBe(0);
  });

  it("mode='player_choice' は候補プールを targeted disclosure に先行公開しない", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const responderDef = makeDef({
      cardNo: "RESPONDER",
      tribe: "responder",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            cause: ["self_effect"],
          },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 1,
              },
            },
          ],
        },
      ],
    });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(responderDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const responder = makeInstance(responderDef, { instanceId: "responder" });
    const state = makeState([host, t1, t2, responder], 2);

    const result = executeEffect({
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      chainId: "core-distribute-player-choice-disclosure",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        responderDef,
      ]),
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingTargetedDisclosureContinuation).toBeNull();
    expect(result.pendingTriggeredEffects).toHaveLength(0);
    expect(
      result.log.some((entry) =>
        entry.startsWith("effect:target-disclosure:queued:")
      )
    ).toBe(false);
    expect(
      result.pendingCoreDistribution!.candidates.map((c) => c.instanceId).sort()
    ).toEqual(["tok1", "tok2"]);
  });

  it("mode='player_choice' は実際に配分した対象だけを targeted disclosure に流す", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const responderDef = makeDef({
      cardNo: "RESPONDER",
      tribe: "responder",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            cause: ["self_effect"],
          },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 1,
              },
            },
          ],
        },
      ],
    });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(responderDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const responder = makeInstance(responderDef, { instanceId: "responder" });
    const state = makeState([host, t1, t2, responder], 2);
    const triggeredLookup = buildTriggeredEffectLookup([responderDef]);

    const pendingState = executeEffect({
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      chainId: "core-distribute-selected-target-disclosure",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const cdAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;

    const applied = applyLegalAction({
      state: pendingState,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      coreDistributionAllocations: { tok1: 1, tok2: 0 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    expect(applied.state.pendingTargetedDisclosureContinuation).not.toBeNull();
    expect(
      applied.state.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["tok1"]);
    expect(applied.state.pendingTriggeredEffects).toHaveLength(1);
    expect(
      applied.state.log.some((entry) =>
        entry.includes(
          "effect:target-disclosure:queued:core-distribute-selected-target-disclosure:tok1"
        )
      )
    ).toBe(true);
  });

  it("mode='player_choice' は targeted disclosure 応答後に確定済み配分を再 pending 化せず適用する", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const responderDef = makeDef({
      cardNo: "RESPONDER",
      tribe: "responder",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            cause: ["self_effect"],
          },
          steps: [
            {
              action: {
                kind: "count_increase",
                player: "self",
                amount: 1,
              },
            },
          ],
        },
      ],
    });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(responderDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const responder = makeInstance(responderDef, { instanceId: "responder" });
    const state = makeState([host, t1, t2, responder], 2);
    const triggeredLookup = buildTriggeredEffectLookup([responderDef]);
    const emptyFieldLookup = () => [];

    const pendingState = executeEffect({
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      chainId: "core-distribute-disclosure-resume-allocations",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const cdAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;

    const disclosure = applyLegalAction({
      state: pendingState,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      coreDistributionAllocations: { tok1: 1, tok2: 0 },
    }).state;

    expect(disclosure.pendingCoreDistribution).toBeNull();
    expect(
      disclosure.pendingTargetedDisclosureContinuation
        ?.coreDistributionAllocations
    ).toEqual({ tok1: 1, tok2: 0 });
    expect(
      disclosure.cardInstances.find((c) => c.instanceId === "tok1")!
        .normalCoreCount
    ).toBe(0);

    const resumed = resumeTargetedDisclosureIfReady(
      {
        ...disclosure,
        pendingTriggeredEffects: [],
        pendingPrivateDeclarations: [],
        pendingBurstChecks: [],
      },
      {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: emptyFieldLookup,
      }
    );

    expect(resumed.pendingTargetedDisclosureContinuation).toBeNull();
    expect(resumed.pendingCoreDistribution).toBeNull();
    expect(
      resumed.cardInstances.find((c) => c.instanceId === "tok1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      resumed.cardInstances.find((c) => c.instanceId === "tok2")!
        .normalCoreCount
    ).toBe(0);
    expect(
      resumed.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(1);
  });

  it("mode='player_choice' は配分確定時の redirect prompt で候補を差し替える", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const redirectHost = makeInstance(hostDef, { instanceId: "redirect-host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = {
      ...makeState([host, redirectHost, t1, t2], 2),
      activeContinuousEffects: [
        {
          effectId: "ce-redirect",
          sourceInstanceId: "redirect-host",
          sourceDefinitionId: "HOST",
          actingPlayerId: "alice",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "any",
              protectedTargetKind: "instances",
              protectedInstanceIds: ["tok1"],
            },
            redirectCandidateSource: {
              kind: "explicit",
              instanceIds: ["tok2"],
            },
            optional: true,
          },
        },
      ],
    } satisfies GameState;
    const emptyTriggeredLookup = () => [];

    const pendingState = executeEffect({
      chainId: "test:core-distribute-player-choice:973",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    });
    const cdAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;

    const redirectedPrompt = applyLegalAction({
      state: pendingState,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      coreDistributionAllocations: { tok1: 1 },
    });

    expect(redirectedPrompt.state.pendingCoreDistribution).not.toBeNull();
    expect(redirectedPrompt.state.pendingTargetRedirects).toHaveLength(1);
    const redirectAction = getLegalActions({
      state: redirectedPrompt.state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    }).find((a) => a.kind === "confirm_target_redirect")!;
    expect(redirectAction).toBeDefined();

    const confirmed = applyLegalAction({
      state: redirectedPrompt.state,
      action: redirectAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      redirectTargetReplacementInstanceId: "tok2",
    });
    if (!("redirected" in confirmed)) {
      throw new Error("expected redirect result");
    }
    expect(confirmed.redirected).toBe(true);
    expect(confirmed.resolvedAfterRedirect).toEqual(["tok2"]);
    expect(confirmed.state.pendingTargetRedirects).toHaveLength(0);
    expect(confirmed.state.pendingCoreDistribution).toBeNull();
    expect(
      confirmed.state.cardInstances.find((c) => c.instanceId === "tok1")!
        .normalCoreCount
    ).toBe(0);
    expect(
      confirmed.state.cardInstances.find((c) => c.instanceId === "tok2")!
        .normalCoreCount
    ).toBe(1);
    expect(
      confirmed.state.players.find((p) => p.id === "alice")!
        .reserveNormalCoreCount
    ).toBe(1);
  });

  it("redirect 後の replacement 配分先には targeted disclosure を再評価する", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    const responderDef = makeDef({
      cardNo: "RESPONDER",
      tribe: "responder",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "targeted",
            player: "self",
            cause: ["self_effect"],
          },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    });
    registerDef(hostDef);
    registerDef(tokenDef);
    registerDef(responderDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const redirectHost = makeInstance(hostDef, { instanceId: "redirect-host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const responder = makeInstance(responderDef, { instanceId: "responder" });
    const state = {
      ...makeState([host, redirectHost, t1, t2, responder], 2),
      activeContinuousEffects: [
        {
          effectId: "ce-redirect",
          sourceInstanceId: "redirect-host",
          sourceDefinitionId: "HOST",
          actingPlayerId: "alice",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "any",
              protectedTargetKind: "instances",
              protectedInstanceIds: ["tok1"],
            },
            redirectCandidateSource: {
              kind: "explicit",
              instanceIds: ["tok2"],
            },
            optional: true,
          },
        },
      ],
    } satisfies GameState;
    const triggeredLookup = buildTriggeredEffectLookup([responderDef]);

    const pendingState = executeEffect({
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      chainId: "core-distribute-redirect-replacement-disclosure",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const afterInitialDisclosure: GameState = {
      ...pendingState,
      pendingCoreDistribution: {
        ...pendingState.pendingCoreDistribution!,
        targetInterruption: {
          ...pendingState.pendingCoreDistribution!.targetInterruption!,
          targetedDisclosureResolved: true,
        },
      },
    };
    const cdAction = getLegalActions({
      state: afterInitialDisclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;

    const redirectedPrompt = applyLegalAction({
      state: afterInitialDisclosure,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      coreDistributionAllocations: { tok1: 1 },
    });
    const redirectAction = getLegalActions({
      state: redirectedPrompt.state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((a) => a.kind === "confirm_target_redirect")!;
    const confirmed = applyLegalAction({
      state: redirectedPrompt.state,
      action: redirectAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      redirectTargetReplacementInstanceId: "tok2",
    });

    expect(confirmed.state.pendingCoreDistribution).toBeNull();
    expect(
      confirmed.state.pendingTargetedDisclosureContinuation?.targetInstanceIds
    ).toEqual(["tok2"]);
    expect(confirmed.state.pendingTriggeredEffects).toHaveLength(1);
    expect(
      confirmed.state.cardInstances.find((c) => c.instanceId === "tok2")!
        .normalCoreCount
    ).toBe(0);
  });

  it("core_move reserve→field_card は target 解決済み候補だけを配分候補にする", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const lowDef = makeDef({ cardNo: "TOK-LOW", tribe: "token", cost: 2 });
    const highDef = makeDef({ cardNo: "TOK-HIGH", tribe: "token", cost: 9 });
    registerDef(hostDef);
    registerDef(lowDef);
    registerDef(highDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(lowDef, { instanceId: "tok1" });
    const t2 = makeInstance(lowDef, { instanceId: "tok2" });
    const widenedByToFilter = makeInstance(highDef, { instanceId: "tok3" });
    const effect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            target: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"], maxCost: 3 },
              count: "all",
            },
            to: {
              kind: "field_card",
              player: "self",
              filter: { tribes: ["token"] },
            },
            amount: 2,
          },
        },
      ],
    };
    const emptyTriggeredLookup = () => [];

    const pendingState = executeEffect({
      chainId: "test:core-distribute-player-choice:1188",
      state: makeState([host, t1, t2, widenedByToFilter], 2),
      effect,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    });

    expect(pendingState.pendingCoreDistribution).not.toBeNull();
    expect(
      pendingState.pendingCoreDistribution!.candidates.map(
        (candidate) => candidate.instanceId
      )
    ).toEqual(["tok1", "tok2"]);

    expect(() =>
      executeEffect({
        chainId: "test:core-distribute-player-choice:1205",
        state: makeState([host, t1, t2, widenedByToFilter], 2),
        effect,
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        coreDistributionAllocations: { tok1: 1, tok3: 1 },
      })
    ).toThrow(/Core distribution target tok3 is not a candidate/);

    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    if (!resolveAction) throw new Error("expected distribution action");

    const moved = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      coreDistributionAllocations: { tok1: 1, tok2: 1 },
    });

    expect(moved.state.pendingCoreDistribution).toBeNull();
    expect(
      moved.state.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(0);
    expect(
      moved.state.cardInstances.find((c) => c.instanceId === "tok1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      moved.state.cardInstances.find((c) => c.instanceId === "tok1")!
        .everHadCorePlaced
    ).toBe(true);
    expect(
      moved.state.cardInstances.find((c) => c.instanceId === "tok2")!
        .normalCoreCount
    ).toBe(1);
    expect(
      moved.state.cardInstances.find((c) => c.instanceId === "tok2")!
        .everHadCorePlaced
    ).toBe(true);
    expect(
      moved.state.cardInstances.find((c) => c.instanceId === "tok3")!
        .normalCoreCount
    ).toBe(0);
  });

  it("core_move reserve→field_card の全コア配置は reserve のソウルコアも必須にする", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const token = makeInstance(tokenDef, { instanceId: "tok1" });
    const effect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            target: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            to: {
              kind: "field_card",
              player: "self",
              filter: { tribes: ["token"] },
            },
            amount: "all",
          },
        },
      ],
    };
    const baseState = makeState([host, token], 1);
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              soulCoreLocation: { kind: "reserve" as const },
              reserveSoulCoreCount: 1,
            }
          : p
      ),
    };
    const emptyTriggeredLookup = () => [];

    const pendingState = executeEffect({
      chainId: "test:core-distribute-player-choice:1304",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    });

    expect(pendingState.pendingCoreDistribution).not.toBeNull();
    expect(pendingState.pendingCoreDistribution!.totalNormalCores).toBe(1);
    expect(pendingState.pendingCoreDistribution!.hasSoulCore).toBe(true);
    expect(pendingState.pendingCoreDistribution!.mustPlaceSoulCore).toBe(true);
    expect(pendingState.pendingCoreDistribution!.candidates).toEqual([
      { instanceId: "tok1", definitionId: "TOK" },
    ]);

    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    if (!resolveAction) throw new Error("expected distribution action");

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveAction,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        coreDistributionAllocations: { tok1: 1 },
      })
    ).toThrow(/Soul core in reserve must be placed/);

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: resolveAction,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
        coreDistributionAllocations: { tok1: 0 },
        coreDistributionSoulCoreInstanceId: "tok1",
      })
    ).toThrow(/all-normal total 1/);

    const moved = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      coreDistributionAllocations: { tok1: 1 },
      coreDistributionSoulCoreInstanceId: "tok1",
    });

    const alice = moved.state.players.find((p) => p.id === "alice")!;
    const tokenAfter = moved.state.cardInstances.find(
      (c) => c.instanceId === "tok1"
    )!;
    expect(moved.state.pendingCoreDistribution).toBeNull();
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "tok1",
    });
    expect(tokenAfter.normalCoreCount).toBe(1);
    expect(tokenAfter.soulCoreCount).toBe(1);
    expect(tokenAfter.everHadCorePlaced).toBe(true);
  });

  it("core_move reserve→field_card の全コア配置は count-only 追加ソウルも全数置く", () => {
    const hostDef = makeDef({ cardNo: "HOST2" });
    const primaryDef = makeDef({ cardNo: "PRIMARY" });
    const tokenDef = makeDef({ cardNo: "TOK2", tribe: "token" });
    registerDef(hostDef);
    registerDef(primaryDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host2" });
    const primary = makeInstance(primaryDef, {
      instanceId: "primary-soul-card",
      soulCoreCount: 1,
    });
    const token = makeInstance(tokenDef, { instanceId: "tok2" });
    const tokenB = makeInstance(tokenDef, { instanceId: "tok3" });
    const effect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            target: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            to: {
              kind: "field_card",
              player: "self",
              filter: { tribes: ["token"] },
            },
            amount: "all",
          },
        },
      ],
    };
    const baseState = makeState([host, primary, token, tokenB], 1);
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              soulCoreLocation: {
                kind: "card" as const,
                instanceId: "primary-soul-card",
              },
              reserveSoulCoreCount: 2,
            }
          : p
      ),
    };
    const emptyTriggeredLookup = () => [];

    const pendingState = executeEffect({
      chainId: "test:core-distribute-player-choice:1431",
      state,
      effect,
      sourceInstanceId: "host2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    });

    const pending = pendingState.pendingCoreDistribution;
    expect(pending).not.toBeNull();
    expect(pending!.totalNormalCores).toBe(1);
    expect(pending!.hasSoulCore).toBe(true);
    expect(pending!.totalSoulCores).toBe(2);
    expect(pending!.mustPlaceSoulCore).toBe(true);

    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_core_distribution"
    ) {
      throw new Error("expected distribution action");
    }
    expect(resolveAction.totalSoulCores).toBe(2);

    const moved = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      coreDistributionAllocations: { tok2: 1 },
      coreDistributionSoulCoreAllocations: { tok2: 1, tok3: 1 },
    });

    const alice = moved.state.players.find((p) => p.id === "alice")!;
    const primaryAfter = moved.state.cardInstances.find(
      (c) => c.instanceId === "primary-soul-card"
    )!;
    const tokenAfter = moved.state.cardInstances.find(
      (c) => c.instanceId === "tok2"
    )!;
    const tokenBAfter = moved.state.cardInstances.find(
      (c) => c.instanceId === "tok3"
    )!;
    expect(moved.state.pendingCoreDistribution).toBeNull();
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "primary-soul-card",
    });
    expect(primaryAfter.soulCoreCount).toBe(1);
    expect(tokenAfter.normalCoreCount).toBe(1);
    expect(tokenAfter.soulCoreCount).toBe(1);
    expect(tokenAfter.everHadCorePlaced).toBe(true);
    expect(tokenBAfter.soulCoreCount).toBe(1);
    expect(tokenBAfter.everHadCorePlaced).toBe(true);
  });

  it("deferred target redirect: preserveOriginalTargetSpec は core_distribution 配分確定時にも候補を絞り reselect にする", () => {
    const magicDef = makeDef({
      cardNo: "MAGIC",
      printedCategory: "magic",
      tribe: undefined,
    });
    const spiritDef = makeDef({ cardNo: "SPIRIT", tribe: "fighter" });
    const nexusDef = makeDef({
      cardNo: "NEXUS",
      printedCategory: "nexus",
      tribe: undefined,
      levelDefs: [],
      symbolColors: ["red"],
    });
    registerDef(magicDef);
    registerDef(spiritDef);
    registerDef(nexusDef);

    const sourceMagic = makeInstance(magicDef, {
      instanceId: "bob-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
    });
    const aliceProtected = makeInstance(spiritDef, {
      instanceId: "alice-protected",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
    });
    const aliceOther = makeInstance(spiritDef, {
      instanceId: "alice-other",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
    });
    const bobSpirit1 = makeInstance(spiritDef, {
      instanceId: "bob-spirit-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const bobSpirit2 = makeInstance(spiritDef, {
      instanceId: "bob-spirit-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const bobNexus = makeInstance(nexusDef, {
      instanceId: "bob-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const base = makeState(
      [
        sourceMagic,
        aliceProtected,
        aliceOther,
        bobSpirit1,
        bobSpirit2,
        bobNexus,
      ],
      0
    );
    const state = {
      ...base,
      players: base.players.map((p) =>
        p.id === "bob" ? { ...p, reserveNormalCoreCount: 2 } : p
      ),
      activeContinuousEffects: [
        {
          effectId: "ce-preserve-reselect",
          sourceInstanceId: "alice-protected",
          sourceDefinitionId: "SPIRIT",
          actingPlayerId: "alice",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "opponent",
              sourceFilter: { category: ["magic"] },
              protectedTargetKind: "instances",
              protectedInstanceIds: ["alice-protected"],
            },
            redirectCandidateSource: {
              kind: "owned_filter",
              filter: { category: ["spirit", "ultimate", "brave", "nexus"] },
              playerRef: "opponent",
              preserveOriginalTargetSpec: { playerRef: "self" },
            },
            promptedPlayerRef: "self",
            candidateChooserPlayerRef: "opponent",
            optional: true,
          },
        },
      ],
    } satisfies GameState;
    const bobTargetSpec: TargetSpec = {
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit"] },
      count: 2,
    };
    const bobEffect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: bobTargetSpec,
            amount: 2,
            mode: "player_choice",
            minTotal: 1,
          },
        },
      ],
    };
    const emptyTriggeredLookup = () => [];

    const pendingState = executeEffect({
      chainId: "test:core-distribute-player-choice:1614",
      state,
      effect: bobEffect,
      sourceInstanceId: sourceMagic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    });
    expect(
      pendingState.pendingCoreDistribution?.targetInterruption?.targetSpec
    ).toEqual(bobTargetSpec);

    const cdAction = getLegalActions({
      state: pendingState,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const redirectedPrompt = applyLegalAction({
      state: pendingState,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: emptyTriggeredLookup,
      coreDistributionAllocations: {
        "alice-protected": 1,
        "alice-other": 1,
      },
    });

    const redirectPending = redirectedPrompt.state.pendingTargetRedirects[0];
    expect(redirectPending?.replacementMode).toBe("reselect");
    expect(redirectPending?.promptedPlayerId).toBe("alice");
    expect(redirectPending?.candidateChooserPlayerId).toBe("bob");
    expect(redirectPending?.redirectableInstanceIds).toEqual([
      "alice-protected",
      "alice-other",
    ]);
    expect(redirectPending?.candidateTokenInstanceIds).toEqual([
      "bob-spirit-1",
      "bob-spirit-2",
    ]);
  });

  it("mode='even' (既定) は player_choice 経路を通らず均等分配 (regression)", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 4);

    const evenEffect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: 4,
            // mode 省略 = "even"
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-player-choice:1687",
      state,
      effect: evenEffect,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
    const tok1 = result.cardInstances.find((c) => c.instanceId === "tok1")!;
    const tok2 = result.cardInstances.find((c) => c.instanceId === "tok2")!;
    // 4 を 2 token に均等 = 2 個ずつ
    expect(tok1.normalCoreCount).toBe(2);
    expect(tok2.normalCoreCount).toBe(2);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
  });
});
