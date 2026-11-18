/**
 * P3-47 F-5: コア移動可否判定 helper。
 *
 * `core_distribute` (mode="player_choice", from="any_movable_self") の
 * 「自分の通常移動可能な全ゾーン」展開時に、フィールド上の各カードがソースとして
 * 採用可能かどうかを判定する。
 *
 * ユーザー裁定 (2026-05-05):
 * > 「自分のコア1個以上をそれらのカードに置く」は、通常移動可能なすべての自分の
 * > ゾーンのコアを好きな数”それら”に置くという意味。つまり、フィールド / リザーブ /
 * > トラッシュ / ライフまで含む（創界神 / 導界者 / 創界石ネクサス、ボイド、カウント、
 * > その他コア移動不可なカードを除く）。
 *
 * 除外対象:
 * - 創界神 / 導界者 / 創界石ネクサス: `hasIndependentCoreManagement()` で検出。
 * - 「コア移動不可」キーワード: 現状未実装。該当カード登場時に拡張する。
 * - 裏向きカード: 自分の裏向きカード自体はコアを保持できるが、本効果の文脈
 *   ("それら" = 裏向きで配置した 3 枚) と競合するため、ソース側からは除外する。
 *   呼び出し側で必要に応じて判定する。本 helper 自体は faceDown を許容する。
 */

import { isNormalCoreMovePrevented, isSoulCoreOn } from "./core-system";
import { hasIndependentCoreManagement } from "../model";
import type { CardDefinition, CardInstance, GameState } from "../model";
import type { NormalCoreDistributionSourceChunk } from "./core-distribution-flow";

/** 全通常コア回収の要求対象。移動禁止は除かず、実移動時に別途判定する。 */
export function collectNonLifeNormalCoreSources(
  state: GameState,
  playerId: string,
  destinationIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): NormalCoreDistributionSourceChunk[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  const sources: NormalCoreDistributionSourceChunk[] = [
    {
      container: { kind: "reserve", playerId },
      remaining: player.reserveNormalCoreCount,
    },
    {
      container: { kind: "trash", playerId },
      remaining: player.trashNormalCoreCount,
    },
  ];
  for (const card of state.cardInstances) {
    if (
      card.zone !== "field" ||
      card.controllerPlayerId !== playerId ||
      destinationIds.includes(card.instanceId)
    )
      continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def || hasIndependentCoreManagement(def)) continue;
    sources.push({
      container: { kind: "card", instanceId: card.instanceId },
      remaining: card.normalCoreCount,
    });
  }
  return sources.filter((source) => source.remaining > 0);
}

/** 指定 field カード上の通常コアを、通常の移動元として使えるか。 */
export function canMoveNormalCoresFrom(
  state: GameState,
  card: CardInstance,
  def: CardDefinition | undefined
): boolean {
  if (!def || hasIndependentCoreManagement(def)) return false;
  return (
    card.normalCoreCount > 0 &&
    !isNormalCoreMovePrevented(state, card.instanceId)
  );
}

/**
 * 指定の field カードが「コア移動元」になり得るかを判定する。
 *
 * @param state ソウルコア所在を判定するための GameState
 * @param card field 上のカードインスタンス
 * @param def 当該カードの定義 (見つからない場合 undefined)
 * @returns 移動可能なコア (通常コア + ソウルコア) を 1 個以上保持し、かつ移動不可
 *          カテゴリでなければ true
 */
export function canMoveCoresFrom(
  state: GameState,
  card: CardInstance,
  def: CardDefinition | undefined
): boolean {
  if (!def) return false;
  // 創界神 / 導界者 / 創界石ネクサスはコア管理が独立しているため、汎用コア移動の対象外。
  if (hasIndependentCoreManagement(def)) return false;
  const hasNormalCore = canMoveNormalCoresFrom(state, card, def);
  const hasSoulCore = isSoulCoreOn(state, card.instanceId);
  return hasNormalCore || hasSoulCore;
}
