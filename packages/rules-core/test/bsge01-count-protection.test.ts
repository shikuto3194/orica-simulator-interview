/**
 * BSGE01 神喰「カウント保護タグ」の挙動検証。
 * 「追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない」
 * = protectedFromNonTribe を持つ count_increase は protectedCounts に記録され、
 * 神喰を持たない効果からは (1) カウントとして数えられず (2) 減らされない。
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  executeCountIncrease,
  executeCountDecrease,
  evaluateCondition,
} from "../src/effect/structured-effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const GODEATER = "BSGE01-C05"; // tribe: 神喰・神機・1G
const NON_GODEATER = ALL_CARDS.find(
  (c) =>
    !c.tribe?.split("・").includes("神喰") && c.printedCategory === "spirit"
)!.cardNo;

const PLAYER = "player-1";

describe("BSGE01 カウント保護タグ", () => {
  it("カード data: 16枚の count_increase が protectedFromNonTribe:神喰 を持ち stub が消えている", () => {
    const protectedCards = ALL_CARDS.filter(
      (c) =>
        c.cardNo.startsWith("BSGE01-") &&
        c.effects?.some((e) =>
          e.steps.some(
            (s) =>
              s.action.kind === "count_increase" &&
              (s.action as { protectedFromNonTribe?: string })
                .protectedFromNonTribe === "神喰"
          )
        )
    );
    expect(protectedCards.length).toBe(16);
    // 純粋な保護タグ stub は全消し（残り2枚は別ギャップで stub 継続）
    const lingering = protectedCards.filter((c) =>
      c.effects?.some((e) => e.stub?.includes("カウント保護タグ"))
    );
    expect(lingering.length).toBe(0);
  });

  it("executeCountIncrease(protected): countValue と protectedCounts の双方が増える", () => {
    const state = createEmptyGameState({ playerIds: [PLAYER, "player-2"] });
    const next = executeCountIncrease(state, PLAYER, "self", 3, "神喰");
    const p = next.players.find((x) => x.id === PLAYER)!;
    expect(p.countValue).toBe(3);
    expect(p.protectedCounts).toEqual({ 神喰: 3 });
  });

  it("count_value 条件: 神喰ソースは保護分を数える / 非神喰ソースは数えない", () => {
    const godeater = createCardInstance(getDef(GODEATER)!, {
      ownerPlayerId: PLAYER,
      zone: "field",
      instanceId: "ge-src",
    });
    const nonGodeater = createCardInstance(getDef(NON_GODEATER)!, {
      ownerPlayerId: PLAYER,
      zone: "field",
      instanceId: "non-ge-src",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [godeater, nonGodeater],
      playerOverrides: [{ countValue: 3, protectedCounts: { 神喰: 3 } }, {}],
    });
    const clause = [{ kind: "count_value", player: "self", min: 3 } as const];
    // 神喰ソース: 3 >= 3 → true
    expect(evaluateCondition(state, clause, "ge-src", PLAYER, getDef)).toBe(
      true
    );
    // 非神喰ソース: (3 - 3) = 0 >= 3 → false（保護分は数えられない）
    expect(evaluateCondition(state, clause, "non-ge-src", PLAYER, getDef)).toBe(
      false
    );
  });

  it("executeCountDecrease: 非神喰ソースは保護分まで減らせない（床）", () => {
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    // 非神喰効果が -5 を試みる → 減らせるのは 5-3=2 まで
    const afterNon = executeCountDecrease(state, PLAYER, "self", 5, ["幻想"]);
    const pNon = afterNon.players.find((x) => x.id === PLAYER)!;
    expect(pNon.countValue).toBe(3);
    expect(pNon.protectedCounts).toEqual({ 神喰: 3 });
  });

  it("executeCountDecrease: 神喰ソースは保護分も含めて減らせる", () => {
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    // 神喰効果が -5 → 0 まで減り、保護も 0 に丸まる
    const after = executeCountDecrease(state, PLAYER, "self", 5, [
      "神喰",
      "神機",
    ]);
    const p = after.players.find((x) => x.id === PLAYER)!;
    expect(p.countValue).toBe(0);
    expect(p.protectedCounts).toBeUndefined();
  });
});
