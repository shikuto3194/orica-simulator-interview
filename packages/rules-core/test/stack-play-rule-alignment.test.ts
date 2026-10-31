import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/index";
import type { CardDefinition, GameState, LegalAction } from "../src/index";
import type { EffectStep } from "../src/dsl-types";
import {
  applyCardCostPayments,
  getAvailableOnBoardCorePaymentSources,
} from "../src/core/payment-system";
import { rollbackNormalHandPlayAfterStack } from "../src/play/play-card-resolution";
import { applyEnterFieldCorePlacements } from "../src/zone/enter-field-placement-execution";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  flushPendingLeaves,
  queuePendingLeave,
  runStateBasedActions,
} from "../src/state-based-actions";

function card(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function setup(
  target: CardDefinition,
  responseSteps: EffectStep[],
  reserveSoulCoreCount = 0,
  extraDefinitions: CardDefinition[] = []
) {
  const response: CardDefinition = {
    ...card("RESPONSE"),
    effects: [
      { timing: { kind: "activated", mode: "stack" }, steps: responseSteps },
    ],
  };
  const defs = [target, response, ...extraDefinitions];
  const getCardDefinitionById = (id: string) =>
    defs.find((d) => d.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
  };
  const initial: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 3,
          countValue: 9,
          soulCoreLocation: reserveSoulCoreCount ? { kind: "reserve" } : null,
        },
        { reserveNormalCoreCount: 3 },
      ],
      cardInstances: [
        createCardInstance(target, {
          instanceId: "target",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(response, {
          instanceId: "response",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
  };
  const find = (
    state: GameState,
    player: string,
    kind: LegalAction["kind"]
  ) => {
    const action = getLegalActions({
      state,
      actingPlayerId: player,
      ...lookups,
    }).find((a) => a.kind === kind);
    expect(action, kind).toBeDefined();
    return action!;
  };
  const apply = (state: GameState, player: string, kind: LegalAction["kind"]) =>
    applyLegalAction({ state, action: find(state, player, kind), ...lookups })
      .state;
  return { initial, lookups, find, apply };
}

const drainReserve: EffectStep = {
  action: {
    kind: "core_move",
    from: { kind: "reserve", player: "opponent" },
    to: { kind: "trash", player: "opponent" },
    amount: 2,
    effectKind: "normal_only",
  },
};

describe("03f: real stack responses distinguish failure from illegal declaration", () => {
  it.each(["none", "host", "cost"] as const)(
    "BSFT01-X01 cancellation refunds the excluded key cost and retains response movement: %s",
    (responseMove) => {
      const target = ALL_CARDS.find((c) => c.cardNo === "BSFT01-X01")!;
      const lucyDef = ALL_CARDS.find((c) => c.cardNo === "BSFT01-CX01")!;
      const keyDef = ALL_CARDS.find((c) => c.cardNo === "BSFT01-TR01(A)")!;
      const { initial, lookups, find, apply } = setup(
        target,
        [
          { action: { kind: "count_decrease", player: "opponent", amount: 1 } },
          ...(responseMove === "none"
            ? []
            : [
                {
                  action: {
                    kind: "move_card" as const,
                    from: {
                      zone:
                        responseMove === "host"
                          ? ("field" as const)
                          : ("removed_from_game" as const),
                      player: "opponent" as const,
                    },
                    to: {
                      zone:
                        responseMove === "host"
                          ? ("trash" as const)
                          : ("hand" as const),
                    },
                    count: 1,
                  },
                },
              ]),
        ],
        0,
        [lucyDef, keyDef]
      );
      const before: GameState = {
        ...initial,
        players: initial.players.map((p) =>
          p.id === "alice"
            ? { ...p, countValue: 5, reserveNormalCoreCount: 10 }
            : p
        ),
        cardInstances: [
          ...initial.cardInstances,
          createCardInstance(lucyDef, {
            instanceId: "lucy",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
            attachedChildrenIds: ["key"],
          }),
          createCardInstance(keyDef, {
            instanceId: "key",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
            attachedToInstanceId: "lucy",
          }),
        ],
      };
      const permission = getLegalActions({
        state: before,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (a) =>
          a.kind === "summon" && a.reason === "legal_summon_by_hand_permission"
      );
      expect(permission).toBeDefined();
      const costPending = applyLegalAction({
        state: before,
        action: permission!,
        ...lookups,
      }).state;
      const opened = applyLegalAction({
        state: costPending,
        action: find(
          costPending,
          "alice",
          "resolve_pending_summon_cost_exclude_choice"
        ),
        summonCostExcludeSelectedCardInstanceIds: ["key"],
        paymentSources: [],
        ...lookups,
      }).state;
      expect(
        opened.cardInstances.find((c) => c.instanceId === "key")?.zone
      ).toBe("removed_from_game");
      const cancelled = apply(
        apply(opened, "bob", "use_field_card_effect"),
        "alice",
        "pass_stack"
      );
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "target")?.zone
      ).toBe("hand");
      expect(cancelled.players[0]!).toMatchObject({
        countValue: 4,
        reserveNormalCoreCount:
          responseMove === "host" ? 11 : responseMove === "cost" ? 12 : 10,
      });
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "key")
      ).toMatchObject({
        zone: responseMove === "cost" ? "hand" : "field",
        normalCoreCount: responseMove === "cost" ? 0 : 2,
        attachedToInstanceId: responseMove === "none" ? "lucy" : null,
      });
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "lucy")
          ?.attachedChildrenIds
      ).toEqual(responseMove === "none" ? ["key"] : []);
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "lucy")?.zone
      ).toBe(responseMove === "host" ? "trash" : "field");
    }
  );
  it("refunded permission usage allows a second declaration in the same turn", () => {
    const target: CardDefinition = {
      ...card("PERMISSION"),
      cost: 10,
      effects: [
        {
          applicability: { zone: "hand" },
          timing: { kind: "continuous" },
          usageLimit: { kind: "per_instance", duration: "turn" },
          condition: [{ kind: "count_value", player: "self", min: 9 }],
          steps: [
            {
              action: {
                kind: "summon",
                target: { kind: "self" },
                costModifier: "free",
                normalActionPermission: true,
              },
            },
          ],
        },
      ],
    };
    const { initial, lookups, apply } = setup(target, [
      { action: { kind: "count_decrease", player: "opponent", amount: 1 } },
    ]);
    const opened = apply(initial, "alice", "summon");
    expect(opened.effectUsageRecords).toHaveLength(1);
    const cancelled = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(
      cancelled.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("hand");
    expect(cancelled.effectUsageRecords).toHaveLength(0);
    const recovered = executeEffect({
      state: cancelled,
      sourceInstanceId: "response",
      actingPlayerId: "bob",
      chainId: "restore-count",
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "opponent", amount: 1 } },
        ],
      },
      ...lookups,
    });
    const redeclared = apply(recovered, "alice", "summon");
    expect(redeclared.stackWindow).not.toBeNull();
    expect(redeclared.effectUsageRecords).toHaveLength(1);
  });

  it("BSSL01-M01 advent-source permission is cancelled and its original under-card slot is restored", () => {
    const target = ALL_CARDS.find((c) => c.cardNo === "BSSL01-M01")!;
    const hostDef = ALL_CARDS.find((c) => c.cardNo === "BSSL01-CX01")!;
    const { initial, lookups, find, apply } = setup(
      target,
      [{ action: { kind: "count_decrease", player: "opponent", amount: 1 } }],
      0,
      [hostDef]
    );
    const host = createCardInstance(hostDef, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [{ cardInstanceId: "target", role: "advent_source" }];
    const withSource: GameState = {
      ...initial,
      players: initial.players.map((p) =>
        p.id === "alice"
          ? { ...p, countValue: 5, reserveNormalCoreCount: 5, handCount: 0 }
          : p
      ),
      cardInstances: [
        ...initial.cardInstances.map((c) =>
          c.instanceId === "target"
            ? { ...c, zone: "field" as const, zoneRoleName: "advent-source" }
            : c
        ),
        host,
      ],
    };
    const declaration = find(withSource, "alice", "summon");
    if (declaration.kind !== "summon") throw new Error("Expected summon");
    const opened = applyLegalAction({
      state: withSource,
      action: declaration,
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: declaration.finalCost }],
    }).state;
    expect(
      opened.cardInstances.find((c) => c.instanceId === "host")?.underCards
    ).toEqual([]);
    const cancelled = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(cancelled.pendingEnterFieldPlacement).toBeNull();
    expect(
      cancelled.cardInstances.find((c) => c.instanceId === "target")
    ).toMatchObject({
      zone: "field",
      zoneRoleName: "advent-source",
      normalCoreCount: 0,
    });
    expect(
      cancelled.cardInstances.find((c) => c.instanceId === "host")?.underCards
    ).toEqual(host.underCards);
    expect(cancelled.players.find((p) => p.id === "alice")).toMatchObject({
      countValue: 4,
      reserveNormalCoreCount: 5,
      handCount: 0,
    });
  });

  it.each([0, 1])(
    "BSKB01-M02 cancellation reverses declaration counts but retains the response removing Meta Knight and adding %i count",
    (responseCount) => {
      const target = ALL_CARDS.find((c) => c.cardNo === "BSKB01-M02")!;
      const hostDef = ALL_CARDS.find((c) => c.cardNo === "BSKB01-CX01")!;
      const { initial, apply } = setup(
        target,
        [
          {
            action: {
              kind: "move_card",
              from: { zone: "field", player: "opponent" },
              to: { zone: "trash" },
              count: 1,
            },
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: responseCount,
            },
          },
        ],
        0,
        [hostDef]
      );
      const withMeta: GameState = {
        ...initial,
        players: initial.players.map((p) => ({
          ...p,
          countValue: p.id === "alice" ? 10 : 8,
          ...(p.id === "alice"
            ? { protectedCounts: { [target.tribe!.split("・")[0]!]: 3 } }
            : {}),
        })),
        cardInstances: [
          ...initial.cardInstances,
          createCardInstance(hostDef, {
            instanceId: "meta",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const opened = apply(withMeta, "alice", "summon");
      expect(opened.players.map((p) => p.countValue)).toEqual([0, 3]);
      const cancelled = apply(
        apply(opened, "bob", "use_field_card_effect"),
        "alice",
        "pass_stack"
      );
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "target")?.zone
      ).toBe("hand");
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "meta")?.zone
      ).toBe("trash");
      expect(cancelled.players.map((p) => p.countValue)).toEqual([
        10,
        8 + responseCount,
      ]);
      expect(cancelled.players[0]!.protectedCounts).toEqual({
        [target.tribe!.split("・")[0]!]: 3,
      });
    }
  );

  it("usage rollback subtracts only the declaration increment from a shared record", () => {
    const { initial, lookups } = setup(card("TARGET"), []);
    const record = {
      sourceInstanceId: "target",
      sourceDefinitionId: "TARGET",
      effectLabel: "shared",
      groupId: "shared",
      turnNumber: initial.turnNumber,
      step: initial.step,
      duration: "turn" as const,
      count: 2,
    };
    const unrelated = {
      ...record,
      sourceInstanceId: "response",
      sourceDefinitionId: "RESPONSE",
      count: 1,
    };
    const state = rollbackNormalHandPlayAfterStack({
      state: { ...initial, effectUsageRecords: [record, unrelated] },
      activeStack: {
        stackId: "cancelled",
        chainId: "cancelled",
        actionKind: "summon",
        actingPlayerId: "alice",
        cardInstanceId: "target",
        cardDefinitionId: "TARGET",
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
        normalHandPlayRollback: {
          paidCores: [],
          declarationUsageDeltas: [{ ...record, count: 1 }],
        },
      },
      ...lookups,
    });
    expect(state.effectUsageRecords).toEqual([
      { ...record, count: 1 },
      unrelated,
    ]);
  });

  it.each(["trash", "hand", "deck"] as const)(
    "cancelled advent-source declaration follows the response-moved host to %s",
    (destination) => {
      const target = ALL_CARDS.find((c) => c.cardNo === "BSSL01-M01")!;
      const hostDef = card("HOST");
      const { initial, lookups, find, apply } = setup(
        target,
        [
          { action: { kind: "count_decrease", player: "opponent", amount: 1 } },
          {
            action: {
              kind: "move_card",
              from: { zone: "field", player: "opponent" },
              to: { zone: destination },
              count: 1,
            },
          },
        ],
        0,
        [hostDef]
      );
      const host = createCardInstance(hostDef, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      host.underCards = [{ cardInstanceId: "target", role: "advent_source" }];
      const before: GameState = {
        ...initial,
        players: initial.players.map((p) =>
          p.id === "alice"
            ? { ...p, countValue: 5, reserveNormalCoreCount: 6, handCount: 0 }
            : p
        ),
        cardInstances: [
          ...initial.cardInstances.map((c) =>
            c.instanceId === "target"
              ? { ...c, zone: "field" as const, zoneRoleName: "advent-source" }
              : c
          ),
          host,
        ],
      };
      const action = find(before, "alice", "summon");
      if (action.kind !== "summon") throw new Error("Expected summon");
      const opened = applyLegalAction({
        state: before,
        action,
        ...lookups,
        paymentSources: [{ kind: "reserve", amount: action.finalCost }],
      }).state;
      const cancelled = apply(
        apply(opened, "bob", "use_field_card_effect"),
        "alice",
        "pass_stack"
      );
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "host")?.zone
      ).toBe(destination);
      expect(
        cancelled.cardInstances.find((c) => c.instanceId === "target")?.zone
      ).toBe(destination);
      expect(
        cancelled.cardInstances.some((c) =>
          c.underCards?.some((e) => e.cardInstanceId === "target")
        )
      ).toBe(false);
      expect(cancelled.players.find((p) => p.id === "alice")).toMatchObject({
        countValue: 4,
        handCount: destination === "hand" ? 2 : 0,
        deckCount:
          before.players[0]!.deckCount + (destination === "deck" ? 2 : 0),
      });
    }
  );

  it("soul-state permission restores the soul membership and inheriting key-brave group", () => {
    const target: CardDefinition = {
      ...card("SOUL"),
      effects: [
        {
          applicability: { zone: "soul_state" },
          timing: { kind: "continuous" },
          condition: [{ kind: "count_value", player: "self", min: 9 }],
          steps: [
            {
              action: {
                kind: "summon",
                target: { kind: "self" },
                costModifier: "free",
                normalActionPermission: true,
              },
            },
          ],
        },
      ],
    };
    const braveDef: CardDefinition = {
      ...card("KEY"),
      printedCategory: "brave",
      tribe: "鍵",
      keywordTags: ["magic_compatible"],
    };
    const { initial, apply } = setup(
      target,
      [{ action: { kind: "count_decrease", player: "opponent", amount: 1 } }],
      0,
      [braveDef]
    );
    const brave = createCardInstance(braveDef, {
      instanceId: "key",
      ownerPlayerId: "alice",
      zone: "field",
    });
    brave.attachedToInstanceId = "target";
    const before: GameState = {
      ...initial,
      turnNumber: 5,
      players: initial.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: ["target", "key"], handCount: 0 }
          : p
      ),
      cardInstances: [
        ...initial.cardInstances.map((c) =>
          c.instanceId === "target"
            ? {
                ...c,
                zone: "field" as const,
                zoneRoleName: "spirit",
                zoneEnteredAtTurn: 2,
                attachedChildrenIds: ["key"],
              }
            : c
        ),
        brave,
      ],
    };
    const opened = apply(before, "alice", "summon");
    expect(opened.players[0]!.soulStateInstanceIds).toEqual([]);
    expect(opened.cardInstances.find((c) => c.instanceId === "key")?.zone).toBe(
      "in_use"
    );
    const cancelled = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(cancelled.players[0]!.soulStateInstanceIds).toEqual([
      "target",
      "key",
    ]);
    expect(
      cancelled.cardInstances.find((c) => c.instanceId === "target")
    ).toMatchObject({
      zone: "field",
      zoneRoleName: "spirit",
      zoneEnteredAtTurn: 2,
      attachedChildrenIds: ["key"],
      pendingLeaveKind: null,
    });
    expect(
      cancelled.cardInstances.find((c) => c.instanceId === "key")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: "target",
      pendingLeaveKind: null,
    });
  });
  it.each(["spirit", "ultimate", "brave"] as const)(
    "%s is never established when the response consumes required placement cores",
    (category) => {
      const target: CardDefinition = {
        ...card("TARGET"),
        printedCategory: category,
        effects: [
          {
            timing: { kind: "card_event", event: "summon" },
            steps: [
              {
                action: { kind: "count_increase", player: "self", amount: 10 },
              },
            ],
          },
        ],
      };
      const { initial, lookups, find, apply } = setup(target, [drainReserve]);
      const opened = applyLegalAction({
        state: initial,
        action: find(initial, "alice", "summon"),
        ...lookups,
        paymentSources: [{ kind: "reserve", amount: 1 }],
      }).state;
      const responding = apply(opened, "bob", "use_field_card_effect");
      const settled = apply(responding, "alice", "pass_stack");
      expect(
        settled.cardInstances.find((c) => c.instanceId === "target")
      ).toMatchObject({
        zone: "trash",
        normalCoreCount: 0,
        pendingLeaveKind: null,
      });
      expect(settled.players.find((p) => p.id === "alice")).toMatchObject({
        reserveNormalCoreCount: 0,
        trashNormalCoreCount: 3,
        countValue: 9,
      });
      expect(settled.pendingEnterFieldPlacement).toBeNull();
      expect(
        settled.pendingTriggeredEffects.some(
          (p) => p.relatedInstanceId === "target"
        )
      ).toBe(false);
      expect(
        settled.log.some(
          (l) => l.includes(":enter-field:") && l.includes(":target:")
        )
      ).toBe(false);
      expect(
        settled.log.some(
          (l) => l.includes("not-established") && l.includes(":target:")
        )
      ).toBe(true);
    }
  );

  it("count 9 -> 8 withdraws the declaration but retains the response", () => {
    const target: CardDefinition = {
      ...card("TARGET"),
      printedCategory: "ultimate",
      summonCondition: [{ kind: "count_value", player: "self", min: 9 }],
    };
    const { initial, lookups, find, apply } = setup(target, [
      { action: { kind: "count_decrease", player: "opponent", amount: 1 } },
    ]);
    const opened = applyLegalAction({
      state: initial,
      action: find(initial, "alice", "summon"),
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;
    const responding = apply(opened, "bob", "use_field_card_effect");
    const settled = apply(responding, "alice", "pass_stack");
    expect(
      settled.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("hand");
    expect(settled.players.find((p) => p.id === "alice")).toMatchObject({
      countValue: 8,
      reserveNormalCoreCount: 3,
      trashNormalCoreCount: 0,
    });
    expect(settled.pendingEnterFieldPlacement).toBeNull();
  });

  it("preselected placement does not bypass post-stack shortage validation", () => {
    const { initial, lookups, find, apply } = setup(card("TARGET"), [
      drainReserve,
    ]);
    const opened = applyLegalAction({
      state: initial,
      action: find(initial, "alice", "summon"),
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;
    const settled = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(
      settled.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("trash");
    expect(settled.pendingEnterFieldPlacement).toBeNull();
  });

  it("stale preselected placement is reselected when other legal cores remain", () => {
    const target = card("TARGET");
    const { initial, lookups, find, apply } = setup(target, [drainReserve]);
    const withSource = {
      ...initial,
      cardInstances: [
        ...initial.cardInstances,
        createCardInstance(target, {
          instanceId: "other",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };
    const opened = applyLegalAction({
      state: withSource,
      action: find(withSource, "alice", "summon"),
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;
    const pending = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(pending.pendingEnterFieldPlacement?.minimumCoreCount).toBe(1);
    expect(
      pending.pendingEnterFieldPlacement?.deferredStack
        ?.enterFieldCorePlacements
    ).toBeUndefined();
    const settled = applyLegalAction({
      state: pending,
      action: find(pending, "alice", "resolve_pending_enter_field_placement"),
      ...lookups,
      enterFieldCorePlacements: [
        { kind: "card_normal", instanceId: "other", amount: 1 },
      ],
    }).state;
    expect(
      settled.cardInstances.find((c) => c.instanceId === "target")
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      settled.cardInstances.find((c) => c.instanceId === "other")
        ?.normalCoreCount
    ).toBe(2);
  });

  it("rollback removes cost-wait markers and preserves the response's core removal", () => {
    const target: CardDefinition = {
      ...card("TARGET"),
      printedCategory: "ultimate",
      levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
      summonCondition: [{ kind: "count_value", player: "self", min: 9 }],
    };
    const { initial, lookups, find, apply } = setup(target, [
      {
        action: {
          kind: "core_move",
          from: { kind: "card_instance", instanceId: "payer" },
          to: { kind: "trash", player: "opponent" },
          amount: 1,
          effectKind: "normal_only",
        },
      },
      { action: { kind: "count_decrease", player: "opponent", amount: 1 } },
    ]);
    const withSource = {
      ...initial,
      cardInstances: [
        ...initial.cardInstances,
        createCardInstance(target, {
          instanceId: "payer",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
    };
    const opened = applyLegalAction({
      state: withSource,
      action: find(withSource, "alice", "summon"),
      ...lookups,
      paymentSources: [{ kind: "card", instanceId: "payer", amount: 1 }],
    }).state;
    const cancelled = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(
      cancelled.pendingLeaveEntities.some((p) => p.cause === "cost_payment")
    ).toBe(false);
    const settled = flushPendingLeaves(
      cancelled,
      lookups.getCardDefinitionById
    );
    expect(
      settled.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("hand");
    expect(
      settled.cardInstances.find((c) => c.instanceId === "payer")?.zone
    ).toBe("trash");
    expect(settled.players.find((p) => p.id === "alice")).toMatchObject({
      countValue: 8,
      reserveNormalCoreCount: 4,
      trashNormalCoreCount: 1,
    });
  });

  it("losing the movable soul core cancels advent without undoing the response", () => {
    const target: CardDefinition = {
      ...card("TARGET"),
      keywordTags: ["advent"],
      adventData: {
        adventCondition: {
          colors: ["red"],
          minCost: 0,
          targetCategory: ["spirit"],
        },
        adventTiming: "main_and_flash",
        soulCoreDest: "trash",
      },
    };
    const { initial, lookups, apply } = setup(
      target,
      [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "opponent" },
            to: { kind: "trash", player: "opponent" },
            amount: 1,
            effectKind: "explicit_soul_core",
          },
        },
      ],
      1
    );
    const withHost = {
      ...initial,
      cardInstances: [
        ...initial.cardInstances,
        createCardInstance(target, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const opened = apply(withHost, "alice", "declare_advent");
    const settled = apply(
      apply(opened, "bob", "use_field_card_effect"),
      "alice",
      "pass_stack"
    );
    expect(
      settled.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("hand");
    expect(
      settled.cardInstances.find((c) => c.instanceId === "host")
    ).toMatchObject({
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    expect(settled.players.find((p) => p.id === "alice")).toMatchObject({
      reserveSoulCoreCount: 0,
      trashSoulCoreCount: 1,
    });
    expect(settled.stackWindow).toBeNull();
    expect(settled.pendingEnterFieldPlacement).toBeNull();
    expect(
      getLegalActions({
        state: settled,
        actingPlayerId: "alice",
        ...lookups,
      }).some((a) => a.kind === "declare_advent")
    ).toBe(false);
  });
});

describe("03f: waiting cores stay selectable without changing the leave reason", () => {
  it.each(["destroy", "bounce", "vanish", "remove_from_game"] as const)(
    "%s",
    (kind) => {
      const source: CardDefinition = {
        ...card("WAITING"),
        levelDefs: [{ level: 1, requiredCores: 2, bp: 1000 }],
      };
      const destination = card("DESTINATION");
      const getDef = (id: string) =>
        [source, destination].find((d) => d.cardNo === id);
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, trashNormalCoreCount: 0 },
        ],
        cardInstances: [
          createCardInstance(source, {
            instanceId: "waiting",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 4,
          }),
          createCardInstance(destination, {
            instanceId: "destination",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      });
      const queued = queuePendingLeave({
        state: base,
        instanceId: "waiting",
        kind,
        cause: kind === "vanish" ? "cost_payment" : "effect_resolution",
        chainId: "original-leave",
        deferZoneMoveUntilChainEnd: true,
        ...(kind === "bounce"
          ? { leaveDestination: { zone: "hand" as const } }
          : {}),
      });
      expect(
        getAvailableOnBoardCorePaymentSources(queued, "alice", getDef)
      ).toContainEqual(
        expect.objectContaining({
          instanceId: "waiting",
          availableCoreAmount: 4,
        })
      );
      const paid = applyCardCostPayments({
        state: queued,
        actingPlayerId: "alice",
        chainId: "new-payment",
        paymentSources: [{ kind: "card", instanceId: "waiting", amount: 1 }],
        getCardDefinitionById: getDef,
      });
      const removed = executeEffect({
        state: paid,
        sourceInstanceId: "destination",
        actingPlayerId: "bob",
        chainId: "core-removal",
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "card_instance", instanceId: "waiting" },
                to: { kind: "trash", player: "opponent" },
                amount: 1,
                effectKind: "normal_only",
              },
            },
          ],
        },
        getCardDefinitionById: getDef,
      });
      const placed = applyEnterFieldCorePlacements({
        state: removed,
        actingPlayerId: "alice",
        destinationInstanceId: "destination",
        placements: [{ kind: "card_normal", instanceId: "waiting", amount: 1 }],
        getCardDefinitionById: getDef,
      });
      const checked = runStateBasedActions(placed, getDef).state;
      expect(
        checked.cardInstances.find((c) => c.instanceId === "waiting")
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
        pendingLeaveKind: kind,
        pendingLeaveChainId: "original-leave",
      });
      expect(
        checked.pendingLeaveEntities.find((p) => p.instanceId === "waiting")
      ).toEqual(
        queued.pendingLeaveEntities.find((p) => p.instanceId === "waiting")
      );
      expect(
        checked.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
      ).toBe(0);
      const flushed = flushPendingLeaves(checked, getDef);
      expect(
        flushed.cardInstances.find((c) => c.instanceId === "waiting")
      ).toMatchObject({
        zone:
          kind === "bounce"
            ? "hand"
            : kind === "remove_from_game"
              ? "removed_from_game"
              : "trash",
        normalCoreCount: 0,
      });
      expect(flushed.players.find((p) => p.id === "alice")).toMatchObject({
        reserveNormalCoreCount: 1,
        trashNormalCoreCount: 2,
      });
    }
  );
});
