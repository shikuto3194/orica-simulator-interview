#!/usr/bin/env node
import { buildDefaultRegistry } from "../tools/registry.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkWebFetch(): Promise<CheckResult> {
  const reg = buildDefaultRegistry();
  const tool = reg.get("web_fetch");
  if (!tool) {
    return {
      name: "web_fetch",
      ok: false,
      detail: "tool not registered (ORICA_AI_DISABLE_WEB?)",
    };
  }
  try {
    const out = (await tool.execute({
      url: "https://example.com/",
      maxChars: 2000,
    })) as { status: number; content: string };
    if (out.status !== 200) {
      return {
        name: "web_fetch",
        ok: false,
        detail: `unexpected status ${out.status}`,
      };
    }
    if (!/Example Domain/i.test(out.content)) {
      return {
        name: "web_fetch",
        ok: false,
        detail: `content did not contain "Example Domain": ${out.content.slice(0, 200)}`,
      };
    }
    return {
      name: "web_fetch",
      ok: true,
      detail: `status=${out.status}, bytes match`,
    };
  } catch (err) {
    return {
      name: "web_fetch",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkWebSearch(): Promise<CheckResult> {
  const reg = buildDefaultRegistry();
  const tool = reg.get("web_search");
  if (!tool) {
    return {
      name: "web_search",
      ok: false,
      detail: "tool not registered (ORICA_AI_DISABLE_WEB?)",
    };
  }
  try {
    const out = (await tool.execute({
      query: "wikipedia battle spirits",
      maxResults: 3,
    })) as {
      backend: string;
      results: Array<{ title: string; url: string; snippet: string }>;
    };
    if (out.results.length === 0) {
      return {
        name: "web_search",
        ok: false,
        detail:
          "0 results. Backend may be rate-limiting, or the parser may need updating.",
      };
    }
    const sample = out.results[0];
    if (!sample || !/^https?:\/\//.test(sample.url) || !sample.title) {
      return {
        name: "web_search",
        ok: false,
        detail: `malformed result: ${JSON.stringify(sample)}`,
      };
    }
    return {
      name: "web_search",
      ok: true,
      detail: `backend=${out.backend}, ${out.results.length} results, first url=${sample.url}`,
    };
  } catch (err) {
    return {
      name: "web_search",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function main(): Promise<void> {
  console.warn(
    "[web-smoke] running real-HTTP checks for web_fetch + web_search"
  );
  const results = await Promise.all([checkWebFetch(), checkWebSearch()]);
  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? "[ OK ]" : "[FAIL]";
    console.warn(`${tag} ${r.name}: ${r.detail}`);
    if (!r.ok) failed++;
  }
  if (failed > 0) {
    console.warn(
      `[web-smoke] ${failed} check(s) failed. ` +
        "If web_search failed with a parser/anomaly error, the DuckDuckGo layout may have changed; " +
        "update parseDuckDuckGoHtml in packages/ai/src/tools/web-search.ts."
    );
    process.exit(1);
  }
  console.warn("[web-smoke] all checks passed.");
}

main().catch((err) => {
  console.error("[web-smoke] unexpected failure:", err);
  process.exit(2);
});
