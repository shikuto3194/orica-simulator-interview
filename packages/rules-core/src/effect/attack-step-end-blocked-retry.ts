import type { GameState, PendingAttackStepEndBlockedRetry } from "../model";
import type { CardDefinition } from "../model";
import type { SerializedStepContext } from "../step-execution-context";
import { deserializeStepContext } from "../step-execution-context";
import { evaluateStepCondition } from "./native-condition-connector";

export function evaluateAttackStepEndBlockedRetryCondition(options: {
  state: GameState;
  retry: PendingAttackStepEndBlockedRetry;
  stepContext: SerializedStepContext;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const stepCtx = deserializeStepContext(options.stepContext, options.state);
  stepCtx.sourceInstanceId = options.retry.continuation.sourceInstanceId;
  if (options.retry.continuation.eventAmount !== undefined) {
    stepCtx.eventAmount = options.retry.continuation.eventAmount;
  }
  if (options.retry.continuation.costPaidThisEffect !== undefined) {
    stepCtx.costPaidThisEffect = options.retry.continuation.costPaidThisEffect;
  }
  return evaluateStepCondition(
    options.retry.stepCondition,
    stepCtx,
    options.state,
    options.getCardDefinitionById
  );
}
