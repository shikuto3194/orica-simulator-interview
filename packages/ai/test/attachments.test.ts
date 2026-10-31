import { describe, expect, it } from "vitest";
import {
  buildAgentInputs,
  classifyAttachment,
} from "../src/server/attachments";

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("classifyAttachment", () => {
  it("classifies png as image", () => {
    const r = classifyAttachment({
      name: "icon.png",
      mimeType: "image/png",
      base64: "AAAA",
    });
    expect(r.kind).toBe("image");
    if (r.kind === "image") {
      expect(r.base64).toBe("AAAA");
      expect(r.mimeType).toBe("image/png");
    }
  });

  it("strips data url prefix from base64", () => {
    const r = classifyAttachment({
      name: "icon.png",
      base64: "data:image/png;base64,FAKEDATA==",
    });
    expect(r.kind).toBe("image");
    if (r.kind === "image") expect(r.base64).toBe("FAKEDATA==");
  });

  it("classifies markdown as text", () => {
    const r = classifyAttachment({
      name: "README.md",
      base64: toBase64("# hello\nworld"),
    });
    expect(r.kind).toBe("text");
    if (r.kind === "text") {
      expect(r.text).toContain("hello");
      expect(r.truncated).toBe(false);
    }
  });

  it("classifies typescript by extension when mime missing", () => {
    const r = classifyAttachment({
      name: "foo.ts",
      base64: toBase64("export const x = 1;"),
    });
    expect(r.kind).toBe("text");
  });

  it("classifies json with mime", () => {
    const r = classifyAttachment({
      name: "config.json",
      mimeType: "application/json",
      base64: toBase64('{"a":1}'),
    });
    expect(r.kind).toBe("text");
  });

  it("classifies Dockerfile (no extension) as text", () => {
    const r = classifyAttachment({
      name: "Dockerfile",
      base64: toBase64("FROM node:22"),
    });
    expect(r.kind).toBe("text");
  });

  it("rejects pdf as unsupported", () => {
    const r = classifyAttachment({
      name: "doc.pdf",
      mimeType: "application/pdf",
      base64: toBase64("dummy"),
    });
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") {
      expect(r.reason).toMatch(/application\/pdf/);
    }
  });

  it("rejects binary content despite text-like extension", () => {
    // mostly null bytes => looks binary
    const binary = String.fromCharCode(0).repeat(500);
    const r = classifyAttachment({
      name: "fake.txt",
      base64: toBase64(binary),
    });
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") {
      expect(r.reason).toMatch(/binary/i);
    }
  });

  it("truncates very long text", () => {
    const long = "x".repeat(200_000);
    const r = classifyAttachment(
      { name: "big.txt", base64: toBase64(long) },
      { maxTextChars: 1000 }
    );
    expect(r.kind).toBe("text");
    if (r.kind === "text") {
      expect(r.truncated).toBe(true);
      expect(r.originalChars).toBe(200_000);
      expect(r.text.length).toBeLessThan(1500);
    }
  });

  it("rejects empty / missing base64", () => {
    expect(classifyAttachment({ name: "x.txt" }).kind).toBe("unsupported");
    expect(classifyAttachment({ name: "x.txt", base64: "" }).kind).toBe(
      "unsupported"
    );
  });
});

describe("buildAgentInputs", () => {
  it("returns task unchanged when no attachments", () => {
    const r = buildAgentInputs("hello", []);
    expect(r.task).toBe("hello");
    expect(r.images).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it("collects images into images array", () => {
    const img = classifyAttachment({
      name: "a.png",
      mimeType: "image/png",
      base64: "AAA",
    });
    const r = buildAgentInputs("look", [img]);
    expect(r.images).toEqual(["AAA"]);
    expect(r.task).toBe("look");
  });

  it("embeds text attachments into task with fenced code block", () => {
    const txt = classifyAttachment({
      name: "note.md",
      base64: toBase64("# title\ncontent"),
    });
    const r = buildAgentInputs("要約して", [txt]);
    expect(r.task).toContain("# 添付ファイル: note.md");
    expect(r.task).toContain("```");
    expect(r.task).toContain("# title");
    expect(r.task).toContain("# 質問\n要約して");
    expect(r.images).toEqual([]);
  });

  it("uses fallback task when only attachments present", () => {
    const txt = classifyAttachment({
      name: "x.txt",
      base64: toBase64("body"),
    });
    const r = buildAgentInputs("", [txt]);
    expect(r.task).toContain("添付の内容を確認してください");
  });

  it("escapes backtick fences in content", () => {
    const content = "```\ncode with triple backtick fence\n```";
    const txt = classifyAttachment({
      name: "a.md",
      base64: toBase64(content),
    });
    const r = buildAgentInputs("ok", [txt]);
    // fence must be longer than any sequence in content
    expect(r.task).toContain("````");
  });

  it("collects unsupported as notices", () => {
    const pdf = classifyAttachment({
      name: "doc.pdf",
      mimeType: "application/pdf",
      base64: "AAAA",
    });
    const r = buildAgentInputs("see this", [pdf]);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]?.name).toBe("doc.pdf");
    expect(r.task).toBe("see this");
  });

  it("mixes images + text + unsupported in a single request", () => {
    const items = [
      classifyAttachment({
        name: "i.png",
        mimeType: "image/png",
        base64: "AAA",
      }),
      classifyAttachment({
        name: "n.md",
        base64: toBase64("# hi"),
      }),
      classifyAttachment({
        name: "z.zip",
        mimeType: "application/zip",
        base64: "ZZZ",
      }),
    ];
    const r = buildAgentInputs("explain all", items);
    expect(r.images).toEqual(["AAA"]);
    expect(r.task).toContain("# 添付ファイル: n.md");
    expect(r.task).toContain("# 質問\nexplain all");
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]?.name).toBe("z.zip");
  });
});
