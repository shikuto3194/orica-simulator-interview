import type {
  GameState,
  CardDefinition,
  PendingPrivateDeclaration,
} from "../model";
import type { Effect } from "../dsl-types";
import type { TriggeredEffectActionRegistrationLookup } from "./trigger-system";
import { evaluateCondition } from "./structured-condition-eval";
import { evaluateStepCondition } from "./native-condition-connector";
import { canExecuteOptionalStep } from "./native-effect-front-helpers";
import { createStepExecutionContext } from "../step-execution-context";

export function isPrivateTriggeredDeclarationConditionMet(options: {
  state: GameState;
  declaration: PendingPrivateDeclaration;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}): boolean {
  const registration = options.getRegisteredTriggeredEffectActions(
    options.sourceDefinition.cardNo
  )?.[options.declaration.registrationIndex];
  const effectIndex = registration?.effectIndex;
  if (effectIndex === undefined) return true;
  const effect = options.sourceDefinition.effects?.[effectIndex];
  if (!effect) {
    return true;
  }
  const triggerContext =
    options.declaration.fromZone !== undefined
      ? { fromZone: options.declaration.fromZone }
      : undefined;
  if (
    effect.condition &&
    effect.condition.length > 0 &&
    !evaluateCondition(
      options.state,
      effect.condition,
      options.declaration.sourceInstanceId,
      options.declaration.actingPlayerId,
      options.getCardDefinitionById,
      triggerContext
    )
  ) {
    return false;
  }
  return arePrivateDeclarationInitialStepConditionsMet({
    ...options,
    effect,
  });
}

function arePrivateDeclarationInitialStepConditionsMet(options: {
  state: GameState;
  declaration: PendingPrivateDeclaration;
  sourceDefinition: CardDefinition;
  effect: Effect;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const firstStep = options.effect.steps[0];
  if (!firstStep) {
    return true;
  }
  const stepContext = createStepExecutionContext(options.state);
  stepContext.sourceInstanceId = options.declaration.sourceInstanceId;
  if (options.declaration.relatedInstanceId !== null) {
    stepContext.triggerRelatedInstanceId =
      options.declaration.relatedInstanceId;
  }
  if (options.declaration.triggerRelatedCombinedHostInstanceId !== undefined) {
    stepContext.triggerRelatedCombinedHostInstanceId =
      options.declaration.triggerRelatedCombinedHostInstanceId;
  }
  if (options.declaration.relatedInstanceIds !== undefined) {
    stepContext.triggerRelatedInstanceIds = [
      ...options.declaration.relatedInstanceIds,
    ];
  }
  if (options.declaration.amount !== null) {
    stepContext.eventAmount = options.declaration.amount;
  }
  const triggerContext =
    options.declaration.fromZone !== undefined
      ? { fromZone: options.declaration.fromZone }
      : undefined;
  if (
    firstStep.condition &&
    firstStep.condition.length > 0 &&
    !evaluateCondition(
      options.state,
      firstStep.condition,
      options.declaration.sourceInstanceId,
      options.declaration.actingPlayerId,
      options.getCardDefinitionById,
      triggerContext
    )
  ) {
    return false;
  }
  if (
    firstStep.action?.kind === "brave_combine_effect" &&
    firstStep.action.asSummon === true &&
    !canExecuteOptionalStep({
      action: firstStep.action,
      state: options.state,
      actingPlayerId: options.declaration.actingPlayerId,
      sourceInstanceId: options.declaration.sourceInstanceId,
      sourceDefinition: options.sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
      stepCtx: stepContext,
    })
  ) {
    return false;
  }
  if (!firstStep.stepCondition) {
    return true;
  }
  return evaluateStepCondition(
    firstStep.stepCondition,
    stepContext,
    options.state,
    options.getCardDefinitionById
  );
}
