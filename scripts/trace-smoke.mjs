#!/usr/bin/env node
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";

import { createServer } from "vite";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HMR_PORT = 30000 + (process.pid % 10000);

const server = await createServer({
  root: ROOT,
  configFile: false,
  appType: "custom",
  logLevel: "error",
  server: {
    middlewareMode: true,
    hmr: { port: HMR_PORT, clientPort: HMR_PORT },
  },
  optimizeDeps: {
    entries: [],
    noDiscovery: true,
  },
  resolve: {
    alias: {
      "@orica/rules-core": resolve(ROOT, "packages/rules-core/src/index.ts"),
      "@orica/card-data": resolve(ROOT, "packages/card-data/src/index.ts"),
    },
  },
});

try {
  const mod = await server.ssrLoadModule("/apps/cli/src/trace-smoke.ts");
  await mod.runTraceSmokeCli(process.argv.slice(2));
} finally {
  await server.close();
}
