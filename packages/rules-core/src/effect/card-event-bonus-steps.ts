import type { EffectStep } from "../dsl-types";
import type { CardDefinition, GameState } from "../model";
import { getCardById } from "../card/card-lookup";

/** Disposition is resolved already; run its remaining text through the normal resumable DSL. */
export function queueCardEventBonusSteps(
  state: GameState,
  sourceInstanceId: string,
  steps: readonly EffectStep[],
  lookup: (id: string) => CardDefinition | undefined,
  parentChainId?: string
): GameState {
  const source = getCardById(state, sourceInstanceId);
  if (!source || steps.length === 0) return state;
  const effectIndex =
    lookup(source.definitionId)?.effects?.findIndex((effect) =>
      effect.steps.some((step) => steps.includes(step))
    ) ?? -1;
  const continuationId = `card-event-bonus:${sourceInstanceId}:${state.log.length}:${state.pendingAfterTriggersContinuations.length}`;
  const chainId = parentChainId
    ? `${parentChainId}:${continuationId}`
    : continuationId;
  return {
    ...state,
    pendingAfterTriggersContinuations: [
      ...state.pendingAfterTriggersContinuations,
      {
        continuationId,
        chainId,
        waitChainId: chainId,
        sourceInstanceId,
        sourceDefinitionId: source.definitionId,
        actingPlayerId: source.ownerPlayerId,
        effectIndex: Math.max(0, effectIndex),
        resumeStepIndex: 0,
        stepContext: { results: {} },
        resumeEffectOverride: {
          timing: { kind: "continuous" },
          steps: [...steps],
        },
      },
    ],
  };
}
