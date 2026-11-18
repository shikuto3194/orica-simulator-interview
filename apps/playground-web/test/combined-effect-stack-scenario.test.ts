import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
} from "@orica/rules-core";
import { buildCombinedEffectStackScenario } from "../src/scenario-combined-effect-stack";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((d) => d.cardNo === id),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
  getRegisteredMagicActions: buildMagicLookup(definitions),
  getRegisteredBurstActions: () => [],
};
describe("combined-effect-stack: バトルフラッシュの離脱確定", () => {
  it.each([
    ["alice", "send_with_host"],
    ["alice", "keep"],
    ["bob", "send_with_host"],
    ["bob", "keep"],
  ])("%s の %s →魂状態辞退→実移動、対象選択なし", (owner, braveChoice) => {
    let state = buildCombinedEffectStackScenario(
      ALL_CARDS,
      new URLSearchParams({ owner })
    );
    expect(state.pendingBraveLeaveChoice?.choosingPlayerId).toBe(owner);
    expect(state.pendingEffectTargetSelection).toBeNull();
    for (const choice of [braveChoice, "decline"]) {
      const action = getLegalActions({
        state,
        actingPlayerId: owner,
        ...lookups,
      }).find((a) => "choice" in a && a.choice === choice);
      expect(
        action,
        JSON.stringify({
          choice,
          brave: state.pendingBraveLeaveChoice,
          soul: state.pendingSoulStateReplacement,
          cascade: state.pendingStackCascade,
          actions: getLegalActions({
            state,
            actingPlayerId: owner,
            ...lookups,
          }),
        })
      ).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...lookups }).state;
    }
    expect(state.pendingLeaveEntities).toEqual([]);
    expect(state.pendingStackCascade).toBeNull();
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(
      state.cardInstances
        .filter((c) => c.instanceId.startsWith("combined-"))
        .map((c) => c.zone)
    ).toEqual(["hand", braveChoice === "keep" ? "field" : "hand"]);
    expect(
      state.cardInstances
        .filter((c) => c.instanceId.startsWith("target-"))
        .every((c) => c.zone === "field")
    ).toBe(true);
    expect(state.players.find((p) => p.id === owner)?.countValue).toBe(4);
  });
});
