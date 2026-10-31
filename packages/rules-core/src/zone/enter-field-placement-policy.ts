import { hasIndependentCoreManagement } from "../model";
import type { CardDefinition, CardInstance } from "../model";

export type EnterFieldCorePlacementRule =
  | "required_minimum"
  | "optional"
  | "forbidden";

export interface EnterFieldCorePlacementPolicy {
  rule: EnterFieldCorePlacementRule;
  minimumCoreCount: number;
  maximumCoreCount: number | null;
  /**
   * 召喚時トラッシュ配置許可 (BSLH01-T13 grant_summon_trash_core_placement CE、
   * ENGINE-summon-trash-core-placement-grant)。未設定 = 許可なし。設定時、
   * この件数まで通常コアをトラッシュから置ける（`assertEnterFieldCorePlacementsAllowed`
   * が opt-in で検証、`getEnterFieldCorePlacementPolicy` 自体はこの値を書かない —
   * hand summon の呼び出し元 (play-card-system.ts) が
   * `getSummonTrashCorePlacementGrant` の結果をこの base policy に合流させる）。
   */
  allowedTrashNormalCoreCount?: number;
}

export const ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG =
  "enter_field_core_placement_forbidden";
export const ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX =
  "enter_field_core_placement_rule_";
export const ENTER_FIELD_CORE_PLACEMENT_MIN_TAG_PREFIX =
  "enter_field_core_placement_min_";
export const ENTER_FIELD_CORE_PLACEMENT_MAX_TAG_PREFIX =
  "enter_field_core_placement_max_";

export function getEnterFieldCorePlacementRule(
  definition: CardDefinition
): EnterFieldCorePlacementRule {
  // P3-93: 独立コア管理カード（創界神/導界者/創界石）は「配置時にコアを置けない」
  // （08c）。通常ネクサスの optional 維持コア選択を出してはならない。
  if (hasIndependentCoreManagement(definition)) {
    return "forbidden";
  }

  if (
    definition.keywordTags.includes(ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG)
  ) {
    return "forbidden";
  }

  return definition.printedCategory === "nexus"
    ? "optional"
    : "required_minimum";
}

function getSingleKeywordTagSuffix(options: {
  keywordTags: readonly string[];
  prefix: string;
  cardNo: string;
}): string | undefined {
  const matchingTags = options.keywordTags.filter((keywordTag) =>
    keywordTag.startsWith(options.prefix)
  );

  if (matchingTags.length === 0) {
    return undefined;
  }

  if (matchingTags.length > 1) {
    throw new Error(
      `Duplicate enter-field placement keyword tags on ${options.cardNo}: ${matchingTags.join(",")}`
    );
  }

  return matchingTags[0]?.slice(options.prefix.length);
}

function parseNonNegativeIntegerKeywordTagSuffix(options: {
  keywordTags: readonly string[];
  prefix: string;
  cardNo: string;
}): number | undefined {
  const suffix = getSingleKeywordTagSuffix(options);

  if (suffix === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(suffix)) {
    throw new Error(
      `Invalid enter-field placement integer keyword tag on ${options.cardNo}: ${options.prefix}${suffix}`
    );
  }

  return Number.parseInt(suffix, 10);
}

function parseEnterFieldCorePlacementRuleKeywordTag(
  definition: CardDefinition
): EnterFieldCorePlacementRule | undefined {
  const suffix = getSingleKeywordTagSuffix({
    keywordTags: definition.keywordTags,
    prefix: ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX,
    cardNo: definition.cardNo,
  });

  if (suffix === undefined) {
    return undefined;
  }

  if (
    suffix === "required_minimum" ||
    suffix === "optional" ||
    suffix === "forbidden"
  ) {
    return suffix;
  }

  throw new Error(
    `Invalid enter-field placement rule keyword tag on ${definition.cardNo}: ${ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX}${suffix}`
  );
}

export function getKeywordTagEnterFieldCorePlacementPolicyOverride(
  definition: CardDefinition
): Partial<EnterFieldCorePlacementPolicy> {
  const hasForbiddenTag = definition.keywordTags.includes(
    ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG
  );
  const ruleFromKeywordTag =
    parseEnterFieldCorePlacementRuleKeywordTag(definition);
  const minimumCoreCount = parseNonNegativeIntegerKeywordTagSuffix({
    keywordTags: definition.keywordTags,
    prefix: ENTER_FIELD_CORE_PLACEMENT_MIN_TAG_PREFIX,
    cardNo: definition.cardNo,
  });
  const maximumCoreCount = parseNonNegativeIntegerKeywordTagSuffix({
    keywordTags: definition.keywordTags,
    prefix: ENTER_FIELD_CORE_PLACEMENT_MAX_TAG_PREFIX,
    cardNo: definition.cardNo,
  });
  const rule = hasForbiddenTag ? "forbidden" : ruleFromKeywordTag;

  if (rule === "forbidden") {
    if (
      (ruleFromKeywordTag !== undefined &&
        ruleFromKeywordTag !== "forbidden") ||
      (minimumCoreCount !== undefined && minimumCoreCount !== 0) ||
      (maximumCoreCount !== undefined && maximumCoreCount !== 0)
    ) {
      throw new Error(
        `Conflicting enter-field placement keyword tags on ${definition.cardNo}`
      );
    }

    return {
      rule: "forbidden",
      minimumCoreCount: 0,
      maximumCoreCount: 0,
    };
  }

  if (
    minimumCoreCount !== undefined &&
    maximumCoreCount !== undefined &&
    minimumCoreCount > maximumCoreCount
  ) {
    throw new Error(
      `Invalid enter-field placement min/max keyword tags on ${definition.cardNo}: min=${minimumCoreCount} max=${maximumCoreCount}`
    );
  }

  return {
    ...(rule !== undefined ? { rule } : {}),
    ...(minimumCoreCount !== undefined ? { minimumCoreCount } : {}),
    ...(maximumCoreCount !== undefined ? { maximumCoreCount } : {}),
  };
}

export function getDefaultEnterFieldCorePlacementPolicy(options: {
  card: CardInstance;
  definition: CardDefinition;
}): EnterFieldCorePlacementPolicy {
  const baseRule = getEnterFieldCorePlacementRule(options.definition);
  const basePolicy: EnterFieldCorePlacementPolicy = {
    rule: baseRule,
    minimumCoreCount:
      baseRule === "required_minimum" ? options.card.minimumRequiredCores : 0,
    maximumCoreCount: baseRule === "forbidden" ? 0 : null,
  };
  const keywordTagOverride = getKeywordTagEnterFieldCorePlacementPolicyOverride(
    options.definition
  );

  return {
    rule: keywordTagOverride.rule ?? basePolicy.rule,
    minimumCoreCount:
      keywordTagOverride.minimumCoreCount ?? basePolicy.minimumCoreCount,
    maximumCoreCount:
      keywordTagOverride.maximumCoreCount ?? basePolicy.maximumCoreCount,
  };
}

export function getEnterFieldCorePlacementPolicy(options: {
  card: CardInstance;
  definition: CardDefinition;
}): EnterFieldCorePlacementPolicy {
  return getDefaultEnterFieldCorePlacementPolicy(options);
}

export function getMinimumEnterFieldCoreCount(options: {
  card: CardInstance;
  definition: CardDefinition;
}): number {
  return getDefaultEnterFieldCorePlacementPolicy(options).minimumCoreCount;
}
