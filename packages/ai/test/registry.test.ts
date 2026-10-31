import { describe, expect, it } from "vitest";
import {
  buildDefaultRegistry,
  DEFAULT_WEB_HOST_ALLOWLIST,
} from "../src/tools/registry";

describe("buildDefaultRegistry web tool wiring", () => {
  it("includes web_fetch and web_search by default", () => {
    const reg = buildDefaultRegistry({ env: {} });
    const names = reg.list().map((t) => t.name);
    expect(names).toContain("web_fetch");
    expect(names).toContain("web_search");
  });

  it("excludes web tools when ORICA_AI_DISABLE_WEB=true", () => {
    const reg = buildDefaultRegistry({ env: { ORICA_AI_DISABLE_WEB: "true" } });
    const names = reg.list().map((t) => t.name);
    expect(names).not.toContain("web_fetch");
    expect(names).not.toContain("web_search");
  });

  it("excludes web tools when includeWebTools=false overrides env", () => {
    const reg = buildDefaultRegistry({ env: {}, includeWebTools: false });
    const names = reg.list().map((t) => t.name);
    expect(names).not.toContain("web_fetch");
    expect(names).not.toContain("web_search");
  });

  it("threads ORICA_AI_WEB_HOST_ALLOWLIST into the web_fetch description", () => {
    const reg = buildDefaultRegistry({
      env: {
        ORICA_AI_WEB_HOST_ALLOWLIST: "wikipedia.org,*.wikipedia.org",
      },
    });
    const fetchTool = reg.get("web_fetch");
    expect(fetchTool).toBeDefined();
    expect(fetchTool!.description).toContain("wikipedia.org");
  });

  it("applies the default 3-domain allowlist when env is unset", () => {
    const reg = buildDefaultRegistry({ env: {} });
    const fetchTool = reg.get("web_fetch");
    expect(fetchTool).toBeDefined();
    for (const host of DEFAULT_WEB_HOST_ALLOWLIST) {
      expect(fetchTool!.description).toContain(host);
    }
  });

  it("rejects non-allowlisted host at execute time when env is unset", async () => {
    const reg = buildDefaultRegistry({
      env: {},
      webFetchOptions: {
        fetchImpl: (async () =>
          new Response("ok", { status: 200 })) as unknown as typeof fetch,
        lookupImpl: (async () => ({
          address: "93.184.216.34",
          family: 4 as const,
        })) as unknown as typeof import("node:dns/promises").lookup,
      },
    });
    const fetchTool = reg.get("web_fetch");
    await expect(
      fetchTool!.execute({ url: "https://example.com/" })
    ).rejects.toThrow(/allowlist/);
  });

  it("accepts each default allowlist host at execute time", async () => {
    const reg = buildDefaultRegistry({
      env: {},
      webFetchOptions: {
        fetchImpl: (async () =>
          new Response("ok", { status: 200 })) as unknown as typeof fetch,
        lookupImpl: (async () => ({
          address: "93.184.216.34",
          family: 4 as const,
        })) as unknown as typeof import("node:dns/promises").lookup,
      },
    });
    const fetchTool = reg.get("web_fetch");
    const urls = [
      "https://batspi.com/",
      "https://www.battlespirits.com/",
      "https://dancing-pixie-db5cc3.netlify.app/some/page",
    ];
    for (const url of urls) {
      const result = (await fetchTool!.execute({ url })) as { status: number };
      expect(result.status).toBe(200);
    }
  });

  it("env override replaces the default allowlist (not appends)", () => {
    const reg = buildDefaultRegistry({
      env: { ORICA_AI_WEB_HOST_ALLOWLIST: "example.com" },
    });
    const fetchTool = reg.get("web_fetch");
    expect(fetchTool!.description).toContain("example.com");
    expect(fetchTool!.description).not.toContain("batspi.com");
  });
});
