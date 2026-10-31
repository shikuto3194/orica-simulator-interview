import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  getLegalActions,
  queueFlashUsedTriggers,
  queuePendingReactionsFromTriggerEvents,
  type ApplyLegalActionOptions,
  type CardDefinition,
  type GameState,
} from "../src";
import { generateActionInputChoices } from "../src/action-input-choices";
import { finishCoreChoices } from "./helpers/core-choice-driver";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definition = (id: string) => definitions.find((d) => d.cardNo === id)!;
const lookup = (id: string) => definitions.find((d) => d.cardNo === id);
function lookups(cardNo: string) {
  const cards = [definition(cardNo)];
  return {
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
}
const card = (
  no: string,
  instanceId: string,
  zone: "hand" | "field" | "deck" | "in_use" | "trash",
  normalCoreCount = 0,
  ownerPlayerId = "alice"
) =>
  createCardInstance(definition(no), {
    instanceId,
    ownerPlayerId,
    zone,
    normalCoreCount,
  });
const resources = (s: GameState) => ({
  cards: s.cardInstances,
  players: s.players,
  usage: s.effectUsageRecords,
  effects: s.activeContinuousEffects,
});

/** Acts through public choices with the subject's real registrations enabled. */
function settle(
  state: GameState,
  lo: ReturnType<typeof lookups>,
  mode: "execute" | "decline" = "execute"
) {
  for (let n = 0; n < 80; n++) {
    state = finishCoreChoices(state, lo.getCardDefinitionById, lo);
    const all = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lo })
    );
    const next =
      all.find((a) =>
        mode === "decline"
          ? a.kind === "skip_private_triggered_effect"
          : a.kind === "declare_private_triggered_effect"
      ) ??
      all.find((a) => a.kind === "resolve_pending_triggered_effect") ??
      all.find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" && a.choice === mode
      ) ??
      all.find((a) =>
        [
          "resolve_pending_effect_target",
          "resolve_pending_zone_selection",
          "resolve_pending_step_choice",
          "resolve_pending_core_shoot",
          "resolve_core_source_allocation",
          "pass_stack",
          "pass_pre_declaration_stack",
        ].includes(a.kind)
      ) ??
      all.find((a) => a.kind === "skip_private_triggered_effect");
    if (!next) return flushPendingLeaves(state, lo.getCardDefinitionById);
    const values = generateActionInputChoices(
      state,
      next,
      { getCardDefinitionById: lo.getCardDefinitionById },
      256
    ).values;
    const score = (v: Partial<ApplyLegalActionOptions>) =>
      Object.values(v).reduce<number>(
        (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
        0
      );
    const input = values.sort((a, b) => score(b) - score(a))[0] ?? {};
    state = applyLegalAction({
      state,
      action: next,
      ...lo,
      ...input,
      ...(next.kind === "resolve_pending_triggered_effect" &&
      (mode === "decline" || next.skipOnly)
        ? { skipOptionalEffect: true }
        : {}),
    }).state;
  }
  throw new Error("Adversarial conditional-cost input did not settle");
}

describe("round1: outer conditional-cost bindings", () => {
  it("BSAZ01-C03: one nonzero exclusion with no threshold result leaves the cost in hand", () => {
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSAZ01-C03", "source", "in_use"),
          card("BSTH001-C01", "cost", "hand"),
        ],
        playerOverrides: [{ handCount: 1, deckCount: 0 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      turnNumber: 4,
    };
    const after = executeEffect({
      state: before,
      effect: definition("BSAZ01-C03").effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId: "adversarial:outer-exclusion-one",
      targetInstanceIds: ["cost"],
      targetStepId: "exclude-cards",
      ...lookups("BSAZ01-C03"),
    });
    expect(resources(after)).toEqual(resources(before));
    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });

  it.each([1, 2])(
    "BSLH01-M01: paid choice %i on an empty opponent field refunds the full payment",
    (choiceIndex) => {
      const before: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card("BSLH01-M01", "source", "field", 2)],
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        }),
        activePlayerId: "alice",
        step: "attack",
        turnNumber: 4,
      };
      const lo = lookups("BSLH01-M01");
      const after = settle(
        executeEffect({
          state: before,
          effect: definition("BSLH01-M01").effects![1]!,
          effectIndex: 1,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          chainId: `adversarial:paid-choice:${choiceIndex}`,
          choiceIndex,
          ...lo,
        }),
        lo
      );
      expect(resources(after)).toEqual(resources(before));
      expect(after.pendingCoreSourceAllocation).toBeNull();
      expect(after.pendingEffectTargetSelection).toBeNull();
    }
  );
  it.each([false, true])(
    "BSAZ01-C03: two exclusions require a valid deferred battle result (battle=%s)",
    (battle) => {
      const before: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            card("BSAZ01-C03", "source", "in_use"),
            card("BSTH001-C01", "cost0", "hand"),
            card("BSTH001-C01", "cost1", "hand"),
            card("BSTH001-C01", "attacker", "field", 1, "bob"),
          ],
          playerOverrides: [{ handCount: 2 }, {}],
        }),
        activePlayerId: "bob",
        step: "attack",
        turnNumber: 4,
        ...(battle
          ? {
              battleEntities: [
                {
                  entityId: "battle",
                  memberInstanceIds: ["attacker"],
                  resolvedBp: 1000,
                  resolvedSymbols: [],
                  attackState: "attacking" as const,
                },
              ],
              activeAttack: {
                attackId: "attack",
                primaryEntityId: "battle",
                participantEntityIds: ["battle"],
                groupMode: "single" as const,
                target: { kind: "player" as const, playerId: "alice" },
                blockAssignments: [],
                symbolResolutionOrder: [],
                flashBeforeBlockCompleted: true,
                flashAfterBlockCompleted: true,
                flashWindowState: null,
              },
            }
          : {}),
      };
      const after = executeEffect({
        state: before,
        effect: definition("BSAZ01-C03").effects![1]!,
        effectIndex: 1,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "adversarial:deferred-result",
        targetInstanceIds: ["cost0", "cost1"],
        targetStepId: "exclude-cards",
        ...lookups("BSAZ01-C03"),
      });
      if (battle) {
        expect(after.players[0]!.handCount).toBe(0);
        expect(after.pendingBattleEndDeferrals).toHaveLength(1);
        expect(
          after.pendingBattleEndDeferrals[0]!.restoredStepContext
            ?.pendingConditionalCostRollback
        ).toBeUndefined();
      } else {
        expect(resources(after), after.log.join("\n")).toEqual(
          resources(before)
        );
        expect(after.pendingBattleEndDeferrals).toHaveLength(0);
      }
    }
  );
  it("BSLH01-M01: paid3 can fulfill its own return/retrieval tier with no opponent field", () => {
    const lo = lookups("BSLH01-M01");
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSLH01-M01", "source", "field", 2),
          card("BSLH01-C01", "retrieval", "trash"),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 4,
    };
    const after = settle(
      executeEffect({
        state: before,
        effect: definition("BSLH01-M01").effects![1]!,
        effectIndex: 1,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "adversarial:paid3-alternative",
        choiceIndex: 3,
        ...lo,
      }),
      lo
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "retrieval")!.zone
    ).toBe("hand");
    expect(after.players[0]!.trashNormalCoreCount).toBe(3);
    expect(after.players[0]!.reserveNormalCoreCount).toBe(4);
  });
});

describe("BSDB01-M02: technical leave cancellation belongs to the paid clause", () => {
  function fixture(voidCores: number) {
    const source = card("BSDB01-M02", "source", "field", 2);
    Object.assign(source, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "opponent_effect",
      pendingLeaveChainId: "adversarial:return-self",
      deferZoneMoveUntilChainEnd: true,
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [
          { voidNormalCoreCount: voidCores, trashSoulCoreCount: 0 },
          {},
        ],
      }),
      activePlayerId: "bob",
      step: "main",
      turnNumber: 4,
      pendingLeaveEntities: [
        {
          instanceId: "source",
          kind: "destroy",
          cause: "opponent_effect",
          causePlayerId: "bob",
          chainId: "adversarial:return-self",
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const lo = lookups("BSDB01-M02");
    const body = () =>
      executeEffect({
        state: before,
        effect: definition("BSDB01-M02").effects![2]!,
        effectIndex: 2,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        choiceIndex: 0,
        chainId: "adversarial:return-self",
        ...lo,
      });
    const run = () => settle(body(), lo);
    return { before, body, run, lo };
  }
  it("decline does not bounce the source or gain life", () => {
    const f = fixture(1);
    const queued = queuePendingReactionsFromTriggerEvents(
      f.before,
      [
        {
          actingPlayerId: "alice",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId: "adversarial:return-self",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source",
          amount: null,
          cause: "opponent_effect",
          causePlayerId: "bob",
        },
      ],
      undefined,
      f.lo
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const after = settle(queued, f.lo, "decline");
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")!.zone
    ).not.toBe("hand");
    expect(after.players[0]!.lifeNormalCoreCount).toBe(5);
    expect(after.players[0]!.voidNormalCoreCount).toBe(1);
    expect(after.effectUsageRecords).toEqual(queued.effectUsageRecords);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("successful return pays the source and gains one life core", () => {
    const f = fixture(1);
    const after = f.run();
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")!.zone
    ).toBe("hand");
    expect(after.players[0]!.lifeNormalCoreCount).toBe(6);
    expect(after.players[0]!.voidNormalCoreCount).toBe(0);
    expect(after.pendingLeaveEntities).toHaveLength(0);
  });
  it("no life/soul payoff restores the original destruction pending as well as the bounce", () => {
    const f = fixture(0);
    const after = f.body();
    expect(resources(after), after.log.join("\n")).toEqual(resources(f.before));
    expect(after.pendingLeaveEntities).toEqual(f.before.pendingLeaveEntities);
  });
});

describe("BSSA01-C03: additional draw cost", () => {
  function fixture(deck: number, count = 1) {
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSSA01-C03", "source", "field", 2),
          card("BSTH001-C01", "cost", "hand"),
          ...Array.from({ length: deck }, (_, n) =>
            card("BSTH001-C01", `deck-${n}`, "deck")
          ),
        ],
        playerOverrides: [
          { handCount: 1, deckCount: deck, countValue: count },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      turnNumber: 4,
    };
    const lo = lookups("BSSA01-C03");
    const run = () =>
      executeEffect({
        state: before,
        effect: definition("BSSA01-C03").effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "adversarial:additional-draw",
        ...lo,
      });
    return { before, lo, run };
  }
  it("declining the natural summon trigger preserves resources and clears pending", () => {
    const f = fixture(3);
    const queued = queuePendingReactionsFromTriggerEvents(
      f.before,
      [
        {
          actingPlayerId: "alice",
          eventKind: "summon",
          source: "action_resolution",
          chainId: "adversarial:additional-draw-trigger",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source",
          amount: null,
        },
      ],
      undefined,
      f.lo
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const after = settle(queued, f.lo, "decline");
    expect(resources(after)).toEqual(resources(queued));
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("one discard draws two cards", () => {
    const f = fixture(3);
    const after = settle(f.run(), f.lo);
    expect(after.players[0]!.handCount).toBe(2);
    expect(after.players[0]!.deckCount).toBe(1);
    expect(after.cardInstances.find((c) => c.instanceId === "cost")!.zone).toBe(
      "trash"
    );
  });
  it("zero discards retains the independent basic one-card draw", () => {
    const f = fixture(3);
    const pending = f.run();
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...f.lo,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_optional_choice" &&
        candidate.choice === "decline"
    );
    expect(action).toBeDefined();
    const after = settle(
      applyLegalAction({
        state: pending,
        action: action!,
        ...f.lo,
      }).state,
      f.lo
    );
    expect(after.players[0]!.handCount).toBe(2);
    expect(after.players[0]!.deckCount).toBe(2);
    expect(after.cardInstances.find((c) => c.instanceId === "cost")!.zone).toBe(
      "hand"
    );
  });
  it("deck0 permits no discard cost and still allows the independent count increase", () => {
    const f = fixture(0, 0);
    const after = settle(f.run(), f.lo);
    expect(after.players[0]!.handCount).toBe(1);
    expect(after.players[0]!.deckCount).toBe(0);
    expect(after.players[0]!.countValue).toBe(1);
    expect(after.cardInstances.find((c) => c.instanceId === "cost")!.zone).toBe(
      "hand"
    );
    expect(after.pendingZoneSelection).toBeNull();
  });
  it("declining both the discard and basic draw still permits the independent count increase", () => {
    const f = fixture(3, 0);
    let state = f.run();
    for (let n = 0; n < 2; n++) {
      const decline = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...f.lo,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      );
      expect(decline).toBeDefined();
      state = applyLegalAction({ state, action: decline!, ...f.lo }).state;
    }
    const after = settle(state, f.lo);
    expect(after.players[0]!.handCount).toBe(1);
    expect(after.players[0]!.deckCount).toBe(3);
    expect(after.players[0]!.countValue).toBe(1);
    expect(after.cardInstances.find((c) => c.instanceId === "cost")!.zone).toBe(
      "hand"
    );
  });
});

describe("BSES01-C03: full two-core payment from the natural attack registration", () => {
  function fixture(cores: number) {
    const lo = lookups("BSES01-C03");
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSES01-C03", "source", "field", cores),
          card("BSES01-CX01", "lena", "field"),
          card("BSES01-T01", "jugger", "field", 1),
        ],
        playerOverrides: [{ countValue: 6, voidNormalCoreCount: 10 }, {}],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 4,
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      before,
      [
        {
          actingPlayerId: "alice",
          eventKind: "attack",
          source: "action_resolution",
          chainId: "adversarial:two-core",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "jugger",
          amount: null,
        },
      ],
      undefined,
      lo
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    return { before, queued, lo };
  }
  it("decline pays no core and registers no immunity", () => {
    const f = fixture(2);
    const after = settle(f.queued, f.lo, "decline");
    expect(resources(after)).toEqual(resources(f.queued));
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("two cores pay in full and register the printed immunity", () => {
    const f = fixture(2);
    const after = settle(f.queued, f.lo);
    expect(after.players[0]!.voidNormalCoreCount, after.log.join("\n")).toBe(
      12
    );
    expect(after.activeContinuousEffects).toContainEqual(
      expect.objectContaining({
        modifierTag: "life_damage_source_prevention_immunity",
      })
    );
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("one core offers decline only and preserves the source core and void", () => {
    const f = fixture(1);
    const offered = getLegalActions({
      state: f.queued,
      actingPlayerId: "alice",
      ...f.lo,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ skipOnly: true });
    const after = settle(f.queued, f.lo);
    expect(resources(after)).toEqual(resources(f.queued));
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
});

describe("BSSA01-転醒X03(A): exactly one attached Blue Rose Sword before rebirth", () => {
  function fixture(partner: "none" | "wrong" | "correct") {
    const source = card("BSSA01-転醒X03(A)", "source", "field", 3);
    const other =
      partner === "none"
        ? undefined
        : card(
            partner === "correct" ? "BSSA01-転醒X02(A)" : "BSSA01-転醒X01(B)",
            "brave",
            "field"
          );
    if (other) {
      source.attachedChildrenIds = ["brave"];
      other.attachedToInstanceId = "source";
      other.zoneRoleName = "brave";
    }
    source.pendingLeaveKind = "destroy";
    source.pendingLeaveCause = "opponent_effect";
    source.pendingLeaveChainId = "adversarial:fold";
    source.deferZoneMoveUntilChainEnd = true;
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...(other ? [other] : [])],
        playerOverrides: [{ countValue: 2, reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: "bob",
      step: "main",
      turnNumber: 4,
      pendingLeaveEntities: [
        {
          instanceId: "source",
          kind: "destroy",
          cause: "opponent_effect",
          causePlayerId: "bob",
          chainId: "adversarial:fold",
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const lo = lookups("BSSA01-転醒X03(A)");
    const queued = queuePendingReactionsFromTriggerEvents(
      before,
      [
        {
          actingPlayerId: "alice",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId: "adversarial:fold",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source",
          amount: null,
          cause: "opponent_effect",
          causePlayerId: "bob",
        },
      ],
      undefined,
      lo
    );
    return { queued, lo };
  }
  it.each(["none", "wrong"] as const)(
    "%s partner cannot pay or flip",
    (partner) => {
      const f = fixture(partner);
      const after = settle(f.queued, f.lo);
      const source = after.cardInstances.find(
        (c) => c.instanceId === "source"
      )!;
      expect(source.definitionId).toBe("BSSA01-転醒X03(A)");
      expect(after.players[0]!.countValue).toBe(2);
      expect(source.underCards).toEqual([]);
      expect(after.pendingTriggeredEffects).toHaveLength(0);
    }
  );
  it("correct attached sword is the single cost, then flip/count/leave replacement complete", () => {
    const f = fixture("correct");
    const after = settle(f.queued, f.lo);
    const source = after.cardInstances.find((c) => c.instanceId === "source")!;
    expect(source, after.log.join("\n")).toMatchObject({
      definitionId: "BSSA01-転醒X03(B)",
      zone: "field",
      pendingLeaveKind: null,
    });
    expect(source.underCards).toEqual([
      { cardInstanceId: "brave", role: "advent_source" },
    ]);
    expect(after.players[0]!.countValue).toBe(3);
    expect(after.pendingLeaveEntities).toHaveLength(0);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("decline does not fold the sword or consume a rebirth count", () => {
    const f = fixture("correct");
    const after = settle(f.queued, f.lo, "decline");
    expect(after.players[0]!.countValue).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")!.definitionId
    ).toBe("BSSA01-転醒X03(A)");
    expect(
      after.cardInstances.some((c) =>
        c.underCards.some((u) => u.cardInstanceId === "brave")
      )
    ).toBe(false);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
});

describe("BSTH01-X05: summon cost before flash negation", () => {
  function fixture(reserve: number) {
    const lo = lookups("BSTH01-X05");
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSTH01-X05", "sakuya", "hand"),
          card("BSTH04-C11", "bob-flash", "in_use", 0, "bob"),
        ],
        playerOverrides: [
          {
            reserveNormalCoreCount: reserve,
            trashNormalCoreCount: 0,
            handCount: 1,
          },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "stack",
      stackWindow: {
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        actingPlayerId: "bob",
        previousWindow: "none",
        stackResponseSourcePlayerId: "bob",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: {
          stackId: "adversarial:flash",
          actionKind: "magic",
          chainId: "adversarial:flash",
          actingPlayerId: "bob",
          cardInstanceId: "bob-flash",
          cardDefinitionId: "BSTH04-C11",
          chosenTiming: "flash",
          targetInstanceIds: [],
          targetEffectFilterTags: ["general"],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    };
    state = queueFlashUsedTriggers({
      state,
      chainId: "adversarial:flash-trigger",
      flashSourceInstanceId: "bob-flash",
      userPlayerId: "bob",
      flashSourceFromZone: "hand",
      ...lo,
    });
    return { state, lo };
  }
  it("maintenance0 cannot negate the opponent's flash", () => {
    const f = fixture(0);
    const after = settle(f.state, f.lo);
    expect(after.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      false
    );
    expect(
      after.activeContinuousEffects.some((ce) => ce.modifierTag === "negate")
    ).toBe(false);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sakuya")!.zone
    ).toBe("hand");
    expect(after.pendingPrivateDeclarations).toHaveLength(0);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("decline retains Sakuya and leaves the opponent flash unnegated", () => {
    const f = fixture(1);
    const after = settle(f.state, f.lo, "decline");
    expect(after.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      false
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "sakuya")!.zone
    ).toBe("hand");
    expect(after.players[0]!.reserveNormalCoreCount).toBe(1);
    expect(after.pendingPrivateDeclarations).toHaveLength(0);
  });
  it("successful summon completes maintenance before negating the target", () => {
    const f = fixture(1);
    const after = settle(f.state, f.lo);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sakuya")
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(after.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(
      after.log.some((line) => line.startsWith("magic:nullified:")),
      after.log.join("\n")
    ).toBe(true);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
    expect(after.pendingMultiPlacement).toBeNull();
  });
  it("a real stack response removing the last maintenance core leaves the original flash unnegated", () => {
    const tax: CardDefinition = {
      ...definition("BSTH04-C11"),
      cardNo: "ADVERSARIAL-RESERVE-RESPONSE",
      name: "Reserve response",
      cost: 0,
      reductionSymbols: [],
      effects: [
        {
          timing: { kind: "activated", mode: "stack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "reserve", player: "opponent" },
                to: { kind: "void", player: "opponent" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const f = fixture(1);
    const lo = {
      ...f.lo,
      getCardDefinitionById: (id: string) =>
        id === tax.cardNo ? tax : lookup(id),
      getRegisteredMagicActions: buildMagicLookup([...definitions, tax]),
    };
    let state = {
      ...f.state,
      cardInstances: [
        ...f.state.cardInstances,
        createCardInstance(tax, {
          instanceId: "tax",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    };
    for (const kind of [
      "pass_stack",
      "declare_private_triggered_effect",
      "resolve_pending_triggered_effect",
    ] as const) {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lo,
      }).find((candidate) => candidate.kind === kind);
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...lo }).state;
    }
    expect(state.stackWindow).not.toBeNull();
    expect(state.pendingMultiPlacement).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "sakuya")!.zone
    ).toBe("hand");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
    const response = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lo,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "tax" &&
        a.timing === "stack"
    );
    expect(response).toBeDefined();
    state = applyLegalAction({
      state,
      action: response!,
      paymentSources: [],
      ...lo,
    }).state;
    const after = settle(state, lo);
    expect(after.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(
      after.cardInstances.find((c) => c.instanceId === "sakuya")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-flash")!.zone
    ).toBe("trash");
    expect(
      after.log.some((line) => line.startsWith("magic:nullified:")),
      after.log.join("\n")
    ).toBe(false);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
    expect(after.pendingStackCascade).toBeNull();
  });
});
