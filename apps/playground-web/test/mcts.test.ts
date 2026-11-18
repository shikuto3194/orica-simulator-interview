/**
 * ISMCTS スモークテスト。現エンジン (カード未完) を基盤に「探索が機能する」ことを検証。
 * 強さ (vs random 勝ち越し) は scope 上保留 — 評価器 (現状: 手書きヒューリスティック) の質に依存し、
 * 後段の value ネットで初めて意味を持つ。ここでは機械の正当性のみ assert し、勝率は報告のみ。
 * 実行: vitest run mcts   (MCTS_GAMES / MCTS_ITERS で調整)
 *
 * 既知の所見 (2026-06: 14_dl-ai-architecture.md): 浅いロールアウト + ライフ重視ヒューリスティックの
 * MCTS は「攻めると自ライフを risk する」を過大評価して turtling に陥り、attack バイアス random に
 * 勝てない。終局までの深いロールアウトor value ネットが必要。
 */
import { describe, it, expect, afterEach } from "vitest";
import { initializeGame } from "@orica/rules-core";
import {
  buildEngine,
  playGame,
  randomDeck,
  legalActionsFor,
  advance,
} from "./selfplay-driver";
import { makeMctsPolicy, mctsSearch } from "./mcts";

const GAMES = Number(process.env.MCTS_GAMES ?? 6);
const ITERS = Number(process.env.MCTS_ITERS ?? 40);
const ROLLOUT = Number(process.env.MCTS_ROLLOUT ?? 24);
const MAX_STEPS = Number(process.env.MCTS_MAX_STEPS ?? 1200);

// 重い e2e 対局テスト（GAMES 局を同期実行し ~60s ブロック）は selfplay-fuzz と同様に
// 既定の `pnpm test`（merge ゲート）からは除外する。1 テストで worker が長時間ブロックすると
// vitest birpc heartbeat (onTaskUpdate) がタイムアウトし、全 green でも run が exit 1 化して
// ゲートを常時赤にしていたため。end-to-end の no-crash 担保は fuzz ゲート（FUZZ_GAMES=200）が
// 別途担う。強度/対局調査時のみ RUN_PERF=1 で実行する（重い perf/diagnostic 共通フラグ）。
const E2E_ENABLED = process.env.RUN_PERF === "1";

/**
 * 決定論的 PRNG (mulberry32)。`Math.random` を seed 固定の列に差し替えて
 * randomDeck / rollout の乱数を再現可能にし、テストの flaky を排除する。
 * 過去の flaky (expected null not to be null) の原因: driver はカード使用コストの
 * paymentSources を供給しないため summon/magic/place_nexus が apply で throw し、
 * mctsSearch がそれらの手を root.moves から splice しきって「合法手 0」と誤認、
 * null を返していた。決定ノードでは必ず合法手を返すよう mcts.ts 側で修正済み
 * (root の合法 action を退避して最終 fallback)。
 */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("ISMCTS machinery", () => {
  const realRandom = Math.random;
  afterEach(() => {
    Math.random = realRandom;
  });

  it("mctsSearch returns a legal action for the acting player", () => {
    const engine = buildEngine();
    // 複数の固定 seed で検証する (決定論的 + 局面に幅を持たせる)。
    for (let seed = 1; seed <= 12; seed++) {
      Math.random = mulberry32(seed);
      let state = initializeGame({
        decks: [randomDeck(engine.cards), randomDeck(engine.cards)],
        skipPreGame: true,
      });
      // 初期は start ステップ (advance のみ) なので、合法手のある決定ノードまで進める。
      let actor: string | undefined;
      let actions = legalActionsFor(state, engine).actions;
      for (let i = 0; i < 50; i++) {
        const la = legalActionsFor(state, engine);
        if (la.actor && la.actions.length > 0) {
          actor = la.actor;
          actions = la.actions;
          break;
        }
        state = advance(state, engine);
      }
      expect(actor, `seed=${seed}`).toBeTruthy();
      expect(actions.length, `seed=${seed}`).toBeGreaterThan(0);

      const { action } = mctsSearch(state, actor!, engine, {
        iterations: 30,
        rolloutDepth: 20,
      });
      // 決定ノード (合法手あり) では探索は必ず合法 action を返す。
      expect(action, `seed=${seed}`).not.toBeNull();
      // 返した手が実際の合法手集合に含まれる (actionId 一致)。
      const legalIds = new Set(actions.map((a) => a.actionId));
      expect(legalIds.has(action!.actionId), `seed=${seed}`).toBe(true);
    }
  });

  (E2E_ENABLED ? it : it.skip)(
    "runs MCTS-vs-random games end-to-end (seats alternated for fairness)",
    async () => {
      // 注意: 先攻(alice) は random 同士で勝率 ~15% の強い構造的不利 (position-bias.test.ts)。
      // 公平比較のため MCTS の席をゲームごとに交互に入れ替え、バイアスを相殺する。
      const engine = buildEngine();
      const mctsPolicy = makeMctsPolicy({
        iterations: ITERS,
        rolloutDepth: ROLLOUT,
      });

      let mctsWins = 0;
      let randomWins = 0;
      let stuckOrError = 0;
      let completed = 0;
      let mctsAsFirst = 0;
      let mctsFirstWins = 0;

      const t0 = performance.now();
      for (let g = 0; g < GAMES; g++) {
        // 各ゲーム前に event loop を解放する。1 テストで GAMES 局を同期実行すると
        // forks pool の worker が ~60s 以上ブロックされ、vitest の birpc heartbeat
        // (onTaskUpdate) が応答できず「Timeout calling onTaskUpdate」偽陽性で run が
        // exit 1 化していた。局間で yield すれば連続ブロックは 1 局分 (~10s) に収まり
        // RPC が捌ける。GAMES / 統計・assert は不変。
        await new Promise((resolve) => setTimeout(resolve, 0));
        const mctsSeat = g % 2 === 0 ? "alice" : "bob";
        if (mctsSeat === "alice") mctsAsFirst++;
        const res = playGame({
          engine,
          decks: [randomDeck(engine.cards), randomDeck(engine.cards)],
          maxSteps: MAX_STEPS,
          policies: { [mctsSeat]: mctsPolicy },
        });
        if (res.outcome === "stuck" || res.outcome === "error") {
          stuckOrError++;
          continue;
        }
        completed++;
        if (res.winner === mctsSeat) {
          mctsWins++;
          if (mctsSeat === "alice") mctsFirstWins++;
        } else if (res.winner !== null) {
          randomWins++;
        }
      }
      const totalMs = performance.now() - t0;
      const decisive = mctsWins + randomWins;

      console.log("\n===== ISMCTS vs RANDOM (seats alternated) =====");
      console.log(`games            : ${GAMES}`);
      console.log(`iterations/move  : ${ITERS}, rolloutDepth: ${ROLLOUT}`);
      console.log(`completed        : ${completed}`);
      console.log(`MCTS wins        : ${mctsWins}`);
      console.log(`random wins      : ${randomWins}`);
      console.log(`stuck/error      : ${stuckOrError}`);
      console.log(
        `MCTS win-rate    : ${decisive > 0 ? ((mctsWins / decisive) * 100).toFixed(1) : "n/a"}% (decisive=${decisive})`
      );
      console.log(
        `  as first seat  : ${mctsFirstWins}/${mctsAsFirst} (first-player baseline ~15%)`
      );
      console.log(
        `wall time        : ${(totalMs / 1000).toFixed(1)}s (${(totalMs / GAMES / 1000).toFixed(2)}s/game)`
      );
      console.log("===============================================\n");

      // 機械の正当性のみ assert (強さは別途調査):
      //  - 大半のゲームが end-to-end 完走する (稀な engine-gap stuck ~2% は許容)。
      //  - 決着が発生する (探索が実際に進行・終局させている)。
      expect(completed).toBeGreaterThanOrEqual(GAMES - Math.ceil(GAMES * 0.25));
      expect(decisive).toBeGreaterThan(0);
    },
    600_000
  );
});
