import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type { GameState } from "../model";

/** 公開情報の採番と viewer filter 前提を壊さないための最小不変条件。 */
export function collectPublicDisclosureInvariantIssues(
  state: GameState,
  issues: GameStateInvariantIssue[]
): void {
  const entries = state.publicDisclosures ?? [];
  let previousSequence = 0;
  const ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (
      !Number.isInteger(entry.sequence) ||
      entry.sequence <= previousSequence
    ) {
      issues.push({
        code: "public_disclosure_sequence_not_monotonic",
        path: `publicDisclosures[${index}].sequence`,
        message:
          "Public disclosure sequence must be a strictly increasing positive integer",
      });
    }
    previousSequence = Math.max(previousSequence, entry.sequence);
    if (ids.has(entry.id)) {
      issues.push({
        code: "public_disclosure_duplicate_id",
        path: `publicDisclosures[${index}].id`,
        message: "Public disclosure ids must be unique",
      });
    }
    ids.add(entry.id);
    for (const result of entry.results) {
      if (
        result.kind === "hidden_card_move" &&
        result.instanceId !== undefined
      ) {
        issues.push({
          code: "hidden_public_disclosure_exposes_instance",
          path: `publicDisclosures[${index}].results`,
          message: "Hidden card moves must not expose an instanceId",
        });
      }
    }
  }
}
