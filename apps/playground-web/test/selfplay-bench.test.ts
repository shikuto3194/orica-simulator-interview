/**
 * Self-play スループット計測ベンチ (DL/MCTS 可否判定用)。
 * 堅牢ドライバ (selfplay-driver) を使用。
 *
 * 主指標: steps/秒 (= getLegalActions + applyLegalAction のスループット)。
 * 副指標: games/秒, 平均ステップ数, 自然終局率, 残 stuck 原因。
 *
 * 実行: vitest run selfplay-bench   (BENCH_GAMES / BENCH_MAX_STEPS で規模調整)
 */
import { describe, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { buildEngine, playRandomGame, type Outcome } from "./selfplay-driver";

const GAMES = Number(process.env.BENCH_GAMES ?? 300);
const MAX_STEPS = Number(process.env.BENCH_MAX_STEPS ?? 4000);

function norm(msg: string): string {
  return msg
    .replace(/\(.*?\)/g, "")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

// ベンチマーク（~60s+ の同期ループ）は既定 `pnpm test`（merge ゲート）から除外する。
// 1 テストで worker が長時間ブロックすると vitest birpc heartbeat (onTaskUpdate) が
// タイムアウトし全 green でも run が exit 1 化するため。RUN_PERF=1 で実行する。
describe.runIf(process.env.RUN_PERF === "1")(
  "self-play throughput benchmark",
  () => {
    it(`runs ${GAMES} random self-play games and reports throughput`, () => {
      const engine = buildEngine();
      const opts = { ...engine, maxSteps: MAX_STEPS };

      for (let i = 0; i < 5; i++) playRandomGame(opts); // warmup

      let totalSteps = 0;
      let maxGameMs = 0;
      const counts: Record<Outcome, number> = {
        natural: 0,
        capped: 0,
        stuck: 0,
        error: 0,
      };
      const stuckReasons: Record<string, number> = {};

      const t0 = performance.now();
      for (let g = 0; g < GAMES; g++) {
        const gs = performance.now();
        let res;
        try {
          res = playRandomGame(opts);
        } catch (e) {
          res = {
            steps: 0,
            outcome: "error" as Outcome,
            winner: null,
            lastError: (e as Error).message,
          };
        }
        const ms = performance.now() - gs;
        if (ms > maxGameMs) maxGameMs = ms;
        totalSteps += res.steps;
        counts[res.outcome]++;
        if (
          (res.outcome === "stuck" || res.outcome === "error") &&
          res.lastError
        )
          stuckReasons[norm(res.lastError)] =
            (stuckReasons[norm(res.lastError)] ?? 0) + 1;
      }
      const totalMs = performance.now() - t0;

      const stepsPerSec = (totalSteps / totalMs) * 1000;
      const top = Object.entries(stuckReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      console.log("\n===== SELF-PLAY THROUGHPUT =====");
      console.log(`cards in pool        : ${ALL_CARDS.length}`);
      console.log(`games                : ${GAMES}`);
      console.log(`total wall time      : ${totalMs.toFixed(0)} ms`);
      console.log(`total steps          : ${totalSteps}`);
      console.log(`avg steps / game     : ${(totalSteps / GAMES).toFixed(1)}`);
      console.log(`STEPS / SECOND       : ${stepsPerSec.toFixed(0)}`);
      console.log(
        `microseconds / step  : ${((totalMs * 1000) / totalSteps).toFixed(1)} us`
      );
      console.log(
        `games / second       : ${((GAMES / totalMs) * 1000).toFixed(1)}`
      );
      console.log(`max single-game time : ${maxGameMs.toFixed(1)} ms`);
      console.log(
        `outcomes             : natural=${counts.natural} capped=${counts.capped} stuck=${counts.stuck} error=${counts.error}`
      );
      if (top.length > 0) {
        console.log("-- remaining stuck/error reasons --");
        for (const [k, v] of top) console.log(`  ${v}\t${k}`);
      }
      console.log("================================\n");
    }, 600_000);
  }
);
