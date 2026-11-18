import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  runStateBasedActions,
} from "../src";
import { getAvailableCardCostPaymentSources } from "../src/core/payment-system";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
const noFieldCardEffects = () => [];

function card(cardNo: string): CardDefinition {
  const def = cardNoMap.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
}

function resolveMainStackAndEnterField(state: GameState): GameState {
  let current = state;

  for (let guard = 0; guard < 8; guard += 1) {
    if (current.window === "stack" && current.stackWindow !== null) {
      const actingPlayerId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: noFieldCardEffects,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state;
      continue;
    }

    const pendingPlacement = current.pendingEnterFieldPlacement;
    if (pendingPlacement !== null) {
      const resolve = getLegalActions({
        state: current,
        actingPlayerId: pendingPlacement.actingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: noFieldCardEffects,
      }).find(
        (action) => action.kind === "resolve_pending_enter_field_placement"
      );
      expect(resolve).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: resolve!,
        enterFieldCorePlacements: [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state;
      continue;
    }

    return current;
  }

  throw new Error("main stack did not settle");
}

function resolveTriggeredEffect(
  state: GameState,
  predicate: (
    action: Extract<
      ReturnType<typeof getLegalActions>[number],
      { kind: "resolve_pending_triggered_effect" }
    >
  ) => boolean
): GameState {
  let current = state;
  while (current.pendingBurstChecks.length > 0) {
    const actingPlayerId = current.pendingBurstChecks[0]!.actingPlayerId;
    const burstCheckAction = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: noFieldCardEffects,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_burst_check" ||
        candidate.kind === "decline_pending_burst_check"
    );
    expect(burstCheckAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: burstCheckAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
  }
  let actions = getLegalActions({
    state: current,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredFieldCardEffectActions: noFieldCardEffects,
  });
  let action = actions.find(
    (
      candidate
    ): candidate is Extract<
      typeof candidate,
      { kind: "resolve_pending_triggered_effect" }
    > =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      predicate(candidate)
  );
  if (!action) {
    const select = actions.find(
      (candidate) =>
        candidate.kind === "select_pending_to_resolve" &&
        candidate.sourceInstanceId === "fenrir" &&
        candidate.eventKind === "place"
    );
    expect(select).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: select!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    actions = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: noFieldCardEffects,
    });
    action = actions.find(
      (
        candidate
      ): candidate is Extract<
        typeof candidate,
        { kind: "resolve_pending_triggered_effect" }
      > =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        predicate(candidate)
    );
  }
  expect(action).toBeDefined();
  return applyLegalAction({
    state: current,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

const targetCost1: CardDefinition = {
  cardNo: "TEST-SOUL-PAYMENT-TARGET",
  name: "支払い対象",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
};

describe("魂状態とSBA/コスト支払い", () => {
  it("魂状態カードは通常コア0でもコア不足消滅しない", () => {
    const yuu = createCardInstance(card("BSGE01-CX01"), {
      instanceId: "yuu-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [yuu],
      playerOverrides: [
        {
          contractCardNo: "BSGE01-CX01",
          soulStateInstanceIds: ["yuu-soul"],
        },
        {},
      ],
    });

    const result = runStateBasedActions(state, getDef);

    expect(
      result.checks.some(
        (check) =>
          check.kind === "vanish_due_to_core_deficit" &&
          check.instanceId === "yuu-soul"
      )
    ).toBe(false);
    const yuuAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "yuu-soul"
    )!;
    expect(yuuAfter.zone).toBe("field");
    expect(yuuAfter.pendingLeaveKind).toBeNull();
  });

  it("魂状態カード上のコアは通常のカードコスト支払い源に列挙されない", () => {
    const yuu = createCardInstance(card("BSGE01-CX01"), {
      instanceId: "yuu-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [yuu],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          contractCardNo: "BSGE01-CX01",
          soulStateInstanceIds: ["yuu-soul"],
        },
        {},
      ],
    });

    const payment = getAvailableCardCostPaymentSources({
      state,
      actingPlayerId: ALICE,
      card: targetCost1,
      getCardDefinitionById: (id) =>
        id === targetCost1.cardNo ? targetCost1 : getDef(id),
      useKind: "summon",
    });

    expect(payment.onBoardCoreSources).toHaveLength(0);
    expect(payment.soulCoreOnlySources).toHaveLength(0);
    expect(payment.canFullyPay).toBe(false);
  });

  it("BSGE01-C13 の神喰カウント+2は、魂状態の神薙ユウを条件に BSGE01-C01 を誘発させる", () => {
    const c01 = createCardInstance(card("BSGE01-C01"), {
      instanceId: "tearstone",
      ownerPlayerId: ALICE,
      zone: "mirage",
    });
    const yuu = createCardInstance(card("BSGE01-CX01"), {
      instanceId: "yuu-soul",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const c13 = createCardInstance(card("BSGE01-C13"), {
      instanceId: "fenrir",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deckCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(targetCost1, {
        instanceId: `deck-${index}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [c01, yuu, c13, ...deckCards],
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "tearstone" }],
        playerOverrides: [
          {
            handCount: 3,
            reserveNormalCoreCount: 3,
            deckCount: 5,
            contractCardNo: "BSGE01-CX01",
            soulStateInstanceIds: ["yuu-soul"],
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };

    const placeAction = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: noFieldCardEffects,
      getCardDefinitionById: (id) =>
        id === targetCost1.cardNo ? targetCost1 : getDef(id),
    }).find(
      (action) =>
        action.kind === "place_nexus" && action.sourceInstanceId === "fenrir"
    );
    expect(placeAction).toBeDefined();
    if (!placeAction || placeAction.kind !== "place_nexus") {
      throw new Error("BSGE01-C13 place_nexus action not found");
    }

    const declared = applyLegalAction({
      state,
      action: placeAction,
      paymentSources: [{ kind: "reserve", amount: placeAction.finalCost }],
      getCardDefinitionById: (id) =>
        id === targetCost1.cardNo ? targetCost1 : getDef(id),
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const placed = resolveMainStackAndEnterField(declared);

    expect(
      placed.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "place" &&
          pending.relatedInstanceId === "fenrir"
      )
    ).toBe(true);

    const c13TriggerDeclared = resolveTriggeredEffect(
      placed,
      (action) =>
        (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
          "fenrir" &&
        action.sourceDefinitionId === "BSGE01-C13" &&
        action.eventKind === "place"
    );
    const after = resolveMainStackAndEnterField(c13TriggerDeclared);

    const yuuAfter = after.cardInstances.find(
      (c) => c.instanceId === "yuu-soul"
    )!;
    expect(yuuAfter.zone).toBe("field");
    expect(
      after.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).toContain("yuu-soul");
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(2);
    expect(
      after.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "count_increase" &&
          pending.relatedInstanceId === "fenrir"
      )
    ).toBe(true);
    expect(
      getLegalActions({
        state: after,
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) =>
          id === targetCost1.cardNo ? targetCost1 : getDef(id),
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: noFieldCardEffects,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "tearstone" &&
          action.sourceDefinitionId === "BSGE01-C01" &&
          action.eventKind === "count_increase"
      )
    ).toBe(true);
  });
});
