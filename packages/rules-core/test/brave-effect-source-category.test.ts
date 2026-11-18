/** Q378/Q8139: effect ownership differs from the card's field categories. */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import {
  getAffectSourceCategories,
  resolveAffectSourceIdentity,
  resolveEffectTimingAtEvent,
} from "../src/effect/effect-source-identity";
import { computeCoreMoveAmountBonus } from "../src/effect/structured-modifiers";
import { resolveBonusCoreLocation } from "../src/effect/structured-core-move";
import { findApplicableDeckRevealCountBoostBonus } from "../src/effect/deck-reveal-count-boost";
import { findApplicableTargetRedirects } from "../src/effect/redirect-effect-target";
import {
  getExpandEffectTargetCountBonus,
  getExpandEffectTargetCountBonusDeclarative,
} from "../src/effect/expand-effect-target-count";
import { applyEffectParamOverridesToFilter } from "../src/effect/effect-param-override";
import { getEffectiveDuration } from "../src/effect/duration-override";
import { withRequiredEffectCost } from "../src/effect/card-access-rules";
import { getEffectiveBp } from "../src/legal/legal-actions-shared";
import { isCardRecoveryRestricted } from "../src/effect/recovery-restriction";
import type { Effect } from "../src/dsl-types";
import {
  createStepExecutionContext,
  deserializeStepContext,
  serializeStepContext,
} from "../src/step-execution-context";
import type {
  CardCategory,
  CardDefinition,
  ContinuousEffect,
  EffectTiming,
  GameState,
} from "../src/model";

const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const mixedTiming: EffectTiming = {
  kind: "card_event",
  event: ["summon", "attack"],
};
const coreEffect: Effect = {
  timing: mixedTiming,
  steps: [
    {
      id: "remove-core",
      action: {
        kind: "core_move",
        from: { kind: "target_card" },
        to: { kind: "reserve", player: "opponent" },
        amount: 1,
        target: {
          kind: "filter",
          player: "opponent",
          zone: "field",
          filter: { category: ["spirit"] },
          count: 1,
        },
      },
    },
  ],
};
// Keep the host/target categories and legal combine condition explicit. The
// real Yuugen below supplies the bonus under test; these cards add no unrelated
// continuous effects or card-specific combine restrictions.
const spiritDefinition: CardDefinition = {
  cardNo: "TEST-Q378-SPIRIT",
  name: "Q378 spirit fixture",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "Q378",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
const braveDefinition: CardDefinition = {
  ...spiritDefinition,
  cardNo: "TEST-Q378-BRAVE",
  name: "Q378 brave fixture",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  combinedBoost: 1000,
  braveCondition: { categories: ["spirit"] },
  effects: [coreEffect],
};
const getDef = (id: string): CardDefinition | undefined =>
  id === braveDefinition.cardNo
    ? braveDefinition
    : id === spiritDefinition.cardNo
      ? spiritDefinition
      : cards.get(id);
const summonTiming: EffectTiming = { kind: "card_event", event: "summon" };
const attackTiming: EffectTiming = { kind: "card_event", event: "attack" };

function setup(combined = false): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(braveDefinition, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: combined ? 0 : 1,
        attachedToInstanceId: combined ? "host" : null,
      }),
      createCardInstance(spiritDefinition, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        attachedChildrenIds: combined ? ["brave"] : [],
      }),
      createCardInstance(cards.get("BSTH001-転醒R02(A)")!, {
        instanceId: "yuugen",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(spiritDefinition, {
        instanceId: "target",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 4,
      }),
    ],
  });
}

function withImmunity(state: GameState, category: CardCategory): GameState {
  const immunity: ContinuousEffect = {
    effectId: "test-immunity",
    sourceInstanceId: "target",
    sourceDefinitionId: spiritDefinition.cardNo,
    actingPlayerId: "bob",
    targetInstanceId: "target",
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    immunitySourceScope: { categories: [category] },
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, immunity],
  };
}

function runCoreEffect(
  state: GameState,
  event: string,
  sourceInstanceId = "brave",
  effectSourceInstanceId?: string
): GameState {
  return executeEffect({
    state,
    effect: coreEffect,
    sourceInstanceId,
    actingPlayerId: "alice",
    chainId: `q378:${event}`,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    effectEventAction: event,
    effectIndex: 0,
    targetInstanceIds: ["target"],
    ...(effectSourceInstanceId ? { effectSourceInstanceId } : {}),
  });
}

describe("Q378/Q8139 brave effect categories", () => {
  it.each([false, true])(
    "own contract-combine effect stays brave-only with spirit immunity=%s",
    (immune) => {
      const state = rebuildContinuousEffectsFromField(setup(true), getDef);
      const before = immune ? withImmunity(state, "spirit") : state;
      const reserve = before.players.find(
        (player) => player.id === "bob"
      )!.reserveNormalCoreCount;
      const after = executeEffect({
        state: before,
        effect: {
          ...coreEffect,
          timing: {
            kind: "card_event",
            event: "brave_combined",
            cause: ["contract_combine"],
          },
          condition: [{ kind: "combined" }],
        },
        sourceInstanceId: "brave",
        actingPlayerId: "alice",
        chainId: `own-contract:${immune}`,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        effectIndex: 0,
        effectEventAction: "brave_combined",
        targetInstanceIds: ["target"],
      });
      // Spirit-only immunity and Yuugen's spirit-only +1 both ignore this effect.
      expect(
        after.cardInstances.find((card) => card.instanceId === "target")!
          .normalCoreCount
      ).toBe(3);
      expect(
        after.players.find((player) => player.id === "bob")!
          .reserveNormalCoreCount
      ).toBe(reserve + 1);
      expect(after.pendingCoreDistribution).toBeNull();
      expect(after.pendingZoneSelection).toBeNull();
    }
  );

  it.each(["summon", "attack"] as const)(
    "a mixed-heading %s effect keeps its category when its CE is reevaluated after immunity appears",
    (event) => {
      const state = setup();
      const target = state.cardInstances.find(
        (card) => card.instanceId === "target"
      )!;
      const targetDefinition = getDef(target.definitionId)!;
      const baselineBp = getEffectiveBp(
        state,
        target,
        targetDefinition,
        getDef
      );
      expect(targetDefinition.printedCategory).toBe("spirit");
      expect(baselineBp).toBeGreaterThan(0);
      const effect: Effect = {
        timing: mixedTiming,
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              amount: 1000,
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "restrict_recovery",
              player: "opponent",
              filter: { category: ["spirit"] },
              duration: { scope: "turn" },
            },
          },
        ],
      };
      const after = executeEffect({
        state,
        effect,
        sourceInstanceId: "brave",
        actingPlayerId: "alice",
        chainId: `q378-ce-reevaluation:${event}`,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        effectEventAction: event,
        effectIndex: 0,
      });
      for (const tag of ["bp_modifier", "prevent_recovery"] as const) {
        expect(
          after.activeContinuousEffects.find((ce) => ce.modifierTag === tag)
            ?.provenance?.effectTiming
        ).toEqual({ kind: "card_event", event });
      }
      expect(getEffectiveBp(after, target, targetDefinition, getDef)).toBe(
        baselineBp + 1000
      );
      expect(isCardRecoveryRestricted(after, target, getDef)).toBe(true);

      const protectedState = withImmunity(after, "spirit");
      expect(
        getEffectiveBp(protectedState, target, targetDefinition, getDef)
      ).toBe(baselineBp + (event === "summon" ? 1000 : 0));
      expect(isCardRecoveryRestricted(protectedState, target, getDef)).toBe(
        event === "summon"
      );
    }
  );

  it.each([false, true])(
    "own summon remains brave-only (combined=%s)",
    (combined) => {
      const state = setup(combined);
      const brave = state.cardInstances.find(
        (card) => card.instanceId === "brave"
      )!;
      expect(
        getAffectSourceCategories(
          state,
          brave,
          braveDefinition,
          getDef,
          summonTiming
        )
      ).toEqual(["brave"]);
      for (const category of ["spirit", "brave"] as const) {
        const protectedState = withImmunity(state, category);
        expect(
          isCardImmuneToOpponentEffect(
            protectedState,
            protectedState.cardInstances.find(
              (card) => card.instanceId === "target"
            )!,
            "alice",
            "none",
            {
              instance: brave,
              definition: braveDefinition,
              effectTiming: summonTiming,
            },
            getDef
          )
        ).toBe(category === "brave");
      }
    }
  );

  it.each(["spirit", "brave"] as const)(
    "a spirit-state brave's non-summon effect is blocked by %s immunity",
    (category) => {
      const state = withImmunity(setup(), category);
      const after = runCoreEffect(state, "attack");
      expect(
        after.cardInstances.find((card) => card.instanceId === "target")!
          .normalCoreCount
      ).toBe(4);
    }
  );

  it("a mixed summon/attack heading uses the actual summon event at the target and core-move gates", () => {
    const after = runCoreEffect(withImmunity(setup(), "spirit"), "summon");
    expect(
      after.cardInstances.find((card) => card.instanceId === "target")!
        .normalCoreCount
    ).toBe(3);
  });

  it.each(["summon", "attack"])(
    "legacy action gates preserve the actual %s timing",
    (event) => {
      const effect: Effect = {
        timing: mixedTiming,
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      };
      const after = executeEffect({
        state: withImmunity(setup(), "spirit"),
        effect,
        sourceInstanceId: "brave",
        actingPlayerId: "alice",
        chainId: `q378-exhaust:${event}`,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        effectEventAction: event,
        effectIndex: 0,
        targetInstanceIds: ["target"],
      });
      expect(
        after.cardInstances.find((card) => card.instanceId === "target")!
          .exhaustState
      ).toBe(event === "summon" ? "exhausted" : "recovered");
    }
  );

  it("combined-text summon effects belong to the host, unlike a brave's own summon effect", () => {
    const state = setup(true);
    const identity = resolveAffectSourceIdentity({
      state,
      sourceInstanceId: "host",
      effectSourceInstanceId: "brave",
      getCardDefinitionById: getDef,
    });
    expect(identity.instanceId).toBe("host");
    expect(
      getAffectSourceCategories(
        state,
        identity.instance,
        identity.definition!,
        getDef,
        summonTiming
      )
    ).toEqual(["spirit"]);
    expect(
      runCoreEffect(
        withImmunity(state, "spirit"),
        "summon",
        "host",
        "brave"
      ).cardInstances.find((card) => card.instanceId === "target")!
        .normalCoreCount
    ).toBe(4);
    expect(
      runCoreEffect(
        withImmunity(state, "brave"),
        "summon",
        "host",
        "brave"
      ).cardInstances.find((card) => card.instanceId === "target")!
        .normalCoreCount
    ).toBe(3);
  });

  it("Yuugen's spirit-effect bonus applies to non-summon brave effects, with the summon exception", () => {
    const state = rebuildContinuousEffectsFromField(setup(), getDef);
    expect(
      computeCoreMoveAmountBonus(
        state,
        "alice",
        "brave",
        getDef,
        undefined,
        attackTiming
      )
    ).toBe(1);
    expect(
      computeCoreMoveAmountBonus(
        state,
        "alice",
        "brave",
        getDef,
        undefined,
        summonTiming
      )
    ).toBe(0);
    expect(
      runCoreEffect(state, "attack").cardInstances.find(
        (card) => card.instanceId === "target"
      )!.normalCoreCount
    ).toBe(2);
    expect(
      runCoreEffect(state, "summon").cardInstances.find(
        (card) => card.instanceId === "target"
      )!.normalCoreCount
    ).toBe(3);
  });

  it("combined ownership grants the spirit bonus; an under-card text provider does not borrow it", () => {
    const state = rebuildContinuousEffectsFromField(setup(true), getDef);
    expect(
      computeCoreMoveAmountBonus(
        state,
        "alice",
        "host",
        getDef,
        "brave",
        summonTiming
      )
    ).toBe(1);
    const underState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "host"
          ? {
              ...card,
              attachedChildrenIds: [],
              underCards: [{ cardInstanceId: "brave", role: "text_role" }],
            }
          : card
      ),
    };
    expect(
      computeCoreMoveAmountBonus(
        underState,
        "alice",
        "host",
        getDef,
        "brave",
        attackTiming
      )
    ).toBe(0);
  });

  it("does not mistake merely containing summon for an actual summon timing", () => {
    expect(resolveEffectTimingAtEvent(mixedTiming, "attack")).toEqual(
      attackTiming
    );
    expect(resolveEffectTimingAtEvent(mixedTiming, "summon")).toEqual(
      summonTiming
    );
    expect(resolveEffectTimingAtEvent(mixedTiming, undefined)).toBe(
      mixedTiming
    );
    const stepContext = createStepExecutionContext(setup());
    stepContext.effectTiming = attackTiming;
    stepContext.effectActivationTiming = "stack";
    expect(
      deserializeStepContext(serializeStepContext(stepContext), setup())
        .effectTiming
    ).toEqual(attackTiming);
    expect(
      deserializeStepContext(serializeStepContext(stepContext), setup())
        .effectActivationTiming
    ).toBe("stack");
  });

  it("spirit bonus-core destinations include a spirit-state brave", () => {
    const state = setup();
    expect(
      resolveBonusCoreLocation(
        state,
        {
          kind: "field_card",
          player: "self",
          filter: { category: ["spirit"] },
        },
        "alice",
        getDef
      )
    ).toEqual({ kind: "card", instanceId: "brave" });
  });

  it("source-filter bonuses and redirects use effect categories including the summon exception", () => {
    const state = setup();
    const brave = state.cardInstances.find(
      (card) => card.instanceId === "brave"
    )!;
    const base: ContinuousEffect = {
      effectId: "bonus",
      sourceInstanceId: "host",
      sourceDefinitionId: spiritDefinition.cardNo,
      actingPlayerId: "alice",
      targetInstanceId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: "grant_optional_deck_reveal_count_boost",
      metadata: { sourceFilter: { category: ["spirit"] }, bonusAmount: 1 },
    };
    state.activeContinuousEffects = [base];
    expect(
      findApplicableDeckRevealCountBoostBonus(state, "alice", "brave", getDef, {
        effectTiming: attackTiming,
      })
    ).toBe(1);
    expect(
      findApplicableDeckRevealCountBoostBonus(state, "alice", "brave", getDef, {
        effectTiming: summonTiming,
      })
    ).toBeUndefined();
    state.activeContinuousEffects = [
      {
        ...base,
        modifierTag: "expand_effect_target_count",
        metadata: {
          sourceFilter: { category: ["spirit"] },
          targetFilter: { category: ["spirit"] },
          targetPlayer: "opponent",
          bonusAmount: 1,
        },
      },
    ];
    const stepContext = createStepExecutionContext(state);
    const target = state.cardInstances.find(
      (card) => card.instanceId === "target"
    )!;
    stepContext.effectTiming = attackTiming;
    const bonusOptions = {
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "brave",
      candidatePool: [target],
      getCardDefinitionById: getDef,
      stepContext,
    };
    expect(getExpandEffectTargetCountBonus(bonusOptions)).toBe(1);
    stepContext.effectTiming = summonTiming;
    expect(getExpandEffectTargetCountBonus(bonusOptions)).toBe(0);
    expect(
      getExpandEffectTargetCountBonusDeclarative({
        ...bonusOptions,
        registration: {
          targetCardFilter: { category: ["spirit"] },
          candidateTargetPlayerScope: "opponent",
        },
      })
    ).toBe(1);
    state.activeContinuousEffects = [
      {
        ...base,
        modifierTag: "redirect_effect_target",
        targetInstanceId: "target",
        actingPlayerId: "bob",
        metadata: {
          triggerCondition: {
            sourcePlayerRef: "opponent",
            sourceFilter: { category: ["spirit"] },
            protectedTargetKind: "instances",
            protectedInstanceIds: ["target"],
          },
          redirectCandidateSource: { kind: "explicit", instanceIds: ["host"] },
          optional: true,
        },
      },
    ];
    expect(
      findApplicableTargetRedirects(
        state,
        ["target"],
        "alice",
        "none",
        {
          instance: brave,
          definition: braveDefinition,
          effectTiming: attackTiming,
        },
        getDef
      )
    ).toHaveLength(1);
    expect(
      findApplicableTargetRedirects(
        state,
        ["target"],
        "alice",
        "none",
        {
          instance: brave,
          definition: braveDefinition,
          effectTiming: summonTiming,
        },
        getDef
      )
    ).toHaveLength(0);
  });

  it("parameter, duration, and required-cost filters share the resolving effect's categories", () => {
    const state = setup();
    const base: ContinuousEffect = {
      effectId: "param",
      sourceInstanceId: "host",
      sourceDefinitionId: spiritDefinition.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: "effect_param_override",
      targetFilter: { player: "self", category: ["spirit"] },
      metadata: {
        effectClass: "cost_exhaust",
        scope: "player_cards",
        addLimitAmount: 3,
      },
    };
    state.activeContinuousEffects = [base];
    for (const [timing, expected] of [
      [attackTiming, 5],
      [summonTiming, 2],
    ] as const) {
      expect(
        applyEffectParamOverridesToFilter(
          { maxCost: 2 },
          "cost_exhaust",
          "brave",
          state,
          getDef,
          { effectTiming: timing }
        ).maxCost
      ).toBe(expected);
    }
    state.activeContinuousEffects = [
      {
        ...base,
        modifierTag: "duration_override",
        metadata: {
          fromScope: "turn",
          toDuration: { scope: "battle", nextBattleEnd: true },
        },
      },
    ];
    const originating: ContinuousEffect = {
      ...base,
      sourceInstanceId: "brave",
      sourceDefinitionId: braveDefinition.cardNo,
      modifierTag: "bp_modifier",
      modifierAmount: 1000,
      duration: { scope: "turn" },
      provenance: { effectIndex: 0, stepIndex: 0, effectTiming: attackTiming },
    };
    expect(getEffectiveDuration(state, originating, getDef)).toEqual({
      scope: "battle",
      nextBattleEnd: true,
    });
    expect(
      getEffectiveDuration(
        state,
        {
          ...originating,
          provenance: {
            effectIndex: 0,
            stepIndex: 0,
            effectTiming: summonTiming,
          },
        },
        getDef
      )
    ).toEqual({ scope: "turn" });
    state.activeContinuousEffects = [
      {
        ...base,
        modifierTag: "required_effect_cost",
        targetInstanceId: "alice",
        metadata: {
          rule: {
            kind: "require_effect_cost",
            player: "self",
            amount: 1,
            events: ["summon", "attack"],
            categories: ["spirit"],
            sourceFilter: { category: ["spirit"] },
            duration: { scope: "permanent" },
          },
        },
      },
    ];
    // The printed-heading gate is independent of the sourceFilter category gate.
    const headedEffect: Effect = {
      ...coreEffect,
      heading: "『このスピリットの召喚/アタック時』",
    };
    const brave = state.cardInstances.find(
      (card) => card.instanceId === "brave"
    )!;
    expect(
      withRequiredEffectCost(
        state,
        headedEffect,
        brave,
        "alice",
        getDef,
        "attack"
      ).steps[0]!.id
    ).toBe("required-effect-cost");
    expect(
      withRequiredEffectCost(
        state,
        headedEffect,
        brave,
        "alice",
        getDef,
        "summon"
      )
    ).toBe(headedEffect);
  });
});
