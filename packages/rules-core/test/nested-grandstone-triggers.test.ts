import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildNestedGrandstoneTriggersScenario } from "../../../apps/playground-web/src/scenario-nested-grandstone-triggers";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  getLegalActions,
  type GameState,
} from "../src";
import {
  buildFieldCardEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((d) => d.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};
const actions = (state: GameState, player = state.activePlayerId) =>
  getLegalActions({ state, actingPlayerId: player, ...lookups });

describe("解封から派生した転醒は残りの解封より先 (Q6645 / Q6163)", () => {
  it.each(["alice", "bob"])(
    "%s: 転醒を受諾した場合も、さらに派生した転醒時まで外側へ戻れない",
    (owner) => {
      let state = buildNestedGrandstoneTriggersScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const opponent = owner === "alice" ? "bob" : "alice";
      state = applyLegalAction({
        state,
        action: actions(state)[0]!,
        ...lookups,
      }).state;
      expect(
        actions(state, owner).some(
          (a) => "eventKind" in a && a.eventKind === "unseal"
        )
      ).toBe(false);
      state = applyLegalAction({
        state,
        action: actions(state, opponent).find((a) => a.kind === "pass_stack")!,
        ...lookups,
      }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === "inner-stone")
          ?.definitionId
      ).toBe("BSTH04-転醒R01(B)");
      expect(actions(state)).toEqual([
        expect.objectContaining({ eventKind: "rebirth" }),
      ]);
      state = applyLegalAction({
        state,
        action: actions(state)[0]!,
        ...lookups,
        skipOptionalEffect: true,
      }).state;
      expect(actions(state)).toEqual([
        expect.objectContaining({ eventKind: "unseal" }),
      ]);
    }
  );
  it.each(["alice", "bob"])(
    "%s: 内側の辞退までは外側の発揮・辞退を拒否する",
    (owner) => {
      const initial = buildNestedGrandstoneTriggersScenario(
        ALL_CARDS,
        new URLSearchParams({ owner, stage: "unseal" })
      );
      const outerPending = initial.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === "outer-stone"
      )!;
      const stale = actions(initial).find(
        (a) =>
          a.kind === "select_pending_to_resolve" &&
          a.pendingId === outerPending.pendingId
      )!;
      expect(stale).toBeDefined();
      let state = buildNestedGrandstoneTriggersScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      expect(state.pendingTriggeredEffects.map((p) => p.eventKind)).toEqual([
        "unseal",
        "stone_rebirth",
      ]);
      expect(actions(state)).toEqual([
        expect.objectContaining({ eventKind: "stone_rebirth" }),
      ]);
      const outer = state.pendingTriggeredEffects.find(
        (p) => p.eventKind === "unseal"
      )!;
      for (const skipOptionalEffect of [false, true]) {
        expect(() =>
          applyLegalAction({
            state,
            action: { ...stale, pendingId: outer.pendingId },
            ...lookups,
            skipOptionalEffect,
          })
        ).toThrow(/inner|内側|derived/);
      }
      state = applyLegalAction({
        state,
        action: actions(state)[0]!,
        ...lookups,
        skipOptionalEffect: true,
      }).state;
      expect(actions(state)).toEqual([
        expect.objectContaining({ eventKind: "unseal" }),
      ]);
      state = applyLegalAction({
        state,
        action: actions(state)[0]!,
        ...lookups,
      }).state;
      const pass = actions(state, owner === "alice" ? "bob" : "alice").find(
        (a) => a.kind === "pass_stack"
      )!;
      state = applyLegalAction({ state, action: pass, ...lookups }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === "outer-stone")
          ?.normalCoreCount
      ).toBe(3);
      expect(
        state.cardInstances.find((c) => c.instanceId === "inner-stone")
          ?.normalCoreCount
      ).toBe(4);
      expect(state.pendingTriggeredEffects).toEqual([]);
    }
  );
});
