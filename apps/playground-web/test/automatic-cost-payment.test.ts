import { describe, expect, it } from "vitest";
import { manualPaymentBoard } from "../../../packages/rules-core/test/fixtures/manual-core-payment";
import { getAutomaticCostPaymentSources } from "../src/utils/automatic-cost-payment";

describe("HUDの自動支払い例外", () => {
  it("唯一のリザーブにソウルがあれば、全量支払いでもHUDで確認する", () => {
    expect(
      getAutomaticCostPaymentSources(manualPaymentBoard(), "bob", 1, 1, [])
    ).toBeNull();
  });
  it("ソウルが支払い候補外なら、通常コアだけの単一支払い元を自動選択する", () => {
    const state = manualPaymentBoard();
    state.players[1]!.reserveNormalCoreCount = 2;
    expect(getAutomaticCostPaymentSources(state, "bob", 1, 2, [])).toEqual([
      { kind: "reserve", amount: 1, includeSoulCore: false },
    ]);
    expect(getAutomaticCostPaymentSources(state, "bob", 1, 3, [])).toBeNull();
  });
  it("リザーブが禁止された支払いでは、唯一のフィールド通常コアから払う", () => {
    expect(
      getAutomaticCostPaymentSources(manualPaymentBoard(), "bob", 2, 0, [
        {
          instanceId: "donor",
          maxAmount: 4,
          soulCoreOnly: false,
          destination: "void",
        },
      ])
    ).toEqual([
      {
        kind: "card",
        instanceId: "donor",
        amount: 2,
        includeSoulCore: false,
        destination: "void",
      },
    ]);
  });
  it("複数の通常コア支払い元を勝手に選ばない", () => {
    expect(
      getAutomaticCostPaymentSources(manualPaymentBoard(), "bob", 2, 0, [
        { instanceId: "donor", maxAmount: 4, soulCoreOnly: false },
        { instanceId: "symbol", maxAmount: 1, soulCoreOnly: false },
      ])
    ).toBeNull();
  });
});

it("通常コアが移動禁止でも候補のソウルを自動通常支払いで落とさない", () => {
  const state = manualPaymentBoard();
  state.activeContinuousEffects.push({
    effectId: "protect",
    sourceInstanceId: "donor",
    sourceDefinitionId: "BSAZ01-C01",
    actingPlayerId: "bob",
    targetInstanceId: "donor",
    modifierTag: "prevent_normal_core_move",
    duration: { scope: "turn" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
  });
  expect(
    getAutomaticCostPaymentSources(state, "bob", 1, 0, [
      { instanceId: "donor", maxAmount: 1, soulCoreOnly: false },
    ])
  ).toBeNull();
});
