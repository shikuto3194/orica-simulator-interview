import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectCardFaces,
  collectEffectContainers,
} from "./card-text-accountability-core.mjs";
import {
  auditConditionalCostScopes,
  textHash,
} from "./conditional-cost-scope-audit.mjs";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const directory = await mkdtemp(join(tmpdir(), "orica-conditional-cost-"));
let cards;
try {
  const bundle = join(directory, "cards.mjs");
  await build({
    entryPoints: ["packages/card-data/src/generated-index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
  });
  cards = (await import(pathToFileURL(bundle).href)).ALL_CARDS;
} finally {
  // Only the directory created by this invocation is removed.
  await rm(directory, { recursive: true });
}
const review = JSON.parse(
  await readFile("scripts/conditional-cost-scope-review.json", "utf8")
);
const report = auditConditionalCostScopes({ cards, review });
const rows = [];
function visit(face, effect, effectPath, steps, path) {
  for (const [index, step] of steps.entries()) {
    const stepPath = `${path}[${index}]`;
    if (step.connector === "conditional_cost")
      rows.push({
        cardNo: face.cardNo,
        effectPath,
        path: stepPath,
        cost: steps[index - 1] ?? null,
        result: step,
      });
    for (const [i, branch] of (step.choice ?? []).entries()) {
      if (branch.action?.effect?.steps)
        visit(
          face,
          branch.action.effect,
          effectPath,
          branch.action.effect.steps,
          `${stepPath}.choice[${i}].action.effect.steps`
        );
    }
    if (step.action?.effect?.steps)
      visit(
        face,
        step.action.effect,
        effectPath,
        step.action.effect.steps,
        `${stepPath}.action.effect.steps`
      );
    for (const key of ["beforePickSteps", "normalActionDeclarationSteps"])
      if (step.action?.[key])
        visit(
          face,
          effect,
          effectPath,
          step.action[key],
          `${stepPath}.action.${key}`
        );
  }
}
for (const { face } of cards.flatMap(collectCardFaces))
  for (const container of collectEffectContainers(face))
    for (const [i, effect] of container.effects.entries())
      visit(
        face,
        effect,
        `${container.path}[${i}]`,
        effect.steps,
        `${container.path}[${i}].steps`
      );
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const output = resolve(
  process.argv[2] ?? "artifacts/conditional-cost-audit.json"
);
const metadata = {
  schemaVersion: 2,
  targetHead: git("rev-parse", "HEAD"),
  reviewedBaseHead: review.reviewedBaseHead,
  sourceDigest: textHash(JSON.stringify(cards)),
  reviewDigest: textHash(JSON.stringify(review)),
  modifiedCards: review.modifiedCards,
  acceptance:
    "static_scope_audit_only; GUI/REST and rules-core execution are separate gates",
};
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ ...metadata, ...report, rows }, null, 2) + "\n"
);
const { wording: _wording, errors, ...summary } = report;
console.log(
  JSON.stringify(
    { ...metadata, ...summary, errors, connections: rows.length, output },
    null,
    2
  )
);
if (report.errors.length) process.exitCode = 1;
