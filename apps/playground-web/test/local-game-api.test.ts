import { createServer, request as httpRequest, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createLocalGameApi } from "../server/local-game-api";
import type { Connect } from "vite";
import { ALL_CARDS } from "@orica/card-data";
import { buildMainStepEndScenario } from "../src/scenario-main-step-end";
import { registerGameApiMiddlewares } from "../server/game-api";

let server: Server;
let base: string;
let dispose: () => void;
beforeAll(async () => {
  const api = await createLocalGameApi((name, params) =>
    name === "main-step-end"
      ? buildMainStepEndScenario([...ALL_CARDS], params)
      : undefined
  );
  dispose = api.dispose;
  server = createServer((req, res) => {
    void api.middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("creates isolated scenarios, requires per-player tokens, rejects writes after setup and deletes fixture state", async () => {
  const created = await fetch(`${base}/api/local-game`, {
    method: "POST",
    body: JSON.stringify({ scenario: "main-step-end" }),
  });
  expect(created.status).toBe(201);
  const { roomId, tokens } = await created.json();
  const room = `${base}/api/room/${roomId}`;
  expect((await fetch(`${room}/state/full`)).status).toBe(401);
  const view = await (
    await fetch(`${room}/state/full`, {
      headers: { Authorization: `Bearer ${tokens.bob}` },
    })
  ).json();
  expect(view.viewerPlayerId).toBe("bob");
  expect(
    view.state.cardInstances.find(
      (card: { instanceId: string }) => card.instanceId === "main-end-hand"
    ).definitionId
  ).toBe("_hidden_card_");
  expect(
    (
      await fetch(`${room}/state`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${tokens.alice}` },
        body: "{}",
      })
    ).status
  ).toBe(404);
  expect((await fetch(`${base}/api/local-game/${roomId}/inspect`)).status).toBe(
    403
  );
  expect(
    (
      await fetch(`${base}/api/local-game/${roomId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens.inspect}` },
      })
    ).status
  ).toBe(200);
  expect((await fetch(`${room}/state/full`)).status).toBe(404);
});
it("does not expose fixtures through normal production registration, rejects cross-origin creation and production mode", async () => {
  expect(
    (
      await fetch(`${base}/api/local-game`, {
        method: "POST",
        headers: { Origin: "https://unrelated.invalid" },
        body: "{}",
      })
    ).status
  ).toBe(403);
  for (const [host, status] of [
    ["unrelated.invalid", 403],
    ["127.unrelated.invalid", 403],
    ["[broken", 400],
  ] as const) {
    expect(
      await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          `${base}/api/local-game/health`,
          { headers: { Host: host } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          }
        );
        request.on("error", reject);
        request.end();
      })
    ).toBe(status);
  }
  const middlewares: Connect.NextHandleFunction[] = [];
  // Registration has no local route; production receives only room/snapshot handlers.
  registerGameApiMiddlewares((handler) => middlewares.push(handler));
  const normal = createServer((req, res) => {
    let index = 0;
    const next = () => {
      const handler = middlewares[index++];
      if (handler) void handler(req, res, next);
      else {
        res.writeHead(404);
        res.end();
      }
    };
    next();
  });
  await new Promise<void>((resolve) => normal.listen(0, "127.0.0.1", resolve));
  try {
    const port = (normal.address() as { port: number }).port;
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/api/local-game`, {
          method: "POST",
          body: "{}",
        })
      ).status
    ).toBe(404);
  } finally {
    normal.closeAllConnections();
    await new Promise<void>((resolve) => normal.close(() => resolve()));
  }
  vi.stubEnv("NODE_ENV", "production");
  try {
    await expect(
      createLocalGameApi((name, params) =>
        name === "main-step-end"
          ? buildMainStepEndScenario([...ALL_CARDS], params)
          : undefined
      )
    ).rejects.toThrow("development-only");
  } finally {
    vi.unstubAllEnvs();
  }
});
