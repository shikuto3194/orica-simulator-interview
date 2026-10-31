// Owned Windows resource scheduler only. Shared budget/output/service admission
// and full program accounting must be connected before production acceptance.
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { profile } from "./resources.mjs";
import { readWindowsServiceBusy } from "./windows-service-state.mjs";
import { ownedJobStopReason } from "./windows-job.mjs";

const active = new WeakSet();

export async function runWindowsResourceLoop(
  controller,
  { serviceBusy, signal, onSample } = {}
) {
  if (
    !controller ||
    controller.resourceWatchdog !== true ||
    active.has(controller) ||
    serviceBusy === undefined ||
    (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) ||
    (onSample !== undefined && typeof onSample !== "function")
  )
    throw new Error(
      "resource loop requires an exclusive native-watchdog controller and service state"
    );
  active.add(controller);
  let running = false,
    samples = 0,
    last = null;
  let next = performance.now() + profile.compute.sampleMs;
  try {
    readWindowsServiceBusy(serviceBusy);
    while (!signal?.aborted) {
      try {
        await delay(Math.max(0, next - performance.now()), undefined, {
          signal,
        });
      } catch (error) {
        if (error.name === "AbortError" && signal?.aborted) break;
        throw error;
      }
      if (signal?.aborted) break;
      const startedAt = performance.now();
      const busy = readWindowsServiceBusy(serviceBusy);
      last = await (running
        ? controller.poll(busy)
        : controller.start(busy, serviceBusy));
      samples++;
      if (onSample && onSample(last) !== undefined)
        throw new Error("resource observation must be synchronous");
      if (["exited", "stopped"].includes(last.status)) {
        const terminal = await controller.finish();
        const nativeStopReason = ownedJobStopReason(terminal.sample);
        return {
          status:
            !nativeStopReason &&
            last.status === "exited" &&
            terminal.sample.exitCode === 0
              ? "completed"
              : "stopped",
          reason:
            nativeStopReason ??
            (last.status === "stopped" ? last.decision.reason : "job_exit"),
          samples,
          last,
          terminal,
        };
      }
      if (!["waiting", "running"].includes(last.status))
        throw new Error("invalid resource loop state");
      running = last.status === "running";
      // Never catch up with bursts or reuse an observation across a delay.
      // The native timer independently terminates running work after 3 seconds.
      next = startedAt + profile.compute.sampleMs;
    }
    const terminal = await controller.finish();
    return {
      status: "stopped",
      reason: ownedJobStopReason(terminal.sample) ?? "cancelled",
      samples,
      last,
      terminal,
    };
  } catch (error) {
    await controller.close();
    throw error;
  } finally {
    active.delete(controller);
  }
}
