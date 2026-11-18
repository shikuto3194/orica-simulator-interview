import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadAuditMirror, auditInputRoot } from "../audit-inputs.mjs";
const provenance = JSON.parse(
  readFileSync("scripts/audit-mirror-provenance.json", "utf8")
);
if (
  provenance.schemaVersion !== 1 ||
  !/^[a-f0-9]{64}$/.test(provenance.sha256) ||
  !/^[a-f0-9]{40}$/.test(provenance.source?.revision) ||
  !provenance.source?.path ||
  !provenance.evidence ||
  !existsSync(resolve(provenance.evidence))
)
  throw new Error("Invalid card source provenance/evidence");
// Local mirrors are additional inputs, not a prerequisite for a clean CI
// checkout. CI checks the tracked raw hashes via the raw-audit regression.
if (
  existsSync(resolve(auditInputRoot(process.cwd()), "external-qa/cardData.js"))
)
  loadAuditMirror(process.cwd());
for (const line of readFileSync("needs-ruling.jsonl", "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim()))
  JSON.parse(line);
console.log(
  "Tracked card source provenance/evidence and ruling records checked"
);
