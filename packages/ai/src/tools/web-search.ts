import { z } from "zod";
import type { ToolDef } from "./types.js";

const WebSearchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).optional(),
});

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  backend: string;
  results: WebSearchResultItem[];
}

export type SearchBackend = "duckduckgo";

export interface WebSearchOptions {
  /** 検索バックエンド (現在 "duckduckgo" のみ) */
  backend?: SearchBackend;
  /** 返す結果の既定件数 (デフォルト 5) */
  defaultMaxResults?: number;
  /** リクエストタイムアウト ms (デフォルト 30000) */
  timeoutMs?: number;
  /** User-Agent */
  userAgent?: string;
  /** テスト用 fetch 差し替え */
  fetchImpl?: typeof fetch;
}

export function makeWebSearchTool(
  options: WebSearchOptions = {}
): ToolDef<typeof WebSearchSchema, WebSearchResult> {
  const backend = options.backend ?? "duckduckgo";
  const defaultMaxResults = options.defaultMaxResults ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const userAgent =
    options.userAgent ??
    "Mozilla/5.0 (compatible; orica-ai-web-search/0.1; +https://github.com/anthropics/claude-code)";
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: "web_search",
    description:
      `Web を検索して関連 URL を見つける (backend: ${backend})。使うべき場面: ` +
      `CLAUDE.md / manual/ai-reference / カードデータに書かれていない外部情報を調べたい / 最新の公式裁定や FAQ を確認したい / ` +
      `ユーザーが「ウェブで調べて」「リサーチして」「最新情報を」と求めた。タイトル / URL / スニペットを最大 maxResults 件返す。` +
      `本文が必要なら次に web_fetch で URL を取得する流れ。`,
    schema: WebSearchSchema,
    jsonSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "検索クエリ" },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: `返す結果の最大件数 (デフォルト ${defaultMaxResults})`,
        },
      },
    },
    execute: async ({ query, maxResults }) => {
      const cap = maxResults ?? defaultMaxResults;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const url = buildSearchUrl(backend, query);
        const res = await doFetch(url, {
          signal: ctrl.signal,
          redirect: "follow",
          method: "POST",
          headers: {
            "User-Agent": userAgent,
            Accept: "text/html",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `q=${encodeURIComponent(query)}`,
        });
        if (!res.ok) {
          throw new Error(`search backend HTTP ${res.status}`);
        }
        const html = await res.text();
        const analysis = analyzeDuckDuckGoHtml(html);
        if (analysis.signal === "blocked") {
          throw new Error(
            "search backend returned an anomaly/captcha page (likely rate-limited or blocked). " +
              "Retry later or set ORICA_AI_DISABLE_WEB=true while it persists."
          );
        }
        if (
          analysis.signal === "unknown_structure" &&
          analysis.results.length === 0
        ) {
          const sample = html.slice(0, 240).replace(/\s+/g, " ").trim();
          throw new Error(
            "search returned 0 results and the HTML does not match the expected DuckDuckGo layout. " +
              "The parser may be outdated. " +
              `HTML head (240 chars): ${sample}`
          );
        }
        return {
          query,
          backend,
          results: analysis.results.slice(0, cap),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type DuckDuckGoSignal = "ok" | "empty" | "blocked" | "unknown_structure";

export interface DuckDuckGoAnalysis {
  results: WebSearchResultItem[];
  signal: DuckDuckGoSignal;
}

const ANOMALY_PATTERNS: RegExp[] = [
  /class="[^"]*\banomaly\b[^"]*"/i,
  /id="anomaly[-_]?modal"/i,
  /Unfortunately,?\s+bots\s+use\s+DuckDuckGo\s+too/i,
  /class="[^"]*captcha[^"]*"/i,
  /<title>[^<]*anomaly[^<]*<\/title>/i,
];

const EMPTY_PATTERNS: RegExp[] = [
  /\bno\s+results(\s+found)?\b\.?/i,
  /class="no-results"/i,
];

const STRUCTURE_MARKERS: RegExp[] = [
  /class="[^"]*\bresult__a\b[^"]*"/i,
  /class="[^"]*\bresult__snippet\b[^"]*"/i,
  /class="[^"]*\bresults_links\b[^"]*"/i,
  /id="links"/i,
];

export function analyzeDuckDuckGoHtml(html: string): DuckDuckGoAnalysis {
  const results = parseDuckDuckGoHtml(html);
  if (results.length > 0) return { results, signal: "ok" };
  if (ANOMALY_PATTERNS.some((re) => re.test(html))) {
    return { results, signal: "blocked" };
  }
  if (EMPTY_PATTERNS.some((re) => re.test(html))) {
    return { results, signal: "empty" };
  }
  if (STRUCTURE_MARKERS.some((re) => re.test(html))) {
    // 構造マーカーはあるのに 0 件しか拾えていない = parser drift の可能性が高い
    return { results, signal: "unknown_structure" };
  }
  return { results, signal: "unknown_structure" };
}

function buildSearchUrl(backend: SearchBackend, query: string): string {
  switch (backend) {
    case "duckduckgo":
      return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    default: {
      const exhaustive: never = backend;
      throw new Error(`unknown search backend: ${String(exhaustive)}`);
    }
  }
}

const RESULT_A_RE =
  /<a[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const RESULT_SNIPPET_RE =
  /<a[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

export function parseDuckDuckGoHtml(html: string): WebSearchResultItem[] {
  const titles: Array<{ href: string; title: string }> = [];
  let m: RegExpExecArray | null;
  RESULT_A_RE.lastIndex = 0;
  while ((m = RESULT_A_RE.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1] ?? "");
    const title = stripTags(m[2] ?? "").trim();
    if (title) titles.push({ href, title });
  }
  const snippets: string[] = [];
  RESULT_SNIPPET_RE.lastIndex = 0;
  while ((m = RESULT_SNIPPET_RE.exec(html)) !== null) {
    snippets.push(stripTags(m[1] ?? "").trim());
  }
  const items: WebSearchResultItem[] = [];
  for (let i = 0; i < titles.length; i++) {
    const { href, title } = titles[i]!;
    const realUrl = extractRedirectTarget(href);
    if (!realUrl) continue;
    items.push({
      title,
      url: realUrl,
      snippet: snippets[i] ?? "",
    });
  }
  return items;
}

function extractRedirectTarget(href: string): string | null {
  try {
    const normalized = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(normalized, "https://duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    if (target) {
      const decoded = decodeURIComponent(target);
      if (/^https?:\/\//i.test(decoded)) return decoded;
      return null;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
