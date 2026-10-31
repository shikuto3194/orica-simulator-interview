import type { Action } from "../dsl-types";
import type {
  CardDefinition,
  EffectPreventionLevel,
  GameState,
} from "../model";
import type { StepExecutionContext } from "../step-execution-context";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  canEffectPenetrateDefense,
  matchesGlobalCETargetFilter,
} from "../legal/legal-actions-shared";
import { resolveProvenanceEffectForTiming } from "./continuous-effect-rebuild";
import {
  evaluateCondition,
  resolvePlayerRef,
} from "./structured-effect-interpreter";
import { resolveTargetSpec } from "./target-resolution";

/** 発揮済みの期間指定効果を対象ごとに照合する。スタックや将来の誘発予約は変更しない。 */
export function negateOngoingEffects(options: {
  state: GameState;
  action: Extract<Action, { kind: "negate_ongoing_effects" }>;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepCtx: StepExecutionContext;
  sourcePreventionLevel?: EffectPreventionLevel | undefined;
}): GameState {
  const { state, action, getCardDefinitionById } = options;
  const sourcePlayerId = resolvePlayerRef(
    options.actingPlayerId,
    action.sourcePlayer,
    state
  );
  const targets = resolveTargetSpec({
    ...options,
    targetSpec: action.target,
    stepContext: options.stepCtx,
  });
  const removed = new Set<string>();
  const activeContinuousEffects = state.activeContinuousEffects.filter((ce) => {
    if (ce.actingPlayerId !== sourcePlayerId || ce.modifierTag === "retrigger")
      return true;
    const origin = resolveProvenanceEffectForTiming({
      state,
      ce,
      getCardDefinitionById,
    });
    if (origin?.timing.kind === "continuous") return true;
    const protection =
      origin?.preventionLevelCondition?.length &&
      !evaluateCondition(
        state,
        origin.preventionLevelCondition,
        ce.sourceInstanceId,
        ce.actingPlayerId,
        getCardDefinitionById
      )
        ? "none"
        : (origin?.preventionLevel ?? "none");
    if (
      !canEffectPenetrateDefense(
        options.sourcePreventionLevel ?? "none",
        protection
      )
    )
      return true;
    if (
      !["turn", "battle", "attack", "step", "permanent"].includes(
        ce.duration.scope
      )
    )
      return true;
    const matches = targets.some(
      (card) =>
        ce.targetInstanceId === card.instanceId ||
        (ce.targetInstanceId === undefined &&
          ce.targetFilter !== undefined &&
          matchesGlobalCETargetFilter(
            state,
            ce,
            card,
            getCardDefinitionById,
            getTotalCoresOnCardById(state, card.instanceId)
          ))
    );
    if (matches) removed.add(ce.effectId);
    return !matches;
  });
  if (!removed.size) return state;
  return {
    ...state,
    activeContinuousEffects,
    log: [
      ...state.log,
      `effect:negate_ongoing_effects:${[...removed].join(",")}`,
    ],
  };
}
