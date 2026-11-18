import type {
  Condition,
  ConditionClause,
  TriggerConditionObservationResults,
} from "../model";

function isObservationRecord(
  value: unknown
): value is Readonly<Record<string, boolean>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((result) => typeof result === "boolean")
  );
}

function isObservationResults(
  value: unknown
): value is TriggerConditionObservationResults {
  return (
    isObservationRecord(value) ||
    (Array.isArray(value) && value.every(isObservationRecord))
  );
}

function isEventObservationClause(clause: ConditionClause): boolean {
  // related_instance_off_field は正源どおり「評価時点の場所」を見る動的条件。
  return (
    clause.kind.startsWith("trigger_") &&
    clause.kind !== "trigger_related_instance_off_field"
  );
}

/** 旧pending（観測表なし）と、観測表はあるが述語値が欠落した入力を区別する。 */
export function getObservedTriggerConditionResults(
  source:
    | { eventConditionResults?: TriggerConditionObservationResults }
    | undefined
): TriggerConditionObservationResults | undefined {
  if (source === undefined) return undefined;
  const results = source.eventConditionResults;
  return isObservationResults(results) ? results : {};
}

/** イベント述語だけを共通評価器で収集時に評価する。動的条件の値は保存しない。 */
export function collectTriggerConditionResults(
  condition: Condition,
  evaluate: (condition: Condition) => boolean
): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  const visit = (clauses: Condition, prefix: string) => {
    clauses.forEach((clause, index) => {
      const path = `${prefix}${index}`;
      if (clause.kind === "any_of")
        clause.groups.forEach((group, groupIndex) =>
          visit(group, `${path}/${groupIndex}/`)
        );
      else if (isEventObservationClause(clause))
        results[path] = evaluate([clause]);
    });
  };
  visit(condition, "");
  return results;
}

/** AND/ORを維持し、保存済みイベント述語と現在の動的条件を同じ評価器へ渡す。 */
export function applyTriggerConditionResults(
  condition: Condition,
  results: TriggerConditionObservationResults | undefined,
  observeOnly = false
): Condition {
  // A combined delivery may represent several real occurrences. Preserve each
  // occurrence's complete condition tree: merging individual clause truth values
  // would incorrectly make A AND B true when separate occurrences only met one.
  if (Array.isArray(results)) {
    return [
      {
        kind: "any_of",
        groups: results.every(isObservationRecord)
          ? results.map((record) =>
              applyTriggerConditionResults(condition, record, observeOnly)
            )
          : [],
      },
    ];
  }
  const observed = results as Readonly<Record<string, boolean>> | undefined;
  const visit = (clauses: Condition, prefix: string): Condition =>
    clauses.flatMap<ConditionClause>((clause, index) => {
      const path = `${prefix}${index}`;
      if (clause.kind === "any_of")
        return [
          {
            ...clause,
            groups: clause.groups.map((group, groupIndex) =>
              visit(group, `${path}/${groupIndex}/`)
            ),
          },
        ];
      if (isEventObservationClause(clause)) {
        if (observed === undefined) return [clause]; // 旧snapshotの互換
        // 空ANDはtrue、空ORはfalse。欠落/不正な保存値はfail-closed。
        return isObservationRecord(observed) &&
          Object.hasOwn(observed, path) &&
          observed[path] === true
          ? []
          : [{ kind: "any_of", groups: [] }];
      }
      return observeOnly ? [] : [clause];
    });
  return visit(condition, "");
}

/** JSON state内の全pending/stack/復元snapshotを表示へ投影する。元stateは変更しない。 */
export function projectTriggerConditionObservations<T>(value: T): {
  value: T;
  hasTimingObservations: boolean;
} {
  let hasTimingObservations = false;
  const caches = [
    new WeakMap<object, unknown>(),
    new WeakMap<object, unknown>(),
    new WeakMap<object, unknown>(),
  ];
  const visit = (current: unknown, context = 0): unknown => {
    if (current === null || typeof current !== "object") return current;
    const cache = caches[context]!;
    if (cache.has(current)) return cache.get(current);
    let result: Record<string, unknown> | unknown[] = current as Record<
      string,
      unknown
    >;
    for (const [key, child] of Object.entries(current)) {
      if (
        key === "observationSnapshot" ||
        key === "effectActivationObservationSnapshot" ||
        key === "eventConditionResults" ||
        key === "eventFactOccurrences" ||
        key === "effectActivationEventFactOccurrences" ||
        key === "oracleTriggerCardFact" ||
        key === "oracleTriggerEventFacts"
      ) {
        hasTimingObservations = true;
        if (result === current) result = { ...current };
        delete (result as Record<string, unknown>)[key];
        continue;
      }
      const next = visit(
        child,
        key === "timingSourceRegistrations" ? 1 : context === 1 ? 2 : 0
      );
      if (next !== child) {
        if (result === current)
          result = Array.isArray(current) ? [...current] : { ...current };
        (result as Record<string, unknown>)[key] = next;
      }
    }
    cache.set(current, result);
    return result;
  };
  const projected = visit(value) as T;
  return { value: projected, hasTimingObservations };
}
