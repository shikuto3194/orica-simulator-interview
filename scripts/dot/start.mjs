import { build } from "vite";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startDotSessionServer } from "./session-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.DOT_ACCOUNT_EMAIL)
  throw new Error("Set DOT_ACCOUNT_EMAIL to the existing opponent account.");
const revision = (
  process.env.DOT_RULES_REVISION ||
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
).trim();
if (!/^[a-f0-9]{40}$/.test(revision))
  throw new Error("A Git revision is required for the rules snapshot.");
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  resolve: {
    alias: {
      "@orica/rules-core": resolve(root, "packages/rules-core/src/runtime.ts"),
      "@orica/card-data": resolve(root, "packages/card-data/src/index.ts"),
    },
  },
  build: {
    ssr: "scripts/dot/rules-adapter.ts",
    outDir: "artifacts/dot-session/rules",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "adapter.mjs",
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
  },
});
await build({
  configFile: resolve(root, "apps/playground-web/vite.config.ts"),
  configLoader: "runner",
  root: resolve(root, "apps/playground-web"),
  mode: "dot",
  logLevel: "warn",
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") },
  build: {
    outDir: resolve(root, "artifacts/dot-session/web"),
    emptyOutDir: true,
  },
});
const rules = await import(
  pathToFileURL(resolve(root, "artifacts/dot-session/rules/adapter.mjs")).href
);
function client(accessToken) {
  return createClient(rules.supabaseUrl, rules.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
const helper = await startDotSessionServer({
  webRoot: resolve(root, "artifacts/dot-session/web"),
  expectedEmail: process.env.DOT_ACCOUNT_EMAIL,
  baseUrl: process.env.DOT_API_BASE || "http://127.0.0.1:4310",
  port: Number(process.env.DOT_PORT || 4321),
  revision,
  rules,
  authenticate: async (token) => {
    const { data, error } = await client(token).auth.getUser(token);
    if (error) throw new Error("Session verification failed.");
    return data.user;
  },
  loadDecks: async (token) => {
    const { data, error } = await client(token).rpc("bs_deck_library", {
      p_action: "list",
    });
    if (error) throw new Error("Saved deck lookup failed.");
    return data;
  },
});
console.log(
  `Normal login screen (open in a separate private window): ${helper.loginUrl}`
);
console.log(
  "After normal login, click the dot connection button. Tokens and passwords are never printed or saved by the helper."
);
console.log(
  "Local controls require X-Dot-Connection from that URL. GET /dot/invitations, /dot/decks, /dot/state, /dot/actions."
);
console.log(
  "POST /dot/accept {invitationId}; /dot/deck {deckId}; /dot/decision {kind,payload}."
);
console.log(
  "Disconnect with /dot/disconnect or stop this helper. The session also expires naturally."
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => helper.server.close(() => process.exit(0)));
