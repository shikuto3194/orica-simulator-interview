/**
 * Self-play fuzz ゲート (無人ループのマージ前検証用)。
 *
 * ランダムポリシーで N 局の完全対戦を回し、engine の crash / stuck / capped を検出する。
 * ベンチ (selfplay-bench) と違い品質ゲートなので、error / stuck が 1 件でもあれば fail。
 * capped (maxSteps 到達) は自然終局でもループ非該当とも証明できないため、未分類の
 * stuck 相当として fail し、seed を修正対象として報告する。
 *
 * 実行: pnpm fuzz   (FUZZ_GAMES / FUZZ_MAX_STEPS で規模調整。既定 200 局)
 *
 * 通常の `pnpm test` ではスキップされる (RUN_FUZZ=1 のときのみ実行)。
 * 全 suite に毎回 30 秒級の負荷を足さない & ゲートは明示実行で使う。
 */
import { describe, expect, it } from "vitest";

import {
  buildFuzzSeedPlan,
  DEFAULT_FUZZ_REGRESSION_SEEDS,
} from "../../../scripts/fuzz-seed-ledger.mjs";
import {
  buildEngine,
  mulberry32,
  playGameAsync,
  type Outcome,
} from "./selfplay-driver";

const ENABLED = process.env.RUN_FUZZ === "1";
const GAMES = Number(process.env.FUZZ_GAMES ?? 200);
const MAX_STEPS = Number(process.env.FUZZ_MAX_STEPS ?? 4000);
// 固定回帰 seed を毎回含め、残りを run-fuzz.mjs が予約した範囲から採る。
const SEED_BASE = Number(process.env.FUZZ_SEED_BASE ?? 10_000);
const configuredRegressionSeeds = String(
  process.env.FUZZ_REGRESSION_SEEDS ?? DEFAULT_FUZZ_REGRESSION_SEEDS.join(",")
)
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value));
const { seeds: SEEDS, regressionSeeds: REGRESSION_SEEDS } = buildFuzzSeedPlan({
  games: GAMES,
  rotatingSeedBase: SEED_BASE,
  regressionSeeds: configuredRegressionSeeds,
});
const TEST_TIMEOUT_MS = Number(
  process.env.FUZZ_TEST_TIMEOUT_MS ?? Math.max(600_000, GAMES * 1_500)
);

function norm(msg: string): string {
  return msg
    .replace(/\(.*?\)/g, "")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

describe.runIf(ENABLED)("self-play fuzz gate", () => {
  it(
    `plays ${GAMES} random games without crash, stuck, or unclassified cap`,
    async () => {
      const engine = buildEngine();
      const opts = { ...engine, maxSteps: MAX_STEPS };

      const counts: Record<Outcome, number> = {
        natural: 0,
        capped: 0,
        stuck: 0,
        error: 0,
      };
      const failures: Record<string, number> = {};
      const badSeeds: Array<{ seed: number; outcome: Outcome; msg?: string }> =
        [];

      for (let g = 0; g < GAMES; g++) {
        const seed = SEEDS[g]!;
        let res;
        try {
          res = await playGameAsync({
            engine,
            maxSteps: opts.maxSteps,
            rng: mulberry32(seed),
          });
        } catch (e) {
          res = {
            steps: 0,
            outcome: "error" as Outcome,
            winner: null,
            lastError: (e as Error).stack ?? (e as Error).message,
          };
        }
        counts[res.outcome]++;
        if (res.outcome !== "natural") {
          const msg =
            res.outcome === "capped"
              ? `${res.lastError ?? `maxSteps=${MAX_STEPS} reached without a natural game result`}; unclassified cap is treated as stuck`
              : res.lastError;
          badSeeds.push({ seed, outcome: res.outcome, msg });
          if (msg) failures[norm(msg)] = (failures[norm(msg)] ?? 0) + 1;
        }
        // 定期的にイベントループへ制御を返す。同期 CPU ループのままだと 1 テストが
        // vitest worker スレッドを長時間 (200 局で ~75s) ブロックし、worker が
        // メッセージポートを drain できず birpc の「Timeout calling onTaskUpdate」
        // 偽陽性 (テスト自体は pass) を招く。yield で worker が reporter RPC の ack を
        // 受け取れるようにする。fuzz の意味論 (seed 列・判定) は不変。
        if ((g & 3) === 3) await new Promise((r) => setTimeout(r, 0));
      }

      console.log(
        `[fuzz] games=${GAMES} regression=${Math.min(
          REGRESSION_SEEDS.length,
          GAMES
        )} discovery=${Math.max(
          0,
          GAMES - REGRESSION_SEEDS.length
        )} seedBase=${SEED_BASE} natural=${counts.natural} capped=${counts.capped} stuck=${counts.stuck} error=${counts.error}`
      );
      for (const [k, v] of Object.entries(failures).sort((a, b) => b[1] - a[1]))
        console.log(`  ${v}\t${k}`);
      for (const b of badSeeds)
        console.log(`  seed=${b.seed} ${b.outcome}: ${b.msg ?? "?"}`);

      expect(counts.error, "engine crash detected").toBe(0);
      expect(counts.stuck, "stuck game detected").toBe(0);
      expect(
        counts.capped,
        "unclassified capped game detected (treated as stuck)"
      ).toBe(0);
    },
    TEST_TIMEOUT_MS
  );
});
