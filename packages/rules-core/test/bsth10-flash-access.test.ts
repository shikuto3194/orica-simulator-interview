import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type GameState,
} from "../src";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const registries = {
  getCardDefinitionById: lookup,
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function board(no: string): GameState {
  const make = (
    cardNo: string,
    instanceId: string,
    zone: "field" | "deck",
    ownerPlayerId = "alice",
    normalCoreCount = 1
  ) =>
    createCardInstance(lookup(cardNo)!, {
      instanceId,
      ownerPlayerId,
      zone,
      normalCoreCount: zone === "deck" ? 0 : normalCoreCount,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make("BSTH10-X01", "domain", "field", "alice", 3),
      make(no, "top", "deck"),
      make("BSTH10-C04", "attacker", "field", "bob"),
    ],
    playerOverrides: [
      {
        handCount: 0,
        deckCount: 1,
        reserveNormalCoreCount: 10,
        reserveSoulCoreCount: 1,
      },
      {},
    ],
  });
  return {
    ...rebuildContinuousEffectsFromField(state, lookup),
    activePlayerId: "bob",
    step: "attack",
    window: "flash_before_block",
    turnNumber: 3,
    battleEntities: [
      {
        entityId: "attack",
        memberInstanceIds: ["attacker"],
        resolvedBp: 3000,
        resolvedSymbols: ["black"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-1",
      primaryEntityId: "attack",
      participantEntityIds: ["attack"],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        { participantEntityId: "attack", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attack"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
  };
}
describe("qa-057 公開デッキからのフラッシュ宣言", () => {
  it("通常召喚のコストが不足していても除外による軽減召喚を宣言できる", () => {
    const initial = board("BSTH10-M01");
    const state: GameState = {
      ...initial,
      players: initial.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveNormalCoreCount: 3,
              reserveSoulCoreCount: 0,
              handCount: 1,
            }
          : p
      ),
      cardInstances: [
        ...initial.cardInstances,
        createCardInstance(lookup("BSTH10-C01")!, {
          instanceId: "exile",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...registries,
    }).filter(
      (a) => a.kind === "use_hand_card_effect" && a.sourceInstanceId === "top"
    );
    expect(
      actions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          (a.choiceIndex === 1 || a.deferredChoiceIndexes?.includes(1))
      ),
      JSON.stringify(actions)
    ).toBe(true);
    expect(
      actions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          (a.choiceIndex === 0 || a.deferredChoiceIndexes?.includes(0))
      )
    ).toBe(false);
  });
  it.each(["BSTH10-M01", "BSTH10-X05"])(
    "%sを合法手から宣言してフィールドへ出す",
    (no) => {
      let state = board(no);
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...registries,
      }).find(
        (a) =>
          (a.kind === "use_hand_card_effect" || a.kind === "summon") &&
          a.sourceInstanceId === "top"
      );
      expect(
        action,
        JSON.stringify({
          actions: getLegalActions({
            state,
            actingPlayerId: "alice",
            ...registries,
          }),
          registrations: registries.getRegisteredHandActivatedEffectActions(no),
        })
      ).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        ...registries,
        ...(action?.kind === "summon"
          ? {
              paymentSources: [
                { kind: "reserve" as const, amount: action.finalCost },
              ],
            }
          : {}),
      }).state;
      expect(state.players[0]!.handCount).toBe(0);
      expect(state.players[0]!.deckCount).toBe(0);
      for (
        let i = 0;
        i < 12 &&
        state.cardInstances.find((c) => c.instanceId === "top")?.zone !==
          "field";
        i++
      ) {
        const actor = state.activeAttack?.flashWindowState?.pendingStackAction
          ? "bob"
          : "alice";
        const actions = getLegalActions({
          state,
          actingPlayerId: actor,
          ...registries,
        });
        const next =
          actions.find((a) => a.kind === "pass_battle_flash") ??
          actions.find(
            (a) =>
              a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0
          ) ??
          actions.find(
            (a) =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.choice === "execute"
          ) ??
          actions.find(
            (a) => a.kind === "resolve_pending_effect_summon_cost_payment"
          ) ??
          actions.find(
            (a) => a.kind === "resolve_pending_enter_field_placement"
          );
        expect(next, JSON.stringify({ actions, log: state.log })).toBeDefined();
        state = applyLegalAction({
          state,
          action: next!,
          ...registries,
          ...(state.pendingEffectSummonCostPayment
            ? {
                summonPaymentSources: [
                  {
                    kind: "reserve" as const,
                    amount: state.pendingEffectSummonCostPayment.requiredCost,
                  },
                ],
              }
            : {}),
          ...(state.pendingEnterFieldPlacement
            ? {
                enterFieldCorePlacements: [
                  { kind: "reserve_normal" as const, amount: 1 },
                ],
              }
            : {}),
        }).state;
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "top")?.zone,
        JSON.stringify(state.log)
      ).toBe("field");
      expect(state.players[0]!.handCount).toBe(0);
      expect(state.players[0]!.deckCount).toBe(0);
      if (no === "BSTH10-X05")
        expect(state.players[0]!.trashSoulCoreCount).toBe(1);
    }
  );
});
