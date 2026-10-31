import type { CardFilter } from "../dsl-types";
import type { CardDefinition, GameState } from "../model";
import { getCEsForTarget } from "../card/ce-lookup";
import { getCardById } from "../card/card-lookup";
import { matchesCardReferenceFilter } from "../card/card-filter";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";

/**
 * `grant_optional_deck_reveal_count_boost` CE (BSLH01-X09【クォーツ：練刃】) のうち、
 * actingPlayerId が保持し、かつ deck_reveal 実行元カード (`sourceInstanceId`) が
 * `metadata.sourceFilter` にマッチするものを検索し、加算可能な bonusAmount を返す。
 * 該当が無ければ undefined（通常実行、pending は立てない）。
 *
 * category 判定は印字 (printedCategory) ではなく `getEffectiveCategory` 経由の実効値で行う
 * (act_as_spirit 分身がスピリット扱いされるケースを取りこぼさないため、
 * redirect-effect-target.ts の sourceFilter 判定と同型の SSOT)。
 *
 * 正源: needs-dsl.audit ENGINE-optional-deck-reveal-count-boost Step2。
 */
export function findApplicableDeckRevealCountBoostBonus(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number | undefined {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return undefined;
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef) return undefined;
  const effectiveCategory = getEffectiveCategory(state, sourceCard, sourceDef);
  for (const ce of getCEsForTarget(state, actingPlayerId)) {
    if (
      ce.modifierTag !== "grant_optional_deck_reveal_count_boost" ||
      !ce.metadata
    ) {
      continue;
    }
    const filter = ce.metadata.sourceFilter as CardFilter | undefined;
    if (
      !filter ||
      !matchesCardReferenceFilter(sourceCard, sourceDef, filter, {
        effectiveCategory,
      })
    ) {
      continue;
    }
    return (ce.metadata.bonusAmount as number | undefined) ?? 1;
  }
  return undefined;
}
