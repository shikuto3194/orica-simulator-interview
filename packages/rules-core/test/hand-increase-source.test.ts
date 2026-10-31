import { describe, expect, it } from "vitest";
import { materializeDeferredTrashOptionalAdds } from "../src/effect/structured-trash-ops";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildHandIncreaseBurstScenario } from "../../../apps/playground-web/src/scenario-hand-increase-burst";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  collectTriggerEventsFromStateDelta,
  createCardInstance,
  executeEffect,
  getAvailableBurstSourceChoices,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  sanitizeStateForViewer,
  type CardDefinition,
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
function initial() {
  return buildHandIncreaseBurstScenario(
    ALL_CARDS,
    new URLSearchParams({ owner: "bob", stage: "self-recovery" })
  );
}
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
  const action = actions.find((candidate) => candidate.kind === kind);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}

function withRecoveryCauses() {
  let state = act(initial(), "bob", "use_field_card_effect");
  state = act(state, "alice", "pass_stack");
  state = act(state, "bob", "resolve_pending_deck_reveal_pick", {
    selectedDeckRevealCardIds: ["blazing"],
  });
  state = act(state, "bob", "resolve_pending_deck_reveal_pick", {
    selectedDeckRevealCardIds: ["night1", "night2", "night3"],
  });
  state = act(state, "bob", "resolve_pending_deck_reveal_order", {
    deckRevealRemainderOrder: ["rest1", "rest2", "rest3", "rest4"],
    deckRevealRemainderPlacements: {
      rest1: "bottom",
      rest2: "bottom",
      rest3: "bottom",
      rest4: "bottom",
    },
  });
  return state;
}

describe("手札増加の効果元", () => {
  it("ブレイジングスターの自己回収とソルティリーナの3枚回収を別の原因で保持する", () => {
    const state = withRecoveryCauses();
    expect(state.players[1]!.handCount).toBe(4);
    expect(state.pendingBurstChecks).toMatchObject([
      {
        amount: 1,
        relatedInstanceId: "blazing",
        event: { cause: "self_effect", effectSourceDefinitionId: "BSTH01-C21" },
      },
      {
        amount: 3,
        relatedInstanceId: "soltiliena",
        event: { cause: "self_effect" },
      },
    ]);
    // 公開済みの原因名は残し、非公開手札の現在のカード情報には依存しない。
    const visible = sanitizeStateForViewer(state, "alice");
    expect(
      visible.cardInstances.find((c) => c.instanceId === "blazing")
        ?.definitionId
    ).toBe("_hidden_card_");
    expect(visible.pendingBurstChecks[0]?.event?.effectSourceDefinitionId).toBe(
      "BSTH01-C21"
    );
  });

  it.each([
    ["blazing", 1],
    ["soltiliena", 3],
  ] as const)(
    "%s を原因に発動すると他方の確認が消え、効果は1回だけ解決する",
    (cause, amount) => {
      let state = withRecoveryCauses();
      const selected = state.pendingBurstChecks.find(
        (p) => p.relatedInstanceId === cause
      )!;
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (a) =>
          a.kind === "resolve_pending_burst_check" &&
          a.checkId === selected.checkId
      )!;
      state = applyLegalAction({
        state,
        action,
        ...lookups,
      }).state;
      expect(state.pendingBurstChecks).toEqual([
        { ...selected, activationSelected: true },
      ]);
      expect(state.stackWindow?.burstWindowKind).toBe("activation");
      expect(
        state.stackWindow?.pendingStackAction?.burstPendingSnapshot
      ).toMatchObject({ relatedInstanceId: cause, amount });
      state = act(state, "bob", "pass_stack");
      expect(state.stackWindow?.burstWindowKind).toBe("effect_declaration");
      expect(
        state.stackWindow?.pendingStackAction?.burstPendingSnapshot
      ).toMatchObject({ relatedInstanceId: cause, amount });
      state = act(state, "bob", "pass_stack");
      expect(state.players[0]!.reserveNormalCoreCount).toBe(12);
      state = act(state, "alice", "resolve_pending_multi_placement", {
        multiPlacementAllocations: [
          {
            destinationInstanceId: "souei",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      });
      expect(state.players[0]!.reserveNormalCoreCount).toBe(11); // +2、召喚維持コア -1
      expect(
        state.cardInstances.find((c) => c.instanceId === "souei")
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(state.pendingBurstChecks).toEqual([]);
      expect(state.revealedBurstStates).toEqual([]);
      expect(
        state.log.filter((line) =>
          line.startsWith("burst:activation-selected:")
        )
      ).toHaveLength(1);

      // 同じ chainId でも、後から別の事象・別カードの発動機会が生じれば受け付ける。
      state = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(definitions.get("BSTS01-R02")!, {
            instanceId: "later",
            ownerPlayerId: "alice",
            zone: "burst",
          }),
        ],
        setBurstStates: [{ playerId: "alice", cardInstanceId: "later" }],
      };
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "bob",
            eventKind: "increase_hand",
            source: selected.source,
            chainId: selected.chainId,
            attackId: null,
            relatedPlayerId: "bob",
            relatedInstanceId: "soltiliena",
            amount: 2,
            cause: "self_effect",
          },
        ],
        undefined,
        lookups
      );
      expect(state.pendingBurstChecks).toMatchObject([
        { amount: 2, activationSelected: false },
      ]);
      expect(
        getAvailableBurstSourceChoices({
          state,
          pendingBurstCheck: state.pendingBurstChecks[0]!,
          ...lookups,
        }).map((c) => c.sourceCard.instanceId)
      ).toEqual(["later"]);
    }
  );

  it("別カードの手札バーストと相手の確認を残し、宣言済みカードは再選択できない", () => {
    const base = withRecoveryCauses();
    const getRegisteredBurstActions = (id: string) => {
      const registrations = lookups.getRegisteredBurstActions(id);
      return id === "BSTS01-R02"
        ? [...registrations!, { ...registrations![0]!, handSource: true }]
        : registrations;
    };
    const options = { ...lookups, getRegisteredBurstActions };
    let state: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(definitions.get("BSTS01-R02")!, {
          instanceId: "hand-burst",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(definitions.get("BSTS01-R02")!, {
          instanceId: "opponent-burst",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 1 } : p
      ),
      setBurstStates: [
        ...base.setBurstStates,
        { playerId: "bob", cardInstanceId: "opponent-burst" },
      ],
      pendingBurstChecks: [
        ...base.pendingBurstChecks,
        {
          ...base.pendingBurstChecks[0]!,
          checkId: "opponent-check",
          actingPlayerId: "bob",
          relatedPlayerId: "alice",
        },
      ],
    };
    const select = (checkId: string, sourceId: string) => {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...options,
      }).find(
        (a) =>
          a.kind === "resolve_pending_burst_check" &&
          a.checkId === checkId &&
          a.sourceInstanceId === sourceId
      )!;
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action, ...options }).state;
    };
    const staleAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...options,
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        a.checkId === base.pendingBurstChecks[1]!.checkId &&
        a.sourceInstanceId === "souei"
    )!;
    select(base.pendingBurstChecks[0]!.checkId, "souei");
    expect(() =>
      applyLegalAction({ state, action: staleAction, ...options })
    ).toThrow("Burst activation already selected");
    expect(state.pendingBurstChecks).toHaveLength(3);
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...options,
    });
    expect(
      actions
        .filter((a) => a.kind === "resolve_pending_burst_check")
        .map((a) => a.sourceInstanceId)
    ).toEqual(["hand-burst"]);
    select(base.pendingBurstChecks[1]!.checkId, "hand-burst");
    expect(
      state.pendingBurstChecks.filter((p) => p.activationSelected)
    ).toHaveLength(2);
    expect(state.revealedBurstStates.map((r) => r.cardInstanceId)).toEqual([
      "souei",
      "hand-burst",
    ]);
    expect(
      state.pendingBurstChecks.find((p) => p.checkId === "opponent-check")
        ?.activationSelected
    ).toBe(false);
    expect(
      getLegalActions({ state, actingPlayerId: "bob", ...options })
        .filter((a) => a.kind === "resolve_pending_burst_check")
        .map((a) => a.sourceInstanceId)
    ).toEqual(["opponent-burst"]);
  });

  it.each([
    ["optional", "open"],
    ["mandatory", "open"],
    ["optional", "trash"],
    ["mandatory", "trash"],
  ] as const)(
    "複数の%s自己回収（%s）は1枚ずつ別の効果元になる",
    (mode, route) => {
      const base = initial();
      const blazing = definitions.get("BSTH01-C21")!;
      const selfDef: CardDefinition = {
        ...blazing,
        effects: blazing.effects!.map((effect, i) =>
          i === 0 ? { ...effect, executionMode: mode } : effect
        ),
      };
      const getCardDefinitionById = (id: string) =>
        id === selfDef.cardNo ? selfDef : definitions.get(id);
      const before: GameState = {
        ...base,
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "night1"
            ? { ...card, definitionId: selfDef.cardNo }
            : card
        ),
      };
      const effect = {
        timing: { kind: "activated" as const, mode: "main" as const },
        steps: [
          {
            action:
              route === "open"
                ? {
                    kind: "deck_reveal" as const,
                    revealCount: 2,
                    picks: [],
                    remainder: "trash" as const,
                  }
                : {
                    kind: "discard" as const,
                    fromZone: "deck" as const,
                    count: 2,
                  },
          },
        ],
      };
      let after = executeEffect({
        chainId: "test:hand-increase-source:347",
        state: before,
        effect,
        actingPlayerId: "bob",
        sourceInstanceId: "soltiliena",
        ...lookups,
        getCardDefinitionById,
      });
      after = materializeDeferredTrashOptionalAdds(after);
      if (mode === "optional") {
        const actions = getLegalActions({
          state: after,
          actingPlayerId: "bob",
          ...lookups,
          getCardDefinitionById,
        });
        const action = actions.find(
          (a) => a.kind === "resolve_pending_deck_reveal_pick"
        )!;
        expect(action, JSON.stringify(actions)).toBeDefined();
        after = applyLegalAction({
          state: after,
          action,
          selectedDeckRevealCardIds: ["blazing", "night1"],
          ...lookups,
          getCardDefinitionById,
        }).state;
      }
      expect(after.players[1]!.handCount).toBe(2);
      const events = collectTriggerEventsFromStateDelta({
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        causedByPlayerId: "bob",
        causedBySourceInstanceId: "soltiliena",
        getCardDefinitionById,
      }).filter((e) => e.eventKind === "increase_hand");
      expect(events.map((e) => [e.relatedInstanceId, e.amount])).toEqual([
        ["blazing", 1],
        ["night1", 1],
      ]);
    }
  );
});
