import { describe, expect, it, vi } from "vitest";
import {
  INPUT_LIMITS,
  expandCardCounts,
  parseImportedDeck,
  parseStoredDeck,
  readDeckFile,
  validateDeckName,
  validateDisplayName,
} from "../src/input-validation";
import {
  normalizeCloudRows,
  upsertCloudDeck,
} from "../src/hooks/useCloudDecks";

vi.mock("../src/hooks/useDeckLibrary", () => ({ mutateDeckLibrary: vi.fn() }));
const lookup = new Map([
  [7, "CARD-7"],
  [8, "TOKEN-8"],
]);

describe("deck input boundaries before expansion or persistence", () => {
  it.each([1e12, Infinity, NaN, 1.5, 0, -1, "3", null])(
    "rejects count %s",
    (count) => {
      expect(() =>
        parseImportedDeck({ name: "test", cards: [{ id: 7, count }] }, lookup)
      ).toThrow();
      expect(() => expandCardCounts([{ cardNo: "CARD-7", count }])).toThrow();
    }
  );
  it("checks all entries and total, including duplicates and unknown IDs", () => {
    for (const cards of [
      [
        { id: 7, count: 600 },
        { id: 7, count: 401 },
      ],
      [{ id: 999, count: 1e12 }],
      Array.from({ length: 1001 }, () => ({ id: 7, count: 1 })),
    ])
      expect(() =>
        parseImportedDeck({ name: "test", cards }, lookup)
      ).toThrow();
    expect(() =>
      parseImportedDeck(
        JSON.parse('{"name":"test","cards":[{"id":7,"count":1e309}]}'),
        lookup
      )
    ).toThrow();
  });
  it("rejects malformed native decks, including tokens and names", () => {
    for (const deck of [
      { name: {}, cardNos: [] },
      { name: "test", cardNos: [7] },
      { name: "test", cardNos: Array(1001).fill("CARD-7") },
      {
        name: "test",
        cardNos: [],
        tokenDeck: [{ cardNo: "TOKEN-8", count: 1e12 }],
      },
      { name: "test", cardNos: [], tokenDeck: {} },
    ])
      expect(() => parseStoredDeck(deck)).toThrow();
  });
  it("reads both legacy token encodings and native decks at the bounds", () => {
    for (const tokens of [{ "8": 9 }, [{ id: 8, count: 9 }]]) {
      expect(
        parseImportedDeck(
          { name: "test", cards: [{ id: 7, count: 1000 }], tokenDeck: tokens },
          lookup
        )
      ).toEqual({
        name: "test",
        cardNos: Array(1000).fill("CARD-7"),
        tokenDeck: [{ cardNo: "TOKEN-8", count: 9 }],
      });
    }
    expect(
      parseStoredDeck({
        name: "test",
        cardNos: [],
        tokenDeck: [{ cardNo: "TOKEN-8", count: 1000 }],
      }).tokenDeck?.[0].count
    ).toBe(1000);
  });
  it("rejects oversized files before reading their contents", async () => {
    const text = vi.fn(async () => "{}");
    await expect(
      readDeckFile({ size: INPUT_LIMITS.importBytes + 1, text }, lookup)
    ).rejects.toThrow("1MiB");
    expect(text).not.toHaveBeenCalled();
  });
  it("skips invalid cloud decks visibly before expansion and preserves good rows", () => {
    const result = normalizeCloudRows([
      { id: "bad", name: "bad", cards: [{ id: 7, count: 1e12 }] },
      { id: "good", name: "good", cards: [{ id: 7, count: 3 }] },
    ]);
    expect(result.error).toContain("読み込めません");
    expect(result.rows.map((row) => row.id)).toEqual(["good"]);
  });
  it("validates again at the cloud save boundary", async () => {
    const { mutateDeckLibrary } = await import("../src/hooks/useDeckLibrary");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await upsertCloudDeck(
          "user",
          { name: "x".repeat(101), cardNos: [] },
          [],
          "scope"
        )
      ).toBe(false);
      expect(mutateDeckLibrary).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("plain text names", () => {
  it("matches PostgreSQL Unicode character counts and preserves markup as data", () => {
    expect(validateDisplayName("😀".repeat(30))).toBe("😀".repeat(30));
    expect(() => validateDisplayName("😀".repeat(31))).toThrow();
    expect(validateDeckName("😀".repeat(100))).toBe("😀".repeat(100));
    expect(() => validateDeckName("😀".repeat(101))).toThrow();
    expect(validateDeckName("<img src=x onerror=alert(1)>")).toBe(
      "<img src=x onerror=alert(1)>"
    );
    expect(validateDisplayName("O'Brien <3")).toBe("O'Brien <3");
    expect(() => validateDeckName("   ")).toThrow();
  });
});
