import { existsSync, readFileSync } from "node:fs";
import * as prettier from "prettier";
import { ESLint } from "eslint";

const files = process.argv.slice(2).filter((file) => existsSync(file));
let failed = false;
for (const file of files) {
  const info = await prettier.getFileInfo(file, {
    ignorePath: ".prettierignore",
  });
  if (info.ignored || !info.inferredParser) continue;
  if (
    !(await prettier.check(readFileSync(file, "utf8"), {
      ...(await prettier.resolveConfig(file)),
      filepath: file,
    }))
  ) {
    console.error("[format] " + file);
    failed = true;
  }
}
const eslint = new ESLint();
const lintFiles = [];
for (const file of files) {
  if (/\.(?:[cm]?js|tsx?)$/.test(file) && !(await eslint.isPathIgnored(file)))
    lintFiles.push(file);
}
if (lintFiles.length) {
  const results = await eslint.lintFiles(lintFiles);
  const output = (await eslint.loadFormatter("stylish")).format(results);
  if (output) console.log(output);
  failed ||= results.some((result) => result.errorCount || result.warningCount);
}
console.log(`[changed-style] ${files.length} existing changed files checked`);
if (failed) process.exitCode = 1;
