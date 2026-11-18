import { describe, it, expect } from "vitest";
import { createEmptyGameState } from "../src/factories";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import type { CardDefinition, ConditionClause, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";
const SRC = "src-1";

const getCardDef = (_id: string): CardDefinition | undefined => undefined;

function stateWithActivePlayer(activePlayerId: string): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return { ...base, activePlayerId };
}

describe("turn_player ConditionClause（ターンプレイヤー判定）", () => {
  const self: ConditionClause = { kind: "turn_player", player: "self" };
  const opponent: ConditionClause = { kind: "turn_player", player: "opponent" };

  it("player:self は効果コントローラーのターンなら true", () => {
    const state = stateWithActivePlayer(ALICE);
    expect(evaluateCondition(state, [self], SRC, ALICE, getCardDef)).toBe(true);
  });

  it("player:self は相手のターンなら false", () => {
    const state = stateWithActivePlayer(BOB);
    expect(evaluateCondition(state, [self], SRC, ALICE, getCardDef)).toBe(
      false
    );
  });

  it("player:opponent は相手のターンなら true", () => {
    const state = stateWithActivePlayer(BOB);
    expect(evaluateCondition(state, [opponent], SRC, ALICE, getCardDef)).toBe(
      true
    );
  });

  it("player:opponent は自分のターンなら false", () => {
    const state = stateWithActivePlayer(ALICE);
    expect(evaluateCondition(state, [opponent], SRC, ALICE, getCardDef)).toBe(
      false
    );
  });
});
