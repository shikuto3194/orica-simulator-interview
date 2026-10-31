import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const url = process.env.PW_BASE_URL ?? "http://127.0.0.1:4173";
const address = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
  throw new Error("Local game tests require a loopback base URL.");

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: [
    "local-game-sync.spec.ts",
    "scenario-blazing-star-oracle.spec.ts",
  ],
  retries: 0,
  use: {
    ...base.use,
    baseURL: url,
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: `npx vite --config apps/playground-web/vite.config.ts --port ${address.port || "80"}`,
    url: `${url}/api/local-game/health`,
    env: { ORICA_LOCAL_GAME_TESTS: "1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
