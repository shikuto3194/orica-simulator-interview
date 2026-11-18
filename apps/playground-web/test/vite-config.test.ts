import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("static Vite commands", () => {
  it.each([
    { command: "build", mode: "production", isPreview: false },
    { command: "serve", mode: "production", isPreview: true },
  ])("loads $command (preview=$isPreview) without server secrets", (env) => {
    // Use Vite's real config bundler in a fresh process. Local .env files must
    // neither hide the missing production key nor be read by static commands.
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { loadConfigFromFile } from "vite";
          delete process.env.SUPABASE_SERVICE_ROLE_KEY;
          process.env.NODE_ENV = "production";
          let envReads = 0;
          process.loadEnvFile = () => { envReads++; };
          const result = await loadConfigFromFile(
            ${JSON.stringify(env)}, "apps/playground-web/vite.config.ts"
          );
          const plugins = (await Promise.all(result.config.plugins)).flat()
            .filter(Boolean).map(plugin => plugin.name);
          console.log(JSON.stringify({ envReads, plugins }));
        `,
      ],
      { cwd: projectRoot, encoding: "utf8", timeout: 30_000 }
    );
    const result = JSON.parse(output.trim());
    expect(result.envReads).toBe(0);
    expect(result.plugins).toContain("public-build-boundary");
    expect(result.plugins).not.toContain("game-api");
  });
});
