import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { Connect } from "vite";
import { createApiAdmission, type ApiLimits } from "./api-limits";

export function readServerConfig(env: NodeJS.ProcessEnv) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  }
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (allowedOrigins.size === 0)
    throw new Error("ALLOWED_ORIGINS is required.");
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.hostname.includes("*") ||
      url.origin !== origin ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    ) {
      throw new Error("ALLOWED_ORIGINS must contain exact HTTPS origins.");
    }
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  return { allowedOrigins, port, host: env.HOST ?? "127.0.0.1" };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Caddy の背後で動く、静的ファイルを一切配信しない API サーバー。 */
export function createApiServer(
  allowedOrigins: ReadonlySet<string>,
  middlewares: readonly Connect.NextHandleFunction[],
  limits: Partial<ApiLimits> = {},
  now: () => number = () => performance.now()
) {
  const admission = createApiAdmission(limits, now);
  const server = createServer(
    { requestTimeout: 30_000, headersTimeout: 15_000 },
    (req, res) => {
      res.setHeader("X-Request-ID", randomUUID());
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Vary", "Origin");
      const origin = req.headers.origin;
      if (origin) {
        if (!allowedOrigins.has(origin))
          return json(res, 403, { error: "Origin not allowed" });
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Server-Timing, Retry-After, X-Request-ID"
        );
      }
      if (!admission.admit(req, res)) return;
      if (req.method === "OPTIONS") {
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, DELETE, OPTIONS"
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, Last-Event-ID"
        );
        res.setHeader("Access-Control-Max-Age", "600");
        res.writeHead(204);
        return res.end();
      }
      if (req.url === "/healthz" && req.method === "GET")
        return json(res, 200, {
          ok: true,
          ...(process.env.ORICA_API_REVISION
            ? { revision: process.env.ORICA_API_REVISION }
            : {}),
        });
      let index = 0;
      const next: Connect.NextFunction = (err?: unknown) => {
        if (res.writableEnded || res.destroyed) return;
        if (err) {
          console.error("[api] Unhandled request error");
          if (res.headersSent) res.destroy();
          else json(res, 500, { error: "Internal server error" });
          return;
        }
        const middleware = middlewares[index++];
        if (!middleware) return json(res, 404, { error: "Not found" });
        try {
          Promise.resolve(middleware(req, res, next)).catch(next);
        } catch (error) {
          next(error);
        }
      };
      next();
    }
  );
  server.maxConnections = admission.limits.maxSockets;
  // Includes incomplete requests/idle sockets; SSE ping frames keep live streams active.
  server.setTimeout(35_000, (socket) => socket.destroy());
  return server;
}
