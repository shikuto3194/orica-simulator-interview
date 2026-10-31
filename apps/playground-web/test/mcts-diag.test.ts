/**
 * MCTS 探索方向の局所診断。root 子の (visits, 平均価値) を出力し、
 * 「最多訪問 == 最大価値 (ROOT視点)」が成り立つか = 最終選択の向きが正しいかを確認する。
 * 実行: vitest run mcts-diag
 */
import { describe, it } from "vitest";
import { initializeGame } from "@orica/rules-core";
import { buildEngine, randomDeck, legalActionsFor } from "./selfplay-driver";
import { mctsSearch } from "./mcts";

describe("mcts direction diagnostic", () => {
  it("prints root children value/visits", () => {
    const engine = buildEngine();
    const state = initializeGame({
      decks: [randomDeck(engine.cards), randomDeck(engine.cards)],
      skipPreGame: true,
    });
    const { actor } = legalActionsFor(state, engine);
    const { action, root } = mctsSearch(state, actor!, engine, {
      iterations: 200,
      rolloutDepth: 30,
    });

    const rows = root.moves
      .map((mv, i) => {
        const ch = root.children[i];
        return {
          kind: mv.kind === "action" ? mv.action.kind : "advance",
          visits: ch?.visits ?? 0,
          // ROOT 視点平均価値 (root.actor === actor なので非反転)
          q: ch && ch.visits ? ch.value / ch.visits : NaN,
        };
      })
      .sort((a, b) => b.visits - a.visits);

    console.log(`\n===== MCTS ROOT (actor=${actor}) =====`);
    console.log(`chosen kind   : ${action?.kind}`);
    console.log("rank visits  q(root)  kind");
    rows
      .slice(0, 12)
      .forEach((r, i) =>
        console.log(
          `${String(i).padStart(2)}  ${String(r.visits).padStart(5)}  ${(Number.isNaN(r.q) ? 0 : r.q).toFixed(3)}   ${r.kind}`
        )
      );
    const maxVisit = rows[0];
    const maxQ = [...rows]
      .filter((r) => r.visits > 0)
      .sort((a, b) => b.q - a.q)[0];
    console.log(
      `most-visited q=${maxVisit?.q.toFixed(3)} | highest-q kind=${maxQ?.kind} q=${maxQ?.q.toFixed(3)}`
    );
    console.log(
      `direction OK (most-visited is near-highest-q)? ${
        maxVisit && maxQ && maxVisit.q >= maxQ.q - 0.05
          ? "YES"
          : "NO ← suspicious"
      }`
    );
    console.log("======================================\n");
  });
});
