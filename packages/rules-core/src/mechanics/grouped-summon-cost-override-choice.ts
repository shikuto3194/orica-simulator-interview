/**
 * 複数対象召喚の『トラッシュ○枚まで除外することで、除外N枚につき召喚対象1体のコストを
 * 0(overrideCost)にする』グループ化コストオーバーライド選択 (BSTH02.7-C06 branch2)。
 *
 * `summon-cost-exclude-choice.ts`（自己召喚・線形割引専用）と姉妹の pending 型だが、
 * 対象が発動元カード自身ではなく複数の異なる召喚対象になるため別 pending として扱う
 * (model.ts §PendingGroupedSummonCostOverrideChoice のコメント参照)。
 */
import { matchesCardFilter } from "../card/card-filter";
import { moveCardZone } from "../core/core-system";
import type { CardFilter } from "../dsl-types";
import { getEffectiveColors } from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  GameState,
  PendingGroupedSummonCostOverrideChoice,
} from "../model";
import { getCardsByZone } from "../zone/zone-partition";

/** 除外候補（フィルタ適用済みの自分のトラッシュ instanceId）を列挙する。 */
export function getGroupedSummonCostOverrideCandidateIds(
  state: GameState,
  actingPlayerId: string,
  sourceZone: "trash",
  filter: CardFilter | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): string[] {
  return getCardsByZone(state, sourceZone)
    .filter((card) => card.ownerPlayerId === actingPlayerId)
    .filter((card) => {
      if (!filter) return true;
      const def = getCardDefinitionById(card.definitionId);
      if (!def) return false;
      return matchesCardFilter(card, def, filter, {
        effectiveColors: getEffectiveColors(state, card, def),
      });
    })
    .map((card) => card.instanceId);
}

export interface GroupedSummonCostOverrideResolution {
  state: GameState;
  /** instanceId → 上書き後コスト (overrideCost)。対象外の召喚対象は含まない。 */
  perCardOverrideCost: Record<string, number>;
}

/**
 * pendingGroupedSummonCostOverrideChoice を解決する: 選択されたカードをトラッシュから
 * removed_from_game へ移動し、floor(選択枚数/groupSize) 体分（summonTargetInstanceIds の
 * 先頭から、上限は対象数）の perCardOverrideCost を返す。
 */
export function resolveGroupedSummonCostOverrideSelection(
  state: GameState,
  pending: PendingGroupedSummonCostOverrideChoice,
  selectedCardInstanceIds: readonly string[]
): GroupedSummonCostOverrideResolution {
  const uniqueSelected = Array.from(new Set(selectedCardInstanceIds));
  if (uniqueSelected.length !== selectedCardInstanceIds.length) {
    throw new Error("Grouped summon cost override: duplicate card selection");
  }
  if (uniqueSelected.length > pending.maxCount) {
    throw new Error(
      `Grouped summon cost override: selected ${uniqueSelected.length} exceeds maxCount ${pending.maxCount}`
    );
  }
  const candidateSet = new Set(pending.candidateCardInstanceIds);
  const invalidId = uniqueSelected.find((id) => !candidateSet.has(id));
  if (invalidId !== undefined) {
    throw new Error(
      `Grouped summon cost override: selected card is not a candidate: ${invalidId}`
    );
  }

  let currentState = state;
  for (const id of uniqueSelected) {
    currentState = moveCardZone(currentState, id, "removed_from_game");
  }

  if (uniqueSelected.length > 0) {
    currentState = {
      ...currentState,
      log: [
        ...currentState.log,
        `grouped-summon-cost-override:${pending.pendingId}:${uniqueSelected.length}`,
      ],
    };
  }

  const numOverrides = Math.min(
    Math.floor(uniqueSelected.length / pending.groupSize),
    pending.summonTargetInstanceIds.length
  );
  const perCardOverrideCost: Record<string, number> = {};
  for (let i = 0; i < numOverrides; i++) {
    perCardOverrideCost[pending.summonTargetInstanceIds[i]!] =
      pending.overrideCost;
  }

  return { state: currentState, perCardOverrideCost };
}
