import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  sanitizeStateForSpectator,
  type CardDefinition,
  type GameState,
  type LegalAction,
  type SupplementalTriggerEvent,
} from "../src";
import type { Effect } from "../src/dsl-types";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  pruneIllegalPendingTriggeredEffects,
} from "../src/effect/trigger-system";
import { captureTriggerObservation } from "../src/effect/trigger-observation-sources";
import {
  captureTriggerEventFacts,
  getTriggerEventFactFilterOptions,
} from "../src/effect/trigger-event-facts";
import { getTriggeredMechanicActivationState } from "../src/effect/triggered-mechanic-eligibility";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";

const definition: CardDefinition = {
  cardNo: "TEST-GRANTED-DYNAMIC",
  name: "付与済みの同時誘発",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 3, bp: 3000 },
  ],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "exhaust" },
      executionMode: "optional",
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "void", player: "self" },
            to: { kind: "this_card" },
            amount: 1,
          },
        },
      ],
    },
  ],
};
const deps = {
  getCardDefinitionById: (id: string) =>
    id === definition.cardNo ? definition : undefined,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([definition]),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function base() {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { voidNormalCoreCount: 20, reserveNormalCoreCount: 0 },
        {},
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
          exhaustState: "exhausted",
        }),
      ],
    }),
    step: "main" as const,
    turnNumber: 3,
  };
}
function grant(state: GameState, applicability = false, eventCondition = true) {
  const effect: Effect = {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "grant_effect",
          target: { kind: "self" },
          duration: { scope: "turn" },
          grantedEffect: {
            timing: { kind: "card_event", event: "exhaust" },
            executionMode: "optional",
            ...(applicability ? { applicability: { level: { min: 2 } } } : {}),
            condition: [
              ...(eventCondition
                ? [
                    {
                      kind: "trigger_colors" as const,
                      colors: ["red" as const],
                    },
                  ]
                : []),
              ...(!applicability
                ? [{ kind: "min_level" as const, value: 2 }]
                : []),
            ],
            steps: [
              {
                action: {
                  kind: "core_move",
                  from: { kind: "void", player: "self" },
                  to: { kind: "reserve", player: "self" },
                  amount: 2,
                },
              },
            ],
          },
        },
      },
    ],
  };
  return executeEffect({
    state,
    effect,
    sourceInstanceId: "observer",
    actingPlayerId: "alice",
    chainId: "grant-setup",
    ...deps,
  });
}
function event(state: GameState): SupplementalTriggerEvent {
  return {
    eventKind: "exhaust",
    source: "action_resolution",
    chainId: "grant-event",
    attackId: null,
    actingPlayerId: "alice",
    relatedPlayerId: "alice",
    relatedInstanceId: "observer",
    amount: null,
    observationSnapshot: captureTriggerObservation(state),
  };
}
function queued(applicability = false) {
  const state = grant(base(), applicability);
  return collectAndQueueTriggerReactions({
    beforeState: state,
    afterState: state,
    source: "action_resolution",
    chainId: "grant-event",
    supplementalEvents: [event(state)],
    ...deps,
  });
}
function act(
  state: GameState,
  predicate: (action: LegalAction) => boolean,
  extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  const legal = ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
  const action = legal.find(predicate);
  expect(action, JSON.stringify(legal)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...deps, ...extra }).state;
}
function resolve(
  state: GameState,
  granted: boolean,
  skipOptionalEffect = false
) {
  state = act(
    state,
    (action) =>
      (action.kind === "resolve_pending_triggered_effect" ||
        action.kind === "select_pending_to_resolve") &&
      action.sourceInstanceId === "observer" &&
      (granted
        ? action.registrationIndex === undefined
        : action.registrationIndex !== undefined),
    { skipOptionalEffect }
  );
  for (let i = 0; state.stackWindow && i < 12; i++)
    state = act(state, (action) => action.kind === "pass_stack");
  return state;
}
function grantedPending(state: GameState) {
  return state.pendingTriggeredEffects.find(
    (pending) => pending.mechanic?.kind === "granted_effect"
  );
}

describe("付与登録の同時誘発条件", () => {
  it("抑止中の事象は後解除で復活せず、同集約内の後続の正規事象だけが誘発する", () => {
    const granted = grant(base(), true, false);
    const ready: GameState = {
      ...granted,
      cardInstances: granted.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 3,
        exhaustState: "exhausted",
      })),
    };
    const suppressed: GameState = {
      ...ready,
      activeContinuousEffects: [
        ...ready.activeContinuousEffects,
        {
          effectId: "suppress-grant",
          sourceInstanceId: "observer",
          sourceDefinitionId: definition.cardNo,
          actingPlayerId: "alice",
          targetInstanceId: "observer",
          modifierTag: "effect_suppression",
          duration: { scope: "turn" },
          createdAtTurn: ready.turnNumber,
          createdAtAttackId: null,
          metadata: {},
        },
      ],
    };
    const observed = event(suppressed);
    observed.eventFactOccurrences = [
      captureTriggerEventFacts(
        suppressed,
        observed,
        deps.getCardDefinitionById
      ),
    ];
    expect(
      grantedPending(
        queueGrantedEffectTriggersFromTriggerEvents(
          ready,
          [observed],
          deps.getCardDefinitionById
        )
      )
    ).toBeUndefined();
    observed.eventFactOccurrences.push(
      captureTriggerEventFacts(ready, observed, deps.getCardDefinitionById)
    );
    const state = resolve(
      queueGrantedEffectTriggersFromTriggerEvents(
        ready,
        [observed],
        deps.getCardDefinitionById
      ),
      true
    );
    expect(state.players[0]?.reserveNormalCoreCount).toBe(2);
  });
  it("付与の事象filterは後段の色追加を見ず、事象時の色だけで発揮する", () => {
    const granted = grant(base(), true, false);
    const prepared: GameState = {
      ...granted,
      cardInstances: granted.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 3,
      })),
      activeContinuousEffects: granted.activeContinuousEffects.map((ce) =>
        ce.modifierTag !== "granted_effect"
          ? ce
          : {
              ...ce,
              metadata: {
                ...ce.metadata,
                grantedEffect: {
                  ...(ce.metadata?.grantedEffect as Effect),
                  timing: {
                    kind: "game_event",
                    event: "exhaust",
                    player: "self",
                    triggerFilter: { colors: ["purple"] },
                  },
                } satisfies Effect,
              },
            }
      ),
    };
    const purple: GameState = {
      ...prepared,
      activeContinuousEffects: [
        ...prepared.activeContinuousEffects,
        {
          effectId: "purple-grantee",
          sourceInstanceId: "observer",
          sourceDefinitionId: definition.cardNo,
          actingPlayerId: "alice",
          targetInstanceId: "observer",
          modifierTag: "treat_as_color",
          modifierSymbol: ["purple"],
          duration: { scope: "turn" },
          createdAtTurn: prepared.turnNumber,
          createdAtAttackId: null,
        },
      ],
    };
    const queue = (atEvent: GameState, after: GameState) => {
      const observed = event(atEvent);
      observed.eventFactOccurrences = [
        captureTriggerEventFacts(atEvent, observed, deps.getCardDefinitionById),
      ];
      return queueGrantedEffectTriggersFromTriggerEvents(
        after,
        [observed],
        deps.getCardDefinitionById
      );
    };
    expect(grantedPending(queue(prepared, purple))).toBeUndefined();
    expect(
      getTriggerEventFactFilterOptions(
        captureTriggerEventFacts(
          purple,
          event(purple),
          deps.getCardDefinitionById
        ),
        "observer"
      ).effectiveColors
    ).toContain("purple");
    const queued = queue(purple, prepared);
    expect(grantedPending(queued)).toBeDefined();
    const state = resolve(queued, true);
    expect(state.players[0]?.reserveNormalCoreCount).toBe(2);
  });
  it.each([false, true])(
    "Lv条件のcarrierがapplicability=%sでも、兄弟解決後だけ宣言して完走する",
    (applicability) => {
      let state = queued(applicability);
      const pending = grantedPending(state)!;
      expect(pending).toBeDefined();
      expect(pending.dormantMechanic).toBe(true);
      expect(
        getTriggeredMechanicActivationState(
          state,
          pending.mechanic!,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(false);
      state = resolve(state, false);
      expect(state.cardInstances[0]!.normalCoreCount).toBe(3);
      expect(
        getTriggeredMechanicActivationState(
          state,
          grantedPending(state)!.mechanic!,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(true);
      state = resolve(JSON.parse(JSON.stringify(state)) as GameState, true);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );

  it.each([false, true])(
    "集約した疲労事象では条件を満たす観測を1回だけ発揮する (reverse=%s)",
    (reverse) => {
      const initial = grant(base(), true, false);
      const prepared: GameState = {
        ...initial,
        cardInstances: initial.cardInstances.map((card) => ({
          ...card,
          normalCoreCount: 3,
        })),
        activeContinuousEffects: initial.activeContinuousEffects.map((ce) =>
          ce.modifierTag === "granted_effect"
            ? {
                ...ce,
                metadata: {
                  ...ce.metadata,
                  grantedEffect: {
                    ...(ce.metadata?.grantedEffect as Effect),
                    condition: [{ kind: "trigger_colors", colors: ["purple"] }],
                  } satisfies Effect,
                },
              }
            : ce
        ),
      };
      const purple: GameState = {
        ...prepared,
        activeContinuousEffects: [
          ...prepared.activeContinuousEffects,
          {
            effectId: "purple-occurrence-subject",
            sourceInstanceId: "observer",
            sourceDefinitionId: definition.cardNo,
            actingPlayerId: "alice",
            targetInstanceId: "observer",
            modifierTag: "treat_as_color",
            modifierSymbol: ["purple"],
            duration: { scope: "turn" },
            createdAtTurn: prepared.turnNumber,
            createdAtAttackId: null,
          },
        ],
      };
      const aggregate = event(prepared);
      aggregate.eventFactOccurrences = (
        reverse ? [purple, prepared] : [prepared, purple]
      ).map((state) =>
        captureTriggerEventFacts(state, aggregate, deps.getCardDefinitionById)
      );
      const queued = queueGrantedEffectTriggersFromTriggerEvents(
        prepared,
        [aggregate],
        deps.getCardDefinitionById
      );
      expect(
        queued.pendingTriggeredEffects.filter(
          (pending) => pending.mechanic?.kind === "granted_effect"
        )
      ).toHaveLength(1);
      expect(resolve(queued, true).players[0]?.reserveNormalCoreCount).toBe(2);
    }
  );

  it("最後の兄弟を辞退すると未成立付与は失効し、後のLv上昇で戻らない", () => {
    let state = resolve(queued(), false, true);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    state = {
      ...state,
      cardInstances: state.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 3,
      })),
    };
    expect(
      pruneIllegalPendingTriggeredEffects({ state, ...deps })
        .pendingTriggeredEffects
    ).toHaveLength(0);
  });

  it("同じ事象の後に新たに付与した効果を、元の事象へ追加しない", () => {
    const before = base();
    const after = grant(before);
    const state = queueGrantedEffectTriggersFromTriggerEvents(
      after,
      [event(before)],
      deps.getCardDefinitionById
    );
    expect(grantedPending(state)).toBeUndefined();
  });

  it("観測時に場にいなかった被付与個体は過去の事象を拾わない", () => {
    const state = grant(base());
    const e = event({
      ...state,
      cardInstances: state.cardInstances.map((card) => ({
        ...card,
        zone: "hand",
      })),
    });
    expect(
      grantedPending(
        queueGrantedEffectTriggersFromTriggerEvents(
          state,
          [e],
          deps.getCardDefinitionById
        )
      )
    ).toBeUndefined();
  });

  it("イベント述語の観測結果を正式保存に保持し、観戦配送の入れ子から除く", () => {
    const state = queued();
    const mechanic = grantedPending(state)!.mechanic;
    expect(
      mechanic?.kind === "granted_effect" && mechanic.eventConditionResults
    ).toEqual({ "0": true });
    expect(JSON.stringify(sanitizeStateForSpectator(state))).not.toContain(
      "eventConditionResults"
    );
  });
});
