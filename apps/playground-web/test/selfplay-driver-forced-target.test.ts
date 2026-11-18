import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type LegalAction,
} from "@orica/rules-core";
import { executeEffect } from "../../../packages/rules-core/src/effect/effect-interpreter";
import {
  applyChosenAction,
  buildEngine,
  mulberry32,
  playGame,
  playGameAsync,
  resolveActionInputs,
} from "./selfplay-driver";

type TargetAction = Extract<
  LegalAction,
  { kind: "resolve_pending_effect_target" }
>;
function targetAction(overrides: Partial<TargetAction> = {}): TargetAction {
  return {
    kind: "resolve_pending_effect_target",
    actionId: "forced-target-input",
    can: true,
    reason: "pending_effect_target_selection",
    actingPlayerId: "bob",
    pendingId: "forced-target-input",
    sourceInstanceId: "source",
    sourceDefinitionId: "BSAZ01-X02",
    targetMode: "manual",
    requiredTargetCount: 1,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: ["other", "host", "last"],
    ...overrides,
  };
}

describe("selfplay forced target input", () => {
  it.each([false, true])(
    "includes a late mandatory target through real apply (groups=%s)",
    (grouped) => {
      const engine = buildEngine();
      const host = engine.getCardDefinitionById("BSFT01-TR02(B)")!;
      const source = engine.getCardDefinitionById("BSAZ01-X02")!;
      const other = engine.getCardDefinitionById("BSSA01-C01")!;
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(other, {
            instanceId: "other",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(host, {
            instanceId: "host",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(source, {
            instanceId: "source",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      });
      const effect = host.effects!.find(
        (entry) => entry.steps[0]?.action.kind === "forced_target_inclusion"
      )!;
      state = executeEffect({
        chainId: "forced-target-input-registration",
        state,
        effect,
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        getCardDefinitionById: engine.getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      });
      // Nullify the continuation to isolate input legality and pending closure.
      // The fixed integration seed below also exercises the real battle effect.
      state = {
        ...state,
        pendingEffectTargetSelection: {
          pendingId: "forced-target-input",
          actingPlayerId: "bob",
          sourceInstanceId: "source",
          sourceDefinitionId: source.cardNo,
          deferredStack: {
            stackId: "forced-target-input-stack",
            actionKind: "field_card_effect",
            chainId: "forced-target-input-chain",
            actingPlayerId: "bob",
            cardInstanceId: "source",
            cardDefinitionId: source.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            isNullified: true,
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
          remainingStacks: [],
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateInstanceIds: ["other", "host"],
          targetEffectFilterTags: [],
          ...(grouped
            ? {
                targetGroups: [
                  {
                    candidateTargetInstanceIds: ["other", "host"],
                    requiredTargetCount: 1,
                  },
                ],
              }
            : {}),
        },
      };
      const action = getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: engine.getCardDefinitionById,
        ...engine.lookups,
      }).find(
        (candidate): candidate is TargetAction =>
          candidate.kind === "resolve_pending_effect_target"
      )!;
      expect(action.mandatoryTargetInstanceIds).toEqual(["host"]);
      expect(() =>
        applyLegalAction({
          state,
          action,
          targetInstanceIds: ["other"],
          getCardDefinitionById: engine.getCardDefinitionById,
          ...engine.lookups,
        })
      ).toThrow(/forced target inclusion/);
      expect(
        resolveActionInputs(state, action, engine.getCardDefinitionById)
          .targetInstanceIds
      ).toEqual(["host"]);
      const next = applyChosenAction(state, action, engine);
      expect(next.pendingEffectTargetSelection).toBeNull();
      expect(next.log).toContain(
        "effect:target-selection:resolved:forced-target-input-chain:host"
      );
      expect(
        next.cardInstances.find((card) => card.instanceId === "other")?.zone
      ).toBe("field");
    }
  );

  // resolveActionInputs delegates targets to generateActionInputChoices, so
  // ordinary (non-mandatory) order is the generator's, not the legacy slice order.
  it.each([
    {
      name: "ordinary selection is the shared generator's first legal value",
      action: targetAction(),
      expected: ["last"],
    },
    {
      name: "already included mandatory target",
      action: targetAction({ mandatoryTargetInstanceIds: ["other"] }),
      expected: ["other"],
    },
    {
      name: "duplicate selection is the shared generator's first legal value",
      action: targetAction({
        requiredTargetCount: 2,
        allowDuplicateTargets: true,
      }),
      expected: ["other", "other"],
    },
    {
      name: "legacy group assignment order",
      action: targetAction({
        requiredTargetCount: 2,
        targetGroups: [
          {
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["other", "host"],
          },
          { requiredTargetCount: 1, candidateTargetInstanceIds: ["other"] },
        ],
      }),
      expected: ["other", "host"],
    },
  ])("preserves successful selection order: $name", ({ action, expected }) => {
    expect(
      resolveActionInputs(createEmptyGameState(), action).targetInstanceIds
    ).toEqual(expected);
  });

  it("fills a mandatory target in an optional group", () => {
    const action = targetAction({
      requiredTargetCount: 0,
      maxTargetCount: 1,
      mandatoryTargetInstanceIds: ["host"],
      targetGroups: [
        {
          requiredTargetCount: 0,
          maxTargetCount: 1,
          candidateTargetInstanceIds: ["other", "host"],
        },
      ],
    });
    expect(
      resolveActionInputs(createEmptyGameState(), action).targetInstanceIds
    ).toEqual(["host"]);
  });

  it("uses the legal larger duplicate selection when the minimum cannot include every mandatory target", () => {
    const action = targetAction({
      requiredTargetCount: 1,
      maxTargetCount: 2,
      allowDuplicateTargets: true,
      mandatoryTargetInstanceIds: ["other", "host"],
    });
    expect(
      resolveActionInputs(createEmptyGameState(), action).targetInstanceIds
    ).toEqual(["other", "host"]);
  });

  it.each([undefined, ["host"]])(
    "honors mandatory targets in the step continuation and otherwise follows the shared generator (%s)",
    (mandatoryTargetInstanceIds) => {
      const action: Extract<
        LegalAction,
        { kind: "resolve_pending_step_optional_target_selection" }
      > = {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: "step-target-input",
        can: true,
        reason: "pending_step_optional_target_selection",
        actingPlayerId: "bob",
        pendingId: "step-target-input",
        sourceInstanceId: "source",
        sourceDefinitionId: "BSAZ01-X02",
        effectIndex: 0,
        stepIndex: 0,
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateTargetInstanceIds: ["other", "host"],
        ...(mandatoryTargetInstanceIds ? { mandatoryTargetInstanceIds } : {}),
      };
      expect(
        resolveActionInputs(createEmptyGameState(), action).targetInstanceIds
      ).toEqual(["host"]);
    }
  );

  it("seed 1558718747 reaches the same natural result in both drivers", async () => {
    const engine = buildEngine();
    const result = await playGameAsync({
      engine,
      rng: mulberry32(1_558_718_747),
    });
    expect(result.outcome, result.lastError).toBe("natural");
    expect(playGame({ engine, rng: mulberry32(1_558_718_747) })).toEqual(
      result
    );
  });
});
