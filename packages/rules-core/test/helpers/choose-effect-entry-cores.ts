import { applyLegalAction } from "../../src/legal/legal-actions-apply";
import type { ApplyLegalActionOptions, GameState } from "../../src/model";
import {
  finishCoreChoices,
  executeEffectWithChosenMinimumCores,
} from "./core-choice-driver";

type Lookups = Pick<
  ApplyLegalActionOptions,
  | "getCardDefinitionById"
  | "getRegisteredTriggeredEffectActions"
  | "getRegisteredBurstActions"
>;

/** Explicit test-player input; use the shared driver for both payment and entry choices. */
export function chooseEffectEntryCores(
  state: GameState,
  options: Lookups
): GameState {
  return finishCoreChoices(state, options.getCardDefinitionById, options);
}
export const executeEffectAndChooseEntryCores =
  executeEffectWithChosenMinimumCores;

export function applyActionAndChooseEntryCores(
  options: ApplyLegalActionOptions
): ReturnType<typeof applyLegalAction> {
  const result = applyLegalAction(options);
  return { ...result, state: chooseEffectEntryCores(result.state, options) };
}
