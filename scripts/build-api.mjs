import { build } from "vite";
import { resolve } from "node:path";

// An immutable Git export can be built without touching the active checkout.
const root = resolve(process.argv[2] ?? ".");

// Private artifact. Never copy this into playground-web/dist (Netlify).
await build({
  root,
  configFile: false,
  publicDir: false,
  ssr: { noExternal: true },
  resolve: {
    alias: {
      "@orica/rules-core": resolve(root, "packages/rules-core/src/runtime.ts"),
      "@orica/card-data": resolve(root, "packages/card-data/src/index.ts"),
    },
  },
  build: {
    ssr: true,
    target: "node22",
    outDir: "dist/api",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        server: resolve(root, "apps/playground-web/server/main.ts"),
        "http-runtime": resolve(
          root,
          "apps/playground-web/server/http-runtime.ts"
        ),
      },
      output: {
        entryFileNames: "[name].mjs",
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
  },
});
