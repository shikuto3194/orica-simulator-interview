import { describe, expect, it, vi } from "vitest";
import {
  analyzeDuckDuckGoHtml,
  makeWebSearchTool,
  parseDuckDuckGoHtml,
} from "../src/tools/web-search";

function mockFetch(body: string, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "content-type": "text/html" },
      })
  ) as unknown as typeof fetch;
}

const SAMPLE_DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example Page <b>highlight</b></a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">This is a <b>snippet</b> from example.</a>
</div>
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fother.test%2Fpath">Other Result</a>
  </h2>
  <a class="result__snippet">Snippet two.</a>
</div>
`;

describe("parseDuckDuckGoHtml", () => {
  it("extracts title, decoded URL, and snippet", () => {
    const results = parseDuckDuckGoHtml(SAMPLE_DDG_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example Page highlight",
      url: "https://example.com/page",
      snippet: "This is a snippet from example.",
    });
    expect(results[1]).toEqual({
      title: "Other Result",
      url: "https://other.test/path",
      snippet: "Snippet two.",
    });
  });

  it("returns empty array when no result blocks exist", () => {
    expect(parseDuckDuckGoHtml("<html><body>no results</body></html>")).toEqual(
      []
    );
  });
});

describe("analyzeDuckDuckGoHtml", () => {
  it("signals ok when there are results", () => {
    const analysis = analyzeDuckDuckGoHtml(SAMPLE_DDG_HTML);
    expect(analysis.signal).toBe("ok");
    expect(analysis.results.length).toBeGreaterThan(0);
  });

  it("signals blocked on anomaly page", () => {
    const html =
      '<div class="anomaly-modal">Unfortunately, bots use DuckDuckGo too.</div>';
    expect(analyzeDuckDuckGoHtml(html).signal).toBe("blocked");
  });

  it("signals empty when DDG says no results", () => {
    const html = '<div class="no-results">No results.</div>';
    expect(analyzeDuckDuckGoHtml(html).signal).toBe("empty");
  });

  it("signals unknown_structure when no markers match", () => {
    const html = "<html><body><main>unrelated content</main></body></html>";
    expect(analyzeDuckDuckGoHtml(html).signal).toBe("unknown_structure");
  });

  it("signals unknown_structure when markers exist but parser found nothing", () => {
    // structure markers present, but our regex won't extract complete pairs
    const html =
      '<div class="results_links"><span class="result__a-broken">x</span></div>';
    const analysis = analyzeDuckDuckGoHtml(html);
    expect(analysis.results).toEqual([]);
    expect(analysis.signal).toBe("unknown_structure");
  });
});

describe("makeWebSearchTool", () => {
  it("fetches and parses results", async () => {
    const tool = makeWebSearchTool({
      fetchImpl: mockFetch(SAMPLE_DDG_HTML),
    });
    const result = await tool.execute({ query: "battle spirits" });
    expect(result.backend).toBe("duckduckgo");
    expect(result.query).toBe("battle spirits");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.url).toBe("https://example.com/page");
  });

  it("respects maxResults", async () => {
    const tool = makeWebSearchTool({
      fetchImpl: mockFetch(SAMPLE_DDG_HTML),
    });
    const result = await tool.execute({
      query: "battle spirits",
      maxResults: 1,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("Example Page highlight");
  });

  it("rejects empty query at schema layer", () => {
    const tool = makeWebSearchTool({ fetchImpl: mockFetch("") });
    expect(() => tool.schema.parse({ query: "" })).toThrow();
  });

  it("throws on non-200 backend response", async () => {
    const tool = makeWebSearchTool({
      fetchImpl: mockFetch("", 503),
    });
    await expect(tool.execute({ query: "x" })).rejects.toThrow(/HTTP 503/);
  });

  it("throws when DDG returns an anomaly/captcha page", async () => {
    const anomalyHtml = `
      <html><body>
        <div class="anomaly-modal">
          Unfortunately, bots use DuckDuckGo too. Please complete the CAPTCHA.
        </div>
      </body></html>
    `;
    const tool = makeWebSearchTool({ fetchImpl: mockFetch(anomalyHtml) });
    await expect(tool.execute({ query: "x" })).rejects.toThrow(
      /anomaly|captcha|blocked/i
    );
  });

  it("throws when HTML has no results and no recognized structure (parser drift)", async () => {
    const driftedHtml =
      "<html><body><main>welcome to NewSearch v2</main></body></html>";
    const tool = makeWebSearchTool({ fetchImpl: mockFetch(driftedHtml) });
    await expect(tool.execute({ query: "x" })).rejects.toThrow(
      /parser may be outdated|expected DuckDuckGo layout/i
    );
  });

  it("returns empty array when DDG legitimately has no results", async () => {
    const emptyHtml =
      '<html><body><div class="results"><div class="no-results">No results.</div></div></body></html>';
    const tool = makeWebSearchTool({ fetchImpl: mockFetch(emptyHtml) });
    const result = await tool.execute({ query: "asdkjghasdkjghaskdjhg" });
    expect(result.results).toEqual([]);
  });

  it("calls fetch with POST and form-encoded query", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(SAMPLE_DDG_HTML, {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    const tool = makeWebSearchTool({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await tool.execute({ query: "hello world" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("duckduckgo.com");
    expect((init as RequestInit).method).toBe("POST");
    expect(String((init as RequestInit).body)).toBe("q=hello%20world");
  });
});
