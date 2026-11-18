import type { CardInstance, Zone } from "../model";

export type ZoneVisibility = "public" | "private" | "controller_only";

/**
 * 各ゾーンの可視性メタデータ。F-1 裏向きフィールド配置で参照する。
 * - public: 両プレイヤーに完全可視 (定義情報・コア・状態すべて)
 * - controller_only: コントローラのみ定義情報可視 (相手は件数のみ)
 * - private: 両プレイヤーに不可視 (件数のみ)
 */
export const ZONE_VISIBILITY: Record<Zone, ZoneVisibility> = {
  token_pool: "public",
  deck: "private",
  hand: "controller_only",
  revealed: "public",
  // 手元はオープンゾーン (08b:23「手札と違い公開され」) で相手も閲覧可能。
  set_aside: "public",
  burst: "controller_only",
  field: "public",
  trash: "public",
  life: "private",
  reserve: "public",
  void: "public",
  removed_from_game: "public",
  in_use: "public",
  // 2026-05-29 裁定: ミラージュは表向きセット (08c:62) で相手も定義情報を閲覧可能。
  mirage: "public",
  count_area: "public",
};

/**
 * 裏向きカードがゾーン移動する際の faceDown フラグを規則化する。
 *
 * **規則 (2026-05-29 裁定で精緻化)**: `faceDown` は *フィールド上の裏向き配置状態* のみを
 * 表す。ゾーン移動時はこの既定ポリシーで常に解除し「通常カード」に戻す。
 * — フランドール【フォーオブアカインド】の分身は、フィールドを離れ分身でなくなった以上、
 *   破壊(トラッシュ)でもバウンス(手札)でもデッキ戻しでも、他カードと同様の挙動になるべき。
 * — 相手への秘匿は移動先ゾーンの可視性 (手札=controller_only / デッキ=private) が
 *   `sanitizeStateForViewer` で担保するため、faceDown を立て続ける必要はない
 *   (P3-69: ルール identity と presentation を分離)。
 * — 「裏向きで〜に置く/戻す」と *明記された* 効果は別経路 (`move_card` の `faceDown:true`)
 *   で強制 face-down するため、本ポリシーは関与しない。
 *
 * 表向きカード (faceDown=false) はそのまま返す。
 *
 * 出典: P3-47 F-1 裏向きフィールド配置 / 2026-05-05 裁定 (公開→表/非公開→裏) を
 * 2026-05-29 に「離場で常に解除、明示効果のみ維持」へ精緻化。
 */
export function applyFaceDownPolicyOnZoneChange(
  card: CardInstance,
  _destinationZone: Zone
): CardInstance {
  if (!card.faceDown) return card;
  // 移動先を問わず解除。明示的 face-down 移動は move_card.faceDown:true が別途強制する。
  return { ...card, faceDown: false, faceDownContentsPublic: false };
}
