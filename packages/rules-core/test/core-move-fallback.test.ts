/**
 * P3-15 問題2: executeCoreMove 汎用フォールバック (moveNormalCores 経由)。
 * 明示ブランチにマッチしない simple container-to-container パスを検証する。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PlayerState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

function fieldCard(
  instanceId: string,
  owner = ALICE,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function getCardDef(_id: string): CardDefinition | undefined {
  return dummyDef();
}

function runEffect(
  state: GameState,
  effect: Effect,
  sourceId = "s1"
): GameState {
  return executeEffect({
    chainId: "test:core-move-fallback:70",
    state,
    effect,
    sourceInstanceId: sourceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

describe("P3-15 問題2: executeCoreMove 汎用フォールバック", () => {
  describe("reserve → life", () => {
    it("自分のリザーブのコアをライフに置く", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { reserveNormalCoreCount: 4, lifeNormalCoreCount: 3 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(2);
      expect(getPlayer(result, ALICE).lifeNormalCoreCount).toBe(5);
      expect(
        result.log.some((l) =>
          l.includes("core_move:reserve:player-1->life:player-1:2")
        )
      ).toBe(true);
    });

    it("リザーブ不足時は利用可能な分だけ移動", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { reserveNormalCoreCount: 1, lifeNormalCoreCount: 3 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 3,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(0);
      expect(getPlayer(result, ALICE).lifeNormalCoreCount).toBe(4);
    });
  });

  describe("reserve → trash", () => {
    it("自分のリザーブのコアをトラッシュに置く", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { reserveNormalCoreCount: 3, trashNormalCoreCount: 1 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "trash", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(1);
      expect(getPlayer(result, ALICE).trashNormalCoreCount).toBe(3);
    });
  });

  describe("trash → reserve", () => {
    it("自分のトラッシュのコアをリザーブに戻す（リフレッシュ相当）", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { reserveNormalCoreCount: 1, trashNormalCoreCount: 3 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).trashNormalCoreCount).toBe(1);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(3);
    });
  });

  describe("trash → life", () => {
    it("自分のトラッシュのコアをライフに置く", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { trashNormalCoreCount: 2, lifeNormalCoreCount: 3 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).trashNormalCoreCount).toBe(1);
      expect(getPlayer(result, ALICE).lifeNormalCoreCount).toBe(4);
    });
  });

  describe("this_card → reserve", () => {
    it("このスピリットのコアをリザーブに戻す", () => {
      const card = fieldCard("s1", ALICE, 3);
      const state = {
        ...createEmptyGameState({
          playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
        }),
        cardInstances: [card],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getCard(result, "s1").normalCoreCount).toBe(1);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(3);
    });
  });

  describe("this_card → void", () => {
    it("amount:all はこのカード上の全コアをボイドに置く", () => {
      const card = fieldCard("s1", ALICE, 3);
      const state = {
        ...createEmptyGameState({
          playerOverrides: [{ voidNormalCoreCount: 0 }, {}],
        }),
        cardInstances: [card],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: "all",
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getCard(result, "s1").normalCoreCount).toBe(0);
      expect(getPlayer(result, ALICE).voidNormalCoreCount).toBe(3);
    });

    it("固定数に足りない通常効果は、可能な数を移動する", () => {
      const card = fieldCard("s1", ALICE, 1);
      const state = {
        ...createEmptyGameState({
          playerOverrides: [{ voidNormalCoreCount: 0 }, {}],
        }),
        cardInstances: [card],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getCard(result, "s1").normalCoreCount).toBe(0);
      expect(getPlayer(result, ALICE).voidNormalCoreCount).toBe(1);
    });
  });

  describe("this_card → trash", () => {
    it("このスピリットのコアをトラッシュに置く", () => {
      const card = fieldCard("s1", ALICE, 3);
      const state = {
        ...createEmptyGameState({
          playerOverrides: [{ trashNormalCoreCount: 0 }, {}],
        }),
        cardInstances: [card],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "trash", player: "self" },
              amount: 1,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getCard(result, "s1").normalCoreCount).toBe(2);
      expect(getPlayer(result, ALICE).trashNormalCoreCount).toBe(1);
    });
  });

  describe("source-player 指定", () => {
    it("相手のリザーブのコアを自分のリザーブに置く（opponent → self）", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { reserveNormalCoreCount: 1 },
            { reserveNormalCoreCount: 4 },
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "opponent" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(3);
      expect(getPlayer(result, BOB).reserveNormalCoreCount).toBe(2);
    });
  });

  describe("ガード: fallback で扱わないパス", () => {
    it("from=life の場合は fallback でなく明示ブランチ (life→reserve) が使われる", () => {
      // 既存の life → reserve ブランチは applyLifeDamageInterception を経由する。
      // fallback は allowLife=false なので life をソースとして拾わない。
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { lifeNormalCoreCount: 3, reserveNormalCoreCount: 1 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).lifeNormalCoreCount).toBe(2);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(2);
      // 既存の life→reserve ログ形式が使われていること
      expect(
        result.log.some((l) =>
          l.match(/core_move:life:player-1->reserve:player-1:1$/)
        )
      ).toBe(true);
    });

    it("source コアが0のときは no-source-cores をログ出力", () => {
      const state = {
        ...createEmptyGameState({
          playerOverrides: [
            { trashNormalCoreCount: 0, reserveNormalCoreCount: 1 },
            {},
          ],
        }),
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).trashNormalCoreCount).toBe(0);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(1);
      expect(result.log).toContain(
        "effect:core_move:trash:player-1->reserve:player-1:0:no-cores"
      );
    });
  });
});
