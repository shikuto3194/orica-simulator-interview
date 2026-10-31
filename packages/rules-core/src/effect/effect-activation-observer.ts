export function didEffectActivationFail(
  logEntries: readonly string[],
  sourceInstanceId: string
): boolean {
  return logEntries.some(
    (entry) =>
      entry === `effect:applicability-unmet:${sourceInstanceId}` ||
      entry === `effect:condition-unmet:${sourceInstanceId}` ||
      entry === `effect:conditional-cost-effect-failed:${sourceInstanceId}` ||
      entry === `effect:conditional-cost-target-shortage:${sourceInstanceId}` ||
      entry.startsWith(`effect:no-duplicate-skipped:${sourceInstanceId}:`) ||
      isBeforeStepEffectSuppressionFailure(entry, sourceInstanceId)
  );
}

function isBeforeStepEffectSuppressionFailure(
  entry: string,
  sourceInstanceId: string
): boolean {
  const prefix = "reevaluation:before_each_step:failed:";
  if (!entry.startsWith(prefix)) return false;
  const parts = entry.slice(prefix.length).split(":");
  const failedChecks = parts[0]?.split(",") ?? [];
  if (!failedChecks.includes("effect_suppression")) return false;
  const sourcePart = parts.find((part) => part.startsWith("source="));
  return (
    sourcePart === undefined || sourcePart === `source=${sourceInstanceId}`
  );
}
