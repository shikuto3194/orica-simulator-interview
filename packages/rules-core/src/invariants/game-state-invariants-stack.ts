import { appendMissingReferenceIssue } from "./game-state-invariant-helpers";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type { ActiveStack, CardInstance, GameState } from "../model";

export function collectStackGameStateInvariantIssues(options: {
  state: GameState;
  issues: GameStateInvariantIssue[];
  playerIds: Set<string>;
  cardById: Map<string, CardInstance>;
}): void {
  const { state, issues, playerIds, cardById } = options;
  const stackWindow = state.stackWindow;

  if (stackWindow === null) {
    if (state.window === "stack") {
      issues.push({
        code: "stack_window_without_state",
        path: "window",
        message: "window=stack requires state.stackWindow to be present",
      });
    }

    return;
  }

  if (state.window !== "stack") {
    issues.push({
      code: "stack_window_state_window_mismatch",
      path: "stackWindow",
      message: "state.stackWindow must match the current stack window",
    });
  }

  if (!playerIds.has(stackWindow.actingPlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "stackWindow.actingPlayerId",
      "missing_stack_acting_player",
      stackWindow.actingPlayerId
    );
  }

  if (!playerIds.has(stackWindow.priorityPlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "stackWindow.priorityPlayerId",
      "missing_stack_priority_player",
      stackWindow.priorityPlayerId
    );
  }

  if (!playerIds.has(stackWindow.stackResponseSourcePlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "stackWindow.stackResponseSourcePlayerId",
      "missing_stack_response_source_player",
      stackWindow.stackResponseSourcePlayerId
    );
  }

  // 1-pass cascade rule (2026-03-31): stack window は片方がパスした時点で
  // 即クローズするため consecutivePassCount は常に 0。
  if (stackWindow.consecutivePassCount !== 0) {
    issues.push({
      code: "stack_window_pass_count_out_of_range",
      path: "stackWindow.consecutivePassCount",
      message:
        "stackWindow.consecutivePassCount must always be 0 under 1-pass close model",
    });
  }

  collectPendingStackChainIssues({
    pendingStack: stackWindow.pendingStackAction,
    basePath: "stackWindow.pendingStackAction",
    issues,
    playerIds,
    cardById,
  });
}

function collectPendingStackChainIssues(options: {
  pendingStack: ActiveStack | null | undefined;
  basePath: string;
  issues: GameStateInvariantIssue[];
  playerIds: Set<string>;
  cardById: Map<string, CardInstance>;
}): void {
  const seenStackIds = new Set<string>();
  let current = options.pendingStack;
  let currentPath = options.basePath;

  while (current != null) {
    if (seenStackIds.has(current.stackId)) {
      options.issues.push({
        code: "pending_stack_cycle_detected",
        path: `${currentPath}.stackId`,
        message: `Pending stack chain must not contain cycles: ${current.stackId}`,
      });
      return;
    }

    seenStackIds.add(current.stackId);

    if (!options.playerIds.has(current.actingPlayerId)) {
      appendMissingReferenceIssue(
        options.issues,
        `${currentPath}.actingPlayerId`,
        "missing_player_reference",
        current.actingPlayerId
      );
    }

    if (
      current.previousResponseSourcePlayerId !== null &&
      !options.playerIds.has(current.previousResponseSourcePlayerId)
    ) {
      appendMissingReferenceIssue(
        options.issues,
        `${currentPath}.previousResponseSourcePlayerId`,
        "missing_player_reference",
        current.previousResponseSourcePlayerId
      );
    }

    if (!options.cardById.has(current.cardInstanceId)) {
      appendMissingReferenceIssue(
        options.issues,
        `${currentPath}.cardInstanceId`,
        "missing_card_reference",
        current.cardInstanceId
      );
    }

    currentPath = `${currentPath}.previousPendingStackAction`;
    current = current.previousPendingStackAction;
  }
}
