import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  getLegalActions,
  getAutomaticNormalCorePaymentSources,
  executeEffect,
  createCardInstance,
  type GameState,
  type LegalAction,
} from "../src";
import {
  manualPaymentBoard,
  paymentCardDefinition as getCardDefinitionById,
} from "./fixtures/manual-core-payment";

const lookups = {
  getCardDefinitionById,
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  extra = {}
) {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...extra })
    .state;
}

describe("プレイヤーが支払い元を決める", () => {
  it("支払い前に配置する関連トークンを、支払い選択後に再生成しない", () => {
    let state = manualPaymentBoard("bob");
    state.cardInstances = state.cardInstances.map((card) =>
      card.instanceId === "aun"
        ? createCardInstance(getCardDefinitionById("BSES01-M03")!, {
            instanceId: "aun",
            ownerPlayerId: "bob",
            zone: "hand",
          })
        : card
    );
    state.players[1]!.reserveNormalCoreCount = 8;
    state = act(state, "bob", "use_hand_card_effect");
    state = act(state, "alice", "pass_battle_flash");
    expect(state.pendingEffectSummonCostPayment).toBeNull();
    expect(state.players[1]!.reserveNormalCoreCount).toBe(8);
    const tokenPlacement = state.pendingMultiPlacement!;
    expect(tokenPlacement.targets).toHaveLength(1);
    state = act(state, "bob", "resolve_pending_multi_placement", {
      multiPlacementAllocations: [
        {
          destinationInstanceId: tokenPlacement.targets[0]!.instanceId,
          placements: [{ kind: "reserve_normal", amount: 2 }],
        },
      ],
    });
    const pending = state.pendingEffectSummonCostPayment!;
    expect(pending.requiredCost).toBeGreaterThan(0);
    expect(pending.preCostCombineHostInstanceId).toBeDefined();
    const beforeReserve = state.players[1]!.reserveNormalCoreCount;
    const tokens = state.cardInstances.filter(
      (c) => c.definitionId === "BSES01-T01"
    );
    expect(tokens).toHaveLength(1);
    state = act(state, "bob", "resolve_pending_effect_summon_cost_payment", {
      summonPaymentSources: [
        {
          kind: "reserve",
          amount: pending.requiredCost,
          includeSoulCore: false,
        },
      ],
    });
    expect(state.pendingEffectSummonCostPayment).toBeNull();
    expect(
      state.cardInstances
        .filter((c) => c.definitionId === "BSES01-T01")
        .map((c) => c.instanceId)
    ).toEqual(tokens.map((c) => c.instanceId));
    expect(state.players[1]!.reserveNormalCoreCount).toBe(
      beforeReserve - pending.requiredCost
    );
    expect(state.players[1]!.reserveSoulCoreCount).toBe(1);
  });
  it.each([false, true])(
    "リザーブだけの効果コスト: ソウルあり=%s",
    (hasSoul) => {
      const state = manualPaymentBoard("bob");
      state.cardInstances = state.cardInstances.filter(
        (card) => card.instanceId === "aun"
      );
      state.players[1]!.reserveNormalCoreCount = hasSoul ? 0 : 1;
      state.players[1]!.reserveSoulCoreCount = hasSoul ? 1 : 0;
      state.players[1]!.soulCoreLocation = hasSoul ? { kind: "reserve" } : null;
      const after = executeEffect({
        chainId: "manual-payment-reserve-only",
        state,
        sourceInstanceId: "aun",
        actingPlayerId: "bob",
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "pay_cost", amount: 1 } }],
        },
        getCardDefinitionById,
        allowPendingPayCostSourceAllocation: true,
      });
      if (hasSoul) {
        expect(after.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
        expect(after.players[1]!.reserveSoulCoreCount).toBe(1);
        expect(after.players[1]!.trashSoulCoreCount).toBe(0);
      } else {
        expect(after.pendingCoreSourceAllocation).toBeNull();
        expect(after.players[1]!.reserveNormalCoreCount).toBe(0);
        expect(after.players[1]!.trashNormalCoreCount).toBe(1);
      }
    }
  );
  it.each(["hand", "set_aside"] as const)(
    "R03 %s: GUIフラグなしでも支払い待ちになり、現界用ソウルを残せる",
    (zone) => {
      let state = manualPaymentBoard("bob", zone);
      state = act(state, "bob", "use_hand_card_effect");
      expect(state.players[1]!.reserveSoulCoreCount).toBe(1);
      expect(state.pendingEffectSummonCostPayment).toBeNull();
      state = act(state, "alice", "pass_battle_flash");
      expect(state.pendingEffectSummonCostPayment).toMatchObject({
        requiredCost: 2,
      });
      expect(state.players[1]!.reserveSoulCoreCount).toBe(1);
      expect(state.players[1]!.trashSoulCoreCount).toBe(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "donor")!
          .normalCoreCount
      ).toBe(4);
      state = act(state, "bob", "resolve_pending_effect_summon_cost_payment", {
        summonPaymentSources: [
          {
            kind: "card",
            instanceId: "donor",
            amount: 2,
            includeSoulCore: false,
          },
        ],
      });
      expect(state.pendingEffectSummonCostPayment).toBeNull();
      expect(state.pendingMultiPlacement).not.toBeNull();
      expect(state.players[1]!.reserveSoulCoreCount).toBe(1);
      expect(state.players[1]!.trashSoulCoreCount).toBe(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "donor")!
          .normalCoreCount
      ).toBe(2);
    }
  );

  it.each([
    [[{ sourceId: "reserve", available: 3, hasSoulCore: false }], true],
    [[{ sourceId: "field", available: 3, hasSoulCore: false }], true],
    [[{ sourceId: "reserve", available: 3, hasSoulCore: true }], false],
    [[{ sourceId: "reserve", available: 1, hasSoulCore: true }], false],
    [
      [
        { sourceId: "reserve", available: 2, hasSoulCore: false },
        { sourceId: "field", available: 2, hasSoulCore: false },
      ],
      false,
    ],
  ] as const)("支払元候補 %j の自動支払い可否は %s", (sources, automatic) => {
    expect(getAutomaticNormalCorePaymentSources(1, sources) !== null).toBe(
      automatic
    );
  });
});
