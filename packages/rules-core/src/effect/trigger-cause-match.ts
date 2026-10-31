import type { TriggerEventCause } from "../model";

export function triggerCauseMatches(
  allowed: TriggerEventCause,
  actual: TriggerEventCause
): boolean {
  if (allowed === "bp_compare") {
    return (
      actual === "bp_compare" ||
      actual === "opponent_bp_compare" ||
      actual === "self_bp_compare"
    );
  }
  return allowed === actual;
}

export function triggerCauseListMatches(
  allowedCauses: readonly TriggerEventCause[],
  actual: TriggerEventCause
): boolean {
  if (allowedCauses.some((cause) => triggerCauseMatches(cause, actual))) {
    return true;
  }
  return (
    actual === "opponent_bp_compare" &&
    allowedCauses.includes("opponent_effect") &&
    allowedCauses.includes("battle")
  );
}
