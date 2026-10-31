import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeApplyEditTool,
  makeReadFileTool,
  makeWriteFileTool,
} from "../src/tools/file-ops";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = join(tmpdir(), `orica-ai-fs-${Date.now()}-${Math.random()}`);
  await mkdir(repoRoot, { recursive: true });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("read_file tool", () => {
  it("reads a file inside the repo", async () => {
    await writeFile(join(repoRoot, "a.txt"), "hello", "utf8");
    const tool = makeReadFileTool({ repoRoot });
    const result = await tool.execute({ path: "a.txt" });
    expect(result.content).toBe("hello");
    expect(result.truncated).toBe(false);
  });

  it("rejects path escape", async () => {
    const tool = makeReadFileTool({ repoRoot });
    await expect(tool.execute({ path: "../../etc/passwd" })).rejects.toThrow(
      /path escape/
    );
  });

  it("truncates when content exceeds maxChars", async () => {
    await writeFile(join(repoRoot, "big.txt"), "x".repeat(1000), "utf8");
    const tool = makeReadFileTool({ repoRoot });
    const result = await tool.execute({ path: "big.txt", maxChars: 100 });
    expect(result.content.length).toBe(100);
    expect(result.truncated).toBe(true);
  });
});

describe("write_file tool", () => {
  it("creates a new file", async () => {
    const tool = makeWriteFileTool({ repoRoot });
    await tool.execute({ path: "new.txt", content: "fresh" });
    expect(await readFile(join(repoRoot, "new.txt"), "utf8")).toBe("fresh");
  });

  it("refuses to overwrite without flag", async () => {
    await writeFile(join(repoRoot, "exists.txt"), "old", "utf8");
    const tool = makeWriteFileTool({ repoRoot });
    await expect(
      tool.execute({ path: "exists.txt", content: "new" })
    ).rejects.toThrow(/file exists/);
  });

  it("overwrites with overwrite=true", async () => {
    await writeFile(join(repoRoot, "exists.txt"), "old", "utf8");
    const tool = makeWriteFileTool({ repoRoot });
    await tool.execute({
      path: "exists.txt",
      content: "new",
      overwrite: true,
    });
    expect(await readFile(join(repoRoot, "exists.txt"), "utf8")).toBe("new");
  });

  it("rejects protected paths", async () => {
    const tool = makeWriteFileTool({ repoRoot });
    await expect(
      tool.execute({ path: ".env", content: "secret" })
    ).rejects.toThrow(/protected/);
    await expect(
      tool.execute({
        path: "node_modules/x/y.js",
        content: "x",
      })
    ).rejects.toThrow(/protected/);
  });
});

describe("apply_edit tool", () => {
  it("replaces a unique occurrence", async () => {
    await writeFile(join(repoRoot, "code.ts"), "const x = 1;\n", "utf8");
    const tool = makeApplyEditTool({ repoRoot });
    const result = await tool.execute({
      path: "code.ts",
      oldString: "const x = 1;",
      newString: "const x = 2;",
    });
    expect(result.replacements).toBe(1);
    expect(await readFile(join(repoRoot, "code.ts"), "utf8")).toContain(
      "const x = 2;"
    );
  });

  it("errors when oldString is absent", async () => {
    await writeFile(join(repoRoot, "code.ts"), "abc", "utf8");
    const tool = makeApplyEditTool({ repoRoot });
    await expect(
      tool.execute({ path: "code.ts", oldString: "zzz", newString: "yyy" })
    ).rejects.toThrow(/not found/);
  });

  it("errors when oldString matches multiple times without replaceAll", async () => {
    await writeFile(join(repoRoot, "code.ts"), "x x x", "utf8");
    const tool = makeApplyEditTool({ repoRoot });
    await expect(
      tool.execute({ path: "code.ts", oldString: "x", newString: "y" })
    ).rejects.toThrow(/matches 3 times/);
  });

  it("replaces all when replaceAll=true", async () => {
    await writeFile(join(repoRoot, "code.ts"), "x x x", "utf8");
    const tool = makeApplyEditTool({ repoRoot });
    const result = await tool.execute({
      path: "code.ts",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    });
    expect(result.replacements).toBe(3);
    expect(await readFile(join(repoRoot, "code.ts"), "utf8")).toBe("y y y");
  });
});
