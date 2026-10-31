import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
} from "@orica/rules-core";
import { buildNightSwordScenario } from "../src/scenario-night-sword";
const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) =>
    cards.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(cards),
};
describe("夜空の剣・同時消滅シナリオ", () => {
  it.each(["alice", "bob"])(
    "%s: キリトのコア除去2体から記憶開放術を1回誘発する",
    (owner) => {
      const state = buildNightSwordScenario(
        [...ALL_CARDS],
        new URLSearchParams({ mode: "vanish", owner })
      );
      const action = getLegalActions({
        state,
        actingPlayerId: owner,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_core_shoot");
      expect(action).toBeDefined();
      const after = applyLegalAction({
        state,
        action: action!,
        coreShootDistribution: { "target-a": 1, "target-b": 1 },
        ...lookups,
      }).state;
      const pending = after.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "vanish"
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]!.relatedInstanceIds?.sort()).toEqual([
        "target-a",
        "target-b",
      ]);
    }
  );
});
