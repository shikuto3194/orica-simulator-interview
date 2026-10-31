#!/usr/bin/env node
/**
 * immunity-zone-scope-detector.mjs の単体テスト。
 * `node scripts/test-immunity-zone-scope-detector.mjs` で実行。
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasUnboundedSelfEffectImmunityWording } from "./immunity-zone-scope-detector.mjs";

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  x ${label}`);
  }
}

check(
  "detects BSES01-C04 unbounded immunity even when the next sentence has zone words",
  hasUnboundedSelfEffectImmunityWording(
    "このカードは相手の効果を受けない。デッキからオープンされた/トラッシュにあるこのカードは手札に加えられず、入れ替えられない。"
  ) === true
);

check(
  "does not flag hand-bound immunity",
  hasUnboundedSelfEffectImmunityWording(
    "手札にあるこのカードは、相手の効果を受けない。"
  ) === false
);

check(
  "does not flag activation-window-bound immunity",
  hasUnboundedSelfEffectImmunityWording(
    "発動している間、このカードは相手の効果を受けない。"
  ) === false
);

check(
  "detects 受けず wording",
  hasUnboundedSelfEffectImmunityWording(
    "このカードは相手の効果を受けず、破棄されない。"
  ) === true
);

check(
  "empty text is false",
  hasUnboundedSelfEffectImmunityWording("") === false
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const violatingEffect = {
  timing: { kind: "continuous" },
  applicability: { zone: ["hand"] },
  steps: [
    {
      action: {
        kind: "effect_immunity",
        target: { kind: "self" },
        duration: { scope: "permanent" },
      },
    },
  ],
  textRef: [0],
};
const overbroadEffect = (zone) => ({
  ...violatingEffect,
  applicability: {
    zone: ["hand", "set_aside", "in_use", "trash", "field", zone],
  },
});
const fixtureCards = [
  {
    cardNo: "TEST01-C01",
    textLines: ["このカードは相手の効果を受けない。"],
    effects: [violatingEffect],
  },
  {
    cardNo: "TEST01-C02",
    textLines: ["このカードは相手の効果を受けない。"],
    mirageData: { effects: [violatingEffect] },
  },
  {
    cardNo: "TEST01-C03",
    textLines: ["このカードは相手の効果を受けない。"],
    grandwalkerData: {
      divineSkills: [{ effects: [violatingEffect] }],
    },
  },
  {
    cardNo: "TEST01-C04",
    textLines: ["このカードは相手の効果を受けない。"],
    effects: [overbroadEffect("revealed")],
  },
  {
    cardNo: "TEST01-C05",
    textLines: ["このカードは相手の効果を受けない。"],
    effects: [overbroadEffect("deck")],
  },
  {
    cardNo: "TEST01-C06",
    textLines: ["このカードは相手の効果を受けない。"],
    effects: [overbroadEffect("anywhere")],
  },
];
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
const immunityViolations = auditReport.violations
  .filter((violation) => violation.kind === "immunity_zone_scope")
  .map((violation) => violation.cardNo)
  .sort();

check(
  "cards-fidelity-audit wires immunityZoneScope for face, nested, and divineSkill effects",
  JSON.stringify(immunityViolations) ===
    JSON.stringify([
      "TEST01-C01",
      "TEST01-C02#mirage",
      "TEST01-C03#divineSkill[0]",
      "TEST01-C04",
      "TEST01-C05",
      "TEST01-C06",
    ])
);

console.log(`\n[immunity-zone-scope-detector] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
