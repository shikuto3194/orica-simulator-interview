/**
 * BSTH002-C04「封魔録三面道中」ミラージュ【セット中】effects[0] 検証。
 *
 * ENGINE-restrict-core-placement-from-zone: RestrictCorePlacementAction に
 * `fromZone` を新設し、既存 `restrict_core_placement_life` CE (scope:"to_life") を
 * 「移動元を Zone で絞り込める」よう拡張したもの。既存の to_life (移動元不問、
 * BSTH02.7-C01) / from_void_self (移動元=void かつ自己原因限定、BSSL01-C02) の
 * どちらとも異なる「移動元=void 限定・原因不問」の第三の組み合わせを表現する。
 *
 * カード本文「【セット中】お互い、ボイドからコアをライフに置けない。」
 * (BSTH002-C04 effects[0]、mirageData 併用の【セット中】常時制限)。
 * 「このカードのセット時」自分1ドロー(強制)部分はセット時点トリガーがDSL未対応のため
 * 別 stub effect (effects[1]) として残置。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Effect, GameState } from "../src";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const C04 = cardNoMap.get("BSTH002-C04")!;
const ALICE = "alice";
const BOB = "bob";

function lifeCores(state: GameState, playerId: string): number {
  return state.players.find((p) => p.id === playerId)!.lifeNormalCoreCount;
}

const coreMove = (
  fromKind: "void" | "reserve",
  player: "self" | "opponent",
  amount: number
): Effect => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: fromKind, player },
        to: { kind: "life", player },
        amount,
      },
    },
  ],
});

function runEffect(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId:
      "test:bsth002-c04-mirage-set-restrict-core-placement-void-to-life:57",
    state,
    effect,
    sourceInstanceId: "runner",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function setupBoard(mirageZone: "mirage" | "hand" | "field" = "mirage") {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        voidNormalCoreCount: 5,
        reserveNormalCoreCount: 5,
        lifeNormalCoreCount: 3,
      },
      {
        voidNormalCoreCount: 5,
        reserveNormalCoreCount: 5,
        lifeNormalCoreCount: 3,
      },
    ],
    cardInstances: [
      createCardInstance(C04, {
        instanceId: "c04-instance",
        ownerPlayerId: ALICE,
        zone: mirageZone,
      }),
    ],
  });
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

describe("BSTH002-C04 effects[0] shape (継続: 【セット中】restrict_core_placement fromZone:void)", () => {
  const effect = C04.effects![0]!;

  it("stub 解消済み、mirage_set 束縛の continuous", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
  });

  it("steps[0] = restrict_core_placement(player:either, scope:to_life, fromZone:void, duration:while_set)", () => {
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("restrict_core_placement");
    if (action.kind === "restrict_core_placement") {
      expect(action.player).toBe("either");
      expect(action.scope).toBe("to_life");
      expect(action.fromZone).toBe("void");
      expect(action.duration).toEqual({ scope: "while_set" });
    }
  });
});

describe("BSTH002-C04 effects[0] 盤面変化 (ミラージュセット中のボイド→ライフ配置禁止)", () => {
  it("ミラージュセット中は、自分・相手どちらのボイド→ライフ移動もブロックされる", () => {
    let state = setupBoard("mirage");
    state = runEffect(state, coreMove("void", "self", 2));
    expect(lifeCores(state, ALICE)).toBe(3);
    state = runEffect(state, coreMove("void", "opponent", 2));
    expect(lifeCores(state, BOB)).toBe(3);
  });

  it("ミラージュセット中でも、リザーブ→ライフ移動はブロックされない (fromZone:void 限定)", () => {
    let state = setupBoard("mirage");
    state = runEffect(state, coreMove("reserve", "self", 2));
    expect(lifeCores(state, ALICE)).toBe(5);
  });

  it("ミラージュゾーンを離れる (手札/フィールド) と制限は登録されない", () => {
    for (const zone of ["hand", "field"] as const) {
      const state = setupBoard(zone);
      const after = runEffect(state, coreMove("void", "self", 2));
      expect(lifeCores(after, ALICE)).toBe(5);
    }
  });
});
