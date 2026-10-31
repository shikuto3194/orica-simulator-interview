import { measureAiWork, type AiWorkTelemetry } from "./ai-work-telemetry";
import type { LegalAction } from "./legal/legal-actions-types";
import type { GameState } from "./model";
import {
  applyTrainingDecisionChoice,
  createActionInputDecisionNode,
  getNextTrainingDecision,
  heuristicTrainingPolicy,
  randomTrainingPolicy,
  type Engine,
  type Rng,
  type TrainingDecisionChoice,
  type TrainingDecisionNode,
  type TrainingDecisionSurfaceOptions,
  type TrainingPolicy,
  winnerOf,
} from "./training-decision-surface";

export interface TrainingMctsOptions extends Omit<
  TrainingDecisionSurfaceOptions,
  "getCardDefinitionById"
> {
  iterations?: number;
  rolloutDepth?: number;
  /**
   * Deterministic guard for smoke callers that retain large serializable game
   * histories. Once this many JSON characters is exceeded, both the number of
   * virtual branches and rollout depth are reduced by the same size ratio.
   */
  maxStateSerializedChars?: number;
  c?: number;
  rolloutPolicy?: TrainingPolicy;
}

export interface TrainingMctsChoiceStat {
  choiceId: string;
  label: string;
  visits: number;
  value: number;
  averageValue: number;
}

export interface TrainingMctsSearchResult {
  choice: TrainingDecisionChoice;
  root: {
    visits: number;
    choices: TrainingMctsChoiceStat[];
  };
}

interface SearchPosition {
  state: GameState;
  node: TrainingDecisionNode | null;
}

interface SearchNode {
  position: SearchPosition;
  choices: TrainingDecisionChoice[];
  children: (SearchNode | null)[];
  visits: number;
  value: number;
  terminal: boolean;
}

const DEFAULT_ITERATIONS = 80;
const DEFAULT_ROLLOUT_DEPTH = 24;
const DEFAULT_C = 1.2;

function boundedMctsOptionsForState(
  state: GameState,
  opts: TrainingMctsOptions
): TrainingMctsOptions {
  const limit = opts.maxStateSerializedChars;
  if (!Number.isFinite(limit) || limit === undefined || limit <= 0) {
    return opts;
  }
  const serializedChars = JSON.stringify(state).length;
  if (serializedChars <= limit) return opts;

  const scale = Math.ceil(serializedChars / limit);
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const rolloutDepth = opts.rolloutDepth ?? DEFAULT_ROLLOUT_DEPTH;
  return {
    ...opts,
    // Explicit zero is used by policy tests to request the heuristic fallback;
    // do not promote it to one when applying the size guard.
    iterations:
      iterations === 0 ? 0 : Math.max(1, Math.floor(iterations / scale)),
    rolloutDepth:
      rolloutDepth === 0 ? 0 : Math.max(1, Math.floor(rolloutDepth / scale)),
  };
}

function surfaceOptions(
  engine: Engine,
  opts: TrainingMctsOptions
): TrainingDecisionSurfaceOptions {
  return {
    getCardDefinitionById: engine.getCardDefinitionById,
    ...(opts.telemetry ? { telemetry: opts.telemetry } : {}),
    ...(opts.maxGeneratedChoices !== undefined
      ? { maxGeneratedChoices: opts.maxGeneratedChoices }
      : {}),
    ...(opts.suppressManualCoreMovesWhenLegalActionsExist !== undefined
      ? {
          suppressManualCoreMovesWhenLegalActionsExist:
            opts.suppressManualCoreMovesWhenLegalActionsExist,
        }
      : {}),
    ...(opts.factorManualCoreMovesThroughReserve !== undefined
      ? {
          factorManualCoreMovesThroughReserve:
            opts.factorManualCoreMovesThroughReserve,
        }
      : {}),
  };
}

function otherPlayer(state: GameState, id: string): string {
  return state.playerOrder.find((playerId) => playerId !== id) ?? id;
}

function heuristicValue(state: GameState, rootPlayerId: string): number {
  const opponentId = otherPlayer(state, rootPlayerId);
  const me = state.players.find((player) => player.id === rootPlayerId);
  const opponent = state.players.find((player) => player.id === opponentId);
  const myLife = me?.lifeNormalCoreCount ?? 0;
  const opponentLife = opponent?.lifeNormalCoreCount ?? 0;
  const myField = state.cardInstances.filter(
    (card) => card.zone === "field" && card.controllerPlayerId === rootPlayerId
  ).length;
  const opponentField = state.cardInstances.filter(
    (card) => card.zone === "field" && card.controllerPlayerId === opponentId
  ).length;
  const raw =
    0.3 * (myLife - opponentLife) +
    0.12 * (5 - opponentLife - (5 - myLife)) +
    0.04 * (myField - opponentField) +
    0.015 *
      ((me?.reserveNormalCoreCount ?? 0) -
        (opponent?.reserveNormalCoreCount ?? 0));
  return 1 / (1 + Math.exp(-raw));
}

function terminalValue(state: GameState, rootPlayerId: string): number | null {
  if (state.gameResult === null) return null;
  const winner = winnerOf(state);
  if (winner === null) return 0.5;
  return winner === rootPlayerId ? 1 : 0;
}

function makePosition(
  state: GameState,
  engine: Engine,
  opts: TrainingMctsOptions
): SearchPosition {
  return {
    state,
    node:
      state.gameResult === null
        ? getNextTrainingDecision(state, engine, surfaceOptions(engine, opts))
        : null,
  };
}

function makeSearchNode(position: SearchPosition): SearchNode {
  const choices = position.node ? [...position.node.choices] : [];
  return {
    position,
    choices,
    children: new Array(choices.length).fill(null),
    visits: 0,
    value: 0,
    terminal: position.state.gameResult !== null,
  };
}

function isJankenDecisionNode(node: TrainingDecisionNode): boolean {
  return (
    node.kind === "pregame" &&
    node.choices.length > 0 &&
    node.choices.every((choice) => choice.preGameChoice?.kind === "janken")
  );
}

function cloneSearchState(
  state: GameState,
  telemetry?: AiWorkTelemetry
): GameState {
  return measureAiWork(
    telemetry,
    "state_copy",
    () => JSON.parse(JSON.stringify(state)) as GameState
  );
}

function applyLegalActionChoiceAsVirtualInput(
  position: SearchPosition,
  choice: TrainingDecisionChoice & { action: LegalAction },
  engine: Engine,
  opts: TrainingMctsOptions
): SearchPosition | null {
  const { action } = choice;
  // Input-node enumeration is read-only.  Keeping the original state here is
  // safe because applySearchChoice clones it immediately before applying the
  // selected input.  Cloning both before enumeration and again for that input
  // used to serialize the full (and potentially very large) game log twice
  // for every MCTS action-with-input branch.
  const inputNode = createActionInputDecisionNode(position.state, action, {
    ...surfaceOptions(engine, opts),
  });
  if (inputNode) {
    return { state: position.state, node: inputNode };
  }
  const searchState = cloneSearchState(position.state, opts.telemetry);
  const nextState = applyTrainingDecisionChoice(
    searchState,
    position.node!,
    choice,
    engine,
    opts.telemetry
  );
  return makePosition(nextState, engine, opts);
}

function applySearchChoice(
  position: SearchPosition,
  choice: TrainingDecisionChoice,
  engine: Engine,
  opts: TrainingMctsOptions
): SearchPosition | null {
  const node = position.node;
  if (!node) return null;
  if (node.kind === "legal_action" && choice.action) {
    return applyLegalActionChoiceAsVirtualInput(
      position,
      choice as TrainingDecisionChoice & { action: LegalAction },
      engine,
      opts
    );
  }
  const searchState = cloneSearchState(position.state, opts.telemetry);
  const nextState = applyTrainingDecisionChoice(
    searchState,
    node,
    choice,
    engine,
    opts.telemetry
  );
  return makePosition(nextState, engine, opts);
}

function exploitQ(
  child: SearchNode,
  rootPlayerId: string,
  parentActorId: string | undefined
): number {
  if (child.visits === 0) return 0;
  const q = child.value / child.visits;
  return parentActorId === rootPlayerId ? q : 1 - q;
}

function selectChildIndex(
  node: SearchNode,
  rootPlayerId: string,
  c: number
): number {
  let bestIndex = -1;
  let bestScore = -Infinity;
  const parentActorId = node.position.node?.actingPlayerId;
  for (let index = 0; index < node.choices.length; index++) {
    const child = node.children[index];
    const visits = child?.visits ?? 0;
    const q = child ? exploitQ(child, rootPlayerId, parentActorId) : 0;
    const ucb =
      visits === 0
        ? Infinity
        : q + c * Math.sqrt(Math.log(node.visits + 1) / visits);
    if (ucb > bestScore) {
      bestScore = ucb;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function normalizePolicyChoice(
  node: TrainingDecisionNode,
  selected: TrainingDecisionChoice
): TrainingDecisionChoice {
  return node.choices.includes(selected) ? selected : node.choices[0]!;
}

function rollout(
  start: SearchPosition,
  rootPlayerId: string,
  engine: Engine,
  opts: TrainingMctsOptions,
  rng: Rng
): number {
  let position = start;
  const depth = opts.rolloutDepth ?? DEFAULT_ROLLOUT_DEPTH;
  const rolloutPolicy = opts.rolloutPolicy ?? heuristicTrainingPolicy;

  for (let step = 0; step < depth; step++) {
    const terminal = terminalValue(position.state, rootPlayerId);
    if (terminal !== null) return terminal;
    const node =
      position.node ??
      getNextTrainingDecision(
        position.state,
        engine,
        surfaceOptions(engine, opts)
      );
    if (!node || node.choices.length === 0) break;
    const selected = normalizePolicyChoice(
      node,
      rolloutPolicy === heuristicTrainingPolicy
        ? measureAiWork(opts.telemetry, "heuristic_inference", () =>
            rolloutPolicy(position.state, node, engine, rng)
          )
        : rolloutPolicy(position.state, node, engine, rng)
    );
    try {
      const next = applySearchChoice(
        { state: position.state, node },
        selected,
        engine,
        opts
      );
      if (!next) break;
      position = next;
    } catch {
      break;
    }
  }

  return (
    terminalValue(position.state, rootPlayerId) ??
    measureAiWork(opts.telemetry, "heuristic_inference", () =>
      heuristicValue(position.state, rootPlayerId)
    )
  );
}

function choiceStats(root: SearchNode): TrainingMctsChoiceStat[] {
  return root.choices.map((choice, index) => {
    const child = root.children[index];
    const visits = child?.visits ?? 0;
    const value = child?.value ?? 0;
    return {
      choiceId: choice.choiceId,
      label: choice.label,
      visits,
      value,
      averageValue: visits === 0 ? 0 : value / visits,
    };
  });
}

function bestRootChoice(root: SearchNode): TrainingDecisionChoice | null {
  let bestIndex = -1;
  let bestVisits = -1;
  let bestAverageValue = -Infinity;
  for (let index = 0; index < root.choices.length; index++) {
    const child = root.children[index];
    const visits = child?.visits ?? 0;
    const averageValue = visits === 0 ? -Infinity : child!.value / visits;
    if (
      visits > bestVisits ||
      (visits === bestVisits && averageValue > bestAverageValue)
    ) {
      bestIndex = index;
      bestVisits = visits;
      bestAverageValue = averageValue;
    }
  }
  return bestIndex >= 0 ? root.choices[bestIndex]! : null;
}

function searchTrainingDecisionMctsInner(
  state: GameState,
  node: TrainingDecisionNode,
  engine: Engine,
  opts: TrainingMctsOptions = {},
  rng: Rng = Math.random
): TrainingMctsSearchResult {
  if (node.choices.length === 0) {
    throw new Error(`Training decision node ${node.nodeId} has no choices`);
  }

  const boundedOpts = boundedMctsOptionsForState(state, opts);
  const iterations = boundedOpts.iterations ?? DEFAULT_ITERATIONS;
  const c = boundedOpts.c ?? DEFAULT_C;
  const rootPlayerId = node.actingPlayerId;
  const root = makeSearchNode({ state, node });
  const fallbackChoices = [...node.choices];

  for (let iteration = 0; iteration < iterations; iteration++) {
    measureAiWork(opts.telemetry, "simulation", () => {
      const path: SearchNode[] = [root];
      let current = root;

      while (!current.terminal && current.choices.length > 0) {
        const index = selectChildIndex(current, rootPlayerId, c);
        if (index < 0) break;
        let child = current.children[index];
        if (!child) {
          try {
            const nextPosition = applySearchChoice(
              current.position,
              current.choices[index]!,
              engine,
              boundedOpts
            );
            if (!nextPosition) {
              current.choices.splice(index, 1);
              current.children.splice(index, 1);
              continue;
            }
            child = makeSearchNode(nextPosition);
            current.children[index] = child;
            path.push(child);
            current = child;
            break;
          } catch {
            current.choices.splice(index, 1);
            current.children.splice(index, 1);
            continue;
          }
        }
        path.push(child);
        current = child;
      }

      const value =
        terminalValue(current.position.state, rootPlayerId) ??
        rollout(current.position, rootPlayerId, engine, boundedOpts, rng);
      for (const item of path) {
        item.visits += 1;
        item.value += value;
      }
    });
  }

  return {
    choice: bestRootChoice(root) ?? fallbackChoices[0]!,
    root: {
      visits: root.visits,
      choices: choiceStats(root),
    },
  };
}

export function makeMctsTrainingPolicy(
  opts: TrainingMctsOptions = {}
): TrainingPolicy {
  return (state, node, engine, rng) => {
    if (isJankenDecisionNode(node)) {
      return randomTrainingPolicy(state, node, engine, rng);
    }
    const isForcedChoice = node.choices.length === 1;
    const selected = isForcedChoice
      ? node.choices[0]!
      : searchTrainingDecisionMcts(state, node, engine, opts, rng).choice;
    const emptyFirePass = getEmptyFireSingleStepSummonPassChoice(
      node,
      selected,
      engine
    );
    if (emptyFirePass) return emptyFirePass;
    if (isForcedChoice) return selected;
    const heuristicSelected = heuristicTrainingPolicy(state, node, engine, rng);
    return shouldPreferHeuristicProgressChoice(
      node,
      selected,
      heuristicSelected
    )
      ? heuristicSelected
      : selected;
  };
}

/**
 * 空撃ちはルール上は合法だが、対象を持たない単発の召喚効果を訓練 MCTS が連続選択すると、
 * フラッシュ優先権を渡すだけで盤面を変えず、自己対局が decision cap まで巡回し得る。
 *
 * これは LegalAction の提示を狭める規則ではない。相手プレイヤーが実際に空撃ちを使う
 * 権利は残したまま、MCTS の方策に限って、同一フラッシュ窓の pass を選ぶ。
 */
function getEmptyFireSingleStepSummonPassChoice(
  node: TrainingDecisionNode,
  selected: TrainingDecisionChoice,
  engine: Engine
): TrainingDecisionChoice | undefined {
  const action = selected.action;
  if (
    node.kind !== "legal_action" ||
    action?.kind !== "use_field_card_effect" ||
    action.targetMode !== "none" ||
    action.requiredTargetCount !== 0 ||
    action.candidateTargetInstanceIds.length !== 0
  ) {
    return undefined;
  }

  const registration = engine.lookups.getRegisteredFieldCardEffectActions(
    action.sourceCardNo
  )?.[action.registrationIndex];
  if (
    registration?.requiredTargetCount === undefined ||
    registration.requiredTargetCount <= 0
  ) {
    return undefined;
  }

  const sourceDefinition = engine.getCardDefinitionById(
    action.sourceEffectDefinitionId ?? action.sourceDefinitionId
  );
  const effect = sourceDefinition?.effects?.[registration.effectIndex];
  const onlyStep = effect?.steps.length === 1 ? effect.steps[0] : undefined;
  if (
    onlyStep?.executionMode === "optional" ||
    onlyStep?.action.kind !== "summon" ||
    onlyStep.action.target.kind !== "from_zone"
  ) {
    return undefined;
  }

  return node.choices.find(
    (choice) => choice.action?.kind === "pass_battle_flash"
  );
}

function isManualCoreMoveChoice(choice: TrainingDecisionChoice): boolean {
  return (
    choice.systemAction?.kind === "manual_core_move" ||
    choice.systemAction?.kind === "commit_factored_manual_core_move"
  );
}

function isPendingReselectChoice(choice: TrainingDecisionChoice): boolean {
  return choice.action?.kind === "select_pending_to_resolve";
}

function isProgressChoice(choice: TrainingDecisionChoice): boolean {
  if (isPendingReselectChoice(choice)) return false;
  return choice.action !== undefined || choice.systemAction !== undefined;
}

function shouldPreferHeuristicProgressChoice(
  node: TrainingDecisionNode,
  selected: TrainingDecisionChoice,
  heuristicSelected: TrainingDecisionChoice
): boolean {
  const selectedIsLowProgress =
    isManualCoreMoveChoice(selected) || isPendingReselectChoice(selected);
  if (!selectedIsLowProgress) return false;
  if (
    isManualCoreMoveChoice(heuristicSelected) ||
    isPendingReselectChoice(heuristicSelected)
  ) {
    return false;
  }
  if (!isProgressChoice(heuristicSelected)) return false;
  const manualCoreMoveChoices = node.choices.filter(isManualCoreMoveChoice);
  return isPendingReselectChoice(selected) || manualCoreMoveChoices.length > 1;
}

export function searchTrainingDecisionMcts(
  state: GameState,
  node: TrainingDecisionNode,
  engine: Engine,
  opts: TrainingMctsOptions = {},
  rng: Rng = Math.random
): TrainingMctsSearchResult {
  return measureAiWork(opts.telemetry, "decision", () =>
    searchTrainingDecisionMctsInner(state, node, engine, opts, rng)
  );
}
