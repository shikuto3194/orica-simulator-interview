import type { EffectQueueEntry, GameState } from "../model";

export function createChainResolveEffectQueueEntry(
  chainId: string,
  stage = "main"
): EffectQueueEntry {
  return {
    kind: "resolve",
    scope: "chain",
    stage,
    chainId,
  };
}

export function createGlobalResolveEffectQueueEntry(
  stage: string
): EffectQueueEntry {
  return {
    kind: "resolve",
    scope: "global",
    stage,
    chainId: null,
  };
}

export function summarizeEffectQueueEntry(entry: EffectQueueEntry): string {
  if (entry.scope === "chain" && entry.chainId !== null) {
    return `${entry.kind}[chain:${entry.chainId}]:${entry.stage}`;
  }

  return `${entry.kind}:${entry.stage}`;
}

export function summarizeEffectQueueEntries(
  entries: readonly EffectQueueEntry[]
): string[] {
  return entries.map(summarizeEffectQueueEntry);
}

export function setEffectQueueEntries(
  state: GameState,
  entries: readonly EffectQueueEntry[]
): GameState {
  const nextEntries = [...entries];

  return {
    ...state,
    effectQueueEntries: nextEntries,
    effectQueueSummary: summarizeEffectQueueEntries(nextEntries),
  };
}
