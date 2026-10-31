import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAgentRun, telemetryPath } from "../src/telemetry";

describe("telemetry", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "orica-ai-tel-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("appends a record to .claude/ai-telemetry.jsonl", async () => {
    await recordAgentRun(
      {
        task: "BSTH05-X01 のテキストを教えて",
        steps: 3,
        selectedSkills: ["card-info"],
        selectedMemories: ["project_rule_base"],
        resolvedCommand: "review",
      },
      { repoRoot: tmp, env: {} }
    );
    const path = telemetryPath(tmp);
    const content = await readFile(path, "utf8");
    const lines = content.trim().split(/\n/);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record.taskPreview).toBe("BSTH05-X01 のテキストを教えて");
    expect(record.steps).toBe(3);
    expect(record.selectedSkills).toEqual(["card-info"]);
    expect(record.resolvedCommand).toBe("review");
    expect(typeof record.ts).toBe("string");
  });

  it("truncates long task previews to 120 chars + ellipsis", async () => {
    const long = "あ".repeat(200);
    await recordAgentRun(
      {
        task: long,
        steps: 1,
        selectedSkills: [],
        selectedMemories: [],
      },
      { repoRoot: tmp, env: {} }
    );
    const content = await readFile(telemetryPath(tmp), "utf8");
    const record = JSON.parse(content.trim());
    expect(record.taskPreview.length).toBeLessThanOrEqual(120);
    expect(record.taskPreview.endsWith("…")).toBe(true);
  });

  it("respects ORICA_AI_TELEMETRY_OFF=true", async () => {
    await recordAgentRun(
      {
        task: "should not be logged",
        steps: 1,
        selectedSkills: [],
        selectedMemories: [],
      },
      { repoRoot: tmp, env: { ORICA_AI_TELEMETRY_OFF: "true" } }
    );
    await expect(readFile(telemetryPath(tmp), "utf8")).rejects.toThrow();
  });
});
