/**
 * 診断: position bias の原因切り分け。
 * - 終局理由 (deck_out / life_zero) と敗者 (alice/bob) の内訳を取る。
 * - 同一デッキ(mirror)で席だけ入替え、バイアスが「席」起因か「デッキ運」起因かを分離。
 * 実行: PB_GAMES=80 vitest run position-bias-diagnose --no-file-parallelism
 */
import { describe, it } from "vitest";
import { initializeGame, type GameState } from "@orica/rules-core";
import {
  buildEngine,
  randomDeck,
  legalActionsFor,
  applyChosenAction,
  advance,
  randomPolicy,
  type Engine,
} from "./selfplay-driver";
import type { CardDefinition } from "@orica/rules-core";

interface Diag {
  winner: string | null;
  loser: string | null;
  reason: string | null;
  outcome: "natural" | "capped" | "stuck" | "error";
  turnNumber: number;
  steps: number;
}

function playGameDiag(
  engine: Engine,
  decks: [CardDefinition[], CardDefinition[]],
  maxSteps = 1500
): Diag {
  let state: GameState = initializeGame({ decks, skipPreGame: true });
  for (let steps = 0; steps < maxSteps; steps++) {
    if (state.gameResult !== null) {
      const gr = state.gameResult;
      const loser = "losingPlayerId" in gr ? (gr.losingPlayerId ?? null) : null;
      const winner =
        gr.kind === "draw" || !loser
          ? null
          : (state.playerOrder.find((p) => p !== loser) ?? null);
      return {
        winner,
        loser,
        reason: gr.reason ?? null,
        outcome: "natural",
        turnNumber: state.turnNumber,
        steps,
      };
    }
    const { actor, actions } = legalActionsFor(state, engine);
    let progressed = false;
    if (actor && actions.length > 0) {
      const ordered = [randomPolicy(state, actor, actions, engine), ...actions];
      for (const action of ordered) {
        try {
          state = applyChosenAction(state, action, engine);
          progressed = true;
          break;
        } catch {
          /* fallback */
        }
      }
    }
    if (!progressed) {
      try {
        state = advance(state, engine);
      } catch {
        return {
          winner: null,
          loser: null,
          reason: "stuck",
          outcome: "stuck",
          turnNumber: state.turnNumber,
          steps,
        };
      }
    }
  }
  return {
    winner: null,
    loser: null,
    reason: null,
    outcome: "capped",
    turnNumber: state.turnNumber,
    steps: maxSteps,
  };
}

function tally(label: string, diags: Diag[]) {
  let aliceWin = 0;
  let bobWin = 0;
  let nondecisive = 0;
  const reasonByLoser: Record<string, Record<string, number>> = {
    alice: {},
    bob: {},
  };
  let turnSum = 0;
  for (const d of diags) {
    if (d.outcome === "natural" && d.winner === "alice") aliceWin++;
    else if (d.outcome === "natural" && d.winner === "bob") bobWin++;
    else nondecisive++;
    if (d.loser && d.reason) {
      reasonByLoser[d.loser] ??= {};
      reasonByLoser[d.loser]![d.reason] =
        (reasonByLoser[d.loser]![d.reason] ?? 0) + 1;
    }
    turnSum += d.turnNumber;
  }
  const dec = aliceWin + bobWin;
  console.log(`\n===== ${label} =====`);
  console.log(`games          : ${diags.length}`);
  console.log(`alice(1st) win : ${aliceWin}`);
  console.log(`bob(2nd) win   : ${bobWin}`);
  console.log(`nondecisive    : ${nondecisive}`);
  console.log(
    `alice win-rate among decisive: ${dec ? ((aliceWin / dec) * 100).toFixed(1) : "n/a"}%`
  );
  console.log(`avg turnNumber : ${(turnSum / diags.length).toFixed(1)}`);
  console.log(`loss reason by loser:`);
  console.log(`  alice lost via: ${JSON.stringify(reasonByLoser.alice)}`);
  console.log(`  bob   lost via: ${JSON.stringify(reasonByLoser.bob)}`);
  console.log(`========================================\n`);
}

// 診断用（数十局の自己対戦・長時間同期ブロック）は既定 `pnpm test`（merge ゲート）から
// 除外する（vitest birpc onTaskUpdate タイムアウト偽陽性回避）。RUN_PERF=1 で実行する。
describe.runIf(process.env.RUN_PERF === "1")("position bias diagnose", () => {
  const GAMES = Number(process.env.PB_GAMES ?? 80);

  it("A: random decks — reason/loser breakdown", () => {
    const engine = buildEngine();
    const diags: Diag[] = [];
    for (let g = 0; g < GAMES; g++) {
      diags.push(
        playGameDiag(engine, [
          randomDeck(engine.cards),
          randomDeck(engine.cards),
        ])
      );
    }
    tally("A: RANDOM DECKS", diags);
  }, 600_000);

  it("B: mirror deck (same deck both seats) — pure positional", () => {
    const engine = buildEngine();
    const diags: Diag[] = [];
    for (let g = 0; g < GAMES; g++) {
      // 同一カード列をコピーして両席に配る → デッキ運を完全に消す
      const base = randomDeck(engine.cards);
      const mirror: [CardDefinition[], CardDefinition[]] = [
        [...base],
        [...base],
      ];
      diags.push(playGameDiag(engine, mirror));
    }
    tally("B: MIRROR DECK (positional only)", diags);
  }, 600_000);
});
