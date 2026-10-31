import base from "../../vitest.config.ts";
import { unitTestFiles } from "./unit-test-input.mjs";

const files = unitTestFiles(
  process.cwd(),
  JSON.parse(process.env.ORICA_UNIT_TEST_FILES || "null")
);
if (!base || typeof base !== "object" || !base.test)
  throw new Error("Unit entry requires the repository Vitest configuration");

export default {
  ...base,
  test: {
    ...base.test,
    // Literal includes prevent Vitest's substring CLI filters from also
    // collecting similarly named files. Source aliases remain inherited.
    include: files,
    watch: false,
    passWithNoTests: false,
    allowOnly: false,
    pool: "forks",
    minWorkers: 1,
    maxWorkers: 2,
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
  },
};
