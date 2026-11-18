import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { Action, Effect, DSL } from "../src/dsl-types";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { GameState } from "../src/model";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const run = (
  state: GameState,
  effect: Effect,
  sourceInstanceId: string,
  actingPlayerId = "alice",
  effectSourceInstanceId?: string
) =>
  executeEffect({
    chainId: "test:core-placement-source-filter",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    ...(effectSourceInstanceId ? { effectSourceInstanceId } : {}),
  });

function setup(player: string, category: "spirit" | "ultimate") {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: ["alice", "bob"].map(() => ({
      voidNormalCoreCount: 10,
      reserveNormalCoreCount: 0,
      lifeNormalCoreCount: 5,
    })),
    cardInstances: [
      createCardInstance(getDef("BSTH03-C31")!, {
        instanceId: "guard",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(
        getDef(category === "spirit" ? "BSTH01-C01" : "BSTH03-M06")!,
        {
          instanceId: "source",
          ownerPlayerId: player,
          zone: "field",
          normalCoreCount: 1,
        }
      ),
      createCardInstance(getDef("BSTH01-C01")!, {
        instanceId: "destination",
        ownerPlayerId: player,
        zone: "field",
        normalCoreCount: 0,
      }),
    ],
  });
}

function register(
  state: GameState,
  options: Partial<DSL.RestrictCorePlacementAction> = {},
  filtered = true
) {
  return run(
    state,
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "restrict_core_placement",
            player: "either",
            scope: "from_void_self",
            sourceTimingScope: "summon",
            ...(filtered
              ? { sourceFilter: { category: ["spirit" as const] } }
              : {}),
            duration: { scope: "while_on_field" },
            ...options,
          },
        },
      ],
    },
    "guard"
  );
}

const actions: Action[] = [
  {
    kind: "core_move",
    from: { kind: "void", player: "self" },
    to: { kind: "reserve", player: "self" },
    amount: 2,
  },
  {
    kind: "core_move",
    from: { kind: "union", sources: [{ kind: "void", player: "self" }] },
    to: { kind: "reserve", player: "self" },
    amount: 1,
  },
  {
    kind: "core_distribute",
    from: { kind: "void", player: "self" },
    to: { kind: "self" },
    amount: 2,
  },
  {
    kind: "core_set_to_level",
    from: { kind: "void", player: "self" },
    target: {
      kind: "filter",
      player: "self",
      filter: { category: ["spirit"] },
      count: "all",
    },
    level: 1,
  },
];

describe.each(["alice", "bob"])(
  "core placement sourceFilter for %s",
  (player) => {
    it.each(actions)(
      "$kind は移動先でなく発揮元カテゴリで双方を制限する ($from.kind)",
      (action) => {
        for (const category of ["spirit", "ultimate"] as const) {
          let state = register(setup(player, category));
          state = run(
            state,
            {
              timing: { kind: "card_event", event: "summon" },
              steps: [{ action }],
            },
            "source",
            player
          );
          const blocked = category === "spirit";
          const moved =
            action.kind === "core_set_to_level" ||
            (action.kind === "core_move" && action.from.kind === "union")
              ? 1
              : 2;
          expect(
            state.players.find((p) => p.id === player)!.voidNormalCoreCount
          ).toBe(blocked ? 10 : 10 - moved);
          if (action.kind === "core_move")
            expect(
              state.players.find((p) => p.id === player)!.reserveNormalCoreCount
            ).toBe(blocked ? 0 : moved);
          if (action.kind === "core_distribute")
            expect(
              state.cardInstances.find((c) => c.instanceId === "source")!
                .normalCoreCount
            ).toBe(blocked ? 1 : 3);
          if (action.kind === "core_set_to_level")
            expect(
              state.cardInstances.find((c) => c.instanceId === "destination")!
                .normalCoreCount
            ).toBe(blocked ? 0 : 1);
        }
      }
    );

    it("スピリットの非召喚時は許可し、sourceFilter省略時の召喚時限定は他カテゴリにも維持する", () => {
      const action = actions[0]!;
      const flash = run(
        register(setup(player, "spirit")),
        { timing: { kind: "activated", mode: "flash" }, steps: [{ action }] },
        "source",
        player
      );
      expect(
        flash.players.find((p) => p.id === player)!.voidNormalCoreCount
      ).toBe(8);
      let state = register(setup(player, "ultimate"), {}, false);
      state = run(
        state,
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [{ action }],
        },
        "source",
        player
      );
      expect(
        state.players.find((p) => p.id === player)!.voidNormalCoreCount
      ).toBe(10);
    });

    it("ライフへの配置制限もsourceFilterと移動元制限を同時に評価する", () => {
      for (const category of ["spirit", "ultimate"] as const) {
        let state = register(setup(player, category), {
          scope: "to_life",
          fromZone: "void",
        });
        state = run(
          state,
          {
            timing: { kind: "card_event", event: "summon" },
            steps: [
              {
                action: {
                  kind: "core_move",
                  from: { kind: "void", player: "self" },
                  to: { kind: "life", player: "self" },
                  amount: 1,
                },
              },
            ],
          },
          "source",
          player
        );
        expect(
          state.players.find((p) => p.id === player)!.lifeNormalCoreCount
        ).toBe(category === "spirit" ? 5 : 6);
        expect(
          state.players.find((p) => p.id === player)!.voidNormalCoreCount
        ).toBe(category === "spirit" ? 10 : 9);
      }
    });

    it.each(actions.filter((a) => a.kind !== "core_set_to_level"))(
      "$kind はテキスト供給元の発揮元を共通規則で照合する ($from.kind)",
      (action) => {
        let state = register(setup(player, "ultimate"));
        // 非合体の効果供給元をspiritへ向けると、ultimateのhostから実行しても制限する。
        state = run(
          state,
          {
            timing: { kind: "card_event", event: "summon" },
            steps: [{ action }],
          },
          "source",
          player,
          "destination"
        );
        expect(
          state.players.find((p) => p.id === player)!.voidNormalCoreCount
        ).toBe(10);
      }
    );
  }
);
