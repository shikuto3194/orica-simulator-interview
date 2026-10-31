/**
 * BSGE01-C03「ディソレイト」/ BSGE01-C10「鎮魂の廃寺」共通ミラージュ【セット中】
 * effects[0] 検証 (engine-mirage-set-attack-window-and-discard-cost-draw cluster 残り部分)。
 *
 * 「魂状態を含む自分の「空木 レンカ」がいるとき、このターン、自分がミラージュ効果でドロー
 * していなければ、自分は手札の系統：「神喰」を持つカード1枚を破棄することで、デッキの上から
 * 3枚ドローする。」
 *
 * - 【セット中】『自分のメインステップ』は BSTS01-C06 と同型: timing:activated mode:"main" +
 *   applicability.zone:["mirage_set"] (timingScope 併記不要、BSTS01-C06 確認済み前例)。
 * - 「このターン、ミラージュ効果でドローしていなければ」は新設 mirage_draw_occurred
 *   ConditionClause + mirageSetDrawLog (executeDraw が発揮元カードの mirage ゾーン滞在時に
 *   push、attack_occurred/flash_used と対称構造の履歴 SSOT)。
 * - discard→draw は conditional_cost connector (BSSG01-C07/BSSL01-C04 同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const C03 = cardNoMap.get("BSGE01-C03")!;
const C10 = cardNoMap.get("BSGE01-C10")!;
const RENKA = cardNoMap.get("BSGE01-CX03")!; // 「空木 レンカ」
const KAMIKUI_FODDER = cardNoMap.get("BSGE01-C09")!; // tribe:"神喰" 実在カード（破棄用）
const FILLER = cardNoMap.get("BSFT01-C03")!; // tribe未指定の実在カード（デッキ/非該当手札埋め用）

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:bsge01-c03-c10-mirage-set-discard-draw:45",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe.each([
  ["BSGE01-C03", C03],
  ["BSGE01-C10", C10],
])(
  "%s ミラージュ【セット中】effects[0] shape (討伐コストドロー)",
  (_label, card) => {
    const effect = card.effects![0]!;

    it("mirageData: cost2/reduction purple 宣言済み", () => {
      expect(card.mirageData).toEqual({ cost: 2, reduction: ["purple"] });
    });

    it("stub 解消済み、activated mode:main + applicability=mirage_set + executionMode:optional", () => {
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
      expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
      expect(effect.executionMode).toBe("optional");
    });

    it("condition: 空木レンカ(魂状態含む) + このターン未ドロー(mirage_draw_occurred negate)", () => {
      expect(effect.condition).toEqual([
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "空木 レンカ" }],
          includeSoulState: true,
        },
        {
          kind: "mirage_draw_occurred",
          scope: "turn",
          player: "self",
          negate: true,
        },
      ]);
    });

    it("steps: discard(系統:神喰 1枚) → conditional_cost draw(3枚)", () => {
      expect(effect.steps).toHaveLength(2);
      expect(effect.steps[0]!.action).toEqual({
        kind: "discard",
        count: 1,
        player: "self",
        fromZone: "hand",
        filter: { tribes: ["神喰"] },
      });
      expect(effect.steps[1]!.action).toEqual({ kind: "draw", count: 3 });
      expect(effect.steps[1]!.connector).toBe("conditional_cost");
    });
  }
);

describe("BSGE01-C03 condition 評価 (空木レンカ + mirage_draw_occurred negate)", () => {
  function scenario(opts: {
    includeRenka: boolean;
    priorDraw?: { playerId: string; turnNumber: number };
  }): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    return {
      ...base,
      turnNumber: 3,
      cardInstances: [
        createCardInstance(C03, {
          instanceId: "c03-mirage",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "mirage",
        }),
        ...(opts.includeRenka
          ? [
              createCardInstance(RENKA, {
                instanceId: "renka-1",
                ownerPlayerId: ALICE,
                controllerPlayerId: ALICE,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
      ],
      mirageSetDrawLog: opts.priorDraw
        ? [
            {
              playerId: opts.priorDraw.playerId,
              sourceInstanceId: "some-other-mirage-card",
              turnNumber: opts.priorDraw.turnNumber,
            },
          ]
        : [],
    };
  }

  it("空木レンカ不在 → false", () => {
    const state = scenario({ includeRenka: false });
    expect(
      evaluateCondition(
        state,
        C03.effects![0]!.condition!,
        "c03-mirage",
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("空木レンカ在場 + ドロー履歴なし → true", () => {
    const state = scenario({ includeRenka: true });
    expect(
      evaluateCondition(
        state,
        C03.effects![0]!.condition!,
        "c03-mirage",
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("空木レンカ在場 + 自分が今ターン既にミラージュドロー済み → false (negate)", () => {
    const state = scenario({
      includeRenka: true,
      priorDraw: { playerId: ALICE, turnNumber: 3 },
    });
    expect(
      evaluateCondition(
        state,
        C03.effects![0]!.condition!,
        "c03-mirage",
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("相手のミラージュドロー履歴は無関係 → true", () => {
    const state = scenario({
      includeRenka: true,
      priorDraw: { playerId: BOB, turnNumber: 3 },
    });
    expect(
      evaluateCondition(
        state,
        C03.effects![0]!.condition!,
        "c03-mirage",
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("前ターンのミラージュドロー履歴は繰り越さない (scope:turn) → true", () => {
    const state = scenario({
      includeRenka: true,
      priorDraw: { playerId: ALICE, turnNumber: 2 },
    });
    expect(
      evaluateCondition(
        state,
        C03.effects![0]!.condition!,
        "c03-mirage",
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);
  });
});

describe("BSGE01-C03 盤面変化 (discard→conditional_cost draw + mirageSetDrawLog 記録)", () => {
  it("手札に神喰カードあり → 1枚破棄しデッキ上3枚ドロー、mirageSetDrawLog に記録される", () => {
    const mirage = createCardInstance(C03, {
      instanceId: "c03-mirage",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const renka = createCardInstance(RENKA, {
      instanceId: "renka-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const kamikuiHand = createCardInstance(KAMIKUI_FODDER, {
      instanceId: "hand-kamikui",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deck = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = {
      ...createEmptyGameState({
        cardInstances: [mirage, renka, kamikuiHand, ...deck],
        playerOverrides: [{ handCount: 1, deckCount: 3 }, {}],
      }),
      turnNumber: 5,
    };
    const after = runEffect(before, C03.effects![0]!, "c03-mirage");

    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-kamikui")!.zone
    ).toBe("trash");
    const drawnCount = after.log.filter((l) =>
      l.includes("effect:draw")
    ).length;
    expect(drawnCount).toBe(3);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
    expect(after.mirageSetDrawLog).toContainEqual({
      playerId: ALICE,
      sourceInstanceId: "c03-mirage",
      turnNumber: 5,
    });
  });

  it("手札に神喰カードなし → discard 不成立、conditional_cost で draw もロールバック", () => {
    const mirage = createCardInstance(C03, {
      instanceId: "c03-mirage",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const renka = createCardInstance(RENKA, {
      instanceId: "renka-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonKamikuiHand = createCardInstance(FILLER, {
      instanceId: "hand-filler",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deck = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = {
      ...createEmptyGameState({
        cardInstances: [mirage, renka, nonKamikuiHand, ...deck],
        playerOverrides: [{ handCount: 1, deckCount: 3 }, {}],
      }),
      turnNumber: 5,
    };
    const after = runEffect(before, C03.effects![0]!, "c03-mirage");

    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-filler")!.zone
    ).toBe("hand");
    const drawnCount = after.log.filter((l) =>
      l.includes("effect:draw")
    ).length;
    expect(drawnCount).toBe(0);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(3);
    expect(after.mirageSetDrawLog).toEqual([]);
  });
});
