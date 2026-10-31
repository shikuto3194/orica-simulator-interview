/**
 * BSTH07.8 (妖精大戦争) カードの effects 検証テスト。
 *
 * 共通: 「軽減シンボルは赤/紫/緑/白/黄/青としても扱う」= treat_as(reduction_symbol)×6。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  applyLegalAction,
  collectContinuousEffectInvariantIssues,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getEffectiveTribes,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { calculateReduction } from "../src/core/cost-system";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  GameState,
  GameStateInvariantIssue,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const fieldEffectLookup = buildFieldCardEffectLookup(ALL_CARDS);
const triggeredEffectLookup = buildTriggeredEffectLookup(ALL_CARDS);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth07_8-cards:45",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

/** effects[0] が 6 色の軽減シンボル treat_as であることを検証 */
function expectReductionRainbow(card: CardDefinition) {
  const e = card.effects![0]!;
  const colors = e.steps
    .map((s) => (s.action.kind === "treat_as" ? s.action.asColor : null))
    .filter(Boolean);
  expect(colors).toEqual(["red", "purple", "green", "white", "yellow", "blue"]);
  e.steps.forEach((s) => {
    if (s.action.kind === "treat_as") {
      expect(s.action.aspects).toEqual(["reduction_symbol"]);
      expect(s.action.appliesToCard).toBe(true);
    }
  });
}

describe("BSTH07.8 軽減シンボル虹化 (共通)", () => {
  it.each([
    "BSTH07.8-C01",
    "BSTH07.8-C02",
    "BSTH07.8-C03",
    "BSTH07.8-C04",
    "BSTH07.8-C05",
    "BSTH07.8-M01",
    "BSTH07.8-R01",
    "BSTH07.8-R02",
    "BSTH07.8-R03",
    "BSTH07.8-R04",
    "BSTH07.8-X01",
  ])("%s は effects[0] で 6 色 reduction_symbol treat_as を持つ", (cardNo) => {
    expectReductionRainbow(cardNoMap.get(cardNo)!);
  });
});

// ============================================================
// C01 / C02 妖精 / メイド妖精
// ============================================================
describe.each([
  ["BSTH07.8-C01", "妖精"],
  ["BSTH07.8-C02", "メイド妖精"],
])("%s %s", (cardNo) => {
  const card = cardNoMap.get(cardNo)!;
  it("メイン: 導界者不在条件 + 疲労コスト→deck_reveal", () => {
    const e = card.effects![1]!;
    expect(e.condition).toEqual([
      { kind: "field_lacks", player: "self", grandwalkerKind: "guided" },
    ]);
    expect(e.steps[0]!.action.kind).toBe("set_exhaust_state");
    expect(e.steps[1]!.connector).toBe("conditional_cost");
    expect(e.steps[1]!.action.kind).toBe("deck_reveal");
  });

  it("空デッキでは疲労コスト付き deck_reveal を legal action に出さない", () => {
    const source = createCardInstance(card, {
      instanceId: `${cardNo}-source`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      window: "none",
      cardInstances: [source],
    };
    const fieldActions = (candidateState: GameState) =>
      getLegalActions({
        state: candidateState,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldEffectLookup,
        getRegisteredTriggeredEffectActions: triggeredEffectLookup,
      }).filter(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === source.instanceId
      );

    expect(fieldActions(state)).toHaveLength(0);

    const deckCard = createCardInstance(card, {
      instanceId: `${cardNo}-deck`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    expect(
      fieldActions({ ...state, cardInstances: [source, deckCard] })
    ).toHaveLength(1);
  });
});

// ============================================================
// C03 リリーホワイト
// ============================================================
describe("BSTH07.8-C03 [妖精大戦争]リリーホワイト", () => {
  const card = cardNoMap.get("BSTH07.8-C03")!;
  it("召喚時 deck_reveal (妖精導界者 + 妖精コスト3以上) / Lv2 軽減制限", () => {
    const reveal = card.effects![1]!.steps[0]!.action;
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[1]!.filter?.minCost).toBe(3);
    }
    expect(card.effects![2]!.stub).toBeUndefined();
    expect(card.effects![2]!.steps[0]!.action.kind).toBe(
      "prevent_cost_reduction"
    );
  });

  it("召喚時効果実行: pendingDeckReveal が生成される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "lily-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `d${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    const result = runEffect(state, card.effects![1]!, "lily-1", "alice");
    expect(result.pendingDeckReveal).not.toBeNull();
  });
});

// ============================================================
// C04 ひまわり妖精
// ============================================================
describe("BSTH07.8-C04 ひまわり妖精", () => {
  const card = cardNoMap.get("BSTH07.8-C04")!;
  it("召喚時 deck_reveal / 相手ネクサス発生源限定 effect_immunity (sourceScope.categories=[nexus])", () => {
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("deck_reveal");
    const immune = card.effects![2]!;
    expect(immune.stub).toBeUndefined();
    const a = immune.steps[0]!.action;
    expect(a.kind).toBe("effect_immunity");
    if (a.kind === "effect_immunity") {
      expect(a.target).toEqual({ kind: "self" });
      expect(a.duration).toEqual({ scope: "while_on_field" });
      expect(a.sourceScope).toEqual({ categories: ["nexus"] });
    }
  });
});

// ============================================================
// C05 霧の湖 (ネクサス)
// ============================================================
describe("BSTH07.8-C05 霧の湖", () => {
  const card = cardNoMap.get("BSTH07.8-C05")!;
  it("妖精 発生源限定自己回収 / 配置時 deck_reveal(4枚) / フラッシュ召喚(ライフコスト+summon)", () => {
    const place = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps[0]?.action.kind === "deck_reveal"
    )!;
    const reveal = place.steps[0]!.action;
    if (reveal.kind === "deck_reveal") expect(reveal.revealCount).toBe(4);
    // 自己回収（妖精効果でオープン/トラッシュ行き → 手札）は BSFT01-C02 add 型で実装済。
    const recover = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps[0]?.action.kind === "move_self"
    )!;
    expect(recover).toBeDefined();
    expect(recover.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
      { kind: "trigger_tribes", tribes: ["妖精"] },
      { kind: "trigger_from_zone", zones: ["deck"] },
    ]);
    expect(recover.stub).toBeUndefined();
    // フラッシュ召喚(妖精導界者ネクサスLv2条件+ライフコア1個コスト+手札/トラッシュ召喚)も
    // field_has(minLevel/maxLevel) + conditional_cost で実装済み (詳細は
    // bsth07-8-c05-fairy-life-cost-summon.test.ts)。残る stub は 0 件。
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });
});

describe("BSTH07.8-R01 サニーミルク", () => {
  const card = cardNoMap.get("BSTH07.8-R01")!;
  const attackEffect = card.effects!.find(
    (effect) => effect.timing.kind === "card_event"
  )!;

  it("アタック時: トラッシュのソウルコア以外1個をこのスピリットに置く", () => {
    const action = attackEffect.steps[0]!.action;
    expect(attackEffect.stub).toBeUndefined();
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from).toEqual({ kind: "trash", player: "self" });
      expect(action.to).toEqual({ kind: "this_card" });
      expect(action.amount).toBe(1);
      expect(action.effectKind).toBe("normal_only");
    }
  });

  it("実行: 通常コアだけをトラッシュから置き、トラッシュのソウルコアは動かさない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sunny-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              trashNormalCoreCount: 1,
              soulCoreLocation: { kind: "trash" },
            }
          : p
      ),
    };

    const moved = runEffect(state, attackEffect, "sunny-1", "alice");
    expect(
      moved.cardInstances.find((c) => c.instanceId === "sunny-1")!
        .normalCoreCount
    ).toBe(3);
    const aliceAfterMove = moved.players.find((p) => p.id === "alice")!;
    expect(aliceAfterMove.trashNormalCoreCount).toBe(0);
    expect(aliceAfterMove.soulCoreLocation).toEqual({ kind: "trash" });

    const soulOnly: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, trashNormalCoreCount: 0 } : p
      ),
    };
    const skipped = runEffect(soulOnly, attackEffect, "sunny-1", "alice");
    expect(
      skipped.cardInstances.find((c) => c.instanceId === "sunny-1")!
        .normalCoreCount
    ).toBe(2);
    const aliceAfterSkip = skipped.players.find((p) => p.id === "alice")!;
    expect(aliceAfterSkip.trashNormalCoreCount).toBe(0);
    expect(aliceAfterSkip.soulCoreLocation).toEqual({ kind: "trash" });
  });
});

// ============================================================
// M01 大妖精
// ============================================================
describe("BSTH07.8-M01 [妖精大戦争]大妖精", () => {
  const card = cardNoMap.get("BSTH07.8-M01")!;
  it("メイン: 疲労+コア2+deck_reveal7(妖精導界者+チルノ exact) ゲーム1回", () => {
    const e = card.effects![1]!;
    expect(e.usageLimit).toEqual({ kind: "per_card_name", duration: "game" });
    const reveal = e.steps[2]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(7);
      expect(reveal.picks[1]!.filter?.cardName).toEqual({ exact: "チルノ" });
      expect(reveal.remainder).toBe("trash");
    }
  });

  /** CE 登録後にフィールド上の対象カードを離脱経路 (pendingLeave) へ乗せる。
   * pendingLeaveKind は resolveTargetCards の候補から離脱中カードを除外するガード
   * (native-target-resolution.ts L685) があるため、CE 登録より後に付与する。 */
  function queuePendingLeave(
    state: GameState,
    instanceId: string,
    kind: "destroy" | "vanish",
    causePlayerId: string
  ): GameState {
    return {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === instanceId
          ? {
              ...c,
              pendingLeaveKind: kind,
              pendingLeaveCause: "effect_resolution",
              pendingLeaveChainId: `chain-${instanceId}`,
            }
          : c
      ),
      pendingLeaveEntities: [
        {
          instanceId,
          kind,
          cause: "effect_resolution",
          causePlayerId,
          chainId: `chain-${instanceId}`,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
  }

  it("Lv2: 系統「妖精」の自分のスピリットが相手効果で破壊/消滅したとき、手札に戻る（トラッシュへ行かない）", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!; // 幻想・妖精 spirit
    for (const kind of ["destroy", "vanish"] as const) {
      const m01 = createCardInstance(card, {
        instanceId: "m01",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3, // Lv2 (levelDefs[1].requiredCores)
      });
      const ally = createCardInstance(fairySpirit, {
        instanceId: `ally-${kind}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      let state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [m01, ally],
      });
      state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);

      // class-wide (dynamic filter) CE として登録される。targetInstanceId 固定の
      // per-target snapshot ではなく targetFilter を持つ (後から召喚された個体も追従)。
      const ce = state.activeContinuousEffects.find(
        (c) =>
          c.modifierTag === "replace_field_exit" && c.targetFilter !== undefined
      );
      expect(ce).toBeDefined();

      state = queuePendingLeave(state, ally.instanceId, kind, BOB);
      const flushed = flushPendingLeaves(state, getCardDefinitionById);
      const allyAfter = flushed.cardInstances.find(
        (c) => c.instanceId === ally.instanceId
      )!;
      expect(allyAfter.zone).toBe("hand");
    }
  });

  it("CE 登録後に召喚された妖精スピリットも class-wide (dynamic filter) CE で追従保護される (adversarial verifier 2026-07-30 round1 指摘の回帰確認)", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!;
    const m01 = createCardInstance(card, {
      instanceId: "m01-late",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01],
    });
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);

    // M01 が Lv2 化した後に別の妖精スピリットを召喚する (per-target snapshot だと
    // 見逃す個体)。
    const lateFairy = createCardInstance(fairySpirit, {
      instanceId: "late-fairy",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = {
      ...state,
      cardInstances: [...state.cardInstances, lateFairy],
    };
    state = recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);

    state = queuePendingLeave(state, lateFairy.instanceId, "destroy", BOB);
    const flushed = flushPendingLeaves(state, getCardDefinitionById);
    const lateFairyAfter = flushed.cardInstances.find(
      (c) => c.instanceId === lateFairy.instanceId
    )!;
    expect(lateFairyAfter.zone).toBe("hand");
  });

  it("自分の効果による破壊/消滅は置換されない（source:opponent_effect gate）", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!;
    const m01 = createCardInstance(card, {
      instanceId: "m01-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const ally = createCardInstance(fairySpirit, {
      instanceId: "ally-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01, ally],
    });
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    state = queuePendingLeave(state, ally.instanceId, "destroy", ALICE); // 自分自身が破壊 → 置換対象外
    const flushed = flushPendingLeaves(state, getCardDefinitionById);
    const allyAfter = flushed.cardInstances.find(
      (c) => c.instanceId === ally.instanceId
    )!;
    expect(allyAfter.zone).toBe("trash");
  });

  it("Lv1 では継続効果が未成立のため通常通りトラッシュへ行く", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!;
    const m01 = createCardInstance(card, {
      instanceId: "m01-lv1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv1
    });
    const ally = createCardInstance(fairySpirit, {
      instanceId: "ally-lv1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01, ally],
    });
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    expect(
      state.activeContinuousEffects.some(
        (c) => c.modifierTag === "replace_field_exit"
      )
    ).toBe(false);

    state = queuePendingLeave(state, ally.instanceId, "destroy", BOB);
    const flushed = flushPendingLeaves(state, getCardDefinitionById);
    const allyAfter = flushed.cardInstances.find(
      (c) => c.instanceId === ally.instanceId
    )!;
    expect(allyAfter.zone).toBe("trash");
  });
});

// ============================================================
// R01 / R02 / R03 アタック時コア操作
// ============================================================
describe("BSTH07.8-R01 サニーミルク", () => {
  const card = cardNoMap.get("BSTH07.8-R01")!;
  it("Lv2 アタック時 トラッシュ→自身 core_move", () => {
    const e = card.effects![1]!;
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const a = e.steps[0]!.action;
    expect(a.kind).toBe("core_move");
    if (a.kind === "core_move") {
      expect(a.from).toEqual({ kind: "trash", player: "self" });
      expect(a.to).toEqual({ kind: "this_card" });
    }
  });
});

describe("BSTH07.8-R02 ルナチャイルド", () => {
  const card = cardNoMap.get("BSTH07.8-R02")!;
  it("Lv2 アタック時 ライフ3以下で ボイド→ライフ", () => {
    const e = card.effects![1]!;
    expect(e.condition).toContainEqual({
      kind: "life_value",
      player: "self",
      max: 3,
    });
    const a = e.steps[0]!.action;
    if (a.kind === "core_move") {
      expect(a.to).toEqual({ kind: "life", player: "self" });
    }
  });

  it("実行: ライフコアが+1される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "luna-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, voidNormalCoreCount: 5, lifeNormalCoreCount: 2 }
          : p
      ),
    };
    const result = runEffect(state, card.effects![1]!, "luna-1", "alice");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(3);
  });
});

describe("BSTH07.8-R03 スターサファイア", () => {
  const card = cardNoMap.get("BSTH07.8-R03")!;
  it("Lv2 アタック時 相手リザーブ→トラッシュ core_move", () => {
    const a = card.effects![1]!.steps[0]!.action;
    if (a.kind === "core_move") {
      expect(a.from).toEqual({ kind: "reserve", player: "opponent" });
      expect(a.to).toEqual({ kind: "trash", player: "opponent" });
    }
  });
});

// ============================================================
// R04 パーフェクトフリーズ (マジック)
// ============================================================
describe("BSTH07.8-R04 凍符「パーフェクトフリーズ」", () => {
  const card = cardNoMap.get("BSTH07.8-R04")!;
  it("フラッシュ: 相手2体を prevent_battle (attack/block, turn)", () => {
    const flash = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "prevent_battle"
    )!;
    const a = flash.steps[0]!.action;
    if (a.kind === "prevent_battle") {
      expect(a.restriction).toEqual(["attack", "block"]);
      if (typeof a.target === "object" && "count" in a.target) {
        expect(a.target.count).toBe(2);
      }
    }
  });

  it("妖精効果でオープン/トラッシュ行きの自己回収は optional add 型", () => {
    const recovery = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (Array.isArray(e.timing.event)
          ? e.timing.event.includes("moved_to_trash")
          : e.timing.event === "moved_to_trash")
    );
    expect(recovery?.stub).toBeUndefined();
    expect(recovery?.executionMode).toBe("optional");
    expect(recovery?.cardEventDisposition).toEqual({
      kind: "move",
      destination: "hand",
    });
    expect(recovery?.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
      {
        kind: "trigger_source_match",
        cardNames: [{ contains: "霧の湖" }],
        tribes: ["妖精"],
      },
      { kind: "trigger_from_zone", zones: ["deck"] },
    ]);
    expect(recovery?.steps[0]?.action).toEqual({
      kind: "move_self",
      destination: "hand",
    });
  });

  it("アタック/ブロック中の妖精スピリット1体につきコスト-1（手札にある間のみ、動的に再評価される）", () => {
    // additionalCost（自己 cost_modify 由来の相対加算/軽減のみ）で検証する。printed 軽減
    // シンボル軽減（effects[0] のレインボー treat_as + 妖精カード自身の printed 色シンボル）は
    // 別軸で常時混入するため finalCost では確認しない (additionalCostModifiers が SSOT)。
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!; // 幻想・妖精 spirit
    const additionalCostWith = (inBattleCount: 0 | 1 | 2): number => {
      const source = createCardInstance(card, {
        instanceId: "self-r04",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const fairies = Array.from({ length: 2 }, (_, i) =>
        createCardInstance(fairySpirit, {
          instanceId: `fairy-${i}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        })
      );
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, ...fairies],
        battleEntities: fairies.slice(0, inBattleCount).map((f, i) => ({
          entityId: `be-fairy-${i}`,
          memberInstanceIds: [f.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: [],
          attackState:
            i % 2 === 0 ? ("attacking" as const) : ("blocking" as const),
        })),
      });
      return calculateReduction({
        state,
        actingPlayerId: ALICE,
        card,
        getCardDefinitionById,
        sourceInstanceId: "self-r04",
      }).additionalCost;
    };

    expect(additionalCostWith(0)).toBe(0);
    expect(additionalCostWith(1)).toBe(-1);
    expect(additionalCostWith(2)).toBe(-2);
  });

  it("フィールド上 (applicability zone 外) では自己コスト減少を評価しない", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!;
    const source = createCardInstance(card, {
      instanceId: "self-r04-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const fairy = createCardInstance(fairySpirit, {
      instanceId: "fairy-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, fairy],
      battleEntities: [
        {
          entityId: "be-fairy-field",
          memberInstanceIds: ["fairy-field"],
          resolvedBp: 3000,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
    });
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card,
      getCardDefinitionById,
      sourceInstanceId: "self-r04-field",
    });
    expect(result.additionalCost).toBe(0);
    expect(result.additionalCostModifiers).toEqual([]);
  });
});

// ============================================================
// X01 チルノ
// ============================================================
describe("BSTH07.8-X01 チルノ", () => {
  const card = cardNoMap.get("BSTH07.8-X01")!;
  it("界放：3 は実装済み (engine-summon-target-self-paid-cost) + Lv2 アタックステップ ネクサス/マジック耐性 (sourceScope.categories)", () => {
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
    expect(
      card.effects!.find((e) => e.timing.kind === "activated")?.stub
    ).toBeUndefined();
    const divineRelease = card.effects!.find(
      (e) => e.timing.kind === "activated"
    );
    expect(divineRelease?.steps[0]?.action.kind).toBe("core_move");
    expect(divineRelease?.steps[1]?.action.kind).toBe("summon");
    const immune = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    );
    expect(immune?.condition).toEqual([{ kind: "min_level", value: 2 }]);
    // 「自分のアタックステップ」限定 timingScope
    expect(immune?.timingScope).toEqual({ player: "self", period: "attack" });
    expect(immune?.stub).toBeUndefined();
    const a = immune!.steps[0]!.action;
    expect(a.kind).toBe("effect_immunity");
    if (a.kind === "effect_immunity") {
      expect(a.sourceScope).toEqual({ categories: ["nexus", "magic"] });
      expect(a.target).toEqual({ kind: "self" });
      expect(a.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("アタック/ブロック中の妖精スピリット/アルティメット1体につきコスト-1（手札にある間のみ）", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!; // 幻想・妖精 spirit
    const source = createCardInstance(card, {
      instanceId: "self-x01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const fairy = createCardInstance(fairySpirit, {
      instanceId: "fairy-x01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const idleState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, fairy],
    });
    const battlingState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, fairy],
      battleEntities: [
        {
          entityId: "be-fairy-x01",
          memberInstanceIds: ["fairy-x01"],
          resolvedBp: 3000,
          resolvedSymbols: [],
          attackState: "blocking",
        },
      ],
    });
    // additionalCost で検証する（effects[0] のレインボー treat_as + 妖精カード自身の
    // printed 色シンボルによる通常軽減が別軸で混入するため finalCost では確認しない）。
    const additionalCostOf = (state: GameState) =>
      calculateReduction({
        state,
        actingPlayerId: ALICE,
        card,
        getCardDefinitionById,
        sourceInstanceId: "self-x01",
      }).additionalCost;

    expect(additionalCostOf(idleState)).toBe(0);
    expect(additionalCostOf(battlingState)).toBe(-1);
  });

  it("手札の自己対象 additional_cost CE は再計算で失効せず整合性を保つ", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const fairySpirit = cardNoMap.get("BSTH07.8-C01")!;
    const source = createCardInstance(card, {
      instanceId: "self-x01-hand-ce",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const fairy = createCardInstance(fairySpirit, {
      instanceId: "fairy-x01-hand-ce",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, fairy],
      battleEntities: [
        {
          entityId: "be-fairy-x01-hand-ce",
          memberInstanceIds: [fairy.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: [],
          attackState: "blocking",
        },
      ],
    });

    const registered = recomputeAndRebuildContinuousEffects(
      state,
      getCardDefinitionById
    );
    const additionalCost = registered.activeContinuousEffects.find(
      (ce) =>
        ce.sourceInstanceId === source.instanceId &&
        ce.modifierTag === "additional_cost"
    );
    expect(additionalCost).toMatchObject({
      targetInstanceId: source.instanceId,
      modifierAmount: -1,
      metadata: { sourceApplicabilityZone: ["hand"] },
      provenance: { effectIndex: 1, stepIndex: 0 },
    });
    if (!additionalCost) {
      throw new Error("BSTH07.8-X01 hand additional_cost CE missing");
    }

    const recomputed = recomputeContinuousEffects(registered);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) => ce.effectId === additionalCost.effectId
      )
    ).toBe(true);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: recomputed,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toEqual([]);
  });
});

// ============================================================
// X02 [妖精大戦争]霧雨 魔理沙 (バースト)
// ============================================================
describe("BSTH07.8-X02 [妖精大戦争]霧雨 魔理沙", () => {
  const card = cardNoMap.get("BSTH07.8-X02")!;
  it("BSTH07.8-X02 バーストは BP-5000 を3回発揮し、BP0破壊後の召喚は任意にする", () => {
    const burst = card.effects!.find((e) => e.timing.kind === "burst")!;
    expect(burst.stub).toBeUndefined();
    expect(burst.timing).toMatchObject({
      kind: "burst",
      trigger: "相手によって自分のスピリットがフィールドを離れた後",
      triggerFilter: { category: ["spirit"] },
      cause: ["opponent_effect", "battle"],
    });
    expect(burst.steps[0]!.action.kind).toBe("bp_modify");
    expect(burst.steps[0]!.repeat).toEqual({ additional: 2 });
    expect(burst.steps[1]!.action).toEqual({
      kind: "destroy",
      target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
    });
    expect(burst.steps[2]!.action.kind).toBe("noop");
    expect(burst.steps[2]!.choice?.[0]?.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
    const atk = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps[0]?.action.kind === "core_move"
    )!;
    expect(atk.condition).toEqual([{ kind: "min_level", value: 3 }]);
    const a = atk.steps[0]!.action;
    if (a.kind === "core_move") {
      expect(a.from).toEqual({ kind: "life", player: "opponent" });
    }
  });

  it("BSTH07.8-X02 バースト登録はBP-5000の3回分を対象選択に載せる", () => {
    const lookup = buildBurstEffectLookup([card]);
    const burstReg = lookup("BSTH07.8-X02")?.[0];
    expect(burstReg).toMatchObject({
      eventKind: "leave_field",
      whose: "self",
      triggerFilter: { category: ["spirit"] },
      cause: ["opponent_effect", "battle"],
    });
    expect(burstReg?.choices).toBeUndefined();
    expect(burstReg).toMatchObject({
      requiredTargetCount: 3,
      maxTargetCount: 3,
      allowDuplicateTargets: true,
    });
  });

  it("[board] BSTH07.8-X02 バーストは同じ対象を3回BP-5000し、BP0になった相手を破壊する", () => {
    const source = createCardInstance(card, {
      instanceId: "marisa-x02",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const enemyDef = cardNoMap.get("BSTH07.8-C01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x02",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [source, enemy],
    };

    const result = executeEffect({
      chainId: "test:bsth07_8-cards:940",
      state,
      effect: card.effects!.find((e) => e.timing.kind === "burst")!,
      sourceInstanceId: "marisa-x02",
      actingPlayerId: "alice",
      targetInstanceIds: ["enemy-x02", "enemy-x02", "enemy-x02"],
      getCardDefinitionById,
    });

    expect(
      result.log.filter((line) =>
        line.startsWith("effect:bp_modify:registered:enemy-x02:-5000")
      )
    ).toHaveLength(3);
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-x02"
    )!;
    expect(enemyAfter.pendingLeaveKind).toBe("destroy");
  });

  it("[board] BSTH07.8-X02 バースト後の召喚選択はコスト7を払わず、維持コアだけで着地する", () => {
    const source = createCardInstance(card, {
      instanceId: "marisa-x02-free-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const enemyDef = cardNoMap.get("BSTH07.8-C01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x02-free-summon",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [source, enemy],
      // 印字コスト7には足りず、Lv1維持コア1個だけを用意する。
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 1 }
          : player
      ),
    };

    const result = executeEffect({
      chainId: "test:bsth07_8-cards:x02-free-summon",
      state,
      effect: card.effects!.find((e) => e.timing.kind === "burst")!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: [enemy.instanceId, enemy.instanceId, enemy.instanceId],
      choiceIndex: 1,
      getCardDefinitionById,
    });

    expect(
      result.cardInstances.find(
        (entry) => entry.instanceId === source.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 0 });
    expect(result.pendingMultiPlacement).toMatchObject({
      actingPlayerId: "alice",
      targets: [
        expect.objectContaining({
          instanceId: source.instanceId,
          minimumCoreCount: 1,
          enterFieldEventKind: "summon",
        }),
      ],
    });

    const resolvePlacement = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredEffectLookup,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: result,
      action: resolvePlacement!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredEffectLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: source.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;

    expect(
      resolved.cardInstances.find(
        (entry) => entry.instanceId === source.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    const alice = resolved.players.find((player) => player.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("[board] 相手効果のデッキ送りでもフィールドを離れた後バーストが候補に乗る", () => {
    const source = createCardInstance(card, {
      instanceId: "marisa-x02",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const victimDef = cardNoMap.get("BSTH07.8-C01")!;
    const victim = createCardInstance(victimDef, {
      instanceId: "alice-spirit-x02",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const before: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "main",
      cardInstances: [source, victim],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "marisa-x02" }],
    };
    const after: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((instance) =>
        instance.instanceId === "alice-spirit-x02"
          ? {
              ...instance,
              zone: "deck",
              normalCoreCount: 0,
              exhaustState: "recovered",
            }
          : instance
      ),
      log: [...before.log, "effect:send_to_deck:alice-spirit-x02:bottom"],
    };

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth07_8-cards:998",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        card,
        victimDef,
      ]),
      getRegisteredBurstActions: buildBurstEffectLookup([card, victimDef]),
    });

    expect(queued.pendingBurstChecks).toContainEqual(
      expect.objectContaining({
        actingPlayerId: "alice",
        eventKind: "leave_field",
        relatedPlayerId: "alice",
        relatedInstanceId: "alice-spirit-x02",
        event: expect.objectContaining({
          family: "leave_field",
          cause: "opponent_effect",
        }),
      })
    );
  });

  it('card-data: effects[0] は zone:"revealed" 限定の override_properties.addTribes(妖精)', () => {
    const grant = card.effects![0]!;
    expect(grant.stub).toBeUndefined();
    expect(grant.applicability).toEqual({ zone: "revealed" });
    expect(grant.steps[0]!.action).toEqual({
      kind: "override_properties",
      target: { kind: "self" },
      properties: { addTribes: ["妖精"] },
      duration: { scope: "while_revealed" },
    });
  });

  it("[board] デッキからオープンされている間だけ系統「妖精」を得る (ENGINE-revealed-zone-continuous-effect-applicability)", () => {
    const source = createCardInstance(card, {
      instanceId: "marisa-x02-reveal",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [source],
    };

    const revealedState = recomputeAndRebuildContinuousEffects(
      state,
      getCardDefinitionById
    );
    const revealedCard = revealedState.cardInstances.find(
      (c) => c.instanceId === "marisa-x02-reveal"
    )!;
    expect(
      getEffectiveTribes(
        revealedState,
        revealedCard,
        card,
        getCardDefinitionById
      )
    ).toContain("妖精");

    // revealed を離れて field へ着地したら系統付与は消える (CE は残さない)。
    const fieldedState: GameState = {
      ...revealedState,
      cardInstances: revealedState.cardInstances.map((c) =>
        c.instanceId === "marisa-x02-reveal" ? { ...c, zone: "field" } : c
      ),
    };
    const settled = recomputeAndRebuildContinuousEffects(
      fieldedState,
      getCardDefinitionById
    );
    const fieldedCard = settled.cardInstances.find(
      (c) => c.instanceId === "marisa-x02-reveal"
    )!;
    expect(
      getEffectiveTribes(settled, fieldedCard, card, getCardDefinitionById)
    ).not.toContain("妖精");
    expect(
      settled.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "override_properties"
      )
    ).toBe(false);
  });
});

// ============================================================
// XX01 [導界者]リリーブラック (ネクサス)
// ============================================================
describe("BSTH07.8-XX01 [導界者]リリーブラック", () => {
  const card = cardNoMap.get("BSTH07.8-XX01")!;
  it("grandwalkerData: 妖精スピリット/アルティメットの召喚/煌臨、配置時の同名ゲートなし + 軽減虹化", () => {
    expect(card.grandwalkerData).toEqual({
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      placementOracle: { sameNameGate: false },
      oracleConditions: [
        { tribes: ["妖精"], categories: ["spirit"] },
        { tribes: ["妖精"], categories: ["ultimate"] },
      ],
    });
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const colors = treat.steps.map((s) =>
      s.action.kind === "treat_as" ? s.action.asColor : null
    );
    expect(colors).toEqual([
      "red",
      "purple",
      "green",
      "white",
      "yellow",
      "blue",
    ]);
    // 導域(アタックステップ): (1) 同時アタック許可は allow_simultaneous_attack、
    // (2) 召喚した個体の途中合流は allow_mid_battle_join で表現済み (P2-05 Phase 1/5)。
    // 導域(ターン): trigger_from_zone 注入により「手札から召喚したとき1ドロー」を実装。
    expect(card.effects!.filter((e) => e.stub)).toHaveLength(0);
    const zone1 = card.effects![1]!;
    expect(zone1.timingScope).toEqual({ player: "self", period: "attack" });
    expect(zone1.steps[0]!.action).toEqual({
      kind: "allow_simultaneous_attack",
      player: "self",
      filter: { tribes: ["妖精"], category: ["spirit"] },
      maxCount: 5,
      blockerCapacity: "participant_count",
      duration: { scope: "while_on_field" },
    });
    const midBattleJoinStep = zone1.steps.find(
      (s) => s.action.kind === "allow_mid_battle_join"
    )!;
    expect(midBattleJoinStep.action).toEqual({
      kind: "allow_mid_battle_join",
      player: "self",
      filter: { tribes: ["妖精"], category: ["spirit"] },
      duration: { scope: "while_on_field" },
    });
    // 導域(ターン): game_event:summon + triggerFilter(妖精/spirit) +
    // trigger_from_zone(hand) + min_level 2 + no_duplicate で 1 ドロー。
    const zone2 = card.effects![2]!;
    expect(zone2.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "summon",
      triggerFilter: { tribes: ["妖精"], category: ["spirit"] },
    });
    expect(zone2.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "trigger_from_zone", zones: ["hand"] },
      { kind: "turn_player", player: "self" },
    ]);
    expect(zone2.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(zone2.steps[0]!.action).toEqual({
      kind: "draw",
      player: "self",
      count: 1,
    });
    expect(zone2.stub).toBeUndefined();
  });
});

// ============================================================
// BSTH07.8-X01 チルノ 効果耐性 behaviour
// 「相手のネクサス/マジックの効果を受けない」(sourceScope.categories) を発生源の
// 実効カテゴリで照合する。スピリット/ブレイヴ発生源は通常どおり通る。
// ============================================================
describe("BSTH07.8-X01 効果耐性 sourceScope.categories behaviour", () => {
  it("Lv2 + 自分のアタックステップ外: timingScope により免疫不成立", () => {
    const card = cardNoMap.get("BSTH07.8-X01")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "cirno-x-off",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    // 相手ターン (alice は active でない) かつ step=main → timingScope:self/attack 不成立
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "main",
      cardInstances: [self],
    };
    const immune = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    const next = runEffect(state, immune, "cirno-x-off", "alice");
    const target = next.cardInstances.find(
      (c) => c.instanceId === "cirno-x-off"
    )!;
    const nexusSource: CardDefinition = {
      ...card,
      cardNo: "TEST-NEXUS",
      printedCategory: "nexus",
    } as unknown as CardDefinition;
    // timingScope 外なので nexus 発生源でも免疫不成立
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: nexusSource,
      })
    ).toBe(false);
  });

  it("Lv2: nexus/magic 発生源は免疫成立、spirit 発生源は不成立", () => {
    const card = cardNoMap.get("BSTH07.8-X01")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "cirno-x",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const immune = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    const next = runEffect(state, immune, "cirno-x", "alice");
    const target = next.cardInstances.find((c) => c.instanceId === "cirno-x")!;
    const nexusSource: CardDefinition = {
      ...card,
      cardNo: "TEST-NEXUS",
      printedCategory: "nexus",
    } as unknown as CardDefinition;
    const magicSource: CardDefinition = {
      ...card,
      cardNo: "TEST-MAGIC",
      printedCategory: "magic",
    } as unknown as CardDefinition;
    const spiritSource: CardDefinition = {
      ...card,
      cardNo: "TEST-SPIRIT",
      printedCategory: "spirit",
    } as unknown as CardDefinition;
    // 発生源 nexus → 免疫成立
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: nexusSource,
      })
    ).toBe(true);
    // 発生源 magic → 免疫成立
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: magicSource,
      })
    ).toBe(true);
    // 発生源 spirit → 免疫不成立 (素通し)
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: spiritSource,
      })
    ).toBe(false);
  });
});
