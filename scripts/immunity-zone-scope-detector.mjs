/**
 * 自己「このカードは相手の効果を受けない」型の zone scope 監査ヘルパー。
 *
 * BSES01-C04 は同じ textRef 行に
 * 「このカードは相手の効果を受けない。」と
 * 「デッキからオープンされた/トラッシュにあるこのカードは...」が並ぶ。
 * 行全体で zone 語を見てしまうと前者の無限定耐性を見落とすため、
 * 句点単位で immunity 文そのものだけを見る。
 */

export const REQUIRED_SELF_IMMUNITY_ZONES = [
  "hand",
  "set_aside",
  "in_use",
  "trash",
  "field",
];

const SELF_CARD_OPPONENT_IMMUNITY_RE =
  /このカードは、?相手の効果を受け(?:ない|ず)/;

const ZONE_LIMIT_WORDING_RE =
  /手札|手元|トラッシュ|セットしている|発動している間|発動中|フィールド|デッキ|オープン|ミラージュ|煌臨元|魂状態/;

export function hasUnboundedSelfEffectImmunityWording(text) {
  if (!text) return false;
  const sentences = String(text)
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.some(
    (sentence) =>
      SELF_CARD_OPPONENT_IMMUNITY_RE.test(sentence) &&
      !ZONE_LIMIT_WORDING_RE.test(sentence)
  );
}

export function normalizeApplicabilityZoneList(zone) {
  return zone === undefined ? [] : Array.isArray(zone) ? zone : [zone];
}
