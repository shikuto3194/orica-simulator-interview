import type { AiObservation, AiRelativePlayer } from "./ai-observation";
import { AI_SEARCH_WORLD_PLAYERS } from "./ai-search-deck-instances";
import { searchPlayerResolver } from "./ai-search-observation";
import { STEP_ORDER, type GameState } from "./model";
import { AI_OBSERVATION_ENCODER_WINDOW_DOMAIN } from "./ai-observation-encoder";

/** Public clocks and seat order only. Step/window, interrupted-turn return
 * contexts, pending/stack and usage still need their own reconstruction.
 * A clock component is not a complete resumable world or a search request. */
export interface AiSearchTurnClock {
  turnNumber: number;
  turnNumberHighWaterMark: number;
  stepSequence: number;
  activePlayer: AiRelativePlayer;
  playerOrder: readonly AiRelativePlayer[];
}

function copyClock(input: AiSearchTurnClock): AiSearchTurnClock {
  if (!input || typeof input !== "object")
    throw new Error("missing observed turn clock");
  const { turnNumber, turnNumberHighWaterMark, stepSequence, activePlayer } =
    input;
  if (
    !Number.isSafeInteger(turnNumber) ||
    turnNumber < 1 ||
    !Number.isSafeInteger(turnNumberHighWaterMark) ||
    turnNumberHighWaterMark < turnNumber ||
    !Number.isSafeInteger(stepSequence) ||
    stepSequence < 0 ||
    (activePlayer !== "me" && activePlayer !== "opp") ||
    !Array.isArray(input.playerOrder) ||
    input.playerOrder.length !== 2 ||
    !input.playerOrder.includes("me") ||
    !input.playerOrder.includes("opp")
  )
    throw new Error("invalid observed turn clock or seat order");
  return {
    turnNumber,
    turnNumberHighWaterMark,
    stepSequence,
    activePlayer,
    playerOrder: [...input.playerOrder],
  };
}

/** Accept the current player observation, never a live GameState. Do not infer
 * seats from the observation's players array or high-water from turnNumber:
 * a restored interrupted turn may have a lower number than an issued turn. */
export function projectAiSearchTurnClock(
  observation: AiObservation
): AiSearchTurnClock {
  const relative = searchPlayerResolver(observation);
  const global = observation.global;
  if (!global.turnClock) throw new Error("missing observed turn clock");
  if (relative(global.activePlayerId) !== global.activePlayer)
    throw new Error("inconsistent observed active player");
  return copyClock({
    turnNumber: global.turnNumber,
    turnNumberHighWaterMark: global.turnClock.turnNumberHighWaterMark,
    stepSequence: global.turnClock.stepSequence,
    activePlayer: global.activePlayer,
    playerOrder: global.turnClock.playerOrder,
  });
}

/** Explicit fresh overrides for the common game factory, with only synthetic
 * player IDs. No hidden instances, source state, clock/RNG or DB are accepted. */
export function materializeAiSearchTurnClock(
  input: AiSearchTurnClock
): Pick<
  GameState,
  | "turnNumber"
  | "turnNumberHighWaterMark"
  | "stepSequence"
  | "activePlayerId"
  | "playerOrder"
> {
  const clock = copyClock(input);
  return {
    turnNumber: clock.turnNumber,
    turnNumberHighWaterMark: clock.turnNumberHighWaterMark,
    stepSequence: clock.stepSequence,
    activePlayerId: AI_SEARCH_WORLD_PLAYERS[clock.activePlayer],
    playerOrder: clock.playerOrder.map(
      (owner) => AI_SEARCH_WORLD_PLAYERS[owner]
    ),
  };
}

/** Public position component. A window tag does not reconstruct its pending,
 * stack, battle or interrupted-turn context. A complete world builder must
 * supply those separately before resuming an arbitrary position. */
export interface AiSearchTurnPosition extends AiSearchTurnClock {
  step: GameState["step"];
  window: GameState["window"];
}

function copyPosition(input: AiSearchTurnPosition): AiSearchTurnPosition {
  const clock = copyClock(input);
  if (
    !STEP_ORDER.includes(input.step) ||
    !AI_OBSERVATION_ENCODER_WINDOW_DOMAIN.includes(input.window)
  )
    throw new Error("invalid observed turn position");
  return { ...clock, step: input.step, window: input.window };
}

/** Project the already visible clock and position only. Never infer the step
 * from resource counts, nor replace an unfinished window with `none`. */
export function projectAiSearchTurnPosition(
  observation: AiObservation
): AiSearchTurnPosition {
  return copyPosition({
    ...projectAiSearchTurnClock(observation),
    step: observation.global.step,
    window: observation.global.window,
  });
}

/** Fresh scalar overrides. In particular, a factory's default start step must
 * not replay core gain, draw or refresh that the observation already includes.
 * No live GameState, hidden identity or window payload is accepted/copied. */
export function materializeAiSearchTurnPosition(
  input: AiSearchTurnPosition
): ReturnType<typeof materializeAiSearchTurnClock> &
  Pick<GameState, "step" | "window"> {
  const position = copyPosition(input);
  return {
    ...materializeAiSearchTurnClock(position),
    step: position.step,
    window: position.window,
  };
}
