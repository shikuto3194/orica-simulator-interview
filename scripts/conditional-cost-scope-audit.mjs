import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  collectCardFaces,
  collectEffectContainers,
} from "./card-text-accountability-core.mjs";

export const textHash = (text) =>
  createHash("sha256").update(text).digest("hex");
export function atPath(object, path) {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce((o, key) => o?.[key], object);
}
const jsonValue = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hasCostBody = (value) =>
  !!value &&
  typeof value === "object" &&
  (value.connector === "conditional_cost" ||
    value.prepaidCost !== undefined ||
    Object.values(value).some(hasCostBody));

// Only typed optional-cost carriers can witness a partial scope. Merely
// finding an arbitrary field in the same effect is not evidence of optionality.
function costFollows(steps, index) {
  if (steps[index + 1]?.connector === "conditional_cost") return true;
  const step = steps[index];
  const next = steps[index + 1];
  return (
    step?.action?.kind === "noop" &&
    !!step.action.target &&
    typeof step.id === "string" &&
    !!step.id &&
    ((next?.stepCondition?.kind === "ref_succeeded" &&
      next.stepCondition.stepId === step.id &&
      !next.stepCondition.not) ||
      (next?.action?.target?.kind === "ref" &&
        next.action.target.stepId === step.id)) &&
    steps[index + 2]?.connector === "conditional_cost"
  );
}
function paidChoice(condition, stepId, choiceIndex) {
  if (!condition || typeof condition !== "object") return false;
  if (condition.kind === "ref_choice" && condition.stepId === stepId)
    return condition.not === true
      ? condition.choiceIndex === 0
      : condition.choiceIndex === choiceIndex;
  return (
    condition.kind === "all" &&
    Array.isArray(condition.conditions) &&
    condition.conditions.some((child) => paidChoice(child, stepId, choiceIndex))
  );
}
function boundCostFollows(steps, index, effectPath, contract, cardNo) {
  if (!costFollows(steps, index)) return false;
  const resultIndex =
    steps[index + 1]?.connector === "conditional_cost" ? index + 1 : index + 2;
  return contract.some(
    (proof) =>
      (!proof.cardNo || proof.cardNo === cardNo) &&
      proof.path === `${effectPath}.steps[${resultIndex}].connector` &&
      proof.equals === "conditional_cost"
  );
}
function partialScopeOwners(face, effectPaths, proofs, contract) {
  return effectPaths.filter((effectPath) => {
    const effect = atPath(face, effectPath);
    const steps = effect?.steps ?? [];
    const own = proofs.filter(
      (p) =>
        (!p.cardNo || p.cardNo === face.cardNo) &&
        p.path.startsWith(`${effectPath}.steps[`)
    );
    const bound = (index) =>
      boundCostFollows(steps, index, effectPath, contract, face.cardNo);
    return own.some((proof) => {
      const relative = proof.path.slice(effectPath.length);
      const match = /^\.steps\[(\d+)\](.*)$/.exec(relative);
      if (!match) return false;
      const index = Number(match[1]);
      const tail = match[2];
      const step = steps[index];
      if (tail === ".executionMode" && proof.equals === "optional")
        return bound(index);
      if (tail === ".repeat.optional" && proof.equals === true)
        return (
          step?.connector === "conditional_cost" &&
          index > 0 &&
          bound(index - 1) &&
          (effect.executionMode === "optional" ||
            steps[index - 1].executionMode === "optional")
        );
      if (tail === ".action.amount.min") {
        const amount = step?.action?.amount;
        const variableExtra =
          proof.equals === 1 &&
          effect.executionMode === "optional" &&
          (amount?.max === undefined || amount.max > 1);
        return (
          (proof.equals === 0 || variableExtra) &&
          ["count_decrease", "count_increase"].includes(step?.action?.kind) &&
          bound(index)
        );
      }
      if (tail !== ".action.kind" || !step?.id || !bound(index)) return false;
      const prefix = `${effectPath}.steps[${index}]`;
      return own.some((choice) => {
        const branch = /^\.choice\[(\d+)\]\.action\.kind$/.exec(
          choice.path.slice(prefix.length)
        );
        return (
          choice.path.startsWith(prefix) &&
          branch &&
          typeof choice.equals === "string" &&
          choice.equals !== proof.equals &&
          paidChoice(
            steps[index + 1]?.stepCondition,
            step.id,
            Number(branch[1]) + 1
          )
        );
      });
    });
  });
}

/** This is a reviewed source-to-scope inventory, never an optionality inference
 * from the mere presence of conditional_cost. New/changed text fails closed. */
export function auditConditionalCostScopes({ cards, review }) {
  const faces = cards.flatMap(collectCardFaces).map(({ face }) => face);
  const byNo = new Map(faces.map((face) => [face.cardNo, face]));
  const reviewed = new Map();
  const errors = [];
  for (const row of review.entries) {
    const id = `${row.cardNo}:${row.line}`;
    if (reviewed.has(id)) errors.push({ id, code: "duplicate_review" });
    reviewed.set(id, row);
  }
  const wording = [];
  for (const face of faces) {
    for (const [line, text] of (face.textLines ?? []).entries()) {
      if (!text.includes("ことで")) continue;
      const id = `${face.cardNo}:${line}`;
      const row = reviewed.get(id);
      reviewed.delete(id);
      const effectPaths = collectEffectContainers(face).flatMap(
        ({ path, effects }) =>
          effects.flatMap((effect, index) =>
            (effect.textRef ?? []).includes(line) ? [`${path}[${index}]`] : []
          )
      );
      const failures = [];
      if (!row) failures.push("unclassified");
      else {
        if (row.textHash !== textHash(text))
          failures.push("changed_source_requires_review");
        if (!isDeepStrictEqual(row.effectPaths, effectPaths))
          failures.push("changed_text_binding");
        if (!row.reason?.trim()) failures.push("missing_scope_reason");
        if (!row.carrier?.trim()) failures.push("missing_carrier");
        const occurrences = [...text.matchAll(/ことで/g)].length;
        if (row.clauses?.length !== occurrences)
          failures.push("unclassified_occurrence");
        const scopedClauses = (row.clauses ?? []).filter((clause) =>
          ["effect", "subeffect"].includes(clause.category)
        );
        const covered = new Set();
        for (const clause of row.clauses ?? []) {
          if (
            ![
              "effect",
              "subeffect",
              "dedicated_carrier",
              "non_effect",
            ].includes(clause.category)
          )
            failures.push("invalid_category");
          if (!clause.reason?.trim()) failures.push("missing_exception_reason");
          if (clause.category === "non_effect" && effectPaths.length)
            failures.push("executable_text_cannot_be_exempted");
          if (clause.category !== "non_effect" && !clause.optionality?.length)
            failures.push("missing_optional_scope");
          if (
            clause.category === "effect" &&
            !clause.optionality?.every(
              (p) =>
                (!p.cardNo || p.cardNo === face.cardNo) &&
                effectPaths.some(
                  (path) => p.path === `${path}.executionMode`
                ) &&
                p.equals === "optional"
            )
          )
            failures.push("effect_requires_executionMode");
          if (["effect", "subeffect"].includes(clause.category)) {
            for (const proof of clause.optionality ?? []) {
              const ownedPath = effectPaths.find((path) =>
                clause.category === "effect"
                  ? proof.path === `${path}.executionMode`
                  : proof.path.startsWith(`${path}.steps[`)
              );
              if ((proof.cardNo && proof.cardNo !== face.cardNo) || !ownedPath)
                failures.push("optional_scope_not_owned_by_binding");
              else if (clause.category === "effect") {
                if (
                  !boundCostFollows(
                    atPath(face, ownedPath)?.steps ?? [],
                    0,
                    ownedPath,
                    clause.contract ?? [],
                    face.cardNo
                  )
                )
                  failures.push("missing_bound_cost_contract");
                covered.add(ownedPath);
              }
            }
          }
          if (clause.category === "subeffect") {
            const owners = partialScopeOwners(
              face,
              effectPaths,
              clause.optionality ?? [],
              clause.contract ?? []
            );
            if (!owners.length) failures.push("missing_optional_scope");
            for (const owner of owners) covered.add(owner);
          }
          if (
            clause.category === "dedicated_carrier" &&
            (clause.optionality ?? []).every((p) =>
              /\.executionMode$/.test(p.path)
            )
          )
            failures.push("missing_typed_dedicated_carrier");
          for (const proof of [
            ...(clause.optionality ?? []),
            ...(clause.contract ?? []),
          ]) {
            if (!Object.hasOwn(proof, "equals"))
              failures.push("missing_proof_value");
            const actual = atPath(
              proof.cardNo ? byNo.get(proof.cardNo) : face,
              proof.path
            );
            if (actual === undefined)
              failures.push(`missing_proof_path:${proof.path}`);
            if (!isDeepStrictEqual(jsonValue(actual), proof.equals))
              failures.push(
                `scope_mismatch:${proof.cardNo ?? face.cardNo}:${proof.path}`
              );
          }
        }
        const excepted = new Set();
        for (const exception of row.bindingExceptions ?? []) {
          const path = exception.effectPath;
          const actual = atPath(face, path);
          if (
            !effectPaths.includes(path) ||
            excepted.has(path) ||
            covered.has(path)
          )
            failures.push("invalid_binding_exception");
          excepted.add(path);
          if (!exception.reason?.trim())
            failures.push("missing_binding_exception_reason");
          if (!isDeepStrictEqual(jsonValue(actual), exception.expectedEffect))
            failures.push("changed_binding_exception");
          if (hasCostBody(actual))
            failures.push("cost_body_cannot_be_exempted");
        }
        if (scopedClauses.length)
          for (const path of effectPaths)
            if (!covered.has(path) && !excepted.has(path))
              failures.push(`uncovered_effect_binding:${path}`);
      }
      wording.push({
        id,
        cardNo: face.cardNo,
        line,
        text,
        textHash: textHash(text),
        carrier: row?.carrier ?? null,
        effectPaths,
        clauses: row?.clauses ?? [],
        bindingExceptions: row?.bindingExceptions ?? [],
        reason: row?.reason ?? null,
        status: failures.length ? "failed" : "passed",
        failures,
      });
      errors.push(...failures.map((code) => ({ id, code })));
    }
  }
  for (const id of reviewed.keys()) errors.push({ id, code: "stale_review" });
  const classificationCounts = Object.fromEntries(
    ["effect", "subeffect", "dedicated_carrier", "non_effect"].map(
      (category) => [
        category,
        wording.filter((row) => row.clauses[0]?.category === category).length,
      ]
    )
  );
  const clauseClassificationCounts = Object.fromEntries(
    Object.keys(classificationCounts).map((category) => [
      category,
      wording
        .flatMap((row) => row.clauses)
        .filter((c) => c.category === category).length,
    ])
  );
  return {
    cardCount: cards.length,
    faceCount: faces.length,
    wordingLines: wording.length,
    occurrences: wording.reduce(
      (n, row) => n + [...row.text.matchAll(/ことで/g)].length,
      0
    ),
    classificationCounts,
    clauseClassificationCounts,
    bindingExceptionCount: wording.reduce(
      (n, row) => n + row.bindingExceptions.length,
      0
    ),
    unclassified: errors.filter((e) =>
      ["unclassified", "unclassified_occurrence"].includes(e.code)
    ).length,
    failedLines: wording.filter((row) => row.failures.length).length,
    errors,
    wording,
  };
}
