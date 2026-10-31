import { fileURLToPath, URL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import devServerContract from "../../scripts/harness/dev-server-contract.json";
import { imageAssetsPlugin } from "./server/image-assets";
import { publicBuildPlugin } from "./server/public-build";
import { releaseVersionPlugin } from "./server/release-version";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const webRoot = fileURLToPath(new URL(".", import.meta.url));

async function loadGameApiPlugin() {
  if (process.env.ORICA_LOCAL_GAME_TESTS === "1") {
    const { localGameApiPlugin } = await import("./server/local-game-api");
    return localGameApiPlugin();
  }
  // game-api は評価時に秘密キーを検証する。静的 build / preview では読み込まない。
  // dev では API の評価より先にサーバー用 .env の注入を完了させる。
  await import("./load-server-env");
  const { gameApiPlugin } = await import("./server/game-api");
  return gameApiPlugin();
}

function cliFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index >= 0) return argv[index + 1];
  const prefix = `${flag}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function assertCanonicalDevServerInvocation(): void {
  const argv = process.argv.slice(2);
  const executable = path.basename(process.argv[1] ?? "").toLowerCase();
  if (!executable.startsWith("vite") || argv.includes("build")) return;
  if (argv.includes("preview")) return;

  const configPath = cliFlagValue(argv, "--config")
    ?.replaceAll("\\", "/")
    .replace(/^\.\//, "");
  const portText = cliFlagValue(argv, "--port");
  const port = portText && /^\d+$/.test(portText) ? Number(portText) : NaN;
  const gitPath = path.join(projectRoot, ".git");
  const isPrimaryWorktree =
    fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory();
  const portIsValid =
    Number.isInteger(port) &&
    (!isPrimaryWorktree || port === devServerContract.mainPort);

  if (configPath !== devServerContract.configPath || !portIsValid) {
    throw new Error(
      `[orica dev server contract] repo root から次を実行してください: ${devServerContract.command}`
    );
  }
}

assertCanonicalDevServerInvocation();

function chunkNameFromCardPack(id: string): string {
  const fileName = path.basename(id).replace(/\.[cm]?[jt]sx?$/, "");
  return `card-data-${fileName.replaceAll(".", "-")}`;
}

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");

  if (
    normalizedId.includes("html5-qrcode") ||
    normalizedId.includes("react-qr-code")
  ) {
    return normalizedId.includes("html5-qrcode") ? "vendor-qr" : "vendor-react";
  }

  if (
    normalizedId.includes("commonjsHelpers") ||
    normalizedId.includes("commonjs-dynamic-modules")
  ) {
    return "vendor";
  }

  if (normalizedId.includes("/node_modules/")) {
    if (
      normalizedId.includes("/react/") ||
      normalizedId.includes("/react-dom/") ||
      normalizedId.includes("/react-window/") ||
      normalizedId.includes("/scheduler/")
    ) {
      return "vendor-react";
    }
    if (normalizedId.includes("/@supabase/")) {
      return "vendor-supabase";
    }
    return "vendor";
  }

  if (normalizedId.includes("/packages/card-data/")) {
    if (normalizedId.includes("/src/cards/")) {
      return chunkNameFromCardPack(normalizedId);
    }
    return "card-data-index";
  }

  if (normalizedId.includes("/packages/rules-core/")) {
    return "rules-core";
  }

  if (normalizedId.includes("/apps/playground-web/src/components/")) {
    const componentName = path
      .basename(normalizedId)
      .replace(/\.[cm]?[jt]sx?$/, "");
    if (
      [
        "BattleScreen",
        "DeckBuilder",
        "BattleSetup",
        "RoomLobby",
        "LoginPage",
      ].includes(componentName)
    ) {
      return `screen-${componentName}`;
    }
  }

  if (normalizedId.includes("/apps/playground-web/src/scenarios.ts")) {
    return "scenarios";
  }

  return undefined;
}

export default defineConfig(({ command, isPreview, mode }) => {
  const env = { ...loadEnv(mode, webRoot, "VITE_"), ...process.env };
  const interviewBuild = env.VITE_INTERVIEW_MODE === "true";
  if (interviewBuild) {
    const supabaseUrl = env.VITE_SUPABASE_URL;
    const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
    const apiBaseUrl = env.VITE_API_BASE_URL;
    let parsedSupabaseUrl: URL;
    let parsedApiUrl: URL;
    try {
      parsedSupabaseUrl = new URL(supabaseUrl ?? "");
      parsedApiUrl = new URL(apiBaseUrl ?? "");
    } catch {
      throw new Error(
        "Interview builds require VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_API_BASE_URL."
      );
    }
    if (
      parsedSupabaseUrl.protocol !== "https:" ||
      !parsedSupabaseUrl.hostname.endsWith(".supabase.co") ||
      parsedSupabaseUrl.hostname === "nnthvbizvqpufpfkzlho.supabase.co"
    ) {
      throw new Error(
        "Interview builds must use a separate HTTPS Supabase project."
      );
    }
    if (
      !supabaseKey ||
      /service_role|sb_secret_/i.test(supabaseKey) ||
      env.VITE_SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error(
        "Interview builds require a browser-safe Supabase key; server keys are forbidden."
      );
    }
    if (
      parsedApiUrl.protocol !== "https:" ||
      parsedApiUrl.origin !== apiBaseUrl ||
      parsedApiUrl.hostname === "kenshi2.tail4e104e.ts.net"
    ) {
      throw new Error(
        "Interview builds must use a separate HTTPS API origin without a path."
      );
    }
  }

  return ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    releaseVersionPlugin(projectRoot),
    publicBuildPlugin(),
    imageAssetsPlugin(projectRoot),
    command === "serve" && !isPreview ? loadGameApiPlugin() : undefined,
    VitePWA({
      disable: interviewBuild,
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // dev でも SW を有効化し、PWA 経路の動作確認をできるようにする
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
        disableRuntimeConfig: false,
      },
      includeAssets: [
        "apple-touch-icon.png",
        "pwa-192.png",
        "pwa-512.png",
        "pwa-maskable-512.png",
      ],
      manifest: {
        name: "幻想符",
        short_name: "幻想符",
        description:
          "バトルスピリッツ エターナル版ベースの独自拡張シミュレーター",
        theme_color: "#0d0e1a",
        background_color: "#0d0e1a",
        display: "standalone",
        orientation: "landscape",
        lang: "ja",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,svg,webmanifest}"],
        globIgnores: ["images/**", "sounds/**"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@orica/rules-core": fileURLToPath(
        new URL(
          command === "build"
            ? "../../packages/rules-core/src/runtime.ts"
            : "../../packages/rules-core/src/index.ts",
          import.meta.url
        )
      ),
      "@orica/card-data": fileURLToPath(
        new URL("../../packages/card-data/src/index.ts", import.meta.url)
      ),
    },
  },
  // VitePWA がアイコン / manifest を配信するため public/ を有効化
  publicDir: "public",
  server: {
    host: "0.0.0.0",
    port: devServerContract.mainPort,
    strictPort: true,
    fs: {
      allow: [projectRoot],
    },
  },
  optimizeDeps: {
    include: ["react-window"],
  },
  build: {
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
    commonjsOptions: {
      include: [/react-window/, /node_modules/],
    },
  },
  });
});
