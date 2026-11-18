#!/usr/bin/env node
/**
 * vitest 起動 wrapper — worker が Jest 用 legacy フラグを混ぜても弾かないよう
 * vitest の同等フラグへ自動翻訳する。
 *
 * 背景 (2026-06-20): Codex worker が `pnpm test -- --runInBand` を投げたところ
 * vitest 3.2.4 の CAC checkUnknownOptions が strict reject (`CACError: Unknown
 * option --runInBand`) で test gate が立たず、verifier の refute=0 ループに
 * 入れず engine-drain lane が詰まった。`--runInBand` は Jest legacy、vitest の
 * 等価は `--no-file-parallelism` (3.x 以降)。worker (LLM) は autonomous で
 * フラグ規約を教えにくいため、wrapper 側で機械的に吸収する。
 *
 * 翻訳ルール (現状 1 件、必要に応じて追加):
 *   --runInBand        → --no-file-parallelism
 *
 * その他の引数はそのまま vitest へ passthrough。固定されたローカルCLIをNodeで
 * 直接起動し、空白を含むファイル名もshellの再解釈なしに渡す。
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ALIAS_MAP = {
  "--runInBand": "--no-file-parallelism",
};

const incoming = process.argv.slice(2);
const translated = incoming.map((a) => ALIAS_MAP[a] ?? a);

// A misspelled filter must not turn an untested change green.
const baseArgs = ["run"];

const result = spawnSync(
  process.execPath,
  [resolve("node_modules/vitest/vitest.mjs"), ...baseArgs, ...translated],
  {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  }
);

process.exit(result.status ?? 1);
