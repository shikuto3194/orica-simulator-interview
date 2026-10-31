import assert from "node:assert/strict";
import { test } from "node:test";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import {
  TARGET,
  RESOLVERS,
  isPublicAddress,
  resolvePublic,
  probePublic,
  probeAuthorities,
  localHealth,
  publicHealth,
  dnsJson,
} from "../deploy/local-pc/funnel-probe.mjs";
import {
  EXPECTED_FUNNEL,
  canonical,
  initialState,
  validateState,
  decide,
  recover,
} from "../deploy/local-pc/funnel-policy.mjs";
import {
  runOnce,
  saveState,
  loadState,
  acquireLease,
} from "../deploy/local-pc/funnel-watchdog.mjs";

const connected = () => ({
  BackendState: "Running",
  Self: { Online: true, DNSName: `${TARGET.hostname}.` },
});
const local = () => ({
  local: { ok: true },
  status: connected(),
  funnel: globalThis.structuredClone(EXPECTED_FUNNEL),
});
const missing = () => ({
  ok: false,
  dns: RESOLVERS.map((resolver) => ({
    resolver,
    status: "nxdomain",
    addresses: [],
  })),
  ingress: [],
});
const healthy = () => ({
  ok: true,
  dns: RESOLVERS.map((resolver) => ({
    resolver,
    status: "ok",
    addresses: ["103.84.155.153"],
  })),
  ingress: [{ address: "103.84.155.153", ok: true }],
});
const snapshot = () => ({
  ...local(),
  public: missing(),
  authorities: { status: "nxdomain" },
  disabled: false,
});
const START = 1_000_000_000;
function ready() {
  let state = initialState();
  for (const delta of [0, 60_000])
    state = decide(state, snapshot(), START + delta).state;
  return decide(state, snapshot(), START + 120_000);
}
function fakeIO(options = {}) {
  let view = local();
  let enabled = true;
  const calls = [];
  const saves = [];
  const io = {
    inspect: async () => globalThis.structuredClone(view),
    enabled: () => enabled,
    save: async (state) => {
      saves.push(globalThis.structuredClone(state));
    },
    command: async (args) => {
      calls.push(args);
      if (args.at(-1) === "off") {
        assert.ok(saves.at(-1).pending, "journal precedes disabling Funnel");
        view.funnel = {};
        await options.afterOff?.(view, () => {
          enabled = false;
        });
      } else {
        assert.ok(
          saves.at(-1).pending.restoreTries > 0,
          "journal precedes enabling Funnel"
        );
        if (options.enableError) throw new Error("enable failed");
        view.funnel = globalThis.structuredClone(EXPECTED_FUNNEL);
      }
    },
  };
  return {
    io,
    calls,
    saves,
    setView: (value) => {
      view = value;
    },
  };
}

test("requires three spaced observations over two minutes", () => {
  assert.equal(ready().action, "refresh");
  let state = initialState();
  for (const delta of [0, 10, 20, 30, 40]) {
    const result = decide(state, snapshot(), START + delta);
    assert.equal(result.action, "none");
    state = result.state;
  }
  const gap = decide(ready().state, snapshot(), START + 400_000);
  assert.equal(gap.state.streak, 1);
  assert.equal(gap.action, "none");
});

test("unrelated failures and intentional configuration changes never restart Funnel", () => {
  for (const mutate of [
    (value) => {
      value.local.ok = false;
    },
    (value) => {
      value.status.Self.Online = false;
    },
    (value) => {
      value.status.Self.DNSName = "renamed.ts.net";
    },
    (value) => {
      value.status.BackendState = "NeedsLogin";
    },
    (value) => {
      value.funnel = {};
    },
    (value) => {
      value.funnel.Web[`${TARGET.hostname}:443`].Handlers["/"].Proxy =
        "http://127.0.0.1:9999";
    },
    (value) => {
      value.funnel.AllowFunnel[`${TARGET.hostname}:443`] = false;
    },
    (value) => {
      value.funnel.Web[`${TARGET.hostname}:443`].Handlers["/other"] = {
        Text: "operator",
      };
    },
    (value) => {
      value.public.dns[0].status = "unknown";
    },
    (value) => {
      value.public.dns.pop();
    },
    (value) => {
      value.authorities.status = "unknown";
    },
    (value) => {
      value.authorities.status = "present";
    },
    (value) => {
      value.disabled = true;
    },
  ]) {
    const view = snapshot();
    mutate(view);
    const result = decide(ready().state, view, START + 180_000);
    assert.equal(result.action, "none", JSON.stringify(view));
    assert.equal(result.state.streak, 0);
  }
});

test("cooldown, hourly cap and backwards clocks survive restarts", () => {
  const state = ready().state;
  state.attempts = [START + 60_000];
  assert.equal(
    decide(state, snapshot(), START + 180_000).reason,
    "recovery-cooldown"
  );
  state.attempts = [START - 2_000_000, START - 1_000_000];
  assert.equal(
    decide(state, snapshot(), START + 180_000).reason,
    "recovery-rate-limited"
  );
  state.attempts = [START + 500_000];
  assert.equal(decide(state, snapshot(), START + 180_000).action, "none");
  assert.equal(
    decide(state, snapshot(), START).reason,
    "clock-moved-backwards"
  );
});

test("refresh journals before off/on and waits for actual public recovery", async () => {
  const fixture = fakeIO();
  const result = await recover(ready(), fixture.io, START + 120_000);
  assert.deepEqual(fixture.calls, [
    ["funnel", "--https=443", "off"],
    ["funnel", "--bg", "--https=443", TARGET.upstream],
  ]);
  assert.equal(result.state.pending, null);
  assert.equal(result.state.attempts.length, 1);
  assert.equal(result.reason, "refresh-awaiting-public-dns");
  assert.equal(
    decide(result.state, { ...snapshot(), public: healthy() }, START + 180_000)
      .reason,
    "healthy"
  );
});

test("a failed disable still restores an empty configuration", async () => {
  const fixture = fakeIO({
    afterOff: () => {
      throw new Error("command timeout after applying");
    },
  });
  await recover(ready(), fixture.io, START + 120_000);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.saves.at(-1).pending, null);
});

test("does not overwrite an operator change during the recovery transaction", async () => {
  for (const afterOff of [
    (view) => {
      view.funnel = { Web: { other: { Handlers: {} } } };
    },
    (_view, disable) => disable(),
  ]) {
    const fixture = fakeIO({ afterOff });
    const result = await recover(ready(), fixture.io, START + 120_000);
    assert.equal(fixture.calls.length, 1);
    assert.ok(result.state.pending);
  }
  const fixture = fakeIO();
  fixture.setView({ ...local(), funnel: {} });
  await recover(ready(), fixture.io, START + 120_000);
  assert.deepEqual(fixture.calls, []);
});

test("interrupted enables have bounded recovery, not unlimited toggles", async () => {
  const fixture = fakeIO({ enableError: true });
  await assert.rejects(
    recover(ready(), fixture.io, START + 120_000),
    /enable failed/
  );
  let state = fixture.saves.at(-1);
  assert.equal(state.pending.restoreTries, 1);
  const off = { ...snapshot(), funnel: {} };
  for (let i = 2; i <= 3; i++) {
    const decision = decide(state, off, START + i * 120_000);
    assert.equal(decision.action, "restore");
    await assert.rejects(
      recover(decision, fixture.io, START + i * 120_000),
      /enable failed/
    );
    state = fixture.saves.at(-1);
  }
  assert.equal(
    decide(state, off, START + 420_000).reason,
    "restore-needs-operator"
  );
  assert.equal(fixture.calls.filter((args) => args.at(-1) === "off").length, 1);
  state.pending.restoreTries = 0;
  assert.equal(decide(state, off, START + 2_000_000).action, "none");
});

test("valid recent interrupted journal can restore on the next invocation", async () => {
  const state = initialState();
  state.pending = {
    startedAt: START,
    restoreTries: 1,
    expected: canonical(EXPECTED_FUNNEL),
  };
  const decision = decide(state, { ...snapshot(), funnel: {} }, START + 60_000);
  const fixture = fakeIO();
  fixture.setView({ ...local(), funnel: {} });
  const result = await recover(decision, fixture.io, START + 60_000);
  assert.equal(fixture.calls.length, 1);
  assert.ok(fixture.calls[0].includes("--bg"));
  assert.equal(result.state.pending, null);
});

test("DNS failures are distinguished from timeouts and partial IPv6 answers", async () => {
  assert.equal(
    (await resolvePublic(RESOLVERS[0], async () => ({ Status: 3 }))).status,
    "nxdomain"
  );
  assert.equal(
    (
      await resolvePublic(RESOLVERS[0], async () => {
        throw new Error("network down");
      })
    ).status,
    "unknown"
  );
  assert.equal(
    (
      await resolvePublic(RESOLVERS[0], async (_endpoint, _name, type) => ({
        Status: type === 1 ? 3 : 0,
      }))
    ).status,
    "unknown"
  );
  for (const ip of [
    "100.120.75.105",
    "127.0.0.1",
    "10.0.0.1",
    "192.168.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
    assert.equal((await publicHealth(ip)).ok, false);
  }
  const result = await resolvePublic(
    RESOLVERS[0],
    async (_endpoint, _name, type) => ({
      Status: 0,
      Answer: type === 1 ? [{ type: 1, data: "100.120.75.105" }] : [],
    })
  );
  assert.equal(result.status, "unknown");
  await assert.rejects(
    dnsJson(RESOLVERS[0], TARGET.hostname, 1, async () => ({
      ok: false,
      status: 503,
    })),
    /503/
  );
});

test("public ingress reports immediate IPv4/IPv6 errors after TLS request setup", async (t) => {
  let expectedAddress;
  let expectedFamily;
  let expectedError;
  let all;
  t.mock.method(https, "get", (url, options) => {
    assert.equal(url, `https://${TARGET.hostname}/healthz`);
    assert.equal(options.agent, false);
    assert.notEqual(options.rejectUnauthorized, false);
    const request = new EventEmitter();
    request.destroy = () => {};
    let constructed = false;
    options.lookup(TARGET.hostname, { all }, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(
        constructed,
        true,
        "lookup must not destroy a TLS socket during construction"
      );
      assert.equal(
        request.listenerCount("error"),
        1,
        "connection errors must be observed"
      );
      if (all) {
        assert.deepEqual(address, [
          { address: expectedAddress, family: expectedFamily },
        ]);
      } else {
        assert.equal(address, expectedAddress);
        assert.equal(family, expectedFamily);
      }
      request.emit(
        "error",
        Object.assign(new Error(expectedError), { code: expectedError })
      );
    });
    constructed = true;
    return request;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  for (const scenario of [
    { address: "103.84.155.153", family: 4, error: "ECONNRESET", all: false },
    {
      address: "2403:2500:400:20::25a",
      family: 6,
      error: "ENETUNREACH",
      all: true,
    },
    {
      address: "103.84.155.153",
      family: 4,
      error: "CERT_HAS_EXPIRED",
      all: false,
    },
  ]) {
    expectedAddress = scenario.address;
    expectedFamily = scenario.family;
    expectedError = scenario.error;
    all = scenario.all;
    assert.deepEqual(await publicHealth(scenario.address), {
      address: scenario.address,
      ok: false,
      error: scenario.error,
    });
  }
});

test("external success requires both resolvers and a verified health response", async () => {
  const resolve = async (resolver) => ({
    resolver,
    status: "ok",
    addresses: ["103.84.155.153", "103.84.155.217"],
  });
  assert.equal(
    (
      await probePublic({
        resolve,
        health: async (address) => ({ address, ok: true }),
      })
    ).ok,
    true
  );
  assert.equal(
    (
      await probePublic({
        resolve,
        health: async (address) => ({ address, ok: false, status: 401 }),
      })
    ).ok,
    false
  );
  assert.equal(
    (
      await probePublic({
        resolve: async (resolver) =>
          resolver === RESOLVERS[0]
            ? resolve(resolver)
            : { resolver, status: "unknown", addresses: [] },
        health: async (address) => ({ address, ok: true }),
      })
    ).ok,
    false
  );
  assert.equal(
    (
      await localHealth(async () => ({
        status: 200,
        json: async () => ({ ok: false }),
      }))
    ).ok,
    false
  );
});

test("all discovered authorities must confirm loss; a present or failed server prevents refresh", async () => {
  const lookup = async (_endpoint, _name, type) => ({
    Status: 0,
    Answer:
      type === 2
        ? [
            { type: 2, data: "ns1.example.net." },
            { type: 2, data: "ns2.example.net." },
          ]
        : [{ type: 1, data: "199.247.152.53" }],
  });
  assert.equal(
    (
      await probeAuthorities({
        lookup,
        query: async () => ({ status: "nxdomain" }),
      })
    ).status,
    "nxdomain"
  );
  for (const status of ["ok", "unknown"]) {
    let count = 0;
    assert.notEqual(
      (
        await probeAuthorities({
          lookup,
          query: async () => ({ status: count++ ? status : "nxdomain" }),
        })
      ).status,
      "nxdomain"
    );
  }
  assert.equal(
    (
      await probeAuthorities({
        lookup: async () => {
          throw new Error("offline");
        },
      })
    ).status,
    "unknown"
  );
});

test("check mode is read-only, observation persists evidence, and corrupt state stops writes to Funnel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orica-funnel-test-"));
  const options = {
    directory,
    inspectLocal: async () => local(),
    publicProbe: async () => missing(),
    authorityProbe: async () => ({ status: "nxdomain" }),
    command: async () => {
      throw new Error("must not mutate");
    },
  };
  try {
    await runOnce({ ...options, check: true, now: () => START });
    assert.deepEqual(readdirSync(directory), []);
    for (const delta of [0, 60_000, 120_000])
      await runOnce({ ...options, now: () => START + delta });
    assert.equal(loadState(directory).streak, 3);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "latest.json"))).action,
      "refresh"
    );
    const state = loadState(directory);
    state.attempts = [START];
    saveState(directory, state);
    assert.deepEqual(loadState(directory).attempts, [START]);
    writeFileSync(join(directory, "disabled"), "operator");
    const disabled = await runOnce({
      ...options,
      apply: true,
      now: () => START + 180_000,
    });
    assert.equal(disabled.reason, "operator-disabled");
    writeFileSync(join(directory, "state.json"), "broken");
    await assert.rejects(runOnce({ ...options, apply: true }), /JSON/);
    assert.equal(readFileSync(join(directory, "state.json"), "utf8"), "broken");
    assert.throws(
      () => validateState({ ...initialState(), attempts: ["invalid"] }),
      /Invalid/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("OS lease excludes overlapping processes and becomes reusable after release", async () => {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await assert.rejects(
    acquireLease(port),
    (error) => error.code === "EADDRINUSE"
  );
  await new Promise((done) => server.close(done));
  const release = await acquireLease(port);
  await assert.rejects(
    acquireLease(port),
    (error) => error.code === "EADDRINUSE"
  );
  await release();
  await (
    await acquireLease(port)
  )();
});

test("scheduled deployment and external workflow preserve the operational boundary", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/public-api-monitor.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "7,37 \* \* \* \*"/);
  assert.match(workflow, /funnel-watchdog\.mjs --external/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|--recover|tailscale up/);
  if (process.platform === "win32") {
    const script = new URL(
      "../deploy/local-pc/register-funnel-watchdog.ps1",
      import.meta.url
    );
    const parsed = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:ORICA_FUNNEL_SCRIPT,[ref]$tokens,[ref]$errors) > $null; if($errors.Count){$errors | Out-String | Write-Error; exit 1}",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, ORICA_FUNNEL_SCRIPT: fileURLToPath(script) },
      }
    );
    assert.equal(parsed.status, 0, parsed.stderr);
  }
});
