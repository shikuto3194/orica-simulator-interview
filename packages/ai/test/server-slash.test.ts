import { describe, expect, it } from "vitest";
import { resolveSlashCommand } from "../src/server/server";

describe("resolveSlashCommand (GUI slash command parsing)", () => {
  it("returns null for normal text", async () => {
    expect(await resolveSlashCommand("ウェブリサーチして")).toBeNull();
  });

  it("returns null for unknown commands", async () => {
    expect(await resolveSlashCommand("/totally-unknown")).toBeNull();
  });

  it("resolves /research to the slash command and preserves args", async () => {
    const r = await resolveSlashCommand("/research 煌臨条件の最新裁定");
    expect(r).not.toBeNull();
    expect(r!.command.name).toBe("research");
    expect(r!.args).toBe("煌臨条件の最新裁定");
    expect(r!.additionalSystem).toContain("煌臨条件の最新裁定");
    expect(r!.command.allowedTools).toContain("web_search");
  });

  it("resolves /research with no args", async () => {
    const r = await resolveSlashCommand("/research");
    expect(r).not.toBeNull();
    expect(r!.args).toBe("");
  });

  it("does not treat a URL with a leading slash as a command", async () => {
    // Slash command parser requires letter/digit after the slash; URLs like /foo
    // will only match if /foo is registered. /https://... wouldn't match the regex.
    expect(await resolveSlashCommand("/https://example.com")).toBeNull();
  });
});
