/**
 * BSTH003 (東方夢時空) カードの effects 検証テスト。
 * 導魔/秘封/空牙/動器/導界者/転召 中心。導託/転者/導域/合体中効果は stub。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
  PendingTriggeredEffect,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe.each([
  ["BSTH003-C01", "yellow", ["yellow", "guide"]],
  ["BSTH003-C02", "red", ["red", "guide"]],
])("%s 軽減 %s 化 + deck_reveal", (cardNo, redColor, symAdd) => {
  const card = cardNoMap.get(cardNo)!;
  it("treat_as(reduction) + 召喚時 deck_reveal(導界者/spirit/brave) + メイン dual symbol_add", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.asColor).toBe(redColor);
      expect(t.aspects).toEqual(["reduction_symbol"]);
    }
    const reveal = card.effects![1]!.steps[0]!.action;
    if (reveal.kind === "deck_reveal") expect(reveal.picks.length).toBe(3);
    const sym = card.effects![2]!.steps[0]!.action;
    if (sym.kind === "symbol_add") expect(sym.symbol).toEqual(symAdd);
  });
});

describe.each([
  [
    "BSTH003-C31",
    {
      categories: ["spirit"],
      tribes: ["導魔"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["導魔", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
      ],
    },
  ],
  [
    "BSTH003-C32",
    {
      categories: ["spirit"],
      tribes: ["導魔"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["導魔", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
      ],
    },
  ],
  [
    "BSTH003-M02",
    {
      categories: ["spirit"],
      tribes: ["導魔", "空牙", "秘封"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["導魔", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
        {
          categories: ["nexus"],
          tribes: ["秘封", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
      ],
    },
  ],
])("%s ブレイヴ braveCondition", (cardNo, expected) => {
  const card = cardNoMap.get(cardNo)!;
  it("braveCondition を持つ", () => {
    expect(card.braveCondition).toEqual(expected);
  });
});

describe("BSTH003-C32 braveLimitExemption", () => {
  const card = cardNoMap.get("BSTH003-C32")!;
  it("導魔スピリット/導魔かつ導界者ネクサスの合体可能体数に数えない", () => {
    expect(card.braveLimitExemption).toEqual({
      hostCondition: {
        categories: ["spirit"],
        tribes: ["導魔"],
        alternatives: [
          {
            categories: ["nexus"],
            tribes: ["導魔", "導界者"],
            tribesLogic: "and",
            targetsGrandwalker: "only",
            grandwalkerKind: "guided",
          },
        ],
      },
    });
  });
});

describe("BSTH003-C32 手札からの防御合体（対象化誘発+直接合体+無効/耐性選択+離脱耐性）", () => {
  const card = cardNoMap.get("BSTH003-C32")!;

  it("構造: game_event:targeted(filterOr 導魔スピリット/導魔&導界者ネクサス) + brave_combine_effect(trigger_related_instance) + 無効化/受けず choice + effect_resistance(leave_field, turn)", () => {
    const effect = card.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "targeted",
      cause: ["opponent_effect"],
    });
    if (effect.timing.kind === "game_event") {
      expect(effect.timing.triggerFilter).toEqual({
        filterOr: [
          { category: ["spirit"], tribes: ["導魔"], minCost: 5 },
          {
            category: ["nexus"],
            tribes: ["導魔", "導界者"],
            tribesLogic: "and",
            targetsGrandwalker: "only",
            grandwalkerKind: "guided",
          },
        ],
      });
    }
    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.executionMode).toBe("optional");

    const combineStep = effect.steps[0]!;
    expect(combineStep.id).toBe("mimi-defensive-combine");
    expect(combineStep.action).toEqual({
      kind: "brave_combine_effect",
      asSummon: true,
      target: { kind: "trigger_related_instance" },
    });

    expect(effect.steps[1]!.action).toEqual({
      kind: "negate",
      negateTarget: "effect",
      targetController: "opponent",
    });
    expect(effect.steps[1]!.choice?.[0]?.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "trigger_related_instance" },
      duration: { scope: "current_effect" },
    });
    expect(effect.steps[2]!.action).toEqual({
      kind: "effect_resistance",
      target: { kind: "trigger_related_instance" },
      resistsOutcome: "leave_field",
      source: "opponent",
      duration: { scope: "turn" },
    });
  });

  it("[board] 受けず選択 (choiceIndex 1): 手札のミミちゃんが対象の導魔スピリットへ直接合体し、相手の破壊効果を免疫で防ぎつつ離脱耐性CEを登録する", () => {
    const guideSpiritDef: CardDefinition = {
      cardNo: "TEST-BSTH003-C32-DOMA-SPIRIT",
      name: "テスト導魔スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 5,
      reductionSymbols: ["blue"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["blue"],
      tribe: "導魔",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSTH003-C32-DESTROY-MAGIC",
      name: "TEST destroy magic",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const mimiHand = createCardInstance(card, {
      instanceId: "mimi-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const guideSpirit = createCardInstance(guideSpiritDef, {
      instanceId: "doma-spirit-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(destroyDef, {
      instanceId: "destroy-magic-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
    });
    const definitions = [card, guideSpiritDef, destroyDef];
    const localMap = new Map(definitions.map((d) => [d.cardNo, d]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getCardDefinitionById(id);
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const noBurstLookup = () => [];
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 4 }],
      }),
      activePlayerId: "bob",
      step: "main",
      cardInstances: [mimiHand, guideSpirit, magic],
    };

    const disclosure = executeEffect({
      chainId: "test:bsth003-cards:281",
      state,
      effect: destroyDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      targetInstanceIds: [guideSpirit.instanceId],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });
    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: destroyDef.cardNo,
      sourceInstanceId: magic.instanceId,
      targetInstanceIds: [guideSpirit.instanceId],
    });
    expect(disclosure.pendingPrivateDeclarations).toHaveLength(1);

    const declarePrivate = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: disclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;

    const resolveMimi = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === mimiHand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(1)
    );
    expect(resolveMimi).toBeDefined();
    const afterMimiResolved = applyLegalAction({
      state: afterPrivateDeclared,
      action: resolveMimi!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;

    const passStack = getLegalActions({
      state: afterMimiResolved,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterMimiResolved,
      action: passStack!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;
    expect(afterStackPassed.pendingStepChoice).not.toBeNull();
    const chooseImmunity = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(chooseImmunity).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterStackPassed,
      action: chooseImmunity!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;
    const resolvePlacement = getLegalActions({
      state: afterChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterChoice,
      action: resolvePlacement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;

    expect(afterResolved.pendingTargetedDisclosureContinuation).toBeNull();
    const spiritAfter = afterResolved.cardInstances.find(
      (c) => c.instanceId === guideSpirit.instanceId
    )!;
    expect(spiritAfter.zone).toBe("field");
    expect(spiritAfter.pendingLeaveKind).toBeNull();
    expect(spiritAfter.attachedChildrenIds).toContain(mimiHand.instanceId);
    const mimiAfter = afterResolved.cardInstances.find(
      (c) => c.instanceId === mimiHand.instanceId
    )!;
    expect(mimiAfter.zone).toBe("field");
    expect(mimiAfter.attachedToInstanceId).toBe(guideSpirit.instanceId);
    expect(mimiAfter.normalCoreCount).toBe(0);
    expect(
      afterResolved.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(4);
    expect(afterResolved.log).not.toContain(
      `effect:destroy:bob:${guideSpirit.instanceId}`
    );
    expect(
      afterResolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "cannot_leave_field" &&
          ce.targetInstanceId === guideSpirit.instanceId
      )
    ).toBe(true);
  });

  it("[board] 無効にする選択 (choiceIndex 0, 本番同等の magic stack 経路): 手札のミミちゃんが合体しつつ、相手の破壊マジックそのものを negate で無効化する", () => {
    // adversarial verifier round1 指摘: executeEffect 直接呼び出し(targetStepId 明示)は
    // handWrittenResolution 継続を生成し、negate probing (applyTimingProbedStackNegateRequests)
    // が resumeHandWrittenTargetedDisclosure 側に配線されていないため通らない
    // (stack-resolution-core.ts の deferredStackResolution 分岐のみ negate 対応、
    // BSLH01-T14 と同じ経路)。ここでは pendingEffectTargetSelection→
    // resolve_pending_effect_target 経由の本番同等 magic stack 経路で構築し、
    // negate が実際に相手の破壊マジックを無効化することを検証する。
    const guideSpiritDef: CardDefinition = {
      cardNo: "TEST-BSTH003-C32-DOMA-SPIRIT-NEGATE",
      name: "テスト導魔スピリット2",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 5,
      reductionSymbols: ["blue"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["blue"],
      tribe: "導魔",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSTH003-C32-DESTROY-MAGIC-NEGATE",
      name: "TEST destroy magic (negate branch)",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const mimiHand = createCardInstance(card, {
      instanceId: "mimi-hand-negate",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const guideSpirit = createCardInstance(guideSpiritDef, {
      instanceId: "doma-spirit-negate-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(destroyDef, {
      instanceId: "destroy-magic-negate-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
    });
    const definitions = [card, guideSpiritDef, destroyDef];
    const localMap = new Map(definitions.map((d) => [d.cardNo, d]));
    const lookup = (id: string): CardDefinition | undefined =>
      localMap.get(id) ?? getCardDefinitionById(id);
    const triggeredLookup = buildTriggeredEffectLookup(definitions);
    const noBurstLookup = () => [];
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [mimiHand, guideSpirit, magic],
      pendingEffectTargetSelection: {
        pendingId: "effect-target:bsth003-c32-negate",
        actingPlayerId: "bob",
        sourceInstanceId: magic.instanceId,
        sourceDefinitionId: destroyDef.cardNo,
        deferredStack: {
          stackId: "stack:bsth003-c32-negate",
          actionKind: "magic",
          chainId: "chain:bsth003-c32-negate",
          actingPlayerId: "bob",
          cardInstanceId: magic.instanceId,
          cardDefinitionId: destroyDef.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          magicEffectIndex: 0,
          reducedCost: 0,
          totalReduction: 0,
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
        remainingStacks: [],
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: [guideSpirit.instanceId],
        targetEffectFilterTags: [],
      },
    };

    const chooseSpirit = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(chooseSpirit).toBeDefined();
    const afterDisclosure = applyLegalAction({
      state,
      action: chooseSpirit!,
      targetInstanceIds: [guideSpirit.instanceId],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;
    expect(afterDisclosure.pendingTargetedDisclosureContinuation).toMatchObject(
      { targetInstanceIds: [guideSpirit.instanceId] }
    );
    expect(afterDisclosure.pendingPrivateDeclarations).toHaveLength(1);

    const declarePrivate = getLegalActions({
      state: afterDisclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find((action) => action.kind === "declare_private_triggered_effect");
    expect(declarePrivate).toBeDefined();
    const afterPrivateDeclared = applyLegalAction({
      state: afterDisclosure,
      action: declarePrivate!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;

    const resolveMimi = getLegalActions({
      state: afterPrivateDeclared,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === mimiHand.instanceId &&
        action.choiceIndex === undefined &&
        (action.deferredChoiceIndexes ?? []).includes(0)
    );
    expect(resolveMimi).toBeDefined();
    const afterMimiResolved = applyLegalAction({
      state: afterPrivateDeclared,
      action: resolveMimi!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;

    const passStack = getLegalActions({
      state: afterMimiResolved,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStackPassed = applyLegalAction({
      state: afterMimiResolved,
      action: passStack!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;
    expect(afterStackPassed.pendingStepChoice).not.toBeNull();
    const chooseNegate = getLegalActions({
      state: afterStackPassed,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 0
    );
    expect(chooseNegate).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterStackPassed,
      action: chooseNegate!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;
    const resolvePlacement = getLegalActions({
      state: afterChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      getRegisteredFieldCardEffectActions: noBurstLookup,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const afterResolved = applyLegalAction({
      state: afterChoice,
      action: resolvePlacement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    }).state;

    expect(afterResolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterResolved.log.some((entry) =>
        entry.startsWith("effect:negate:pending-stack:effect:")
      )
    ).toBe(true);
    const spiritAfter = afterResolved.cardInstances.find(
      (c) => c.instanceId === guideSpirit.instanceId
    )!;
    expect(spiritAfter.zone).toBe("field");
    expect(spiritAfter.pendingLeaveKind).toBeNull();
    expect(spiritAfter.attachedChildrenIds).toContain(mimiHand.instanceId);
    const mimiAfter = afterResolved.cardInstances.find(
      (c) => c.instanceId === mimiHand.instanceId
    )!;
    expect(mimiAfter.zone).toBe("field");
    expect(mimiAfter.attachedToInstanceId).toBe(guideSpirit.instanceId);
    expect(afterResolved.log).not.toContain(
      `effect:destroy:bob:${guideSpirit.instanceId}`
    );
  });
});

describe("BSTH003-C33 Strawberry Crisis!! (magic)", () => {
  const card = cardNoMap.get("BSTH003-C33")!;
  it("系統付与 + フラッシュ draw2 + スタック「1コスト支払うことで」destroy(blocking)", () => {
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("draw");
    // stub解消: pay_cost(1) → conditional_cost destroy。
    const stackEffect = card.effects![2]!;
    expect(stackEffect.stub).toBeUndefined();
    expect(stackEffect.steps[0]!.action.kind).toBe("pay_cost");
    const dStep = stackEffect.steps[1]!;
    expect(dStep.connector).toBe("conditional_cost");
    if (
      dStep.action.kind === "destroy" &&
      typeof dStep.action.target === "object" &&
      "filter" in dStep.action.target
    ) {
      expect(dStep.action.target.filter.battleState).toBe("blocking");
    }
  });
});

/**
 * 「デッキの上か下から N 枚ドロー」の位置選択プリミティブ。
 * 専用 pending を新設せず、汎用 choice ステップ (default=上 / choice[0]=下) で表現する。
 * BSTH003-C33(フラッシュ) / M01(召喚時・複数ステップ) / R02(フラッシュ・ことでコスト) で共有。
 */
describe("「上か下から」ドロー位置選択 (choice プリミティブ)", () => {
  /** デッキ順 [top, mid, bottom] で 3 枚積む共通セットアップ */
  function setupDeck(selfCardNo: string, effect: number) {
    const selfDef = cardNoMap.get(selfCardNo)!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(selfDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const mk = (id: string) =>
      createCardInstance(cardNoMap.get("BSTH003-C33")!, {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      });
    const deck = [mk("top"), mk("mid"), mk("bottom")];
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    return { state, effect: selfDef.effects![effect]! };
  }

  function drawnIds(result: GameState): Set<string> {
    return new Set(
      result.cardInstances
        .filter((c) => c.zone === "hand")
        .map((c) => c.instanceId)
    );
  }

  it("C33: 構造 = draw(top) default + choice[0] draw(bottom)", () => {
    const flash = cardNoMap.get("BSTH003-C33")!.effects![1]!;
    expect(flash.stub).toBeUndefined();
    const step = flash.steps[0]!;
    expect(step.action.kind).toBe("draw");
    if (step.action.kind === "draw") expect(step.action.position).toBe("top");
    expect(step.choice).toBeDefined();
    expect(step.choice!.length).toBe(1);
    const alt = step.choice![0]!.action;
    expect(alt.kind).toBe("draw");
    if (alt.kind === "draw") expect(alt.position).toBe("bottom");
  });

  it("C33 フラッシュ: choiceIndex=0 は上2枚 / choiceIndex=1 は下2枚をドロー", () => {
    const { state, effect } = setupDeck("BSTH003-C33", 1);
    const top = executeEffect({
      chainId: "test:bsth003-cards:760",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 0,
    });
    // 上2枚 = top, mid。bottom はデッキに残る。
    expect(drawnIds(top)).toEqual(new Set(["top", "mid"]));

    const bottom = executeEffect({
      chainId: "test:bsth003-cards:771",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    // 下2枚 = mid, bottom。top はデッキに残る。
    expect(drawnIds(bottom)).toEqual(new Set(["mid", "bottom"]));
  });

  it("R02 フラッシュ(ことでコスト): choiceIndex=1 で自身疲労 + 下1枚ドロー", () => {
    const { state, effect } = setupDeck("BSTH003-R02", 1);
    const result = executeEffect({
      chainId: "test:bsth003-cards:785",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    const self = result.cardInstances.find((c) => c.instanceId === "src-1")!;
    expect(self.exhaustState).toBe("exhausted");
    expect(drawnIds(result)).toEqual(new Set(["bottom"]));
  });

  it("M01 召喚時(複数ステップ): choiceIndex=1 で下2枚ドロー後に後続ステップへ進む", () => {
    const { state, effect } = setupDeck("BSTH003-M01", 0);
    let result = executeEffect({
      chainId: "test:bsth003-cards:800",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    const executeDraw = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(executeDraw).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: executeDraw!,
      getCardDefinitionById,
    }).state;
    // ドロー任意選択を実行し、引き続き別の任意召喚へ進む。
    expect(drawnIds(result)).toEqual(new Set(["mid", "bottom"]));
  });

  it("M01 召喚時 registration: choice ラベルが上/下で区別される (GUI 整合)", () => {
    const def = cardNoMap.get("BSTH003-M01")!;
    const regs = generateTriggeredEffectRegistrations(def);
    const withChoices = regs.find((r) => r.choices && r.choices.length === 2);
    expect(withChoices).toBeDefined();
    expect(withChoices!.choices!.map((c) => c.label)).toEqual([
      "デッキの上からドロー",
      "デッキの下からドロー",
    ]);
  });
});

describe("BSTH003-M01 カナ・アナベラル", () => {
  const card = cardNoMap.get("BSTH003-M01")!;
  it("召喚時 draw2 + brave召喚(from_zone hand/trash) / フラッシュ BP-8000→BP0破壊", () => {
    const summon = card.effects![0]!;
    expect(summon.steps[0]!.action.kind).toBe("draw");
    const s = summon.steps[1]!.action;
    expect(s.kind).toBe("summon");
    if (s.kind === "summon" && s.target.kind === "from_zone") {
      expect(s.target.zone).toEqual(["hand", "trash"]);
    }
    const flash = card.effects![1]!;
    const bp = flash.steps[0]!.action;
    if (bp.kind === "bp_modify") expect(bp.amount).toBe(-8000);
    // 「BPが0になったスピリットを破壊する」= maxBp:0 フィルタの destroy ステップ
    const d = flash.steps[1]!.action;
    expect(d.kind).toBe("destroy");
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.maxBp).toBe(0);
    }
    expect(flash.stub).toBeUndefined();
  });

  it("BP0破壊 実行: BP-8000で相手スピリットが実効BP0→破壊待機", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "kana-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    // 相手スピリット Lv1 BP5000 → -8000 で実効BP0
    const target = createCardInstance(card, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      cardInstances: [self, target],
      battleEntities: [
        {
          entityId: "battle-entity:kana-1",
          memberInstanceIds: ["kana-1"],
          resolvedBp: 8000,
          resolvedSymbols: ["yellow"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:kana-1",
        primaryEntityId: "battle-entity:kana-1",
        participantEntityIds: ["battle-entity:kana-1"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:kana-1",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:kana-1"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    };
    const result = executeEffect({
      chainId: "test:bsth003-cards:921",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "kana-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const after = result.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(after.pendingLeaveKind === "destroy" || after.zone === "trash").toBe(
      true
    );
  });
});

describe("BSTH003-M03 [夢時空]博麗 靈夢 (burst)", () => {
  const card = cardNoMap.get("BSTH003-M03")!;
  it("treat_as黄 + burst summon + アタック destroy(BP8000以下)", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe("yellow");
    expect(card.effects![1]!.timing.kind).toBe("burst");
    const d = card.effects![2]!.steps[0]!.action;
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.maxBp).toBe(8000);
    }
  });

  it("burst trigger は attack_finished(opponent) で stub 解消済み", () => {
    expect(card.effects![1]!.stub).toBeUndefined();
    expect(card.effects![1]!.timing).toEqual({
      kind: "burst",
      trigger: { kind: "attack_finished", player: "opponent" },
    });
  });

  it("実行: 相手創界神ネクサス2つのコアを6個ずつボイドへ→コスト無しで自身を召喚", () => {
    const grandwalker = cardNoMap.get("BSLH01-X02")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const source = createCardInstance(card, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const nexusA = createCardInstance(grandwalker, {
      instanceId: "bob-nexus-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const nexusB = createCardInstance(grandwalker, {
      instanceId: "bob-nexus-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 6,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [source, nexusA, nexusB],
    };
    const voidBefore =
      state.players.find((p) => p.id === "bob")?.voidNormalCoreCount ?? 0;
    const result = executeEffect({
      chainId: "test:bsth003-cards:992",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "reimu-burst",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["bob-nexus-a", "bob-nexus-b"],
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-nexus-a")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-nexus-b")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      result.players.find((p) => p.id === "bob")?.voidNormalCoreCount
    ).toBe(voidBefore + 12);
    expect(
      result.cardInstances.find((c) => c.instanceId === "reimu-burst")?.zone
    ).toBe("field");
  });

  it("実行: 相手創界神ネクサスが1つしか無くても安全に召喚まで解決する（2体目未解決は state 不変で no-op）", () => {
    const grandwalker = cardNoMap.get("BSLH01-X02")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const source = createCardInstance(card, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const nexusA = createCardInstance(grandwalker, {
      instanceId: "bob-nexus-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [source, nexusA],
    };
    // targetInstanceIds を明示せず自動解決に委ねる (BSKB01-C04 の「対象未指定の自動解決」precedent
    // と同型)。1体しか候補が無いため repeat 2巡目は候補不足で no-op になり、1巡目の効果と
    // summon だけが安全に解決されることを検証する (adversarial verifier 2026-07-24 round2 指摘:
    // targetInstanceIds を1件だけ明示すると repeatExplicitTargetCount により repeat ループ本体
    // 自体がスキップされ、対象不足 no-op 経路を検証できていなかった)。
    const result = executeEffect({
      chainId: "test:bsth003-cards:1043",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "reimu-burst",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(result.log).toContain(
      "effect:repeat-activation:reimu-burst:1:0:iter=1/1"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-nexus-a")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      result.cardInstances.find((c) => c.instanceId === "reimu-burst")?.zone
    ).toBe("field");
  });
});

describe("BSTH003-R01 小兎姫", () => {
  const card = cardNoMap.get("BSTH003-R01")!;
  it("召喚時 destroy(nexus 2体, suppress) / フラッシュ 疲労→place", () => {
    const d = card.effects![0]!.steps[0]!.action;
    if (d.kind === "destroy") {
      expect(d.suppressDestroyedEffects).toBe("destroyed_only");
      if (typeof d.target === "object" && "count" in d.target)
        expect(d.target.count).toBe(2);
    }
    const flash = card.effects![1]!;
    expect(flash.steps[0]!.action.kind).toBe("exhaust");
    expect(flash.steps[1]!.action.kind).toBe("search_zone");
  });
});

describe("BSTH003-R02 エレン", () => {
  const card = cardNoMap.get("BSTH003-R02")!;
  const fieldLookup = buildFieldCardEffectLookup([card]);

  it("召喚時 search_zone(trash→hand) / フラッシュ 疲労→draw", () => {
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("search_zone");
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("exhaust");
  });

  it("疲労済みなら conditional_cost のフラッシュ field effect を列挙しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const recovered = createCardInstance(card, {
      instanceId: "ellen-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });

    const hasEllenFlashAction = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "ellen-1" &&
          action.sourceCardNo === "BSTH003-R02"
      );

    const recoveredState: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [recovered],
    };
    expect(hasEllenFlashAction(recoveredState)).toBe(true);

    const exhaustedState: GameState = {
      ...recoveredState,
      cardInstances: [{ ...recovered, exhaustState: "exhausted" }],
    };
    expect(hasEllenFlashAction(exhaustedState)).toBe(false);
  });

  it("召喚時 search 実行: トラッシュの黄マジックが手札へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "ellen-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const trashMagic = createCardInstance(cardNoMap.get("BSTH003-R03")!, {
      instanceId: "magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, trashMagic],
    };
    const result = executeEffect({
      chainId: "test:bsth003-cards:1148",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "ellen-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const magicAfter = result.cardInstances.find(
      (c) => c.instanceId === "magic-1"
    )!;
    // 単一候補は自動解決で手札へ、または pendingZoneSelection 待機
    expect(
      magicAfter.zone === "hand" || result.pendingZoneSelection != null
    ).toBe(true);
  });
});

describe("BSTH003-R03 Reincarnation (magic)", () => {
  const card = cardNoMap.get("BSTH003-R03")!;
  it("系統付与 + 黄/赤発生源限定自己回収 + フラッシュ prevent_battle2 + スタック prevent_battle1", () => {
    const flash = card.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        (e.timing as { mode: string }).mode === "flash"
    )!;
    const a = flash.steps[0]!.action;
    if (
      a.kind === "prevent_battle" &&
      typeof a.target === "object" &&
      "count" in a.target
    ) {
      expect(a.target.count).toBe(2);
      expect(a.restriction).toEqual(["attack"]);
    }
  });
});

describe.each(["BSTH003-X01", "BSTH003-X03"])(
  "%s 導界者ネクサス (grandwalkerData)",
  (cardNo) => {
    const card = cardNoMap.get(cardNo)!;
    it("grandwalkerData(guided): 導託は engine 表現で stub なし / 転者も stub 解消済み", () => {
      expect(card.grandwalkerData?.kind).toBe("guided");
      // 導託/導界者共通ルールは grandwalkerData が表現するため stub effect を持たない。
      const oracleStub = card.effects!.find(
        (e) =>
          typeof e.stub === "string" && /導託|導界者ネクサス本体/.test(e.stub)
      );
      expect(oracleStub).toBeUndefined();
      // 転者（divine_transform 起動コスト）は phase-start + core_move + divine_transform +
      // grant_effect (BSTH03-R01 と同型) で表現済み。
      const tenshaStub = card.effects!.find(
        (e) => typeof e.stub === "string" && /転者/.test(e.stub)
      );
      expect(tenshaStub).toBeUndefined();
    });

    it("転者：3 構造: phase-start『自分のアタックステップ開始時』+ self_core_count(min3) + optional + core_move(3→void) + divine_transform(BP3000/6000, protected) + grant_effect(card_event:attack, duration:turn)", () => {
      const effect = card.effects!.find((e) =>
        e.steps.some((s) => s.action.kind === "divine_transform")
      );
      if (!effect) throw new Error("転者 effect not found");
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toMatchObject({
        kind: "phase",
        step: "attack",
        whose: "self",
        subPhase: "start",
      });
      expect(effect.condition).toContainEqual({
        kind: "self_core_count",
        min: 3,
      });
      expect(effect.executionMode).toBe("optional");

      const costStep = effect.steps[0]!.action;
      expect(costStep.kind).toBe("core_move");
      if (costStep.kind === "core_move") {
        expect(costStep.from).toEqual({ kind: "this_card" });
        expect(costStep.to).toEqual({ kind: "void", player: "self" });
        expect(costStep.amount).toBe(3);
      }

      const transform = effect.steps[1]!.action;
      expect(transform.kind).toBe("divine_transform");
      if (transform.kind === "divine_transform") {
        expect(transform.target).toEqual({ kind: "self" });
        expect(transform.bpByLevel).toEqual([
          { level: 1, bp: 3000 },
          { level: 2, bp: 6000 },
        ]);
        expect(transform.protectedFromNonGrandwalker).toBe(true);
      }

      const grant = effect.steps[2]!.action;
      expect(grant.kind).toBe("grant_effect");
      if (grant.kind === "grant_effect") {
        expect(grant.target).toEqual({ kind: "self" });
        expect(grant.duration).toEqual({ scope: "turn" });
        expect(grant.grantedEffect!.timing).toEqual({
          kind: "card_event",
          event: "attack",
        });
        expect(grant.grantedEffect!.executionMode).toBe("mandatory");
      }
    });
  }
);

describe("BSTH003-X01 転者：3 実行", () => {
  const card = cardNoMap.get("BSTH003-X01")!;
  const OPP_SPIRIT: CardDefinition = {
    cardNo: "TEST-X01-OPP-SPIRIT",
    name: "対戦相手テストスピリット",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["blue"],
    tribe: "無関係",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const defsMap = new Map<string, CardDefinition>([
    [card.cardNo, card],
    [OPP_SPIRIT.cardNo, OPP_SPIRIT],
  ]);
  const getDef = (id: string) => defsMap.get(id);

  function buildState(nexusCores: number): GameState {
    return {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "x01-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: nexusCores,
        }),
        createCardInstance(OPP_SPIRIT, {
          instanceId: "opp-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    } as GameState;
  }

  it("コスト3個支払い実行: コア3個ボイド化 + divineTransformState 付与 + granted_effect CE 登録", () => {
    const effect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "divine_transform")
    )!;
    const result = executeEffect({
      chainId: "test:bsth003-cards:1306",
      state: buildState(3),
      effect,
      sourceInstanceId: "x01-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const nexus = result.cardInstances.find((c) => c.instanceId === "x01-1")!;
    expect(nexus.normalCoreCount).toBe(0);
    expect(nexus.divineTransformState).toEqual({
      bpByLevel: [
        { level: 1, bp: 3000 },
        { level: 2, bp: 6000 },
      ],
      protectedFromNonGrandwalker: true,
    });
    const grantCes = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(grantCes).toHaveLength(1);
    expect(grantCes[0]!.targetInstanceId).toBe("x01-1");
    expect(grantCes[0]!.duration).toEqual({ scope: "turn" });
  });

  it("実行後: 自身のアタック時に granted BP-20000 で相手BP3000スピリットが0→破壊", () => {
    const effect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "divine_transform")
    )!;
    const afterGrant = executeEffect({
      chainId: "test:bsth003-cards:1334",
      state: buildState(3),
      effect,
      sourceInstanceId: "x01-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const withPending = queueGrantedEffectTriggersFromTriggerEvents(
      afterGrant,
      [
        {
          chainId: "test:bsth003-cards:1345",
          eventKind: "attack",
          relatedInstanceId: "x01-1",
          relatedPlayerId: "alice",
        },
      ],
      getDef
    );
    const pending = withPending.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pending).toBeDefined();

    const actions = getLegalActions({
      state: withPending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const resolveAction = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();
    let current = (
      applyLegalAction({
        state: withPending,
        action: resolveAction!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;

    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const passActions = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      });
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = (
        applyLegalAction({
          state: current,
          action: pass!,
          getCardDefinitionById: getDef,
        }) as { state: GameState }
      ).state;
    }

    const oppSpirit = current.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    );
    expect(oppSpirit?.zone).toBe("trash");
  });

  it("コスト不足 (コア2個): self_core_count(min3) がゲートし選択肢自体を出さない (core_move の部分成功 clamp による過小支払い発揮を防ぐ)", () => {
    const effect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "divine_transform")
    )!;
    expect(
      evaluateCondition(
        buildState(2),
        effect.condition!,
        "x01-1",
        "alice",
        getDef
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        buildState(3),
        effect.condition!,
        "x01-1",
        "alice",
        getDef
      )
    ).toBe(true);
  });
});

describe("BSTH003-X03 転者：3 実行 (シンボル2つ以下破壊)", () => {
  const card = cardNoMap.get("BSTH003-X03")!;
  const OPP_LOW_SYMBOL: CardDefinition = {
    cardNo: "TEST-X03-OPP-LOWSYM",
    name: "対戦相手テストスピリット(シンボル1)",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["blue"],
    tribe: "無関係",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const OPP_HIGH_SYMBOL: CardDefinition = {
    cardNo: "TEST-X03-OPP-HIGHSYM",
    name: "対戦相手テストスピリット(シンボル3)",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["blue", "blue", "blue"],
    tribe: "無関係",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const defsMap = new Map<string, CardDefinition>([
    [card.cardNo, card],
    [OPP_LOW_SYMBOL.cardNo, OPP_LOW_SYMBOL],
    [OPP_HIGH_SYMBOL.cardNo, OPP_HIGH_SYMBOL],
  ]);
  const getDef = (id: string) => defsMap.get(id);

  it("granted destroy はシンボル2つ以下のみ対象 (シンボル3つの相手は破壊されない)", () => {
    const effect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "divine_transform")
    )!;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "x03-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(OPP_HIGH_SYMBOL, {
          instanceId: "opp-high-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    } as GameState;
    const afterGrant = executeEffect({
      chainId: "test:bsth003-cards:1491",
      state,
      effect,
      sourceInstanceId: "x03-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const withPending = queueGrantedEffectTriggersFromTriggerEvents(
      afterGrant,
      [
        {
          chainId: "test:bsth003-cards:1501",
          eventKind: "attack",
          relatedInstanceId: "x03-1",
          relatedPlayerId: "alice",
        },
      ],
      getDef
    );
    // シンボル2つ以下の対象が場に居ないため、destroy は対象を取れず granted_effect
    // pending 自体が誘発しない、もしくは誘発しても対象不在で盤面不変となる。
    const pending = withPending.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    if (pending) {
      const actions = getLegalActions({
        state: withPending,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      });
      const resolveAction = actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.pendingId === pending.pendingId
      );
      if (resolveAction) {
        let current = (
          applyLegalAction({
            state: withPending,
            action: resolveAction,
            getCardDefinitionById: getDef,
          }) as { state: GameState }
        ).state;
        let guard = 0;
        while (current.stackWindow && guard++ < 10) {
          const responderId = current.stackWindow.priorityPlayerId;
          const passActions = getLegalActions({
            state: current,
            actingPlayerId: responderId,
            getCardDefinitionById: getDef,
            getRegisteredFieldCardEffectActions: () => [],
          });
          const pass = passActions.find((a) => a.kind === "pass_stack");
          if (pass) {
            current = (
              applyLegalAction({
                state: current,
                action: pass,
                getCardDefinitionById: getDef,
              }) as { state: GameState }
            ).state;
          } else break;
        }
        const opp = current.cardInstances.find(
          (c) => c.instanceId === "opp-high-1"
        );
        expect(opp?.zone).toBe("field");
      }
    }
  });

  it("granted destroy: シンボル1つの相手は破壊される", () => {
    const effect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "divine_transform")
    )!;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "x03-2",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(OPP_LOW_SYMBOL, {
          instanceId: "opp-low-1",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    } as GameState;
    const afterGrant = executeEffect({
      chainId: "test:bsth003-cards:1585",
      state,
      effect,
      sourceInstanceId: "x03-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const withPending = queueGrantedEffectTriggersFromTriggerEvents(
      afterGrant,
      [
        {
          chainId: "test:bsth003-cards:1595",
          eventKind: "attack",
          relatedInstanceId: "x03-2",
          relatedPlayerId: "alice",
        },
      ],
      getDef
    );
    const pending = withPending.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pending).toBeDefined();
    const actions = getLegalActions({
      state: withPending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const resolveAction = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();
    let current = (
      applyLegalAction({
        state: withPending,
        action: resolveAction!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;
    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const passActions = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      });
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = (
        applyLegalAction({
          state: current,
          action: pass!,
          getCardDefinitionById: getDef,
        }) as { state: GameState }
      ).state;
    }
    const opp = current.cardInstances.find((c) => c.instanceId === "opp-low-1");
    expect(opp?.zone).toBe("trash");
  });
});

describe("BSTH003-X01 【導域】コア4個につきドロー枚数+1", () => {
  const card = cardNoMap.get("BSTH003-X01")!;

  it("stub 解消: inline draw_modify(cores_on this_card, divisor:4)", () => {
    const effect = card.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toMatchObject({
      kind: "phase",
      step: "draw",
      whose: "self",
      subPhase: "start",
    });
    expect(effect.inline).toBe(true);
    expect(effect.condition).toContainEqual({ kind: "min_level", value: 2 });
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("draw_modify");
    if (action.kind === "draw_modify") {
      expect(action.amount).toEqual({
        source: { kind: "cores_on", location: { kind: "this_card" } },
        divisor: 4,
      });
    }
  });

  function buildDrawState(cores: number) {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const deckCards = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `deck-${cores}-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const nexus = createCardInstance(card, {
      instanceId: `x01-${cores}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cores,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      turnNumber: 2,
      step: "core",
      cardInstances: [nexus, ...deckCards],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, deckCount: deckCards.length, handCount: 0 }
          : p
      ),
    };
    return state;
  }

  it("コア1個 (Lv2最小、floor(1/4)=0): 通常ドロー1枚のみ", () => {
    const lookup = buildTriggeredEffectLookup([card]);
    const after = advanceStep(buildDrawState(1), getCardDefinitionById, lookup);
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(after.step).toBe("draw");
    expect(alice.handCount).toBe(1);
  });

  it("コア4個 (floor(4/4)=1): 通常ドロー1枚+1枚 = 2枚", () => {
    const lookup = buildTriggeredEffectLookup([card]);
    const after = advanceStep(buildDrawState(4), getCardDefinitionById, lookup);
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(2);
  });

  it("コア8個 (floor(8/4)=2): 通常ドロー1枚+2枚 = 3枚", () => {
    const lookup = buildTriggeredEffectLookup([card]);
    const after = advanceStep(buildDrawState(8), getCardDefinitionById, lookup);
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(3);
  });

  it("この効果は重複しない: 同名2枚 (各コア4個) でも+1は1回のみ（sourceDefinitionId 単位 dedup）", () => {
    // adversarial verifier 反証 (engine-claude 2026-07-24): dedup ロジック自体は
    // turn-system.ts の seenDrawModifyDefs (sourceDefinitionId キー) で実装済みだが、
    // 2 インスタンス同時存在を検証するテストが無かった。積み重なれば 1+1+1=3 枚になるはず
    // のところ、dedup が効いていれば 1+1=2 枚に留まることを確認する。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const deckCards = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `deck-dup-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const nexusA = createCardInstance(card, {
      instanceId: "x01-dup-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const nexusB = createCardInstance(card, {
      instanceId: "x01-dup-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      turnNumber: 2,
      step: "core",
      cardInstances: [nexusA, nexusB, ...deckCards],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, deckCount: deckCards.length, handCount: 0 }
          : p
      ),
    };
    const lookup = buildTriggeredEffectLookup([card]);
    const after = advanceStep(state, getCardDefinitionById, lookup);
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(2);
  });
});

describe("BSTH003-X03 導域 restrict_end_attack_step (既存)", () => {
  const card = cardNoMap.get("BSTH003-X03")!;
  it("導域効果が restrict_end_attack_step を持つ", () => {
    const restrict = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "restrict_end_attack_step"
    );
    expect(restrict).toBeDefined();
  });
});

describe("BSTH003-X02 [夢時空]霧雨 魔梨沙 (burst)", () => {
  const card = cardNoMap.get("BSTH003-X02")!;
  it("treat_as赤 + burst summon + 条件付き耐性 + BP-10000×2(非バトル)→BP0破壊", () => {
    expect(card.effects![1]!.timing.kind).toBe("burst");
    const bp = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "bp_modify"
    )!;
    const a = bp.steps[0]!.action;
    if (a.kind === "bp_modify") {
      expect(a.amount).toBe(-10000);
      if (typeof a.target === "object" && "filter" in a.target) {
        // 「このスピリットとバトルしていない」= not_in_battle
        expect(a.target.filter.battleState).toBe("not_in_battle");
      }
    }
    const d = bp.steps[1]!.action;
    expect(d.kind).toBe("destroy");
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.maxBp).toBe(0);
    }
    expect(bp.stub).toBeUndefined();
  });

  it("BSTH003-X02: 疲労ブロック許可は導魔導界者条件に縛られない", () => {
    const blockWhileExhausted = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "allow_block_while_exhausted")
    )!;
    expect(blockWhileExhausted.stub).toBeUndefined();
    expect(blockWhileExhausted.condition ?? []).toEqual([]);
    expect(blockWhileExhausted.steps[0]!.action).toMatchObject({
      kind: "allow_block_while_exhausted",
      target: { kind: "self" },
      duration: { scope: "while_on_field" },
    });

    const immunity = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "effect_immunity")
    )!;
    expect(immunity.stub).toBeUndefined();
    expect(immunity.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      category: ["nexus"],
      tribes: ["導魔"],
      grandwalkerKind: "guided",
    });

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const attackerDef = cardNoMap.get("BSTH003-M01")!;
    const attacker = createCardInstance(attackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(card, {
      instanceId: "marisa-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:bsth003-x02:1",
      primaryEntityId: "attacker-entity",
      participantEntityIds: ["attacker-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "attacker-entity",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["attacker-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const fieldState = rebuildContinuousEffectsFromField(
      {
        ...base,
        turnNumber: 2,
        activePlayerId: "alice",
        cardInstances: [attacker, blocker],
      },
      getCardDefinitionById
    );
    const state: GameState = {
      ...fieldState,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "attacker-entity",
          resolvedBp: 5000,
          attackState: "attacking",
          resolvedSymbols: ["yellow"],
          memberInstanceIds: ["attacker-1"],
        },
      ],
    };

    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "allow_block_while_exhausted" &&
          ce.targetInstanceId === "marisa-blocker"
      )
    ).toBe(true);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.targetInstanceId === "marisa-blocker"
      )
    ).toBe(false);
    expect(
      getBlockDeclarationBlockReason({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "marisa-blocker",
        participantEntityId: "attacker-entity",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("BP0破壊 実行: 非バトルの相手2体がBP-10000で実効BP0→破壊待機", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "marisa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const small = cardNoMap.get("BSTH003-M01")!; // Lv1 BP5000
    const t1 = createCardInstance(small, {
      instanceId: "t1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const t2 = createCardInstance(small, {
      instanceId: "t2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const bpEffect = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "bp_modify"
    )!;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, t1, t2],
    };
    const result = executeEffect({
      chainId: "test:bsth003-cards:1954",
      state,
      effect: bpEffect,
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    for (const id of ["t1", "t2"]) {
      const after = result.cardInstances.find((c) => c.instanceId === id)!;
      expect(
        after.pendingLeaveKind === "destroy" || after.zone === "trash"
      ).toBe(true);
    }
  });
});

describe("BSTH003-X04 北白河 ちゆり", () => {
  const card = cardNoMap.get("BSTH003-X04")!;
  it("召喚時 core_distribute(導界者2) / バトル終了時 core_move→recover / Lv3 BP-10000→BP0破壊", () => {
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("core_move");
    const battleEnd = card.effects![1]!;
    expect(battleEnd.stub).toBeUndefined();
    expect(battleEnd.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "battle_end",
      requireRelatedInstanceOnField: false,
    });
    expect(battleEnd.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    expect(battleEnd.executionMode).toBe("optional");
    expect(battleEnd.steps[0]!.action.kind).toBe("core_move");
    if (battleEnd.steps[0]!.action.kind === "core_move") {
      expect(battleEnd.steps[0]!.action.from.kind).toBe("field_card");
    }
    const triggeredReg = generateTriggeredEffectRegistrations(card).find(
      (r) => r.effectIndex === 1
    );
    expect(triggeredReg?.requiredCoreMoveCost).toMatchObject({
      amount: 3,
      sourcePlayer: "self",
      sourceFilter: {
        category: ["nexus"],
        colors: ["red", "yellow"],
        tribes: ["導界者"],
        targetsGrandwalker: true,
      },
      destination: { kind: "void", player: "self" },
    });
    expect(battleEnd.steps[1]!.connector).toBe("conditional_cost");
    expect(battleEnd.steps[1]!.action.kind).toBe("recover");
    if (battleEnd.steps[1]!.action.kind === "recover") {
      const filter = battleEnd.steps[1]!.action.target;
      expect(filter.kind).toBe("filter");
      if (filter.kind === "filter") {
        expect(filter.filter.filterOr).toEqual([
          { category: ["spirit"], tribes: ["導魔", "秘封"] },
          {
            category: ["nexus"],
            tribes: ["導魔", "秘封"],
            targetsGrandwalker: true,
            hasMechanic: ["guided"],
          },
        ]);
      }
    }
    const bp = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "bp_modify"
    )!;
    expect(bp.condition).toContainEqual({ kind: "min_level", value: 3 });
    const mod = bp.steps[0]!.action;
    if (mod.kind === "bp_modify") expect(mod.amount).toBe(-10000);
    const destroy = bp.steps[1]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy" && destroy.target.kind === "ref") {
      expect(destroy.target).toEqual({
        kind: "ref",
        stepId: "bp0",
        result: "bp_became_zero",
      });
    }
    expect(bp.stub).toBeUndefined();
  });

  it("バトル終了時: 赤/黄導界者ネクサスのコア3個をボイドに置くことで導魔/秘封1つを回復", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const guidedNexus = cardNoMap.get("BSTH003-X01")!;
    const unrelatedSpiritDef = cardNoMap.get("BSTH01-C01")!;
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const costSource = createCardInstance(guidedNexus, {
      instanceId: "guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const unrelatedSpirit = createCardInstance(unrelatedSpiritDef, {
      instanceId: "unrelated-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, costSource, unrelatedSpirit],
    };
    const beforeAliceVoid = base.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    const battleEnd = card.effects![1]!;
    const result = executeEffect({
      chainId: "test:bsth003-cards:2077",
      state,
      effect: battleEnd,
      sourceInstanceId: "chiyuri-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const afterSelf = result.cardInstances.find(
      (c) => c.instanceId === "chiyuri-1"
    )!;
    const afterCostSource = result.cardInstances.find(
      (c) => c.instanceId === "guided-1"
    )!;
    const afterUnrelated = result.cardInstances.find(
      (c) => c.instanceId === "unrelated-1"
    )!;
    const afterAliceVoid = result.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    expect(afterCostSource.normalCoreCount).toBe(0);
    expect(afterAliceVoid).toBe(beforeAliceVoid + 3);
    expect(afterSelf.exhaustState).toBe("recovered");
    expect(afterUnrelated.exhaustState).toBe("exhausted");
  });

  it("バトル終了時: BSTH003-X04 の複数導界者コア源選択後も recover へ再開する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const guidedNexus = cardNoMap.get("BSTH003-X01")!;
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const costSource1 = createCardInstance(guidedNexus, {
      instanceId: "guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const costSource2 = createCardInstance(guidedNexus, {
      instanceId: "guided-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, costSource1, costSource2],
    };
    const pendingState = executeEffect({
      chainId: "test:bsth003-cards:2133",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "chiyuri-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(pendingState.pendingCoreSourceAllocation).not.toBeNull();
    expect(pendingState.pendingCoreSourceAllocation!.requiredTotal).toBe(3);
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_core_source_allocation");
    expect(action).toBeDefined();
    const result = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      coreSourceAllocations: { "guided-1": 1, "guided-2": 2 },
    }).state;
    const afterSelf = result.cardInstances.find(
      (c) => c.instanceId === "chiyuri-1"
    )!;
    const afterCostSource1 = result.cardInstances.find(
      (c) => c.instanceId === "guided-1"
    )!;
    const afterCostSource2 = result.cardInstances.find(
      (c) => c.instanceId === "guided-2"
    )!;
    const afterAliceVoid = result.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    expect(result.pendingCoreSourceAllocation).toBeNull();
    expect(afterCostSource1.normalCoreCount).toBe(1);
    expect(afterCostSource2.normalCoreCount).toBe(0);
    expect(afterAliceVoid).toBe(base.players[0]!.voidNormalCoreCount + 3);
    expect(afterSelf.exhaustState).toBe("recovered");
  });

  it("BSTH003-X04 の形式4 battle_end は参加カードが離場しても本体が場にいれば発火候補に残る", () => {
    const participant = createCardInstance(cardNoMap.get("BSTH003-M01")!, {
      instanceId: "participant-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const costSource = createCardInstance(cardNoMap.get("BSTH003-X01")!, {
      instanceId: "guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, participant, costSource],
    };
    const pendingEffect: PendingTriggeredEffect = {
      pendingId: "battle-end-bsth003-x04",
      actingPlayerId: "alice",
      eventKind: "battle_end",
      event: {
        family: "battle_end",
        validationMode: "require_related_instance_on_field",
        actionKind: "attack",
      },
      source: "battle_resolution",
      chainId: "test:bsth003-cards:2205",
      attackId: "attack-1",
      relatedPlayerId: "alice",
      relatedInstanceId: "participant-1",
      amount: 0,
      step: "attack",
      window: "declare_attack",
      resolvedSourceInstanceIds: [],
    };
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "chiyuri-1")
    ).toBeDefined();
  });

  it("BSTH003-X04 の battle_end は導界者ネクサスのコアが3個未満なら発火候補から落ちる", () => {
    const participant = createCardInstance(cardNoMap.get("BSTH003-M01")!, {
      instanceId: "participant-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const underfundedCostSource = createCardInstance(
      cardNoMap.get("BSTH003-X01")!,
      {
        instanceId: "guided-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }
    );
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, participant, underfundedCostSource],
    };
    const pendingEffect: PendingTriggeredEffect = {
      pendingId: "battle-end-bsth003-x04-underfunded",
      actingPlayerId: "alice",
      eventKind: "battle_end",
      event: {
        family: "battle_end",
        validationMode: "require_related_instance_on_field",
        actionKind: "attack",
      },
      source: "battle_resolution",
      chainId: "test:bsth003-cards:2268",
      attackId: "attack-1",
      relatedPlayerId: "alice",
      relatedInstanceId: "participant-1",
      amount: 0,
      step: "attack",
      window: "declare_attack",
      resolvedSourceInstanceIds: [],
    };
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "chiyuri-1")
    ).toBeUndefined();
  });

  it("BSTH003-X04 の battle_end はコア下限保護で可動3個未満なら発火候補から落ちる", () => {
    const participant = createCardInstance(cardNoMap.get("BSTH003-M01")!, {
      instanceId: "participant-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const protectedCostSource = createCardInstance(
      cardNoMap.get("BSTH003-X01")!,
      {
        instanceId: "guided-protected",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      }
    );
    const coreMinimum: ContinuousEffect = {
      effectId: "test-guided-core-minimum",
      sourceInstanceId: "test-core-min-source",
      sourceDefinitionId: card.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_reduce_cores_below",
      targetInstanceId: protectedCostSource.instanceId,
      metadata: { source: "all", coreMinimum: 1 },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, participant, protectedCostSource],
      activeContinuousEffects: [coreMinimum],
    };
    const pendingEffect: PendingTriggeredEffect = {
      pendingId: "battle-end-bsth003-x04-protected-core",
      actingPlayerId: "alice",
      eventKind: "battle_end",
      event: {
        family: "battle_end",
        validationMode: "require_related_instance_on_field",
        actionKind: "attack",
      },
      source: "battle_resolution",
      chainId: "test:bsth003-cards:2344",
      attackId: "attack-1",
      relatedPlayerId: "alice",
      relatedInstanceId: "participant-1",
      amount: 0,
      step: "attack",
      window: "declare_attack",
      resolvedSourceInstanceIds: [],
    };
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "chiyuri-1")
    ).toBeUndefined();
  });

  it("BSTH003-X04 の battle_end は実効色で黄化された導界者ネクサスをコア源にできる", () => {
    const effectiveYellowGuidedNexus: CardDefinition = {
      cardNo: "TEST-GUIDED-EFFECTIVE-YELLOW",
      name: "実効黄導界者",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: ["purple"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: ["guided_nexus"],
      grandwalkerData: {
        kind: "guided",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
      tribe: "導界者・導魔",
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "treat_as",
                aspects: ["color"],
                asColor: "yellow",
                appliesToCard: true,
              },
            },
          ],
        },
      ],
    };
    const customGetDef = (definitionId: string) =>
      definitionId === effectiveYellowGuidedNexus.cardNo
        ? effectiveYellowGuidedNexus
        : getCardDefinitionById(definitionId);
    const participant = createCardInstance(cardNoMap.get("BSTH003-M01")!, {
      instanceId: "participant-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const costSource = createCardInstance(effectiveYellowGuidedNexus, {
      instanceId: "guided-effective-yellow",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    let state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, participant, costSource],
    };
    state = rebuildContinuousEffectsFromField(state, customGetDef);
    const pendingEffect: PendingTriggeredEffect = {
      pendingId: "battle-end-bsth003-x04-effective-yellow",
      actingPlayerId: "alice",
      eventKind: "battle_end",
      event: {
        family: "battle_end",
        validationMode: "require_related_instance_on_field",
        actionKind: "attack",
      },
      source: "battle_resolution",
      chainId: "test:bsth003-cards:2440",
      attackId: "attack-1",
      relatedPlayerId: "alice",
      relatedInstanceId: "participant-1",
      amount: 0,
      step: "attack",
      window: "declare_attack",
      resolvedSourceInstanceIds: [],
    };
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect,
      getCardDefinitionById: customGetDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        card,
        effectiveYellowGuidedNexus,
      ]),
    });
    expect(
      choices.find((choice) => choice.sourceCard.instanceId === "chiyuri-1")
    ).toBeDefined();
  });

  it("BP0破壊 実行: BP-10000で相手スピリットが実効BP0→破壊待機", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const target = createCardInstance(cardNoMap.get("BSTH003-M01")!, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, target],
    };
    const bpEffect = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "bp_modify"
    )!;
    const result = executeEffect({
      chainId: "test:bsth003-cards:2498",
      state,
      effect: bpEffect,
      sourceInstanceId: "chiyuri-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const after = result.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(after.pendingLeaveKind === "destroy" || after.zone === "trash").toBe(
      true
    );
  });

  it("Lv1-Lv2-Lv3『アタックステップ』バトル終了時: 導界者ネクサスのコア3個ボイドで導魔/秘封カードを回復 (stub解消)", () => {
    const effect = card.effects!.find(
      (e) => e.timing.kind === "game_event" && e.timing.event === "battle_end"
    )!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "battle_end",
      requireRelatedInstanceOnField: false,
    });
    expect(effect.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    expect(effect.executionMode).toBe("optional");
  });

  it("バトル終了時: [導界者]魅魔のコア3個をボイドに置き、疲労中の自身(秘封/導魔)を回復する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "chiyuri-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
      exhaustState: "exhausted",
    });
    const guidedNexus = createCardInstance(cardNoMap.get("BSTH003-X01")!, {
      instanceId: "mima-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, guidedNexus],
    };
    const voidBefore = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;
    const effect = card.effects!.find(
      (e) => e.timing.kind === "game_event" && e.timing.event === "battle_end"
    )!;
    const result = executeEffect({
      chainId: "test:bsth003-cards:2560",
      state,
      effect,
      sourceInstanceId: "chiyuri-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const nexusAfter = result.cardInstances.find(
      (c) => c.instanceId === "mima-1"
    )!;
    expect(nexusAfter.normalCoreCount).toBe(1);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(voidBefore + 3);
    const selfAfter = result.cardInstances.find(
      (c) => c.instanceId === "chiyuri-1"
    )!;
    expect(selfAfter.exhaustState).toBe("recovered");
  });
});

describe("BSTH003-X05 朝倉 理香子 (転召)", () => {
  const card = cardNoMap.get("BSTH003-X05")!;
  it("転召(召喚手順内ステップ tenshoSummon) + アタック destroy(suppress)", () => {
    expect(card.tenshoSummon).toBeDefined();
    expect(card.tenshoSummon!.minCores).toBe(1);
    expect(card.tenshoSummon!.destination).toBe("void");
    expect(card.tenshoSummon!.targetFilter.tribesRequired).toEqual(["幻想"]);
    const destroyEffect = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "destroy"
    )!;
    const d = destroyEffect.steps[0]!.action;
    if (d.kind === "destroy")
      expect(d.suppressDestroyedEffects).toBe("destroyed_only");
  });
});
