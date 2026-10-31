import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const server = spawn(
  process.execPath,
  [
    process.argv[2]
      ? resolve(process.argv[2], "server.mjs")
      : fileURLToPath(new URL("../dist/api/server.mjs", import.meta.url)),
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      SUPABASE_SERVICE_ROLE_KEY: "build-smoke-test-not-a-real-key",
      ALLOWED_ORIGINS: "https://site.netlify.app",
      HOST: "127.0.0.1",
      PORT: String(port),
      ORICA_API_REVISION: "build-smoke-test",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  }
);
let output = "";
server.stdout.on("data", (data) => {
  output += data;
});
server.stderr.on("data", (data) => {
  output += data;
});
try {
  const deadline = Date.now() + 15_000;
  while (!output.includes("[api] Listening")) {
    if (server.exitCode !== null || Date.now() > deadline)
      throw new Error(output || "API startup timed out");
    await setTimeout(50);
  }
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await globalThis.fetch(`${base}/healthz`)).status, 200);
  assert.deepEqual(await (await globalThis.fetch(`${base}/healthz`)).json(), {
    ok: true,
    revision: "build-smoke-test",
  });
  for (const path of ["/api/game/state", "/.env", "/server.mjs"]) {
    assert.equal((await globalThis.fetch(`${base}${path}`)).status, 404);
  }
  const preflight = await globalThis.fetch(`${base}/api/room`, {
    method: "OPTIONS",
    headers: { Origin: "https://site.netlify.app" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://site.netlify.app"
  );
  const leave = await globalThis.fetch(`${base}/api/room/test/leave`, {
    method: "POST",
    headers: {
      Origin: "https://site.netlify.app",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId: "someone-else" }),
  });
  assert.equal(leave.status, 401);
  // The built factory and main share the same chunk. Freeze only this separate
  // test instance's clock: wall time and in-flight limits cannot mask the bucket.
  const buildDir = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL("../dist/api", import.meta.url));
  const { createApiServer, apiLimitsForHost, DEFAULT_API_LIMITS } =
    await import(pathToFileURL(resolve(buildDir, "http-runtime.mjs")).href);
  assert.equal(DEFAULT_API_LIMITS.burst, 120);
  assert.equal(DEFAULT_API_LIMITS.requestsPerSecond, 60);
  assert.deepEqual(apiLimitsForHost("127.0.0.1", true), {
    peerRequestsPerSecond: 60,
    peerBurst: 120,
    maxPeerActiveRequests: 64,
    maxPeerStreams: 32,
  });
  assert.deepEqual(apiLimitsForHost("0.0.0.0", true), {});
  for (const behindProxy of [false, true]) {
    let now = 0;
    const limited = createApiServer(
      new Set(),
      [],
      apiLimitsForHost("127.0.0.1", behindProxy),
      () => now
    );
    limited.listen(0, "127.0.0.1");
    await once(limited, "listening");
    try {
      const endpoint = `http://127.0.0.1:${limited.address().port}/healthz`;
      const capacity = behindProxy ? 120 : 60;
      for (let i = 0; i < capacity; i++) {
        const response = await globalThis.fetch(endpoint);
        assert.equal(response.status, 200, `burst ${i + 1}/${capacity}`);
        await response.text();
      }
      const denied = await globalThis.fetch(endpoint);
      assert.equal(denied.status, 429, "Built API must limit request bursts");
      assert.equal(denied.headers.get("retry-after"), "1");
      await denied.text();
      now = 1000;
      const replenished = behindProxy ? 60 : 30;
      for (let i = 0; i < replenished; i++) {
        const recovered = await globalThis.fetch(endpoint);
        assert.equal(
          recovered.status,
          200,
          "Bucket must refill at the configured rate"
        );
        await recovered.text();
      }
      const exhausted = await globalThis.fetch(endpoint);
      assert.equal(exhausted.status, 429, "Refill must remain bounded");
      await exhausted.text();
    } finally {
      limited.closeAllConnections();
      await new Promise((done) => limited.close(done));
    }
  }
  console.log(
    "Built API: startup, revision, CORS, authenticated leave, rate limits and private/development route isolation passed."
  );
  const disconnected = once(server, "exit");
  server.disconnect();
  await Promise.race([
    disconnected,
    setTimeout(10_000, undefined, { ref: false }).then(() => {
      throw new Error("API remained alive after supervisor disconnect");
    }),
  ]);
  console.log("Built API: supervisor disconnect stopped its child.");
} finally {
  if (server.exitCode === null) {
    const closed = once(server, "exit");
    server.kill("SIGTERM");
    await closed;
  }
}
