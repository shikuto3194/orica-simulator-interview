import type { CardFilter } from "../dsl-types";

export function matchesTribes(
  cardTribe: string | undefined,
  filter: CardFilter,
  effectiveTribes?: readonly string[]
): boolean {
  const parts = effectiveTribes
    ? [...effectiveTribes]
    : cardTribe
      ? cardTribe.split("・")
      : [];

  if (filter.noTribes === true && parts.length > 0) return false;

  if (filter.tribesRequired && filter.tribesRequired.length > 0) {
    if (!filter.tribesRequired.every((t) => parts.includes(t))) return false;
  }

  if (filter.tribes && filter.tribes.length > 0) {
    const logic = filter.tribesLogic ?? "or";
    if (logic === "or") {
      if (!filter.tribes.some((t) => parts.includes(t))) return false;
    } else {
      if (!filter.tribes.every((t) => parts.includes(t))) return false;
    }
  }

  if (filter.excludeTribeSubstring && filter.excludeTribeSubstring.length > 0) {
    if (tribeContainsExcludedSubstring(parts, filter.excludeTribeSubstring)) {
      return false;
    }
  }

  return true;
}

/**
 * 系統トークン群のいずれかが除外部分文字列のいずれかを含むか判定する SSOT ヘルパー。
 * CardFilter.excludeTribeSubstring と BraveCondition.excludeTribeSubstring
 * （合体条件の否定系統フィルタ、P3-111）が共有する。
 */
export function tribeContainsExcludedSubstring(
  tribeParts: readonly string[],
  excludeSubstrings: readonly string[]
): boolean {
  return tribeParts.some((part) =>
    excludeSubstrings.some((sub) => part.includes(sub))
  );
}
