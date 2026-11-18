/**
 * 使用枠の純粋な台帳。query は状態を変更せず、consume は全制限を確認してから原子的に更新し、
 * refund は当該操作 (receipt) の差分だけを戻す。
 *
 * この台帳への書込 (buckets / operations / grants の更新) は本ファイルだけが行う。
 * 他のモジュールが `EffectAccounting` を直接組み立てて書込むことは禁止
 * (scripts/check-ssot.mjs の P3-170 規則)。
 */

import { isBucketLive } from "./clock";
import { makeBucketKey } from "./identity";
import type {
  EffectAccounting,
  UsageBucket,
  UsageClock,
  UsageConsumeResult,
  UsageConstraint,
  UsageContext,
  UsageDelta,
  UsageGrant,
  UsageMaximumResolver,
  UsageOperation,
  UsageQueryEntry,
  UsageQueryResult,
} from "./types";

export function createEmptyEffectAccounting(): EffectAccounting {
  return {
    version: 1,
    nextOperationSeq: 0,
    buckets: [],
    grants: [],
    operations: [],
  };
}

// ---------------------------------------------------------------
// 索引 (不変配列をキーにしたキャッシュ。分岐state間で可変値を共有しない)
// ---------------------------------------------------------------

const bucketIndexCache = new WeakMap<
  readonly UsageBucket[],
  ReadonlyMap<string, UsageBucket>
>();

function bucketIndex(
  buckets: readonly UsageBucket[]
): ReadonlyMap<string, UsageBucket> {
  let index = bucketIndexCache.get(buckets);
  if (!index) {
    const map = new Map<string, UsageBucket>();
    for (const bucket of buckets) map.set(bucket.key, bucket);
    index = map;
    bucketIndexCache.set(buckets, index);
  }
  return index;
}

/** operationId を呼出側が持たない消費のために、状態から決定的に採番する。 */
export function allocateOperationId(accounting: EffectAccounting): {
  accounting: EffectAccounting;
  operationId: string;
} {
  return {
    accounting: {
      ...accounting,
      nextOperationSeq: accounting.nextOperationSeq + 1,
    },
    operationId: `usage-op:${accounting.nextOperationSeq}`,
  };
}

function isValidAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0;
}

function isValidMaximum(limit: number): boolean {
  return Number.isSafeInteger(limit) && limit >= 0;
}

/** 回数/数量を強制する測定か。観測は常に記録だけを行い、上限で止めない。 */
function isEnforced(constraint: UsageConstraint): boolean {
  return constraint.measure !== "observation";
}

interface ResolvedBucket {
  constraint: UsageConstraint;
  key: string;
  limit: number;
}

type ResolveOutcome =
  | { ok: true; resolved: ResolvedBucket[] }
  | {
      ok: false;
      reason: "missing_player" | "invalid_maximum";
      constraintId: string;
    };

function resolveBuckets(
  constraints: readonly UsageConstraint[],
  context: UsageContext,
  resolveMaximum: UsageMaximumResolver
): ResolveOutcome {
  const resolved: ResolvedBucket[] = [];
  for (const constraint of constraints) {
    const made = makeBucketKey(constraint, context);
    if (made === null) {
      // 期間が成立しない (バトル外のバトル期間など)。使用不可として扱う。
      resolved.push({ constraint, key: "", limit: 0 });
      continue;
    }
    if ("missingPlayer" in made) {
      return {
        ok: false,
        reason: "missing_player",
        constraintId: constraint.constraintId,
      };
    }
    const limit = resolveMaximum(constraint, context);
    if (!isValidMaximum(limit)) {
      return {
        ok: false,
        reason: "invalid_maximum",
        constraintId: constraint.constraintId,
      };
    }
    resolved.push({ constraint, key: made.key, limit });
  }
  return { ok: true, resolved };
}

// ---------------------------------------------------------------
// query (状態を変更しない)
// ---------------------------------------------------------------

/**
 * 各制限の limit / used / remaining を返す。`demand` はこの操作で消費したい量。
 * 全件が demand を満たすときだけ allowed。
 */
export function queryUsage(
  accounting: EffectAccounting,
  constraints: readonly UsageConstraint[],
  context: UsageContext,
  resolveMaximum: UsageMaximumResolver,
  demand = 1
): UsageQueryResult {
  const outcome = resolveBuckets(constraints, context, resolveMaximum);
  if (!outcome.ok) {
    return {
      entries: [
        {
          constraintId: outcome.constraintId,
          bucketKey: "",
          limit: 0,
          used: 0,
          remaining: 0,
          blockedReason: outcome.reason,
        },
      ],
      allowed: false,
    };
  }
  const index = bucketIndex(accounting.buckets);
  const entries: UsageQueryEntry[] = [];
  let allowed = true;
  for (const { constraint, key, limit } of outcome.resolved) {
    const used = key === "" ? 0 : (index.get(key)?.amount ?? 0);
    // 使用済みを上限で切り詰めない。上限が下がっても使用済みはそのまま。
    const remaining = key === "" ? 0 : Math.max(0, limit - used);
    const blocked = isEnforced(constraint) && remaining < demand;
    if (blocked) allowed = false;
    entries.push({
      constraintId: constraint.constraintId,
      bucketKey: key,
      limit,
      used,
      remaining,
      ...(blocked ? { blockedReason: "exhausted" as const } : {}),
    });
  }
  return { entries, allowed };
}

// ---------------------------------------------------------------
// consume (全件確認後に原子的に更新)
// ---------------------------------------------------------------

function findOperation(
  accounting: EffectAccounting,
  operationId: string
): UsageOperation | undefined {
  return accounting.operations.find((op) => op.operationId === operationId);
}

/**
 * 複数の制限を原子的に消費する。
 *
 * - 同一 operationId の再送は何も加算せず、既存 receipt を返す (replayed)。内容 (量・対象の枠) が
 *   違う再送は operation_conflict で拒否する。
 * - 取消済みの operationId の再送は拒否する。
 * - 同一 operation 内で同じ bucket を指す制限は一度だけ加算し、別 constraintId の枠は独立に加算する。
 * - 一部だけ更新して失敗することはない。
 */
export function consumeUsage(
  accounting: EffectAccounting,
  constraints: readonly UsageConstraint[],
  context: UsageContext,
  operationId: string,
  resolveMaximum: UsageMaximumResolver,
  amount = 1,
  options: {
    released?: boolean;
    /**
     * false: 取消の対象にならない記録 (確定した数量・宣言事実)。bucket だけを更新し、
     * receipt (operation) を残さない。declaration 取消などの refund が巻き込まない。
     */
    receipt?: boolean;
  } = {}
): UsageConsumeResult {
  if (!isValidAmount(amount)) return { ok: false, reason: "invalid_amount" };

  const existing = findOperation(accounting, operationId);
  if (existing) {
    if (existing.status === "refunded") {
      return { ok: false, reason: "operation_refunded" };
    }
    // 同じ operationId で内容 (量・対象の枠) が違う再送は、黙って成功にせず競合として拒否する。
    const wanted = [...new Set(usageBucketKeys(constraints, context))];
    const held = existing.deltas.map((delta) => delta.bucketKey);
    if (
      wanted.length !== held.length ||
      !wanted.every((key) => held.includes(key)) ||
      existing.deltas.some((delta) => delta.delta !== amount)
    )
      return { ok: false, reason: "operation_conflict" };
    return { ok: true, accounting, operation: existing, replayed: true };
  }

  const outcome = resolveBuckets(constraints, context, resolveMaximum);
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      constraintId: outcome.constraintId,
    };
  }

  const index = bucketIndex(accounting.buckets);
  // 同一 bucket は一度だけ数える。
  const unique = new Map<string, ResolvedBucket>();
  for (const resolved of outcome.resolved) {
    if (resolved.key === "") {
      // 期間が成立しない枠 (バトル外のバトル期間など)。照会 (queryUsage) と同じく、数える枠は使用不可、
      // 観測は記録先が無いので何も記録しない。
      if (isEnforced(resolved.constraint)) {
        return {
          ok: false,
          reason: "exhausted",
          constraintId: resolved.constraint.constraintId,
        };
      }
      continue;
    }
    if (!unique.has(resolved.key)) unique.set(resolved.key, resolved);
  }
  for (const { constraint, key, limit } of unique.values()) {
    const used = index.get(key)?.amount ?? 0;
    if (isEnforced(constraint) && used + amount > limit) {
      return {
        ok: false,
        reason: "exhausted",
        constraintId: constraint.constraintId,
      };
    }
  }

  const deltas: UsageDelta[] = [];
  const nextBuckets = [...accounting.buckets];
  const position = new Map<string, number>(
    nextBuckets.map((bucket, i) => [bucket.key, i])
  );
  for (const { constraint, key } of unique.values()) {
    deltas.push({ bucketKey: key, delta: amount });
    const at = position.get(key);
    if (at !== undefined) {
      const current = nextBuckets[at]!;
      nextBuckets[at] = { ...current, amount: current.amount + amount };
    } else {
      position.set(key, nextBuckets.length);
      nextBuckets.push({
        key,
        constraintId: constraint.constraintId,
        measure: constraint.measure,
        period: constraint.period,
        turnId: context.clock.turnId,
        stepId: context.clock.stepId,
        battleId: context.clock.battleId,
        playerId:
          constraint.playerScope === "beneficiary"
            ? (context.beneficiaryPlayerId ?? context.playerId)
            : context.playerId,
        amount,
      });
    }
  }

  const operation: UsageOperation = {
    operationId,
    turnId: context.clock.turnId,
    status: "applied",
    deltas,
    ...(options.released === true ? { released: true } : {}),
  };
  return {
    ok: true,
    accounting: {
      ...accounting,
      buckets: nextBuckets,
      operations:
        options.receipt === false
          ? accounting.operations
          : [...accounting.operations, operation],
    },
    operation,
    replayed: false,
  };
}

// ---------------------------------------------------------------
// refund (当該操作の差分だけを一度取り消す)
// ---------------------------------------------------------------

/**
 * 操作 (receipt) の差分だけを戻す。最新の同ラベル記録を探索しない。
 * 他の操作や他プレイヤーの消費は減らさない。二重取消・未知のIDは状態を変えない。
 * 期限切れで整理済みの bucket は戻す対象が無いため無視する。
 */
export function refundUsage(
  accounting: EffectAccounting,
  operationId: string
): EffectAccounting {
  const operation = findOperation(accounting, operationId);
  if (!operation || operation.status === "refunded") return accounting;

  const deltaByKey = new Map(
    operation.deltas.map((d) => [d.bucketKey, d.delta])
  );
  const buckets: UsageBucket[] = [];
  for (const bucket of accounting.buckets) {
    const delta = deltaByKey.get(bucket.key);
    if (delta === undefined) {
      buckets.push(bucket);
      continue;
    }
    const amount = Math.max(0, bucket.amount - delta);
    if (amount > 0) buckets.push({ ...bucket, amount });
  }
  return {
    ...accounting,
    buckets,
    operations: accounting.operations.map((op) =>
      op.operationId === operationId ? { ...op, status: "refunded" } : op
    ),
  };
}

/** 制約と文脈から bucketキーを列挙する (成立しない枠は除く)。取消対象の特定に使う。 */
export function usageBucketKeys(
  constraints: readonly UsageConstraint[],
  context: UsageContext
): string[] {
  const keys: string[] = [];
  for (const constraint of constraints) {
    const made = makeBucketKey(constraint, context);
    if (made !== null && "key" in made) keys.push(made.key);
  }
  return keys;
}

/** 継続/pending/取消snapshotから参照されなくなった操作を release する。 */
export function releaseOperation(
  accounting: EffectAccounting,
  operationId: string
): EffectAccounting {
  const operation = findOperation(accounting, operationId);
  if (!operation || operation.released === true) return accounting;
  return {
    ...accounting,
    operations: accounting.operations.map((op) =>
      op.operationId === operationId ? { ...op, released: true } : op
    ),
  };
}

// ---------------------------------------------------------------
// grant (権利の付与。固有 grantId、再開時の二重付与を防ぐ)
// ---------------------------------------------------------------

export type GrantUsageResult =
  | {
      ok: true;
      accounting: EffectAccounting;
      grantId: string;
      replayed: boolean;
    }
  | { ok: false; reason: "invalid_amount" | "grant_conflict" };

/**
 * 権利を付与する。同じ grantId の再送は何も追加しない (再開時の二重付与防止)。
 * 同じ grantId で内容が異なる付与は競合として拒否する。
 */
export function grantUsage(
  accounting: EffectAccounting,
  grant: UsageGrant
): GrantUsageResult {
  if (!isValidAmount(grant.total))
    return { ok: false, reason: "invalid_amount" };
  const existing = accounting.grants.find((g) => g.grantId === grant.grantId);
  if (existing) {
    const same =
      existing.operationId === grant.operationId &&
      existing.total === grant.total &&
      existing.playerId === grant.playerId;
    return same
      ? { ok: true, accounting, grantId: grant.grantId, replayed: true }
      : { ok: false, reason: "grant_conflict" };
  }
  return {
    ok: true,
    accounting: { ...accounting, grants: [...accounting.grants, grant] },
    grantId: grant.grantId,
    replayed: false,
  };
}

/** 付与の取消 (付与操作の取消)。 */
export function revokeGrant(
  accounting: EffectAccounting,
  grantId: string
): EffectAccounting {
  if (!accounting.grants.some((g) => g.grantId === grantId)) return accounting;
  return {
    ...accounting,
    grants: accounting.grants.filter((g) => g.grantId !== grantId),
  };
}

// ---------------------------------------------------------------
// 時計・整理
// ---------------------------------------------------------------

/**
 * 生存する時計 (現在 + 中断元。呼出側が GameState から導出して渡す) に属さない
 * bucket / 失効した grant を整理する。
 * 参照中 (released でない) の receipt は期限切れだけでは消さない。
 */
export function pruneAccounting(
  accounting: EffectAccounting,
  live: readonly UsageClock[]
): EffectAccounting {
  const buckets = accounting.buckets.filter((bucket) =>
    isBucketLive(bucket, live)
  );
  const grants = accounting.grants.filter((grant) =>
    isBucketLive(
      {
        period: grant.expires.period,
        turnId: grant.expires.turnId,
        stepId: grant.expires.stepId,
        battleId: grant.expires.battleId ?? null,
      },
      live
    )
  );
  // 参照中 (released でない) の操作は期限切れだけでは消さない。
  // released な操作は、作成ターンが生存しなくなったら整理する (保持を有界にする)。
  const operations = accounting.operations.filter(
    (op) =>
      op.released !== true || live.some((clock) => clock.turnId === op.turnId)
  );
  if (
    buckets.length === accounting.buckets.length &&
    grants.length === accounting.grants.length &&
    operations.length === accounting.operations.length
  ) {
    return accounting;
  }
  return { ...accounting, buckets, grants, operations };
}
