import { describe, expect, it } from "vitest";
import {
  createGameSnapshot,
  initializeGame,
  type CardDefinition,
} from "@orica/rules-core";
import {
  parseReplayFile,
  parseReplayJson,
  resolveReplayFrameState,
} from "../src/replayViewer";

const testCard: CardDefinition = {
  cardNo: "TEST-REPLAY-CARD",
  name: "Replay Test Card",
  colors: ["red"],
  symbolColors: ["red"],
  cost: 1,
  reduction: [],
  reductionSymbols: [],
  category: "spirit",
  printedCategory: "spirit",
  bp: 1000,
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  keywordTags: [],
  effects: [],
};

function testDeck(): CardDefinition[] {
  return Array.from({ length: 40 }, () => testCard);
}

function makeState() {
  return initializeGame({
    decks: [testDeck(), testDeck()],
    skipPreGame: true,
    allowUnavailableDeckCards: true,
  });
}

function getCardDefinitionById(id: string): CardDefinition | undefined {
  return id === testCard.cardNo ? testCard : undefined;
}

describe("parseReplayJson", () => {
  it("parses frame-wrapped GameState entries with trace metadata", () => {
    const state = makeState();
    const replay = parseReplayJson(
      {
        title: "training trace",
        frames: [
          {
            label: "main step choice",
            state,
            traceEntry: {
              step: 12,
              actionKind: "advance_step",
              choiceId: "choice-12",
            },
          },
        ],
      },
      { getCardDefinitionById }
    );

    expect(replay.title).toBe("training trace");
    expect(replay.frames).toHaveLength(1);
    expect(replay.frames[0]).toMatchObject({
      label: "main step choice",
      step: 12,
      actionKind: "advance_step",
      choiceId: "choice-12",
    });
    expect(replay.frames[0]!.state?.turnNumber).toBe(state.turnNumber);
  });

  it("restores GameSnapshot entries", () => {
    const state = makeState();
    const snapshot = createGameSnapshot(state, {
      label: "snapshot frame",
      nowIso: "2026-08-11T00:00:00.000Z",
    });

    const replay = parseReplayJson(
      { snapshots: [snapshot] },
      { getCardDefinitionById }
    );

    expect(replay.frames).toHaveLength(1);
    expect(replay.frames[0]!.label).toBe("snapshot frame");
    expect(replay.frames[0]!.state?.players).toHaveLength(2);
    expect(replay.warnings).toEqual([]);
  });

  it("parses line-delimited replay files lazily", async () => {
    const state = makeState();
    const file = new File(
      [
        `${JSON.stringify({ schemaVersion: 1, title: "training trace jsonl" })}\n`,
        `${JSON.stringify({
          label: "main step choice",
          state,
          traceEntry: {
            step: 12,
            actionKind: "advance_step",
            choiceId: "choice-12",
          },
        })}\n`,
      ],
      "trace.replay.jsonl",
      { type: "application/x-ndjson" }
    );

    const replay = await parseReplayFile(file, { getCardDefinitionById });

    expect(replay.title).toBe("training trace jsonl");
    expect(replay.frames).toHaveLength(1);
    expect(replay.frames[0]).toMatchObject({
      label: "main step choice",
      step: 12,
      actionKind: "advance_step",
      choiceId: "choice-12",
    });
    expect(replay.frames[0]!.state).toBeUndefined();

    const resolved = resolveReplayFrameState(replay.frames[0]!, {
      getCardDefinitionById,
    });
    expect(resolved.state.turnNumber).toBe(state.turnNumber);
    expect(replay.frames[0]!.state?.turnNumber).toBe(state.turnNumber);
  });

  it("rejects JSON without replay frames", () => {
    expect(() =>
      parseReplayJson({ title: "empty" }, { getCardDefinitionById })
    ).toThrow("frames / states / snapshots");
  });
});

describe("旧形式の使用会計を持つ棋譜 (P3-170)", () => {
  const legacyState = (extra: Record<string, unknown>) => {
    const state = JSON.parse(JSON.stringify(makeState())) as Record<
      string,
      unknown
    >;
    delete state.effectAccounting;
    delete state.stepOrdinalThisTurn;
    return { ...state, ...extra };
  };

  it("使用済みの旧データが空の snapshot は定義なしの変換で読める", () => {
    const snapshot = {
      schemaVersion: 3,
      savedAt: "2026-11-07T00:00:00.000Z",
      state: legacyState({
        effectUsageRecords: [],
        usedDivineSkillKeysThisTurn: [],
      }),
    };
    const replay = parseReplayJson(snapshot, { getCardDefinitionById });
    expect(replay.frames[0]?.state?.effectAccounting.version).toBe(1);
  });

  it("遅延 parse する JSONL の frame も、変換できない旧データは描画前の読込時に理由つきで拒否する", async () => {
    const bad = legacyState({ usedDivineSkillKeysThisTurn: ["garbage"] });
    const file = new File(
      [
        `${JSON.stringify({ schemaVersion: 1, title: "legacy jsonl" })}
`,
        `${JSON.stringify({ label: "ok", state: makeState() })}
`,
        `${JSON.stringify({ label: "bad", state: bad })}
`,
      ],
      "legacy.replay.jsonl",
      { type: "application/x-ndjson" }
    );
    await expect(
      parseReplayFile(file, { getCardDefinitionById })
    ).rejects.toThrow(
      /usage_accounting_migration_failed.*usedDivineSkillKeysThisTurn\[0\]/
    );
  });

  it("変換できる旧形式の JSONL frame は遅延 parse のまま読め、復元時に新形式へ移行される", async () => {
    const file = new File(
      [
        `${JSON.stringify({
          label: "legacy",
          state: legacyState({ effectUsageRecords: [] }),
        })}
`,
      ],
      "legacy-ok.replay.jsonl",
      { type: "application/x-ndjson" }
    );
    const replay = await parseReplayFile(file, { getCardDefinitionById });
    expect(replay.frames[0]!.state).toBeUndefined();
    const resolved = resolveReplayFrameState(replay.frames[0]!, {
      getCardDefinitionById,
    });
    expect(resolved.state.effectAccounting.version).toBe(1);
  });

  it("変換できない旧データの snapshot / 生 state は、握りつぶさず理由 (code と path) つきで拒否する", () => {
    const bad = legacyState({ usedDivineSkillKeysThisTurn: ["garbage"] });
    expect(() =>
      parseReplayJson(
        { schemaVersion: 3, savedAt: "2026-11-07T00:00:00.000Z", state: bad },
        { getCardDefinitionById }
      )
    ).toThrow(
      /usage_accounting_migration_failed.*usedDivineSkillKeysThisTurn\[0\]/
    );
    expect(() =>
      parseReplayJson({ frames: [{ state: bad }] }, { getCardDefinitionById })
    ).toThrow(
      /usage_accounting_migration_failed.*usedDivineSkillKeysThisTurn\[0\]/
    );
  });
});
