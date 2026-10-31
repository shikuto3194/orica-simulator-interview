import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildSeirensenDrawTriggerScenario } from "../../../apps/playground-web/src/scenario-seirensen-draw-trigger";
import {
  advanceStep,
  applyLegalAction,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import {
  collectTriggerEventsFromStateDelta,
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const nexus = ALL_CARDS.find((c) => c.cardNo === "BSTH07-転醒R01(A)")!;
const allFaces = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definitions = new Map(allFaces.map((c) => [c.cardNo, c]));
const deps = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allFaces),
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
  getRegisteredMagicActions: () => [],
};

function choices(state: GameState) {
  return state.pendingTriggeredEffects
    .filter((p) => p.eventKind === "after_draw")
    .flatMap((pendingEffect) =>
      getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect,
        ...deps,
      })
    );
}

function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input: Partial<Parameters<typeof applyLegalAction>[0]> = {},
  sourceId?: string
) {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...deps,
  }).find(
    (a) =>
      a.can &&
      a.kind === kind &&
      (!sourceId ||
        ("sourceInstanceId" in a && a.sourceInstanceId === sourceId))
  );
  expect(action, JSON.stringify(state.log.slice(-12))).toBeDefined();
  const payment =
    action?.kind === "place_nexus"
      ? {
          paymentSources: [
            { kind: "reserve" as const, amount: action.finalCost ?? 3 },
          ],
        }
      : {};
  return applyLegalAction({
    ...payment,
    ...input,
    state,
    action: action!,
    ...deps,
  }).state;
}

function drawn(
  sourceId: string | null,
  sourceDef = nexus,
  controller = "alice"
) {
  const cards = [
    createCardInstance(nexus, {
      instanceId: "observer",
      ownerPlayerId: "alice",
      zone: "field",
    }),
    ...(sourceId && sourceId !== "observer"
      ? [
          createCardInstance(sourceDef, {
            instanceId: sourceId,
            ownerPlayerId: controller,
            zone: "field",
          }),
        ]
      : []),
    ...Array.from({ length: 3 }, (_, i) =>
      createCardInstance(nexus, {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    ),
  ];
  const before = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: [{ deckCount: 3 }, {}],
    }),
    step: "main" as const,
    turnNumber: 4,
  };
  const after = executeEffect({
    state: before,
    sourceInstanceId: sourceId ?? "observer",
    actingPlayerId: "alice",
    chainId: "draw-test",
    effect: {
      timing: { kind: "card_event", event: "place" },
      steps: [{ action: { kind: "draw", count: 2 } }],
    },
    getCardDefinitionById: (id) =>
      id === sourceDef.cardNo ? sourceDef : deps.getCardDefinitionById(id),
  });
  const options = {
    beforeState: before,
    afterState: after,
    source: "action_resolution" as const,
    chainId: "draw-test",
    causedBySourceInstanceId: sourceId,
    causedByPlayerId: sourceId ? controller : null,
    ...deps,
    getCardDefinitionById: (id: string) =>
      id === sourceDef.cardNo ? sourceDef : deps.getCardDefinitionById(id),
  };
  return {
    options,
    events: collectTriggerEventsFromStateDelta(options),
    state: collectAndQueueTriggerReactions(options),
  };
}

describe("BSTH07-転醒R01(A): 実ドローの発生源と転醒", () => {
  it("別の起幻効果の2ドローはplayer値イベント1件・転醒1回、再収集で二重化しない", () => {
    const result = drawn("cause");
    expect(result.events.filter((e) => e.eventKind === "after_draw")).toEqual([
      expect.objectContaining({
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        effectSourceInstanceId: "cause",
        amount: 2,
      }),
    ]);
    expect(choices(result.state).map((c) => c.sourceCard.instanceId)).toEqual([
      "observer",
    ]);
    let state = act(
      result.state,
      "alice",
      "resolve_pending_triggered_effect",
      {},
      "observer"
    );
    state = act(state, "bob", "pass_stack");
    expect(
      state.cardInstances.find((c) => c.instanceId === "observer")!.definitionId
    ).toBe(nexus.backFace!.cardNo);
    expect(state.players[0]!.countValue).toBe(1);
    const recollected = collectAndQueueTriggerReactions({
      ...result.options,
      beforeState: state,
      afterState: state,
    });
    expect(choices(recollected)).toEqual([]);
    expect(recollected.players[0]!.countValue).toBe(1);
  });

  it("自身・相手の効果・非起幻の効果・発生源不明を除外する", () => {
    expect(choices(drawn("observer").state)).toEqual([]);
    expect(choices(drawn("cause", nexus, "bob").state)).toEqual([]);
    const vanilla = {
      ...nexus,
      cardNo: "TEST-NON-KIGEN-DRAW",
      tribe: "幻想",
      effects: [],
    };
    expect(choices(drawn("cause", vanilla).state)).toEqual([]);
    expect(choices(drawn(null).state)).toEqual([]);
  });

  it("発生源の効果系統タグも条件へ届く", () => {
    const tagged: CardDefinition = {
      ...nexus,
      cardNo: "TEST-TAGGED-DRAW",
      tribe: "幻想",
      effects: [
        {
          timing: { kind: "card_event", event: "place" },
          effectTribes: { tribes: ["起幻"] },
          steps: [{ action: { kind: "draw", count: 2 } }],
        },
      ],
    };
    const result = drawn("cause", tagged);
    expect(
      result.state.pendingTriggeredEffects.find(
        (p) => p.eventKind === "after_draw"
      )
    ).toBeDefined();
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: result.state,
        pendingEffect: result.state.pendingTriggeredEffects.find(
          (p) => p.eventKind === "after_draw"
        )!,
        ...result.options,
      }).map((c) => c.sourceCard.instanceId)
    ).toEqual(["observer"]);
  });

  it("relatedInstanceIdなしの複数発生源carrierも条件を評価し、不明IDは推測しない", () => {
    const result = drawn("cause");
    const draw = result.events.find((e) => e.eventKind === "after_draw")!;
    const { effectSourceInstanceId: _, ...base } = draw;
    const queued = queuePendingReactionsFromTriggerEvents(
      result.options.afterState,
      [{ ...base, effectSourceInstanceIds: ["cause"] }],
      "draw-test",
      deps
    );
    expect(choices(queued).map((c) => c.sourceCard.instanceId)).toEqual([
      "observer",
    ]);
    const unknown = collectAndQueueTriggerReactions({
      ...result.options,
      causedBySourceInstanceId: "missing",
    });
    expect(choices(unknown)).toEqual([]);
  });

  it("通常ドローステップは転醒を誤誘発しない", () => {
    const initial = buildSeirensenDrawTriggerScenario(ALL_CARDS);
    const state: GameState = {
      ...initial,
      step: "core",
      window: "step_end",
      cardInstances: initial.cardInstances.map((c) =>
        c.instanceId === "card-9" ? { ...c, zone: "field" } : c
      ),
      players: initial.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 1 } : p
      ),
    };
    const after = advanceStep(
      state,
      deps.getCardDefinitionById,
      deps.getRegisteredTriggeredEffectActions,
      deps.getRegisteredBurstActions
    );
    expect(after.players[0]!.deckCount).toBe(7);
    expect(choices(after)).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "card-9")!.definitionId
    ).toBe(nexus.cardNo);
  });

  it.each(["alice", "bob"])(
    "%s: card-9→card-10の通常配置・2ドロー・破棄を完走してcard-9だけ1回転醒",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildSeirensenDrawTriggerScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      for (const [index, id] of ["card-9", "card-10"].entries()) {
        state = act(state, owner, "place_nexus", {}, id);
        state = act(state, opponent, "pass_stack");
        if (state.pendingEnterFieldPlacement)
          state = act(state, owner, "resolve_pending_enter_field_placement");
        state = act(state, owner, "resolve_pending_triggered_effect", {}, id);
        state = act(state, opponent, "pass_stack");
        expect(state.pendingZoneSelection).not.toBeNull();
        expect(state.players.find((p) => p.id === owner)!.deckCount).toBe(
          6 - index * 2
        );
        // 破棄選択中は解決途中。転醒アクションを先に発揮できない。
        expect(
          getLegalActions({ state, actingPlayerId: owner, ...deps })
            .filter((a) => a.can)
            .map((a) => a.kind)
        ).toEqual(["resolve_pending_zone_selection"]);
        state = act(state, owner, "resolve_pending_zone_selection", {
          selectedZoneCardIds: [`deck-${index * 2 + 1}`],
        });
        if (index === 0) expect(choices(state)).toEqual([]);
      }
      expect(
        state.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "after_draw"
        )
      ).toHaveLength(1);
      expect(choices(state).map((c) => c.sourceCard.instanceId)).toEqual([
        "card-9",
      ]);
      state = act(
        state,
        owner,
        "resolve_pending_triggered_effect",
        {},
        "card-9"
      );
      state = act(state, opponent, "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "card-9")!.definitionId
      ).toBe(nexus.backFace!.cardNo);
      expect(
        state.cardInstances.find((c) => c.instanceId === "card-10")!
          .definitionId
      ).toBe(nexus.cardNo);
      expect(state.players.find((p) => p.id === owner)!.countValue).toBe(1);
      // productionと同じB面登録を使い、強制転醒時効果も対象0件で完了させる。
      state = act(
        state,
        owner,
        "resolve_pending_triggered_effect",
        {},
        "card-9"
      );
      state = act(state, opponent, "pass_stack");
      if (state.pendingEffectTargetSelection)
        state = act(state, owner, "resolve_pending_effect_target", {
          targetInstanceIds: [],
        });
      expect(state.pendingTriggeredEffects).toEqual([]);
      expect(state.pendingPrivateDeclarations).toEqual([]);
      expect(state.stackWindow).toBeNull();
      expect(state.pendingZoneSelection).toBeNull();
      expect(state.players.find((p) => p.id === owner)).toMatchObject({
        deckCount: 4,
        handCount: 2,
        countValue: 1,
      });
    }
  );
});
