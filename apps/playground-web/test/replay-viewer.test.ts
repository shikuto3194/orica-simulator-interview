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
