import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import {
  __initializeGameApiLookupsForTest,
  executeAction,
} from "../server/game-api";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
function act(state: GameState, kind: LegalAction["kind"], body = {}) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => [],
  }).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return executeAction({
    state,
    actingPlayerId: "alice",
    action: action!,
    body,
  }).state;
}
function board(reserve: number): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(lookup("BSES01-C02")!, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(lookup("BSES01-CX01")!, {
          instanceId: "nexus",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: reserve,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
          trashNormalCoreCount: 2,
        },
        {},
      ],
    }),
    step: "main",
    activePlayerId: "alice",
  };
}
describe("T01 room/API summon payment", () => {
  it.each([1, 3])(
    "reserve=%s: RESTは未選択の支払いを補完せず、reserveだけのtoken配置後にHUDを要求",
    async (reserve) => {
      await __initializeGameApiLookupsForTest(ALL_CARDS);
      let state = act(board(reserve), "summon");
      const pending = state.pendingMultiPlacement!;
      expect(pending.summonDeclaration!.inputs.paymentSources).toBeUndefined();
      state = act(state, "resolve_pending_multi_placement", {
        multiPlacementAllocations: [
          {
            destinationInstanceId: pending.targets[0]!.instanceId,
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      });
      expect(state.players[0]!.trashNormalCoreCount).toBe(2);
      expect(state.pendingEffectSummonCostPayment?.requiredCost).toBe(2);
      expect(state.players[0]!.reserveSoulCoreCount).toBe(1);
    }
  );
  it("配置で増えたtokenのコアも、最新の支払い候補として受理する", async () => {
    await __initializeGameApiLookupsForTest(ALL_CARDS);
    let state = act(board(4), "summon");
    const id = state.pendingMultiPlacement!.targets[0]!.instanceId;
    state = act(state, "resolve_pending_multi_placement", {
      multiPlacementAllocations: [
        {
          destinationInstanceId: id,
          placements: [{ kind: "reserve_normal", amount: 2 }],
        },
      ],
    });
    state = act(state, "resolve_pending_effect_summon_cost_payment", {
      summonPaymentSources: [
        { kind: "card", instanceId: id, amount: 1 },
        { kind: "reserve", amount: 1 },
      ],
    });
    expect(state.window).toBe("stack");
    expect(
      state.cardInstances.find((c) => c.instanceId === id)?.normalCoreCount
    ).toBe(1);
    expect(state.players[0]!.reserveSoulCoreCount).toBe(1);
  });
});
