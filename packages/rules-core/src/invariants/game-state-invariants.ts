import { appendPositiveIntegerIssue } from "./game-state-invariant-helpers";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import { collectBattleGameStateInvariantIssues } from "./game-state-invariants-battle";
import { collectContinuousEffectInvariantIssues } from "./game-state-invariants-continuous";
import { collectBattleEntityDerivedValueIssues } from "./game-state-invariants-derived";
import { collectCoreGameStateInvariantIssues } from "./game-state-invariants-core";
import { collectEffectQueueInvariantIssues } from "./game-state-invariants-queue";
import { collectPublicDisclosureInvariantIssues } from "./game-state-invariants-public-disclosures";
import { collectStackGameStateInvariantIssues } from "./game-state-invariants-stack";
import { collectTriggeredQueueInvariantIssues } from "./game-state-invariants-triggers";
import type { CardDefinition, GameState } from "../model";

export type { GameStateInvariantIssue } from "./game-state-invariant-types";

/**
 * オプション。`getCardDefinitionById` を渡すと継続効果整合性チェック
 * (collectContinuousEffectInvariantIssues) も実行する。
 */
export interface CollectGameStateInvariantOptions {
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}

export function collectGameStateInvariantIssues(
  state: GameState,
  options?: CollectGameStateInvariantOptions
): GameStateInvariantIssue[] {
  const issues: GameStateInvariantIssue[] = [];

  appendPositiveIntegerIssue(
    issues,
    state.turnNumber,
    "turnNumber",
    "invalid_turn_number"
  );

  const { playerIds, cardById } = collectCoreGameStateInvariantIssues(
    state,
    issues
  );
  collectEffectQueueInvariantIssues(state, issues);
  collectPublicDisclosureInvariantIssues(state, issues);
  collectTriggeredQueueInvariantIssues({
    state,
    issues,
    playerIds,
    cardById,
  });
  collectStackGameStateInvariantIssues({
    state,
    issues,
    playerIds,
    cardById,
  });
  collectBattleGameStateInvariantIssues({
    state,
    issues,
    playerIds,
    cardById,
  });
  if (options?.getCardDefinitionById) {
    collectBattleEntityDerivedValueIssues({
      state,
      issues,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    collectContinuousEffectInvariantIssues({
      state,
      issues,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  return issues;
}

export function isValidGameState(
  state: GameState,
  options?: CollectGameStateInvariantOptions
): boolean {
  return collectGameStateInvariantIssues(state, options).length === 0;
}

export function assertValidGameState(
  state: GameState,
  options?: CollectGameStateInvariantOptions
): void {
  const issues = collectGameStateInvariantIssues(state, options);

  if (issues.length === 0) {
    return;
  }

  const message = issues
    .map((issue) => `${issue.code} @ ${issue.path}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid GameState:\n${message}`);
}
