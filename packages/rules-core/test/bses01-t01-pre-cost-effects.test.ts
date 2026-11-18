import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { GameState, LegalAction } from "../src/model";

const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function board(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(lookup("BSES01-C05")!, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(lookup("BSES01-C04")!, {
          instanceId: "map",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(lookup("BSAZ01-C01")!, {
          instanceId: "donor",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: 5,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
          trashNormalCoreCount: 0,
        },
        {},
      ],
    }),
    activePlayerId: "alice",
    step: "main",
  };
}
function act(state: GameState, kind: LegalAction["kind"], extra = {}) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...extra })
    .state;
}
function place(state: GameState, amount: number) {
  return act(state, "resolve_pending_multi_placement", {
    multiPlacementAllocations: [
      {
        destinationInstanceId:
          state.pendingMultiPlacement!.targets[0]!.instanceId,
        placements: amount ? [{ kind: "reserve_normal", amount }] : [],
      },
    ],
  });
}
describe("T01自身の支払い前effects", () => {
  it("本文は空stepsやCardDefinition専用フラグではなくputとして定義される", () => {
    const token = lookup("BSES01-T01")!;
    expect(token).not.toHaveProperty("tokenPoolPreCostForcedCombine");
    expect(token.effects![0]!.steps[0]!.action.kind).toBe("put");
    expect(
      lookup("BSES01-C04")!.effects![1]!.steps[0]!.action
    ).not.toHaveProperty("resolveSummonedBraveForcedTokenCombine");
  });
  it.each(["self", "other"] as const)(
    "%s召喚はトークン配置→支払い→任意のブレイヴ配置の順",
    (target) => {
      let state = board();
      const effect = {
        timing: { kind: "activated" as const, mode: "main" as const },
        steps: [
          {
            action: {
              kind: "summon" as const,
              target:
                target === "self"
                  ? { kind: "self" as const }
                  : {
                      kind: "from_zone" as const,
                      zone: "hand" as const,
                      filter: { category: ["brave" as const] },
                      count: 1,
                    },
              costModifier: { fixedPayment: 1 },
            },
          },
        ],
      };
      state = executeEffect({
        state,
        effect,
        chainId: "pre-cost-regression",
        sourceInstanceId: target === "self" ? "brave" : "map",
        actingPlayerId: "alice",
        ...lookups,
      });
      expect(state.pendingEffectSummonCostPayment).toBeNull();
      expect(state.pendingMultiPlacement?.targets[0]?.definitionId).toBe(
        "BSES01-T01"
      );
      expect(state.players[0]!.trashNormalCoreCount).toBe(0);
      const tokenId = state.pendingMultiPlacement!.targets[0]!.instanceId;
      state = place(state, 1);
      expect(state.players[0]!.trashNormalCoreCount).toBe(0);
      expect(state.pendingEffectSummonCostPayment?.requiredCost).toBe(1);
      state = act(state, "resolve_pending_effect_summon_cost_payment", {
        summonPaymentSources: [{ kind: "reserve", amount: 1 }],
      });
      expect(state.pendingMultiPlacement?.targets[0]).toMatchObject({
        instanceId: "brave",
        minimumCoreCount: 0,
      });
      state = place(state, 2);
      expect(
        state.cardInstances.find((c) => c.instanceId === "brave")
          ?.attachedToInstanceId
      ).toBe(tokenId);
      expect(
        state.cardInstances.find((c) => c.instanceId === tokenId)
          ?.normalCoreCount
      ).toBe(3);
      expect(state.players[0]!.trashNormalCoreCount).toBe(1);
      expect(state.pendingMultiPlacement).toBeNull();
      expect(state.pendingEffectSummonCostPayment).toBeNull();
    }
  );
  it.each([
    "reserve_normal",
    "reserve_soul",
    "card_normal",
    "trash_normal",
  ] as const)("%sのみからのT01配置を受理する（trashは任意）", (kind) => {
    const initial = board();
    initial.players[0]!.trashNormalCoreCount = 2;
    let state = act(initial, "summon");
    const pending = state.pendingMultiPlacement!;
    expect(pending.sourceDefinitionId).toBe("BSES01-T01");
    expect(pending.sourceInstanceId).toBe(pending.targets[0]!.instanceId);
    expect(pending.canAbort).toBe(false);
    state = act(state, "resolve_pending_multi_placement", {
      multiPlacementAllocations: [
        {
          destinationInstanceId: pending.targets[0]!.instanceId,
          placements: [
            {
              kind,
              amount: 1,
              ...(kind === "card_normal" ? { instanceId: "donor" } : {}),
            },
          ],
        },
      ],
    });
    expect(state.pendingEffectSummonCostPayment).not.toBeNull();
    expect(state.players[0]!.trashNormalCoreCount).toBe(
      kind === "trash_normal" ? 1 : 2
    );
  });
  it.each([
    { kind: "trash_normal", amount: 2 },
    { kind: "trash_soul", amount: 1 },
  ])("T01はトラッシュ通常2個・ソウル1個を許可しない: $kind", (placement) => {
    const initial = board();
    initial.players[0]!.trashNormalCoreCount = 2;
    initial.players[0]!.reserveSoulCoreCount = 0;
    initial.players[0]!.trashSoulCoreCount = 1;
    initial.players[0]!.soulCoreLocation = { kind: "trash" };
    const state = act(initial, "summon");
    expect(() =>
      act(state, "resolve_pending_multi_placement", {
        multiPlacementAllocations: [
          {
            destinationInstanceId:
              state.pendingMultiPlacement!.targets[0]!.instanceId,
            placements: [placement],
          },
        ],
      })
    ).toThrow();
    expect(state.players[0]!.trashNormalCoreCount).toBe(2);
    expect(state.players[0]!.trashSoulCoreCount).toBe(1);
  });
});
