/**
 * BSTH03-C11 神宝「ライフスプリングインフィニティ」 — フラッシュ効果
 * 「このターンの間、自分のライフは0にならない」のライフ下限保護（floor）検証。
 *
 * プリミティブ: life_damage_interception mode:"floor"。
 * 既存の before/replace モードと同じ interception 経路で、ライフが floor を
 * 下回らないようダメージ量をクランプする（コア移動は伴わない）。
 *
 * ルール正源: 10_rules/06_core-system.md L119「ライフ減少は『ライフのコア1個を
 * リザーブに置く』」。floor はその減少をクランプする（非致死ダメージは通す）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:bsth03-c11-life-floor:39",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSTH03-C11 神宝「ライフスプリングインフィニティ」", () => {
  const c = card("BSTH03-C11");

  it("effects[2] フラッシュ: life_damage_interception(floor:1, turn) を登録する", () => {
    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.player).toBe("self");
      expect(action.mode).toBe("floor");
      expect(action.floor).toBe(1);
      expect(action.duration).toEqual({ scope: "turn" });
    }
  });

  it("[board] floor 登録後、致死ライフダメージは floor=1 でクランプされる", () => {
    const src = createCardInstance(c, {
      instanceId: "lifespring-c11",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });

    // フラッシュ効果で floor CE を登録。
    state = runEffect(state, c.effects![2]!, "lifespring-c11");
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "life_damage_interception"
      )
    ).toBe(true);

    // ライフ3に対し 5 ダメージ（致死量）。floor=1 で 2 だけ通る。
    const after = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: ALICE,
    });
    expect(getPlayerLifeCoreCount(alice(after))).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(2);
  });

  it("[board] floor 未満の非致死ダメージはそのまま通る", () => {
    const src = createCardInstance(c, {
      instanceId: "lifespring-c11b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 4, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, c.effects![2]!, "lifespring-c11b");

    // ライフ4 → 1 ダメージ。floor=1 を上回るのでそのまま 1 減る。
    const after = resolveLifeDamage(state, ALICE, 1, [], {
      cause: "battle",
      actingPlayerId: ALICE,
    });
    expect(getPlayerLifeCoreCount(alice(after))).toBe(3);
  });
});
