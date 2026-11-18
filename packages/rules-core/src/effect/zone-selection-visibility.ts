import type { GameState, PendingZoneSelection } from "../model";
import { disclosureAudienceCanView } from "../public-disclosure";

/** 現在の発揮中に見た候補だけを、選択者向けの画像/詳細表示へ渡す。 */
export function withRevealedSelectionCards(
  state: GameState,
  pending: PendingZoneSelection,
  startSequence: number
): PendingZoneSelection {
  const candidates = new Set([
    ...pending.candidateCardInstanceIds,
    ...(pending.alternateSelections ?? []).flatMap(
      (alt) => alt.candidateInstanceIds
    ),
  ]);
  const revealed = new Map<string, string>();
  for (const disclosure of state.publicDisclosures ?? []) {
    if (disclosure.sequence <= startSequence) continue;
    // 閲覧後に移動した実体へ、以前の手札内容を再結合しない。
    for (const result of disclosure.results) {
      if (result.kind === "card_move" && result.instanceId)
        revealed.delete(result.instanceId);
    }
    if (
      disclosure.kind !== "deck_revealed" ||
      !disclosureAudienceCanView(
        disclosure.audience,
        disclosure.actorPlayerId,
        pending.actingPlayerId
      )
    )
      continue;
    for (const target of disclosure.targets) {
      if (
        target.kind === "card" &&
        target.instanceId &&
        target.definitionIdSnapshot &&
        candidates.has(target.instanceId)
      )
        revealed.set(target.instanceId, target.definitionIdSnapshot);
    }
  }
  const definitions = Object.fromEntries(
    [...revealed].filter(([id, definitionId]) =>
      state.cardInstances.some(
        (card) => card.instanceId === id && card.definitionId === definitionId
      )
    )
  );
  return Object.keys(definitions).length === 0
    ? pending
    : { ...pending, revealedCardDefinitionIds: definitions };
}
