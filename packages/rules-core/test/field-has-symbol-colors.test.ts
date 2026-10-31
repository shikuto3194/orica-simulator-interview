/**
 * field_has.symbolColors フィルタ（BSTH07-転醒R01(B) effects[1] 等）。
 *
 * 仕様:
 *   - symbolColors:["blue"] → 実効シンボル（getEffectiveSymbols）に blue を含む
 *     カードのみマッチ
 *   - colors:["blue"] と区別: 「青を持つカード（色のみ）」ではなく
 *     「青シンボルを 1 つ以上持つカード」に限定する
 *   - colors と symbolColors を併用すると AND 評価
 *
 * 退行ケース: BSAZ02-C01 アルギュレ (printedCategory:"ultimate" / colors:["white"] /
 *   symbolColors:["ultimate_symbol"]) は colors:["white"] では拾われるが、
 *   symbolColors:["white"] では拾われない（実効シンボルが究極シンボルのみ）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Condition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { evaluateCondition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const ALICE = "player-1";
const BOB = "player-2";

// BSAZ02-C01 アルギュレ: colors:["white"], symbolColors:["ultimate_symbol"]。
// colors と symbolColors が divergent な実カード。
const ULT_WHITE_NO_WHITE_SYMBOL = "BSAZ02-C01";
// BSDB01-C02 ベジータ: colors/symbolColors とも青。symbolColors check で拾える対照群。
const SPIRIT_BLUE = "BSDB01-C02";

const evalIt = (
  state: Parameters<typeof evaluateCondition>[0],
  cond: Condition
) => evaluateCondition(state, cond, "", ALICE, getDef);

describe("field_has.symbolColors (BSTH07-転醒R01(B) effects[1] 型)", () => {
  it("symbolColors は実効シンボルで判定する: colors のみ一致では false", () => {
    // BSAZ02-C01 (colors:white, symbolColors:ultimate_symbol) を自分のフィールドに置く。
    const ult = createCardInstance(card(ULT_WHITE_NO_WHITE_SYMBOL), {
      instanceId: "ult-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [ult],
    });
    // colors:["white"] では従来通り拾える（カード色判定）。
    const byColor: Condition = [
      {
        kind: "field_has",
        player: "self",
        colors: ["white"],
        minCount: 1,
      },
    ];
    expect(evalIt(state, byColor)).toBe(true);
    // symbolColors:["white"] は拾えない（実効シンボルは ultimate_symbol のみ）。
    const bySymbol: Condition = [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["white"],
        minCount: 1,
      },
    ];
    expect(evalIt(state, bySymbol)).toBe(false);
  });

  it("symbolColors で実効シンボルが一致するカードは true", () => {
    const blueSpirit = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "spi-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [blueSpirit],
    });
    const bySymbol: Condition = [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["blue"],
        minCount: 1,
      },
    ];
    expect(evalIt(state, bySymbol)).toBe(true);
  });

  it("相手のカードは player:'self' では数えない", () => {
    const blueSpirit = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "spi-bob",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [blueSpirit],
    });
    const bySymbol: Condition = [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["blue"],
        minCount: 1,
      },
    ];
    expect(evalIt(state, bySymbol)).toBe(false);
  });

  it("excludeSelf:true で源カード自身は数えない", () => {
    const blueSpirit = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [blueSpirit],
    });
    // 源が src 自身。excludeSelf=true で除外 → 0 件 → false。
    const bySymbol: Condition = [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["blue"],
        minCount: 1,
        excludeSelf: true,
      },
    ];
    expect(evaluateCondition(state, bySymbol, "src", ALICE, getDef)).toBe(
      false
    );
  });
});

describe("BSTH07-転醒R01(B) effects[1] (青シンボル限定 +2 cost destroy)", () => {
  it("青シンボルを持たない青色カードでは +2 が成立しない", () => {
    // BSAZ02-C01 (colors:white, symbolColors:ultimate_symbol) を青色カードに見立てるのは
    // 不自然なので、ここは効果定義側を直接 inspect する。
    const back = card("BSTH07-転醒R01(A)").backFace!;
    const effect = back.effects![1]!;
    // 旧 colors:["blue"] でなく symbolColors:["blue"] を使う（stub 解消）。
    expect(effect.stub).toBeUndefined();
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["blue"],
        minCount: 1,
        excludeSelf: true,
      },
    ]);
  });
});
