/**
 * Conservative, effect-local control-flow fidelity checks.
 *
 * Sources: 10_rules/03c_effect-text-interpretation.md, 03c1_effect-connectors-
 * and-completion.md, 03e_effect-duration-and-repeat-scope.md and
 * 03e_ongoing-effect-negation.md. Audit examples motivate patterns, never IDs.
 *
 * `path` is relative to the supplied effect; `evidence` is referenced source
 * text. Only explicit discard-choice clipping and a single immediate action's
 * explicit duration contradiction are violations. Sentence/action alignment,
 * optional independence, reveal ordering and ongoing-negation intent are review
 * signals: sibling effects, trigger provenance and runtime continuation cannot
 * be proven from this input. No findings does NOT establish fidelity/coverage.
 *
 * Text outside effect.textRef, quoted granted effects, unrecognized synonyms,
 * arbitrary conditions, cross-effect dependencies and engine runtime behavior
 * are outside this detector's proof scope. Sequence alignment is top-level;
 * nested lifetimes need a source prompt. Nested Effects are recursively audited
 * with their OWN textRef, never with the enclosing effect's source text.
 */

import { effectBodyText } from "./effect-optionality-detector.mjs";
import { hasOptionalWording } from "./optional-wording-detector.mjs";

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim();
const object = (value) => value !== null && typeof value === "object";
const optional = (step) =>
  step?.executionMode === "optional" ||
  step?.executionMode?.kind === "optional";

// These recognize operations, not every mention of an affected card/category.
// Deliberately small: ambiguous or unsupported operations remain unclassified.
const OPERATIONS = {
  draw: /ドロー(?:する|でき|し)/,
  discard: /破棄(?:する|でき|し)/,
  destroy: /破壊(?:する|でき|し)/,
  bounce: /(?:手札に戻(?:す|せ|し)|手札へ戻(?:す|せ|し))/,
  count_increase: /カウント\s*\+\s*\d+\s*(?:する|でき|し)/,
  core_move:
    /(?:コア\s*\+\s*\d+\s*(?:する|でき|し)|コア[^。]*?(?:置く|置け|置き))/,
  borrow_magic_effect:
    /(?:メイン|フラッシュ|スタック)[^。]*?効果[^。]*?発揮(?:する|でき|し)/,
  deck_reveal: /(?:オープン|公開)(?:する|でき|し)/,
};

function matchesOperation(step, text) {
  return OPERATIONS[step?.action?.kind]?.test(text) ?? false;
}

function walk(
  value,
  callback,
  path = "",
  seen = new Set(),
  skipEffects = true
) {
  if (!object(value) || seen.has(value)) return;
  seen.add(value);
  callback(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (!object(child)) continue;
    // A granted/borrowed nested Effect has its own text attribution. The public
    // wrapper audits it separately, rather than borrowing enclosing source text.
    if (
      Array.isArray(child.steps) &&
      (child.stub || (skipEffects && child.timing))
    )
      continue;
    const childPath = Array.isArray(value)
      ? `${path}[${key}]`
      : path
        ? `${path}.${key}`
        : key;
    walk(child, callback, childPath, seen, skipEffects);
  }
}

function refsTo(value, stepId) {
  let found = false;
  if (!stepId) return false;
  walk(value, (node) => {
    if (node.stepId === stepId) found = true;
  });
  return found;
}

function dependsOnPrevious(step, previous) {
  if (["conditional_result", "conditional_cost"].includes(step.connector)) {
    return true;
  }
  return refsTo(step.stepCondition, previous?.id);
}

function hasResultLanguage(text) {
  return /そうしたとき|ことで|(?:した|置いた|戻した|加えた|引いた|選んだ)とき|場合|なら/.test(
    text
  );
}

function hasBranch(step) {
  return Array.isArray(step?.choice) && step.choice.length > 0;
}

function isQuotedGrant(text) {
  return /(?:「[^」]*」|『[^』]*』)\s*(?:という)?効果を(?:与える|得る|持つ|追加する)/.test(
    text
  );
}

function findLocalFlowFidelityIssues(effect, textLines) {
  if (!object(effect) || effect.stub) return [];
  const body = normalize(effectBodyText(textLines, effect.textRef));
  if (!body || isQuotedGrant(body)) return [];
  const steps = Array.isArray(effect.steps) ? effect.steps : [];
  if (steps.length === 0) return [];
  const findings = [];
  const keys = new Set();
  const add = (kind, path, message, evidence = body, severity = "review") => {
    const key = `${kind}:${path}`;
    if (keys.has(key)) return;
    keys.add(key);
    findings.push({ kind, path, message, evidence, severity });
  };

  const allSteps = [];
  walk(effect, (node, path) => {
    if (object(node.action) && typeof node.action.kind === "string") {
      allSteps.push({ step: node, path });
    }
  });

  // A source prompt may align a nested step precisely. Otherwise only a
  // two-sentence, two-step effect is aligned; arbitrary positional zipping is
  // unsafe because one printed sentence can expand into multiple actions.
  const sentences = body
    .split(/[。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const aligned = new Map();
  for (const { step, path } of allSteps) {
    const prompt = normalize(step.prompt?.sourceText);
    if (prompt && body.includes(prompt)) aligned.set(path, prompt);
  }
  if (
    steps.length === 2 &&
    sentences.length === 2 &&
    steps.every(
      (step, i) => !hasBranch(step) && matchesOperation(step, sentences[i])
    )
  ) {
    steps.forEach((_, i) => aligned.set(`steps[${i}]`, sentences[i]));
  }

  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const path = `steps[${i}]`;
    const text = aligned.get(path);
    if (
      text &&
      /^そうしたとき[、,\s]/.test(text) &&
      step.connector === "conditional_cost"
    ) {
      add(
        "flow_completed_result_became_cost",
        `${path}.connector`,
        "「そうしたとき」は前段の達成条件。後段不能時に前段を禁止・巻き戻す「ことで」コストへ変換していないか確認する。",
        text
      );
    }
    if (!text || !/^(?:その後|この効果発揮後)[、,\s]/.test(text)) continue;
    if (
      /^この効果発揮後[、,\s]/.test(text) &&
      step.connector !== "after_triggers"
    ) {
      add(
        "flow_after_triggers_wait_missing",
        `${path}.connector`,
        "「この効果発揮後」は誘発効果の解決後に続く。通常の順次実行だけで待機を省略していないか確認する。",
        text
      );
    }
    if (hasResultLanguage(text)) continue;
    if (dependsOnPrevious(step, steps[i - 1])) {
      add(
        "flow_order_became_success_dependency",
        step.stepCondition ? `${path}.stepCondition` : `${path}.connector`,
        "「その後／この効果発揮後」は順序のみ。前段成功・コスト条件へ変換していないか確認する。",
        text
      );
    }
    if (
      optional(effect) &&
      (optional(steps[0]) || hasOptionalWording(aligned.get("steps[0]"))) &&
      !optional(step) &&
      !["activated", "burst", "continuous"].includes(effect.timing?.kind) &&
      !step.stepCondition &&
      !step.condition?.length &&
      !dependsOnPrevious(step, steps[i - 1]) &&
      !hasOptionalWording(text)
    ) {
      add(
        "flow_optional_root_hides_independent_step",
        "executionMode",
        "独立した後段の強制処理まで effect 全体の任意発揮で省略されないか確認する。",
        text
      );
    }
  }

  // The independent second optional clause may share an earlier destruction
  // prerequisite, but must not inherit success of the adjacent optional draw.
  const optionalPair = body.match(
    /ドローでき(?:る)?[、,]([^。]*?カウント\s*\+\s*\d+できる)/
  );
  if (
    optionalPair &&
    !/そうしたとき|ことで|(?:ドローした|手札に加えた|引いた)とき/.test(
      optionalPair[1]
    )
  ) {
    const draws = steps.filter(
      (step) => step.action?.kind === "draw" && optional(step)
    );
    if (draws.length === 1) {
      steps.forEach((step, i) => {
        if (
          step.action?.kind === "count_increase" &&
          optional(step) &&
          (refsTo(step.stepCondition, draws[0].id) ||
            (steps[i - 1] === draws[0] && dependsOnPrevious(step, draws[0])))
        ) {
          add(
            "flow_optional_sibling_dependency",
            `steps[${i}]`,
            "隣接する任意ドローの辞退・不成立で独立した任意カウントまで省略されないか確認する。",
            optionalPair[0]
          );
        }
      });
    }
  }

  // Recognize only count-threshold and literal field/name gates. Broader
  // conditions cannot be attributed to a later clause without semantic parsing.
  if (
    Array.isArray(effect.condition) &&
    effect.condition.length > 0 &&
    steps.length > 1
  ) {
    const boundary = body.search(/その後[、,]|この効果発揮後[、,]/);
    if (boundary > 0) {
      const before = body.slice(0, boundary);
      const after = body.slice(boundary);
      if (!/とき|場合|なら|ことで/.test(before)) {
        effect.condition.forEach((condition, index) => {
          const countGate =
            condition.kind === "count_value" &&
            /カウント[^。]*?(?:以上|以下|のとき|なら)/.test(after) &&
            !/カウント/.test(before);
          const filter = condition.filter ?? condition;
          const names = [
            filter.cardName?.exact,
            filter.cardName?.contains,
            ...(Array.isArray(filter.tribes) ? filter.tribes : []),
          ].filter((v) => typeof v === "string");
          const fieldGate =
            ["field_has", "cards_in_zone"].includes(condition.kind) &&
            /とき|場合|なら/.test(after) &&
            names.some(
              (name) => after.includes(name) && !before.includes(name)
            );
          if (countGate || fieldGate) {
            add(
              "flow_later_condition_gates_earlier_step",
              `condition[${index}]`,
              "後段にだけ書かれた条件を effect 全体へ置き、独立した前段の発揮を禁止していないか確認する。"
            );
          }
        });
      }
    }
  }

  // Explicit either/or discard is a choice of algorithms, not min(fixed,
  // hand-size delta). An unrelated choice elsewhere does not cover this step.
  const discardChoice = body.match(
    /(\d+)枚破棄するか[、,\s]*(\d+)枚になるように破棄する/
  );
  if (discardChoice) {
    const fixed = Number(discardChoice[1]);
    const handSize = Number(discardChoice[2]);
    const discards = steps
      .map((step, i) => ({ step, path: `steps[${i}]` }))
      .filter(({ step }) => step.action?.kind === "discard");
    for (const { step, path } of discards) {
      const variants = [
        step,
        ...(Array.isArray(step.choice) ? step.choice : []),
      ]
        .map((variant) => variant?.action)
        .filter((action) => action?.kind === "discard");
      if (
        variants.some(
          (action) =>
            action.count === fixed && action.targetHandSize === undefined
        ) &&
        variants.some(
          (action) =>
            action.targetHandSize === handSize && action.capCount === undefined
        )
      )
        continue;
      const action = step.action;
      const clipped =
        action.targetHandSize === handSize && action.capCount === fixed;
      add(
        "flow_discard_alternative_collapsed",
        `${path}.action`,
        clipped
          ? "固定枚数と指定手札枚数までの二択を targetHandSize + capCount に縮約している。EffectStep.choice で各処理を選ぶ。"
          : "固定枚数と指定手札枚数までの二択に対応する choice がこの破棄 step に無い。別の分岐表現があるか確認する。",
        discardChoice[0],
        clipped && !hasBranch(step) && discards.length === 1
          ? "violation"
          : "review"
      );
    }
  }

  // Reveal action completes picks AND remainder movement before its next sibling.
  // Looking at revealed StepResult after movement is valid when the printed
  // payload also follows the movement: require the opposite source order here.
  steps.forEach((reveal, i) => {
    if (reveal.action?.kind !== "deck_reveal" || !reveal.id) return;
    const open = body.search(/(?:オープン|公開)(?:する|できる|し)/);
    if (open < 0) return;
    const tail = body.slice(open);
    const move = tail.search(
      /残(?:った|りの)?カード[^。]*?(?:破棄|戻)|(?:その中の|効果を発揮した)[^。]*?手札に加/
    );
    if (move < 0) return;
    const whileRevealed = tail.slice(0, move);
    for (let j = i + 1; j < steps.length; j++) {
      const step = steps[j];
      if (!["borrow_magic_effect", "core_move"].includes(step.action?.kind))
        continue;
      if (
        !refsTo(step.action, reveal.id) ||
        !matchesOperation(step, whileRevealed)
      )
        continue;
      add(
        "flow_reveal_payload_after_movement",
        `steps[${j}].action`,
        "公開中の処理が deck_reveal の後続 step にある。beforePickSteps／beforeMoveSteps でカード移動前に処理すべきか確認する。"
      );
    }
  });

  // Do not infer a zone from “field-external”: the ruling refers to an already
  // resolved immediate continuous effect, even if its source is still on field.
  if (/フィールド以外で発揮中の[^。]*?効果[^。]*?無効/.test(body)) {
    const ongoing = allSteps.some(
      ({ step }) => step.action.kind === "negate_ongoing_effects"
    );
    if (!ongoing) {
      for (const { step, path } of allSteps) {
        if (["negate", "effect_immunity"].includes(step.action.kind)) {
          add(
            "flow_ongoing_negation_uses_other_lifecycle",
            `${path}.action`,
            "発揮中の期間指定効果は解決済み CE が対象。未解決スタックの無効化や将来の耐性付与へ置き換えていないか確認する。"
          );
        }
      }
    }
    if (
      effect.timing?.kind === "game_event" &&
      effect.timing.event === "targeted"
    ) {
      add(
        "flow_ongoing_negation_auto_triggers",
        "timing",
        "「発揮中」は発揮タイミングの指定ではない。対象化への自動誘発を本文見出し・別効果との帰属で確認する。"
      );
    }
  }

  // Narrow proof: exactly one immediate action/sentence with an explicit
  // duration, no field-stay qualification, and only its own lifetime setting.
  const durationText = body.match(
    /(この(?:ターンの間|バトル中|バトルの間))[、,]/
  )?.[1];
  if (durationText && effect.timing?.kind !== "continuous") {
    for (const { step, path } of allSteps) {
      if (step.action.duration?.scope !== "while_on_field") continue;
      if (!/^steps\[\d+\]$/.test(path) && !aligned.has(path)) continue;
      const localText = /^steps\[\d+\]$/.test(path) ? body : aligned.get(path);
      const localDuration = localText.match(
        /(この(?:ターンの間|バトル中|バトルの間))[、,]/
      )?.[1];
      if (!localDuration) continue;
      const qualified = /フィールド[^。]*(?:間|限り)|いる間|ある間/.test(
        localText
      );
      if (qualified) continue;
      const isolated =
        allSteps.length === 1 &&
        sentences.length === 1 &&
        !!effect.timing?.kind &&
        !step.retrigger &&
        !step.deferTo &&
        !hasBranch(step);
      add(
        "flow_explicit_duration_ends_on_source_leave",
        `${path}.action.duration`,
        "明示された期間指定効果は発揮元が離場しても継続する。while_on_field で途中終了させていないか確認する。",
        localDuration,
        isolated ? "violation" : "review"
      );
    }
  }
  return findings;
}

/**
 * @param {object} effect
 * @param {string[]} textLines Full face text (each effect's textRef supplies attribution).
 * @returns {{kind:string,path:string,message:string,evidence:string,severity:'violation'|'review'}[]}
 */
export function findFlowFidelityIssues(effect, textLines) {
  if (!object(effect) || effect.stub) return [];
  const findings = findLocalFlowFidelityIssues(effect, textLines);
  walk(
    effect,
    (node, path) => {
      if (node === effect || !node.timing || !Array.isArray(node.steps)) return;
      for (const issue of findLocalFlowFidelityIssues(node, textLines)) {
        findings.push({
          ...issue,
          path: issue.path ? `${path}.${issue.path}` : path,
        });
      }
    },
    "",
    new Set(),
    false
  );
  return findings;
}
