import { getCardById } from "../card/card-lookup";
import {
  cardDeclaresUnderCardSlot,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { countEffectiveUnderCardRole } from "./under-card-role";
import { getCEsForTarget } from "../card/ce-lookup";
import { isCardCombinedWithHostAsBraveEffectSource } from "../effect/effect-source-identity";
import { getEffectiveCategory } from "./act-as-spirit";
import {
  BULLET_EDIT_ROLE_TAG,
  underCardRoleTagsEqual,
  textRoleUnderCardIdsOf,
} from "../model";
import type { CardDefinition, CardInstance, GameState } from "../model";

export {
  BULLET_EDIT_ROLE_TAG,
  LEGACY_BULLET_EDIT_ROLE_TAG,
  normalizeUnderCardRoleTag,
  underCardRoleTagsEqual,
} from "../model";

/**
 * text_role アンダーカードが「host の下にあるとき以下の効果を発揮する」を
 * 名乗るヘッダー行のマーカー一覧。星霊衣/バレットエディット双方で共有する SSOT
 * (continuous-effect-rebuild.ts の isTextRoleUnderTextEffect と
 * structured-effect-registrations.ts の requiredSourceRole 推論が同じ判定を使う)。
 */
export const TEXT_ROLE_UNDER_HEADER_MARKERS = [
  "【星霊衣】",
  "【バレットエディット】",
] as const;

/**
 * requiredSourceRole の共通識別子。星霊衣/バレットエディット ("text_role_under") に加え、
 * クォーツの host 継承発揮 ("quartz_inherited"、qa-030、mechanics/quartz-system.ts
 * isQuartzSetHeaderLine が SSOT) と、【合体中】ブレイヴ効果の host 帰属
 * ("combined_brave") も同じ discriminator フィールドを再利用する。
 */
export type TextRoleUnderSourceRole =
  | "text_role_under"
  | "quartz_inherited"
  | "combined_brave";

export function isTextRoleUnderHeaderLine(line: string): boolean {
  return (
    line.includes("スピリットの下") &&
    TEXT_ROLE_UNDER_HEADER_MARKERS.some((marker) => line.includes(marker))
  );
}

export function isTextRoleUnderTextEffect(
  definition: Pick<CardDefinition, "textLines">,
  effect: { textRef?: readonly number[] }
): boolean {
  return (
    effect.textRef?.some((lineIndex) => {
      const line = definition.textLines?.[lineIndex];
      return line !== undefined && isTextRoleUnderHeaderLine(line);
    }) ?? false
  );
}

export function textRoleUnderRequiredRoleTagForLine(
  line: string
): string | undefined {
  if (!line.includes("スピリットの下")) return undefined;
  if (line.includes("【星霊衣】")) return "星霊衣";
  if (line.includes("【バレットエディット】")) return BULLET_EDIT_ROLE_TAG;
  return undefined;
}

export function textRoleUnderRequiredRoleTagForTextLines(
  textLines: readonly string[] | undefined
): string | undefined {
  const tags = new Set<string>();
  for (const line of textLines ?? []) {
    const tag = textRoleUnderRequiredRoleTagForLine(line);
    if (tag !== undefined) tags.add(tag);
  }
  return tags.size === 1 ? [...tags][0] : undefined;
}

export const STAR_GARMENT_CANNOT_BE_UNDER_TAG = "star_garment_cannot_be_under";

export function hasStarGarmentCannotBeUnderTag(
  definition: CardDefinition
): boolean {
  return (
    (definition.keywordTags?.includes(STAR_GARMENT_CANNOT_BE_UNDER_TAG) ??
      false) ||
    (definition.backFace?.keywordTags?.includes(
      STAR_GARMENT_CANNOT_BE_UNDER_TAG
    ) ??
      false)
  );
}

export function isStarGarmentTargetEligible(
  definition: CardDefinition
): boolean {
  return (
    definition.isDoubleSided === true &&
    definition.backFace !== undefined &&
    !hasStarGarmentCannotBeUnderTag(definition)
  );
}

export function countTextRoleUnderCards(
  card: CardInstance,
  roleTag: string,
  state?: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  if (state)
    return countEffectiveUnderCardRole(
      state,
      card,
      roleTag,
      getCardDefinitionById
    );
  return card.underCards.filter(
    (entry) =>
      entry.role === "text_role" &&
      underCardRoleTagsEqual(entry.roleTag, roleTag)
  ).length;
}

export function hasOpenTextRoleUnderCardSlot(
  card: CardInstance,
  roleTag: string,
  maxCount: number,
  state?: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  return (
    countTextRoleUnderCards(card, roleTag, state, getCardDefinitionById) <
    maxCount
  );
}

/**
 * `text_role_under` provider effects are the effects whose header explicitly says
 * "スピリットの下". A soul-state host may physically keep cards under
 * "このカード/スピリット", but it is not a Spirit entity for that wording.
 *
 * If a future card explicitly says its under-card text works under a soul-state
 * card, represent that with a separate header/source role instead of widening this
 * helper.
 */
export function isTextRoleUnderActiveSpiritHost(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
}): boolean {
  if (options.hostCard.zone !== "field" || options.hostCard.faceDown) {
    return false;
  }
  if (
    options.state.players.some((player) =>
      player.soulStateInstanceIds.includes(options.hostCard.instanceId)
    )
  ) {
    return false;
  }
  return (
    getEffectiveCategory(
      options.state,
      options.hostCard,
      options.hostDefinition
    ) === "spirit"
  );
}

/**
 * host 定義の `underCardSlots`（roleTag 一致の maxCount、静的印字値）に、
 * `under_card_slot_capacity` CE（`under_card_slot_capacity_grant` 由来）による動的加算を
 * 適用した実効枠上限を返す。CE は host 自身の `modifierUnderCardSlotBonus.childRoleTag`
 * 一致 text_role アンダーカードそれぞれの自身の `underCardSlots`（同一 roleTag）maxCount を
 * 合算する（「このアルティメットの下にあるアルティメットカードすべての【アルドノアドライブ】を
 * Lvを無視で得る」BSAZ02-TX01(B) precedent）。静的宣言が無ければ CE があっても undefined
 * （枠自体を持たないカードへの加算は無意味、既存の「宣言が無ければクランプしない」既定を保つ）。
 * 裏向きアンダーカードは素性を持たないため合算対象から除外する
 * （getUnderCardSymbolBundles と同じ SSOT）。
 */
export function getEffectiveUnderCardSlotCap(
  state: GameState,
  host: CardInstance,
  hostDef: CardDefinition,
  roleTag: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number | undefined {
  const declaredCap = hostDef.underCardSlots?.find((s) =>
    underCardRoleTagsEqual(s.roleTag, roleTag)
  )?.maxCount;
  if (declaredCap === undefined) return undefined;
  let bonus = 0;
  for (const ce of getCEsForTarget(state, host.instanceId)) {
    if (ce.modifierTag !== "under_card_slot_capacity") continue;
    const bonusSource = ce.modifierUnderCardSlotBonus;
    if (
      !bonusSource ||
      !underCardRoleTagsEqual(bonusSource.hostRoleTag, roleTag)
    ) {
      continue;
    }
    for (const childId of bonusSource.childFilter
      ? host.underCards.map((entry) => entry.cardInstanceId)
      : textRoleUnderCardIdsOf(host, bonusSource.childRoleTag)) {
      const childCard = getCardById(state, childId);
      if (!childCard || childCard.faceDown) continue;
      const childDef = getCardDefinitionById(childCard.definitionId);
      if (
        bonusSource.childFilter &&
        (!childDef ||
          !matchesCardReferenceFilter(
            childCard,
            childDef,
            bonusSource.childFilter,
            {
              state,
              getCardDefinitionById,
            }
          ))
      )
        continue;
      const childCap = getCardDefinitionById(
        childCard.definitionId
      )?.underCardSlots?.find((s) =>
        underCardRoleTagsEqual(s.roleTag, roleTag)
      )?.maxCount;
      if (childCap) bonus += childCap;
    }
  }
  return declaredCap + bonus;
}

/**
 * text_role アンダーカード（役割不問）が、解決時点でも引き続き host の下に
 * アクティブに存在しているか（stack 解決 / battle-immediate 解決の両方で使う SSOT）。
 * card-effect-system.ts と battle-immediate-effect-system.ts に同一ロジックが
 * 重複していたものを集約 (P3-111 S8 バレットエディット一般化)。
 */
export function isActiveTextRoleUnderEffectSource(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  effectSourceInstanceId: string;
  effectSourceDefinitionId?: string;
}): boolean {
  if (!isTextRoleUnderActiveSpiritHost(options)) {
    return false;
  }

  const effectSourceCard = getCardById(
    options.state,
    options.effectSourceInstanceId
  );
  if (!effectSourceCard) return false;
  if (effectSourceCard.zone !== "field" || effectSourceCard.faceDown) {
    return false;
  }
  if (effectSourceCard.attachedToInstanceId !== options.hostCard.instanceId) {
    return false;
  }
  if (
    options.effectSourceDefinitionId !== undefined &&
    effectSourceCard.definitionId !== options.effectSourceDefinitionId
  ) {
    return false;
  }
  return options.hostCard.underCards.some(
    (entry) =>
      entry.role === "text_role" &&
      entry.cardInstanceId === options.effectSourceInstanceId &&
      entry.roleTag !== undefined &&
      cardDeclaresUnderCardSlot(options.hostDefinition, entry.roleTag)
  );
}

/**
 * ブレイヴの【合体中】効果が host 帰属で解決されるとき、効果本文の provider
 * ブレイヴが解決時点でも同じ host に合体中かを検査する。
 */
export function isActiveCombinedBraveEffectSource(options: {
  state: GameState;
  hostCard: CardInstance;
  effectSourceInstanceId: string;
  effectSourceDefinitionId?: string;
}): boolean {
  if (options.hostCard.zone !== "field" || options.hostCard.faceDown) {
    return false;
  }
  const effectSourceCard = getCardById(
    options.state,
    options.effectSourceInstanceId
  );
  if (!effectSourceCard) return false;
  if (effectSourceCard.zone !== "field" || effectSourceCard.faceDown) {
    return false;
  }
  if (
    !isCardCombinedWithHostAsBraveEffectSource({
      hostCard: options.hostCard,
      effectSourceCard,
    })
  ) {
    return false;
  }
  if (
    options.effectSourceDefinitionId !== undefined &&
    effectSourceCard.definitionId !== options.effectSourceDefinitionId
  ) {
    return false;
  }
  return true;
}
