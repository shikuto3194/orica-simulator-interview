import { cardCategoryLabel, mechanicDisplayLabel } from "@orica/rules-core";
import { COLOR_JA } from "./symbol-format";
/**
 * CardFilter から人間可読な日本語説明文を生成する。
 *
 * 用途: 「OR 形式選択」の代替条件ラベル (BSTH01-C12 ヴワル魔法図書館 = 系統「紅魔」1枚 等)、
 *       deck reveal pick の条件説明など、フィルタ条件を UI 表示する箇所で再利用する。
 *
 * 既存の `DeckRevealModal.describePickFilter` のロジックを汎用化したもの。
 */

import type { CardFilter } from "@orica/rules-core";

/**
 * filter に含まれる条件部分を結合した説明文を返す。count は末尾に付与される。
 *
 * 例:
 *   - { tribes: ["紅魔"] }, count=1            → "系統：「紅魔」1枚"
 *   - { colors: ["red"], category: ["spirit"] }, count=2 → "赤のスピリット2枚"
 *   - { minCost: 3 }, count=1                  → "コスト3以上1枚"
 *   - undefined, count=1                       → "カード1枚"
 *
 * 未知のフィルタフィールドが組み合わさった場合は表現可能な部分のみを連結する。
 */
export function describeCardFilter(
  filter: CardFilter | undefined,
  count: number
): string {
  if (!filter) return `カード${count}枚`;
  const parts: string[] = [];

  if (filter.colors && filter.colors.length > 0) {
    parts.push(filter.colors.map((c) => COLOR_JA[c] ?? "色").join("/"));
  }
  if (filter.tribes && filter.tribes.length > 0) {
    const join = filter.tribesLogic === "and" ? "」かつ「" : "」「";
    parts.push(`系統：「${filter.tribes.join(join)}」`);
  }
  if (filter.tribesRequired && filter.tribesRequired.length > 0) {
    parts.push(`必須系統：「${filter.tribesRequired.join("」「")}」`);
  }
  if (filter.category && filter.category.length > 0) {
    parts.push(filter.category.map((c) => cardCategoryLabel(c)).join("/"));
  }
  if (filter.minCost !== undefined && filter.maxCost !== undefined) {
    parts.push(`コスト${filter.minCost}〜${filter.maxCost}`);
  } else if (filter.minCost !== undefined) {
    parts.push(`コスト${filter.minCost}以上`);
  } else if (filter.maxCost !== undefined) {
    parts.push(`コスト${filter.maxCost}以下`);
  }
  if (filter.minBp !== undefined && filter.maxBp !== undefined) {
    parts.push(`BP${filter.minBp}〜${filter.maxBp}`);
  } else if (filter.minBp !== undefined) {
    parts.push(`BP${filter.minBp}以上`);
  } else if (filter.maxBp !== undefined) {
    parts.push(`BP${filter.maxBp}以下`);
  }
  if (filter.symbolCount !== undefined) {
    parts.push(`シンボル${filter.symbolCount}`);
  }
  if (filter.hasMechanic && filter.hasMechanic.length > 0) {
    parts.push(
      filter.hasMechanic.map((m) => mechanicDisplayLabel(m)).join("/") + "持ち"
    );
  }

  return parts.length > 0
    ? `${parts.join("の")}${count}枚`
    : `カード${count}枚`;
}
