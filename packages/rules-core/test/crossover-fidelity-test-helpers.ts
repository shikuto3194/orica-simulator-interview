import { applyLegalAction, getLegalActions } from "../src";
import type {
  ApplyLegalActionOptions,
  CardDefinition,
  GameState,
} from "../src";

/** Exercise the real optional-step continuation when a regression chooses to perform every optional sentence. */
export function acceptOptionalSteps(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  extra: Partial<ApplyLegalActionOptions> = {}
): GameState {
  for (
    let limit = 0;
    (state.pendingStepOptionalChoice ||
      state.pendingStepOptionalTargetSelection) &&
    limit < 20;
    limit++
  ) {
    const targetPending = state.pendingStepOptionalTargetSelection;
    if (targetPending) {
      const action = getLegalActions({
        state,
        actingPlayerId: targetPending.choosingPlayerId,
        getCardDefinitionById,
      }).find(
        (a) => a.kind === "resolve_pending_step_optional_target_selection"
      )!;
      const chosen = extra.targetInstanceIds?.filter((id) =>
        targetPending.candidateInstanceIds.includes(id)
      );
      state = applyLegalAction({
        ...extra,
        state,
        action,
        getCardDefinitionById,
        targetInstanceIds: chosen?.length
          ? chosen
          : targetPending.candidateInstanceIds.slice(
              0,
              targetPending.maxTargetCount
            ),
      }).state;
      continue;
    }
    const pending = state.pendingStepOptionalChoice;
    if (!pending) break;
    state = applyLegalAction({
      ...extra,
      state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: pending.canExecute === false ? "decline" : "execute",
        pendingId: pending.pendingId,
        actingPlayerId: pending.choosingPlayerId,
      },
      getCardDefinitionById,
    }).state;
  }
  return state;
}
