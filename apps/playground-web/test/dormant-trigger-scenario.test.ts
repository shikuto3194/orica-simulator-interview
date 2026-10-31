import { expect, it } from "vitest";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import {
  applyLegalAction,
  getCurrentActorPlayerIds,
  getLegalActions,
  legalActionsForTraining,
} from "@orica/rules-core";
import { buildDormantTriggerActorScenario } from "../src/scenario-dormant-trigger-actor";
import { buildEngine } from "./selfplay-driver";

it.each(["alice", "bob"])(
  "%sの非ターン側の残置反応を合法手・操作権・学習が共有する",
  (owner) => {
    const state = buildDormantTriggerActorScenario(
      [...ALL_CARDS],
      new URLSearchParams({ owner })
    );
    const engine = buildEngine();
    const deps = {
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    };
    expect(state.pendingTriggeredEffects).toHaveLength(2);
    expect(
      state.pendingTriggeredEffects.filter(
        (p) => p.dormantSourceRegistrationKeys?.length
      )
    ).toHaveLength(1);
    expect(getCurrentActorPlayerIds(state).has(owner)).toBe(true);
    expect(
      getLegalActions({ state, actingPlayerId: state.activePlayerId, ...deps })
    ).toEqual([]);
    const action = getLegalActions({
      state,
      actingPlayerId: owner,
      ...deps,
    }).find((a) => a.can)!;
    expect(action.kind).toBe("resolve_pending_triggered_effect");
    const decision = legalActionsForTraining(state, engine);
    expect(decision?.actingPlayerId).toBe(owner);
    const done = applyLegalAction({
      state,
      action,
      skipOptionalEffect: true,
      ...deps,
    }).state;
    expect(done.pendingTriggeredEffects).toEqual([]);
    expect(done.pendingAfterTriggersContinuations).toEqual([]);
    expect(done.cardInstances.every((c) => c.zone === "trash")).toBe(true);
  }
);
