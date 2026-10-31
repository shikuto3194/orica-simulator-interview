/**
 * BSTH02-R01/R02/R03「プリズムリバー」三姉妹 effects[1] 検証。
 *
 * 原文 (共通パターン、例R01 textLines[1]):
 *   自分は、手札1枚を破棄することで、2枚ドローする。ネクサスがあるとき、相手の
 *   (フィールド/リザーブ/トラッシュ)のコア1個を(リザーブ/トラッシュ/ボイド)に置く。
 *
 * 「ネクサスがあるとき」の対象プレイヤーは原文に明記が無くユーザー確認待ちだったが、
 * needs-ruling.jsonl:BSTH02-R01/R02/R03 で裁定C確定（自分/相手いずれかのネクサス）。
 * field_has ConditionClause の player:"either" (needs-ruling 裁定Cの実装、
 * structured-condition-eval.ts) で解禁する。
 *
 * 検証点:
 *  - 自分のネクサスのみ / 相手のネクサスのみ いずれでも条件成立する (either)。
 *  - ネクサスが場に無ければ不成立。
 *  - 条件成立時、コア移動 step が実際に盤面へ反映される (R01: field→reserve,
 *    R02: reserve→trash, R03: trash→void、いずれも相手側)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const NEXUS = card("BSDB01-C06");

function nexus(owner: string, instanceId: string) {
  return createCardInstance(NEXUS, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
  });
}

function gateCondition(cardNo: string) {
  return card(cardNo).effects![1]!.condition!;
}

describe("BSTH02-R01/R02/R03 effects[1] ネクサスゲート (field_has player:either)", () => {
  it.each([["BSTH02-R01"], ["BSTH02-R02"], ["BSTH02-R03"]])(
    "%s: stub が解消され field_has either 条件を持つ",
    (cardNo) => {
      const c = card(cardNo);
      const effect = c.effects![1]!;
      expect(effect.stub).toBeUndefined();
      expect(effect.condition).toEqual([
        {
          kind: "field_has",
          player: "either",
          category: ["nexus"],
        },
      ]);
    }
  );

  it.each([["BSTH02-R01"], ["BSTH02-R02"], ["BSTH02-R03"]])(
    "%s: 自分のネクサスのみでも条件成立",
    (cardNo) => {
      const src = createCardInstance(card(cardNo), {
        instanceId: "src",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, nexus(ALICE, "own-nexus")],
      });
      expect(
        evaluateCondition(state, gateCondition(cardNo), "src", ALICE, getDef)
      ).toBe(true);
    }
  );

  it.each([["BSTH02-R01"], ["BSTH02-R02"], ["BSTH02-R03"]])(
    "%s: 相手のネクサスのみでも条件成立",
    (cardNo) => {
      const src = createCardInstance(card(cardNo), {
        instanceId: "src",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, nexus(BOB, "opp-nexus")],
      });
      expect(
        evaluateCondition(state, gateCondition(cardNo), "src", ALICE, getDef)
      ).toBe(true);
    }
  );

  it.each([["BSTH02-R01"], ["BSTH02-R02"], ["BSTH02-R03"]])(
    "%s: ネクサスが無ければ条件不成立",
    (cardNo) => {
      const src = createCardInstance(card(cardNo), {
        instanceId: "src",
        ownerPlayerId: ALICE,
        zone: "field",
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
      });
      expect(
        evaluateCondition(state, gateCondition(cardNo), "src", ALICE, getDef)
      ).toBe(false);
    }
  );
});

function runEffect(
  cardNo: string,
  state: GameState,
  effectIndex: number
): GameState {
  return executeEffect({
    chainId: "test:bsth02-r01-r02-r03-nexus-gate:130",
    state,
    effect: card(cardNo).effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

describe("BSTH02-R01 effects[1]（相手フィールドのコア1個→相手リザーブ）", () => {
  it("条件成立後の step 実行で相手フィールドカードのコアが1個リザーブへ移る", () => {
    const src = createCardInstance(card("BSTH02-R01"), {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // NEXUS 自身を相手フィールドカードとして使う (ゲート条件「ネクサスがあるとき」
    // も同時に満たす、コア移動元も兼ねる)。
    const oppField = createCardInstance(NEXUS, {
      instanceId: "opp-field-card",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, oppField],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const after = runEffect("BSTH02-R01", state, 1);
    const movedCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-field-card"
    )!;
    expect(movedCard.normalCoreCount).toBe(0);
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(1);
  });
});

describe("BSTH02-R02 effects[1]（相手リザーブのコア1個→相手トラッシュ）", () => {
  it("条件成立後の step 実行で相手のリザーブコアが1個トラッシュへ移る", () => {
    const src = createCardInstance(card("BSTH02-R02"), {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, nexus(ALICE, "own-nexus")],
      playerOverrides: [
        {},
        { reserveNormalCoreCount: 1, trashNormalCoreCount: 0 },
      ],
    });
    const after = runEffect("BSTH02-R02", state, 1);
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(0);
    expect(bob.trashNormalCoreCount).toBe(1);
  });
});

describe("BSTH02-R03 effects[1]（相手トラッシュのコア1個→相手ボイド）", () => {
  it("条件成立後の step 実行で相手のトラッシュコアが1個ボイドへ移る", () => {
    const src = createCardInstance(card("BSTH02-R03"), {
      instanceId: "src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, nexus(ALICE, "own-nexus")],
      playerOverrides: [
        {},
        { trashNormalCoreCount: 1, voidNormalCoreCount: 0 },
      ],
    });
    const after = runEffect("BSTH02-R03", state, 1);
    const bob = after.players.find((p) => p.id === BOB)!;
    expect(bob.trashNormalCoreCount).toBe(0);
    expect(bob.voidNormalCoreCount).toBe(1);
  });
});
