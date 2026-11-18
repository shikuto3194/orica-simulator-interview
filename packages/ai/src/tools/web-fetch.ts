import { lookup as dnsLookup } from "node:dns/promises";
import { z } from "zod";
import type { ToolDef } from "./types.js";

/**
 * `web_fetch` が受け付けるプロトコル一覧 (single source of truth)。
 * tool description / runtime check / JSON schema description が同じ定数を参照することで
 * 「prompt は http も OK と言うが runtime は https のみ」のような不整合を防ぐ。
 */
export const WEB_FETCH_ALLOWED_PROTOCOLS = ["https:"] as const;
type AllowedProtocol = (typeof WEB_FETCH_ALLOWED_PROTOCOLS)[number];

function isAllowedProtocol(p: string): p is AllowedProtocol {
  return (WEB_FETCH_ALLOWED_PROTOCOLS as readonly string[]).includes(p);
}

function protocolListForHumans(): string {
  return WEB_FETCH_ALLOWED_PROTOCOLS.map((p) => p.replace(":", "")).join("/");
}

const PRIVATE_IPV4_RANGES = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some((r) => r.test(ip));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped: check the embedded IPv4
    const v4 = lower.slice("::ffff:".length);
    return isPrivateIPv4(v4);
  }
  return false;
}

function matchHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith("." + suffix);
  }
  return h === p;
}

const WebFetchSchema = z.object({
  url: z.string().url(),
  maxChars: z.number().int().positive().max(64_000).optional(),
  raw: z.boolean().optional(),
});

export interface WebFetchResult {
  url: string;
  status: number;
  contentType: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export interface WebFetchOptions {
  /** 許可するホスト名パターン (例: "example.com", "*.wikipedia.org", "*"). 未指定なら public な全ドメイン許可 */
  allowlist?: string[];
  /** 拒否するホスト名パターン (allowlist より優先) */
  blocklist?: string[];
  /** 1 回で返す最大文字数 (デフォルト 16000) */
  defaultMaxChars?: number;
  /** リクエストタイムアウト ms (デフォルト 30000) */
  timeoutMs?: number;
  /** ダウンロード上限 bytes (デフォルト 2MB) */
  maxBytes?: number;
  /** User-Agent ヘッダ */
  userAgent?: string;
  /** テスト用 fetch 差し替え */
  fetchImpl?: typeof fetch;
  /** テスト用 DNS lookup 差し替え */
  lookupImpl?: typeof dnsLookup;
  /** SSRF 用プライベートアドレスチェックをスキップ (テスト用)。本番では false */
  skipPrivateAddressCheck?: boolean;
}

export function makeWebFetchTool(
  options: WebFetchOptions = {}
): ToolDef<typeof WebFetchSchema, WebFetchResult> {
  const allowlist = options.allowlist;
  const blocklist = options.blocklist ?? [];
  const defaultMaxChars = options.defaultMaxChars ?? 16_000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const doFetch = options.fetchImpl ?? fetch;
  const doLookup = options.lookupImpl ?? dnsLookup;
  const userAgent = options.userAgent ?? "orica-ai-web-fetch/0.1";
  const skipPrivateAddressCheck = options.skipPrivateAddressCheck ?? false;

  const allowlistDesc =
    allowlist && allowlist.length > 0
      ? ` 許可ホスト: ${allowlist.join(", ")}.`
      : "";

  const protoHuman = protocolListForHumans();
  return {
    name: "web_fetch",
    description:
      `外部 URL の本文を取得する。使うべき場面: ユーザーが URL を提示した / web_search で見つけた URL の中身を読みたい / 公式 Q&A や独自カードサイトのページを引用したい。` +
      `${protoHuman} のみ (平文 http はダウングレード防止のため拒否)。SSRF 防止のためプライベート IP も拒否。HTML は自動でタグ除去 (raw=true で生 HTML 取得)。` +
      `URL を当てずっぽうで組み立てるのは禁止。先に web_search で URL を見つけるか、ユーザー指定の URL を使うこと。${allowlistDesc}`,
    schema: WebFetchSchema,
    jsonSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: `取得する URL (${protoHuman} のみ。それ以外のプロトコルは拒否される)`,
        },
        maxChars: {
          type: "integer",
          minimum: 1,
          maximum: 64_000,
          description: `返す本文の最大文字数 (デフォルト ${defaultMaxChars})`,
        },
        raw: {
          type: "boolean",
          description: "true で HTML のタグ除去をしない (デフォルト false)",
        },
      },
    },
    execute: async ({ url, maxChars, raw }) => {
      const parsed = new URL(url);
      if (!isAllowedProtocol(parsed.protocol)) {
        throw new Error(
          `unsupported protocol: ${parsed.protocol}. Allowed: ${WEB_FETCH_ALLOWED_PROTOCOLS.join(", ")}.`
        );
      }
      const host = parsed.hostname.toLowerCase();
      if (!host) {
        throw new Error("url must have a hostname");
      }
      if (host === "localhost") {
        throw new Error(`blocked host: ${host}`);
      }
      if (blocklist.some((p) => matchHostPattern(host, p))) {
        throw new Error(`host is blocklisted: ${host}`);
      }
      if (allowlist && allowlist.length > 0) {
        if (!allowlist.some((p) => matchHostPattern(host, p))) {
          throw new Error(
            `host not in allowlist: ${host}. Allowed patterns: ${allowlist.join(", ")}`
          );
        }
      }
      if (!skipPrivateAddressCheck) {
        const resolved = await doLookup(host);
        const addr = resolved.address;
        const family = resolved.family;
        const isPrivate =
          family === 4 ? isPrivateIPv4(addr) : isPrivateIPv6(addr);
        if (isPrivate) {
          throw new Error(
            `host resolves to private address (SSRF guard): ${host} -> ${addr}`
          );
        }
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await doFetch(url, {
          signal: ctrl.signal,
          redirect: "follow",
          headers: {
            "User-Agent": userAgent,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
          },
        });
        const contentType = res.headers.get("content-type") ?? "";
        const { buffer, received, hitLimit } = await readBodyWithLimit(
          res,
          maxBytes
        );
        const rawText = buffer.toString("utf8");
        const text = raw ? rawText : maybeStripHtml(contentType, rawText);
        const cap = maxChars ?? defaultMaxChars;
        const charTruncated = text.length > cap;
        return {
          url,
          status: res.status,
          contentType,
          content: charTruncated ? text.slice(0, cap) : text,
          truncated: charTruncated || hitLimit,
          bytes: received,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

interface ReadResult {
  buffer: Buffer;
  received: number;
  hitLimit: boolean;
}

async function readBodyWithLimit(
  res: Response,
  maxBytes: number
): Promise<ReadResult> {
  if (!res.body) {
    const text = await res.text();
    const buf = Buffer.from(text, "utf8");
    if (buf.byteLength > maxBytes) {
      return {
        buffer: buf.subarray(0, maxBytes),
        received: maxBytes,
        hitLimit: true,
      };
    }
    return { buffer: buf, received: buf.byteLength, hitLimit: false };
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  let hitLimit = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    const chunk = Buffer.from(value);
    if (received + chunk.byteLength > maxBytes) {
      const remaining = maxBytes - received;
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      received = maxBytes;
      hitLimit = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(chunk);
    received += chunk.byteLength;
  }
  return { buffer: Buffer.concat(chunks), received, hitLimit };
}

function maybeStripHtml(contentType: string, body: string): string {
  const looksHtml =
    /html|xml/i.test(contentType) ||
    /<\s*html\b|<\s*body\b/i.test(body.slice(0, 1024));
  if (!looksHtml) return body;
  return stripHtml(body);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
