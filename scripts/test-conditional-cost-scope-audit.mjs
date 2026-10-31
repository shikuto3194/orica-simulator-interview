import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditConditionalCostScopes,
  textHash,
} from "./conditional-cost-scope-audit.mjs";

const line = "手札1枚を破棄することで、1枚ドローする。";
const card = {
  cardNo: "SCOPE",
  textLines: [line],
  effects: [
    {
      executionMode: "optional",
      textRef: [0],
      steps: [
        { action: { kind: "discard", count: 1 } },
        { connector: "conditional_cost", action: { kind: "draw", count: 1 } },
      ],
    },
  ],
};
const row = {
  cardNo: "SCOPE",
  line: 0,
  textHash: textHash(line),
  effectPaths: ["effects[0]"],
  carrier: "effects.textRef",
  reason: "03c entire syntax optional",
  clauses: [
    {
      category: "effect",
      reason: "No independent prefix",
      optionality: [{ path: "effects[0].executionMode", equals: "optional" }],
      contract: [
        { path: "effects[0].steps[1].connector", equals: "conditional_cost" },
      ],
    },
  ],
};
function audit(c = card, r = row) {
  return auditConditionalCostScopes({ cards: [c], review: { entries: [r] } });
}
assert.deepEqual(audit().errors, []);
const absentProof = globalThis.structuredClone(row);
absentProof.clauses[0].contract.push({ path: "effects[0].absent" });
assert(
  audit(card, absentProof).errors.some((e) => e.code === "missing_proof_value")
);
assert(
  audit(card, absentProof).errors.some(
    (e) => e.code === "missing_proof_path:effects[0].absent"
  )
);
const missing = globalThis.structuredClone(card);
delete missing.effects[0].executionMode;
assert(
  audit(missing).errors.some((e) => e.code.includes("scope_mismatch")),
  "conditional_cost alone must not pass"
);
const unrelated = globalThis.structuredClone(missing);
unrelated.effects.push({ executionMode: "optional", steps: [], textRef: [] });
assert(
  audit(unrelated).errors.length,
  "an unrelated optional effect must not pay for the missing scope"
);
const wrongLevel = globalThis.structuredClone(card);
delete wrongLevel.effects[0].executionMode;
wrongLevel.effects[0].steps[0].executionMode = "optional";
const wrongReview = globalThis.structuredClone(row);
wrongReview.clauses[0].optionality[0].path =
  "effects[0].steps[0].executionMode";
assert(
  audit(wrongLevel, wrongReview).errors.some(
    (e) => e.code === "effect_requires_executionMode"
  )
);
const noLink = globalThis.structuredClone(card);
delete noLink.effects[0].steps[1].connector;
assert(audit(noLink).errors.length);
const changed = globalThis.structuredClone(card);
changed.textLines[0] += "さらに、コアを置くことで、回復する。";
assert(audit(changed).errors.some((e) => e.code === "unclassified_occurrence"));
const fresh = globalThis.structuredClone(card);
fresh.textLines.push(line);
assert(audit(fresh).errors.some((e) => e.code === "unclassified"));
const rebound = globalThis.structuredClone(card);
rebound.effects[0].textRef = [];
assert(audit(rebound).errors.some((e) => e.code === "changed_text_binding"));
const sub = globalThis.structuredClone(card);
delete sub.effects[0].executionMode;
sub.effects[0].steps[0].executionMode = "optional";
const subReview = globalThis.structuredClone(wrongReview);
subReview.clauses[0].category = "subeffect";
assert.deepEqual(audit(sub, subReview).errors, []);
const foreign = globalThis.structuredClone(row);
foreign.clauses[0].optionality[0].cardNo = "OTHER";
assert(
  auditConditionalCostScopes({
    cards: [
      missing,
      {
        cardNo: "OTHER",
        textLines: [],
        effects: [{ executionMode: "optional" }],
      },
    ],
    review: { entries: [foreign] },
  }).errors.some((e) => e.code === "optional_scope_not_owned_by_binding")
);
const unrelatedSub = globalThis.structuredClone(sub);
unrelatedSub.effects.push({
  textRef: [],
  steps: [{ executionMode: "optional" }],
});
const unrelatedSubReview = globalThis.structuredClone(subReview);
unrelatedSubReview.clauses[0].optionality[0].path =
  "effects[1].steps[0].executionMode";
assert(
  audit(unrelatedSub, unrelatedSubReview).errors.some(
    (e) => e.code === "optional_scope_not_owned_by_binding"
  )
);
const rootProxy = globalThis.structuredClone(row);
rootProxy.clauses[0].category = "subeffect";
assert(
  audit(card, rootProxy).errors.some(
    (e) => e.code === "optional_scope_not_owned_by_binding"
  )
);
const independent = globalThis.structuredClone(card);
independent.effects.push({
  timing: { kind: "constant" },
  textRef: [0],
  steps: [{ action: { kind: "noop" } }],
});
const independentReview = globalThis.structuredClone(row);
independentReview.effectPaths.push("effects[1]");
assert(
  audit(independent, independentReview).errors.some(
    (e) => e.code === "uncovered_effect_binding:effects[1]"
  )
);
independentReview.bindingExceptions = [
  {
    effectPath: "effects[1]",
    reason: "Independent continuous sentence",
    expectedEffect: globalThis.structuredClone(independent.effects[1]),
  },
];
assert.deepEqual(audit(independent, independentReview).errors, []);
const staleException = globalThis.structuredClone(independentReview);
staleException.bindingExceptions[0].expectedEffect.steps = [];
assert(
  audit(independent, staleException).errors.some(
    (e) => e.code === "changed_binding_exception"
  )
);
const foreignException = globalThis.structuredClone(independentReview);
foreignException.bindingExceptions[0].effectPath = "effects[9]";
assert(
  audit(independent, foreignException).errors.some(
    (e) => e.code === "invalid_binding_exception"
  )
);
const costException = globalThis.structuredClone(independent);
costException.effects[1].steps[0].connector = "conditional_cost";
const costExceptionReview = globalThis.structuredClone(independentReview);
costExceptionReview.bindingExceptions[0].expectedEffect =
  costException.effects[1];
assert(
  audit(costException, costExceptionReview).errors.some(
    (e) => e.code === "cost_body_cannot_be_exempted"
  )
);
delete costException.effects[1].steps[0].connector;
costException.effects[1].prepaidCost = { kind: "pay_cost", amount: 1 };
assert(
  audit(costException, costExceptionReview).errors.some(
    (e) => e.code === "cost_body_cannot_be_exempted"
  )
);
const duplicateException = globalThis.structuredClone(independentReview);
duplicateException.bindingExceptions.push(
  duplicateException.bindingExceptions[0]
);
assert(
  audit(independent, duplicateException).errors.some(
    (e) => e.code === "invalid_binding_exception"
  )
);
delete sub.effects[0].steps[0].executionMode;
assert(audit(sub, subReview).errors.length);
const carrier = {
  cardNo: "SCOPE",
  textLines: [line],
  effects: [],
  adventData: { soulCoreDest: "trash" },
};
const carrierReview = globalThis.structuredClone(row);
carrierReview.effectPaths = [];
carrierReview.carrier = "adventData";
carrierReview.clauses = [
  {
    category: "dedicated_carrier",
    reason: "Optional advent declaration",
    optionality: [{ path: "adventData", equals: { soulCoreDest: "trash" } }],
    contract: [],
  },
];
assert.deepEqual(audit(carrier, carrierReview).errors, []);
delete carrier.adventData;
assert(audit(carrier, carrierReview).errors.length);
const quote = {
  cardNo: "SCOPE",
  textLines: ["説明用の引用「ことで」"],
  effects: [],
};
const quoteReview = {
  ...row,
  textHash: textHash(quote.textLines[0]),
  effectPaths: [],
  carrier: "explanation",
  clauses: [
    {
      category: "non_effect",
      reason: "Explanation only; no executable text",
      optionality: [],
      contract: [],
    },
  ],
};
assert.deepEqual(audit(quote, quoteReview).errors, []);
const executableQuote = globalThis.structuredClone(card);
const exemptReview = globalThis.structuredClone(quoteReview);
exemptReview.textHash = row.textHash;
exemptReview.effectPaths = row.effectPaths;
assert(
  audit(executableQuote, exemptReview).errors.some(
    (e) => e.code === "executable_text_cannot_be_exempted"
  )
);
function partial(data, proofs, contract = row.clauses[0].contract) {
  const review = globalThis.structuredClone(row);
  review.clauses[0] = {
    category: "subeffect",
    reason: "Typed partial scope",
    optionality: proofs,
    contract,
  };
  return audit(data, review);
}
const metadata = [
  { path: "effects[0].steps[0].executionMode", equals: "optional" },
];
const kindProxy = [
  { path: "effects[0].steps[0].action.kind", equals: "discard" },
];
assert(
  partial(card, kindProxy).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
const unrelatedSibling = globalThis.structuredClone(card);
unrelatedSibling.effects[0].steps.push({
  executionMode: "optional",
  action: { kind: "draw", count: 1 },
});
assert(
  partial(unrelatedSibling, [
    { path: "effects[0].steps[2].executionMode", equals: "optional" },
  ]).errors.some((e) => e.code === "missing_optional_scope")
);
const resultProxy = globalThis.structuredClone(card);
resultProxy.effects[0].steps[1].executionMode = "optional";
assert(
  partial(resultProxy, [
    { path: "effects[0].steps[1].executionMode", equals: "optional" },
  ]).errors.some((e) => e.code === "missing_optional_scope")
);
for (const free of ["noop", "draw"]) {
  const choiceCard = globalThis.structuredClone(card);
  delete choiceCard.effects[0].executionMode;
  choiceCard.effects[0].steps[0] = {
    id: "cost-choice",
    action: { kind: free },
    choice: [{ action: { kind: "pay_cost", amount: 2 } }],
  };
  choiceCard.effects[0].steps[1].stepCondition = {
    kind: "ref_choice",
    stepId: "cost-choice",
    choiceIndex: 1,
  };
  const proofs = [
    { path: "effects[0].steps[0].action.kind", equals: free },
    { path: "effects[0].steps[0].choice[0].action.kind", equals: "pay_cost" },
  ];
  assert.deepEqual(partial(choiceCard, proofs).errors, []);
  assert(
    partial(choiceCard, proofs.slice(0, 1)).errors.some(
      (e) => e.code === "missing_optional_scope"
    )
  );
  assert(
    partial(choiceCard, proofs.slice(1)).errors.some(
      (e) => e.code === "missing_optional_scope"
    )
  );
  choiceCard.effects[0].steps[1].stepCondition.choiceIndex = 0;
  assert(
    partial(choiceCard, proofs).errors.some(
      (e) => e.code === "missing_optional_scope"
    )
  );
}
const counted = globalThis.structuredClone(card);
counted.effects[0].steps[0].action = {
  kind: "count_decrease",
  amount: { min: 1 },
};
const minProof = [{ path: "effects[0].steps[0].action.amount.min", equals: 1 }];
assert.deepEqual(partial(counted, minProof).errors, []);
counted.effects[0].steps[0].action.amount.max = 1;
assert(
  partial(counted, minProof).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
delete counted.effects[0].steps[0].action.amount.max;
delete counted.effects[0].executionMode;
assert(
  partial(counted, minProof).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
counted.effects[0].steps[0].action.amount.min = 0;
assert.deepEqual(partial(counted, [{ ...minProof[0], equals: 0 }]).errors, []);
const repeated = globalThis.structuredClone(card);
repeated.effects[0].steps[1].repeat = { optional: true };
const repeatProof = [
  { path: "effects[0].steps[1].repeat.optional", equals: true },
];
assert.deepEqual(partial(repeated, repeatProof).errors, []);
repeated.effects[0].steps[1].repeat.optional = false;
assert(
  partial(repeated, [{ ...repeatProof[0], equals: false }]).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
repeated.effects[0].steps[1].repeat.optional = true;
delete repeated.effects[0].executionMode;
assert(
  partial(repeated, repeatProof).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
const selection = globalThis.structuredClone(card);
delete selection.effects[0].executionMode;
selection.effects[0].steps = [
  {
    id: "pick",
    executionMode: "optional",
    action: { kind: "noop", target: { kind: "filter" } },
  },
  {
    action: { kind: "brave_combine_effect" },
    stepCondition: { kind: "ref_succeeded", stepId: "pick" },
  },
  { action: { kind: "recover" }, connector: "conditional_cost" },
];
const selectionContract = [
  { path: "effects[0].steps[2].connector", equals: "conditional_cost" },
];
assert.deepEqual(partial(selection, metadata, selectionContract).errors, []);
selection.effects[0].steps[1].stepCondition.stepId = "unrelated";
assert(
  partial(selection, metadata, selectionContract).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
selection.effects[0].steps[1].stepCondition.stepId = "pick";
selection.effects[0].steps[0].action.kind = "draw";
assert(
  partial(selection, metadata, selectionContract).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);

// A later inner conditional cannot certify an outer paid clause (BSAZ01-C03).
const innerProxy = globalThis.structuredClone(card);
innerProxy.effects[0].steps.push(
  { action: { kind: "discard" } },
  { connector: "conditional_cost", action: { kind: "draw" } }
);
delete innerProxy.effects[0].steps[1].connector;
const innerReview = globalThis.structuredClone(row);
innerReview.clauses[0].contract[0].path = "effects[0].steps[3].connector";
assert(
  audit(innerProxy, innerReview).errors.some(
    (e) => e.code === "missing_bound_cost_contract"
  )
);
const emptyContract = globalThis.structuredClone(row);
emptyContract.clauses[0].contract = [];
assert(
  audit(card, emptyContract).errors.some(
    (e) => e.code === "missing_bound_cost_contract"
  )
);
const partialProxy = globalThis.structuredClone(subReview);
partialProxy.clauses[0].contract = innerReview.clauses[0].contract;
innerProxy.effects[0].steps[0].executionMode = "optional";
assert(
  audit(innerProxy, partialProxy).errors.some(
    (e) => e.code === "missing_optional_scope"
  )
);
const typedSelector = globalThis.structuredClone(selection);
typedSelector.effects[0].steps[0].action.kind = "noop";
delete typedSelector.effects[0].steps[1].stepCondition;
typedSelector.effects[0].steps[1].action = {
  kind: "set_self_as_mirage",
  target: { kind: "ref", stepId: "pick" },
};
assert.deepEqual(
  partial(typedSelector, metadata, selectionContract).errors,
  []
);
const rootDedicatedProxy = globalThis.structuredClone(row);
rootDedicatedProxy.clauses[0].category = "dedicated_carrier";
assert(
  audit(card, rootDedicatedProxy).errors.some(
    (e) => e.code === "missing_typed_dedicated_carrier"
  )
);

const inventory = JSON.parse(
  readFileSync("scripts/conditional-cost-scope-review.json", "utf8")
);
assert.equal(
  new Set(inventory.entries.map((e) => `${e.cardNo}:${e.line}`)).size,
  221
);
assert.equal(
  inventory.entries.reduce((n, e) => n + e.clauses.length, 0),
  224
);
assert.equal(inventory.modifiedCards.length, 67);
console.log(
  "[test-conditional-cost-scope-audit] passed: 4 classifications, owned optional scope and every effect binding, exact independent exceptions and typed cost carriers; foreign/unrelated/root-proxy/ordinary-kind/unlinked-choice/fixed-amount/missing/cost-bearing/stale/duplicate evidence fails closed; current 221-line inventory"
);
