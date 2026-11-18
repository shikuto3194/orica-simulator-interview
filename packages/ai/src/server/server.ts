import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Message } from "ollama";
import { runAgent, runAgentStreaming } from "../agent.js";
import { loadConfig } from "../config.js";
import { getModelProfile } from "../models.js";
import { INDEX_HTML } from "./static-html.js";
import {
  buildAgentInputs,
  classifyAttachment,
  detectSnapshotAttachment,
  stripDataUrlPrefix,
} from "./attachments.js";
import type { RawAttachment } from "./attachments.js";
import { buildDefaultRegistry } from "../tools/registry.js";
import {
  findCommand,
  loadAllCommands,
  renderCommandPrompt,
} from "../context/commands.js";
import type { SlashCommand } from "../context/commands.js";
import { recordAgentRun } from "../telemetry.js";

const SLASH_COMMAND_RE = /^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i;

interface ResolvedSlashCommand {
  command: SlashCommand;
  args: string;
  additionalSystem: string;
}

export async function resolveSlashCommand(
  rawTask: string
): Promise<ResolvedSlashCommand | null> {
  const trimmed = rawTask.trim();
  if (!trimmed.startsWith("/")) return null;
  const m = SLASH_COMMAND_RE.exec(trimmed);
  if (!m) return null;
  const name = m[1] ?? "";
  const args = (m[2] ?? "").trim();
  const commands = await loadAllCommands();
  const cmd = findCommand(commands, name);
  if (!cmd) return null;
  return {
    command: cmd,
    args,
    additionalSystem: renderCommandPrompt(cmd, args),
  };
}

export interface StartServerOptions {
  port?: number;
  host?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startGuiServer(
  options: StartServerOptions = {}
): Promise<ServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 5180;
  const server = createServer(handleRequest);
  const actualPort = await listen(server, host, requestedPort);
  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        server.listen(0, host, () => {
          const addr = server.address();
          if (addr && typeof addr === "object") resolve(addr.port);
          else reject(new Error("failed to bind ephemeral port"));
        });
      } else {
        reject(err);
      }
    });
    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("failed to bind"));
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    if (
      req.method === "GET" &&
      (req.url === "/" || req.url === "/index.html")
    ) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(INDEX_HTML);
      return;
    }
    if (req.method === "GET" && req.url === "/api/info") {
      const config = loadConfig();
      const flagship = getModelProfile("flagship", config);
      sendJson(res, 200, { model: flagship.tag, baseUrl: config.baseUrl });
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      const body = await readJson(req);
      const task = typeof body.task === "string" ? body.task : "";
      const history: Message[] = Array.isArray(body.history)
        ? (body.history as Message[])
        : [];
      if (!task.trim()) {
        sendJson(res, 400, { error: "task is required" });
        return;
      }
      const slash = await resolveSlashCommand(task);
      const runInput = slash
        ? {
            task:
              slash.args ||
              `${slash.command.name} コマンドを実行してください (引数省略時のデフォルト挙動)`,
            history,
            additionalSystem: slash.additionalSystem,
            ...(slash.command.allowedTools.length > 0
              ? { allowedTools: slash.command.allowedTools }
              : {}),
          }
        : { task, history };
      const result = await runAgent(runInput);
      await recordAgentRun({
        task,
        steps: result.steps,
        selectedSkills: result.selectedSkills,
        selectedMemories: result.selectedMemories,
        ...(slash ? { resolvedCommand: slash.command.name } : {}),
      });
      sendJson(res, 200, {
        output: result.output,
        steps: result.steps,
        selectedSkills: result.selectedSkills,
        selectedMemories: result.selectedMemories,
        ...(slash ? { resolvedCommand: slash.command.name } : {}),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat-stream") {
      const body = await readJson(req);
      const task = typeof body.task === "string" ? body.task : "";
      const history: Message[] = Array.isArray(body.history)
        ? (body.history as Message[])
        : [];

      // 後方互換: body.images: string[] (純粋な base64 配列、image のみ)
      const legacyImages = Array.isArray(body.images)
        ? (body.images as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map(stripDataUrlPrefix)
        : [];

      // 新方式: body.attachments: { name, mimeType, base64 }[] (任意ファイル)
      const rawAttachments = Array.isArray(body.attachments)
        ? (body.attachments as unknown[]).filter(
            (x): x is RawAttachment => !!x && typeof x === "object"
          )
        : [];
      const classified = rawAttachments.map((a) => classifyAttachment(a));
      const detectedSnapshot = detectSnapshotAttachment(classified);
      // snapshot は registry に bind するので、task 文への展開はスキップ (コンテキスト節約)
      const forEmbedding = detectedSnapshot
        ? classified.filter((_, i) => i !== detectedSnapshot.index)
        : classified;
      const {
        task: augmentedTask,
        images: classifiedImages,
        notices,
      } = buildAgentInputs(task, forEmbedding);
      const images = [...legacyImages, ...classifiedImages];

      const finalTask = augmentedTask.trim();
      if (!finalTask && images.length === 0) {
        sendJson(res, 400, { error: "task or attachments required" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const write = (event: unknown): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      for (const n of notices) {
        write({
          type: "notice",
          message: `添付 ${n.name} はスキップ: ${n.reason}`,
        });
      }
      const slash = await resolveSlashCommand(finalTask);
      if (slash) {
        write({
          type: "notice",
          message: `slash command を解決: /${slash.command.name}${slash.args ? ` (${slash.args})` : ""}`,
        });
      }
      if (detectedSnapshot) {
        write({
          type: "notice",
          message: `GameSnapshot をセッションに紐付け: ${detectedSnapshot.sourceName} (inspect_game_state / legal_actions が snapshot 引数なしで使えます)`,
        });
      }
      const registry = detectedSnapshot
        ? buildDefaultRegistry({ boundSnapshot: detectedSnapshot.snapshot })
        : undefined;
      const snapshotNotice = detectedSnapshot
        ? `\n\n# セッションに GameSnapshot を紐付け済み (${detectedSnapshot.sourceName})\n以後 inspect_game_state / legal_actions は snapshot 引数を省略して呼べる。`
        : "";
      try {
        const gen = runAgentStreaming({
          task:
            (slash
              ? slash.args ||
                `${slash.command.name} コマンドを実行してください (引数省略時のデフォルト挙動)`
              : finalTask || "(添付の内容を確認してください)") + snapshotNotice,
          history,
          ...(slash ? { additionalSystem: slash.additionalSystem } : {}),
          ...(slash && slash.command.allowedTools.length > 0
            ? { allowedTools: slash.command.allowedTools }
            : {}),
          ...(images.length > 0 ? { images } : {}),
          ...(registry ? { registry } : {}),
        });
        for (;;) {
          const next = await gen.next();
          if (next.done) {
            write({
              type: "done",
              steps: next.value.steps,
              output: next.value.output,
              selectedSkills: next.value.selectedSkills,
              selectedMemories: next.value.selectedMemories,
            });
            await recordAgentRun({
              task: finalTask,
              steps: next.value.steps,
              selectedSkills: next.value.selectedSkills,
              selectedMemories: next.value.selectedMemories,
              attachmentCount: rawAttachments.length,
              hasImages: images.length > 0,
              ...(slash ? { resolvedCommand: slash.command.name } : {}),
            });
            break;
          }
          write(next.value);
        }
      } catch (err) {
        write({ type: "error", message: (err as Error).message });
      }
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message });
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJson(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}
