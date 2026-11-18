/**
 * GameState を内包する型の「型グラフ」(生成物。手で編集しない)。
 *
 * 旧形式の使用会計 migration (migration.ts) が、入れ子の GameState (priorStateSnapshot /
 * effectResolutionBeforeState / resumePreviousStepPreState / originalState / beforeState /
 * triggerBeforeState …) と、使用会計の運搬フィールド (recordedUsage / refundableUsage /
 * normalHandPlayRollback) を訪問するために使う。生JSONを汎用再帰して field 名が似たものを
 * 変換しないよう、model.ts の型から導出した「親型 → フィールド → 子型」だけを辿る。
 *
 * 生成: node scripts/generate-effect-usage-nested-states.mjs
 * 検証: test/effect-usage-nested-states.test.ts が model.ts の型から再導出して一致を確認する。
 */

export type NestedStateCarrier =
  | "normalHandPlayRollback"
  | "recordedUsage"
  | "refundableUsage";

export interface NestedStateEdge {
  /** 親型のフィールド名。 */
  readonly prop: string;
  /** 配列フィールドか。 */
  readonly array: boolean;
  /** 子型の名前 (NESTED_STATE_GRAPH のキー)。union は複数。 */
  readonly targets: readonly string[];
}

export interface NestedStateNode {
  readonly edges: readonly NestedStateEdge[];
  /** この型が持つ使用会計の運搬フィールド。 */
  readonly carriers: readonly NestedStateCarrier[];
}

/** 型名 → その型が持つ辺。"GameState" が根 (入れ子の GameState も同じ型)。 */
export const NESTED_STATE_GRAPH: Readonly<Record<string, NestedStateNode>> = {
  ActiveAttack: {
    edges: [
      {
        prop: "flashWindowState",
        array: false,
        targets: ["BattleFlashWindowState"],
      },
    ],
    carriers: [],
  },
  ActiveStack: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      {
        prop: "previousPendingStackAction",
        array: false,
        targets: ["ActiveStack"],
      },
      {
        prop: "supplementalTriggerEvents",
        array: true,
        targets: ["SupplementalTriggerEvent"],
      },
      {
        prop: "triggeredPendingSnapshot",
        array: false,
        targets: ["PendingTriggeredEffect"],
      },
    ],
    carriers: ["normalHandPlayRollback", "recordedUsage"],
  },
  BattleFlashWindowState: {
    edges: [
      { prop: "pendingStackAction", array: false, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  ChangeData: {
    edges: [{ prop: "effects", array: true, targets: ["Effect"] }],
    carriers: [],
  },
  CoreDistributionContinuation: {
    edges: [
      { prop: "initialStepResults", array: true, targets: ["StepResult"] },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      {
        prop: "resumePreviousStepPreState",
        array: false,
        targets: ["GameState"],
      },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
      {
        prop: "targetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
    ],
    carriers: ["recordedUsage"],
  },
  CoreDistributionTargetInterruptionContext: {
    edges: [
      {
        prop: "effectResolutionBeforeState",
        array: false,
        targets: ["GameState"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: [],
  },
  CoreSourceAllocationContinuation: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: ["recordedUsage"],
  },
  DeckRevealAction: {
    edges: [
      { prop: "beforeMoveSteps", array: true, targets: ["EffectStep"] },
      { prop: "beforePickSteps", array: true, targets: ["EffectStep"] },
    ],
    carriers: [],
  },
  DeferredSummonDeclaration: {
    edges: [{ prop: "originalState", array: false, targets: ["GameState"] }],
    carriers: [],
  },
  Effect: {
    edges: [{ prop: "steps", array: true, targets: ["EffectStep"] }],
    carriers: [],
  },
  EffectStep: {
    edges: [
      { prop: "action", array: false, targets: ["EffectStep.action"] },
      { prop: "choice", array: true, targets: ["EffectStep"] },
    ],
    carriers: [],
  },
  "EffectStep.action": {
    edges: [
      { prop: "beforeMoveSteps", array: true, targets: ["EffectStep"] },
      { prop: "beforePickSteps", array: true, targets: ["EffectStep"] },
      { prop: "grantedEffect", array: false, targets: ["Effect"] },
      {
        prop: "normalActionDeclarationSteps",
        array: true,
        targets: ["EffectStep"],
      },
      { prop: "pending", array: false, targets: ["PendingDeckReveal"] },
      {
        prop: "zoneAction",
        array: false,
        targets: ["PendingSplitSummonChoice.zoneAction"],
      },
    ],
    carriers: [],
  },
  EffectSummonCostPaymentContinuation: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: ["recordedUsage"],
  },
  ExtraTurnState: {
    edges: [
      {
        prop: "returnContext",
        array: false,
        targets: ["ExtraTurnState.returnContext"],
      },
    ],
    carriers: [],
  },
  "ExtraTurnState.returnContext": {
    edges: [
      { prop: "activeAttack", array: false, targets: ["ActiveAttack"] },
      { prop: "extraTurnState", array: false, targets: ["ExtraTurnState"] },
    ],
    carriers: [],
  },
  GameState: {
    edges: [
      { prop: "activeAttack", array: false, targets: ["ActiveAttack"] },
      { prop: "extraTurnState", array: false, targets: ["ExtraTurnState"] },
      {
        prop: "pendingAccelCleanups",
        array: true,
        targets: ["GameState.pendingAccelCleanups"],
      },
      {
        prop: "pendingAfterTriggersContinuations",
        array: true,
        targets: ["PendingAfterTriggersContinuation"],
      },
      {
        prop: "pendingAsIfSoulCoreChoice",
        array: false,
        targets: ["PendingAsIfSoulCoreChoice"],
      },
      {
        prop: "pendingAttackStepEndFinalizations",
        array: true,
        targets: ["PendingAttackStepEndFinalization"],
      },
      {
        prop: "pendingBattleEndDeferrals",
        array: true,
        targets: ["PendingBattleEndDeferral"],
      },
      {
        prop: "pendingBorrowedEffectTargetSelection",
        array: false,
        targets: ["PendingBorrowedEffectTargetSelection"],
      },
      {
        prop: "pendingBraveCombineChoice",
        array: false,
        targets: ["PendingBraveCombineChoice"],
      },
      {
        prop: "pendingChangeCleanupChoice",
        array: false,
        targets: ["PendingChangeCleanupChoice"],
      },
      {
        prop: "pendingCoreCountSelection",
        array: false,
        targets: ["PendingCoreCountSelection"],
      },
      {
        prop: "pendingCoreDistribution",
        array: false,
        targets: ["PendingCoreDistribution"],
      },
      {
        prop: "pendingCoreShootSelection",
        array: false,
        targets: ["PendingCoreShootSelection"],
      },
      {
        prop: "pendingCoreSourceAllocation",
        array: false,
        targets: ["PendingCoreSourceAllocation"],
      },
      {
        prop: "pendingCoreSplitSelection",
        array: false,
        targets: ["PendingCoreSplitSelection"],
      },
      {
        prop: "pendingCountSelection",
        array: false,
        targets: ["PendingCountSelection"],
      },
      {
        prop: "pendingDeckReveal",
        array: false,
        targets: ["PendingDeckReveal"],
      },
      {
        prop: "pendingDeckRevealCountBoostChoice",
        array: false,
        targets: ["PendingDeckRevealCountBoostChoice"],
      },
      {
        prop: "pendingDeckRevealSwapChain",
        array: true,
        targets: ["PendingZoneSelection"],
      },
      {
        prop: "pendingDeferredTriggeredEffects",
        array: true,
        targets: ["PendingTriggeredEffect"],
      },
      {
        prop: "pendingDiscardSetBurstCountSelection",
        array: false,
        targets: ["PendingDiscardSetBurstCountSelection"],
      },
      {
        prop: "pendingEffectOptionalRepeatChoice",
        array: false,
        targets: ["PendingEffectOptionalRepeatChoice"],
      },
      {
        prop: "pendingEffectOptionalRepeatCountSelection",
        array: false,
        targets: ["PendingEffectOptionalRepeatCountSelection"],
      },
      {
        prop: "pendingEffectSummonCostPayment",
        array: false,
        targets: ["PendingEffectSummonCostPayment"],
      },
      {
        prop: "pendingEffectTargetSelection",
        array: false,
        targets: ["PendingEffectTargetSelection"],
      },
      {
        prop: "pendingEnterFieldPlacement",
        array: false,
        targets: ["PendingEnterFieldPlacement"],
      },
      {
        prop: "pendingFieldHandSwapChoice",
        array: false,
        targets: ["PendingFieldHandSwapChoice"],
      },
      {
        prop: "pendingHandTrashSwapChoice",
        array: false,
        targets: ["PendingHandTrashSwapChoice"],
      },
      {
        prop: "pendingLifeCoreSelection",
        array: false,
        targets: ["PendingLifeCoreSelection"],
      },
      {
        prop: "pendingLifeDamageDiscardChoice",
        array: false,
        targets: ["PendingLifeDamageDiscardChoice"],
      },
      {
        prop: "pendingLifeGainReplacementChoice",
        array: false,
        targets: ["PendingLifeGainReplacementChoice"],
      },
      {
        prop: "pendingLinkAidCostSourceChoice",
        array: false,
        targets: ["PendingLinkAidCostSourceChoice"],
      },
      {
        prop: "pendingMultiPlacement",
        array: false,
        targets: ["PendingMultiPlacement"],
      },
      {
        prop: "pendingPayToActCoreGate",
        array: false,
        targets: ["PendingPayToActCoreGate"],
      },
      {
        prop: "pendingPayToActHandDiscardGate",
        array: false,
        targets: ["PendingPayToActHandDiscardGate"],
      },
      {
        prop: "pendingPreDeclarationConfirmation",
        array: false,
        targets: ["PreDeclarationStackWindow"],
      },
      {
        prop: "pendingReverseRebirthSummon",
        array: false,
        targets: ["PendingReverseRebirthSummon"],
      },
      {
        prop: "pendingSetAsideExitReplacementChoice",
        array: false,
        targets: ["PendingSetAsideExitReplacementChoice"],
      },
      {
        prop: "pendingSplitSummonChoice",
        array: false,
        targets: ["PendingSplitSummonChoice"],
      },
      {
        prop: "pendingStackCascade",
        array: false,
        targets: ["GameState.pendingStackCascade"],
      },
      {
        prop: "pendingStackCascadeFlushGuardStacks",
        array: true,
        targets: ["ActiveStack"],
      },
      {
        prop: "pendingStepChoice",
        array: false,
        targets: ["PendingStepChoice"],
      },
      {
        prop: "pendingStepOptionalChoice",
        array: false,
        targets: ["PendingStepOptionalChoice"],
      },
      {
        prop: "pendingStepOptionalTargetSelection",
        array: false,
        targets: ["PendingStepOptionalTargetSelection"],
      },
      {
        prop: "pendingStoneFlipCombine",
        array: false,
        targets: ["PendingStoneFlipCombine"],
      },
      {
        prop: "pendingTargetRedirects",
        array: true,
        targets: ["PendingTargetRedirect"],
      },
      {
        prop: "pendingTargetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
      {
        prop: "pendingTenshoSummon",
        array: false,
        targets: ["PendingTenshoSummon"],
      },
      {
        prop: "pendingTriggeredEffects",
        array: true,
        targets: ["PendingTriggeredEffect"],
      },
      {
        prop: "pendingTurnEndFinalizations",
        array: true,
        targets: ["PendingTurnEndFinalization"],
      },
      {
        prop: "pendingZoneSelection",
        array: false,
        targets: ["PendingZoneSelection"],
      },
      {
        prop: "preDeclarationStackWindow",
        array: false,
        targets: ["PreDeclarationStackWindow"],
      },
      {
        prop: "semanticTriggerEvents",
        array: true,
        targets: ["SemanticTriggerEvent"],
      },
      { prop: "stackWindow", array: false, targets: ["StackWindow"] },
    ],
    carriers: [],
  },
  "GameState.pendingAccelCleanups": {
    edges: [{ prop: "changeData", array: false, targets: ["ChangeData"] }],
    carriers: [],
  },
  "GameState.pendingStackCascade": {
    edges: [{ prop: "remainingStacks", array: true, targets: ["ActiveStack"] }],
    carriers: [],
  },
  LifeCoreSelectionContinuation: {
    edges: [
      { prop: "initialStepResults", array: true, targets: ["StepResult"] },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      {
        prop: "resumePreviousStepPreState",
        array: false,
        targets: ["GameState"],
      },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
      {
        prop: "targetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
    ],
    carriers: ["recordedUsage"],
  },
  MultiPlacementContinuation: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
      {
        prop: "targetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
    ],
    carriers: ["recordedUsage"],
  },
  PendingAfterTriggersContinuation: {
    edges: [
      {
        prop: "effectResolutionBeforeState",
        array: false,
        targets: ["GameState"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: ["recordedUsage"],
  },
  PendingAsIfSoulCoreChoice: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      {
        prop: "effectResume",
        array: false,
        targets: ["PendingAsIfSoulCoreChoice.effectResume"],
      },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  "PendingAsIfSoulCoreChoice.effectResume": {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["StepOptionalContinuation"],
      },
    ],
    carriers: [],
  },
  PendingAttackStepEndBlockedRetry: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["StepOptionalContinuation"],
      },
    ],
    carriers: [],
  },
  PendingAttackStepEndFinalization: {
    edges: [
      {
        prop: "blockedByOpponentRetry",
        array: false,
        targets: ["PendingAttackStepEndBlockedRetry"],
      },
    ],
    carriers: ["refundableUsage"],
  },
  PendingBattleEndDeferral: {
    edges: [
      {
        prop: "restoredStepContext",
        array: false,
        targets: ["SerializedStepContext"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
    ],
    carriers: [],
  },
  PendingBorrowedEffectTargetSelection: {
    edges: [
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: ["recordedUsage"],
  },
  PendingBraveCombineChoice: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      {
        prop: "effectSummon",
        array: false,
        targets: ["PendingBraveCombineChoice.effectSummon"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  "PendingBraveCombineChoice.effectSummon": {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["MultiPlacementContinuation"],
      },
      { prop: "triggerBeforeState", array: false, targets: ["GameState"] },
    ],
    carriers: [],
  },
  PendingChangeCleanupChoice: {
    edges: [{ prop: "changeData", array: false, targets: ["ChangeData"] }],
    carriers: [],
  },
  PendingConditionalCostRollback: {
    edges: [{ prop: "originalState", array: false, targets: ["GameState"] }],
    carriers: [],
  },
  PendingCoreCountSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["ZoneSelectionContinuation"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
    ],
    carriers: [],
  },
  PendingCoreDistribution: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["CoreDistributionContinuation"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
      {
        prop: "supplementalTriggerEvents",
        array: true,
        targets: ["SupplementalTriggerEvent"],
      },
      {
        prop: "targetInterruption",
        array: false,
        targets: ["CoreDistributionTargetInterruptionContext"],
      },
    ],
    carriers: [],
  },
  PendingCoreShootSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
      {
        prop: "ownerCoreChoice",
        array: false,
        targets: ["PendingCoreShootSelection.ownerCoreChoice"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "remainingActions", array: true, targets: ["DeckRevealAction"] },
    ],
    carriers: [],
  },
  "PendingCoreShootSelection.ownerCoreChoice": {
    edges: [
      {
        prop: "originalPending",
        array: false,
        targets: ["PendingCoreShootSelection"],
      },
    ],
    carriers: [],
  },
  PendingCoreSourceAllocation: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["CoreSourceAllocationContinuation"],
      },
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingCoreSplitSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["CoreDistributionContinuation"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
    ],
    carriers: [],
  },
  PendingCountSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["ZoneSelectionContinuation"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
    ],
    carriers: [],
  },
  PendingDeckReveal: {
    edges: [
      { prop: "beforeMoveSteps", array: true, targets: ["EffectStep"] },
      { prop: "beforePickSteps", array: true, targets: ["EffectStep"] },
      {
        prop: "continuation",
        array: false,
        targets: ["ZoneSelectionContinuation"],
      },
      {
        prop: "pendingSwapOut",
        array: false,
        targets: ["PendingZoneSelection"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
    ],
    carriers: [],
  },
  "PendingDeckReveal.postResolutionOracle": {
    edges: [
      {
        prop: "effectActivationEventFactOccurrences",
        array: true,
        targets: ["TriggerEventFacts"],
      },
      {
        prop: "oracleTriggerEventFacts",
        array: false,
        targets: ["TriggerEventFacts"],
      },
      { prop: "useCostGateCoreMoveResume", array: false, targets: ["Pick"] },
    ],
    carriers: [],
  },
  PendingDeckRevealCountBoostChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["StepOptionalContinuation"],
      },
    ],
    carriers: [],
  },
  PendingDiscardSetBurstCountSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["ZoneSelectionContinuation"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
    ],
    carriers: [],
  },
  PendingEffectOptionalRepeatChoice: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingEffectOptionalRepeatCountSelection: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingEffectSummonCostPayment: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["EffectSummonCostPaymentContinuation"],
      },
      {
        prop: "splitSummonChoice",
        array: false,
        targets: ["PendingEffectSummonCostPayment.splitSummonChoice"],
      },
      {
        prop: "summonDeclaration",
        array: false,
        targets: ["DeferredSummonDeclaration"],
      },
    ],
    carriers: [],
  },
  "PendingEffectSummonCostPayment.splitSummonChoice": {
    edges: [
      { prop: "pending", array: false, targets: ["PendingSplitSummonChoice"] },
    ],
    carriers: [],
  },
  PendingEffectTargetSelection: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingEnterFieldPlacement: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      {
        prop: "effectBraveCombineAsSummon",
        array: false,
        targets: ["PendingEnterFieldPlacement.effectBraveCombineAsSummon"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  "PendingEnterFieldPlacement.effectBraveCombineAsSummon": {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["MultiPlacementContinuation"],
      },
      {
        prop: "effectResolutionBeforeState",
        array: false,
        targets: ["GameState"],
      },
    ],
    carriers: [],
  },
  PendingFieldHandSwapChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
    ],
    carriers: [],
  },
  PendingHandTrashSwapChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
    ],
    carriers: [],
  },
  PendingLifeCoreSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
      {
        prop: "deferredCoreMoveChoice",
        array: false,
        targets: ["PendingLifeCoreSelection.deferredCoreMoveChoice"],
      },
      {
        prop: "lifeDamageInterception",
        array: false,
        targets: ["PendingLifeDamageDiscardChoice"],
      },
    ],
    carriers: [],
  },
  "PendingLifeCoreSelection.deferredCoreMoveChoice": {
    edges: [{ prop: "beforeState", array: false, targets: ["GameState"] }],
    carriers: [],
  },
  PendingLifeDamageDiscardChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
    ],
    carriers: [],
  },
  PendingLifeGainReplacementChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
    ],
    carriers: [],
  },
  PendingLinkAidCostSourceChoice: {
    edges: [{ prop: "deferredStack", array: false, targets: ["ActiveStack"] }],
    carriers: [],
  },
  PendingMirageSetChoice: {
    edges: [{ prop: "reveal", array: false, targets: ["PendingDeckReveal"] }],
    carriers: [],
  },
  PendingMultiPlacement: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["MultiPlacementContinuation"],
      },
      {
        prop: "deckRevealResume",
        array: false,
        targets: ["PendingMultiPlacement.deckRevealResume"],
      },
      {
        prop: "preCostEffectContinuation",
        array: false,
        targets: ["MultiPlacementContinuation"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
      {
        prop: "summonDeclaration",
        array: false,
        targets: ["DeferredSummonDeclaration"],
      },
    ],
    carriers: [],
  },
  "PendingMultiPlacement.deckRevealResume": {
    edges: [{ prop: "reveal", array: false, targets: ["PendingDeckReveal"] }],
    carriers: [],
  },
  PendingPayToActCoreGate: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingPayToActHandDiscardGate: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingReverseRebirthSummon: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["ReverseRebirthSummonContinuation"],
      },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingSetAsideExitReplacementChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
    ],
    carriers: [],
  },
  PendingSplitSummonChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["CoreDistributionContinuation"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      {
        prop: "zoneAction",
        array: false,
        targets: ["PendingSplitSummonChoice.zoneAction"],
      },
    ],
    carriers: [],
  },
  "PendingSplitSummonChoice.zoneAction": {
    edges: [
      {
        prop: "normalActionDeclarationSteps",
        array: true,
        targets: ["EffectStep"],
      },
    ],
    carriers: [],
  },
  PendingStepChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["StepOptionalContinuation"],
      },
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      {
        prop: "mirageSetChoice",
        array: false,
        targets: ["PendingMirageSetChoice"],
      },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingStepOptionalChoice: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["StepOptionalContinuation"],
      },
    ],
    carriers: [],
  },
  PendingStepOptionalTargetSelection: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["StepOptionalContinuation"],
      },
    ],
    carriers: [],
  },
  PendingStoneFlipCombine: {
    edges: [
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
    ],
    carriers: [],
  },
  PendingTargetRedirect: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["RedirectActionContinuation"],
      },
    ],
    carriers: [],
  },
  PendingTenshoSummon: {
    edges: [
      { prop: "deferredStack", array: false, targets: ["ActiveStack"] },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  PendingTriggeredEffect: {
    edges: [
      {
        prop: "eventFactOccurrences",
        array: true,
        targets: ["TriggerEventFacts"],
      },
    ],
    carriers: [],
  },
  PendingTurnEndFinalization: { edges: [], carriers: ["refundableUsage"] },
  PendingZoneSelection: {
    edges: [
      {
        prop: "adventPreparation",
        array: false,
        targets: ["PendingZoneSelection.adventPreparation"],
      },
      {
        prop: "continuation",
        array: false,
        targets: ["ZoneSelectionContinuation"],
      },
      {
        prop: "deckRevealResumeAfterSwapSelection",
        array: false,
        targets: ["PendingDeckReveal"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "priorStateSnapshot", array: false, targets: ["GameState"] },
      { prop: "remainingActions", array: true, targets: ["DeckRevealAction"] },
    ],
    carriers: [],
  },
  "PendingZoneSelection.adventPreparation": {
    edges: [{ prop: "declaredStack", array: false, targets: ["ActiveStack"] }],
    carriers: [],
  },
  Pick: {
    edges: [
      {
        prop: "continuation",
        array: false,
        targets: ["LifeCoreSelectionContinuation"],
      },
    ],
    carriers: [],
  },
  PreDeclarationStackWindow: {
    edges: [
      { prop: "pendingStackAction", array: false, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  RedirectActionContinuation: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: [],
  },
  ReverseRebirthSummonContinuation: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
      {
        prop: "targetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
    ],
    carriers: ["recordedUsage"],
  },
  SemanticTriggerEvent: {
    edges: [
      {
        prop: "eventFactOccurrences",
        array: true,
        targets: ["TriggerEventFacts"],
      },
    ],
    carriers: [],
  },
  SerializedStepContext: {
    edges: [
      {
        prop: "conditionalCostOriginalState",
        array: false,
        targets: ["GameState"],
      },
      {
        prop: "pendingConditionalCostRollback",
        array: false,
        targets: ["PendingConditionalCostRollback"],
      },
      {
        prop: "resolutionSegmentBeforeState",
        array: false,
        targets: ["GameState"],
      },
    ],
    carriers: [],
  },
  StackWindow: {
    edges: [
      { prop: "pendingStackAction", array: false, targets: ["ActiveStack"] },
    ],
    carriers: [],
  },
  StepOptionalContinuation: {
    edges: [
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
      {
        prop: "targetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
    ],
    carriers: ["recordedUsage"],
  },
  StepResult: {
    edges: [{ prop: "stateSnapshot", array: false, targets: ["GameState"] }],
    carriers: [],
  },
  SupplementalTriggerEvent: {
    edges: [
      {
        prop: "eventFactOccurrences",
        array: true,
        targets: ["TriggerEventFacts"],
      },
    ],
    carriers: [],
  },
  TargetedDisclosureContinuation: {
    edges: [
      {
        prop: "conditionalCostResponseState",
        array: false,
        targets: ["GameState"],
      },
      {
        prop: "coreDistributionPending",
        array: false,
        targets: ["PendingCoreDistribution"],
      },
      {
        prop: "deferredStackResolution",
        array: false,
        targets: ["TargetedDisclosureContinuation.deferredStackResolution"],
      },
      {
        prop: "effectResolutionBeforeState",
        array: false,
        targets: ["GameState"],
      },
      {
        prop: "negateIdentitySnapshot",
        array: false,
        targets: ["ActiveStack"],
      },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      {
        prop: "previousTargetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
      { prop: "remainingStacks", array: true, targets: ["ActiveStack"] },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
    ],
    carriers: [],
  },
  "TargetedDisclosureContinuation.deferredStackResolution": {
    edges: [{ prop: "deferredStack", array: false, targets: ["ActiveStack"] }],
    carriers: [],
  },
  TriggerEventFacts: {
    edges: [
      {
        prop: "filterState",
        array: false,
        targets: ["TriggerEventFacts.filterState"],
      },
    ],
    carriers: [],
  },
  "TriggerEventFacts.filterState": {
    edges: [
      { prop: "activeAttack", array: false, targets: ["ActiveAttack"] },
      {
        prop: "pendingPreDeclarationConfirmation",
        array: false,
        targets: ["PreDeclarationStackWindow"],
      },
      {
        prop: "preDeclarationStackWindow",
        array: false,
        targets: ["PreDeclarationStackWindow"],
      },
    ],
    carriers: [],
  },
  ZoneSelectionContinuation: {
    edges: [
      { prop: "initialStepResults", array: true, targets: ["StepResult"] },
      {
        prop: "postResolutionOracle",
        array: false,
        targets: ["PendingDeckReveal.postResolutionOracle"],
      },
      { prop: "resumeEffectOverride", array: false, targets: ["Effect"] },
      {
        prop: "resumePreviousStepPreState",
        array: false,
        targets: ["GameState"],
      },
      { prop: "stepContext", array: false, targets: ["SerializedStepContext"] },
      {
        prop: "targetedDisclosureContinuation",
        array: false,
        targets: ["TargetedDisclosureContinuation"],
      },
    ],
    carriers: ["recordedUsage"],
  },
};
