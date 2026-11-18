import type { CardFilter } from "../dsl-types";
import type { CardDefinition, EffectTiming, GameState } from "../model";
import { getCEsForTarget } from "../card/ce-lookup";
import { matchesCardReferenceFilter } from "../card/card-filter";
import {
  getAffectSourceCategories,
  resolveAffectSourceIdentity,
} from "./effect-source-identity";

/**
 * `grant_optional_deck_reveal_count_boost` CE (BSLH01-X09【クォーツ：練刃】) のうち、
 * actingPlayerId が保持し、かつ deck_reveal 実行元カード (`sourceInstanceId`) が
 * `metadata.sourceFilter` にマッチするものを検索し、加算可能な bonusAmount を返す。
 * 該当が無ければ undefined（通常実行、pending は立てない）。
 *
 * category は効果帰属の共通 helper で判定する。Q378 のスピリット状態ブレイヴは
 * 非召喚時には spirit/brave、召喚時には brave のみになる。
 *
 * 正源: needs-dsl.audit ENGINE-optional-deck-reveal-count-boost Step2。
 */
export function findApplicableDeckRevealCountBoostBonus(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  context?: {
    effectTiming?: EffectTiming | undefined;
    effectSourceInstanceId?: string | undefined;
    effectSourceDefinitionId?: string | undefined;
  }
): number | undefined {
  const identity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    getCardDefinitionById,
    ...context,
  });
  const sourceCard = identity.instance;
  if (!sourceCard) return undefined;
  const sourceDef = identity.definition;
  if (!sourceDef) return undefined;
  const effectiveCategories = getAffectSourceCategories(
    state,
    sourceCard,
    sourceDef,
    getCardDefinitionById,
    context?.effectTiming
  );
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
        state,
        getCardDefinitionById,
        effectiveCategories,
      })
    ) {
      continue;
    }
    return (ce.metadata.bonusAmount as number | undefined) ?? 1;
  }
  return undefined;
}
