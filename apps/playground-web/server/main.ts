import type { Connect } from "vite";
import { createApiServer, readServerConfig } from "./http-server";
import { apiLimitsForHost } from "./api-limits";

// Validate before evaluating the game API; secrets are provided only at runtime.
const config = readServerConfig(process.env);
const {
  registerGameApiMiddlewares,
  startRoomMaintenance,
  drainRoomStreams,
  checkRoomNetworkReadiness,
} = await import("./game-api");
if (process.env.ORICA_API_PREFLIGHT === "1") {
  process.exit((await checkRoomNetworkReadiness()) ? 0 : 1);
}
const middlewares: Connect.NextHandleFunction[] = [];
registerGameApiMiddlewares((middleware) => {
  middlewares.push(middleware);
});
const server = createApiServer(
  config.allowedOrigins,
  middlewares,
  apiLimitsForHost(config.host, process.env.API_BEHIND_LOOPBACK_PROXY === "1")
);
const stopCleanup = startRoomMaintenance();
server.once("close", stopCleanup);
server.listen(config.port, config.host, () => {
  process.stdout.write(`[api] Listening on ${config.host}:${config.port}\n`);
});
server.on("error", () => {
  console.error("[api] Server failed to listen");
  process.exitCode = 1;
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  stopCleanup();
  server.close(() => process.exit(0));
  drainRoomStreams();
  // SSE clients reconnect after deployment; do not hold shutdown forever.
  setTimeout(() => server.closeAllConnections(), 25_000).unref();
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, shutdown);
}
// The Windows task owns the supervisor; losing its IPC channel must also stop
// the child, so a task restart cannot leave a stale listener behind.
if (process.send) {
  process.on("disconnect", shutdown);
  process.on("message", (message) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "shutdown"
    )
      shutdown();
  });
}
