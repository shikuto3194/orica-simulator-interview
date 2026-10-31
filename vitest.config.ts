import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

// "hanging-process" reporter requires why-is-node-running at onInit(), which enables an
// async_hooks hook that captures a stack-traced Error for every async resource created in
// the main process for the entire run duration (see why-is-node-running README: "should be
// your first require"). Kept default-off: P3-122 traced the recurring
// "[vitest-worker]: Timeout calling onTaskUpdate" auto-merge gate flake to this reporter —
// its continuous async_hooks overhead in the main thread, combined with concurrent lane
// system load, occasionally delays main-thread RPC processing past birpc's timeout for a
// worker's onTaskUpdate call, surfacing as a spurious "1 unhandled error" even though every
// test already passed. Opt in with VITEST_HANGING_PROCESS_REPORTER=1 when diagnosing an
// actual process-won't-exit hang.
const reporters = ["default"];
if (process.env.VITEST_HANGING_PROCESS_REPORTER === "1") {
  reporters.push("hanging-process");
}

export default defineConfig({
  // ワークスペース参照を src へ解決する。`apps/playground-web/vite.config.ts` の
  // alias と `tsconfig.base.json` の `paths` に揃えるための設定。
  //
  // 背景 (2026-08-02): この alias が無いと `@orica/card-data` は package.json の
  // exports (`./dist/index.js`) に解決され、vitest は **ビルド済み dist** を検証して
  // いた。`pnpm test` は card-data を再ビルドしないため、src を壊してもテストは
  // 緑のまま通り続ける (textRef を意図的に破壊して回帰テストの発火を確認しようと
  // した際に発覚)。dist は .gitignore 対象のローカル成果物なので、staleness の度合いは
  // マシン/worktree ごとに異なり、テスト結果が再現しない。実際この時点で
  // dist は 2026-06-11 ビルドのままで、BSTH11 は dist に存在すらしていなかった。
  //
  // tsc は既に tsconfig.base.json の paths で src を見ていたため、
  // 「型は src・実行は dist」という食い違いが型エラー無しで成立していた。
  resolve: {
    alias: {
      "@orica/rules-core": fileURLToPath(
        new URL("./packages/rules-core/src/index.ts", import.meta.url)
      ),
      "@orica/card-data": fileURLToPath(
        new URL("./packages/card-data/src/index.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        // Shared PC validation follows the I0 two-compute-worker limit.
        maxForks: 2,
      },
    },
    reporters,
    coverage: {
      provider: "v8",
      include: ["packages/rules-core/src/**/*.ts"],
      reporter: ["text", "text-summary"],
    },
  },
});
