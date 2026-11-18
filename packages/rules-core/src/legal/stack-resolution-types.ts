// Shared stack-resolution type contracts extracted from legal-actions-apply.ts
// (P2-11 god-file decomposition phase5b). Imported by the stack-resolution core
// and its consumer handler modules to avoid a value-import cycle through the parent.
import type { ActiveStack, GameState } from "../model";
import type { ApplyLegalActionOptions } from "./legal-actions-types";

export type DeferredStackResolverOptions = Pick<
  ApplyLegalActionOptions,
  | "getCardDefinitionById"
  | "getHandWrittenEffectResolver"
  | "getRegisteredBattleImmediateEffectActions"
  | "resolvePendingBurstCheck"
  | "getPendingBurstCheckResolver"
  | "getRegisteredBurstActions"
  | "getRegisteredFieldCardEffectActions"
  | "getRegisteredHandActivatedEffectActions"
  | "getRegisteredMagicActions"
  | "getRegisteredTriggeredEffectActions"
  | "resolvePendingTriggeredEffect"
  | "getPendingTriggeredEffectResolver"
  | "getConditionalCostCanExecuteCheck"
  | "getConditionalResultSuccessCheck"
  | "getHandWrittenBurstPostResolutionPolicy"
  | "resolveFieldCardEffect"
>;

export type DeferredStackResolver = (
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
) => GameState;

export type StackRegistrationLookupOptions = Pick<
  ApplyLegalActionOptions,
  | "getCardDefinitionById"
  | "getRegisteredBattleImmediateEffectActions"
  | "getRegisteredBurstActions"
  | "getRegisteredFieldCardEffectActions"
  | "getRegisteredHandActivatedEffectActions"
  | "getRegisteredMagicActions"
  | "getRegisteredTriggeredEffectActions"
>;
