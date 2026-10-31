import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PW_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  // These specs require the dedicated local server and its configuration.
  testIgnore: [
    "**/local-game-sync.spec.ts",
    "**/scenario-blazing-star-oracle.spec.ts",
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  // Failure screenshots/traces must stay out of the primary worktree's Git
  // status: final-verification e2e also runs against that tree before merge.
  outputDir: ".codex-temp/playwright-test-results",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "npx vite --config apps/playground-web/vite.config.ts --port 4173".replace(
        "--port 4173",
        `--port ${new URL(BASE_URL).port || "4173"}`
      ),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
