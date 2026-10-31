import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { ledgerDriverScriptPath } from "../../../scripts/sync-worktree-to-main.mjs";

describe("sync-worktree-to-main oledger driver registration", () => {
  it("registers the ledger merge driver from the executing repo script", () => {
    const scripts = resolve("fixtures", "checkout with spaces 棋譜", "scripts");
    expect(
      ledgerDriverScriptPath(
        pathToFileURL(resolve(scripts, "sync-worktree-to-main.mjs")).href
      )
    ).toBe(resolve(scripts, "git-merge-ledger.mjs").replace(/\\/g, "/"));
  });
});
