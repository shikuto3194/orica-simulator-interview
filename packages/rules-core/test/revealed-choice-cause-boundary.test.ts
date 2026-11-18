import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type Effect,
  type GameState,
  type ApplyLegalActionOptions,
} from "../src";
import { finishCoreChoices } from "./helpers/core-choice-driver";

const real = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const victim: CardDefinition = {
  ...real.get("BSTH09-C03")!,
  cardNo: "TEST-REVEAL-CAUSE-VICTIM",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  effects: [
    {
      timing: {
        kind: "card_event",
        event: "leave_field",
        cause: ["opponent_effect"],
      },
      executionMode: "optional",
      steps: [{ action: { kind: "stay_on_field", target: { kind: "self" } } }],
    },
  ],
};

function setup(
  owner: string,
  effect: Effect,
  extraDefs: CardDefinition[] = []
) {
  const actor = owner === "bob" ? "alice" : "bob";
  const opener: CardDefinition = {
    ...real.get("BSTH01-C01")!,
    cardNo: "TEST-REVEAL-CAUSE-OPENER",
    tribe: "勇傑",
    effects: [effect, victim.effects![0]!],
  };
  const defs = new Map(
    [...ALL_CARDS, victim, opener, ...extraDefs].map((card) => [
      card.cardNo,
      card,
    ])
  );
  const options = {
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
      ...defs.values(),
    ]),
    getRegisteredFieldCardEffectActions: () => undefined,
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 10,
      playerOverrides: ["alice", "bob"].map((id) => ({
        deckCount: id === owner ? 2 : 0,
        handCount: 0,
      })),
      cardInstances: [
        createCardInstance(opener, {
          instanceId: "opener",
          ownerPlayerId: actor,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(victim, {
          instanceId: "victim",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
        ...[
          extraDefs[0] ?? real.get("BSTH09-M01")!,
          real.get("BSTH01-C21")!,
        ].map((card, index) =>
          createCardInstance(card, {
            instanceId: index === 0 ? "choice" : "filler",
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
    }),
    activePlayerId: actor,
    turnNumber: 3,
    step: "main",
  };
  return {
    actor,
    owner,
    options,
    state: executeEffect({
      ...options,
      state,
      chainId: "test:revealed-choice-cause",
      sourceInstanceId: "opener",
      actingPlayerId: actor,
      effect,
      effectIndex: 0,
    }),
  };
}

function choose(
  fixture: ReturnType<typeof setup>,
  selectedDeckRevealCardIds: string[],
  input: Partial<ApplyLegalActionOptions> = {}
) {
  // Exercise the durable pending, rather than relying on object identity.
  const state = JSON.parse(JSON.stringify(fixture.state)) as GameState;
  const action = getLegalActions({
    ...fixture.options,
    state,
    actingPlayerId: fixture.owner,
  }).find((entry) => entry.kind === "resolve_pending_deck_reveal_pick");
  expect(action?.actingPlayerId).toBe(fixture.owner);
  return applyLegalAction({
    ...fixture.options,
    state,
    action: action!,
    selectedDeckRevealCardIds,
    ...input,
  }).state;
}

function declineReaction(fixture: ReturnType<typeof setup>, state: GameState) {
  const available = () =>
    ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ ...fixture.options, state, actingPlayerId })
    );
  for (let n = 0; n < 10; n++) {
    const actions = available();
    const decline = actions.find(
      (action) => action.kind === "resolve_pending_triggered_effect"
    );
    if (decline)
      return applyLegalAction({
        ...fixture.options,
        state,
        action: decline,
        skipOptionalEffect: true,
      }).state;
    const next = actions.find(
      (action) =>
        action.kind === "select_pending_to_resolve" ||
        action.kind === "resolve_pending_burst_check"
    );
    expect(next, JSON.stringify(actions)).toBeDefined();
    state = applyLegalAction({
      ...fixture.options,
      state,
      action: next!,
      skipOptionalEffect: true,
    }).state;
  }
  throw new Error("Leave reaction did not become actionable");
}

const coreRemoval: Effect["steps"][number] = {
  action: {
    kind: "core_move",
    from: {
      kind: "field_card",
      player: "opponent",
      filter: { category: ["spirit"] },
    },
    to: { kind: "void", player: "self" },
    amount: 1,
  },
};

describe("BSTH09-M01の所有者選択と元効果の原因境界", () => {
  const parentCounter: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "deck_reveal",
          player: "opponent",
          revealCount: 2,
          picks: [],
          remainder: "bottom",
          beforePickSteps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      },
    ],
  };

  it.each(["alice", "bob"])(
    "%sの自己ミラージュによるSBAも所有者とセットカードに帰属する",
    (owner) => {
      const entry: CardDefinition = {
        ...real.get("BSTH01-C01")!,
        cardNo: "TEST-REVEAL-SELF-MIRAGE",
        mirageData: { cost: 0, reduction: [] },
        effects: [
          {
            timing: { kind: "card_event", event: "revealed" },
            executionMode: "optional",
            cardEventDisposition: { kind: "set_as_mirage" },
            steps: [{ action: { kind: "noop" } }],
          },
          {
            timing: { kind: "continuous" },
            applicability: { zone: ["mirage_set"] },
            steps: [
              {
                action: {
                  kind: "override_properties",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  properties: { levelCost: { lv1: 2 } },
                  duration: { scope: "while_on_field" },
                },
              },
            ],
          },
        ],
      };
      const fixture = setup(owner, parentCounter, [entry]);
      let state = choose(fixture, ["choice"], {
        deckRevealMiragePaymentSourcesByInstanceId: { choice: [] },
      });
      expect(state.mirageSetStates).toEqual([
        { playerId: owner, cardInstanceId: "choice" },
      ]);
      expect(state.pendingLeaveEntities).toEqual([
        expect.objectContaining({
          causePlayerId: owner,
          causedByEffectSourceInstanceId: "choice",
        }),
      ]);
      expect(state.pendingTriggeredEffects).toEqual([
        expect.objectContaining({
          relatedInstanceId: "opener",
          cause: "opponent_effect",
        }),
      ]);
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(0);
      state = declineReaction(fixture, state);
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(1);
      expect(state.pendingAfterTriggersContinuations).toEqual([]);
    }
  );

  it.each(["alice", "bob"])(
    "%sの自己召喚は維持コアを選ぶまで親を再開せず、場入りを1回だけ通知する",
    (owner) => {
      const entry: CardDefinition = {
        ...real.get("BSTH01-C01")!,
        cardNo: "TEST-REVEAL-SELF-SUMMON",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
        effects: [
          {
            timing: { kind: "card_event", event: "revealed" },
            executionMode: "optional",
            cardEventDisposition: { kind: "move", destination: "field" },
            steps: [{ action: { kind: "move_self", destination: "field" } }],
          },
        ],
      };
      const fixture = setup(owner, parentCounter, [entry]);
      let state = choose(fixture, ["choice"]);
      expect(state.pendingMultiPlacement?.actingPlayerId).toBe(owner);
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(0);
      state = finishCoreChoices(
        state,
        fixture.options.getCardDefinitionById,
        fixture.options
      );
      expect(
        state.cardInstances.find((card) => card.instanceId === "choice")
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(1);
      expect(
        state.log.filter((entry) => entry.startsWith("effect:summon:choice:"))
      ).toHaveLength(1);
      expect(
        state.log.filter(
          (entry) =>
            entry.startsWith("effect:field_place:") && entry.endsWith(":choice")
        )
      ).toHaveLength(0);
      expect(state.pendingDeckReveal).toBeNull();
      expect(state.pendingAfterTriggersContinuations).toEqual([]);
    }
  );

  it.each(["alice", "bob"])(
    "%sの保存されたbonus carrierと離脱誘発も親より先に完了する",
    (owner) => {
      const entry: CardDefinition = {
        ...real.get("BSTH01-C01")!,
        cardNo: "TEST-REVEAL-SELF-BONUS",
        effects: [
          {
            timing: { kind: "card_event", event: "revealed" },
            executionMode: "optional",
            cardEventDisposition: { kind: "move", destination: "hand" },
            steps: [
              { action: { kind: "move_self", destination: "hand" } },
              coreRemoval,
            ],
          },
        ],
      };
      const fixture = setup(owner, parentCounter, [entry]);
      // Test the serialized handler carrier, not deck-to-carrier compilation.
      fixture.state.pendingDeckReveal!.bonusStepsByInstanceId = {
        choice: [coreRemoval],
      };
      let state = choose(fixture, ["choice"]);
      expect(
        state.cardInstances.find((card) => card.instanceId === "choice")?.zone
      ).toBe("hand");
      expect(
        state.players.find((player) => player.id === owner)!.handCount
      ).toBe(1);
      expect(state.pendingLeaveEntities).toEqual([
        expect.objectContaining({
          causePlayerId: owner,
          causedByEffectSourceInstanceId: "choice",
        }),
      ]);
      expect(state.pendingTriggeredEffects).toEqual([
        expect.objectContaining({
          relatedInstanceId: "opener",
          cause: "opponent_effect",
        }),
      ]);
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(0);
      state = declineReaction(fixture, state);
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(1);
      expect(state.pendingAfterTriggersContinuations).toEqual([]);
    }
  );

  for (const owner of ["alice", "bob"])
    for (const selected of [[], ["choice"]])
      it.each(["beforePickSteps", "beforeMoveSteps", "afterReveal"] as const)(
        `${owner}/selected=${selected.length}/%s: 相手原因の消滅を自己原因へ変えない`,
        (boundary) => {
          const effect: Effect = {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: {
                  kind: "deck_reveal",
                  player: "opponent",
                  revealCount: 2,
                  picks: [],
                  remainder: "bottom",
                  ...(boundary === "afterReveal"
                    ? {}
                    : { [boundary]: [coreRemoval] }),
                },
              },
              ...(boundary === "afterReveal" ? [coreRemoval] : []),
            ],
          };
          const fixture = setup(owner, effect);
          let state = choose(fixture, selected);
          if (state.pendingDeckReveal) {
            const action = getLegalActions({
              ...fixture.options,
              state,
              actingPlayerId: fixture.actor,
            }).find(
              (entry) => entry.kind === "resolve_pending_deck_reveal_order"
            );
            expect(action).toBeDefined();
            state = applyLegalAction({
              ...fixture.options,
              state,
              action: action!,
              deckRevealRemainderOrder:
                state.pendingDeckReveal.revealedCardInstanceIds,
            }).state;
          }
          expect(
            state.cardInstances.find((card) => card.instanceId === "victim")
          ).toMatchObject({ zone: "field", normalCoreCount: 0 });
          expect(state.pendingLeaveEntities).toEqual([
            expect.objectContaining({
              causePlayerId: fixture.actor,
              causedByEffectSourceInstanceId: "opener",
            }),
          ]);
          expect(state.pendingTriggeredEffects).toEqual([
            expect.objectContaining({
              relatedInstanceId: "victim",
              cause: "opponent_effect",
            }),
          ]);
          expect(state.setBurstStates).toEqual(
            selected.length
              ? [{ playerId: owner, cardInstanceId: "choice" }]
              : []
          );
          expect(state.pendingAfterTriggersContinuations).toEqual([]);
          state = declineReaction(fixture, state);
          expect(
            state.cardInstances.find((card) => card.instanceId === "victim")
              ?.zone
          ).toBe("trash");
          expect(state.pendingTriggeredEffects).toEqual([]);
          expect(state.pendingLeaveEntities).toEqual([]);
        }
      );

  it.each(["alice", "bob"])(
    "%sの自己配置が起こすSBAは所有者と配置カードに帰属し、親は離脱誘発後まで待つ",
    (owner) => {
      const entry: CardDefinition = {
        ...real.get("BSTH01-C01")!,
        cardNo: "TEST-REVEAL-SELF-ENTRY",
        printedCategory: "nexus",
        tribe: "",
        levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
        keywordTags: ["enter_field_core_placement_forbidden"],
        effects: [
          {
            timing: { kind: "card_event", event: "revealed" },
            executionMode: "optional",
            cardEventDisposition: { kind: "move", destination: "field" },
            steps: [{ action: { kind: "move_self", destination: "field" } }],
          },
          {
            timing: { kind: "continuous" },
            steps: [
              {
                action: {
                  kind: "override_properties",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  properties: { levelCost: { lv1: 2 } },
                  duration: { scope: "while_on_field" },
                },
              },
            ],
          },
        ],
      };
      const fixture = setup(
        owner,
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                player: "opponent",
                revealCount: 2,
                picks: [],
                remainder: "bottom",
                beforePickSteps: [
                  {
                    action: {
                      kind: "count_increase",
                      player: "self",
                      amount: 1,
                    },
                  },
                ],
              },
            },
          ],
        },
        [entry]
      );
      let state = choose(fixture, ["choice"]);
      expect(
        state.cardInstances.find((card) => card.instanceId === "choice")
      ).toMatchObject({ zone: "field", ownerPlayerId: owner });
      expect(state.pendingLeaveEntities).toEqual([
        expect.objectContaining({
          causePlayerId: owner,
          causedByEffectSourceInstanceId: "choice",
        }),
      ]);
      expect(state.pendingTriggeredEffects).toEqual([
        expect.objectContaining({
          relatedInstanceId: "opener",
          cause: "opponent_effect",
        }),
      ]);
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(0);
      expect(state.pendingAfterTriggersContinuations).toHaveLength(1);
      expect(state.pendingAfterTriggersContinuations[0]!.actingPlayerId).toBe(
        fixture.actor
      );
      state = declineReaction(fixture, state);
      expect(
        state.cardInstances.find((card) => card.instanceId === "opener")?.zone
      ).toBe("trash");
      expect(
        state.players.find((player) => player.id === fixture.actor)!.countValue
      ).toBe(1);
      expect(state.pendingAfterTriggersContinuations).toEqual([]);
      expect(state.pendingDeckReveal).toBeNull();
    }
  );
});
