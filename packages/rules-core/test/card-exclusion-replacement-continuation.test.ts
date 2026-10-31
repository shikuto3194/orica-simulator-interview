import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { convertTargetSpecToEffectTarget } from "../src/effect/native-target-resolution";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeRemoveFromGame,
  getLegalActions,
  flushPendingLeaves,
  queuePendingLeave,
  recomputeAndRebuildContinuousEffects,
  sanitizeStateForViewer,
  type GameState,
  type LegalAction,
} from "../src";

const defs = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => defs.get(id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
const instance = (
  no: string,
  id: string,
  zone: "set_aside" | "field" | "hand" | "in_use"
) =>
  createCardInstance(defs.get(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone,
    ...(zone === "field" ? { normalCoreCount: 2 } : {}),
  });
const zone = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)?.zone;
function stateFor(no: string, count = 2, reserve = 4): GameState {
  return recomputeAndRebuildContinuousEffects(
    createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: reserve,
          reserveSoulCoreCount: 0,
          handCount: 0,
        },
        {},
      ],
      cardInstances: Array.from({ length: count }, (_, i) =>
        instance(no, `mask-${i}`, "set_aside")
      ),
    }),
    getDef
  );
}
function actions(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "alice", ...lookups });
}
function apply(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
) {
  return applyLegalAction({
    state,
    action,
    ...lookups,
    ...(targetInstanceIds ? { selectedZoneCardIds: targetInstanceIds } : {}),
  }).state;
}
function choose(state: GameState, choice: "replace" | "decline") {
  const action = actions(state).find(
    (a) =>
      a.kind === "resolve_set_aside_exit_replacement_choice" &&
      a.choice === choice
  );
  expect(action, state.log.join("\n")).toBeDefined();
  return apply(state, action!);
}
function removeBoth(state: GameState) {
  const action = defs.get("BSAZ01-C03")!.effects![1]!.steps[0]!.action;
  if (action.kind !== "remove_from_game")
    throw new Error("C03 removal action missing");
  return executeRemoveFromGame(
    state,
    "alice",
    {
      kind: "remove_from_game",
      target: convertTargetSpecToEffectTarget(action.target),
    },
    getDef,
    "c03",
    ["mask-0", "mask-1"]
  );
}

describe("カード除外の複数自己置換と本文継続", () => {
  it("M11の2枚を待機させ、受諾後にも2枚目の選択を提示する", () => {
    let state = removeBoth(stateFor("BSTH08.5-M11"));
    expect([zone(state, "mask-0"), zone(state, "mask-1")]).toEqual([
      "set_aside",
      "set_aside",
    ]);
    const stale = actions(state).find(
      (a) =>
        a.kind === "resolve_set_aside_exit_replacement_choice" &&
        a.choice === "replace"
    )!;
    state = choose(state, "replace");
    expect(zone(state, "mask-0")).toBe("hand");
    expect(zone(state, "mask-1")).toBe("set_aside");
    expect(state.pendingSetAsideExitReplacementChoice?.cardInstanceId).toBe(
      "mask-1"
    );
    expect(actions(state).some((a) => a.actionId === stale.actionId)).toBe(
      false
    );
    // 保存/再読込後もqueueを保持し、相手・観戦者へ本文継続を公開しない。
    state = JSON.parse(JSON.stringify(state));
    expect(
      sanitizeStateForViewer(state, "bob").pendingSetAsideExitReplacementChoice
    ).toBeNull();
    expect(
      sanitizeStateForViewer(state, null).pendingSetAsideExitReplacementChoice
    ).toBeNull();
    state = choose(state, "replace");
    expect([zone(state, "mask-0"), zone(state, "mask-1")]).toEqual([
      "hand",
      "hand",
    ]);
    expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(state.players[0]!.handCount).toBe(2);
  });

  it("M11の受諾と辞退を混在させても未選択札を先に除外しない", () => {
    let state = choose(removeBoth(stateFor("BSTH08.5-M11")), "decline");
    expect(zone(state, "mask-0")).toBe("removed_from_game");
    expect(zone(state, "mask-1")).toBe("set_aside");
    state = choose(state, "replace");
    expect([zone(state, "mask-0"), zone(state, "mask-1")]).toEqual([
      "removed_from_game",
      "hand",
    ]);
    expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
  });

  it("X04の2枚目は1枚目の支払い後のリザーブで支払可否を再判定する", () => {
    let state = choose(removeBoth(stateFor("BSTH08.5-X04", 2, 1)), "replace");
    expect(zone(state, "mask-0")).toBe("set_aside");
    expect(zone(state, "mask-1")).toBe("set_aside");
    expect(
      actions(state)
        .filter((a) => a.kind === "resolve_set_aside_exit_replacement_choice")
        .map((a) => a.choice)
    ).toEqual(["decline"]);
    state = choose(state, "decline");
    expect([zone(state, "mask-0"), zone(state, "mask-1")]).toEqual([
      "set_aside",
      "removed_from_game",
    ]);
    expect(state.players[0]!.trashNormalCoreCount).toBe(1);
    expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
  });

  for (const candidates of [1, 2]) {
    for (const maskNo of ["BSTH08.5-M11", "BSTH08.5-X04"]) {
      for (const choice of ["replace", "decline"] as const) {
        describe(`X01 ${candidates === 1 ? "即時" : "選択"}search / ${maskNo} / ${choice}`, () => {
          it("自己除外置換の選択完了まで残留を保留し離脱処理まで完走する", () => {
            let state = stateFor(maskNo, candidates);
            const host = instance("BSTH08.5-X01", "host", "field");
            state = queuePendingLeave({
              state: recomputeAndRebuildContinuousEffects(
                { ...state, cardInstances: [...state.cardInstances, host] },
                getDef
              ),
              instanceId: "host",
              kind: "destroy",
              cause: "opponent_effect",
              causePlayerId: "bob",
              chainId: "test:exclude-search",
              deferZoneMoveUntilChainEnd: false,
            });
            state = executeEffect({
              chainId: "test:exclude-search",
              state,
              effect: defs.get("BSTH08.5-X01")!.effects![1]!,
              effectIndex: 1,
              sourceInstanceId: "host",
              actingPlayerId: "alice",
              ...lookups,
            });
            if (candidates === 2) {
              expect(state.pendingZoneSelection).not.toBeNull();
              const selection = actions(state).find(
                (a) => a.kind === "resolve_pending_zone_selection"
              )!;
              state = apply(state, selection, ["mask-0"]);
            }
            expect(zone(state, "mask-0")).toBe("set_aside");
            expect(
              state.pendingSetAsideExitReplacementChoice?.cardInstanceId
            ).toBe("mask-0");
            expect(
              sanitizeStateForViewer(state, "alice")
                .pendingSetAsideExitReplacementChoice
            ).toEqual({
              choosingPlayerId: "alice",
              cardInstanceId: "mask-0",
              replacement: maskNo.endsWith("M11")
                ? { kind: "move_to", zone: "hand" }
                : { kind: "pay_cost", amount: 1 },
            });
            expect(
              state.pendingLeaveEntities.some((p) => p.instanceId === "host")
            ).toBe(true);
            state = choose(state, choice);
            if (state.pendingCoreSourceAllocation) {
              expect(maskNo).toBe("BSTH08.5-X04");
              expect(choice).toBe("replace");
              expect(
                state.pendingSetAsideExitReplacementChoice?.cardInstanceId
              ).toBe("mask-0");
              const payment = actions(state).find(
                (a) => a.kind === "resolve_core_source_allocation"
              )!;
              state = applyLegalAction({
                state,
                action: payment,
                ...lookups,
                coreSourceAllocations: { reserve: 1 },
              }).state;
            }
            state = flushPendingLeaves(state, getDef);
            expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
            expect(state.pendingZoneSelection).toBeNull();
            expect(zone(state, "mask-0")).toBe(
              choice === "decline"
                ? "removed_from_game"
                : maskNo.endsWith("M11")
                  ? "hand"
                  : "set_aside"
            );
            expect(
              state.pendingLeaveEntities.some((p) => p.instanceId === "host"),
              state.log.join("\n")
            ).toBe(false);
            expect(zone(state, "host")).toBe(
              choice === "decline" ? "field" : "trash"
            );
            if (candidates === 2)
              expect(zone(state, "mask-1")).toBe("set_aside");
          });
        });
      }
    }
  }

  for (const finalChoice of ["replace", "decline"] as const) {
    describe(`C03 実除外${finalChoice === "replace" ? "9" : "10"}枚`, () => {
      it("実本文は全選択後の実除外数で10枚以上の破壊を判定する", () => {
        let state = stateFor("BSTH08.5-M11");
        const ordinary = Array.from({ length: 9 }, (_, i) =>
          instance("BSTH01-C01", `ordinary-${i}`, "hand")
        );
        const attacker = instance("BSTH01-C01", "attacker", "field");
        const enemy = {
          ...instance("BSTH01-C01", "enemy", "field"),
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
        };
        state = {
          ...state,
          cardInstances: [
            ...state.cardInstances,
            ...ordinary,
            attacker,
            enemy,
            instance("BSAZ01-C03", "c03", "in_use"),
          ],
          players: state.players.map((p) =>
            p.id === "alice" ? { ...p, handCount: 9 } : p
          ),
          step: "attack",
          window: "declare_attack",
          activePlayerId: "alice",
          activeAttack: {
            attackId: "test:exclusion-count",
            primaryEntityId: "attacker-be",
            participantEntityIds: ["attacker-be"],
            groupMode: "single",
            target: { kind: "player", playerId: "bob" },
            blockAssignments: [
              { participantEntityId: "attacker-be", blockedByEntityIds: [] },
            ],
            symbolResolutionOrder: ["attacker-be"],
            flashBeforeBlockCompleted: true,
            flashAfterBlockCompleted: false,
            flashWindowState: null,
          },
          battleEntities: [
            {
              entityId: "attacker-be",
              memberInstanceIds: ["attacker"],
              resolvedBp: 1000,
              resolvedSymbols: ["red"],
              attackState: "attacking",
            },
          ],
        };
        state = executeEffect({
          chainId: "test:exclusion-count",
          state,
          effect: defs.get("BSAZ01-C03")!.effects![1]!,
          effectIndex: 1,
          sourceInstanceId: "c03",
          actingPlayerId: "alice",
          ...lookups,
          targetInstanceIds: [
            "mask-0",
            "mask-1",
            ...ordinary.map((c) => c.instanceId),
          ],
          targetStepId: "exclude-cards",
          targetSelectionResolved: true,
        });
        expect(zone(state, "enemy")).toBe("field");
        expect(state.pendingBattleEndDeferrals).toHaveLength(0);
        expect(state.pendingSetAsideExitReplacementChoice?.cardInstanceId).toBe(
          "mask-0"
        );
        state = choose(state, "replace");
        expect(state.pendingSetAsideExitReplacementChoice?.cardInstanceId).toBe(
          "mask-1"
        );
        expect(zone(state, "enemy")).toBe("field");
        expect(state.pendingBattleEndDeferrals).toHaveLength(0);
        state = flushPendingLeaves(choose(state, finalChoice), getDef);
        expect(
          state.cardInstances.filter((c) => c.zone === "removed_from_game")
        ).toHaveLength(finalChoice === "replace" ? 9 : 10);
        expect(zone(state, "enemy")).toBe(
          finalChoice === "replace" ? "field" : "trash"
        );
        expect(state.pendingBattleEndDeferrals).toHaveLength(1);
        expect(state.pendingSetAsideExitReplacementChoice).toBeNull();
      });
    });
  }
});
