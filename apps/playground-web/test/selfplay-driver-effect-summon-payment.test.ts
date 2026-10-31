import { describe, expect, it } from "vitest";
import { createEmptyGameState, type LegalAction } from "@orica/rules-core";
import { resolveActionInputs } from "./selfplay-driver";

const ALICE = "alice";

describe("selfplay-driver: effect summon cost payment", () => {
  it("窓後の pending summon payment に reserve の正確な支払い入力を供給する", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });
    const action = {
      kind: "resolve_pending_effect_summon_cost_payment",
      actionId: "escp-selfplay-payment",
      can: true,
      reason: "pending_effect_summon_cost_payment",
      actingPlayerId: ALICE,
      pendingId: "escp-selfplay-payment",
      sourceInstanceId: "source",
      sourceDefinitionId: "SELFPLAY-SOURCE",
      summonTargetInstanceId: "target",
      summonTargetDefinitionId: "SELFPLAY-TARGET",
      requiredCost: 1,
      availableReserveCoreAmount: 3,
      availableReserveNormalCoreAmount: 3,
      availableOnBoardCoreSources: [],
      availableSoulCoreOnlySources: [],
    } as Extract<
      LegalAction,
      { kind: "resolve_pending_effect_summon_cost_payment" }
    >;

    expect(resolveActionInputs(state, action)).toEqual({
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
    });
  });
});

describe("selfplay-driver: enter field placement", () => {
  it("リザーブのソウルコアだけでも最低維持コアの入力を供給する", () => {
    const baseState = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });
    const state = {
      ...baseState,
      pendingEnterFieldPlacement: {
        pendingId: "efp-selfplay-reserve-soul",
        actingPlayerId: ALICE,
        sourceInstanceId: "entering-spirit",
        sourceDefinitionId: "SELFPLAY-ENTERING-SPIRIT",
        remainingStacks: [],
        minimumCoreCount: 1,
        maximumCoreCount: null,
      },
    };
    const action = {
      kind: "resolve_pending_enter_field_placement",
      actionId: "efp-selfplay-reserve-soul",
      can: true,
      reason: "pending_enter_field_placement",
      actingPlayerId: ALICE,
      pendingId: "efp-selfplay-reserve-soul",
      sourceInstanceId: "entering-spirit",
      sourceDefinitionId: "SELFPLAY-ENTERING-SPIRIT",
      sourceCardNo: "SELFPLAY-ENTERING-SPIRIT",
      minimumCoreCount: 1,
      maximumCoreCount: null,
    } as Extract<
      LegalAction,
      { kind: "resolve_pending_enter_field_placement" }
    >;

    expect(resolveActionInputs(state, action)).toEqual({
      enterFieldCorePlacements: [{ kind: "reserve_soul" }],
    });
  });
});
