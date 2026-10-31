/**
 * ENGINE-core-move-from-life-soul-inclusion 回帰: 10_rules/06 §41-42 / §54 / §121-124
 * 「generic 『ライフのコア』はソウルコアを含む。ライフ/リザーブ/トラッシュへ move 可、ボイドのみ硬制約」。
 *
 * 旧実装は from:life→reserve / from:life→trash で available を lifeNormalCoreCount のみで
 * 算出し、soul のみのライフ (lifeNormalCoreCount=0 + soulCoreLocation.kind=="life") では
 * silent no-op になっていた。本 commit (2026-06-23) で normal-first・soul-fallback の
 * auto-pick を実装。soul が移動した場合は soulCoreLocation を新ゾーンへ更新。
 *
 * 影響: BSTH001-C04 effects[2] (life→reserve) を含む from:life 系汎用効果全般。
 * Player-choice pending は次段 (本 test 範囲外)。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const shooter: CardDefinition = {
  cardNo: "TEST-LIFE-SOUL-SHOOTER",
  name: "ライフコア源",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

function effectLifeTo(toKind: "reserve" | "trash", amount: number): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "life", player: "opponent" },
          to: { kind: toKind, player: "opponent" },
          amount,
        },
      },
    ],
  };
}

function baseSoulOnlyLifeState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  // bob: lifeNormalCoreCount=0、soulCoreLocation={kind:"life"} = ライフが soul のみ。
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === "bob"
        ? {
            ...p,
            lifeNormalCoreCount: 0,
            reserveNormalCoreCount: 0,
            trashNormalCoreCount: 0,
            soulCoreLocation: { kind: "life" },
          }
        : p
    ),
    cardInstances: [
      createCardInstance(shooter, {
        instanceId: "shooter-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
    ],
  };
}

const defs = new Map<string, CardDefinition>([[shooter.cardNo, shooter]]);

describe("core_move from:life で generic コアにソウルコアを含める", () => {
  it("life→reserve: soul のみのライフから soul を掴んでリザーブへ移す (normal 0)", () => {
    // 10_rules/06 §32 「ソウルコアは通常コアとは別種」: soul は soulCoreLocation のみで管理し
    // reserveNormalCoreCount を増やさない (通常コアを phantom 生成しない)。
    const state = baseSoulOnlyLifeState();
    const result = executeEffect({
      chainId: "test:core-move-from-life-soul-inclusion:86",
      state,
      effect: effectLifeTo("reserve", 1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(0);
    expect(bob.reserveNormalCoreCount).toBe(0);
    expect(bob.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("life→trash: soul のみのライフから soul を掴んでトラッシュへ移す (normal 0)", () => {
    const state = baseSoulOnlyLifeState();
    const result = executeEffect({
      chainId: "test:core-move-from-life-soul-inclusion:101",
      state,
      effect: effectLifeTo("trash", 1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(0);
    expect(bob.trashNormalCoreCount).toBe(0);
    expect(bob.soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("life→reserve: 真の選択肢 (normal=1 / soul=1 / amount=1) で持ち主選択 pending を生成しライフ owner が partition を選ぶ", () => {
    // ENGINE-core-move-from-life-owner-soul-choice (deep mode iteration 2):
    // BS35 Q22728「通常コアとソウルコアの選択は持ち主」。auto-pick (normal-first) は
    // 真の選択肢があるケースから外して、持ち主 (bob) が partition を選ぶ。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "bob"
          ? {
              ...p,
              lifeNormalCoreCount: 1,
              reserveNormalCoreCount: 0,
              soulCoreLocation: { kind: "life" },
            }
          : p
      ),
      cardInstances: [
        createCardInstance(shooter, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    const generated = executeEffect({
      chainId: "test:core-move-from-life-soul-inclusion:141",
      state,
      effect: effectLifeTo("reserve", 1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    // pending 生成 + 盤面未変化
    expect(generated.pendingLifeCoreSelection).not.toBeNull();
    expect(generated.pendingLifeCoreSelection!.actingPlayerId).toBe("bob");
    expect(generated.pendingLifeCoreSelection!.normalAvailable).toBe(1);
    expect(generated.pendingLifeCoreSelection!.soulAvailable).toBe(1);
    expect(generated.pendingLifeCoreSelection!.totalAmount).toBe(1);
    const bobMid = generated.players.find((p) => p.id === "bob")!;
    expect(bobMid.lifeNormalCoreCount).toBe(1);
    expect(bobMid.reserveNormalCoreCount).toBe(0);
    expect(bobMid.soulCoreLocation).toEqual({ kind: "life" });

    // legal action は ライフ owner (bob) に提示される
    const actions = getLegalActions({
      state: generated,
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_life_core_selection"
    );
    expect(action).toBeDefined();

    // owner が normal を選んだケース: ソウルはライフに残る
    const normalResolved = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById: (id) => defs.get(id),
      lifeCorePartitionChoice: { normalChosen: 1, soulChosen: 0 },
    });
    const bobN = normalResolved.state.players.find((p) => p.id === "bob")!;
    expect(bobN.lifeNormalCoreCount).toBe(0);
    expect(bobN.reserveNormalCoreCount).toBe(1);
    expect(bobN.soulCoreLocation).toEqual({ kind: "life" });
    expect(normalResolved.state.pendingLifeCoreSelection).toBeNull();

    // owner が soul を選んだケース: 通常はライフに残り、ソウルがリザーブへ
    const soulResolved = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById: (id) => defs.get(id),
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    });
    const bobS = soulResolved.state.players.find((p) => p.id === "bob")!;
    expect(bobS.lifeNormalCoreCount).toBe(1);
    expect(bobS.reserveNormalCoreCount).toBe(0);
    expect(bobS.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(soulResolved.state.pendingLifeCoreSelection).toBeNull();
  });

  it("life→reserve: amount=2 で normal 1 + soul 1 を両方掴む (reserve normal は 1, soul 別管理)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "bob"
          ? {
              ...p,
              lifeNormalCoreCount: 1,
              reserveNormalCoreCount: 0,
              soulCoreLocation: { kind: "life" },
            }
          : p
      ),
      cardInstances: [
        createCardInstance(shooter, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:core-move-from-life-soul-inclusion:220",
      state,
      effect: effectLifeTo("reserve", 2),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(0);
    // 通常コア 1 個のみ reserveNormalCoreCount へ。soul は soulCoreLocation 移行で別管理。
    expect(bob.reserveNormalCoreCount).toBe(1);
    expect(bob.soulCoreLocation).toEqual({ kind: "reserve" });
  });
});
