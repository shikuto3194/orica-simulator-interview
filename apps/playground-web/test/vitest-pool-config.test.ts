/**
 * 機械ガード: 検証の実行基盤 (vitest の pool) の契約を固定する。
 *
 * - 既定は worker threads。ファイルごとの隔離 (isolate) は forks と同じく維持する。
 *   `isolate: false` はファイル間のモック・モジュール状態の漏れで偽の失敗/偽の通過を
 *   生むため採用しない (2026-11-01 棄却: apps の 7 ファイル 25 件が失敗した)。
 * - 計算 worker は I0 の 2 本まで。
 * - ORICA_VITEST_POOL=forks で子プロセス方式へ戻せる。未知の値は黙って既定に
 *   せず失敗させる。
 * - pool・隔離・上限の正源は scripts/harness/vitest-pool.mjs の 1 箇所。基底設定
 *   (vitest.config.ts) と単体入口 (vitest-unit.config.mjs) はそこから得る。単体入口は
 *   基底より後に適用するので、別の基底設定でも上限や方式を変えられない
 *   (敵対的な基底設定を使う実行時の検査は scripts/test-unit-entry.mjs)。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";

type PoolConfig = {
  test: {
    pool: string;
    isolate?: boolean;
    maxWorkers?: number;
    minWorkers?: number;
    include: string[];
    poolOptions: {
      threads: { minThreads: number; maxThreads: number; isolate?: boolean };
      forks: { minForks: number; maxForks: number; isolate?: boolean };
    };
  };
};

const originalPool = process.env.ORICA_VITEST_POOL;
const originalUnitFiles = process.env.ORICA_UNIT_TEST_FILES;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function loadBase(pool?: string): Promise<PoolConfig> {
  vi.resetModules();
  restore("ORICA_VITEST_POOL", pool);
  return (await import("../../../vitest.config")).default as PoolConfig;
}

async function loadUnit(pool?: string): Promise<PoolConfig> {
  vi.resetModules();
  restore("ORICA_VITEST_POOL", pool);
  process.env.ORICA_UNIT_TEST_FILES = JSON.stringify([
    "apps/playground-web/test/vitest-pool-config.test.ts",
  ]);
  return (await import("../../../scripts/harness/vitest-unit.config.mjs"))
    .default as PoolConfig;
}

afterEach(() => {
  restore("ORICA_VITEST_POOL", originalPool);
  restore("ORICA_UNIT_TEST_FILES", originalUnitFiles);
});

describe("vitest pool configuration", () => {
  it("既定は worker threads で、2 worker 上限とファイルごとの隔離を保つ", async () => {
    const { test } = await loadBase(undefined);
    expect(test.pool).toBe("threads");
    expect(test.poolOptions.threads).toEqual({
      minThreads: 1,
      maxThreads: 2,
      isolate: true,
    });
    // forks へ戻した場合も同じ上限と隔離を使う。
    expect(test.poolOptions.forks).toEqual({
      minForks: 1,
      maxForks: 2,
      isolate: true,
    });
    expect(test.isolate).toBe(true);
    // ファイル単位の pool 切替 (非推奨) は使わない。
    expect(test.poolMatchGlobs).toBeUndefined();
    // pool 指定を読む別方式 (vm 系など) へ逸れても 2 本を超えない。
    expect(test.maxWorkers).toBe(2);
    expect(test.minWorkers).toBe(1);
    // 検証済みの方式は threads / forks のみ。vm 系 pool の設定を黙って足さない。
    expect(Object.keys(test.poolOptions).sort()).toEqual(["forks", "threads"]);
  });

  it("実際の実行方式が設定どおりである (CLI の --pool 等で逸れていない)", () => {
    // isMainThread: threads なら worker thread (false)、forks なら子プロセスの
    // メインスレッド (true)。設定オブジェクトだけでは見えない実行時の食い違いを検出する。
    // 戻すときは ORICA_VITEST_POOL=forks を使う (--pool では変えない)。
    const expectedPool =
      process.env.ORICA_VITEST_POOL === "forks" ? "forks" : "threads";
    expect(isMainThread).toBe(expectedPool === "forks");
  });

  it("環境変数で計算 worker が 2 本を超えて上書きされていない", () => {
    // vitest は設定の解決後に VITEST_MAX_* / VITEST_MIN_* で poolOptions を上書きする。
    // 設定オブジェクトの検査だけでは検知できないため、環境そのものを検査する。
    for (const name of [
      "VITEST_MAX_THREADS",
      "VITEST_MIN_THREADS",
      "VITEST_MAX_FORKS",
      "VITEST_MIN_FORKS",
    ]) {
      const value = process.env[name];
      if (value === undefined || value === "") continue;
      const workers = Number.parseInt(value, 10);
      expect(
        Number.isInteger(workers) && workers >= 1 && workers <= 2,
        `${name}=${value} は I0 の計算 worker 2 本を超える`
      ).toBe(true);
    }
  });

  it("worker 数の環境変数上書きは、設定の読込時点で 2 本を超えると失敗させる", async () => {
    const { vitestPoolSettings, assertWorkerEnvironment } =
      await import("../../../scripts/harness/vitest-pool.mjs");
    for (const name of [
      "VITEST_MAX_THREADS",
      "VITEST_MIN_THREADS",
      "VITEST_MAX_FORKS",
      "VITEST_MIN_FORKS",
    ]) {
      for (const ok of ["1", "2", ""]) {
        expect(() => assertWorkerEnvironment({ [name]: ok })).not.toThrow();
      }
      // vitest は parseInt() で読む。Number() と解釈が割れる形 ("0b10" は
      // Number では 2 だが parseInt では 0) も、空白付きや符号付きも拒否する。
      for (const bad of [
        "3",
        "8",
        "0",
        "-1",
        "abc",
        "2abc",
        "1.5",
        "0b10",
        "0o2",
        "0.2e1",
        " 2",
        "2 ",
        "+2",
        "02",
        "１",
      ]) {
        expect(
          () => vitestPoolSettings({ [name]: bad }),
          `${name}=${bad}`
        ).toThrow(new RegExp(name));
      }
    }
    // 設定ファイル自体の読込も、同じ検査で失敗する (どの vitest 実行にも効く)。
    vi.resetModules();
    process.env.VITEST_MAX_THREADS = "8";
    try {
      await expect(import("../../../vitest.config")).rejects.toThrow(
        /VITEST_MAX_THREADS/
      );
    } finally {
      delete process.env.VITEST_MAX_THREADS;
    }
  });

  it("ルート直下に vitest の workspace / projects 定義ファイルが無い", () => {
    // test.projects / test.workspace が無いと、vitest はルートの
    // vitest.workspace.* / vitest.projects.* を自動で探して読む (3.2.4)。
    // それらは project ごとに pool 設定を持てるため、単体入口が基底から取り除く
    // 対象 (projects / workspace) では塞げない。存在しないことを固定する。
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const found = ["vitest.workspace", "vitest.projects"].flatMap((name) =>
      [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]
        .map((extension) => name + extension)
        .filter((file) => existsSync(root + file))
    );
    expect(found).toEqual([]);
  });

  it("ORICA_VITEST_POOL=forks で子プロセス方式へ戻せる", async () => {
    const { test } = await loadBase("forks");
    expect(test.pool).toBe("forks");
    expect(test.poolOptions.forks.maxForks).toBe(2);
    expect(test.poolOptions.forks.isolate).toBe(true);
  });

  it("未知の pool 名は黙って既定にせず失敗させる", async () => {
    await expect(loadBase("fork")).rejects.toThrow(/ORICA_VITEST_POOL/);
    await expect(loadBase("")).rejects.toThrow(/ORICA_VITEST_POOL/);
    await expect(loadBase("vmThreads")).rejects.toThrow(/ORICA_VITEST_POOL/);
  });

  it("共有モジュールは環境変数を読み、既定・forks・不正値を区別する", async () => {
    const { vitestPoolSettings, resolveVitestPool, COMPUTE_WORKERS } =
      await import("../../../scripts/harness/vitest-pool.mjs");
    expect(COMPUTE_WORKERS).toBe(2);
    expect(resolveVitestPool({})).toBe("threads");
    expect(resolveVitestPool({ ORICA_VITEST_POOL: "forks" })).toBe("forks");
    expect(() => resolveVitestPool({ ORICA_VITEST_POOL: "threadz" })).toThrow(
      /ORICA_VITEST_POOL/
    );
    expect(vitestPoolSettings({}).maxWorkers).toBe(COMPUTE_WORKERS);
  });

  it.each([undefined, "threads", "forks"])(
    "単体入口は pool=%s でも基底設定と同じ pool 設定を持つ",
    async (pool) => {
      const base = await loadBase(pool);
      const unit = await loadUnit(pool);
      expect(unit.test.pool).toBe(base.test.pool);
      expect(unit.test.poolOptions).toEqual(base.test.poolOptions);
      expect(unit.test.isolate).toBe(true);
      expect(unit.test.poolMatchGlobs).toBeUndefined();
      expect(unit.test.include).toEqual([
        "apps/playground-web/test/vitest-pool-config.test.ts",
      ]);
    }
  );
});
