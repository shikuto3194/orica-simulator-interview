import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";

describe("declared target survives optional steps before the targeted action", () => {
  for (const payCount of [false, true]) {
    it(`Randy and Fenrir resolve once when count payment is ${payCount}`, () => {
      const source = ALL_CARDS.find((c) => c.cardNo === "BSLH01-C05")!;
      const responder = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C13")!;
      const defs = [source, responder];
      const lookup = (id: string) => defs.find((c) => c.cardNo === id);
      const triggers = buildTriggeredEffectLookup(defs);
      const fields = buildFieldCardEffectLookup(defs);
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ reserveNormalCoreCount: 12, countValue: 4 }, {}],
          cardInstances: [
            createCardInstance(source, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
            createCardInstance(responder, {
              instanceId: "nexus",
              ownerPlayerId: "bob",
              zone: "field",
            }),
          ],
        }),
        step: "main",
        window: "none",
      };
      const actions = (player: string) =>
        getLegalActions({
          state,
          actingPlayerId: player,
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggers,
          getRegisteredFieldCardEffectActions: fields,
        }).filter((a) => a.can);
      const apply = (
        action: LegalAction,
        extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
      ) => {
        state = applyLegalAction({
          state,
          action,
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggers,
          getRegisteredFieldCardEffectActions: fields,
          ...extra,
        }).state;
      };
      const take = (player: string, kind: LegalAction["kind"]) => {
        if (kind === "resolve_pending_triggered_effect") {
          for (let i = 0; i < 8; i++) {
            const burst = actions(player).find(
              (a) => a.kind === "resolve_pending_burst_check"
            );
            if (!burst) break;
            apply(burst);
          }
          const select = actions(state.activePlayerId).find(
            (a) => a.kind === "select_pending_to_resolve"
          );
          if (select) apply(select);
        }
        const a = actions(player).find((a) => a.kind === kind);
        expect(a, `${player}: ${kind}`).toBeDefined();
        return a!;
      };
      const close = () => {
        for (let i = 0; state.stackWindow && i < 8; i++)
          apply(take(state.stackWindow.priorityPlayerId, "pass_stack"));
        expect(state.stackWindow).toBeNull();
      };
      const summon = take("alice", "summon");
      if (summon.kind !== "summon") throw new Error("missing summon");
      apply(summon, {
        paymentSources: [{ kind: "reserve", amount: summon.finalCost }],
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      });
      close();
      if (state.pendingEnterFieldPlacement)
        apply(take("alice", "resolve_pending_enter_field_placement"), {
          enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        });
      apply(take("alice", "resolve_pending_triggered_effect"));
      close();
      expect(state.pendingStepChoice).not.toBeNull();
      const variant = actions("alice").find(
        (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0
      );
      expect(variant).toBeDefined();
      apply(variant!);
      apply(take("alice", "resolve_pending_effect_target"), {
        targetInstanceIds: ["nexus"],
      });
      expect(state.pendingTargetedDisclosureContinuation).not.toBeNull();
      apply(take("bob", "resolve_pending_triggered_effect"));
      close();
      const countResponse = actions("alice").find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === (payCount ? "execute" : "decline")
      );
      expect(countResponse).toBeDefined();
      apply(countResponse!);
      for (let i = 0; state.pendingStepOptionalChoice && i < 3; i++) {
        const execute = actions("alice").find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "execute"
        );
        expect(execute).toBeDefined();
        apply(execute!);
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
      ).toBe(payCount ? "trash" : "field");
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(state.players[0]!.countValue).toBe(payCount ? 2 : 5);
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingTargetedDisclosureContinuation).toBeNull();
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingEffectCompletions).toHaveLength(0);
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(
        state.log.filter((l) =>
          l.startsWith("effect:target-disclosure:queued:")
        )
      ).toHaveLength(1);
      expect(
        state.log.filter((l) => l === "effect:count_increase:alice:1")
      ).toHaveLength(payCount ? 2 : 1);
    });
  }
});
