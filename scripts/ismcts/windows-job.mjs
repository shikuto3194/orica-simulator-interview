// Low-level Windows containment only. The production resource runner must
// acquire shared budget, measure host eligibility and guard output first.
// No R1-runtime/calibration receipt is issued by this primitive or its tests.
import { spawn } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { profile } from "./resources.mjs";
import { loadProcessMeter } from "./windows-process-handle.mjs";

// One precedence contract shared by dispatch and persisted terminal evidence.
export function ownedJobStopReason(sample) {
  if (sample?.writeTransferLimitExceeded === true)
    return "write_transfer_limit";
  if (sample?.resourceWatchdogExpired === true)
    return "resource_watchdog_expired";
  return null;
}

export function validateRetainedProcessSample(
  sample,
  expected,
  terminal = false
) {
  const identity = (x) =>
    typeof x === "string" &&
    /^[1-9]\d{0,18}$/.test(x) &&
    BigInt(x) <= 0x7fffffffffffffffn;
  if (
    !Number.isSafeInteger(sample?.pid) ||
    sample.pid < 1 ||
    sample.pid > 0xffffffff ||
    !identity(sample.created) ||
    !Number.isFinite(sample.cpuMs) ||
    sample.cpuMs < 0 ||
    typeof sample.signaled !== "boolean" ||
    !Number.isSafeInteger(sample.exitCode) ||
    sample.exitCode < 0 ||
    sample.exitCode > 0xffffffff ||
    (sample.signaled
      ? !identity(sample.exited) ||
        BigInt(sample.exited) < BigInt(sample.created)
      : sample.exited !== "0") ||
    (expected &&
      (sample.pid !== expected.pid ||
        sample.created !== expected.created ||
        sample.cpuMs < expected.cpuMs)) ||
    (terminal && (!sample.signaled || sample.exitCode !== 0))
  )
    throw new Error("incomplete retained helper process accounting");
  return sample;
}

export function validateOwnedSample(sample, threads, previous = null) {
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const pid = (value) => integer(value) && value > 0 && value <= 0xffffffff;
  const cpu = (value) => Number.isFinite(value) && value >= 0;
  const nativeDecimal = (value, max) =>
    typeof value === "string" &&
    value.length <= max.toString().length &&
    /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= max;
  const identity = (value) => nativeDecimal(value, 0x7fffffffffffffffn);
  const affinity = (value) => nativeDecimal(value, 0xffffffffffffffffn);
  const guardian = sample?.guardian;
  // Legacy private fixtures may omit the pair. Native creation below requires
  // an exact launch echo; a bounded sample must preserve both fields/counters.
  if (
    (Object.hasOwn(sample ?? {}, "writeTransferLimitBytes") ||
      Object.hasOwn(sample ?? {}, "writeTransferLimitExceeded")) &&
    (!Number.isSafeInteger(sample.writeTransferLimitBytes) ||
      sample.writeTransferLimitBytes < -1 ||
      sample.writeTransferLimitBytes > profile.offline.outputBytes ||
      typeof sample.writeTransferLimitExceeded !== "boolean" ||
      typeof sample.writeTransferBytes !== "string" ||
      !/^(0|[1-9]\d{0,19})$/.test(sample.writeTransferBytes) ||
      BigInt(sample.writeTransferBytes) > 0xffffffffffffffffn ||
      (sample.writeTransferLimitExceeded &&
        (sample.writeTransferLimitBytes < 0 ||
          BigInt(sample.writeTransferBytes) <=
            BigInt(sample.writeTransferLimitBytes))) ||
      (sample.writeTransferLimitBytes >= 0 &&
        BigInt(sample.writeTransferBytes) >
          BigInt(sample.writeTransferLimitBytes) &&
        !sample.writeTransferLimitExceeded) ||
      (previous &&
        (sample.writeTransferLimitBytes !== previous.writeTransferLimitBytes ||
          (previous.writeTransferLimitExceeded &&
            !sample.writeTransferLimitExceeded) ||
          BigInt(sample.writeTransferBytes) <
            BigInt(previous.writeTransferBytes))))
  )
    throw new Error("owned write transfer limit/counter changed");
  if (
    previous?.writeTransferLimitBytes !== undefined &&
    sample?.writeTransferLimitBytes === undefined
  )
    throw new Error("owned write transfer limit missing");
  if (
    ![1, 2].includes(threads) ||
    !pid(sample?.rootPid) ||
    !identity(sample.rootCreated) ||
    !integer(sample.active) ||
    sample.active > 1024 ||
    !integer(sample.exitCode) ||
    sample.exitCode > 0xffffffff ||
    typeof sample.resourceWatchdogEnabled !== "boolean" ||
    typeof sample.resourceWatchdogExpired !== "boolean" ||
    (sample.resourceWatchdogExpired && !sample.resourceWatchdogEnabled) ||
    !cpu(sample.cpuMs) ||
    !integer(sample.rssBytes) ||
    !pid(guardian?.pid) ||
    guardian.pid === sample.rootPid ||
    !identity(guardian.created) ||
    !cpu(guardian.cpuMs) ||
    !integer(guardian.rssBytes) ||
    !affinity(sample.affinityMask) ||
    !affinity(guardian.affinityMask) ||
    sample.affinityMask !== guardian.affinityMask ||
    BigInt(sample.affinityMask).toString(2).replaceAll("0", "").length !==
      threads ||
    sample.priority !== 0x4000 ||
    guardian.priority !== 0x4000 ||
    sample.commitLimitBytes !== profile.ram.hardGiB * 1024 ** 3 ||
    !Array.isArray(sample.members) ||
    sample.members.length !== sample.active ||
    sample.members.some(
      (member) =>
        !pid(member.pid) ||
        member.pid === guardian.pid ||
        !identity(member.created) ||
        !integer(member.rssBytes)
    ) ||
    sample.members.some(
      (member) =>
        member.pid === sample.rootPid && member.created !== sample.rootCreated
    ) ||
    new Set(sample.members.map((member) => member.pid)).size !==
      sample.active ||
    sample.members.reduce((sum, member) => sum + member.rssBytes, 0) !==
      sample.rssBytes ||
    !integer(sample.totalRssBytes) ||
    sample.totalRssBytes !== sample.rssBytes + guardian.rssBytes ||
    !cpu(sample.totalCpuMs) ||
    sample.totalCpuMs !== sample.cpuMs + guardian.cpuMs
  )
    throw new Error("incomplete owned job/guardian accounting");
  if (
    previous &&
    (sample.rootPid !== previous.rootPid ||
      sample.rootCreated !== previous.rootCreated ||
      guardian.pid !== previous.guardian.pid ||
      guardian.created !== previous.guardian.created ||
      sample.affinityMask !== previous.affinityMask ||
      sample.cpuMs < previous.cpuMs ||
      guardian.cpuMs < previous.guardian.cpuMs ||
      sample.totalCpuMs < previous.totalCpuMs ||
      sample.resourceWatchdogEnabled !== previous.resourceWatchdogEnabled ||
      (previous.resourceWatchdogExpired === true &&
        sample.resourceWatchdogExpired !== true) ||
      sample.members.some((member) =>
        previous.members.some(
          (old) => old.pid === member.pid && old.created !== member.created
        )
      ))
  )
    throw new Error("owned job/guardian identity or cumulative CPU changed");
  return sample;
}

// Connect to the existing policy without substituting job-only RSS for the
// whole owned envelope. Host CPU stays the measured system percentage.
export function windowsResourceSample(host, sample, threads) {
  validateOwnedSample(sample, threads);
  validateMeterEnvelope(sample);
  return {
    ...host,
    treeRssGiB: sample.observedTotalRssBytes / 1024 ** 3,
    ownedCpuMs: sample.observedTotalCpuMs,
  };
}

export function validateMeterReply(
  reply,
  expected,
  previous = null,
  terminal = false
) {
  const pid = (x) => Number.isSafeInteger(x) && x > 0 && x <= 0xffffffff;
  const decimal = (x) =>
    typeof x === "string" &&
    /^[1-9]\d{0,18}$/.test(x) &&
    BigInt(x) <= 0x7fffffffffffffffn;
  const cpu = (x) => Number.isFinite(x) && x >= 0;
  const target = reply?.target,
    helper = reply?.helper;
  if (
    !pid(target?.pid) ||
    !decimal(target.created) ||
    !cpu(target.cpuMs) ||
    typeof target.signaled !== "boolean" ||
    !Number.isSafeInteger(target.exitCode) ||
    target.exitCode < 0 ||
    target.exitCode > 0xffffffff ||
    (target.signaled
      ? !decimal(target.exited) ||
        BigInt(target.exited) < BigInt(target.created)
      : target.exited !== "0") ||
    !pid(helper?.pid) ||
    helper.pid === target.pid ||
    !decimal(helper.created) ||
    !cpu(helper.cpuMs) ||
    !Number.isSafeInteger(helper.rssBytes) ||
    helper.rssBytes < 0 ||
    helper.priority !== 0x4000 ||
    typeof helper.affinityMask !== "string" ||
    !/^[1-9]\d{0,19}$/.test(helper.affinityMask) ||
    BigInt(helper.affinityMask) > 0xffffffffffffffffn ||
    (terminal && (!target.signaled || target.exitCode !== 0)) ||
    (expected &&
      (target.pid !== expected.pid ||
        target.created !== expected.created ||
        target.cpuMs < expected.cpuMs)) ||
    (previous &&
      (helper.pid !== previous.helper.pid ||
        helper.created !== previous.helper.created ||
        helper.affinityMask !== previous.helper.affinityMask ||
        helper.cpuMs < previous.helper.cpuMs ||
        target.pid !== previous.target.pid ||
        target.created !== previous.target.created ||
        target.cpuMs < previous.target.cpuMs))
  )
    throw new Error("incomplete retained guardian process accounting");
  return reply;
}

function validateMeterEnvelope(sample) {
  const reply = validateMeterReply(sample.meter, sample.guardian);
  if (
    reply.target.signaled ||
    reply.helper.pid === sample.rootPid ||
    sample.members.some((member) => member.pid === reply.helper.pid) ||
    reply.helper.affinityMask !== sample.affinityMask ||
    !Number.isSafeInteger(sample.observedTotalRssBytes) ||
    !Number.isFinite(sample.observedTotalCpuMs) ||
    sample.observedTotalRssBytes !==
      sample.totalRssBytes + reply.helper.rssBytes ||
    sample.observedTotalCpuMs !==
      sample.cpuMs + reply.target.cpuMs + reply.helper.cpuMs
  )
    throw new Error("meter envelope accounting mismatch");
}

// Attach before sending the guardian's create request, so the retained handle
// predates job creation/deadline and remains queryable after guardian exit.
// The PID comes only from our immutable ChildProcess spawn, not public args.
async function attachGuardianMeter(
  guardian,
  threads,
  onFailure,
  signal,
  binding
) {
  if (signal.aborted) throw new Error("guardian process meter cancelled");
  const meter = spawn(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fileURLToPath(new URL("windows-process-meter.ps1", import.meta.url)),
      "-Threads",
      String(threads),
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  let pending = null,
    failure = null,
    closing = false,
    stderrBytes = 0,
    previous = null,
    retained = null;
  const exited = new Promise((done) =>
    meter.once("close", (code, signal) => done({ code, signal }))
  );
  function abort() {
    const first = failure === null;
    failure ??= new Error("guardian process meter failed");
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(failure);
      pending = null;
    }
    meter.kill();
    if (first) onFailure();
  }
  // The local helper exists before attach returns to the caller. Connect its
  // cancellation here, rather than relying on the caller's later assignment.
  signal.addEventListener("abort", abort, { once: true });
  meter.once("close", () => signal.removeEventListener("abort", abort));
  if (signal.aborted) abort();
  meter.on("error", abort);
  meter.stdin.on("error", abort);
  meter.stderr.on("data", (bytes) => {
    stderrBytes += bytes.length;
    if (stderrBytes > 65536) abort();
  });
  meter.once("close", () => {
    if (!closing || pending) abort();
  });
  const receive = guardianFrames((line) => {
    try {
      const reply = JSON.parse(line);
      if (!pending || reply.op !== pending.expected)
        throw new Error("meter protocol mismatch");
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      request.resolve(reply);
    } catch {
      abort();
      return false;
    }
  }, abort);
  meter.stdout.on("data", receive);
  function request(value, expected) {
    if (failure || closing || pending)
      return Promise.reject(failure ?? new Error("meter closed/overlap"));
    return new Promise((done, reject) => {
      pending = {
        expected,
        resolve: done,
        reject,
        timer: setTimeout(abort, 15000),
      };
      meter.stdin.write(JSON.stringify(value) + "\n");
    });
  }
  async function close(retainHandle = false) {
    closing = true;
    if (pending) abort();
    meter.stdin.end();
    const timer = setTimeout(() => meter.kill(), 5000);
    try {
      return await exited;
    } finally {
      clearTimeout(timer);
      meter.stdout.off("data", receive);
      if (!retainHandle) retained?.close();
    }
  }
  try {
    // Capture only our immutable spawn before the helper can return/exit.
    // The handle has query/synchronize rights, no terminate/write access.
    retained = binding.open(meter.pid);
    validateRetainedProcessSample(retained.sample());
    const initial = validateMeterReply(
      await request({ op: "attach", pid: guardian.pid, threads }, "attached"),
      null
    );
    if (
      initial.target.pid !== guardian.pid ||
      initial.helper.pid !== meter.pid ||
      initial.target.signaled ||
      BigInt(initial.helper.affinityMask).toString(2).replaceAll("0", "")
        .length !== threads
    )
      throw new Error("guardian meter attachment mismatch");
    previous = initial;
    return {
      initial,
      abort,
      close,
      async sample(expected) {
        const reply = validateMeterReply(
          await request({ op: "sample" }, "sample"),
          expected,
          previous
        );
        if (reply.target.signaled)
          throw new Error("guardian unexpectedly exited");
        previous = reply;
        return reply;
      },
      async finish(expected) {
        // The helper exits after this response; arm closing before the request
        // is sent without disabling the pending response validation.
        const response = request({ op: "finish" }, "finished");
        closing = true;
        const reply = validateMeterReply(
          await response,
          expected,
          previous,
          true
        );
        try {
          const exit = await close(true);
          if (failure || exit.code !== 0 || exit.signal !== null)
            throw new Error("process meter terminal exit unconfirmed");
          const helperFinal = validateRetainedProcessSample(
            retained.sample(),
            reply.helper,
            true
          );
          return { ...reply, helperFinal };
        } finally {
          retained.close();
        }
      },
    };
  } catch (error) {
    abort();
    await close();
    throw error;
  }
}

export function validateTerminalSample(terminal, threads, previous) {
  const sample = validateOwnedSample(terminal?.sample, threads, previous);
  if (
    terminal.rootExited !== true ||
    terminal.jobCpuComplete !== true ||
    typeof terminal.forced !== "boolean" ||
    sample.active !== 0 ||
    sample.members.length !== 0 ||
    sample.rssBytes !== 0
  )
    throw new Error("owned tree terminal accounting incomplete");
  return terminal;
}

export function ownedJobFailureReason(reply) {
  return [
    "membership_incomplete",
    "membership_count_changed",
    "membership_set_changed",
    "membership_accounting_changed",
  ].includes(reply?.reason)
    ? reply.reason
    : "owned_job_operation_failed";
}

// Bound an individual JSONL response before its newline arrives. Successful
// frames release their bytes; normal polling never consumes a lifetime quota.
export function guardianFrames(onLine, onOverflow) {
  let frame = Buffer.alloc(0),
    stopped = false;
  return (bytes) => {
    if (stopped) return;
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      if (frame.length + end - offset > 65536) {
        stopped = true;
        onOverflow();
        return;
      }
      frame = Buffer.concat([frame, bytes.subarray(offset, end)]);
      if (newline < 0) return;
      const line = frame.toString("utf8");
      frame = Buffer.alloc(0);
      if (onLine(line) === false) {
        stopped = true;
        return;
      }
      offset = newline + 1;
    }
  };
}

export function windowsArgument(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("invalid Windows argument");
  return (
    '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1") + '"'
  );
}

export function validateWindowsJobRequest({
  module,
  args = [],
  cwd,
  threads = 1,
  wallMs,
  resourceWatchdog = false,
  writeTransferLimitBytes = -1,
  signal,
}) {
  if (
    typeof module !== "string" ||
    typeof cwd !== "string" ||
    !isAbsolute(module) ||
    !isAbsolute(cwd) ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string") ||
    !Number.isSafeInteger(threads) ||
    threads < 1 ||
    threads > profile.compute.threads ||
    !Number.isSafeInteger(wallMs) ||
    wallMs < 1 ||
    wallMs > profile.offline.chunkMs ||
    typeof resourceWatchdog !== "boolean" ||
    !Number.isSafeInteger(writeTransferLimitBytes) ||
    writeTransferLimitBytes < -1 ||
    writeTransferLimitBytes > profile.offline.outputBytes ||
    (signal !== undefined && !(signal instanceof globalThis.AbortSignal))
  )
    throw new Error("invalid owned process request");
  const commandLine = [
    process.execPath,
    `--v8-pool-size=${threads}`,
    module,
    ...args,
  ]
    .map(windowsArgument)
    .join(" ");
  if (commandLine.length >= 30000) throw new Error("owned command too long");
  return {
    module,
    args: [...args],
    cwd,
    threads,
    wallMs,
    resourceWatchdog,
    writeTransferLimitBytes,
    signal,
    commandLine,
  };
}

export async function createWindowsJob(options) {
  if (process.platform !== "win32")
    throw new Error("Windows containment unavailable");
  const {
    cwd,
    threads,
    wallMs,
    resourceWatchdog,
    writeTransferLimitBytes,
    signal,
    commandLine,
  } = validateWindowsJobRequest(options);
  if (signal?.aborted) throw new Error("owned job cancelled before creation");
  // Artifact verification occurs before either native helper is generated.
  const processMeterBinding = loadProcessMeter();
  const meterCancellation = new globalThis.AbortController();
  const guardian = spawn(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fileURLToPath(new URL("windows-job.ps1", import.meta.url)),
      "-Threads",
      String(threads),
    ],
    {
      cwd: resolve(cwd),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  let processMeter = null,
    pending = null,
    failure = null,
    closing = false,
    stderrBytes = 0,
    started = false,
    terminationRequested = false,
    finishing = false,
    closePromise = null;
  const fail = () => {
    failure ??= new Error("owned job guardian failed");
    if (pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      request.reject(failure);
    }
    if (!closing) guardian.kill();
    meterCancellation.abort();
  };
  const exited = new Promise((done) =>
    guardian.once("close", (code, signal) => done({ code, signal }))
  );
  // Cancellation during compilation/attachment must close the same owned
  // spawn, including the suspended root and helper, rather than wait to start.
  signal?.addEventListener("abort", fail, { once: true });
  guardian.once("close", () => signal?.removeEventListener("abort", fail));
  if (signal?.aborted) fail();
  guardian.on("error", fail);
  guardian.stdin.on("error", fail);
  guardian.stderr.on("data", (bytes) => {
    stderrBytes += bytes.length;
    if (stderrBytes > 65536) fail();
  });
  const receive = guardianFrames((line) => {
    if (failure) return false;
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      fail();
      return false;
    }
    if (
      !reply ||
      typeof reply !== "object" ||
      Array.isArray(reply) ||
      typeof reply.op !== "string"
    ) {
      fail();
      return false;
    }
    if (reply.op === "error") {
      failure = new Error(
        `owned job failed at ${reply.stage} (native code ${reply.nativeError}, ${reply.errorType}/${reply.innerType}, reason ${ownedJobFailureReason(reply)})`
      );
      fail();
      return false;
    }
    if (!pending || reply.op !== pending.expected) {
      fail();
      return false;
    }
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    request.resolve(reply);
  }, fail);
  guardian.stdout.on("data", receive);
  guardian.once("close", () => {
    if (!closing || pending) fail();
  });
  function request(value, expected, timeout = 15000) {
    if (failure) return Promise.reject(failure);
    if (pending || closing)
      return Promise.reject(new Error("owned job request overlap/closed"));
    return new Promise((done, reject) => {
      pending = {
        expected,
        resolve: done,
        reject,
        timer: setTimeout(fail, timeout),
      };
      guardian.stdin.write(JSON.stringify(value) + "\n");
    });
  }
  function closeGuardian() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      if (pending) {
        fail();
        guardian.kill();
      }
      guardian.stdin.end();
      const timer = setTimeout(() => guardian.kill(), 5000);
      try {
        return await exited;
      } finally {
        clearTimeout(timer);
        guardian.stdout.off("data", receive);
      }
    })();
    return closePromise;
  }
  try {
    processMeter = await attachGuardianMeter(
      guardian,
      threads,
      fail,
      meterCancellation.signal,
      processMeterBinding
    );
    const nativeInitial = validateOwnedSample(
      (
        await request(
          {
            op: "create",
            executable: process.execPath,
            commandLine,
            cwd,
            threads,
            wallMs,
            resourceWatchdog,
            writeTransferLimitBytes,
          },
          "created"
        )
      ).sample,
      threads
    );
    if (
      nativeInitial.resourceWatchdogEnabled !== resourceWatchdog ||
      nativeInitial.resourceWatchdogExpired !== false ||
      nativeInitial.writeTransferLimitBytes !== writeTransferLimitBytes ||
      nativeInitial.writeTransferLimitExceeded !== false
    )
      throw new Error("resource watchdog launch mismatch");
    async function withMeter(sample) {
      const meter = await processMeter.sample(sample.guardian);
      const measured = {
        ...sample,
        meter,
        observedTotalRssBytes: sample.totalRssBytes + meter.helper.rssBytes,
        observedTotalCpuMs:
          sample.cpuMs + meter.target.cpuMs + meter.helper.cpuMs,
      };
      validateMeterEnvelope(measured);
      if (measured.observedTotalRssBytes >= profile.ram.hardGiB * 1024 ** 3)
        throw new Error("owned envelope ram_hard");
      return measured;
    }
    const initial = await withMeter(nativeInitial);
    if (initial.observedTotalRssBytes >= profile.ram.hardGiB * 1024 ** 3)
      throw new Error("owned envelope ram_hard");
    let previous = JSON.parse(JSON.stringify(initial));
    async function readSample() {
      try {
        const sample = await withMeter(
          validateOwnedSample(
            (await request({ op: "sample" }, "sample")).sample,
            threads,
            previous
          )
        );
        previous = JSON.parse(JSON.stringify(sample));
        if (
          started &&
          !terminationRequested &&
          resourceWatchdog &&
          !sample.resourceWatchdogExpired &&
          sample.active !== 0
        )
          await request(
            { op: "heartbeat", hostToken: sample.host?.startToken },
            "heartbeat"
          );
        if (sample.totalRssBytes >= profile.ram.hardGiB * 1024 ** 3)
          throw new Error("owned envelope ram_hard");
        return sample;
      } catch (error) {
        fail();
        throw error;
      }
    }
    return {
      initial,
      resourceWatchdog,
      async start(beforeStart = () => true) {
        if (started || terminationRequested || finishing)
          throw new Error("owned job already started/finishing");
        if (typeof beforeStart !== "function")
          throw new Error("invalid pre-start guard");
        // A resource caller evaluates the final fresh owned/host sample, rather
        // than licensing ResumeThread with the earlier policy observation.
        const finalSample = await readSample();
        const allowed = beforeStart(finalSample);
        if (typeof allowed !== "boolean")
          throw new Error("asynchronous or invalid pre-start guard");
        if (!allowed) return false;
        started = true;
        await request(
          { op: "start", hostToken: finalSample.host?.startToken },
          "started"
        );
        return true;
      },
      sample: readSample,
      async terminate() {
        // Native termination disarms the heartbeat. Keep subsequent samples
        // available for membership/CPU drain without trying to re-arm it.
        terminationRequested = true;
        await request({ op: "terminate" }, "terminated");
      },
      async finish() {
        if (finishing) throw new Error("owned job already finishing");
        finishing = true;
        try {
          const terminal = validateTerminalSample(
            (await request({ op: "finish" }, "finished")).terminal,
            threads,
            previous
          );
          const exit = await closeGuardian();
          if (failure || exit.code !== 0 || exit.signal !== null)
            throw new Error("guardian terminal exit unconfirmed");
          const guardianFinal = await processMeter.finish(
            terminal.sample.guardian
          );
          // Retained in-process handle includes the helper response/dispose/exit
          // tail. Caller/probes/service remain outside whole-program accounting.
          return {
            jobExited: true,
            guardianExited: true,
            jobCpuComplete: true,
            guardianCpuComplete: true,
            guardianFinal: guardianFinal.target,
            finalJobGuardianCpuMs:
              terminal.sample.cpuMs + guardianFinal.target.cpuMs,
            meterLastSample: guardianFinal.helper,
            meterFinal: guardianFinal.helperFinal,
            meterExited: true,
            meterCpuComplete: true,
            finalOwnedCpuMs:
              terminal.sample.cpuMs +
              guardianFinal.target.cpuMs +
              guardianFinal.helperFinal.cpuMs,
            accountingComplete: false,
            reason: "caller_and_program_unaccounted",
            forced: terminal.forced,
            sample: terminal.sample,
          };
        } catch (error) {
          fail();
          await closeGuardian();
          await processMeter.close();
          throw error;
        }
      },
      // Fault injection targets this immutable spawn handle, never a supplied PID.
      abortGuardian() {
        guardian.kill();
      },
      abortMeter() {
        processMeter.abort();
      },
      async close() {
        await closeGuardian();
        return processMeter.close();
      },
    };
  } catch (error) {
    closing = true;
    guardian.kill();
    await exited;
    if (processMeter) await processMeter.close();
    throw error;
  }
}
