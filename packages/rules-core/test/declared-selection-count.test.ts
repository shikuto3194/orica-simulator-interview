import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type Effect,
  type GameState,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const definition = ALL_CARDS.find((card) => card.cardNo === "BSTH01-C01")!;
const lookup = {
  getCardDefinitionById: (id: string) =>
    ALL_CARDS.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function base(): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      ...["hand", "trash"].flatMap((zone) =>
        ["a", "b"].map((suffix) =>
          createCardInstance(definition, {
            instanceId: `${zone}-${suffix}`,
            ownerPlayerId: "alice",
            zone: zone as "hand" | "trash",
          })
        )
      ),
    ],
  });
}
function run(effect: Effect) {
  return executeEffect({
    state: base(),
    effect,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    chainId: "selection-count",
    ...lookup,
  });
}
function actions(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "alice", ...lookup });
}

describe("発揮後の固定枚数と任意枚数", () => {
  it("任意stepを実行した後の固定1枚破棄は辞退不可", () => {
    let state = run({
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          executionMode: "optional",
          action: { kind: "discard", player: "self", count: 1 },
        },
      ],
    });
    const execute = actions(state).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    state = applyLegalAction({ state, action: execute, ...lookup }).state;
    const choice = actions(state).find(
      (a) => a.kind === "resolve_pending_zone_selection"
    )!;
    expect(choice).toMatchObject({ canSkip: false });
    expect(() =>
      applyLegalAction({
        state,
        action: choice,
        selectedZoneCardIds: [],
        ...lookup,
      })
    ).toThrow();
    state = applyLegalAction({
      state,
      action: choice,
      selectedZoneCardIds: ["hand-b"],
      ...lookup,
    }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "hand-b")?.zone
    ).toBe("trash");
  });

  it("「まで」の破棄は発揮後も0枚で完了できる", () => {
    const state = run({
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: { min: 0, max: 1 } } }],
    });
    const choice = actions(state).find(
      (a) => a.kind === "resolve_pending_zone_selection"
    )!;
    expect(choice).toMatchObject({ canSkip: true });
    const after = applyLegalAction({
      state,
      action: choice,
      selectedZoneCardIds: [],
      ...lookup,
    }).state;
    expect(after.pendingZoneSelection).toBeNull();
    expect(after.cardInstances.map((c) => [c.instanceId, c.zone])).toEqual(
      state.cardInstances.map((c) => [c.instanceId, c.zone])
    );
  });

  for (const count of [1, { min: 0, max: 1 }] as const)
    it(`複数ゾーン検索は固定枚数と「まで」を区別する: ${JSON.stringify(count)}`, () => {
      const state = run({
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: ["hand", "trash"],
              count,
              mandatory: true,
              destination: "removed_from_game",
            },
          },
        ],
      });
      const choice = actions(state).find(
        (a) => a.kind === "resolve_pending_zone_selection"
      )!;
      expect(choice).toMatchObject({ canSkip: count !== 1 });
      if (count === 1)
        expect(() =>
          applyLegalAction({
            state,
            action: choice,
            selectedZoneCardIds: [],
            ...lookup,
          })
        ).toThrow();
      else
        expect(
          applyLegalAction({
            state,
            action: choice,
            selectedZoneCardIds: [],
            ...lookup,
          }).state.pendingZoneSelection
        ).toBeNull();
      const after = applyLegalAction({
        state,
        action: choice,
        selectedZoneCardIds: ["trash-b"],
        ...lookup,
      }).state;
      expect(
        after.cardInstances.find((c) => c.instanceId === "trash-b")?.zone
      ).toBe("removed_from_game");
    });
});
