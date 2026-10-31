/**
 * P3-77 Phase 3-4: プレイヤー対象の効果耐性 (節②「自分は相手の効果を受けない」) の
 * モデル + 人称判定 gate の回帰テスト。
 *
 * - isPlayerImmuneToOpponentEffect: player_effect_immunity CE + 相手起因の判定。
 * - restrict 系 executor (相手は、〜できない型) は免疫中プレイヤーへの相手起因効果を no-op。
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, executeRestrictFlash } from "../src";
import { isPlayerImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { ContinuousEffect, GameState } from "../src";

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

/** alice を保護する player_effect_immunity CE。 */
function aliceImmunityCE(): ContinuousEffect {
  return {
    effectId: "pei-alice",
    sourceInstanceId: "x07",
    sourceDefinitionId: "BSTH01-X07",
    actingPlayerId: "alice",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "player_effect_immunity",
    targetInstanceId: "alice",
  };
}

describe("P3-77 Phase 3: isPlayerImmuneToOpponentEffect", () => {
  it("相手起因 + 免疫中なら true", () => {
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [aliceImmunityCE()],
    };
    // bob (相手) 起因で alice を狙う → 免疫
    expect(isPlayerImmuneToOpponentEffect(state, "alice", "bob")).toBe(true);
  });

  it("自分起因は免疫対象外 (false)", () => {
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [aliceImmunityCE()],
    };
    expect(isPlayerImmuneToOpponentEffect(state, "alice", "alice")).toBe(false);
  });

  it("system/SBA 起因 (actingPlayerId=null) は免疫対象外 (false)", () => {
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [aliceImmunityCE()],
    };
    expect(isPlayerImmuneToOpponentEffect(state, "alice", null)).toBe(false);
  });

  it("免疫 CE を持たないプレイヤーは false", () => {
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [aliceImmunityCE()],
    };
    expect(isPlayerImmuneToOpponentEffect(state, "bob", "alice")).toBe(false);
  });
});

describe("P3-77 Phase 4: restrict_flash の人称判定 gate", () => {
  it("免疫中プレイヤーへの相手起因 restrict_flash は no-op (CE 登録されない)", () => {
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [aliceImmunityCE()],
    };
    // bob が「相手 (=alice) は、フラッシュを使用できない」を発動。alice は免疫。
    const result = executeRestrictFlash(
      state,
      "bob",
      {
        kind: "restrict_flash",
        player: "opponent",
        source: "any",
        duration: { scope: "turn" },
      },
      "bob-source"
    );
    const restrictCEs = result.activeContinuousEffects.filter((ce) =>
      ce.modifierTag.startsWith("restrict_flash")
    );
    expect(restrictCEs).toHaveLength(0);
    expect(
      result.log.some((l) => l.includes("restrict_flash:player-immune:skip"))
    ).toBe(true);
  });

  it("免疫が無ければ通常通り restrict_flash CE が登録される", () => {
    const state = makeState();
    const result = executeRestrictFlash(
      state,
      "bob",
      {
        kind: "restrict_flash",
        player: "opponent",
        source: "any",
        duration: { scope: "turn" },
      },
      "bob-source"
    );
    const restrictCEs = result.activeContinuousEffects.filter((ce) =>
      ce.modifierTag.startsWith("restrict_flash")
    );
    expect(restrictCEs).toHaveLength(1);
    expect(restrictCEs[0]!.targetInstanceId).toBe("alice");
  });

  it("自分対象 (相手起因でない) の restrict_flash は免疫に関係なく登録される", () => {
    const state: GameState = {
      ...makeState(),
      activeContinuousEffects: [aliceImmunityCE()],
    };
    // alice が自分自身を対象にする (player: "self") → 相手起因でないので gate されない
    const result = executeRestrictFlash(
      state,
      "alice",
      {
        kind: "restrict_flash",
        player: "self",
        source: "any",
        duration: { scope: "turn" },
      },
      "alice-source"
    );
    const restrictCEs = result.activeContinuousEffects.filter((ce) =>
      ce.modifierTag.startsWith("restrict_flash")
    );
    expect(restrictCEs).toHaveLength(1);
  });
});
