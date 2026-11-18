// Synchronize the two shared UI/client modules to the separate orika-react repo.
// Usage: node scripts/sync-orika-account-link.mjs <orika-react-root>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const target = process.argv[2];
if (!target || !existsSync(resolve(target, "src/supabaseClient.js"))) {
  throw new Error("Specify the orika-react repository root");
}
for (const [source, destination] of [
  ["hooks/useDeckLibrary.ts", "useDeckLibrary.js"],
  ["components/AccountLinkSettings.tsx", "AccountLinkSettings.jsx"],
]) {
  const code = readFileSync(resolve("apps/playground-web/src", source), "utf8")
    .replace("../supabaseClient", "./supabaseClient")
    .replace("../hooks/useDeckLibrary", "./useDeckLibrary");
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  }).outputText;
  writeFileSync(
    resolve(target, "src", destination),
    "// Generated from orica-simulator; update via scripts/sync-orika-account-link.mjs.\n" +
      result
  );
}
