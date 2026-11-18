import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildHandIncreaseBurstScenario } from "../../../apps/playground-web/src/scenario-hand-increase-burst";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};
function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input = {}
) {
  const actions = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  });
  const action = actions.find((a) => a.kind === kind);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}
const unseals = (state: GameState) =>
  state.pendingTriggeredEffects.filter((p) => p.mechanic?.kind === "unseal");
const handIncreaseStones = [
  ["BSTH04-転醒R01(A)", "BSTH02-M02"],
  ["BSTH07-転醒X02(A)", "BSTH07-C01"],
] as const;

describe("解封の手札増加原因", () => {
  it.each(["alice", "bob"])(
    "%s: BSTH02-M02のバースト3ドロー→解封でコア1個",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildHandIncreaseBurstScenario(
        ALL_CARDS,
        new URLSearchParams({ owner, stage: "unseal" })
      );
      state = act(state, owner, "resolve_pending_burst_check");
      state = act(state, opponent, "pass_stack");
      state = act(state, opponent, "pass_stack");
      expect(state.players.find((p) => p.id === owner)?.handCount).toBe(7);
      expect(unseals(state)).toMatchObject([
        {
          actingPlayerId: owner,
          mechanic: {
            grandstoneInstanceId: "stone",
            triggerEvent: "hand_increase",
            triggerCardInstanceId: "burst",
          },
        },
      ]);
      state = act(state, owner, "resolve_pending_multi_placement", {
        multiPlacementAllocations: [
          {
            destinationInstanceId: "burst",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      });
      expect(unseals(state)).toHaveLength(1);
      state = act(state, owner, "resolve_pending_triggered_effect");
      state = act(state, opponent, "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "stone")
          ?.normalCoreCount
      ).toBe(1);
      expect(
        state.players.find((p) => p.id === owner)?.voidNormalCoreCount
      ).toBe(99);
      expect(unseals(state)).toHaveLength(0);
    }
  );

  it("手札増加型解封を持つ実カード全件を監査対象に含む", () => {
    expect(
      ALL_CARDS.filter((card) =>
        card.grandstoneData?.unsealConditions.some((c) =>
          c.events.includes("hand_increase")
        )
      )
        .map((card) => card.cardNo)
        .sort()
    ).toEqual(handIncreaseStones.map(([stone]) => stone).sort());
  });

  it.each(handIncreaseStones)(
    "%s: 外側の効果元と異なる手札増加の原因を使う",
    (stoneNo, causeNo) => {
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(definitions.get(stoneNo)!, {
            instanceId: "stone",
            ownerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(definitions.get(causeNo)!, {
            instanceId: "cause",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(definitions.get("BSTH01-C04")!, {
            instanceId: "outer",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(definitions.get("BSTH01-C04")!, {
            instanceId: "deck",
            ownerPlayerId: "alice",
            zone: "deck",
          }),
        ],
        playerOverrides: [
          { handCount: 0, deckCount: 1, voidNormalCoreCount: 100 },
          {},
        ],
      });
      const after = executeEffect({
        chainId: "test:grandstone-hand-increase-source:139",
        state: before,
        actingPlayerId: "alice",
        sourceInstanceId: "cause",
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
        ...lookups,
      });
      const queued = collectAndQueueTriggerReactions({
        chainId: "test:grandstone-hand-increase-source:149",
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        causedByPlayerId: "alice",
        causedBySourceInstanceId: "outer",
        ...lookups,
      });
      expect(unseals(queued)).toMatchObject([
        { mechanic: { triggerCardInstanceId: "cause" } },
      ]);
    }
  );

  for (const [stoneNo, causeNo] of handIncreaseStones) {
    it.each([
      ["self_effect", causeNo, "alice", 1],
      ["self_effect", "BSTH01-C04", "alice", 0],
      ["opponent_effect", causeNo, "alice", 0],
      ["state_based", causeNo, "alice", 0],
      ["self_effect", causeNo, "bob", 0],
    ] as const)(
      `${stoneNo}: %s / %s / 増加者 %s の条件境界`,
      (cause, eventSourceNo, grower, count) => {
        const state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(definitions.get(stoneNo)!, {
              instanceId: "stone",
              ownerPlayerId: "alice",
              zone: "field",
            }),
            createCardInstance(definitions.get(eventSourceNo)!, {
              instanceId: "cause",
              ownerPlayerId: "alice",
              zone: "trash",
            }),
            createCardInstance(definitions.get(causeNo)!, {
              instanceId: "outer",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
          playerOverrides: [{ voidNormalCoreCount: 100 }, {}],
        });
        const queued = collectAndQueueTriggerReactions({
          chainId: "test:grandstone-hand-increase-source:195",
          beforeState: state,
          afterState: state,
          source: "action_resolution",
          causedByPlayerId: "alice",
          causedBySourceInstanceId: "outer",
          ...lookups,
          supplementalEvents: [
            {
              chainId: "test:grandstone-hand-increase-source:203",
              eventKind: "increase_hand",
              actingPlayerId: grower,
              relatedPlayerId: grower,
              relatedInstanceId: "cause",
              amount: 1,
              cause,
            },
          ],
        });
        expect(unseals(queued)).toHaveLength(count);
      }
    );
  }
});
