#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { createServer } from "vite";
import { checkStorage } from "./artifact-storage.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HMR_PORT = 30000 + (process.pid % 10000);
if (!process.argv.includes("--help") && !process.argv.includes("-h"))
  checkStorage(ROOT);

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
  const mod = await server.ssrLoadModule(
    "/apps/cli/src/position-bias-diagnose.ts"
  );
  await mod.runPositionBiasDiagnoseCli(process.argv.slice(2));
} finally {
  await server.close();
}
