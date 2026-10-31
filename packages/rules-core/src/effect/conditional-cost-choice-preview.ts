import {
  applyCardCostPayments,
  getAvailablePayCostCoreSources,
} from "../core/payment-system";
import { visitPaymentSourceAllocations } from "../core/payment-allocation";
import { recordStepResult } from "../step-execution-context";
import type { Effect } from "../dsl-types";
import type { EffectPlayerRef, GameState } from "../model";
import { canExecuteOptionalStep } from "./native-effect-front-helpers";
import { evaluateStepCondition } from "./native-condition-connector";
import {
  cloneStateForPendingSnapshot,
  evaluateCondition,
  resolvePlayerRef,
} from "./structured-effect-interpreter";

/** A pay_cost choice is executable only if its conditional result can complete
 * after at least one legal payment. Preview allocations use the real payment
 * primitive and never mutate the live continuation or reserve/field cores.
 */
export function canExecuteChoiceConditionalCostPayload(
  args: Parameters<typeof canExecuteOptionalStep>[0] & {
    effect: Effect;
    stepIndex: number;
    choiceIndex: number;
    conditionSourceInstanceId: string;
    conditionSourceContext: Parameters<typeof evaluateCondition>[6];
    triggerContext: Parameters<typeof evaluateCondition>[5];
  }
): boolean {
  const resultStep = args.effect.steps[args.stepIndex + 1];
  if (
    resultStep?.connector !== "conditional_cost" ||
    args.action.kind !== "pay_cost"
  )
    return true;
  const payer = args.action.player
    ? resolvePlayerRef(
        args.actingPlayerId,
        args.action.player as EffectPlayerRef,
        args.state
      )
    : args.actingPlayerId;
  const mode =
    args.effect.timing.kind === "activated" && args.effect.timing.mode !== "any"
      ? args.effect.timing.mode
      : undefined;
  const sources = getAvailablePayCostCoreSources(
    args.state,
    payer,
    args.getCardDefinitionById,
    mode
  );
  const context = { ...args.stepCtx, results: new Map(args.stepCtx.results) };
  recordStepResult(context, {
    stepId: args.effect.steps[args.stepIndex]!.id ?? `__step_${args.stepIndex}`,
    affectedCardInstanceIds: [],
    succeeded: true,
    executed: true,
    chosenChoiceIndex: args.choiceIndex,
  });
  const canExecuteResult = (state: GameState): boolean => {
    if (
      resultStep.condition?.length &&
      !evaluateCondition(
        state,
        resultStep.condition,
        args.conditionSourceInstanceId,
        args.actingPlayerId,
        args.getCardDefinitionById,
        args.triggerContext,
        args.conditionSourceContext
      )
    )
      return false;
    if (
      resultStep.stepCondition &&
      !evaluateStepCondition(
        resultStep.stepCondition,
        context,
        state,
        args.getCardDefinitionById
      )
    )
      return false;
    return (resultStep.choice ?? [resultStep]).some((result) => {
      if (
        result.condition?.length &&
        !evaluateCondition(
          state,
          result.condition,
          args.conditionSourceInstanceId,
          args.actingPlayerId,
          args.getCardDefinitionById,
          args.triggerContext,
          args.conditionSourceContext
        )
      )
        return false;
      return canExecuteOptionalStep({
        ...args,
        targetStepId: resultStep.id ?? `__step_${args.stepIndex + 1}`,
        state,
        action: result.action,
        stepCtx: context,
        allowPartialTargetCount: false,
        allowEmptyTargets: false,
      });
    });
  };
  return visitPaymentSourceAllocations(
    [...sources].reverse().map((source) => ({
      kind: source.instanceId === "reserve" ? "reserve" : "card",
      ...(source.instanceId !== "reserve"
        ? { instanceId: source.instanceId }
        : {}),
      normalCap: source.normalAvailable,
      soulCap: source.hasSoulCore ? 1 : 0,
    })),
    args.action.amount,
    (paymentSources) => {
      try {
        return canExecuteResult(
          applyCardCostPayments({
            state: cloneStateForPendingSnapshot(args.state),
            actingPlayerId: payer,
            chainId: `choice-cost-preview:${args.sourceInstanceId}:${args.stepIndex}`,
            paymentSources,
            causedByEffectSourceInstanceId: args.sourceInstanceId,
            getCardDefinitionById: args.getCardDefinitionById,
          })
        );
      } catch {
        return false;
      }
    }
  );
}
