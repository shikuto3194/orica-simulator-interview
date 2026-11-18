/**
 * ENGINE-core-move-from-life-to-this_card-soul-cross-player: core_move from:life →
 * to:this_card の soul 対応。ENGINE-core-move-from-life-to-field-card (resolved) が
 * life→field/field_card に実装した partitionLifeMoveWithSoul auto-pick +
 * pendingLifeCoreSelection (持ち主選択) を this_card 宛にも揃えた。
 * destinationCardOwnerId (=this_card の ownerPlayerId) === fromPlayerId の same-player
 * ケースのみ soul を含め、cross-player (BSTH02-X02 effects[0] のような「相手ライフ→自カード」)
 * は ENGINE-core-move-soul-cross-player-destination option b と同じく soul を除外し
 * normal-only のまま (ownership 移転未モデル化)。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const shooter: CardDefinition = {
  cardNo: "TEST-LIFE-THISCARD-SHOOTER",
  name: "ライフコア源 (このカード)",
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

const defs = new Map<string, CardDefinition>([[shooter.cardNo, shooter]]);

function effectLifeToThisCard(
  player: "self" | "opponent",
  amount: number
): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "life", player },
          to: { kind: "this_card" },
          amount,
        },
      },
    ],
  };
}

function makeState(
  cards: CardInstance[],
  opts: {
    aliceLifeNormal?: number;
    aliceSoulOnLife?: boolean;
    bobLifeNormal?: number;
    bobSoulOnLife?: boolean;
  } = {}
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    players: base.players.map((p) => {
      if (p.id === "alice") {
        return {
          ...p,
          lifeNormalCoreCount: opts.aliceLifeNormal ?? 5,
          ...(opts.aliceSoulOnLife
            ? { soulCoreLocation: { kind: "life" } }
            : {}),
        };
      }
      if (p.id === "bob") {
        return {
          ...p,
          lifeNormalCoreCount: opts.bobLifeNormal ?? 5,
          ...(opts.bobSoulOnLife ? { soulCoreLocation: { kind: "life" } } : {}),
        };
      }
      return p;
    }),
    cardInstances: cards,
  };
}

describe("core_move from:life to:this_card soul 対応 (ENGINE-core-move-from-life-to-this_card-soul-cross-player)", () => {
  it("same-player: 自分のライフが soul のみのとき shortfall auto-pick で soul をこのカードへ置く", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], {
      aliceLifeNormal: 0,
      aliceSoulOnLife: true,
    });

    const result = executeEffect({
      chainId: "test:core-move-from-life-to-this-card-soul:103",
      state,
      effect: effectLifeToThisCard("self", 1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(result.pendingLifeCoreSelection).toBeNull();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(0);
  });

  it("same-player: 通常/ソウル混在で真の選択肢があるとき pendingLifeCoreSelection を生成する (BS35 Q22728)", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], {
      aliceLifeNormal: 1,
      aliceSoulOnLife: true,
    });

    const generated = executeEffect({
      chainId: "test:core-move-from-life-to-this-card-soul:136",
      state,
      effect: effectLifeToThisCard("self", 1),
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
    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
    const shooterAfter = resolved.state.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(0);
  });

  it("cross-player (相手ライフ→自カード、BSTH02-X02 effects[0] 同型): soul のみのライフは silent no-op のまま (option b)", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = makeState([shooterCard], {
      bobLifeNormal: 0,
      bobSoulOnLife: true,
    });

    const result = executeEffect({
      chainId: "test:core-move-from-life-to-this-card-soul:191",
      state,
      effect: effectLifeToThisCard("opponent", 1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(result.pendingLifeCoreSelection).toBeNull();
    const bob = result.players.find((p) => p.id === "bob")!;
    // soul は移転されず bob のライフに残る (cross-player soul ownership 移転は未モデル化)
    expect(bob.soulCoreLocation).toEqual({ kind: "life" });
    expect(bob.lifeNormalCoreCount).toBe(0);
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    // 取れる通常コアが 0 のため no-op、元の 1 コアのまま
    expect(shooterAfter.normalCoreCount).toBe(1);
  });

  it("cross-player: 相手ライフに通常コアがあれば従来どおり normal のみ移動する", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], {
      bobLifeNormal: 2,
      bobSoulOnLife: true,
    });

    const result = executeEffect({
      chainId: "test:core-move-from-life-to-this-card-soul:223",
      state,
      effect: effectLifeToThisCard("opponent", 1),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(result.pendingLifeCoreSelection).toBeNull();
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(1);
    expect(bob.soulCoreLocation).toEqual({ kind: "life" });
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(1);
  });
});
