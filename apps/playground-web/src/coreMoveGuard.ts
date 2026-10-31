/**
 * 手動コア移動（メインステップの core-move モード）の GUI ドロップ可否ガード。
 *
 * 独立コア管理カード（創界神 / 導界者 / 創界石）は「対象にした効果」でしか
 * コアを置けず・引き抜けないため、手動コア移動の source / destination にできない。
 * tokenIndependentCoreManagement の「出すとき以外で置けず」は destination のみ禁止し、
 * source は `moveNormalCores` の forced-void redirect で扱う。
 * REST 側は `findManualCoreMoveViolation`（core-draft.ts）が commit 前に 400 で拒否
 * 済みだが、GUI 側はタップ可能なまま 400 トースト止まりだった（P3-90）。
 *
 * 本モジュールはフィールド上の source / destination 禁止 instanceId 集合を返す純関数を
 * 提供し、BattleScreen / FieldArea が core-move モードの `.ac-selectable` 付与と
 * タップハンドラの双方から該当集合を除外する。判定は rules-core の
 * `getManualCoreMoveCardBlockReason` に委譲し、魂状態・カード状態を含め
 * preview / REST 側と同じ拒否条件を共有する。
 *
 * 仕様正源: `issues/P3-90_manual-core-move-independent-core-cards.md`、
 * ルール `10_rules/08d_grandwalker-nexus.md`。
 */
import {
  getManualCoreMoveCardBlockReason,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export interface ManualCoreMoveBlockedLocationIds {
  sourceBlockedIds: Set<string>;
  destinationBlockedIds: Set<string>;
}

/**
 * フィールド上にある独立コア管理カード（創界神 / 導界者 / 創界石）の instanceId 集合を返す。
 *
 * 手動コア移動でタップ対象になるのはフィールドのカードと `reserve` のみで、`reserve` は
 * カードではないため対象外。カード状態・独立コア管理の共通ガードに委譲する。
 */
export function computeIndependentCoreLocationIds(
  state: GameState,
  getDefinition: (definitionId: string) => CardDefinition | undefined
): Set<string> {
  return computeManualCoreMoveBlockedLocationIds(state, getDefinition)
    .sourceBlockedIds;
}

export function computeManualCoreMoveBlockedLocationIds(
  state: GameState,
  getDefinition: (definitionId: string) => CardDefinition | undefined
): ManualCoreMoveBlockedLocationIds {
  const sourceBlockedIds = new Set<string>();
  const destinationBlockedIds = new Set<string>();

  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (
      getManualCoreMoveCardBlockReason(
        state,
        card.instanceId,
        "from",
        getDefinition
      )
    ) {
      sourceBlockedIds.add(card.instanceId);
    }
    if (
      getManualCoreMoveCardBlockReason(
        state,
        card.instanceId,
        "to",
        getDefinition
      )
    ) {
      destinationBlockedIds.add(card.instanceId);
    }
  }

  return { sourceBlockedIds, destinationBlockedIds };
}

export function computeManualCoreMoveDestinationBlockedIds(
  state: GameState,
  getDefinition: (definitionId: string) => CardDefinition | undefined
): Set<string> {
  return computeManualCoreMoveBlockedLocationIds(state, getDefinition)
    .destinationBlockedIds;
}
