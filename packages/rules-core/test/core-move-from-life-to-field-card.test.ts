/**
 * ENGINE-core-move-from-life-to-field-card: core_move from:life → to:field / field_card
 * の dispatch 対応。10_rules/06 §41-42・§54・§121-124「generic なライフのコアはフィールドへも
 * 置ける (soul 含む)」。旧実装は from=life → to:field/field_card の分岐が無く partial-impl
 * ログに落ちていた (structured-effect-interpreter.ts 旧 L2810-2817 の allowLife=false 除外)。
 * トラッシュ→フィールド (from:trash to:field) と同型の候補フィルタ + pendingCoreDistribution
 * を実装し、shortfall 時のソウルコア auto-pick と BS35 Q22728 持ち主選択 pending
 * (ENGINE-core-move-from-life-owner-soul-choice と同じパターン) を life→trash/reserve と
 * 揃えた。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const shooter: CardDefinition = {
  cardNo: "TEST-LIFE-FIELD-SHOOTER",
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

const target: CardDefinition = {
  cardNo: "TEST-LIFE-FIELD-TARGET",
  name: "配置先スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([
  [shooter.cardNo, shooter],
  [target.cardNo, target],
]);

function effectSelfLifeToField(amount: number): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "life", player: "self" },
          to: { kind: "field", player: "self" },
          amount,
        },
      },
    ],
  };
}

function makeState(
  cards: CardInstance[],
  opts: { lifeNormal?: number; soulOnLife?: boolean } = {}
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            lifeNormalCoreCount: opts.lifeNormal ?? 5,
            ...(opts.soulOnLife
              ? { soulCoreLocation: { kind: "life" }, lifeSoulCoreCount: 1 }
              : {}),
          }
        : p
    ),
    cardInstances: cards,
  };
}

describe("core_move from:life to:field/field_card (ENGINE-core-move-from-life-to-field-card)", () => {
  it("候補1体のみ: 自動 fallback で直接コアを置き、lifeNormalCoreCount を減算する", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
      everHadCorePlaced: false,
    });
    const state = makeState([shooterCard], { lifeNormal: 3 });

    const result = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:103",
      state,
      effect: effectSelfLifeToField(2),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(result.pendingCoreDistribution).toBeNull();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(1);
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    // 元 2 コア + ライフから 2 = 4
    expect(shooterAfter.normalCoreCount).toBe(4);
    expect(shooterAfter.everHadCorePlaced).toBe(true);
  });

  it("候補複数: pendingCoreDistribution (fromKind='life') が生成され、resolve でライフが減算される", () => {
    const s1 = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const s2 = createCardInstance(target, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = makeState([s1, s2], { lifeNormal: 2 });

    const generated = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:137",
      state,
      effect: effectSelfLifeToField(1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(generated.pendingCoreDistribution).not.toBeNull();
    const pending = generated.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("life");
    expect(pending.totalNormalCores).toBe(1);
    expect(pending.hasSoulCore).toBe(false);
    expect(pending.candidates.map((c) => c.instanceId).sort()).toEqual([
      "shooter-1",
      "target-1",
    ]);
    // 候補提示時点ではライフはまだ減っていない
    const aliceMid = generated.players.find((p) => p.id === "alice")!;
    expect(aliceMid.lifeNormalCoreCount).toBe(2);

    const actions = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    expect(cdAction).toBeDefined();
    if (cdAction.kind === "resolve_pending_core_distribution") {
      expect(cdAction.fromKind).toBe("life");
    }

    const applied = applyLegalAction({
      state: generated,
      action: cdAction,
      getCardDefinitionById: (id) => defs.get(id),
      coreDistributionAllocations: { "target-1": 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const aliceAfter = applied.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.lifeNormalCoreCount).toBe(1);
    const targetAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    // 元 1 コア + ライフから 1 = 2
    expect(targetAfter.normalCoreCount).toBe(2);
  });

  it("field_card filter: 候補を絞り込み、対象外カードには配分できない", () => {
    const s1 = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const t1 = createCardInstance(target, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = makeState([s1, t1], { lifeNormal: 2 });

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "self" },
            to: {
              kind: "field_card",
              player: "self",
              filter: { cardName: { exact: target.name } },
            },
            amount: 1,
          },
        },
      ],
    };

    const generated = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:221",
      state,
      effect,
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // 候補が target-1 のみに絞られるため単一 fallback で直接適用される
    expect(generated.pendingCoreDistribution).toBeNull();
    const targetAfter = generated.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(targetAfter.normalCoreCount).toBe(2);
    const shooterAfter = generated.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(1);
  });

  it("soul のみのライフ (normal 不足) から shortfall-triggered auto-pick で soul を候補に加え、明示配置で置く", () => {
    // 候補1体でも hasSoulCore=true (トラッシュ→フィールドの trashHasSoulCore と同型) の
    // ときは、ソウル配置先を明示選択させるため pendingCoreDistribution を立てる。
    const s1 = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = makeState([s1], { lifeNormal: 0, soulOnLife: true });

    const generated = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:252",
      state,
      effect: effectSelfLifeToField(1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(generated.pendingCoreDistribution).not.toBeNull();
    const pending = generated.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("life");
    expect(pending.totalNormalCores).toBe(0);
    expect(pending.hasSoulCore).toBe(true);

    const actions = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: generated,
      action: cdAction,
      getCardDefinitionById: (id) => defs.get(id),
      coreDistributionSoulCoreInstanceId: "shooter-1",
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    expect(applied.state.gameResult).toEqual({
      kind: "player_loss",
      losingPlayerId: "alice",
      reason: "life_zero",
    });
    const alice = applied.state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
  });

  it("通常/ソウル混在で真の選択肢があるとき pendingLifeCoreSelection を生成する (BS35 Q22728)", () => {
    const s1 = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = makeState([s1], { lifeNormal: 1, soulOnLife: true });

    const generated = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:305",
      state,
      effect: effectSelfLifeToField(1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(generated.pendingLifeCoreSelection).not.toBeNull();
    expect(generated.pendingLifeCoreSelection!.normalAvailable).toBe(1);
    expect(generated.pendingLifeCoreSelection!.soulAvailable).toBe(1);
    expect(generated.pendingLifeCoreSelection!.totalAmount).toBe(1);

    const actions = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_life_core_selection"
    )!;
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: generated,
      action,
      getCardDefinitionById: (id) => defs.get(id),
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    });
    expect(resolved.state.pendingLifeCoreSelection).toBeNull();
    // soulChosen=1 は候補への配置先選択がまだ必要なため、二段目の
    // pendingCoreDistribution (hasSoulCore=true) が続けて立つ。
    expect(resolved.state.pendingCoreDistribution).not.toBeNull();
    expect(resolved.state.pendingCoreDistribution!.hasSoulCore).toBe(true);
    expect(resolved.state.pendingCoreDistribution!.totalNormalCores).toBe(0);
    const aliceMid = resolved.state.players.find((p) => p.id === "alice")!;
    expect(aliceMid.lifeNormalCoreCount).toBe(1);
    expect(aliceMid.soulCoreLocation).toEqual({ kind: "life" });

    const actions2 = getLegalActions({
      state: resolved.state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const cdAction = actions2.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    const finalApplied = applyLegalAction({
      state: resolved.state,
      action: cdAction,
      getCardDefinitionById: (id) => defs.get(id),
      coreDistributionSoulCoreInstanceId: "shooter-1",
    });
    expect(finalApplied.state.pendingCoreDistribution).toBeNull();
    const alice = finalApplied.state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
  });

  it("cross-player (相手ライフ→自分フィールド): shortfall でも soul は候補に含めず、resolve 後も soul は相手ライフに残る (ENGINE-core-move-soul-cross-player-destination option b)", () => {
    const s1 = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const t1 = createCardInstance(target, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "bob"
          ? {
              ...p,
              lifeNormalCoreCount: 1,
              soulCoreLocation: { kind: "life" },
            }
          : p
      ),
      cardInstances: [s1, t1],
    };

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "field", player: "self" },
            amount: 2,
          },
        },
      ],
    };

    const generated = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:409",
      state,
      effect,
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // bob の通常コアは 1 個のみ (amount=2 に shortfall) だが、cross-player
    // destination では soul ownership 移転が未モデル化のため hasSoulCore=false
    // (同一プレイヤー内なら shortfall-triggered soul auto-pick が働くケース)。
    expect(generated.pendingCoreDistribution).not.toBeNull();
    const pending = generated.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("life");
    expect(pending.totalNormalCores).toBe(1);
    expect(pending.hasSoulCore).toBe(false);

    const actions = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: generated,
      action: cdAction,
      getCardDefinitionById: (id) => defs.get(id),
      coreDistributionAllocations: { "target-1": 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const bobAfter = applied.state.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(0);
    // soul は移転されず bob のライフに残る
    expect(bobAfter.soulCoreLocation).toEqual({ kind: "life" });

    // 明示的に soulCoreInstanceId を渡そうとしても pending.hasSoulCore=false のため reject
    const generated2 = executeEffect({
      chainId: "test:core-move-from-life-to-field-card:449",
      state,
      effect,
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const actions2 = getLegalActions({
      state: generated2,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const cdAction2 = actions2.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    expect(() =>
      applyLegalAction({
        state: generated2,
        action: cdAction2,
        getCardDefinitionById: (id) => defs.get(id),
        coreDistributionSoulCoreInstanceId: "shooter-1",
      })
    ).toThrow();
  });
});
