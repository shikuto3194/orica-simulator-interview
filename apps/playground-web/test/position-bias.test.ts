/**
 * 対照実験: ランダム同士で先攻(alice)/後攻(bob) の勝率バイアスを測る。
 * MCTS 評価の公平性 / winnerOf の正当性チェック。実行: RUN_PERF=1 vitest run position-bias
 */
import { describe, it } from "vitest";
import { buildEngine, playGame, randomDeck } from "./selfplay-driver";

// アサーション無しの診断用ベンチ（数十局の自己対戦・長時間同期ブロック）は既定
// `pnpm test`（merge ゲート）から除外する（vitest birpc onTaskUpdate タイムアウト
// 偽陽性回避、position-bias-diagnose.test.ts と同型）。RUN_PERF=1 で実行する。
describe.runIf(process.env.RUN_PERF === "1")(
  "position bias (random vs random)",
  () => {
    it("measures first/second player win rate", () => {
      const engine = buildEngine();
      const GAMES = Number(process.env.PB_GAMES ?? 80);
      let alice = 0;
      let bob = 0;
      let nondecisive = 0;
      for (let g = 0; g < GAMES; g++) {
        const res = playGame({
          engine,
          decks: [randomDeck(engine.cards), randomDeck(engine.cards)],
          maxSteps: 1500,
        });
        if (res.outcome === "natural" && res.winner === "alice") alice++;
        else if (res.outcome === "natural" && res.winner === "bob") bob++;
        else nondecisive++;
      }
      const dec = alice + bob;

      console.log("\n===== POSITION BIAS (random vs random) =====");
      console.log(`games        : ${GAMES}`);
      console.log(`alice (1st)  : ${alice}`);
      console.log(`bob (2nd)    : ${bob}`);
      console.log(`nondecisive  : ${nondecisive}`);
      console.log(
        `alice win-rate among decisive: ${dec ? ((alice / dec) * 100).toFixed(1) : "n/a"}%`
      );
      console.log("============================================\n");
    }, 300_000);
  }
);
