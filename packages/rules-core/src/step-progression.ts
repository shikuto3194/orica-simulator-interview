import { STEP_ORDER, type GameState, type Step } from "./model";

export function getNextStep(currentStep: Step): Step {
  return (
    STEP_ORDER[(STEP_ORDER.indexOf(currentStep) + 1) % STEP_ORDER.length] ??
    "start"
  );
}

/** 終了時の選択・誘発がすべて終わった後にだけ呼ぶ。予約は実際の遷移と同時に消費する。 */
export function takeNextStep(state: GameState): {
  state: GameState;
  step: Step;
} {
  const continuation = [...(state.stepContinuation ?? [])];
  let next = continuation.shift() ?? getNextStep(state.step);
  if ((state.pendingExtraSteps?.length ?? 0) > 0) {
    continuation.unshift(...state.pendingExtraSteps!.slice(1), next);
    next = state.pendingExtraSteps![0]!;
  }
  // 「行えない」ステップは追加されたものも含めて飛ばす。
  const forbidden = state.extraTurnState?.deferredStart
    ? []
    : (state.extraTurnState?.skipSteps ?? []);
  const firstTurn =
    state.turnNumber === 1 && state.activePlayerId === state.playerOrder[0];
  while (
    next !== "end" &&
    (forbidden.includes(next) ||
      (firstTurn && (next === "core" || next === "attack")))
  ) {
    state.log.push(
      `step:${forbidden.includes(next) ? "extra-turn-skip" : "skip"}:${state.turnNumber}:${state.activePlayerId}:${next}`
    );
    next = continuation.shift() ?? getNextStep(next);
  }
  return {
    state: { ...state, pendingExtraSteps: [], stepContinuation: continuation },
    step: next,
  };
}
