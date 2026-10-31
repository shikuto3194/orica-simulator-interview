import type { DraftCoreMove } from "./core/core-draft";
import type {
  ApplyLegalActionOptions,
  LegalAction,
} from "./legal/legal-actions-types";
import type { PreGamePhase } from "./model";

/**
 * PlayerDecision は、人間/AI/将来の matching server が送る「選択肢」の契約。
 * LegalAction はこの一部であり、ステップ送り・手動コア移動・preGame・追加入力は
 * ここで同じ decision surface に束ねる。
 */
export const PLAYER_DECISION_NODE_KINDS = [
  "pregame",
  "legal_action",
  "action_input",
] as const;

export type PlayerDecisionNodeKind =
  (typeof PLAYER_DECISION_NODE_KINDS)[number];

export const PLAYER_SYSTEM_ACTION_KINDS = [
  "advance_step",
  "manual_core_move",
] as const;

export type PlayerSystemActionKind =
  (typeof PLAYER_SYSTEM_ACTION_KINDS)[number];

export type PlayerSystemAction =
  | { kind: "advance_step"; actingPlayerId: string }
  | {
      kind: "manual_core_move";
      actingPlayerId: string;
      drafts: readonly DraftCoreMove[];
    };

export type JankenHand = "rock" | "scissors" | "paper";

export const PLAYER_PREGAME_CHOICE_KINDS = [
  "contract_presentation",
  "contract_confirm",
  "janken",
  "first_player",
  "mulligan",
] as const;

export type PlayerPreGameChoiceKind =
  (typeof PLAYER_PREGAME_CHOICE_KINDS)[number];

export type PlayerPreGameChoice =
  | { kind: "contract_presentation"; playerId: string; present: boolean }
  | { kind: "contract_confirm"; playerId: string }
  | { kind: "janken"; playerId: string; hand: JankenHand }
  | { kind: "first_player"; playerId: string; firstPlayerId: string }
  | { kind: "mulligan"; playerId: string; mulligan: boolean };

export type PreGamePhaseDecisionRole = "player_choice" | "terminal";

export const PLAYER_PREGAME_PHASE_DECISION_ROLES = {
  waiting_contract: "player_choice",
  contract_confirm: "player_choice",
  waiting_janken: "player_choice",
  janken_resolved: "player_choice",
  waiting_order_pick: "player_choice",
  order_decided: "player_choice",
  waiting_mulligan_first: "player_choice",
  waiting_mulligan_second: "player_choice",
  pregame_complete: "terminal",
} as const satisfies Record<PreGamePhase, PreGamePhaseDecisionRole>;

export type ApplyOptionFieldRole = "engine_context" | "ai_decision";

export const APPLY_OPTION_FIELD_ROLES = {
  action: "engine_context",
  getCardDefinitionById: "engine_context",
  getConditionalCostCanExecuteCheck: "engine_context",
  getConditionalResultSuccessCheck: "engine_context",
  getHandWrittenBurstPostResolutionPolicy: "engine_context",
  getHandWrittenEffectResolver: "engine_context",
  getPendingBurstCheckResolver: "engine_context",
  getPendingTriggeredEffectResolver: "engine_context",
  getRegisteredBattleImmediateEffectActions: "engine_context",
  getRegisteredBurstActions: "engine_context",
  getRegisteredFieldCardEffectActions: "engine_context",
  getRegisteredHandActivatedEffectActions: "engine_context",
  getRegisteredMagicActions: "engine_context",
  getRegisteredTriggeredEffectActions: "engine_context",
  resolveFieldCardEffect: "engine_context",
  resolvePendingBurstCheck: "engine_context",
  resolvePendingTriggeredEffect: "engine_context",
  state: "engine_context",

  additionalAttackExhaustCostSourceInstanceIds: "ai_decision",
  additionalSourceInstanceIds: "ai_decision",
  chosenLifeCoreKind: "ai_decision",
  coreCountSelection: "ai_decision",
  coreDistributionAllocations: "ai_decision",
  coreDistributionSoulCoreAllocations: "ai_decision",
  coreDistributionSoulCoreInstanceId: "ai_decision",
  coreDistributionSoulCoreSourceAllocations: "ai_decision",
  coreDistributionSourceAllocations: "ai_decision",
  coreShootDistribution: "ai_decision",
  coreShootSoulCoreInstanceId: "ai_decision",
  coreSourceAllocations: "ai_decision",
  coreSourceSoulCoreInstanceId: "ai_decision",
  coreSplitDistribution: "ai_decision",
  countDecreaseSelection: "ai_decision",
  deckRevealPickFreeDestination: "ai_decision",
  deckRevealPlacement: "ai_decision",
  deckRevealRemainderOrder: "ai_decision",
  deckRevealRemainderPlacements: "ai_decision",
  deferPayCostSourceSelection: "ai_decision",
  discardSetBurstCountSelection: "ai_decision",
  drawStepCostChoice: "ai_decision",
  drawStepCostDiscardCardInstanceId: "ai_decision",
  enterFieldCorePlacements: "ai_decision",
  fieldMagicPreCostTriggerDecision: "ai_decision",
  followUpChosenLifeCoreKind: "ai_decision",
  followUpPerTargetInputs: "ai_decision",
  followUpTargetInstanceIds: "ai_decision",
  groupedSummonCostOverrideSelectedCardInstanceIds: "ai_decision",
  lifeCorePartitionChoice: "ai_decision",
  lifeDamageDiscardChoice: "ai_decision",
  lifeGainReplacementChoice: "ai_decision",
  multiPlacementAllocations: "ai_decision",
  paidPreventionImmunityCardSelection: "ai_decision",
  payCostPaymentSources: "ai_decision",
  paymentSources: "ai_decision",
  deckRevealMiragePaymentSourcesByInstanceId: "ai_decision",
  payToActCoreGateDecline: "ai_decision",
  payToActCoreSourceContainerId: "ai_decision",
  payToActCoreKind: "ai_decision",
  payToActHandDiscardCardInstanceIds: "ai_decision",
  payToActHandDiscardGateDecline: "ai_decision",
  redirectTargetReplacementInstanceId: "ai_decision",
  redirectTargetReplacementInstanceIds: "ai_decision",
  selectedDeckRevealCardIds: "ai_decision",
  selectedZoneCardIds: "ai_decision",
  separateCoreDistribution: "ai_decision",
  skipOptionalEffect: "ai_decision",
  splitSummonTokenCount: "ai_decision",
  splitSummonZoneCardInstanceIds: "ai_decision",
  summonCostCoreMoveDestination: "ai_decision",
  summonCostCoreMoveAllocations: "ai_decision",
  summonCostCoreMoveSelectedCount: "ai_decision",
  summonCostExcludeSelectedCardInstanceIds: "ai_decision",
  summonEnterFieldCorePlacements: "ai_decision",
  summonPaymentSources: "ai_decision",
  swapTargetInstanceId: "ai_decision",
  targetInstanceIds: "ai_decision",
  zoneSelectionDestinationByCardId: "ai_decision",
} as const satisfies Record<
  keyof ApplyLegalActionOptions,
  ApplyOptionFieldRole
>;

export type AiDecisionApplyOptionField = {
  [K in keyof typeof APPLY_OPTION_FIELD_ROLES]: (typeof APPLY_OPTION_FIELD_ROLES)[K] extends "ai_decision"
    ? K
    : never;
}[keyof typeof APPLY_OPTION_FIELD_ROLES];

export const AI_DECISION_APPLY_OPTION_FIELDS = Object.entries(
  APPLY_OPTION_FIELD_ROLES
)
  .filter(([, role]) => role === "ai_decision")
  .map(([field]) => field)
  .sort() as AiDecisionApplyOptionField[];

export type PlayerActionInputOptions = Partial<
  Pick<ApplyLegalActionOptions, AiDecisionApplyOptionField>
>;

export const SELFPLAY_AUTO_INPUT_FIELDS = [
  "coreDistributionAllocations",
  "coreDistributionSoulCoreAllocations",
  "coreDistributionSoulCoreSourceAllocations",
  "coreDistributionSourceAllocations",
  "coreShootDistribution",
  "coreShootSoulCoreInstanceId",
  "coreSourceAllocations",
  "coreSourceSoulCoreInstanceId",
  "coreSplitDistribution",
  "deckRevealPickFreeDestination",
  "deckRevealPlacement",
  "deckRevealRemainderOrder",
  "deckRevealRemainderPlacements",
  "enterFieldCorePlacements",
  "lifeCorePartitionChoice",
  "paidPreventionImmunityCardSelection",
  "paymentSources",
  "selectedDeckRevealCardIds",
  "selectedZoneCardIds",
  "summonCostCoreMoveAllocations",
  "summonCostCoreMoveSelectedCount",
  "summonCostExcludeSelectedCardInstanceIds",
  "summonPaymentSources",
  "targetInstanceIds",
  "zoneSelectionDestinationByCardId",
] as const satisfies readonly AiDecisionApplyOptionField[];

export type PlayerDecisionCommand =
  | {
      kind: "legal_action";
      actingPlayerId: string;
      action: LegalAction;
      applyOptions?: PlayerActionInputOptions;
    }
  | { kind: "system_action"; action: PlayerSystemAction }
  | { kind: "pregame"; choice: PlayerPreGameChoice }
  | {
      kind: "action_input";
      actingPlayerId: string;
      actionKind: LegalAction["kind"];
      applyOptions: PlayerActionInputOptions;
    };
