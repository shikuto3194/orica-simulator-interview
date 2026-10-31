import type { AiObservation, AiRelativePlayer } from "./ai-observation";
import { AI_SEARCH_WORLD_PLAYERS } from "./ai-search-deck-instances";
import { searchPlayerResolver } from "./ai-search-observation";
import { STEP_ORDER, type GameState, type Step } from "./model";

/** Public scheduling only. Interrupted/deferred turns require a separate
 * reconstruction of their return context; never transport that live snapshot. */
export interface AiSearchTurnSchedule {
  pendingExtraTurn: {
    owner: AiRelativePlayer;
    skipSteps: readonly Step[];
  } | null;
  extraTurn: {
    owner: AiRelativePlayer;
    skipSteps: readonly Step[];
    nextPlayer: AiRelativePlayer | null;
    hasReturnContext: boolean;
    deferredStart: boolean;
  } | null;
  pendingTurnSkips: readonly AiRelativePlayer[];
}

function player(value: AiRelativePlayer): AiRelativePlayer {
  if (value !== "me" && value !== "opp")
    throw new Error("invalid observed turn schedule player");
  return value;
}

function steps(values: readonly Step[]): Step[] {
  if (!Array.isArray(values))
    throw new Error("missing observed turn skip steps");
  const result: Step[] = [];
  for (const value of values) {
    if (!STEP_ORDER.includes(value))
      throw new Error("invalid observed turn skip step");
    result.push(value);
  }
  return result;
}

function copySchedule(input: AiSearchTurnSchedule): AiSearchTurnSchedule {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.pendingTurnSkips)
  )
    throw new Error("missing observed turn schedule");
  if (input.pendingExtraTurn === undefined || input.extraTurn === undefined)
    throw new Error("missing observed extra turn schedule");
  const pendingExtraTurn =
    input.pendingExtraTurn === null
      ? null
      : {
          owner: player(input.pendingExtraTurn.owner),
          skipSteps: steps(input.pendingExtraTurn.skipSteps),
        };
  const extra = input.extraTurn;
  if (
    extra !== null &&
    (extra.hasReturnContext !== false || extra.deferredStart !== false)
  )
    throw new Error("unsupported interrupted or deferred observed extra turn");
  return {
    pendingExtraTurn,
    extraTurn:
      extra === null
        ? null
        : {
            owner: player(extra.owner),
            skipSteps: steps(extra.skipSteps),
            nextPlayer:
              extra.nextPlayer === null ? null : player(extra.nextPlayer),
            hasReturnContext: false,
            deferredStart: false,
          },
    pendingTurnSkips: Array.from(input.pendingTurnSkips, player),
  };
}

/** Observation-only boundary. Missing old observations and unsupported return
 * contexts fail closed instead of silently becoming ordinary alternating turns. */
export function projectAiSearchTurnSchedule(
  observation: AiObservation
): AiSearchTurnSchedule {
  const relative = searchPlayerResolver(observation);
  if (
    relative(observation.global.activePlayerId) !==
    observation.global.activePlayer
  )
    throw new Error("inconsistent observed active player");
  if (!observation.global.turnSchedule)
    throw new Error("missing observed turn schedule");
  const schedule = copySchedule(observation.global.turnSchedule);
  if (
    schedule.extraTurn &&
    schedule.extraTurn.owner !== observation.global.activePlayer
  )
    throw new Error("inconsistent observed extra turn owner");
  return schedule;
}

/** Fresh engine fields with synthetic seats only, no live state/IDs/return data. */
export function materializeAiSearchTurnSchedule(
  input: AiSearchTurnSchedule
): Pick<GameState, "pendingExtraTurn" | "extraTurnState" | "pendingTurnSkips"> {
  const schedule = copySchedule(input);
  const extra = schedule.extraTurn;
  return {
    pendingExtraTurn:
      schedule.pendingExtraTurn === null
        ? null
        : {
            ownerPlayerId:
              AI_SEARCH_WORLD_PLAYERS[schedule.pendingExtraTurn.owner],
            skipSteps: [...schedule.pendingExtraTurn.skipSteps],
          },
    extraTurnState:
      extra === null
        ? null
        : {
            ownerPlayerId: AI_SEARCH_WORLD_PLAYERS[extra.owner],
            skipSteps: [...extra.skipSteps],
            ...(extra.nextPlayer === null
              ? {}
              : { nextPlayerId: AI_SEARCH_WORLD_PLAYERS[extra.nextPlayer] }),
            returnContext: null,
          },
    pendingTurnSkips: schedule.pendingTurnSkips.map(
      (owner) => AI_SEARCH_WORLD_PLAYERS[owner]
    ),
  };
}
