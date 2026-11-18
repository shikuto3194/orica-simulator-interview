/**
 * 旧形式の使用データが残っているかを見る軽量な検査 (P3-170 W5)。
 *
 * `backfillOptionalStateFields` (state-sanitize.ts、engine 非ロードの軽量モジュール) は欠落キーを
 * 既定値で補う。`effectAccounting` に空の会計を補うと、旧形式の使用済みを失う。そこで、旧形式の
 * 非空データが残る state が migration (migration.ts) を通らずに補完へ入ったら、補完せずに止める。
 *
 * このファイルは旧キー名を **文字列のデータとして** 持ち、旧データが残っているかを **検出するためだけに**
 * 読む (書かない)。旧フィールドを読み書きして変換する実行時コードは migration.ts に限る
 * (scripts/effect-usage-ssot.mjs の許可は migration.ts、検出専用のこのファイル、旧観測の語彙写像 ai-observation-encoder.ts)。
 * 変換そのものは migration.ts が行う。
 */

export const USAGE_ACCOUNTING_MIGRATION_FAILED =
  "usage_accounting_migration_failed" as const;

/** state / returnContext.turnContext が持っていた「このターンの」配列。 */
export const LEGACY_TURN_ARRAY_KEYS: readonly string[] = [
  "usedDivineSkillKeysThisTurn",
  "usedTrashAdventKeysThisTurn",
  "usedAlternateCostAdventKeysThisTurn",
  "usedAdventDeclareKeysThisTurn",
  "countGainModifierConsumedThisTurn",
  "pendingAdditionalAttackGrants",
  "usedTaplessBattleDeclareInstanceIdsThisTurn",
  "mirageSetCountExemptionsUsed",
  "mirageSetCountExemptionUsedPlayerIds",
];

/** state / returnContext.turnContext が持っていた「このターンの」辞書。 */
export const LEGACY_TURN_RECORD_KEYS: readonly string[] = [
  "declareGimmickGateUsedThisTurn",
  "lifeDamageInterceptionUseCostGateUsedThisTurn",
  "effectLifeReductionThisTurn",
  "declarationCountThisTurn",
  "lifeReductionCappedThisTurn",
  "filteredLifeReductionCappedThisTurn",
  "bpThresholdCappedLifeReductionThisTurn",
  "symbolAdditionRestrictedCountThisTurn",
];

/** state / returnContext が持っていた記録の配列。 */
export const LEGACY_RECORD_LIST_KEYS: readonly string[] = [
  "effectUsageRecords",
  "effectOccurrenceRecords",
];

export const LEGACY_TURN_KEYS: readonly string[] = [
  ...LEGACY_TURN_ARRAY_KEYS,
  ...LEGACY_TURN_RECORD_KEYS,
];

type Rec = Record<string, unknown>;

export const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isNonEmptyLegacyValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isRec(v)) return Object.keys(v).length > 0;
  return true;
}

/** 旧データを持ちうる親オブジェクト: state 本体と、追加ターンで中断された元ターンの退避文脈。 */
export function legacyTurnHolders(state: Rec): { holder: Rec; records: Rec }[] {
  const out: { holder: Rec; records: Rec }[] = [
    { holder: state, records: state },
  ];
  let extra = state["extraTurnState"];
  while (isRec(extra) && isRec(extra["returnContext"])) {
    const rc = extra["returnContext"];
    out.push({
      holder: isRec(rc["turnContext"]) ? rc["turnContext"] : {},
      records: rc,
    });
    extra = rc["extraTurnState"];
  }
  return out;
}

/** 旧キーが (空でも) 1つでも残っているか。変換済みの高速判定に使う。 */
export function anyLegacyKeyPresent(state: Rec): boolean {
  for (const { holder, records } of legacyTurnHolders(state)) {
    if (LEGACY_TURN_KEYS.some((k) => k in holder)) return true;
    if (LEGACY_RECORD_LIST_KEYS.some((k) => k in records)) return true;
  }
  const attack = state["activeAttack"];
  if (isRec(attack) && "connectBattleGrant" in attack) return true;
  const pending = state["pendingConnectBattleDecision"];
  if (isRec(pending) && "remainingUses" in pending) return true;
  return false;
}

/**
 * 旧形式の使用データが (空でなく) 残っているか。入れ子の state の検査は migration が担う
 * (ここは state 本体と追加ターンの退避文脈だけを見る)。
 */
export function hasLegacyEffectUsageData(state: unknown): boolean {
  if (!isRec(state)) return false;
  for (const { holder, records } of legacyTurnHolders(state)) {
    if (LEGACY_TURN_KEYS.some((k) => isNonEmptyLegacyValue(holder[k]))) {
      return true;
    }
    if (
      LEGACY_RECORD_LIST_KEYS.some((k) => isNonEmptyLegacyValue(records[k]))
    ) {
      return true;
    }
  }
  const attack = state["activeAttack"];
  if (isRec(attack) && attack["connectBattleGrant"]) return true;
  const pending = state["pendingConnectBattleDecision"];
  return isRec(pending) && "remainingUses" in pending;
}

/**
 * 旧形式の使用データが残る state が、migration を通らずに既定値補完へ入ったことを示すエラー。
 * 空の会計を補うと使用済みを失うため、補完せずに止める。
 */
export class UnmigratedEffectUsageError extends Error {
  readonly code = USAGE_ACCOUNTING_MIGRATION_FAILED;
  constructor() {
    super(
      "state has old-format effect usage data; run migrateEffectAccounting before backfillOptionalStateFields"
    );
  }
}

/** 会計が無い state に旧形式の使用データが残っていないことを確認する (残っていれば例外)。 */
export function assertEffectUsageMigrated(state: unknown): void {
  if (!isRec(state)) return;
  if (
    state["effectAccounting"] === undefined &&
    hasLegacyEffectUsageData(state)
  ) {
    throw new UnmigratedEffectUsageError();
  }
}

/**
 * 旧版が「宣言時に消費済み」を pending・継続効果・スタックに運んでいたフラグ。
 * 新形式は消費の receipt (operationId) で同じ二重消費防止を表し、対応する bucket を一意に特定できない
 * 旧フラグは変換しない (推測しない)。値が真 (配列は非空) の旧フラグを持つ対戦途中の state は、
 * 読込を明示エラーで拒否する (compatibility.md: 変換できない取消可能 pending は途中の読込を失敗させる)。
 */
export const LEGACY_IN_FLIGHT_FLAG_KEYS: readonly string[] = [
  "usageLimitConsumedOnPrivateDeclaration",
  "usageLimitConsumed",
  "mirageSetCountExemptionConsumed",
  "consumedUsageGroups",
];

/** 旧フラグが真の箇所を state のどこからでも探す。見つからなければ undefined。 */
export function findLegacyInFlightFlag(
  root: unknown
): { path: string; key: string } | undefined {
  const seen = new WeakSet<object>();
  const walk = (
    value: unknown,
    path: string
  ): { path: string; key: string } | undefined => {
    if (typeof value !== "object" || value === null || seen.has(value))
      return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        const found = walk(item, `${path}[${i}]`);
        if (found) return found;
      }
      return undefined;
    }
    for (const [key, child] of Object.entries(value)) {
      if (LEGACY_IN_FLIGHT_FLAG_KEYS.includes(key)) {
        const active = Array.isArray(child) ? child.length > 0 : child === true;
        if (active) return { path: `${path}.${key}`, key };
      }
      const found = walk(child, `${path}.${key}`);
      if (found) return found;
    }
    return undefined;
  };
  return walk(root, "state");
}
