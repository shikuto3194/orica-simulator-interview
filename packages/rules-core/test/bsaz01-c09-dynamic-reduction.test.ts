/**
 * BSAZ01-C09「煙幕阻害」effects[1] (textRef[0]):
 *   使用時の印字済み軽減枠充足「自分のフィールドのマジックカード1枚につき、
 *   このカードの軽減シンボル1つを満たす。」
 *   BSAZ01-C08[1]/C10[1] と同型 (treat_as reduction_symbol + DynamicCount
 *   cards_in_zone, engine-field-magic-self-placement)。
 *
 * effects[0] (自己配置トリガー) は
 * bsaz01-c08-c09-field-magic-self-placement-stack.test.ts で別途検証済み。
 * effects[2] (field常駐スタック本体、require_battle_cost 新設プリミティブ +
 * block_unblockable) は bsaz01-c09-battle-cost-gate.test.ts で実装・検証済み。
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
const C09 = cardNoMap.get("BSAZ01-C09")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSAZ01-C09 effects[1]: 使用時の印字済み軽減枠充足", () => {
  it("effect 定義: treat_as reduction_symbol + waivesReductionRequirement + count(cards_in_zone field/self/magic)", () => {
    const effect = C09.effects!.find(
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
    const other = { ...C09, cardNo: "TEST-OTHER-MAGIC-C09" } as CardDefinition;
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
      createCardInstance(C09, {
        instanceId: "paying",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const result = calculateReduction({
      card: C09,
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        id === other.cardNo ? other : getCardDefinitionById(id),
      sourceInstanceId: "paying",
    });
    expect(result.reducedCost).toBe(
      Math.max(0, C09.cost - Math.min(2, C09.reductionSymbols.length))
    );
    expect(result.totalReduction).toBe(
      Math.min(2, C09.reductionSymbols.length)
    );
  });
});
