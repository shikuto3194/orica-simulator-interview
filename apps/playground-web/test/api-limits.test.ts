import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createApiAdmission, type ApiLimits } from "../server/api-limits";

function response() {
  const res = new EventEmitter() as ServerResponse & {
    status: number;
    headers: Record<string, string>;
  };
  res.writeHead = ((status: number, headers: Record<string, string>) => {
    res.status = status;
    res.headers = headers;
    return res;
  }) as typeof res.writeHead;
  res.end = (() => {
    res.emit("finish");
    return res;
  }) as typeof res.end;
  return res;
}
function request(peer = "127.0.0.1", stream = false, forwarded = "") {
  return {
    socket: { remoteAddress: peer },
    method: "GET",
    url: stream ? "/api/room/room1/events" : "/healthz",
    headers: { "x-forwarded-for": forwarded },
  } as unknown as IncomingMessage;
}
const roomy: Partial<ApiLimits> = {
  burst: 1000,
  requestsPerSecond: 1000,
  peerBurst: 1000,
  peerRequestsPerSecond: 1000,
};
describe("API admission", () => {
  it("enforces peer bursts despite spoofed forwarding headers and refills over time", () => {
    let now = 0;
    const gate = createApiAdmission(
      { ...roomy, peerBurst: 2, peerRequestsPerSecond: 1 },
      () => now
    );
    for (let i = 0; i < 2; i++) {
      const res = response();
      expect(gate.admit(request(), res)).toBe(true);
      res.end();
    }
    const denied = response();
    expect(
      gate.admit(request("127.0.0.1", false, "different-client"), denied)
    ).toBe(false);
    expect(denied.status).toBe(429);
    expect(denied.headers["Retry-After"]).toBe("1");
    now = 1000;
    expect(gate.admit(request(), response())).toBe(true);
    expect(gate.admit(request(), response())).toBe(false);
  });
  it("enforces a global budget even when peers rotate", () => {
    const gate = createApiAdmission({ ...roomy, burst: 2 }, () => 0);
    expect(gate.admit(request("one"), response())).toBe(true);
    expect(gate.admit(request("two"), response())).toBe(true);
    expect(gate.admit(request("three"), response())).toBe(false);
  });
  it("bounds tracked peers without evicting active peers and reclaims idle entries", () => {
    let now = 0;
    const gate = createApiAdmission({ ...roomy, maxPeers: 1 }, () => now);
    const open = response();
    expect(gate.admit(request("one"), open)).toBe(true);
    now = 60_000;
    expect(gate.admit(request("two"), response())).toBe(false);
    open.emit("close");
    now = 120_000;
    expect(gate.admit(request("two"), response())).toBe(true);
  });
  it.each([
    ["maxActiveRequests", false, "two"],
    ["maxPeerActiveRequests", false, "one"],
    ["maxStreams", true, "two"],
    ["maxPeerStreams", true, "one"],
  ] as const)(
    "enforces %s and releases once on finish/close",
    (limit, stream, peer) => {
      const gate = createApiAdmission({ ...roomy, [limit]: 1 }, () => 0);
      const first = response();
      expect(gate.admit(request("one", stream), first)).toBe(true);
      expect(gate.admit(request(peer, stream), response())).toBe(false);
      first.emit("finish");
      first.emit("close");
      expect(gate.admit(request(peer, stream), response())).toBe(true);
      expect(gate.admit(request(peer, stream), response())).toBe(false);
    }
  );
  it("stream saturation leaves capacity for heartbeats and ordinary requests", () => {
    const gate = createApiAdmission({ ...roomy, maxStreams: 1 }, () => 0);
    expect(gate.admit(request("one", true), response())).toBe(true);
    expect(gate.admit(request("two", true), response())).toBe(false);
    expect(gate.admit(request("one"), response())).toBe(true);
  });
  it("rejects disabling or unbounded limits", () => {
    for (const value of [0, -1, Infinity, NaN, 0.5])
      expect(() => createApiAdmission({ maxSockets: value })).toThrow();
  });
});

it("separates 20 verified users behind one proxy while bounding each identity", () => {
  const gate = createApiAdmission({ ...roomy, maxPeerStreams: 3 }, () => 0);
  const opened = [];
  for (let i = 0; i < 20; i++) {
    const res = response();
    expect(gate.admit(request("127.0.0.1", true), res, `user-${i}`)).toBe(true);
    opened.push(res);
  }
  expect(gate.admit(request("127.0.0.1", true), response(), "user-0")).toBe(
    true
  );
  expect(gate.admit(request("127.0.0.1", true), response(), "user-0")).toBe(
    true
  );
  expect(
    gate.admit(request("127.0.0.1", true, "forged"), response(), "user-0")
  ).toBe(false);
  opened[0].emit("close");
  expect(gate.admit(request("127.0.0.1", true), response(), "user-0")).toBe(
    true
  );
});
