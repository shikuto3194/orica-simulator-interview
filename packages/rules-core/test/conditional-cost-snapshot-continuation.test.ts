import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  sanitizeStateForViewer,
  type CardDefinition,
  type Effect,
} from "../src";
import { getGimmickDeclarationCount } from "../src/mechanics/quantity-usage";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";
import type { GameState } from "../src";
import {
  generateSoulCoreOutsideGame,
  moveSoulCore,
  withSoulCoreLocation,
} from "../src/core/core-system";
import { rebaseConditionalCostRollback } from "../src/effect/conditional-cost-response-state";

function board(effect?: Effect) {
  const actual = ALL_CARDS.find((c) => c.cardNo === "BSTH002-転醒R01(A)")!;
  const source: CardDefinition = {
    ...actual,
    effects: effect ? [effect] : actual.effects,
  };
  const filler = ALL_CARDS.find((c) => c.cardNo === "BSTH001-C01")!;
  const getCardDefinitionById = (id: string) =>
    id === source.cardNo ? source : id === filler.cardNo ? filler : undefined;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      ...[0, 1].map((i) =>
        createCardInstance(filler, {
          instanceId: `hand-${i}`,
          ownerPlayerId: "alice",
          zone: "hand",
        })
      ),
    ],
    playerOverrides: [
      { handCount: 2, deckCount: 0, reserveNormalCoreCount: 5 },
      {},
    ],
  });
  return { state, source, getCardDefinitionById };
}
describe("conditional cost continuation preserves the pre-cost snapshot", () => {
  it("declining an unavailable optional cost cannot undo the independent count prefix", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
        {
          executionMode: "optional",
          action: { kind: "discard", player: "self", count: 1 },
        },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    const f = board(effect);
    f.state.cardInstances = f.state.cardInstances.filter(
      (c) => c.zone !== "hand"
    );
    f.state.players[0]!.handCount = 0;
    const current = executeEffect({
      state: f.state,
      effect,
      effectIndex: 0,
      chainId: "snapshot-declined-tail",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const decline = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(decline).toBeDefined();
    const after = applyLegalAction({
      state: current,
      action: decline!,
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.players[0]).toMatchObject({
      countValue: 1,
      handCount: 0,
      deckCount: 0,
    });
    expect(after.pendingStepOptionalChoice).toBeNull();
  });
  it("BSTH002-転醒R01(A): no draw after selected discard refunds the card across JSON persistence", () => {
    const f = board();
    const pending = executeEffect({
      state: f.state,
      effect: f.source.effects![2]!,
      effectIndex: 2,
      chainId: "snapshot-makai",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(pending.pendingZoneSelection).not.toBeNull();
    expect(
      pending.pendingZoneSelection?.continuation?.stepContext
        .conditionalCostOriginalState
    ).toBeDefined();
    const restored = JSON.parse(JSON.stringify(pending));
    const action = getLegalActions({
      state: restored,
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const after = applyLegalAction({
      state: restored,
      action,
      selectedZoneCardIds: ["hand-1"],
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.players[0]).toMatchObject({ handCount: 2, deckCount: 0 });
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
    expect(after.pendingZoneSelection).toBeNull();
  });
  it("server-only rollback state is removed for the owner, opponent and spectator", () => {
    const f = board();
    const pending = executeEffect({
      state: f.state,
      effect: f.source.effects![2]!,
      effectIndex: 2,
      chainId: "snapshot-private",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const internal =
      pending.pendingZoneSelection!.continuation!.stepContext
        .conditionalCostOriginalState!;
    internal.log = [...internal.log, "PRIVATE-CONDITIONAL-COST-SNAPSHOT"];
    for (const viewer of ["alice", "bob", null]) {
      const shown = JSON.stringify(sanitizeStateForViewer(pending, viewer));
      expect(shown).not.toContain("conditionalCostOriginalState");
      expect(shown).not.toContain("PRIVATE-CONDITIONAL-COST-SNAPSHOT");
    }
  });
  it("an independent draw before the cost survives a resumed rollback", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          action: { kind: "discard", count: 1, player: "self" },
        },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    };
    const f = board(effect);
    const filler = ALL_CARDS.find((c) => c.cardNo === "BSTH001-C01")!;
    f.state.cardInstances.push(
      createCardInstance(filler, {
        instanceId: "prefix-draw",
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    f.state.players[0]!.deckCount = 1;
    let current = executeEffect({
      state: f.state,
      effect,
      effectIndex: 0,
      chainId: "snapshot-prefix",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const select = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: f.getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    expect(select).toBeDefined();
    current = applyLegalAction({
      state: JSON.parse(JSON.stringify(current)),
      action: select!,
      selectedZoneCardIds: ["hand-1"],
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(current.players[0]).toMatchObject({ handCount: 3, deckCount: 0 });
    expect(
      current.cardInstances.find((c) => c.instanceId === "prefix-draw")?.zone
    ).toBe("hand");
    expect(
      current.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
    ).toBe("hand");
    expect(current.pendingZoneSelection).toBeNull();
    expect(current.pendingStepOptionalChoice).toBeNull();
  });
});

describe("conditional cost requires the full life result", () => {
  it.each(["life_damage", "core_move"] as const)(
    "%s rolls back the payment and damage when a cap removes one core",
    (kind) => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 1 } },
          {
            id: "lose-life",
            connector: "conditional_cost",
            action:
              kind === "life_damage"
                ? { kind, player: "opponent", amount: 2 }
                : {
                    kind,
                    from: { kind: "life", player: "opponent" },
                    to: { kind: "reserve", player: "opponent" },
                    amount: 2,
                  },
          },
          {
            action: {
              kind: "count_increase",
              player: "opponent",
              amount: {
                source: { kind: "step_numeric_amount", stepId: "lose-life" },
              },
            },
          },
        ],
      };
      for (const cap of [1, 2]) {
        const f = board(effect);
        f.state.players[0]!.countValue = 5;
        f.state.activeContinuousEffects = [
          {
            effectId: "damage-cap",
            sourceInstanceId: "source",
            sourceDefinitionId: f.source.cardNo,
            actingPlayerId: "bob",
            duration: { scope: "permanent" },
            createdAtTurn: f.state.turnNumber,
            createdAtAttackId: null,
            modifierTag: "life_damage_interception",
            targetInstanceId: "bob",
            metadata: { cause: "opponent_effect", mode: "turn_cap", cap },
          },
        ];
        const beforeLife = f.state.players[1]!.lifeNormalCoreCount;
        const after = executeEffect({
          state: f.state,
          effect,
          effectIndex: 0,
          chainId: `snapshot-reduced-life:${kind}:${cap}`,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          getCardDefinitionById: f.getCardDefinitionById,
          getRegisteredTriggeredEffectActions: () => [],
        });
        expect(after.players[1]!.lifeNormalCoreCount).toBe(
          beforeLife - (cap === 1 ? 0 : 2)
        );
        expect(after.players[0]!.countValue).toBe(cap === 1 ? 5 : 4);
        if (kind === "core_move") {
          expect(after.players[1]!.countValue).toBe(cap === 1 ? 0 : 2);
        }
        expect(
          after.log.includes("effect:conditional-cost-effect-failed:source")
        ).toBe(cap === 1);
      }
    }
  );
});

it.each(["pay", "decline"] as const)(
  "雷鎚ショットとBSLH01-C12のライフ軽減を保存後に解決する (%s)",
  (choice) => {
    const shooter = ALL_CARDS.find((card) => card.cardNo === "BSGE01-R03")!;
    const defender = ALL_CARDS.find((card) => card.cardNo === "BSLH01-C12")!;
    const getCardDefinitionById = (id: string) =>
      ALL_CARDS.find((card) => card.cardNo === id);
    const effect = shooter.effects![3]!;
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ countValue: 5 }, { lifeNormalCoreCount: 5 }],
          cardInstances: [
            createCardInstance(shooter, {
              instanceId: "shooter",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 2,
            }),
            createCardInstance(defender, {
              instanceId: "defender",
              ownerPlayerId: "bob",
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        }),
        step: "attack",
        activePlayerId: "alice",
      },
      getCardDefinitionById
    );
    const awaitingChoice = executeEffect({
      state,
      effect,
      effectIndex: 3,
      chainId: "r03-lightning-versus-reduction",
      sourceInstanceId: "shooter",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(awaitingChoice.players[0]?.countValue).toBe(3);
    const saved = JSON.parse(JSON.stringify(awaitingChoice));
    const action = getLegalActions({
      state: saved,
      actingPlayerId: "bob",
      getCardDefinitionById,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_life_damage_discard_choice"
    );
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: saved,
      action: action!,
      lifeDamageDiscardChoice: choice,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.pendingLifeDamageDiscardChoice).toBeNull();
    expect(after.players[0]?.countValue).toBe(choice === "pay" ? 5 : 3);
    expect(after.players[1]?.lifeNormalCoreCount).toBe(
      choice === "pay" ? 5 : 4
    );
    expect(getGimmickDeclarationCount(after, "bob")).toBe(
      choice === "pay" ? 1 : 0
    );
  }
);

it.each(["departure", "negate"] as const)(
  "対象開示への応答で効果が不発になったら、相手の処理を残して支払いだけを戻す (%s)",
  (reason) => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "pay_cost", amount: 2 } },
        {
          id: "recover",
          connector: "conditional_cost",
          targetSelectionTiming: "on_step",
          action: {
            kind: "recover",
            target: {
              kind: "filter",
              player: "self",
              zone: "field",
              filter: { category: ["spirit"], exhaustState: "exhausted" },
              count: 2,
            },
          },
        },
      ],
    };
    const f = board(effect);
    const before = {
      ...f.state,
      cardInstances: [
        ...f.state.cardInstances,
        ...["kept", "gone"].map((instanceId) =>
          createCardInstance(f.source, {
            instanceId,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
            exhaustState: "exhausted",
          })
        ),
      ],
    };
    const paid = {
      ...before,
      players: before.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 3, trashNormalCoreCount: 2 }
          : player
      ),
    };
    const afterResponse: GameState = {
      ...paid,
      cardInstances: paid.cardInstances.map((card) =>
        card.instanceId === "gone" ? { ...card, zone: "trash" } : card
      ),
      players: paid.players.map((player) =>
        player.id === "bob" ? { ...player, countValue: 1 } : player
      ),
      pendingTargetedDisclosureContinuation: {
        chainId: "conditional-late-target-departure",
        pendingId: "disclosure-test",
        sourceDefinitionId: f.source.cardNo,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        effectIndex: 0,
        resumeStepIndex: 1,
        stepContext: {
          results: {
            __step_0: {
              stepId: "__step_0",
              affectedCardInstanceIds: [],
              succeeded: true,
            },
          },
          conditionalCostOriginalState: before,
          conditionalCostSnapshotHadPriorSuccess: false,
        },
        conditionalCostResponseState: paid,
        targetStepId: "recover",
        targetInstanceIds: ["kept", "gone"],
        targetZonesByInstanceId: { kept: "field", gone: "field" },
        skipTargetedDisclosureTargetCount: 2,
        remainingStacks: [],
        ...(reason === "negate"
          ? {
              negateIdentitySnapshot: {
                stackId: "disclosed-effect",
                actingPlayerId: "alice",
                actionKind: "field_card_effect",
                cardDefinitionId: f.source.cardNo,
                cardInstanceId: "source",
                targetInstanceIds: ["kept", "gone"],
                isNullified: true,
              },
            }
          : {}),
      },
    };
    const saved = JSON.parse(JSON.stringify(afterResponse));
    const safe = sanitizeStateForViewer(saved, "bob");
    expect(
      safe.pendingTargetedDisclosureContinuation?.conditionalCostResponseState
    ).toBeUndefined();
    const resolved = resumeTargetedDisclosureIfReady(saved, {
      getCardDefinitionById: f.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(resolved.pendingTargetedDisclosureContinuation).toBeNull();
    expect(resolved.log, JSON.stringify(resolved.log)).toContain(
      reason === "negate"
        ? "effect:negate:targeted-disclosure-step-continuation:disclosure-test"
        : "effect:conditional-cost-effect-failed:source"
    );
    expect(resolved.players.find((p) => p.id === "alice")).toMatchObject({
      reserveNormalCoreCount: 5,
      trashNormalCoreCount: 0,
    });
    expect(resolved.players.find((p) => p.id === "bob")?.countValue).toBe(1);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "gone")?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "kept")?.exhaustState
    ).toBe("exhausted");
  }
);

it("割り込みで支払い先のコアが移動しても、返却でコアを増やしたり負数にしたりしない", () => {
  const { state } = board();
  const paid = {
    ...state,
    players: state.players.map((player) =>
      player.id === "alice"
        ? { ...player, reserveNormalCoreCount: 3, trashNormalCoreCount: 2 }
        : player
    ),
  };
  const afterResponse = {
    ...paid,
    players: paid.players.map((player) =>
      player.id === "alice"
        ? {
            ...player,
            trashNormalCoreCount: 1,
            voidNormalCoreCount: player.voidNormalCoreCount + 1,
          }
        : player
    ),
  };
  const restored = rebaseConditionalCostRollback(state, paid, afterResponse);
  expect(restored.players[0]).toMatchObject({
    reserveNormalCoreCount: 4,
    trashNormalCoreCount: 0,
    voidNormalCoreCount: state.players[0]!.voidNormalCoreCount + 1,
  });
});

it("支払い元が応答で場を離れた場合、ソウルコアはリザーブへ戻す", () => {
  const { state } = board();
  const before = withSoulCoreLocation(state, "alice", {
    kind: "card",
    instanceId: "source",
  });
  const paid = withSoulCoreLocation(before, "alice", { kind: "trash" });
  const afterResponse: GameState = {
    ...paid,
    cardInstances: paid.cardInstances.map((card) =>
      card.instanceId === "source" ? { ...card, zone: "trash" } : card
    ),
  };
  const restored = rebaseConditionalCostRollback(before, paid, afterResponse);
  expect(restored.players[0]).toMatchObject({
    soulCoreLocation: { kind: "reserve" },
    reserveSoulCoreCount: 1,
    trashSoulCoreCount: 0,
  });
  expect(
    restored.cardInstances.find((card) => card.instanceId === "source")
  ).toMatchObject({ zone: "trash", soulCoreCount: 0 });
});

it("追加ソウルの支払いを戻しても、リザーブの主ソウルは動かさない", () => {
  const { state } = board();
  const field = { kind: "card", instanceId: "source" } as const;
  const trash = { kind: "trash", playerId: "alice" } as const;
  const primaryInReserve = withSoulCoreLocation(state, "alice", {
    kind: "reserve",
  });
  const before = generateSoulCoreOutsideGame(primaryInReserve, "alice", field);
  const paid = moveSoulCore(before, "alice", field, trash);
  const afterResponse: GameState = {
    ...paid,
    players: paid.players.map((player) =>
      player.id === "bob" ? { ...player, countValue: 1 } : player
    ),
  };
  const restored = rebaseConditionalCostRollback(before, paid, afterResponse);
  expect(restored.players[0]).toMatchObject({
    soulCoreLocation: { kind: "reserve" },
    reserveSoulCoreCount: 1,
    trashSoulCoreCount: 0,
  });
  expect(restored.players[1]?.countValue).toBe(1);
  expect(
    restored.cardInstances.find((card) => card.instanceId === "source")
  ).toMatchObject({ soulCoreCount: 1 });
});
