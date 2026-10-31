import { expect, it } from "vitest";
import { createEmptyGameState } from "@orica/rules-core";
import { BattleReplayRecorder } from "../src/battleReplay";
import { parseReplayFile } from "../src/replayViewer";

it("starts a new recording when a room reset is approved, including a missed request update", async () => {
  const before = createEmptyGameState();
  const recorder = new BattleReplayRecorder();
  recorder.append(before);
  const restarted = {
    ...before,
    roomReset: { gameNumber: 1, requestedBy: null, usedBy: [] },
  };
  recorder.append(restarted);
  recorder.append({
    ...restarted,
    roomReset: { ...restarted.roomReset, requestedBy: "bob", usedBy: ["bob"] },
  });
  recorder.append({
    ...restarted,
    roomReset: { ...restarted.roomReset, usedBy: ["bob"] },
  });
  expect(recorder.frameCount).toBe(3);
  const replay = await parseReplayFile(await recorder.file("リセット後"), {
    getCardDefinitionById: () => undefined,
  });
  expect(replay.frames[0]?.state).toEqual(restarted);
});
