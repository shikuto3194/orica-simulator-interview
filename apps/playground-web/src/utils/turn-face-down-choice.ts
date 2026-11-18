import type { PendingStepOptionalChoice } from "@orica/rules-core";

/** Inspect the resumed action, never the display label or a generated step ID. */
export function getTurnFaceDownChoice(
  pending: PendingStepOptionalChoice | null
) {
  if (!pending) return null;
  const continuation = pending.continuation;
  const action =
    continuation.resumeEffectOverride?.steps[continuation.stepIndex]?.action;
  if (
    action?.kind !== "turn_face_down" ||
    (action.resolution !== "soul_state" && action.resolution !== "separate") ||
    action.target.kind !== "ref"
  )
    return null;
  const instanceId =
    continuation.stepContext.results[action.target.stepId]
      ?.affectedCardInstanceIds[0];
  if (!instanceId) return null;
  return { instanceId, resolution: action.resolution };
}
