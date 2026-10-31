import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildCountLeaveOrderScenario } from "../../../apps/playground-web/src/scenario-count-leave-order";
import {
  applyLegalAction,
  getLegalActions,
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  buildBurstEffectLookup,
} from "../src";
const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((d) => d.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredBurstActions: buildBurstEffectLookup(definitions),
};
for (const owner of ["alice", "bob"]) {
  it.each([false, true])(
    `サイレントクライの実際のフラッシュ解決 (${owner}, 辞退=%s)`,
    (skip) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildCountLeaveOrderScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const actions = () =>
        [owner, opponent]
          .flatMap((actingPlayerId) =>
            getLegalActions({ state, actingPlayerId, ...lookups })
          )
          .filter((a) => a.can);
      expect(state.players.find((p) => p.id === owner)?.countValue).toBe(1);
      expect(
        state.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "count_decrease"
        )
      ).toHaveLength(1);
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(1);
      const trigger = actions().find(
        (a) => a.kind === "resolve_pending_triggered_effect"
      )!;
      expect(trigger).toBeDefined();
      state = applyLegalAction({
        state,
        action: trigger,
        skipOptionalEffect: skip,
        ...lookups,
      }).state;
      if (!skip) {
        expect(state.pendingSoulStateReplacement).toBeNull();
        const pass = actions().find(
          (a) => a.kind === "pass_battle_flash" || a.kind === "pass_stack"
        )!;
        expect(pass).toBeDefined();
        state = applyLegalAction({ state, action: pass, ...lookups }).state;
      }
      expect(state.players.find((p) => p.id === owner)?.handCount).toBe(
        skip ? 5 : 6
      );
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe(
        "count-victim"
      );
      const soul = actions().find(
        (a) =>
          a.kind === "resolve_soul_state_replacement" &&
          a.choice === (skip ? "decline" : "keep")
      )!;
      state = applyLegalAction({ state, action: soul, ...lookups }).state;
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(
        state.players
          .find((p) => p.id === opponent)
          ?.soulStateInstanceIds.includes("count-victim")
      ).toBe(!skip);
    }
  );
}
