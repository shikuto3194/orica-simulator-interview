import { expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { ActiveStack, CardDefinition, GameState } from "../src";
import { executeRedirectTarget } from "../src/effect/native-ce-registration-handlers";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";

const base: CardDefinition = {
  cardNo: "REDIRECT-ZONE-A",
  name: "A",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const replacement = { ...base, cardNo: "REDIRECT-ZONE-B", name: "B" };
const gate = { ...base, cardNo: "REDIRECT-ZONE-GATE", name: "Gate" };
const magic: CardDefinition = {
  ...base,
  cardNo: "REDIRECT-ZONE-MAGIC",
  name: "Redirect zone regression",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          id: "target",
          action: {
            kind: "send_to_deck",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};
const definitions = [base, replacement, gate, magic];
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((definition) => definition.cardNo === id),
  getRegisteredMagicActions: buildMagicLookup(definitions),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredHandCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};

it.each([1, 2])(
  "redirected magic preserves its selected zone through another core gate (%s cores)",
  (cores) => {
    const deferredStack: ActiveStack = {
      stackId: "stack",
      actionKind: "magic",
      chainId: "chain",
      actingPlayerId: "alice",
      cardInstanceId: "magic",
      cardDefinitionId: magic.cardNo,
      targetInstanceIds: ["a"],
      targetStepId: "target",
      targetSelectionResolved: true,
      targetZonesByInstanceId: { a: "field" },
      candidateTargetZones: ["field"],
      targetEffectFilterTags: ["general"],
      chosenTiming: "flash",
      magicEffectIndex: 0,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(base, {
            instanceId: "a",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(replacement, {
            instanceId: "b",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: cores,
          }),
          createCardInstance(gate, {
            instanceId: "gate",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(magic, {
            instanceId: "magic",
            ownerPlayerId: "alice",
            zone: "in_use",
          }),
        ],
      }),
      pendingTargetedDisclosureContinuation: {
        chainId: "test:magic-redirect-target-zone-continuation:119",
        pendingId: "disclosure",
        sourceDefinitionId: magic.cardNo,
        effectIndex: 0,
        sourceInstanceId: "magic",
        actingPlayerId: "alice",
        resumeStepIndex: 0,
        stepContext: { results: {} },
        targetInstanceIds: ["a"],
        targetCandidateInstanceIds: ["a", "b"],
        targetZonesByInstanceId: { a: "field" },
        targetStepId: "target",
        remainingStacks: [],
        deferredStackResolution: { deferredStack },
      },
    };
    state = executeRedirectTarget(
      {
        kind: "redirect_target",
        from: {
          kind: "filter",
          player: "self",
          filter: { cardName: { exact: "A" } },
          count: 1,
        },
        to: {
          kind: "filter",
          player: "self",
          filter: { cardName: { exact: "B" } },
          count: 1,
        },
      },
      state,
      "alice",
      "magic",
      lookups.getCardDefinitionById,
      { results: {} }
    );
    // A response has introduced a gate after the original target was selected.
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "gate",
          sourceInstanceId: "gate",
          sourceDefinitionId: gate.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: state.turnNumber,
          createdAtAttackId: null,
          modifierTag: "gate_flash_stack_core",
          targetInstanceId: "alice",
        },
      ],
    };
    state = resumeTargetedDisclosureIfReady(state, lookups);
    expect(
      state.pendingPayToActCoreGate?.deferredStack.targetInstanceIds
    ).toEqual(["b"]);
    expect(
      state.pendingPayToActCoreGate?.deferredStack.targetZonesByInstanceId
    ).toEqual({ b: "field" });
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((entry) => entry.kind === "resolve_pay_to_act_core_gate");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state,
      action: action!,
      ...lookups,
      payToActCoreSourceContainerId: "b",
    }).state;
    expect(
      after.cardInstances.find((card) => card.instanceId === "b")?.zone
    ).toBe(cores === 1 ? "trash" : "deck");
    expect(
      after.cardInstances.find((card) => card.instanceId === "a")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((card) => card.instanceId === "magic")?.zone
    ).toBe("trash");
    expect(after.log.includes("magic:effect-fizzled:chain:b")).toBe(
      cores === 1
    );
    expect(
      after.log.some((entry) => entry.startsWith("effect:count_increase:"))
    ).toBe(cores === 2);
    expect(after.pendingPayToActCoreGate).toBeNull();
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
  }
);
