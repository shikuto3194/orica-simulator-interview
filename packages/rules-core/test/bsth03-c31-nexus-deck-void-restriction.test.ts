/**
 * BSTH03-C31「永遠亭」effects[2] (Lv1-Lv2) 検証。
 *
 * 原文: 「お互いのネクサスは破壊されず、デッキは破棄されない。また、お互い
 * 『このスピリットの召喚時』効果でボイドからコアを増やせない。」
 *
 * 独立な 3 CE 登録の組み合わせ (複合禁止効果):
 *  - effect_resistance(category:nexus, player:either, count:all, resistsOutcome:"destroy",
 *    source:"all") — 因不問でお互いのネクサス破壊を防ぐ。
 *  - prevent_deck_discard(player:either) — 既存プリミティブそのまま (BSTH08.5-C21 同型)。
 *  - restrict_core_placement(scope:"from_void_self", sourceTimingScope:"summon",
 *    sourceFilter:{category:["spirit"]}, player:either) — スピリットが発揮元の
 *    `card_event:summon` だけをブロックし、アルティメットや召喚時以外の自己効果に
 *    よるボイド減少までは禁止しない (原文の「召喚時」限定を過剰一般化しないための軸)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "player-1";
const BOB = "player-2";

const eirentei = card("BSTH03-C31");
const registerEffect = eirentei.effects![2]!;

const dummySpirit: CardDefinition = {
  cardNo: "TEST-DUMMY-SPIRIT",
  name: "テストダミースピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

// dummySpirit は ALL_CARDS 未収録の ad-hoc fixture なので、通常の cardNoMap 参照に
// フォールバックする前段で自身の定義を解決する (bsth03-m03 test の testGetDef 同型)。
const getDef = (id: string): CardDefinition | undefined =>
  id === dummySpirit.cardNo ? dummySpirit : cardNoMap.get(id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
): GameState {
  return executeEffect({
    chainId: "test:bsth03-c31-nexus-deck-void-restriction:64",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("BSTH03-C31 effects[2] shape", () => {
  it("stub 解消済み・継続 timing", () => {
    expect(registerEffect.stub).toBeUndefined();
    expect(registerEffect.timing).toEqual({ kind: "continuous" });
  });

  it("steps: effect_resistance + prevent_deck_discard + restrict_core_placement", () => {
    expect(registerEffect.steps).toHaveLength(3);
    const kinds = registerEffect.steps.map((s) => s.action.kind);
    expect(kinds).toEqual([
      "effect_resistance",
      "prevent_deck_discard",
      "restrict_core_placement",
    ]);
    const [resistance, deckGuard, voidGuard] = registerEffect.steps.map(
      (s) => s.action
    );
    expect(resistance).toMatchObject({
      resistsOutcome: "destroy",
      source: "all",
      target: {
        kind: "filter",
        player: "either",
        filter: { category: ["nexus"] },
        count: "all",
      },
    });
    expect(deckGuard).toMatchObject({ player: "either" });
    expect(voidGuard).toMatchObject({
      player: "either",
      scope: "from_void_self",
      sourceTimingScope: "summon",
      sourceFilter: { category: ["spirit"] },
    });
  });
});

describe("BSTH03-C31 [board] お互いのネクサス破壊不可", () => {
  it("因不問で自分/相手のネクサスは破壊されず、非ネクサスは通常どおり破壊される", () => {
    const self = createCardInstance(eirentei, {
      instanceId: "eirentei-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const opponentNexus = createCardInstance(eirentei, {
      instanceId: "bob-eirentei",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const aliceSpirit = createCardInstance(dummySpirit, {
      instanceId: "alice-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    let state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [self, opponentNexus, aliceSpirit],
    };
    state = runEffect(state, registerEffect, "eirentei-1", ALICE);

    const destroyAll: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "either",
              filter: {},
              count: "all",
            },
          },
        },
      ],
    };
    state = runEffect(state, destroyAll, "eirentei-1", ALICE);
    state = flushPendingLeaves(state, getDef);

    expect(
      state.cardInstances.find((c) => c.instanceId === "eirentei-1")!.zone
    ).toBe("field");
    expect(
      state.cardInstances.find((c) => c.instanceId === "bob-eirentei")!.zone
    ).toBe("field");
    expect(
      state.cardInstances.find((c) => c.instanceId === "alice-spirit")!.zone
    ).toBe("trash");
  });
});

describe("BSTH03-C31 [board] お互いのデッキは破棄されない", () => {
  it("自分/相手いずれのデッキ→トラッシュ移動もブロックされる", () => {
    const self = createCardInstance(eirentei, {
      instanceId: "eirentei-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const aliceDeck = createCardInstance(dummySpirit, {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const bobDeck = createCardInstance(dummySpirit, {
      instanceId: "bob-deck-1",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    let state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [self, aliceDeck, bobDeck],
    };
    state = runEffect(state, registerEffect, "eirentei-1", ALICE);

    const deckDiscard = (
      player: "self" | "opponent"
    ): NonNullable<CardDefinition["effects"]>[number] => ({
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player, position: "top" },
            to: { zone: "trash" },
            count: 1,
            deckDiscard: true,
          },
        },
      ],
    });

    state = runEffect(state, deckDiscard("self"), "eirentei-1", ALICE);
    expect(
      state.cardInstances.find((c) => c.instanceId === "alice-deck-1")!.zone
    ).toBe("deck");

    state = runEffect(state, deckDiscard("opponent"), "eirentei-1", ALICE);
    expect(
      state.cardInstances.find((c) => c.instanceId === "bob-deck-1")!.zone
    ).toBe("deck");
  });
});

describe("BSTH03-C31 [board] 召喚時効果限定のボイドコア増加禁止", () => {
  function setUp(voidCores: number) {
    const self = createCardInstance(eirentei, {
      instanceId: "eirentei-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { voidNormalCoreCount: voidCores, reserveNormalCoreCount: 0 },
        { voidNormalCoreCount: voidCores, reserveNormalCoreCount: 0 },
      ],
    });
    return {
      ...base,
      cardInstances: [
        self,
        ...[ALICE, BOB].map((playerId) =>
          createCardInstance(dummySpirit, {
            instanceId: `${playerId}-spirit`,
            ownerPlayerId: playerId,
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      ],
    } as GameState;
  }

  const voidToReserve = (
    timing: NonNullable<CardDefinition["effects"]>[number]["timing"]
  ): NonNullable<CardDefinition["effects"]>[number] => ({
    timing,
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "reserve", player: "self" },
          amount: 2,
        },
      },
    ],
  });

  it("スピリットの召喚時 (card_event:summon) 効果由来のボイド→リザーブはお互いブロックされる", () => {
    let state = setUp(5);
    state = runEffect(state, registerEffect, "eirentei-1", ALICE);

    const summonTiming = {
      kind: "card_event" as const,
      event: "summon" as const,
    };
    state = runEffect(
      state,
      voidToReserve(summonTiming),
      `${ALICE}-spirit`,
      ALICE
    );
    expect(state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      5
    );
    expect(
      state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(0);

    state = runEffect(state, voidToReserve(summonTiming), `${BOB}-spirit`, BOB);
    expect(state.players.find((p) => p.id === BOB)!.voidNormalCoreCount).toBe(
      5
    );
    expect(
      state.players.find((p) => p.id === BOB)!.reserveNormalCoreCount
    ).toBe(0);
  });

  it("召喚時以外 (フラッシュ) の自己効果によるボイド減少までは禁止しない", () => {
    let state = setUp(5);
    state = runEffect(state, registerEffect, "eirentei-1", ALICE);

    const flashTiming = { kind: "activated" as const, mode: "flash" as const };
    state = runEffect(
      state,
      voidToReserve(flashTiming),
      `${ALICE}-spirit`,
      ALICE
    );
    expect(state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      3
    );
    expect(
      state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(2);
  });

  // core_move と並列の core_distribute 経路 (native-move-core-handlers.ts) も
  // 同じ resolveCorePlacementFromVoidAffect を消費するため、sourceTimingScope 配線漏れが
  // ないことを個別に確認する (adversarial verifier round1 refute: core_distribute は
  // effectTiming 未配線だったため「召喚時」限定が素通しになっていた)。
  const voidToSelfDistribute = (
    timing: NonNullable<CardDefinition["effects"]>[number]["timing"]
  ): NonNullable<CardDefinition["effects"]>[number] => ({
    timing,
    steps: [
      {
        action: {
          kind: "core_distribute",
          from: { kind: "void", player: "self" },
          to: { kind: "self" },
          amount: 2,
        },
      },
    ],
  });

  it("[core_distribute] 召喚時効果由来のボイド→自身配置もブロックされる", () => {
    let state = setUp(5);
    state = runEffect(state, registerEffect, "eirentei-1", ALICE);

    const summonTiming = {
      kind: "card_event" as const,
      event: "summon" as const,
    };
    state = runEffect(
      state,
      voidToSelfDistribute(summonTiming),
      `${ALICE}-spirit`,
      ALICE
    );
    expect(state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      5
    );
  });

  it("[core_distribute] 召喚時以外 (フラッシュ) の自己効果によるボイド減少までは禁止しない", () => {
    let state = setUp(5);
    state = runEffect(state, registerEffect, "eirentei-1", ALICE);

    const flashTiming = { kind: "activated" as const, mode: "flash" as const };
    state = runEffect(
      state,
      voidToSelfDistribute(flashTiming),
      `${ALICE}-spirit`,
      ALICE
    );
    expect(state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount).toBe(
      3
    );
  });
});
