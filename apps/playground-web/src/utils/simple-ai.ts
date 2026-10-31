import {
  advanceStep,
  applyLegalAction,
  generateActionInputChoices,
  getGameProgressBlockerReason,
  getPendingPromptResolverPlayerIds,
  materializeDeferredTrashOptionalAdds,
  type ActionInputOptions,
  type ApplyLegalActionOptions,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";

export type PlayerController = (
  state: GameState,
  legalActions: LegalAction[]
) => LegalAction | null;

/** A simple policy; required action inputs are supplied by the shared chooser. */
export const autoPlayerController: PlayerController = (_state, actions) =>
  actions[0] ?? null;

export interface SimpleAiProgress {
  phase: string;
  declarations: Set<string>;
}

export function createSimpleAiProgress(): SimpleAiProgress {
  return { phase: "", declarations: new Set() };
}

type EngineContext = Omit<ApplyLegalActionOptions, "state" | "action">;

/** Pending resolutions and response passes must never be limited by the policy. */
function declarationKey(state: GameState, action: LegalAction): string | null {
  if (getPendingPromptResolverPlayerIds(state)?.has(action.actingPlayerId))
    return null;
  if (
    /^(resolve_|pass_|decline_|skip_|select_|confirm_|open_|end_)/.test(
      action.kind
    )
  )
    return null;
  return action.actionId;
}

function inputCost(input: ActionInputOptions): number {
  const payments = [
    ...(input.paymentSources ?? []),
    ...(input.summonPaymentSources ?? []),
  ];
  const placements = [
    ...(input.enterFieldCorePlacements ?? []),
    ...(input.summonEnterFieldCorePlacements ?? []),
  ];
  return (
    payments.reduce(
      (cost, source) =>
        cost +
        source.amount +
        (source.kind === "card" ? 100 : 0) +
        (source.includeSoulCore ? 10 : 0),
      0
    ) +
    placements.reduce(
      (cost, source) =>
        cost +
        ("amount" in source ? source.amount : 1) +
        (source.kind.startsWith("card_") ? 100 : 0) +
        (source.kind.endsWith("soul") ? 10 : 0),
      0
    )
  );
}

function logicalState(state: GameState): string {
  const {
    log: _log,
    actionStartLogIndex: _index,
    publicDisclosures: _disclosures,
    ...rest
  } = state;
  void _log;
  void _index;
  void _disclosures;
  return JSON.stringify(rest);
}

/** One game transition, using the same action inputs as the manual engine API. */
export function advanceSimpleAi(options: {
  state: GameState;
  actions: LegalAction[];
  playerId: string;
  canAdvance: boolean;
  engine: EngineContext;
  progress: SimpleAiProgress;
  controller?: PlayerController;
}): {
  state: GameState;
  action?: LegalAction | "step";
  inputs?: ActionInputOptions;
} | null {
  const { state, playerId, engine, progress } = options;
  // 先後選択・マリガンはプレゲーム側が進める。legal actions が空でも
  // canAdvance によるステップ送りで開始前の手札やログを変更しない。
  if (state.preGame || state.gameResult) return null;
  const controller = options.controller ?? autoPlayerController;
  const phase = `${state.turnNumber}:${state.activePlayerId}:${state.step}`;
  if (progress.phase !== phase) {
    progress.phase = phase;
    progress.declarations.clear();
  }
  const automated = controller === autoPlayerController;
  if (automated) {
    const materialized = materializeDeferredTrashOptionalAdds(state);
    if (materialized !== state) return { state: materialized };
  }
  const actions = options.actions.filter((action) => {
    if (!action.can || action.actingPlayerId !== playerId) return false;
    const key = declarationKey(state, action);
    return (
      !automated ||
      key === null ||
      (!progress.declarations.has(key) && progress.declarations.size < 32)
    );
  });
  const chosen = controller(state, actions);
  // Custom controllers also implement manual scenario/replay mode. null is a
  // deliberate wait, never an instruction to advance another player's step.
  if (!automated && !chosen) return null;
  const ordered = chosen
    ? [chosen, ...(automated ? actions.filter((a) => a !== chosen) : [])]
    : [];
  const errors: string[] = [];
  const before = logicalState(state);
  for (const action of ordered) {
    try {
      const generated =
        "skipOnly" in action && action.skipOnly
          ? []
          : generateActionInputChoices(
              state,
              action,
              {
                getCardDefinitionById: engine.getCardDefinitionById,
              },
              64
            ).values;
      const inputs = generated.length
        ? generated.sort((a, b) => inputCost(a) - inputCost(b))
        : [{}];
      for (const input of inputs) {
        try {
          const next = applyLegalAction({
            ...engine,
            state,
            action,
            ...input,
          }).state;
          if (logicalState(next) === before) continue;
          const key = declarationKey(state, action);
          if (key) progress.declarations.add(key);
          return { state: next, action, inputs: input };
        } catch (error) {
          errors.push(
            `${action.kind}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      errors.push(
        `${action.kind}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (
    automated &&
    options.canAdvance &&
    state.activePlayerId === playerId &&
    getGameProgressBlockerReason(state) === null
  ) {
    const next = advanceStep(
      state,
      engine.getCardDefinitionById,
      engine.getRegisteredTriggeredEffectActions,
      engine.getRegisteredBurstActions,
      engine.getRegisteredMagicActions
    );
    if (logicalState(next) !== before) return { state: next, action: "step" };
  }
  if (ordered.length) {
    throw new Error(
      `簡易AIの行動を解決できませんでした (${ordered[0]!.kind})。${errors.at(-1) ?? "状態が変化しませんでした"}`
    );
  }
  if (automated && options.canAdvance && state.activePlayerId === playerId) {
    const blocker = getGameProgressBlockerReason(state);
    if (blocker)
      throw new Error(`簡易AIの進行待ちを解決できませんでした。${blocker}`);
  }
  return null;
}
