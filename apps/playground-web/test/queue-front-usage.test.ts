import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { buildTriggeredEffectLookup, getLegalActions } from "@orica/rules-core";
import { buildQueueFrontUsageScenario } from "../src/scenario-queue-front-usage";
import {
  buildEffectQueue,
  isActionForEffectQueueFront,
} from "../src/components/EffectQueueOverlay";

describe("提供snapshot: 使用済み効果のボタン漏れ", () => {
  it("全順序候補に画像があり、前面神託に別カードのボタンが混ざらない", () => {
    const state = buildQueueFrontUsageScenario(ALL_CARDS);
    const getCardDefinitionById = (id: string) =>
      ALL_CARDS.find((c) => c.cardNo === id);
    const lookup = buildTriggeredEffectLookup(ALL_CARDS);
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    });
    const items = buildEffectQueue(
      state,
      getCardDefinitionById,
      lookup,
      "bob",
      actions
    );
    expect(items).toHaveLength(4);
    expect(
      actions.filter((a) => a.kind === "select_pending_to_resolve")
    ).toHaveLength(4);
    expect(
      actions.every((a) => items.some((i) => i.actions?.includes(a)))
    ).toBe(true);
    for (const item of items) {
      expect(
        actions.filter((a) => isActionForEffectQueueFront(a, item))
      ).toHaveLength(1);
    }
  });
});
