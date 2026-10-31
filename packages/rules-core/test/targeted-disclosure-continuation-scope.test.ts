import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type ActiveStack,
  type TargetedDisclosureContinuation,
} from "../src";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";
import { flushReadyEffectCompletions } from "../src/effect/effect-completion";
import type { Effect, EffectStep } from "../src/dsl-types";

function fixture(steps: EffectStep[]) {
  const spiritTemplate = ALL_CARDS.find((c) => c.cardNo === "BSTH02-C01")!;
  const nexusTemplate = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C13")!;
  const effect: Effect = { timing: { kind: "flash" }, steps };
  const source: CardDefinition = {
    ...spiritTemplate,
    cardNo: "TEST-SOURCE",
    effects: [effect],
  };
  const spirit: CardDefinition = {
    ...spiritTemplate,
    cardNo: "TEST-SPIRIT",
    effects: [],
  };
  const nexus: CardDefinition = {
    ...nexusTemplate,
    cardNo: "TEST-NEXUS",
    effects: [],
  };
  const defs = [source, spirit, nexus];
  const lookup = (id: string) => defs.find((c) => c.cardNo === id);
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(spirit, {
          instanceId: "spirit",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(nexus, {
          instanceId: "nexus",
          ownerPlayerId: "bob",
          zone: "field",
          exhaustState: "exhausted",
        }),
      ],
    }),
    step: "main",
    window: "none",
  };
  const applyPending = () => {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (a) =>
        a.can &&
        ((a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute") ||
          (a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0))
    );
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).state;
  };
  return {
    source,
    effect,
    lookup,
    get state() {
      return state;
    },
    set state(s: GameState) {
      state = s;
    },
    applyPending,
  };
}
const count: EffectStep = {
  id: "count",
  executionMode: "optional",
  action: { kind: "count_increase", player: "self", amount: 1 },
};
const destroySpirit: EffectStep = {
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
const recoverNexus: EffectStep = {
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

describe("disclosure continuation keeps each declaration and target group separate", () => {
  for (const position of ["before", "after"] as const)
    for (const choice of [false, true]) {
      it(`${choice ? "choice" : "optional"} ${position} a grouped action preserves the other group`, () => {
        const pause: EffectStep = choice
          ? {
              ...count,
              executionMode: "mandatory",
              choice: [
                {
                  action: { kind: "count_increase", player: "self", amount: 2 },
                },
              ],
            }
          : count;
        const f = fixture(
          position === "before"
            ? [pause, destroySpirit, recoverNexus]
            : [destroySpirit, pause, recoverNexus]
        );
        f.state = executeEffect({
          state: f.state,
          effect: f.effect,
          effectIndex: 0,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          getCardDefinitionById: f.lookup,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredFieldCardEffectActions: () => [],
          chainId: "grouped",
          promptUnresolvedChoice: true,
          targetInstanceIds: ["spirit", "nexus"],
          targetGroups: groups,
          targetSelectionResolved: true,
          preservePreSelectedTargetRefs: true,
        });
        f.applyPending();
        expect(
          f.state.cardInstances.find((c) => c.instanceId === "spirit")?.zone
        ).toBe("trash");
        expect(
          f.state.cardInstances.find((c) => c.instanceId === "nexus")
        ).toMatchObject({ zone: "field", exhaustState: "recovered" });
        expect(f.state.players[0]!.countValue).toBe(1);
        expect(f.state.pendingStepOptionalChoice).toBeNull();
        expect(f.state.pendingStepChoice).toBeNull();
        expect(f.state.pendingTargetedDisclosureContinuation).toBeNull();
        expect(f.state.pendingLeaveEntities).toHaveLength(0);
        expect(
          f.state.log.filter(
            (l) => l.startsWith("effect:destroy:") && l.includes("nexus")
          )
        ).toHaveLength(0);
      });
    }
  for (const pause of [false, true]) {
    it(`child immunity ends at its own completion (child optional=${pause})`, () => {
      const destroy: EffectStep = {
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
      const f = fixture(pause ? [count, destroy] : [destroy]);
      const stack = (chainId: string, isNullified: boolean): ActiveStack => ({
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
      });
      const continuation = (
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
        remainingStacks: [],
        deferredStackResolution: { deferredStack: stack(chainId, isNullified) },
      });
      const outer = continuation("outer", false);
      const inner = {
        ...continuation("outer:target:response:inner", !pause),
        previousTargetedDisclosureContinuation: outer,
        resolutionCleanups: [
          {
            kind: "continuous_effects" as const,
            effectIds: ["inner-only-immunity"],
          },
        ],
      };
      f.state = {
        ...f.state,
        pendingTargetedDisclosureContinuation: inner,
        activeContinuousEffects: [
          {
            effectId: "inner-only-immunity",
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
      const resume = () => {
        f.state = resumeTargetedDisclosureIfReady(f.state, {
          getCardDefinitionById: f.lookup,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredFieldCardEffectActions: () => [],
        });
      };
      resume();
      if (pause) {
        expect(
          f.state.activeContinuousEffects.some(
            (c) => c.effectId === "inner-only-immunity"
          )
        ).toBe(true);
        expect(f.state.pendingStepOptionalChoice).not.toBeNull();
        f.applyPending();
        expect(
          f.state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
        ).toBe("field");
      }
      expect(
        f.state.activeContinuousEffects.some(
          (c) => c.effectId === "inner-only-immunity"
        )
      ).toBe(false);
      expect(
        f.state.pendingTargetedDisclosureContinuation?.resolutionCleanups ?? []
      ).toHaveLength(0);
      resume();
      if (pause && f.state.pendingStepOptionalChoice) f.applyPending();
      expect(
        f.state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
      ).toBe("trash");
      expect(f.state.pendingTargetedDisclosureContinuation).toBeNull();
      expect(f.state.pendingStepOptionalChoice).toBeNull();
      expect(f.state.pendingLeaveEntities).toHaveLength(0);
      // このfixtureは低位resumeを直接呼ぶ。通常legal-action末尾と同じ完了flushを行う。
      for (let i = 0; f.state.pendingEffectCompletions.length && i < 4; i++)
        f.state = flushReadyEffectCompletions(f.state, {
          getCardDefinitionById: f.lookup,
          getRegisteredTriggeredEffectActions: () => [],
        });
      expect(f.state.pendingEffectCompletions).toHaveLength(0);
    });
  }
});
