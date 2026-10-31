import type { AiObservation } from "./ai-observation";
import { searchPlayerResolver } from "./ai-search-observation";
import { STEP_ORDER, type GameState, type Step } from "./model";

/** Public insertion/return queues for the current turn. This component does
 * not reconstruct extra-turn skip rules, pending effects or window payloads. */
export interface AiSearchStepProgression {
  pendingExtraSteps: readonly Step[];
  stepContinuation: readonly Step[];
}

function copySteps(input: readonly Step[]): Step[] {
  if (!Array.isArray(input)) throw new Error("missing observed step queue");
  const result: Step[] = [];
  for (const step of input) {
    if (!STEP_ORDER.includes(step))
      throw new Error("invalid observed step queue");
    result.push(step);
  }
  return result;
}

function copyProgression(input: AiSearchStepProgression): {
  pendingExtraSteps: Step[];
  stepContinuation: Step[];
} {
  if (!input || typeof input !== "object")
    throw new Error("missing observed step progression");
  // Preserve order and repeated return steps. Never sort/deduplicate a
  // continuation or infer it from the current step/clock/resource counts.
  return {
    pendingExtraSteps: copySteps(input.pendingExtraSteps),
    stepContinuation: copySteps(input.stepContinuation),
  };
}

/** Accept a player observation, never live GameState or its nested snapshots. */
export function projectAiSearchStepProgression(
  observation: AiObservation
): AiSearchStepProgression {
  searchPlayerResolver(observation);
  if (!observation.global.stepProgression)
    throw new Error("missing observed step progression");
  return copyProgression(observation.global.stepProgression);
}

/** Fresh queues for the common game factory. No live ID/state is transported. */
export function materializeAiSearchStepProgression(
  input: AiSearchStepProgression
): Pick<GameState, "pendingExtraSteps" | "stepContinuation"> {
  return copyProgression(input);
}
