import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateActionInputChoices,
  getLegalActions,
  type ActiveStack,
  type CardDefinition,
  type GameState,
  type TargetedDisclosureContinuation,
} from "../src";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";
import type { Effect, EffectStep } from "../src/dsl-types";

const mill: EffectStep = {
  id: "mill",
  action: { kind: "discard", player: "self", fromZone: "deck", count: 1 },
};
const destroy: EffectStep = {
  id: "destroy-spirit",
  action: {
    kind: "destroy",
    target: {
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit"] },
      count: 1,
    },
  },
};
const recover: EffectStep = {
  id: "recover-nexus",
  action: {
    kind: "recover",
    target: {
      kind: "filter",
      player: "opponent",
      filter: { category: ["nexus"] },
      count: 1,
    },
  },
};
const groups = [
  {
    targetStepId: "destroy-spirit",
    requiredTargetCount: 1,
    maxTargetCount: 1,
    candidateTargetZones: ["field" as const],
    candidateTargetInstanceIds: ["spirit"],
  },
  {
    targetStepId: "recover-nexus",
    requiredTargetCount: 1,
    maxTargetCount: 1,
    candidateTargetZones: ["field" as const],
    candidateTargetInstanceIds: ["nexus"],
  },
];

function fixture(steps: EffectStep[]) {
  const spiritTemplate = ALL_CARDS.find((c) => c.cardNo === "BSTH02-C01")!;
  const nexusTemplate = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C13")!;
  const effect: Effect = {
    timing: { kind: "activated", mode: "flash" },
    steps,
  };
  const source: CardDefinition = {
    ...spiritTemplate,
    cardNo: "TEST-SOURCE",
    effects: [effect],
  };
  const nexus: CardDefinition = {
    ...nexusTemplate,
    cardNo: "TEST-NEXUS",
    effects: [],
  };
  const lookup = (id: string) => [source, nexus].find((d) => d.cardNo === id);
  const opts = {
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  const make = (
    def: CardDefinition,
    id: string,
    owner: string,
    zone: "field" | "deck",
    cores = 0
  ) =>
    createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make(source, "source", "alice", "field", 1),
        make(source, "spirit", "bob", "field", 1),
        make(source, "spirit2", "bob", "field", 1),
        { ...make(nexus, "nexus", "bob", "field"), exhaustState: "exhausted" },
        make(source, "deck1", "alice", "deck"),
        make(source, "deck2", "alice", "deck"),
      ],
    }),
    step: "main",
    window: "none",
    activeContinuousEffects: [
      {
        effectId: "boost",
        modifierTag: "grant_optional_deck_reveal_count_boost",
        targetInstanceId: "alice",
        sourceInstanceId: "source",
        sourceDefinitionId: source.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        metadata: { bonusAmount: 1, sourceFilter: { category: ["spirit"] } },
      },
    ],
  };
  const finishBoost = (paused: GameState, choice: "apply" | "decline") => {
    const action = getLegalActions({
      state: paused,
      actingPlayerId: "alice",
      ...opts,
    }).find(
      (a) =>
        a.can &&
        a.kind === "resolve_pending_deck_reveal_count_boost_choice" &&
        a.choice === choice
    );
    expect(action).toBeDefined();
    return applyLegalAction({ state: paused, action: action!, ...opts }).state;
  };
  return { source, effect, state, opts, finishBoost };
}
function expectFinished(state: GameState) {
  expect(state.pendingDeckRevealCountBoostChoice).toBeNull();
  expect(state.pendingTargetedDisclosureContinuation).toBeNull();
  expect(state.pendingEffectTargetSelection).toBeNull();
  expect(state.pendingStepOptionalChoice).toBeNull();
  expect(state.pendingStepChoice).toBeNull();
  expect(state.pendingLeaveEntities).toHaveLength(0);
  expect(state.pendingEffectCompletions).toHaveLength(0);
}

describe("deck count boost preserves declared targets and child cleanup", () => {
  for (const position of ["before", "after"] as const)
    for (const choice of ["apply", "decline"] as const) {
      it(`keeps grouped targets when boost is ${position} the first group and ${choice}`, () => {
        const f = fixture(
          position === "before"
            ? [mill, destroy, recover]
            : [destroy, mill, recover]
        );
        const paused = executeEffect({
          state: f.state,
          effect: f.effect,
          effectIndex: 0,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          chainId: "grouped-boost",
          promptUnresolvedChoice: true,
          targetInstanceIds: ["spirit", "nexus"],
          targetGroups: groups,
          targetSelectionResolved: true,
          preservePreSelectedTargetRefs: true,
          ...f.opts,
        });
        expect(paused.pendingDeckRevealCountBoostChoice).not.toBeNull();
        const completed = f.finishBoost(paused, choice);
        expect(
          completed.cardInstances.find((c) => c.instanceId === "spirit")?.zone
        ).toBe("trash");
        expect(
          completed.cardInstances.find((c) => c.instanceId === "nexus")
        ).toMatchObject({ zone: "field", exhaustState: "recovered" });
        expect(
          completed.cardInstances.filter(
            (c) =>
              ["deck1", "deck2"].includes(c.instanceId) && c.zone === "trash"
          )
        ).toHaveLength(choice === "apply" ? 2 : 1);
        expect(
          completed.log.filter(
            (l) => l.startsWith("effect:destroy:") && l.includes("nexus")
          )
        ).toHaveLength(0);
        expectFinished(completed);
      });
    }
  for (const choice of ["apply", "decline"] as const) {
    it(`keeps child immunity until boost ${choice} completes without moving it to the nullified parent`, () => {
      const destroyNexus: EffectStep = {
        id: "destroy",
        action: {
          kind: "destroy",
          target: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["nexus"] },
            count: 1,
          },
        },
      };
      const f = fixture([mill, destroyNexus]);
      const cont = (
        chainId: string,
        isNullified: boolean
      ): TargetedDisclosureContinuation => {
        const deferredStack: ActiveStack = {
          stackId: chainId,
          chainId,
          actingPlayerId: "alice",
          actionKind: "field_card_effect",
          cardDefinitionId: f.source.cardNo,
          cardInstanceId: "source",
          fieldEffectSourceKind: "spirit",
          fieldEffectRegistrationIndex: 0,
          fieldEffectIndex: 0,
          targetInstanceIds: ["nexus"],
          targetEffectFilterTags: ["destroy"],
          isNullified,
        };
        return {
          pendingId: chainId,
          chainId,
          sourceDefinitionId: f.source.cardNo,
          sourceInstanceId: "source",
          effectIndex: 0,
          actingPlayerId: "alice",
          resumeStepIndex: 0,
          stepContext: { results: {} },
          targetInstanceIds: ["nexus"],
          targetStepId: "destroy",
          targetZonesByInstanceId: { nexus: "field" },
          remainingStacks: [],
          deferredStackResolution: { deferredStack },
        };
      };
      const outer = cont("outer", true);
      const inner = {
        ...cont("outer:target:response:inner", false),
        previousTargetedDisclosureContinuation: outer,
        resolutionCleanups: [
          {
            kind: "continuous_effects" as const,
            effectIds: ["child-immunity"],
          },
        ],
      };
      const state: GameState = {
        ...f.state,
        pendingTargetedDisclosureContinuation: inner,
        activeContinuousEffects: [
          ...f.state.activeContinuousEffects,
          {
            effectId: "child-immunity",
            sourceInstanceId: "source",
            sourceDefinitionId: f.source.cardNo,
            actingPlayerId: "bob",
            targetInstanceId: "nexus",
            modifierTag: "defense_immune",
            duration: { scope: "current_effect" },
            createdAtTurn: 0,
            createdAtAttackId: null,
            metadata: {
              source: "opponent_effect",
              currentEffectSourceInstanceId: "source",
              currentEffectSourceDefinitionId: f.source.cardNo,
              currentEffectIndex: 0,
              currentEffectTargetStepId: "destroy",
            },
          },
        ],
      };
      const paused = resumeTargetedDisclosureIfReady(state, f.opts);
      expect(paused.pendingDeckRevealCountBoostChoice).not.toBeNull();
      expect(paused.pendingTargetedDisclosureContinuation?.chainId).toBe(
        "outer:target:response:inner"
      );
      expect(
        paused.activeContinuousEffects.some(
          (c) => c.effectId === "child-immunity"
        )
      ).toBe(true);
      expect(
        paused.pendingTargetedDisclosureContinuation?.resolutionCleanups ?? []
      ).toHaveLength(1);
      const completed = f.finishBoost(paused, choice);
      expect(
        completed.cardInstances.find((c) => c.instanceId === "nexus")?.zone
      ).toBe("field");
      expect(
        completed.activeContinuousEffects.some(
          (c) => c.effectId === "child-immunity"
        )
      ).toBe(false);
      expectFinished(completed);
    });
  }
});

describe("child cleanup waits for body input before returning to its parent", () => {
  const inputs: Array<[string, EffectStep]> = [
    [
      "deck pick",
      {
        id: "input",
        action: {
          kind: "deck_reveal",
          revealCount: 1,
          picks: [{ count: 1, mandatory: true }],
          remainder: "trash",
          suppressRevealedEffects: true,
        },
      },
    ],
    [
      "remainder order",
      {
        id: "input",
        action: {
          kind: "deck_reveal",
          revealCount: 1,
          picks: [],
          remainder: "top_or_bottom",
          suppressRevealedEffects: true,
        },
      },
    ],
    [
      "count selection",
      {
        id: "input",
        action: {
          kind: "count_decrease",
          player: "self",
          amount: { min: 0, max: 1 },
        },
      },
    ],
    [
      "zone selection",
      {
        id: "input",
        action: { kind: "discard", player: "self", fromZone: "hand", count: 1 },
      },
    ],
  ];
  for (const [name, inputStep] of inputs) {
    for (const parentNullified of [true, false]) {
      it(`${name}: protects child once, then expires before parent (nullified=${parentNullified})`, () => {
        const f = fixture([
          inputStep,
          {
            id: "destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: 1,
              },
            },
          },
        ]);
        const makeContinuation = (
          chainId: string,
          isNullified: boolean
        ): TargetedDisclosureContinuation => ({
          pendingId: chainId,
          chainId,
          sourceDefinitionId: f.source.cardNo,
          sourceInstanceId: "source",
          effectIndex: 0,
          actingPlayerId: "alice",
          resumeStepIndex: 0,
          stepContext: { results: {} },
          targetInstanceIds: ["nexus"],
          targetStepId: "destroy",
          targetZonesByInstanceId: { nexus: "field" },
          remainingStacks: [],
          deferredStackResolution: {
            deferredStack: {
              stackId: chainId,
              chainId,
              actingPlayerId: "alice",
              actionKind: "field_card_effect",
              cardDefinitionId: f.source.cardNo,
              cardInstanceId: "source",
              fieldEffectSourceKind: "spirit",
              fieldEffectRegistrationIndex: 0,
              fieldEffectIndex: 0,
              targetInstanceIds: ["nexus"],
              targetEffectFilterTags: ["destroy"],
              isNullified,
            },
          },
        });
        // The parent only destroys: its body must not produce another input.
        const originalParent = makeContinuation("outer", parentNullified);
        const { deferredStackResolution, ...parentBody } = originalParent;
        const parent = {
          ...parentBody,
          resumeStepIndex: 1,
          negateIdentitySnapshot: deferredStackResolution!.deferredStack,
        };
        const inner = {
          ...makeContinuation("outer:target:response:inner", false),
          previousTargetedDisclosureContinuation: parent,
          resolutionCleanups: [
            {
              kind: "continuous_effects" as const,
              effectIds: ["child-immunity"],
            },
          ],
        };
        const initial: GameState = {
          ...f.state,
          players: f.state.players.map((p) => ({ ...p, countValue: 2 })),
          cardInstances: f.state.cardInstances.map((c) =>
            name === "zone selection" && c.zone === "deck"
              ? { ...c, zone: "hand" as const }
              : c
          ),
          pendingTargetedDisclosureContinuation: inner,
          activeContinuousEffects: [
            {
              effectId: "child-immunity",
              sourceInstanceId: "source",
              sourceDefinitionId: f.source.cardNo,
              actingPlayerId: "bob",
              targetInstanceId: "nexus",
              modifierTag: "defense_immune",
              duration: { scope: "current_effect" },
              createdAtTurn: 0,
              createdAtAttackId: null,
              metadata: {
                source: "opponent_effect",
                currentEffectSourceInstanceId: "source",
                currentEffectSourceDefinitionId: f.source.cardNo,
                currentEffectIndex: 0,
                currentEffectTargetStepId: "destroy",
              },
            },
          ],
        };
        let state = resumeTargetedDisclosureIfReady(initial, f.opts);
        expect(
          state.activeContinuousEffects.some(
            (c) => c.effectId === "child-immunity"
          )
        ).toBe(true);
        const legal = getLegalActions({
          state,
          actingPlayerId: "alice",
          ...f.opts,
        });
        const action = legal.find(
          (a) =>
            a.can &&
            [
              "resolve_pending_deck_reveal_pick",
              "resolve_pending_deck_reveal_order",
              "resolve_pending_count_decrease",
              "resolve_pending_zone_selection",
            ].includes(a.kind)
        );
        expect(action).toBeDefined();
        const choices = generateActionInputChoices(state, action!, {
          limit: 1,
        });
        expect(choices.values.length).toBeGreaterThan(0);
        state = applyLegalAction({
          state,
          action: action!,
          ...choices.values[0],
          ...f.opts,
        }).state;
        expect(
          state.activeContinuousEffects.some(
            (c) => c.effectId === "child-immunity"
          )
        ).toBe(false);
        expect(
          state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
        ).toBe(parentNullified ? "field" : "trash");
        expect(
          state.log.filter(
            (l) => l.startsWith("effect:destroy:") && l.includes("nexus")
          )
        ).toHaveLength(parentNullified ? 0 : 1);
        expect(state.pendingDeckReveal).toBeNull();
        expect(state.pendingZoneSelection).toBeNull();
        expect(state.pendingCountSelection).toBeNull();
        expect(state.pendingTargetedDisclosureContinuation).toBeNull();
        expectFinished(state);
      });
    }
  }
});

describe("non-group duplicate target ranges include forced targets", () => {
  for (const [required, forcedCount] of [
    [0, 1],
    [1, 2],
    [2, 1],
  ] as const) {
    it(`finishes a legal range ${required}..2 with ${forcedCount} forced target(s)`, () => {
      const f = fixture([
        {
          id: "suppress",
          action: {
            kind: "suppress_effect",
            scope: "entire",
            duration: { scope: "turn" },
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: { min: required, max: 2 },
            },
          },
        },
      ]);
      f.effect.allowDuplicateTargets = true;
      const ids = forcedCount === 2 ? ["spirit", "spirit2"] : ["spirit"];
      const deferredStack: ActiveStack = {
        stackId: "stack",
        chainId: "forced-range",
        actingPlayerId: "alice",
        actionKind: "field_card_effect",
        cardDefinitionId: f.source.cardNo,
        cardInstanceId: "source",
        fieldEffectSourceKind: "spirit",
        fieldEffectRegistrationIndex: 0,
        fieldEffectIndex: 0,
        targetInstanceIds: [],
        targetEffectFilterTags: ["suppress_effects"],
        targetMode: "manual",
        requiredTargetCount: required,
        maxTargetCount: 2,
        allowDuplicateTargets: true,
        candidateTargetZones: ["field"],
      };
      const state: GameState = {
        ...f.state,
        activeContinuousEffects: ids.map((id) => ({
          effectId: `force-${id}`,
          modifierTag: "forced_target_inclusion",
          targetInstanceId: id,
          sourceInstanceId: id,
          sourceDefinitionId: f.source.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
        })),
        pendingEffectTargetSelection: {
          pendingId: "pending",
          actingPlayerId: "alice",
          sourceInstanceId: "source",
          sourceDefinitionId: f.source.cardNo,
          requiredTargetCount: required,
          maxTargetCount: 2,
          allowDuplicateTargets: true,
          candidateInstanceIds: ids,
          candidateTargetZones: ["field"],
          targetEffectFilterTags: ["suppress_effects"],
          remainingStacks: [],
          deferredStack,
        },
      };
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...f.opts,
      }).find((a) => a.can && a.kind === "resolve_pending_effect_target");
      expect(action).toBeDefined();
      const inputs = generateActionInputChoices(state, action!, f.opts, 1);
      expect(inputs.values).toHaveLength(1);
      for (const id of ids)
        expect(inputs.values[0]!.targetInstanceIds).toContain(id);
      if (required === 2 && forcedCount === 1)
        expect(inputs.values[0]!.targetInstanceIds).toEqual([
          "spirit",
          "spirit",
        ]);
      const completed = applyLegalAction({
        state,
        action: action!,
        ...inputs.values[0],
        ...f.opts,
      }).state;
      for (const id of ids)
        expect(
          completed.activeContinuousEffects.some(
            (c) =>
              c.modifierTag === "effect_suppression" &&
              c.targetInstanceId === id
          )
        ).toBe(true);
      expectFinished(completed);
    });
  }
});
