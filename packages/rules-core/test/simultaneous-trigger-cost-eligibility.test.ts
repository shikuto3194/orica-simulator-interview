import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const chiyuri = ALL_CARDS.find((card) => card.cardNo === "BSTH003-X04")!;
// 実カードの支払い/回復を変更せず、同じ群で資源を増やす兄弟効果を補助する。
const coreSource: CardDefinition = {
  ...ALL_CARDS.find((card) => card.cardNo === "BSTH003-X01")!,
  cardNo: "TEST-BATTLE-END-CORE-SOURCE",
  effects: [
    {
      timing: { kind: "game_event", event: "battle_end", player: "self" },
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
const definitions = [chiyuri, coreSource];
const deps = {
  getCardDefinitionById: (id: string) =>
    definitions.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function fixture() {
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ voidNormalCoreCount: 20 }, {}],
      cardInstances: [
        createCardInstance(chiyuri, {
          instanceId: "chiyuri",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
        createCardInstance(coreSource, {
          instanceId: "core-source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    }),
    step: "attack",
    turnNumber: 2,
  };
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        eventKind: "battle_end",
        event: { family: "battle_end", actionKind: "attack" },
        actingPlayerId: "alice",
        source: "battle_resolution",
        chainId: "simultaneous-cost",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "chiyuri",
        amount: null,
      },
    ],
    "simultaneous-cost-group",
    deps
  );
}
function choices(state: GameState) {
  return state.pendingTriggeredEffects.flatMap((pendingEffect) =>
    getAvailableTriggeredEffectSourceChoices({ state, pendingEffect, ...deps })
  );
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
function resolve(state: GameState, source: string, skipOptionalEffect = false) {
  const selected = act(
    state,
    (action) =>
      action.sourceInstanceId === source &&
      (action.kind === "select_pending_to_resolve" ||
        action.kind === "resolve_pending_triggered_effect"),
    {
      skipOptionalEffect,
      ...(source === "chiyuri" ? { targetInstanceIds: ["chiyuri"] } : {}),
    }
  );
  state = selected;
  for (let i = 0; state.stackWindow && i < 12; i++)
    state = act(state, (action) => action.kind === "pass_stack");
  return state;
}

describe("同時誘発中に支払い可能になる公開登録", () => {
  it("BSTH003-X04: 2コアでは選択不可、兄弟効果で3コアになった後に支払い回復する", () => {
    let state = fixture();
    expect(
      choices(state).map((choice) => choice.sourceCard.instanceId)
    ).toEqual(["core-source"]);
    state = resolve(state, "core-source");
    expect(
      state.cardInstances.find((card) => card.instanceId === "core-source")!
        .normalCoreCount
    ).toBe(3);
    expect(
      choices(state).map((choice) => choice.sourceCard.instanceId)
    ).toContain("chiyuri");
    state = resolve(JSON.parse(JSON.stringify(state)) as GameState, "chiyuri");
    expect(
      state.cardInstances.find((card) => card.instanceId === "core-source")!
        .normalCoreCount
    ).toBe(0);
    expect(
      state.cardInstances.find((card) => card.instanceId === "chiyuri")!
        .exhaustState
    ).toBe("recovered");
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });

  it("兄弟効果を辞退して支払えないまま群を閉じると、未成立登録を残さない", () => {
    const state = resolve(fixture(), "core-source", true);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(
      state.cardInstances.find((card) => card.instanceId === "chiyuri")!
        .exhaustState
    ).toBe("exhausted");
  });
});
