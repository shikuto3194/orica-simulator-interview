import type { GameState } from "../model";

interface ReadMemo {
  children: Map<unknown, ReadMemo>;
  completed?: { value: unknown };
}

interface ReadFamily {
  views: Map<string, GameState>;
}

interface ReadScope {
  families: Map<GameState, ReadFamily>;
  results: Map<GameState, ReadMemo>;
}

// Synchronous, read-only dependencies share work only until the outer read
// returns (including on throw). Never retain results across engine mutations,
// independent reads, or definition lookup functions.
let currentScope: ReadScope | undefined;

export function memoizeContinuousEffectRead<T>(
  state: GameState,
  operation: unknown,
  inputs: readonly unknown[],
  compute: () => T
): T {
  const outerScope = currentScope;
  const scope = (currentScope ??= { families: new Map(), results: new Map() });
  try {
    let memo = scope.results.get(state);
    if (!memo) {
      memo = { children: new Map() };
      scope.results.set(state, memo);
    }
    for (const key of [operation, ...inputs]) {
      let child = memo.children.get(key);
      if (!child) {
        child = { children: new Map() };
        memo.children.set(key, child);
      }
      memo = child;
    }
    if (memo.completed) return memo.completed.value as T;
    const value = compute();
    memo.completed = { value };
    return value;
  } finally {
    currentScope = outerScope;
  }
}

/** Canonicalize only views derived by removing effects from this same state.
 * Other state objects form independent families, even with identical CE IDs.
 * Removal preserves CE order and the historical self-exclusion semantics.
 */
export function continuousEffectReadInputState(
  state: GameState,
  effectId: string
): GameState {
  const effects = state.activeContinuousEffects.filter(
    (other) => other.effectId !== effectId
  );
  if (effects.length === state.activeContinuousEffects.length) return state;
  if (!currentScope) return { ...state, activeContinuousEffects: effects };

  let family = currentScope.families.get(state);
  if (!family) {
    family = { views: new Map() };
    currentScope.families.set(state, family);
    family.views.set(
      JSON.stringify(state.activeContinuousEffects.map((ce) => ce.effectId)),
      state
    );
  }
  const key = JSON.stringify(effects.map((ce) => ce.effectId));
  const existing = family.views.get(key);
  if (existing) return existing;
  const view = { ...state, activeContinuousEffects: effects };
  family.views.set(key, view);
  currentScope.families.set(view, family);
  return view;
}
