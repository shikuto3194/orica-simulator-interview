import { expect } from "vitest";
import {
  applyLegalAction,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../../src";

/** The test acts as the owner, explicitly choosing a destination and normal-core sources. */
export function chooseRuleBraveCores(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  braveInstanceId: string,
  sourceAllocations: Record<string, number> = {}
): GameState {
  const pending = state.pendingCoreDistribution;
  expect(pending?.stateBasedBraveSeparation?.braveInstanceId).toBe(
    braveInstanceId
  );
  const action = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
  }).find(
    (candidate) => candidate.kind === "resolve_pending_core_distribution"
  );
  expect(action).toBeDefined();
  const total = Object.values(sourceAllocations).reduce(
    (sum, amount) => sum + amount,
    0
  );
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    coreDistributionAllocations: total ? { [braveInstanceId]: total } : {},
    coreDistributionSourceAllocations: sourceAllocations,
  }).state;
}
