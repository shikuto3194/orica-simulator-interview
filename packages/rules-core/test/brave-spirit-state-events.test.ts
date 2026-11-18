import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBraveSpiritEventsScenario } from "../../../apps/playground-web/src/scenario-brave-spirit-events";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createGameSnapshot,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  restoreSnapshot,
  getAvailableBurstSourceChoices,
  executeDestroy,
  executeEffectResistance,
  evaluateCondition,
  executeEffect,
  calculateReduction,
  type CardDefinition,
  type CardEventType,
  type GameState,
  type LegalAction,
} from "../src";
import { queuePendingReactionsFromTriggerEvents } from "../src/effect/trigger-system";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { buildBraveSemanticEventsScenario } from "../../../apps/playground-web/src/scenario-brave-semantic-events";
import { matchesCardReferenceFilter } from "../src/card/card-filter";
import { getExpandEffectTargetCountBonus } from "../src/effect/expand-effect-target-count";
import { getApplicableAdditionalCostDelta } from "../src/card/card-filter";
import { matchesUnsealCardEvent } from "../src/mechanics/grandstone-system";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => cards.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBurstActions: buildBurstEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
};
const actions = (state: GameState) =>
  ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...options })
    )
    .filter((a) => a.can);
function apply(state: GameState, kind: LegalAction["kind"]) {
  const action = actions(state).find((a) => a.kind === kind);
  expect(
    action,
    `missing ${kind}: ${actions(state).map((a) => a.kind)}`
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options }).state;
}

describe("スピリット状態ブレイヴの疲労による転醒", () => {
  it.each(["bsth03", "bsth06"])(
    "%s: 添付の BSSL01-R03 のアタックを実操作し、保存復元後に転醒を解決",
    (nexus) => {
      let state = buildBraveSpiritEventsScenario(
        cards,
        new URLSearchParams({ nexus })
      );
      state = apply(state, "attack");
      if (state.preDeclarationStackWindow)
        state = apply(state, "pass_pre_declaration_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "card-77")
          ?.exhaustState
      ).toBe("exhausted");
      expect(
        state.pendingTriggeredEffects.some(
          (p) => p.eventKind === "exhaust" && p.relatedInstanceId === "card-77"
        )
      ).toBe(true);
      state = restoreSnapshot(
        JSON.parse(JSON.stringify(createGameSnapshot(state))),
        getDef,
        options
      ).state;
      const choose = actions(state).find(
        (a) =>
          a.kind === "select_pending_to_resolve" && a.eventKind === "exhaust"
      );
      if (choose)
        state = applyLegalAction({ state, action: choose, ...options }).state;
      state = apply(state, "resolve_pending_triggered_effect");
      if (state.stackWindow) state = apply(state, "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "card-1")?.definitionId
      ).toBe(nexus === "bsth03" ? "BSTH03-転醒R01(B)" : "BSTH06-転醒R01(B)");
      expect(state.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    }
  );
});

const fieldEvents = [
  "attack",
  "block",
  "exhaust",
  "recover",
  "destroy",
  "vanish",
  "bounce",
  "remove_from_game",
  "leave_field",
  "targeted",
  "rebirth",
  "battle_end",
  "battle_destroy_opponent_only",
  "soul_state_to_spirit_state",
] as const;
const printedEvents = ["summon", "place", "put", "brave_combined"] as const;
function observerFixture(event: CardEventType, category: "spirit" | "brave") {
  const braveDef = {
    ...getDef("BSSL01-R03")!,
    cardNo: `AUDIT-BRAVE-${event}-${category}`,
    effects: [],
  };
  const observerDef: CardDefinition = {
    ...getDef("BSTH03-転醒R01(A)")!,
    cardNo: `EVENT-OBSERVER-${event}-${category}`,
    isDoubleSided: false,
    backFace: undefined,
    textLines: [],
    effects: [
      {
        timing: {
          kind: "game_event",
          event,
          player: "either",
          sourceWhose: "either",
          triggerFilter: { category: [category] },
        },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  const definitions = [braveDef, observerDef];
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(braveDef, {
        instanceId: "brave",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
        ...(event === "exhaust" ? { exhaustState: "exhausted" as const } : {}),
      }),
      createCardInstance(observerDef, {
        instanceId: "observer",
        ownerPlayerId: "alice",
        zone: "field",
      }),
    ],
  });
  return {
    state,
    definitions,
    getCardDefinitionById: (id: string) =>
      definitions.find((c) => c.cardNo === id),
  };
}

describe("場のイベントと印字イベントの境界", () => {
  it("場のスピリット数で決まる動的追加コストに単体ブレイヴを数える", () => {
    const fixture = observerFixture("exhaust", "spirit");
    fixture.state.activeContinuousEffects.push({
      effectId: "dynamic-cost",
      sourceInstanceId: "observer",
      sourceDefinitionId: fixture.definitions[1]!.cardNo,
      actingPlayerId: "alice",
      modifierTag: "additional_cost",
      targetFilter: { player: "self" },
      createdAtTurn: fixture.state.turnNumber,
      createdAtAttackId: null,
      duration: { scope: "turn" },
      modifierAmountDynamic: {
        source: {
          kind: "cards_in_zone",
          player: "opponent",
          zone: "field",
          filter: { category: ["spirit"] },
        },
      },
    });
    expect(
      getApplicableAdditionalCostDelta(
        fixture.state,
        "alice",
        fixture.definitions[1]!,
        { getCardDefinitionById: fixture.getCardDefinitionById }
      )
    ).toBe(1);
  });
  it("対象数加算は候補プールの単体ブレイヴをスピリットに含む", () => {
    const fixture = observerFixture("exhaust", "spirit");
    fixture.state.activeContinuousEffects.push({
      effectId: "expand",
      sourceInstanceId: "observer",
      sourceDefinitionId: fixture.definitions[1]!.cardNo,
      actingPlayerId: "alice",
      targetInstanceId: "alice",
      modifierTag: "expand_effect_target_count",
      createdAtTurn: fixture.state.turnNumber,
      createdAtAttackId: null,
      duration: { scope: "turn" },
      metadata: {
        sourceFilter: { category: ["nexus"] },
        targetPlayer: "opponent",
        targetFilter: { category: ["spirit"] },
        bonusAmount: 1,
      },
    });
    expect(
      getExpandEffectTargetCountBonus({
        ...fixture,
        actingPlayerId: "alice",
        sourceInstanceId: "observer",
        candidatePool: [fixture.state.cardInstances[0]!],
      })
    ).toBe(1);
  });
  it("攻撃履歴のカード/指定対象条件でも現在の場のスピリット状態を参照する", () => {
    const fixture = observerFixture("attack", "spirit");
    fixture.state.attackDeclarationLog.push({
      playerId: "bob",
      cardInstanceId: "brave",
      cardDefinitionId: fixture.definitions[0]!.cardNo,
      designatedTargetInstanceId: "brave",
      designatedTargetDefinitionId: fixture.definitions[0]!.cardNo,
      turnNumber: fixture.state.turnNumber,
      step: fixture.state.step,
      attackId: null,
    });
    expect(
      evaluateCondition(
        fixture.state,
        [
          {
            kind: "attack_occurred",
            player: "opponent",
            scope: "turn",
            cardFilter: { category: ["spirit"] },
            targetFilter: { category: ["spirit"] },
          },
        ],
        "observer",
        "alice",
        fixture.getCardDefinitionById
      )
    ).toBe(true);
  });
  it("スピリットの複数体換算が単体ブレイヴにも適用される", () => {
    const fixture = observerFixture("exhaust", "spirit");
    const countIsThree = (state: GameState) =>
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            cardNames: [{ contains: fixture.definitions[0]!.name }],
            minCount: 3,
            maxCount: 3,
          },
        ],
        "brave",
        "bob",
        fixture.getCardDefinitionById
      );
    expect(countIsThree(fixture.state)).toBe(false);
    const after = executeEffect({
      ...fixture,
      actingPlayerId: "bob",
      sourceInstanceId: "brave",
      chainId: "brave-count-multiple",
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "count_as_multiple",
              player: "self",
              filter: { category: ["spirit"] },
              multiplier: 3,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    });
    expect(countIsThree(after)).toBe(true);
  });
  it("スピリットの軽減供給上限は単体ブレイヴのシンボルにも適用する", () => {
    const source: CardDefinition = {
      ...getDef("BSSL01-R03")!,
      effects: [],
      symbolColors: ["red", "red"],
    };
    const hand: CardDefinition = {
      ...getDef("BSTH08.5-X01")!,
      cost: 4,
      reductionSymbols: ["red", "red"],
      effects: [],
    };
    const lookup = (id: string) =>
      id === source.cardNo ? source : id === hand.cardNo ? hand : undefined;
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    });
    const calc = (state: GameState) =>
      calculateReduction({
        state,
        actingPlayerId: "alice",
        card: hand,
        getCardDefinitionById: lookup,
        useKind: "summon",
      }).totalReduction;
    expect(calc(before)).toBe(2);
    const after = executeEffect({
      state: before,
      actingPlayerId: "alice",
      sourceInstanceId: "source",
      chainId: "brave-symbol-limit",
      getCardDefinitionById: lookup,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "limit_cost_reduction",
              targetScope: "player",
              player: "self",
              sourceFilter: { category: ["spirit"] },
              maxSymbols: 1,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    });
    expect(calc(after)).toBe(1);
  });
  it("全登録ブレイヴは単体の場では両カテゴリ、トラッシュ・合体中・ソウル状態では独立スピリットでない", () => {
    const braves = cards.filter((c) => c.printedCategory === "brave");
    expect(braves.length).toBeGreaterThan(10);
    for (const def of braves) {
      const card = createCardInstance(def, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      });
      const opts = {
        state,
        getCardDefinitionById: getDef,
        fieldCategoryContext: true,
      };
      expect(
        matchesCardReferenceFilter(card, def, { category: ["spirit"] }, opts),
        def.cardNo
      ).toBe(true);
      expect(
        matchesCardReferenceFilter(card, def, { category: ["brave"] }, opts),
        def.cardNo
      ).toBe(true);
      for (const absent of [
        { ...card, zone: "trash" as const },
        { ...card, attachedToInstanceId: "host" },
      ]) {
        expect(
          matchesCardReferenceFilter(
            absent,
            def,
            { category: ["spirit"] },
            { ...opts, state: { ...state, cardInstances: [absent] } }
          ),
          def.cardNo
        ).toBe(false);
      }
      const soulState = {
        ...state,
        players: state.players.map((p) =>
          p.id === "alice"
            ? { ...p, soulStateInstanceIds: [card.instanceId] }
            : p
        ),
      };
      expect(
        matchesCardReferenceFilter(
          card,
          def,
          { category: ["spirit"] },
          { ...opts, state: soulState }
        ),
        def.cardNo
      ).toBe(false);
    }
  });
  it.each(["brave", "host"])(
    "Q64/Q75: %s の疲労状態を引き継ぐ合体は疲労イベントを作らない",
    (exhausted) => {
      const initial = buildBraveSemanticEventsScenario(
        cards,
        new URLSearchParams({ mode: "summon" })
      );
      const before: GameState = {
        ...initial,
        cardInstances: initial.cardInstances.map((c) =>
          c.instanceId === "card-3"
            ? {
                ...c,
                zone: "field",
                normalCoreCount: 1,
                exhaustState: exhausted === "brave" ? "exhausted" : "recovered",
              }
            : c.instanceId === "card-14"
              ? {
                  ...c,
                  exhaustState:
                    exhausted === "host" ? "exhausted" : "recovered",
                }
              : c
        ),
      };
      const combined = executeBraveCombine(
        before,
        "alice",
        "card-3",
        "card-14",
        getDef
      );
      expect(
        combined.cardInstances.find((c) => c.instanceId === "card-3")
          ?.attachedToInstanceId
      ).toBe("card-14");
      expect(
        combined.cardInstances.find((c) => c.instanceId === "card-14")
          ?.exhaustState
      ).toBe("exhausted");
      expect(
        collectTriggerEventsFromStateDelta({
          beforeState: before,
          afterState: combined,
          source: "action_resolution",
          ...options,
        }).filter((e) => e.eventKind === "exhaust")
      ).toHaveLength(0);
      const recovered: GameState = {
        ...combined,
        cardInstances: combined.cardInstances.map((c) => ({
          ...c,
          exhaustState: "recovered",
        })),
      };
      const thenExhausted: GameState = {
        ...recovered,
        cardInstances: recovered.cardInstances.map((c) =>
          c.instanceId === "card-14" || c.instanceId === "card-3"
            ? { ...c, exhaustState: "exhausted" }
            : c
        ),
      };
      expect(
        collectTriggerEventsFromStateDelta({
          beforeState: recovered,
          afterState: thenExhausted,
          source: "action_resolution",
          ...options,
        })
          .filter((e) => e.eventKind === "exhaust")
          .map((e) => e.relatedInstanceId)
      ).toEqual(["card-14"]);
    }
  );
  it("field_all_match/cards_in_zone は場のブレイヴをスピリットに含め、トラッシュでは含めない", () => {
    const fixture = observerFixture("exhaust", "spirit");
    expect(
      evaluateCondition(
        fixture.state,
        [
          {
            kind: "field_all_match",
            player: "opponent",
            filter: { category: ["spirit"] },
          },
        ],
        "observer",
        "alice",
        fixture.getCardDefinitionById
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        fixture.state,
        [
          {
            kind: "cards_in_zone",
            player: "opponent",
            zone: "field",
            filter: { category: ["spirit"] },
            min: 1,
          },
        ],
        "observer",
        "alice",
        fixture.getCardDefinitionById
      )
    ).toBe(true);
    const offField: GameState = {
      ...fixture.state,
      cardInstances: fixture.state.cardInstances.map((c) =>
        c.instanceId === "brave" ? { ...c, zone: "trash" } : c
      ),
    };
    expect(
      evaluateCondition(
        offField,
        [
          {
            kind: "cards_in_zone",
            player: "opponent",
            zone: "trash",
            filter: { category: ["spirit"] },
            min: 1,
          },
        ],
        "observer",
        "alice",
        fixture.getCardDefinitionById
      )
    ).toBe(false);
  });
  it.each(["attack", "rebirth", "summon"] as const)(
    "解封の %s は同じカテゴリ規則を使う",
    (event) => {
      const fixture = observerFixture("exhaust", "spirit");
      const triggerCard = fixture.state.cardInstances[0]!;
      expect(
        matchesUnsealCardEvent({
          state: fixture.state,
          event,
          triggerCard,
          triggerDef: fixture.getCardDefinitionById(triggerCard.definitionId)!,
          condition: {
            events: [event],
            cardFilter: { categories: ["spirit"] },
          },
          getCardDefinitionById: fixture.getCardDefinitionById,
        })
      ).toBe(event !== "summon");
    }
  );

  it.each(["brave", "ultimate"] as const)(
    "スピリット限定の破壊時抑止: %s",
    (printedCategory) => {
      const fixture = observerFixture("exhaust", "spirit");
      fixture.definitions[0]!.printedCategory = printedCategory;
      const state = executeEffectResistance(
        fixture.state,
        "bob",
        {
          kind: "effect_resistance",
          target: { selfCard: true, count: 1 },
          resistType: "cannot_leave_field",
          source: "opponent_effect",
          duration: { scope: "permanent" },
        },
        "brave",
        fixture.getCardDefinitionById
      );
      const after = executeDestroy(
        state,
        "alice",
        {
          selfCard: false,
          player: "opponent",
          category: ["spirit", "ultimate"],
          count: -1,
        },
        fixture.getCardDefinitionById,
        "observer",
        undefined,
        "destroyed_only",
        "none",
        undefined,
        ["spirit"]
      );
      expect(
        after.cardInstances.find((c) => c.instanceId === "brave")
          ?.pendingLeaveKind
      ).toBe(printedCategory === "brave" ? "destroy" : null);
    }
  );
  it.each([...fieldEvents, ...printedEvents])(
    "%s の第三者観測は文脈を区別し、ブレイヴ指定も維持する",
    (event) => {
      for (const category of ["spirit", "brave"] as const) {
        const fixture = observerFixture(event, category);
        const queued = queuePendingReactionsFromTriggerEvents(
          fixture.state,
          [
            {
              actingPlayerId: "bob",
              eventKind: event,
              source: "action_resolution",
              chainId: `brave-audit:${event}:${category}`,
              attackId: null,
              relatedPlayerId: "bob",
              relatedInstanceId: "brave",
              amount: null,
            },
          ],
          undefined,
          {
            getCardDefinitionById: fixture.getCardDefinitionById,
            getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
              fixture.definitions
            ),
            getRegisteredBurstActions: undefined,
          }
        );
        expect(
          queued.pendingTriggeredEffects.some((p) => p.eventKind === event)
        ).toBe(
          (category === "brave" && event !== "place") ||
            fieldEvents.some((e) => e === event)
        );
      }
    }
  );

  it.each(["exhaust", "attack_after", "leave_field", "summon"] as const)(
    "%s バーストも同じ文脈を使う",
    (eventKind) => {
      const fixture = observerFixture("exhaust", "spirit");
      const state: GameState = {
        ...fixture.state,
        cardInstances: fixture.state.cardInstances.map((c) =>
          c.instanceId === "observer" ? { ...c, zone: "burst" } : c
        ),
        setBurstStates: [{ playerId: "alice", cardInstanceId: "observer" }],
      };
      const choices = getAvailableBurstSourceChoices({
        state,
        getCardDefinitionById: fixture.getCardDefinitionById,
        pendingBurstCheck: {
          checkId: "burst-audit",
          actingPlayerId: "alice",
          eventKind,
          source: "action_resolution",
          chainId: "brave-burst-audit",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: "brave",
          amount: 1,
          step: "attack",
          window: "none",
          resolvedBurstCardInstanceIds: [],
        },
        getRegisteredBurstActions: (id) =>
          id === fixture.definitions[1]!.cardNo
            ? [
                {
                  sourceKind: "nexus",
                  eventKind,
                  triggerFilter: { category: ["spirit"] },
                },
              ]
            : undefined,
      });
      expect(choices).toHaveLength(eventKind === "summon" ? 0 : 1);
    }
  );
});
