import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  generateTriggeredEffectRegistrations,
  expandCardDefinitionsWithBackFaces,
  getAvailableTriggeredEffectSourceChoices,
  getLegalActions,
} from "../src";
import { buildPhaseOwnerScenario } from "../../../apps/playground-web/src/scenario-phase-owner";

const definitions = new Map(ALL_CARDS.map((d) => [d.cardNo, d]));
const options = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
    ...ALL_CARDS,
  ]),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
describe("phase誘発の所有者はイベント発生時のプレイヤーを基準にする", () => {
  it.each(["alice", "bob"])(
    "%sの開始時: controllerへforkしたpendingを再走査しても自他を逆転しない",
    (active) => {
      const state = buildPhaseOwnerScenario(
        [...ALL_CARDS],
        new URLSearchParams({ active })
      );
      expect(state.pendingTriggeredEffects).toHaveLength(1);
      const pending = state.pendingTriggeredEffects[0]!;
      expect(pending.actingPlayerId).toBe("bob");
      expect(pending.relatedPlayerId).toBe(active);
      const choices = getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: pending,
        ...options,
      });
      expect(choices.map((c) => c.sourceCard.instanceId)).toEqual([
        active === "alice" ? "phase-reisen" : "phase-patchouli",
      ]);
    }
  );
  it("全カードのphase登録で省略時selfを確定し、明示されたopponent/eitherは維持する", () => {
    const registrations = expandCardDefinitionsWithBackFaces(ALL_CARDS).flatMap(
      (definition) =>
        generateTriggeredEffectRegistrations(definition)
          .filter((r) => r.suppressionEffectDescriptor?.timingKind === "phase")
          .map((registration) => ({ definition, registration }))
    );
    expect(registrations.length).toBeGreaterThan(0);
    for (const { definition, registration } of registrations) {
      const effect =
        definition.effects![
          registration.suppressionEffectDescriptor!.effectIndex!
        ]!;
      if (effect.timing.kind !== "phase")
        throw new Error("Expected phase timing");
      expect(
        registration.whose,
        `${definition.cardNo}: ${effect.textRef}`
      ).toBe(effect.timing.whose ?? "self");
    }
  });
  it("自分開始時のパチュリーは宣言・窓後に回復する", () => {
    let state = buildPhaseOwnerScenario(
      [...ALL_CARDS],
      new URLSearchParams({ active: "bob" })
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...options,
    }).find(
      (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
    )!;
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action, ...options }).state;
    for (let i = 0; i < 6 && state.stackWindow; i++) {
      const pass = getLegalActions({
        state,
        actingPlayerId: state.stackWindow.priorityPlayerId,
        ...options,
      }).find((a) => a.kind === "pass_stack")!;
      expect(pass).toBeDefined();
      state = applyLegalAction({ state, action: pass, ...options }).state;
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "phase-patchouli")!
        .exhaustState
    ).toBe("recovered");
  });
});
