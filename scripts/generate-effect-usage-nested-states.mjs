// P3-170 W5: src/effect-usage/nested-states.ts を model.ts の型から再生成する。
// 使い方: node scripts/generate-effect-usage-nested-states.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildNestedStateGraph,
  renderNestedStateTable,
} from "./lib/nested-state-graph.mjs";

const root = process.cwd();
const target = path.join(
  root,
  "packages/rules-core/src/effect-usage/nested-states.ts"
);
fs.writeFileSync(target, renderNestedStateTable(buildNestedStateGraph(root)));
try {
  execFileSync("pnpm", ["exec", "prettier", "--write", target], {
    stdio: "inherit",
    shell: true,
  });
} catch {
  console.warn("prettier に失敗しました。手動で整形してください:", target);
}
console.log("generated", path.relative(root, target));
