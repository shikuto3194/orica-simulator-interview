import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type ActiveAttack,
} from "../src";
import { executeEnterSoulState } from "../src/effect/structured-soul-state";
import { executeSoulStateSummon } from "../src/effect/structured-summon";
import { moveCardZone, updateCard } from "../src/core/core-system";
import {
  flushPendingLeaves,
  resolveSoulStateReplacement,
} from "../src/state-based-actions";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
  refundEffectUsage,
} from "../src/legal/legal-actions-shared";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: () => undefined,
  getRegisteredBurstActions: () => undefined,
};

function makeState(cardNo = "BSGE01-CX01") {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(getDef(cardNo)!, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        ...["hand-1", "hand-2", "draw-1", "draw-2"].map((id) =>
          createCardInstance(getDef("BSSL01-C02")!, {
            instanceId: id,
            ownerPlayerId: "alice",
            zone: id.startsWith("hand") ? "hand" : "deck",
          })
        ),
      ],
      playerOverrides: [{ handCount: 2, deckCount: 2 }],
    }),
    step: "main" as const,
  };
}

function findBullet(state: GameState) {
  return getLegalActions({ ...lookups, state, actingPlayerId: "alice" }).find(
    (a) =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === "host" &&
      a.timing === "normal"
  );
}

function useBullet(state: GameState, targetId: string) {
  const declaration = findBullet(state);
  expect(declaration).toBeDefined();
  let next = applyLegalAction({
    ...lookups,
    state,
    action: declaration!,
  }).state;
  const pass = getLegalActions({
    ...lookups,
    state: next,
    actingPlayerId: "bob",
  }).find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  next = applyLegalAction({ ...lookups, state: next, action: pass! }).state;
  const target = getLegalActions({
    ...lookups,
    state: next,
    actingPlayerId: "alice",
  }).find((a) => a.kind === "resolve_pending_effect_target");
  expect(target).toBeDefined();
  return applyLegalAction({
    ...lookups,
    state: next,
    action: target!,
    targetInstanceIds: [targetId],
  }).state;
}

function leave(state: GameState, soul: boolean) {
  const pending = updateCard(state, "host", (c) => ({
    ...c,
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: "leave-host",
  }));
  pending.pendingLeaveEntities = [
    {
      instanceId: "host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId: "leave-host",
      deferZoneMoveUntilChainEnd: false,
      leaveFieldCoreDestinationOverride: null,
    },
  ];
  pending.pendingSoulStateReplacement = {
    choosingPlayerId: "alice",
    cardInstanceId: "host",
    originalLeaveKind: "destroy",
    originalLeaveCause: "effect_resolution",
  };
  return flushPendingLeaves(
    resolveSoulStateReplacement(pending, soul, getDef),
    getDef
  );
}

describe("バレットエディットの個体単位回数制限", () => {
  it.each(["BSGE01-CX01", "BSGE01-CX02", "BSGE01-CX03", "BSGE01-CX04"])(
    "%s: トラッシュを経た再登場ではもう一度配置してドローできる",
    (cardNo) => {
      const used = useBullet(makeState(cardNo), "hand-1");
      expect(findBullet(used)).toBeUndefined();
      const trashed = leave(used, false);
      expect(
        trashed.cardInstances.find((c) => c.instanceId === "host")?.zone
      ).toBe("trash");
      expect(
        trashed.cardInstances.find((c) => c.instanceId === "hand-1")?.zone
      ).toBe("trash");
      let returned = moveCardZone(trashed, "host", "field", "spirit");
      returned = updateCard(returned, "host", (c) => ({
        ...c,
        normalCoreCount: 1,
      }));
      const after = useBullet(returned, "hand-2");
      expect(
        after.cardInstances.find((c) => c.instanceId === "host")?.underCards
      ).toContainEqual({
        cardInstanceId: "hand-2",
        role: "text_role",
        roleTag: "バレットエディット",
      });
      expect(after.players[0]!.deckCount).toBe(0);
      expect(findBullet(after)).toBeUndefined();
    }
  );

  it("魂状態になっても消費を維持し、下カードが無い状態でも再使用できない", () => {
    const used = useBullet(makeState(), "hand-1");
    const soul = leave(used, true);
    expect(soul.players[0]!.soulStateInstanceIds).toContain("host");
    expect(soul.cardInstances.find((c) => c.instanceId === "host")?.zone).toBe(
      "field"
    );
    const emptySoul = updateCard(
      moveCardZone(soul, "hand-1", "trash"),
      "host",
      (c) => ({ ...c, underCards: [] })
    );
    expect(findBullet(emptySoul)).toBeUndefined();
    const restored = executeSoulStateSummon(
      emptySoul,
      "test:bsge01-bullet-edit-reentry.test.ts:summon",
      "alice",
      undefined,
      "free",
      "host",
      getDef,
      ["host"],
      [{ kind: "reserve_normal", amount: 1 }]
    );
    expect(restored.players[0]!.soulStateInstanceIds).not.toContain("host");
    expect(
      restored.cardInstances.find((c) => c.instanceId === "host")
        ?.normalCoreCount
    ).toBe(1);
    expect(findBullet(restored)).toBeUndefined();
  });

  it.each(["hand", "deck", "trash"] as const)(
    "%s への直接離脱でも個体制限のみリセットし、同名制限の履歴は保持する",
    (destination) => {
      const limits = {
        sourceInstanceId: "host",
        sourceDefinitionId: "BSGE01-CX01",
        effectLabel: "shared-test",
        usageLimit: {
          kind: "per_instance" as const,
          duration: "game" as const,
        },
      };
      const used = recordEffectUsageIfLimited({
        ...limits,
        state: makeState(),
      });
      const returned = moveCardZone(
        moveCardZone(used, "host", destination),
        "host",
        "field"
      );
      expect(canUseEffectByUsageLimit({ ...limits, state: returned })).toBe(
        true
      );
      expect(
        canUseEffectByUsageLimit({
          ...limits,
          state: returned,
          usageLimit: { kind: "per_card_name", duration: "game" },
        })
      ).toBe(false);
      const reused = recordEffectUsageIfLimited({ ...limits, state: returned });
      expect(canUseEffectByUsageLimit({ ...limits, state: reused })).toBe(
        false
      );
      const refunded = {
        ...reused,
        effectUsageRecords: refundEffectUsage({
          ...limits,
          state: reused,
          duration: "game",
        }),
      };
      expect(canUseEffectByUsageLimit({ ...limits, state: refunded })).toBe(
        true
      );
      expect(
        canUseEffectByUsageLimit({
          ...limits,
          state: refunded,
          usageLimit: { kind: "per_card_name", duration: "game" },
        })
      ).toBe(false);
    }
  );
});

describe("魂状態を含まない効果の per_instance 制限", () => {
  for (const entry of ["replacement", "effect"] as const) {
    it.each(["turn", "game", "step", "battle"] as const)(
      entry + ": %s 制限は魂状態化でリセットされ、復帰後にもう一度消費できる",
      (duration) => {
        let initial: GameState = makeState();
        if (duration === "battle") {
          initial = {
            ...initial,
            activeAttack: {
              attackId: "same-battle",
              primaryEntityId: "unrelated-attacker",
              participantEntityIds: ["unrelated-attacker"],
              groupMode: "single",
              target: { kind: "player", playerId: "bob" },
              blockAssignments: [],
              symbolResolutionOrder: [],
              flashBeforeBlockCompleted: false,
              flashAfterBlockCompleted: false,
              flashWindowState: null,
            } satisfies ActiveAttack,
          };
        }
        const options = {
          sourceInstanceId: "host",
          sourceDefinitionId: "BSGE01-CX01",
          effectLabel: "spirit-only-test",
          usageLimit: { kind: "per_instance" as const, duration },
        };
        const used = recordEffectUsageIfLimited({ ...options, state: initial });
        expect(canUseEffectByUsageLimit({ ...options, state: used })).toBe(
          false
        );
        const soul =
          entry === "replacement"
            ? leave(used, true)
            : executeEnterSoulState(
                used,
                "alice",
                {
                  target: { player: "self", selfCard: true },
                },
                getDef,
                "host"
              );
        // battle 自体が閉じても同じ期間で検査し、期間更新による解除との混同を避ける。
        const sameScopeSoul = { ...soul, activeAttack: initial.activeAttack };
        expect(soul.players[0]!.soulStateInstanceIds).toContain("host");
        expect(
          canUseEffectByUsageLimit({ ...options, state: sameScopeSoul })
        ).toBe(true);
        expect(
          canUseEffectByUsageLimit({
            ...options,
            state: sameScopeSoul,
            usageLimit: { kind: "per_card_name", duration },
          })
        ).toBe(false);
        const restored = executeSoulStateSummon(
          soul,
          "test:bsge01-bullet-edit-reentry.test.ts:summon",
          "alice",
          undefined,
          "free",
          "host",
          getDef,
          ["host"],
          [{ kind: "reserve_normal", amount: 1 }]
        );
        const sameScopeRestored = {
          ...restored,
          activeAttack: initial.activeAttack,
        };
        expect(
          canUseEffectByUsageLimit({ ...options, state: sameScopeRestored })
        ).toBe(true);
        const reused = recordEffectUsageIfLimited({
          ...options,
          state: sameScopeRestored,
        });
        expect(canUseEffectByUsageLimit({ ...options, state: reused })).toBe(
          false
        );
        const refunded = {
          ...reused,
          effectUsageRecords: refundEffectUsage({
            ...options,
            state: reused,
            duration,
          }),
        };
        expect(canUseEffectByUsageLimit({ ...options, state: refunded })).toBe(
          true
        );
      }
    );
  }
});

it("星霊衣はスピリット/魂状態の DSL 変種をまたいでも per_instance の消費を共有する", () => {
  const def = getDef("BSFT01-CX01")!;
  const spiritEffect = def.effects![2]!;
  const soulEffect = def.effects![3]!;
  expect(spiritEffect.applicability?.soulState).toBe(false);
  expect(soulEffect.applicability?.soulState).toBe(true);
  expect(spiritEffect.limitGroupId).toBe(soulEffect.limitGroupId);
  const options = {
    sourceInstanceId: "host",
    sourceDefinitionId: def.cardNo,
    getCardDefinitionById: getDef,
    effectLabel: "spirit:0",
    groupId: spiritEffect.limitGroupId!,
    usageLimit: { kind: "per_instance" as const, duration: "game" as const },
  };
  const used = recordEffectUsageIfLimited({
    ...options,
    state: makeState(def.cardNo),
  });
  const soul = leave(used, true);
  expect(
    canUseEffectByUsageLimit({
      ...options,
      state: soul,
      sourceEffect: soulEffect,
    })
  ).toBe(false);
  const restored = executeSoulStateSummon(
    soul,
    "test:bsge01-bullet-edit-reentry.test.ts:summon",
    "alice",
    undefined,
    "free",
    "host",
    getDef,
    ["host"],
    [{ kind: "reserve_normal", amount: 1 }]
  );
  expect(
    canUseEffectByUsageLimit({
      ...options,
      state: restored,
      sourceEffect: spiritEffect,
    })
  ).toBe(false);
});
