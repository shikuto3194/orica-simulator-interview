/**
 * 旧形式 fixture (fixtures/legacy-effect-usage/*.json) が test/helpers/legacy-effect-usage-states.ts の
 * 定義と一致していることを検査する。UPDATE_LEGACY_FIXTURES=1 で書き出す。
 * real-*.json は旧コードで作った実スナップショット (旧 HEAD の fixture をそのまま保存) で、定義を持たない。
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGACY_FIXTURES,
  legacyFixtureJson,
} from "./helpers/legacy-effect-usage-states";

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "legacy-effect-usage"
);

describe("旧形式 fixture の定義との一致", () => {
  for (const name of Object.keys(LEGACY_FIXTURES)) {
    it(`${name}.json は定義から生成した内容と一致する`, () => {
      const path = join(DIR, `${name}.json`);
      const expected = JSON.stringify(legacyFixtureJson(name), null, 1) + "\n";
      if (process.env.UPDATE_LEGACY_FIXTURES === "1") {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(path, expected);
      }
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(expected);
    });
  }
});
