import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("原文変換は表裏の複合1個と独立2個を区別する", () => {
  const root = mkdtempSync(join(tmpdir(), "orica-raw-symbol-"));
  try {
    const scripts = join(root, "scripts");
    mkdirSync(scripts);
    mkdirSync(join(root, "raw"));
    const converter = join(scripts, "convert-raw.ts");
    copyFileSync(
      resolve("packages/card-data/scripts/convert-raw.ts"),
      converter
    );
    const raw = [
      {
        id: 1,
        cardNumber: "TEST-C01",
        name: "複合",
        pack: "TEST",
        symbol: ["黄導"],
        type: "契約ネクサス",
      },
      {
        id: 2,
        cardNumber: "TEST-C02",
        name: "独立",
        pack: "TEST",
        symbol: ["黄", "導"],
        type: "ネクサス",
      },
      {
        id: 3,
        isDoubleSided: true,
        front: {
          cardNumber: "TEST-C03",
          name: "表",
          pack: "TEST",
          type: "ネクサス",
          symbol: ["黄導"],
        },
        back: {
          cardNumber: "TEST-C03B",
          name: "裏",
          pack: "TEST",
          type: "ネクサス",
          symbol: ["白導"],
        },
      },
    ];
    writeFileSync(
      join(root, "raw/cardData.js"),
      `const cardData = ${JSON.stringify(raw)};\nexport default cardData;`
    );
    execFileSync(process.execPath, ["--experimental-strip-types", converter], {
      stdio: "pipe",
    });
    const output = readFileSync(join(root, "src/cards/TEST.ts"), "utf8");
    const cards = JSON.parse(
      output
        .slice(output.indexOf(" = ") + 3)
        .trim()
        .replace(/;$/, "")
    );
    expect(cards[0].symbolColors).toEqual(["yellow", "guide"]);
    expect(cards[0].symbolColorEntries).toEqual([["yellow", "guide"]]);
    expect(cards[1].symbolColors).toEqual(["yellow", "guide"]);
    expect(cards[1].symbolColorEntries).toBeUndefined();
    expect(cards[2].symbolColorEntries).toEqual([["yellow", "guide"]]);
    expect(cards[2].backFace.symbolColorEntries).toEqual([["white", "guide"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
