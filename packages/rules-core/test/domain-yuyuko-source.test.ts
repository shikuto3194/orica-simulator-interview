/** 幽々子の導域は離脱対象への付与ではなく、ネクサス自身の効果。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingLeave,
  queuePendingReactionsFromTriggerEvents,
  recomputeAndRebuildContinuousEffects,
  type GameState,
} from "../src";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: lookup,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: undefined,
};
const inst = (no: string, id: string, cores: number) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: cores,
  });
function board(): GameState {
  const initial = recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          inst("BSTH04-X01", "yuyuko", 4),
          inst("BSTH04-X03", "first", 1),
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 3,
    },
    getDef
  );
  return recomputeAndRebuildContinuousEffects(
    {
      ...initial,
      cardInstances: [...initial.cardInstances, inst("BSTH04-X03", "late", 1)],
    },
    getDef
  );
}
function leave(
  state: GameState,
  suppressed: string[] = [],
  target: string | string[] = "late",
  cause: "opponent_effect" | "self_effect" = "opponent_effect"
) {
  const targets = Array.isArray(target) ? target : [target];
  const pending = targets.reduce(
    (current, instanceId) =>
      queuePendingLeave({
        state: current,
        instanceId,
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: cause === "opponent_effect" ? "bob" : "alice",
        chainId: "domain-destroy",
      }),
    state
  );
  return queuePendingReactionsFromTriggerEvents(
    pending,
    targets.map((instanceId) => ({
      actingPlayerId: "alice",
      eventKind: "destroy",
      source: "action_resolution",
      chainId: "domain-destroy",
      attackId: null,
      relatedInstanceId: instanceId,
      relatedPlayerId: "alice",
      amount: 1,
      cause,
      suppressedSourceInstanceIds: suppressed,
      preFlushLeaveEvent: true,
      suppressBurstCheck: true,
    })),
    undefined,
    options
  );
}
function choices(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "alice", ...options }).filter(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "yuyuko" &&
      !a.skipOnly
  );
}
function resolve(state: GameState, selected?: string[]): GameState {
  const action = choices(state)[0];
  expect(
    action,
    JSON.stringify({
      pending: state.pendingTriggeredEffects,
      actions: getLegalActions({ state, actingPlayerId: "alice", ...options }),
      log: state.log.slice(-8),
    })
  ).toBeDefined();
  let current = applyLegalAction({
    state,
    action: action!,
    skipOptionalEffect: false,
    ...options,
  }).state;
  for (
    let i = 0;
    i < 10 &&
    (current.stackWindow || current.pendingStepOptionalTargetSelection);
    i++
  ) {
    if (current.pendingStepOptionalTargetSelection) {
      const pending = current.pendingStepOptionalTargetSelection;
      const choice = getLegalActions({
        state: current,
        actingPlayerId: "alice",
        ...options,
      }).find(
        (a) => a.kind === "resolve_pending_step_optional_target_selection"
      );
      expect(choice).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: choice!,
        targetInstanceIds: selected ?? pending.candidateInstanceIds,
        ...options,
      }).state;
      continue;
    }
    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow!.priorityPlayerId,
      ...options,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      ...options,
    }).state;
  }
  return current;
}

describe("BSTH04-X01 幽々子の導域の発揮元", () => {
  it("同じ相手効果で同時に離れる2体を残せる", () => {
    const resolved = resolve(
      leave(board(), ["first", "late"], ["first", "late"])
    );
    for (const id of ["first", "late"]) {
      expect(
        resolved.cardInstances.find((c) => c.instanceId === id)
      ).toMatchObject({
        zone: "field",
        exhaustState: "exhausted",
        pendingLeaveKind: null,
      });
    }
  });
  it("同時に離れる2体のうち選んだ1体だけを残せる", () => {
    const resolved = resolve(
      leave(board(), ["first", "late"], ["first", "late"]),
      ["late"]
    );
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "late")
    ).toMatchObject({
      zone: "field",
      exhaustState: "exhausted",
      pendingLeaveKind: null,
    });
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "first")?.zone
    ).toBe("trash");
  });
  it.each(["first", "late"])(
    "%s は相手効果による破壊から任意で疲労状態のまま残る",
    (target) => {
      const resolved = resolve(leave(board(), [], target));
      expect(
        resolved.cardInstances.find((c) => c.instanceId === target)
      ).toMatchObject({
        zone: "field",
        exhaustState: "exhausted",
        pendingLeaveKind: null,
      });
    }
  );
  it("離脱対象の効果を発揮させない場合も幽々子の効果で残る", () => {
    const resolved = resolve(leave(board(), ["late"]));
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "late")
    ).toMatchObject({
      zone: "field",
      exhaustState: "exhausted",
      pendingLeaveKind: null,
    });
  });
  it("幽々子自身の効果が抑止される場合は発揮しない", () => {
    expect(choices(leave(board(), ["yuyuko"]))).toHaveLength(0);
  });
  it("自分の効果による離脱には発揮しない", () => {
    expect(choices(leave(board(), [], "late", "self_effect"))).toHaveLength(0);
  });
  it.each(["level", "turn", "step", "target", "source-left"])(
    "%s の条件外では発揮しない",
    (change) => {
      const base = board();
      const changed: GameState = {
        ...base,
        ...(change === "turn" ? { activePlayerId: "bob" } : {}),
        ...(change === "step" ? { step: "main" } : {}),
        cardInstances: base.cardInstances.map((c) => {
          if (c.instanceId === "yuyuko" && change === "level")
            return { ...c, normalCoreCount: 3 };
          if (c.instanceId === "yuyuko" && change === "source-left")
            return { ...c, zone: "trash" };
          if (c.instanceId === "late" && change === "target")
            return { ...c, definitionId: "BSDB01-M02" };
          return c;
        }),
      };
      expect(
        choices(leave(recomputeAndRebuildContinuousEffects(changed, getDef)))
      ).toHaveLength(0);
    }
  );
});
