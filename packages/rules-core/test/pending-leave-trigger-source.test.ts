import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingLeave,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
  type PendingLeaveKind,
  type TriggerEventKind,
} from "../src";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";

const definition: CardDefinition = {
  cardNo: "TEST-WAITING-SOURCE",
  name: "待機状態の誘発元",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "A",
  effects: [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: ["summon", "place", "count_increase", "destroy"],
      },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
    {
      timing: { kind: "card_event", event: "leave_field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
};
const otherDefinition = {
  ...definition,
  cardNo: "TEST-WAITING-OTHER",
  effects: [],
};
const nexusDefinition: CardDefinition = {
  ...otherDefinition,
  cardNo: "TEST-WAITING-NEXUS",
  printedCategory: "nexus",
};
const options = {
  getCardDefinitionById: (id: string) =>
    [definition, otherDefinition, nexusDefinition].find(
      (card) => card.cardNo === id
    ),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([definition]),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function setup() {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(nexusDefinition, {
        instanceId: "nexus",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(otherDefinition, {
        instanceId: "other",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(definition, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(definition, {
        instanceId: "deck",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ],
  });
}
function leave(state: GameState, kind: PendingLeaveKind, blocked = false) {
  return queuePendingLeave({
    state,
    instanceId: "source",
    kind,
    cause: "effect_resolution",
    causePlayerId: "alice",
    chainId: "waiting-source",
    blockedByResistance: blocked,
  });
}
function queue(
  state: GameState,
  eventKind: TriggerEventKind,
  related = eventKind === "place" ? "nexus" : "other"
) {
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: "alice",
        eventKind,
        source: "action_resolution",
        chainId: "waiting-source",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: related,
        amount: 1,
        preFlushLeaveEvent: related === "source",
      },
    ],
    undefined,
    options
  );
}
const actions = (state: GameState) =>
  ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...options })
  );

describe("Q2404/Q31800: 離脱待機中の発揮元の誘発制限", () => {
  for (const kind of [
    "destroy",
    "vanish",
    "bounce",
    "remove_from_game",
  ] as const) {
    it.each(["summon", "place", "count_increase", "destroy"] as const)(
      `${kind} 待機中は他カードの %s から誘発しない`,
      (eventKind) => {
        expect(queue(setup(), eventKind).pendingTriggeredEffects).toHaveLength(
          1
        );
        expect(
          queue(leave(setup(), kind), eventKind).pendingTriggeredEffects
        ).toHaveLength(0);
      }
    );
    it(`${kind} 待機中でも自身の離脱時効果は解決する`, () => {
      let state = queue(leave(setup(), kind), kind, "source");
      const action = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.registrationIndex !== undefined &&
          options.getRegisteredTriggeredEffectActions(definition.cardNo)?.[
            a.registrationIndex
          ]?.effectIndex === 1
      )!;
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action, ...options }).state;
      state = applyLegalAction({
        state,
        action: actions(state).find((a) => a.kind === "pass_stack")!,
        ...options,
      }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck")?.zone
      ).toBe("hand");
    });
  }
  it("誘発後に離脱待機になった発揮元は再列挙で除外する", () => {
    const before = queue(setup(), "count_increase");
    expect(before.pendingTriggeredEffects).toHaveLength(1);
    const state = leave(before, "vanish");
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: state.pendingTriggeredEffects[0]!,
        ...options,
      })
    ).toHaveLength(0);
  });
  it("保存済みのスタックも待機中の無関係な効果を解決しない", () => {
    let state = queue(setup(), "count_increase");
    state = applyLegalAction({
      state,
      action: actions(state).find(
        (a) => a.kind === "resolve_pending_triggered_effect"
      )!,
      ...options,
    }).state;
    state = JSON.parse(JSON.stringify(leave(state, "vanish"))) as GameState;
    state = applyLegalAction({
      state,
      action: actions(state).find((a) => a.kind === "pass_stack")!,
      ...options,
    }).state;
    expect(state.cardInstances.find((c) => c.instanceId === "deck")?.zone).toBe(
      "deck"
    );
    expect(state.stackWindow).toBeNull();
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
  it("耐性で離脱を阻止したマーカーは離脱待機として扱わない", () => {
    expect(
      queue(leave(setup(), "destroy", true), "count_increase")
        .pendingTriggeredEffects
    ).toHaveLength(1);
  });
});
