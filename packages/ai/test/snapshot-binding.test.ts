import { describe, expect, it } from "vitest";
import {
  detectSnapshotAttachment,
  type ClassifiedAttachment,
} from "../src/server/attachments";
import { buildDefaultRegistry } from "../src/tools/registry";
import { makeInspectGameStateTool } from "../src/tools/game-state";
import { makeLegalActionsTool } from "../src/tools/legal-actions";

function textAttach(
  name: string,
  mime: string,
  text: string
): ClassifiedAttachment {
  return {
    name,
    kind: "text",
    mimeType: mime,
    text,
    originalChars: text.length,
    truncated: false,
  };
}

describe("detectSnapshotAttachment", () => {
  it("detects file named orica-snapshot-*.json even without players key", () => {
    const detected = detectSnapshotAttachment([
      textAttach(
        "orica-snapshot-2026-05-13.json",
        "application/json",
        '{"version":1}'
      ),
    ]);
    expect(detected).not.toBeNull();
    expect(detected!.index).toBe(0);
    expect(detected!.sourceName).toBe("orica-snapshot-2026-05-13.json");
  });

  it("detects any *.json with top-level players key", () => {
    const detected = detectSnapshotAttachment([
      textAttach("my-game.json", "application/json", '{"players":{"self":{}}}'),
    ]);
    expect(detected).not.toBeNull();
  });

  it("ignores non-text attachments", () => {
    const detected = detectSnapshotAttachment([
      { name: "x.png", kind: "image", mimeType: "image/png", base64: "abc" },
    ]);
    expect(detected).toBeNull();
  });

  it("ignores .txt files even with players key", () => {
    const detected = detectSnapshotAttachment([
      textAttach("notes.txt", "text/plain", '{"players":{}}'),
    ]);
    expect(detected).toBeNull();
  });

  it("ignores malformed JSON", () => {
    const detected = detectSnapshotAttachment([
      textAttach("orica-snapshot-x.json", "application/json", "{not json"),
    ]);
    expect(detected).toBeNull();
  });

  it("picks the first snapshot when multiple JSONs are attached", () => {
    const detected = detectSnapshotAttachment([
      textAttach("config.json", "application/json", '{"foo":1}'),
      textAttach("orica-snapshot-a.json", "application/json", "{}"),
      textAttach("orica-snapshot-b.json", "application/json", "{}"),
    ]);
    expect(detected).not.toBeNull();
    expect(detected!.sourceName).toBe("orica-snapshot-a.json");
  });
});

describe("inspect_game_state with bound snapshot", () => {
  const sampleSnapshot = { players: { self: { hand: [], field: [] } } };

  it("uses bound snapshot when no arg is given", async () => {
    const tool = makeInspectGameStateTool({ boundSnapshot: sampleSnapshot });
    const result = await tool.execute({ query: { kind: "raw" } });
    expect(result.text).toContain("players");
  });

  it("arg snapshot overrides bound", async () => {
    const tool = makeInspectGameStateTool({ boundSnapshot: sampleSnapshot });
    const result = await tool.execute({
      snapshot: { custom: 42 },
      query: { kind: "raw" },
    });
    expect(result.text).toContain("custom");
    expect(result.text).toContain("42");
  });

  it("throws when neither arg nor bound is available", async () => {
    const tool = makeInspectGameStateTool();
    await expect(tool.execute({ query: { kind: "raw" } })).rejects.toThrow(
      /snapshot is required/
    );
  });

  it("description mentions bound state when snapshot is bound", () => {
    const tool = makeInspectGameStateTool({ boundSnapshot: sampleSnapshot });
    expect(tool.description).toContain("セッションに紐付");
  });
});

describe("legal_actions with bound snapshot", () => {
  const sampleSnapshot = { players: {} };

  it("uses bound snapshot when no arg is given", async () => {
    const tool = makeLegalActionsTool({ boundSnapshot: sampleSnapshot });
    const result = await tool.execute({});
    // count may be 0 (no listLegalActions exposed by rules-core in this path),
    // but no throw means bound was used
    expect(typeof result.count).toBe("number");
  });

  it("throws when neither arg nor bound is available", async () => {
    const tool = makeLegalActionsTool();
    await expect(tool.execute({})).rejects.toThrow(/snapshot is required/);
  });
});

describe("buildDefaultRegistry threads boundSnapshot into snapshot tools", () => {
  it("makes inspect_game_state callable without snapshot arg when boundSnapshot is set", async () => {
    const reg = buildDefaultRegistry({
      env: {},
      boundSnapshot: { players: { self: {} } },
    });
    const tool = reg.get("inspect_game_state");
    expect(tool).toBeDefined();
    const result = (await tool!.execute({ query: { kind: "raw" } })) as {
      text: string;
    };
    expect(result.text).toContain("players");
  });
});
