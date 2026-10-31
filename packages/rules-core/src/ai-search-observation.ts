import {
  AI_OBSERVATION_SCHEMA_VERSION,
  type AiObservation,
  type AiRelativePlayer,
} from "./ai-observation";

/** Common player-mode boundary for trusted search observation components.
 * This validates the viewer/player binding, not arbitrary external JSON.
 */
export function searchPlayerResolver(observation: AiObservation) {
  if (
    observation.schemaVersion !== AI_OBSERVATION_SCHEMA_VERSION ||
    observation.mode !== "player" ||
    typeof observation.viewpointPlayerId !== "string" ||
    !Array.isArray(observation.players) ||
    observation.players.length !== 2 ||
    observation.players.some((player) => typeof player.playerId !== "string") ||
    observation.players.filter(
      (player) => player.playerId === observation.viewpointPlayerId
    ).length !== 1 ||
    new Set(observation.players.map((player) => player.playerId)).size !== 2
  )
    throw new Error("search requires a two-player player observation");
  return (id: string): AiRelativePlayer => {
    if (!observation.players.some((player) => player.playerId === id))
      throw new Error("unknown search observation player");
    return id === observation.viewpointPlayerId ? "me" : "opp";
  };
}
