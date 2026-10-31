import { describe, expect, it } from "vitest";
import {
  CARD_COLORS,
  countUniqueColors,
  matchesColorCount,
} from "../src/model";
import type { CardColor } from "../src/model";

describe("CARD_COLORS", () => {
  it("should contain exactly 7 colors", () => {
    expect(CARD_COLORS).toHaveLength(7);
  });

  it("should include black", () => {
    expect(CARD_COLORS).toContain("black");
  });
});

describe("countUniqueColors", () => {
  it("empty array returns 0", () => {
    expect(countUniqueColors([])).toBe(0);
  });

  it("single color returns 1", () => {
    expect(countUniqueColors(["red"])).toBe(1);
  });

  it("duplicate colors are counted once", () => {
    expect(countUniqueColors(["red", "red", "blue"])).toBe(2);
  });

  it("all 7 colors returns 7 (七色)", () => {
    expect(countUniqueColors([...CARD_COLORS])).toBe(7);
  });

  it("6 of 7 colors returns 6 (六色)", () => {
    const sixColors: CardColor[] = [
      "red",
      "purple",
      "green",
      "white",
      "yellow",
      "blue",
    ];
    expect(countUniqueColors(sixColors)).toBe(6);
  });
});

describe("matchesColorCount", () => {
  const sixColors: CardColor[] = [
    "red",
    "purple",
    "green",
    "white",
    "yellow",
    "blue",
  ];
  const sevenColors: CardColor[] = [...CARD_COLORS];
  const threeColors: CardColor[] = ["red", "purple", "green"];

  describe("at least N (min only)", () => {
    it("六色以上: 6 colors matches min:6", () => {
      expect(matchesColorCount(sixColors, 6)).toBe(true);
    });

    it("六色以上: 7 colors matches min:6", () => {
      expect(matchesColorCount(sevenColors, 6)).toBe(true);
    });

    it("六色以上: 3 colors does not match min:6", () => {
      expect(matchesColorCount(threeColors, 6)).toBe(false);
    });

    it("七色: 7 colors matches min:7", () => {
      expect(matchesColorCount(sevenColors, 7)).toBe(true);
    });

    it("七色: 6 colors does not match min:7", () => {
      expect(matchesColorCount(sixColors, 7)).toBe(false);
    });
  });

  describe("exactly N (min === max)", () => {
    it("ちょうど六色: 6 colors matches min:6,max:6", () => {
      expect(matchesColorCount(sixColors, 6, 6)).toBe(true);
    });

    it("ちょうど六色: 7 colors does NOT match min:6,max:6", () => {
      expect(matchesColorCount(sevenColors, 6, 6)).toBe(false);
    });

    it("ちょうど六色: 3 colors does NOT match min:6,max:6", () => {
      expect(matchesColorCount(threeColors, 6, 6)).toBe(false);
    });
  });

  describe("at most N (max only)", () => {
    it("3 colors matches max:6", () => {
      expect(matchesColorCount(threeColors, undefined, 6)).toBe(true);
    });

    it("7 colors does NOT match max:6", () => {
      expect(matchesColorCount(sevenColors, undefined, 6)).toBe(false);
    });
  });

  describe("no constraints", () => {
    it("always matches when neither min nor max", () => {
      expect(matchesColorCount([], undefined, undefined)).toBe(true);
      expect(matchesColorCount(sevenColors, undefined, undefined)).toBe(true);
    });
  });

  describe("real card patterns", () => {
    it("2色以上 condition", () => {
      expect(matchesColorCount(["red", "blue"], 2)).toBe(true);
      expect(matchesColorCount(["red"], 2)).toBe(false);
    });

    it("5色以上 condition", () => {
      const fiveColors: CardColor[] = [
        "red",
        "purple",
        "green",
        "white",
        "yellow",
      ];
      expect(matchesColorCount(fiveColors, 5)).toBe(true);
      expect(matchesColorCount(["red", "purple", "green", "white"], 5)).toBe(
        false
      );
    });

    it("7色以上 condition (includes exactly 7)", () => {
      expect(matchesColorCount(sevenColors, 7)).toBe(true);
      expect(matchesColorCount(sixColors, 7)).toBe(false);
    });
  });
});
