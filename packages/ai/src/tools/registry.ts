import type { AnyToolDef } from "./types.js";
import { toOllamaTool } from "./types.js";
import type { Tool as OllamaTool } from "ollama";
import { makeFilterCardsTool, makeLookupCardTool } from "./card-lookup.js";
import { makeReadDocTool } from "./doc-read.js";
import { makeInspectGameStateTool } from "./game-state.js";
import { makeLegalActionsTool } from "./legal-actions.js";
import {
  makeApplyEditTool,
  makeReadFileTool,
  makeWriteFileTool,
} from "./file-ops.js";
import {
  makeGitDiffTool,
  makeGitStatusTool,
  makeRunCommandTool,
  makeRunTestsTool,
  makeRunTypecheckTool,
} from "./shell-ops.js";
import { makeWebFetchTool } from "./web-fetch.js";
import type { WebFetchOptions } from "./web-fetch.js";
import { makeWebSearchTool } from "./web-search.js";
import type { WebSearchOptions } from "./web-search.js";

export interface ToolRegistry {
  list(): AnyToolDef[];
  asOllamaTools(): OllamaTool[];
  get(name: string): AnyToolDef | undefined;
  /** allowedTools が指定された場合、それらのみを残した派生 registry を返す */
  restrictTo(allowed: string[]): ToolRegistry;
}

export interface BuildRegistryOptions {
  /** 書き込み系を含めるか。デフォルト true */
  includeWriteTools?: boolean;
  /** Web 系 (web_fetch / web_search) を含めるか。デフォルトは env で判定 */
  includeWebTools?: boolean;
  /** run_command の allowlist 上書き */
  runCommandAllowlist?: string[];
  /** web_fetch のオプション上書き (allowlist 等) */
  webFetchOptions?: WebFetchOptions;
  /** web_search のオプション上書き */
  webSearchOptions?: WebSearchOptions;
  /** GameSnapshot をセッションに紐付ける (inspect_game_state / legal_actions が引数なしで使えるようになる) */
  boundSnapshot?: unknown;
  /** 環境変数読み込み用 (テスト用)。未指定なら process.env */
  env?: NodeJS.ProcessEnv;
}

/**
 * `web_fetch` のデフォルト allowlist。`ORICA_AI_WEB_HOST_ALLOWLIST` が未設定なら
 * これだけ許可される。env を設定するとこの既定は完全に置き換わる (= ユーザー側の
 * 「全部許可」「別ドメイン追加」の意思を尊重)。
 *
 * 含めるドメインの基準: バトルスピリッツの一次/準一次情報源。
 *  - `batspi.com`: コミュニティ運営のカードデータベース。
 *  - `www.battlespirits.com`: 公式サイト。
 *  - `dancing-pixie-db5cc3.netlify.app`: 独自カードサイト (orica 同人版データ参照先)。
 */
export const DEFAULT_WEB_HOST_ALLOWLIST: readonly string[] = [
  "batspi.com",
  "www.battlespirits.com",
  "dancing-pixie-db5cc3.netlify.app",
];

function parseList(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function resolveWebFetchOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  override?: WebFetchOptions
): WebFetchOptions {
  const envAllowlist = parseList(env.ORICA_AI_WEB_HOST_ALLOWLIST);
  const blocklist = parseList(env.ORICA_AI_WEB_HOST_BLOCKLIST);
  const maxBytes = parsePositiveInt(env.ORICA_AI_WEB_MAX_BYTES);
  const timeoutMs = parsePositiveInt(env.ORICA_AI_WEB_TIMEOUT_MS);
  const fromEnv: WebFetchOptions = {
    allowlist: envAllowlist ?? [...DEFAULT_WEB_HOST_ALLOWLIST],
  };
  if (blocklist) fromEnv.blocklist = blocklist;
  if (maxBytes !== undefined) fromEnv.maxBytes = maxBytes;
  if (timeoutMs !== undefined) fromEnv.timeoutMs = timeoutMs;
  return { ...fromEnv, ...(override ?? {}) };
}

function resolveWebSearchOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  override?: WebSearchOptions
): WebSearchOptions {
  const timeoutMs = parsePositiveInt(env.ORICA_AI_WEB_TIMEOUT_MS);
  const fromEnv: WebSearchOptions = {};
  if (timeoutMs !== undefined) fromEnv.timeoutMs = timeoutMs;
  return { ...fromEnv, ...(override ?? {}) };
}

export function buildDefaultRegistry(
  options: BuildRegistryOptions = {}
): ToolRegistry {
  const env = options.env ?? process.env;
  const includeWrite = options.includeWriteTools ?? true;
  const includeWebFromEnv = env.ORICA_AI_DISABLE_WEB === "true" ? false : true;
  const includeWeb = options.includeWebTools ?? includeWebFromEnv;
  const snapshotOpt =
    options.boundSnapshot !== undefined
      ? { boundSnapshot: options.boundSnapshot }
      : {};
  const tools: AnyToolDef[] = [
    makeLookupCardTool() as unknown as AnyToolDef,
    makeFilterCardsTool() as unknown as AnyToolDef,
    makeReadDocTool() as unknown as AnyToolDef,
    makeInspectGameStateTool(snapshotOpt) as unknown as AnyToolDef,
    makeLegalActionsTool(snapshotOpt) as unknown as AnyToolDef,
    makeReadFileTool() as unknown as AnyToolDef,
    makeGitStatusTool() as unknown as AnyToolDef,
    makeGitDiffTool() as unknown as AnyToolDef,
    makeRunTestsTool() as unknown as AnyToolDef,
    makeRunTypecheckTool() as unknown as AnyToolDef,
  ];
  if (includeWeb) {
    tools.push(
      makeWebFetchTool(
        resolveWebFetchOptionsFromEnv(env, options.webFetchOptions)
      ) as unknown as AnyToolDef,
      makeWebSearchTool(
        resolveWebSearchOptionsFromEnv(env, options.webSearchOptions)
      ) as unknown as AnyToolDef
    );
  }
  if (includeWrite) {
    tools.push(
      makeWriteFileTool() as unknown as AnyToolDef,
      makeApplyEditTool() as unknown as AnyToolDef,
      makeRunCommandTool({
        ...(options.runCommandAllowlist !== undefined
          ? { allowlist: options.runCommandAllowlist }
          : {}),
      }) as unknown as AnyToolDef
    );
  }
  return registryOf(tools);
}

export function registryOf(tools: AnyToolDef[]): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    list: () => [...tools],
    asOllamaTools: () => tools.map(toOllamaTool),
    get: (name: string) => byName.get(name),
    restrictTo: (allowed: string[]) => {
      if (allowed.length === 0) return registryOf(tools);
      const filtered = tools.filter((t) => allowed.includes(t.name));
      return registryOf(filtered);
    },
  };
}
