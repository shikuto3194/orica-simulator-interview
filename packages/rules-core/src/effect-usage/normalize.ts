/**
 * カード定義の制限記述 (EffectUsageLimit) を UsageConstraint へ正規化する。
 *
 * 登録時に一度だけ呼び、列挙・pending・実行へ同じ constraint を渡す。
 * 各consumerが制限kindごとに分岐して識別キーを作ることを禁止するための入口。
 */

import { makeConstraintId } from "./identity";
import type {
  AbilityKind,
  AbilityRef,
  EffectUsageLimit,
  UsageCommitPoint,
  UsageConstraint,
  UsageIncarnation,
  UsageMaximum,
  UsagePeriodKind,
  UsageShare,
} from "./types";

// ---------------------------------------------------------------
// AbilityRef の構築 (構造参照。表示ラベルとは独立)
// ---------------------------------------------------------------

export function makeAbilityRef(
  kind: AbilityKind,
  definitionKey: string,
  path: string
): AbilityRef {
  return { kind, definitionKey, path };
}

/**
 * 同名共有用の能力参照: 名前 + 能力指紋。definitionId ではなく printed name を使い、
 * 同一本文の共有能力を別definitionIdでも同じ枠にする。
 */
export function sharedNameAbilityRef(
  printedName: string,
  fingerprint: string
): AbilityRef {
  return makeAbilityRef("effect", `name:${printedName}`, `fp:${fingerprint}`);
}

export function effectAbilityRef(
  definitionKey: string,
  effectIndex: number
): AbilityRef {
  return makeAbilityRef("effect", definitionKey, `effects[${effectIndex}]`);
}

/**
 * step の構造path (`effects[i].steps[j]`)。実行時の識別 (`usageIdentityOfStep`) とこの `stepAbilityRef` が
 * 共有する唯一の写像で、`step.id` は識別に使わない。card-data の step 位置・制限の変更は、
 * effect-usage-catalog-manifest.test.ts の「識別 pin」(既存カードの path・種類・値の hash) が検出する。
 */
export function stepStructuralPath(
  effectIndex: number,
  stepIndex: number
): string {
  return `effects[${effectIndex}].steps[${stepIndex}]`;
}

export function stepAbilityRef(
  definitionKey: string,
  effectIndex: number,
  stepIndex: number
): AbilityRef {
  return makeAbilityRef(
    "step",
    definitionKey,
    stepStructuralPath(effectIndex, stepIndex)
  );
}

export function choiceAbilityRef(
  definitionKey: string,
  effectIndex: number,
  choiceIndex: number
): AbilityRef {
  return makeAbilityRef(
    "choice",
    definitionKey,
    `effects[${effectIndex}].choices[${choiceIndex}]`
  );
}

// ---------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------

export interface NormalizeUsageLimitOptions {
  abilityRef: AbilityRef;
  /** 単体・配列・未設定を受ける。未設定は制約なし。 */
  limits: EffectUsageLimit | readonly EffectUsageLimit[] | undefined;
  /**
   * 同名共有 (per_card_name / no_duplicate / 重複不可併用の主語別) に使う能力参照。
   * 「同名でも別効果は別枠、別definitionIdでも同一本文なら同枠」のため、
   * 名前 + 能力指紋 (`sharedNameAbilityRef`) を渡す。未指定なら abilityRef を使う。
   */
  nameAbilityRef?: AbilityRef;
  /** 共有使用制限グループ。能力間で同じ枠を共有する (usageGroupId / limitGroupId)。 */
  groupId?: string;
  /** 効果が【魂状態】を含むか。含む場合、魂状態化で per_instance 枠を更新しない。 */
  includesSoulState?: boolean;
  commitPoint?: UsageCommitPoint;
}

interface Shape {
  share: UsageShare;
  period: UsagePeriodKind;
  incarnation: UsageIncarnation;
  shareSourceByName?: boolean;
}

function shapeOf(
  limit: EffectUsageLimit,
  includesSoulState: boolean,
  anyNoDuplicate: boolean
): Shape {
  const duration: UsagePeriodKind = limit.duration ?? "turn";
  switch (limit.kind) {
    case "per_instance":
      return {
        share: "instance",
        period: duration,
        incarnation: { field: true, soul: !includesSoulState },
      };
    case "per_card_name":
      return {
        share: "card_name",
        period: duration,
        incarnation: { field: false, soul: false },
      };
    case "per_group":
      return {
        share: "group",
        period: duration,
        incarnation: { field: false, soul: false },
      };
    case "no_duplicate":
      // 〔重複不可〕は同一出来事 (event) 内のみで畳む。duration は無視する。
      return {
        share: "card_name",
        period: "event",
        incarnation: { field: false, soul: false },
      };
    case "per_trigger_related_instance":
      return {
        share: "subject_instance",
        period: duration,
        incarnation: { field: false, soul: false },
        ...(anyNoDuplicate ? { shareSourceByName: true } : {}),
      };
    case "per_trigger_activation":
      return {
        share: "instance",
        period: "activation",
        incarnation: { field: false, soul: false },
      };
  }
}

function maximumOf(limit: EffectUsageLimit): UsageMaximum {
  if (limit.kind === "no_duplicate") return { base: 1 };
  return {
    base: limit.maxCount ?? 1,
    ...(limit.maxCountAdditionalDynamic
      ? { additionalDynamic: limit.maxCountAdditionalDynamic }
      : {}),
    ...(limit.maxCountOverrides ? { overrides: limit.maxCountOverrides } : {}),
  };
}

/**
 * 制限記述を constraint の配列に変換する (複数制限は AND)。
 * 同一能力内で (共有, 期間) が重複する制限だけ序数で区別する。
 */
export function normalizeUsageLimits(
  options: NormalizeUsageLimitOptions
): UsageConstraint[] {
  const { limits } = options;
  if (limits === undefined) return [];
  const list: readonly EffectUsageLimit[] = Array.isArray(limits)
    ? (limits as readonly EffectUsageLimit[])
    : [limits as EffectUsageLimit];
  const anyNoDuplicate = list.some((limit) => limit.kind === "no_duplicate");
  const seen = new Map<string, number>();
  return list.map((limit) => {
    const shape = shapeOf(
      limit,
      options.includesSoulState === true,
      anyNoDuplicate
    );
    const sharesByName =
      shape.share === "card_name" || shape.shareSourceByName === true;
    const ref =
      sharesByName && options.nameAbilityRef
        ? options.nameAbilityRef
        : options.abilityRef;
    const slot = `${shape.share}/${shape.period}`;
    const ordinal = seen.get(slot) ?? 0;
    seen.set(slot, ordinal + 1);
    const groupId = options.groupId;
    return {
      constraintId: makeConstraintId(
        ref,
        shape.share,
        shape.period,
        ordinal,
        groupId
      ),
      abilityRef: ref,
      share: shape.share,
      ...(groupId !== undefined ? { groupId } : {}),
      playerScope: "actor" as const,
      period: shape.period,
      measure: "use" as const,
      maximum: maximumOf(limit),
      incarnation: shape.incarnation,
      ...(shape.shareSourceByName ? { shareSourceByName: true } : {}),
      commitPoint: options.commitPoint ?? "declaration",
    };
  });
}

// ---------------------------------------------------------------
// 回数以外(事実・数量・観測・権利行使)の制約を直接作る
// ---------------------------------------------------------------

export interface BuildUsageConstraintOptions {
  abilityRef: AbilityRef;
  share: UsageShare;
  period: UsagePeriodKind;
  measure: UsageConstraint["measure"];
  /** 固定の上限。数量を集計するだけで上限を持たない枠は省略(実質無制限)。 */
  maximum?: UsageMaximum;
  playerScope?: UsageConstraint["playerScope"];
  incarnation?: UsageIncarnation;
  groupId?: string;
  shareSourceByName?: boolean;
  commitPoint?: UsageCommitPoint;
  /** 同一能力内で (共有, 期間) が重複する場合の序数。 */
  ordinal?: number;
}

/** 数量集計など上限を持たない枠に使う、実質無制限の上限。 */
export const UNBOUNDED_USAGE_MAXIMUM: UsageMaximum = {
  base: Number.MAX_SAFE_INTEGER,
};

/**
 * 回数制限(EffectUsageLimit)では表せない枠(事実の記録・実量の集計・観測・権利の行使など)の
 * 制約を作る。constraintId はここで生成する(呼出側で組み立てない)。
 */
export function buildUsageConstraint(
  options: BuildUsageConstraintOptions
): UsageConstraint {
  return {
    constraintId: makeConstraintId(
      options.abilityRef,
      options.share,
      options.period,
      options.ordinal ?? 0,
      options.groupId
    ),
    abilityRef: options.abilityRef,
    share: options.share,
    ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
    playerScope: options.playerScope ?? "actor",
    period: options.period,
    measure: options.measure,
    maximum: options.maximum ?? UNBOUNDED_USAGE_MAXIMUM,
    incarnation: options.incarnation ?? { field: false, soul: false },
    ...(options.shareSourceByName ? { shareSourceByName: true } : {}),
    commitPoint: options.commitPoint ?? "application",
  };
}
