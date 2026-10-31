import type {
  AiObservationCardVocabulary,
  EncodedAiObservation,
} from "./ai-observation-encoder";
import type { CardDefinition } from "./model";
import {
  AI_DECISION_APPLY_OPTION_FIELDS,
  PLAYER_DECISION_NODE_KINDS,
  PLAYER_PREGAME_CHOICE_KINDS,
  type AiDecisionApplyOptionField,
} from "./player-decision-contract";
import type { LegalAction } from "./legal/legal-actions-types";
import type {
  TrainingDecisionChoice,
  TrainingDecisionNode,
} from "./training-decision-surface";
import { TRAINING_SYSTEM_ACTION_KINDS } from "./training-decision-surface";

export const ACTION_KINDS = [
  "abort_pending_core_distribution",
  "abort_pending_multi_placement",
  "activate_soul_state",
  "attack",
  "block",
  "brave_combine",
  "brave_separate",
  "brave_swap",
  "confirm_target_redirect",
  "contract_combine",
  "declare_advent",
  "declare_dual_host_advent",
  "declare_host_dual_advent",
  "declare_manifest",
  "declare_private_triggered_effect",
  "decline_block",
  "decline_field_hand_swap",
  "decline_hand_trash_swap",
  "decline_pending_burst_check",
  "decline_target_redirect",
  "end_attack_step",
  "flip_instead_of_attack",
  "join_active_attack",
  "link_aid",
  "open_battle_flash",
  "pass_battle_flash",
  "pass_pre_declaration_stack",
  "pass_stack",
  "place_nexus",
  "resolve_advent_source_replacement",
  "resolve_battle_immediate_effect",
  "resolve_brave_attack_continuation",
  "resolve_brave_combine_choice",
  "resolve_brave_leave_choice",
  "resolve_borrowed_effect_choice",
  "resolve_borrowed_effect_target",
  "resolve_connect_battle_decision",
  "resolve_core_source_allocation",
  "resolve_field_magic_pre_cost_trigger",
  "resolve_pay_to_act_core_gate",
  "resolve_pay_to_act_hand_discard_gate",
  "resolve_pending_burst_check",
  "resolve_pending_change_cleanup_choice",
  "resolve_pending_core_count",
  "resolve_pending_core_distribution",
  "resolve_pending_core_shoot",
  "resolve_pending_core_split",
  "resolve_pending_count_decrease",
  "resolve_pending_deck_reveal_count_boost_choice",
  "resolve_pending_deck_reveal_order",
  "resolve_pending_deck_reveal_pick",
  "resolve_pending_discard_set_burst_count",
  "resolve_pending_draw_step_cost_choice",
  "resolve_pending_as_if_soul_core_choice",
  "resolve_pending_effect_optional_repeat_choice",
  "resolve_pending_effect_optional_repeat_count",
  "resolve_pending_effect_summon_cost_payment",
  "resolve_pending_effect_target",
  "resolve_pending_enter_field_placement",
  "resolve_pending_grouped_summon_cost_override_choice",
  "resolve_pending_life_core_selection",
  "resolve_pending_life_damage_discard_choice",
  "resolve_pending_life_gain_replacement_choice",
  "resolve_pending_link_aid_cost_source_choice",
  "resolve_pending_multi_placement",
  "resolve_pending_split_summon_choice",
  "resolve_pending_step_choice",
  "resolve_pending_step_optional_choice",
  "resolve_pending_step_optional_target_selection",
  "resolve_pending_summon_cost_core_move_choice",
  "resolve_pending_summon_cost_exclude_choice",
  "resolve_pending_triggered_effect",
  "resolve_pending_zone_selection",
  "resolve_reverse_rebirth_summon",
  "resolve_set_aside_exit_replacement_choice",
  "resolve_soul_state_replacement",
  "resolve_tensho_summon",
  "select_pending_to_resolve",
  "set_burst",
  "set_mirage",
  "set_quartz",
  "skip_private_triggered_effect",
  "summon",
  "swap_field_hand",
  "swap_hand_trash",
  "use_accel",
  "use_change",
  "use_divine_skill",
  "use_field_card_effect",
  "use_hand_card_effect",
  "use_magic",
  "decline_immediate_attack_join",
] as const satisfies readonly LegalAction["kind"][];

const KIND_INDEX = new Map(ACTION_KINDS.map((kind, index) => [kind, index]));
export const ACTION_KIND_UNK = ACTION_KINDS.length;

export const TRAINING_CHOICE_CHANNELS = [
  "legal_action",
  "system_action",
  "pregame",
  "action_input",
] as const;

const CHANNEL_INDEX = new Map(
  TRAINING_CHOICE_CHANNELS.map((channel, index) => [channel, index])
);
const NODE_KIND_INDEX = new Map(
  PLAYER_DECISION_NODE_KINDS.map((kind, index) => [kind, index])
);
const SYSTEM_ACTION_INDEX = new Map(
  TRAINING_SYSTEM_ACTION_KINDS.map((kind, index) => [kind, index])
);
const PREGAME_CHOICE_INDEX = new Map(
  PLAYER_PREGAME_CHOICE_KINDS.map((kind, index) => [kind, index])
);
const APPLY_OPTION_FIELD_INDEX = new Map(
  AI_DECISION_APPLY_OPTION_FIELDS.map((field, index) => [field, index])
);

const TIMINGS: readonly string[] = ["normal", "flash", "stack"];
const PASS_KINDS = new Set<LegalAction["kind"]>([
  "pass_stack",
  "pass_battle_flash",
  "pass_pre_declaration_stack",
  "decline_block",
  "decline_pending_burst_check",
  "decline_target_redirect",
  "end_attack_step",
  "abort_pending_core_distribution",
  "abort_pending_multi_placement",
]);
const PASS_KIND_SCHEMA_VALUES = [...PASS_KINDS].sort();

export interface EncodedAction {
  kindIndex: number;
  sourceEmbIndex: number;
  sourceTokenIndex: number;
  targetTokenIndex: number;
  feats: number[];
}

export interface EncodeActionOptions {
  cardVocabulary?: AiObservationCardVocabulary;
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}

export interface EncodeTrainingDecisionChoiceOptions extends EncodeActionOptions {
  node: TrainingDecisionNode;
  choice: TrainingDecisionChoice;
  encodedObservation: EncodedAiObservation;
}

export interface EncodedTrainingDecisionChoice {
  choiceId: string;
  channelIndex: number;
  action: EncodedAction;
  feats: number[];
}

type AnyRecord = Record<string, unknown>;

function numberValue(record: AnyRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function stringValue(record: AnyRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function oneHotIndex(index: number, size: number): number[] {
  const values = new Array(size).fill(0);
  if (index >= 0 && index < size) values[index] = 1;
  return values;
}

function ratio(value: number, denominator: number): number {
  return denominator <= 0 ? 0 : value / denominator;
}

function vocabularyIndex(
  vocabulary: AiObservationCardVocabulary | undefined,
  cardNo: string | undefined
): number {
  if (vocabulary === undefined || cardNo === undefined) return 0;
  if ("get" in vocabulary && typeof vocabulary.get === "function") {
    return vocabulary.get(cardNo) ?? 0;
  }
  return (vocabulary as Readonly<Record<string, number>>)[cardNo] ?? 0;
}

function sourceCardNo(
  action: AnyRecord,
  options: EncodeActionOptions
): string | undefined {
  const explicit = stringValue(action, "sourceCardNo");
  if (explicit !== undefined) return explicit;
  const definitionId = stringValue(action, "sourceDefinitionId");
  if (definitionId === undefined) return undefined;
  return options.getCardDefinitionById?.(definitionId)?.cardNo ?? definitionId;
}

export function encodeAction(
  action: LegalAction,
  encodedObservation: Pick<EncodedAiObservation, "cardInstanceIds">,
  options: EncodeActionOptions = {}
): EncodedAction {
  const record = action as unknown as AnyRecord;
  const kindIndex = KIND_INDEX.get(action.kind) ?? ACTION_KIND_UNK;
  const sourceInstanceId = stringValue(record, "sourceInstanceId");
  const targetInstanceId = stringValue(record, "targetInstanceId");
  const sourceTokenIndex = sourceInstanceId
    ? encodedObservation.cardInstanceIds.indexOf(sourceInstanceId)
    : -1;
  const targetTokenIndex = targetInstanceId
    ? encodedObservation.cardInstanceIds.indexOf(targetInstanceId)
    : -1;
  const sourceEmbIndex = vocabularyIndex(
    options.cardVocabulary,
    sourceCardNo(record, options)
  );

  const cost =
    numberValue(record, "finalCost") ??
    numberValue(record, "coreCost") ??
    numberValue(record, "reducedCost") ??
    0;
  const candidates = record.candidateTargetInstanceIds;
  const candidateCount = Array.isArray(candidates) ? candidates.length : 0;
  const requiredTargetCount = numberValue(record, "requiredTargetCount") ?? 0;
  const maxTargetCount =
    numberValue(record, "maxTargetCount") ?? requiredTargetCount;
  const timing = stringValue(record, "timing");
  const timingIndex = timing === undefined ? -1 : TIMINGS.indexOf(timing);
  const skillIndex = numberValue(record, "skillIndex") ?? 0;

  return {
    kindIndex,
    sourceEmbIndex,
    sourceTokenIndex,
    targetTokenIndex,
    feats: [
      ...oneHotIndex(kindIndex, ACTION_KINDS.length + 1),
      sourceInstanceId ? 1 : 0,
      sourceTokenIndex >= 0 ? 1 : 0,
      targetTokenIndex >= 0 ? 1 : 0,
      ratio(cost, 12),
      ratio(candidateCount, 20),
      ratio(requiredTargetCount, 10),
      ratio(maxTargetCount, 10),
      stringValue(record, "targetMode") === "manual" ? 1 : 0,
      ...oneHotIndex(timingIndex, TIMINGS.length),
      ratio(skillIndex, 8),
      PASS_KINDS.has(action.kind) ? 1 : 0,
    ],
  };
}

export const ACTION_FEAT_DIM =
  ACTION_KINDS.length +
  1 +
  1 +
  1 +
  1 +
  1 +
  1 +
  1 +
  1 +
  1 +
  TIMINGS.length +
  1 +
  1;

function zeroAction(): EncodedAction {
  return {
    kindIndex: ACTION_KIND_UNK,
    sourceEmbIndex: 0,
    sourceTokenIndex: -1,
    targetTokenIndex: -1,
    feats: new Array(ACTION_FEAT_DIM).fill(0),
  };
}

function choiceChannel(choice: TrainingDecisionChoice) {
  if (choice.action !== undefined) return "legal_action";
  if (choice.systemAction !== undefined) return "system_action";
  if (choice.preGameChoice !== undefined) return "pregame";
  return "action_input";
}

function applyOptionFieldMask(
  choice: TrainingDecisionChoice
): readonly number[] {
  const mask = new Array(AI_DECISION_APPLY_OPTION_FIELDS.length).fill(0);
  for (const field of Object.keys(choice.applyOptions ?? {})) {
    const index = APPLY_OPTION_FIELD_INDEX.get(
      field as AiDecisionApplyOptionField
    );
    if (index !== undefined) mask[index] = 1;
  }
  return mask;
}

export const TRAINING_CHOICE_FEAT_DIM =
  PLAYER_DECISION_NODE_KINDS.length +
  TRAINING_CHOICE_CHANNELS.length +
  ACTION_FEAT_DIM +
  TRAINING_SYSTEM_ACTION_KINDS.length +
  PLAYER_PREGAME_CHOICE_KINDS.length +
  AI_DECISION_APPLY_OPTION_FIELDS.length +
  5;

/**
 * Stable, ordered description of every position in a training choice feature
 * vector. Checkpoints record this rather than relying on the vector length:
 * inserting a field, reordering a segment, or changing a ratio denominator
 * must make existing `choiceW` weights incompatible.
 */
export const TRAINING_CHOICE_FEATURE_SCHEMA_FINGERPRINT = JSON.stringify({
  featureLayout: [
    {
      kind: "one_hot",
      id: "node_kind",
      values: PLAYER_DECISION_NODE_KINDS,
    },
    {
      kind: "one_hot",
      id: "choice_channel",
      values: TRAINING_CHOICE_CHANNELS,
    },
    {
      kind: "one_hot",
      id: "action_kind",
      values: [...ACTION_KINDS, "unknown"],
    },
    { kind: "boolean", id: "has_source_instance" },
    { kind: "boolean", id: "has_source_token" },
    { kind: "boolean", id: "has_target_token" },
    { kind: "ratio", id: "cost", denominator: 12 },
    { kind: "ratio", id: "candidate_count", denominator: 20 },
    { kind: "ratio", id: "required_target_count", denominator: 10 },
    { kind: "ratio", id: "max_target_count", denominator: 10 },
    { kind: "boolean", id: "manual_target_mode" },
    { kind: "one_hot", id: "timing", values: TIMINGS },
    { kind: "ratio", id: "skill_index", denominator: 8 },
    {
      kind: "boolean",
      id: "is_pass_kind",
      // The boolean's meaning changes when this membership changes, even though
      // the vector's width does not. Preserve the stable, sorted membership so
      // an old checkpoint cannot silently reinterpret the feature.
      values: PASS_KIND_SCHEMA_VALUES,
    },
    {
      kind: "one_hot",
      id: "system_action_kind",
      values: TRAINING_SYSTEM_ACTION_KINDS,
    },
    {
      kind: "one_hot",
      id: "pregame_choice_kind",
      values: PLAYER_PREGAME_CHOICE_KINDS,
    },
    {
      kind: "multi_hot",
      id: "ai_decision_apply_option_field",
      values: AI_DECISION_APPLY_OPTION_FIELDS,
    },
    { kind: "boolean", id: "has_legal_action" },
    { kind: "boolean", id: "has_system_action" },
    { kind: "boolean", id: "has_pregame_choice" },
    { kind: "boolean", id: "has_apply_options" },
    { kind: "ratio", id: "choice_count", denominator: 256 },
  ],
});

export function encodeTrainingDecisionChoice(
  options: EncodeTrainingDecisionChoiceOptions
): EncodedTrainingDecisionChoice {
  const { node, choice, encodedObservation } = options;
  const channel = choiceChannel(choice);
  const channelIndex = CHANNEL_INDEX.get(channel) ?? -1;
  const action =
    choice.action === undefined
      ? zeroAction()
      : encodeAction(choice.action, encodedObservation, options);
  const systemActionIndex =
    choice.systemAction === undefined
      ? -1
      : (SYSTEM_ACTION_INDEX.get(choice.systemAction.kind) ?? -1);
  const preGameChoiceIndex =
    choice.preGameChoice === undefined
      ? -1
      : (PREGAME_CHOICE_INDEX.get(choice.preGameChoice.kind) ?? -1);
  const nodeKindIndex = NODE_KIND_INDEX.get(node.kind) ?? -1;

  return {
    choiceId: choice.choiceId,
    channelIndex,
    action,
    feats: [
      ...oneHotIndex(nodeKindIndex, PLAYER_DECISION_NODE_KINDS.length),
      ...oneHotIndex(channelIndex, TRAINING_CHOICE_CHANNELS.length),
      ...action.feats,
      ...oneHotIndex(systemActionIndex, TRAINING_SYSTEM_ACTION_KINDS.length),
      ...oneHotIndex(preGameChoiceIndex, PLAYER_PREGAME_CHOICE_KINDS.length),
      ...applyOptionFieldMask(choice),
      choice.action !== undefined ? 1 : 0,
      choice.systemAction !== undefined ? 1 : 0,
      choice.preGameChoice !== undefined ? 1 : 0,
      choice.applyOptions !== undefined ? 1 : 0,
      // Enumeration position and delivery IDs are not semantic choice data.
      // Keep this shared by live inference and replay-batch encoding so that
      // reordering the candidates only permutes the corresponding scores.
      ratio(node.choices.length, 256),
    ],
  };
}
