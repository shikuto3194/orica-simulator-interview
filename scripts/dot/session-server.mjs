import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { DotRoomClient } from "./room-client.mjs";
import { URL } from "node:url";
import {
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
} from "node:timers";

const { fetch, AbortSignal } = globalThis;

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const equalKey = (value, key) =>
  typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value) &&
  timingSafeEqual(Buffer.from(value), Buffer.from(key));

export async function startDotSessionServer({
  webRoot,
  expectedEmail,
  authenticate,
  loadDecks,
  rules,
  revision,
  baseUrl = "http://127.0.0.1:4310",
  port = 4321,
  fetchImpl = fetch,
}) {
  if (!expectedEmail)
    throw new Error(
      "DOT_ACCOUNT_EMAIL must identify the existing opponent account."
    );
  const api = new URL(baseUrl);
  if (
    api.origin !== baseUrl ||
    api.username ||
    api.password ||
    !(
      api.protocol === "https:" ||
      (api.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(api.hostname))
    )
  )
    throw new Error("Use an HTTPS API origin or HTTP loopback origin.");
  const root = resolve(webRoot);
  const key = randomBytes(32).toString("hex");
  let origin;
  let session = null;
  let generation = 0;
  let busy = false;
  let heartbeatBusy = false;
  let expiryTimer;
  const forgetSession = () => {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (session) {
      session.client.close();
      session.accessToken = null;
    }
    session = null;
  };
  const scheduleExpiry = () => {
    const own = session;
    expiryTimer = setTimeout(
      () => {
        if (session !== own) return;
        if (Date.now() >= own.expiresAt) forgetSession();
        else scheduleExpiry();
      },
      Math.min(Math.max(1, own.expiresAt - Date.now()), 2_147_483_647)
    );
    expiryTimer.unref();
  };
  const reply = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  const readBody = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) throw new Error("Request too large.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  };
  const requireSession = () => {
    if (!session || Date.now() >= session.expiresAt) {
      forgetSession();
      throw new Error("Reconnect from the normal login screen.");
    }
    return session;
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return reply(res, 403, { error: "Unexpected host or origin." });
    const path = new URL(req.url ?? "/", origin).pathname;
    try {
      if (path.startsWith("/dot/")) {
        if (!equalKey(req.headers["x-dot-connection"], key))
          return reply(res, 403, { error: "Connection key required." });
        if (path === "/dot/status" && req.method === "GET") {
          if (session && Date.now() >= session.expiresAt) forgetSession();
          return reply(res, 200, {
            connected: !!session,
            roomId: session?.roomId ?? null,
          });
        }
        if (path === "/dot/disconnect" && req.method === "POST") {
          generation += 1;
          forgetSession();
          return reply(res, 200, { disconnected: true });
        }
        if (req.method === "POST" && busy)
          return reply(res, 409, {
            error: "Another operation is in progress.",
          });
        if (path === "/dot/connect" && req.method === "POST") {
          busy = true;
          try {
            const connectionGeneration = generation;
            const { accessToken } = await readBody(req);
            if (typeof accessToken !== "string" || accessToken.length > 16000)
              return reply(res, 400, { error: "Invalid session." });
            // Ordinary authenticated-user verification, never an administrator key.
            const user = await authenticate(accessToken);
            if (connectionGeneration !== generation)
              return reply(res, 409, { error: "Connection was cancelled." });
            if (user?.email?.toLowerCase() !== expectedEmail.toLowerCase())
              return reply(res, 403, {
                error: "Use the specified opponent account.",
              });
            const claims = JSON.parse(
              Buffer.from(accessToken.split(".")[1], "base64url").toString(
                "utf8"
              )
            );
            if (
              claims.sub !== user.id ||
              !Number.isFinite(claims.exp) ||
              claims.exp * 1000 <= Date.now()
            )
              return reply(res, 401, { error: "Session expired." });
            forgetSession();
            session = {
              accessToken,
              expiresAt: claims.exp * 1000,
              userId: user.id,
              roomId: null,
              client: new DotRoomClient({ baseUrl, accessToken, fetchImpl }),
            };
            scheduleExpiry();
            return reply(res, 200, { connected: true });
          } finally {
            busy = false;
          }
        }
        const own = requireSession();
        const decks = async () => {
          const library = await loadDecks(own.accessToken);
          if (requireSession() !== own) throw new Error("Session changed.");
          if (library.user_id !== own.userId || !Array.isArray(library.decks))
            throw new Error("Deck library owner mismatch.");
          return rules.savedDecks(library.decks);
        };
        if (req.method === "GET" && path === "/dot/invitations")
          return reply(res, 200, await own.client.invitations());
        if (req.method === "GET" && path === "/dot/decks")
          return reply(res, 200, { decks: await decks() });
        if (req.method === "GET" && path === "/dot/lobby")
          return reply(res, 200, await own.client.lobby());
        if (req.method === "GET" && path === "/dot/state")
          return reply(res, 200, await own.client.state());
        if (req.method === "GET" && path === "/dot/actions") {
          const health = await fetchImpl(`${baseUrl}/healthz`, {
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          });
          if (!health.ok || (await health.json()).revision !== revision)
            throw new Error("API rules revision changed; restart the helper.");
          const snapshot = await own.client.state();
          return reply(res, 200, {
            version: snapshot.version,
            actions: rules.ownLegalActions(snapshot.state),
          });
        }
        if (req.method === "POST") {
          busy = true;
          try {
            const input = await readBody(req);
            if (requireSession() !== own) throw new Error("Session changed.");
            if (path === "/dot/accept") {
              const joined = await own.client.acceptInvitation(
                input.invitationId
              );
              own.roomId = joined.roomId;
              return reply(res, 200, joined);
            }
            if (path === "/dot/deck") {
              const deck = (await decks()).find(
                (item) => item.id === input.deckId
              );
              if (!deck?.selectable)
                throw new Error("Choose a valid named saved deck.");
              if (requireSession() !== own) throw new Error("Session changed.");
              return reply(res, 200, await own.client.deck(deck.cardNos));
            }
            if (path === "/dot/decision")
              return reply(
                res,
                200,
                await own.client.decision(input.kind, input.payload)
              );
          } finally {
            busy = false;
          }
        }
        return reply(res, 404, { error: "Unknown control route." });
      }
      // Normal browser room requests carry that browser's bearer session.
      // No server key or privileged room state is accessible through this proxy.
      if (/^\/api\/room(?:-invitations)?(?:[/?]|$)/.test(req.url ?? "")) {
        const rawPath = (req.url ?? "").split("?")[0];
        const decodedPath = decodeURIComponent(rawPath);
        if (
          rawPath !== path ||
          decodedPath.includes("\\") ||
          decodedPath.split("/").some((part) => part.startsWith("."))
        )
          return reply(res, 404, { error: "Unknown room route." });
        if (!["GET", "POST", "DELETE", "PUT"].includes(req.method))
          return reply(res, 405, { error: "Method not allowed." });
        if (path.endsWith("/events"))
          return reply(res, 404, { error: "Use the normal polling fallback." });
        const headers = {
          ...(req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {}),
          ...(req.headers["content-type"]
            ? { "Content-Type": req.headers["content-type"] }
            : {}),
        };
        const body = ["POST", "PUT", "DELETE"].includes(req.method)
          ? JSON.stringify(await readBody(req))
          : undefined;
        const response = await fetchImpl(baseUrl + req.url, {
          method: req.method,
          headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        res.writeHead(response.status, { "Content-Type": "application/json" });
        return res.end(await response.text());
      }
      if (!["GET", "HEAD"].includes(req.method))
        return reply(res, 405, { error: "Method not allowed." });
      const decoded = decodeURIComponent(path);
      if (
        decoded.split("/").some((part) => part.startsWith(".")) ||
        decoded.includes("\\")
      )
        return reply(res, 404, { error: "Not found." });
      let file = resolve(root, "." + decoded);
      if (file !== root && !file.startsWith(root + sep))
        return reply(res, 404, { error: "Not found." });
      if (file === root) file = resolve(root, "index.html");
      if (!(await stat(file)).isFile())
        return reply(res, 404, { error: "Not found." });
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      });
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch (error) {
      // Never echo auth errors, submitted credentials, or request payloads.
      reply(res, error.status ?? 400, {
        error:
          "Operation failed; check the account, invitation, deck, and current game state.",
        ...(Number.isInteger(error.currentVersion)
          ? { currentVersion: error.currentVersion }
          : {}),
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.maxConnections = 16;
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const heartbeat = setInterval(async () => {
    if (session && Date.now() >= session.expiresAt) forgetSession();
    if (!session?.roomId || heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      await session.client.heartbeat();
    } catch {
      /* A later tick rechecks the normal API. */
    } finally {
      heartbeatBusy = false;
    }
  }, 5000);
  heartbeat.unref();
  server.on("close", () => {
    clearInterval(heartbeat);
    generation += 1;
    forgetSession();
  });
  return { server, origin, key, loginUrl: `${origin}/#dot=${key}` };
}
