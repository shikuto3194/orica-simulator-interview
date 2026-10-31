import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./memory.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface SlashCommand {
  name: string;
  description: string;
  allowedTools: string[];
  /** 引数のヒント文 (フリーフォーム説明)。 */
  argsHint: string;
  body: string;
  path: string;
}

export interface LoadCommandsOptions {
  /** commands ルート。デフォルト `packages/ai/prompts/commands` */
  root?: string;
}

function defaultCommandsRoot(): string {
  // HERE は src/context または dist/context のどちらかで、どちらも packages/ai 配下
  // depth 2 (../../) で packages/ai に届く
  return resolve(HERE, "../../prompts/commands");
}

export async function loadAllCommands(
  options: LoadCommandsOptions = {}
): Promise<SlashCommand[]> {
  const root = options.root ?? defaultCommandsRoot();
  let files: string[];
  try {
    files = await readdir(root);
  } catch {
    return [];
  }
  const out: SlashCommand[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const p = join(root, f);
    const raw = await readFile(p, "utf8");
    const { data, body } = parseFrontmatter(raw);
    out.push({
      name: typeof data.name === "string" ? data.name : f.replace(/\.md$/, ""),
      description: typeof data.description === "string" ? data.description : "",
      allowedTools: Array.isArray(data["allowed-tools"])
        ? (data["allowed-tools"] as string[])
        : [],
      argsHint: typeof data.args === "string" ? data.args : "",
      body,
      path: p,
    });
  }
  return out;
}

export function findCommand(
  commands: SlashCommand[],
  name: string
): SlashCommand | undefined {
  const norm = name.replace(/^\//, "");
  return commands.find((c) => c.name === norm);
}

export function renderCommandPrompt(
  command: SlashCommand,
  args: string
): string {
  return command.body.replace(/\{\{\s*ARGS\s*\}\}/g, args);
}
