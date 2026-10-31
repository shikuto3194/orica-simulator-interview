import {
  getPlayerLifeCoreCount,
  getPlayerReserveCoreCount,
} from "./core/core-system";
import type { GameState } from "./model";

export function summarizeGameState(state: GameState): string {
  const players = state.players
    .map(
      (player) =>
        `${player.id}(life=${getPlayerLifeCoreCount(
          player
        )}, deck=${player.deckCount}, hand=${player.handCount}, reserve=${getPlayerReserveCoreCount(player)})`
    )
    .join(" / ");
  const activeAttackSummary = state.activeAttack
    ? ` | attack=${state.activeAttack.attackId}:${state.activeAttack.groupMode}:${state.activeAttack.participantEntityIds.join(
        ","
      )}:target=${
        state.activeAttack.target.kind === "player"
          ? `player:${state.activeAttack.target.playerId}`
          : `entity:${state.activeAttack.target.entityId}`
      }`
    : "";
  const battleResolutionSummary = state.battleResolutionGroup
    ? ` | battleResolution=${state.battleResolutionGroup.attackId}:${state.battleResolutionGroup.participantSnapshots
        .map((snapshot) => snapshot.entityId)
        .join(",")}`
    : "";
  const triggerSummary =
    state.pendingTriggeredEffects.length > 0
      ? ` | pendingTriggers=${state.pendingTriggeredEffects.length}`
      : "";
  const burstSummary =
    state.pendingBurstChecks.length > 0
      ? ` | pendingBurstChecks=${state.pendingBurstChecks.length}`
      : "";
  const setBurstSummary =
    state.setBurstStates.length > 0
      ? ` | setBursts=${state.setBurstStates.length}`
      : "";
  const revealedBurstSummary =
    state.revealedBurstStates.length > 0
      ? ` | revealedBursts=${state.revealedBurstStates.length}`
      : "";

  return `Turn ${state.turnNumber} | active=${state.activePlayerId} | step=${state.step} | window=${state.window}${activeAttackSummary}${battleResolutionSummary}${triggerSummary}${burstSummary}${setBurstSummary}${revealedBurstSummary} | players=${players}`;
}
