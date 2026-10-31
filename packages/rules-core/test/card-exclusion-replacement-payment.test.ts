import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeRemoveFromGame,
  flushPendingLeaves,
  getLegalActions,
  queuePendingLeave,
  recomputeAndRebuildContinuousEffects,
  sanitizeStateForViewer,
  resolveSetAsideExitReplacementChoice,
  type GameState,
} from "../src";
import { getAvailablePayCostCoreSources } from "../src/core/payment-system";
import { moveNormalCores, moveSoulCore } from "../src/core/core-system";

const defs = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => defs.get(id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function makeState(reserve = 0, donorCores?: number, soul = 0): GameState {
  return recomputeAndRebuildContinuousEffects(
    createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: reserve,
          reserveSoulCoreCount: soul,
          handCount: 0,
        },
        {},
      ],
      cardInstances: [
        createCardInstance(defs.get("BSTH08.5-X04")!, {
          instanceId: "mask",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        ...(donorCores === undefined
          ? []
          : [
              createCardInstance(defs.get("BSTH01-C01")!, {
                instanceId: "donor",
                ownerPlayerId: "alice",
                zone: "field",
                normalCoreCount: donorCores,
              }),
            ]),
      ],
    }),
    getDef
  );
}
function remove(state: GameState) {
  return executeRemoveFromGame(
    state,
    "alice",
    {
      kind: "remove_from_game",
      target: { player: "self", zone: ["set_aside"], count: 1 },
    },
    getDef,
    "mask",
    ["mask"]
  );
}
function actions(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "alice", ...lookups });
}
function accept(state: GameState) {
  const action = actions(state).find(
    (a) =>
      a.kind === "resolve_set_aside_exit_replacement_choice" &&
      a.choice === "replace"
  );
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}
function pay(
  state: GameState,
  allocations: Record<string, number>,
  soulSource?: string
) {
  const action = actions(state).find(
    (a) => a.kind === "resolve_core_source_allocation"
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...lookups,
    coreSourceAllocations: allocations,
    ...(soulSource ? { coreSourceSoulCoreInstanceId: soulSource } : {}),
  }).state;
}
function restrict(state: GameState, field = false) {
  // The real R03 reserve restriction carrier, or the same common field restriction primitive.
  const action = field
    ? {
        kind: "restrict_field_cost_payment" as const,
        player: "opponent" as const,
        duration: { scope: "turn" as const },
      }
    : defs.get("BSSL01-R03")!.effects![1]!.steps[2]!.action;
  return executeEffect({
    state,
    chainId: "test:replacement-restriction",
    sourceInstanceId: "restriction-source",
    actingPlayerId: "bob",
    ...lookups,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action }],
    },
  });
}

describe("自己除外置換の共通コスト支払い", () => {
  it("リザーブ0でもフィールドを原資に選び実X01の離脱本文を再開する", () => {
    let state = makeState(0, 2);
    const host = createCardInstance(defs.get("BSTH08.5-X01")!, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    state = recomputeAndRebuildContinuousEffects(
      { ...state, cardInstances: [...state.cardInstances, host] },
      getDef
    );
    state = queuePendingLeave({
      state,
      instanceId: "host",
      kind: "destroy",
      cause: "opponent_effect",
      causePlayerId: "bob",
      chainId: "test:replacement-payment",
      deferZoneMoveUntilChainEnd: false,
    });
    state = executeEffect({
      state,
      effect: defs.get("BSTH08.5-X01")!.effects![1]!,
      effectIndex: 1,
      chainId: "test:replacement-payment",
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      getAvailablePayCostCoreSources(state, "alice", getDef)
        .map((s) => s.instanceId)
        .sort()
    ).toEqual(["donor", "host"]);
    state = accept(state);
    expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
    expect(state.pendingSetAsideExitReplacementChoice?.cardInstanceId).toBe(
      "mask"
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "host")?.pendingLeaveKind
    ).toBe("destroy");
    expect(state.players[0]!.trashNormalCoreCount).toBe(0);
    state = flushPendingLeaves(pay(state, { donor: 1 }), getDef);
    expect(state.cardInstances.find((c) => c.instanceId === "mask")?.zone).toBe(
      "set_aside"
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "donor")?.normalCoreCount
    ).toBe(1);
    expect(state.cardInstances.find((c) => c.instanceId === "host")?.zone).toBe(
      "trash"
    );
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
    expect(state.pendingCoreSourceAllocation).toBeNull();
    expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
  });

  it("実R03のリザーブ禁止下で原資がなければ置換を提示しない", () => {
    const state = remove(restrict(makeState(4)));
    expect(getAvailablePayCostCoreSources(state, "alice", getDef)).toEqual([]);
    expect(
      actions(state)
        .filter((a) => a.kind === "resolve_set_aside_exit_replacement_choice")
        .map((a) => a.choice)
    ).toEqual(["decline"]);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(4);
    const before = JSON.stringify(state);
    expect(() =>
      resolveSetAsideExitReplacementChoice(state, true, getDef, [
        { kind: "reserve", amount: 1 },
      ])
    ).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("リザーブ禁止下でも合法なフィールドだけを候補に残す", () => {
    let state = accept(remove(restrict(makeState(4, 2))));
    expect(
      state.pendingCoreSourceAllocation!.candidates.map((c) => c.instanceId)
    ).toEqual(["donor"]);
    state = pay(state, { donor: 1 });
    expect(state.players[0]!.reserveNormalCoreCount).toBe(4);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
  });

  it("フィールド支払い禁止を候補と明示入力の双方で守る", () => {
    const state = remove(restrict(makeState(0, 2), true));
    expect(getAvailablePayCostCoreSources(state, "alice", getDef)).toEqual([]);
    expect(
      actions(state)
        .filter((a) => a.kind === "resolve_set_aside_exit_replacement_choice")
        .map((a) => a.choice)
    ).toEqual(["decline"]);
    const before = JSON.stringify(state);
    expect(() =>
      resolveSetAsideExitReplacementChoice(state, true, getDef, [
        { kind: "card", instanceId: "donor", amount: 1 },
      ])
    ).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("通常とソウルがあると支払前に選択を待ちソウルだけを支払う", () => {
    let state = accept(remove(makeState(1, undefined, 1)));
    expect(state.pendingCoreSourceAllocation?.candidates).toEqual([
      {
        instanceId: "reserve",
        available: 2,
        normalAvailable: 1,
        hasSoulCore: true,
      },
    ]);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
    state = JSON.parse(JSON.stringify(state));
    expect(
      sanitizeStateForViewer(state, "alice")
        .pendingSetAsideExitReplacementChoice
    ).toEqual({
      choosingPlayerId: "alice",
      cardInstanceId: "mask",
      replacement: { kind: "pay_cost", amount: 1 },
    });
    expect(
      sanitizeStateForViewer(state, "bob").pendingCoreSourceAllocation
    ).toBeNull();
    const stale = actions(state).find(
      (a) => a.kind === "resolve_core_source_allocation"
    )!;
    state = pay(state, {}, "reserve");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
    expect(state.players[0]!.reserveSoulCoreCount).toBe(0);
    expect(state.players[0]!.trashSoulCoreCount).toBe(1);
    expect(state.players[0]!.trashNormalCoreCount).toBe(0);
    expect(() =>
      applyLegalAction({
        state,
        action: stale,
        ...lookups,
        coreSourceAllocations: {},
        coreSourceSoulCoreInstanceId: "reserve",
      })
    ).toThrow();
  });

  it("支払い元の最後のコアは共通のコスト消滅待機と離脱を通る", () => {
    let state = accept(remove(makeState(0, 1)));
    state = pay(state, { donor: 1 });
    const leave = state.pendingLeaveEntities.find(
      (p) => p.instanceId === "donor"
    );
    expect(leave?.kind).toBe("vanish");
    expect(leave?.causedByEffectSourceInstanceId).toBe("mask");
    state = flushPendingLeaves(state, getDef);
    expect(
      state.cardInstances.find((c) => c.instanceId === "donor")?.zone
    ).toBe("trash");
    expect(state.cardInstances.find((c) => c.instanceId === "mask")?.zone).toBe(
      "set_aside"
    );
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
  });

  for (const location of ["reserve", "field"] as const) {
    describe(`現在のコア種再検証 / ${location}`, () => {
      const pendingWithBothCoreKinds = () => {
        let state = makeState(
          location === "reserve" ? 1 : 0,
          location === "field" ? 1 : undefined,
          location === "reserve" ? 1 : 0
        );
        if (location === "field")
          state = {
            ...state,
            cardInstances: state.cardInstances.map((card) =>
              card.instanceId === "donor" ? { ...card, soulCoreCount: 1 } : card
            ),
          };
        const pending = accept(remove(state));
        expect(pending.pendingCoreSourceAllocation?.candidates).toEqual([
          {
            instanceId: location === "reserve" ? "reserve" : "donor",
            available: 2,
            normalAvailable: 1,
            hasSoulCore: true,
          },
        ]);
        return pending;
      };
      const source =
        location === "reserve"
          ? { kind: "reserve" as const, playerId: "alice" }
          : { kind: "card" as const, instanceId: "donor" };
      const sourceId = location === "reserve" ? "reserve" : "donor";

      it("通常コア消失後の古い通常配分をソウルへ代用せず無変更で拒否する", () => {
        const state = moveNormalCores(
          pendingWithBothCoreKinds(),
          source,
          { kind: "trash", playerId: "alice" },
          1
        );
        const before = structuredClone(state);
        expect(() => pay(state, { [sourceId]: 1 })).toThrow();
        expect(state).toEqual(before);
        expect(state.players[0]!.trashSoulCoreCount).toBe(0);
        expect(state.pendingCoreSourceAllocation).not.toBeNull();
        expect(state.pendingSetAsideExitReplacementChoice).not.toBeNull();
      });

      it("ソウル消失後の古いソウル指定を通常へ代用せず無変更で拒否する", () => {
        const state = moveSoulCore(
          pendingWithBothCoreKinds(),
          "alice",
          source,
          { kind: "trash", playerId: "alice" }
        );
        const before = structuredClone(state);
        expect(() => pay(state, {}, sourceId)).toThrow();
        expect(state).toEqual(before);
        expect(state.players[0]!.trashNormalCoreCount).toBe(0);
        expect(state.pendingCoreSourceAllocation).not.toBeNull();
      });

      it("直接の通常原資指定もソウルへ代替せず明示ソウル指定だけを支払う", () => {
        const state = moveNormalCores(
          pendingWithBothCoreKinds(),
          source,
          { kind: "trash", playerId: "alice" },
          1
        );
        const direct = { ...state, pendingCoreSourceAllocation: null };
        const before = structuredClone(direct);
        for (const flag of [undefined, false]) {
          const payment =
            location === "reserve"
              ? { kind: "reserve" as const, amount: 1, includeSoulCore: flag }
              : {
                  kind: "card" as const,
                  instanceId: "donor",
                  amount: 1,
                  includeSoulCore: flag,
                };
          expect(() =>
            resolveSetAsideExitReplacementChoice(direct, true, getDef, [
              payment,
            ])
          ).toThrow();
          expect(direct).toEqual(before);
        }
        const paid = resolveSetAsideExitReplacementChoice(
          direct,
          true,
          getDef,
          [
            location === "reserve"
              ? { kind: "reserve", amount: 1, includeSoulCore: true }
              : {
                  kind: "card",
                  instanceId: "donor",
                  amount: 1,
                  includeSoulCore: true,
                },
          ]
        );
        expect(paid.players[0]!.trashSoulCoreCount).toBe(1);
        expect(paid.pendingSetAsideExitReplacementChoice).toBeNull();
        expect(
          paid.cardInstances.find((card) => card.instanceId === "mask")?.zone
        ).toBe("set_aside");
      });
    });
  }

  it("原資選択中の置換再押下と不正配分を状態変更前に拒否する", () => {
    const initial = remove(makeState(1, 2, 1));
    const stale = actions(initial).find(
      (a) =>
        a.kind === "resolve_set_aside_exit_replacement_choice" &&
        a.choice === "replace"
    )!;
    const state = accept(initial);
    const before = JSON.stringify(state);
    expect(() =>
      applyLegalAction({ state, action: stale, ...lookups })
    ).toThrow();
    for (const input of [
      { outsider: 1 },
      { donor: 2 },
      { donor: -1, reserve: 2 },
    ]) {
      expect(() => pay(state, input)).toThrow();
      expect(JSON.stringify(state)).toBe(before);
    }
    const action = actions(state).find(
      (a) => a.kind === "resolve_core_source_allocation"
    )!;
    const forbidden = restrict(makeState(1));
    const changed = {
      ...state,
      activeContinuousEffects: forbidden.activeContinuousEffects,
    };
    expect(() =>
      applyLegalAction({
        state: changed,
        action,
        ...lookups,
        coreSourceAllocations: { reserve: 1 },
      })
    ).toThrow();
    expect(state.players[0]!.trashNormalCoreCount).toBe(0);
  });

  for (const lastChoice of ["replace", "decline"] as const) {
    describe(`C03 X04二枚 / 最後${lastChoice}`, () => {
      it("支払原資選択を挟んでも全置換後の実除外数だけで本文を再開する", () => {
        let state = makeState(0, 3);
        const ordinary = Array.from({ length: 9 }, (_, i) =>
          createCardInstance(defs.get("BSTH01-C01")!, {
            instanceId: `ordinary-${i}`,
            ownerPlayerId: "alice",
            zone: "hand",
          })
        );
        state = recomputeAndRebuildContinuousEffects(
          {
            ...state,
            cardInstances: [
              ...state.cardInstances,
              ...ordinary,
              createCardInstance(defs.get("BSTH08.5-X04")!, {
                instanceId: "mask-2",
                ownerPlayerId: "alice",
                zone: "set_aside",
              }),
              createCardInstance(defs.get("BSAZ01-C03")!, {
                instanceId: "c03",
                ownerPlayerId: "alice",
                zone: "in_use",
              }),
              createCardInstance(defs.get("BSTH01-C01")!, {
                instanceId: "enemy",
                ownerPlayerId: "bob",
                zone: "field",
                normalCoreCount: 1,
              }),
            ],
            players: state.players.map((p) =>
              p.id === "alice" ? { ...p, handCount: 9 } : p
            ),
            activePlayerId: "alice",
            step: "attack",
            window: "declare_attack",
            activeAttack: {
              attackId: "test:replacement-pay-count",
              primaryEntityId: "donor-be",
              participantEntityIds: ["donor-be"],
              groupMode: "single",
              target: { kind: "player", playerId: "bob" },
              blockAssignments: [
                { participantEntityId: "donor-be", blockedByEntityIds: [] },
              ],
              symbolResolutionOrder: ["donor-be"],
              flashBeforeBlockCompleted: true,
              flashAfterBlockCompleted: false,
              flashWindowState: null,
            },
            battleEntities: [
              {
                entityId: "donor-be",
                memberInstanceIds: ["donor"],
                resolvedBp: 1000,
                resolvedSymbols: ["red"],
                attackState: "attacking",
              },
            ],
          },
          getDef
        );
        state = executeEffect({
          state,
          chainId: "test:replacement-pay-count",
          effect: defs.get("BSAZ01-C03")!.effects![1]!,
          effectIndex: 1,
          sourceInstanceId: "c03",
          actingPlayerId: "alice",
          ...lookups,
          targetInstanceIds: [
            "mask",
            "mask-2",
            ...ordinary.map((c) => c.instanceId),
          ],
          targetStepId: "exclude-cards",
          targetSelectionResolved: true,
        });
        state = accept(state);
        expect(state.pendingSetAsideExitReplacementChoice?.cardInstanceId).toBe(
          "mask"
        );
        expect(state.pendingBattleEndDeferrals).toHaveLength(0);
        const visible = sanitizeStateForViewer(state, "alice");
        expect(
          JSON.stringify(visible.pendingCoreSourceAllocation)
        ).not.toContain("originalState");
        expect(
          JSON.stringify(visible.pendingSetAsideExitReplacementChoice)
        ).not.toContain("continuation");
        state = pay(JSON.parse(JSON.stringify(state)), { donor: 1 });
        expect(state.pendingSetAsideExitReplacementChoice?.cardInstanceId).toBe(
          "mask-2"
        );
        expect(state.pendingBattleEndDeferrals).toHaveLength(0);
        if (lastChoice === "replace") {
          state = accept(state);
          expect(
            state.pendingSetAsideExitReplacementChoice?.cardInstanceId
          ).toBe("mask-2");
          expect(state.pendingBattleEndDeferrals).toHaveLength(0);
          state = pay(state, { donor: 1 });
        } else {
          const decline = actions(state).find(
            (a) =>
              a.kind === "resolve_set_aside_exit_replacement_choice" &&
              a.choice === "decline"
          )!;
          state = applyLegalAction({
            state,
            action: decline,
            ...lookups,
          }).state;
        }
        state = flushPendingLeaves(state, getDef);
        expect(
          state.cardInstances.filter((c) => c.zone === "removed_from_game")
        ).toHaveLength(lastChoice === "replace" ? 9 : 10);
        expect(
          state.cardInstances.find((c) => c.instanceId === "enemy")?.zone
        ).toBe(lastChoice === "replace" ? "field" : "trash");
        expect(state.players[0]!.trashNormalCoreCount).toBe(
          lastChoice === "replace" ? 2 : 1
        );
        expect(state.pendingBattleEndDeferrals).toHaveLength(1);
        expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
        expect(state.pendingCoreSourceAllocation).toBeNull();
      });
    });
  }
});
