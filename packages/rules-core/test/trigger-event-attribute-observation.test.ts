import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  Effect,
  EffectStep,
  GameState,
} from "../src/model";
import {
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  restoreSnapshot,
  sanitizeStateForViewer,
} from "../src";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { listOccurrenceTallies } from "./helpers/quantity-usage-fixture";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";

const reward: EffectStep[] = [
  { action: { kind: "count_increase", player: "self", amount: 1 } },
];
const exhaust: EffectStep = {
  action: { kind: "exhaust", target: { kind: "self" } },
};
const purple: EffectStep = {
  action: { kind: "treat_as", aspects: ["color"], asColor: "purple" },
};
const rename: EffectStep = {
  action: {
    kind: "override_properties",
    target: { kind: "self" },
    properties: { cardName: "changed" },
    duration: { scope: "turn" },
  },
};
const draw: EffectStep = { action: { kind: "draw", count: 1 } };
const releaseSuppression: EffectStep = {
  action: {
    kind: "negate_ongoing_effects",
    sourcePlayer: "self",
    target: {
      kind: "filter",
      player: "self",
      filter: { cardName: { exact: "observer" } },
      count: "all",
    },
  },
};

function fixture(
  trigger: Effect,
  steps: EffectStep[],
  entry = false,
  suppressed = false,
  category?: CardDefinition["printedCategory"]
) {
  const definition: CardDefinition = {
    cardNo: "ATTRIBUTE-SOURCE",
    name: "original",
    printedCategory: category ?? (entry ? "nexus" : "spirit"),
    cost: 0,
    colors: ["red"],
    tribe: "A",
    reductionSymbols: [],
    symbolColors: ["red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: category === "brave" || !entry ? 1 : 0,
        bp: 1000,
      },
    ],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const observer: CardDefinition = {
    ...definition,
    cardNo: "ATTRIBUTE-OBSERVER",
    name: "observer",
    printedCategory: "nexus",
    levelDefs: [{ level: 1, requiredCores: 0 }],
    effects: [trigger],
  };
  const effect: Effect = { timing: { kind: "activated", mode: "main" }, steps };
  const definitions = [definition, observer];
  const deps = {
    getCardDefinitionById: (id: string) =>
      definitions.find((card) => card.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ deckCount: 3, reserveNormalCoreCount: 5 }, {}],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: entry ? "hand" : "field",
          normalCoreCount: entry ? 0 : 1,
        }),
        createCardInstance(observer, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        ...Array.from({ length: 3 }, (_, i) =>
          createCardInstance(definition, {
            instanceId: `deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    }),
    step: "main",
    ...(suppressed
      ? {
          activeContinuousEffects: [
            {
              effectId: "initial-suppression",
              sourceInstanceId: "source",
              sourceDefinitionId: definition.cardNo,
              actingPlayerId: "alice",
              targetInstanceId: "observer",
              modifierTag: "effect_suppression" as const,
              duration: { scope: "turn" as const },
              createdAtTurn: 1,
              createdAtAttackId: null,
              metadata: {},
            },
          ],
        }
      : {}),
  };
  const restore = (state: GameState) =>
    restoreSnapshot(
      JSON.parse(JSON.stringify(createGameSnapshot(state))),
      deps.getCardDefinitionById,
      deps
    ).state;
  const run = (
    start = before,
    body = steps,
    chainId = "attribute-observation"
  ) => {
    const executed = executeEffectWithChosenMinimumCores({
      state: start,
      effect: { ...effect, steps: body },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId,
      ...deps,
    });
    return collectAndQueueTriggerReactions({
      beforeState: start,
      afterState: executed,
      source: "action_resolution",
      chainId,
      causedByPlayerId: "alice",
      causedBySourceInstanceId: "source",
      enterFieldCausedByPlayerId: "alice",
      ...deps,
    });
  };
  const responders = (state: GameState) =>
    state.pendingTriggeredEffects
      .flatMap((pendingEffect) =>
        getAvailableTriggeredEffectSourceChoices({
          state,
          pendingEffect,
          ...deps,
        })
      )
      .map((choice) => choice.sourceCard.instanceId);
  return { run, restore, responders };
}

describe("trigger attributes belong to the observed operation", () => {
  it.each(["spirit", "brave"] as const)(
    "retains summon category semantics for a spirit-state Brave (filter=%s)",
    (category) => {
      const f = fixture(
        {
          timing: {
            kind: "game_event",
            event: "summon",
            player: "self",
            triggerFilter: { category: [category] },
          },
          steps: reward,
        },
        [{ action: { kind: "summon", target: { kind: "self" } } }],
        true,
        false,
        "brave"
      );
      expect(f.responders(f.run())).toEqual(
        category === "brave" ? ["observer"] : []
      );
    }
  );
  it.each([false, true])(
    "source filter uses the event's color (changedFirst=%s)",
    (changedFirst) => {
      const f = fixture(
        {
          timing: {
            kind: "game_event",
            event: "exhaust",
            player: "self",
            triggerSourceFilter: { colors: ["purple"] },
          },
          steps: reward,
        },
        changedFirst ? [purple, exhaust] : [exhaust, purple]
      );
      expect(f.responders(f.run())).toEqual(changedFirst ? ["observer"] : []);
    }
  );
  it.each([false, true])(
    "requires an unsuppressed observer when the operation occurs (releasedFirst=%s)",
    (releasedFirst) => {
      const f = fixture(
        {
          timing: { kind: "game_event", event: "after_draw", player: "self" },
          steps: reward,
        },
        releasedFirst ? [releaseSuppression, draw] : [draw, releaseSuppression],
        false,
        true
      );
      const state = f.run();
      expect(
        state.activeContinuousEffects.some(
          (ce) => ce.effectId === "initial-suppression"
        )
      ).toBe(false);
      expect(f.responders(f.restore(state))).toEqual(
        releasedFirst ? ["observer"] : []
      );
    }
  );
  it("発揮抑止中のドローも観測回数に入り、解除後の2回目で発揮できる", () => {
    const f = fixture(
      {
        timing: { kind: "game_event", event: "after_draw", player: "self" },
        occurrenceGate: { duration: "turn", targetCount: 2 },
        steps: reward,
      },
      [draw, releaseSuppression],
      false,
      true
    );
    const first = f.restore(f.run());
    expect(listOccurrenceTallies(first).map((entry) => entry.count)).toEqual([
      1,
    ]);
    expect(f.responders(first)).toEqual([]);
    const second = f.run(first, [draw], "attribute-second-draw");
    expect(listOccurrenceTallies(second).map((entry) => entry.count)).toEqual([
      2,
    ]);
    expect(f.responders(second)).toEqual(["observer"]);
  });
  it.each(["condition", "filter"] as const)(
    "does not borrow a later color for %s",
    (kind) => {
      const f = fixture(
        {
          timing: {
            kind: "game_event",
            event: "exhaust",
            player: "self",
            ...(kind === "filter"
              ? { triggerFilter: { colors: ["purple"] } }
              : {}),
          },
          ...(kind === "condition"
            ? { condition: [{ kind: "trigger_colors", colors: ["purple"] }] }
            : {}),
          steps: reward,
        },
        [exhaust, purple]
      );
      expect(f.responders(f.run())).toEqual([]);
    }
  );

  it.each(["condition", "filter"] as const)(
    "uses the color established before the event for %s",
    (kind) => {
      const f = fixture(
        {
          timing: {
            kind: "game_event",
            event: "exhaust",
            player: "self",
            ...(kind === "filter"
              ? { triggerFilter: { colors: ["purple"] } }
              : {}),
          },
          ...(kind === "condition"
            ? { condition: [{ kind: "trigger_colors", colors: ["purple"] }] }
            : {}),
          steps: reward,
        },
        [purple, exhaust]
      );
      expect(f.responders(f.restore(f.run()))).toEqual(["observer"]);
    }
  );

  it.each([false, true])(
    "source-name condition sees the name at the event (renamedFirst=%s)",
    (renamedFirst) => {
      const f = fixture(
        {
          timing: { kind: "game_event", event: "exhaust", player: "self" },
          condition: [
            { kind: "trigger_source_match", cardNames: [{ exact: "changed" }] },
          ],
          steps: reward,
        },
        renamedFirst ? [rename, exhaust] : [exhaust, rename]
      );
      expect(f.responders(f.run())).toEqual(renamedFirst ? ["observer"] : []);
    }
  );

  it("preserves an entry's name before later text after its maintenance-core choice", () => {
    const f = fixture(
      {
        timing: { kind: "game_event", event: "place", player: "self" },
        condition: [
          { kind: "trigger_source_match", cardNames: [{ exact: "original" }] },
        ],
        steps: reward,
      },
      [{ action: { kind: "place" } }, rename],
      true
    );
    expect(f.responders(f.restore(f.run()))).toEqual(["observer"]);
  });

  it("does not give an entry a name gained only after its maintenance-core choice", () => {
    const f = fixture(
      {
        timing: { kind: "game_event", event: "place", player: "self" },
        condition: [
          { kind: "trigger_source_match", cardNames: [{ exact: "changed" }] },
        ],
        steps: reward,
      },
      [{ action: { kind: "place" } }, rename],
      true
    );
    expect(f.responders(f.run())).toEqual([]);
  });

  it.each([false, true])(
    "keeps aggregate event clauses in the same occurrence (secondHasBoth=%s)",
    (secondHasBoth) => {
      const f = fixture(
        {
          timing: { kind: "game_event", event: "after_draw", player: "self" },
          condition: [
            { kind: "trigger_tribes", tribes: ["A"] },
            { kind: "trigger_tribes", tribes: ["B"] },
          ],
          steps: reward,
        },
        [
          draw,
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { tribes: secondHasBoth ? ["A", "B"] : ["B"] },
              duration: { scope: "turn" },
            },
          },
          draw,
        ]
      );
      expect(f.responders(f.restore(f.run()))).toEqual(
        secondHasBoth ? ["observer"] : []
      );
    }
  );

  it.each(["alice", "bob", null])(
    "removes event attributes from every public projection for %s",
    (viewer) => {
      const f = fixture(
        {
          timing: { kind: "game_event", event: "exhaust", player: "self" },
          steps: reward,
        },
        [exhaust, purple]
      );
      const state = f.run();
      const publicJson = JSON.stringify(sanitizeStateForViewer(state, viewer));
      for (const key of [
        "eventFactOccurrences",
        "effectActivationEventFactOccurrences",
        "oracleTriggerCardFact",
        "conditionContext",
        "filterState",
        "sourceIdentities",
      ])
        expect(publicJson).not.toContain(`"${key}"`);
      expect(f.responders(f.restore(state))).toEqual(["observer"]);
    }
  );
});
