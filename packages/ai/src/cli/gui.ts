#!/usr/bin/env node
import { spawn } from "node:child_process";
import { startGuiServer } from "../server/server.js";

interface CliArgs {
  port: number | undefined;
  host: string | undefined;
  noOpen: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: undefined, host: undefined, noOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      const next = argv[++i];
      if (next !== undefined) args.port = Number(next);
    } else if (a === "--host") {
      const next = argv[++i];
      if (next !== undefined) args.host = next;
    } else if (a === "--no-open") {
      args.noOpen = true;
    }
  }
  return args;
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = await startGuiServer({
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.host !== undefined ? { host: args.host } : {}),
  });
  console.warn(`[gui] serving at ${handle.url}`);
  console.warn("[gui] Ctrl+C で停止");
  if (!args.noOpen) openBrowser(handle.url);

  const shutdown = async (): Promise<void> => {
    console.warn("\n[gui] shutting down…");
    try {
      await handle.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
