import type { GameState, LegalAction } from "@orica/rules-core";

/** 現在公開/閲覧中の実体だけを表示する。履歴やrollbackから内容を復元しない。 */
export function visibleRevealedCardIds(state: GameState): string[] {
  return state.cardInstances
    .filter(
      (card) =>
        card.zone === "revealed" && card.definitionId !== "_hidden_card_"
    )
    .map((card) => card.instanceId);
}

/** 公開確定の印だけを履歴から得る。カード内容は現在のviewer用live状態から得る。 */
export function confirmedRevealedTargetIds(state: GameState): string[] {
  const visible = visibleRevealedCardIds(state);
  const visibleSet = new Set(visible);
  const disclosures = state.publicDisclosures ?? [];
  const latestSequence = disclosures.at(-1)?.sequence ?? 0;
  const records = disclosures.filter(
    (entry) =>
      Number.isSafeInteger(entry.sequence) &&
      entry.sequence > 0 &&
      entry.sequence <= latestSequence &&
      entry.turnNumber <= state.turnNumber
  );
  const latestOpen = new Map<string, number>();
  for (const entry of records) {
    if (entry.kind !== "deck_revealed") continue;
    for (const target of entry.targets) {
      if (
        target.kind === "card" &&
        target.instanceId &&
        visibleSet.has(target.instanceId)
      ) {
        latestOpen.set(
          target.instanceId,
          Math.max(latestOpen.get(target.instanceId) ?? 0, entry.sequence)
        );
      }
    }
  }
  const confirmed = new Set<string>();
  for (const entry of records) {
    if (entry.kind !== "target_declared") continue;
    for (const target of entry.targets) {
      const openedAt = target.instanceId
        ? latestOpen.get(target.instanceId)
        : undefined;
      if (
        target.kind === "card" &&
        target.instanceId &&
        openedAt !== undefined &&
        entry.sequence > openedAt
      ) {
        confirmed.add(target.instanceId);
      }
    }
  }
  return visible.filter((id) => confirmed.has(id));
}

/** 候補が全てオープン中なら、対象外も含む同じ持ち主の公開カードを既存modalへ。 */
export function revealedTargetCardIds(
  state: GameState,
  action: LegalAction | null
): string[] | null {
  if (!action || !("candidateTargetInstanceIds" in action)) return null;
  return revealedCandidateCardIds(state, action.candidateTargetInstanceIds);
}

export function revealedCandidateCardIds(
  state: GameState,
  candidates: readonly string[]
): string[] | null {
  if (candidates.length === 0) return null;
  const visibleIds = new Set(visibleRevealedCardIds(state));
  if (!candidates.every((id) => visibleIds.has(id))) return null;
  const owners = new Set(
    state.cardInstances
      .filter((card) => candidates.includes(card.instanceId))
      .map((card) => card.ownerPlayerId)
  );
  return state.cardInstances
    .filter(
      (card) =>
        visibleIds.has(card.instanceId) && owners.has(card.ownerPlayerId)
    )
    .map((card) => card.instanceId);
}
