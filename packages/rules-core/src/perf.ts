/**
 * 開発モード用パフォーマンス計測ユーティリティ。
 * production ビルドではノーオプ。
 *
 * rules-core は lib: ["ES2023"] のみで DOM / Node 型を含まないため、
 * ランタイムに存在するグローバルだけ最小限宣言する。
 */
declare const process: { env: Record<string, string | undefined> } | undefined;
declare const performance: { now(): number };
declare const console: { warn(...args: unknown[]): void };

const PERF_ENABLED =
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "production" &&
  typeof performance !== "undefined";

const WARN_THRESHOLD_MS: Record<string, number> = {
  getLegalActions: 100,
  recomputeContinuousEffects: 50,
  executeStructuredEffect: 50,
  runStateBasedActions: 30,
  collectStateBasedActions: 20,
};

const DEFAULT_THRESHOLD_MS = 50;

export function measureTime<T>(label: string, fn: () => T): T {
  if (!PERF_ENABLED) return fn();
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  const threshold = WARN_THRESHOLD_MS[label] ?? DEFAULT_THRESHOLD_MS;
  if (ms > threshold) {
    console.warn(
      `[PERF] ${label}: ${ms.toFixed(1)}ms (threshold: ${threshold}ms)`
    );
  }
  return result;
}
