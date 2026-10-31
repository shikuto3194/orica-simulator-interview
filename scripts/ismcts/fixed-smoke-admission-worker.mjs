// Private production continuation. The caller is a suspended root assigned to
// the outer Job before any module, storage helper or inner runtime can execute.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runFixedSmokeAdmission } from "./fixed-smoke.mjs";
import { programPaths } from "./shared.mjs";
import { checkIsmctsStorageAdmission } from "./storage-admission.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv.length !== 5 || !/^(?:[0-9]|1[0-5])$/.test(process.argv[2]))
  throw new Error("invalid fixed smoke envelope arguments");
try {
  const result = await runFixedSmokeAdmission(
    programPaths(root).shared,
    Number(process.argv[2]),
    process.argv[3],
    process.argv[4],
    (bytes) => checkIsmctsStorageAdmission(root, bytes)
  );
  // This is only the inner execution outcome. The parent still retains the
  // reservation and reports unreconciled program accounting, even on exit 0.
  process.exitCode = result.status === "completed" ? 0 : 1;
} catch {
  // No owner, arguments, exception text or game state leaves this worker.
  process.exitCode = 1;
}
