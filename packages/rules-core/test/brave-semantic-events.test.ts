import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBraveSemanticEventsScenario } from "../../../apps/playground-web/src/scenario-brave-semantic-events";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createGameSnapshot,
  restoreSnapshot,
  sanitizeStateForViewer,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { restorePendingSchedulingAfterRollback } from "../src/effect/pending-resolution-policy";
import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
import { queueEnterFieldCorePlacement } from "../src/zone/enter-field-placement-pending";
import { executeSummonSelf } from "../src/effect/structured-summon";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";

const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const triggers = buildTriggeredEffectLookup(ALL_CARDS);
const bursts = buildBurstEffectLookup(ALL_CARDS);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: triggers,
  getRegisteredBurstActions: bursts,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};
const restore = (s: GameState): GameState =>
  restoreSnapshot(JSON.parse(JSON.stringify(createGameSnapshot(s))), lookup, {
    getRegisteredTriggeredEffectActions: triggers,
    getRegisteredBurstActions: bursts,
  }).state;
function apply(
  state: GameState,
  kind: LegalAction["kind"],
  extra: Partial<Parameters<typeof applyLegalAction>[0]> = {},
  select?: (a: LegalAction) => boolean
) {
  const action = ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...options })
    )
    .find((a) => a.kind === kind && (!select || select(a)));
  expect(action, `missing ${kind}`).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options, ...extra })
    .state;
}
function finish(state: GameState) {
  return finalizeEffectResolution({
    state,
    beforeState: state,
    chainId: "semantic-replay",
    endLogs: [],
    actingPlayerId: state.activePlayerId,
    causedBySourceInstanceId: "card-14",
    ...options,
  });
}
const oracle = (s: GameState) =>
  s.pendingTriggeredEffects.filter((p) => p.mechanic?.kind === "oracle");

describe("Telegram 629905088: operation-owned brave events", () => {
  it("a combine fact is consumed after departure and cannot be resurrected by a later unrelated field entry", () => {
    const before = buildBraveSemanticEventsScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "summon" })
    );
    const combined = executeBraveCombine(
      before,
      "alice",
      "card-3",
      "card-14",
      lookup
    );
    expect(combined.semanticTriggerEvents).toHaveLength(1);
    const departed: GameState = {
      ...combined,
      cardInstances: combined.cardInstances.map((c) =>
        c.instanceId === "card-3"
          ? {
              ...c,
              zone: "trash",
              zoneRoleName: "trash",
              attachedToInstanceId: null,
            }
          : c.instanceId === "card-14"
            ? { ...c, attachedChildrenIds: [] }
            : c
      ),
    };
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: departed,
      source: "action_resolution",
      ...options,
    });
    expect(events.filter((e) => e.eventKind === "brave_combined")).toHaveLength(
      1
    );
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: departed,
      source: "action_resolution",
      chainId: "departure-probe",
      ...options,
    });
    expect(queued.semanticTriggerEvents?.every((e) => e.delivered)).toBe(true);
    const reentered: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((c) =>
        c.instanceId === "card-3"
          ? { ...c, zone: "field", zoneRoleName: "brave", normalCoreCount: 1 }
          : c
      ),
    };
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: queued,
        afterState: reentered,
        source: "action_resolution",
        ...options,
      }).filter((e) => e.eventKind === "brave_combined")
    ).toHaveLength(0);
  });
  it.each(["alice", "bob", null])(
    "viewer=%s does not receive internal delivery receipts while authoritative snapshots preserve them",
    (viewer) => {
      const before = buildBraveSemanticEventsScenario(
        ALL_CARDS,
        new URLSearchParams({ mode: "summon" })
      );
      const state = recordSemanticTriggerEvent(before, {
        eventKind: "summon",
        relatedInstanceId: "card-3",
        fromZone: "hand",
      });
      const display = sanitizeStateForViewer(state, viewer);
      expect(display.semanticTriggerEvents).toBeUndefined();
      expect(display.semanticTriggerSequence).toBeUndefined();
      expect(restore(state).semanticTriggerEvents).toEqual(
        state.semanticTriggerEvents
      );
      expect(restore(state).semanticTriggerSequence).toBe(
        state.semanticTriggerSequence
      );
      expect(state.semanticTriggerEvents).toHaveLength(1);
    }
  );

  it("the common segment collector dispatches oracle with the summon before outer finalize", () => {
    const before = buildBraveSemanticEventsScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "summon" })
    );
    const summoned = executeSummonSelf(
      before,
      "segment-probe",
      "alice",
      { kind: "summon", target: "self", zone: "hand", withoutCost: true },
      "card-3",
      lookup,
      [],
      [{ kind: "reserve_normal", amount: 1 }]
    );
    expect(oracle(summoned)).toHaveLength(0);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: summoned,
      source: "action_resolution",
      chainId: "segment-probe",
      ...options,
    });
    expect(oracle(queued)).toHaveLength(1);
    expect(queued.semanticTriggerEvents?.every((e) => e.delivered)).toBe(true);
    const cleared = restore({
      ...queued,
      pendingTriggeredEffects: [],
      pendingDeferredTriggeredEffects: [],
    });
    expect(oracle(finish(cleared))).toHaveLength(0);
  });
  it("failed maintenance placement discards the tentative summon before a later entry of the same card", () => {
    const initial = buildBraveSemanticEventsScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "summon" })
    );
    const before: GameState = {
      ...initial,
      cardInstances: [
        initial.cardInstances.find((c) => c.instanceId === "card-3")!,
      ],
      players: initial.players.map((p) => ({
        ...p,
        reserveNormalCoreCount: 0,
        reserveSoulCoreCount: 0,
      })),
      activeContinuousEffects: [],
    };
    const tentative = recordSemanticTriggerEvent(
      {
        ...before,
        cardInstances: before.cardInstances.map((c) => ({
          ...c,
          zone: "field",
          zoneRoleName: "brave",
        })),
      },
      { eventKind: "summon", relatedInstanceId: "card-3", fromZone: "hand" }
    );
    const failed = queueEnterFieldCorePlacement({
      state: tentative,
      beforeState: before,
      instanceId: "card-3",
      getCardDefinitionById: lookup,
      eventKind: "summon",
    });
    expect(failed.cardInstances[0]?.zone).toBe("trash");
    expect(failed.semanticTriggerEvents).toEqual([]);
    const retry = recordSemanticTriggerEvent(
      {
        ...failed,
        cardInstances: failed.cardInstances.map((c) => ({
          ...c,
          zone: "field",
          zoneRoleName: "brave",
          normalCoreCount: 1,
        })),
      },
      { eventKind: "summon", relatedInstanceId: "card-3", fromZone: "trash" }
    );
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: failed,
        afterState: retry,
        source: "action_resolution",
        getCardDefinitionById: lookup,
      }).filter((e) => e.eventKind === "summon")
    ).toHaveLength(1);
  });
  it.each(["alice", "bob"])(
    "%s: X01 battle-end combines C21 and recovers, without any summon observation after save/restore",
    (owner) => {
      let pending = buildBraveSemanticEventsScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      expect(pending.pendingStepOptionalChoice).not.toBeNull();
      pending = apply(
        restore(pending),
        "resolve_pending_step_optional_choice",
        {},
        (action) =>
          action.kind === "resolve_pending_step_optional_choice" &&
          action.choice === "execute"
      );
      expect(pending.pendingStepOptionalTargetSelection).not.toBeNull();
      const combined = apply(
        restore(pending),
        "resolve_pending_step_optional_target_selection",
        { targetInstanceIds: ["card-3"] }
      );
      expect(
        combined.cardInstances.find((c) => c.instanceId === "card-3")
      ).toMatchObject({ zone: "field", attachedToInstanceId: "card-14" });
      expect(
        combined.cardInstances.find((c) => c.instanceId === "card-14")
          ?.exhaustState
      ).toBe("recovered");
      expect(oracle(combined)).toHaveLength(0);
      expect(
        combined.pendingBurstChecks.filter((p) => p.eventKind === "summon")
      ).toHaveLength(0);
      expect(
        combined.pendingTriggeredEffects.filter((p) => p.eventKind === "summon")
      ).toHaveLength(0);
      expect(combined.turnSummonedCardRefs ?? []).toHaveLength(0);
      expect(combined.semanticTriggerEvents?.map((e) => e.eventKind)).toEqual([
        "brave_combined",
      ]);
      expect(oracle(finish(restore(combined)))).toHaveLength(0);
    }
  );

  it("contract combine routes only its cause-limited trigger, even with C21's actual oracle-matching attributes", () => {
    // Mechanism probe: C21's category/accel/tribes are real; contract permission
    // and observer effects are synthetic and do not change the production card.
    const probe: CardDefinition = {
      ...lookup("BSTH08.5-C21")!,
      contractCombineData: {
        braveCondition: lookup("BSTH08.5-C21")!.braveCondition!,
        timingScope: { player: "self", period: "turn" },
      },
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [{ action: { kind: "noop" } }],
        },
        {
          timing: {
            kind: "card_event",
            event: "brave_combined",
            cause: ["contract_combine"],
          },
          steps: [{ action: { kind: "noop" } }],
        },
      ],
    };
    const defs = [...ALL_CARDS.filter((c) => c.cardNo !== probe.cardNo), probe];
    const local = {
      getCardDefinitionById: (id: string) => defs.find((c) => c.cardNo === id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
    };
    let state = buildBraveSemanticEventsScenario(
      defs,
      new URLSearchParams({ mode: "summon" })
    );
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveSoulCoreCount: 1,
              soulCoreLocation: { kind: "reserve" as const },
            }
          : p
      ),
    };
    const combine = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...local,
    }).find(
      (a) => a.kind === "contract_combine" && a.braveInstanceId === "card-3"
    );
    expect(combine).toBeDefined();
    state = applyLegalAction({
      state,
      action: combine!,
      ...local,
      targetInstanceIds: ["card-14"],
    }).state;
    for (
      let n = 0;
      n < 4 &&
      !state.semanticTriggerEvents?.some((e) => e.cause === "contract_combine");
      n++
    ) {
      const action = ["alice", "bob"]
        .flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...local })
        )
        .find(
          (a) =>
            a.kind === "pass_stack" ||
            a.kind === "resolve_pending_effect_target"
        );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        ...local,
        targetInstanceIds: ["card-14"],
      }).state;
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "card-3")
        ?.attachedToInstanceId
    ).toBe("card-14");
    expect(
      state.semanticTriggerEvents?.map((e) => [e.eventKind, e.cause])
    ).toEqual([["brave_combined", "contract_combine"]]);
    expect(
      state.pendingTriggeredEffects
        .filter((p) => p.relatedInstanceId === "card-3")
        .map((p) => [p.eventKind, p.cause])
    ).toEqual([["brave_combined", "contract_combine"]]);
    expect(oracle(state)).toHaveLength(0);
    expect(
      state.pendingBurstChecks.filter((p) => p.eventKind === "summon")
    ).toHaveLength(0);
    expect(state.turnSummonedCardRefs ?? []).toHaveLength(0);
  });

  it.each(["alice", "bob"])(
    "%s: asSummon direct combine emits both facts and exactly one X03 oracle across two pending restores",
    (owner) => {
      const selected = apply(
        restore(
          buildBraveSemanticEventsScenario(
            ALL_CARDS,
            new URLSearchParams({ owner, mode: "direct-summon" })
          )
        ),
        "resolve_pending_step_optional_target_selection",
        { targetInstanceIds: ["card-3"] }
      );
      expect(
        selected.pendingEnterFieldPlacement?.effectBraveCombineAsSummon
      ).toBeDefined();
      expect(oracle(selected)).toHaveLength(0);
      const combined = apply(
        restore(selected),
        "resolve_pending_enter_field_placement",
        { enterFieldCorePlacements: [] }
      );
      expect(
        combined.cardInstances.find((c) => c.instanceId === "card-3")
          ?.attachedToInstanceId
      ).toBe("card-14");
      expect(oracle(combined)).toHaveLength(1);
      expect(oracle(combined)[0]?.mechanic).toMatchObject({
        triggerKind: "summon",
        triggerCardInstanceId: "card-3",
      });
      expect(combined.turnSummonedCardRefs?.map((r) => r.instanceId)).toEqual([
        "card-3",
      ]);
      expect(
        combined.semanticTriggerEvents?.map((e) => e.eventKind).sort()
      ).toEqual(["brave_combined", "summon"]);
      expect(oracle(finish(restore(combined)))).toHaveLength(1);
      const cleared = {
        ...combined,
        pendingTriggeredEffects: [],
        pendingDeferredTriggeredEffects: [],
      };
      expect(oracle(finish(restore(cleared)))).toHaveLength(0);
    }
  );

  it.each([null, "card-14"])(
    "normal C21 summon (host=%s) issues one oracle, one summon record, and combine only with a host",
    (host) => {
      let state = buildBraveSemanticEventsScenario(
        ALL_CARDS,
        new URLSearchParams({ mode: "summon" })
      );
      state = apply(
        state,
        "summon",
        { paymentSources: [{ kind: "reserve", amount: 2 }] },
        (a) => a.kind === "summon" && a.sourceInstanceId === "card-3"
      );
      state = apply(state, "pass_stack");
      state = apply(
        state,
        "resolve_brave_combine_choice",
        {},
        (a) =>
          a.kind === "resolve_brave_combine_choice" &&
          a.chosenHostInstanceId === host
      );
      state = apply(restore(state), "resolve_pending_enter_field_placement", {
        enterFieldCorePlacements: host
          ? []
          : [{ kind: "reserve_normal", amount: 1 }],
      });
      expect(oracle(state)).toHaveLength(1);
      expect(state.turnSummonedCardRefs?.map((r) => r.instanceId)).toEqual([
        "card-3",
      ]);
      expect(
        state.semanticTriggerEvents?.filter(
          (e) => e.eventKind === "brave_combined"
        )
      ).toHaveLength(host ? 1 : 0);
    }
  );

  it.each(["brave", "spirit"])(
    "forged display logs and field/attachment differences cannot issue brave summon/combine (role=%s)",
    (role) => {
      const before = buildBraveSemanticEventsScenario(
        ALL_CARDS,
        new URLSearchParams({ mode: "summon" })
      );
      const after = {
        ...before,
        cardInstances: before.cardInstances.map((c) =>
          c.instanceId === "card-3"
            ? {
                ...c,
                zone: "field" as const,
                zoneRoleName: role,
                attachedToInstanceId: "card-14",
              }
            : c
        ),
        log: [
          ...before.log,
          "effect:summon:card-3:direct-combine:from=hand:cost=0",
          "brave:combine:effect:21:alice:card-3:card-14",
        ],
      };
      expect(
        collectTriggerEventsFromStateDelta({
          beforeState: before,
          afterState: after,
          source: "action_resolution",
          getCardDefinitionById: lookup,
        }).filter(
          (e) => e.eventKind === "summon" || e.eventKind === "brave_combined"
        )
      ).toHaveLength(0);
    }
  );

  it("cancelled tentative facts disappear, committed receipts survive and IDs are never reused", () => {
    const before = buildBraveSemanticEventsScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "summon" })
    );
    const tentative = recordSemanticTriggerEvent(before, {
      eventKind: "summon",
      relatedInstanceId: "card-3",
    });
    const cancelled = restorePendingSchedulingAfterRollback(before, tentative);
    expect(cancelled.semanticTriggerEvents).toEqual([]);
    const next = recordSemanticTriggerEvent(cancelled, {
      eventKind: "summon",
      relatedInstanceId: "card-3",
    });
    expect(next.semanticTriggerSequence).toBe(2);
    const committed = {
      ...tentative,
      semanticTriggerEvents: tentative.semanticTriggerEvents!.map((e) => ({
        ...e,
        delivered: true,
      })),
    };
    expect(
      restorePendingSchedulingAfterRollback(before, committed)
        .semanticTriggerEvents
    ).toEqual(committed.semanticTriggerEvents);
  });

  it.each([false, true])(
    "summon effects and an explicit brave summon burst require the summon fact (asSummon=%s)",
    (asSummon) => {
      const base = buildBraveSemanticEventsScenario(
        ALL_CARDS,
        new URLSearchParams({ mode: "summon" })
      );
      const braveDef: CardDefinition = {
        ...lookup("BSTH08.5-C21")!,
        effects: [
          {
            timing: { kind: "card_event", event: "summon" },
            steps: [{ action: { kind: "noop" } }],
          },
        ],
      };
      const burstDef: CardDefinition = {
        ...lookup("BSTH08.5-X01")!,
        cardNo: "TEST-BRAVE-BURST",
        effects: [
          {
            timing: {
              kind: "burst",
              trigger: { kind: "opponent_summon" },
              triggerFilter: { category: ["brave"] },
            },
            steps: [{ action: { kind: "noop" } }],
          },
        ],
      };
      const defs = [
        ...ALL_CARDS.filter((c) => c.cardNo !== braveDef.cardNo),
        braveDef,
        burstDef,
      ];
      const lookups = {
        getCardDefinitionById: (id: string) =>
          defs.find((d) => d.cardNo === id),
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
        getRegisteredBurstActions: buildBurstEffectLookup(defs),
      };
      let state: GameState = {
        ...base,
        cardInstances: [
          ...base.cardInstances.map((c) =>
            c.instanceId === "card-3"
              ? {
                  ...c,
                  zone: "field" as const,
                  attachedToInstanceId: "card-14",
                }
              : c
          ),
          createCardInstance(burstDef, {
            instanceId: "burst",
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            zone: "burst",
          }),
        ],
        setBurstStates: [{ playerId: "bob", cardInstanceId: "burst" }],
      };
      state = recordSemanticTriggerEvent(state, {
        eventKind: "brave_combined",
        relatedInstanceId: "card-3",
        triggerRelatedCombinedHostInstanceId: "card-14",
      });
      if (asSummon)
        state = recordSemanticTriggerEvent(state, {
          eventKind: "summon",
          relatedInstanceId: "card-3",
          fromZone: "hand",
        });
      const queued = collectAndQueueTriggerReactions({
        beforeState: base,
        afterState: state,
        source: "action_resolution",
        chainId: "test-semantic-observers",
        ...lookups,
      });
      expect(
        queued.pendingTriggeredEffects.filter((p) => p.eventKind === "summon")
      ).toHaveLength(asSummon ? 1 : 0);
      expect(
        queued.pendingBurstChecks.filter((p) => p.eventKind === "summon")
      ).toHaveLength(asSummon ? 1 : 0);
      const cleared = restore({
        ...queued,
        pendingTriggeredEffects: [],
        pendingBurstChecks: [],
      });
      const replayed = collectAndQueueTriggerReactions({
        beforeState: base,
        afterState: cleared,
        source: "action_resolution",
        chainId: "test-semantic-observers",
        ...lookups,
      });
      expect(replayed.pendingTriggeredEffects).toHaveLength(0);
      expect(replayed.pendingBurstChecks).toHaveLength(0);
    }
  );
});
