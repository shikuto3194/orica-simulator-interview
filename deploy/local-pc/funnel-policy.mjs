import { TARGET } from "./funnel-probe.mjs";

export const COOLDOWN_MS = 15 * 60_000;
export const HOUR_MS = 60 * 60_000;
export const EXPECTED_FUNNEL = Object.freeze({
  TCP: { 443: { HTTPS: true } },
  Web: {
    [`${TARGET.hostname}:443`]: {
      Handlers: { "/": { Proxy: TARGET.upstream } },
    },
  },
  AllowFunnel: { [`${TARGET.hostname}:443`]: true },
});

export function canonical(value) {
  if (Array.isArray(value))
    return JSON.stringify(value.map((item) => JSON.parse(canonical(item))));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, JSON.parse(canonical(value[key]))])
      )
    );
  return JSON.stringify(value);
}
export const isExpectedFunnel = (value) =>
  !!value && canonical(value) === canonical(EXPECTED_FUNNEL);
export function isEmptyFunnel(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, entries]) =>
        ["TCP", "Web", "AllowFunnel"].includes(key) &&
        entries &&
        typeof entries === "object" &&
        !Array.isArray(entries) &&
        Object.keys(entries).length === 0
    )
  );
}
export const isConnected = (status) =>
  status?.BackendState === "Running" &&
  status?.Self?.Online === true &&
  status?.Self?.DNSName?.replace(/\.$/, "") === TARGET.hostname;

export function initialState() {
  return {
    version: 1,
    lastCheckAt: 0,
    streak: 0,
    streakStartedAt: 0,
    attempts: [],
    pending: null,
  };
}
export function validateState(state) {
  const time = (value) => Number.isFinite(value) && value >= 0;
  if (
    state?.version !== 1 ||
    !time(state.lastCheckAt) ||
    !time(state.streakStartedAt) ||
    !Number.isInteger(state.streak) ||
    state.streak < 0 ||
    state.streak > 3 ||
    !Array.isArray(state.attempts) ||
    !state.attempts.every(time) ||
    (state.pending !== null &&
      (!time(state.pending?.startedAt) ||
        !Number.isInteger(state.pending.restoreTries) ||
        state.pending.restoreTries < 0 ||
        state.pending.restoreTries > 3 ||
        state.pending.expected !== canonical(EXPECTED_FUNNEL)))
  )
    throw new Error("Invalid watchdog state; automatic recovery stopped");
  return state;
}

export function decide(previous, snapshot, now) {
  validateState(previous);
  const state = {
    ...previous,
    attempts: previous.attempts.filter((at) => now - at < HOUR_MS),
    lastCheckAt: now,
  };
  const result = (reason, action = "none") => ({ state, reason, action });
  const reset = (reason) => {
    state.streak = 0;
    state.streakStartedAt = 0;
    return result(reason);
  };
  if (previous.lastCheckAt > now || state.attempts.some((at) => at > now))
    return reset("clock-moved-backwards");
  if (snapshot.disabled) return reset("operator-disabled");
  if (!isConnected(snapshot.status)) return reset("tailscale-unavailable");
  if (!snapshot.local.ok) return reset("local-api-unhealthy");
  if (state.pending) {
    if (isExpectedFunnel(snapshot.funnel)) state.pending = null;
    else if (!isEmptyFunnel(snapshot.funnel))
      return reset("configuration-changed");
    else if (
      now - state.pending.startedAt > COOLDOWN_MS ||
      state.pending.restoreTries >= 3
    )
      return reset("restore-needs-operator");
    else return result("interrupted-restore", "restore");
  }
  if (!isExpectedFunnel(snapshot.funnel))
    return reset("funnel-disabled-or-changed");
  if (snapshot.public.ok) return reset("healthy");
  if (
    snapshot.public.dns.length !== 2 ||
    !snapshot.public.dns.every((reply) => reply.status === "nxdomain")
  )
    return reset("public-path-unhealthy");
  if (snapshot.authorities?.status !== "nxdomain")
    return reset(
      snapshot.authorities?.status === "present"
        ? "dns-cache-propagating"
        : "authority-unconfirmed"
    );
  const elapsed = now - previous.lastCheckAt;
  if (!previous.streak || elapsed > 150_000) {
    state.streak = 1;
    state.streakStartedAt = now;
  } else if (elapsed >= 45_000) state.streak = Math.min(3, previous.streak + 1);
  if (state.streak < 3 || now - state.streakStartedAt < 120_000)
    return result("confirming-dns-loss");
  if (state.attempts.some((at) => now - at < COOLDOWN_MS))
    return result("recovery-cooldown");
  if (state.attempts.length >= 2) return result("recovery-rate-limited");
  return result("confirmed-dns-loss", "refresh");
}

// Persist before every mutation. A later invocation can finish an interrupted
// enable, but only while our journal is recent and the configuration is empty.
export async function recover(decision, io, now) {
  const state = decision.state;
  const fresh = await io.inspect();
  if (!io.enabled() || !isConnected(fresh.status) || !fresh.local.ok)
    return { state, reason: "recovery-precondition-changed" };
  if (decision.action === "refresh") {
    if (!isExpectedFunnel(fresh.funnel))
      return { state, reason: "configuration-changed" };
    state.attempts.push(now);
    state.pending = {
      startedAt: now,
      restoreTries: 0,
      expected: canonical(EXPECTED_FUNNEL),
    };
    state.streak = 0;
    state.streakStartedAt = 0;
    await io.save(state);
  } else if (
    decision.action !== "restore" ||
    !state.pending ||
    now - state.pending.startedAt > COOLDOWN_MS ||
    state.pending.restoreTries >= 3 ||
    !isEmptyFunnel(fresh.funnel)
  )
    return { state, reason: "restore-precondition-changed" };
  let offError;
  let restoreError;
  try {
    if (decision.action === "refresh")
      await io.command(["funnel", "--https=443", "off"]);
  } catch (error) {
    offError = error.code ?? error.message;
  } finally {
    // Do not overwrite a concurrent operator change, even during recovery.
    const current = await io.inspect();
    if (isExpectedFunnel(current.funnel)) {
      state.pending = null;
    } else if (
      io.enabled() &&
      isConnected(current.status) &&
      current.local.ok &&
      isEmptyFunnel(current.funnel)
    ) {
      state.pending.restoreTries++;
      await io.save(state);
      await io.command(["funnel", "--bg", "--https=443", TARGET.upstream]);
      const restored = await io.inspect();
      if (!isExpectedFunnel(restored.funnel))
        restoreError = new Error("Funnel configuration did not restore");
      else state.pending = null;
    }
    await io.save(state);
  }
  if (restoreError) throw restoreError;
  return {
    state,
    reason: state.pending
      ? "restore-pending"
      : offError
        ? "off-failed-config-preserved"
        : "refresh-awaiting-public-dns",
  };
}
