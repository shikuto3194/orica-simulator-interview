import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The spec serves dist on its own ephemeral port. No Vite/auth/room server is needed.
export default defineConfig({
  ...base,
  testMatch: "public-build.spec.ts",
  webServer: undefined,
});
