/**
 * Effect-level optionality detector.
 *
 * 2026-08-09 ruling:
 * - If the first operative sentence is optional and later mandatory sentences
 *   only make sense after that optional action resolved, the whole effect is
 *   optional.
 * - If the optional sentence is a single operative step, the whole effect is
 *   optional and the step itself should stay mandatory after the effect fires.
 * - If later optional sentences all depend on the first optional sentence, the
 *   first step should still stay mandatory after the effect fires; keep
 *   step-level optional only on the later dependent optional steps.
 * - If a later mandatory sentence can stand without the previous optional
 *   action, the whole effect remains mandatory.
 */

import {
  hasOptionalWording,
  stepHasOptionalExpression,
} from "./optional-wording-detector.mjs";

const EFFECT_LEVEL_IRRELEVANT_TIMINGS = new Set(["activated", "continuous"]);

function isHeaderOnlyLine(line) {
  const s = String(line || "").trim();
  if (!s) return true;
  if (/^(?:メイン|フラッシュ|スタック)$/.test(s)) return true;
  if (/^Lv[0-9０-９,\-ー・]+(?:-Lv[0-9０-９]+)*.*『[^』]+』$/.test(s)) {
    return true;
  }
  if (/^【[^】]+】(?:『[^』]+』)?$/.test(s)) return true;
  if (/^【[^】]+】（[^。]*）$/.test(s)) return true;
  if (/^《[^》]+》$/.test(s)) return true;
  return false;
}

export function effectReferencedText(textLines, textRef) {
  if (!Array.isArray(textRef)) return "";
  return textRef.map((idx) => textLines?.[idx] ?? "").join("\n");
}

export function effectBodyText(textLines, textRef) {
  if (!Array.isArray(textRef)) return "";
  return textRef
    .map((idx) => textLines?.[idx] ?? "")
    .filter((line) => !isHeaderOnlyLine(line))
    .join("\n");
}

export function hasOptionalIntentText(text) {
  return hasOptionalWording(text);
}

function isFirstStepOptionalDependencyRoot(step) {
  if (!step) return false;
  if (isStepExecutionModeOptional(step)) return true;
  if (step.repeat?.optional === true) return true;
  const action = step.action;
  if (!action) return false;
  if (action.optional === true) return true;
  if (["revealed_choice", "optional_branch"].includes(action.kind)) return true;
  if (action.kind === "life_gain_replacement") return true;
  const payment = action.useCostPayment;
  if (payment) {
    if (payment.kind === "discard_hand") return true;
    if (
      payment.kind === "exclude" &&
      (payment.minCount === undefined || payment.minCount === 0)
    ) {
      return true;
    }
  }
  return false;
}

function isStepExecutionModeOptional(step) {
  if (!step) return false;
  return (
    step.executionMode === "optional" || step.executionMode?.kind === "optional"
  );
}

const COUNT_ZERO_OPTIONAL_COUNT_SOURCE_TEXT =
  "自分のカウント0のとき、自分のカウント+1できる。";
const COUNT_ZERO_OPTIONAL_COUNT_RE =
  /自分のカウント0のとき、自分のカウント\+1できる/;

function isCountZeroSelfCountIncreaseStep(step) {
  if (!step?.action) return false;
  const action = step.action;
  if (
    action.kind !== "count_increase" ||
    action.player !== "self" ||
    action.amount !== 1
  ) {
    return false;
  }
  const conditions = Array.isArray(step.condition) ? step.condition : [];
  return conditions.some(
    (condition) =>
      condition?.kind === "count_value" &&
      condition.player === "self" &&
      condition.max === 0
  );
}

function isDependentMandatoryStep(step) {
  if (!step) return false;
  if (step.connector === "unless_previous_succeeded") return false;
  if (step.stepCondition) return true;
  // after_triggers は誘発の解決待ちだけを表し、前段の成功は要求しない。
  return (
    step.connector === "conditional_result" ||
    step.connector === "conditional_cost"
  );
}

export function findEffectLevelOptionalityIssue(effect, textLines) {
  if (!effect || effect.stub) return null;
  if (effect.executionMode === "optional") return null;
  if (EFFECT_LEVEL_IRRELEVANT_TIMINGS.has(effect.timing?.kind)) return null;
  const steps = Array.isArray(effect.steps) ? effect.steps : [];
  if (steps.length < 1) return null;
  if (!isFirstStepOptionalDependencyRoot(steps[0])) return null;

  const body = effectBodyText(textLines, effect.textRef);
  const referencedText = effectReferencedText(textLines, effect.textRef);
  if (!hasOptionalIntentText(body || referencedText)) return null;

  if (steps.length === 1) {
    return {
      kind: "effect_level_optional_missing",
      detail:
        "単一 optional step の発揮有無を step-level だけで表しているが effect.executionMode が optional ではない",
      dependentStepIndexes: [],
    };
  }

  const laterMandatorySteps = steps
    .slice(1)
    .map((step, offset) => ({ step, stepIndex: offset + 1 }))
    .filter(({ step }) => !stepHasOptionalExpression(step));
  if (laterMandatorySteps.length === 0) return null;

  const independent = laterMandatorySteps.find(
    ({ step }) => !isDependentMandatoryStep(step)
  );
  if (independent) return null;

  return {
    kind: "effect_level_optional_missing",
    detail:
      "先頭 step が任意で、後続 mandatory step がすべて前段結果依存だが effect.executionMode が optional ではない",
    dependentStepIndexes: laterMandatorySteps.map(({ stepIndex }) => stepIndex),
  };
}

function collectReferencedStepIds(condition, out = []) {
  if (!condition || typeof condition !== "object") return out;
  if (typeof condition.stepId === "string") out.push(condition.stepId);
  if (Array.isArray(condition.conditions)) {
    for (const child of condition.conditions)
      collectReferencedStepIds(child, out);
  }
  return out;
}

function isStepDependentOnRootChain(
  step,
  knownDependentIds,
  previousWasDependent
) {
  if (!step) return false;
  if (step.connector === "unless_previous_succeeded") return false;
  const refIds = collectReferencedStepIds(step.stepCondition);
  if (refIds.length > 0) {
    return refIds.every((id) => knownDependentIds.has(id));
  }
  if (
    step.connector === "conditional_result" ||
    step.connector === "conditional_cost"
  ) {
    return previousWasDependent;
  }
  return false;
}

export function findRedundantRootStepOptionalityIssue(effect, textLines) {
  if (!effect || effect.stub) return null;
  if (effect.executionMode !== "optional") return null;
  if (EFFECT_LEVEL_IRRELEVANT_TIMINGS.has(effect.timing?.kind)) return null;
  const steps = Array.isArray(effect.steps) ? effect.steps : [];
  if (steps.length < 1) return null;
  if (!isStepExecutionModeOptional(steps[0])) return null;

  const body = effectBodyText(textLines, effect.textRef);
  const referencedText = effectReferencedText(textLines, effect.textRef);
  if (!hasOptionalIntentText(body || referencedText)) return null;

  if (steps.length === 1) {
    return {
      kind: "root_step_optional_redundant",
      detail:
        "単一任意文は effect.executionMode optional で発揮有無を表し、先頭 step に executionMode optional を重ねない",
      dependentStepIndexes: [],
    };
  }

  const knownDependentIds = new Set();
  if (typeof steps[0].id === "string") knownDependentIds.add(steps[0].id);
  let previousWasDependent = true;
  const dependentStepIndexes = [];
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const dependent = isStepDependentOnRootChain(
      step,
      knownDependentIds,
      previousWasDependent
    );
    if (!dependent) return null;
    dependentStepIndexes.push(i);
    if (typeof step.id === "string") knownDependentIds.add(step.id);
    previousWasDependent = dependent;
  }

  return {
    kind: "root_step_optional_redundant",
    detail:
      "effect-level optional の先頭任意文に後続 step がすべて依存しているため、先頭 step には executionMode optional を重ねない",
    dependentStepIndexes,
  };
}

export function findCountZeroOptionalCountStepIssues(effect, textLines) {
  if (!effect || effect.stub) return [];
  const body = effectBodyText(textLines, effect.textRef);
  const referencedText = effectReferencedText(textLines, effect.textRef);
  if (!COUNT_ZERO_OPTIONAL_COUNT_RE.test(body || referencedText)) return [];

  const steps = Array.isArray(effect.steps) ? effect.steps : [];
  const matchingSteps = steps
    .map((step, stepIndex) => ({ step, stepIndex }))
    .filter(({ step }) => isCountZeroSelfCountIncreaseStep(step));

  if (matchingSteps.length === 0) {
    return [
      {
        kind: "count_zero_optional_count_step_missing",
        detail:
          "「自分のカウント0のとき、自分のカウント+1できる。」に対応する count_increase step が見つからない",
        dependentStepIndexes: [],
      },
    ];
  }

  // 単独 count+ effect なら effect-level optional で発揮有無を表せる。
  // 複数 step effect 内の独立した count+ 文は、step-level optional に結び直す。
  if (steps.length <= 1) return [];

  const issues = [];
  for (const { step, stepIndex } of matchingSteps) {
    if (!isStepExecutionModeOptional(step)) {
      issues.push({
        kind: "count_zero_optional_count_step_missing_optional",
        detail:
          '「自分のカウント0のとき、自分のカウント+1できる。」は複数 step effect 内の独立任意文なので、対応する count_increase step に executionMode:"optional" が必要',
        dependentStepIndexes: [stepIndex],
      });
    }
    if (step.prompt?.sourceText !== COUNT_ZERO_OPTIONAL_COUNT_SOURCE_TEXT) {
      issues.push({
        kind: "count_zero_optional_count_step_missing_prompt_source",
        detail:
          "「自分のカウント0のとき、自分のカウント+1できる。」の任意 step は prompt.sourceText で該当句へ結び直す",
        dependentStepIndexes: [stepIndex],
      });
    }
  }
  return issues;
}
