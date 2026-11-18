/**
 * BSTH02.7-TX01(A) 「グランギニョル座の怪人」フラッシュ effects の検証。
 *
 * 原文: 「フラッシュ／このバトルの間、自分のライフは減らない。」
 * 発生源限定なし → life_damage_interception(cause:"any", mode:"replace",
 * duration:battle) で表現。全 cause (opponent_effect / battle / self_effect)
 * のライフ減少を 0 化する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
): GameState {
  return executeEffect({
    chainId: "test:bsth02-7-tx01-flash-life-damage:34",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH02.7-TX01(A) グランギニョル座の怪人 フラッシュ", () => {
  const card = cardNoMap.get("BSTH02.7-TX01(A)")!;
  const findFlashEffect = () =>
    card.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        e.steps[0]?.action.kind === "life_damage_interception"
    )!;

  it("effects: life_damage_interception(cause:any, mode:replace, duration:battle)", () => {
    const flash = findFlashEffect();
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.cause).toBe("any");
      expect(action.mode).toBe("replace");
      expect(action.player).toBe("self");
      expect(action.duration).toEqual({ scope: "battle" });
    }
  });

  it("[board] BSTH02.7-TX01(A) フラッシュ: 全 cause のライフ減少を replace で阻止", () => {
    const src = createCardInstance(card, {
      instanceId: "th02-7-tx01-src",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, findFlashEffect(), "th02-7-tx01-src", "player-1");

    // 相手効果 1 ダメージ → 0 化。
    const afterOppEffect = resolveLifeDamage(state, "player-1", 1, [], {
      cause: "opponent_effect",
      actingPlayerId: "player-2",
    });
    expect(getPlayerLifeCoreCount(afterOppEffect.players[0]!)).toBe(3);

    // バトル 1 ダメージ → 0 化。
    const afterBattle = resolveLifeDamage(state, "player-1", 1, [], {
      cause: "battle",
      actingPlayerId: "player-2",
    });
    expect(getPlayerLifeCoreCount(afterBattle.players[0]!)).toBe(3);

    // 自効果 1 ダメージ → 0 化 (発生源限定なし)。
    const afterSelfEffect = resolveLifeDamage(state, "player-1", 1, [], {
      cause: "self_effect",
      actingPlayerId: "player-1",
    });
    expect(getPlayerLifeCoreCount(afterSelfEffect.players[0]!)).toBe(3);
  });
});
