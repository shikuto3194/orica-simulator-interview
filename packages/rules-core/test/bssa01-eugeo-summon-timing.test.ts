import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type { ApplyLegalActionOptions, GameState, LegalAction } from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => undefined,
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredMagicActions: () => undefined,
  getRegisteredBattleImmediateEffectActions: () => undefined,
};

function setup(owner = "alice"): GameState {
  const cards = [
    ["summoner", "BSSA01-X02", "field"],
    ["eugeo", "BSSA01-C02", "hand"],
    ["kirito", "BSSA01-X01", "hand"],
    ["cardinal", "BSSA01-XX01", "field"],
  ] as const;
  const initial = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards.map(([instanceId, cardNo, zone]) =>
      createCardInstance(definitions.get(cardNo)!, {
        instanceId,
        ownerPlayerId: owner,
        zone,
        normalCoreCount: zone === "field" ? 1 : 0,
      })
    ),
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount: 10,
      handCount: id === owner ? 2 : 0,
    })),
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...initial, activePlayerId: owner, turnNumber: 3, step: "main" },
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "test:bssa01-eugeo-summon-timing:48",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "summoner",
        amount: null,
      },
    ],
    undefined,
    lookups
  );
}

function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input: Partial<ApplyLegalActionOptions> = {}
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find((candidate) => candidate.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}

function reachPlacement(owner = "alice", targets = ["eugeo", "kirito"]) {
  let state = act(setup(owner), owner, "resolve_pending_triggered_effect");
  state = act(state, owner === "alice" ? "bob" : "alice", "pass_stack");
  state = act(state, owner, "resolve_pending_effect_target", {
    targetInstanceIds: targets,
  });
  expect(
    state.pendingMultiPlacement?.targets.map((target) => target.instanceId)
  ).toEqual(targets);
  return state;
}

describe("反逆者アリスから召喚するユージオの誘発タイミング", () => {
  it.each(["alice", "bob"])(
    "%s: コア配置HUD中は召喚時・神託・召喚記録を作らない",
    (owner) => {
      const state = reachPlacement(owner);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.turnSummonedCardRefs).toHaveLength(0);
    }
  );

  it.each([{ targets: ["eugeo"] }, { targets: ["eugeo", "kirito"] }])(
    "$targets: 配置確定後にユージオの召喚時と神託を各1回だけ登録する",
    ({ targets }) => {
      let state = reachPlacement("alice", targets);
      state = act(state, "alice", "resolve_pending_multi_placement", {
        multiPlacementAllocations: targets.map((destinationInstanceId) => ({
          destinationInstanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        })),
      });
      expect(
        state.pendingTriggeredEffects.filter(
          (pending) =>
            pending.eventKind === "summon" &&
            pending.relatedInstanceId === "eugeo"
        )
      ).toHaveLength(1);
      expect(
        state.pendingTriggeredEffects.filter(
          (pending) => pending.eventKind === "oracle"
        )
      ).toHaveLength(1);
      expect(
        state.cardInstances.find((card) => card.instanceId === "eugeo")
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    }
  );

  it("配置を中止した場合は召喚時効果も召喚記録も残さない", () => {
    const state = act(
      reachPlacement(),
      "alice",
      "abort_pending_multi_placement"
    );
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(state.turnSummonedCardRefs).toHaveLength(0);
    expect(
      state.cardInstances.find((card) => card.instanceId === "eugeo")?.zone
    ).toBe("hand");
  });
});
