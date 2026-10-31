/**
 * field_has.tribesRequired フィルタ (BSTH02.7-C02 effects[0] choice variant condition 等)。
 *
 * 仕様:
 *   - tribesRequired:["幻想","動玩"] → 系統：「幻想」と「動玩」を **両方** 持つカードのみマッチ
 *     (CardFilter.tribesRequired と同型の AND 評価)
 *   - tribes (OR) と独立に評価する
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

// BSTH02.7-C02 紅毛の和蘭人形: tribe "幻想・動玩" (両方持つ)
const BOTH_TRIBES = "BSTH02.7-C02";
// BSFT01-X01: tribe "光導・星霊" (どちらも持たない)
const NEITHER_TRIBE = "BSFT01-X01";

const evalIt = (
  state: Parameters<typeof evaluateCondition>[0],
  cond: Condition
) => evaluateCondition(state, cond, "", ALICE, getDef);

describe("field_has.tribesRequired (AND 評価)", () => {
  it("両方の系統を持つカードは true", () => {
    const c = createCardInstance(card(BOTH_TRIBES), {
      instanceId: "c-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    const cond: Condition = [
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribesRequired: ["幻想", "動玩"],
        minCount: 1,
      },
    ];
    expect(evalIt(state, cond)).toBe(true);
  });

  it("どちらの系統も持たないカードは false", () => {
    const c = createCardInstance(card(NEITHER_TRIBE), {
      instanceId: "c-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    const cond: Condition = [
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribesRequired: ["幻想", "動玩"],
        minCount: 1,
      },
    ];
    expect(evalIt(state, cond)).toBe(false);
  });

  it("minCount: 該当カードが必要数未満なら false, 到達すれば true", () => {
    const cards = [0, 1].map((i) =>
      createCardInstance(card(BOTH_TRIBES), {
        instanceId: `c-${i}`,
        ownerPlayerId: ALICE,
        zone: "trash",
      })
    );
    const state = createEmptyGameState({ cardInstances: cards });
    const cond: Condition = [
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribesRequired: ["幻想", "動玩"],
        minCount: 3,
      },
    ];
    expect(evalIt(state, cond)).toBe(false);

    const threeCards = [0, 1, 2].map((i) =>
      createCardInstance(card(BOTH_TRIBES), {
        instanceId: `c3-${i}`,
        ownerPlayerId: ALICE,
        zone: "trash",
      })
    );
    const state3 = createEmptyGameState({ cardInstances: threeCards });
    expect(evalIt(state3, cond)).toBe(true);
  });

  it("tribesRequired 1つだけ満たすカード (OR の tribes とは異なりマッチしない)", () => {
    // BSTH02.7-C02 自身は両方持つので、片方欠けたケースを見るには合成不要な代替として
    // NEITHER_TRIBE を使い、片方だけの要求でも false になることを tribes(OR) と対比する。
    const c = createCardInstance(card(NEITHER_TRIBE), {
      instanceId: "c-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({ cardInstances: [c] });
    const requiredCond: Condition = [
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribesRequired: ["光導", "動玩"],
        minCount: 1,
      },
    ];
    // 光導は持つが動玩は持たない → AND 不成立
    expect(evalIt(state, requiredCond)).toBe(false);

    const orCond: Condition = [
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribes: ["光導", "動玩"],
        minCount: 1,
      },
    ];
    // OR (tribes) なら光導だけでも成立
    expect(evalIt(state, orCond)).toBe(true);
  });
});
