import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  sanitizeStateForViewer,
  type GameState,
  type LegalAction,
} from "../src";
import {
  executeRefSummon,
  executeSummon,
  executeTokenSummon,
} from "../src/effect/structured-summon";

const base = ALL_CARDS.find((card) => card.cardNo === "BSDB01-CX01")!;
const definition = {
  ...base,
  cardNo: "HUD-TARGET",
  effects: [],
  relatedTokenCardNos: ["HUD-TOKEN"],
};
const token = {
  ...definition,
  cardNo: "HUD-TOKEN",
  token: true,
  maxTokenCount: 2,
};
const getDefinition = (id: string) =>
  id === token.cardNo
    ? token
    : id === definition.cardNo
      ? definition
      : undefined;
function resolve(state: GameState, kind: LegalAction["kind"], inputs = {}) {
  const playerId =
    state.pendingMultiPlacement?.actingPlayerId ??
    state.pendingEffectSummonCostPayment?.actingPlayerId ??
    "alice";
  const action = getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById: getDefinition,
  }).find((a) => a.kind === kind)!;
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
    ...inputs,
  }).state;
}
function setup() {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        reserveNormalCoreCount: 8,
        reserveSoulCoreCount: 1,
        soulCoreLocation: { kind: "reserve" },
        handCount: 3,
      },
      {},
    ],
    cardInstances: ["source", "target", "target2"].map((instanceId) =>
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: "alice",
        zone: "hand",
      })
    ),
  });
}

describe("core HUD choice routing", () => {
  it.each([1, 2])(
    "paid from-zone count=%i preserves the chosen targets, then waits for placement before the next step",
    (count) => {
      let state = executeEffect({
        state: setup(),
        chainId: "hud-from-zone",
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
        targetInstanceIds: ["target", "target2"].slice(0, count),
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "summon",
              action: {
                kind: "summon",
                target: { kind: "from_zone", zone: "hand", filter: {}, count },
                costModifier: { fixedPayment: 1 },
              },
            },
            { action: { kind: "count_increase", player: "self", amount: 2 } },
          ],
        },
      });
      expect(state.pendingEffectSummonCostPayment?.requiredCost).toBe(count);
      expect(state.players[0]!.countValue).toBe(0);
      state = resolve(state, "resolve_pending_effect_summon_cost_payment", {
        summonPaymentSources: [
          { kind: "reserve", amount: count, includeSoulCore: true },
        ],
      });
      expect(
        state.pendingMultiPlacement?.targets.map((target) => target.instanceId)
      ).toEqual(["target", "target2"].slice(0, count));
      expect(state.players[0]!.countValue).toBe(0);
      state = resolve(state, "resolve_pending_multi_placement", {
        multiPlacementAllocations: ["target", "target2"]
          .slice(0, count)
          .map((id) => ({
            destinationInstanceId: id,
            placements: [{ kind: "reserve_normal", amount: 2 }],
          })),
      });
      expect(state.players[0]!.countValue).toBe(2);
      expect(state.players[0]!.trashSoulCoreCount).toBe(1);
      expect(
        state.cardInstances.find((card) => card.instanceId === "source")!.zone
      ).toBe("hand");
      for (const id of ["target", "target2"].slice(0, count))
        expect(
          state.cardInstances.find((card) => card.instanceId === id)!
            .normalCoreCount
        ).toBe(2);
    }
  );
  it("self summon without activation metadata waits for placement", () => {
    const before = setup();
    const after = executeSummon(
      before,
      "hud-self",
      "alice",
      { kind: "summon", target: "self", withoutCost: true },
      "source",
      getDefinition
    );
    expect(after.pendingMultiPlacement?.targets[0]?.instanceId).toBe("source");
    expect(after.players[0]!.reserveNormalCoreCount).toBe(8);
    expect(after.cardInstances[0]!.normalCoreCount).toBe(0);
  });
  it.each([1, 2])(
    "%i from-zone summons wait for cost choices before moving cards",
    (count) => {
      const after = executeSummon(
        setup(),
        "hud-other",
        "alice",
        {
          kind: "summon",
          target: "other",
          zone: "hand",
          count,
          fixedPayment: 1,
        },
        "source",
        getDefinition,
        undefined,
        undefined,
        ["target", "target2"].slice(0, count)
      );
      expect(after.pendingEffectSummonCostPayment?.requiredCost).toBe(count);
      expect(after.players[0]!.reserveNormalCoreCount).toBe(8);
      expect(after.cardInstances.every((card) => card.zone === "hand")).toBe(
        true
      );
    }
  );
  it("paid token summon waits for the same cost HUD", () => {
    const after = executeTokenSummon(
      setup(),
      "hud-token",
      "alice",
      1,
      { fixedPayment: 1 },
      undefined,
      undefined,
      undefined,
      "source",
      getDefinition
    );
    expect(after.pendingEffectSummonCostPayment?.requiredCost).toBe(1);
    expect(after.cardInstances).toHaveLength(3);
    expect(after.players[0]!.reserveNormalCoreCount).toBe(8);
  });
});

it("sanitized placement state omits the private rollback snapshot", () => {
  const before = setup();
  const pending = executeSummon(
    before,
    "hud-private",
    "alice",
    { kind: "summon", target: "self", withoutCost: true },
    "source",
    getDefinition
  );
  expect(pending.pendingMultiPlacement?.priorStateSnapshot).toBeDefined();
  const visible = sanitizeStateForViewer(pending, "bob");
  expect(visible.pendingMultiPlacement?.priorStateSnapshot).toBeUndefined();
});
it("owner-field resummons keep both owners in placement choice until they select their own cores", () => {
  const before = setup();
  before.cardInstances[1]!.ownerPlayerId = "bob";
  before.cardInstances[1]!.controllerPlayerId = "bob";
  before.players[1]!.reserveNormalCoreCount = 2;
  before.players[1]!.reserveSoulCoreCount = 1;
  before.players[1]!.soulCoreLocation = { kind: "reserve" };
  let state = executeRefSummon(
    before,
    "alice",
    {
      kind: "summon",
      target: { kind: "ref", stepId: "previous" },
      costModifier: "free",
      toOwnerField: true,
    },
    getDefinition,
    ["source", "target"],
    "source"
  );
  expect(state.pendingMultiPlacement?.actingPlayerId).toBe("alice");
  expect(state.cardInstances[1]!.normalCoreCount).toBe(0);
  state = resolve(state, "resolve_pending_multi_placement", {
    multiPlacementAllocations: [
      {
        destinationInstanceId: "source",
        placements: [{ kind: "reserve_normal", amount: 2 }],
      },
    ],
  });
  expect(state.pendingMultiPlacement?.actingPlayerId).toBe("bob");
  expect(
    collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: state,
      source: "action_resolution",
      getCardDefinitionById: getDefinition,
    }).filter((event) => event.eventKind === "summon")
  ).toHaveLength(0);
  expect(state.pendingTriggeredEffects).toHaveLength(0);
  state = resolve(state, "resolve_pending_multi_placement", {
    multiPlacementAllocations: [
      {
        destinationInstanceId: "target",
        placements: [
          { kind: "reserve_normal", amount: 1 },
          { kind: "reserve_soul" },
        ],
      },
    ],
  });
  expect(state.pendingMultiPlacement).toBeNull();
  expect(
    state.cardInstances.find((c) => c.instanceId === "source")
  ).toMatchObject({ zone: "field", normalCoreCount: 2 });
  expect(
    state.cardInstances.find((c) => c.instanceId === "target")
  ).toMatchObject({ zone: "field", normalCoreCount: 1, soulCoreCount: 1 });
});
