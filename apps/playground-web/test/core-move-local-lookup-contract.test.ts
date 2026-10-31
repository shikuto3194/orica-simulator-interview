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

describe("manual core move local projection lookup contract", () => {
  it("threads definitions through core selection preview and local commit", () => {
    expect(BATTLE_SCREEN).toContain(
      "const coreSelection = useCoreSelection(state, getDefinition);"
    );

    const exitCoreMoveMode = sliceBetween(
      "const exitCoreMoveMode = useCallback(() => {",
      "setCoreMoveFrom(null);"
    );

    expect(exitCoreMoveMode).toContain(
      "let newState = applyDraftCoreMoves(state, drafts, getDefinition);"
    );
    expect(exitCoreMoveMode).toContain(
      "newState = flushPendingLeaves(sbaResult.state, getDefinition);"
    );
    expect(exitCoreMoveMode).not.toContain(
      "let newState = applyDraftCoreMoves(state, drafts);"
    );
    expect(exitCoreMoveMode).not.toContain(
      "newState = flushPendingLeaves(sbaResult.state);"
    );
  });
});
