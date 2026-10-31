import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type Effect,
  type GameState,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((d) => d.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
const card = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;

describe("複数体の効果離脱と魂状態選択", () => {
  it.each(
    ["alice", "bob"].flatMap((owner) =>
      [false, true].flatMap((mixed) =>
        [false, true].flatMap((eligible) =>
          (["keep", "decline"] as const).flatMap((first) =>
            (["keep", "decline"] as const).map((second) => ({
              owner,
              mixed,
              eligible,
              first,
              second,
            }))
          )
        )
      )
    )
  )(
    "対象=$owner 混在=$mixed 置換=$eligible 選択=$first/$second",
    ({ owner, mixed, eligible, first, second }) => {
      const actor = owner === "alice" ? "bob" : "alice";
      const definition = getCardDefinitionById(
        eligible ? "BSGE01-R01" : "BSTH01-C01"
      )!;
      let state = rebuildContinuousEffectsFromField(
        createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            { reserveNormalCoreCount: 3 },
            { reserveNormalCoreCount: 3 },
          ],
          cardInstances: [
            ...["one", "two"].map((instanceId) =>
              createCardInstance(definition, {
                instanceId,
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 2,
              })
            ),
            createCardInstance(definition, {
              instanceId: "deck-existing",
              ownerPlayerId: owner,
              zone: "deck",
            }),
            createCardInstance(definition, {
              instanceId: "source",
              ownerPlayerId: actor,
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        }),
        getCardDefinitionById
      );
      const effect: Effect = {
        timing: { kind: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: mixed ? 1 : 2,
              },
            },
          },
          ...(mixed
            ? [
                {
                  action: {
                    kind: "send_to_deck" as const,
                    target: {
                      kind: "filter" as const,
                      player: "opponent" as const,
                      filter: { category: ["spirit" as const] },
                      count: 1,
                    },
                    position: "bottom" as const,
                  },
                },
              ]
            : []),
        ],
      };
      state = executeEffect({
        chainId: "test:multiple-effect-leave-choices:112",
        state,
        effect,
        sourceInstanceId: "source",
        actingPlayerId: actor,
        targetInstanceIds: ["one", "two"],
        sequentialTargetConsumption: mixed,
        ...lookups,
      });
      state = flushPendingLeaves(state, getCardDefinitionById);
      if (eligible) {
        expect(state.pendingLeaveEntities).toHaveLength(2);
        expect(card(state, "two")).toMatchObject({
          zone: "field",
          normalCoreCount: 2,
          pendingLeaveKind: mixed ? "bounce" : "destroy",
        });
        if (mixed)
          expect(
            state.pendingLeaveEntities.find((p) => p.instanceId === "two")
              ?.leaveDestination
          ).toEqual({ zone: "deck", position: "bottom" });
        for (const [index, choice] of [first, second].entries()) {
          expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe(
            index === 0 ? "one" : "two"
          );
          const action = getLegalActions({
            state,
            actingPlayerId: owner,
            ...lookups,
          }).find(
            (a) =>
              a.can &&
              a.kind === "resolve_soul_state_replacement" &&
              a.choice === choice
          );
          expect(action).toBeDefined();
          state = applyLegalAction({
            state,
            action: action!,
            ...lookups,
          }).state;
          if (index === 0)
            expect(card(state, "two")).toMatchObject({
              zone: "field",
              normalCoreCount: 2,
            });
        }
      }
      expect(card(state, "one").zone).toBe(
        eligible && first === "keep" ? "field" : "trash"
      );
      expect(card(state, "two").zone).toBe(
        eligible && second === "keep" ? "field" : mixed ? "deck" : "trash"
      );
      if (card(state, "two").zone === "deck")
        expect(
          state.cardInstances
            .filter((c) => c.ownerPlayerId === owner && c.zone === "deck")
            .map((c) => c.instanceId)
        ).toEqual(["deck-existing", "two"]);
      expect(state.pendingLeaveEntities).toEqual([]);
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(
        state.players.find((p) => p.id === owner)!.reserveNormalCoreCount
      ).toBe(7);
    }
  );
});
