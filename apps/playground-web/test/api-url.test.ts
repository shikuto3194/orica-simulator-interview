import { describe, expect, it } from "vitest";
import { createApiUrl } from "../src/apiUrl";

describe("API origin", () => {
  it("keeps local dev requests relative and sends public requests to the API host", () => {
    expect(createApiUrl()("/api/room/abc/events")).toBe("/api/room/abc/events");
    const url = createApiUrl("https://api.example.com/");
    for (const path of [
      "/api/room",
      "/api/room/abc/events",
      "/api/room/abc/leave",
      "/api/snapshot",
    ]) {
      expect(url(path)).toBe(`https://api.example.com${path}`);
    }
  });
  it.each([
    "http://api.example.com",
    "https://example.com/api",
    "https://user:secret@example.com",
    "https://example.com?key=x",
  ])("rejects an unsafe or misconfigured origin: %s", (base) => {
    expect(() => createApiUrl(base)).toThrow();
  });
});
