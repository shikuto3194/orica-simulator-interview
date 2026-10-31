/**
 * ISMCTS（の第一段階: 真状態 UCT 探索）。設計: 20_design/14_dl-ai-architecture.md (4)
 *
 * 自己対戦では両者の真状態にアクセスできるため、まず determinization なしの
 * perfect-information UCT を実装する（「探索が機能しランダムに勝つ」ことの検証用）。
 * 隠れ情報対応 (determinization サンプラ) は次段階で root 状態の隠れ部分を差し替えて被せる。
 *
 * 評価はランダムロールアウト + 深さ打ち切り時のヒューリスティック（ライフ差中心）。
 * 後段で value/policy ネットに差し替える。card-agnostic。
 */
import type { GameState, LegalAction } from "@orica/rules-core";
import {
  type Engine,
  type Policy,
  legalActionsFor,
  applyChosenAction,
  advance,
  winnerOf,
} from "./selfplay-driver";

type Move = { kind: "action"; action: LegalAction } | { kind: "advance" };

interface Node {
  state: GameState;
  actor?: string; // この局面の手番者 (undefined = 強制 advance)
  moves: Move[];
  children: (Node | null)[];
  visits: number;
  /** ROOT プレイヤー視点の累積価値 (勝ち=1, 負け=0, 引分=0.5)。 */
  value: number;
  terminal: boolean;
}

export interface MctsOptions {
  iterations?: number;
  rolloutDepth?: number;
  /** UCB 探索定数。 */
  c?: number;
}

function otherPlayer(state: GameState, id: string): string {
  return state.playerOrder.find((p) => p !== id) ?? id;
}

/** ROOT 視点のヒューリスティック評価 (0..1)。ライフ差中心 + 軽い盤面項。 */
function heuristicValue(state: GameState, root: string): number {
  const opp = otherPlayer(state, root);
  const me = state.players.find((p) => p.id === root);
  const ot = state.players.find((p) => p.id === opp);
  const myLife = me?.lifeNormalCoreCount ?? 0;
  const opLife = ot?.lifeNormalCoreCount ?? 0;
  const myField = state.cardInstances.filter(
    (c) => c.zone === "field" && c.controllerPlayerId === root
  ).length;
  const opField = state.cardInstances.filter(
    (c) => c.zone === "field" && c.controllerPlayerId === opp
  ).length;
  // 相手ライフが少ないほど強く加点 (リーサル誘導)。
  const lethalBonus = (5 - opLife) * 0.12 - (5 - myLife) * 0.12;
  const raw =
    0.3 * (myLife - opLife) +
    lethalBonus +
    0.04 * (myField - opField) +
    0.015 *
      ((me?.reserveNormalCoreCount ?? 0) - (ot?.reserveNormalCoreCount ?? 0));
  return 1 / (1 + Math.exp(-raw)); // sigmoid → 0..1
}

/** 終局なら ROOT 視点の確定値、未終局なら null。 */
function terminalValue(state: GameState, root: string): number | null {
  if (state.gameResult === null) return null;
  const w = winnerOf(state);
  if (w === null) return 0.5; // 引き分け/不明
  return w === root ? 1 : 0;
}

function getMoves(
  state: GameState,
  engine: Engine
): { actor?: string; moves: Move[] } {
  const { actor, actions } = legalActionsFor(state, engine);
  if (actor && actions.length > 0)
    return {
      actor,
      moves: actions.map((a) => ({ kind: "action", action: a })),
    };
  return { actor: undefined, moves: [{ kind: "advance" }] };
}

function applyMove(
  state: GameState,
  move: Move,
  engine: Engine
): GameState | null {
  try {
    return move.kind === "advance"
      ? advance(state, engine)
      : applyChosenAction(state, move.action, engine);
  } catch {
    return null;
  }
}

/** ランダムロールアウト → ROOT 視点の価値 (0..1)。 */
function rollout(
  state: GameState,
  root: string,
  engine: Engine,
  depth: number
): number {
  let s = state;
  for (let d = 0; d < depth; d++) {
    const tv = terminalValue(s, root);
    if (tv !== null) return tv;
    const { moves } = getMoves(s, engine);
    // ランダム順 + attack 優先 (driver の randomPolicy と整合させ、リーサルへ進める)
    const order = [...moves];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    order.sort((a, b) =>
      a.kind === "action" && a.action.kind === "attack"
        ? -1
        : b.kind === "action" && b.action.kind === "attack"
          ? 1
          : 0
    );
    let next: GameState | null = null;
    for (const mv of order) {
      next = applyMove(s, mv, engine);
      if (next) break;
    }
    if (!next) break; // 進めない
    s = next;
  }
  const tv = terminalValue(s, root);
  return tv !== null ? tv : heuristicValue(s, root);
}

function makeNode(state: GameState, engine: Engine): Node {
  const tv = state.gameResult !== null;
  const { actor, moves } = tv
    ? { actor: undefined, moves: [] }
    : getMoves(state, engine);
  return {
    state,
    actor,
    moves,
    children: new Array(moves.length).fill(null),
    visits: 0,
    value: 0,
    terminal: tv,
  };
}

/** ノードの手番者視点の Q (ROOT でなければ反転)。 */
function exploitQ(child: Node, root: string, parentActor?: string): number {
  if (child.visits === 0) return 0;
  const q = child.value / child.visits; // ROOT 視点
  return parentActor === root ? q : 1 - q;
}

function selectChildIndex(node: Node, root: string, c: number): number {
  let best = -1;
  let bestU = -Infinity;
  for (let i = 0; i < node.moves.length; i++) {
    const child = node.children[i];
    const visits = child?.visits ?? 0;
    const q = child ? exploitQ(child, root, node.actor) : 0;
    const u =
      visits === 0
        ? Infinity
        : q + c * Math.sqrt(Math.log(node.visits + 1) / visits);
    if (u > bestU) {
      bestU = u;
      best = i;
    }
  }
  return best;
}

export function mctsSearch(
  rootState: GameState,
  rootPlayer: string,
  engine: Engine,
  opts: MctsOptions = {}
): { action: LegalAction | null; root: Node } {
  const iterations = opts.iterations ?? 80;
  const rolloutDepth = opts.rolloutDepth ?? 24;
  const c = opts.c ?? 1.2;

  const root = makeNode(rootState, engine);
  // 反復中に apply 不能な手は root.moves から splice される。root に合法 action が
  // あったのに全 action が splice され尽くすと最終選択で null になる
  // (driver がカード使用コスト等の追加入力を供給できず apply で throw する局面)。
  // 元の合法 action 集合を退避し、決定ノードでは必ず合法手を返せるようにする。
  const rootActionMoves = root.moves.filter(
    (m): m is Extract<Move, { kind: "action" }> => m.kind === "action"
  );

  for (let it = 0; it < iterations; it++) {
    // --- selection + expansion ---
    const path: Node[] = [root];
    let node = root;
    while (!node.terminal && node.moves.length > 0) {
      const idx = selectChildIndex(node, rootPlayer, c);
      if (idx < 0) break;
      let child = node.children[idx];
      if (!child) {
        // expand
        const next = applyMove(node.state, node.moves[idx]!, engine);
        if (!next) {
          // この手は適用不能 → 除去して再選択
          node.moves.splice(idx, 1);
          node.children.splice(idx, 1);
          if (node.moves.length === 0) break;
          continue;
        }
        child = makeNode(next, engine);
        node.children[idx] = child;
        path.push(child);
        node = child;
        break; // 新規展開ノードでロールアウト
      }
      path.push(child);
      node = child;
    }

    // --- simulation ---
    const value =
      terminalValue(node.state, rootPlayer) ??
      rollout(node.state, rootPlayer, engine, rolloutDepth);

    // --- backprop (ROOT 視点で一貫) ---
    for (const n of path) {
      n.visits += 1;
      n.value += value;
    }
  }

  // 最多訪問の action 子を返す
  let bestIdx = -1;
  let bestVisits = -1;
  for (let i = 0; i < root.moves.length; i++) {
    const mv = root.moves[i]!;
    if (mv.kind !== "action") continue;
    const v = root.children[i]?.visits ?? 0;
    if (v > bestVisits) {
      bestVisits = v;
      bestIdx = i;
    }
  }
  const mv = bestIdx >= 0 ? root.moves[bestIdx] : undefined;
  const action = mv && mv.kind === "action" ? mv.action : null;
  return {
    // 訪問ベースで action を選べなかった (全 action が apply 不能で splice 済み)
    // 場合でも、root に合法 action があったなら最初の合法手を返す。
    // 探索が「合法手 0」と誤認して null を返すのを防ぐ (機械の正当性)。
    action: action ?? rootActionMoves[0]?.action ?? null,
    root,
  };
}

/** driver の Policy として使える MCTS 方策を生成。 */
export function makeMctsPolicy(opts: MctsOptions = {}): Policy {
  return (state, actor, actions, engine) => {
    const { action } = mctsSearch(state, actor, engine, opts);
    // 探索が action を返せないとき (全 advance 等) は先頭にフォールバック
    return action ?? actions[0]!;
  };
}
