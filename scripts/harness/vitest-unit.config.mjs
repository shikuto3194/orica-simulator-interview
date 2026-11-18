import base from "../../vitest.config.ts";
import { unitTestFiles } from "./unit-test-input.mjs";
import { vitestPoolSettings } from "./vitest-pool.mjs";

const files = unitTestFiles(
  process.cwd(),
  JSON.parse(process.env.ORICA_UNIT_TEST_FILES || "null")
);
if (!base || typeof base !== "object" || !base.test)
  throw new Error("Unit entry requires the repository Vitest configuration");

// Per-glob pool switching and extra projects/workspaces carry their own pool
// settings and would bypass the pool settings below.
const baseTest = { ...base.test };
for (const key of ["poolMatchGlobs", "projects", "workspace"])
  delete baseTest[key];

export default {
  ...base,
  test: {
    ...baseTest,
    // Literal includes prevent Vitest's substring CLI filters from also
    // collecting similarly named files. Source aliases remain inherited.
    include: files,
    watch: false,
    passWithNoTests: false,
    allowOnly: false,
    // Applied after the base so a different base configuration can neither
    // widen the worker cap nor change the pool or its per-file isolation.
    ...vitestPoolSettings(),
  },
};
