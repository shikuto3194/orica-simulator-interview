import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildFlashEffectCategoryScenario } from "../../../apps/playground-web/src/scenario-flash-effect-category";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};
function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input = {}
) {
  const actions = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  });
  const action = actions.find((candidate) => candidate.kind === kind);
  expect(
    action,
    `Missing ${kind}: ${actions.map((candidate) => candidate.kind)}`
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}
function declare(
  state: GameState,
  kind: "use_hand_card_effect" | "use_field_card_effect",
  owner = "bob"
) {
  const declared = act(state, owner, kind, {
    deferPayCostSourceSelection: true,
  });
  expect(declared.pendingPayToActHandDiscardGate).toBeNull();
  expect(declared.pendingPayToActCoreGate).toBeNull();
  return act(declared, owner === "bob" ? "alice" : "bob", "pass_battle_flash");
}
const instance = (state: GameState, id: string) =>
  state.cardInstances.find((card) => card.instanceId === `category-${id}`)!;

describe("実カードのフラッシュ効果種別と発揮前提 (03c/03d、2026-09-10報告)", () => {
  for (const owner of ["alice", "bob"]) {
    for (const gate of ["hand", "core", "both"]) {
      it(`${owner}/${gate}: R01は窓後に前提を満たしてから1コスト召喚・コア1個・1ドロー`, () => {
        let state = buildFlashEffectCategoryScenario(
          ALL_CARDS,
          new URLSearchParams({ owner, gate })
        );
        state = declare(state, "use_hand_card_effect", owner);
        expect(state.pendingEffectSummonCostPayment).toBeNull();
        if (gate !== "core") {
          expect(state.pendingPayToActHandDiscardGate?.requiredCount).toBe(1);
          expect(instance(state, "summon").zone).toBe("in_use");
          state = act(state, owner, "resolve_pay_to_act_hand_discard_gate", {
            payToActHandDiscardCardInstanceIds: ["category-payment"],
          });
          expect(instance(state, "payment").zone).toBe("trash");
        }
        if (gate !== "hand") {
          expect(state.pendingPayToActCoreGate?.remainingCount).toBe(1);
          state = act(state, owner, "resolve_pay_to_act_core_gate", {
            payToActCoreSourceContainerId: "reserve",
          });
        }
        state = act(
          state,
          owner,
          "resolve_pending_effect_summon_cost_payment",
          { summonPaymentSources: [{ kind: "reserve", amount: 1 }] }
        );
        state = act(state, owner, "resolve_pending_multi_placement", {
          multiPlacementAllocations: [
            {
              destinationInstanceId: "category-summon",
              placements: [{ kind: "reserve_normal", amount: 1 }],
            },
          ],
        });
        expect(instance(state, "summon")).toMatchObject({
          zone: "field",
          normalCoreCount: 2,
        });
        expect(instance(state, "draw").zone).toBe("hand");
        expect(
          state.players.find((player) => player.id === owner)
            ?.trashNormalCoreCount
        ).toBe(gate === "hand" ? 1 : 2);
        expect(state.pendingPayToActHandDiscardGate).toBeNull();
        expect(state.pendingPayToActCoreGate).toBeNull();
      });
    }
  }
  for (const gate of ["hand", "core"]) {
    it(`${gate}: R01の前提を拒否すると召喚・コア獲得・ドローしない`, () => {
      let state = declare(
        buildFlashEffectCategoryScenario(
          ALL_CARDS,
          new URLSearchParams({ owner: "bob", gate })
        ),
        "use_hand_card_effect"
      );
      state =
        gate === "hand"
          ? act(state, "bob", "resolve_pay_to_act_hand_discard_gate", {
              payToActHandDiscardGateDecline: true,
            })
          : act(state, "bob", "resolve_pay_to_act_core_gate", {
              payToActCoreGateDecline: true,
            });
      expect(instance(state, "summon").zone).toBe("trash");
      expect(instance(state, "draw").zone).toBe("deck");
      expect(instance(state, "payment").zone).toBe("hand");
      expect(state.pendingEffectSummonCostPayment).toBeNull();
    });
  }
  for (const host of [
    "BSGE01-CX01",
    "BSGE01-CX02",
    "BSGE01-CX03",
    "BSGE01-CX04",
  ]) {
    it.each(["0", "1"])(
      `${host}/soul=%s: 入替は両ゲートの要求なしで解決し、手札・コア・デッキ枚数を保つ`,
      (soul) => {
        const before = buildFlashEffectCategoryScenario(
          ALL_CARDS,
          new URLSearchParams({ owner: "bob", host, soul })
        );
        let state = declare(before, "use_field_card_effect");
        expect(state.pendingPayToActHandDiscardGate).toBeNull();
        expect(state.pendingPayToActCoreGate).toBeNull();
        state = act(state, "bob", "resolve_pending_effect_target", {
          targetInstanceIds: ["category-payment"],
        });
        expect(instance(state, "under").zone).toBe("hand");
        expect(instance(state, "payment")).toMatchObject({
          zone: "field",
          attachedToInstanceId: "category-host",
        });
        for (const key of [
          "handCount",
          "deckCount",
          "reserveNormalCoreCount",
          "trashNormalCoreCount",
        ] as const) {
          expect(state.players[1]![key]).toBe(before.players[1]![key]);
        }
        expect(state.flashEffectActivationLog).toHaveLength(0);
      }
    );
  }
});
