import type { ContinuousEffect, Step, TimingScope, Window } from "../model";

interface HasActiveCEs {
  readonly activeContinuousEffects: readonly ContinuousEffect[];
}

/** スコープフィルタに必要なゲーム状態。GameState はこれを満たす。 */
interface ScopeContext {
  readonly step: Step;
  readonly activePlayerId: string;
  /**
   * `timingScope.subPhase` 判定用 (window==="step_end" のときだけ "end" 窓とみなす)。
   * 未指定時は "start" 扱い (isTimingScopeActive の既定と同じ、後方互換)。
   * legal-actions-availability.ts の declaration-time 判定と同じ規約
   * (engine-hand-self-card-main-end-activation-timing の CE 消費側配線漏れを解消、
   * BSTH02.7-C01 effects[0] が初出）。
   */
  readonly window: Window;
}

interface CEIndex {
  readonly byTargetId: ReadonlyMap<string, readonly ContinuousEffect[]>;
  readonly global: readonly ContinuousEffect[];
}

const cache = new WeakMap<readonly ContinuousEffect[], CEIndex>();

function buildCEIndex(ces: readonly ContinuousEffect[]): CEIndex {
  let index = cache.get(ces);
  if (!index) {
    const byTargetId = new Map<string, ContinuousEffect[]>();
    const global: ContinuousEffect[] = [];
    for (const ce of ces) {
      if (ce.targetInstanceId) {
        let arr = byTargetId.get(ce.targetInstanceId);
        if (!arr) {
          arr = [];
          byTargetId.set(ce.targetInstanceId, arr);
        }
        arr.push(ce);
      } else {
        global.push(ce);
      }
    }
    index = { byTargetId, global };
    cache.set(ces, index);
  }
  return index;
}

/**
 * TimingScope の汎用判定。owner（CE owner / 効果を発揮するプレイヤー）と
 * 現在のゲーム状態を照合し、scope が有効かを返す。
 * scope が未設定なら常に有効（後方互換）。
 *
 * - `player: "self"` = owner がターンプレイヤー (= activePlayerId)
 * - `player: "opponent"` = owner が非ターンプレイヤー
 * - `player: "both"` = player 制約なし
 * - `period: "turn"` = ステップ非依存
 * - `period: <Step>` = そのステップのみ
 *
 * 用途:
 *   - CE: ownerPlayerId = ce.actingPlayerId
 *   - legal-action availability (activated/flash): ownerPlayerId = actingPlayerId
 */
export function isTimingScopeActive(
  scope: TimingScope | undefined,
  currentStep: Step,
  activePlayerId: string,
  ownerPlayerId: string,
  // engine-hand-self-card-main-end-activation-timing: 呼び出し元が未指定のときは
  // "start"（= 通常のステップ進行中。既存カード BSTH01-M01 timingScope.subPhase:"start" 等の
  // 後方互換）。state.window==="step_end" のときだけ呼び出し元が明示的に "end" を渡す。
  currentSubPhase: "start" | "end" = "start"
): boolean {
  if (!scope) return true;

  const { player, period, subPhase } = scope;

  if (player !== "both") {
    const isSelfTurn = ownerPlayerId === activePlayerId;
    if (player === "self" && !isSelfTurn) return false;
    if (player === "opponent" && isSelfTurn) return false;
  }

  if (period && period !== "turn" && currentStep !== period) return false;

  // subPhase 指定時は「そのステップの開始際」/「終了際」専用の窓でのみ有効にする。
  // 未指定時は従来どおりステップ全体で有効 (後方互換)。
  if (subPhase !== undefined && subPhase !== currentSubPhase) return false;

  return true;
}

/**
 * TimingScope に基づいて CE が現在のゲーム状態で有効かを判定する。
 * timingScope が未設定なら常に有効（後方互換）。
 */
export function isCEActiveForScope(
  ce: ContinuousEffect,
  currentStep: Step,
  activePlayerId: string,
  currentSubPhase?: "start" | "end"
): boolean {
  return isTimingScopeActive(
    ce.timingScope,
    currentStep,
    activePlayerId,
    ce.actingPlayerId,
    currentSubPhase
  );
}

/** スコープコンテキストの有無で CE リストをフィルタ */
function filterByScope(
  ces: readonly ContinuousEffect[],
  state: HasActiveCEs & Partial<ScopeContext>
): readonly ContinuousEffect[] {
  if (
    !("step" in state) ||
    !state.step ||
    !("activePlayerId" in state) ||
    !state.activePlayerId
  ) {
    return ces;
  }
  const hasScope = ces.some((ce) => ce.timingScope);
  if (!hasScope) return ces;
  const currentSubPhase = state.window === "step_end" ? "end" : undefined;
  return ces.filter((ce) =>
    isCEActiveForScope(ce, state.step!, state.activePlayerId!, currentSubPhase)
  );
}

/**
 * 特定カードを対象とする CE を O(1) で取得する。
 * state に step/activePlayerId があれば timingScope でフィルタされる。
 */
export function getCEsForTarget(
  state: HasActiveCEs & Partial<ScopeContext>,
  targetInstanceId: string
): readonly ContinuousEffect[] {
  const raw =
    buildCEIndex(state.activeContinuousEffects).byTargetId.get(
      targetInstanceId
    ) ?? [];
  return filterByScope(raw, state);
}

/**
 * targetInstanceId が未設定の CE（動的フィルタ等）を取得する。
 * state に step/activePlayerId があれば timingScope でフィルタされる。
 */
export function getGlobalCEs(
  state: HasActiveCEs & Partial<ScopeContext>
): readonly ContinuousEffect[] {
  const raw = buildCEIndex(state.activeContinuousEffects).global;
  return filterByScope(raw, state);
}
