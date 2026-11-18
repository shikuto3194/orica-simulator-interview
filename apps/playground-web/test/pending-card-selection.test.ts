import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  getLegalActions,
  applyLegalAction,
  buildTriggeredEffectLookup,
  type AttackLegalAction,
} from "@orica/rules-core";
import { buildCardSelectionScenario } from "../src/scenario-card-selection";
import { buildPendingCardChoice } from "../src/hooks/usePendingCardSelection";
import { buildBattleCostCardChoice } from "../src/utils/battle-cost-card-choice";

const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
describe("共通カード選択", () => {
  it.each([0, 1])("除外下限 %i に応じて0枚選択の文言を区別する", (minCount) => {
    const state = buildCardSelectionScenario(ALL_CARDS);
    state.pendingSummonCostExcludeChoice = {
      pendingId: "exclude-choice",
      actingPlayerId: "alice",
      sourceInstanceId: "selection-a",
      sourceDefinitionId: state.cardInstances[0]!.definitionId,
      effectIndex: 0,
      candidateCardInstanceIds: ["selection-b"],
      maxCount: 1,
      minCount,
      discountPerCard: 1,
      fullCostPaid: minCount > 0,
    };
    const choice = buildPendingCardChoice(
      state,
      getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
      }),
      getDefinition
    )!;
    expect(choice.min).toBe(minCount);
    expect(choice.confirmLabel(0)).toBe(
      minCount === 0 ? "除外せず召喚" : "除外して召喚"
    );
    expect(choice.confirmLabel(1)).toBe("除外して召喚");
  });
  it("同じpending内で辞退した次のentryは別の選択として扱い、次のカードを破棄する", () => {
    const before = buildCardSelectionScenario(
      ALL_CARDS,
      new URLSearchParams("mode=draw")
    );
    const actions = getLegalActions({
      state: before,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    });
    const first = buildPendingCardChoice(before, actions, getDefinition)!;
    const next = applyLegalAction({
      state: before,
      action: first.action,
      getCardDefinitionById: getDefinition,
      ...first.declinePayload,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).state;
    const second = buildPendingCardChoice(
      next,
      getLegalActions({
        state: next,
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
      }),
      getDefinition
    )!;
    expect(second.key).not.toBe(first.key);
    expect(second.candidateIds).toContain("selection-b");
    const result = applyLegalAction({
      state: next,
      action: second.action,
      getCardDefinitionById: getDefinition,
      ...second.payload(["selection-b"], 0),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    }).state;
    expect(result.pendingDrawStepCostChoice).toBeNull();
    expect(
      result.cardInstances.find((card) => card.instanceId === "selection-b")
        ?.zone
    ).toBe("trash");
    expect(
      result.cardInstances.filter((card) => card.zone === "hand")
    ).toHaveLength(5);
  });

  it("複数の破壊・重疲労コストの組合せと順序を削らない", () => {
    const state = buildCardSelectionScenario(ALL_CARDS);
    const variants = [
      {
        kind: "attack",
        actionId: "first",
        sourceInstanceId: "missing",
        battleDestroyCostSourceInstanceIds: ["a", "b"],
        attackExhaustCostSourceInstanceIds: ["c", "d"],
      },
      {
        kind: "attack",
        actionId: "second",
        sourceInstanceId: "missing",
        battleDestroyCostSourceInstanceIds: ["b", "a"],
        attackExhaustCostSourceInstanceIds: ["d", "c"],
      },
    ] as AttackLegalAction[];
    const choice = buildBattleCostCardChoice(state, variants, getDefinition)!;
    expect(choice.candidateIds).toEqual(["a", "b", "c", "d"]);
    expect(
      choice.orderedChoices?.map((option) =>
        option.steps.map((step) => step.id)
      )
    ).toEqual([
      ["a", "b", "c", "d"],
      ["b", "a", "d", "c"],
    ]);
    expect(choice.orderedChoices?.[0]?.steps.map((step) => step.label)).toEqual(
      [
        "破壊するカードを選択",
        "破壊するカードを選択",
        "重疲労させるカードを選択",
        "重疲労させるカードを選択",
      ]
    );
  });
});
