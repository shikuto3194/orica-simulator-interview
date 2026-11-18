#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { programPaths } from "./ismcts/shared.mjs";
import {
  evidenceStatus,
  recordReceipt,
  finalizeReceipt,
  persistEvidenceIndex,
  tasks,
} from "./ismcts/evidence.mjs";
import { budgetStatus, migrateBudget } from "./ismcts/budget.mjs";

export function makePlan(status, budget) {
  // Reconstruct the current required set rather than trusting a cached parent
  // state from before acceptance additions. Missing evidence stays pending;
  // malformed/duplicate/unknown evidence cannot select monitor.
  const states = ["valid", "invalid", "unverified"];
  if (
    status?.schemaVersion !== 1 ||
    typeof status.orphanInvalid !== "boolean" ||
    !Array.isArray(status.taskStates)
  )
    throw new Error("invalid controller evidence status");
  const known = new Map();
  for (const task of status.taskStates) {
    if (
      !Object.hasOwn(tasks, task?.taskId) ||
      known.has(task.taskId) ||
      !states.includes(task.state) ||
      !Array.isArray(task.acceptances)
    )
      throw new Error("invalid controller task state");
    const acceptances = new Map();
    for (const item of task.acceptances) {
      if (
        !tasks[task.taskId].includes(item?.acceptanceId) ||
        acceptances.has(item.acceptanceId) ||
        !states.includes(item.state)
      )
        throw new Error("invalid controller acceptance state");
      acceptances.set(item.acceptanceId, item);
    }
    known.set(task.taskId, { task, acceptances });
  }
  const taskStates = Object.entries(tasks).map(([taskId, required]) => {
    const entry = known.get(taskId);
    const acceptances = required.map(
      (acceptanceId) =>
        entry?.acceptances.get(acceptanceId) ?? {
          acceptanceId,
          state: "unverified",
          reason: "no_receipt",
        }
    );
    return {
      taskId,
      acceptances,
      state:
        entry?.task.state === "invalid" ||
        acceptances.some((item) => item.state === "invalid")
          ? "invalid"
          : acceptances.every((item) => item.state === "valid")
            ? "valid"
            : "unverified",
    };
  });
  const first = taskStates.find((task) => task.state !== "valid");
  const corrupt =
    status.orphanInvalid || taskStates.some((task) => task.state === "invalid");
  if (corrupt || first)
    return {
      schemaVersion: 1,
      action: "ismcts-implementation-required",
      skipWorker: false,
      nextTask: corrupt ? "I0" : first.taskId,
      evidenceState: corrupt ? "invalid" : first.state,
      workerFocus: corrupt
        ? "Repair invalid ISMCTS evidence/controller without discarding history."
        : `Implement/verify ${first.taskId}: ${first.acceptances
            .filter((item) => item.state !== "valid")
            .map((item) => item.acceptanceId)
            .join(
              ", "
            )}. Integration and calibration are required; partial evidence is not completion.`,
      budget,
    };
  // I7 parent transition receipt, not worker exit, is the last required task.
  return {
    schemaVersion: 1,
    action: "ismcts-monitor",
    // I7 must add live progress/health and stagnation checks before the parent
    // may suppress an LLM tick. Static receipts alone do not prove normality.
    skipWorker: false,
    nextTask: "maintenance",
    evidenceState: "valid",
    workerFocus:
      "Run parent monitor checks and the initial 120-minute LLM progress review; live health and stagnation checks remain required.",
    budget,
  };
}

export function programCli(args) {
  const command = args.shift();
  if (
    !["plan", "record", "verify", "status", "migrate-budget"].includes(command)
  )
    throw new Error(
      "Usage: ismcts-program.mjs plan|record|verify|status|migrate-budget [--repo path] [--worktree path] [--integration path] [--task I0 --acceptance E1 --run path]"
    );
  const options = {};
  while (args.length) {
    const key = args.shift(),
      value = args.shift();
    if (
      ![
        "--repo",
        "--worktree",
        "--integration",
        "--task",
        "--acceptance",
        "--run",
        "--receipt",
        "--commit",
        "--integration-id",
        "--evidence",
      ].includes(key) ||
      !value ||
      Object.hasOwn(options, key)
    )
      throw new Error("invalid controller arguments");
    options[key] = value;
  }
  if (
    command !== "record" &&
    [
      "--task",
      "--acceptance",
      "--run",
      "--receipt",
      "--commit",
      "--integration-id",
      "--evidence",
    ].some((key) => options[key])
  )
    throw new Error("record arguments require record command");
  const root = resolve(options["--worktree"] ?? process.cwd());
  const paths = programPaths(root, options["--repo"]);
  if (
    options["--integration"] &&
    resolve(options["--integration"]) !== resolve(paths.integrationWorktree)
  )
    throw new Error("integration checkout binding mismatch");
  if (command === "migrate-budget") return migrateBudget(paths.shared);
  if (command === "record") {
    if (options["--receipt"]) {
      if (
        !options["--commit"] ||
        !options["--integration-id"] ||
        ["--task", "--acceptance", "--run"].some((key) => options[key])
      )
        throw new Error(
          "finalization requires receipt, commit and completed parent integration ID only"
        );
      return finalizeReceipt(
        root,
        paths.shared,
        resolve(paths.shared, options["--receipt"]),
        options["--commit"],
        options["--integration-id"],
        Date.now(),
        options["--evidence"] ? resolve(root, options["--evidence"]) : undefined
      );
    }
    if (
      options["--commit"] ||
      options["--integration-id"] ||
      options["--evidence"]
    )
      throw new Error("finalization requires receipt");
    if (!options["--task"] || !options["--acceptance"] || !options["--run"])
      throw new Error("record requires task, acceptance and harness run");
    return recordReceipt(
      root,
      paths.shared,
      options["--task"],
      options["--acceptance"],
      resolve(root, options["--run"])
    );
  }
  const status =
    command === "verify"
      ? persistEvidenceIndex(root, paths.shared)
      : evidenceStatus(root, paths.shared);
  const budget = budgetStatus(paths.shared);
  return command === "plan" ? makePlan(status, budget) : { ...status, budget };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(programCli(process.argv.slice(2))));
  } catch (error) {
    console.error(`[ismcts-program] ${error.message}`);
    process.exitCode = 1;
  }
}
