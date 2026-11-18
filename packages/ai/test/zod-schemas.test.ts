import { describe, expect, it } from "vitest";
import { validateParseOutput } from "../src/parsers/zod-schemas";

describe("validateParseOutput", () => {
  it("accepts a minimal valid effect", () => {
    const result = validateParseOutput({
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts needsHumanReview shape", () => {
    const result = validateParseOutput({
      effects: [],
      needsHumanReview: true,
      reason: "数量不明",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects effect missing timing", () => {
    const result = validateParseOutput({
      effects: [
        {
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects effect with empty steps", () => {
    const result = validateParseOutput({
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});
