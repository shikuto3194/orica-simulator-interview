import { expect, it } from "vitest";
import { executeBonusCoreMove } from "../src/effect/structured-core-move";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  applyLegalAction,
  type Effect,
  type Action,
  type GameState,
} from "../src";

const original = ALL_CARDS.find((c) => c.cardNo === "BSRK01-C07")!;
it.each(["void", "reserve", "card_instance"] as const)(
  "トラッシュ後の追加処理も%sの保有2個を可能な限り移動する",
  (kind) => {
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: kind === "reserve" ? 2 : 0,
          voidNormalCoreCount: kind === "void" ? 2 : 0,
        },
        {},
      ],
      cardInstances: [
        createCardInstance(original, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: kind === "card_instance" ? 2 : 0,
        }),
      ],
    });
    const state = executeBonusCoreMove(
      before,
      "alice",
      {
        kind: "core_move",
        from:
          kind === "card_instance"
            ? { kind, instanceId: "source" }
            : { kind, player: "self" },
        to:
          kind === "card_instance"
            ? { kind: "reserve", player: "self" }
            : { kind: "card_instance", instanceId: "source" },
        amount: 3,
      },
      (id) => ALL_CARDS.find((c) => c.cardNo === id)
    );
    expect(state.cardInstances[0]!.normalCoreCount).toBe(
      kind === "card_instance" ? 0 : 2
    );
    expect(state.players[0]!.reserveNormalCoreCount).toBe(
      kind === "card_instance" ? 2 : 0
    );
    expect(state.players[0]!.voidNormalCoreCount).toBe(0);
  }
);
function run(action: Action, cost: boolean, cores: number) {
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [
      { action },
      {
        action: { kind: "draw", count: 1 },
        connector: cost ? "conditional_cost" : "sequential",
      },
    ],
  };
  const card = { ...original, effects: [effect] };
  const getDef = (id: string) =>
    id === card.cardNo ? card : ALL_CARDS.find((c) => c.cardNo === id);
  const lookups = {
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  };
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          voidNormalCoreCount: 100,
          handCount: 0,
          deckCount: 2,
        },
        {},
      ],
      cardInstances: [
        createCardInstance(card, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: cores,
        }),
        ...[0, 1].map((i) =>
          createCardInstance(original, {
            instanceId: `deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    }),
    step: "main",
  };
  let state = executeEffect({
    chainId: "test:core-move-partial-count:114",
    state: before,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    effect,
    ...lookups,
  });
  if (state.pendingCoreSplitSelection) {
    expect(state.pendingCoreSplitSelection.totalAmount).toBe(
      Math.min(3, cores)
    );
    const choose = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_core_split")!;
    state = applyLegalAction({
      state,
      action: choose,
      coreSplitDistribution: [Math.min(3, cores), 0],
      ...lookups,
    }).state;
  }
  return state;
}

for (const fromKind of ["this_card", "field_card"] as const) {
  for (const toKind of ["reserve", "void"] as const) {
    it.each([
      [false, 2, 2],
      [true, 2, 0],
      [true, 3, 3],
    ] as const)(
      `${fromKind}→${toKind}: 対価%s、保有%i、移動%i`,
      (cost, cores, moved) => {
        const state = run(
          {
            kind: "core_move",
            from:
              fromKind === "this_card"
                ? { kind: fromKind }
                : {
                    kind: fromKind,
                    player: "self",
                    filter: { category: ["nexus"] },
                  },
            to: { kind: toKind, player: "self" },
            amount: 3,
          },
          cost,
          cores
        );
        expect(
          state.cardInstances.find((c) => c.instanceId === "source")!
            .normalCoreCount
        ).toBe(cores - moved);
        expect(
          state.players[0]![
            toKind === "reserve"
              ? "reserveNormalCoreCount"
              : "voidNormalCoreCount"
          ]
        ).toBe((toKind === "void" ? 100 : 0) + moved);
        expect(state.players[0]!.handCount).toBe(moved > 0 ? 1 : 0);
      }
    );
  }
}
it.each([
  [false, 2, 2],
  [true, 2, 0],
  [true, 3, 3],
] as const)("split: 対価%s、保有%i、移動%i", (cost, cores, moved) => {
  const state = run(
    {
      kind: "core_move",
      from: { kind: "this_card" },
      amount: 3,
      splitDestinations: {
        destinations: [
          { location: { kind: "reserve", player: "self" } },
          { location: { kind: "void", player: "self" } },
        ],
      },
    },
    cost,
    cores
  );
  expect(
    state.cardInstances.find((c) => c.instanceId === "source")!.normalCoreCount
  ).toBe(cores - moved);
  expect(state.players[0]!.reserveNormalCoreCount).toBe(moved);
  expect(state.players[0]!.handCount).toBe(moved > 0 ? 1 : 0);
});
