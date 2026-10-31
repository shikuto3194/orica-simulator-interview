import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import {
  applyChosenAction,
  buildEngine,
  mulberry32,
  playGameAsync,
  resolveActionInputs,
} from "./selfplay-driver";

const engine = buildEngine();
const shanghai = engine.getCardDefinitionById("BSTH02.7-X02")!;
const candidate = engine.getCardDefinitionById("BSTH02.7-C02")!;

function pendingState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { reserveNormalCoreCount: 4, reserveSoulCoreCount: 0 },
      {},
    ],
    cardInstances: [
      createCardInstance(shanghai, {
        instanceId: "shanghai",
        ownerPlayerId: "alice",
        zone: "in_use",
      }),
      createCardInstance(candidate, {
        instanceId: "excluded",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(candidate, {
        instanceId: "payer",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 3,
      }),
    ],
  });
  return {
    ...base,
    step: "attack",
    activePlayerId: "bob",
    pendingSummonCostExcludeChoice: {
      pendingId: "selfplay-shanghai",
      actingPlayerId: "alice",
      sourceInstanceId: "shanghai",
      sourceDefinitionId: shanghai.cardNo,
      effectIndex: 1,
      candidateCardInstanceIds: ["excluded"],
      maxCount: 4,
      discountPerCard: 1,
      effectSummonActivationZone: "hand",
      effectSummonSourceEffectIndex: 0,
      effectSummonChainId: "selfplay-shanghai-chain",
    },
  };
}

function pendingAction(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: engine.getCardDefinitionById,
    ...engine.lookups,
  }).find(
    (
      action
    ): action is Extract<
      LegalAction,
      { kind: "resolve_pending_summon_cost_exclude_choice" }
    > => action.kind === "resolve_pending_summon_cost_exclude_choice"
  );
  expect(action).toBeDefined();
  return action!;
}

describe("selfplay-driver: summon cost exclude payment", () => {
  it("BSTH02.7-X02 pays the reserve deficit from a legal field source and completes the summon", () => {
    const state = pendingState();
    const action = pendingAction(state);
    expect(action.reducedCost).toBe(6);
    const input = resolveActionInputs(
      state,
      action,
      engine.getCardDefinitionById
    );
    expect(input.summonCostExcludeSelectedCardInstanceIds).toEqual([
      "excluded",
    ]);
    expect(
      input.paymentSources!.some(
        (source) =>
          source.kind === "card" &&
          source.instanceId === "payer" &&
          source.amount > 0
      )
    ).toBe(true);
    expect(
      input
        .paymentSources!.filter((source) => source.kind === "reserve")
        .reduce((sum, source) => sum + source.amount, 0)
    ).toBeLessThanOrEqual(4);
    expect(
      input.paymentSources!.reduce((sum, source) => sum + source.amount, 0)
    ).toBe(5);
    const after = applyChosenAction(state, action, engine);
    expect(after.pendingSummonCostExcludeChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "excluded")?.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find((card) => card.instanceId === "shanghai")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((card) => card.instanceId === "payer")
        ?.normalCoreCount
    ).toBeLessThan(3);
    expect(
      state.cardInstances.find((card) => card.instanceId === "payer")
        ?.normalCoreCount
    ).toBe(3);
  });

  it("keeps a full-cost-paid replacement distinct from a linear discount", () => {
    const state = pendingState();
    const action = {
      ...pendingAction(state),
      fullCostPaid: true,
      remainingPaymentCost: 1,
    };
    const input = resolveActionInputs(
      state,
      action,
      engine.getCardDefinitionById
    );
    expect(
      input.paymentSources!.reduce((sum, source) => sum + source.amount, 0)
    ).toBe(1);
  });

  it("uses the reserve soul core when it is the only remaining payment source", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });
    const action = {
      ...pendingAction(pendingState()),
      reducedCost: 2,
      availableReserveCoreAmount: 1,
      availableOnBoardCoreSources: [],
      availableSoulCoreOnlySources: [],
    };
    expect(
      resolveActionInputs(state, action, engine.getCardDefinitionById)
        .paymentSources
    ).toEqual([{ kind: "reserve", amount: 1, includeSoulCore: true }]);
  });

  it("can keep a field exclusion candidate when excluding it would remove the only payable completion", () => {
    const state = pendingState();
    const action = {
      ...pendingAction(state),
      candidateCardInstanceIds: ["payer"],
      maxCount: 1,
    };
    const input = resolveActionInputs(
      state,
      action,
      engine.getCardDefinitionById
    );
    expect(input.summonCostExcludeSelectedCardInstanceIds).toEqual([]);
    expect(
      input.paymentSources!.reduce((sum, source) => sum + source.amount, 0)
    ).toBe(6);
    expect(
      input.paymentSources!.some(
        (source) => source.kind === "card" && source.instanceId === "payer"
      )
    ).toBe(true);
  });

  it("replays integration failure seed 1558775056 to a natural result", async () => {
    const result = await playGameAsync({
      engine,
      maxSteps: 4000,
      rng: mulberry32(1558775056),
    });
    expect(result.outcome, result.lastError).toBe("natural");
    expect(result.winner).not.toBeNull();
  }, 60000);

  it("also pays a remaining summon cost after the core-move alternative", () => {
    const state = pendingState();
    state.pendingSummonCostExcludeChoice = null;
    state.pendingSummonCostCoreMoveChoice = {
      pendingId: "selfplay-core-move",
      actingPlayerId: "alice",
      sourceInstanceId: "shanghai",
      sourceDefinitionId: shanghai.cardNo,
      effectIndex: 1,
      minCount: 0,
      availableCoreCount: 0,
      costOffset: 1,
      fieldDestinationCandidateInstanceIds: [],
      effectSummonActivationZone: "hand",
      effectSummonSourceEffectIndex: 0,
      effectSummonChainId: "selfplay-core-move-chain",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_summon_cost_core_move_choice"
    )!;
    expect(action).toBeDefined();
    const after = applyChosenAction(state, action, engine);
    expect(after.pendingSummonCostCoreMoveChoice).toBeNull();
    expect(after.log.some((entry) => entry.includes("payment-mismatch"))).toBe(
      false
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "shanghai")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((card) => card.instanceId === "payer")
        ?.normalCoreCount
    ).toBeLessThan(3);
  });
});
