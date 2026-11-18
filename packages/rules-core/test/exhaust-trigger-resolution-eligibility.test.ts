import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { moveCardZone, updateCard } from "../src/core/core-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import { getTriggeredMechanicActivationState } from "../src/effect/triggered-mechanic-eligibility";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { resolveGrantedEffectMechanic } from "../src/legal/mechanic-trigger-handlers";
import { resolveDeferredTriggeredEffectStack } from "../src/legal/stack-resolution-core";
import {
  createGameSnapshot,
  parseGameSnapshot,
  restoreSnapshot,
} from "../src/snapshot";
import { advanceSoulStateGeneration } from "../src/effect/effect-usage-lifecycle";
import type { Effect } from "../src/dsl-types";
import type {
  CardDefinition,
  ActiveStack,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";

// Official Eternal Q31576 (2026-04-10): when the exhausted subject recovers
// or leaves before another waiting exhaust effect, that effect cannot activate.
// The printed question has no self-only qualifier; third-party coverage applies
// the same rule to the captured event subject, including a spirit-state Brave.
const gainCore: Effect["steps"] = [
  {
    action: {
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 1,
    },
  },
];
const observe: Effect = {
  timing: {
    kind: "game_event",
    event: "exhaust",
    player: "self",
    triggerFilter: { category: ["spirit"] },
  },
  steps: gainCore,
};

function definition(
  cardNo: string,
  category: "spirit" | "brave",
  effects: Effect[] = []
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    symbolColors: ["red"],
    tribe: cardNo,
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

function fixture(category: "spirit" | "brave", multiple = false) {
  const subject = definition("SUBJECT", category, [
    { timing: { kind: "card_event", event: "exhaust" }, steps: gainCore },
  ]);
  const second = definition("SECOND", category);
  const observer = definition("OBSERVER", "spirit", [observe]);
  const firstOnly = definition("FIRST-ONLY", "spirit", [
    {
      ...observe,
      timing: {
        kind: "game_event",
        event: "exhaust",
        player: "self",
        triggerFilter: { category: ["spirit"], tribes: ["SUBJECT"] },
      },
    },
  ]);
  const defs = [subject, second, observer, firstOnly];
  const deps = {
    getCardDefinitionById: (id: string) =>
      defs.find((def) => def.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
  };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { reserveNormalCoreCount: 0, voidNormalCoreCount: 20 },
      {},
    ],
    cardInstances: [
      subject,
      observer,
      ...(multiple ? [second, firstOnly] : []),
    ].map((def) =>
      createCardInstance(def, {
        instanceId: def.cardNo.toLowerCase(),
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState:
          def === subject || def === second ? "exhausted" : "recovered",
      })
    ),
  });
  return {
    state: { ...state, step: "main" as const, window: "none" as const },
    deps,
  };
}

function event(id = "subject", chainId = "fatigue"): CollectedTriggerEvent {
  return {
    eventKind: "exhaust",
    source: "action_resolution",
    actingPlayerId: "alice",
    relatedPlayerId: "alice",
    relatedInstanceId: id,
    chainId,
    attackId: null,
    amount: 1,
  };
}

function available(
  state: GameState,
  deps: ReturnType<typeof fixture>["deps"],
  pendings = state.pendingTriggeredEffects
) {
  return pendings.flatMap((pendingEffect) =>
    getAvailableTriggeredEffectSourceChoices({ state, pendingEffect, ...deps })
  );
}

function interrupt(
  state: GameState,
  kind: "recover" | "leave",
  id = "subject"
) {
  return kind === "recover"
    ? updateCard(state, id, (card) => ({ ...card, exhaustState: "recovered" }))
    : moveCardZone(state, id, "hand");
}

function waitToLeave(state: GameState, kind: "destroy" | "vanish") {
  const pending = updateCard(state, "subject", (card) => ({
    ...card,
    pendingLeaveKind: kind,
    pendingLeaveCause: "effect",
    pendingLeaveChainId: "prior-leave",
  }));
  return {
    ...pending,
    pendingLeaveEntities: [
      ...pending.pendingLeaveEntities,
      {
        instanceId: "subject",
        kind,
        cause: "effect" as const,
        causePlayerId: "bob",
        chainId: "prior-leave",
        deferZoneMoveUntilChainEnd: true,
      },
    ],
  };
}

describe.each(["spirit", "brave"] as const)(
  "Q31576: %s subject",
  (category) => {
    it.each(["recover", "leave"] as const)(
      "%s makes self and third-party pending effects unavailable",
      (kind) => {
        const { state: base, deps } = fixture(category);
        const state = queuePendingReactionsFromTriggerEvents(
          base,
          [event()],
          undefined,
          deps
        );
        expect(
          new Set(
            available(state, deps).map((choice) => choice.sourceCard.instanceId)
          )
        ).toEqual(new Set(["subject", "observer"]));
        expect(available(interrupt(state, kind), deps)).toHaveLength(0);
      }
    );

    it.each(["recover", "leave"] as const)(
      "%s followed by a new exhaustion cannot revive the old pending without a prune",
      (kind) => {
        const { state: base, deps } = fixture(category);
        let state = queuePendingReactionsFromTriggerEvents(
          base,
          [event()],
          undefined,
          deps
        );
        const oldPendings = state.pendingTriggeredEffects;
        state = interrupt(state, kind);
        if (kind === "leave") state = moveCardZone(state, "subject", "field");
        state = updateCard(state, "subject", (card) => ({
          ...card,
          exhaustState: "exhausted",
          normalCoreCount: 1,
        }));
        expect(state.pendingTriggeredEffects).toEqual(oldPendings);
        expect(available(state, deps, oldPendings)).toHaveLength(0);
        state = queuePendingReactionsFromTriggerEvents(
          state,
          [event("subject", "new-fatigue")],
          undefined,
          deps
        );
        const newPendings = state.pendingTriggeredEffects.filter(
          (pending) =>
            !oldPendings.some((old) => old.pendingId === pending.pendingId)
        );
        expect(
          available(state, deps, newPendings).some(
            (choice) => choice.sourceCard.instanceId === "observer"
          )
        ).toBe(true);
      }
    );

    it("keeps only sources with a still-valid subject in an aggregate, without relying on the representative", () => {
      const { state: base, deps } = fixture(category, true);
      let state = queuePendingReactionsFromTriggerEvents(
        base,
        [event(), event("second")],
        undefined,
        deps
      );
      const observerPending = state.pendingTriggeredEffects.find((pending) =>
        available(state, deps, [pending]).some(
          (choice) => choice.sourceCard.instanceId === "observer"
        )
      )!;
      expect(
        observerPending.relatedInstanceIdsBySourceRegistrationKey?.[
          "observer#0"
        ]
      ).toEqual(expect.arrayContaining(["subject", "second"]));
      state = interrupt(state, "leave");
      const choices = available(state, deps);
      expect(
        choices.some((choice) => choice.sourceCard.instanceId === "observer")
      ).toBe(true);
      expect(
        choices.some((choice) => choice.sourceCard.instanceId === "first-only")
      ).toBe(false);
      state = interrupt(state, "recover", "second");
      expect(available(state, deps)).toHaveLength(0);
    });

    it("heavy exhaustion keeps the original waiting effect eligible", () => {
      const { state: base, deps } = fixture(category);
      let state = queuePendingReactionsFromTriggerEvents(
        base,
        [event()],
        undefined,
        deps
      );
      state = updateCard(state, "subject", (card) => ({
        ...card,
        exhaustState: "heavily_exhausted",
      }));
      expect(
        available(state, deps).some(
          (choice) => choice.sourceCard.instanceId === "observer"
        )
      ).toBe(true);
    });

    it("restores an eligible legacy pending with prior field/soul generations, then permanently invalidates it on recovery", () => {
      const { state: base, deps } = fixture(category);
      const priorLife = updateCard(base, "subject", (card) => ({
        ...card,
        fieldInstanceGeneration: 4,
        soulStateGeneration: 3,
      }));
      const queued = queuePendingReactionsFromTriggerEvents(
        priorLife,
        [event()],
        undefined,
        deps
      );
      const legacy = {
        ...queued,
        pendingTriggeredEffects: queued.pendingTriggeredEffects.map(
          ({ exhaustTriggerSubjects: _old, ...pending }) => pending
        ),
      };
      const parsed = parseGameSnapshot(
        JSON.parse(JSON.stringify(createGameSnapshot(legacy)))
      );
      if (!parsed.ok) throw new Error(parsed.error);
      let restored = restoreSnapshot(
        parsed.snapshot,
        deps.getCardDefinitionById,
        deps
      ).state;
      expect(
        available(restored, deps).some(
          (choice) => choice.sourceCard.instanceId === "observer"
        )
      ).toBe(true);
      restored = interrupt(restored, "recover");
      restored = updateCard(restored, "subject", (card) => ({
        ...card,
        exhaustState: "exhausted",
      }));
      expect(available(restored, deps)).toHaveLength(0);
    });

    it("legacy pending cannot revive after the shared soul-state boundary even without a recovery stamp", () => {
      const { state: base, deps } = fixture(category);
      const queued = queuePendingReactionsFromTriggerEvents(
        base,
        [event()],
        undefined,
        deps
      );
      const legacy = {
        ...queued,
        pendingTriggeredEffects: queued.pendingTriggeredEffects.map(
          ({ exhaustTriggerSubjects: _old, ...pending }) => pending
        ),
      };
      let state = advanceSoulStateGeneration(
        legacy,
        {
          ...legacy,
          players: legacy.players.map((player) =>
            player.id === "alice"
              ? { ...player, soulStateInstanceIds: ["subject"] }
              : player
          ),
        },
        deps.getCardDefinitionById
      );
      state = {
        ...state,
        players: state.players.map((player) => ({
          ...player,
          soulStateInstanceIds: [],
        })),
      };
      expect(available(state, deps)).toHaveLength(0);
    });

    it.each(["still-exhausted", "recovered", "re-exhausted"] as const)(
      "rechecks a declared normal effect at deferred resolution: %s",
      (mode) => {
        const { state: base, deps } = fixture(category);
        const queued = queuePendingReactionsFromTriggerEvents(
          base,
          [event()],
          undefined,
          deps
        );
        const pending = queued.pendingTriggeredEffects.find((entry) =>
          available(queued, deps, [entry]).some(
            (choice) => choice.sourceCard.instanceId === "observer"
          )
        )!;
        const stack: ActiveStack = {
          stackId: "declared-fatigue",
          actionKind: "triggered_effect",
          chainId: "trigger:declared-fatigue",
          actingPlayerId: "alice",
          cardInstanceId: "observer",
          cardDefinitionId: "OBSERVER",
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
          triggeredPendingSnapshot: pending,
          triggeredRegistrationIndex: 0,
          triggeredSourceCardNo: "OBSERVER",
          triggeredSourceKind: "spirit",
        };
        let state: GameState = { ...queued, pendingTriggeredEffects: [] };
        if (mode !== "still-exhausted") state = interrupt(state, "recover");
        if (mode === "re-exhausted")
          state = updateCard(state, "subject", (card) => ({
            ...card,
            exhaustState: "exhausted",
          }));
        let calls = 0;
        resolveDeferredTriggeredEffectStack(state, stack, {
          ...deps,
          resolvePendingTriggeredEffect: (current) => {
            calls++;
            return current;
          },
        });
        expect(calls).toBe(mode === "still-exhausted" ? 1 : 0);
      }
    );

    function grantedFixture(multiple = false) {
      const { state: base, deps } = fixture(category, multiple);
      const state: GameState = {
        ...base,
        activeContinuousEffects: [
          {
            effectId: "grant",
            sourceInstanceId: "observer",
            sourceDefinitionId: "OBSERVER",
            actingPlayerId: "alice",
            targetInstanceId: "observer",
            modifierTag: "granted_effect",
            duration: { scope: "turn" },
            createdAtTurn: base.turnNumber,
            createdAtAttackId: null,
            metadata: { grantedEffect: observe },
          },
        ],
      };
      return {
        state: queueGrantedEffectTriggersFromTriggerEvents(
          state,
          multiple ? [event(), event("second")] : [event()],
          deps.getCardDefinitionById
        ),
        deps,
      };
    }

    const mechanic = (pending: PendingTriggeredEffect) => {
      if (pending.mechanic?.kind !== "granted_effect")
        throw new Error("Expected granted effect");
      return pending.mechanic;
    };

    it.each(["destroy", "vanish"] as const)(
      "%s waiting subject stays observable; the effect's own source must remain eligible",
      (kind) => {
        const { state: base, deps } = fixture(category);
        const queued = queuePendingReactionsFromTriggerEvents(
          base,
          [event()],
          undefined,
          deps
        );
        const waiting = waitToLeave(queued, kind);
        expect(
          new Set(
            available(waiting, deps).map(
              (choice) => choice.sourceCard.instanceId
            )
          )
        ).toEqual(new Set(["observer"]));

        const { state: granted, deps: grantDeps } = grantedFixture();
        const observerGrant = mechanic(granted.pendingTriggeredEffects[0]!);
        const grantedWaiting = waitToLeave(granted, kind);
        expect(
          getTriggeredMechanicActivationState(
            grantedWaiting,
            observerGrant,
            grantDeps.getCardDefinitionById
          ).canActivate
        ).toBe(true);
        const ownGrant = { ...observerGrant, granteeInstanceId: "subject" };
        expect(
          getTriggeredMechanicActivationState(
            grantedWaiting,
            ownGrant,
            grantDeps.getCardDefinitionById
          ).canActivate
        ).toBe(false);
        const unchanged = resolveGrantedEffectMechanic(
          grantDeps,
          grantedWaiting,
          ownGrant,
          "alice",
          true,
          1,
          "self-waiting"
        );
        expect(unchanged.players[0]!.reserveNormalCoreCount).toBe(0);
      }
    );

    it.each(["recover", "leave"] as const)(
      "granted effect uses the original subject after %s and never revives",
      (kind) => {
        const { state: base, deps } = grantedFixture();
        expect(base.pendingTriggeredEffects).toHaveLength(1);
        const grant = mechanic(base.pendingTriggeredEffects[0]!);
        expect(base.pendingTriggeredEffects[0]!.relatedInstanceId).toBe(
          "observer"
        );
        expect(
          grant.exhaustTriggerSubjects?.map((entry) => entry.instanceId)
        ).toEqual(["subject"]);
        expect(
          getTriggeredMechanicActivationState(
            base,
            grant,
            deps.getCardDefinitionById
          ).canActivate
        ).toBe(true);
        const resolved = resolveGrantedEffectMechanic(
          deps,
          base,
          grant,
          "alice",
          true,
          1,
          "granted-live"
        );
        expect(resolved.players[0]!.reserveNormalCoreCount).toBe(1);
        let state = interrupt(base, kind);
        expect(
          getTriggeredMechanicActivationState(
            state,
            grant,
            deps.getCardDefinitionById
          ).canActivate
        ).toBe(false);
        if (kind === "leave") state = moveCardZone(state, "subject", "field");
        state = updateCard(state, "subject", (card) => ({
          ...card,
          exhaustState: "exhausted",
          normalCoreCount: 1,
        }));
        expect(
          getTriggeredMechanicActivationState(
            state,
            grant,
            deps.getCardDefinitionById
          ).canActivate
        ).toBe(false);
        const suppressed = resolveGrantedEffectMechanic(
          deps,
          state,
          grant,
          "alice",
          true,
          1,
          "granted-old"
        );
        expect(suppressed.players[0]!.reserveNormalCoreCount).toBe(0);
      }
    );

    it("granted aggregate remains eligible until every captured fatigue subject is invalid", () => {
      const { state: base, deps } = grantedFixture(true);
      const grant = mechanic(base.pendingTriggeredEffects[0]!);
      expect(
        grant.exhaustTriggerSubjects?.map((entry) => entry.instanceId)
      ).toEqual(["subject", "second"]);
      let state = interrupt(base, "leave");
      expect(
        getTriggeredMechanicActivationState(
          state,
          grant,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(true);
      state = interrupt(state, "recover", "second");
      expect(
        getTriggeredMechanicActivationState(
          state,
          grant,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(false);
    });
  }
);
