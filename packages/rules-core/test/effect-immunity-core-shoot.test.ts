/**
 * カード対象「相手の効果を受けない」(defense_immune) の汎用配線回帰。
 *
 * パチュリー BSTH01-M01「回復状態のこのスピリットは、相手の効果を受けない」型の
 * defense_immune CE が、コアシュート (core_move field→reserve) と実行時カード対象解決
 * (resolveTargets 経由の destroy 等) の双方で相手起因効果を no-op にすることを検証する。
 *
 * - isCardImmuneToOpponentEffect: 相手起因 + 防御レベルの判定 (unpreventable は貫通)。
 * - コアシュート: 免疫スピリットからコアを抜けない。免疫が無ければ通常通り抜ける。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
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
  cores = 3,
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

/** instanceId のカードを「相手の効果を受けない」状態にする defense_immune CE。 */
function immunityCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `di-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "BSTH01-M01",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
  };
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

/** BOB が ALICE のフィールドからコアシュート (field→reserve) する effect。 */
const coreShootEffect: Effect = {
  timing: { kind: "activated", mode: "main" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "field", player: "opponent" },
        to: { kind: "reserve", player: "self" },
        amount: 1,
      },
    },
  ],
};

describe("isCardImmuneToOpponentEffect", () => {
  const card = fieldCard("p1");
  const state: GameState = {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [card],
    activeContinuousEffects: [immunityCE("p1")],
  };

  it("相手起因なら免疫 (true)", () => {
    expect(isCardImmuneToOpponentEffect(state, card, BOB)).toBe(true);
  });

  it("自分起因 (コントローラー自身) は免疫対象外 (false)", () => {
    expect(isCardImmuneToOpponentEffect(state, card, ALICE)).toBe(false);
  });

  it("system/SBA 起因 (null) は免疫対象外 (false)", () => {
    expect(isCardImmuneToOpponentEffect(state, card, null)).toBe(false);
  });

  it("「防げない」(unpreventable) は免疫を貫通 (false)", () => {
    expect(
      isCardImmuneToOpponentEffect(state, card, BOB, "unpreventable")
    ).toBe(false);
  });

  it("defense_immune CE が無ければ免疫なし (false)", () => {
    const noImmunity: GameState = { ...state, activeContinuousEffects: [] };
    expect(isCardImmuneToOpponentEffect(noImmunity, card, BOB)).toBe(false);
  });
});

describe("コアシュート vs 相手の効果を受けない", () => {
  it("免疫スピリットからはコアを抜けない (cores 不変)", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerOverrides: [
          { reserveNormalCoreCount: 0 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      cardInstances: [fieldCard("p1", ALICE, 3)],
      activeContinuousEffects: [immunityCE("p1")],
    };
    const result = executeEffect({
      chainId: "test:effect-immunity-core-shoot:147",
      state,
      effect: coreShootEffect,
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(getCard(result, "p1").normalCoreCount).toBe(3);
    expect(getPlayer(result, BOB).reserveNormalCoreCount).toBe(0);
  });

  it("免疫が無ければ通常通りコアシュートできる (回帰)", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerOverrides: [
          { reserveNormalCoreCount: 0 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      cardInstances: [fieldCard("p1", ALICE, 3)],
      activeContinuousEffects: [],
    };
    const result = executeEffect({
      chainId: "test:effect-immunity-core-shoot:169",
      state,
      effect: coreShootEffect,
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    expect(getCard(result, "p1").normalCoreCount).toBe(2);
    expect(getPlayer(result, BOB).reserveNormalCoreCount).toBe(1);
  });

  it("自分の効果なら免疫スピリットからでもコア移動できる (自分起因は受ける)", () => {
    // ALICE 自身が自分のスピリットのコアをリザーブへ戻す。acting === controller。
    const state: GameState = {
      ...createEmptyGameState({
        playerOverrides: [
          { reserveNormalCoreCount: 0 },
          { reserveNormalCoreCount: 0 },
        ],
      }),
      cardInstances: [fieldCard("p1", ALICE, 3)],
      activeContinuousEffects: [immunityCE("p1")],
    };
    const selfCoreMove: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "field", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:effect-immunity-core-shoot:205",
      state,
      effect: selfCoreMove,
      sourceInstanceId: "p1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(getCard(result, "p1").normalCoreCount).toBe(2);
    expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(1);
  });
});

describe("実行時カード対象解決 vs 相手の効果を受けない", () => {
  it("免疫スピリットは相手の破壊効果の対象から除外される", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [fieldCard("p1", ALICE, 3)],
      activeContinuousEffects: [immunityCE("p1")],
    };
    // BOB が「相手のスピリットすべてを破壊」(候補選択を経ない all 経路)。
    const destroyAll: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              zone: "field",
              count: "all",
              filter: {},
            },
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:effect-immunity-core-shoot:242",
      state,
      effect: destroyAll,
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      getCardDefinitionById: getCardDef,
    });
    // 免疫スピリットはフィールドに残る。
    expect(result.cardInstances.find((c) => c.instanceId === "p1")?.zone).toBe(
      "field"
    );
  });
});
