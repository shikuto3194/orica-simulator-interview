import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/model";
import type { Action, DSL, Effect } from "../src/dsl-types";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeBorrowMagicEffect } from "../src/effect/effect-borrowing";
import { executeDeckReveal } from "../src/effect/structured-zone-ops";
import { replaceCardInstances } from "../src/zone/card-instance-state";

const base = ALL_CARDS[0]!;
const none = () => [];
const effect = (action: Action): Effect => ({
  timing: { kind: "activated", mode: "main" },
  steps: [{ action }],
});
function makeState(
  zone: "deck" | "hand" | "trash" | "set_aside",
  definition = base
) {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        handCount: zone === "hand" ? 1 : 0,
        deckCount: zone === "deck" ? 1 : 0,
      },
    ],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "target",
        ownerPlayerId: "alice",
        zone,
      }),
    ],
  });
}
function run(state: GameState, action: Action, getDef = () => base) {
  return executeEffect({
    state,
    chainId: "test:card-zone-guard",
    sourceInstanceId: "target",
    actingPlayerId: "alice",
    effect: effect(action),
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: none,
  });
}

describe("カード移動DSLの未型付け入口", () => {
  it("search_zoneのvoidをdeck・手札・手元・trash・混在で正規化前に拒否する", () => {
    for (const zone of ["deck", "hand", "set_aside", "trash"] as const) {
      for (const scope of zone === "hand"
        ? [zone, ["hand", "trash"]]
        : [zone]) {
        const state = makeState(zone);
        const before = structuredClone(state);
        const action = {
          kind: "search_zone",
          zone: scope,
          destination: "void",
          count: 1,
          mandatory: true,
        } as unknown as DSL.SearchZoneAction;
        expect(() => run(state, action)).toThrow("Cards cannot move to void");
        expect(state).toEqual(before);
      }
    }
  });

  it("search_zoneの手札・手元の個別選択sentinelは有効なpendingへ接続する", () => {
    const result = run(makeState("hand"), {
      kind: "search_zone",
      zone: "hand",
      destination: "hand_or_set_aside_choice",
      count: 1,
      mandatory: true,
    });
    expect(result.pendingZoneSelection?.destination).toBe(
      "hand_or_set_aside_choice"
    );
    expect(result.pendingZoneSelection?.candidateCardInstanceIds).toEqual([
      "target",
    ]);
    expect(result.cardInstances[0]!.zone).toBe("hand");
  });

  for (const mode of ["mandatory", "optional"] as const) {
    describe(`revealed / ${mode}`, () => {
      for (const explicit of [false, true]) {
        describe(explicit ? "明示disposition" : "move_selfから推論", () => {
          it("voidを公開・pending・一括カード移動より前に拒否する", () => {
            const definition: CardDefinition = {
              ...base,
              cardNo: "TEST-REVEALED-VOID",
              effects: [
                {
                  timing: { kind: "card_event", event: "revealed" },
                  executionMode: mode,
                  ...(explicit
                    ? {
                        cardEventDisposition: {
                          kind: "move",
                          destination: "void",
                        },
                      }
                    : {}),
                  steps: [
                    { action: { kind: "move_self", destination: "void" } },
                  ],
                } as unknown as Effect,
              ],
            };
            const state = makeState("deck", definition);
            const before = structuredClone(state);
            expect(() =>
              executeDeckReveal(
                state,
                "alice",
                {
                  kind: "deck_reveal",
                  revealCount: 1,
                  picks: [],
                  remainder: "bottom",
                },
                () => definition
              )
            ).toThrow("Cards cannot move to void");
            expect(state).toEqual(before);
          });
        });
      }
    });
  }

  it("borrowのbeforeMoveと即時・遅延thenMoveを本文・公開・usageより前に拒否する", () => {
    const definition: CardDefinition = {
      ...base,
      cardNo: "TEST-BORROW-GUARD",
      printedCategory: "magic",
      effects: [effect({ kind: "draw", player: "self", count: 1 })],
    };
    for (const move of [
      { beforeMove: { zone: "void", fromZone: "hand" } },
      { thenMove: { zone: "void", fromZone: "trash" } },
      { thenMove: { zone: "void", fromZone: "trash", afterTriggers: true } },
    ]) {
      let state = makeState("trash", definition);
      state = replaceCardInstances(state, [
        ...state.cardInstances,
        createCardInstance(base, {
          instanceId: "draw-card",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ]);
      const before = structuredClone(state);
      const action = {
        kind: "borrow_magic_effect",
        target: { kind: "self" },
        borrowModes: ["main"],
        ...move,
      } as unknown as DSL.BorrowMagicEffectAction;
      expect(() =>
        executeBorrowMagicEffect(
          state,
          "test:borrow-guard",
          "alice",
          action,
          (id) => (id === definition.cardNo ? definition : base),
          ["target"],
          executeEffect,
          none
        )
      ).toThrow("Cards cannot move to void");
      expect(state).toEqual(before);
    }
  });

  it("borrowの有効な即時移動と本文pendingのcleanupを維持し不正な遅延移動は先に拒否する", () => {
    for (const pauses of [false, true]) {
      const definition: CardDefinition = {
        ...base,
        cardNo: "TEST-BORROW-POSITIVE",
        printedCategory: "magic",
        effects: [
          effect(
            pauses
              ? {
                  kind: "search_zone",
                  zone: "hand",
                  destination: "hand_or_set_aside_choice",
                  count: 1,
                  mandatory: true,
                }
              : { kind: "draw", count: 1 }
          ),
        ],
      };
      const initial = makeState("trash", definition);
      const state = replaceCardInstances(initial, [
        ...initial.cardInstances,
        createCardInstance(base, {
          instanceId: "choice",
          ownerPlayerId: "alice",
          zone: pauses ? "hand" : "deck",
        }),
      ]);
      const action: DSL.BorrowMagicEffectAction = {
        kind: "borrow_magic_effect",
        target: { kind: "self" },
        borrowModes: ["main"],
        thenMove: { zone: "removed_from_game", fromZone: "trash" },
      };
      const getDef = (id: string) =>
        id === definition.cardNo ? definition : base;
      const before = structuredClone(state);
      expect(() =>
        executeBorrowMagicEffect(
          state,
          "test:borrow-pause",
          "alice",
          {
            ...action,
            thenMove: { ...action.thenMove!, zone: "void" },
          } as unknown as DSL.BorrowMagicEffectAction,
          getDef,
          ["target"],
          executeEffect,
          none
        )
      ).toThrow("Cards cannot move to void");
      expect(state).toEqual(before);
      const result = executeBorrowMagicEffect(
        state,
        "test:borrow-positive",
        "alice",
        action,
        getDef,
        ["target"],
        executeEffect,
        none
      );
      if (pauses) {
        expect(result.pendingZoneSelection).not.toBeNull();
        expect(result.pendingAfterTriggersContinuations).toHaveLength(1);
        const cleanup =
          result.pendingAfterTriggersContinuations[0]!.resumeEffectOverride!
            .steps[0]!.action;
        expect(cleanup.kind === "move_card" && cleanup.to.zone).toBe(
          "removed_from_game"
        );
      } else {
        expect(
          result.cardInstances.find((card) => card.instanceId === "target")
            ?.zone
        ).toBe("removed_from_game");
        expect(result.players[0]!.handCount).toBe(1);
      }
    }
  });

  it("mandatory revealedの有効な直接除外は一括更新とdeck枚数同期を維持する", () => {
    const definition: CardDefinition = {
      ...base,
      cardNo: "TEST-REVEALED-VALID",
      effects: [
        {
          timing: { kind: "card_event", event: "revealed" },
          executionMode: "mandatory",
          cardEventDisposition: {
            kind: "move",
            destination: "removed_from_game",
          },
          steps: [],
        },
      ],
    };
    const result = executeDeckReveal(
      makeState("deck", definition),
      "alice",
      { kind: "deck_reveal", revealCount: 1, picks: [], remainder: "bottom" },
      () => definition
    );
    expect(result.cardInstances[0]!.zone).toBe("removed_from_game");
    expect(result.players[0]!.deckCount).toBe(0);
    expect(result.players[0]!.handCount).toBe(0);
  });

  it("通常のコア→void移動はカード移動ガードの対象にしない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
          reserveSoulCoreCount: 0,
          voidNormalCoreCount: 0,
        },
      ],
    });
    const result = run(state, {
      kind: "core_move",
      from: { kind: "reserve", player: "self" },
      to: { kind: "void", player: "self" },
      amount: 1,
    });
    expect(result.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(result.players[0]!.voidNormalCoreCount).toBe(1);
  });
});
