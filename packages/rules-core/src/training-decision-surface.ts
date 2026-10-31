import { measureAiWork, type AiWorkTelemetry } from "./ai-work-telemetry";
import { isCoreDistributionAllocationValid } from "./core/core-distribution-constraints";
import {
  type ActionInputOptions,
  type ChoiceAccumulator,
  type TargetGroupLike,
  type TrainingPaymentSource,
  type TrainingPlacementSource,
  actionRecord,
  attackAdditionalSourceGroup,
  booleanValue,
  braveSeparationCoreGroup,
  canCompleteOverlappingNormalCoreDistributionTargetTotals,
  canRouteNormalCoreDistributionWithoutSelfMove,
  canSatisfyCoreDistributionSoulAllocation,
  chosenLifeCoreGroup,
  compactOptions,
  coreDistributionChoices,
  currentPlayer,
  fitsCombinedCoreDistributionSourceAvailability,
  fixedCoreDistributionTotalsMatch,
  followUpInputGroup,
  generateActionInputChoices,
  generateTopLevelActionInputChoices,
  hasCoreDistributionSourceOwnerChoice,
  hasDisjointCoreDistributionSources,
  hasOnlyOverlappingCoreDistributionSources,
  hasOnlyOverlappingNormalCoreDistributionSources,
  integerDistributions,
  makeAccumulator,
  numberValue,
  payCostGroup,
  paymentSourceAllocationOptions,
  paymentSourcesForTraining,
  placementSources,
  pushLimited,
  reverseRebirthSummonInputChoices,
  reverseRebirthSummonSourceReturnedState,
  stringArrayValue,
  summonCostExcludePaymentChoicesForSelection,
  summonCostExcludePaymentRequest,
  targetGroupsValue,
  targetInputGroup,
  targetSelectionsForAction,
  topLevelPaymentGroup,
  topLevelPaymentRequest,
  topLevelPaymentSourcesAreCompletable,
  variableZoneDiscountMagicPaymentChoicesForSelection,
  variableZoneDiscountMagicPaymentGroup,
  variableZoneDiscountMagicPaymentRequest,
} from "./action-input-choices";
import { buildAiObservation, type AiObservation } from "./ai-observation";
import { getCombinedUnitSymbolCount } from "./battle/battle-shared";
import { getCardById } from "./card/card-lookup";
import { randomDeck } from "./card/random-deck";
import { getCoreDistributionTargetTotalBounds } from "./core/core-distribution-target-totals";
import type { DraftCoreMove } from "./core/core-draft";
import {
  applyDraftCoreMoves,
  findManualCoreMoveViolation,
} from "./core/core-draft";
import {
  applyCardCostPayments,
  getAvailableCardCostPaymentSources,
  type CardCostPaymentSource,
} from "./core/payment-system";
import { getCurrentActorPlayerIds } from "./current-actor";
import { recomputeAndRebuildContinuousEffects } from "./effect/continuous-effect-rebuild";
import { materializeDeferredTrashOptionalAdds } from "./effect/structured-effect-interpreter";
import {
  applyContractPresentationChoices,
  applyGameStartEffects,
  initializeGame,
  mulliganHand,
  setFirstPlayer,
} from "./factories";
import { getLegalActions } from "./legal/legal-actions";
import { applyLegalAction } from "./legal/legal-actions-apply";
import {
  getCombinedUnitBp,
  getSummonTrashCorePlacementGrant,
} from "./legal/legal-actions-shared";
import type {
  ApplyLegalActionOptions,
  LegalAction,
} from "./legal/legal-actions-types";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  NormalCoreContainer,
  PreGamePhase,
  SoulCoreContainer,
} from "./model";
import {
  AI_DECISION_APPLY_OPTION_FIELDS,
  PLAYER_PREGAME_PHASE_DECISION_ROLES,
  PLAYER_SYSTEM_ACTION_KINDS,
  SELFPLAY_AUTO_INPUT_FIELDS,
  type AiDecisionApplyOptionField,
  type JankenHand,
  type PlayerDecisionNodeKind,
  type PlayerPreGameChoice,
  type PlayerPreGameChoiceKind,
  type PlayerSystemAction,
  type PlayerSystemActionKind,
} from "./player-decision-contract";
import {
  flushPendingLeaves,
  runStateBasedActions,
} from "./state-based-actions";
import { advanceStep, getGameProgressBlockerReason } from "./turn-system";
import {
  getPlacedCoreCount,
  type EnterFieldCorePlacement,
} from "./zone/enter-field-placement-execution";
export { randomDeck } from "./card/random-deck";

export interface TrainingEngineLookups {
  getRegisteredTriggeredEffectActions: ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"];
  getRegisteredBurstActions: NonNullable<
    ApplyLegalActionOptions["getRegisteredBurstActions"]
  >;
  getRegisteredBattleImmediateEffectActions: NonNullable<
    ApplyLegalActionOptions["getRegisteredBattleImmediateEffectActions"]
  >;
  getRegisteredFieldCardEffectActions: NonNullable<
    ApplyLegalActionOptions["getRegisteredFieldCardEffectActions"]
  >;
  getRegisteredHandActivatedEffectActions: NonNullable<
    ApplyLegalActionOptions["getRegisteredHandActivatedEffectActions"]
  >;
  getRegisteredMagicActions: NonNullable<
    ApplyLegalActionOptions["getRegisteredMagicActions"]
  >;
}

export interface Engine {
  cards: CardDefinition[];
  getCardDefinitionById: ApplyLegalActionOptions["getCardDefinitionById"];
  lookups: TrainingEngineLookups;
}

/** 乱数生成器 (0 以上 1 未満)。既定は Math.random。 */
export type Rng = () => number;

/** mulberry32: seed 固定再現用の軽量 PRNG。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 終局時の勝者 (引き分け/不明は null)。 */
export function winnerOf(state: GameState): string | null {
  if (state.gameResult === null) return null;
  const losing = state.gameResult.losingPlayerId;
  if (state.gameResult.kind === "draw" || !losing) return null;
  return state.playerOrder.find((playerId) => playerId !== losing) ?? null;
}

export type ApplyOptionDecisionField = Extract<
  AiDecisionApplyOptionField,
  keyof ApplyLegalActionOptions
>;

export type TrainingActionInputOptions = ActionInputOptions;

export type TrainingDecisionNodeKind = PlayerDecisionNodeKind;

/**
 * Training has one private system action in addition to the player-visible
 * system actions. It factors an unbounded single-target multi-placement into
 * one source decision at a time, so the policy surface remains complete
 * without materialising a Cartesian product of placements.
 */
export const TRAINING_SYSTEM_ACTION_KINDS = [
  ...PLAYER_SYSTEM_ACTION_KINDS,
  "select_multi_placement_source",
  "select_factored_target_selection",
  "select_factored_zone_selection",
  "select_factored_deck_reveal_order",
  "commit_factored_manual_core_move",
] as const;

export type TrainingSystemActionKind =
  (typeof TRAINING_SYSTEM_ACTION_KINDS)[number];

type FactoredManualCoreMoveSystemAction = Extract<
  PlayerSystemAction,
  { kind: "manual_core_move" }
> & {
  /** This draft is held until a training-only commit action runs SBA once. */
  trainingFactored: true;
};

type FactoredOrdinaryTargetSelectionSystemAction = {
  /** One include/exclude choice in a large ordinary target-selection. */
  kind: "select_factored_target_selection";
  actingPlayerId: string;
  action: LegalAction;
  /**
   * The target group currently being factored. Omitted for the original
   * single-pool path so existing training drafts remain compact.
   */
  targetGroupIndex?: number;
  candidateIndex: number;
  select: boolean;
};

type FactoredZoneSelectionSystemAction = {
  /** One include/exclude choice in a large zone-card selection. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_zone_selection" | "use_magic" }
  >;
  candidateIndex: number;
  select: boolean;
};

type FactoredVariableZoneDiscountPaymentSystemAction = {
  /** One source allocation after a variable zone-discount subset is fixed. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "use_magic" }>;
  paymentCandidateIndex: number;
  paymentSource: CardCostPaymentSource | undefined;
};

type FactoredSummonCostExcludeSelectionSystemAction = {
  /** One include/exclude choice before a summon-cost-exclude payment. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >;
  candidateIndex: number;
  select: boolean;
};

type FactoredSummonCostExcludePaymentSystemAction = {
  /** One payment-source allocation after a summon-cost-exclude subset is fixed. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >;
  summonCostExcludePaymentCandidateIndex: number;
  paymentSource: CardCostPaymentSource | undefined;
};

type FactoredTopLevelPaymentSystemAction = {
  /** One payment-source allocation for an otherwise input-free summon/place. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "summon" | "place_nexus" }>;
  topLevelPaymentCandidateIndex: number;
  paymentSource: CardCostPaymentSource | undefined;
};

type FactoredReverseRebirthPaymentSystemAction = {
  /** One payment-source allocation before reverse-rebirth core placement. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "resolve_reverse_rebirth_summon" }>;
  reverseRebirthPaymentCandidateIndex: number;
  paymentSource: CardCostPaymentSource | undefined;
};

type FactoredReverseRebirthPlacementSystemAction = {
  /** One placement-source allocation after reverse-rebirth payment is fixed. */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "resolve_reverse_rebirth_summon" }>;
  reverseRebirthPlacementSourceIndex: number;
  normalAmount: number;
  soulAmount: number;
};

type FactoredCoreDistributionTargetTotalSystemAction = {
  /**
   * One target's final total in a large core-distribution target-total phase.
   * This deliberately reuses the existing factored-target channel: extending
   * TRAINING_SYSTEM_ACTION_KINDS would change the policy feature width and
   * invalidate an otherwise compatible checkpoint.
   */
  kind: "select_factored_target_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>;
  candidateIndex: number;
  targetTotal: number;
};

type FactoredCoreDistributionSourceAllocationSystemAction = {
  /**
   * One physical source allocation after a single target's final total has
   * already been fixed.  Reuse the factored-zone channel so policy feature
   * width remains compatible with existing checkpoints.
   */
  kind: "select_factored_zone_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>;
  coreDistributionSourceCandidateIndex: number;
  normalAmount: number;
  soulAmount: number;
};

type FactoredCoreDistributionSoulTargetAllocationSystemAction = {
  /**
   * One target's soul-core allocation after a factored disjoint-source
   * distribution has fixed its physical source totals.  This stays on the
   * existing factored-target channel so policy checkpoint width is unchanged.
   */
  kind: "select_factored_target_selection";
  actingPlayerId: string;
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>;
  coreDistributionSoulTargetCandidateIndex: number;
  soulAmount: number;
};

export type TrainingSystemAction =
  | PlayerSystemAction
  | FactoredManualCoreMoveSystemAction
  | {
      /** Training-only commit point for a factored, atomic manual core batch. */
      kind: "commit_factored_manual_core_move";
      actingPlayerId: string;
    }
  | {
      kind: "select_multi_placement_source";
      actingPlayerId: string;
      action: Extract<
        LegalAction,
        {
          kind:
            | "resolve_pending_multi_placement"
            | "resolve_pending_enter_field_placement";
        }
      >;
      sourceIndex: number;
      source: TrainingPlacementSource;
      normalAmount: number;
      soulAmount: number;
    }
  | FactoredOrdinaryTargetSelectionSystemAction
  | FactoredCoreDistributionTargetTotalSystemAction
  | FactoredCoreDistributionSourceAllocationSystemAction
  | FactoredCoreDistributionSoulTargetAllocationSystemAction
  | FactoredZoneSelectionSystemAction
  | FactoredVariableZoneDiscountPaymentSystemAction
  | FactoredSummonCostExcludeSelectionSystemAction
  | FactoredSummonCostExcludePaymentSystemAction
  | FactoredTopLevelPaymentSystemAction
  | FactoredReverseRebirthPaymentSystemAction
  | FactoredReverseRebirthPlacementSystemAction
  | {
      kind: "select_factored_deck_reveal_order";
      actingPlayerId: string;
      action: Extract<
        LegalAction,
        { kind: "resolve_pending_deck_reveal_order" }
      >;
      cardInstanceId: string;
      placement: "top" | "bottom";
    };

export type TrainingPreGameChoice = PlayerPreGameChoice;

export interface TrainingDecisionChoice {
  choiceId: string;
  label: string;
  action?: LegalAction;
  systemAction?: TrainingSystemAction;
  applyOptions?: TrainingActionInputOptions;
  preGameChoice?: TrainingPreGameChoice;
}

export interface TrainingDecisionNode {
  nodeId: string;
  kind: TrainingDecisionNodeKind;
  actingPlayerId: string;
  action?: LegalAction;
  actionKind?: LegalAction["kind"];
  preGamePhase?: NonNullable<GameState["preGame"]>["phase"];
  fields: readonly AiDecisionApplyOptionField[];
  choices: readonly TrainingDecisionChoice[];
  truncated: boolean;
}

export interface TrainingDecisionTraceEntry {
  /** Zero-based coordinate on the executed transition timeline. */
  step: number;
  nodeKind: TrainingDecisionNodeKind;
  actingPlayerId: string;
  choiceId: string;
  choiceCount: number;
  actionKind?: LegalAction["kind"];
  actionId?: string;
  systemActionKind?: TrainingSystemActionKind;
  fields: readonly AiDecisionApplyOptionField[];
  preGamePhase?: NonNullable<GameState["preGame"]>["phase"];
  truncated: boolean;
}

export type TrainingPolicy = (
  state: GameState,
  node: TrainingDecisionNode,
  engine: Engine,
  rng: Rng
) => TrainingDecisionChoice;

export interface TrainingDecisionSurfaceOptions {
  telemetry?: AiWorkTelemetry;
  /**
   * 巨大な順序・配分ノードを rollout smoke で爆発させないための上限。
   * 上限に達した node は truncated=true で trace に残る。単体列挙の検証では十分大きくする。
   */
  maxGeneratedChoices?: number;
  /**
   * カード定義依存の action input 候補を列挙するための lookup。
   * playTrainingGame 経路では engine.getCardDefinitionById を渡す。
   */
  getCardDefinitionById?: Engine["getCardDefinitionById"];
  /**
   * effect-debug など進行優先の smoke では、通常 legal action が存在する局面の
   * manual core move 候補を surface から外し、巨大 choice surface 化を避ける。
   */
  suppressManualCoreMovesWhenLegalActionsExist?: boolean;
  /**
   * effect-debug のように choice-surface 完全性を監査する実行では、手動コア移動を
   * リザーブを中継する 1 コア単位の決定へ分解する。全コンテナへの一括再配分は
   * 組合せ的に増えるが、逐次移動でも同じ最終配分へ到達できる。
   */
  factorManualCoreMovesThroughReserve?: boolean;
}

export interface TrainingPlayOptions extends TrainingDecisionSurfaceOptions {
  engine: Engine;
  decks?: [CardDefinition[], CardDefinition[]];
  /**
   * Optional validated state for deterministic replay and targeted training
   * simulations. When omitted, a game is initialized from decks as usual.
   */
  initialState?: GameState;
  /**
   * Optional mutable progress-visit index for a resumed deterministic
   * rollout. Ordinary games omit this; replay diagnostics can record a
   * known state immediately before its progress check without changing game
   * state.
   */
  initialProgressStateVisits?: Map<string, number>;
  /**
   * Observes a deterministic replay transition immediately before its
   * progress-visit check. This is diagnostic-only; callers cannot alter the
   * transition selected by the training loop.
   */
  onBeforeProgressVisitCheck?: (transition: {
    stateBeforeTransition: Readonly<GameState>;
    nextState: Readonly<GameState>;
    action?: LegalAction;
  }) => void;
  /**
   * Maximum number of policy-controlled decisions. A transition with exactly
   * one available choice is resolved without consuming this budget; a
   * consecutive forced-transition guard with the same limit still protects
   * against an automatic loop.
   */
  maxSteps?: number;
  /**
   * Maximum number of consecutive transitions that do not consume the policy
   * decision budget. This is independent from maxSteps so a short exploration
   * horizon cannot misclassify a forced-transition loop as an ordinary cap.
   */
  maxForcedTransitions?: number;
  /**
   * Maximum number of consecutive transitions that leave the logical game
   * state unchanged. Log-only changes are ignored. Reaching this guard is a
   * stuck failure, never a capped game.
   */
  maxRepeatedStateTransitions?: number;
  /**
   * Optional wall-clock budget for one training game. This is a training-only
   * cap: reaching it produces a durable `capped` result without changing
   * normal-game action legality.
   */
  maxDurationMs?: number;
  /** Deterministic clock injection for bounded training callers and tests. */
  now?: () => number;
  rng?: Rng;
  policies?: Record<string, TrainingPolicy>;
  skipPreGame?: boolean;
  /** Preserve a caller-provided, already-randomized deck order during setup. */
  preserveDeckOrder?: boolean;
}

export interface TrainingGameResult {
  /**
   * Backward-compatible alias for transitionSteps. New artifact consumers should
   * use the explicit counters below instead of inferring a timeline from this.
   */
  steps: number;
  /** Number of policy-controlled decisions consumed from maxSteps. */
  decisionSteps: number;
  /** Number of executed state transitions; trace entries use its zero-based index. */
  transitionSteps: number;
  outcome: "natural" | "capped" | "stuck" | "error";
  winner: string | null;
  trace: TrainingDecisionTraceEntry[];
  finalState: GameState;
  lastError?: string;
  terminationReason?:
    | "decision_limit"
    | "elapsed_time_limit"
    | "forced_transition_limit"
    | "repeated_state"
    | "advance_error";
}

export interface TrainingTraceReplayFrame {
  state: GameState;
  label: string;
  traceEntry?: TrainingDecisionTraceEntry;
}

export interface TrainingTraceReplayArtifact {
  schemaVersion: 1;
  title: string;
  frames: TrainingTraceReplayFrame[];
}

export interface TrainingTraceSmokeFrame {
  frameIndex: number;
  stateHash: string;
  observationHash: string;
  state: GameState;
  observation: AiObservation;
  node: TrainingDecisionNode;
  selected: TrainingDecisionTraceEntry;
}

export interface TrainingTraceSmokeMetrics {
  outcome: TrainingGameResult["outcome"];
  winner: string | null;
  /** Backward-compatible alias for transitionSteps. */
  steps: number;
  decisionSteps: number;
  transitionSteps: number;
  decisionFrames: number;
  traceEntries: number;
  truncatedNodeCount: number;
  truncatedNodeRate: number;
  maxChoiceCount: number;
  nodeKindCounts: Record<TrainingDecisionNodeKind, number>;
}

export interface TrainingTraceSmokeResult extends TrainingGameResult {
  frames: TrainingTraceSmokeFrame[];
  replay: TrainingTraceReplayArtifact;
  metrics: TrainingTraceSmokeMetrics;
  /**
   * The most recent decision snapshot, retained even when a caller streams the
   * full recording instead of keeping every frame in memory.
   */
  lastFrame?: TrainingTraceSmokeFrame;
  /** First incomplete decision surface, retained for precise debug tickets. */
  firstTruncatedFrame?: TrainingTraceSmokeFrame;
}

/**
 * Hooks for artifact writers that must not retain an unbounded history in the
 * game process. Callbacks receive the same serialized snapshots that the
 * default in-memory trace/replay artifacts receive.
 */
export interface TrainingTraceSmokeRecordingOptions {
  /** Defaults to true for backward-compatible trace-smoke callers. */
  retainFrames?: boolean;
  /** Defaults to true for backward-compatible trace-smoke callers. */
  retainReplay?: boolean;
  onFrame?: (frame: TrainingTraceSmokeFrame) => void;
  onReplayFrame?: (frame: TrainingTraceReplayFrame) => void;
}

export interface TrainingTraceSmokeOptions extends TrainingPlayOptions {
  title?: string;
  recording?: TrainingTraceSmokeRecordingOptions;
}

interface TrainingTraceRecorder {
  recordDecision(
    state: GameState,
    node: TrainingDecisionNode,
    entry: TrainingDecisionTraceEntry
  ): void;
  recordFinal(
    state: GameState,
    decisionSteps: number,
    transitionSteps: number,
    outcome: TrainingGameResult["outcome"]
  ): void;
}
type TrainingMultiPlacementDraft = {
  pendingId: string;
  sourceIndex: number;
  placements: readonly EnterFieldCorePlacement[];
};
type TrainingStateWithMultiPlacementDraft = GameState & {
  trainingMultiPlacementDraft?: TrainingMultiPlacementDraft;
};
type TrainingZoneSelectionDraft = {
  pendingId: string;
  actionId: string;
  candidateIndex: number;
  selectedZoneCardIds: readonly string[];
};
type TrainingVariableZoneDiscountDraft = {
  actionId: string;
  candidateIndex: number;
  selectedZoneCardIds: readonly string[];
  selectionComplete: boolean;
  paymentCandidateIndex?: number;
  selectedPaymentSources?: readonly CardCostPaymentSource[];
};
type TrainingSummonCostExcludeDraft = {
  pendingId: string;
  actionId: string;
  candidateIndex: number;
  selectedCardInstanceIds: readonly string[];
  selectionComplete: boolean;
  paymentCandidateIndex?: number;
  selectedPaymentSources?: readonly CardCostPaymentSource[];
};
type TrainingTopLevelPaymentDraft = {
  actionId: string;
  paymentCandidateIndex: number;
  selectedPaymentSources: readonly CardCostPaymentSource[];
};
type TrainingReverseRebirthSummonDraft = {
  pendingId: string;
  actionId: string;
  phase: "payment" | "placement";
  paymentCandidateIndex: number;
  selectedPaymentSources: readonly CardCostPaymentSource[];
  placementSourceIndex: number;
  placements: readonly EnterFieldCorePlacement[];
};
type TrainingTargetSelectionDraft = {
  actionId: string;
  /** Present only when a disjoint targetGroups action is factored. */
  targetGroupIndex?: number;
  candidateIndex: number;
  selectedTargetInstanceIds: readonly string[];
  complete: boolean;
};
type TrainingCoreDistributionTargetTotalDraft = {
  pendingId: string;
  actionId: string;
  candidateIndex: number;
  selectedTotals: Readonly<Record<string, number>>;
};
type TrainingCoreDistributionSourceAllocationDraft = {
  pendingId: string;
  actionId: string;
  sourceCandidateIndex: number;
  normalAllocations: Readonly<Record<string, number>>;
  soulAllocations: Readonly<Record<string, number>>;
};
type TrainingCoreDistributionSoulTargetAllocationDraft = {
  pendingId: string;
  actionId: string;
  targetCandidateIndex: number;
  soulAllocations: Readonly<Record<string, number>>;
};
type TrainingDeckRevealOrderDraft = {
  pendingId: string;
  actionId: string;
  deckRevealRemainderOrder: readonly string[];
  deckRevealRemainderPlacements: Readonly<Record<string, "top" | "bottom">>;
  /**
   * `top_or_bottom` keeps one destination for the entire remainder.  Store it
   * with the factored order draft so every subsequent card only offers that
   * already-selected destination instead of reintroducing a global choice.
   */
  deckRevealPlacement?: "top" | "bottom";
};
type TrainingStateWithFactoredActionInputDrafts = GameState & {
  trainingTargetSelectionDraft?: TrainingTargetSelectionDraft;
  trainingCoreDistributionTargetTotalDraft?: TrainingCoreDistributionTargetTotalDraft;
  trainingCoreDistributionSourceAllocationDraft?: TrainingCoreDistributionSourceAllocationDraft;
  trainingCoreDistributionSoulTargetAllocationDraft?: TrainingCoreDistributionSoulTargetAllocationDraft;
  trainingZoneSelectionDraft?: TrainingZoneSelectionDraft;
  trainingVariableZoneDiscountDraft?: TrainingVariableZoneDiscountDraft;
  trainingSummonCostExcludeDraft?: TrainingSummonCostExcludeDraft;
  trainingTopLevelPaymentDraft?: TrainingTopLevelPaymentDraft;
  trainingReverseRebirthSummonDraft?: TrainingReverseRebirthSummonDraft;
  trainingDeckRevealOrderDraft?: TrainingDeckRevealOrderDraft;
};

const DEFAULT_MAX_GENERATED_CHOICES = 512;
const MAX_ATOMIC_ENTER_FIELD_PLACEMENT_CHOICES = 64;
const MAX_ATOMIC_VARIABLE_ZONE_DISCOUNT_CHOICES = 64;

export const TRAINING_DECISION_APPLY_OPTION_FIELDS =
  AI_DECISION_APPLY_OPTION_FIELDS;

export const TRAINING_SELFPLAY_AUTO_INPUT_FIELDS = [
  ...SELFPLAY_AUTO_INPUT_FIELDS,
] as const satisfies readonly (typeof TRAINING_DECISION_APPLY_OPTION_FIELDS)[number][];

export const TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS = [
  "additionalAttackExhaustCostSourceInstanceIds",
  "additionalSourceInstanceIds",
  "chosenLifeCoreKind",
  "coreCountSelection",
  "coreDistributionAllocations",
  "coreDistributionSoulCoreAllocations",
  "coreDistributionSoulCoreInstanceId",
  "coreDistributionSoulCoreSourceAllocations",
  "coreDistributionSourceAllocations",
  "coreShootDistribution",
  "coreShootSoulCoreInstanceId",
  "coreSourceAllocations",
  "coreSourceSoulCoreInstanceId",
  "coreSplitDistribution",
  "countDecreaseSelection",
  "deckRevealPickFreeDestination",
  "deckRevealMiragePaymentSourcesByInstanceId",
  "deckRevealPlacement",
  "deckRevealRemainderOrder",
  "deckRevealRemainderPlacements",
  "deferPayCostSourceSelection",
  "discardSetBurstCountSelection",
  "drawStepCostChoice",
  "drawStepCostDiscardCardInstanceId",
  "enterFieldCorePlacements",
  "fieldMagicPreCostTriggerDecision",
  "followUpChosenLifeCoreKind",
  "followUpPerTargetInputs",
  "followUpTargetInstanceIds",
  "groupedSummonCostOverrideSelectedCardInstanceIds",
  "lifeCorePartitionChoice",
  "lifeDamageDiscardChoice",
  "lifeGainReplacementChoice",
  "multiPlacementAllocations",
  "paidPreventionImmunityCardSelection",
  "payCostPaymentSources",
  "paymentSources",
  "payToActCoreGateDecline",
  "payToActCoreSourceContainerId",
  "payToActCoreKind",
  "payToActHandDiscardCardInstanceIds",
  "payToActHandDiscardGateDecline",
  "redirectTargetReplacementInstanceId",
  "redirectTargetReplacementInstanceIds",
  "selectedDeckRevealCardIds",
  "selectedZoneCardIds",
  "separateCoreDistribution",
  "skipOptionalEffect",
  "splitSummonTokenCount",
  "splitSummonZoneCardInstanceIds",
  "summonCostCoreMoveDestination",
  "summonCostCoreMoveAllocations",
  "summonCostCoreMoveSelectedCount",
  "summonCostExcludeSelectedCardInstanceIds",
  "summonEnterFieldCorePlacements",
  "summonPaymentSources",
  "swapTargetInstanceId",
  "targetInstanceIds",
  "zoneSelectionDestinationByCardId",
] as const satisfies readonly AiDecisionApplyOptionField[];

export const TRAINING_ACTION_INPUT_FIELD_GAPS = {} as const satisfies Partial<
  Record<AiDecisionApplyOptionField, string>
>;

export type TrainingImplementedActionInputField =
  (typeof TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS)[number];

export type TrainingActionInputFieldGap =
  keyof typeof TRAINING_ACTION_INPUT_FIELD_GAPS;

type TrainingActionInputFieldCoverageMissing = Exclude<
  AiDecisionApplyOptionField,
  TrainingImplementedActionInputField | TrainingActionInputFieldGap
>;

const TRAINING_ACTION_INPUT_FIELD_COVERAGE_CHECK: Record<
  TrainingActionInputFieldCoverageMissing,
  never
> = {};
void TRAINING_ACTION_INPUT_FIELD_COVERAGE_CHECK;

export const randomTrainingPolicy: TrainingPolicy = (
  _state,
  node,
  _engine,
  rng
) => node.choices[Math.floor(rng() * node.choices.length)] ?? node.choices[0]!;

function isManualCoreMoveTrainingChoice(
  choice: TrainingDecisionChoice
): boolean {
  return (
    choice.systemAction?.kind === "manual_core_move" ||
    choice.systemAction?.kind === "commit_factored_manual_core_move"
  );
}

function isPendingReselectTrainingChoice(
  choice: TrainingDecisionChoice
): boolean {
  return choice.action?.kind === "select_pending_to_resolve";
}

function isTrainingProgressChoice(choice: TrainingDecisionChoice): boolean {
  if (isManualCoreMoveTrainingChoice(choice)) return false;
  if (isPendingReselectTrainingChoice(choice)) return false;
  return (
    choice.action !== undefined ||
    choice.systemAction !== undefined ||
    choice.preGameChoice !== undefined ||
    choice.applyOptions !== undefined
  );
}

export function progressFilteredTrainingChoices(
  node: TrainingDecisionNode
): readonly TrainingDecisionChoice[] {
  let choices: readonly TrainingDecisionChoice[] = node.choices;

  if (
    choices.some(
      (choice) =>
        isTrainingProgressChoice(choice) &&
        !isManualCoreMoveTrainingChoice(choice)
    )
  ) {
    choices = choices.filter(
      (choice) => !isManualCoreMoveTrainingChoice(choice)
    );
  }

  if (
    choices.some(
      (choice) => choice.action?.kind === "resolve_pending_triggered_effect"
    )
  ) {
    choices = choices.filter(
      (choice) => !isPendingReselectTrainingChoice(choice)
    );
  }

  return choices.length > 0 ? choices : node.choices;
}

export const progressRandomTrainingPolicy: TrainingPolicy = (
  _state,
  node,
  _engine,
  rng
) => {
  if (isJankenDecisionNode(node)) {
    return randomTrainingPolicy(_state, node, _engine, rng);
  }
  const choices = progressFilteredTrainingChoices(node);
  return choices[Math.floor(rng() * choices.length)] ?? node.choices[0]!;
};

function isJankenDecisionNode(node: TrainingDecisionNode): boolean {
  return (
    node.kind === "pregame" &&
    node.choices.length > 0 &&
    node.choices.every((choice) => choice.preGameChoice?.kind === "janken")
  );
}

function opponentPlayerId(state: GameState, playerId: string): string | null {
  return state.playerOrder.find((id) => id !== playerId) ?? null;
}

function liveFieldCards(state: GameState, playerId: string): CardInstance[] {
  return state.cardInstances.filter(
    (card) =>
      card.zone === "field" &&
      card.controllerPlayerId === playerId &&
      card.attachedToInstanceId === null &&
      card.pendingLeaveKind === null
  );
}

function readyFieldCards(state: GameState, playerId: string): CardInstance[] {
  return liveFieldCards(state, playerId).filter(
    (card) => card.exhaustState === "recovered"
  );
}

function combinedUnitBp(
  state: GameState,
  card: CardInstance | undefined,
  engine: Engine
): number {
  if (!card) return 0;
  return getCombinedUnitBp(
    state,
    card,
    engine.getCardDefinitionById(card.definitionId),
    engine.getCardDefinitionById
  );
}

function combinedUnitSymbols(
  state: GameState,
  card: CardInstance | undefined,
  engine: Engine
): number {
  if (!card) return 0;
  const symbols = getCombinedUnitSymbolCount(
    state,
    card,
    engine.getCardDefinitionById(card.definitionId),
    engine.getCardDefinitionById
  );
  return Math.max(1, symbols);
}

function readySymbolPressure(
  state: GameState,
  playerId: string,
  engine: Engine
): number {
  return readyFieldCards(state, playerId).reduce(
    (sum, card) => sum + combinedUnitSymbols(state, card, engine),
    0
  );
}

function bestReadyBp(
  state: GameState,
  playerId: string,
  engine: Engine
): number {
  return readyFieldCards(state, playerId).reduce(
    (best, card) => Math.max(best, combinedUnitBp(state, card, engine)),
    0
  );
}

function actionSourceCard(
  state: GameState,
  action: LegalAction
): CardInstance | undefined {
  const sourceInstanceId =
    "sourceInstanceId" in action ? action.sourceInstanceId : undefined;
  return typeof sourceInstanceId === "string"
    ? getCardById(state, sourceInstanceId)
    : undefined;
}

function attackActionPriority(
  state: GameState,
  action: Extract<LegalAction, { kind: "attack" | "join_active_attack" }>,
  engine: Engine
): number {
  const opponentId = opponentPlayerId(state, action.actingPlayerId);
  if (!opponentId) return 50;

  const attacker = actionSourceCard(state, action);
  const attackerBp = combinedUnitBp(state, attacker, engine);
  const damage = combinedUnitSymbols(state, attacker, engine);
  const opponentLife =
    currentPlayer(state, opponentId)?.lifeNormalCoreCount ?? 0;
  const myLife =
    currentPlayer(state, action.actingPlayerId)?.lifeNormalCoreCount ?? 0;
  const target =
    action.kind === "attack" && action.targetInstanceId
      ? getCardById(state, action.targetInstanceId)
      : undefined;
  const opponentReadyBlockers = readyFieldCards(state, opponentId);
  const opponentHasSetBurst = state.setBurstStates.some(
    (burst) => burst.playerId === opponentId
  );
  const canBeBlocked =
    action.kind === "attack" &&
    action.targetInstanceId === undefined &&
    opponentReadyBlockers.length > 0;
  const bestBlockerBp = bestReadyBp(state, opponentId, engine);
  const opponentReturnPressure = readySymbolPressure(state, opponentId, engine);
  const myReadyPressure = readySymbolPressure(
    state,
    action.actingPlayerId,
    engine
  );
  const attackerWasReady = attacker?.exhaustState === "recovered";
  const myReadyAfterAttack = Math.max(
    0,
    myReadyPressure - (attackerWasReady ? damage : 0)
  );

  let score = action.kind === "join_active_attack" ? 58 : 50;

  if (target) {
    const targetBp = combinedUnitBp(state, target, engine);
    score += Math.min(18, combinedUnitSymbols(state, target, engine) * 6);
    score += attackerBp >= targetBp ? 12 : -30;
  } else {
    score += damage * 8;
    if (damage >= opponentLife) score += 80;
    if (opponentHasSetBurst && damage < opponentLife) score -= 24;
    if (!canBeBlocked) {
      score += 18;
    } else {
      score -= 16;
      score += attackerBp > bestBlockerBp ? 8 : -18;
    }
  }

  if (opponentReturnPressure >= myLife) {
    score -= myReadyAfterAttack <= 0 ? 34 : 14;
  }
  if (myLife <= 2 && myReadyAfterAttack < opponentReadyBlockers.length) {
    score -= 8;
  }
  if (action.attackExhaustCostSourceInstanceId) score -= 8;
  if (action.attackExhaustCostSourceInstanceIds) {
    score -= action.attackExhaustCostSourceInstanceIds.length * 8;
  }
  if (action.battleDestroyCostSourceInstanceId) score -= 20;
  if (action.battleDestroyCostSourceInstanceIds) {
    score -= action.battleDestroyCostSourceInstanceIds.length * 20;
  }

  return score;
}

function bestAttackPriority(
  state: GameState,
  node: TrainingDecisionNode,
  engine: Engine
): number {
  return node.choices.reduce((best, choice) => {
    const action = choice.action;
    if (action?.kind !== "attack" && action?.kind !== "join_active_attack") {
      return best;
    }
    return Math.max(best, attackActionPriority(state, action, engine));
  }, Number.NEGATIVE_INFINITY);
}

function hasLethalAttack(
  state: GameState,
  node: TrainingDecisionNode,
  engine: Engine
): boolean {
  return node.choices.some((choice) => {
    const action = choice.action;
    if (action?.kind !== "attack" || action.targetInstanceId !== undefined) {
      return false;
    }
    const opponentId = opponentPlayerId(state, action.actingPlayerId);
    if (!opponentId) return false;
    const opponentLife =
      currentPlayer(state, opponentId)?.lifeNormalCoreCount ?? 0;
    return (
      combinedUnitSymbols(state, actionSourceCard(state, action), engine) >=
      opponentLife
    );
  });
}

function endAttackStepPriority(
  state: GameState,
  node: TrainingDecisionNode,
  action: Extract<LegalAction, { kind: "end_attack_step" }>,
  engine: Engine
): number {
  const opponentId = opponentPlayerId(state, action.actingPlayerId);
  const bestAttack = bestAttackPriority(state, node, engine);
  let score = 54;

  if (hasLethalAttack(state, node, engine)) score -= 70;
  if (bestAttack !== Number.NEGATIVE_INFINITY) {
    score -= Math.max(0, bestAttack - 58) * 0.4;
    score += Math.max(0, 45 - bestAttack) * 0.4;
  }

  if (opponentId) {
    const myLife =
      currentPlayer(state, action.actingPlayerId)?.lifeNormalCoreCount ?? 0;
    const opponentPressure = readySymbolPressure(state, opponentId, engine);
    const myReady = readySymbolPressure(state, action.actingPlayerId, engine);
    if (opponentPressure >= myLife && myReady > 0) score += 18;
  }

  return score;
}

function actionKindPriority(
  state: GameState,
  node: TrainingDecisionNode,
  choice: TrainingDecisionChoice,
  engine: Engine
): number {
  const action = choice.action;
  if (!action) return 0;
  switch (action.kind) {
    case "attack":
    case "join_active_attack":
      return attackActionPriority(state, action, engine);
    case "end_attack_step":
      return endAttackStepPriority(state, node, action, engine);
    case "flip_instead_of_attack":
      return 74;
  }

  const kind = action.kind;
  switch (kind) {
    case "summon":
    case "place_nexus":
    case "activate_soul_state":
      return 90;
    case "use_magic":
    case "use_accel":
    case "use_change":
    case "declare_advent":
    case "declare_manifest":
      return 80;
    case "use_field_card_effect":
    case "use_hand_card_effect":
    case "resolve_battle_immediate_effect":
    case "resolve_pending_triggered_effect":
      return 70;
    case "block":
      return 60;
    case "set_burst":
    case "set_mirage":
    case "set_quartz":
      return 50;
    case "pass_stack":
    case "pass_battle_flash":
    case "pass_pre_declaration_stack":
    case "decline_block":
    case "decline_pending_burst_check":
      return 10;
    default:
      return kind.startsWith("resolve_") ? 40 : 30;
  }
}

function paymentAmount(
  sources: readonly CardCostPaymentSource[] | undefined
): number {
  return sources?.reduce((sum, source) => sum + source.amount, 0) ?? 0;
}

function actionInputPriority(
  node: TrainingDecisionNode,
  choice: TrainingDecisionChoice
): number {
  const options = choice.applyOptions ?? {};
  let score = 0;
  if (options.skipOptionalEffect === true) {
    const action = node.action ? actionRecord(node.action) : null;
    const targetMode = action ? action.targetMode : undefined;
    const candidateCount =
      action === null
        ? 0
        : stringArrayValue(action, "candidateTargetInstanceIds").length;
    score += targetMode === "none" || candidateCount === 0 ? 2 : -8;
  }
  if (options.skipOptionalEffect === false) score += 5;
  score -= paymentAmount(options.paymentSources);
  score -= paymentAmount(options.payCostPaymentSources);
  score -= paymentAmount(options.summonPaymentSources);
  score += (options.targetInstanceIds?.length ?? 0) * 2;
  score += (options.selectedDeckRevealCardIds?.length ?? 0) * 2;
  score += (options.selectedZoneCardIds?.length ?? 0) * 2;
  return score;
}

function preGamePriority(choice: TrainingDecisionChoice): number {
  const preGame = choice.preGameChoice;
  if (!preGame) return 0;
  switch (preGame.kind) {
    case "contract_presentation":
      return preGame.present ? 10 : 0;
    case "contract_confirm":
      return 5;
    case "janken":
      return preGame.hand === "rock" ? 3 : preGame.hand === "scissors" ? 2 : 1;
    case "first_player":
      return preGame.firstPlayerId === preGame.playerId ? 4 : 2;
    case "mulligan":
      return preGame.mulligan ? 1 : 4;
  }
}

function systemActionPriority(choice: TrainingDecisionChoice): number {
  switch (choice.systemAction?.kind) {
    case "advance_step":
      return 20;
    case "manual_core_move":
    case "commit_factored_manual_core_move":
      return 2;
    default:
      return 0;
  }
}

function trainingChoicePriority(
  state: GameState,
  node: TrainingDecisionNode,
  choice: TrainingDecisionChoice,
  engine: Engine
): number {
  if (node.kind === "pregame") return preGamePriority(choice);
  if (node.kind === "action_input") return actionInputPriority(node, choice);
  if (choice.action) return actionKindPriority(state, node, choice, engine);
  return systemActionPriority(choice);
}

export const heuristicTrainingPolicy: TrainingPolicy = (
  state,
  node,
  engine,
  rng
) => {
  if (isJankenDecisionNode(node)) {
    return randomTrainingPolicy(state, node, engine, rng);
  }
  return [...node.choices].sort((a, b) => {
    const priorityDiff =
      trainingChoicePriority(state, node, b, engine) -
      trainingChoicePriority(state, node, a, engine);
    return priorityDiff !== 0
      ? priorityDiff
      : a.choiceId.localeCompare(b.choiceId);
  })[0]!;
};

/**
 * Empty optional groups contribute exactly one legal target subset (`[]`), so
 * there is no decision for training to make. Skip them while factoring the
 * remaining disjoint groups; an empty required group remains unfactorable.
 */
function nextFactoredTargetGroupIndex(
  targetGroups: readonly TargetGroupLike[],
  startIndex: number
): number {
  let index = startIndex;
  while (
    index < targetGroups.length &&
    targetGroups[index]!.candidateTargetInstanceIds.length === 0 &&
    targetGroups[index]!.requiredTargetCount === 0
  ) {
    index += 1;
  }
  return index;
}

function optionFields(
  options: TrainingActionInputOptions
): AiDecisionApplyOptionField[] {
  const known = new Set<string>(AI_DECISION_APPLY_OPTION_FIELDS);
  return Object.keys(options)
    .filter((field): field is AiDecisionApplyOptionField => known.has(field))
    .sort();
}

function makeChoice(
  choiceId: string,
  label: string,
  applyOptions: TrainingActionInputOptions
): TrainingDecisionChoice {
  return { choiceId, label, applyOptions: compactOptions(applyOptions) };
}

function targetInputGroupForTraining(
  state: GameState,
  action: LegalAction,
  limit: number
): ChoiceAccumulator<TrainingActionInputOptions> | null {
  const targetDraft = trainingTargetSelectionDraftOf(state);
  if (targetDraft && targetDraft.actionId !== action.actionId) {
    throw new Error(
      "Training target-selection draft does not match its action"
    );
  }
  if (targetDraft?.complete) {
    return {
      values: [
        {
          targetInstanceIds: [...targetDraft.selectedTargetInstanceIds],
        },
      ],
      truncated: false,
      limit,
    };
  }
  return targetInputGroup(action, limit);
}

/**
 * Return whether a partially chosen discount subset can still end in at least
 * one payable atomic action. A chosen field card can stop being a payment
 * source, so this checks the real payment generator instead of inferring from
 * core totals or the number of remaining discounts.
 */
function variableZoneDiscountHasPayableCompletion(
  state: GameState,
  action: Extract<LegalAction, { kind: "use_magic" }>,
  selectedZoneCardIds: readonly string[],
  remainingCandidateIds: readonly string[],
  remainingSelectionCount: number
): boolean {
  const canPaySelection = (selection: readonly string[]): boolean => {
    const payments = variableZoneDiscountMagicPaymentChoicesForSelection(
      state,
      action,
      selection,
      1
    );
    return (payments?.values.length ?? 0) > 0;
  };
  if (canPaySelection(selectedZoneCardIds)) return true;
  if (remainingSelectionCount <= 0 || remainingCandidateIds.length === 0) {
    return false;
  }

  const selected = [...selectedZoneCardIds];
  const visit = (candidateIndex: number, availableSlots: number): boolean => {
    if (candidateIndex >= remainingCandidateIds.length || availableSlots <= 0) {
      return canPaySelection(selected);
    }
    selected.push(remainingCandidateIds[candidateIndex]!);
    if (
      canPaySelection(selected) ||
      visit(candidateIndex + 1, availableSlots - 1)
    ) {
      selected.pop();
      return true;
    }
    selected.pop();
    return visit(candidateIndex + 1, availableSlots);
  };
  return visit(0, remainingSelectionCount);
}

/**
 * The factored first stage must never offer a prefix that ends with no
 * physical core allocation. When every source is also a target, enumerate
 * only the remaining final-total prefixes, then ask the existing physical
 * source allocator whether a completion exists. This preserves the
 * target-chooser/source-owner split even when a movable soul core shares an
 * overlapping source card. Normal-only distributions keep their canonical
 * aggregate completion shortcut; all other supported shapes delegate to the
 * second-stage generator so source caps, soul-core availability, and later
 * fixed-total rules remain authoritative.
 */
function hasReachableFactoredCoreDistributionTargetTotal(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  bounds: ReturnType<typeof getCoreDistributionTargetTotalBounds>,
  selectedTotals: Readonly<Record<string, number>>,
  nextCandidateIndex: number,
  limit: number
): boolean {
  if (canFactorOverlappingCoreDistributionTargetTotals(action)) {
    const visit = (
      candidateIndex: number,
      partialTotals: Readonly<Record<string, number>>
    ): boolean => {
      const selectedTotal = Object.values(partialTotals).reduce(
        (sum, amount) => sum + amount,
        0
      );
      const remainingIds = bounds.candidateIds.slice(candidateIndex);
      const remainingMinimumTotal = remainingIds.reduce(
        (sum, id) => sum + (bounds.minimumTotals[id] ?? 0),
        0
      );
      const remainingMaximumTotal = remainingIds.reduce(
        (sum, id) => sum + (bounds.maximumTotals[id] ?? 0),
        0
      );
      const minimumSelectedTotal = Math.max(
        bounds.minimumSelectedTotal,
        action.minTotal ?? 0
      );
      if (
        selectedTotal + remainingMinimumTotal > bounds.maximumSelectedTotal ||
        selectedTotal + remainingMaximumTotal < minimumSelectedTotal
      ) {
        return false;
      }
      if (candidateIndex >= bounds.candidateIds.length) {
        if (hasOnlyOverlappingNormalCoreDistributionSources(action)) {
          return (
            canCompleteOverlappingNormalCoreDistributionTargetTotals(
              state,
              action,
              bounds,
              partialTotals
            ) !== null
          );
        }
        return canCompleteOverlappingCoreDistributionTargetTotals(
          state,
          action,
          bounds,
          partialTotals
        );
      }
      const candidateId = bounds.candidateIds[candidateIndex]!;
      const minimum = bounds.minimumTotals[candidateId] ?? 0;
      const maximum = bounds.maximumTotals[candidateId] ?? 0;
      for (let targetTotal = minimum; targetTotal <= maximum; targetTotal++) {
        if (
          visit(candidateIndex + 1, {
            ...partialTotals,
            [candidateId]: targetTotal,
          })
        ) {
          return true;
        }
      }
      return false;
    };
    return visit(nextCandidateIndex, selectedTotals);
  }

  const selectedTotal = Object.values(selectedTotals).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const remainingIds = bounds.candidateIds.slice(nextCandidateIndex);
  const remainingMinimumTotal = remainingIds.reduce(
    (sum, id) => sum + (bounds.minimumTotals[id] ?? 0),
    0
  );
  const remainingMaximumTotal = remainingIds.reduce(
    (sum, id) => sum + (bounds.maximumTotals[id] ?? 0),
    0
  );
  const minimumSelectedTotal = Math.max(
    bounds.minimumSelectedTotal,
    action.minTotal ?? 0,
    selectedTotal + remainingMinimumTotal
  );
  const maximumSelectedTotal = Math.min(
    bounds.maximumSelectedTotal,
    selectedTotal + remainingMaximumTotal
  );

  for (
    let finalSelectedTotal = minimumSelectedTotal;
    finalSelectedTotal <= maximumSelectedTotal;
    finalSelectedTotal++
  ) {
    let extra = finalSelectedTotal - selectedTotal - remainingMinimumTotal;
    const finalTotals: Record<string, number> = { ...selectedTotals };
    for (const id of remainingIds) {
      const minimum = bounds.minimumTotals[id] ?? 0;
      const capacity = Math.max(0, (bounds.maximumTotals[id] ?? 0) - minimum);
      const amount = minimum + Math.min(extra, capacity);
      extra -= amount - minimum;
      finalTotals[id] = amount;
    }
    if (extra !== 0) continue;
    const deficitTotal = bounds.candidateIds.reduce(
      (sum, id) =>
        sum +
        Math.max(0, (finalTotals[id] ?? 0) - (bounds.currentTotals[id] ?? 0)),
      0
    );
    if (deficitTotal > bounds.maximumDeficitTotal) continue;
    const nonZeroFinalTotals = Object.fromEntries(
      Object.entries(finalTotals).filter(([, amount]) => amount > 0)
    ) as Record<string, number>;
    if (
      hasCoreDistributionSourceOwnerChoice(
        state,
        action,
        nonZeroFinalTotals,
        limit
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A positive minimum distribution can require an otherwise net-zero cycle.
 * The normal-only canonical path represents those cycles directly. Mixed
 * normal/soul overlap is factored when an optional distribution may use its
 * net flow as the complete physical allocation; mandatory mixed cycles stay
 * on the exhaustive path until they have their own source sequence.
 */
function canFactorOverlappingCoreDistributionTargetTotals(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): boolean {
  return (
    hasOnlyOverlappingCoreDistributionSources(action) &&
    (hasOnlyOverlappingNormalCoreDistributionSources(action) ||
      (action.minTotal ?? 0) === 0)
  );
}

/**
 * Decide whether a mixed normal/soul overlapping-source final-total map has
 * one physical completion without materialising its source/target Cartesian
 * product. With no required minimum move, its net flow is sufficient: a
 * source with a negative delta supplies exactly that delta, and a target with
 * a positive delta receives it. We only enumerate the (normally tiny) soul
 * source and target partitions, then reuse the ordinary flow validators.
 */
function canCompleteOverlappingCoreDistributionTargetTotals(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  bounds: ReturnType<typeof getCoreDistributionTargetTotalBounds>,
  finalTotals: Readonly<Record<string, number>>
): boolean {
  if (
    hasOnlyOverlappingNormalCoreDistributionSources(action) ||
    !hasOnlyOverlappingCoreDistributionSources(action) ||
    (action.minTotal ?? 0) > 0
  ) {
    return false;
  }

  const totalSoulCores = action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0);
  const maximumTotal =
    action.maxTotal ?? action.totalNormalCores + totalSoulCores;
  const outgoingById: Record<string, number> = {};
  const incomingById: Record<string, number> = {};
  let movedTotal = 0;
  let outgoingTotal = 0;
  for (const id of bounds.candidateIds) {
    const delta = (finalTotals[id] ?? 0) - (bounds.currentTotals[id] ?? 0);
    if (delta > 0) {
      incomingById[id] = delta;
      movedTotal += delta;
    } else if (delta < 0) {
      outgoingById[id] = -delta;
      outgoingTotal -= delta;
    }
  }
  if (
    movedTotal !== outgoingTotal ||
    movedTotal > maximumTotal ||
    movedTotal > action.totalNormalCores + totalSoulCores
  ) {
    return false;
  }

  const sources = (action.allowedSources ?? []).map((source) => {
    if (source.kind !== "field") return null;
    const sourceKey = `field:${source.instanceId}`;
    return {
      id: source.instanceId,
      sourceKey,
      outgoing: outgoingById[source.instanceId] ?? 0,
      normalCap: action.sourceAvailable?.[sourceKey] ?? 0,
      soulCap: action.soulSourceAvailable?.[sourceKey] ?? 0,
      combinedCap: action.sourceTotalAvailable?.[sourceKey],
    };
  });
  if (sources.some((source) => source === null)) return false;

  const normalSources: Record<string, number> = {};
  const soulSources: Record<string, number> = {};
  const chooseSoulTargets = (
    candidateIndex: number,
    remainingSoul: number,
    soulTargets: Record<string, number>
  ): boolean => {
    if (candidateIndex >= bounds.candidateIds.length) {
      if (remainingSoul !== 0) return false;
      const normalAllocations: Record<string, number> = {};
      for (const id of bounds.candidateIds) {
        const incoming = incomingById[id] ?? 0;
        const soul = soulTargets[id] ?? 0;
        if (soul > incoming) return false;
        const normal = incoming - soul;
        if (normal > 0) normalAllocations[id] = normal;
      }
      const normalTotal = Object.values(normalSources).reduce(
        (sum, amount) => sum + amount,
        0
      );
      const soulTotal = Object.values(soulSources).reduce(
        (sum, amount) => sum + amount,
        0
      );
      if (
        Object.values(normalAllocations).reduce(
          (sum, amount) => sum + amount,
          0
        ) !== normalTotal ||
        (soulTotal > 0 &&
          !canSatisfyCoreDistributionSoulAllocation(
            action,
            soulTargets,
            soulSources
          ))
      ) {
        return false;
      }
      return (
        canRouteNormalCoreDistributionWithoutSelfMove(
          action,
          normalAllocations,
          normalSources
        ) &&
        fitsCombinedCoreDistributionSourceAvailability(
          action,
          normalSources,
          soulTotal > 0 ? soulSources : undefined
        ) &&
        fixedCoreDistributionTotalsMatch(
          state,
          action,
          normalAllocations,
          normalSources,
          soulTargets,
          soulTotal > 0 ? soulSources : undefined
        )
      );
    }
    const id = bounds.candidateIds[candidateIndex]!;
    const maximum = Math.min(incomingById[id] ?? 0, remainingSoul);
    for (let soul = 0; soul <= maximum; soul++) {
      if (soul > 0) soulTargets[id] = soul;
      else delete soulTargets[id];
      if (
        chooseSoulTargets(candidateIndex + 1, remainingSoul - soul, soulTargets)
      ) {
        return true;
      }
    }
    delete soulTargets[id];
    return false;
  };

  const chooseSoulSources = (
    sourceIndex: number,
    selectedSoul: number
  ): boolean => {
    if (sourceIndex >= sources.length) {
      const normalTotal = Object.values(normalSources).reduce(
        (sum, amount) => sum + amount,
        0
      );
      if (
        normalTotal + selectedSoul !== movedTotal ||
        normalTotal > action.totalNormalCores ||
        selectedSoul > totalSoulCores ||
        (action.mustPlaceSoulCore &&
          (normalTotal !== action.totalNormalCores ||
            selectedSoul !== totalSoulCores))
      ) {
        return false;
      }
      return chooseSoulTargets(0, selectedSoul, {});
    }
    const source = sources[sourceIndex]!;
    const minimumSoul = Math.max(0, source.outgoing - source.normalCap);
    const maximumSoul = Math.min(source.outgoing, source.soulCap);
    for (let soul = minimumSoul; soul <= maximumSoul; soul++) {
      const normal = source.outgoing - soul;
      if (
        normal > source.normalCap ||
        (source.combinedCap !== undefined && normal + soul > source.combinedCap)
      ) {
        continue;
      }
      if (normal > 0) normalSources[source.sourceKey] = normal;
      else delete normalSources[source.sourceKey];
      if (soul > 0) soulSources[source.sourceKey] = soul;
      else delete soulSources[source.sourceKey];
      if (chooseSoulSources(sourceIndex + 1, selectedSoul + soul)) return true;
    }
    delete normalSources[source.sourceKey];
    delete soulSources[source.sourceKey];
    return false;
  };

  return chooseSoulSources(0, 0);
}

function trainingMultiPlacementDraftOf(
  state: GameState
): TrainingMultiPlacementDraft | undefined {
  return (state as TrainingStateWithMultiPlacementDraft)
    .trainingMultiPlacementDraft;
}

function withTrainingMultiPlacementDraft(
  state: GameState,
  draft: TrainingMultiPlacementDraft
): GameState {
  return {
    ...state,
    trainingMultiPlacementDraft: draft,
  } as TrainingStateWithMultiPlacementDraft;
}

function withoutTrainingMultiPlacementDraft(state: GameState): GameState {
  const { trainingMultiPlacementDraft: _draft, ...cleanState } =
    state as TrainingStateWithMultiPlacementDraft;
  void _draft;
  return cleanState;
}

function trainingTargetSelectionDraftOf(
  state: GameState
): TrainingTargetSelectionDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingTargetSelectionDraft;
}

function withTrainingTargetSelectionDraft(
  state: GameState,
  draft: TrainingTargetSelectionDraft
): GameState {
  return {
    ...state,
    trainingTargetSelectionDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingTargetSelectionDraft(state: GameState): GameState {
  const { trainingTargetSelectionDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingCoreDistributionTargetTotalDraftOf(
  state: GameState
): TrainingCoreDistributionTargetTotalDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingCoreDistributionTargetTotalDraft;
}

function withTrainingCoreDistributionTargetTotalDraft(
  state: GameState,
  draft: TrainingCoreDistributionTargetTotalDraft
): GameState {
  return {
    ...state,
    trainingCoreDistributionTargetTotalDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingCoreDistributionTargetTotalDraft(
  state: GameState
): GameState {
  const { trainingCoreDistributionTargetTotalDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingCoreDistributionSourceAllocationDraftOf(
  state: GameState
): TrainingCoreDistributionSourceAllocationDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingCoreDistributionSourceAllocationDraft;
}

function withTrainingCoreDistributionSourceAllocationDraft(
  state: GameState,
  draft: TrainingCoreDistributionSourceAllocationDraft
): GameState {
  return {
    ...state,
    trainingCoreDistributionSourceAllocationDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingCoreDistributionSourceAllocationDraft(
  state: GameState
): GameState {
  const {
    trainingCoreDistributionSourceAllocationDraft: _draft,
    ...cleanState
  } = state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingCoreDistributionSoulTargetAllocationDraftOf(
  state: GameState
): TrainingCoreDistributionSoulTargetAllocationDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingCoreDistributionSoulTargetAllocationDraft;
}

function withTrainingCoreDistributionSoulTargetAllocationDraft(
  state: GameState,
  draft: TrainingCoreDistributionSoulTargetAllocationDraft
): GameState {
  return {
    ...state,
    trainingCoreDistributionSoulTargetAllocationDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingCoreDistributionSoulTargetAllocationDraft(
  state: GameState
): GameState {
  const {
    trainingCoreDistributionSoulTargetAllocationDraft: _draft,
    ...cleanState
  } = state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingZoneSelectionDraftOf(
  state: GameState
): TrainingZoneSelectionDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingZoneSelectionDraft;
}

function withTrainingZoneSelectionDraft(
  state: GameState,
  draft: TrainingZoneSelectionDraft
): GameState {
  return {
    ...state,
    trainingZoneSelectionDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingZoneSelectionDraft(state: GameState): GameState {
  const { trainingZoneSelectionDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingVariableZoneDiscountDraftOf(
  state: GameState
): TrainingVariableZoneDiscountDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingVariableZoneDiscountDraft;
}

function withTrainingVariableZoneDiscountDraft(
  state: GameState,
  draft: TrainingVariableZoneDiscountDraft
): GameState {
  return {
    ...state,
    trainingVariableZoneDiscountDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingVariableZoneDiscountDraft(state: GameState): GameState {
  const { trainingVariableZoneDiscountDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingSummonCostExcludeDraftOf(
  state: GameState
): TrainingSummonCostExcludeDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingSummonCostExcludeDraft;
}

function withTrainingSummonCostExcludeDraft(
  state: GameState,
  draft: TrainingSummonCostExcludeDraft
): GameState {
  return {
    ...state,
    trainingSummonCostExcludeDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingSummonCostExcludeDraft(state: GameState): GameState {
  const { trainingSummonCostExcludeDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingTopLevelPaymentDraftOf(
  state: GameState
): TrainingTopLevelPaymentDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingTopLevelPaymentDraft;
}

function withTrainingTopLevelPaymentDraft(
  state: GameState,
  draft: TrainingTopLevelPaymentDraft
): GameState {
  return {
    ...state,
    trainingTopLevelPaymentDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingTopLevelPaymentDraft(state: GameState): GameState {
  const { trainingTopLevelPaymentDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingReverseRebirthSummonDraftOf(
  state: GameState
): TrainingReverseRebirthSummonDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingReverseRebirthSummonDraft;
}

function withTrainingReverseRebirthSummonDraft(
  state: GameState,
  draft: TrainingReverseRebirthSummonDraft
): GameState {
  return {
    ...state,
    trainingReverseRebirthSummonDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingReverseRebirthSummonDraft(state: GameState): GameState {
  const { trainingReverseRebirthSummonDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

function trainingDeckRevealOrderDraftOf(
  state: GameState
): TrainingDeckRevealOrderDraft | undefined {
  return (state as TrainingStateWithFactoredActionInputDrafts)
    .trainingDeckRevealOrderDraft;
}

function withTrainingDeckRevealOrderDraft(
  state: GameState,
  draft: TrainingDeckRevealOrderDraft
): GameState {
  return {
    ...state,
    trainingDeckRevealOrderDraft: draft,
  } as TrainingStateWithFactoredActionInputDrafts;
}

function withoutTrainingDeckRevealOrderDraft(state: GameState): GameState {
  const { trainingDeckRevealOrderDraft: _draft, ...cleanState } =
    state as TrainingStateWithFactoredActionInputDrafts;
  void _draft;
  return cleanState;
}

/**
 * Some action inputs have factorial or powerset surfaces. Keep their
 * resolution atomic in rules-core, but expose their independent selections as
 * sequential training-only actions so MCTS never silently drops legal input.
 */
function factoredZoneSelectionInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_zone_selection" }>
): TrainingDecisionNode | null {
  // Per-card destinations are a second independent choice surface and retain
  // the direct implementation until they receive the same sequential draft.
  if (
    action.requiresPerCardDestinationChoice ||
    (action.handGainCost ?? 0) > 0 ||
    (action.alternateSelections?.length ?? 0) > 0
  ) {
    return null;
  }
  const draft = trainingZoneSelectionDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training zone-selection draft does not match the pending action"
    );
  }
  const candidateIndex = draft?.candidateIndex ?? 0;
  const selectedZoneCardIds = draft?.selectedZoneCardIds ?? [];
  const candidateId = action.candidateCardInstanceIds[candidateIndex];
  if (!candidateId) return null;

  const minimum = action.canSkip ? 0 : action.maxCount;
  const remainingAfterThis =
    action.candidateCardInstanceIds.length - candidateIndex - 1;
  const choices: TrainingDecisionChoice[] = [];
  if (selectedZoneCardIds.length < action.maxCount) {
    choices.push({
      choiceId: `${action.actionId}:training-zone:${candidateIndex}:select`,
      label: "select_factored_zone_selection",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        select: true,
      },
    });
  }
  if (selectedZoneCardIds.length + remainingAfterThis >= minimum) {
    choices.push({
      choiceId: `${action.actionId}:training-zone:${candidateIndex}:skip`,
      label: "select_factored_zone_selection",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        select: false,
      },
    });
  }
  return choices.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:zone:${candidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["selectedZoneCardIds"],
        choices,
        truncated: false,
      };
}

function variableZoneDiscountHasOtherTopLevelInput(
  state: GameState,
  action: Extract<LegalAction, { kind: "use_magic" }>,
  opts: TrainingDecisionSurfaceOptions,
  limit: number,
  options: { ignoreTargetInput?: boolean } = {}
): boolean {
  const completedTargetDraft = trainingTargetSelectionDraftOf(state);
  const targetInput = options.ignoreTargetInput
    ? null
    : targetInputGroupForTraining(state, action, limit);
  const ignoreTargetInput =
    options.ignoreTargetInput ||
    (completedTargetDraft?.actionId === action.actionId &&
      completedTargetDraft.complete) ||
    (targetInput !== null &&
      !targetInput.truncated &&
      targetInput.values.length <= 1);
  const groups = [
    ignoreTargetInput ? null : targetInput,
    payCostGroup(state, action, limit),
    attackAdditionalSourceGroup(
      state,
      action,
      opts.getCardDefinitionById,
      limit
    ),
    braveSeparationCoreGroup(state, action, opts.getCardDefinitionById, limit),
    followUpInputGroup(state, action, opts, limit),
    {
      values: chosenLifeCoreGroup(action),
      truncated: false,
      limit,
    },
  ];
  return groups.some((group) =>
    group?.values.some((value) => optionFields(value).length > 0)
  );
}

/**
 * A completed training-only target draft, or a single forced target, has
 * already fixed the target without leaving a policy choice. Downstream
 * factored inputs must carry it into the one atomic rules action that finally
 * applies the magic.
 */
function fixedFactoredTargetInput(
  state: GameState,
  action: LegalAction,
  limit = DEFAULT_MAX_GENERATED_CHOICES
): Pick<TrainingActionInputOptions, "targetInstanceIds"> {
  const draft = trainingTargetSelectionDraftOf(state);
  if (draft?.actionId === action.actionId && draft.complete) {
    return { targetInstanceIds: [...draft.selectedTargetInstanceIds] };
  }
  const targetInput = targetInputGroupForTraining(state, action, limit);
  if (
    targetInput?.truncated ||
    targetInput?.values.length !== 1 ||
    targetInput.values[0]?.targetInstanceIds === undefined
  ) {
    return {};
  }
  return { targetInstanceIds: [...targetInput.values[0].targetInstanceIds] };
}

/**
 * A variable zone discount couples a bounded card subset with a payment whose
 * required amount and available field sources depend on that subset. Choose
 * the subset first without changing game state, then enumerate only the
 * payments for the fixed subset. This preserves the atomic rules action while
 * avoiding the subset x payment Cartesian product in one policy node.
 */
function paymentSourcesTotalAmount(
  sources: readonly CardCostPaymentSource[]
): number {
  return sources.reduce((total, source) => total + source.amount, 0);
}

function hasReachableFactoredPaymentSourceAllocation(
  sources: readonly TrainingPaymentSource[],
  requiredCost: number,
  selectedPaymentSources: readonly CardCostPaymentSource[],
  nextCandidateIndex: number
): boolean {
  const paid = paymentSourcesTotalAmount(selectedPaymentSources);
  if (paid > requiredCost) return false;
  const remainingCapacity = sources
    .slice(nextCandidateIndex)
    .reduce((total, source) => total + source.normalCap + source.soulCap, 0);
  return paid + remainingCapacity >= requiredCost;
}

function samePaymentSource(
  left: CardCostPaymentSource | undefined,
  right: CardCostPaymentSource | undefined
): boolean {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind || left.amount !== right.amount) return false;
  if (left.includeSoulCore !== right.includeSoulCore) return false;
  if (left.kind === "reserve" || right.kind === "reserve") return true;
  return (
    left.instanceId === right.instanceId &&
    left.destination === right.destination
  );
}

function factoredVariableZoneDiscountPaymentInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "use_magic" }>,
  draft: TrainingVariableZoneDiscountDraft,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const direct = variableZoneDiscountMagicPaymentChoicesForSelection(
    state,
    action,
    draft.selectedZoneCardIds,
    limit
  );
  if (!direct?.truncated) return null;

  const paymentRequest = variableZoneDiscountMagicPaymentRequest(
    state,
    action,
    draft.selectedZoneCardIds
  );
  if (!paymentRequest) return null;
  const sources = paymentSourcesForTraining(paymentRequest);
  const paymentCandidateIndex = draft.paymentCandidateIndex ?? 0;
  const source = sources[paymentCandidateIndex];
  if (!source) return null;
  const selectedPaymentSources = draft.selectedPaymentSources ?? [];
  const remainingCost =
    paymentRequest.requiredCost -
    paymentSourcesTotalAmount(selectedPaymentSources);
  const choices = makeAccumulator<TrainingDecisionChoice>(limit);
  for (const paymentSource of paymentSourceAllocationOptions(
    source,
    remainingCost
  )) {
    const nextSelected = paymentSource
      ? [...selectedPaymentSources, paymentSource]
      : [...selectedPaymentSources];
    if (
      !hasReachableFactoredPaymentSourceAllocation(
        sources,
        paymentRequest.requiredCost,
        nextSelected,
        paymentCandidateIndex + 1
      )
    ) {
      continue;
    }
    const sourceKey = paymentSource
      ? `${paymentSource.kind}:${paymentSource.kind === "card" ? paymentSource.instanceId : "reserve"}:${paymentSource.amount}:${paymentSource.includeSoulCore ? "soul" : "normal"}`
      : "skip";
    pushLimited(choices, {
      choiceId: `${action.actionId}:training-variable-payment:${paymentCandidateIndex}:${sourceKey}`,
      label: "select_factored_payment_source",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        paymentCandidateIndex,
        paymentSource,
      },
    });
  }
  return choices.values.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:variable-payment:${paymentCandidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["paymentSources"],
        choices: choices.values,
        truncated: choices.truncated,
      };
}

function factoredVariableZoneDiscountInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "use_magic" }>,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  if (action.costMode !== "zone_discount_variable") return null;
  const maxCount = action.zoneCostPaymentMaxCount;
  const candidateIds = action.zoneCostPaymentCandidateIds ?? [];
  if (maxCount === undefined || maxCount <= 0 || candidateIds.length === 0) {
    return null;
  }
  const actionShape = actionRecord(action);
  if (
    actionShape.executionMode === "optional" ||
    actionShape.skipOnly === true ||
    variableZoneDiscountHasOtherTopLevelInput(
      state,
      action,
      opts,
      MAX_ATOMIC_VARIABLE_ZONE_DISCOUNT_CHOICES
    )
  ) {
    return null;
  }

  const draft = trainingVariableZoneDiscountDraftOf(state);
  if (draft && draft.actionId !== action.actionId) {
    throw new Error(
      "Training variable zone-discount draft does not match its action"
    );
  }
  if (!draft) {
    const probe = variableZoneDiscountMagicPaymentGroup(
      state,
      action,
      MAX_ATOMIC_VARIABLE_ZONE_DISCOUNT_CHOICES
    );
    if (!probe?.truncated) return null;
  }

  const selectedZoneCardIds = draft?.selectedZoneCardIds ?? [];
  if (draft?.selectionComplete) {
    const factored = factoredVariableZoneDiscountPaymentInputNode(
      state,
      action,
      draft,
      opts
    );
    if (factored) return factored;
    const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
    const payments = variableZoneDiscountMagicPaymentChoicesForSelection(
      state,
      action,
      selectedZoneCardIds,
      limit
    );
    if (!payments || payments.values.length === 0) return null;
    return {
      nodeId: `${action.actionId}:input:zone-discount-payment`,
      kind: "action_input",
      actingPlayerId: action.actingPlayerId,
      action,
      actionKind: action.kind,
      fields: ["paymentSources"],
      choices: payments.values.map((payment, index) =>
        makeChoice(
          `${action.actionId}:training-zone-discount:payment:${index}`,
          "select_variable_zone_discount_payment",
          {
            ...fixedFactoredTargetInput(state, action),
            selectedZoneCardIds: [...selectedZoneCardIds],
            ...payment,
          }
        )
      ),
      truncated: payments.truncated,
    };
  }

  const candidateIndex = draft?.candidateIndex ?? 0;
  const candidateId = candidateIds[candidateIndex];
  if (!candidateId) return null;
  const choices: TrainingDecisionChoice[] = [];
  const remainingCandidateIds = candidateIds.slice(candidateIndex + 1);
  const pushChoiceWhenPayable = (select: boolean): void => {
    const nextSelected = select
      ? [...selectedZoneCardIds, candidateId]
      : selectedZoneCardIds;
    const remainingSelectionCount = maxCount - nextSelected.length;
    if (
      !variableZoneDiscountHasPayableCompletion(
        state,
        action,
        nextSelected,
        remainingCandidateIds,
        remainingSelectionCount
      )
    ) {
      return;
    }
    choices.push({
      choiceId: `${action.actionId}:training-zone-discount:${candidateIndex}:${select ? "select" : "skip"}`,
      label: "select_factored_zone_selection",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        select,
      },
    });
  };
  if (selectedZoneCardIds.length < maxCount) pushChoiceWhenPayable(true);
  pushChoiceWhenPayable(false);
  return {
    nodeId: `${action.actionId}:input:zone-discount:${candidateIndex}`,
    kind: "action_input",
    actingPlayerId: action.actingPlayerId,
    action,
    actionKind: action.kind,
    fields: ["selectedZoneCardIds"],
    choices,
    truncated: false,
  };
}

function topLevelPaymentHasOtherInput(
  state: GameState,
  action: Extract<LegalAction, { kind: "summon" | "place_nexus" }>,
  opts: TrainingDecisionSurfaceOptions,
  limit: number
): boolean {
  const groups = [
    targetInputGroupForTraining(state, action, limit),
    payCostGroup(state, action, limit),
    attackAdditionalSourceGroup(
      state,
      action,
      opts.getCardDefinitionById,
      limit
    ),
    braveSeparationCoreGroup(state, action, opts.getCardDefinitionById, limit),
    followUpInputGroup(state, action, opts, limit),
    { values: chosenLifeCoreGroup(action), truncated: false, limit },
  ];
  return groups.some((group) =>
    group?.values.some((value) => optionFields(value).length > 0)
  );
}

function hasReachableFactoredTopLevelPaymentSourceAllocation(
  state: GameState,
  action: Extract<LegalAction, { kind: "summon" | "place_nexus" }>,
  sources: readonly TrainingPaymentSource[],
  requiredCost: number,
  selectedPaymentSources: readonly CardCostPaymentSource[],
  nextCandidateIndex: number,
  getCardDefinitionById?: Engine["getCardDefinitionById"]
): boolean {
  if (
    !hasReachableFactoredPaymentSourceAllocation(
      sources,
      requiredCost,
      selectedPaymentSources,
      nextCandidateIndex
    )
  ) {
    return false;
  }
  if (nextCandidateIndex >= sources.length) {
    return (
      paymentSourcesTotalAmount(selectedPaymentSources) === requiredCost &&
      topLevelPaymentSourcesAreCompletable(
        state,
        action,
        selectedPaymentSources,
        getCardDefinitionById
      )
    );
  }

  const source = sources[nextCandidateIndex]!;
  const remainingCost =
    requiredCost - paymentSourcesTotalAmount(selectedPaymentSources);
  for (const paymentSource of paymentSourceAllocationOptions(
    source,
    remainingCost
  )) {
    const nextSelected = paymentSource
      ? [...selectedPaymentSources, paymentSource]
      : [...selectedPaymentSources];
    if (
      hasReachableFactoredTopLevelPaymentSourceAllocation(
        state,
        action,
        sources,
        requiredCost,
        nextSelected,
        nextCandidateIndex + 1,
        getCardDefinitionById
      )
    ) {
      return true;
    }
  }
  return false;
}

function factoredTopLevelPaymentInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "summon" | "place_nexus" }>,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  if (
    topLevelPaymentHasOtherInput(
      state,
      action,
      opts,
      MAX_ATOMIC_VARIABLE_ZONE_DISCOUNT_CHOICES
    )
  ) {
    return null;
  }
  const draft = trainingTopLevelPaymentDraftOf(state);
  if (draft && draft.actionId !== action.actionId) {
    throw new Error(
      "Training top-level payment draft does not match its action"
    );
  }
  if (!draft) {
    const probe = topLevelPaymentGroup(
      state,
      action,
      MAX_ATOMIC_VARIABLE_ZONE_DISCOUNT_CHOICES,
      opts.getCardDefinitionById
    );
    if (!probe?.truncated) return null;
  }
  const request = topLevelPaymentRequest(state, action);
  if (!request) return null;
  const sources = paymentSourcesForTraining(request);
  const paymentCandidateIndex = draft?.paymentCandidateIndex ?? 0;
  const source = sources[paymentCandidateIndex];
  if (!source) return null;
  const selectedPaymentSources = draft?.selectedPaymentSources ?? [];
  const remainingCost =
    request.requiredCost - paymentSourcesTotalAmount(selectedPaymentSources);
  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const choices = makeAccumulator<TrainingDecisionChoice>(limit);
  for (const paymentSource of paymentSourceAllocationOptions(
    source,
    remainingCost
  )) {
    const nextSelected = paymentSource
      ? [...selectedPaymentSources, paymentSource]
      : [...selectedPaymentSources];
    if (
      !hasReachableFactoredTopLevelPaymentSourceAllocation(
        state,
        action,
        sources,
        request.requiredCost,
        nextSelected,
        paymentCandidateIndex + 1,
        opts.getCardDefinitionById
      )
    ) {
      continue;
    }
    const sourceKey = paymentSource
      ? `${paymentSource.kind}:${paymentSource.kind === "card" ? paymentSource.instanceId : "reserve"}:${paymentSource.amount}:${paymentSource.includeSoulCore ? "soul" : "normal"}`
      : "skip";
    pushLimited(choices, {
      choiceId: `${action.actionId}:training-top-level-payment:${paymentCandidateIndex}:${sourceKey}`,
      label: "select_factored_payment_source",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        topLevelPaymentCandidateIndex: paymentCandidateIndex,
        paymentSource,
      },
    });
  }
  return choices.values.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:top-level-payment:${paymentCandidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["paymentSources"],
        choices: choices.values,
        truncated: choices.truncated,
      };
}

function summonCostExcludeHasPayableCompletion(
  state: GameState,
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >,
  selectedCardInstanceIds: readonly string[],
  remainingCandidateIds: readonly string[],
  remainingSelectionCount: number
): boolean {
  const minCount = action.minCount ?? 0;
  const canPaySelection = (selection: readonly string[]): boolean => {
    if (selection.length < minCount) return false;
    return (
      summonCostExcludePaymentChoicesForSelection(state, action, selection, 1)
        .values.length > 0
    );
  };
  if (canPaySelection(selectedCardInstanceIds)) return true;
  if (remainingSelectionCount <= 0 || remainingCandidateIds.length === 0) {
    return false;
  }

  const selected = [...selectedCardInstanceIds];
  const visit = (candidateIndex: number, availableSlots: number): boolean => {
    if (candidateIndex >= remainingCandidateIds.length) {
      return canPaySelection(selected);
    }
    if (
      selected.length + remainingCandidateIds.length - candidateIndex <
      minCount
    ) {
      return false;
    }
    if (availableSlots > 0) {
      selected.push(remainingCandidateIds[candidateIndex]!);
      if (
        canPaySelection(selected) ||
        visit(candidateIndex + 1, availableSlots - 1)
      ) {
        selected.pop();
        return true;
      }
      selected.pop();
    }
    return visit(candidateIndex + 1, availableSlots);
  };

  return visit(0, remainingSelectionCount);
}

function factoredSummonCostExcludePaymentInputNode(
  state: GameState,
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >,
  draft: TrainingSummonCostExcludeDraft,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const direct = summonCostExcludePaymentChoicesForSelection(
    state,
    action,
    draft.selectedCardInstanceIds,
    limit
  );
  if (!direct.truncated) return null;

  const request = summonCostExcludePaymentRequest(
    state,
    action,
    draft.selectedCardInstanceIds
  );
  const sources = paymentSourcesForTraining(request);
  const paymentCandidateIndex = draft.paymentCandidateIndex ?? 0;
  const source = sources[paymentCandidateIndex];
  if (!source) return null;
  const selectedPaymentSources = draft.selectedPaymentSources ?? [];
  const remainingCost =
    request.requiredCost - paymentSourcesTotalAmount(selectedPaymentSources);
  const choices = makeAccumulator<TrainingDecisionChoice>(limit);
  for (const paymentSource of paymentSourceAllocationOptions(
    source,
    remainingCost
  )) {
    const nextSelected = paymentSource
      ? [...selectedPaymentSources, paymentSource]
      : [...selectedPaymentSources];
    if (
      !hasReachableFactoredPaymentSourceAllocation(
        sources,
        request.requiredCost,
        nextSelected,
        paymentCandidateIndex + 1
      )
    ) {
      continue;
    }
    const sourceKey = paymentSource
      ? `${paymentSource.kind}:${paymentSource.kind === "card" ? paymentSource.instanceId : "reserve"}:${paymentSource.amount}:${paymentSource.includeSoulCore ? "soul" : "normal"}`
      : "skip";
    pushLimited(choices, {
      choiceId: `${action.actionId}:training-summon-cost-exclude-payment:${paymentCandidateIndex}:${sourceKey}`,
      label: "select_factored_payment_source",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        summonCostExcludePaymentCandidateIndex: paymentCandidateIndex,
        paymentSource,
      },
    });
  }
  return choices.values.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:summon-cost-exclude-payment:${paymentCandidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["paymentSources"],
        choices: choices.values,
        truncated: choices.truncated,
      };
}

/**
 * The selected exclusion subset changes both the final cost and (for an
 * on-board candidate) the available payment sources. Keep the rules action
 * atomic, but let training choose the subset and payment allocation in small
 * policy nodes instead of truncating their Cartesian product.
 */
function factoredSummonCostExcludeInputNode(
  state: GameState,
  action: Extract<
    LegalAction,
    { kind: "resolve_pending_summon_cost_exclude_choice" }
  >,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  if (action.maxCount <= 0 || action.candidateCardInstanceIds.length === 0) {
    return null;
  }
  const draft = trainingSummonCostExcludeDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training summon-cost-exclude draft does not match its action"
    );
  }
  if (!draft) {
    const probe = actionInputChoicesForPending(
      state,
      action,
      opts,
      MAX_ATOMIC_VARIABLE_ZONE_DISCOUNT_CHOICES
    );
    if (!probe.truncated) return null;
  }

  const selectedCardInstanceIds = draft?.selectedCardInstanceIds ?? [];
  if (draft?.selectionComplete) {
    const factored = factoredSummonCostExcludePaymentInputNode(
      state,
      action,
      draft,
      opts
    );
    if (factored) return factored;
    const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
    const payments = summonCostExcludePaymentChoicesForSelection(
      state,
      action,
      selectedCardInstanceIds,
      limit
    );
    if (payments.values.length === 0) return null;
    return {
      nodeId: `${action.actionId}:input:summon-cost-exclude-payment`,
      kind: "action_input",
      actingPlayerId: action.actingPlayerId,
      action,
      actionKind: action.kind,
      fields: ["paymentSources"],
      choices: payments.values.map((payment, index) =>
        makeChoice(
          `${action.actionId}:training-summon-cost-exclude:payment:${index}`,
          "select_summon_cost_exclude_payment",
          {
            summonCostExcludeSelectedCardInstanceIds: [
              ...selectedCardInstanceIds,
            ],
            ...payment,
          }
        )
      ),
      truncated: payments.truncated,
    };
  }

  const candidateIndex = draft?.candidateIndex ?? 0;
  const candidateId = action.candidateCardInstanceIds[candidateIndex];
  if (!candidateId) return null;
  const choices: TrainingDecisionChoice[] = [];
  const remainingCandidateIds = action.candidateCardInstanceIds.slice(
    candidateIndex + 1
  );
  const pushChoiceWhenPayable = (select: boolean): void => {
    const nextSelected = select
      ? [...selectedCardInstanceIds, candidateId]
      : selectedCardInstanceIds;
    if (
      !summonCostExcludeHasPayableCompletion(
        state,
        action,
        nextSelected,
        remainingCandidateIds,
        action.maxCount - nextSelected.length
      )
    ) {
      return;
    }
    choices.push({
      choiceId: `${action.actionId}:training-summon-cost-exclude:${candidateIndex}:${select ? "select" : "skip"}`,
      label: "select_factored_zone_selection",
      systemAction: {
        kind: "select_factored_zone_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        select,
      },
    });
  };
  if (selectedCardInstanceIds.length < action.maxCount) {
    pushChoiceWhenPayable(true);
  }
  pushChoiceWhenPayable(false);
  return choices.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:summon-cost-exclude:${candidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["summonCostExcludeSelectedCardInstanceIds"],
        choices,
        truncated: false,
      };
}

/**
 * Split a large ordinary target subset into include/exclude decisions. This
 * keeps every legal subset available to training policies without forming a
 * Cartesian product with independent inputs such as payment sources.
 */
function factoredTargetSelectionInputNode(
  state: GameState,
  action: LegalAction,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  const usesDedicatedPaidPreventionSelection =
    action.kind === "resolve_pending_triggered_effect" &&
    action.paidPreventionImmunityCardCostAmount !== undefined &&
    (action.paidPreventionImmunityCardCostCandidateInstanceIds ?? []).length >
      action.paidPreventionImmunityCardCostAmount;
  // These paths intentionally omit the immediate target group. Factoring it
  // would add discarded choices or hide truncation in their dedicated input.
  if (
    action.kind === "resolve_battle_immediate_effect" ||
    usesDedicatedPaidPreventionSelection
  ) {
    return null;
  }
  const a = actionRecord(action);
  const isPendingTargetSelectionAction =
    action.kind === "resolve_pending_effect_target" ||
    action.kind === "resolve_pending_step_optional_target_selection" ||
    action.kind === "resolve_borrowed_effect_target";
  if (a.targetMode !== "manual" && !isPendingTargetSelectionAction) {
    return null;
  }
  const targetGroups = targetGroupsValue(a);
  const targetGroupsAreDisjoint = (() => {
    const seen = new Set<string>();
    for (const group of targetGroups) {
      for (const id of group.candidateTargetInstanceIds) {
        if (seen.has(id)) return false;
        seen.add(id);
      }
    }
    return true;
  })();
  if (
    booleanValue(a, "allowDuplicateTargets") === true ||
    stringArrayValue(a, "mandatoryTargetInstanceIds").length > 0 ||
    (targetGroups.length > 0 && !targetGroupsAreDisjoint)
  ) {
    return null;
  }

  const singleTargetCandidates = stringArrayValue(
    a,
    "candidateTargetInstanceIds"
  );
  const singleRequiredTargetCount = numberValue(a, "requiredTargetCount") ?? 0;
  const singleMaxTargetCount =
    numberValue(a, "maxTargetCount") ?? singleRequiredTargetCount;
  if (
    (targetGroups.length === 0 &&
      (singleTargetCandidates.length === 0 || singleMaxTargetCount < 0)) ||
    (targetGroups.length > 0 &&
      targetGroups.some(
        (group) =>
          (group.candidateTargetInstanceIds.length === 0 &&
            group.requiredTargetCount > 0) ||
          (group.maxTargetCount ?? group.requiredTargetCount) < 0
      ))
  ) {
    return null;
  }

  const draft = trainingTargetSelectionDraftOf(state);
  if (draft && draft.actionId !== action.actionId) {
    throw new Error(
      "Training target-selection draft does not match its action"
    );
  }
  if (!draft) {
    const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
    const targetSelections = targetSelectionsForAction(a, limit);
    const combinedInputs = actionInputChoicesForPending(
      state,
      action,
      opts,
      limit
    );
    if (
      (!combinedInputs.truncated && !targetSelections.truncated) ||
      (!targetSelections.truncated && targetSelections.values.length <= 1)
    ) {
      return null;
    }
    const inputsWithoutTarget = topLevelActionInputChoices(
      state,
      action,
      opts,
      limit,
      { includeTargetInput: false }
    );
    // Factoring the target only helps when the remaining fixed-subset input
    // surface is complete by itself. Otherwise keep the original truncation
    // visible until that independent input receives its own factorization.
    if (inputsWithoutTarget.truncated) {
      // `zone_discount_variable` can itself be factored after this target
      // subset has been fixed.  Permit the first handoff only when every
      // remaining input other than that discount is already atomic; otherwise
      // retain the original truncation signal instead of hiding a different
      // incomplete surface.
      const canFactorVariableZoneDiscountAfterTarget =
        action.kind === "use_magic" &&
        action.costMode === "zone_discount_variable" &&
        !variableZoneDiscountHasOtherTopLevelInput(state, action, opts, limit, {
          ignoreTargetInput: true,
        });
      if (!canFactorVariableZoneDiscountAfterTarget) return null;
    }
  }
  if (draft?.complete) return null;

  if (targetGroups.length > 0) {
    const targetGroupIndex = nextFactoredTargetGroupIndex(
      targetGroups,
      draft?.targetGroupIndex ?? 0
    );
    const targetGroup = targetGroups[targetGroupIndex];
    if (!targetGroup) return null;
    const candidateTargetInstanceIds = targetGroup.candidateTargetInstanceIds;
    const requiredTargetCount = targetGroup.requiredTargetCount;
    const maxTargetCount =
      targetGroup.maxTargetCount ?? targetGroup.requiredTargetCount;
    const candidateIndex = draft?.candidateIndex ?? 0;
    const candidateId = candidateTargetInstanceIds[candidateIndex];
    if (!candidateId) return null;
    const selectedTargetInstanceIds = draft?.selectedTargetInstanceIds ?? [];
    const selectedInGroup = selectedTargetInstanceIds.filter((id) =>
      candidateTargetInstanceIds.includes(id)
    ).length;
    const remainingAfterThis =
      candidateTargetInstanceIds.length - candidateIndex - 1;
    const choices: TrainingDecisionChoice[] = [];
    if (selectedInGroup < maxTargetCount) {
      choices.push({
        choiceId: `${action.actionId}:training-target-group:${targetGroupIndex}:${candidateIndex}:select`,
        label: "select_factored_target_selection",
        systemAction: {
          kind: "select_factored_target_selection",
          actingPlayerId: action.actingPlayerId,
          action,
          targetGroupIndex,
          candidateIndex,
          select: true,
        },
      });
    }
    if (selectedInGroup + remainingAfterThis >= requiredTargetCount) {
      choices.push({
        choiceId: `${action.actionId}:training-target-group:${targetGroupIndex}:${candidateIndex}:skip`,
        label: "select_factored_target_selection",
        systemAction: {
          kind: "select_factored_target_selection",
          actingPlayerId: action.actingPlayerId,
          action,
          targetGroupIndex,
          candidateIndex,
          select: false,
        },
      });
    }
    return choices.length === 0
      ? null
      : {
          nodeId: `${action.actionId}:input:target-group:${targetGroupIndex}:${candidateIndex}`,
          kind: "action_input",
          actingPlayerId: action.actingPlayerId,
          action,
          actionKind: action.kind,
          fields: ["targetInstanceIds"],
          choices,
          truncated: false,
        };
  }

  const candidateTargetInstanceIds = singleTargetCandidates;
  const requiredTargetCount = singleRequiredTargetCount;
  const maxTargetCount = singleMaxTargetCount;
  const candidateIndex = draft?.candidateIndex ?? 0;
  const candidateId = candidateTargetInstanceIds[candidateIndex];
  if (!candidateId) return null;
  const selectedTargetInstanceIds = draft?.selectedTargetInstanceIds ?? [];
  const remainingAfterThis =
    candidateTargetInstanceIds.length - candidateIndex - 1;
  const choices: TrainingDecisionChoice[] = [];
  if (selectedTargetInstanceIds.length < maxTargetCount) {
    choices.push({
      choiceId: `${action.actionId}:training-target:${candidateIndex}:select`,
      label: "select_factored_target_selection",
      systemAction: {
        kind: "select_factored_target_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        select: true,
      },
    });
  }
  if (
    selectedTargetInstanceIds.length + remainingAfterThis >=
    requiredTargetCount
  ) {
    choices.push({
      choiceId: `${action.actionId}:training-target:${candidateIndex}:skip`,
      label: "select_factored_target_selection",
      systemAction: {
        kind: "select_factored_target_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        select: false,
      },
    });
  }
  return choices.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:target:${candidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["targetInstanceIds"],
        choices,
        truncated: false,
      };
}

/**
 * A target-total/core-owner distribution is already two-stage in rules-core.
 * Its target-total stage can still contain O(n^k) final-total maps when a
 * player has accumulated many reserve cores. Keep the game action atomic,
 * but let training choose one target total at a time when the direct surface
 * would hit its choice cap. Disjoint sources use the shared bounds directly;
 * overlapping normal-only sources additionally validate each final-total map
 * through the same aggregate routing rules used by the atomic action.
 */
function factoredCoreDistributionTargetTotalInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  if (
    !action.targetTotalSelection ||
    action.targetTotalSelection.fixedTargetTotals !== undefined ||
    (!hasDisjointCoreDistributionSources(action) &&
      !canFactorOverlappingCoreDistributionTargetTotals(action))
  ) {
    return null;
  }
  const draft = trainingCoreDistributionTargetTotalDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training core-distribution target-total draft does not match the pending action"
    );
  }

  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const bounds = getCoreDistributionTargetTotalBounds(state, action);
  if (!draft) {
    const baselineTotal = bounds.candidateIds.reduce(
      (sum, id) => sum + (bounds.minimumTotals[id] ?? 0),
      0
    );
    const directTotals = integerDistributions({
      ids: [...bounds.candidateIds],
      minTotal: Math.max(0, bounds.minimumSelectedTotal - baselineTotal),
      maxTotal: Math.max(0, bounds.maximumSelectedTotal - baselineTotal),
      caps: Object.fromEntries(
        bounds.candidateIds.map((id) => [
          id,
          Math.max(
            0,
            (bounds.maximumTotals[id] ?? 0) - (bounds.minimumTotals[id] ?? 0)
          ),
        ])
      ),
      limit,
    });
    if (!directTotals.truncated) return null;
  }

  const candidateIndex = draft?.candidateIndex ?? 0;
  const candidateId = bounds.candidateIds[candidateIndex];
  if (!candidateId) return null;
  const selectedTotals = draft?.selectedTotals ?? {};
  const selectedTotal = Object.values(selectedTotals).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const selectedDeficit = Object.entries(selectedTotals).reduce(
    (sum, [id, amount]) =>
      sum + Math.max(0, amount - (bounds.currentTotals[id] ?? 0)),
    0
  );
  const remainingIds = bounds.candidateIds.slice(candidateIndex + 1);
  const remainingMinimumTotal = remainingIds.reduce(
    (sum, id) => sum + (bounds.minimumTotals[id] ?? 0),
    0
  );
  const remainingMaximumTotal = remainingIds.reduce(
    (sum, id) => sum + (bounds.maximumTotals[id] ?? 0),
    0
  );
  const remainingMinimumDeficit = remainingIds.reduce(
    (sum, id) =>
      sum +
      Math.max(
        0,
        (bounds.minimumTotals[id] ?? 0) - (bounds.currentTotals[id] ?? 0)
      ),
    0
  );
  const minimumSelectedTotal = Math.max(
    bounds.minimumSelectedTotal,
    action.minTotal ?? 0
  );
  const choices: TrainingDecisionChoice[] = [];
  const minimum = bounds.minimumTotals[candidateId] ?? 0;
  const maximum = bounds.maximumTotals[candidateId] ?? 0;
  for (let targetTotal = minimum; targetTotal <= maximum; targetTotal++) {
    const totalAfterThis = selectedTotal + targetTotal;
    const deficitAfterThis =
      selectedDeficit +
      Math.max(0, targetTotal - (bounds.currentTotals[candidateId] ?? 0));
    if (
      totalAfterThis + remainingMinimumTotal > bounds.maximumSelectedTotal ||
      totalAfterThis + remainingMaximumTotal < minimumSelectedTotal ||
      deficitAfterThis + remainingMinimumDeficit > bounds.maximumDeficitTotal
    ) {
      continue;
    }
    if (
      !hasReachableFactoredCoreDistributionTargetTotal(
        state,
        action,
        bounds,
        { ...selectedTotals, [candidateId]: targetTotal },
        candidateIndex + 1,
        limit
      )
    ) {
      continue;
    }
    choices.push({
      choiceId: `${action.actionId}:training-core-target-total:${candidateIndex}:${targetTotal}`,
      label: "select_factored_target_selection",
      systemAction: {
        kind: "select_factored_target_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        candidateIndex,
        targetTotal,
      },
    });
  }
  return choices.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:core-target-total:${candidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["coreDistributionAllocations"],
        choices,
        truncated: false,
      };
}

function coreDistributionSourceKeys(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): string[] {
  const keys: string[] = [];
  for (const source of action.allowedSources ?? []) {
    const key =
      source.kind === "field" ? `field:${source.instanceId}` : source.kind;
    if (
      keys.includes(key) ||
      ((action.sourceAvailable?.[key] ?? 0) <= 0 &&
        (action.soulSourceAvailable?.[key] ?? 0) <= 0)
    ) {
      continue;
    }
    keys.push(key);
  }
  return keys;
}

function singleTargetCoreDistributionSourceCompletion(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  normalAllocations: Readonly<Record<string, number>>,
  soulAllocations: Readonly<Record<string, number>>
): TrainingActionInputOptions | null {
  const target = action.candidates[0];
  const fixedTargetTotals = action.targetTotalSelection?.fixedTargetTotals;
  if (!target || action.candidates.length !== 1) {
    return null;
  }
  const card = getCardById(state, target.instanceId);
  const normalTotal = Object.values(normalAllocations).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const soulTotal = Object.values(soulAllocations).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const totalSoulCores = action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0);
  const maxTotal = action.maxTotal ?? action.totalNormalCores + totalSoulCores;
  if (
    normalTotal > action.totalNormalCores ||
    soulTotal > totalSoulCores ||
    normalTotal + soulTotal < (action.minTotal ?? 0) ||
    normalTotal + soulTotal > maxTotal ||
    (action.mustPlaceSoulCore &&
      (normalTotal !== action.totalNormalCores || soulTotal !== totalSoulCores))
  ) {
    return null;
  }
  const coreDistributionAllocations =
    normalTotal > 0 ? { [target.instanceId]: normalTotal } : {};
  const coreDistributionSoulCoreAllocations =
    soulTotal > 0 ? { [target.instanceId]: soulTotal } : {};
  if (
    !isCoreDistributionAllocationValid(
      action,
      coreDistributionAllocations,
      coreDistributionSoulCoreAllocations
    )
  )
    return null;
  if (
    !canSatisfyCoreDistributionSoulAllocation(
      action,
      coreDistributionSoulCoreAllocations,
      soulTotal > 0 ? { ...soulAllocations } : {}
    ) ||
    !canRouteNormalCoreDistributionWithoutSelfMove(
      action,
      coreDistributionAllocations,
      normalAllocations
    ) ||
    !fitsCombinedCoreDistributionSourceAvailability(
      action,
      normalAllocations,
      soulTotal > 0 ? soulAllocations : undefined
    ) ||
    !fixedCoreDistributionTotalsMatch(
      state,
      action,
      coreDistributionAllocations,
      normalAllocations,
      coreDistributionSoulCoreAllocations,
      soulTotal > 0 ? soulAllocations : undefined
    )
  ) {
    return null;
  }
  if (fixedTargetTotals !== undefined) {
    const currentTotal =
      (card?.normalCoreCount ?? 0) + (card?.soulCoreCount ?? 0);
    const targetSourceKey = `field:${target.instanceId}`;
    const finalTotal =
      currentTotal -
      (normalAllocations[targetSourceKey] ?? 0) -
      (soulAllocations[targetSourceKey] ?? 0) +
      normalTotal +
      soulTotal;
    if (finalTotal !== (fixedTargetTotals[target.instanceId] ?? 0)) {
      return null;
    }
  }
  return {
    coreDistributionAllocations,
    coreDistributionSourceAllocations: { ...normalAllocations },
    ...(soulTotal > 0
      ? {
          coreDistributionSoulCoreAllocations,
          coreDistributionSoulCoreSourceAllocations: { ...soulAllocations },
        }
      : {}),
  };
}

function hasReachableFactoredSingleTargetCoreDistributionSourceAllocation(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  sourceKeys: readonly string[],
  sourceIndex: number,
  normalAllocations: Readonly<Record<string, number>>,
  soulAllocations: Readonly<Record<string, number>>,
  memo: Map<string, boolean>
): boolean {
  const targetId = action.candidates[0]?.instanceId ?? "";
  const normalTotal = Object.values(normalAllocations).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const soulTotal = Object.values(soulAllocations).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const targetSourceKey = `field:${targetId}`;
  const memoKey = [
    sourceIndex,
    normalTotal,
    soulTotal,
    normalAllocations[targetSourceKey] ?? 0,
    soulAllocations[targetSourceKey] ?? 0,
  ].join(":");
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;
  if (sourceIndex >= sourceKeys.length) {
    const complete =
      singleTargetCoreDistributionSourceCompletion(
        state,
        action,
        normalAllocations,
        soulAllocations
      ) !== null;
    memo.set(memoKey, complete);
    return complete;
  }
  const sourceKey = sourceKeys[sourceIndex]!;
  const normalCap = action.sourceAvailable?.[sourceKey] ?? 0;
  const soulCap = action.soulSourceAvailable?.[sourceKey] ?? 0;
  const combinedCap = action.sourceTotalAvailable?.[sourceKey];
  for (let normalAmount = 0; normalAmount <= normalCap; normalAmount++) {
    for (let soulAmount = 0; soulAmount <= soulCap; soulAmount++) {
      if (
        combinedCap !== undefined &&
        normalAmount + soulAmount > combinedCap
      ) {
        continue;
      }
      const nextNormal =
        normalAmount > 0
          ? { ...normalAllocations, [sourceKey]: normalAmount }
          : { ...normalAllocations };
      const nextSoul =
        soulAmount > 0
          ? { ...soulAllocations, [sourceKey]: soulAmount }
          : { ...soulAllocations };
      if (
        hasReachableFactoredSingleTargetCoreDistributionSourceAllocation(
          state,
          action,
          sourceKeys,
          sourceIndex + 1,
          nextNormal,
          nextSoul,
          memo
        )
      ) {
        memo.set(memoKey, true);
        return true;
      }
    }
  }
  memo.set(memoKey, false);
  return false;
}

/**
 * A fixed multi-target distribution with disjoint sources has no outgoing
 * core on any target.  Once source normal/soul totals are selected, the only
 * remaining degree of freedom is the soul-core partition over the fixed
 * target totals.  Keep that partition as its own small sequence instead of
 * rebuilding the source/target Cartesian product.
 */
function isFactoredDisjointMultiTargetCoreDistribution(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): boolean {
  return (
    action.fromKind === "any_movable" &&
    action.candidates.length > 1 &&
    action.targetTotalSelection?.fixedTargetTotals !== undefined &&
    hasDisjointCoreDistributionSources(action)
  );
}

/**
 * A one-target any-movable distribution can be represented entirely by its
 * source choices.  It is safe both after a target-total owner fixed the final
 * total and for ordinary single-owner optional distributions, where the sum
 * of selected sources is the target allocation itself.
 */
function isFactoredSingleTargetCoreDistribution(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): boolean {
  return (
    action.fromKind === "any_movable" &&
    action.candidates.length === 1 &&
    (action.targetTotalSelection === undefined ||
      action.targetTotalSelection.fixedTargetTotals !== undefined)
  );
}

function fixedDisjointCoreDistributionIncomingTotals(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): Record<string, number> | null {
  const fixedTargetTotals = action.targetTotalSelection?.fixedTargetTotals;
  if (!fixedTargetTotals || !hasDisjointCoreDistributionSources(action)) {
    return null;
  }
  const incomingTotals: Record<string, number> = {};
  for (const candidate of action.candidates) {
    const card = getCardById(state, candidate.instanceId);
    const currentTotal =
      (card?.normalCoreCount ?? 0) + (card?.soulCoreCount ?? 0);
    const incoming =
      (fixedTargetTotals[candidate.instanceId] ?? 0) - currentTotal;
    if (incoming < 0) return null;
    incomingTotals[candidate.instanceId] = incoming;
  }
  return incomingTotals;
}

function allocationTotal(
  allocations: Readonly<Record<string, number>>
): number {
  return Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
}

function factoredDisjointCoreDistributionTotalsAreLegal(
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  normalTotal: number,
  soulTotal: number,
  requiredIncomingTotal: number
): boolean {
  const totalSoulCores = action.totalSoulCores ?? (action.hasSoulCore ? 1 : 0);
  const maxTotal = action.maxTotal ?? action.totalNormalCores + totalSoulCores;
  const total = normalTotal + soulTotal;
  return (
    normalTotal >= 0 &&
    soulTotal >= 0 &&
    total === requiredIncomingTotal &&
    normalTotal <= action.totalNormalCores &&
    soulTotal <= totalSoulCores &&
    total >= (action.minTotal ?? 0) &&
    total <= maxTotal &&
    (!action.mustPlaceSoulCore ||
      (normalTotal === action.totalNormalCores && soulTotal === totalSoulCores))
  );
}

function hasReachableFactoredDisjointCoreDistributionSourceAllocation(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  sourceKeys: readonly string[],
  sourceIndex: number,
  normalAllocations: Readonly<Record<string, number>>,
  soulAllocations: Readonly<Record<string, number>>,
  memo: Map<string, boolean>
): boolean {
  const incomingTotals = fixedDisjointCoreDistributionIncomingTotals(
    state,
    action
  );
  if (!incomingTotals) return false;
  const requiredIncomingTotal = allocationTotal(incomingTotals);
  const normalTotal = allocationTotal(normalAllocations);
  const soulTotal = allocationTotal(soulAllocations);
  if (normalTotal + soulTotal > requiredIncomingTotal) return false;
  const memoKey = `${sourceIndex}:${normalTotal}:${soulTotal}`;
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;
  if (sourceIndex >= sourceKeys.length) {
    const complete = factoredDisjointCoreDistributionTotalsAreLegal(
      action,
      normalTotal,
      soulTotal,
      requiredIncomingTotal
    );
    memo.set(memoKey, complete);
    return complete;
  }
  const sourceKey = sourceKeys[sourceIndex]!;
  const normalCap = action.sourceAvailable?.[sourceKey] ?? 0;
  const soulCap = action.soulSourceAvailable?.[sourceKey] ?? 0;
  const combinedCap = action.sourceTotalAvailable?.[sourceKey];
  for (
    let normalAmount = 0;
    normalAmount <= Math.min(normalCap, requiredIncomingTotal - normalTotal);
    normalAmount++
  ) {
    for (
      let soulAmount = 0;
      soulAmount <=
      Math.min(soulCap, requiredIncomingTotal - normalTotal - normalAmount);
      soulAmount++
    ) {
      if (
        combinedCap !== undefined &&
        normalAmount + soulAmount > combinedCap
      ) {
        continue;
      }
      if (
        hasReachableFactoredDisjointCoreDistributionSourceAllocation(
          state,
          action,
          sourceKeys,
          sourceIndex + 1,
          normalAmount > 0
            ? { ...normalAllocations, [sourceKey]: normalAmount }
            : normalAllocations,
          soulAmount > 0
            ? { ...soulAllocations, [sourceKey]: soulAmount }
            : soulAllocations,
          memo
        )
      ) {
        memo.set(memoKey, true);
        return true;
      }
    }
  }
  memo.set(memoKey, false);
  return false;
}

function completeFactoredDisjointCoreDistribution(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  normalSourceAllocations: Readonly<Record<string, number>>,
  soulSourceAllocations: Readonly<Record<string, number>>,
  soulTargetAllocations: Readonly<Record<string, number>>
): TrainingActionInputOptions | null {
  const incomingTotals = fixedDisjointCoreDistributionIncomingTotals(
    state,
    action
  );
  if (!incomingTotals) return null;
  const normalTotal = allocationTotal(normalSourceAllocations);
  const soulTotal = allocationTotal(soulSourceAllocations);
  if (
    !factoredDisjointCoreDistributionTotalsAreLegal(
      action,
      normalTotal,
      soulTotal,
      allocationTotal(incomingTotals)
    ) ||
    allocationTotal(soulTargetAllocations) !== soulTotal
  ) {
    return null;
  }

  const coreDistributionAllocations: Record<string, number> = {};
  for (const candidate of action.candidates) {
    const incoming = incomingTotals[candidate.instanceId] ?? 0;
    const soul = soulTargetAllocations[candidate.instanceId] ?? 0;
    if (soul < 0 || soul > incoming) return null;
    const normal = incoming - soul;
    if (normal > 0) coreDistributionAllocations[candidate.instanceId] = normal;
  }
  if (
    allocationTotal(coreDistributionAllocations) !== normalTotal ||
    (soulTotal > 0 &&
      !canSatisfyCoreDistributionSoulAllocation(
        action,
        soulTargetAllocations as Record<string, number>,
        soulSourceAllocations as Record<string, number>
      )) ||
    !fitsCombinedCoreDistributionSourceAvailability(
      action,
      normalSourceAllocations as Record<string, number>,
      soulTotal > 0
        ? (soulSourceAllocations as Record<string, number>)
        : undefined
    ) ||
    !canRouteNormalCoreDistributionWithoutSelfMove(
      action,
      coreDistributionAllocations,
      normalSourceAllocations as Record<string, number>
    ) ||
    !fixedCoreDistributionTotalsMatch(
      state,
      action,
      coreDistributionAllocations,
      normalSourceAllocations as Record<string, number>,
      soulTargetAllocations as Record<string, number>,
      soulTotal > 0
        ? (soulSourceAllocations as Record<string, number>)
        : undefined
    )
  ) {
    return null;
  }
  return {
    coreDistributionAllocations,
    coreDistributionSourceAllocations: { ...normalSourceAllocations },
    ...(soulTotal > 0
      ? {
          coreDistributionSoulCoreAllocations: { ...soulTargetAllocations },
          coreDistributionSoulCoreSourceAllocations: {
            ...soulSourceAllocations,
          },
        }
      : {}),
  };
}

/**
 * A single target can still leave a large Cartesian product of physical
 * source maps, whether its total was fixed by a prior owner or is the sum of
 * the optional source choices. Select each source's normal/soul amount in
 * turn and retain only prefixes with a legal atomic completion. The final
 * action remains the existing validated core-distribution action.
 */
function factoredCoreDistributionSourceAllocationInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  const factoredDisjointMultiTarget =
    isFactoredDisjointMultiTargetCoreDistribution(action);
  if (
    !factoredDisjointMultiTarget &&
    !isFactoredSingleTargetCoreDistribution(action)
  ) {
    return null;
  }
  const draft = trainingCoreDistributionSourceAllocationDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training core-distribution source-allocation draft does not match the pending action"
    );
  }
  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  if (!draft && !coreDistributionChoices(state, action, limit).truncated) {
    return null;
  }
  const sourceKeys = coreDistributionSourceKeys(action);
  const sourceCandidateIndex = draft?.sourceCandidateIndex ?? 0;
  const sourceKey = sourceKeys[sourceCandidateIndex];
  if (!sourceKey) return null;
  const normalAllocations = draft?.normalAllocations ?? {};
  const soulAllocations = draft?.soulAllocations ?? {};
  const normalCap = action.sourceAvailable?.[sourceKey] ?? 0;
  const soulCap = action.soulSourceAvailable?.[sourceKey] ?? 0;
  const combinedCap = action.sourceTotalAvailable?.[sourceKey];
  const memo = new Map<string, boolean>();
  const choices = makeAccumulator<TrainingDecisionChoice>(limit);
  for (let normalAmount = 0; normalAmount <= normalCap; normalAmount++) {
    for (let soulAmount = 0; soulAmount <= soulCap; soulAmount++) {
      if (
        combinedCap !== undefined &&
        normalAmount + soulAmount > combinedCap
      ) {
        continue;
      }
      const nextNormal =
        normalAmount > 0
          ? { ...normalAllocations, [sourceKey]: normalAmount }
          : { ...normalAllocations };
      const nextSoul =
        soulAmount > 0
          ? { ...soulAllocations, [sourceKey]: soulAmount }
          : { ...soulAllocations };
      if (
        !(factoredDisjointMultiTarget
          ? hasReachableFactoredDisjointCoreDistributionSourceAllocation(
              state,
              action,
              sourceKeys,
              sourceCandidateIndex + 1,
              nextNormal,
              nextSoul,
              memo
            )
          : hasReachableFactoredSingleTargetCoreDistributionSourceAllocation(
              state,
              action,
              sourceKeys,
              sourceCandidateIndex + 1,
              nextNormal,
              nextSoul,
              memo
            ))
      ) {
        continue;
      }
      pushLimited(choices, {
        choiceId: `${action.actionId}:training-core-source:${sourceCandidateIndex}:${sourceKey}:${normalAmount}:${soulAmount}`,
        label: "select_factored_core_source",
        systemAction: {
          kind: "select_factored_zone_selection",
          actingPlayerId: action.actingPlayerId,
          action,
          coreDistributionSourceCandidateIndex: sourceCandidateIndex,
          normalAmount,
          soulAmount,
        },
      });
    }
  }
  return choices.values.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:core-source:${sourceCandidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: [
          "coreDistributionSourceAllocations",
          "coreDistributionSoulCoreSourceAllocations",
        ],
        choices: choices.values,
        truncated: choices.truncated,
      };
}

function factoredCoreDistributionSoulTargetAllocationInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_core_distribution" }>
): TrainingDecisionNode | null {
  if (!isFactoredDisjointMultiTargetCoreDistribution(action)) return null;
  const sourceDraft = trainingCoreDistributionSourceAllocationDraftOf(state);
  if (
    !sourceDraft ||
    sourceDraft.pendingId !== action.pendingId ||
    sourceDraft.actionId !== action.actionId ||
    sourceDraft.sourceCandidateIndex !==
      coreDistributionSourceKeys(action).length
  ) {
    return null;
  }
  const sourceSoulTotal = allocationTotal(sourceDraft.soulAllocations);
  if (sourceSoulTotal <= 0) return null;
  const incomingTotals = fixedDisjointCoreDistributionIncomingTotals(
    state,
    action
  );
  if (!incomingTotals) return null;
  const draft = trainingCoreDistributionSoulTargetAllocationDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training core-distribution soul-target draft does not match the pending action"
    );
  }
  const candidateIndex = draft?.targetCandidateIndex ?? 0;
  const candidate = action.candidates[candidateIndex];
  if (!candidate) return null;
  const selectedSoulTotal = allocationTotal(draft?.soulAllocations ?? {});
  const remainingCapacity = action.candidates
    .slice(candidateIndex + 1)
    .reduce((sum, next) => sum + (incomingTotals[next.instanceId] ?? 0), 0);
  const maximum = Math.min(
    incomingTotals[candidate.instanceId] ?? 0,
    sourceSoulTotal - selectedSoulTotal
  );
  const choices: TrainingDecisionChoice[] = [];
  for (let soulAmount = 0; soulAmount <= maximum; soulAmount++) {
    const totalAfterThis = selectedSoulTotal + soulAmount;
    if (
      totalAfterThis > sourceSoulTotal ||
      totalAfterThis + remainingCapacity < sourceSoulTotal
    ) {
      continue;
    }
    choices.push({
      choiceId: `${action.actionId}:training-core-soul-target:${candidateIndex}:${soulAmount}`,
      label: "select_factored_core_soul_target",
      systemAction: {
        kind: "select_factored_target_selection",
        actingPlayerId: action.actingPlayerId,
        action,
        coreDistributionSoulTargetCandidateIndex: candidateIndex,
        soulAmount,
      },
    });
  }
  return choices.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:core-soul-target:${candidateIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["coreDistributionSoulCoreAllocations"],
        choices,
        truncated: false,
      };
}

function factoredDeckRevealOrderInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_deck_reveal_order" }>
): TrainingDecisionNode | null {
  if (
    action.remainder !== "top_bottom_split" &&
    action.remainder !== "top_or_bottom" &&
    action.remainder !== "top" &&
    action.remainder !== "bottom"
  ) {
    return null;
  }
  const draft = trainingDeckRevealOrderDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training deck-reveal order draft does not match the pending action"
    );
  }
  const ordered = draft?.deckRevealRemainderOrder ?? [];
  const remaining = action.remainingCardInstanceIds.filter(
    (id) => !ordered.includes(id)
  );
  if (remaining.length === 0) return null;
  const choices: TrainingDecisionChoice[] = [];
  const fixedPlacement =
    action.remainder === "top" || action.remainder === "bottom"
      ? action.remainder
      : draft?.deckRevealPlacement;
  const placements =
    action.remainder === "top_bottom_split" || fixedPlacement === undefined
      ? (["top", "bottom"] as const)
      : ([fixedPlacement] as const);
  for (const cardInstanceId of remaining) {
    for (const placement of placements) {
      choices.push({
        choiceId: `${action.actionId}:training-deck-order:${ordered.length}:${cardInstanceId}:${placement}`,
        label: "select_factored_deck_reveal_order",
        systemAction: {
          kind: "select_factored_deck_reveal_order",
          actingPlayerId: action.actingPlayerId,
          action,
          cardInstanceId,
          placement,
        },
      });
    }
  }
  return {
    nodeId: `${action.actionId}:input:deck-order:${ordered.length}`,
    kind: "action_input",
    actingPlayerId: action.actingPlayerId,
    action,
    actionKind: action.kind,
    fields:
      action.remainder === "top_bottom_split"
        ? ["deckRevealRemainderOrder", "deckRevealRemainderPlacements"]
        : action.remainder === "top_or_bottom"
          ? ["deckRevealRemainderOrder", "deckRevealPlacement"]
          : ["deckRevealRemainderOrder"],
    choices,
    truncated: false,
  };
}

type FactoredPlacementAction = Extract<
  LegalAction,
  {
    kind:
      | "resolve_pending_multi_placement"
      | "resolve_pending_enter_field_placement";
  }
>;

type TrainingPlacementFactoringSpec = {
  sources: TrainingPlacementSource[];
  minimumCoreCount: number;
  maximumCoreCount: number;
  field: "multiPlacementAllocations" | "enterFieldCorePlacements";
  destinationInstanceId?: string;
};

function placementFactoringSpec(
  state: GameState,
  action: FactoredPlacementAction,
  opts: TrainingDecisionSurfaceOptions
): TrainingPlacementFactoringSpec | null {
  if (action.kind === "resolve_pending_multi_placement") {
    // Multi-target placement shares each source budget between destinations.
    // Keep it atomic until that shared-budget case gets the same factoring.
    if (action.targets.length !== 1) return null;
    const target = action.targets[0]!;
    const sources = placementSources({
      state,
      playerId: action.actingPlayerId,
      allowedTrashNormalCoreCount:
        (action.trashNormalCoreMax ?? 0) + (action.trashCoreMax ?? 0),
      excludeInstanceIds: action.targets.map(
        (placementTarget) => placementTarget.instanceId
      ),
      ...(opts.getCardDefinitionById
        ? { getCardDefinitionById: opts.getCardDefinitionById }
        : {}),
    });
    return {
      sources,
      minimumCoreCount: target.minimumCoreCount,
      maximumCoreCount:
        target.maximumCoreCount ??
        sources.reduce(
          (sum, source) => sum + source.normalCap + source.soulCap,
          0
        ),
      field: "multiPlacementAllocations",
      destinationInstanceId: target.instanceId,
    };
  }

  const pending =
    state.pendingEnterFieldPlacement?.pendingId === action.pendingId
      ? state.pendingEnterFieldPlacement
      : null;
  const sourceDefinition = opts.getCardDefinitionById?.(
    action.sourceDefinitionId
  );
  const trashGrant =
    pending?.deferredStack?.actionKind === "summon" && sourceDefinition
      ? getSummonTrashCorePlacementGrant(
          state,
          action.actingPlayerId,
          sourceDefinition
        )
      : null;
  const sources = placementSources({
    state,
    playerId: action.actingPlayerId,
    excludeInstanceIds: [action.sourceInstanceId],
    ...(opts.getCardDefinitionById
      ? { getCardDefinitionById: opts.getCardDefinitionById }
      : {}),
    ...(trashGrant ? { allowedTrashNormalCoreCount: trashGrant.amount } : {}),
  });
  return {
    sources,
    minimumCoreCount: action.minimumCoreCount,
    maximumCoreCount:
      action.maximumCoreCount ??
      sources.reduce(
        (sum, source) => sum + source.normalCap + source.soulCap,
        0
      ),
    field: "enterFieldCorePlacements",
  };
}

function placementFromTrainingSource(
  source: TrainingPlacementSource,
  normalAmount: number,
  soulAmount: number
): EnterFieldCorePlacement[] {
  const placements: EnterFieldCorePlacement[] = [];
  if (source.kind === "reserve") {
    if (normalAmount > 0) {
      placements.push({ kind: "reserve_normal", amount: normalAmount });
    }
    if (soulAmount > 0) placements.push({ kind: "reserve_soul" });
    return placements;
  }
  if (source.kind === "trash") {
    if (soulAmount > 0) {
      throw new Error("Training trash placement cannot include a soul core");
    }
    if (normalAmount > 0) {
      placements.push({ kind: "trash_normal", amount: normalAmount });
    }
    return placements;
  }
  if (!source.instanceId) {
    throw new Error(
      "Training multi-placement card source is missing instanceId"
    );
  }
  if (normalAmount > 0) {
    placements.push({
      kind: "card_normal",
      instanceId: source.instanceId,
      amount: normalAmount,
    });
  }
  if (soulAmount > 0) {
    placements.push({ kind: "card_soul", instanceId: source.instanceId });
  }
  return placements;
}

/**
 * A placement's source allocations are independent once their source order is
 * fixed. Representing each source as a decision preserves every legal final
 * allocation while avoiding the exponential Cartesian product at one node.
 */
function factoredPlacementInputNode(
  state: GameState,
  action: FactoredPlacementAction,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  const spec = placementFactoringSpec(state, action, opts);
  if (!spec) return null;
  const draft = trainingMultiPlacementDraftOf(state);
  if (draft && draft.pendingId !== action.pendingId) {
    throw new Error(
      "Training placement draft " +
        draft.pendingId +
        " does not match action " +
        action.pendingId
    );
  }
  const sourceIndex = draft?.sourceIndex ?? 0;
  const existingPlacements = draft?.placements ?? [];
  const placed = getPlacedCoreCount(existingPlacements);
  const remaining = spec.maximumCoreCount - placed;
  const source = spec.sources[sourceIndex];
  if (!source || remaining < 0) return null;

  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const choices = makeAccumulator<TrainingDecisionChoice>(limit);
  const normalMax = Math.min(source.normalCap, remaining);
  const followingSourceCapacity = spec.sources
    .slice(sourceIndex + 1)
    .reduce(
      (sum, followingSource) =>
        sum + followingSource.normalCap + followingSource.soulCap,
      0
    );
  for (let normalAmount = 0; normalAmount <= normalMax; normalAmount++) {
    const soulMax = Math.min(source.soulCap, remaining - normalAmount);
    for (let soulAmount = 0; soulAmount <= soulMax; soulAmount++) {
      if (normalAmount + soulAmount > (source.totalCap ?? Infinity)) continue;
      const finalPlaced = placed + normalAmount + soulAmount;
      if (finalPlaced + followingSourceCapacity < spec.minimumCoreCount) {
        continue;
      }
      pushLimited(choices, {
        choiceId:
          action.actionId +
          ":training-mp:" +
          sourceIndex +
          ":" +
          normalAmount +
          ":" +
          soulAmount,
        label: "select_multi_placement_source",
        systemAction: {
          kind: "select_multi_placement_source",
          actingPlayerId: action.actingPlayerId,
          action,
          sourceIndex,
          source,
          normalAmount,
          soulAmount,
        },
      });
    }
  }
  if (choices.values.length === 0) return null;
  return {
    nodeId: action.actionId + ":input:source:" + sourceIndex,
    kind: "action_input",
    actingPlayerId: action.actingPlayerId,
    action,
    actionKind: action.kind,
    fields: [spec.field],
    choices: choices.values,
    truncated: choices.truncated,
  };
}

type ReverseRebirthSummonPaymentContext = {
  returnedState: GameState;
  getCardDefinitionById: NonNullable<
    TrainingDecisionSurfaceOptions["getCardDefinitionById"]
  >;
  sources: TrainingPaymentSource[];
};

function reverseRebirthSummonPaymentContext(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_reverse_rebirth_summon" }>,
  opts: TrainingDecisionSurfaceOptions
): ReverseRebirthSummonPaymentContext | null {
  const getCardDefinitionById = opts.getCardDefinitionById;
  const frontDefinition = getCardDefinitionById?.(action.frontDefinitionId);
  if (!getCardDefinitionById || !frontDefinition) return null;

  const returnedState = reverseRebirthSummonSourceReturnedState(state, action);
  const available = getAvailableCardCostPaymentSources({
    state: returnedState,
    actingPlayerId: action.actingPlayerId,
    excludeFieldInstanceIds: [action.sourceInstanceId],
    card: frontDefinition,
    sourceInstanceId: action.sourceInstanceId,
    getCardDefinitionById,
  });
  return {
    returnedState,
    getCardDefinitionById,
    sources: paymentSourcesForTraining({
      state: returnedState,
      playerId: action.actingPlayerId,
      requiredCost: action.costToPay,
      reserveAvailable: available.reserveSource.availableCoreAmount,
      onBoardSources: available.onBoardCoreSources.filter(
        (source) => source.instanceId !== action.sourceInstanceId
      ),
      soulOnlySources: available.soulCoreOnlySources.filter(
        (source) => source.instanceId !== action.sourceInstanceId
      ),
    }),
  };
}

function hasReachableFactoredReverseRebirthPayment(
  sources: readonly TrainingPaymentSource[],
  requiredCost: number,
  selectedPaymentSources: readonly CardCostPaymentSource[],
  nextCandidateIndex: number
): boolean {
  const paid = paymentSourcesTotalAmount(selectedPaymentSources);
  if (paid > requiredCost) return false;
  const remainingCapacity = sources
    .slice(nextCandidateIndex)
    .reduce((sum, source) => sum + source.normalCap + source.soulCap, 0);
  return paid + remainingCapacity >= requiredCost;
}

function reverseRebirthSummonStateAfterPayment(
  context: ReverseRebirthSummonPaymentContext,
  action: Extract<LegalAction, { kind: "resolve_reverse_rebirth_summon" }>,
  paymentSources: readonly CardCostPaymentSource[]
): GameState | null {
  if (paymentSources.length === 0) {
    return action.costToPay === 0 ? context.returnedState : null;
  }
  try {
    return applyCardCostPayments({
      state: context.returnedState,
      actingPlayerId: action.actingPlayerId,
      chainId: `training:reverse-rebirth:${action.pendingId}`,
      paymentSources,
      getCardDefinitionById: context.getCardDefinitionById,
    });
  } catch {
    return null;
  }
}

function factoredReverseRebirthSummonInputNode(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_reverse_rebirth_summon" }>,
  opts: TrainingDecisionSurfaceOptions
): TrainingDecisionNode | null {
  const existingDraft = trainingReverseRebirthSummonDraftOf(state);
  if (
    existingDraft &&
    (existingDraft.pendingId !== action.pendingId ||
      existingDraft.actionId !== action.actionId)
  ) {
    throw new Error("Training reverse-rebirth draft does not match its action");
  }

  if (!existingDraft) {
    const atomicProbe = reverseRebirthSummonInputChoices(
      state,
      action,
      opts,
      MAX_ATOMIC_ENTER_FIELD_PLACEMENT_CHOICES
    );
    if (!atomicProbe.truncated) return null;
  }

  const context = reverseRebirthSummonPaymentContext(state, action, opts);
  if (!context) return null;
  const draft =
    existingDraft ??
    ({
      pendingId: action.pendingId,
      actionId: action.actionId,
      phase: action.costToPay > 0 ? "payment" : "placement",
      paymentCandidateIndex: 0,
      selectedPaymentSources: [],
      placementSourceIndex: 0,
      placements: [],
    } satisfies TrainingReverseRebirthSummonDraft);

  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  if (draft.phase === "payment") {
    const source = context.sources[draft.paymentCandidateIndex];
    if (!source) return null;
    const choices = makeAccumulator<TrainingDecisionChoice>(limit);
    const remainingCost =
      action.costToPay -
      paymentSourcesTotalAmount(draft.selectedPaymentSources);
    for (const paymentSource of paymentSourceAllocationOptions(
      source,
      remainingCost
    )) {
      const nextSelected = paymentSource
        ? [...draft.selectedPaymentSources, paymentSource]
        : [...draft.selectedPaymentSources];
      if (
        !hasReachableFactoredReverseRebirthPayment(
          context.sources,
          action.costToPay,
          nextSelected,
          draft.paymentCandidateIndex + 1
        )
      ) {
        continue;
      }
      const sourceKey = paymentSource
        ? `${paymentSource.kind}:${paymentSource.kind === "card" ? paymentSource.instanceId : "reserve"}:${paymentSource.amount}:${paymentSource.includeSoulCore ? "soul" : "normal"}`
        : "skip";
      pushLimited(choices, {
        choiceId: `${action.actionId}:training-reverse-rebirth-payment:${draft.paymentCandidateIndex}:${sourceKey}`,
        label: "select_factored_reverse_rebirth_payment_source",
        systemAction: {
          kind: "select_factored_zone_selection",
          actingPlayerId: action.actingPlayerId,
          action,
          reverseRebirthPaymentCandidateIndex: draft.paymentCandidateIndex,
          paymentSource,
        },
      });
    }
    return choices.values.length === 0
      ? null
      : {
          nodeId: `${action.actionId}:input:reverse-rebirth-payment:${draft.paymentCandidateIndex}`,
          kind: "action_input",
          actingPlayerId: action.actingPlayerId,
          action,
          actionKind: action.kind,
          fields: ["summonPaymentSources"],
          choices: choices.values,
          truncated: choices.truncated,
        };
  }

  const afterPayment = reverseRebirthSummonStateAfterPayment(
    context,
    action,
    draft.selectedPaymentSources
  );
  if (!afterPayment) return null;
  const sources = placementSources({
    state: afterPayment,
    playerId: action.actingPlayerId,
    excludeInstanceIds: [action.sourceInstanceId],
    getCardDefinitionById: context.getCardDefinitionById,
  });
  const source = sources[draft.placementSourceIndex];
  if (!source) return null;
  const placed = getPlacedCoreCount(draft.placements);
  const maximumCoreCount = sources.reduce(
    (sum, candidate) => sum + candidate.normalCap + candidate.soulCap,
    0
  );
  const remaining = maximumCoreCount - placed;
  if (remaining < 0) return null;
  const followingSourceCapacity = sources
    .slice(draft.placementSourceIndex + 1)
    .reduce(
      (sum, candidate) => sum + candidate.normalCap + candidate.soulCap,
      0
    );
  const choices = makeAccumulator<TrainingDecisionChoice>(limit);
  for (
    let normalAmount = 0;
    normalAmount <= Math.min(source.normalCap, remaining);
    normalAmount++
  ) {
    for (
      let soulAmount = 0;
      soulAmount <= Math.min(source.soulCap, remaining - normalAmount);
      soulAmount++
    ) {
      const finalPlaced = placed + normalAmount + soulAmount;
      if (finalPlaced + followingSourceCapacity < action.minimumCoreCount) {
        continue;
      }
      pushLimited(choices, {
        choiceId: `${action.actionId}:training-reverse-rebirth-placement:${draft.placementSourceIndex}:${normalAmount}:${soulAmount}`,
        label: "select_factored_reverse_rebirth_placement_source",
        systemAction: {
          kind: "select_factored_zone_selection",
          actingPlayerId: action.actingPlayerId,
          action,
          reverseRebirthPlacementSourceIndex: draft.placementSourceIndex,
          normalAmount,
          soulAmount,
        },
      });
    }
  }
  return choices.values.length === 0
    ? null
    : {
        nodeId: `${action.actionId}:input:reverse-rebirth-placement:${draft.placementSourceIndex}`,
        kind: "action_input",
        actingPlayerId: action.actingPlayerId,
        action,
        actionKind: action.kind,
        fields: ["summonEnterFieldCorePlacements"],
        choices: choices.values,
        truncated: choices.truncated,
      };
}

function createActionInputDecisionNodeInner(
  state: GameState,
  action: LegalAction,
  opts: TrainingDecisionSurfaceOptions = {}
): TrainingDecisionNode | null {
  // skipOnly は pending を drain するだけで、対象・コストなどの入力を受け付けない。
  // actionInputChoicesForPending に通常の効果メタデータを渡すと、既に非発揮化された
  // 効果についても古い対象選択を再構成してしまい、training replay が進行不能になる。
  if ("skipOnly" in action && action.skipOnly === true) return null;
  if (action.kind === "resolve_reverse_rebirth_summon") {
    const factored = factoredReverseRebirthSummonInputNode(state, action, opts);
    if (factored) return factored;
  }
  const factoredTarget = factoredTargetSelectionInputNode(state, action, opts);
  if (factoredTarget) return factoredTarget;
  if (action.kind === "summon" || action.kind === "place_nexus") {
    const factored = factoredTopLevelPaymentInputNode(state, action, opts);
    if (factored) return factored;
  }
  if (action.kind === "use_magic") {
    const factored = factoredVariableZoneDiscountInputNode(state, action, opts);
    if (factored) return factored;
  }
  if (action.kind === "resolve_pending_summon_cost_exclude_choice") {
    const factored = factoredSummonCostExcludeInputNode(state, action, opts);
    if (factored) return factored;
  }
  if (action.kind === "resolve_pending_core_distribution") {
    const factored = factoredCoreDistributionTargetTotalInputNode(
      state,
      action,
      opts
    );
    if (factored) return factored;
    const sourceFactored = factoredCoreDistributionSourceAllocationInputNode(
      state,
      action,
      opts
    );
    if (sourceFactored) return sourceFactored;
    const soulTargetFactored =
      factoredCoreDistributionSoulTargetAllocationInputNode(state, action);
    if (soulTargetFactored) return soulTargetFactored;
  }
  const unboundedEnterFieldPlacementNeedsFactoring =
    action.kind === "resolve_pending_enter_field_placement" &&
    action.maximumCoreCount === null &&
    (placementFactoringSpec(state, action, opts)?.sources.reduce(
      (sum, source) => sum + source.normalCap + source.soulCap,
      0
    ) ?? 0) > Math.max(action.minimumCoreCount, 12);
  if (
    action.kind === "resolve_pending_multi_placement" ||
    (action.kind === "resolve_pending_enter_field_placement" &&
      (trainingMultiPlacementDraftOf(state) ||
        unboundedEnterFieldPlacementNeedsFactoring))
  ) {
    const factored = factoredPlacementInputNode(state, action, opts);
    if (factored) return factored;
  }
  if (action.kind === "resolve_pending_zone_selection") {
    const factored = factoredZoneSelectionInputNode(state, action);
    if (factored) return factored;
  }
  if (action.kind === "resolve_pending_deck_reveal_order") {
    const factored = factoredDeckRevealOrderInputNode(state, action);
    if (factored) return factored;
  }
  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const generationLimit =
    action.kind === "resolve_pending_enter_field_placement"
      ? Math.min(limit, MAX_ATOMIC_ENTER_FIELD_PLACEMENT_CHOICES)
      : limit;
  let generated = actionInputChoicesForPending(
    state,
    action,
    opts,
    generationLimit
  );
  if (
    generated.truncated &&
    action.kind === "resolve_pending_enter_field_placement"
  ) {
    const factored = factoredPlacementInputNode(state, action, opts);
    if (factored) return factored;
    if (generationLimit !== limit) {
      generated = actionInputChoicesForPending(state, action, opts, limit);
    }
  }
  const choices = generated.values
    .map((applyOptions, index) => {
      const fields = optionFields(applyOptions);
      return fields.length > 0
        ? makeChoice(
            `${action.actionId}:input:${index}`,
            `${action.kind} input ${index + 1}`,
            applyOptions
          )
        : null;
    })
    .filter((choice): choice is TrainingDecisionChoice => choice !== null);
  if (choices.length === 0) return null;
  const fields = [
    ...new Set(
      choices.flatMap((choice) => optionFields(choice.applyOptions ?? {}))
    ),
  ].sort();
  return {
    nodeId: `${action.actionId}:input`,
    kind: "action_input",
    actingPlayerId: action.actingPlayerId,
    action,
    actionKind: action.kind,
    fields,
    choices,
    truncated: generated.truncated,
  };
}

type ManualCoreMoveContainer = {
  id: string;
  normal: NormalCoreContainer;
  soul: SoulCoreContainer;
  normalCount: number;
  soulCount: number;
  everHadCorePlaced: boolean;
};

function manualCoreMoveContainers(
  state: GameState,
  playerId: string
): ManualCoreMoveContainer[] {
  const player = currentPlayer(state, playerId);
  const pendingLeaveIds = new Set(
    state.pendingLeaveEntities.map((pending) => pending.instanceId)
  );
  const containers: ManualCoreMoveContainer[] = [
    {
      id: "reserve",
      normal: { kind: "reserve", playerId },
      soul: { kind: "reserve", playerId },
      normalCount: player?.reserveNormalCoreCount ?? 0,
      soulCount: player?.reserveSoulCoreCount ?? 0,
      everHadCorePlaced: false,
    },
  ];

  for (const card of state.cardInstances) {
    if (card.controllerPlayerId !== playerId) continue;
    if (card.zone !== "field") continue;
    if (
      card.pendingLeaveKind !== null ||
      pendingLeaveIds.has(card.instanceId)
    ) {
      continue;
    }
    containers.push({
      id: card.instanceId,
      normal: { kind: "card", instanceId: card.instanceId },
      soul: { kind: "card", instanceId: card.instanceId },
      normalCount: card.normalCoreCount,
      soulCount: card.soulCoreCount,
      everHadCorePlaced: card.everHadCorePlaced,
    });
  }

  return containers;
}

function normalCoreMoveDraftsForDistribution(
  containers: readonly ManualCoreMoveContainer[],
  distribution: Record<string, number>
): DraftCoreMove[] {
  const surplus = containers
    .map((container) => ({
      container,
      amount: container.normalCount - (distribution[container.id] ?? 0),
    }))
    .filter((entry) => entry.amount > 0);
  const deficit = containers
    .map((container) => ({
      container,
      amount: (distribution[container.id] ?? 0) - container.normalCount,
    }))
    .filter((entry) => entry.amount > 0);
  const drafts: DraftCoreMove[] = [];
  let deficitIndex = 0;

  for (const source of surplus) {
    let remaining = source.amount;
    while (remaining > 0 && deficitIndex < deficit.length) {
      const target = deficit[deficitIndex]!;
      const amount = Math.min(remaining, target.amount);
      drafts.push({
        kind: "normal",
        from: source.container.normal,
        to: target.container.normal,
        amount,
        purpose: "core_move",
      });
      remaining -= amount;
      target.amount -= amount;
      if (target.amount === 0) deficitIndex++;
    }
  }

  return drafts;
}

function manualCoreMoveNormalOptions(
  containers: readonly ManualCoreMoveContainer[],
  limit: number
): ChoiceAccumulator<readonly DraftCoreMove[]> {
  const acc = makeAccumulator<readonly DraftCoreMove[]>(limit);
  pushLimited(acc, []);
  const totalNormal = containers.reduce(
    (sum, container) => sum + container.normalCount,
    0
  );
  if (totalNormal === 0) return acc;

  const distributions = integerDistributions({
    ids: containers.map((container) => container.id),
    minTotal: totalNormal,
    maxTotal: totalNormal,
    limit,
  });
  if (distributions.truncated) acc.truncated = true;
  for (const distribution of distributions.values) {
    const drafts = normalCoreMoveDraftsForDistribution(
      containers,
      distribution
    );
    if (drafts.length === 0) continue;
    pushLimited(acc, drafts);
  }
  return acc;
}

function manualCoreMoveSoulOptions(
  containers: readonly ManualCoreMoveContainer[],
  playerId: string,
  limit: number
): ChoiceAccumulator<readonly DraftCoreMove[]> {
  const acc = makeAccumulator<readonly DraftCoreMove[]>(limit);
  pushLimited(acc, []);
  for (const source of containers) {
    if (source.soulCount <= 0) continue;
    for (const target of containers) {
      if (source.id === target.id) continue;
      pushLimited(acc, [
        {
          kind: "soul",
          playerId,
          from: source.soul,
          to: target.soul,
          purpose: "core_move",
        },
      ]);
    }
  }
  return acc;
}

const TRAINING_FACTORED_MANUAL_CORE_DRAFT_PREFIX =
  "training:factored-manual-core-draft";

function factoredManualCoreDraftMarker(
  phase: "active" | "committed",
  actor: string
): string {
  return `${TRAINING_FACTORED_MANUAL_CORE_DRAFT_PREFIX}:${phase}:${actor}`;
}

function activeFactoredManualCoreDraftActors(
  state: GameState
): readonly string[] {
  const markerPrefix = `${TRAINING_FACTORED_MANUAL_CORE_DRAFT_PREFIX}:`;
  const latestPhaseByActor = new Map<string, "active" | "committed">();
  for (const entry of state.log) {
    if (!entry.startsWith(markerPrefix)) continue;
    const [phase, ...actorParts] = entry.slice(markerPrefix.length).split(":");
    if (
      (phase !== "active" && phase !== "committed") ||
      actorParts.length === 0
    ) {
      continue;
    }
    latestPhaseByActor.set(actorParts.join(":"), phase);
  }
  return [...latestPhaseByActor]
    .filter(([, phase]) => phase === "active")
    .map(([actor]) => actor)
    .sort();
}

function hasActiveFactoredManualCoreDraft(
  state: GameState,
  actor: string
): boolean {
  return activeFactoredManualCoreDraftActors(state).includes(actor);
}

function hasTrainingResponseWindow(state: GameState): boolean {
  return (
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.pendingCoreSourceAllocation?.continuation !== undefined ||
    (state.activeAttack?.flashWindowState !== null &&
      state.activeAttack?.flashWindowState !== undefined)
  );
}

/**
 * A response pass must always be drained before the training loop can advance.
 * It may resolve to the state from before the response window opened (for
 * example, a conditional-cost effect that rolls its cost back), so treating
 * that required close as a revisit would strand the pending stack and make the
 * forced-transition fallback call advanceStep illegally. Do not accept every
 * action merely because it occurs inside a response window: declarations from
 * the outer battle-flash loop must still be subject to the revisit guard.
 *
 * A `pass_battle_flash` is different from an outer declaration. Both the
 * inner stack pass and the outer flash pass are deterministic closure actions:
 * the latter advances the two-pass counter and necessarily closes the window
 * on the second pass. Deferred stack resolution actions (for example a
 * `pendingStepChoice` and its subsequent target selection) are also required
 * closure actions when they return to that outer flash window without changing
 * the logical state. Rejecting either as a revisit strands `activeAttack`,
 * after which the forced-transition fallback incorrectly attempts
 * `advanceStep`.
 */
export function isTrainingResponseWindowClosingAction(
  stateBeforeTransition: GameState,
  action: LegalAction
): boolean {
  switch (action.kind) {
    case "pass_stack":
      return stateBeforeTransition.stackWindow !== null;
    case "pass_pre_declaration_stack":
      return stateBeforeTransition.preDeclarationStackWindow !== null;
    case "pass_battle_flash": {
      const flashWindowState =
        stateBeforeTransition.activeAttack?.flashWindowState;
      if (!flashWindowState) return false;
      if (action.responseTiming === "stack") {
        return flashWindowState.pendingStackAction !== null;
      }
      return (
        action.responseTiming === "flash" &&
        flashWindowState.pendingStackAction === null
      );
    }
    case "resolve_core_source_allocation":
      // A conditional-cost rollback can return to an already visited playable
      // state. The mandatory payment prompt still has to close before advancing.
      return (
        stateBeforeTransition.pendingCoreSourceAllocation?.continuation !==
        undefined
      );
    case "resolve_pending_step_choice":
      return (
        stateBeforeTransition.pendingStepChoice?.deferredStack !== undefined &&
        stateBeforeTransition.activeAttack?.flashWindowState !== null &&
        stateBeforeTransition.activeAttack?.flashWindowState !== undefined
      );
    case "resolve_pending_effect_target":
      return (
        stateBeforeTransition.pendingEffectTargetSelection !== null &&
        stateBeforeTransition.activeAttack?.flashWindowState !== null &&
        stateBeforeTransition.activeAttack?.flashWindowState !== undefined
      );
    default:
      return false;
  }
}

function acceptsTrainingProgressTransition(
  stateBeforeTransition: GameState,
  nextState: GameState,
  visitedStateFingerprints: ReadonlyMap<string, unknown>,
  action?: LegalAction
): boolean {
  return (
    (action !== undefined &&
      (isTrainingResponseWindowClosingAction(stateBeforeTransition, action) ||
        ("skipOnly" in action && action.skipOnly === true))) ||
    isNovelTrainingProgressState(nextState, visitedStateFingerprints)
  );
}

/**
 * 全コア配分を 1 decision に展開すると、N 個の通常コアを C 個のコンテナに置く
 * 候補数が組合せ的に増える。training/effect-debug 用には、reserve を中継する
 * 1 コア draft と commit に分解する。draft 中は SBA を実行しないので、通常/ソウル
 * の交換を含む本来は原子的なコア移動 batch を、最終 commit まで保持できる。
 */
function factoredManualCoreMoveSystemActions(
  state: GameState,
  actor: string,
  engine: Engine,
  limit: number
): ChoiceAccumulator<TrainingSystemAction> {
  const acc = makeAccumulator<TrainingSystemAction>(limit);
  const containers = manualCoreMoveContainers(state, actor);
  const reserve = containers.find((container) => container.id === "reserve");
  if (!reserve) return acc;

  const add = (draft: DraftCoreMove): void => {
    if (!isValidManualCoreMove(state, [draft], actor, engine)) return;
    pushLimited(acc, {
      kind: "manual_core_move",
      actingPlayerId: actor,
      drafts: [draft],
      trainingFactored: true,
    });
  };

  for (const card of containers) {
    if (card.id === "reserve") continue;
    if (reserve.normalCount > 0) {
      add({
        kind: "normal",
        from: reserve.normal,
        to: card.normal,
        amount: 1,
        purpose: "core_move",
      });
    }
    if (card.normalCount > 0) {
      add({
        kind: "normal",
        from: card.normal,
        to: reserve.normal,
        amount: 1,
        purpose: "core_move",
      });
    }
  }

  for (const source of containers) {
    if (source.id === "reserve" || source.soulCount === 0) continue;
    add({
      kind: "soul",
      playerId: actor,
      from: source.soul,
      to: reserve.soul,
      purpose: "core_move",
    });
  }
  if (reserve.soulCount > 0) {
    for (const card of containers) {
      if (card.id === "reserve") continue;
      add({
        kind: "soul",
        playerId: actor,
        from: reserve.soul,
        to: card.soul,
        purpose: "core_move",
      });
    }
  }
  return acc;
}

const TRAINING_MANUAL_CORE_MOVE_SIGNATURE_PREFIX =
  "training:manual-core-move-signature";

function manualCoreMoveSoulLocationSignature(
  state: GameState,
  actor: string
): string {
  const location = currentPlayer(state, actor)?.soulCoreLocation ?? null;
  if (location === null) return "soul=null";
  if (location.kind === "card") return `soul=card:${location.instanceId}`;
  return `soul=${location.kind}`;
}

function manualCoreMovePositionSignature(
  state: GameState,
  actor: string
): string {
  const containerParts = manualCoreMoveContainers(state, actor)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (container) =>
        `${container.id}=n${container.normalCount}:s${container.soulCount}:had${container.everHadCorePlaced ? 1 : 0}`
    )
    .join("|");
  return [
    TRAINING_MANUAL_CORE_MOVE_SIGNATURE_PREFIX,
    state.turnNumber,
    actor,
    state.step,
    state.window,
    manualCoreMoveSoulLocationSignature(state, actor),
    containerParts,
  ].join(":");
}

function hasSeenManualCoreMovePosition(
  state: GameState,
  signature: string
): boolean {
  const scanStart = Math.max(
    0,
    Math.min(state.log.length, state.actionStartLogIndex ?? 0)
  );
  for (let index = state.log.length - 1; index >= scanStart; index--) {
    if (state.log[index] === signature) return true;
  }
  return false;
}

function manualCoreMoveAllowedContainerKeys(
  state: GameState,
  actor: string
): Set<string> {
  const keys = new Set<string>();
  for (const container of manualCoreMoveContainers(state, actor)) {
    keys.add(
      container.id === "reserve" ? `reserve:${actor}` : `card:${container.id}`
    );
  }
  return keys;
}

function manualCoreMoveContainerKey(
  container: NormalCoreContainer | SoulCoreContainer
): string | null {
  if (container.kind === "card") return `card:${container.instanceId}`;
  if (container.kind === "reserve") return `reserve:${container.playerId}`;
  return null;
}

function hasOnlyAllowedManualCoreMoveEndpoints(
  state: GameState,
  drafts: readonly DraftCoreMove[],
  actor: string
): boolean {
  const allowed = manualCoreMoveAllowedContainerKeys(state, actor);
  for (const draft of drafts) {
    const fromKey = manualCoreMoveContainerKey(draft.from);
    const toKey = manualCoreMoveContainerKey(draft.to);
    if (fromKey === null || toKey === null) return false;
    if (!allowed.has(fromKey) || !allowed.has(toKey)) return false;
  }
  return true;
}

function isValidManualCoreMove(
  state: GameState,
  drafts: readonly DraftCoreMove[],
  actor: string,
  engine: Engine
): boolean {
  if (drafts.length === 0) return false;
  if (!hasOnlyAllowedManualCoreMoveEndpoints(state, drafts, actor)) {
    return false;
  }
  const violation = findManualCoreMoveViolation(
    state,
    drafts,
    engine.getCardDefinitionById
  );
  if (violation) return false;
  try {
    const currentSignature = manualCoreMovePositionSignature(state, actor);
    const nextState = applyDraftCoreMoves(
      state,
      drafts,
      engine.getCardDefinitionById
    );
    const nextSignature = manualCoreMovePositionSignature(nextState, actor);
    if (nextSignature === currentSignature) return false;
    return !hasSeenManualCoreMovePosition(state, nextSignature);
  } catch {
    return false;
  }
}

function canOfferManualCoreMove(state: GameState, actor: string): boolean {
  return (
    state.step === "main" &&
    state.window === "none" &&
    state.activePlayerId === actor &&
    getGameProgressBlockerReason(state) === null
  );
}

function manualCoreMoveSystemActions(
  state: GameState,
  actor: string,
  engine: Engine,
  limit: number,
  factorThroughReserve = false
): ChoiceAccumulator<TrainingSystemAction> {
  const acc = makeAccumulator<TrainingSystemAction>(limit);
  if (!canOfferManualCoreMove(state, actor)) {
    return acc;
  }

  if (factorThroughReserve) {
    return factoredManualCoreMoveSystemActions(state, actor, engine, limit);
  }

  const containers = manualCoreMoveContainers(state, actor);
  const normalOptions = manualCoreMoveNormalOptions(containers, limit);
  const soulOptions = manualCoreMoveSoulOptions(containers, actor, limit);
  if (normalOptions.truncated || soulOptions.truncated) acc.truncated = true;

  for (const normalDrafts of normalOptions.values) {
    for (const soulDrafts of soulOptions.values) {
      const drafts = [...normalDrafts, ...soulDrafts];
      if (!isValidManualCoreMove(state, drafts, actor, engine)) continue;
      pushLimited(acc, {
        kind: "manual_core_move",
        actingPlayerId: actor,
        drafts,
      });
    }
  }
  return acc;
}

function canOfferAdvanceStep(state: GameState, actor: string): boolean {
  if (state.activePlayerId !== actor) return false;
  if (state.step === "attack") return false;
  return getGameProgressBlockerReason(state) === null;
}

type SystemActionChoiceBuilder = (
  state: GameState,
  actor: string,
  engine: Engine,
  limit: number,
  factorManualCoreMovesThroughReserve: boolean
) => { choices: TrainingDecisionChoice[]; truncated: boolean };

const SYSTEM_ACTION_CHOICE_BUILDERS = {
  advance_step: (state, actor) => ({
    choices: canOfferAdvanceStep(state, actor)
      ? [
          {
            choiceId: `system:advance-step:${actor}:${state.turnNumber}:${state.step}:${state.window}`,
            label: "advance_step",
            systemAction: {
              kind: "advance_step",
              actingPlayerId: actor,
            } satisfies TrainingSystemAction,
          },
        ]
      : [],
    truncated: false,
  }),
  manual_core_move: (state, actor, engine, limit, factorThroughReserve) => {
    const manualMoves = manualCoreMoveSystemActions(
      state,
      actor,
      engine,
      limit,
      factorThroughReserve
    );
    return {
      choices: manualMoves.values.map((systemAction, index) => ({
        choiceId: `system:manual-core-move:${actor}:${index}`,
        label: "manual_core_move",
        systemAction,
      })),
      truncated: manualMoves.truncated,
    };
  },
} satisfies Record<PlayerSystemActionKind, SystemActionChoiceBuilder>;

function systemActionsForTraining(
  state: GameState,
  actor: string,
  engine: Engine,
  opts: TrainingDecisionSurfaceOptions = {},
  suppressManualCoreMoves = false
): { choices: TrainingDecisionChoice[]; truncated: boolean } {
  const limit = opts.maxGeneratedChoices ?? DEFAULT_MAX_GENERATED_CHOICES;
  const choices: TrainingDecisionChoice[] = [];
  let truncated = false;
  for (const kind of PLAYER_SYSTEM_ACTION_KINDS) {
    if (suppressManualCoreMoves && kind === "manual_core_move") continue;
    const built = SYSTEM_ACTION_CHOICE_BUILDERS[kind](
      state,
      actor,
      engine,
      limit,
      opts.factorManualCoreMovesThroughReserve === true
    );
    choices.push(...built.choices);
    truncated = truncated || built.truncated;
  }
  return { choices, truncated };
}

export function legalActionsForTraining(
  state: GameState,
  engine: Engine,
  opts: TrainingDecisionSurfaceOptions = {}
): TrainingDecisionNode | null {
  const actorIds = [
    ...getCurrentActorPlayerIds(state, {
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }),
  ];
  const actors = actorIds.length > 0 ? actorIds : [state.activePlayerId];
  for (const actor of actors) {
    // Manual-core drafts are training-only staging and must yield to every
    // priority response window. The draft remains active and resumes after
    // the response closes; suppressing its pass action here would instead
    // make the training loop attempt advanceStep against the open window.
    const factoredManualCoreDraftActive =
      opts.factorManualCoreMovesThroughReserve === true &&
      !hasTrainingResponseWindow(state) &&
      hasActiveFactoredManualCoreDraft(state, actor);
    const actions = factoredManualCoreDraftActive
      ? []
      : getLegalActions({
          state,
          actingPlayerId: actor,
          getCardDefinitionById: engine.getCardDefinitionById,
          ...engine.lookups,
        }).filter((action) => action.can);
    const system = systemActionsForTraining(
      state,
      actor,
      engine,
      opts,
      actions.length > 0 &&
        opts.suppressManualCoreMovesWhenLegalActionsExist === true
    );
    const systemChoices = factoredManualCoreDraftActive
      ? [
          ...system.choices.filter(
            (choice) => choice.systemAction?.kind === "manual_core_move"
          ),
          {
            choiceId: `system:commit-factored-manual-core-move:${actor}:${state.turnNumber}`,
            label: "commit_factored_manual_core_move",
            systemAction: {
              kind: "commit_factored_manual_core_move",
              actingPlayerId: actor,
            } satisfies TrainingSystemAction,
          },
        ]
      : system.choices;
    if (actions.length === 0 && systemChoices.length === 0) continue;
    return {
      nodeId: `legal:${actor}:${state.turnNumber}:${state.step}:${state.window}`,
      kind: "legal_action",
      actingPlayerId: actor,
      fields: [],
      choices: [
        ...actions.map((action, index) => ({
          choiceId: action.actionId || `action:${index}`,
          label: action.kind,
          action,
        })),
        ...systemChoices,
      ],
      truncated: system.truncated,
    };
  }
  return null;
}

function resolveJanken(
  first: JankenHand,
  second: JankenHand
): "first" | "second" | "draw" {
  if (first === second) return "draw";
  const beats: Record<JankenHand, JankenHand> = {
    rock: "scissors",
    scissors: "paper",
    paper: "rock",
  };
  return beats[first] === second ? "first" : "second";
}

function preGameDecisionChoice(
  label: string,
  preGameChoice: TrainingPreGameChoice
): TrainingDecisionChoice {
  return {
    choiceId: `${preGameChoice.kind}:${label}`,
    label,
    preGameChoice,
  };
}

type PreGameDecisionNodeBuilder = (
  state: GameState
) => TrainingDecisionNode | null;

function buildWaitingContractNode(
  state: GameState
): TrainingDecisionNode | null {
  const preGame = state.preGame;
  if (!preGame) return null;
  const playerId = Object.keys(preGame.contractCandidateCardNos ?? {}).find(
    (id) => preGame.contractPresentationChoices?.[id] === undefined
  );
  if (!playerId) return null;
  return {
    nodeId: `pregame:contract:${playerId}`,
    kind: "pregame",
    actingPlayerId: playerId,
    preGamePhase: preGame.phase,
    fields: [],
    choices: [
      preGameDecisionChoice("present", {
        kind: "contract_presentation",
        playerId,
        present: true,
      }),
      preGameDecisionChoice("skip", {
        kind: "contract_presentation",
        playerId,
        present: false,
      }),
    ],
    truncated: false,
  };
}

function buildContractConfirmNode(
  state: GameState
): TrainingDecisionNode | null {
  const preGame = state.preGame;
  if (!preGame) return null;
  const playerId = state.players
    .map((player) => player.id)
    .find((id) => preGame.contractConfirmed?.[id] !== true);
  if (!playerId) return null;
  return {
    nodeId: `pregame:contract-confirm:${playerId}`,
    kind: "pregame",
    actingPlayerId: playerId,
    preGamePhase: preGame.phase,
    fields: [],
    choices: [
      preGameDecisionChoice("confirm", { kind: "contract_confirm", playerId }),
    ],
    truncated: false,
  };
}

function buildJankenNode(state: GameState): TrainingDecisionNode | null {
  const preGame = state.preGame;
  if (!preGame) return null;
  const playerIds = state.players.map((player) => player.id);
  const playerId =
    preGame.phase === "janken_resolved"
      ? playerIds[0]
      : playerIds.find((id) => preGame.jankenHands[id] === undefined);
  if (!playerId) return null;
  return {
    nodeId: `pregame:janken:${playerId}:${preGame.jankenRound}`,
    kind: "pregame",
    actingPlayerId: playerId,
    preGamePhase: preGame.phase,
    fields: [],
    choices: (["rock", "scissors", "paper"] as const).map((hand) =>
      preGameDecisionChoice(hand, { kind: "janken", playerId, hand })
    ),
    truncated: false,
  };
}

function buildOrderPickNode(state: GameState): TrainingDecisionNode | null {
  const preGame = state.preGame;
  if (!preGame?.jankenWinner) return null;
  return {
    nodeId: `pregame:first-player:${preGame.jankenWinner}`,
    kind: "pregame",
    actingPlayerId: preGame.jankenWinner,
    preGamePhase: preGame.phase,
    fields: [],
    choices: state.players.map((player) =>
      preGameDecisionChoice(`first:${player.id}`, {
        kind: "first_player",
        playerId: preGame.jankenWinner!,
        firstPlayerId: player.id,
      })
    ),
    truncated: false,
  };
}

function buildMulliganNode(state: GameState): TrainingDecisionNode | null {
  const preGame = state.preGame;
  if (!preGame) return null;
  const firstPlayerId = preGame.firstPlayerId ?? state.playerOrder[0]!;
  const secondPlayerId = state.players.find((p) => p.id !== firstPlayerId)?.id;
  const playerId =
    preGame.mulliganDone[firstPlayerId] === undefined
      ? firstPlayerId
      : secondPlayerId && preGame.mulliganDone[secondPlayerId] === undefined
        ? secondPlayerId
        : undefined;
  if (!playerId) return null;
  return {
    nodeId: `pregame:mulligan:${playerId}`,
    kind: "pregame",
    actingPlayerId: playerId,
    preGamePhase: preGame.phase,
    fields: [],
    choices: [
      preGameDecisionChoice("keep", {
        kind: "mulligan",
        playerId,
        mulligan: false,
      }),
      preGameDecisionChoice("mulligan", {
        kind: "mulligan",
        playerId,
        mulligan: true,
      }),
    ],
    truncated: false,
  };
}

const PREGAME_DECISION_NODE_BUILDERS = {
  waiting_contract: buildWaitingContractNode,
  contract_confirm: buildContractConfirmNode,
  waiting_janken: buildJankenNode,
  janken_resolved: buildJankenNode,
  waiting_order_pick: buildOrderPickNode,
  order_decided: buildMulliganNode,
  waiting_mulligan_first: buildMulliganNode,
  waiting_mulligan_second: buildMulliganNode,
  pregame_complete: () => null,
} satisfies Record<PreGamePhase, PreGameDecisionNodeBuilder>;

export function getPreGameDecisionNode(
  state: GameState
): TrainingDecisionNode | null {
  const preGame = state.preGame;
  if (!preGame) return null;
  if (PLAYER_PREGAME_PHASE_DECISION_ROLES[preGame.phase] === "terminal") {
    return null;
  }
  return PREGAME_DECISION_NODE_BUILDERS[preGame.phase](state);
}

type PreGameChoiceApplier<K extends PlayerPreGameChoiceKind> = (
  state: GameState,
  choice: Extract<TrainingPreGameChoice, { kind: K }>,
  engine: Engine
) => GameState;

function applyContractPresentationChoice(
  state: GameState,
  choice: Extract<TrainingPreGameChoice, { kind: "contract_presentation" }>,
  engine: Engine
): GameState {
  const preGame = state.preGame;
  if (!preGame) return state;
  const contractPresentationChoices = {
    ...(preGame.contractPresentationChoices ?? {}),
    [choice.playerId]: choice.present,
  };
  const contractPlayers = Object.keys(preGame.contractCandidateCardNos ?? {});
  const allDone = contractPlayers.every(
    (id) => contractPresentationChoices[id] !== undefined
  );
  if (!allDone) {
    return {
      ...state,
      preGame: {
        ...preGame,
        contractPresentationChoices,
        phase: "waiting_contract",
      },
    };
  }
  const dealt = applyGameStartEffects(
    applyContractPresentationChoices(state, contractPresentationChoices),
    engine.getCardDefinitionById
  );
  return {
    ...dealt,
    preGame: {
      ...preGame,
      phase: "contract_confirm",
      contractPresentationChoices,
      contractConfirmed: preGame.contractConfirmed ?? {},
    },
  };
}

function applyContractConfirmChoice(
  state: GameState,
  choice: Extract<TrainingPreGameChoice, { kind: "contract_confirm" }>,
  _engine: Engine
): GameState {
  const preGame = state.preGame;
  if (!preGame) return state;
  const playerIds = state.players.map((player) => player.id);
  const contractConfirmed = {
    ...(preGame.contractConfirmed ?? {}),
    [choice.playerId]: true,
  };
  const allConfirmed = playerIds.every((id) => contractConfirmed[id] === true);
  return {
    ...state,
    preGame: {
      ...preGame,
      contractConfirmed,
      phase: allConfirmed ? "waiting_janken" : "contract_confirm",
    },
  };
}

function applyJankenChoice(
  state: GameState,
  choice: Extract<TrainingPreGameChoice, { kind: "janken" }>,
  _engine: Engine
): GameState {
  const preGame = state.preGame;
  if (!preGame) return state;
  const playerIds = state.players.map((player) => player.id);
  const freshHands =
    preGame.phase === "janken_resolved" ? {} : preGame.jankenHands;
  const jankenHands = { ...freshHands, [choice.playerId]: choice.hand };
  const firstHand = jankenHands[playerIds[0]!];
  const secondHand = jankenHands[playerIds[1]!];
  if (firstHand && secondHand) {
    const result = resolveJanken(firstHand, secondHand);
    if (result === "draw") {
      return {
        ...state,
        preGame: {
          ...preGame,
          phase: "janken_resolved",
          jankenHands,
          jankenRound: preGame.jankenRound + 1,
          jankenWinner: null,
        },
      };
    }
    return {
      ...state,
      preGame: {
        ...preGame,
        phase: "waiting_order_pick",
        jankenHands,
        jankenWinner: result === "first" ? playerIds[0]! : playerIds[1]!,
      },
    };
  }
  return {
    ...state,
    preGame: { ...preGame, phase: "waiting_janken", jankenHands },
  };
}

function applyFirstPlayerChoice(
  state: GameState,
  choice: Extract<TrainingPreGameChoice, { kind: "first_player" }>,
  _engine: Engine
): GameState {
  const preGame = state.preGame;
  if (!preGame) return state;
  const ordered = setFirstPlayer(state, choice.firstPlayerId);
  return {
    ...ordered,
    preGame: {
      ...preGame,
      phase: "order_decided",
      firstPlayerId: choice.firstPlayerId,
    },
  };
}

function applyMulliganChoice(
  state: GameState,
  choice: Extract<TrainingPreGameChoice, { kind: "mulligan" }>,
  engine: Engine
): GameState {
  const preGame = state.preGame;
  if (!preGame) return state;
  const afterMulligan = choice.mulligan
    ? mulliganHand(state, choice.playerId, engine.getCardDefinitionById)
    : state;
  const mulliganDone = {
    ...preGame.mulliganDone,
    [choice.playerId]: choice.mulligan,
  };
  const firstPlayerId = preGame.firstPlayerId ?? state.playerOrder[0]!;
  const secondPlayerId = state.players.find((p) => p.id !== firstPlayerId)?.id;
  const allDone =
    mulliganDone[firstPlayerId] !== undefined &&
    secondPlayerId !== undefined &&
    mulliganDone[secondPlayerId] !== undefined;
  if (allDone) {
    return { ...afterMulligan, preGame: null };
  }
  return {
    ...afterMulligan,
    preGame: {
      ...preGame,
      mulliganDone,
      phase:
        mulliganDone[firstPlayerId] !== undefined
          ? "waiting_mulligan_second"
          : "waiting_mulligan_first",
    },
  };
}

const PREGAME_CHOICE_APPLIERS = {
  contract_presentation: applyContractPresentationChoice,
  contract_confirm: applyContractConfirmChoice,
  janken: applyJankenChoice,
  first_player: applyFirstPlayerChoice,
  mulligan: applyMulliganChoice,
} satisfies {
  [K in PlayerPreGameChoiceKind]: PreGameChoiceApplier<K>;
};

type AnyPreGameChoiceApplier = (
  state: GameState,
  choice: TrainingPreGameChoice,
  engine: Engine
) => GameState;

export function applyPreGameChoice(
  state: GameState,
  choice: TrainingPreGameChoice,
  engine: Engine
): GameState {
  const applier = PREGAME_CHOICE_APPLIERS[
    choice.kind
  ] as AnyPreGameChoiceApplier;
  return applier(state, choice, engine);
}

function pendingTrainingActionById(
  state: GameState,
  engine: Engine,
  actionId: string
): LegalAction | undefined {
  const actors = [
    ...getCurrentActorPlayerIds(state, {
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }),
  ];
  if (actors.length === 0) actors.push(state.activePlayerId);
  for (const actingPlayerId of actors) {
    const action = getLegalActions({
      state,
      actingPlayerId,
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }).find((candidate) => candidate.can && candidate.actionId === actionId);
    if (action) return action;
  }
  return undefined;
}

function getNextTrainingDecisionInner(
  state: GameState,
  engine: Engine,
  opts: TrainingDecisionSurfaceOptions = {}
): TrainingDecisionNode | null {
  const multiPlacementDraft = trainingMultiPlacementDraftOf(state);
  if (multiPlacementDraft) {
    const pendingKind =
      state.pendingMultiPlacement?.pendingId === multiPlacementDraft.pendingId
        ? "resolve_pending_multi_placement"
        : state.pendingEnterFieldPlacement?.pendingId ===
            multiPlacementDraft.pendingId
          ? "resolve_pending_enter_field_placement"
          : null;
    const actingPlayerId =
      pendingKind === "resolve_pending_multi_placement"
        ? state.pendingMultiPlacement!.actingPlayerId
        : pendingKind === "resolve_pending_enter_field_placement"
          ? state.pendingEnterFieldPlacement!.actingPlayerId
          : state.activePlayerId;
    const action = getLegalActions({
      state,
      actingPlayerId,
      getCardDefinitionById: engine.getCardDefinitionById,
      ...engine.lookups,
    }).find(
      (
        candidate
      ): candidate is Extract<
        LegalAction,
        {
          kind:
            | "resolve_pending_multi_placement"
            | "resolve_pending_enter_field_placement";
        }
      > =>
        candidate.kind === pendingKind &&
        "pendingId" in candidate &&
        candidate.pendingId === multiPlacementDraft.pendingId &&
        candidate.can
    );
    if (!action) {
      throw new Error(
        "Training placement draft " +
          multiPlacementDraft.pendingId +
          " has no legal pending action"
      );
    }
    const inputNode = createActionInputDecisionNode(state, action, {
      ...opts,
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    if (!inputNode) {
      throw new Error(
        "Training placement draft " +
          multiPlacementDraft.pendingId +
          " has no input choices"
      );
    }
    return inputNode;
  }
  const reverseRebirthDraft = trainingReverseRebirthSummonDraftOf(state);
  if (reverseRebirthDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      reverseRebirthDraft.actionId
    );
    if (
      action?.kind !== "resolve_reverse_rebirth_summon" ||
      action.pendingId !== reverseRebirthDraft.pendingId
    ) {
      throw new Error(
        `Training reverse-rebirth draft ${reverseRebirthDraft.pendingId} has no legal pending action`
      );
    }
    const inputNode = factoredReverseRebirthSummonInputNode(state, action, {
      ...opts,
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    if (!inputNode) {
      throw new Error(
        `Training reverse-rebirth draft ${reverseRebirthDraft.pendingId} has no input choices`
      );
    }
    return inputNode;
  }
  const coreDistributionTargetTotalDraft =
    trainingCoreDistributionTargetTotalDraftOf(state);
  if (coreDistributionTargetTotalDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      coreDistributionTargetTotalDraft.actionId
    );
    if (action?.kind !== "resolve_pending_core_distribution") {
      throw new Error(
        `Training core-distribution target-total draft ${coreDistributionTargetTotalDraft.pendingId} has no legal pending action`
      );
    }
    const inputNode = factoredCoreDistributionTargetTotalInputNode(
      state,
      action,
      { ...opts, getCardDefinitionById: engine.getCardDefinitionById }
    );
    if (!inputNode) {
      throw new Error(
        `Training core-distribution target-total draft ${coreDistributionTargetTotalDraft.pendingId} has no input choices`
      );
    }
    return inputNode;
  }
  const coreDistributionSourceAllocationDraft =
    trainingCoreDistributionSourceAllocationDraftOf(state);
  if (coreDistributionSourceAllocationDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      coreDistributionSourceAllocationDraft.actionId
    );
    if (action?.kind !== "resolve_pending_core_distribution") {
      throw new Error(
        `Training core-distribution source-allocation draft ${coreDistributionSourceAllocationDraft.pendingId} has no legal pending action`
      );
    }
    const inputNode = factoredCoreDistributionSourceAllocationInputNode(
      state,
      action,
      { ...opts, getCardDefinitionById: engine.getCardDefinitionById }
    );
    // A completed disjoint multi-target source draft hands off to the
    // soul-target draft below.  Other source drafts must keep producing a
    // source decision until their action resolves.
    if (inputNode) return inputNode;
    if (
      !isFactoredDisjointMultiTargetCoreDistribution(action) ||
      coreDistributionSourceAllocationDraft.sourceCandidateIndex !==
        coreDistributionSourceKeys(action).length
    ) {
      throw new Error(
        `Training core-distribution source-allocation draft ${coreDistributionSourceAllocationDraft.pendingId} has no input choices`
      );
    }
    const soulTargetInput =
      factoredCoreDistributionSoulTargetAllocationInputNode(state, action);
    if (soulTargetInput) return soulTargetInput;
  }
  const coreDistributionSoulTargetAllocationDraft =
    trainingCoreDistributionSoulTargetAllocationDraftOf(state);
  if (coreDistributionSoulTargetAllocationDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      coreDistributionSoulTargetAllocationDraft.actionId
    );
    if (action?.kind !== "resolve_pending_core_distribution") {
      throw new Error(
        `Training core-distribution soul-target draft ${coreDistributionSoulTargetAllocationDraft.pendingId} has no legal pending action`
      );
    }
    const inputNode = factoredCoreDistributionSoulTargetAllocationInputNode(
      state,
      action
    );
    if (!inputNode) {
      throw new Error(
        `Training core-distribution soul-target draft ${coreDistributionSoulTargetAllocationDraft.pendingId} has no input choices`
      );
    }
    return inputNode;
  }
  const targetSelectionDraft = trainingTargetSelectionDraftOf(state);
  if (targetSelectionDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      targetSelectionDraft.actionId
    );
    if (!action) {
      throw new Error(
        `Training target-selection draft ${targetSelectionDraft.actionId} has no legal action`
      );
    }
    const inputNode = createActionInputDecisionNode(state, action, {
      ...opts,
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    if (!inputNode) {
      throw new Error(
        `Training target-selection draft ${targetSelectionDraft.actionId} has no input choices`
      );
    }
    return inputNode;
  }
  const variableZoneDiscountDraft = trainingVariableZoneDiscountDraftOf(state);
  if (variableZoneDiscountDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      variableZoneDiscountDraft.actionId
    );
    if (
      action?.kind !== "use_magic" ||
      action.costMode !== "zone_discount_variable"
    ) {
      throw new Error(
        `Training variable zone-discount draft ${variableZoneDiscountDraft.actionId} has no legal action`
      );
    }
    const inputNode = factoredVariableZoneDiscountInputNode(state, action, {
      ...opts,
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    if (!inputNode) {
      throw new Error(
        `Training variable zone-discount draft ${variableZoneDiscountDraft.actionId} has no input choices`
      );
    }
    return inputNode;
  }
  const summonCostExcludeDraft = trainingSummonCostExcludeDraftOf(state);
  if (summonCostExcludeDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      summonCostExcludeDraft.actionId
    );
    if (
      action?.kind !== "resolve_pending_summon_cost_exclude_choice" ||
      action.pendingId !== summonCostExcludeDraft.pendingId
    ) {
      throw new Error(
        `Training summon-cost-exclude draft ${summonCostExcludeDraft.pendingId} has no legal action`
      );
    }
    const inputNode = factoredSummonCostExcludeInputNode(state, action, {
      ...opts,
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    if (!inputNode) {
      throw new Error(
        `Training summon-cost-exclude draft ${summonCostExcludeDraft.pendingId} has no input choices`
      );
    }
    return inputNode;
  }
  const topLevelPaymentDraft = trainingTopLevelPaymentDraftOf(state);
  if (topLevelPaymentDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      topLevelPaymentDraft.actionId
    );
    if (action?.kind !== "summon" && action?.kind !== "place_nexus") {
      throw new Error(
        `Training top-level payment draft ${topLevelPaymentDraft.actionId} has no legal action`
      );
    }
    const inputNode = factoredTopLevelPaymentInputNode(state, action, {
      ...opts,
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    if (!inputNode) {
      throw new Error(
        `Training top-level payment draft ${topLevelPaymentDraft.actionId} has no input choices`
      );
    }
    return inputNode;
  }
  const zoneSelectionDraft = trainingZoneSelectionDraftOf(state);
  if (zoneSelectionDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      zoneSelectionDraft.actionId
    );
    if (action?.kind !== "resolve_pending_zone_selection") {
      throw new Error(
        `Training zone-selection draft ${zoneSelectionDraft.pendingId} has no legal pending action`
      );
    }
    const inputNode = factoredZoneSelectionInputNode(state, action);
    if (!inputNode) {
      throw new Error(
        `Training zone-selection draft ${zoneSelectionDraft.pendingId} has no input choices`
      );
    }
    return inputNode;
  }
  const deckRevealOrderDraft = trainingDeckRevealOrderDraftOf(state);
  if (deckRevealOrderDraft) {
    const action = pendingTrainingActionById(
      state,
      engine,
      deckRevealOrderDraft.actionId
    );
    if (action?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error(
        `Training deck-reveal order draft ${deckRevealOrderDraft.pendingId} has no legal pending action`
      );
    }
    const inputNode = factoredDeckRevealOrderInputNode(state, action);
    if (!inputNode) {
      throw new Error(
        `Training deck-reveal order draft ${deckRevealOrderDraft.pendingId} has no input choices`
      );
    }
    return inputNode;
  }
  const preGame = getPreGameDecisionNode(state);
  if (preGame) return preGame;
  return legalActionsForTraining(state, engine, opts);
}

function applyActionWithTrainingInput(
  state: GameState,
  action: LegalAction,
  applyOptions: TrainingActionInputOptions | undefined,
  engine: Engine
): GameState {
  const targetDraft = trainingTargetSelectionDraftOf(state);
  const completedTargetInput = fixedFactoredTargetInput(state, action);
  let actionState =
    targetDraft?.actionId === action.actionId
      ? withoutTrainingTargetSelectionDraft(state)
      : state;
  const topLevelPaymentDraft = trainingTopLevelPaymentDraftOf(actionState);
  if (topLevelPaymentDraft?.actionId === action.actionId) {
    actionState = withoutTrainingTopLevelPaymentDraft(actionState);
  }
  const variableZoneDiscountDraft =
    trainingVariableZoneDiscountDraftOf(actionState);
  if (variableZoneDiscountDraft?.actionId === action.actionId) {
    if (!variableZoneDiscountDraft.selectionComplete) {
      throw new Error(
        "Training variable zone-discount selection is not complete"
      );
    }
    const selected = applyOptions?.selectedZoneCardIds ?? [];
    if (
      selected.length !==
        variableZoneDiscountDraft.selectedZoneCardIds.length ||
      selected.some(
        (id, index) =>
          id !== variableZoneDiscountDraft.selectedZoneCardIds[index]
      )
    ) {
      throw new Error(
        "Training variable zone-discount payment does not match its selected cards"
      );
    }
    actionState = withoutTrainingVariableZoneDiscountDraft(actionState);
  }
  const summonCostExcludeDraft = trainingSummonCostExcludeDraftOf(actionState);
  if (summonCostExcludeDraft?.actionId === action.actionId) {
    if (!summonCostExcludeDraft.selectionComplete) {
      throw new Error("Training summon-cost-exclude selection is not complete");
    }
    const selected =
      applyOptions?.summonCostExcludeSelectedCardInstanceIds ?? [];
    if (
      selected.length !==
        summonCostExcludeDraft.selectedCardInstanceIds.length ||
      selected.some(
        (id, index) =>
          id !== summonCostExcludeDraft.selectedCardInstanceIds[index]
      )
    ) {
      throw new Error(
        "Training summon-cost-exclude payment does not match its selected cards"
      );
    }
    actionState = withoutTrainingSummonCostExcludeDraft(actionState);
  }
  return applyLegalAction({
    state: actionState,
    action,
    getCardDefinitionById: engine.getCardDefinitionById,
    ...engine.lookups,
    ...completedTargetInput,
    ...(applyOptions ?? {}),
  }).state;
}

function applyAdvanceStepSystemAction(
  state: GameState,
  _systemAction: Extract<TrainingSystemAction, { kind: "advance_step" }>,
  engine: Engine
): GameState {
  return advanceTraining(state, engine);
}

function applyManualCoreMoveSystemAction(
  state: GameState,
  systemAction: Extract<TrainingSystemAction, { kind: "manual_core_move" }>,
  engine: Engine
): GameState {
  if (!canOfferManualCoreMove(state, systemAction.actingPlayerId)) {
    throw new Error("Manual core move is not available in this state");
  }
  const violation = findManualCoreMoveViolation(
    state,
    systemAction.drafts,
    engine.getCardDefinitionById
  );
  if (violation) {
    throw new Error(`Manual core move is invalid: ${violation.reason}`);
  }
  if (
    !isValidManualCoreMove(
      state,
      systemAction.drafts,
      systemAction.actingPlayerId,
      engine
    )
  ) {
    throw new Error("Manual core move is not useful for training");
  }

  let nextState = applyDraftCoreMoves(
    state,
    systemAction.drafts,
    engine.getCardDefinitionById
  );
  nextState = {
    ...nextState,
    log: [
      ...nextState.log,
      manualCoreMovePositionSignature(state, systemAction.actingPlayerId),
      manualCoreMovePositionSignature(nextState, systemAction.actingPlayerId),
    ],
  };
  if ("trainingFactored" in systemAction && systemAction.trainingFactored) {
    return {
      ...nextState,
      log: [
        ...nextState.log,
        factoredManualCoreDraftMarker("active", systemAction.actingPlayerId),
      ],
    };
  }
  const sbaResult = runStateBasedActions(
    nextState,
    engine.getCardDefinitionById
  );
  nextState =
    sbaResult.checks.length > 0 ||
    sbaResult.state.pendingLeaveEntities.length > 0
      ? flushPendingLeaves(sbaResult.state, engine.getCardDefinitionById)
      : sbaResult.state;
  return recomputeAndRebuildContinuousEffects(
    nextState,
    engine.getCardDefinitionById
  );
}

function applyCommitFactoredManualCoreMoveSystemAction(
  state: GameState,
  systemAction: Extract<
    TrainingSystemAction,
    { kind: "commit_factored_manual_core_move" }
  >,
  engine: Engine
): GameState {
  if (!hasActiveFactoredManualCoreDraft(state, systemAction.actingPlayerId)) {
    throw new Error("Factored manual core move has no active draft");
  }
  const sbaResult = runStateBasedActions(state, engine.getCardDefinitionById);
  const nextState =
    sbaResult.checks.length > 0 ||
    sbaResult.state.pendingLeaveEntities.length > 0
      ? flushPendingLeaves(sbaResult.state, engine.getCardDefinitionById)
      : sbaResult.state;
  return recomputeAndRebuildContinuousEffects(
    {
      ...nextState,
      log: [
        ...nextState.log,
        factoredManualCoreDraftMarker("committed", systemAction.actingPlayerId),
      ],
    },
    engine.getCardDefinitionById
  );
}

function applyTrainingMultiPlacementSourceAction(
  state: GameState,
  systemAction: Extract<
    TrainingSystemAction,
    { kind: "select_multi_placement_source" }
  >,
  engine: Engine
): GameState {
  const action = systemAction.action;
  const pendingId =
    action.kind === "resolve_pending_multi_placement"
      ? state.pendingMultiPlacement?.pendingId
      : state.pendingEnterFieldPlacement?.pendingId;
  if (pendingId !== action.pendingId) {
    throw new Error(
      "Training placement source action has no matching pending placement"
    );
  }
  const draft = trainingMultiPlacementDraftOf(state);
  if (draft && draft.pendingId !== action.pendingId) {
    throw new Error("Training placement draft does not match its action");
  }
  const expectedSourceIndex = draft?.sourceIndex ?? 0;
  if (systemAction.sourceIndex !== expectedSourceIndex) {
    throw new Error(
      "Training placement source index mismatch: expected=" +
        expectedSourceIndex +
        " actual=" +
        systemAction.sourceIndex
    );
  }
  const spec = placementFactoringSpec(state, action, {
    getCardDefinitionById: engine.getCardDefinitionById,
  });
  if (!spec) {
    throw new Error("Training placement factoring is not available");
  }
  const expectedSource = spec.sources[expectedSourceIndex];
  if (
    !expectedSource ||
    expectedSource.kind !== systemAction.source.kind ||
    expectedSource.instanceId !== systemAction.source.instanceId ||
    expectedSource.normalCap !== systemAction.source.normalCap ||
    expectedSource.soulCap !== systemAction.source.soulCap
  ) {
    throw new Error("Training placement source is no longer available");
  }
  if (
    !Number.isInteger(systemAction.normalAmount) ||
    !Number.isInteger(systemAction.soulAmount) ||
    systemAction.normalAmount < 0 ||
    systemAction.soulAmount < 0 ||
    systemAction.normalAmount > expectedSource.normalCap ||
    systemAction.soulAmount > expectedSource.soulCap ||
    systemAction.normalAmount + systemAction.soulAmount >
      (expectedSource.totalCap ?? Infinity)
  ) {
    throw new Error("Training placement source amount is invalid");
  }

  const existingPlacements = draft?.placements ?? [];
  const selectedTotal =
    getPlacedCoreCount(existingPlacements) +
    systemAction.normalAmount +
    systemAction.soulAmount;
  if (selectedTotal > spec.maximumCoreCount) {
    throw new Error(
      "Training placement selection exceeds maximum: max=" +
        spec.maximumCoreCount +
        " selected=" +
        selectedTotal
    );
  }
  const placements = [
    ...existingPlacements,
    ...placementFromTrainingSource(
      expectedSource,
      systemAction.normalAmount,
      systemAction.soulAmount
    ),
  ];

  if (expectedSourceIndex < spec.sources.length - 1) {
    return withTrainingMultiPlacementDraft(state, {
      pendingId: action.pendingId,
      sourceIndex: expectedSourceIndex + 1,
      placements,
    });
  }
  if (getPlacedCoreCount(placements) < spec.minimumCoreCount) {
    throw new Error(
      "Training placement selection is below minimum: required=" +
        spec.minimumCoreCount
    );
  }
  const applyOptions: TrainingActionInputOptions =
    action.kind === "resolve_pending_multi_placement"
      ? {
          multiPlacementAllocations: [
            {
              destinationInstanceId: spec.destinationInstanceId!,
              placements,
            },
          ],
        }
      : { enterFieldCorePlacements: placements };
  return applyActionWithTrainingInput(
    withoutTrainingMultiPlacementDraft(state),
    action,
    applyOptions,
    engine
  );
}

function applyFactoredTargetSelectionAction(
  state: GameState,
  systemAction: FactoredOrdinaryTargetSelectionSystemAction
): GameState {
  const action = systemAction.action;
  const draft = trainingTargetSelectionDraftOf(state);
  if (draft && draft.actionId !== action.actionId) {
    throw new Error(
      "Training target-selection draft does not match its action"
    );
  }
  if (draft?.complete) {
    throw new Error("Training target-selection draft is already complete");
  }
  const targetGroups = targetGroupsValue(actionRecord(action));
  if (targetGroups.length > 0) {
    const seen = new Set<string>();
    for (const group of targetGroups) {
      for (const id of group.candidateTargetInstanceIds) {
        if (seen.has(id)) {
          throw new Error(
            "Factored target groups must have disjoint candidates"
          );
        }
        seen.add(id);
      }
    }
    const targetGroupIndex = nextFactoredTargetGroupIndex(
      targetGroups,
      draft?.targetGroupIndex ?? 0
    );
    if (systemAction.targetGroupIndex !== targetGroupIndex) {
      throw new Error(
        `Training target-selection group mismatch: expected=${targetGroupIndex} actual=${systemAction.targetGroupIndex}`
      );
    }
    const targetGroup = targetGroups[targetGroupIndex];
    if (!targetGroup) {
      throw new Error("Training target-selection group is unavailable");
    }
    const candidateTargetInstanceIds = targetGroup.candidateTargetInstanceIds;
    const candidateIndex = draft?.candidateIndex ?? 0;
    if (systemAction.candidateIndex !== candidateIndex) {
      throw new Error(
        `Training target-selection index mismatch: expected=${candidateIndex} actual=${systemAction.candidateIndex}`
      );
    }
    const candidateId = candidateTargetInstanceIds[candidateIndex];
    if (!candidateId) {
      throw new Error("Training target-selection candidate is unavailable");
    }
    const selectedTargetInstanceIds = draft?.selectedTargetInstanceIds ?? [];
    const selectedInGroup = selectedTargetInstanceIds.filter((id) =>
      candidateTargetInstanceIds.includes(id)
    ).length;
    const maxTargetCount =
      targetGroup.maxTargetCount ?? targetGroup.requiredTargetCount;
    if (systemAction.select && selectedInGroup >= maxTargetCount) {
      throw new Error("Training target-selection exceeds maximum");
    }
    const nextSelected = systemAction.select
      ? [...selectedTargetInstanceIds, candidateId]
      : [...selectedTargetInstanceIds];
    const nextIndex = candidateIndex + 1;
    const nextSelectedInGroup = selectedInGroup + (systemAction.select ? 1 : 0);
    if (
      nextIndex === candidateTargetInstanceIds.length &&
      nextSelectedInGroup < targetGroup.requiredTargetCount
    ) {
      throw new Error("Training target-selection does not satisfy its minimum");
    }
    const nextTargetGroupIndex = nextFactoredTargetGroupIndex(
      targetGroups,
      nextIndex === candidateTargetInstanceIds.length
        ? targetGroupIndex + 1
        : targetGroupIndex
    );
    return withTrainingTargetSelectionDraft(state, {
      actionId: action.actionId,
      ...(nextTargetGroupIndex < targetGroups.length
        ? { targetGroupIndex: nextTargetGroupIndex }
        : { targetGroupIndex }),
      candidateIndex: nextTargetGroupIndex === targetGroupIndex ? nextIndex : 0,
      selectedTargetInstanceIds: nextSelected,
      complete: nextTargetGroupIndex === targetGroups.length,
    });
  }
  const candidateTargetInstanceIds = stringArrayValue(
    actionRecord(action),
    "candidateTargetInstanceIds"
  );
  const candidateIndex = draft?.candidateIndex ?? 0;
  if (systemAction.candidateIndex !== candidateIndex) {
    throw new Error(
      `Training target-selection index mismatch: expected=${candidateIndex} actual=${systemAction.candidateIndex}`
    );
  }
  const candidateId = candidateTargetInstanceIds[candidateIndex];
  if (!candidateId) {
    throw new Error("Training target-selection candidate is unavailable");
  }
  const selectedTargetInstanceIds = draft?.selectedTargetInstanceIds ?? [];
  const requiredTargetCount =
    numberValue(actionRecord(action), "requiredTargetCount") ?? 0;
  const maxTargetCount =
    numberValue(actionRecord(action), "maxTargetCount") ?? requiredTargetCount;
  if (
    systemAction.select &&
    selectedTargetInstanceIds.length >= maxTargetCount
  ) {
    throw new Error("Training target-selection exceeds maximum");
  }
  const nextSelected = systemAction.select
    ? [...selectedTargetInstanceIds, candidateId]
    : [...selectedTargetInstanceIds];
  const nextIndex = candidateIndex + 1;
  if (
    nextIndex === candidateTargetInstanceIds.length &&
    nextSelected.length < requiredTargetCount
  ) {
    throw new Error("Training target-selection does not satisfy its minimum");
  }
  return withTrainingTargetSelectionDraft(state, {
    actionId: action.actionId,
    candidateIndex: nextIndex,
    selectedTargetInstanceIds: nextSelected,
    complete: nextIndex === candidateTargetInstanceIds.length,
  });
}

function applyFactoredCoreDistributionTargetTotalAction(
  state: GameState,
  systemAction: FactoredCoreDistributionTargetTotalSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  if (
    !action.targetTotalSelection ||
    action.targetTotalSelection.fixedTargetTotals !== undefined ||
    (!hasDisjointCoreDistributionSources(action) &&
      !canFactorOverlappingCoreDistributionTargetTotals(action))
  ) {
    throw new Error(
      "Factored core-distribution target total requires a supported first-stage action"
    );
  }
  const draft = trainingCoreDistributionTargetTotalDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training core-distribution target-total draft does not match the pending action"
    );
  }
  const bounds = getCoreDistributionTargetTotalBounds(state, action);
  const candidateIndex = draft?.candidateIndex ?? 0;
  if (systemAction.candidateIndex !== candidateIndex) {
    throw new Error(
      `Training core-distribution target-total index mismatch: expected=${candidateIndex} actual=${systemAction.candidateIndex}`
    );
  }
  const candidateId = bounds.candidateIds[candidateIndex];
  if (!candidateId) {
    throw new Error("Training core-distribution target total is unavailable");
  }
  const minimum = bounds.minimumTotals[candidateId] ?? 0;
  const maximum = bounds.maximumTotals[candidateId] ?? 0;
  if (
    !Number.isInteger(systemAction.targetTotal) ||
    systemAction.targetTotal < minimum ||
    systemAction.targetTotal > maximum
  ) {
    throw new Error("Training core-distribution target total is out of bounds");
  }
  const selectedTotals = {
    ...(draft?.selectedTotals ?? {}),
    [candidateId]: systemAction.targetTotal,
  };
  const nextIndex = candidateIndex + 1;
  if (
    !hasReachableFactoredCoreDistributionTargetTotal(
      state,
      action,
      bounds,
      selectedTotals,
      nextIndex,
      DEFAULT_MAX_GENERATED_CHOICES
    )
  ) {
    throw new Error(
      "Training core-distribution target total cannot reach a physical allocation"
    );
  }
  if (nextIndex < bounds.candidateIds.length) {
    return withTrainingCoreDistributionTargetTotalDraft(state, {
      pendingId: action.pendingId,
      actionId: action.actionId,
      candidateIndex: nextIndex,
      selectedTotals,
    });
  }
  const finalTotals = Object.fromEntries(
    Object.entries(selectedTotals).filter(([, amount]) => amount > 0)
  ) as Record<string, number>;
  return applyActionWithTrainingInput(
    withoutTrainingCoreDistributionTargetTotalDraft(state),
    action,
    { coreDistributionAllocations: finalTotals },
    engine
  );
}

function applyFactoredCoreDistributionSourceAllocationAction(
  state: GameState,
  systemAction: FactoredCoreDistributionSourceAllocationSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  const factoredDisjointMultiTarget =
    isFactoredDisjointMultiTargetCoreDistribution(action);
  if (
    !factoredDisjointMultiTarget &&
    !isFactoredSingleTargetCoreDistribution(action)
  ) {
    throw new Error(
      "Factored core-distribution source allocation requires one supported target"
    );
  }
  const existingDraft = trainingCoreDistributionSourceAllocationDraftOf(state);
  if (
    existingDraft &&
    (existingDraft.pendingId !== action.pendingId ||
      existingDraft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training core-distribution source-allocation draft does not match the pending action"
    );
  }
  const draft =
    existingDraft ??
    ({
      pendingId: action.pendingId,
      actionId: action.actionId,
      sourceCandidateIndex: 0,
      normalAllocations: {},
      soulAllocations: {},
    } satisfies TrainingCoreDistributionSourceAllocationDraft);
  if (
    systemAction.coreDistributionSourceCandidateIndex !==
    draft.sourceCandidateIndex
  ) {
    throw new Error(
      `Training core-distribution source index mismatch: expected=${draft.sourceCandidateIndex} actual=${systemAction.coreDistributionSourceCandidateIndex}`
    );
  }
  const sourceKeys = coreDistributionSourceKeys(action);
  const sourceKey = sourceKeys[draft.sourceCandidateIndex];
  if (!sourceKey) {
    throw new Error("Training core-distribution source is unavailable");
  }
  const normalCap = action.sourceAvailable?.[sourceKey] ?? 0;
  const soulCap = action.soulSourceAvailable?.[sourceKey] ?? 0;
  const combinedCap = action.sourceTotalAvailable?.[sourceKey];
  if (
    !Number.isInteger(systemAction.normalAmount) ||
    !Number.isInteger(systemAction.soulAmount) ||
    systemAction.normalAmount < 0 ||
    systemAction.soulAmount < 0 ||
    systemAction.normalAmount > normalCap ||
    systemAction.soulAmount > soulCap ||
    (combinedCap !== undefined &&
      systemAction.normalAmount + systemAction.soulAmount > combinedCap)
  ) {
    throw new Error("Training core-distribution source allocation is invalid");
  }
  const normalAllocations =
    systemAction.normalAmount > 0
      ? {
          ...draft.normalAllocations,
          [sourceKey]: systemAction.normalAmount,
        }
      : { ...draft.normalAllocations };
  const soulAllocations =
    systemAction.soulAmount > 0
      ? { ...draft.soulAllocations, [sourceKey]: systemAction.soulAmount }
      : { ...draft.soulAllocations };
  const nextSourceCandidateIndex = draft.sourceCandidateIndex + 1;
  if (
    !(factoredDisjointMultiTarget
      ? hasReachableFactoredDisjointCoreDistributionSourceAllocation(
          state,
          action,
          sourceKeys,
          nextSourceCandidateIndex,
          normalAllocations,
          soulAllocations,
          new Map<string, boolean>()
        )
      : hasReachableFactoredSingleTargetCoreDistributionSourceAllocation(
          state,
          action,
          sourceKeys,
          nextSourceCandidateIndex,
          normalAllocations,
          soulAllocations,
          new Map<string, boolean>()
        ))
  ) {
    throw new Error(
      "Training core-distribution source allocation cannot complete"
    );
  }
  if (nextSourceCandidateIndex < sourceKeys.length) {
    return withTrainingCoreDistributionSourceAllocationDraft(state, {
      pendingId: action.pendingId,
      actionId: action.actionId,
      sourceCandidateIndex: nextSourceCandidateIndex,
      normalAllocations,
      soulAllocations,
    });
  }
  if (factoredDisjointMultiTarget) {
    const soulTotal = allocationTotal(soulAllocations);
    if (soulTotal > 0) {
      return withTrainingCoreDistributionSourceAllocationDraft(state, {
        pendingId: action.pendingId,
        actionId: action.actionId,
        sourceCandidateIndex: nextSourceCandidateIndex,
        normalAllocations,
        soulAllocations,
      });
    }
    const completion = completeFactoredDisjointCoreDistribution(
      state,
      action,
      normalAllocations,
      soulAllocations,
      {}
    );
    if (!completion) {
      throw new Error(
        "Training factored disjoint core-distribution source allocation is incomplete"
      );
    }
    return applyActionWithTrainingInput(
      withoutTrainingCoreDistributionSourceAllocationDraft(state),
      action,
      completion,
      engine
    );
  }
  const completion = singleTargetCoreDistributionSourceCompletion(
    state,
    action,
    normalAllocations,
    soulAllocations
  );
  if (!completion) {
    throw new Error(
      "Training core-distribution source allocation is incomplete"
    );
  }
  return applyActionWithTrainingInput(
    withoutTrainingCoreDistributionSourceAllocationDraft(state),
    action,
    completion,
    engine
  );
}

function applyFactoredCoreDistributionSoulTargetAllocationAction(
  state: GameState,
  systemAction: FactoredCoreDistributionSoulTargetAllocationSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  if (!isFactoredDisjointMultiTargetCoreDistribution(action)) {
    throw new Error(
      "Factored core-distribution soul target requires fixed disjoint multi-target totals"
    );
  }
  const sourceDraft = trainingCoreDistributionSourceAllocationDraftOf(state);
  if (
    !sourceDraft ||
    sourceDraft.pendingId !== action.pendingId ||
    sourceDraft.actionId !== action.actionId ||
    sourceDraft.sourceCandidateIndex !==
      coreDistributionSourceKeys(action).length
  ) {
    throw new Error(
      "Factored core-distribution soul target has no completed source allocation"
    );
  }
  const sourceSoulTotal = allocationTotal(sourceDraft.soulAllocations);
  if (sourceSoulTotal <= 0) {
    throw new Error(
      "Factored core-distribution soul target requires a selected soul-core source"
    );
  }
  const existingDraft =
    trainingCoreDistributionSoulTargetAllocationDraftOf(state);
  if (
    existingDraft &&
    (existingDraft.pendingId !== action.pendingId ||
      existingDraft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training core-distribution soul-target draft does not match the pending action"
    );
  }
  const draft =
    existingDraft ??
    ({
      pendingId: action.pendingId,
      actionId: action.actionId,
      targetCandidateIndex: 0,
      soulAllocations: {},
    } satisfies TrainingCoreDistributionSoulTargetAllocationDraft);
  if (
    systemAction.coreDistributionSoulTargetCandidateIndex !==
    draft.targetCandidateIndex
  ) {
    throw new Error(
      `Training core-distribution soul target index mismatch: expected=${draft.targetCandidateIndex} actual=${systemAction.coreDistributionSoulTargetCandidateIndex}`
    );
  }
  const candidate = action.candidates[draft.targetCandidateIndex];
  const incomingTotals = fixedDisjointCoreDistributionIncomingTotals(
    state,
    action
  );
  if (!candidate || !incomingTotals) {
    throw new Error("Training core-distribution soul target is unavailable");
  }
  const selectedSoulTotal = allocationTotal(draft.soulAllocations);
  const maximum = Math.min(
    incomingTotals[candidate.instanceId] ?? 0,
    sourceSoulTotal - selectedSoulTotal
  );
  if (
    !Number.isInteger(systemAction.soulAmount) ||
    systemAction.soulAmount < 0 ||
    systemAction.soulAmount > maximum
  ) {
    throw new Error(
      "Training core-distribution soul target allocation is invalid"
    );
  }
  const soulAllocations =
    systemAction.soulAmount > 0
      ? {
          ...draft.soulAllocations,
          [candidate.instanceId]: systemAction.soulAmount,
        }
      : { ...draft.soulAllocations };
  const nextTargetCandidateIndex = draft.targetCandidateIndex + 1;
  const selectedAfterThis = allocationTotal(soulAllocations);
  const remainingCapacity = action.candidates
    .slice(nextTargetCandidateIndex)
    .reduce((sum, next) => sum + (incomingTotals[next.instanceId] ?? 0), 0);
  if (
    selectedAfterThis > sourceSoulTotal ||
    selectedAfterThis + remainingCapacity < sourceSoulTotal
  ) {
    throw new Error("Training core-distribution soul target cannot complete");
  }
  if (nextTargetCandidateIndex < action.candidates.length) {
    return withTrainingCoreDistributionSoulTargetAllocationDraft(state, {
      pendingId: action.pendingId,
      actionId: action.actionId,
      targetCandidateIndex: nextTargetCandidateIndex,
      soulAllocations,
    });
  }
  const completion = completeFactoredDisjointCoreDistribution(
    state,
    action,
    sourceDraft.normalAllocations,
    sourceDraft.soulAllocations,
    soulAllocations
  );
  if (!completion) {
    throw new Error(
      "Training core-distribution soul target allocation is incomplete"
    );
  }
  return applyActionWithTrainingInput(
    withoutTrainingCoreDistributionSoulTargetAllocationDraft(
      withoutTrainingCoreDistributionSourceAllocationDraft(state)
    ),
    action,
    completion,
    engine
  );
}

function applyFactoredVariableZoneDiscountSelectionAction(
  state: GameState,
  systemAction: FactoredZoneSelectionSystemAction
): GameState {
  const action = systemAction.action;
  if (
    action.kind !== "use_magic" ||
    action.costMode !== "zone_discount_variable"
  ) {
    throw new Error("Expected a variable zone-discount magic action");
  }
  const draft = trainingVariableZoneDiscountDraftOf(state);
  if (draft && draft.actionId !== action.actionId) {
    throw new Error(
      "Training variable zone-discount draft does not match its action"
    );
  }
  if (draft?.selectionComplete) {
    throw new Error(
      "Training variable zone-discount selection is already complete"
    );
  }
  const candidateIds = action.zoneCostPaymentCandidateIds ?? [];
  const maxCount = action.zoneCostPaymentMaxCount ?? 0;
  const candidateIndex = draft?.candidateIndex ?? 0;
  if (systemAction.candidateIndex !== candidateIndex) {
    throw new Error(
      `Training variable zone-discount index mismatch: expected=${candidateIndex} actual=${systemAction.candidateIndex}`
    );
  }
  const candidateId = candidateIds[candidateIndex];
  if (!candidateId) {
    throw new Error("Training variable zone-discount candidate is unavailable");
  }
  const selectedZoneCardIds = draft?.selectedZoneCardIds ?? [];
  if (systemAction.select && selectedZoneCardIds.length >= maxCount) {
    throw new Error("Training variable zone-discount exceeds maximum");
  }
  const nextSelected = systemAction.select
    ? [...selectedZoneCardIds, candidateId]
    : [...selectedZoneCardIds];
  const nextIndex = candidateIndex + 1;
  return withTrainingVariableZoneDiscountDraft(state, {
    actionId: action.actionId,
    candidateIndex: nextIndex,
    selectedZoneCardIds: nextSelected,
    selectionComplete: nextIndex === candidateIds.length,
  });
}

function applyFactoredVariableZoneDiscountPaymentAction(
  state: GameState,
  systemAction: FactoredVariableZoneDiscountPaymentSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  if (action.costMode !== "zone_discount_variable") {
    throw new Error(
      "Factored variable payment requires a variable zone-discount magic"
    );
  }
  const draft = trainingVariableZoneDiscountDraftOf(state);
  if (
    !draft ||
    draft.actionId !== action.actionId ||
    !draft.selectionComplete
  ) {
    throw new Error(
      "Training variable zone-discount payment has no complete draft"
    );
  }
  const paymentRequest = variableZoneDiscountMagicPaymentRequest(
    state,
    action,
    draft.selectedZoneCardIds
  );
  if (!paymentRequest) {
    throw new Error(
      "Training variable zone-discount payment has invalid metadata"
    );
  }
  const sources = paymentSourcesForTraining(paymentRequest);
  const paymentCandidateIndex = draft.paymentCandidateIndex ?? 0;
  if (systemAction.paymentCandidateIndex !== paymentCandidateIndex) {
    throw new Error(
      `Training variable payment index mismatch: expected=${paymentCandidateIndex} actual=${systemAction.paymentCandidateIndex}`
    );
  }
  const source = sources[paymentCandidateIndex];
  if (!source) {
    throw new Error("Training variable payment source is unavailable");
  }
  const selectedPaymentSources = draft.selectedPaymentSources ?? [];
  const remainingCost =
    paymentRequest.requiredCost -
    paymentSourcesTotalAmount(selectedPaymentSources);
  if (
    !paymentSourceAllocationOptions(source, remainingCost).some((candidate) =>
      samePaymentSource(candidate, systemAction.paymentSource)
    )
  ) {
    throw new Error("Training variable payment source allocation is invalid");
  }
  const nextSelected = systemAction.paymentSource
    ? [...selectedPaymentSources, systemAction.paymentSource]
    : [...selectedPaymentSources];
  const nextCandidateIndex = paymentCandidateIndex + 1;
  if (
    !hasReachableFactoredPaymentSourceAllocation(
      sources,
      paymentRequest.requiredCost,
      nextSelected,
      nextCandidateIndex
    )
  ) {
    throw new Error(
      "Training variable payment allocation cannot reach its cost"
    );
  }
  if (nextCandidateIndex < sources.length) {
    return withTrainingVariableZoneDiscountDraft(state, {
      ...draft,
      paymentCandidateIndex: nextCandidateIndex,
      selectedPaymentSources: nextSelected,
    });
  }
  if (paymentSourcesTotalAmount(nextSelected) !== paymentRequest.requiredCost) {
    throw new Error(
      "Training variable payment allocation does not pay its cost"
    );
  }
  return applyActionWithTrainingInput(
    state,
    action,
    {
      selectedZoneCardIds: [...draft.selectedZoneCardIds],
      paymentSources: nextSelected,
    },
    engine
  );
}

function applyFactoredSummonCostExcludeSelectionAction(
  state: GameState,
  systemAction: FactoredSummonCostExcludeSelectionSystemAction
): GameState {
  const action = systemAction.action;
  const draft = trainingSummonCostExcludeDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training summon-cost-exclude draft does not match its action"
    );
  }
  if (draft?.selectionComplete) {
    throw new Error(
      "Training summon-cost-exclude selection is already complete"
    );
  }
  const candidateIndex = draft?.candidateIndex ?? 0;
  if (systemAction.candidateIndex !== candidateIndex) {
    throw new Error(
      `Training summon-cost-exclude index mismatch: expected=${candidateIndex} actual=${systemAction.candidateIndex}`
    );
  }
  const candidateId = action.candidateCardInstanceIds[candidateIndex];
  if (!candidateId) {
    throw new Error("Training summon-cost-exclude candidate is unavailable");
  }
  const selectedCardInstanceIds = draft?.selectedCardInstanceIds ?? [];
  if (
    systemAction.select &&
    selectedCardInstanceIds.length >= action.maxCount
  ) {
    throw new Error("Training summon-cost-exclude exceeds maximum");
  }
  const nextSelected = systemAction.select
    ? [...selectedCardInstanceIds, candidateId]
    : [...selectedCardInstanceIds];
  const nextIndex = candidateIndex + 1;
  return withTrainingSummonCostExcludeDraft(state, {
    pendingId: action.pendingId,
    actionId: action.actionId,
    candidateIndex: nextIndex,
    selectedCardInstanceIds: nextSelected,
    selectionComplete: nextIndex === action.candidateCardInstanceIds.length,
  });
}

function applyFactoredSummonCostExcludePaymentAction(
  state: GameState,
  systemAction: FactoredSummonCostExcludePaymentSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  const draft = trainingSummonCostExcludeDraftOf(state);
  if (
    !draft ||
    draft.pendingId !== action.pendingId ||
    draft.actionId !== action.actionId ||
    !draft.selectionComplete
  ) {
    throw new Error(
      "Training summon-cost-exclude payment has no complete draft"
    );
  }
  const request = summonCostExcludePaymentRequest(
    state,
    action,
    draft.selectedCardInstanceIds
  );
  const sources = paymentSourcesForTraining(request);
  const paymentCandidateIndex = draft.paymentCandidateIndex ?? 0;
  if (
    systemAction.summonCostExcludePaymentCandidateIndex !==
    paymentCandidateIndex
  ) {
    throw new Error(
      `Training summon-cost-exclude payment index mismatch: expected=${paymentCandidateIndex} actual=${systemAction.summonCostExcludePaymentCandidateIndex}`
    );
  }
  const source = sources[paymentCandidateIndex];
  if (!source) {
    throw new Error(
      "Training summon-cost-exclude payment source is unavailable"
    );
  }
  const selectedPaymentSources = draft.selectedPaymentSources ?? [];
  const remainingCost =
    request.requiredCost - paymentSourcesTotalAmount(selectedPaymentSources);
  if (
    !paymentSourceAllocationOptions(source, remainingCost).some((candidate) =>
      samePaymentSource(candidate, systemAction.paymentSource)
    )
  ) {
    throw new Error("Training summon-cost-exclude payment source is invalid");
  }
  const nextSelected = systemAction.paymentSource
    ? [...selectedPaymentSources, systemAction.paymentSource]
    : [...selectedPaymentSources];
  const nextCandidateIndex = paymentCandidateIndex + 1;
  if (
    !hasReachableFactoredPaymentSourceAllocation(
      sources,
      request.requiredCost,
      nextSelected,
      nextCandidateIndex
    )
  ) {
    throw new Error(
      "Training summon-cost-exclude payment allocation cannot reach its cost"
    );
  }
  if (nextCandidateIndex < sources.length) {
    return withTrainingSummonCostExcludeDraft(state, {
      ...draft,
      paymentCandidateIndex: nextCandidateIndex,
      selectedPaymentSources: nextSelected,
    });
  }
  if (paymentSourcesTotalAmount(nextSelected) !== request.requiredCost) {
    throw new Error(
      "Training summon-cost-exclude payment does not pay its cost"
    );
  }
  return applyActionWithTrainingInput(
    state,
    action,
    {
      summonCostExcludeSelectedCardInstanceIds: [
        ...draft.selectedCardInstanceIds,
      ],
      paymentSources: nextSelected,
    },
    engine
  );
}

function applyFactoredTopLevelPaymentAction(
  state: GameState,
  systemAction: FactoredTopLevelPaymentSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  const existingDraft = trainingTopLevelPaymentDraftOf(state);
  if (existingDraft && existingDraft.actionId !== action.actionId) {
    throw new Error("Training top-level payment has no matching draft");
  }
  const draft =
    existingDraft ??
    ({
      actionId: action.actionId,
      paymentCandidateIndex: 0,
      selectedPaymentSources: [],
    } satisfies TrainingTopLevelPaymentDraft);
  const request = topLevelPaymentRequest(state, action);
  if (!request) {
    throw new Error("Training top-level payment has invalid metadata");
  }
  const sources = paymentSourcesForTraining(request);
  if (
    systemAction.topLevelPaymentCandidateIndex !== draft.paymentCandidateIndex
  ) {
    throw new Error(
      `Training top-level payment index mismatch: expected=${draft.paymentCandidateIndex} actual=${systemAction.topLevelPaymentCandidateIndex}`
    );
  }
  const source = sources[draft.paymentCandidateIndex];
  if (!source) {
    throw new Error("Training top-level payment source is unavailable");
  }
  const remainingCost =
    request.requiredCost -
    paymentSourcesTotalAmount(draft.selectedPaymentSources);
  if (
    !paymentSourceAllocationOptions(source, remainingCost).some((candidate) =>
      samePaymentSource(candidate, systemAction.paymentSource)
    )
  ) {
    throw new Error("Training top-level payment source allocation is invalid");
  }
  const nextSelected = systemAction.paymentSource
    ? [...draft.selectedPaymentSources, systemAction.paymentSource]
    : [...draft.selectedPaymentSources];
  const nextCandidateIndex = draft.paymentCandidateIndex + 1;
  if (
    !hasReachableFactoredTopLevelPaymentSourceAllocation(
      state,
      action,
      sources,
      request.requiredCost,
      nextSelected,
      nextCandidateIndex,
      engine.getCardDefinitionById
    )
  ) {
    throw new Error("Training top-level payment allocation cannot complete");
  }
  if (nextCandidateIndex < sources.length) {
    return withTrainingTopLevelPaymentDraft(state, {
      actionId: action.actionId,
      paymentCandidateIndex: nextCandidateIndex,
      selectedPaymentSources: nextSelected,
    });
  }
  return applyActionWithTrainingInput(
    state,
    action,
    { paymentSources: nextSelected },
    engine
  );
}

function applyFactoredReverseRebirthPaymentAction(
  state: GameState,
  systemAction: FactoredReverseRebirthPaymentSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  const existingDraft = trainingReverseRebirthSummonDraftOf(state);
  if (
    existingDraft &&
    (existingDraft.pendingId !== action.pendingId ||
      existingDraft.actionId !== action.actionId)
  ) {
    throw new Error("Training reverse-rebirth payment has no matching draft");
  }
  const draft =
    existingDraft ??
    ({
      pendingId: action.pendingId,
      actionId: action.actionId,
      phase: "payment",
      paymentCandidateIndex: 0,
      selectedPaymentSources: [],
      placementSourceIndex: 0,
      placements: [],
    } satisfies TrainingReverseRebirthSummonDraft);
  if (draft.phase !== "payment") {
    throw new Error("Training reverse-rebirth payment is already complete");
  }

  const context = reverseRebirthSummonPaymentContext(state, action, {
    getCardDefinitionById: engine.getCardDefinitionById,
  });
  if (!context) {
    throw new Error("Training reverse-rebirth payment metadata is unavailable");
  }
  if (
    systemAction.reverseRebirthPaymentCandidateIndex !==
    draft.paymentCandidateIndex
  ) {
    throw new Error(
      `Training reverse-rebirth payment index mismatch: expected=${draft.paymentCandidateIndex} actual=${systemAction.reverseRebirthPaymentCandidateIndex}`
    );
  }
  const source = context.sources[draft.paymentCandidateIndex];
  if (!source) {
    throw new Error("Training reverse-rebirth payment source is unavailable");
  }
  const remainingCost =
    action.costToPay - paymentSourcesTotalAmount(draft.selectedPaymentSources);
  if (
    !paymentSourceAllocationOptions(source, remainingCost).some((candidate) =>
      samePaymentSource(candidate, systemAction.paymentSource)
    )
  ) {
    throw new Error("Training reverse-rebirth payment source is invalid");
  }
  const nextSelected = systemAction.paymentSource
    ? [...draft.selectedPaymentSources, systemAction.paymentSource]
    : [...draft.selectedPaymentSources];
  const nextCandidateIndex = draft.paymentCandidateIndex + 1;
  if (
    !hasReachableFactoredReverseRebirthPayment(
      context.sources,
      action.costToPay,
      nextSelected,
      nextCandidateIndex
    )
  ) {
    throw new Error(
      "Training reverse-rebirth payment allocation cannot reach its cost"
    );
  }
  if (nextCandidateIndex < context.sources.length) {
    return withTrainingReverseRebirthSummonDraft(state, {
      ...draft,
      paymentCandidateIndex: nextCandidateIndex,
      selectedPaymentSources: nextSelected,
    });
  }
  if (paymentSourcesTotalAmount(nextSelected) !== action.costToPay) {
    throw new Error("Training reverse-rebirth payment does not pay its cost");
  }
  return withTrainingReverseRebirthSummonDraft(state, {
    ...draft,
    phase: "placement",
    paymentCandidateIndex: nextCandidateIndex,
    selectedPaymentSources: nextSelected,
    placementSourceIndex: 0,
    placements: [],
  });
}

function applyFactoredReverseRebirthPlacementAction(
  state: GameState,
  systemAction: FactoredReverseRebirthPlacementSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  const existingDraft = trainingReverseRebirthSummonDraftOf(state);
  if (
    existingDraft &&
    (existingDraft.pendingId !== action.pendingId ||
      existingDraft.actionId !== action.actionId)
  ) {
    throw new Error("Training reverse-rebirth placement has no matching draft");
  }
  const draft =
    existingDraft ??
    ({
      pendingId: action.pendingId,
      actionId: action.actionId,
      phase: "placement",
      paymentCandidateIndex: 0,
      selectedPaymentSources: [],
      placementSourceIndex: 0,
      placements: [],
    } satisfies TrainingReverseRebirthSummonDraft);
  if (draft.phase !== "placement") {
    throw new Error("Training reverse-rebirth payment is incomplete");
  }
  const context = reverseRebirthSummonPaymentContext(state, action, {
    getCardDefinitionById: engine.getCardDefinitionById,
  });
  if (!context) {
    throw new Error(
      "Training reverse-rebirth placement metadata is unavailable"
    );
  }
  const afterPayment = reverseRebirthSummonStateAfterPayment(
    context,
    action,
    draft.selectedPaymentSources
  );
  if (!afterPayment) {
    throw new Error("Training reverse-rebirth placement payment is invalid");
  }
  const sources = placementSources({
    state: afterPayment,
    playerId: action.actingPlayerId,
    excludeInstanceIds: [action.sourceInstanceId],
    getCardDefinitionById: context.getCardDefinitionById,
  });
  if (
    systemAction.reverseRebirthPlacementSourceIndex !==
    draft.placementSourceIndex
  ) {
    throw new Error(
      `Training reverse-rebirth placement index mismatch: expected=${draft.placementSourceIndex} actual=${systemAction.reverseRebirthPlacementSourceIndex}`
    );
  }
  const source = sources[draft.placementSourceIndex];
  if (!source) {
    throw new Error("Training reverse-rebirth placement source is unavailable");
  }
  const placed = getPlacedCoreCount(draft.placements);
  const maximumCoreCount = sources.reduce(
    (sum, candidate) => sum + candidate.normalCap + candidate.soulCap,
    0
  );
  const remaining = maximumCoreCount - placed;
  const followingSourceCapacity = sources
    .slice(draft.placementSourceIndex + 1)
    .reduce(
      (sum, candidate) => sum + candidate.normalCap + candidate.soulCap,
      0
    );
  if (
    remaining < 0 ||
    systemAction.normalAmount < 0 ||
    systemAction.normalAmount > Math.min(source.normalCap, remaining) ||
    systemAction.soulAmount < 0 ||
    systemAction.soulAmount >
      Math.min(source.soulCap, remaining - systemAction.normalAmount)
  ) {
    throw new Error("Training reverse-rebirth placement allocation is invalid");
  }
  const finalPlaced =
    placed + systemAction.normalAmount + systemAction.soulAmount;
  if (finalPlaced + followingSourceCapacity < action.minimumCoreCount) {
    throw new Error(
      "Training reverse-rebirth placement cannot satisfy its minimum core count"
    );
  }
  const nextPlacements = [
    ...draft.placements,
    ...placementFromTrainingSource(
      source,
      systemAction.normalAmount,
      systemAction.soulAmount
    ),
  ];
  const nextSourceIndex = draft.placementSourceIndex + 1;
  if (nextSourceIndex < sources.length) {
    return withTrainingReverseRebirthSummonDraft(state, {
      ...draft,
      placementSourceIndex: nextSourceIndex,
      placements: nextPlacements,
    });
  }
  if (getPlacedCoreCount(nextPlacements) < action.minimumCoreCount) {
    throw new Error("Training reverse-rebirth placement is incomplete");
  }
  return applyActionWithTrainingInput(
    withoutTrainingReverseRebirthSummonDraft(state),
    action,
    {
      summonPaymentSources: [...draft.selectedPaymentSources],
      summonEnterFieldCorePlacements: nextPlacements,
    },
    engine
  );
}

function applyFactoredZoneSelectionAction(
  state: GameState,
  systemAction: FactoredZoneSelectionSystemAction,
  engine: Engine
): GameState {
  const action = systemAction.action;
  if (action.kind === "use_magic") {
    return applyFactoredVariableZoneDiscountSelectionAction(
      state,
      systemAction
    );
  }
  if (action.requiresPerCardDestinationChoice) {
    throw new Error(
      "Factored zone selection does not support per-card destinations"
    );
  }
  const draft = trainingZoneSelectionDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training zone-selection draft does not match the pending action"
    );
  }
  const candidateIndex = draft?.candidateIndex ?? 0;
  if (systemAction.candidateIndex !== candidateIndex) {
    throw new Error(
      `Training zone-selection index mismatch: expected=${candidateIndex} actual=${systemAction.candidateIndex}`
    );
  }
  const candidateId = action.candidateCardInstanceIds[candidateIndex];
  if (!candidateId) {
    throw new Error("Training zone-selection candidate is unavailable");
  }
  const selectedZoneCardIds = draft?.selectedZoneCardIds ?? [];
  if (systemAction.select && selectedZoneCardIds.length >= action.maxCount) {
    throw new Error("Training zone-selection exceeds maximum");
  }
  const nextSelected = systemAction.select
    ? [...selectedZoneCardIds, candidateId]
    : [...selectedZoneCardIds];
  const nextIndex = candidateIndex + 1;
  if (nextIndex < action.candidateCardInstanceIds.length) {
    return withTrainingZoneSelectionDraft(state, {
      pendingId: action.pendingId,
      actionId: action.actionId,
      candidateIndex: nextIndex,
      selectedZoneCardIds: nextSelected,
    });
  }
  const minimum = action.canSkip ? 0 : action.maxCount;
  if (nextSelected.length < minimum || nextSelected.length > action.maxCount) {
    throw new Error(
      "Training zone-selection does not satisfy its required count"
    );
  }
  return applyActionWithTrainingInput(
    withoutTrainingZoneSelectionDraft(state),
    action,
    { selectedZoneCardIds: nextSelected },
    engine
  );
}

function applyFactoredDeckRevealOrderAction(
  state: GameState,
  systemAction: Extract<
    TrainingSystemAction,
    { kind: "select_factored_deck_reveal_order" }
  >,
  engine: Engine
): GameState {
  const action = systemAction.action;
  if (
    action.remainder !== "top_bottom_split" &&
    action.remainder !== "top_or_bottom" &&
    action.remainder !== "top" &&
    action.remainder !== "bottom"
  ) {
    throw new Error("Factored deck-reveal order has an unsupported remainder");
  }
  const draft = trainingDeckRevealOrderDraftOf(state);
  if (
    draft &&
    (draft.pendingId !== action.pendingId || draft.actionId !== action.actionId)
  ) {
    throw new Error(
      "Training deck-reveal order draft does not match the pending action"
    );
  }
  const deckRevealRemainderOrder = draft?.deckRevealRemainderOrder ?? [];
  const deckRevealRemainderPlacements = {
    ...(draft?.deckRevealRemainderPlacements ?? {}),
  };
  const deckRevealPlacement =
    action.remainder === "top_or_bottom"
      ? (draft?.deckRevealPlacement ?? systemAction.placement)
      : undefined;
  const fixedPlacement =
    action.remainder === "top" || action.remainder === "bottom"
      ? action.remainder
      : deckRevealPlacement;
  if (
    action.remainder === "top_or_bottom" &&
    deckRevealPlacement !== systemAction.placement
  ) {
    throw new Error("Factored deck-reveal order placement changed mid-order");
  }
  if (
    (action.remainder === "top" || action.remainder === "bottom") &&
    fixedPlacement !== systemAction.placement
  ) {
    throw new Error(
      "Factored deck-reveal order placement does not match action"
    );
  }
  if (
    !action.remainingCardInstanceIds.includes(systemAction.cardInstanceId) ||
    deckRevealRemainderOrder.includes(systemAction.cardInstanceId)
  ) {
    throw new Error("Training deck-reveal order card is unavailable");
  }
  const nextOrder = [...deckRevealRemainderOrder, systemAction.cardInstanceId];
  if (action.remainder === "top_bottom_split") {
    deckRevealRemainderPlacements[systemAction.cardInstanceId] =
      systemAction.placement;
  }
  if (nextOrder.length < action.remainingCardInstanceIds.length) {
    return withTrainingDeckRevealOrderDraft(state, {
      pendingId: action.pendingId,
      actionId: action.actionId,
      deckRevealRemainderOrder: nextOrder,
      deckRevealRemainderPlacements,
      ...(deckRevealPlacement !== undefined ? { deckRevealPlacement } : {}),
    });
  }
  return applyActionWithTrainingInput(
    withoutTrainingDeckRevealOrderDraft(state),
    action,
    action.remainder === "top_bottom_split"
      ? {
          deckRevealRemainderOrder: nextOrder,
          deckRevealRemainderPlacements,
        }
      : {
          deckRevealRemainderOrder: nextOrder,
          ...(action.remainder === "top_or_bottom"
            ? { deckRevealPlacement: fixedPlacement! }
            : {}),
        },
    engine
  );
}

const SYSTEM_ACTION_APPLIERS = {
  advance_step: applyAdvanceStepSystemAction,
  manual_core_move: applyManualCoreMoveSystemAction,
} satisfies Record<
  PlayerSystemActionKind,
  (state: GameState, systemAction: never, engine: Engine) => GameState
>;

type AnySystemActionApplier = (
  state: GameState,
  systemAction: TrainingSystemAction,
  engine: Engine
) => GameState;

export function applyTrainingSystemAction(
  state: GameState,
  systemAction: TrainingSystemAction,
  engine: Engine
): GameState {
  if (systemAction.kind === "select_multi_placement_source") {
    return applyTrainingMultiPlacementSourceAction(state, systemAction, engine);
  }
  if (systemAction.kind === "select_factored_target_selection") {
    if ("targetTotal" in systemAction) {
      return applyFactoredCoreDistributionTargetTotalAction(
        state,
        systemAction,
        engine
      );
    }
    if ("coreDistributionSoulTargetCandidateIndex" in systemAction) {
      return applyFactoredCoreDistributionSoulTargetAllocationAction(
        state,
        systemAction,
        engine
      );
    }
    return applyFactoredTargetSelectionAction(state, systemAction);
  }
  if (systemAction.kind === "select_factored_zone_selection") {
    if ("reverseRebirthPlacementSourceIndex" in systemAction) {
      return applyFactoredReverseRebirthPlacementAction(
        state,
        systemAction,
        engine
      );
    }
    if ("reverseRebirthPaymentCandidateIndex" in systemAction) {
      return applyFactoredReverseRebirthPaymentAction(
        state,
        systemAction,
        engine
      );
    }
    if ("coreDistributionSourceCandidateIndex" in systemAction) {
      return applyFactoredCoreDistributionSourceAllocationAction(
        state,
        systemAction,
        engine
      );
    }
    if ("topLevelPaymentCandidateIndex" in systemAction) {
      return applyFactoredTopLevelPaymentAction(state, systemAction, engine);
    }
    if ("summonCostExcludePaymentCandidateIndex" in systemAction) {
      return applyFactoredSummonCostExcludePaymentAction(
        state,
        systemAction,
        engine
      );
    }
    if ("paymentCandidateIndex" in systemAction) {
      return applyFactoredVariableZoneDiscountPaymentAction(
        state,
        systemAction,
        engine
      );
    }
    if (
      systemAction.action.kind === "resolve_pending_summon_cost_exclude_choice"
    ) {
      return applyFactoredSummonCostExcludeSelectionAction(
        state,
        systemAction as FactoredSummonCostExcludeSelectionSystemAction
      );
    }
    return applyFactoredZoneSelectionAction(
      state,
      systemAction as FactoredZoneSelectionSystemAction,
      engine
    );
  }
  if (systemAction.kind === "select_factored_deck_reveal_order") {
    return applyFactoredDeckRevealOrderAction(state, systemAction, engine);
  }
  if (systemAction.kind === "commit_factored_manual_core_move") {
    return applyCommitFactoredManualCoreMoveSystemAction(
      state,
      systemAction,
      engine
    );
  }
  const applier = SYSTEM_ACTION_APPLIERS[
    systemAction.kind
  ] as AnySystemActionApplier;
  return applier(state, systemAction, engine);
}

function applyTrainingDecisionChoiceInner(
  state: GameState,
  node: TrainingDecisionNode,
  choice: TrainingDecisionChoice,
  engine: Engine,
  telemetry?: AiWorkTelemetry
): GameState {
  if (node.kind === "pregame") {
    if (!choice.preGameChoice) {
      throw new Error(
        `Training choice ${choice.choiceId} has no pregame input`
      );
    }
    return applyPreGameChoice(state, choice.preGameChoice, engine);
  }

  if (choice.systemAction) {
    return applyTrainingSystemAction(state, choice.systemAction, engine);
  }

  if (node.kind === "action_input") {
    if (!node.action) {
      throw new Error(`Action input node ${node.nodeId} has no source action`);
    }
    return applyActionWithTrainingInput(
      state,
      node.action,
      choice.applyOptions,
      engine
    );
  }

  if (choice.action) {
    const inputNode = createActionInputDecisionNode(state, choice.action, {
      getCardDefinitionById: engine.getCardDefinitionById,
      ...(telemetry ? { telemetry } : {}),
    });
    if (inputNode) {
      throw new Error(
        `Training choice ${choice.choiceId} requires an action-input choice`
      );
    }
    return applyActionWithTrainingInput(
      state,
      choice.action,
      undefined,
      engine
    );
  }

  throw new Error(`Training choice ${choice.choiceId} is not applicable`);
}

function advanceTraining(state: GameState, engine: Engine): GameState {
  // Training advances bypass applyLegalAction's action-completion stabilizer.
  // Surface a deferred optional trash add before attempting the next step, and
  // again after a step's inline work can create one (for example draw-step
  // discard). Otherwise the following decision incorrectly offers/attempts
  // advance_step and only then discovers the newly materialized prompt.
  const beforeAdvance = materializeDeferredTrashOptionalAdds(state);
  if (beforeAdvance !== state) return beforeAdvance;

  const advanced = advanceStep(
    state,
    engine.getCardDefinitionById,
    engine.lookups.getRegisteredTriggeredEffectActions,
    engine.lookups.getRegisteredBurstActions,
    engine.lookups.getRegisteredMagicActions
  );
  return materializeDeferredTrashOptionalAdds(advanced);
}

function traceEntry(
  step: number,
  node: TrainingDecisionNode,
  choice: TrainingDecisionChoice
): TrainingDecisionTraceEntry {
  const actionKind = node.actionKind ?? choice.action?.kind;
  const actionId = node.action?.actionId ?? choice.action?.actionId;
  return {
    step,
    nodeKind: node.kind,
    actingPlayerId: node.actingPlayerId,
    choiceId: choice.choiceId,
    choiceCount: node.choices.length,
    ...(actionKind ? { actionKind } : {}),
    ...(actionId ? { actionId } : {}),
    ...(choice.systemAction
      ? { systemActionKind: choice.systemAction.kind }
      : {}),
    fields: node.fields,
    ...(node.preGamePhase ? { preGamePhase: node.preGamePhase } : {}),
    truncated: node.truncated,
  };
}

export function isPolicyControlledTrainingDecision(
  node: TrainingDecisionNode,
  actionInputNode?: TrainingDecisionNode | null
): boolean {
  return (
    node.truncated ||
    node.choices.length > 1 ||
    (actionInputNode !== undefined &&
      actionInputNode !== null &&
      (actionInputNode.truncated || actionInputNode.choices.length > 1))
  );
}

export function playTrainingGame(
  opts: TrainingPlayOptions
): TrainingGameResult {
  const originalRandom = Math.random;
  if (opts.rng) Math.random = opts.rng;
  try {
    return playTrainingGameInner(opts);
  } finally {
    Math.random = originalRandom;
  }
}

function playTrainingGameUnmeasured(
  opts: TrainingPlayOptions,
  recorder?: TrainingTraceRecorder
): TrainingGameResult {
  const { engine } = opts;
  const rng = opts.rng ?? Math.random;
  const maxSteps = opts.maxSteps ?? 4000;
  const maxForcedTransitions = opts.maxForcedTransitions ?? 1000;
  const maxRepeatedStateTransitions = opts.maxRepeatedStateTransitions ?? 4;
  const maxDurationMs =
    Number.isFinite(opts.maxDurationMs) && (opts.maxDurationMs ?? 0) > 0
      ? opts.maxDurationMs
      : undefined;
  const now = opts.now ?? Date.now;
  let state = opts.initialState
    ? measureAiWork(opts.telemetry, "state_copy", () =>
        cloneSerializable(opts.initialState!)
      )
    : initializeGame({
        decks: opts.decks ?? [
          randomDeck(engine.cards, 40, rng),
          randomDeck(engine.cards, 40, rng),
        ],
        skipPreGame: opts.skipPreGame === true,
        preserveDeckOrder: opts.preserveDeckOrder === true,
      });
  const startedAtMs = now();
  const trace: TrainingDecisionTraceEntry[] = [];
  let lastError: string | undefined;
  let decisionSteps = 0;
  let transitionSteps = 0;
  let consecutiveForcedTransitions = 0;
  let lastTransitionDescription = "initial";
  const initialProgressFingerprint = trainingProgressFingerprint(state);
  const progressStateVisits =
    opts.initialProgressStateVisits ?? new Map<string, number>();
  if (!progressStateVisits.has(initialProgressFingerprint)) {
    progressStateVisits.set(initialProgressFingerprint, 1);
  }
  // A response-window pass must be allowed to close even when it returns to a
  // previously visited state.  That is required for effects whose declaration
  // rolls back during resolution.  A reversible, cost-free effect can also
  // take that same path, however: the pass resolves the effect and returns to
  // a prior playable state.  Keep rules legality untouched, but remember the
  // originating action for this training rollout so it is not selected again
  // from that returned state.  Otherwise a policy can repeatedly declare the
  // action, choose a different temporary input, and rely on the mandatory
  // pass to bypass the normal revisit guard (EDH-0041).
  const cyclicResponseActionIdsByProgressFingerprint = new Map<
    string,
    Set<string>
  >();
  // A response chain can open another response window while it is resolving.
  // Keep every action that led into that chain, rather than replacing the
  // outer declaration with the innermost one. In particular, a target
  // disclosure can declare a hand trigger in a battle-flash sub-stack. If
  // that nested chain returns to an already visited outer flash state, the
  // original declaration must be filtered alongside the nested responder
  // (EDH-0006). A separate declaration from a settled outer flash state is a
  // new chain, however, so its predecessor must not be blocked with it.
  const responseWindowOriginActionIds = new Map<string, Set<string>>();
  const opensTrainingResponseSubWindow = (
    stateBeforeTransition: GameState,
    nextState: GameState
  ): boolean => {
    if (
      stateBeforeTransition.stackWindow === null &&
      nextState.stackWindow !== null
    ) {
      return true;
    }
    if (
      stateBeforeTransition.preDeclarationStackWindow === null &&
      nextState.preDeclarationStackWindow !== null
    ) {
      return true;
    }
    const priorBattleFlash =
      stateBeforeTransition.activeAttack?.flashWindowState;
    const nextBattleFlash = nextState.activeAttack?.flashWindowState;
    return (
      priorBattleFlash !== undefined &&
      priorBattleFlash !== null &&
      nextBattleFlash !== undefined &&
      nextBattleFlash !== null &&
      priorBattleFlash.pendingStackAction === null &&
      nextBattleFlash.pendingStackAction !== null
    );
  };
  const hasTrainingResponseChainContinuation = (state: GameState): boolean =>
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.activeAttack?.flashWindowState?.pendingStackAction !== null ||
    state.pendingCoreSourceAllocation?.continuation !== undefined ||
    state.pendingStepChoice?.deferredStack !== undefined ||
    state.pendingEffectTargetSelection?.deferredStack !== undefined ||
    state.pendingTargetedDisclosureContinuation !== null ||
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0;
  // Factored core inputs remain part of the same response chain.
  const carryResponseWindowOrigin = (
    before: GameState,
    after: GameState
  ): void => {
    const origins = responseWindowOriginActionIds.get(
      trainingProgressFingerprint(before)
    );
    if (origins && hasTrainingResponseWindow(after))
      responseWindowOriginActionIds.set(
        trainingProgressFingerprint(after),
        new Set(origins)
      );
  };
  const rememberResponseWindowOrigin = (
    stateBeforeTransition: GameState,
    nextState: GameState,
    action: LegalAction
  ): void => {
    if (!hasTrainingResponseWindow(nextState)) return;
    const priorOriginActionIds = responseWindowOriginActionIds.get(
      trainingProgressFingerprint(stateBeforeTransition)
    );
    const startsNewResponseChain =
      opensTrainingResponseSubWindow(stateBeforeTransition, nextState) &&
      !hasTrainingResponseChainContinuation(stateBeforeTransition);
    const nextOriginActionIds = new Set(
      startsNewResponseChain ? undefined : priorOriginActionIds
    );
    // Passes and deferred-resolution closures return to an outer response
    // state. They are the escape route from a cycle, so only declarations
    // and other chain-opening actions become candidates for later blocking.
    if (!isTrainingResponseWindowClosingAction(stateBeforeTransition, action)) {
      nextOriginActionIds.add(action.actionId);
    }
    responseWindowOriginActionIds.set(
      trainingProgressFingerprint(nextState),
      nextOriginActionIds
    );
  };
  const rememberCyclicResponseClosure = (
    stateBeforeTransition: GameState,
    nextState: GameState,
    action: LegalAction
  ): void => {
    if (!isTrainingResponseWindowClosingAction(stateBeforeTransition, action)) {
      return;
    }
    const originActionIds = responseWindowOriginActionIds.get(
      trainingProgressFingerprint(stateBeforeTransition)
    );
    const returnedStateFingerprint = trainingProgressFingerprint(nextState);
    if (
      originActionIds === undefined ||
      originActionIds.size === 0 ||
      !progressStateVisits.has(returnedStateFingerprint)
    ) {
      return;
    }
    const blocked =
      cyclicResponseActionIdsByProgressFingerprint.get(
        returnedStateFingerprint
      ) ?? new Set<string>();
    for (const originActionId of originActionIds) {
      blocked.add(originActionId);
    }
    cyclicResponseActionIdsByProgressFingerprint.set(
      returnedStateFingerprint,
      blocked
    );
  };
  const propagateBlockedResponseActions = (
    stateBeforeTransition: GameState,
    nextState: GameState
  ): void => {
    if (!hasTrainingResponseWindow(nextState)) return;
    const blocked = cyclicResponseActionIdsByProgressFingerprint.get(
      trainingProgressFingerprint(stateBeforeTransition)
    );
    if (!blocked || blocked.size === 0) return;
    const nextFingerprint = trainingProgressFingerprint(nextState);
    const nextBlocked =
      cyclicResponseActionIdsByProgressFingerprint.get(nextFingerprint) ??
      new Set<string>();
    for (const actionId of blocked) nextBlocked.add(actionId);
    cyclicResponseActionIdsByProgressFingerprint.set(
      nextFingerprint,
      nextBlocked
    );
  };

  while (decisionSteps < maxSteps) {
    if (maxDurationMs !== undefined && now() - startedAtMs >= maxDurationMs) {
      const lastError = [
        "training elapsed duration limit reached",
        `maxDurationMs=${maxDurationMs}`,
      ].join("; ");
      recorder?.recordFinal(state, decisionSteps, transitionSteps, "capped");
      return {
        steps: transitionSteps,
        decisionSteps,
        transitionSteps,
        outcome: "capped",
        winner: null,
        trace,
        finalState: state,
        lastError,
        terminationReason: "elapsed_time_limit",
      };
    }
    if (state.gameResult !== null) {
      recorder?.recordFinal(state, decisionSteps, transitionSteps, "natural");
      return {
        steps: transitionSteps,
        decisionSteps,
        transitionSteps,
        outcome: "natural",
        winner: winnerOf(state),
        trace,
        finalState: state,
      };
    }

    const node = getNextTrainingDecision(state, engine, opts);
    let progressed = false;
    let policyControlled = node !== null && node.choices.length !== 1;

    if (node?.kind === "pregame") {
      const policy =
        opts.policies?.[node.actingPlayerId] ?? randomTrainingPolicy;
      const selected = measureAiWork(opts.telemetry, "decision", () =>
        policy(state, node, engine, rng)
      );
      if (selected.preGameChoice) {
        const decisionState = state;
        const entry = traceEntry(transitionSteps, node, selected);
        state = measureAiWork(opts.telemetry, "engine_transition", () =>
          applyPreGameChoice(state, selected.preGameChoice!, engine)
        );
        trace.push(entry);
        recorder?.recordDecision(decisionState, node, entry);
        progressed = true;
        lastTransitionDescription = `${entry.nodeKind}:${entry.choiceId}`;
      }
    } else if (node?.kind === "legal_action") {
      const policy =
        opts.policies?.[node.actingPlayerId] ?? randomTrainingPolicy;
      const blockedActionIds =
        cyclicResponseActionIdsByProgressFingerprint.get(
          trainingProgressFingerprint(state)
        ) ?? new Set<string>();
      const availableChoices = node.choices.filter(
        (choice) =>
          choice.action === undefined ||
          !blockedActionIds.has(choice.action.actionId)
      );
      const policyNode = { ...node, choices: availableChoices };
      const selected =
        availableChoices.length > 0
          ? measureAiWork(opts.telemetry, "decision", () =>
              policy(state, policyNode, engine, rng)
            )
          : undefined;
      const orderedChoices = selected
        ? [
            selected,
            ...availableChoices.filter((choice) => choice !== selected),
          ]
        : [];
      for (const actionChoice of orderedChoices) {
        if (actionChoice.systemAction) {
          try {
            const decisionState = state;
            const entry = traceEntry(transitionSteps, node, actionChoice);
            const nextState = measureAiWork(
              opts.telemetry,
              "engine_transition",
              () =>
                applyTrainingSystemAction(
                  state,
                  actionChoice.systemAction!,
                  engine
                )
            );
            opts.onBeforeProgressVisitCheck?.({
              stateBeforeTransition: state,
              nextState,
            });
            if (
              !acceptsTrainingProgressTransition(
                state,
                nextState,
                progressStateVisits
              )
            ) {
              lastError = `training state revisit skipped: ${entry.nodeKind}:${entry.choiceId}`;
              continue;
            }
            carryResponseWindowOrigin(state, nextState);
            propagateBlockedResponseActions(state, nextState);
            state = nextState;
            trace.push(entry);
            recorder?.recordDecision(decisionState, node, entry);
            progressed = true;
            lastTransitionDescription = `${entry.nodeKind}:${entry.choiceId}`;
            break;
          } catch (e) {
            lastError = (e as Error).message;
            continue;
          }
        }
        const action = actionChoice.action;
        if (!action) continue;
        const inputNode = createActionInputDecisionNode(state, action, {
          ...opts,
          getCardDefinitionById: engine.getCardDefinitionById,
        });
        policyControlled = isPolicyControlledTrainingDecision(node, inputNode);
        if (!inputNode) {
          try {
            const decisionState = state;
            const entry = traceEntry(transitionSteps, node, actionChoice);
            const nextState = measureAiWork(
              opts.telemetry,
              "engine_transition",
              () =>
                applyActionWithTrainingInput(state, action, undefined, engine)
            );
            opts.onBeforeProgressVisitCheck?.({
              stateBeforeTransition: state,
              nextState,
              action,
            });
            rememberCyclicResponseClosure(state, nextState, action);
            if (
              !acceptsTrainingProgressTransition(
                state,
                nextState,
                progressStateVisits,
                action
              )
            ) {
              lastError = `training state revisit skipped: ${entry.nodeKind}:${entry.choiceId}`;
              continue;
            }
            rememberResponseWindowOrigin(state, nextState, action);
            propagateBlockedResponseActions(state, nextState);
            state = nextState;
            trace.push(entry);
            recorder?.recordDecision(decisionState, node, entry);
            progressed = true;
            lastTransitionDescription = `${entry.nodeKind}:${entry.choiceId}`;
            break;
          } catch (e) {
            lastError = (e as Error).message;
            continue;
          }
        }
        const inputPolicy =
          opts.policies?.[inputNode.actingPlayerId] ?? randomTrainingPolicy;
        const inputSelected = measureAiWork(opts.telemetry, "decision", () =>
          inputPolicy(state, inputNode, engine, rng)
        );
        const orderedInputs = [
          inputSelected,
          ...inputNode.choices.filter((choice) => choice !== inputSelected),
        ];
        for (const inputChoice of orderedInputs) {
          try {
            const decisionState = state;
            const actionEntry = traceEntry(transitionSteps, node, actionChoice);
            const inputEntry = traceEntry(
              transitionSteps,
              inputNode,
              inputChoice
            );
            const nextState = inputChoice.systemAction
              ? measureAiWork(opts.telemetry, "engine_transition", () =>
                  applyTrainingSystemAction(
                    state,
                    inputChoice.systemAction!,
                    engine
                  )
                )
              : measureAiWork(opts.telemetry, "engine_transition", () =>
                  applyActionWithTrainingInput(
                    state,
                    action,
                    inputChoice.applyOptions,
                    engine
                  )
                );
            opts.onBeforeProgressVisitCheck?.({
              stateBeforeTransition: state,
              nextState,
              action,
            });
            rememberCyclicResponseClosure(state, nextState, action);
            if (
              !acceptsTrainingProgressTransition(
                state,
                nextState,
                progressStateVisits,
                action
              )
            ) {
              lastError = `training state revisit skipped: ${inputEntry.nodeKind}:${inputEntry.choiceId}`;
              continue;
            }
            rememberResponseWindowOrigin(state, nextState, action);
            propagateBlockedResponseActions(state, nextState);
            state = nextState;
            trace.push(actionEntry);
            trace.push(inputEntry);
            recorder?.recordDecision(decisionState, node, actionEntry);
            recorder?.recordDecision(decisionState, inputNode, inputEntry);
            progressed = true;
            lastTransitionDescription = `${inputEntry.nodeKind}:${inputEntry.choiceId}`;
            break;
          } catch (e) {
            lastError = (e as Error).message;
          }
        }
        if (progressed) break;
      }
    } else if (node?.kind === "action_input") {
      const policy =
        opts.policies?.[node.actingPlayerId] ?? randomTrainingPolicy;
      const selected = measureAiWork(opts.telemetry, "decision", () =>
        policy(state, node, engine, rng)
      );
      const decisionState = state;
      const entry = traceEntry(transitionSteps, node, selected);
      if (selected.systemAction) {
        state = measureAiWork(opts.telemetry, "engine_transition", () =>
          applyTrainingSystemAction(state, selected.systemAction!, engine)
        );
      } else if (node.action) {
        state = measureAiWork(opts.telemetry, "engine_transition", () =>
          applyActionWithTrainingInput(
            state,
            node.action!,
            selected.applyOptions,
            engine
          )
        );
      } else {
        throw new Error(
          `Top-level training action-input node ${node.nodeId} has no source action`
        );
      }
      carryResponseWindowOrigin(decisionState, state);
      propagateBlockedResponseActions(decisionState, state);
      trace.push(entry);
      recorder?.recordDecision(decisionState, node, entry);
      progressed = true;
      lastTransitionDescription = `${entry.nodeKind}:${entry.choiceId}`;
    }

    if (!progressed) {
      try {
        state = measureAiWork(opts.telemetry, "engine_transition", () =>
          advanceTraining(state, engine)
        );
        lastTransitionDescription = "advanceTraining";
      } catch (e) {
        recorder?.recordFinal(state, decisionSteps, transitionSteps, "stuck");
        return {
          steps: transitionSteps,
          decisionSteps,
          transitionSteps,
          outcome: "stuck",
          winner: null,
          trace,
          finalState: state,
          lastError: (e as Error).message,
          terminationReason: "advance_error",
        };
      }
    }

    transitionSteps += 1;
    const afterProgressFingerprint = trainingProgressFingerprint(state);
    const stateVisitCount =
      (progressStateVisits.get(afterProgressFingerprint) ?? 0) + 1;
    progressStateVisits.set(afterProgressFingerprint, stateVisitCount);
    const repeatedStateTransitions = stateVisitCount - 1;
    if (repeatedStateTransitions >= maxRepeatedStateTransitions) {
      const message = [
        "training non-progress loop detected",
        `repeatedStateTransitions=${repeatedStateTransitions}`,
        `transition=${lastTransitionDescription}`,
        `state=${afterProgressFingerprint}`,
      ].join("; ");
      recorder?.recordFinal(state, decisionSteps, transitionSteps, "stuck");
      return {
        steps: transitionSteps,
        decisionSteps,
        transitionSteps,
        outcome: "stuck",
        winner: null,
        trace,
        finalState: state,
        lastError: message,
        terminationReason: "repeated_state",
      };
    }
    if (policyControlled) {
      decisionSteps += 1;
      consecutiveForcedTransitions = 0;
    } else {
      consecutiveForcedTransitions += 1;
    }
    if (state.gameResult !== null) {
      recorder?.recordFinal(state, decisionSteps, transitionSteps, "natural");
      return {
        steps: transitionSteps,
        decisionSteps,
        transitionSteps,
        outcome: "natural",
        winner: winnerOf(state),
        trace,
        finalState: state,
      };
    }

    if (policyControlled) continue;

    if (consecutiveForcedTransitions >= maxForcedTransitions) {
      const message = [
        "forced transition limit reached without a policy decision",
        `maxForcedTransitions=${maxForcedTransitions}`,
        `transition=${lastTransitionDescription}`,
      ].join("; ");
      recorder?.recordFinal(state, decisionSteps, transitionSteps, "stuck");
      return {
        steps: transitionSteps,
        decisionSteps,
        transitionSteps,
        outcome: "stuck",
        winner: null,
        trace,
        finalState: state,
        lastError: lastError ? `${message}; lastError=${lastError}` : message,
        terminationReason: "forced_transition_limit",
      };
    }
  }

  recorder?.recordFinal(state, decisionSteps, transitionSteps, "capped");
  return {
    steps: transitionSteps,
    decisionSteps,
    transitionSteps,
    outcome: "capped",
    winner: null,
    trace,
    finalState: state,
    ...(lastError ? { lastError } : {}),
    terminationReason: "decision_limit",
  };
}

/**
 * Fingerprint used only for loop detection. Appending the same diagnostic log
 * (and its derived start index) or an additional public-disclosure history
 * entry is not game progress: neither changes subsequent rules legality.
 * The root trigger sequence only allocates cause identities. Its value alone
 * is not progress; actual pending reactions and usage records remain visible.
 * The non-empty status is retained because it is a policy-observation input,
 * but its unbounded history count must not create novel states. Flash-effect
 * history is summarized to the identities visible to `flash_used`: whether a
 * source was activated in each queried scope and the latest source in the
 * current timing window. The current phase of a factored manual-core draft is
 * the exception: it controls which training choices are legal, so a commit
 * must be visible even when it causes no SBA. Every other serializable state
 * change remains visible to the guard.
 */
export function trainingProgressFingerprint(state: GameState): string {
  const {
    log: _log,
    actionStartLogIndex: _actionStartLogIndex,
    publicDisclosures: _publicDisclosures,
    nextRootTriggerChainId: _nextRootTriggerChainId,
    semanticTriggerSequence: _semanticTriggerSequence,
    semanticTriggerEvents: _semanticTriggerEvents,
    ...logicalState
  } = state;
  void _log;
  void _actionStartLogIndex;
  void _publicDisclosures;
  void _nextRootTriggerChainId;
  void _semanticTriggerSequence;
  return hashSerializable({
    ...logicalState,
    // Delivery receipts and allocator IDs are bookkeeping; undelivered facts
    // can still change legality and must remain part of the progress state.
    ...(_semanticTriggerEvents?.some((e) => !e.delivered)
      ? {
          semanticTriggerEvents: _semanticTriggerEvents
            .filter((e) => !e.delivered)
            .map(
              ({ semanticEventId: _id, delivered: _delivered, ...fact }) => fact
            ),
        }
      : {}),
    trainingHasPublicDisclosures: (state.publicDisclosures?.length ?? 0) > 0,
    flashEffectActivationLog: summarizeFlashEffectActivationHistory(state),
    trainingFactoredManualCoreDraftActors:
      activeFactoredManualCoreDraftActors(state),
  });
}

type FlashEffectActivationIdentity = Pick<
  GameState["flashEffectActivationLog"][number],
  "playerId" | "sourceInstanceId" | "sourceDefinitionId"
>;

function summarizeFlashEffectActivationHistory(state: GameState): {
  game: readonly FlashEffectActivationIdentity[];
  turn: readonly FlashEffectActivationIdentity[];
  step: readonly FlashEffectActivationIdentity[];
  battle: readonly FlashEffectActivationIdentity[];
  latest: FlashEffectActivationIdentity | null;
} {
  const entries = state.flashEffectActivationLog;
  const currentAttackId = state.activeAttack?.attackId ?? null;
  const toIdentity = (
    entry: GameState["flashEffectActivationLog"][number]
  ): FlashEffectActivationIdentity => ({
    playerId: entry.playerId,
    sourceInstanceId: entry.sourceInstanceId,
    sourceDefinitionId: entry.sourceDefinitionId,
  });
  const keyOf = (entry: FlashEffectActivationIdentity): string =>
    JSON.stringify([
      entry.playerId,
      entry.sourceInstanceId,
      entry.sourceDefinitionId,
    ]);
  const uniqueIdentities = (
    candidates: readonly GameState["flashEffectActivationLog"][number][]
  ): readonly FlashEffectActivationIdentity[] => {
    const byIdentity = new Map<string, FlashEffectActivationIdentity>();
    for (const entry of candidates) {
      const identity = toIdentity(entry);
      byIdentity.set(keyOf(identity), identity);
    }
    return [...byIdentity.values()].sort((left, right) =>
      keyOf(left).localeCompare(keyOf(right))
    );
  };
  const currentTurn = entries.filter(
    (entry) => entry.turnNumber === state.turnNumber
  );
  const currentStep = currentTurn.filter((entry) => entry.step === state.step);
  const currentWindow = currentStep.filter(
    (entry) => entry.attackId === currentAttackId
  );
  const currentBattle =
    currentAttackId === null
      ? []
      : entries.filter((entry) => entry.attackId === currentAttackId);

  return {
    game: uniqueIdentities(entries),
    turn: uniqueIdentities(currentTurn),
    step: uniqueIdentities(currentStep),
    battle: uniqueIdentities(currentBattle),
    latest: currentWindow.at(-1) ? toIdentity(currentWindow.at(-1)!) : null,
  };
}

/**
 * Training-only loop prevention: legal game actions remain available to the
 * rules engine, but a self-play rollout must not choose one whose complete
 * result has already occurred in this game.  This covers reversible,
 * cost-free actions such as brave separate → brave combine without changing
 * their normal-game legality.
 */
export function isNovelTrainingProgressState(
  state: GameState,
  visitedStateFingerprints: ReadonlyMap<string, unknown>
): boolean {
  return !visitedStateFingerprints.has(trainingProgressFingerprint(state));
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hashSerializable(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function traceLabel(entry: TrainingDecisionTraceEntry): string {
  return [
    `transition ${entry.step}`,
    entry.nodeKind,
    entry.actionKind ??
      entry.systemActionKind ??
      entry.preGamePhase ??
      entry.choiceId,
  ].join(" / ");
}

interface TraceSmokeMetricAccumulator {
  decisionFrames: number;
  truncatedNodeCount: number;
  maxChoiceCount: number;
  nodeKindCounts: Record<TrainingDecisionNodeKind, number>;
}

function buildTraceSmokeMetrics(
  result: TrainingGameResult,
  accumulator: TraceSmokeMetricAccumulator
): TrainingTraceSmokeMetrics {
  const { decisionFrames, truncatedNodeCount, maxChoiceCount, nodeKindCounts } =
    accumulator;
  return {
    outcome: result.outcome,
    winner: result.winner,
    steps: result.steps,
    decisionSteps: result.decisionSteps,
    transitionSteps: result.transitionSteps,
    decisionFrames,
    traceEntries: result.trace.length,
    truncatedNodeCount,
    truncatedNodeRate:
      decisionFrames === 0 ? 0 : truncatedNodeCount / decisionFrames,
    maxChoiceCount,
    nodeKindCounts,
  };
}

export function playTrainingTraceSmoke(
  opts: TrainingTraceSmokeOptions
): TrainingTraceSmokeResult {
  const originalRandom = Math.random;
  if (opts.rng) Math.random = opts.rng;
  try {
    const title = opts.title ?? "trace-smoke";
    const recording = opts.recording;
    const retainFrames = recording?.retainFrames ?? true;
    const retainReplay = recording?.retainReplay ?? true;
    const metricAccumulator: TraceSmokeMetricAccumulator = {
      decisionFrames: 0,
      truncatedNodeCount: 0,
      maxChoiceCount: 0,
      nodeKindCounts: {
        pregame: 0,
        legal_action: 0,
        action_input: 0,
      },
    };
    let lastFrame: TrainingTraceSmokeFrame | undefined;
    let firstTruncatedFrame: TrainingTraceSmokeFrame | undefined;

    const frames: TrainingTraceSmokeFrame[] = [];
    const replayFrames: TrainingTraceReplayFrame[] = [];
    const recorder: TrainingTraceRecorder = {
      recordDecision: (state, node, entry) => {
        const observation = buildAiObservation({
          state,
          viewpointPlayerId: node.actingPlayerId,
          mode: "player",
          getCardDefinitionById: opts.engine.getCardDefinitionById,
        });
        const stateSnapshot = measureAiWork(opts.telemetry, "state_copy", () =>
          cloneSerializable(state)
        );
        const observationSnapshot = cloneSerializable(observation);
        const selectedSnapshot = cloneSerializable(entry);
        const frame: TrainingTraceSmokeFrame = {
          frameIndex: metricAccumulator.decisionFrames,
          stateHash: hashSerializable(state),
          observationHash: hashSerializable(observation),
          state: stateSnapshot,
          observation: observationSnapshot,
          node: cloneSerializable(node),
          selected: selectedSnapshot,
        };
        const replayFrame: TrainingTraceReplayFrame = {
          state: stateSnapshot,
          label: traceLabel(entry),
          traceEntry: selectedSnapshot,
        };
        metricAccumulator.decisionFrames += 1;
        metricAccumulator.nodeKindCounts[frame.selected.nodeKind] += 1;
        if (frame.selected.truncated) {
          metricAccumulator.truncatedNodeCount += 1;
          firstTruncatedFrame ??= frame;
        }
        metricAccumulator.maxChoiceCount = Math.max(
          metricAccumulator.maxChoiceCount,
          frame.selected.choiceCount
        );
        lastFrame = frame;
        if (retainFrames) frames.push(frame);
        recording?.onFrame?.(frame);
        if (retainReplay) replayFrames.push(replayFrame);
        recording?.onReplayFrame?.(replayFrame);
      },
      recordFinal: (state, decisionSteps, transitionSteps, outcome) => {
        const replayFrame: TrainingTraceReplayFrame = {
          state: measureAiWork(opts.telemetry, "state_copy", () =>
            cloneSerializable(state)
          ),
          label: `final / ${outcome} / transitions ${transitionSteps} / decisions ${decisionSteps}`,
        };
        if (retainReplay) replayFrames.push(replayFrame);
        recording?.onReplayFrame?.(replayFrame);
      },
    };
    const result = playTrainingGameInner(opts, recorder);
    const metrics = buildTraceSmokeMetrics(result, metricAccumulator);
    return {
      ...result,
      frames,
      replay: {
        schemaVersion: 1,
        title,
        frames: replayFrames,
      },
      metrics,
      ...(lastFrame ? { lastFrame } : {}),
      ...(firstTruncatedFrame ? { firstTruncatedFrame } : {}),
    };
  } finally {
    Math.random = originalRandom;
  }
}

function actionInputChoicesForPending(
  state: GameState,
  action: LegalAction,
  opts: TrainingDecisionSurfaceOptions,
  limit: number
): ChoiceAccumulator<TrainingActionInputOptions> {
  return generateActionInputChoices(
    state,
    action,
    { ...opts, getTargetInput: targetInputGroupForTraining },
    limit
  );
}
function topLevelActionInputChoices(
  state: GameState,
  action: LegalAction,
  opts: TrainingDecisionSurfaceOptions,
  limit: number,
  options: { includeTargetInput?: boolean } = {}
): ChoiceAccumulator<TrainingActionInputOptions> {
  return generateTopLevelActionInputChoices(
    state,
    action,
    { ...opts, getTargetInput: targetInputGroupForTraining },
    limit,
    options
  );
}

export function createActionInputDecisionNode(
  state: GameState,
  action: LegalAction,
  opts: TrainingDecisionSurfaceOptions = {}
): TrainingDecisionNode | null {
  return measureAiWork(opts.telemetry, "input_generation", () =>
    createActionInputDecisionNodeInner(state, action, opts)
  );
}

export function getNextTrainingDecision(
  state: GameState,
  engine: Engine,
  opts: TrainingDecisionSurfaceOptions = {}
): TrainingDecisionNode | null {
  return measureAiWork(opts.telemetry, "legal_generation", () =>
    getNextTrainingDecisionInner(state, engine, opts)
  );
}

export function applyTrainingDecisionChoice(
  state: GameState,
  node: TrainingDecisionNode,
  choice: TrainingDecisionChoice,
  engine: Engine,
  telemetry?: AiWorkTelemetry
): GameState {
  return measureAiWork(telemetry, "engine_transition", () =>
    applyTrainingDecisionChoiceInner(state, node, choice, engine, telemetry)
  );
}

function playTrainingGameInner(
  opts: TrainingPlayOptions,
  recorder?: TrainingTraceRecorder
): TrainingGameResult {
  return measureAiWork(opts.telemetry, "game", () =>
    playTrainingGameUnmeasured(opts, recorder)
  );
}
