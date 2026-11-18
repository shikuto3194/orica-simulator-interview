import type { Effect } from "../dsl-types";
import type { CardDefinition } from "../model";

/** 定義内の効果コンテナの位置。条件や効果本文は複製しない。 */
export function definitionEffectPath(options: {
  divineSkillIndex?: number;
  isAccelData?: boolean;
  isChangeData?: boolean;
}): readonly (string | number)[] {
  if (options.divineSkillIndex !== undefined)
    return [
      "grandwalkerData",
      "divineSkills",
      options.divineSkillIndex,
      "effects",
    ];
  if (options.isAccelData) return ["accelData", "effects"];
  if (options.isChangeData) return ["changeData", "effects"];
  return ["effects"];
}

export function resolveDefinitionEffect(
  definition: CardDefinition | undefined,
  index: number,
  path: readonly (string | number)[] | null = ["effects"]
): Effect | undefined {
  if (path === null) return undefined;
  let container: unknown = definition;
  for (const key of path) {
    if (
      container === null ||
      typeof container !== "object" ||
      !Object.hasOwn(container, key)
    )
      return undefined;
    container = (container as Record<string | number, unknown>)[key];
  }
  return Array.isArray(container)
    ? (container[index] as Effect | undefined)
    : undefined;
}

export function sameDefinitionEffectPath(
  left: readonly (string | number)[] | null = ["effects"],
  right: readonly (string | number)[] | null = ["effects"]
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}
