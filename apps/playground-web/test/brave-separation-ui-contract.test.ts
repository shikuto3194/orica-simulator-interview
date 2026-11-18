/**
 * ブレイヴ分離の維持コア HUD は、カード定義の引き直しではなく
 * 盤面上インスタンスの minimumRequiredCores を正源にする。
 *
 * Lv1 requiredCores=0 のブレイヴで definition fallback が 1 に倒れると、
 * HUD が「必要1」になりコア0分離を確定できなくなる。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BATTLE_SCREEN = readFileSync(
  resolve(__dirname, "../src/components/BattleScreen.tsx"),
  "utf8"
);

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = BATTLE_SCREEN.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = BATTLE_SCREEN.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return BATTLE_SCREEN.slice(start, end);
}

describe("ブレイヴ分離 UI の維持コア下限", () => {
  it("通常 brave_separate は CardInstance.minimumRequiredCores を HUD 下限に使う", () => {
    const block = sliceBetween(
      '} else if (a.kind === "brave_separate") {',
      "} else {"
    );

    expect(block).toContain("brave?.minimumRequiredCores ?? 0");
    expect(block).not.toContain("levelDefs?.[0]?.requiredCores ?? 1");
    expect(block).not.toContain("getDefinition(brave");
  });

  it("離脱時にブレイヴを残す選択も CardInstance.minimumRequiredCores を使う", () => {
    const block = sliceBetween(
      "const handleKeep = () => {",
      "const handleSend = () => {"
    );

    expect(block).toContain("brave.minimumRequiredCores");
    expect(block).not.toContain("levelDefs?.[0]?.requiredCores ?? 1");
  });
});
