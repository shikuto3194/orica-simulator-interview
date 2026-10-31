import { describe, expect, it } from "vitest";
import {
  assertWriteCompliance,
  WriteAdvisorError,
} from "../src/tools/write-advisor";

describe("write-advisor: effect type kind addition (Item 1)", () => {
  it("blocks adding a new kind literal in effects/types.ts", () => {
    const previous = `export type Action = { kind: "core_move" } | { kind: "draw" };`;
    const next = `export type Action = { kind: "core_move" } | { kind: "draw" } | { kind: "effect_param_modify" };`;
    expect(() =>
      assertWriteCompliance({
        rel: "packages/rules-core/src/effects/types.ts",
        content: next,
        previousContent: previous,
      })
    ).toThrow(WriteAdvisorError);
  });

  it("allows edits that don't add new kinds", () => {
    const previous = `export type Action = { kind: "core_move" } | { kind: "draw" };`;
    const next = `export type Action = { kind: "core_move" /* edited */ } | { kind: "draw" };`;
    expect(() =>
      assertWriteCompliance({
        rel: "packages/rules-core/src/effects/types.ts",
        content: next,
        previousContent: previous,
      })
    ).not.toThrow();
  });

  it("does not apply to non-rules-core files", () => {
    const next = `const data = { kind: "anything_new" };`;
    expect(() =>
      assertWriteCompliance({
        rel: "packages/ai/src/server/server.ts",
        content: next,
      })
    ).not.toThrow();
  });
});

describe("write-advisor: 20_design/ stub placement (Item 2)", () => {
  it("blocks new short .md in manual/ai-reference/20_design/", () => {
    const content = "## stub\n- TODO\n- impl required";
    expect(() =>
      assertWriteCompliance({
        rel: "manual/ai-reference/20_design/99_new-doc.md",
        content,
      })
    ).toThrow(/20_design/);
  });

  it("does not block when content is 30+ lines", () => {
    const content = Array.from({ length: 40 }, (_, i) => `line ${i}`).join(
      "\n"
    );
    expect(() =>
      assertWriteCompliance({
        rel: "manual/ai-reference/20_design/99_new-doc.md",
        content,
      })
    ).not.toThrow();
  });

  it("does not block edits to existing 20_design files (previousContent set)", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "manual/ai-reference/20_design/01_existing.md",
        content: "short",
        previousContent: "existing content",
      })
    ).not.toThrow();
  });
});

describe("write-advisor: abandoned write signature (Item 11)", () => {
  it("blocks a 3-line file ending with 'required'", () => {
    const content = "## プリミティブ効果層\n- 新規追加\n  - 実装が required";
    expect(() =>
      assertWriteCompliance({
        rel: "some/path.md",
        content,
      })
    ).toThrow(/TODO|required/i);
  });

  it("blocks ending in 'TODO'", () => {
    const content = "title\nTODO";
    expect(() => assertWriteCompliance({ rel: "x.md", content })).toThrow(
      WriteAdvisorError
    );
  });

  it("does not trigger for substantial files", () => {
    const content =
      Array.from({ length: 20 }, () => "line").join("\n") + "\nTODO";
    expect(() => assertWriteCompliance({ rel: "x.md", content })).not.toThrow();
  });
});

describe("write-advisor: SSOT parallel zone→display-key mapping (Item 4)", () => {
  const trioSwitch = `switch (c.kind) { case "reserve": return r(); case "trash": return t(); case "life": return l(); default: return null; }`;
  // 真の違反: 表示層 + ゾーン三つ組 + overrides 構築 + 正源非経由
  const parallelMapping = `const overrides: Record<string, number> = {}; overrides["reserve"] = 1; ${trioSwitch}`;

  it("blocks a parallel display-key mapping in the display layer", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "apps/playground-web/src/altOverrides.ts",
        content: parallelMapping,
      })
    ).toThrow(/SSOT/);
  });

  // --- 必要な分散は阻害しない ---
  it("allows zone control-flow only (no overrides construction)", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "apps/playground-web/src/components/ZoneTapBar.tsx",
        content: trioSwitch,
      })
    ).not.toThrow();
  });

  it("allows engine / other layers even with overrides+trio (out of display scope)", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "packages/rules-core/src/core-relocation.ts",
        content: parallelMapping,
      })
    ).not.toThrow();
    expect(() =>
      assertWriteCompliance({
        rel: "apps/cli/src/dumpCores.ts",
        content: parallelMapping,
      })
    ).not.toThrow();
  });

  it("allows a display producer that routes through coreContainerDisplayKey", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "apps/playground-web/src/extraOverrides.ts",
        content: `const k = coreContainerDisplayKey(c, vp); const overrides: Record<string, number> = {}; ${trioSwitch}`,
      })
    ).not.toThrow();
  });

  it("does not block the SSOT owner module (coreDisplayOverrides.ts)", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "apps/playground-web/src/coreDisplayOverrides.ts",
        content: parallelMapping,
      })
    ).not.toThrow();
  });

  it("does not block editing a file that already had the mapping (newly-introduced only)", () => {
    expect(() =>
      assertWriteCompliance({
        rel: "apps/playground-web/src/components/Existing.tsx",
        content: parallelMapping + "\n// edited",
        previousContent: parallelMapping,
      })
    ).not.toThrow();
  });

  it("respects ORICA_AI_WRITE_ADVISOR_OFF for the SSOT check", () => {
    expect(() =>
      assertWriteCompliance(
        {
          rel: "apps/playground-web/src/altOverrides.ts",
          content: parallelMapping,
        },
        { ORICA_AI_WRITE_ADVISOR_OFF: "true" }
      )
    ).not.toThrow();
  });
});

describe("write-advisor: opt-out", () => {
  it("respects ORICA_AI_WRITE_ADVISOR_OFF=true", () => {
    expect(() =>
      assertWriteCompliance(
        {
          rel: "manual/ai-reference/20_design/99_x.md",
          content: "short",
        },
        { ORICA_AI_WRITE_ADVISOR_OFF: "true" }
      )
    ).not.toThrow();
  });
});
