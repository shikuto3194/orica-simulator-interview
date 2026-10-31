import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { moveNormalCores, moveSoulCore } from "../src/core/core-system";
import { advanceStep } from "../src/turn-system";
import { consumeSoulCore } from "../src/mechanics/advent-system";
import {
  expireCurrentEffectContinuousEffects,
  executeEffect,
} from "../src/effect/effect-interpreter";
import { getLegalActions } from "../src/legal/legal-actions";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, GameState } from "../src/model";

const definition: CardDefinition = {
  cardNo: "LIFE-ZERO-TEST",
  name: "ライフ0テスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const getCardDefinitionById = (id: string) =>
  id === definition.cardNo ? definition : undefined;
const lookups = {
  getCardDefinitionById,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
};
const loss = {
  kind: "player_loss",
  losingPlayerId: "bob",
  reason: "life_zero",
};

function makeState(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{}, { lifeNormalCoreCount: 1 }],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    }),
    step: "attack",
    window: "flash_before_block",
  };
}

const effect: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    { action: { kind: "life_damage", player: "opponent", amount: 1 } },
    { action: { kind: "count_increase", player: "self", amount: 1 } },
  ],
};

describe("ライフ0は即時敗北", () => {
  it("フラッシュ窓中でも最後の通常ライフコア移動で敗北し、以後の合法手はない", () => {
    const state = makeState();
    const result = moveNormalCores(
      state,
      { kind: "life", playerId: "bob" },
      { kind: "trash", playerId: "bob" },
      1
    );
    expect(result.gameResult).toEqual(loss);
    expect(result.players[1]!.trashNormalCoreCount).toBe(
      state.players[1]!.trashNormalCoreCount + 1
    );
    for (const actingPlayerId of ["alice", "bob"]) {
      expect(
        getLegalActions({
          state: result,
          actingPlayerId,
          ...lookups,
        })
      ).toEqual([]);
    }
  });

  it("ライフのソウルコアが残っていれば継続し、最後のソウルコア移動で敗北する", () => {
    const state = makeState();
    state.players[1] = {
      ...state.players[1]!,
      lifeSoulCoreCount: 1,
      reserveSoulCoreCount: 0,
      soulCoreLocation: { kind: "life" },
    };
    const normalMoved = moveNormalCores(
      state,
      { kind: "life", playerId: "bob" },
      { kind: "reserve", playerId: "bob" },
      1
    );
    expect(normalMoved.gameResult).toBeNull();
    const result = moveSoulCore(
      normalMoved,
      "bob",
      { kind: "life", playerId: "bob" },
      { kind: "reserve", playerId: "bob" }
    );
    expect(result.gameResult).toEqual(loss);
    expect(result.players[1]!.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("致死の効果ダメージ後は同じ効果の後続処理を実行しない", () => {
    const result = executeEffect({
      chainId: "test:life-zero-immediate:118",
      state: makeState(),
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(result.gameResult).toEqual(loss);
    expect(result.players[0]!.countValue).toBe(0);
  });

  it("敗北防止効果が有効ならライフ0でも後続処理を実行する", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      {
        effectId: "loss-immunity",
        sourceInstanceId: "source",
        sourceDefinitionId: definition.cardNo,
        actingPlayerId: "bob",
        targetInstanceId: "bob",
        modifierTag: "immune_to_game_loss",
        duration: { scope: "turn" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
      },
    ];
    const result = executeEffect({
      chainId: "test:life-zero-immediate:144",
      state,
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(result.players[1]!.lifeNormalCoreCount).toBe(0);
    expect(result.gameResult).toBeNull();
    expect(result.players[0]!.countValue).toBe(1);
  });
  it("敗北後の同じ効果にライフ回復があっても実行しない", () => {
    const healingEffect: Effect = {
      ...effect,
      steps: [
        effect.steps[0]!,
        {
          action: {
            kind: "core_move",
            from: { kind: "void", player: "opponent" },
            to: { kind: "life", player: "opponent" },
            amount: 1,
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:life-zero-immediate:170",
      state: makeState(),
      effect: healingEffect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(result.gameResult).toEqual(loss);
    expect(result.players[1]!.lifeNormalCoreCount).toBe(0);
    const nonlethal = makeState();
    nonlethal.players[1] = { ...nonlethal.players[1]!, lifeNormalCoreCount: 2 };
    const healed = executeEffect({
      chainId: "test:life-zero-immediate:181",
      state: nonlethal,
      effect: healingEffect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(healed.gameResult).toBeNull();
    expect(healed.players[1]!.lifeNormalCoreCount).toBe(2);
  });

  it("致死でない効果ダメージなら後続処理を実行する", () => {
    const state = makeState();
    state.players[1] = { ...state.players[1]!, lifeNormalCoreCount: 2 };
    const result = executeEffect({
      chainId: "test:life-zero-immediate:195",
      state,
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(result.gameResult).toBeNull();
    expect(result.players[1]!.lifeNormalCoreCount).toBe(1);
    expect(result.players[0]!.countValue).toBe(1);
  });

  it("敗北防止の期間が終了した瞬間にライフ0なら敗北する", () => {
    const state = makeState();
    state.players[1] = { ...state.players[1]!, lifeNormalCoreCount: 0 };
    state.activeContinuousEffects = [
      {
        effectId: "temporary-immunity",
        sourceInstanceId: "source",
        sourceDefinitionId: definition.cardNo,
        actingPlayerId: "bob",
        targetInstanceId: "bob",
        modifierTag: "immune_to_game_loss",
        duration: { scope: "current_effect" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
      },
    ];
    const result = expireCurrentEffectContinuousEffects(state, "source");
    expect(result.gameResult).toEqual(loss);
  });

  it.each([0, 1])(
    "煌臨コストでライフのソウルコアを消費する（通常ライフ%d）",
    (normalLife) => {
      const state = makeState();
      state.players[1] = {
        ...state.players[1]!,
        lifeNormalCoreCount: normalLife,
        lifeSoulCoreCount: 1,
        reserveSoulCoreCount: 0,
        soulCoreLocation: { kind: "life" },
      };
      const result = consumeSoulCore(state, "bob", "trash", "source");
      expect(result.players[1]!.lifeNormalCoreCount).toBe(normalLife);
      expect(result.players[1]!.lifeSoulCoreCount).toBe(0);
      expect(result.players[1]!.trashSoulCoreCount).toBe(1);
      expect(result.gameResult).toEqual(normalLife === 0 ? loss : null);
    }
  );
  it("エンドステップで敗北防止が切れたら次のターンへ進む前に敗北する", () => {
    const state = makeState();
    state.step = "end";
    state.window = "end_step_cleanup";
    state.activePlayerId = "bob";
    state.players[1] = { ...state.players[1]!, lifeNormalCoreCount: 0 };
    state.activeContinuousEffects = [
      {
        effectId: "end-immunity",
        sourceInstanceId: "source",
        sourceDefinitionId: definition.cardNo,
        actingPlayerId: "bob",
        targetInstanceId: "bob",
        modifierTag: "immune_to_game_loss",
        duration: { scope: "step", step: "end" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
      },
    ];
    const result = advanceStep(state, getCardDefinitionById, () => []);
    expect(result.gameResult).toEqual(loss);
    expect(result.turnNumber).toBe(state.turnNumber);
    expect(result.activePlayerId).toBe("bob");
  });
});
