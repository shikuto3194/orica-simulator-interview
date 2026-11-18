import test from "node:test";
import assert from "node:assert/strict";
import { URL } from "node:url";
import { setTimeout } from "node:timers";

const { fetch, Response } = globalThis;
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { startDotSessionServer } from "./session-server.mjs";

const token = (exp) =>
  `mock.${Buffer.from(JSON.stringify({ sub: "bob-user", exp: exp ?? Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.mock`;
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "dot-session-test-"));
  await writeFile(join(root, "index.html"), "<title>Normal app</title>");
  const calls = [];
  const helper = await startDotSessionServer({
    webRoot: root,
    expectedEmail: "opponent@example.test",
    port: 0,
    revision: "verified-revision",
    authenticate: async () => ({
      id: "bob-user",
      email: "opponent@example.test",
    }),
    loadDecks: async () => ({ user_id: "bob-user", decks: [] }),
    rules: { savedDecks: (rows) => rows, ownLegalActions: () => [] },
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return new Response(JSON.stringify({ invitations: [], rooms: [] }));
    },
    ...options,
  });
  t.after(async () => {
    await new Promise((done) => helper.server.close(done));
    await rm(root, { recursive: true });
  });
  const request = (path, body, extra = {}) =>
    fetch(helper.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Dot-Connection": helper.key,
        "Content-Type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...helper, request, calls };
}

test("no key, wrong origin, and DNS rebinding host are denied before auth", async (t) => {
  let authCalls = 0;
  const f = await fixture(t, {
    authenticate: async () => {
      authCalls += 1;
      throw new Error();
    },
  });
  assert.equal((await fetch(f.origin + "/dot/status")).status, 403);
  assert.equal(
    (
      await f.request(
        "/dot/connect",
        { accessToken: token() },
        { Origin: "https://evil.example" }
      )
    ).status,
    403
  );
  const reboundStatus = await new Promise((done, reject) => {
    const req = httpRequest(
      f.origin + "/dot/status",
      { headers: { Host: "evil.example", "X-Dot-Connection": f.key } },
      (res) => {
        res.resume();
        done(res.statusCode);
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(reboundStatus, 403);
  assert.equal(authCalls, 0);
  assert.equal(f.calls.length, 0);
});

test("verified normal opponent session enables invitation reads without revealing token", async (t) => {
  const f = await fixture(t);
  const sessionToken = token();
  const connected = await f.request("/dot/connect", {
    accessToken: sessionToken,
  });
  assert.equal(connected.status, 200);
  assert.ok(!(await connected.text()).includes(sessionToken));
  assert.equal((await f.request("/dot/invitations")).status, 200);
  assert.equal(f.calls[0].url, "http://127.0.0.1:4310/api/room-invitations");
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${sessionToken}`);
  const status = await (await f.request("/dot/status")).json();
  assert.deepEqual(status, { connected: true, roomId: null });
});

test("wrong account and expired session cannot connect", async (t) => {
  const wrong = await fixture(t, {
    authenticate: async () => ({ id: "bob-user", email: "host@example.test" }),
  });
  assert.equal(
    (await wrong.request("/dot/connect", { accessToken: token() })).status,
    403
  );
  const expired = await fixture(t);
  assert.equal(
    (await expired.request("/dot/connect", { accessToken: token(1) })).status,
    401
  );
});

test("disconnect prevents later account operations", async (t) => {
  const f = await fixture(t);
  await f.request("/dot/connect", { accessToken: token() });
  assert.equal((await f.request("/dot/disconnect", {})).status, 200);
  assert.equal((await f.request("/dot/invitations")).status, 400);
  assert.equal(f.calls.length, 0);
});

test("disconnect cancels a decision paused in its membership check before action POST", async (t) => {
  const invitationId = "11111111-2222-3333-4444-555555555555";
  let pause = false;
  let release;
  let actionPosts = 0;
  const f = await fixture(t, {
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/room-invitations"))
        return new Response(
          JSON.stringify({
            invitations: [
              { id: invitationId, roomId: "testroom", available: true },
            ],
          })
        );
      if (url.endsWith("/accept"))
        return new Response(
          JSON.stringify({ roomId: "testroom", role: "bob" })
        );
      if (url.endsWith("/api/room")) {
        if (pause)
          return new Promise((done) => {
            release = done;
          });
        return new Response(JSON.stringify({ rooms: [] }));
      }
      if (init.method === "POST") actionPosts += 1;
      return new Response(JSON.stringify({ ok: true }));
    },
  });
  await f.request("/dot/connect", { accessToken: token() });
  await f.request("/dot/accept", { invitationId });
  pause = true;
  const decision = f.request("/dot/decision", {
    kind: "action",
    payload: { actionId: "x", expectedVersion: 1 },
  });
  while (!release) await new Promise((done) => setTimeout(done, 5));
  assert.equal((await f.request("/dot/disconnect", {})).status, 200);
  release(
    new Response(
      JSON.stringify({ rooms: [{ roomId: "testroom", role: "bob" }] })
    )
  );
  assert.equal((await decision).status, 400);
  assert.equal(actionPosts, 0);
});

test("expiry invalidates an in-flight read without a later status or control request", async (t) => {
  const invitationId = "11111111-2222-3333-4444-555555555555";
  const exp = Math.floor(Date.now() / 1000) + 2;
  let release;
  let pendingSignal;
  const f = await fixture(t, {
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/room-invitations"))
        return new Response(
          JSON.stringify({
            invitations: [
              { id: invitationId, roomId: "testroom", available: true },
            ],
          })
        );
      if (url.endsWith("/accept"))
        return new Response(
          JSON.stringify({ roomId: "testroom", role: "bob" })
        );
      if (url.endsWith("/api/room"))
        return new Response(
          JSON.stringify({ rooms: [{ roomId: "testroom", role: "bob" }] })
        );
      pendingSignal = init.signal;
      return new Promise((done) => {
        release = done;
      });
    },
  });
  assert.equal(
    (await f.request("/dot/connect", { accessToken: token(exp) })).status,
    200
  );
  assert.equal((await f.request("/dot/accept", { invitationId })).status, 200);
  const reading = f.request("/dot/state");
  while (!release) await new Promise((done) => setTimeout(done, 5));
  await new Promise((done) =>
    setTimeout(done, Math.max(1, exp * 1000 - Date.now() + 50))
  );
  assert.equal(
    pendingSignal.aborted,
    true,
    "expiry cancels the request without another client call"
  );
  release(new Response(JSON.stringify({ version: 1, state: {} })));
  assert.equal((await reading).status, 400);
  assert.equal(
    (await (await f.request("/dot/status")).json()).connected,
    false
  );
});

test("disconnect cancels a connection verification already in progress", async (t) => {
  let release;
  const f = await fixture(t, {
    authenticate: () =>
      new Promise((done) => {
        release = done;
      }),
  });
  const connecting = f.request("/dot/connect", { accessToken: token() });
  while (!release) await new Promise((done) => setTimeout(done, 5));
  await f.request("/dot/disconnect", {});
  release({ id: "bob-user", email: "opponent@example.test" });
  assert.equal((await connecting).status, 409);
  assert.equal(
    (await (await f.request("/dot/status")).json()).connected,
    false
  );
});

test("deck registration requires an explicit valid saved deck", async (t) => {
  const f = await fixture(t);
  await f.request("/dot/connect", { accessToken: token() });
  assert.equal((await f.request("/dot/deck", {})).status, 400);
  assert.equal(f.calls.length, 0);
});

test("private files and non-room APIs cannot be fetched", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + "/.env")).status, 404);
  assert.notEqual((await fetch(f.origin + "/api/game/state/full")).status, 200);
  assert.equal((await fetch(f.origin + "/")).status, 200);
  assert.equal(f.calls.length, 0);
});

test("raw and encoded traversal cannot escape the normal room proxy", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/api/room/../../game/state/full",
    "/api/room/%2e%2e/%2e%2e/game/state/full",
    "/api/room/%5c..%5cgame/state/full",
  ]) {
    const status = await new Promise((done, reject) => {
      const req = httpRequest(
        f.origin,
        { path, headers: { Host: new URL(f.origin).host } },
        (res) => {
          res.resume();
          done(res.statusCode);
        }
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 404);
  }
  assert.equal(f.calls.length, 0);
});

test("raw credential-bearing errors never reach the response", async (t) => {
  const f = await fixture(t, {
    authenticate: async () => {
      throw new Error(token());
    },
  });
  const response = await f.request("/dot/connect", { accessToken: token() });
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("mock."));
});
