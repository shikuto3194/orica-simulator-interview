import type { ExecuteEffectOptions } from "./effect-interpreter";
import type { GameState } from "../model";
import { continueDeckRevealAfterPicks } from "../legal/pending-action-handlers";

type BoundaryOptions = Pick<
  ExecuteEffectOptions,
  | "getCardDefinitionById"
  | "getRegisteredTriggeredEffectActions"
  | "getRegisteredBurstActions"
>;

/** 公開中カードを維持し、途中手順の全選択・借用を既存effect continuationで解決する。 */
export function runPendingDeckRevealBoundary(
  state: GameState,
  options: BoundaryOptions,
  execute: (options: ExecuteEffectOptions) => GameState
): GameState {
  let pending = state.pendingDeckReveal;
  if (!pending || pending.phase === "revealed_choice") return state;
  if (
    pending.phase === "picking" &&
    pending.currentPickIndex >= pending.picks.length &&
    !pending.beforePickSteps?.length
  ) {
    pending = { ...pending, phase: "ordering_remainder" };
    state = { ...state, pendingDeckReveal: pending };
  }
  const boundary =
    pending.phase === "picking" && pending.currentPickIndex === 0
      ? "beforePickSteps"
      : pending.phase === "ordering_remainder"
        ? "beforeMoveSteps"
        : undefined;
  if (!boundary || !pending[boundary]?.length) {
    return pending.phase === "ordering_remainder"
      ? continueDeckRevealAfterPicks(state, pending, options)
      : state;
  }
  const continuation = pending.continuation;
  if (!continuation)
    throw new Error("Deck reveal boundary requires an effect continuation");
  const resumePending = { ...pending };
  delete resumePending[boundary];
  const picked = pending.pickedCardInstanceIds;
  const revealed =
    pending.originalRevealedCardInstanceIds ?? pending.revealedCardInstanceIds;
  const definition = options.getCardDefinitionById(
    continuation.sourceDefinitionId
  );
  const originalEffect =
    continuation.resumeEffectOverride ??
    definition?.effects?.[continuation.effectIndex];
  const boundaryEffect: import("../dsl-types").Effect = {
    timing: originalEffect?.timing ?? { kind: "activated", mode: "main" },
    steps: [
      ...pending[boundary]!,
      { action: { kind: "resume_deck_reveal", pending: resumePending } },
    ],
  };
  return execute({
    ...options,
    chainId: continuation.chainId,
    state: { ...state, pendingDeckReveal: null },
    effect: boundaryEffect,
    promptUnresolvedChoice: true,
    optionalStepResumeEffectOverride: boundaryEffect,
    effectIndex: continuation.effectIndex,
    sourceInstanceId: continuation.sourceInstanceId,
    actingPlayerId: continuation.actingPlayerId,
    ...(continuation.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
      : {}),
    ...(continuation.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: continuation.effectSourceDefinitionId }
      : {}),
    ...(continuation.sourceCardReferenceInstanceId !== undefined
      ? {
          sourceCardReferenceInstanceId:
            continuation.sourceCardReferenceInstanceId,
        }
      : {}),
    ...(continuation.effectActionKind !== undefined
      ? { effectActionKind: continuation.effectActionKind }
      : {}),
    ...(continuation.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
      : {}),
    ...(continuation.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
      : {}),
    ...(continuation.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: continuation.costPaidThisEffect }
      : {}),
    restoredStepContext: {
      ...continuation.stepContext,
      results: {
        ...continuation.stepContext.results,
        [continuation.recordStepId]: {
          stepId: continuation.recordStepId,
          // Before selection, a scoped target references this reveal's cards.
          // After selection, the same ref denotes the selected cards.
          affectedCardInstanceIds: [
            ...(boundary === "beforePickSteps" ? revealed : picked),
          ],
          revealedCardInstanceIds: [...revealed],
          succeeded:
            boundary === "beforePickSteps"
              ? revealed.length > 0
              : picked.length > 0,
        },
      },
    },
  });
}
