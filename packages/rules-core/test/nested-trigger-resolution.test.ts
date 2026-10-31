import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildNestedAdventTriggersScenario } from "../../../apps/playground-web/src/scenario-nested-advent-triggers";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getCurrentActorPlayerIds,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";

const lookups = {
  getCardDefinitionById: (id: string) => ALL_CARDS.find((d) => d.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => [],
};
const actions = (state: GameState) =>
  getLegalActions({ state, actingPlayerId: state.activePlayerId, ...lookups });

describe("派生誘発を内側から解決する (公式Q6645 / Q6163)", () => {
  it.each([
    ["BSTS01-C01", true],
    ["BSTS01-C03", false],
    ["BSKB01-R02", true],
  ] as const)(
    "契約煌臨元の誘発候補: 上カード %s の資格を再判定する",
    (cardNo, expected) => {
      const initial = buildNestedAdventTriggersScenario(ALL_CARDS);
      initial.cardInstances.find(
        (card) => card.instanceId === "nested-advent"
      )!.definitionId = cardNo;
      const state = rebuildContinuousEffectsFromField(
        initial,
        lookups.getCardDefinitionById,
        { unsafeAllowDuringBattle: true }
      );
      const available = actions(state).filter(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "nested-host" &&
          !action.skipOnly
      );
      expect(available.length > 0).toBe(expected);
    }
  );
  for (const owner of ["alice", "bob"]) {
    for (const skip of [false, true]) {
      it(`${owner}: カウント増加の${skip ? "辞退" : "解決"}後に煌臨時へ戻る`, () => {
        let state = buildNestedAdventTriggersScenario(
          ALL_CARDS,
          new URLSearchParams({ owner })
        );
        expect(state.pendingTriggeredEffects.map((p) => p.eventKind)).toEqual([
          "advent",
          "count_increase",
        ]);
        const available = actions(state);
        expect(available).toHaveLength(1);
        expect(available[0]).toMatchObject({
          kind: "resolve_pending_triggered_effect",
          eventKind: "count_increase",
        });
        state = applyLegalAction({
          state,
          action: available[0]!,
          ...lookups,
          skipOptionalEffect: skip,
        }).state;
        if (!skip) {
          const pass = getLegalActions({
            state,
            actingPlayerId: owner === "alice" ? "bob" : "alice",
            ...lookups,
          }).find((a) => a.kind === "pass_stack")!;
          state = applyLegalAction({ state, action: pass, ...lookups }).state;
        }
        expect(state.players.find((p) => p.id === owner)?.handCount).toBe(
          skip ? 0 : 1
        );
        expect(actions(state)).toEqual([
          expect.objectContaining({
            kind: "resolve_pending_triggered_effect",
            eventKind: "advent",
          }),
        ]);
      });
    }
  }

  it("古い外側の解決アクションも拒否する", () => {
    const before = buildNestedAdventTriggersScenario(
      ALL_CARDS,
      new URLSearchParams({ stage: "advent" })
    );
    const outer = actions(before).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "nested-advent"
    ) as LegalAction;
    expect(outer).toBeDefined();
    const state = buildNestedAdventTriggersScenario(ALL_CARDS);
    const stale = {
      ...outer,
      pendingId: state.pendingTriggeredEffects[0]!.pendingId,
    };
    expect(() =>
      applyLegalAction({ state, action: stale, ...lookups })
    ).toThrow(/inner|内側|derived/);
  });

  for (const first of ["nested-host", "observer"]) {
    it(`内側の同時誘発で${first}を選び、孫の誘発も先に解決する`, () => {
      const observer: CardDefinition = {
        ...ALL_CARDS.find((d) => d.cardNo === "BSTS01-C01")!,
        cardNo: "NESTED-OBSERVER",
        effects: [
          {
            timing: {
              kind: "game_event",
              player: "self",
              event: "count_increase",
            },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      };
      const deep: CardDefinition = {
        ...observer,
        cardNo: "NESTED-DEEP",
        effects: [
          {
            timing: {
              kind: "game_event",
              player: "self",
              event: "increase_hand",
            },
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
        ],
      };
      const defs = [...ALL_CARDS, observer, deep];
      const registrations = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          defs.find((d) => d.cardNo === id),
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      };
      let state = buildNestedAdventTriggersScenario(
        ALL_CARDS,
        new URLSearchParams({ stage: "advent" })
      );
      state = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          ...[observer, deep].map((d, index) =>
            createCardInstance(d, {
              instanceId: index === 0 ? "observer" : "deep",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            })
          ),
        ],
      };
      const available = () =>
        getLegalActions({ state, actingPlayerId: "alice", ...registrations });
      const resolve = (sourceInstanceId: string) => {
        const action = available().find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === sourceInstanceId
        );
        expect(action, JSON.stringify(available())).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...registrations,
        }).state;
        const pass = getLegalActions({
          state,
          actingPlayerId: "bob",
          ...registrations,
        }).find((a) => a.kind === "pass_stack")!;
        state = applyLegalAction({
          state,
          action: pass,
          ...registrations,
        }).state;
      };
      resolve("nested-host");
      expect(
        available()
          .map((a) => "sourceInstanceId" in a && a.sourceInstanceId)
          .sort()
      ).toEqual(["nested-host", "observer"]);
      resolve(first);
      expect(available()).toEqual([
        expect.objectContaining({
          eventKind: "increase_hand",
          sourceInstanceId: "deep",
        }),
      ]);
      expect(getCurrentActorPlayerIds(state).has("alice")).toBe(true);
      resolve("deep");
      expect(state.players[0]?.reserveNormalCoreCount).toBe(7);
      resolve(first === "observer" ? "nested-host" : "observer");
      resolve("deep");
      expect(state.players[0]?.reserveNormalCoreCount).toBe(9);
      expect(state.players[0]?.handCount).toBe(2);
      expect(available()).toEqual([
        expect.objectContaining({
          eventKind: "advent",
          sourceInstanceId: "nested-advent",
        }),
      ]);
    });
  }

  it("外側のただちに誘発や選択済みフラグも内側を飛び越さない", () => {
    const state = buildNestedAdventTriggersScenario(ALL_CARDS);
    state.pendingTriggeredEffects[0] = {
      ...state.pendingTriggeredEffects[0]!,
      triggerPriority: "immediate",
      selectedByTurnPlayer: true,
    };
    expect(actions(state)).toEqual([
      expect.objectContaining({ eventKind: "count_increase" }),
    ]);
  });

  it("外側の未解決効果を参照する条件判定には完全な盤面を渡す", () => {
    const state = buildNestedAdventTriggersScenario(ALL_CARDS);
    const outerId = state.pendingTriggeredEffects.find(
      (p) => p.eventKind === "advent"
    )!.pendingId;
    const host = state.cardInstances.find(
      (c) => c.instanceId === "nested-host"
    )!;
    host.pendingTriggerCorrelations = { outer: [outerId] };
    const definitions = ALL_CARDS.map((definition) =>
      definition.cardNo !== "BSTS01-CX01"
        ? definition
        : {
            ...definition,
            effects: definition.effects?.map((effect) => ({
              ...effect,
              condition: [
                ...(effect.condition ?? []),
                {
                  kind: "correlated_pending_trigger_active" as const,
                  key: "outer",
                },
              ],
            })),
          }
    );
    const available = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
      getCardDefinitionById: (id) => definitions.find((d) => d.cardNo === id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      eventKind: "count_increase",
      sourceInstanceId: "nested-host",
    });
    expect(available[0]).not.toHaveProperty("skipOnly", true);
  });

  it("原因chainIdがnullの同時誘発も、解決済み親の兄弟を待たせる", () => {
    const definition: CardDefinition = {
      ...ALL_CARDS.find((d) => d.cardNo === "BSTS01-C01")!,
      cardNo: "NESTED-START",
      effects: [
        {
          timing: { kind: "phase", step: "start", subPhase: "start" },
          executionMode: "optional",
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
        {
          timing: {
            kind: "game_event",
            event: "count_increase",
            player: "self",
          },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const registrations = {
      ...lookups,
      getCardDefinitionById: (id: string) =>
        id === definition.cardNo
          ? definition
          : lookups.getCardDefinitionById(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        definition,
      ]),
    };
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: ["alice", "bob"].map((id) =>
        createCardInstance(definition, {
          instanceId: id + "-start",
          ownerPlayerId: id,
          zone: "field",
          normalCoreCount: 1,
        })
      ),
    });
    state = queuePendingReactionsFromTriggerEvents(
      state,
      ["alice", "bob"].map((id) => ({
        actingPlayerId: id,
        eventKind: "start_step" as const,
        source: "step_transition" as const,
        chainId: "test:nested-trigger-resolution:336",
        attackId: null,
        relatedPlayerId: id,
        relatedInstanceId: null,
        amount: null,
        step: "start" as const,
        subPhase: "start" as const,
      })),
      undefined,
      registrations
    );
    const selected = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...registrations,
    }).find(
      (a) =>
        a.kind === "select_pending_to_resolve" && a.ownerPlayerId === "alice"
    )!;
    expect(selected).toBeDefined();
    state = applyLegalAction({
      state,
      action: selected,
      ...registrations,
    }).state;
    const pass = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...registrations,
    }).find((a) => a.kind === "pass_stack")!;
    state = applyLegalAction({ state, action: pass, ...registrations }).state;
    expect(state.pendingTriggeredEffects.map((p) => p.eventKind)).toEqual([
      "start_step",
      "count_increase",
    ]);
    expect(
      getLegalActions({ state, actingPlayerId: "alice", ...registrations })
    ).toEqual([expect.objectContaining({ eventKind: "count_increase" })]);
    expect(
      getLegalActions({ state, actingPlayerId: "bob", ...registrations })
    ).toEqual([]);
  });
});
