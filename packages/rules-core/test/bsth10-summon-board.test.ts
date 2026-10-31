import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingLeave,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { GameState, LegalAction, Zone } from "../src";
import { collectAfterPhysicalLeave } from "./physical-leave-test-helper";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { moveCardZone } from "../src/core/core-system";
import { getStackSourceActivationZone } from "../src/card/card-lookup";

const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
};
const make = (no: string, id: string, zone: Zone, cores = 0) =>
  createCardInstance(lookup(no)!, {
    instanceId: id,
    ownerPlayerId: "player-1",
    zone,
    normalCoreCount: cores,
  });
function act(
  state: GameState,
  kind: LegalAction["kind"],
  params: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  const actor = state.stackWindow?.priorityPlayerId ?? "player-1";
  const actions = getLegalActions({ state, actingPlayerId: actor, ...options });
  const action = actions.find((a) => a.kind === kind);
  expect(action, JSON.stringify({ actions, log: state.log })).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options, ...params })
    .state;
}
describe("BSTH10 召喚と現界の実盤面", () => {
  it.each(["hand", "trash", "deck"] as const)(
    "ドレミーは相手効果による離脱を受け%sから全軽減で召喚する",
    (zone) => {
      const before = rebuildContinuousEffectsFromField(
        createEmptyGameState({
          cardInstances: [
            make("BSTH10-X01", "domain", "field", 3),
            make("BSTH10-C04", "leaves", "field", 1),
            make("BSTH10-M02", "doremy", zone),
          ],
          playerOverrides: [
            {
              reserveNormalCoreCount: 8,
              reserveSoulCoreCount: 0,
              handCount: zone === "hand" ? 1 : 0,
              deckCount: zone === "deck" ? 1 : 0,
            },
            {},
          ],
        }),
        lookup
      );
      const pending = queuePendingLeave({
        state: before,
        instanceId: "leaves",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "player-2",
        chainId: "doremy-leave",
      });
      const waiting = collectAndQueueTriggerReactions({
        beforeState: before,
        afterState: pending,
        source: "action_resolution",
        chainId: "doremy-leave",
        attackId: null,
        ...options,
        getRegisteredBurstActions: undefined,
      });
      expect(waiting.pendingPrivateDeclarations).toEqual([]);
      expect(waiting.pendingTriggeredEffects).toEqual([]);
      let state = collectAfterPhysicalLeave({
        beforeState: before,
        afterState: pending,
        source: "action_resolution",
        chainId: "doremy-leave",
        attackId: null,
        ...options,
        getRegisteredBurstActions: undefined,
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "leaves")?.zone,
        JSON.stringify({
          log: state.log,
          pending: state.pendingTriggeredEffects,
          private: state.pendingPrivateDeclarations,
        })
      ).toBe("trash");
      expect(
        state.pendingPrivateDeclarations.some(
          (d) => d.sourceInstanceId === "doremy"
        )
      ).toBe(zone !== "trash");
      state = act(state, "resolve_pending_burst_check");
      state = act(
        state,
        zone !== "trash"
          ? "declare_private_triggered_effect"
          : "resolve_pending_triggered_effect"
      );
      if (zone !== "trash")
        state = act(state, "resolve_pending_triggered_effect");
      if (zone === "deck") {
        const stack = state.stackWindow!.pendingStackAction!;
        expect(getStackSourceActivationZone(state, stack, "player-1")).toBe(
          "hand"
        );
        expect(getStackSourceActivationZone(state, stack, "player-2")).toBe(
          "deck"
        );
      }
      for (let i = 0; i < 12 && state.stackWindow; i++)
        state = act(state, "pass_stack");
      if (state.pendingStepOptionalChoice)
        state = act(state, "resolve_pending_step_optional_choice");
      if (state.pendingEffectSummonCostPayment)
        state = act(state, "resolve_pending_effect_summon_cost_payment", {
          summonPaymentSources: [{ kind: "reserve", amount: 2 }],
        });
      if (state.pendingEnterFieldPlacement)
        state = act(state, "resolve_pending_enter_field_placement", {
          enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        });
      expect(
        state.cardInstances.find((c) => c.instanceId === "doremy")?.zone,
        JSON.stringify({
          log: state.log,
          pending: Object.entries(state).filter(
            ([k, v]) => k.startsWith("pending") && v
          ),
        })
      ).toBe("field");
      expect(state.players[0]!.trashNormalCoreCount).toBe(2);
      expect(state.players[0]!.handCount).toBe(0);
      expect(state.players[0]!.deckCount).toBe(0);
      const returned = moveCardZone(state, "doremy", zone);
      const repeated = collectAfterPhysicalLeave({
        beforeState: before,
        afterState: {
          ...pending,
          effectUsageRecords: returned.effectUsageRecords,
        },
        source: "action_resolution",
        chainId: "doremy-leave",
        attackId: null,
        ...options,
        getRegisteredBurstActions: undefined,
      });
      expect(repeated.pendingPrivateDeclarations).toEqual([]);
      expect(returned.effectUsageRecords).not.toHaveLength(0);
      const afterBurst = act(repeated, "resolve_pending_burst_check");
      expect(
        getLegalActions({
          state: afterBurst,
          actingPlayerId: "player-1",
          ...options,
        }).filter(
          (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
        )
      ).toEqual([]);
    }
  );
  it.each(["hand", "deck"] as const)(
    "ヘカーティアは%sから現界し、場・リザーブ・ライフの全ソウルコアを払う",
    (zone) => {
      const base = createEmptyGameState({
        cardInstances: [
          make("BSTH10-X01", "domain", "field", 3),
          { ...make("BSTH10-C04", "carrier", "field", 1), soulCoreCount: 2 },
          make("BSTH10-X05", "hecatia", zone),
        ],
        playerOverrides: [
          {
            handCount: zone === "hand" ? 1 : 0,
            reserveNormalCoreCount: 3,
            reserveSoulCoreCount: 2,
            lifeSoulCoreCount: 1,
            trashSoulCoreCount: 0,
          },
          {},
        ],
      });
      const state = rebuildContinuousEffectsFromField(
        { ...base, step: "attack" },
        lookup
      );
      const result = executeEffect({
        chainId: "test:bsth10-summon-board:201",
        state,
        effect: lookup("BSTH10-X05")!.effects![0]!,
        sourceInstanceId: "hecatia",
        actingPlayerId: "player-1",
        ...options,
      });
      expect(
        result.cardInstances.find((c) => c.instanceId === "hecatia")?.zone,
        JSON.stringify(result.log)
      ).toBe("field");
      expect(result.players[0]!.trashSoulCoreCount).toBe(5);
      expect(result.players[0]!.reserveSoulCoreCount).toBe(0);
      expect(result.players[0]!.lifeSoulCoreCount).toBe(0);
      expect(
        result.cardInstances.find((c) => c.instanceId === "carrier")
          ?.soulCoreCount
      ).toBe(0);
      expect(result.players[0]!.trashNormalCoreCount).toBe(0);
      expect(result.players[0]!.handCount).toBe(0);
    }
  );
});
