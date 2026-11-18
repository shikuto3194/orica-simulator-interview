import type { GameStateInvariantIssue } from "./game-state-invariant-types";

export function appendNonNegativeIntegerIssue(
  issues: GameStateInvariantIssue[],
  value: number,
  path: string,
  code: string
): void {
  if (!Number.isInteger(value) || value < 0) {
    issues.push({
      code,
      path,
      message: `Expected a non-negative integer but received ${value}`,
    });
  }
}

export function appendPositiveIntegerIssue(
  issues: GameStateInvariantIssue[],
  value: number,
  path: string,
  code: string
): void {
  if (!Number.isInteger(value) || value <= 0) {
    issues.push({
      code,
      path,
      message: `Expected a positive integer but received ${value}`,
    });
  }
}

export function appendDuplicateIssue(
  issues: GameStateInvariantIssue[],
  path: string,
  code: string,
  value: string
): void {
  issues.push({
    code,
    path,
    message: `Duplicate value detected: ${value}`,
  });
}

export function appendMissingReferenceIssue(
  issues: GameStateInvariantIssue[],
  path: string,
  code: string,
  value: string
): void {
  issues.push({
    code,
    path,
    message: `Missing referenced id: ${value}`,
  });
}
