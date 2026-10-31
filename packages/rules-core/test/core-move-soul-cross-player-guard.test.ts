/**
 * ENGINE-core-move-soul-cross-player-destination option (b) ガード。
 *
 * 10_rules/06 §41-42・§54 で「ライフ/リザーブ/トラッシュへ soul も generic 可」とされるが、
 * soulCoreLocation は per-player 状態であり、cross-player destination (fromPlayerId !==
 * toPlayerId) では soul ownership 移転モデルが未配線。silent に不整合な soulCoreLocation を
 * 設定するのを避けるため、本 lane は audit option (b) に従い「cross-player では soul を
 * 取らない」を実装した。本テストは guard が以下 3 経路で有効であることを回帰検証する:
 *
 *   (i)  executeCoreMove `from.kind === "card_instance"` (相手カード源 + amount=Infinity)
 *   (ii) field-source coreshoot 候補列挙 (analyzeCoreShootCandidates) で soul card を除外
 *   (iii) field-source 自動 fallback (auto-pick) で soul を transfer しない
 *
 * 現状の実カードでは cross-player coreshoot に soul 配置が乗るケースが存在しない
 * (hypothetical gap)。横展開で発覚し得る silent regression を防ぐ。
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  executeCoreMove,
  analyzeCoreShootCandidates,
} from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const SPIRIT_DEF = "BSTH001-C01";

function targetCardToOwnReserveEffect(
  amount: 1 | { min: number; max: number }
): Effect {
  return {
    timing: { kind: "card_event", event: "main" },
    steps: [
      {
        action: {
          kind: "core_move",
          target: {
            kind: "filter",
            player: "self",
            filter: { category: ["spirit"] },
            count: 1,
          },
          from: { kind: "target_card" },
          to: { kind: "reserve", player: "self" },
          amount,
        },
      },
    ],
  };
}

describe("ENGINE-core-move-soul-cross-player-destination option (b) ガード", () => {
  it("card_instance: cross-player では soul ownership 移転を回避 (soul は移動先 player に register されない)", () => {
    // BOB のスピリットに BOB のソウルコアが乗っている状況で、ALICE が
    // amount=Infinity (全コア取得) を発動する。option (b) では soul transfer をスキップ
    // し、normal コアのみ ALICE.reserve へ移す。BOB.soulCoreLocation は変わらない。
    const sourceCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: BOB,
      zone: "field",
      instanceId: "bob-1",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [sourceCard],
      playerOverrides: [
        { reserveNormalCoreCount: 0 },
        { soulCoreLocation: { kind: "card", instanceId: "bob-1" } },
      ],
    });
    const after = executeCoreMove(
      state,
      ALICE,
      { kind: "card_instance", instanceId: "bob-1" },
      { kind: "reserve", player: "self" },
      Number.POSITIVE_INFINITY,
      "alice-source",
      undefined,
      undefined,
      getDef
    );
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    const bobAfter = after.players.find((p) => p.id === BOB)!;
    const targetAfter = after.cardInstances.find(
      (c) => c.instanceId === "bob-1"
    )!;
    expect(targetAfter.normalCoreCount).toBe(0);
    expect(aliceAfter.reserveNormalCoreCount).toBe(1);
    // soul は BOB のカード上に残置されたまま (guard 適用前は {kind:"reserve"} に書き換わるバグ)。
    expect(bobAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "bob-1",
    });
    // soul_core 移動ログが出ていないことを確認 (transfer 抑止)。
    expect(
      after.log.some((l) => l.startsWith("effect:core_move:soul_core:"))
    ).toBe(false);
  });

  it("card_instance: same-player では従来どおり soul を transfer する (guard は cross-player のみ作用)", () => {
    // ALICE のスピリットに ALICE のソウルコアが乗っている状況で、ALICE が
    // amount=Infinity を自身に向けて発動する (例: 自己バウンスでコアを掃き戻す)。
    // soul は ALICE.reserve へ正しく transfer される。
    const sourceCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [sourceCard],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-spirit" },
        },
      ],
    });
    const after = executeCoreMove(
      state,
      ALICE,
      { kind: "card_instance", instanceId: "alice-spirit" },
      { kind: "reserve", player: "self" },
      Number.POSITIVE_INFINITY,
      "alice-source",
      undefined,
      undefined,
      getDef
    );
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    const targetAfter = after.cardInstances.find(
      (c) => c.instanceId === "alice-spirit"
    )!;
    expect(targetAfter.normalCoreCount).toBe(0);
    expect(aliceAfter.reserveNormalCoreCount).toBe(1);
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("card_instance: same-player finite generic core move は soul-only source から soul を移す", () => {
    const sourceCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-soul-only",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [sourceCard],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-soul-only" },
        },
      ],
    });

    const after = executeCoreMove(
      state,
      ALICE,
      { kind: "card_instance", instanceId: "alice-soul-only" },
      { kind: "reserve", player: "self" },
      1,
      "alice-source",
      undefined,
      undefined,
      getDef
    );

    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    const sourceAfter = after.cardInstances.find(
      (c) => c.instanceId === "alice-soul-only"
    )!;
    expect(sourceAfter.normalCoreCount).toBe(0);
    expect(sourceAfter.soulCoreCount).toBe(0);
    expect(aliceAfter.reserveNormalCoreCount).toBe(0);
    expect(aliceAfter.reserveSoulCoreCount).toBe(1);
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("core_count range: card_instance source の finite 上限は soul-only source を 1 個として扱う", () => {
    const effect = targetCardToOwnReserveEffect({ min: 0, max: 1 });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(getDef(SPIRIT_DEF)!, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "alice-src",
          normalCoreCount: 1,
        }),
        createCardInstance(getDef(SPIRIT_DEF)!, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "alice-soul-only",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-soul-only" },
        },
      ],
    });

    const generated = executeEffect({
      chainId: "test:core-move-soul-cross-player-guard:218",
      state,
      effect,
      sourceInstanceId: "alice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["alice-soul-only"],
    });

    expect(generated.pendingCoreCountSelection).not.toBeNull();
    expect(generated.pendingCoreCountSelection!.min).toBe(0);
    expect(generated.pendingCoreCountSelection!.max).toBe(1);

    const action = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_count");
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById: getDef,
      coreCountSelection: 1,
    }).state;

    const aliceAfter = resolved.players.find((p) => p.id === ALICE)!;
    expect(resolved.pendingCoreCountSelection).toBeNull();
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(aliceAfter.reserveSoulCoreCount).toBe(1);
  });

  it("core_count range: card_instance source の finite 上限は cannot_reduce_cores_below を差し引く", () => {
    const effect = targetCardToOwnReserveEffect({ min: 0, max: 2 });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(getDef(SPIRIT_DEF)!, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "alice-src",
          normalCoreCount: 1,
        }),
        createCardInstance(getDef(SPIRIT_DEF)!, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "alice-protected",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-protected" },
        },
      ],
    });
    const state: GameState = {
      ...baseState,
      activeContinuousEffects: [
        {
          effectId: "test-core-min-card-instance",
          sourceInstanceId: "core-min-source",
          sourceDefinitionId: SPIRIT_DEF,
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 0,
          createdAtAttackId: null,
          modifierTag: "cannot_reduce_cores_below",
          targetInstanceId: "alice-protected",
          metadata: { source: "all", coreMinimum: 1 },
        },
      ],
    };

    const generated = executeEffect({
      chainId: "test:core-move-soul-cross-player-guard:294",
      state,
      effect,
      sourceInstanceId: "alice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["alice-protected"],
    });

    expect(generated.pendingCoreCountSelection).not.toBeNull();
    expect(generated.pendingCoreCountSelection!.min).toBe(0);
    expect(generated.pendingCoreCountSelection!.max).toBe(1);
  });

  it("card_instance: same-player finite generic core move で通常/魂の真の選択肢があれば持ち主選択 pending にする", () => {
    const effect = targetCardToOwnReserveEffect(1);
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(getDef(SPIRIT_DEF)!, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "alice-src",
          normalCoreCount: 1,
        }),
        createCardInstance(getDef(SPIRIT_DEF)!, {
          ownerPlayerId: ALICE,
          zone: "field",
          instanceId: "alice-bearer",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-bearer" },
        },
      ],
    });

    const generated = executeEffect({
      chainId: "test:core-move-soul-cross-player-guard:334",
      state,
      effect,
      sourceInstanceId: "alice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["alice-bearer"],
    });

    expect(generated.pendingLifeCoreSelection).not.toBeNull();
    expect(generated.pendingLifeCoreSelection).toMatchObject({
      actingPlayerId: ALICE,
      effectSourcePlayerId: ALICE,
      fromLocation: { kind: "card_instance", instanceId: "alice-bearer" },
      toLocation: { kind: "reserve", player: "self" },
      normalAvailable: 1,
      soulAvailable: 1,
      totalAmount: 1,
    });

    const action = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_life_core_selection");
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById: getDef,
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    const aliceAfter = resolved.players.find((p) => p.id === ALICE)!;
    const bearerAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "alice-bearer"
    )!;
    expect(resolved.pendingLifeCoreSelection).toBeNull();
    expect(bearerAfter.normalCoreCount).toBe(1);
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(aliceAfter.reserveSoulCoreCount).toBe(1);
  });

  it("field-source coreshoot 候補列挙: cross-player では soul-only カードを候補に含めない", () => {
    // BOB の soul-only スピリット (normal=0) は ALICE の cross-player coreshoot 候補から除外される。
    const soulOnlyCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: BOB,
      zone: "field",
      instanceId: "bob-soul-only",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [soulOnlyCard],
      playerOverrides: [
        {},
        { soulCoreLocation: { kind: "card", instanceId: "bob-soul-only" } },
      ],
    });
    const pending = analyzeCoreShootCandidates(
      state,
      ALICE,
      { kind: "field", player: "opponent" },
      { kind: "reserve", player: "self" },
      1,
      "none",
      undefined,
      getDef
    );
    // 候補 0 → null を返す (analyzeCoreShootCandidates の no-target shortcut)。
    expect(pending).toBeNull();
  });

  it("pending core_shoot apply: cross-player では soulCoreInstanceId 指定を拒否する (二重防御)", () => {
    // analyzeCoreShootCandidates で soul-only カードは除外されるが、
    // normal+soul 両持ちカードは normal を取るために候補として残るため、
    // GUI から soulCoreInstanceId を指定された場合に applyPendingCoreShootAction で
    // 拒否する。validator/transfer の両方に cross-player guard を入れた。
    const soulBearer = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: BOB,
      zone: "field",
      instanceId: "bob-bearer",
      normalCoreCount: 2,
    });
    const otherCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: BOB,
      zone: "field",
      instanceId: "bob-other",
      normalCoreCount: 2,
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [soulBearer, otherCard],
      playerOverrides: [
        {},
        { soulCoreLocation: { kind: "card", instanceId: "bob-bearer" } },
      ],
    });
    // ALICE が BOB の field を core_shoot して self.reserve へ移すフローを再現する
    // pendingCoreShootSelection を直接構築する (cross-player, normal-only candidates)。
    const state: GameState = {
      ...baseState,
      pendingCoreShootSelection: {
        pendingId: "cs-x",
        actingPlayerId: ALICE,
        sourceInstanceId: "alice-src",
        sourceDefinitionId: "test",
        candidates: [
          {
            instanceId: "bob-bearer",
            definitionId: SPIRIT_DEF,
            availableCores: 2,
          },
          {
            instanceId: "bob-other",
            definitionId: SPIRIT_DEF,
            availableCores: 2,
          },
        ],
        totalAmount: 1,
        toKind: "reserve",
        toPlayerId: ALICE,
        fromPlayerId: BOB,
        remainingActions: [],
        effectTiming: { kind: "activated", mode: "main" },
      },
    };
    expect(() =>
      applyLegalAction({
        state,
        action: { kind: "resolve_pending_core_shoot" },
        getCardDefinitionById: getDef,
        coreShootDistribution: {},
        coreShootSoulCoreInstanceId: "bob-bearer",
      })
    ).toThrow(/cross-player destination/);
  });

  it("field_card → card_instance: cross-player では soul を移さない (auto greedy fallback)", () => {
    // BOB のスピリットに BOB のソウルが乗っている状況で、ALICE が
    // executeCoreMove({from: field_card BOB filter, to: card_instance ALICE 自身})
    // を実行する。allowSoulCoreMove = false (cross-player) で auto greedy fallback
    // は normal コアのみ移動し、BOB.soulCoreLocation は変わらない。
    const bobSpirit = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: BOB,
      zone: "field",
      instanceId: "bob-bearer",
      normalCoreCount: 1,
    });
    const aliceSpirit = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-target",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [bobSpirit, aliceSpirit],
      playerOverrides: [
        {},
        { soulCoreLocation: { kind: "card", instanceId: "bob-bearer" } },
      ],
    });
    const after = executeCoreMove(
      state,
      ALICE,
      {
        kind: "field_card",
        player: "opponent",
        filter: { category: ["spirit"] },
      },
      { kind: "card_instance", instanceId: "alice-target" },
      Number.POSITIVE_INFINITY,
      "alice-source",
      undefined,
      undefined,
      getDef
    );
    const bobAfter = after.players.find((p) => p.id === BOB)!;
    const target = after.cardInstances.find(
      (c) => c.instanceId === "alice-target"
    )!;
    const src = after.cardInstances.find((c) => c.instanceId === "bob-bearer")!;
    // 通常コアのみ移動 (BOB のスピリット 1→0、ALICE の対象 0→1)。
    expect(src.normalCoreCount).toBe(0);
    expect(target.normalCoreCount).toBe(1);
    // BOB の soul は元のカード上に残る (cross-player guard で transfer 抑止)。
    expect(bobAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "bob-bearer",
    });
  });

  it("field_card → this_card: same-player では soul を従来どおり transfer する", () => {
    // ALICE 自身が自分のスピリットを source・自分のソース card を destination に
    // 指定する same-player 経路。allowSoulCoreMove = true で soul も含めて移動。
    const aliceBearer = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-bearer",
      normalCoreCount: 0,
    });
    const aliceSource = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-src",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [aliceBearer, aliceSource],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "alice-bearer" } },
      ],
    });
    const after = executeCoreMove(
      state,
      ALICE,
      { kind: "field_card", player: "self", filter: { category: ["spirit"] } },
      { kind: "this_card" },
      Number.POSITIVE_INFINITY,
      "alice-src",
      undefined,
      undefined,
      getDef
    );
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    // ソウル単独カード (normal=0) でも same-player なら候補に含まれ soul を移動。
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "alice-src",
    });
  });

  it("field-source coreshoot 候補列挙: same-player では soul-only カードを候補に含める", () => {
    // ALICE 自身が ALICE の soul-only スピリットを源にコアシュート (自己フィールド)。
    // (= 自己のフィールド全体コアシュート。BOB の存在は無視。) → soul を候補に含める。
    const ownSoulOnly = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-soul-only",
      normalCoreCount: 0,
    });
    // 候補が 1 枚だと analyzeCoreShootCandidates は自動解決判定 (null) になるため、
    // dummy normal-only カードを並べて候補>1 を確保する。
    const otherCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-other",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [ownSoulOnly, otherCard],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "alice-soul-only" } },
      ],
    });
    const pending = analyzeCoreShootCandidates(
      state,
      ALICE,
      { kind: "field", player: "self" },
      { kind: "reserve", player: "self" },
      1,
      "none",
      undefined,
      getDef
    );
    expect(pending).not.toBeNull();
    const ids = pending!.candidates.map((c) => c.instanceId).sort();
    expect(ids).toEqual(["alice-other", "alice-soul-only"]);
  });
});
