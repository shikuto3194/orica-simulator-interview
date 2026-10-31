import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import type { GameState } from "@orica/rules-core";
import type { Scenario } from "../src/scenarios";
import { parseRoomMutationId } from "../shared/room-protocol";
import { LocalGameSession } from "./local-game-session";
import {
  initializeGameApiRuntime,
  readBody,
  addSSEConnection,
  removeSSEConnection,
  renewSSEMemberLease,
  broadcastSSEStateUpdate,
  RoomGameplayError,
  ROOM_GAMEPLAY_COMMANDS,
  type RoomGameplayCommand,
} from "./game-api";

const loopback = (address: string) =>
  address === "localhost" ||
  address === "::1" ||
  address === "[::1]" ||
  (isIP(address) === 4 && address.startsWith("127.")) ||
  (isIP(address) === 6 && address.startsWith("::ffff:127."));
const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const bearer = (req: IncomingMessage) =>
  req.headers.authorization?.replace(/^Bearer /, "");
const isCommand = (value: unknown): value is RoomGameplayCommand =>
  typeof value === "string" &&
  (ROOM_GAMEPLAY_COMMANDS as readonly string[]).includes(value);

/** Only the explicitly selected Vite test mode registers this loopback-only API. */
export async function createLocalGameApi(
  buildScenario: (
    name: string,
    params: URLSearchParams
  ) => GameState | undefined
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Local game API is development-only.");
  await initializeGameApiRuntime();
  const sessions = new Map<
    string,
    {
      session: LocalGameSession;
      scenario: { name: string; params: string };
      tokens: Record<string, string>;
      expires: number;
      closeStreams: Set<() => void>;
    }
  >();
  const disposeSession = (id: string) => {
    const entry = sessions.get(id);
    if (entry) for (const close of [...entry.closeStreams]) close();
    sessions.delete(id);
  };
  const dispose = () => {
    for (const id of sessions.keys()) disposeSession(id);
  };
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (
        !url.pathname.startsWith("/api/local-game") &&
        !url.pathname.startsWith("/api/room")
      )
        return next();
      if (!loopback(req.socket.remoteAddress ?? ""))
        return json(res, { error: "Loopback only." }, 403);
      const host = new URL(`http://${req.headers.host ?? ""}`);
      if (!loopback(host.hostname))
        return json(res, { error: "Loopback host only." }, 403);
      if (req.headers.origin) {
        try {
          if (new URL(req.headers.origin).host !== req.headers.host)
            return json(
              res,
              { error: "Cross-origin local game request." },
              403
            );
        } catch {
          return json(res, { error: "Invalid origin." }, 403);
        }
      }
      for (const [id, entry] of sessions)
        if (entry.expires <= Date.now()) disposeSession(id);
      if (url.pathname === "/api/local-game/health" && req.method === "GET")
        return json(res, { ok: true, mode: "local-game", root: process.cwd() });
      if (url.pathname === "/api/local-game" && req.method === "POST") {
        if (sessions.size >= 32)
          return json(res, { error: "Too many local sessions." }, 429);
        const body = JSON.parse(await readBody(req));
        if (
          typeof body.scenario !== "string" ||
          (body.params !== undefined && typeof body.params !== "string")
        )
          return json(res, { error: "Invalid scenario parameters." }, 400);
        const state = buildScenario(
          body.scenario,
          new URLSearchParams(body.params)
        );
        if (!state) return json(res, { error: "Unknown scenario." }, 400);
        const id = `local-${randomUUID()}`;
        const tokens = {
          alice: randomUUID(),
          bob: randomUUID(),
          inspect: randomUUID(),
        };
        const session = new LocalGameSession(id, state);
        sessions.set(id, {
          session,
          scenario: { name: body.scenario, params: body.params ?? "" },
          tokens,
          expires: Date.now() + 30 * 60_000,
          closeStreams: new Set(),
        });
        return json(res, { roomId: id, tokens, version: 1 }, 201);
      }
      const match = url.pathname.match(
        /^\/api\/(local-game|room)\/(local-[a-f0-9-]+)(.*)$/
      );
      if (!match) return json(res, { error: "Unknown local endpoint." }, 404);
      const [, namespace, id, path] = match;
      const entry = sessions.get(id!);
      if (!entry) return json(res, { error: "Local session not found." }, 404);
      const token = bearer(req);
      if (namespace === "local-game") {
        if (token !== entry.tokens.inspect)
          return json(res, { error: "Invalid fixture token." }, 403);
        if (path === "" && req.method === "DELETE") {
          disposeSession(id!);
          return json(res, { ok: true });
        }
        if (path === "/inspect" && req.method === "GET")
          return json(res, {
            ...entry.session.inspect(),
            scenario: entry.scenario,
          });
        return json(
          res,
          { error: "Fixture state is immutable after creation." },
          404
        );
      }
      const actor = ["alice", "bob"].find(
        (role) => token === entry.tokens[role]
      );
      if (!actor)
        return json(res, { error: "Invalid local player token." }, 401);
      entry.expires = Date.now() + 30 * 60_000;
      if (path === "" && req.method === "GET")
        return json(res, { roomId: id, players: [] });
      if (path === "/state/full" && req.method === "GET")
        return json(res, entry.session.view(actor));
      if (path === "/state/version" && req.method === "GET")
        return json(res, { version: entry.session.currentVersion });
      if (path === "/actions" && req.method === "GET")
        return json(res, entry.session.actions(actor));
      if (path === "/state/patch" && req.method === "GET")
        return json(res, { available: false });
      if (path === "/heartbeat" && req.method === "POST") {
        renewSSEMemberLease(id!, actor, Date.now());
        return json(res, { ok: true, opponentDisconnected: false });
      }
      if (path === "/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        res.flushHeaders?.();
        const stream = addSSEConnection(id!, res, true, actor);
        const close = () => {
          clearInterval(ping);
          removeSSEConnection(id!, stream, true);
          entry.closeStreams.delete(close);
        };
        const ping = setInterval(() => {
          renewSSEMemberLease(id!, actor, Date.now());
          if (res.destroyed) close();
          else if (!stream.backpressured)
            res.write(`event: ping\ndata: {}\n\n`);
        }, 5000);
        ping.unref();
        entry.closeStreams.add(close);
        res.once("close", close);
        const snapshot = entry.session.view(actor);
        res.write(
          `event: connected\ndata: ${JSON.stringify({ version: snapshot.version, isSpectator: false })}\n\n`
        );
        broadcastSSEStateUpdate(
          id!,
          snapshot.version,
          entry.session.snapshot().state
        );
        return;
      }
      if (req.method !== "POST")
        return json(res, { error: "Unknown local endpoint." }, 404);
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      if (path === "/mutation-settle") {
        const mutationId = parseRoomMutationId(body.clientMutationId);
        if (
          !mutationId ||
          !isCommand(body.path) ||
          !body.payload ||
          typeof body.payload !== "object" ||
          Array.isArray(body.payload)
        )
          return json(res, { error: "Invalid operation identity." }, 400);
        return json(
          res,
          entry.session.settle(
            actor,
            body.path,
            mutationId,
            body.payload as Record<string, unknown>
          )
        );
      }
      const command = path!.slice(1);
      if (!isCommand(command))
        return json(
          res,
          { error: "Unsupported local gameplay endpoint." },
          404
        );
      const previous = entry.session.snapshot();
      const result = entry.session.mutate(actor, command, body);
      const current = entry.session.snapshot();
      if (current.version > previous.version)
        broadcastSSEStateUpdate(
          id!,
          current.version,
          current.state,
          previous.state,
          undefined,
          previous.version
        );
      return json(res, result);
    } catch (err) {
      return json(
        res,
        { error: err instanceof Error ? err.message : String(err) },
        err instanceof RoomGameplayError ? err.status : 400
      );
    }
  };
  return { middleware, dispose };
}

export function localGameApiPlugin(): Plugin {
  return {
    name: "local-game-api",
    async configureServer(server) {
      // Load browser fixtures through Vite aliases, never through package dist while bundling this config.
      const { SCENARIOS } = (await server.ssrLoadModule(
        "/src/scenarios.ts"
      )) as { SCENARIOS: Record<string, Scenario> };
      const api = await createLocalGameApi((name, params) =>
        Object.hasOwn(SCENARIOS, name)
          ? SCENARIOS[name]!.build([...ALL_CARDS], params)
          : undefined
      );
      server.middlewares.use(api.middleware);
      // Unknown room/auth/snapshot routes must never reach an external backend in this mode.
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/"))
          return json(res, { error: "Local game mode." }, 404);
        next();
      });
      server.httpServer?.once("close", api.dispose);
    },
  };
}
