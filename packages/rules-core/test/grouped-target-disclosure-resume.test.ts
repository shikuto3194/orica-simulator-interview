import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";

describe("grouped target disclosure resumes the original selection scope", () => {
  for (const payCount of [false, true]) {
    it(`BSTS01-M02 targets BSGE01-C13 once when count payment is ${payCount}`, () => {
      const source = ALL_CARDS.find((c) => c.cardNo === "BSTS01-M02")!;
      const responder = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C13")!;
      const spirit: CardDefinition = {
        cardNo: "TEST-GROUPED-TARGET-SPIRIT",
        name: "second category target",
        printedCategory: "spirit",
        colors: ["white"],
        cost: 1,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
      };
      const definitions = [source, responder, spirit];
      const lookup = (id: string) => definitions.find((c) => c.cardNo === id);
      const triggers = buildTriggeredEffectLookup(definitions);
      const fields = buildFieldCardEffectLookup(definitions);
      const make = (
        def: CardDefinition,
        id: string,
        owner: string,
        zone: "hand" | "field",
        cores = 0
      ) =>
        createCardInstance(def, {
          instanceId: id,
          ownerPlayerId: owner,
          controllerPlayerId: owner,
          zone,
          normalCoreCount: cores,
        });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ reserveNormalCoreCount: 12, countValue: 4 }, {}],
          cardInstances: [
            make(source, "source", "alice", "hand"),
            make(responder, "nexus", "bob", "field"),
            make(spirit, "spirit", "bob", "field", 1),
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
        });
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
        const action = actions(player).find((a) => a.kind === kind);
        expect(action, `${player}: ${kind}`).toBeDefined();
        return action!;
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
      expect(state.pendingEffectTargetSelection?.targetGroups).toHaveLength(2);
      apply(take("alice", "resolve_pending_effect_target"), {
        targetInstanceIds: ["spirit", "nexus"],
      });
      expect(state.pendingTargetedDisclosureContinuation).not.toBeNull();
      expect(
        state.cardInstances.find((c) => c.instanceId === "spirit")?.zone
      ).toBe("field");
      apply(take("bob", "resolve_pending_triggered_effect"));
      close();
      expect(state.pendingStepOptionalChoice).not.toBeNull();
      const choice = actions("alice").find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === (payCount ? "execute" : "decline")
      );
      expect(choice).toBeDefined();
      apply(choice!);
      expect(state.pendingTargetedDisclosureContinuation).toBeNull();
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(state.pendingEffectCompletions).toHaveLength(0);
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(state.players[0]!.countValue).toBe(payCount ? 0 : 4);
      expect(
        state.cardInstances.find((c) => c.instanceId === "spirit")?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find((c) => c.instanceId === "nexus")?.zone,
        state.log.slice(-25).join("\n")
      ).toBe(payCount ? "trash" : "field");
      expect(
        state.log.filter((line) =>
          line.startsWith("effect:target-disclosure:queued:")
        )
      ).toHaveLength(1);
    });
  }
});
