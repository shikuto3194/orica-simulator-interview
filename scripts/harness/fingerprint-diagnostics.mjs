import { resolve } from "node:path";
import { auditInputFiles } from "../audit-inputs.mjs";
import state from "./verification-state.cjs";

const args = process.argv.slice(2);
if (
  args.length !== 0 &&
  (args.length !== 2 || args[0] !== "--root" || args[1].startsWith("-"))
) {
  console.error("Usage: fingerprint-diagnostics.mjs [--root PATH]");
  process.exitCode = 1;
} else {
  try {
    const root = resolve(args[1] ?? process.cwd());
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          ...state.sourceFingerprintDetails(root, {
            extraFiles: auditInputFiles(root),
          }),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
