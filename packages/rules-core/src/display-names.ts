import type { CardCategory, MechanicName, Step, Zone } from "./model";

export const STEP_LABELS: Readonly<Record<Step, string>> = {
  start: "スタート",
  core: "コア",
  draw: "ドロー",
  refresh: "リフレッシュ",
  main: "メイン",
  attack: "アタック",
  end: "エンド",
};

export function stepDisplayLabel(step: string): string {
  return `${lookup(STEP_LABELS, step, "")}ステップ`;
}

export const ZONE_LABELS: Readonly<Record<Zone, string>> = {
  token_pool: "トークンデッキ",
  deck: "デッキ",
  hand: "手札",
  revealed: "オープン中",
  set_aside: "手元",
  burst: "バースト",
  field: "フィールド",
  trash: "トラッシュ",
  life: "ライフ",
  reserve: "リザーブ",
  void: "ボイド",
  removed_from_game: "除外",
  in_use: "使用中",
  mirage: "ミラージュ",
  count_area: "カウント",
};

export const CARD_CATEGORY_LABELS: Readonly<Record<CardCategory, string>> = {
  spirit: "スピリット",
  ultimate: "アルティメット",
  brave: "ブレイヴ",
  nexus: "ネクサス",
  magic: "マジック",
};

export const MECHANIC_LABELS: Readonly<Record<MechanicName, string>> = {
  mirage: "ミラージュ",
  accel: "アクセル",
  change: "チェンジ",
  burst: "バースト",
  zero_counter: "ゼロカウンター",
  rebirth: "転醒",
  grandwalker: "創界神",
  guided: "導界者",
  imagin: "異魔神",
  quartz: "クォーツ",
  stack_effect: "スタック効果",
};

function lookup<T extends string>(
  labels: Readonly<Record<T, string>>,
  key: string,
  fallback: string
): string {
  return Object.hasOwn(labels, key) ? labels[key as T] : fallback;
}

export function zoneDisplayLabel(zone: string): string {
  return lookup(ZONE_LABELS, zone, "ゾーン");
}

export function cardCategoryLabel(category: string): string {
  return lookup(CARD_CATEGORY_LABELS, category, "カード");
}

export function mechanicDisplayLabel(mechanic: string): string {
  return lookup(MECHANIC_LABELS, mechanic, "能力");
}

export function coreLocationDisplayLabel(kind: string): string {
  if (kind === "outside_game") return "ゲーム外";
  if (kind === "this_card") return "このカード";
  if (kind === "card" || kind === "card_instance" || kind === "field_card")
    return "カード";
  return lookup(ZONE_LABELS, kind, "コア置き場");
}
