export * from "./model";
export { calculateLevelFromResources } from "./card/level-calculation";
export { randomDeck } from "./card/random-deck";
export * from "./state-sanitize";
export * from "./public-disclosure";
export * from "./known-deck";
export * from "./source-kinds";
export * from "./player-decision-contract";
export * from "./current-actor";
export * from "./factories";
export * from "./effect/effect-queue";
export * from "./turn-system";
export { hasEligibleMainStepEndMagicActivation } from "./legal/legal-actions-availability";
export * from "./core/core-system";
export * from "./core/core-draft";
export * from "./core/core-distribution-constraints";
export { canMoveCoresFrom } from "./core/core-movability";
export {
  getDeckRevealCostPaymentSources,
  getDeckRevealSelectedHandGainCost,
} from "./legal/deck-reveal-hand-gain-cost";
export { getZoneSelectionHandGainCost } from "./legal/zone-selection-hand-gain-cost";
export { getHandGainCostPaymentSources } from "./effect/hand-gain-cost";
export {
  canProvideEnterFieldCorePlacementSource,
  getEnterFieldCorePlacementSourceCapacity,
  getEnterFieldCorePlacementSourceBlockReason,
} from "./zone/enter-field-placement-execution";
export type {
  EnterFieldCorePlacementSourceBlockReason,
  EnterFieldCorePlacementSourceCoreKind,
} from "./zone/enter-field-placement-execution";
export * from "./core/cost-system";
export * from "./core/payment-system";
export * from "./play/play-card-system";
export * from "./battle/battle-system";
export {
  getFaceUpDeckIds,
  getDeckHandCards,
  getOwnHandCards,
  isInHandForOwnEffect,
} from "./effect/card-access-rules";
export {
  getCombinedUnitBp,
  getCombinedUnitSymbolBundles,
  getCombinedUnitSymbols,
  getEffectiveBp,
  getEffectiveLevel,
  getEffectiveSymbolBundles,
  getEffectiveSymbols,
  getEffectiveSymbolsForEntity,
  isSoulStateCard,
  recomputeBattleEntityBp,
  resolveEffectiveIdentity,
} from "./battle/battle-shared";
export type { EffectiveIdentity, SymbolBundle } from "./battle/battle-shared";
export * from "./battle/battle-immediate-effect-system";
export * from "./mechanics/burst-system";
export * from "./mechanics/hand-written-burst-post-resolution-policies";
export * from "./effect/effect-resolution";
export * from "./effect/trigger-system";
export * from "./effect/resolution-items";
export * from "./card/card-effect-system";
export * from "./legal/legal-actions";
export { previewBurstEffectSuppression } from "./legal/burst-activation-preview";
export * from "./mechanics/magic-system";
export * from "./effect/hand-written-effect-resolvers";
export * from "./state-based-actions";
export {
  buildReevaluationConfig,
  derivePreventionLevel,
  derivePreventionProfile,
  executeReevaluationCheck,
  matchesEffectTargetFilter,
  filterTargetsByPreventionLevel,
  getBpModifierTotal,
  getEffectiveColors,
  getEffectiveLevelCostDelta,
  getEffectiveTribes,
  getOverriddenProperties,
  getPreventionBlockReason,
  getStrongestDefenseLevel,
  getSymbolAdditions,
  isBlockedByFieldNameUniqueness,
  isBurstEffectNullifiedByOpponent,
  isCardManifestRestricted,
  isCardUseRestricted,
  isFlashRestricted,
  isStackRestricted,
  filterRestrictedTimings,
  assignLegalActionTargetGroups,
  clearExpiredEffectUsageRecords,
  composeRecordedUsage,
  getChoiceVariantUsageLabel,
  isLegalActionTargetGroupSelectionSatisfied,
  mergeRegistrationChoiceVariant,
  recordEffectUsage,
  recordEffectUsageIfLimited,
  refundEffectUsage,
  refundEffectUsageIfRecorded,
  resolveEmptyFireTargetCounts,
  runReevaluationAtTiming,
} from "./legal/legal-actions-shared";
export type {
  OverriddenProperties,
  ReevaluationConfig,
} from "./legal/legal-actions-shared";
export * from "./invariants/game-state-invariants";
export { collectContinuousEffectInvariantIssues } from "./invariants/game-state-invariants-continuous";
export * from "./effect/effect-affect-adapter";
export * from "./effect/structured-effect-interpreter";
export {
  isSafeStateForContinuousRebuild,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "./effect/continuous-effect-rebuild";
export type { RebuildContinuousEffectsOptions } from "./effect/continuous-effect-rebuild";
export {
  GAME_SNAPSHOT_SCHEMA_VERSION,
  createGameSnapshot,
  parseGameSnapshot,
  restoreSnapshot,
} from "./snapshot";
export type {
  GameSnapshot,
  GameSnapshotParseResult,
  SnapshotRestoreResult,
} from "./snapshot";
export * from "./effect/structured-effect-registrations";
export * from "./effect/effect-label-utils";
export * from "./summaries";
export { refreshPendingRebirthSeparationCoreSources } from "./mechanics/core-charge-distribution";
export * from "./mechanics/advent-system";
export * from "./mechanics/manifest-system";
export * from "./mechanics/accel-change-system";
export * from "./mechanics/mirage-system";
export * from "./mechanics/oracle-system";
export * from "./mechanics/grandstone-system";
export * from "./mechanics/quartz-system";
export * from "./mechanics/brave-spirit-state-recovery";
export { isCombinedBrave } from "./mechanics/virtual-combine";
export * from "./dsl-types";
export * from "./card/card-filter";
export * from "./step-execution-context";
export * from "./effect/target-affect-gate";
export * from "./effect/target-resolution";
export * from "./effect/effect-interpreter";
export {
  definitionEffectPath,
  resolveDefinitionEffect,
  sameDefinitionEffectPath,
} from "./effect/definition-effect-reference";
// P2-14: god-file 分解で effect-interpreter から移動した公開 helper の barrel 再公開
// (元は effect-interpreter の `export *` 経由で公開されていた public API を維持)。
export { getEffectPayCostAmount } from "./effect/native-effect-front-helpers";
export { executeMoveCardPrimitive } from "./effect/native-move-core-handlers";
export * from "./effect/retrigger-system";
export {
  isCEActiveForScope,
  isTimingScopeActive,
  getCEsForTarget,
  getGlobalCEs,
} from "./card/ce-lookup";
export {
  isSpirit,
  getEffectiveCategory,
  getActAsSpiritMetadata,
  getActAsSpiritKeywords,
  hasActAsSpiritKeyword,
  hasCannotCombineRestriction,
  hasDiscardOnLeaveRestriction,
  resolveActAsSpiritBp,
  resolveActAsSpiritLevel,
  resolveActAsSpiritColors,
  resolveActAsSpiritCardName,
  resolveActAsSpiritCost,
} from "./mechanics/act-as-spirit";
export type {
  ActAsSpiritStatAspect,
  ActAsSpiritStatSnapshot,
  ActAsSpiritStatBlueprint,
  ActAsSpiritOverrides,
  ActAsSpiritMetadata,
} from "./mechanics/act-as-spirit";
export {
  getRedirectEffectTargetMetadata,
  getRedirectEffectTargetsProtecting,
  resolveRedirectCandidateInstanceIds,
  findApplicableTargetRedirects,
  applyRedirectToResolvedTargets,
} from "./effect/redirect-effect-target";
export type {
  RedirectTriggerCondition,
  RedirectEffectTargetMetadata,
  TargetRedirectMatch,
} from "./effect/redirect-effect-target";
export {
  applyEffectParamOverridesToFilter,
  deriveEffectParamOverrideClass,
  getEffectParamOverrideMetadata,
} from "./effect/effect-param-override";
export type {
  EffectParamOverrideClass,
  EffectParamOverrideScope,
  EffectParamOverrideMetadata,
} from "./effect/effect-param-override";

export {
  EFFECT_ACTION_LABELS,
  effectActionLabel,
  localizeEffectLabel,
} from "./effect/action-display";
export { applyFieldPositions } from "./card/field-position";
export { generateActionInputChoices } from "./action-input-choices";
export type { ActionInputOptions } from "./action-input-choices";

export {
  ZONE_LABELS,
  STEP_LABELS,
  stepDisplayLabel,
  CARD_CATEGORY_LABELS,
  MECHANIC_LABELS,
  zoneDisplayLabel,
  cardCategoryLabel,
  mechanicDisplayLabel,
  coreLocationDisplayLabel,
} from "./display-names";

export { findTokenPoolPreCostForcedCombineTrigger } from "./legal/token-pool-pre-cost-forced-combine";
export { resolveGrantedEffectSourceDefinition } from "./effect/granted-effect-source";
