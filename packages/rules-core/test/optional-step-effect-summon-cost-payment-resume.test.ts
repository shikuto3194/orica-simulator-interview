import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";

const ALICE = "alice";
const BOB = "bob";

const SELF_SUMMONER: CardDefinition = {
  cardNo: "TEST-OPTIONAL-EFFECT-SUMMON-COST-PAYMENT-RESUME",
  name: "任意自己召喚テスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          executionMode: "optional",
          action: {
            kind: "summon",
            target: { kind: "self" },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    },
  ],
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === SELF_SUMMONER.cardNo ? SELF_SUMMONER : undefined;

describe("optional summon step: effect summon cost payment continuation", () => {
  it("配置時コア禁止のカードは支払い後に配置選択を作らず後続本文を完了する", () => {
    const definition: CardDefinition = {
      ...SELF_SUMMONER,
      keywordTags: ["enter_field_core_placement_forbidden"],
      levelDefs: [{ level: 1, requiredCores: 0 }],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "summon",
                target: { kind: "self" },
                costModifier: { fixedPayment: 1 },
              },
            },
            { action: { kind: "count_increase", player: "self", amount: 2 } },
          ],
        },
      ],
    };
    const lookups = {
      getCardDefinitionById: (id: string) =>
        id === definition.cardNo ? definition : undefined,
      getRegisteredTriggeredEffectActions: () => [],
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "source",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    });
    const pending = executeEffect({
      state,
      effect: definition.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: ALICE,
      activationZone: "hand",
      chainId: "placement:parent:child",
      ...lookups,
    });
    expect(
      pending.pendingEffectSummonCostPayment,
      JSON.stringify(pending.log)
    ).not.toBeNull();
    const action = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_summon_cost_payment")!;
    const resolved = applyLegalAction({
      state: pending,
      action,
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
      ...lookups,
    }).state;
    expect(resolved.pendingMultiPlacement).toBeNull();
    expect(resolved.pendingEffectSummonCostPayment).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "source")?.zone
    ).toBe("field");
    expect(resolved.players[0]!.countValue).toBe(2);
  });
  it("execute 選択後の支払いでは同じ optional step を再提示せず summon を続行する", () => {
    const source = createCardInstance(SELF_SUMMONER, {
      instanceId: "self-summoner",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const optionalPending = executeEffect({
      chainId: "test:optional-step-effect-summon-cost-payment-resume:57",
      state,
      effect: SELF_SUMMONER.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(optionalPending.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: source.instanceId,
      stepIndex: 0,
    });

    const executeChoice = getLegalActions({
      state: optionalPending,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    expect(executeChoice).toBeDefined();
    if (!executeChoice) throw new Error("missing optional execute action");

    const paymentPending = applyLegalAction({
      state: optionalPending,
      action: executeChoice,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(paymentPending.pendingStepOptionalChoice).toBeNull();
    expect(paymentPending.pendingEffectSummonCostPayment).toMatchObject({
      requiredCost: 1,
      continuation: { optionalExecuteResumeStepIndex: 0 },
    });

    const paymentAction = getLegalActions({
      state: paymentPending,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (action) => action.kind === "resolve_pending_effect_summon_cost_payment"
    );
    expect(paymentAction).toBeDefined();
    if (!paymentAction) throw new Error("missing summon payment action");

    const resumed = applyLegalAction({
      state: paymentPending,
      action: paymentAction,
      actingPlayerId: ALICE,
      summonPaymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(resumed.pendingEffectSummonCostPayment).toBeNull();
    expect(resumed.pendingStepOptionalChoice).toBeNull();
    expect(
      resumed.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("field");
  });
});
