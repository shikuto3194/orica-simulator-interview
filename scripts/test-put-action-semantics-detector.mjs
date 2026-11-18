#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPutActionSemanticIssues } from "./put-action-semantics-detector.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  x ${label}`);
  }
}

const invalidActions = [
  { kind: "summon", target: { kind: "from_token_pool", count: 1 } },
  {
    kind: "summon",
    target: { kind: "self" },
    enterFieldEventKind: "put",
  },
  {
    kind: "split_summon_choice",
    tokenAction: {
      kind: "summon",
      target: { kind: "from_token_pool", count: 1 },
    },
  },
  {
    kind: "split_field_entry_choice",
    tokenAction: {
      kind: "summon",
      target: { kind: "from_token_pool", count: 1 },
    },
  },
];
check(
  "detects all legacy summon-shaped put forms",
  findPutActionSemanticIssues(invalidActions).length === 6
);
check(
  "accepts native put and mixed field-entry choice",
  findPutActionSemanticIssues([
    { kind: "put", target: { kind: "from_token_pool", count: 1 } },
    {
      kind: "put",
      target: { kind: "self" },
      effectScope: "genkai",
    },
    {
      kind: "split_field_entry_choice",
      tokenAction: {
        kind: "put",
        target: { kind: "from_token_pool", count: 1 },
      },
      zoneAction: {
        kind: "summon",
        target: { kind: "from_zone", zone: "hand", count: 1 },
      },
    },
  ]).length === 0
);

const fixtureCards = invalidActions.map((action, index) => ({
  cardNo: `TEST01-C0${index + 1}`,
  textLines: ["テスト"],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action }],
      textRef: [0],
    },
  ],
}));
fixtureCards.push({
  cardNo: "TEST01-C05",
  textLines: ["テスト"],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "put",
            target: { kind: "from_token_pool", count: 1 },
          },
        },
      ],
      textRef: [0],
    },
  ],
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const auditReport = JSON.parse(
  execFileSync(
    process.execPath,
    ["scripts/cards-fidelity-audit.mjs", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ORICA_CARDS_FIDELITY_AUDIT_FIXTURE_JSON: JSON.stringify(fixtureCards),
        ORICA_CARDS_FIDELITY_AUDIT_NO_WRITE: "1",
      },
    }
  )
);
const putViolations = auditReport.violations.filter(
  (violation) => violation.kind === "put_action_semantics"
);
check(
  "cards-fidelity wires put semantics before vanilla/text coverage filters",
  putViolations.length === 6 &&
    putViolations.every((violation) => violation.cardNo !== "TEST01-C05")
);

console.log(`\n[put-action-semantics-detector] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
