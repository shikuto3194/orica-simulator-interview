import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  applyLegalAction,
  type CardDefinition,
  type GameState,
  type Effect,
} from "../src";

const source: CardDefinition = {
  cardNo: "BOUNDARY",
  name: "公開途中の処理",
  printedCategory: "magic",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
const spirit: CardDefinition = {
  ...source,
  cardNo: "SPIRIT",
  name: "スピリット",
  printedCategory: "spirit",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
};
const get = (id: string) => [source, spirit].find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById: get,
  getRegisteredTriggeredEffectActions: () => [],
};
function initial(effect: Effect) {
  source.effects = [effect];
  const state = createEmptyGameState({
    playerIds: ["a", "b"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "a",
        zone: "field",
      }),
      ...[0, 1, 2].map((i) =>
        createCardInstance(spirit, {
          instanceId: `card${i}`,
          ownerPlayerId: "a",
          zone: "deck",
        })
      ),
    ],
  });
  state.step = "main";
  state.activePlayerId = "a";
  return state;
}
function act(state: GameState, kind: string, extra: object = {}) {
  const action = getLegalActions({
    state,
    actingPlayerId: "a",
    ...lookups,
  }).find((a) => a.kind === kind);
  expect(
    action,
    JSON.stringify(getLegalActions({ state, actingPlayerId: "a", ...lookups }))
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...extra })
    .state;
}

describe("公開中の処理境界", () => {
  it.each([{ selected: [] }, { selected: ["card0", "card1"] }])(
    "公開時の手札追加 $selected 後も、取得なしの中間手順を省略しない",
    ({ selected }) => {
      const previous = spirit.effects;
      spirit.effects = [
        {
          timing: { kind: "card_event", event: "revealed" },
          executionMode: "optional",
          cardEventDisposition: { kind: "move", destination: "hand" },
          steps: [{ action: { kind: "move_self", destination: "hand" } }],
        },
      ];
      try {
        const effect: Effect = {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "reveal",
              action: {
                kind: "deck_reveal",
                revealCount: 2,
                picks: [],
                remainder: "trash",
                beforePickSteps: [
                  {
                    action: {
                      kind: "count_increase",
                      player: "self",
                      amount: 3,
                    },
                  },
                ],
              },
            },
            { action: { kind: "count_increase", player: "self", amount: 5 } },
          ],
        };
        let state = executeEffect({
          chainId: "test:deck-reveal-boundary:115",
          state: initial(effect),
          effect,
          sourceInstanceId: "source",
          actingPlayerId: "a",
          ...lookups,
        });
        expect(state.pendingDeckReveal?.phase).toBe("revealed_choice");
        state = act(state, "resolve_pending_deck_reveal_pick", {
          selectedDeckRevealCardIds: selected,
        });
        expect(state.pendingDeckReveal).toBeNull();
        expect(state.players[0]!.countValue).toBe(8);
        expect(
          state.cardInstances.filter((c) => c.zone === "hand")
        ).toHaveLength(selected.length);
        expect(
          state.cardInstances.filter((c) => c.zone === "trash")
        ).toHaveLength(2 - selected.length);
      } finally {
        spirit.effects = previous;
      }
    }
  );
  it("取得カード選択前に公開枚数に応じたコアを置き、全カードは公開中のまま残る", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "reveal",
          action: {
            kind: "deck_reveal",
            revealCount: 2,
            picks: [{ count: 1 }],
            remainder: "bottom",
            beforePickSteps: [
              {
                action: {
                  kind: "core_move",
                  from: { kind: "void", player: "self" },
                  to: { kind: "reserve", player: "self" },
                  amount: {
                    source: {
                      kind: "cards_from_ref",
                      stepId: "reveal",
                      result: "revealed",
                      filter: { category: ["spirit"] },
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    };
    const before = initial(effect);
    let state = executeEffect({
      chainId: "test:deck-reveal-boundary:172",
      state: before,
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "a",
      ...lookups,
    });
    expect(state.players[0]!.reserveNormalCoreCount).toBe(
      before.players[0]!.reserveNormalCoreCount + 2
    );
    expect(
      state.cardInstances.filter((c) => c.zone === "revealed")
    ).toHaveLength(2);
    expect(state.pendingDeckReveal?.phase).toBe("picking");
    state = act(state, "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: ["card0"],
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "card0")?.zone
    ).toBe("hand");
    expect(
      state.cardInstances.find((c) => c.instanceId === "card1")?.zone
    ).toBe("deck");
  });
  it("選択後の任意処理中も取得カードを公開中に保ち、解決後に残り処理・外側手順へ戻る", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "reveal",
          action: {
            kind: "deck_reveal",
            revealCount: 2,
            picks: [{ count: 1 }],
            remainder: "trash",
            beforeMoveSteps: [
              {
                executionMode: "optional",
                action: { kind: "count_increase", player: "self", amount: 1 },
              },
            ],
          },
        },
        { action: { kind: "count_increase", player: "self", amount: 5 } },
      ],
    };
    let state = executeEffect({
      chainId: "test:deck-reveal-boundary:218",
      state: initial(effect),
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "a",
      ...lookups,
    });
    state = act(state, "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: ["card0"],
    });
    expect(
      state.cardInstances.filter((c) => c.zone === "revealed")
    ).toHaveLength(2);
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    state = act(state, "resolve_pending_step_optional_choice");
    expect(state.pendingDeckReveal).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "card0")?.zone
    ).toBe("hand");
    expect(
      state.cardInstances.find((c) => c.instanceId === "card1")?.zone
    ).toBe("trash");
    expect(state.players[0]!.countValue).toBe(6);
  });
});
