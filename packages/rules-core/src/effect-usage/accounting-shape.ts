/**
 * 保存・room から読み込んだ `effectAccounting` の形と値の検査 (P3-170)。
 *
 * 版が1でも、破損・手編集・部分書込みの値が後段で TypeError や使用枠の増加になってはならない。
 * 読込口 (migrateEffectAccounting) がこの検査で明示エラーにする。上限・期間の意味の検査は台帳の
 * consume 側が行うので、ここは「JSON として壊れていないか」だけを見る (意味の推測補完はしない)。
 * 依存を持たない軽量モジュール (engine 非ロードの読込口からも使える)。
 */

type Rec = Record<string, unknown>;

const PERIODS = new Set([
  "game",
  "turn",
  "step",
  "battle",
  "event",
  "activation",
]);
const MEASURES = new Set(["use", "amount", "observation", "fact"]);
const OPERATION_STATUSES = new Set(["applied", "refunded"]);

const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

export interface AccountingShapeProblem {
  path: string;
  detail: string;
}

const NON_NEGATIVE = "must be a non-negative integer";
const NON_EMPTY = "must be a non-empty string";

/** 問題が無ければ undefined。最初に見つけた問題だけを返す (path は effectAccounting からの相対)。 */
export function findAccountingShapeProblem(
  accounting: Rec
): AccountingShapeProblem | undefined {
  const bad = (path: string, detail: string): AccountingShapeProblem => ({
    path,
    detail,
  });
  if (!isCount(accounting.nextOperationSeq))
    return bad("nextOperationSeq", NON_NEGATIVE);

  const { buckets, grants, operations } = accounting;
  if (!Array.isArray(buckets)) return bad("buckets", "must be an array");
  if (!Array.isArray(grants)) return bad("grants", "must be an array");
  if (!Array.isArray(operations)) return bad("operations", "must be an array");

  const bucketKeys = new Set<string>();
  for (const [i, b] of buckets.entries()) {
    const at = `buckets[${i}]`;
    if (!isRec(b)) return bad(at, "must be an object");
    if (!isText(b.key)) return bad(`${at}.key`, NON_EMPTY);
    if (bucketKeys.has(b.key)) return bad(`${at}.key`, "duplicate bucket key");
    bucketKeys.add(b.key);
    if (!isText(b.constraintId)) return bad(`${at}.constraintId`, NON_EMPTY);
    if (typeof b.measure !== "string" || !MEASURES.has(b.measure))
      return bad(`${at}.measure`, "unknown measure");
    if (typeof b.period !== "string" || !PERIODS.has(b.period))
      return bad(`${at}.period`, "unknown period");
    if (!isCount(b.turnId)) return bad(`${at}.turnId`, NON_NEGATIVE);
    if (!isCount(b.stepId)) return bad(`${at}.stepId`, NON_NEGATIVE);
    if (b.battleId !== null && typeof b.battleId !== "string")
      return bad(`${at}.battleId`, "must be a string or null");
    if (typeof b.playerId !== "string")
      return bad(`${at}.playerId`, "must be a string");
    if (!isCount(b.amount)) return bad(`${at}.amount`, NON_NEGATIVE);
  }

  const grantIds = new Set<string>();
  for (const [i, g] of grants.entries()) {
    const at = `grants[${i}]`;
    if (!isRec(g)) return bad(at, "must be an object");
    if (!isText(g.grantId)) return bad(`${at}.grantId`, NON_EMPTY);
    if (grantIds.has(g.grantId))
      return bad(`${at}.grantId`, "duplicate grant id");
    grantIds.add(g.grantId);
    if (!isText(g.grantKind)) return bad(`${at}.grantKind`, NON_EMPTY);
    if (!isText(g.playerId)) return bad(`${at}.playerId`, NON_EMPTY);
    if (!isCount(g.total)) return bad(`${at}.total`, NON_NEGATIVE);
    if (!isText(g.operationId)) return bad(`${at}.operationId`, NON_EMPTY);
    const expires = g.expires;
    if (!isRec(expires)) return bad(`${at}.expires`, "must be an object");
    if (typeof expires.period !== "string" || !PERIODS.has(expires.period))
      return bad(`${at}.expires.period`, "unknown period");
    if (!isCount(expires.turnId))
      return bad(`${at}.expires.turnId`, NON_NEGATIVE);
    if (!isCount(expires.stepId))
      return bad(`${at}.expires.stepId`, NON_NEGATIVE);
  }

  const operationIds = new Set<string>();
  for (const [i, op] of operations.entries()) {
    const at = `operations[${i}]`;
    if (!isRec(op)) return bad(at, "must be an object");
    if (!isText(op.operationId)) return bad(`${at}.operationId`, NON_EMPTY);
    if (operationIds.has(op.operationId))
      return bad(`${at}.operationId`, "duplicate operation id");
    operationIds.add(op.operationId);
    if (!isCount(op.turnId)) return bad(`${at}.turnId`, NON_NEGATIVE);
    if (typeof op.status !== "string" || !OPERATION_STATUSES.has(op.status))
      return bad(`${at}.status`, "unknown status");
    if (!Array.isArray(op.deltas))
      return bad(`${at}.deltas`, "must be an array");
    for (const [j, d] of op.deltas.entries()) {
      const dAt = `${at}.deltas[${j}]`;
      if (!isRec(d)) return bad(dAt, "must be an object");
      if (!isText(d.bucketKey)) return bad(`${dAt}.bucketKey`, NON_EMPTY);
      if (!isInt(d.delta)) return bad(`${dAt}.delta`, "must be an integer");
    }
  }
  return undefined;
}
