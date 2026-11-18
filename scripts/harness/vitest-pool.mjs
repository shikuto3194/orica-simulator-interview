// Single source of truth for how the repository runs Vitest workers. Both the
// repository configuration and the focused unit entry take their pool settings
// from here; the unit entry applies them after the base configuration so a
// different base cannot widen the worker cap or switch the isolation model.

// Shared PC validation follows the I0 two-compute-worker limit.
export const COMPUTE_WORKERS = 2;

// Worker threads keep the per-file module isolation of child processes (each
// file still gets a fresh worker; `isolate` is never disabled) at a lower
// start-up cost. Measured on the full suite at 2 workers: 840s -> 617s with
// identical per-test results. ORICA_VITEST_POOL=forks restores child processes.
// Unknown values fail closed instead of silently picking a pool.
export function resolveVitestPool(env = process.env) {
  const requested = env.ORICA_VITEST_POOL ?? "threads";
  if (requested !== "threads" && requested !== "forks")
    throw new Error(
      `ORICA_VITEST_POOL must be "threads" or "forks": ${requested}`
    );
  return requested;
}

// Vitest rewrites poolOptions from these variables after the configuration is
// resolved, so checking the configuration object alone cannot see them. Reject
// any value above the compute limit when the configuration is loaded; this
// covers every Vitest run that uses the repository or unit configuration.
const WORKER_COUNT_ENV = [
  "VITEST_MAX_THREADS",
  "VITEST_MIN_THREADS",
  "VITEST_MAX_FORKS",
  "VITEST_MIN_FORKS",
];

export function assertWorkerEnvironment(env = process.env) {
  for (const name of WORKER_COUNT_ENV) {
    const value = env[name];
    if (value === undefined || value === "") continue;
    // Vitest reads these with parseInt(), which accepts forms Number() reads
    // differently ("0b10" is 2 for Number but 0 for parseInt). Only a single
    // decimal digit in range is accepted, so both readings agree.
    if (!/^[1-9]$/.test(value) || Number(value) > COMPUTE_WORKERS)
      throw new Error(
        `${name}=${value} must be an integer from 1 to ${COMPUTE_WORKERS} (compute worker limit)`
      );
  }
}

export function vitestPoolSettings(env = process.env) {
  assertWorkerEnvironment(env);
  return {
    pool: resolveVitestPool(env),
    // Kept beside poolOptions as defence in depth for pools that read these.
    maxWorkers: COMPUTE_WORKERS,
    minWorkers: 1,
    // Per-file isolation is stated at both levels, so a base configuration that
    // sets either one cannot disable it.
    isolate: true,
    poolOptions: {
      threads: { minThreads: 1, maxThreads: COMPUTE_WORKERS, isolate: true },
      forks: { minForks: 1, maxForks: COMPUTE_WORKERS, isolate: true },
    },
  };
}
