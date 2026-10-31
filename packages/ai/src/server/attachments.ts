/**
 * GUI から送られてくる任意ファイル添付の分類とタスク文への埋め込み。
 *
 * 方針:
 *  - image/* → vision モデルに渡す base64 として返す
 *  - text-like (40+ 拡張子 / text/* mime) → UTF-8 復元してプロンプトに埋め込む
 *  - それ以外 (PDF / Office / 圧縮ファイル等) → unsupported として理由付きで返す
 */

export interface RawAttachment {
  name?: string;
  mimeType?: string;
  /** data URL prefix (data:...;base64,) 付きでも純粋な base64 でも可 */
  base64?: string;
}

export type ClassifiedAttachment =
  | {
      name: string;
      kind: "image";
      mimeType: string;
      base64: string;
    }
  | {
      name: string;
      kind: "text";
      mimeType: string;
      text: string;
      originalChars: number;
      truncated: boolean;
    }
  | {
      name: string;
      kind: "unsupported";
      reason: string;
    };

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "rst",
  "tex",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "svg",
  "css",
  "scss",
  "less",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "psm1",
  "sql",
  "ini",
  "conf",
  "cfg",
  "env",
  "log",
  "lock",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "prettierrc",
  "eslintrc",
  "diff",
  "patch",
]);

const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/x-toml",
  "application/x-sh",
  "application/x-shellscript",
  "application/sql",
  "application/x-www-form-urlencoded",
]);

const EXT_TO_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  toml: "application/x-toml",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  jsx: "application/javascript",
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  c: "text/x-c",
  cc: "text/x-c++",
  cpp: "text/x-c++",
  h: "text/x-c",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  php: "text/x-php",
  sh: "application/x-sh",
  bash: "application/x-sh",
  ps1: "application/x-powershell",
  sql: "application/sql",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  pdf: "application/pdf",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  exe: "application/octet-stream",
  bin: "application/octet-stream",
};

export interface ClassifyOptions {
  /** 1 添付あたりの最大文字数。超過は trim + マーカー追加。 */
  maxTextChars?: number;
}

export function classifyAttachment(
  att: RawAttachment,
  options: ClassifyOptions = {}
): ClassifiedAttachment {
  const maxChars = options.maxTextChars ?? 100_000;
  const name = (att.name ?? "unnamed").trim() || "unnamed";
  if (!att.base64) {
    return { name, kind: "unsupported", reason: "no data" };
  }
  const rawBase64 = stripDataUrlPrefix(att.base64);
  if (!rawBase64) {
    return { name, kind: "unsupported", reason: "empty data" };
  }
  const mime = (att.mimeType ?? "").trim() || guessMimeFromName(name);

  if (mime.startsWith("image/")) {
    return { name, kind: "image", mimeType: mime, base64: rawBase64 };
  }

  if (isTextLike(mime, name)) {
    let text: string;
    try {
      text = Buffer.from(rawBase64, "base64").toString("utf8");
    } catch (err) {
      return {
        name,
        kind: "unsupported",
        reason: `decode failed: ${(err as Error).message}`,
      };
    }
    if (looksBinary(text)) {
      return {
        name,
        kind: "unsupported",
        reason: "binary content detected despite text-like name",
      };
    }
    const originalChars = text.length;
    const truncated = originalChars > maxChars;
    return {
      name,
      kind: "text",
      mimeType: mime,
      text: truncated
        ? text.slice(0, maxChars) +
          `\n\n[…truncated, original ${originalChars} chars]`
        : text,
      originalChars,
      truncated,
    };
  }

  return {
    name,
    kind: "unsupported",
    reason: `unsupported mime: ${mime}`,
  };
}

export function stripDataUrlPrefix(s: string): string {
  const m = s.match(/^data:[^;]+;base64,(.+)$/);
  return m && m[1] ? m[1] : s;
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  const last = lower.split(".").pop() ?? "";
  if (EXT_TO_MIME[last]) return EXT_TO_MIME[last];
  if (lower === "dockerfile" || lower === "makefile" || lower === "rakefile") {
    return "text/plain";
  }
  return "application/octet-stream";
}

function isTextLike(mimeType: string, name: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (TEXT_MIMES.has(mimeType)) return true;
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (lower === "dockerfile" || lower === "makefile" || lower === "rakefile") {
    return true;
  }
  if (/^\.[a-z]+rc(\.json|\.yaml|\.yml)?$/.test(lower)) return true;
  return false;
}

function looksBinary(text: string): boolean {
  if (text.length === 0) return false;
  const sample = Math.min(text.length, 4096);
  let suspicious = 0;
  for (let i = 0; i < sample; i++) {
    const code = text.charCodeAt(i);
    // null, ESC 等の制御文字 (改行/タブを除く) または UTF-8 replacement
    if (code === 0 || code === 0xfffd) {
      suspicious++;
    } else if (code < 9 || (code > 13 && code < 32)) {
      suspicious++;
    }
  }
  return suspicious / sample > 0.01;
}

export interface AugmentationResult {
  task: string;
  images: string[];
  notices: { name: string; reason: string }[];
}

export function buildAgentInputs(
  originalTask: string,
  attachments: ClassifiedAttachment[]
): AugmentationResult {
  const images: string[] = [];
  const textBlocks: string[] = [];
  const notices: { name: string; reason: string }[] = [];

  for (const att of attachments) {
    if (att.kind === "image") {
      images.push(att.base64);
    } else if (att.kind === "text") {
      const fence = pickFence(att.text);
      const note = att.truncated
        ? ` (truncated to ${att.text.length} chars)`
        : "";
      textBlocks.push(
        `# 添付ファイル: ${att.name}${note}\n${fence}\n${att.text}\n${fence}`
      );
    } else {
      notices.push({ name: att.name, reason: att.reason });
    }
  }

  const trimmedTask = originalTask.trim();
  const fallback = "添付の内容を確認してください。";
  const task =
    textBlocks.length > 0
      ? `${textBlocks.join("\n\n")}\n\n# 質問\n${trimmedTask || fallback}`
      : trimmedTask;

  return { task, images, notices };
}

export interface DetectedSnapshot {
  /** classified の何番目か */
  index: number;
  /** パース済みの GameSnapshot */
  snapshot: unknown;
  /** 添付ファイル名 */
  sourceName: string;
}

/**
 * 添付の中から GameSnapshot 形式の JSON を検出する。
 * 検出ルール:
 *  - kind が text
 *  - 名前が `orica-snapshot-*.json` (大文字小文字無視) OR mime が application/json かつ拡張子が .json
 *  - JSON.parse できる
 *  - top-level に `players` プロパティを持つ (緩い shape check)
 */
export function detectSnapshotAttachment(
  attachments: ClassifiedAttachment[]
): DetectedSnapshot | null {
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (!att || att.kind !== "text") continue;
    const nameLower = att.name.toLowerCase();
    const isSnapshotName = /orica-snapshot-.*\.json$/i.test(att.name);
    const isJsonCandidate =
      isSnapshotName ||
      att.mimeType === "application/json" ||
      nameLower.endsWith(".json");
    if (!isJsonCandidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(att.text);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const hasPlayers = "players" in (parsed as Record<string, unknown>);
    if (isSnapshotName || hasPlayers) {
      return { index: i, snapshot: parsed, sourceName: att.name };
    }
  }
  return null;
}

function pickFence(text: string): string {
  let len = 3;
  while (text.includes("`".repeat(len))) len++;
  return "`".repeat(len);
}
