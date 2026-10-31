/**
 * BSAZ01-C11「官制一斉射撃」/ C12「戦力投入」textRef[0]:
 *   使用時の印字済み軽減枠充足「自分のフィールドのマジックカード1枚につき、
 *   このカードの軽減シンボル1つを満たす。」
 *   BSAZ01-C07[0]/C08[0]/C09[0]/C10[0] と同型 (treat_as reduction_symbol +
 *   DynamicCount cards_in_zone, engine-field-magic-self-placement)。
 *
 * C11 effects[0] (自己配置トリガー, textRef[2]) は
 * bsaz01-c06-c07-c10-c11-field-magic-self-placement.test.ts で別途検証済み。
 * C11 effects[2] (field常駐フラッシュ本体) / C12 の自己配置トリガー・
 * コスト支払い前メイン発揮・分身スピリット生成は未実装 (残 stub)。
 * C12 のデッキ92枚投入可は maxDeckCount フィールドで別途実装済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  calculateReduction,
} from "../src";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe.each([["BSAZ01-C11"], ["BSAZ01-C12"]])(
  "%s textRef[0]: 使用時の印字済み軽減枠充足",
  (cardNo) => {
    const def = cardNoMap.get(cardNo)!;

    it("effect 定義: treat_as reduction_symbol + waivesReductionRequirement + count(cards_in_zone field/self/magic)", () => {
      const effect = def.effects!.find(
        (e) =>
          Array.isArray(e.textRef) &&
          e.textRef[0] === 0 &&
          e.steps.length > 0 &&
          e.steps[0]!.action.kind === "treat_as"
      )!;
      expect(effect).toBeDefined();
      expect(effect.stub).toBeUndefined();
      const action = effect.steps[0]!.action;
      expect(action.kind).toBe("treat_as");
      if (action.kind !== "treat_as") throw new Error("unreachable");
      expect(action.asColor).toBe("yellow");
      expect(action.waivesReductionRequirement).toBe(true);
      expect(action.count).toEqual({
        source: {
          kind: "cards_in_zone",
          zone: "field",
          player: "self",
          filter: { category: ["magic"] },
        },
      });
    });

    it("自分のフィールドにマジックが2枚あれば軽減2枠を上限に支払いが減る", () => {
      const other = {
        ...def,
        cardNo: `TEST-OTHER-MAGIC-${cardNo}`,
      } as CardDefinition;
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(other, {
            instanceId: "field-magic-1",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(other, {
            instanceId: "field-magic-2",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
          }),
        ],
      });
      state.cardInstances.push(
        createCardInstance(def, {
          instanceId: "paying",
          ownerPlayerId: "alice",
          zone: "hand",
        })
      );
      const result = calculateReduction({
        card: def,
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: (id) =>
          id === other.cardNo ? other : getCardDefinitionById(id),
        sourceInstanceId: "paying",
      });
      expect(result.reducedCost).toBe(
        Math.max(0, def.cost - Math.min(2, def.reductionSymbols.length))
      );
      expect(result.totalReduction).toBe(
        Math.min(2, def.reductionSymbols.length)
      );
    });
  }
);
