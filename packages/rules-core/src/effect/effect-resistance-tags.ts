import type { ResistableOutcome } from "../dsl-types";
import type { EffectResistanceAction } from "../model";

export type EffectResistanceTag = EffectResistanceAction["resistType"];

const OUTCOME_TO_RESISTANCE_TAG = {
  leave_field: "cannot_leave_field",
  destroy: "cannot_be_destroyed",
  bounce: "cannot_be_bounced",
  send_to_deck: "cannot_be_sent_to_deck",
  vanish: "cannot_be_vanished",
  remove_from_game: "cannot_be_removed_from_game",
  exhaust: "cannot_be_exhausted",
  core_below_min: "cannot_reduce_cores_below",
  targeted: "cannot_be_targeted",
  included: "cannot_include",
  bp_compare_destroy: "cannot_be_destroyed_by_bp_compare",
  enter_zone: "cannot_enter_zone",
} satisfies Record<ResistableOutcome, EffectResistanceTag>;

const RESISTANCE_TAGS = new Set<string>([
  ...Object.values(OUTCOME_TO_RESISTANCE_TAG),
  "replace_field_exit",
]);

export function effectResistanceTagForOutcome(
  outcome: ResistableOutcome | undefined
): EffectResistanceTag {
  return OUTCOME_TO_RESISTANCE_TAG[outcome ?? "leave_field"];
}

export function normalizeEffectResistanceTag(
  value: unknown
): EffectResistanceTag | undefined {
  if (typeof value !== "string") return undefined;
  if (RESISTANCE_TAGS.has(value)) return value as EffectResistanceTag;
  return OUTCOME_TO_RESISTANCE_TAG[value as ResistableOutcome];
}
