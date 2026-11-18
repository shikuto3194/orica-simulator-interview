import { describe, expect, it, vi } from "vitest";
import { makeWebFetchTool, stripHtml } from "../src/tools/web-fetch";

function mockLookup(address: string, family: 4 | 6 = 4) {
  return vi.fn(
    async () => ({ address, family }) as { address: string; family: 4 | 6 }
  );
}

function mockFetch(response: {
  status?: number;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
}): typeof fetch {
  const headers = new Headers({
    "content-type": response.contentType ?? "text/plain",
    ...(response.headers ?? {}),
  });
  const init: ResponseInit = {
    status: response.status ?? 200,
    headers,
  };
  return vi.fn(
    async () => new Response(response.body ?? "", init)
  ) as unknown as typeof fetch;
}

describe("makeWebFetchTool", () => {
  it("fetches plain text and returns content", async () => {
    const tool = makeWebFetchTool({
      fetchImpl: mockFetch({ body: "hello world", contentType: "text/plain" }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    const result = await tool.execute({ url: "https://example.com/" });
    expect(result.status).toBe(200);
    expect(result.content).toBe("hello world");
    expect(result.truncated).toBe(false);
    expect(result.bytes).toBe(11);
  });

  it("strips HTML by default", async () => {
    const html =
      "<html><head><script>var x=1;</script><style>p{color:red}</style></head>" +
      "<body><h1>Title</h1><p>Hello <strong>world</strong>.</p></body></html>";
    const tool = makeWebFetchTool({
      fetchImpl: mockFetch({ body: html, contentType: "text/html" }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    const result = await tool.execute({ url: "https://example.com/" });
    expect(result.content).not.toContain("<");
    expect(result.content).not.toContain("var x=1");
    expect(result.content).toContain("Title");
    expect(result.content).toContain("Hello world");
  });

  it("returns raw HTML when raw=true", async () => {
    const html = "<p>raw</p>";
    const tool = makeWebFetchTool({
      fetchImpl: mockFetch({ body: html, contentType: "text/html" }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    const result = await tool.execute({
      url: "https://example.com/",
      raw: true,
    });
    expect(result.content).toBe(html);
  });

  it("truncates content over maxChars", async () => {
    const tool = makeWebFetchTool({
      fetchImpl: mockFetch({ body: "x".repeat(1000) }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    const result = await tool.execute({
      url: "https://example.com/",
      maxChars: 100,
    });
    expect(result.content.length).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("rejects non-https schemes (http blocked for downgrade prevention)", async () => {
    const tool = makeWebFetchTool({
      lookupImpl: mockLookup("93.184.216.34"),
    });
    await expect(tool.execute({ url: "http://example.com/" })).rejects.toThrow(
      /unsupported protocol/
    );
    await expect(tool.execute({ url: "file:///etc/passwd" })).rejects.toThrow(
      /unsupported protocol/
    );
    await expect(tool.execute({ url: "ftp://example.com/" })).rejects.toThrow(
      /unsupported protocol/
    );
  });

  it("rejects localhost host literal", async () => {
    const tool = makeWebFetchTool({
      lookupImpl: mockLookup("127.0.0.1"),
    });
    await expect(
      tool.execute({ url: "https://localhost:8080/" })
    ).rejects.toThrow(/blocked host/);
  });

  it("rejects when DNS resolves to a private IPv4 address (SSRF)", async () => {
    const tool = makeWebFetchTool({
      fetchImpl: mockFetch({ body: "should not see" }),
      lookupImpl: mockLookup("10.0.0.5"),
    });
    await expect(
      tool.execute({ url: "https://internal.example/" })
    ).rejects.toThrow(/private address/);
  });

  it("rejects when DNS resolves to IPv6 loopback (SSRF)", async () => {
    const tool = makeWebFetchTool({
      fetchImpl: mockFetch({ body: "should not see" }),
      lookupImpl: mockLookup("::1", 6),
    });
    await expect(tool.execute({ url: "https://v6.example/" })).rejects.toThrow(
      /private address/
    );
  });

  it("rejects host not in allowlist", async () => {
    const tool = makeWebFetchTool({
      allowlist: ["wikipedia.org", "*.wikipedia.org"],
      fetchImpl: mockFetch({ body: "x" }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    await expect(tool.execute({ url: "https://example.com/" })).rejects.toThrow(
      /allowlist/
    );
  });

  it("accepts host matching a wildcard allowlist entry", async () => {
    const tool = makeWebFetchTool({
      allowlist: ["*.wikipedia.org"],
      fetchImpl: mockFetch({ body: "ok" }),
      lookupImpl: mockLookup("208.80.154.224"),
    });
    const result = await tool.execute({
      url: "https://en.wikipedia.org/wiki/Cat",
    });
    expect(result.content).toBe("ok");
  });

  it("rejects host in blocklist even if allowlist permits", async () => {
    const tool = makeWebFetchTool({
      allowlist: ["*"],
      blocklist: ["evil.example"],
      fetchImpl: mockFetch({ body: "x" }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    await expect(
      tool.execute({ url: "https://evil.example/" })
    ).rejects.toThrow(/blocklisted/);
  });

  it("caps download at maxBytes and reports truncated", async () => {
    const tool = makeWebFetchTool({
      maxBytes: 32,
      fetchImpl: mockFetch({ body: "y".repeat(1024) }),
      lookupImpl: mockLookup("93.184.216.34"),
    });
    const result = await tool.execute({ url: "https://example.com/" });
    expect(result.bytes).toBeLessThanOrEqual(32);
    expect(result.truncated).toBe(true);
  });
});

describe("stripHtml", () => {
  it("removes scripts, styles, and tags", () => {
    expect(
      stripHtml(
        "<html><script>bad()</script><style>x{}</style><p>Hi <b>there</b></p></html>"
      )
    ).toBe("Hi there");
  });

  it("decodes common entities", () => {
    expect(stripHtml("<p>&amp;&lt;&gt;&quot;&#39;</p>")).toBe("&<>\"'");
  });

  it("decodes numeric entities", () => {
    expect(stripHtml("<p>&#65;&#x42;</p>")).toBe("AB");
  });
});
