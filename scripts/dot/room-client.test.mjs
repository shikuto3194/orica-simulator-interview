import test from "node:test";
import assert from "node:assert/strict";
import { DotRoomClient } from "./room-client.mjs";

const { Response } = globalThis;

const token = (exp = Math.floor(Date.now() / 1000) + 600) =>
  `mock.${Buffer.from(JSON.stringify({ sub: "opponent-id", exp })).toString("base64url")}.mock`;
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture(handler, config = {}) {
  const calls = [];
  const accessToken = token();
  const client = new DotRoomClient({
    roomId: "testroom",
    accessToken,
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        ...init,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return handler(calls.at(-1), calls.length);
    },
    ...config,
  });
  return { client, calls, accessToken };
}
const bob = { rooms: [{ roomId: "testroom", role: "bob" }] };

test("host credential cannot join or read the opponent game", async () => {
  const { client, calls } = fixture(() =>
    response({ rooms: [{ roomId: "testroom", role: "alice" }] })
  );
  await assert.rejects(client.join(), /Host session/);
  await assert.rejects(client.state(), /opponent seat/);
  assert.ok(
    calls.every(
      (call) => call.url.endsWith("/api/room") && call.method === "GET"
    )
  );
});

test("new opponent joins with its own subject and the ordinary API", async () => {
  const { client, calls, accessToken } = fixture((call, index) =>
    response(index === 1 ? { rooms: [] } : { roomId: "testroom", role: "bob" })
  );
  assert.equal((await client.join()).role, "bob");
  assert.deepEqual(calls[1].body, { userId: "opponent-id" });
  assert.equal(calls[1].url, "http://127.0.0.1:4310/api/room/testroom/join");
  assert.equal(calls[1].headers.Authorization, `Bearer ${accessToken}`);
  assert.equal(calls[1].redirect, "error");
});

test("reads only the authenticated room viewer state after bob membership", async () => {
  const view = {
    version: 9,
    state: {
      players: { bob: { hand: ["own-card"] }, alice: { hand: ["hidden"] } },
    },
  };
  const { client, calls } = fixture((call, index) =>
    response(index === 1 ? bob : view)
  );
  assert.deepEqual(await client.state(), view);
  assert.equal(
    calls[1].url,
    "http://127.0.0.1:4310/api/room/testroom/state/full"
  );
});

test("finished opponent room remains readable after disappearing from active rooms", async () => {
  const terminal = {
    version: 268,
    state: { gameResult: { losingPlayerId: "bob" } },
  };
  const { client, calls } = fixture((call, index) =>
    response(
      [
        { rooms: [] },
        { players: [{ userId: "opponent-id", role: "bob" }] },
        terminal,
      ][index - 1]
    )
  );
  assert.deepEqual(await client.state(), terminal);
  assert.equal(calls[1].url, "http://127.0.0.1:4310/api/room/testroom");
  assert.equal(
    calls[2].url,
    "http://127.0.0.1:4310/api/room/testroom/state/full"
  );
});

test("terminal fallback rejects hosts and another user occupying bob before reading state", async () => {
  for (const players of [
    [
      { userId: "opponent-id", role: "alice" },
      { userId: "other-user", role: "bob" },
    ],
    [{ userId: "other-user", role: "bob" }],
    [],
  ]) {
    const { client, calls } = fixture((call, index) =>
      response(index === 1 ? { rooms: [] } : { players })
    );
    await assert.rejects(client.state(), /opponent seat/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => !call.url.endsWith("/state/full")));
  }
});

test("finished membership fallback never enables decisions or heartbeat", async () => {
  const { client, calls } = fixture(() => response({ rooms: [] }));
  await assert.rejects(
    client.decision("action", { actionId: "x", expectedVersion: 268 }),
    /opponent seat/
  );
  await assert.rejects(client.heartbeat(), /opponent seat/);
  assert.ok(
    calls.every(
      (call) => call.method === "GET" && call.url.endsWith("/api/room")
    )
  );
});

test("actual card numbers go only to the opponent deck endpoint", async () => {
  const { client, calls } = fixture((call, index) =>
    response(index === 1 ? bob : { ok: true })
  );
  await client.deck(["BSTH01-X01"]);
  assert.deepEqual(calls[1].body, {
    userId: "opponent-id",
    deckCardNos: ["BSTH01-X01"],
  });
});

test("ordinary decisions preserve expected version and never retry a conflict", async () => {
  const { client, calls } = fixture((call, index) =>
    response(
      index === 1 ? bob : { error: "Conflict", currentVersion: 10 },
      index === 1 ? 200 : 409
    )
  );
  await assert.rejects(
    client.decision("action", {
      actionId: "server-action-id",
      expectedVersion: 9,
    }),
    (error) => error.status === 409 && error.currentVersion === 10
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, {
    actionId: "server-action-id",
    expectedVersion: 9,
  });
});

test("rejects resets, state writes, arbitrary routes, and missing versions before network", async () => {
  const { client, calls } = fixture(() => response(bob));
  for (const kind of [
    "reset",
    "start",
    "state",
    "replay/restore",
    "../state",
  ]) {
    await assert.rejects(
      client.decision(kind, { expectedVersion: 1 }),
      /normal room/
    );
  }
  await assert.rejects(
    client.decision("action", { actionId: "x" }),
    /expectedVersion/
  );
  await assert.rejects(
    client.decision("action", { expectedVersion: 1, state: {} }),
    /game state/
  );
  await assert.rejects(
    client.decision("action", { expectedVersion: 1, actingPlayerId: "alice" }),
    /player identity/
  );
  assert.equal(calls.length, 0);
});

test("rejects another returned seat without reading either hand", async () => {
  const { client, calls } = fixture((call, index) =>
    response(index === 1 ? { rooms: [] } : { role: "alice" })
  );
  await assert.rejects(client.join(), /did not assign/);
  assert.equal(calls.length, 2);
});

test("requires secure exact origins and safe room IDs", () => {
  for (const baseUrl of [
    "http://example.com",
    "https://example.com/api",
    "https://u:p@example.com",
    "https://example.com?token=x",
  ]) {
    assert.throws(
      () =>
        new DotRoomClient({ baseUrl, roomId: "room", accessToken: token() }),
      /API origin/
    );
  }
  assert.throws(
    () => new DotRoomClient({ roomId: "../room", accessToken: token() }),
    /room ID/
  );
});

test("expired sessions stop before any connection", async () => {
  const { client, calls } = fixture(() => response(bob), {
    accessToken: token(1),
  });
  await assert.rejects(client.join(), /expired/);
  assert.equal(calls.length, 0);
});

test("closing during a membership read prevents every later mutation even if fetch ignores abort", async () => {
  for (const operation of [
    (client) =>
      client.decision("action", { actionId: "x", expectedVersion: 1 }),
    (client) => client.deck(["BSTH01-X01"]),
    (client) => client.heartbeat(),
    (client) => client.join(),
    (client) => client.acceptInvitation("11111111-2222-3333-4444-555555555555"),
  ]) {
    let release;
    const { client, calls } = fixture(
      () =>
        new Promise((done) => {
          release = done;
        })
    );
    const pending = operation(client);
    client.close();
    assert.equal(calls[0].signal.aborted, true);
    release(response(bob));
    await assert.rejects(pending, /disconnected/);
    assert.equal(calls.length, 1);
    await assert.rejects(client.invitations(), /disconnected/);
    assert.equal(calls.length, 1);
  }
});

test("connection failure stops without leaking token or replaying mutation", async () => {
  const { client, calls, accessToken } = fixture(() => {
    throw new Error("network");
  });
  await assert.rejects(
    client.join(),
    (error) =>
      !error.message.includes(accessToken) && /not retried/.test(error.message)
  );
  assert.equal(calls.length, 1);
});

test("accepts only an available received invitation and binds its bob room", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const { client, calls } = fixture(
    (call, index) =>
      response(
        [
          { invitations: [{ id, roomId: "testroom", available: true }] },
          { rooms: [] },
          { roomId: "testroom", role: "bob" },
          { rooms: [{ roomId: "testroom", role: "bob" }] },
          { version: 1, state: {} },
        ][index - 1]
      ),
    { roomId: undefined }
  );
  await client.acceptInvitation(id);
  await client.state();
  assert.equal(
    calls[2].url,
    `http://127.0.0.1:4310/api/room-invitations/${id}/accept`
  );
  assert.equal(
    calls[4].url,
    "http://127.0.0.1:4310/api/room/testroom/state/full"
  );
});

test("unavailable invitations never trigger participation", async () => {
  const { client, calls } = fixture(() => response({ invitations: [] }));
  await assert.rejects(
    client.acceptInvitation("11111111-2222-3333-4444-555555555555"),
    /unavailable/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});
