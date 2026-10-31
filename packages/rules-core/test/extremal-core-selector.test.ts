/**
 * 極値セレクタ `CardFilter.extremal` の metric "core" 検証。
 *
 * 「最もコアの少ない / 多い 相手のスピリット/アルティメット1体」型（BSSL01-C01 など）。
 * コア数は `getTotalCoresOnCardById`（通常 + ソウル、SSOT、10_rules/06 L41「generic な
 * 『コア』はソウルコアを含む」）で測る。場のカードにしかコアは乗らないため、場外候補は
 * 極値計算から除外する（bp metric と同じ fail-closed 方針）。タイ時は全タイ候補を残し、
 * 後段の count 選択で効果の持ち主が選ぶ（標準ルール: 「最も〜」が複数なら対象は持ち主選択）。
 *
 * metric "bp"/"cost" は bsdb01-cards / bsth09-cards で配線済み。ここは "core" の SSOT
 * （selectExtremalInstanceIds）の振る舞いを直接検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { selectExtremalInstanceIds } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const BOB = "player-2";

/** 場のスピリットを normalCoreCount だけ指定して生成（def 種別はコア数に無関係）。 */
function fieldCard(instanceId: string, cores: number, zone = "field") {
  return createCardInstance(card("BSDB01-C01"), {
    instanceId,
    ownerPlayerId: BOB,
    zone: zone as "field" | "reserve" | "trash",
    normalCoreCount: cores,
  });
}

describe("extremal metric=core（最もコアの少ない/多い）", () => {
  it("lowest: 最少コアの候補だけを残す", () => {
    const a = fieldCard("a", 3);
    const b = fieldCard("b", 1);
    const c = fieldCard("c", 2);
    const state = createEmptyGameState({ cardInstances: [a, b, c] });
    const result = selectExtremalInstanceIds(
      state,
      ["a", "b", "c"],
      { metric: "core", mode: "lowest" },
      getDef
    );
    expect(result).toEqual(["b"]);
  });

  it("highest: 最多コアの候補だけを残す", () => {
    const a = fieldCard("a", 3);
    const b = fieldCard("b", 1);
    const c = fieldCard("c", 2);
    const state = createEmptyGameState({ cardInstances: [a, b, c] });
    const result = selectExtremalInstanceIds(
      state,
      ["a", "b", "c"],
      { metric: "core", mode: "highest" },
      getDef
    );
    expect(result).toEqual(["a"]);
  });

  it("タイ: 同コア数の候補をすべて残す（持ち主の count 選択に委ねる）", () => {
    const a = fieldCard("a", 2);
    const b = fieldCard("b", 2);
    const c = fieldCard("c", 4);
    const state = createEmptyGameState({ cardInstances: [a, b, c] });
    const result = selectExtremalInstanceIds(
      state,
      ["a", "b", "c"],
      { metric: "core", mode: "lowest" },
      getDef
    );
    expect(result.sort()).toEqual(["a", "b"]);
  });

  it("場外候補は除外（コアは場のカードにしか乗らない、fail-closed）", () => {
    // reserve のカードは 0 コア相当ではなく「測定不能」として除外し、
    // 場の最少コア候補だけを残す（reserve を最少として誤選択しない）。
    const onField = fieldCard("on", 3);
    const inReserve = fieldCard("res", 0, "reserve");
    const state = createEmptyGameState({
      cardInstances: [onField, inReserve],
    });
    const result = selectExtremalInstanceIds(
      state,
      ["on", "res"],
      { metric: "core", mode: "lowest" },
      getDef
    );
    expect(result).toEqual(["on"]);
  });

  it("算出可能な候補が皆無なら空集合（場外のみ）", () => {
    const inReserve = fieldCard("res", 0, "reserve");
    const state = createEmptyGameState({ cardInstances: [inReserve] });
    const result = selectExtremalInstanceIds(
      state,
      ["res"],
      { metric: "core", mode: "highest" },
      getDef
    );
    expect(result).toEqual([]);
  });
});
