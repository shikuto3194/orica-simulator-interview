import assert from "node:assert/strict";
import { testWindowsJob } from "./ismcts/test-windows-job.mjs";
import { testWindowsResourceController } from "./ismcts/test-windows-resource-controller.mjs";
import { testWindowsResourceLoop } from "./ismcts/test-windows-resource-loop.mjs";
import { testWindowsServiceState } from "./ismcts/test-windows-service-state.mjs";
import { testWindowsBudgetAdmission } from "./ismcts/test-windows-budget-admission.mjs";
import { testFixedDecks } from "./ismcts/test-fixed-decks.mjs";
import { testStorageAdmission } from "./ismcts/test-storage-admission.mjs";
import { testManagedOutput } from "./ismcts/test-managed-output.mjs";
import { testRuntimeTelemetry } from "./ismcts/test-runtime-telemetry.mjs";
import { testServicePriority } from "./ismcts/test-service-priority.mjs";
import { testCallerMeter } from "./ismcts/test-caller-meter.mjs";
import { testHostProbe } from "./ismcts/test-host-probe.mjs";
import { testFixedSmoke } from "./ismcts/test-fixed-smoke.mjs";
import { testContainedAdmission } from "./ismcts/test-contained-admission.mjs";

let completed = 0;
async function test(name, fn) {
  await fn();
  completed++;
  console.log(`ok ${completed} - ${name}`);
}
await test("Windows OS containment is exercised without claiming runtime/calibration acceptance", async () => {
  const result = await testWindowsJob();
  if (process.platform === "win32") assert.equal(result.completed, 44);
  else assert.equal(result.executed, false);
});
await test("aggregate host sampling uses native exact intervals without relaxing calibration admission", async () => {
  assert.equal((await testHostProbe()).completed, 6);
});
await test("native host resource dispatch rejects unsafe starts and yields owned execution", async () => {
  assert.equal((await testWindowsResourceController()).completed, 14);
});
await test("current caller CPU and RSS measurements are included without external PID inputs", () => {
  assert.equal(testCallerMeter().completed, 4);
});
await test("two-second owned scheduling requires independent native protection and drains on cancellation", async () => {
  assert.equal((await testWindowsResourceLoop()).completed, 6);
});
await test("service state cannot execute arbitrary callbacks or create poisoned promise rejections", () => {
  assert.equal(testWindowsServiceState().completed, 5);
});
await test("fixed eight decks and separate paired seeds are validated without running matches", async () => {
  const result = await testFixedDecks();
  assert.equal(result.executed, true);
  assert.equal(result.completed, 16);
});
await test("bounded fixed-deck smoke preserves inputs, budgets and partial outcomes", async () => {
  assert.equal((await testFixedSmoke()).completed, 6);
});
await test("shared budget admission precedes Windows creation and retains incomplete accounting", async () => {
  assert.equal(
    (await testWindowsBudgetAdmission()).completed,
    process.platform === "win32" ? 18 : 15
  );
});
await test("storage admission measures registered namespaces and rejects unsafe projected output", async () => {
  assert.equal(testStorageAdmission().completed, 8);
});
await test("managed output persists byte claims before immutable writes and rejects reuse", () => {
  assert.equal(testManagedOutput().completed, 14);
});
await test("owned runtime telemetry uses immutable bounded shared output without accepting calibration", async () => {
  assert.equal(
    (await testRuntimeTelemetry()).completed,
    process.platform === "win32" ? 19 : 17
  );
});
await test("fixed-smoke continuation reuses one reservation inside an outer job through persistence, exit and orphan cleanup", async () => {
  const result = await testContainedAdmission();
  if (process.platform === "win32") assert.equal(result.completed, 2);
  else assert.equal(result.executed, false);
});
await test("shared service lifetime vetoes reservations and yields lower scheduling without production acceptance", async () => {
  assert.equal((await testServicePriority()).completed, 12);
});
console.log(
  `ISMCTS_RUNTIME_TEST_RESULT ${JSON.stringify({ attempted: completed, completed, failed: 0, deferred: 0 })}`
);
