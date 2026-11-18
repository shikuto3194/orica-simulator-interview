import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVATARS, avatarFullBodySrc } from "../src/avatars";
import { isPublicMedia } from "../server/public-build";

describe("home avatar assets", () => {
  it("ships a full-body image for every selectable avatar", () => {
    for (const avatar of AVATARS) {
      const file = avatarFullBodySrc(avatar.id).slice(1);
      expect(existsSync(file), file).toBe(true);
      expect(isPublicMedia(file), file).toBe(true);
      expect(avatar.epithet.length).toBeGreaterThan(0);
    }
  });
  it("falls back for old or invalid profile IDs and keeps review material private", () => {
    for (const id of [undefined, null, "", "unknown", "../../private"]) {
      expect(avatarFullBodySrc(id)).toBe(avatarFullBodySrc("reimu"));
    }
    for (const file of [
      "review.html",
      "README.md",
      "prompts/satori.md",
      "unknown.webp",
      "satori.png",
    ]) {
      expect(isPublicMedia(`images/avater/fullbody/${file}`)).toBe(false);
    }
  });
});
