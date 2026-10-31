import { finishCoreChoices } from "./helpers/core-choice-driver";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type Effect,
  type GameState,
} from "../src";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";

const lookup = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const registries = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};
const chainId = "test:genkai-oracle";

function board(zone: "hand" | "deck"): GameState {
  const make = (
    no: string,
    id: string,
    location: "field" | typeof zone,
    cores = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: "player-1",
      zone: location,
      normalCoreCount: cores,
    });
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        cardInstances: [
          make("BSTH10-X01", "domain", "field", 3),
          make("BSTH10-X03", "sagume", "field", 2),
          make("BSTH10-X05", "hecatia", zone),
        ],
        playerOverrides: [
          {
            handCount: zone === "hand" ? 1 : 0,
            deckCount: zone === "deck" ? 1 : 0,
            reserveNormalCoreCount: 4,
            reserveSoulCoreCount: 1,
          },
          {},
        ],
      }),
      step: "attack",
      turnNumber: 3,
    },
    lookup
  );
}

function resolveEntry(
  before: GameState,
  effect: Effect,
  interactive: boolean
): GameState {
  let state = executeEffect({
    state: before,
    effect,
    sourceInstanceId: "hecatia",
    actingPlayerId: "player-1",
    chainId,
    ...(interactive
      ? { activationZone: "hand" as const }
      : {
          summonEnterFieldCorePlacements: [
            { kind: "reserve_normal" as const, amount: 1 },
          ],
        }),
    ...registries,
  });
  if (interactive) {
    expect(state.pendingMultiPlacement).not.toBeNull();
    expect(state.pendingTriggeredEffects).toEqual([]);
    const action = getLegalActions({
      state,
      actingPlayerId: "player-1",
      ...registries,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      ...registries,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "hecatia",
          placements: [{ kind: "reserve_normal", amount: 2 }],
        },
      ],
    }).state;
  }
  if (state.pendingMultiPlacement || state.pendingEffectSummonCostPayment)
    return finishCoreChoices(state, lookup, registries);
  state = finalizeEffectResolution({
    state,
    beforeState: before,
    chainId,
    endLogs: [],
    actingPlayerId: "player-1",
    getRegisteredBurstActions: undefined,
    ...registries,
  });
  return state;
}

describe("現界は神託・召喚時効果の条件を満たさない（qa-046）", () => {
  it.each([
    ["hand", false],
    ["hand", true],
    ["deck", false],
    ["deck", true],
  ] as const)("BSTH10-X05: %s、維持コア選択=%s", (zone, interactive) => {
    const before = board(zone);
    const after = resolveEntry(
      before,
      lookup("BSTH10-X05")!.effects![0]!,
      interactive
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === "hecatia")
    ).toMatchObject({
      zone: "field",
      normalCoreCount: interactive ? 2 : 1,
    });
    expect(after.players[0]!.trashSoulCoreCount).toBe(1);
    expect(after.players[0]!.handCount).toBe(0);
    expect(after.players[0]!.deckCount).toBe(0);
    expect(after.pendingTriggeredEffects).toEqual([]);
    expect(
      after.cardInstances.find((card) => card.instanceId === "domain")!
        .normalCoreCount
    ).toBe(3);
    expect(
      after.cardInstances.find((card) => card.instanceId === "sagume")!
        .normalCoreCount
    ).toBe(2);
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId,
      getCardDefinitionById: lookup,
    }).filter((event) => event.relatedInstanceId === "hecatia");
    expect(events).toContainEqual(
      expect.objectContaining({ eventKind: "put", effectScope: "genkai" })
    );
    expect(events.some((event) => event.eventKind === "summon")).toBe(false);
  });

  it("同じアルティメットの効果召喚では両創界神の神託を維持する", () => {
    const before = board("hand");
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "summon",
            target: { kind: "self" },
            costModifier: "free",
          },
        },
      ],
    };
    const after = resolveEntry(before, effect, false);
    expect(
      after.pendingTriggeredEffects.filter(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toHaveLength(2);
  });
});
