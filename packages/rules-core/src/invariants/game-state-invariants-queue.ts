import { summarizeEffectQueueEntries } from "../effect/effect-queue";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type { GameState } from "../model";

export function collectEffectQueueInvariantIssues(
  state: GameState,
  issues: GameStateInvariantIssue[]
): void {
  for (const [index, entry] of state.effectQueueEntries.entries()) {
    if (entry.scope === "chain" && entry.chainId === null) {
      issues.push({
        code: "chain_effect_queue_entry_missing_chain_id",
        path: `effectQueueEntries[${index}].chainId`,
        message: "Chain-scoped effect queue entries must have a chainId",
      });
    }

    if (entry.scope === "global" && entry.chainId !== null) {
      issues.push({
        code: "global_effect_queue_entry_has_chain_id",
        path: `effectQueueEntries[${index}].chainId`,
        message: "Global effect queue entries must not have a chainId",
      });
    }
  }

  const expectedSummary = summarizeEffectQueueEntries(state.effectQueueEntries);

  if (
    expectedSummary.length !== state.effectQueueSummary.length ||
    expectedSummary.some(
      (entry, index) => entry !== state.effectQueueSummary[index]
    )
  ) {
    issues.push({
      code: "effect_queue_summary_mismatch",
      path: "effectQueueSummary",
      message:
        "effectQueueSummary does not match the structured effectQueueEntries",
    });
  }
}
