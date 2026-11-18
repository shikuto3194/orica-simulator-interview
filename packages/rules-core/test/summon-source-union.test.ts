import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildSummonSourceUnionScenario } from "../../../apps/playground-web/src/scenario-summon-source-union";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
} from "../src";
import type { GameState, LegalAction } from "../src";
import { resolveDeferredMagicStack } from "../src/mechanics/magic-system";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
};

function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find((entry) => entry.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...lookups,
    ...(action?.kind === "use_magic"
      ? {
          paymentSources: [
            { kind: "reserve" as const, amount: action.finalCost },
          ],
        }
      : {}),
    ...input,
  }).state;
}

describe.each(["BSTS01-C05", "BSGE01-C16"])(
  "%s unified summon sources",
  (cardNo) => {
    it.each(["trash", "soul"])(
      "selects %s directly, then summons exactly one card",
      (source) => {
        let state = buildSummonSourceUnionScenario(
          ALL_CARDS,
          new URLSearchParams({ card: cardNo })
        );
        state = act(
          state,
          "alice",
          cardNo === "BSTS01-C05"
            ? "resolve_pending_triggered_effect"
            : "use_magic"
        );
        state = act(state, "bob", "pass_stack");
        expect(state.pendingStepChoice).toBeNull();
        expect(
          state.pendingEffectTargetSelection?.candidateInstanceIds
            .slice()
            .sort()
        ).toEqual(["sc-union-soul", "sc-union-trash"]);
        const beforeCores = state.players[0]!.reserveNormalCoreCount;
        expect(() =>
          act(state, "alice", "resolve_pending_effect_target", {
            targetInstanceIds: ["sc-union-ordinary"],
          })
        ).toThrow();
        state = act(state, "alice", "resolve_pending_effect_target", {
          targetInstanceIds: [`sc-union-${source}`],
        });
        state = act(state, "alice", "resolve_pending_multi_placement", {
          multiPlacementAllocations: [
            {
              destinationInstanceId: `sc-union-${source}`,
              placements: [{ kind: "reserve_normal", amount: 1 }],
            },
          ],
        });
        expect(
          state.cardInstances.find(
            (card) => card.instanceId === `sc-union-${source}`
          )
        ).toMatchObject({
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "recovered",
        });
        expect(state.players[0]!.reserveNormalCoreCount).toBe(beforeCores - 1);
        expect(state.players[0]!.soulStateInstanceIds).toEqual(
          source === "soul" ? [] : ["sc-union-soul"]
        );
        expect(
          state.cardInstances.find(
            (card) => card.instanceId === "sc-union-trash"
          )?.zone
        ).toBe(source === "trash" ? "field" : "trash");
        expect(state.pendingStepChoice).toBeNull();
        expect(state.pendingMultiPlacement).toBeNull();
      }
    );
  }
);

it.each([true, false])(
  "magic continuation rejects a target that left its selected zone (groups=%s)",
  (grouped) => {
    let state = buildSummonSourceUnionScenario(
      ALL_CARDS,
      new URLSearchParams({ card: "BSGE01-C16" })
    );
    state = act(state, "alice", "use_magic");
    state = act(state, "bob", "pass_stack");
    const pending = state.pendingEffectTargetSelection!;
    const activeStack = {
      ...pending.deferredStack,
      targetInstanceIds: ["sc-union-soul"],
      targetSelectionResolved: true,
      targetZonesByInstanceId: { "sc-union-soul": "field" as const },
      ...(grouped ? { targetGroups: pending.targetGroups } : {}),
    };
    // Simulate an intervening disclosure response: field -> trash. Trash is in the
    // original candidate zone list, but this is no longer the selected TargetRef.
    const moved: GameState = {
      ...state,
      pendingEffectTargetSelection: null,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "sc-union-soul"
          ? { ...card, zone: "trash", zoneRoleName: "spirit-card" }
          : card
      ),
      players: state.players.map((player) => ({
        ...player,
        soulStateInstanceIds: [],
      })),
    };
    const after = resolveDeferredMagicStack({
      state: moved,
      activeStack,
      ...lookups,
      getRegisteredBurstActions: undefined,
    });
    expect(
      after.log.some((line) => line.startsWith("magic:effect-fizzled:"))
    ).toBe(true);
    expect(
      after.cardInstances.find((card) => card.instanceId === "sc-union-soul")
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((card) => card.instanceId === "sc-union-source")
        ?.zone
    ).toBe("trash");
    expect(after.pendingMultiPlacement).toBeNull();
  }
);
