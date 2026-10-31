import { describe, expect, it } from "vitest";
import {
  WEB_FETCH_ALLOWED_PROTOCOLS,
  makeWebFetchTool,
} from "../src/tools/web-fetch";

describe("web_fetch protocol consistency (Item 4)", () => {
  it("exports a single-source-of-truth protocol list", () => {
    expect(WEB_FETCH_ALLOWED_PROTOCOLS).toContain("https:");
    expect(WEB_FETCH_ALLOWED_PROTOCOLS).not.toContain("http:");
  });

  it("tool description references the protocol list (not hard-coded)", () => {
    const tool = makeWebFetchTool({ allowlist: ["example.com"] });
    expect(tool.description).toContain("https");
    // The description is generated, not a stale string saying http
    expect(tool.description).not.toMatch(/http\s+または\s+https/);
  });

  it("jsonSchema.url.description matches the protocol list", () => {
    const tool = makeWebFetchTool({ allowlist: ["example.com"] });
    const schema = tool.jsonSchema as {
      properties: { url: { description: string } };
    };
    expect(schema.properties.url.description).toContain("https");
    expect(schema.properties.url.description).not.toMatch(
      /http\s+または\s+https/
    );
  });

  it("runtime rejects non-https with a message that lists allowed protocols", async () => {
    const tool = makeWebFetchTool({ allowlist: ["example.com"] });
    await expect(tool.execute({ url: "ftp://example.com/" })).rejects.toThrow(
      /https/
    );
  });
});
