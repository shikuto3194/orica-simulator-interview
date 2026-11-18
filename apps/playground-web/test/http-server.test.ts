import type { Server } from "node:http";
import type { Connect } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiServer, readServerConfig } from "../server/http-server";
import { registerGameApiMiddlewares } from "../server/game-api";
import type { ApiLimits } from "../server/api-limits";

// No network/database access in transport tests (including delayed room cleanup).
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({ lt: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

const origin = "https://site.netlify.app";
const servers: Server[] = [];
async function listen(
  middlewares: Connect.NextHandleFunction[] = [],
  limits: Partial<ApiLimits> = {}
) {
  const server = createApiServer(new Set([origin]), middlewares, limits);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        })
    )
  );
  vi.restoreAllMocks();
});

describe("production API transport", () => {
  it("requires secrets and an exact HTTPS allowlist", () => {
    expect(() => readServerConfig({})).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(() =>
      readServerConfig({ SUPABASE_SERVICE_ROLE_KEY: "test" })
    ).toThrow("ALLOWED_ORIGINS");
    for (const value of [
      "*",
      "https://*.netlify.app",
      "http://site.netlify.app",
      "https://site.netlify.app/path",
    ]) {
      expect(() =>
        readServerConfig({
          SUPABASE_SERVICE_ROLE_KEY: "test",
          ALLOWED_ORIGINS: value,
        })
      ).toThrow();
    }
    expect(
      readServerConfig({
        SUPABASE_SERVICE_ROLE_KEY: "test",
        ALLOWED_ORIGINS: origin,
      }).host
    ).toBe("127.0.0.1");
  });
  it("handles preflight, rejects other origins, and preserves CORS on SSE", async () => {
    const base = await listen([
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("event: connected\ndata: {}\n\n");
      },
    ]);
    const preflight = await fetch(`${base}/api/room`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Headers": "authorization,content-type",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "Authorization"
    );
    expect(
      (
        await fetch(`${base}/api/room`, {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status
    ).toBe(403);
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/room/test/events`, {
      headers: { Origin: origin },
      signal: controller.signal,
    });
    expect(stream.headers.get("access-control-allow-origin")).toBe(origin);
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const frame = await stream.body!.getReader().read();
    expect(new TextDecoder().decode(frame.value)).toContain("event: connected");
    controller.abort();
  });
  it("mounts the real room/snapshot APIs, excludes dev routes and never serves files", async () => {
    const stack: Connect.NextHandleFunction[] = [];
    registerGameApiMiddlewares((middleware) => {
      stack.push(middleware);
    });
    const base = await listen(stack);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    for (const path of [
      "/api/game/state",
      "/api/game/start",
      "/.env",
      "/server.mjs",
    ]) {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    }
    for (const path of ["/api/room", "/api/room/test/leave", "/api/snapshot"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        body: "{}",
        headers: { Origin: origin },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });
  it("returns CORS-readable 429 before dispatch and cannot be bypassed with forwarded headers", async () => {
    const dispatch = vi.fn((_req, res) => res.end("ok"));
    const base = await listen([dispatch], {
      peerBurst: 1,
      peerRequestsPerSecond: 1,
    });
    expect(
      (await fetch(`${base}/api/room`, { headers: { Origin: origin } })).status
    ).toBe(200);
    const denied = await fetch(`${base}/api/room`, {
      headers: { Origin: origin, "X-Forwarded-For": "203.0.113.1" },
    });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("access-control-allow-origin")).toBe(origin);
    expect(denied.headers.get("retry-after")).toBe("1");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(servers.at(-1)?.maxConnections).toBe(128);
  });
  it("caps actual SSE responses, frees aborted streams, and leaves ordinary requests available", async () => {
    const base = await listen(
      [
        (_req, res) => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: {}\n\n");
        },
      ],
      { maxStreams: 1 }
    );
    const abort = new AbortController();
    const stream = await fetch(`${base}/api/room/test/events`, {
      signal: abort.signal,
    });
    expect(stream.status).toBe(200);
    expect((await fetch(`${base}/api/room/test/events`)).status).toBe(429);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    abort.abort();
    const nextAbort = new AbortController();
    await expect
      .poll(async () => {
        const next = await fetch(`${base}/api/room/test/events`, {
          signal: nextAbort.signal,
        });
        return next.status;
      })
      .toBe(200);
    nextAbort.abort();
  });
  it("contains rejected middleware promises without returning error details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = await listen([
      async () => {
        throw new Error("private credential");
      },
    ]);
    const response = await fetch(`${base}/api/room`, {
      headers: { Origin: origin },
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private credential");
  });
});
