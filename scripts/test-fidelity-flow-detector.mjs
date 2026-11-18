#!/usr/bin/env node
/** Audited broken/correct DSL pairs plus counterexamples; no engine fixtures. */
import assert from "node:assert/strict";
import { findFlowFidelityIssues as find } from "./fidelity-flow-detector.mjs";
import { findEffectLevelOptionalityIssue } from "./effect-optionality-detector.mjs";

let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed++;
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
const effect = (steps, extras = {}) => ({
  timing: { kind: "card_event", event: "summon" },
  textRef: [0],
  steps,
  ...extras,
});
const step = (kind, fields = {}, actionFields = {}) => ({
  action: { kind, ...actionFields },
  ...fields,
});
const issues = (value, text, kind) =>
  find(value, [text]).filter((issue) => !kind || issue.kind === kind);
const none = (value, text) => assert.deepEqual(find(value, [text]), []);
function one(value, text, kind, severity = "review") {
  const found = issues(value, text, kind);
  assert.equal(found.length, 1, JSON.stringify(find(value, [text])));
  assert.equal(found[0].severity, severity);
  return found[0];
}

const orderText =
  "自分は1枚ドローできる。その後、相手のスピリット1体を破壊する。";
const first = step(
  "draw",
  { id: "drew", executionMode: "optional" },
  { count: 1 }
);
const destroy = step("destroy", { connector: "after_triggers" });
const orderKind = "flow_order_became_success_dependency";
test("after_triggers preserves independent mandatory payload", () => {
  none(effect([first, destroy]), orderText.replace("その後", "この効果発揮後"));
  assert.equal(
    findEffectLevelOptionalityIssue(effect([first, destroy]), [orderText]),
    null
  );
});
test("sequential payload does not require the optional first action to succeed", () => {
  none(effect([first, { ...destroy, connector: "sequential" }]), orderText);
});
test("after-effect clause also requires waiting for induced triggers", () => {
  one(
    effect([first, { ...destroy, connector: "sequential" }]),
    orderText.replace("その後", "この効果発揮後"),
    "flow_after_triggers_wait_missing"
  );
});
test("conditional_result incorrectly gates an independent later action", () => {
  assert.equal(
    one(
      effect([first, { ...destroy, connector: "conditional_result" }]),
      orderText,
      orderKind
    ).path,
    "steps[1].connector"
  );
});
test("conditional_cost also incorrectly gates a plain after clause", () => {
  one(
    effect([first, { ...destroy, connector: "conditional_cost" }]),
    orderText,
    orderKind
  );
});
test("after_triggers plus ref_succeeded is not merely ordering", () => {
  one(
    effect([
      first,
      { ...destroy, stepCondition: { kind: "ref_succeeded", stepId: "drew" } },
    ]),
    orderText.replace("その後", "この効果発揮後"),
    orderKind
  );
});
test("all nested result gate is recognized", () => {
  one(
    effect([
      first,
      {
        ...destroy,
        stepCondition: {
          kind: "all",
          conditions: [{ kind: "ref_count", stepId: "drew", min: 1 }],
        },
      },
    ]),
    orderText,
    orderKind
  );
});
test("separate older prerequisite is not mistaken for adjacent success", () => {
  none(
    effect([
      first,
      {
        ...destroy,
        stepCondition: { kind: "ref_succeeded", stepId: "earlier" },
      },
    ]),
    orderText
  );
});
test("explicit completed-result wording is legitimate", () => {
  none(
    effect([first, { ...destroy, connector: "conditional_result" }]),
    "自分は1枚ドローできる。そうしたとき、相手のスピリット1体を破壊する。"
  );
});
test("completed-result condition is not an all-or-nothing cost", () => {
  one(
    effect([first, { ...destroy, connector: "conditional_cost" }]),
    "自分は1枚ドローできる。そうしたとき、相手のスピリット1体を破壊する。",
    "flow_completed_result_became_cost"
  );
});
test("printed ことで cost is not mistaken for an ordinary completed result", () => {
  none(
    effect([first, { ...destroy, connector: "conditional_cost" }]),
    "自分は手札1枚を破棄することで、相手のスピリット1体を破壊する。"
  );
});
test("after clause may explicitly require a result too", () => {
  none(
    effect([first, { ...destroy, connector: "conditional_result" }]),
    "自分は1枚ドローできる。その後、ドローしたとき、相手のスピリット1体を破壊する。"
  );
});
test("do not zip ambiguous three sentences onto two actions", () => {
  none(
    effect([first, { ...destroy, connector: "conditional_result" }]),
    `${orderText}この破壊効果は相手の効果で防げない。`
  );
});
test("exact referenced source prompt can align a complex source", () => {
  one(
    effect([
      first,
      {
        ...destroy,
        connector: "conditional_result",
        prompt: { sourceText: "その後、相手のスピリット1体を破壊する。" },
      },
    ]),
    `${orderText}この破壊効果は相手の効果で防げない。`,
    orderKind
  );
});
test("stale source prompt is not source evidence", () => {
  none(
    effect([
      first,
      {
        ...destroy,
        connector: "conditional_result",
        prompt: { sourceText: "その後、相手のスピリット1体を破壊する。" },
      },
    ]),
    "自分は1枚ドローできる。そうしたとき、相手のスピリット1体を破壊する。"
  );
});

const optionalRootKind = "flow_optional_root_hides_independent_step";
test("whole optional effect hides independent mandatory after-triggers payload", () => {
  one(
    effect([first, destroy], { executionMode: "optional" }),
    orderText,
    optionalRootKind
  );
});
test("effect-level optional root normally has a mandatory DSL first step", () => {
  one(
    effect([{ ...first, executionMode: "mandatory" }, destroy], {
      executionMode: "optional",
    }),
    orderText,
    optionalRootKind
  );
});
test("independent optional later payload is not a forced action", () => {
  none(
    effect([first, { ...destroy, executionMode: "optional" }], {
      executionMode: "optional",
    }),
    orderText.replace("破壊する", "破壊できる")
  );
});
test("activated/flash declaration optionality is not trigger optionality", () => {
  none(
    effect([first, destroy], {
      executionMode: "optional",
      timing: { kind: "activated", mode: "flash" },
    }),
    orderText
  );
});

const pairText =
  "破壊したとき、自分は2枚ドローでき、自分の魂状態の「装置」があるとき、自分のカウント+2できる。";
const paired = (ref) =>
  effect([
    step("destroy", { id: "destroyed" }),
    { ...first, stepCondition: { kind: "ref_succeeded", stepId: "destroyed" } },
    step(
      "count_increase",
      {
        executionMode: "optional",
        stepCondition: { kind: "ref_succeeded", stepId: ref },
      },
      { amount: 2 }
    ),
  ]);
test("independent optional count must not depend on optional draw success", () => {
  one(paired("drew"), pairText, "flow_optional_sibling_dependency");
});
test("independent optionals may share destruction prerequisite", () =>
  none(paired("destroyed"), pairText));
test("explicit draw-result prerequisite stays valid", () => {
  none(
    paired("drew"),
    pairText.replace("でき、自分", "でき、そうしたとき、自分")
  );
});

const lateText =
  "自分は1枚ドローする。その後、自分のカウントが3以上なら、相手のスピリット1体を破壊する。";
test("later count threshold must not gate first independent draw", () => {
  one(
    effect([first, destroy], {
      condition: [{ kind: "count_value", player: "self", min: 3 }],
    }),
    lateText,
    "flow_later_condition_gates_earlier_step"
  );
});
test("step-local count condition preserves the earlier draw", () => {
  none(
    effect([
      first,
      {
        ...destroy,
        condition: [{ kind: "count_value", player: "self", min: 3 }],
      },
    ]),
    lateText
  );
});
test("first-clause threshold can legitimately gate entire effect", () => {
  none(
    effect([first, destroy], {
      condition: [{ kind: "count_value", player: "self", min: 3 }],
    }),
    `自分のカウントが3以上なら、${lateText}`
  );
});
test("later named field condition is reviewable without card identity", () => {
  one(
    effect([first, destroy], {
      condition: [
        { kind: "field_has", filter: { cardName: { exact: "装置" } } },
      ],
    }),
    lateText.replace("自分のカウントが3以上なら", "自分の「装置」があるとき"),
    "flow_later_condition_gates_earlier_step"
  );
});

const choiceText =
  "自分は相手の手札を、内容を見ないで、3枚破棄するか、3枚になるように破棄する。";
const collapsed = step(
  "discard",
  {},
  { player: "opponent", count: 3, targetHandSize: 3, capCount: 3 }
);
test("fixed discard vs hand-size discard cannot be minimum-clipped", () => {
  const found = one(
    effect([collapsed]),
    choiceText,
    "flow_discard_alternative_collapsed",
    "violation"
  );
  assert.equal(found.path, "steps[0].action");
});
test("correct choice models two discard algorithms", () => {
  none(
    effect([
      step(
        "discard",
        { choice: [step("discard", {}, { count: 0, targetHandSize: 3 })] },
        { count: 3 }
      ),
    ]),
    choiceText
  );
});
test("unsupported separate branch representation is review, not proof", () => {
  one(
    effect([step("discard", {}, { count: 3 })]),
    choiceText,
    "flow_discard_alternative_collapsed"
  );
});
test("an unrelated choice does not cover discard alternatives", () => {
  one(
    effect([collapsed, step("draw", { choice: [step("destroy")] })]),
    choiceText,
    "flow_discard_alternative_collapsed",
    "violation"
  );
});
test("wrong choice attached to discard is still reviewed", () => {
  one(
    effect([{ ...collapsed, choice: [step("destroy")] }]),
    choiceText,
    "flow_discard_alternative_collapsed"
  );
});
test("ordinary capped hand-size discard is permitted", () => {
  none(effect([collapsed]), "相手は手札が3枚になるように3枚まで破棄する。");
});
test("different digits/fullwidth digits use the same generic pattern", () => {
  one(
    effect([step("discard", {}, { count: 2, targetHandSize: 4, capCount: 2 })]),
    choiceText.replaceAll("3枚", "２枚").replace("２枚になる", "４枚になる"),
    "flow_discard_alternative_collapsed",
    "violation"
  );
});

const reveal = step(
  "deck_reveal",
  { id: "opened" },
  { revealCount: 3, picks: [{ count: 1 }], remainder: "trash" }
);
const borrow = step(
  "borrow_magic_effect",
  {},
  { target: { kind: "ref", stepId: "opened" }, borrowModes: ["main", "flash"] }
);
const borrowText =
  "自分のデッキを上から3枚オープンできる。その中のマジックカード1枚のメイン/フラッシュ効果を発揮できる。残ったカードは破棄し、効果を発揮したカードは手札に加える。";
const revealKind = "flow_reveal_payload_after_movement";
test("borrowing revealed card after deck_reveal completes reverses source order", () => {
  one(effect([reveal, borrow]), borrowText, revealKind);
});
test("beforeMoveSteps keeps chosen borrow source revealed until all pending ends", () => {
  none(
    effect([
      { ...reveal, action: { ...reveal.action, beforeMoveSteps: [borrow] } },
    ]),
    borrowText
  );
});
const core = step(
  "core_move",
  {},
  {
    from: { kind: "void" },
    amount: {
      source: { kind: "cards_from_ref", stepId: "opened", result: "revealed" },
    },
  }
);
const coreText =
  "デッキを上から3枚オープンする。その中のスピリットカード1枚につき、ネクサスにコア+1する。その後、その中のカード1枚までを手札に加え、残ったカードはデッキの下に戻す。";
test("core payload printed before picking cannot follow the complete reveal action", () => {
  one(effect([reveal, core]), coreText, revealKind);
});
test("beforePickSteps preserves the core-before-pick order", () => {
  none(
    effect([
      { ...reveal, action: { ...reveal.action, beforePickSteps: [core] } },
    ]),
    coreText
  );
});
test("post-move source reference is valid when printed after movement", () => {
  none(
    effect([reveal, core]),
    "デッキを上から3枚オープンする。その中のカード1枚までを手札に加え、残ったカードはデッキの下に戻す。その後、オープンしたスピリットカード1枚につき、ネクサスにコア+1する。"
  );
});
test("unrelated earlier reveal reference is not matched by source vocabulary alone", () => {
  none(
    effect([
      reveal,
      {
        ...borrow,
        action: { ...borrow.action, target: { kind: "ref", stepId: "other" } },
      },
    ]),
    borrowText
  );
});

const ongoingText =
  "フィールド以外で発揮中の、系統：「仲間」を持つ自分のスピリットを対象にした相手の効果すべてを無効にする。";
test("stack negate does not negate already resolved period effects", () => {
  one(
    effect([step("negate", {}, { negateTarget: "effect" })]),
    ongoingText,
    "flow_ongoing_negation_uses_other_lifecycle"
  );
});
test("future protection is not already-active effect negation", () => {
  one(
    effect([step("effect_immunity", {}, { duration: { scope: "turn" } })]),
    ongoingText,
    "flow_ongoing_negation_uses_other_lifecycle"
  );
});
test("negate_ongoing_effects has the resolved-immediate lifecycle", () => {
  none(effect([step("negate_ongoing_effects")]), ongoingText);
});
test("active-effect phrase alone does not supply a targeted trigger", () => {
  one(
    effect([step("negate_ongoing_effects")], {
      timing: { kind: "game_event", event: "targeted" },
    }),
    ongoingText,
    "flow_ongoing_negation_auto_triggers"
  );
});
test("plain pending effect negation is not an ongoing-effect clause", () => {
  none(
    effect([step("negate", {}, { negateTarget: "effect" })]),
    "相手の効果1つを無効にする。"
  );
});

const durationKind = "flow_explicit_duration_ends_on_source_leave";
const durationText = "このターンの間、自分のスピリットすべてをBP+3000する。";
const bp = step(
  "bp_modify",
  {},
  { amount: 3000, duration: { scope: "while_on_field" } }
);
test("explicit immediate duration cannot end when source leaves field", () => {
  one(effect([bp]), durationText, durationKind, "violation");
});
test("battle duration has same leave-independent lifetime", () => {
  one(
    effect([bp]),
    durationText.replace("このターンの間", "このバトル中"),
    durationKind,
    "violation"
  );
});
test("correct immediate turn duration", () => {
  none(
    effect([{ ...bp, action: { ...bp.action, duration: { scope: "turn" } } }]),
    durationText
  );
});
test("multiple payloads make duration attribution review-only", () => {
  one(
    effect([first, bp]),
    `自分は1枚ドローする。${durationText}`,
    durationKind
  );
});
test("explicit field-stay qualification is outside the contradiction rule", () => {
  none(
    effect([bp]),
    durationText.replace(
      "このターンの間、",
      "このターンの間、このスピリットがフィールドにいる間、"
    )
  );
});
test("turn phrase describing target history is not an effect duration", () => {
  none(
    effect([bp]),
    "このターンの間に召喚した自分のスピリットすべてをBP+3000する。"
  );
});
test("continuous reapplication requires separate interpretation", () => {
  none(effect([bp], { timing: { kind: "continuous" } }), durationText);
});
test("nested granted effect does not inherit enclosing duration wording", () => {
  assert.deepEqual(
    find(
      effect([
        step("grant_effect", {}, { effect: effect([bp], { textRef: [1] }) }),
      ]),
      [durationText, "自分のスピリットすべてをBP+3000する。"]
    ),
    []
  );
});
test("nested effect with its own referenced duration is recursively audited", () => {
  const nested = effect([bp], { textRef: [1] });
  const root = effect([step("grant_effect", {}, { effect: nested })]);
  const found = find(root, [
    "自分のスピリット1体に効果を与える。",
    durationText,
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, durationKind);
  assert.equal(
    found[0].path,
    "steps[0].action.effect.steps[0].action.duration"
  );
  assert.equal(found[0].severity, "violation");
});
test("unreferenced nested effect is outside proof scope", () => {
  none(
    effect([
      step("grant_effect", {}, { effect: effect([bp], { textRef: [] }) }),
    ]),
    durationText
  );
});
test("nested effect only uses its own discard-choice wording", () => {
  const root = effect([
    step("grant_effect", {}, { effect: effect([collapsed], { textRef: [1] }) }),
  ]);
  const found = find(root, ["自分のスピリット1体に効果を与える。", choiceText]);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "steps[0].action.effect.steps[0].action");
  assert.equal(found[0].severity, "violation");
});
test("stub nested effects are skipped with their descendants", () => {
  none(
    effect([
      step("grant_effect", {}, { effect: effect([bp], { stub: true }) }),
    ]),
    durationText
  );
});

test("stub, missing textRef, empty and invalid inputs are outside scope", () => {
  assert.deepEqual(find(null, [choiceText]), []);
  none(effect([collapsed], { stub: true }), choiceText);
  none(effect([collapsed], { textRef: [] }), choiceText);
  none(effect([collapsed], { textRef: [99] }), choiceText);
  none(effect([]), choiceText);
});
test("source text is limited to this effect's textRef", () => {
  assert.deepEqual(
    find(effect([collapsed], { textRef: [1] }), [
      choiceText,
      "自分の手札1枚を破棄する。",
    ]),
    []
  );
});
test("headings alone cannot justify a finding", () => {
  assert.deepEqual(find(effect([collapsed]), ["フラッシュ"]), []);
});
test("quoted granted text is not attributed to the outer action", () => {
  none(effect([bp]), `「${durationText}」という効果を与える。`);
});
test("pure function, deterministic contract and no duplicate findings", () => {
  const value = effect([collapsed]);
  const before = JSON.stringify(value);
  const found = find(value, [choiceText]);
  assert.deepEqual(find(value, [choiceText]), found);
  assert.equal(JSON.stringify(value), before);
  for (const issue of found) {
    assert.deepEqual(Object.keys(issue).sort(), [
      "evidence",
      "kind",
      "message",
      "path",
      "severity",
    ]);
    assert.ok(issue.evidence && issue.path && issue.message);
    assert.ok(["review", "violation"].includes(issue.severity));
  }
  assert.equal(
    new Set(found.map((v) => `${v.kind}:${v.path}`)).size,
    found.length
  );
});

console.log(`fidelity-flow-detector: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
