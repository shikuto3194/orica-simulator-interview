import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildC07UpToScenario } from "../../../apps/playground-web/src/scenario-bsrk01-c07";
import {
  advanceStep,
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type LegalAction,
  executeEffect,
} from "../src";

const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};
function action(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  choice?: string
) {
  const found = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find(
    (candidate) =>
      candidate.kind === kind &&
      (!choice || ("choice" in candidate && candidate.choice === choice))
  );
  expect(found, state.log.join("\n")).toBeDefined();
  return found!;
}
function fixture(cores: number, soulState = false): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          trashNormalCoreCount: cores,
          soulCoreLocation: { kind: "trash" },
          handCount: 5,
          deckCount: 2,
          ...(soulState
            ? {
                soulStateInstanceIds: ["kenshin"],
                contractCardNo: "BSRK01-CX01",
              }
            : {}),
        },
        {},
      ],
      cardInstances: [
        createCardInstance(getDef("BSRK01-C07")!, {
          instanceId: "yahiko",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(getDef("BSRK01-CX01")!, {
          instanceId: "kenshin",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: soulState ? 0 : 2,
        }),
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(getDef("BSRK01-C03")!, {
            instanceId: `hand-${i}`,
            ownerPlayerId: "alice",
            zone: "hand",
          })
        ),
        ...[0, 1].map((i) =>
          createCardInstance(getDef("BSRK01-C01")!, {
            instanceId: `deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    }),
    turnNumber: 3,
    step: "main",
    window: "none",
  };
}

describe("BSRK01-C07 上限未満のコア配分を本番誘発経路で解決", () => {
  it.each(["alice", "bob"])(
    "%s: M02バースト後の無関係な弥彦が配分画面へ進む",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildC07UpToScenario(
        ALL_CARDS,
        new URLSearchParams({ owner, burst: "1" })
      );
      const act = (player: string, kind: LegalAction["kind"], input = {}) => {
        state = applyLegalAction({
          state,
          action: action(state, player, kind),
          ...lookups,
          ...input,
        }).state;
      };
      act(opponent, "resolve_pending_burst_check");
      act(owner, "pass_stack");
      act(owner, "pass_stack");
      act(opponent, "resolve_pending_multi_placement", {
        multiPlacementAllocations: [
          {
            destinationInstanceId: "prior-burst",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      });
      expect(state.players.find((p) => p.id === opponent)!.handCount).toBe(3);
      expect(
        state.activeContinuousEffects.some(
          (ce) => ce.modifierTag === "negate_caused_reaction"
        )
      ).toBe(false);
      state = advanceStep(
        state,
        getDef,
        lookups.getRegisteredTriggeredEffectActions,
        lookups.getRegisteredBurstActions
      );
      act(owner, "resolve_pending_triggered_effect");
      act(opponent, "pass_stack");
      expect(state.pendingCoreDistribution).toMatchObject({
        totalNormalCores: 2,
      });
      expect(
        state.log.some(
          (line) =>
            line.startsWith("effect:nullified:") && line.endsWith(":c07-yahiko")
        )
      ).toBe(false);
    }
  );
  it.each([
    [0, 0, false, false],
    [1, 1, false, true],
    [2, 0, false, false],
    [2, 1, false, true],
    [2, 2, false, true],
    [3, 3, false, true],
    [4, 2, false, false],
    [4, 3, false, true],
    [2, 2, true, true],
  ] as const)(
    "通常コア%i個から%i個配置、魂状態%s・ドロー%s",
    (cores, placed, soulState, draw) => {
      const queued = advanceStep(
        fixture(cores, soulState),
        getDef,
        lookups.getRegisteredTriggeredEffectActions,
        lookups.getRegisteredBurstActions
      );
      const declared = applyLegalAction({
        state: queued,
        action: action(queued, "alice", "resolve_pending_triggered_effect"),
        ...lookups,
      }).state;
      let resolved = applyLegalAction({
        state: declared,
        action: action(declared, "bob", "pass_stack"),
        ...lookups,
      }).state;
      if (cores > 0) {
        expect(resolved.pendingCoreDistribution).toMatchObject({
          totalNormalCores: Math.min(3, cores),
          hasSoulCore: false,
        });
        resolved = applyLegalAction({
          state: resolved,
          action: action(
            resolved,
            "alice",
            "resolve_pending_core_distribution"
          ),
          coreDistributionAllocations: placed ? { yahiko: placed } : {},
          ...lookups,
        }).state;
      }
      expect(resolved.players[0]!.trashNormalCoreCount).toBe(cores - placed);
      expect(resolved.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
      expect(
        resolved.cardInstances.find((card) => card.instanceId === "yahiko")!
          .normalCoreCount
      ).toBe(placed);
      if (placed === 0) {
        expect(resolved.pendingStepOptionalChoice).toBeNull();
      } else {
        expect(resolved.pendingStepOptionalChoice).toMatchObject({
          stepIndex: 1,
        });
        resolved = applyLegalAction({
          state: resolved,
          action: action(
            resolved,
            "alice",
            "resolve_pending_step_optional_choice",
            draw ? "execute" : "decline"
          ),
          ...lookups,
        }).state;
        if (draw) {
          expect(resolved.players[0]!.handCount).toBe(6);
          expect(resolved.pendingZoneSelection).toMatchObject({
            destination: "deck_bottom",
            maxCount: 1,
          });
          resolved = applyLegalAction({
            state: resolved,
            action: action(resolved, "alice", "resolve_pending_zone_selection"),
            selectedZoneCardIds: ["hand-0"],
            ...lookups,
          }).state;
          expect(
            resolved.cardInstances.find((card) => card.instanceId === "hand-0")!
              .zone
          ).toBe("deck");
        }
      }
      expect(resolved.players[0]!.handCount).toBe(5);
      expect(resolved.pendingCoreDistribution).toBeNull();
    }
  );

  it("固定3個の通常効果も、トラッシュに2個なら2個を置く", () => {
    const original = getDef("BSRK01-C07")!.effects![0]!.steps[0]!.action;
    if (original.kind !== "core_distribute")
      throw new Error("distribution required");
    const resolved = executeEffect({
      chainId: "test:bsrk01-c07-up-to:246",
      state: fixture(2),
      sourceInstanceId: "yahiko",
      actingPlayerId: "alice",
      ...lookups,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: { ...original, mode: "even", to: { kind: "source_card" } },
          },
        ],
      },
    });
    expect(resolved.players[0]!.trashNormalCoreCount).toBe(0);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "yahiko")!
        .normalCoreCount
    ).toBe(2);
  });
});
