import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardFilter,
  type CardDefinition,
  type ContinuousEffect,
  type Effect,
  type GameState,
} from "../src";
import {
  matchesCardFilter,
  matchesCardReferenceFilter,
} from "../src/card/card-filter";
import { evaluateStatelessSourceCount } from "../src/legal/legal-actions-shared";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { findApplicableDeckRevealCountBoostBonus } from "../src/effect/deck-reveal-count-boost";
import { evaluateStepCondition } from "../src/effect/native-condition-connector";
import {
  createStepExecutionContext,
  recordStepResult,
} from "../src/step-execution-context";
import { executeMatchingRetriggers } from "../src/effect/retrigger-system";
import { calculateReduction } from "../src/core/cost-system";
import { getActiveSymbolAdditionRestriction } from "../src/effect/effect-affect-adapter";
import { getExpandEffectTargetCountBonus } from "../src/effect/expand-effect-target-count";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};
const benimaru = getCardDefinitionById("BSTS01-M02")!;
const rimuru = getCardDefinitionById("BSTS01-X02")!;
const god = getCardDefinitionById("BSSA01-XX01")!;
const nexus = getCardDefinitionById("BSTS01-C05")!;
const specialNexuses = [
  god,
  ALL_CARDS.find(
    (c) => c.printedCategory === "nexus" && c.grandwalkerData?.kind === "guided"
  )!,
  ALL_CARDS.find(
    (c) => c.printedCategory === "nexus" && c.grandstoneData != null
  )!,
];

function makeState(targetNo = god.cardNo, copies = 1): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { countValue: 14 },
        { lifeNormalCoreCount: 6, reserveNormalCoreCount: 3 },
      ],
      cardInstances: [
        ...Array.from({ length: copies }, (_, i) =>
          createCardInstance(benimaru, {
            instanceId: `benimaru-${i}`,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          })
        ),
        createCardInstance(rimuru, {
          instanceId: "rimuru",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(getCardDefinitionById(targetNo)!, {
          instanceId: "victim",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
    }),
    activePlayerId: "alice",
    turnNumber: 5,
    step: "attack",
    window: "declare_attack",
  };
}

function destroy(state: GameState): GameState {
  const after = executeEffect({
    chainId: "test:special-nexus-reference:101",
    state,
    effect: rimuru.effects![1]!,
    sourceInstanceId: "rimuru",
    actingPlayerId: "alice",
    targetInstanceIds: ["victim"],
    ...lookups,
  });
  let queued = collectAndQueueTriggerReactions({
    beforeState: state,
    afterState: after,
    source: "action_resolution",
    chainId: "test:special-nexus-reference:109",
    causedByPlayerId: "alice",
    ...lookups,
  });
  for (const player of ["alice", "bob"]) {
    const burstCheck = actions(queued, player).find(
      (a) => a.kind === "resolve_pending_burst_check"
    );
    if (burstCheck)
      queued = applyLegalAction({
        state: queued,
        action: burstCheck,
        ...lookups,
      }).state;
  }
  return queued;
}

const actions = (state: GameState, actingPlayerId = "alice") =>
  getLegalActions({ state, actingPlayerId, ...lookups }).filter((a) => a.can);
const triggers = (state: GameState) =>
  actions(state).filter(
    (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
  );

describe("創界神ネクサスの参照と効果対象を区別する (公式 Q1532)", () => {
  it.each(specialNexuses)(
    "$cardNo: ネクサスのシンボル供給元参照に軽減上限を適用する",
    (definition) => {
      const supply: CardDefinition = {
        ...definition,
        effects: [],
        symbolColors: ["red", "red"],
      };
      const demand: CardDefinition = {
        ...benimaru,
        effects: [],
        cost: 3,
        reductionSymbols: ["red", "red"],
      };
      const getDef = (id: string) =>
        id === supply.cardNo ? supply : getCardDefinitionById(id);
      const state = makeState(supply.cardNo);
      const options = {
        state,
        actingPlayerId: "bob",
        card: demand,
        getCardDefinitionById: getDef,
      };
      expect(calculateReduction(options).totalReduction).toBe(2);
      state.activeContinuousEffects.push({
        effectId: "nexus-symbol-limit",
        sourceInstanceId: "benimaru-0",
        sourceDefinitionId: benimaru.cardNo,
        actingPlayerId: "alice",
        targetInstanceId: "bob",
        modifierTag: "limit_cost_reduction",
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        duration: { scope: "turn" },
        metadata: { sourceFilter: { category: ["nexus"] }, maxSymbols: 1 },
      });
      expect(
        calculateReduction({
          ...options,
          state: {
            ...state,
            activeContinuousEffects: [...state.activeContinuousEffects],
          },
        }).totalReduction
      ).toBe(1);
    }
  );

  it.each(specialNexuses)(
    "$cardNo: シンボル追加制限がネクサスの発生源を参照する",
    (definition) => {
      const state = makeState(definition.cardNo);
      state.activeContinuousEffects.push({
        effectId: "symbol-add-limit",
        sourceInstanceId: "benimaru-0",
        sourceDefinitionId: benimaru.cardNo,
        actingPlayerId: "alice",
        targetInstanceId: "bob",
        modifierTag: "restrict_symbol_addition",
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        duration: { scope: "turn" },
        metadata: { sourceFilter: { category: ["nexus"] }, maxTotal: 1 },
      });
      expect(
        getActiveSymbolAdditionRestriction(
          state,
          "bob",
          state.cardInstances.find((c) => c.instanceId === "victim"),
          definition,
          getCardDefinitionById
        )
      ).toEqual({ effectId: "symbol-add-limit", maxTotal: 1 });
    }
  );

  it.each(specialNexuses)(
    "$cardNo: 対象枚数補正は合法な候補だけをネクサスとして参照する",
    (definition) => {
      const state = makeState(definition.cardNo);
      const victim = state.cardInstances.find(
        (c) => c.instanceId === "victim"
      )!;
      state.activeContinuousEffects.push({
        effectId: "nexus-target-count",
        sourceInstanceId: "benimaru-0",
        sourceDefinitionId: benimaru.cardNo,
        actingPlayerId: "alice",
        targetInstanceId: "alice",
        modifierTag: "expand_effect_target_count",
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        duration: { scope: "turn" },
        metadata: {
          sourceFilter: { category: ["ultimate"] },
          targetPlayer: "opponent",
          targetFilter: { category: ["nexus"] },
          bonusAmount: 1,
        },
      });
      const options = {
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "rimuru",
        getCardDefinitionById,
      };
      const legalPool = state.cardInstances.filter((c) =>
        matchesCardFilter(c, getCardDefinitionById(c.definitionId)!, {
          category: ["nexus"],
        })
      );
      expect(
        getExpandEffectTargetCountBonus({
          ...options,
          candidatePool: legalPool,
        })
      ).toBe(0);
      expect(
        getExpandEffectTargetCountBonus({ ...options, candidatePool: [victim] })
      ).toBe(1);
    }
  );

  it.each(specialNexuses)(
    "$cardNo: 付与された配置時誘発でもネクサスとして参照する",
    (definition) => {
      const state = makeState(definition.cardNo);
      const grantedEffect: Effect = {
        timing: {
          kind: "game_event",
          event: "place",
          player: "opponent",
          sourceWhose: "either",
          triggerFilter: { category: ["nexus"] },
        },
        steps: [],
      };
      state.activeContinuousEffects.push({
        effectId: "nexus-place-grant",
        sourceInstanceId: "benimaru-0",
        sourceDefinitionId: benimaru.cardNo,
        actingPlayerId: "alice",
        targetInstanceId: "benimaru-0",
        modifierTag: "granted_effect",
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        duration: { scope: "turn" },
        metadata: { grantedEffect },
      });
      const after = queueGrantedEffectTriggersFromTriggerEvents(
        state,
        [
          {
            chainId: "test:special-nexus-reference:291",
            eventKind: "place",
            relatedInstanceId: "victim",
            relatedPlayerId: "bob",
          },
        ],
        getCardDefinitionById
      );
      expect(after.pendingTriggeredEffects).toHaveLength(1);
      expect(after.pendingTriggeredEffects[0]?.mechanic?.kind).toBe(
        "granted_effect"
      );
    }
  );

  it.each(specialNexuses)(
    "$cardNo: 創界神系の参照は通り、破壊対象の既定制限は維持する",
    (definition) => {
      const state = makeState(definition.cardNo);
      const victim = state.cardInstances.find(
        (c) => c.instanceId === "victim"
      )!;
      const filter: CardFilter = {
        filterOr: [{ category: ["nexus"] }, { category: ["ultimate"] }],
      };
      expect(matchesCardReferenceFilter(victim, definition, filter)).toBe(true);
      expect(matchesCardFilter(victim, definition, filter)).toBe(false);
      const step = createStepExecutionContext(state);
      recordStepResult(step, {
        stepId: "observed",
        succeeded: true,
        affectedCardInstanceIds: [victim.instanceId],
      });
      expect(
        evaluateStepCondition(
          { kind: "ref_has_match", stepId: "observed", filter },
          step,
          state,
          getCardDefinitionById
        )
      ).toBe(true);
    }
  );

  it.each(specialNexuses)(
    "$cardNo: ネクサス効果によるオープン枚数を参照できる",
    (definition) => {
      const state = makeState(definition.cardNo);
      const ce: ContinuousEffect = {
        effectId: "reference-boost",
        sourceInstanceId: "benimaru-0",
        sourceDefinitionId: benimaru.cardNo,
        targetInstanceId: "bob",
        actingPlayerId: "bob",
        modifierTag: "grant_optional_deck_reveal_count_boost",
        duration: { scope: "turn" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        metadata: { sourceFilter: { category: ["nexus"] }, bonusAmount: 1 },
      };
      state.activeContinuousEffects.push(ce);
      expect(
        findApplicableDeckRevealCountBoostBonus(
          state,
          "bob",
          "victim",
          getCardDefinitionById
        )
      ).toBe(1);
    }
  );

  it.each(specialNexuses)(
    "$cardNo: 遅延したネクサス配置時の誘発も参照できる",
    (definition) => {
      const state = makeState(definition.cardNo);
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
            retrigger: {
              event: "place",
              triggerPlayer: "opponent",
              triggerFilter: { category: ["nexus"] },
              maxCount: 1,
              duration: { scope: "turn" },
            },
          },
        ],
      };
      const getDef = (id: string) =>
        id === benimaru.cardNo
          ? { ...benimaru, effects: [effect] }
          : getCardDefinitionById(id);
      const registered = executeEffect({
        chainId: "test:special-nexus-reference:391",
        state,
        sourceInstanceId: "benimaru-0",
        actingPlayerId: "alice",
        ...lookups,
        effect,
        effectIndex: 0,
        getCardDefinitionById: getDef,
      });
      const after = executeMatchingRetriggers({
        state: registered,
        event: "place",
        triggerCard: registered.cardInstances.find(
          (c) => c.instanceId === "victim"
        )!,
        triggerCardDefinition: definition,
        ...lookups,
        getCardDefinitionById: getDef,
      });
      expect(after.players[1]?.lifeNormalCoreCount).toBe(5);
      expect(after.players[1]?.reserveNormalCoreCount).toBe(4);
    }
  );

  it.each(specialNexuses)(
    "$cardNo: ライフ保護がネクサス効果の発生源を参照する",
    (definition) => {
      for (const action of [
        { kind: "life_damage", player: "opponent", amount: 1 },
        {
          kind: "core_move",
          from: { kind: "life", player: "opponent" },
          to: { kind: "reserve", player: "opponent" },
          amount: 1,
        },
      ] as const) {
        const state = makeState(definition.cardNo);
        state.activeContinuousEffects.push({
          effectId: "nexus-life-protection",
          sourceInstanceId: "benimaru-0",
          sourceDefinitionId: benimaru.cardNo,
          actingPlayerId: "alice",
          targetInstanceId: "alice",
          modifierTag: "life_damage_interception",
          createdAtTurn: state.turnNumber,
          createdAtAttackId: null,
          duration: { scope: "turn" },
          metadata: {
            cause: "any",
            mode: "replace",
            turnThreshold: 1,
            floor: 0,
            attackerFilter: { category: ["nexus"] },
          },
        });
        const beforeLife = state.players[0]!.lifeNormalCoreCount;
        const after = executeEffect({
          chainId: "test:special-nexus-reference:447",
          state,
          sourceInstanceId: "victim",
          actingPlayerId: "bob",
          effect: {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action }],
          },
          ...lookups,
        });
        expect(after.players[0]?.lifeNormalCoreCount).toBe(beforeLife);
      }
    }
  );
  it.each([god.cardNo, nexus.cardNo])(
    "BSTS01-X02で%sを破壊するとBSTS01-M02が誘発しライフをリザーブへ置く",
    (cardNo) => {
      let state = destroy(makeState(cardNo, 2));
      expect(
        state.cardInstances.find((c) => c.instanceId === "victim")
          ?.pendingLeaveKind
      ).toBe("destroy");
      const trigger = triggers(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "benimaru-0"
      );
      expect(
        trigger,
        JSON.stringify({
          actions: ["alice", "bob"].flatMap((actingPlayerId) =>
            getLegalActions({ state, actingPlayerId, ...lookups })
          ),
          stack: state.stackWindow,
          preGame: state.preGame,
        })
      ).toBeDefined();
      state = applyLegalAction({ state, action: trigger!, ...lookups }).state;
      const pass = actions(state, "bob").find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      state = applyLegalAction({ state, action: pass!, ...lookups }).state;
      expect(state.players[1]?.lifeNormalCoreCount).toBe(5);
      expect(state.players[1]?.reserveNormalCoreCount).toBe(4);
      expect(triggers(state)).toHaveLength(0);
    }
  );

  it("Lv1・相手アタックステップでは誘発しない", () => {
    const lowLevel = makeState();
    lowLevel.cardInstances[0]!.normalCoreCount = 1;
    expect(triggers(destroy(lowLevel))).toHaveLength(0);
    expect(
      triggers(destroy({ ...makeState(), activePlayerId: "bob" }))
    ).toHaveLength(0);
  });

  it("ネクサスの存在・枚数の参照に創界神を含む", () => {
    const state = makeState();
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_has", player: "opponent", category: ["nexus"] }],
        "benimaru-0",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "cards_in_zone",
            player: "opponent",
            zone: "field",
            filter: { category: ["nexus"] },
            min: 1,
          },
        ],
        "benimaru-0",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      evaluateStatelessSourceCount(
        state,
        "alice",
        {
          kind: "cards_in_zone",
          player: "opponent",
          zone: "field",
          filter: {
            filterOr: [{ category: ["nexus"] }, { category: ["ultimate"] }],
          },
        },
        getCardDefinitionById
      )
    ).toBe(1);
  });

  it("通常のネクサス破壊は創界神を選べず、参照のOR・除外・onlyも保持する", () => {
    const state = makeState();
    const victim = state.cardInstances.find((c) => c.instanceId === "victim")!;
    const filter: CardFilter = { category: ["nexus"] };
    expect(matchesCardFilter(victim, god, filter)).toBe(false);
    expect(matchesCardReferenceFilter(victim, god, filter)).toBe(true);
    expect(
      matchesCardReferenceFilter(victim, god, {
        filterOr: [filter],
        exclude: { cardName: { exact: god.name } },
      })
    ).toBe(false);
    expect(
      matchesCardReferenceFilter(victim, god, {
        targetsGrandwalker: "only",
        grandwalkerKind: "guided",
      })
    ).toBe(false);
    const ordinary = createCardInstance(nexus, {
      instanceId: "ordinary",
      ownerPlayerId: "bob",
      zone: "field",
    });
    expect(
      matchesCardReferenceFilter(ordinary, nexus, {
        targetsGrandwalker: "only",
      })
    ).toBe(false);
    expect(
      matchesCardReferenceFilter(victim, god, filter, {
        soulStateIds: new Set([victim.instanceId]),
      })
    ).toBe(false);
    const after = executeEffect({
      chainId: "test:special-nexus-reference:581",
      state,
      effect: benimaru.effects![1]!,
      sourceInstanceId: "benimaru-0",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "victim")
        ?.pendingLeaveKind
    ).toBeNull();
  });
});
