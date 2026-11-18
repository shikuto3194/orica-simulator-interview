import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { advanceStep } from "../src/turn-system";
import type { CardDefinition, GameState } from "../src/model";

const definition: CardDefinition = {
  cardNo: "LOG-DELTA-NEXUS",
  name: "配置ログ回帰用ネクサス",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

function stateWithLog(log: string[]): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "placed",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    }),
    turnNumber: 4,
    step: "draw",
    log,
  };
}

const markers = [
  { log: "effect:field_place:deck_reveal:alice:placed", kind: "place" },
  { log: "effect:field_put:effect:alice:placed", kind: "put" },
  {
    log: "effect:core_move:soul_drive_activated:alice",
    kind: "soul_drive_activated",
  },
] as const;

describe("誘発収集は今回追加されたログだけを読む", () => {
  it.each(markers)(
    "共有・コピーされた過去の $kind を再発火しない",
    ({ log }) => {
      const before = stateWithLog([log]);
      for (const after of [
        before,
        { ...before },
        { ...before, log: [...before.log] },
      ]) {
        expect(
          collectTriggerEventsFromStateDelta({
            beforeState: before,
            afterState: after,
            source: "step_transition",
          })
        ).toEqual([]);
      }
    }
  );

  it.each(markers)("新しい $kind のログは1回検出する", ({ log, kind }) => {
    const before = stateWithLog([log]);
    const after = { ...before, log: [...before.log, log] };
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: before,
        afterState: after,
        source: "action_resolution",
      }).filter((event) => event.eventKind === kind)
    ).toHaveLength(1);
  });

  it("過去の配置ログがあってもリフレッシュで空バーストを作らない", () => {
    const before = stateWithLog([markers[0].log]);
    // 旧GUIと同じ登録省略経路でも、過去イベント自体を生成してはいけない。
    const after = advanceStep(
      before,
      () => definition,
      () => undefined
    );
    expect(after.step).toBe("refresh");
    expect(after.pendingBurstChecks).toEqual([]);
    expect(after.pendingTriggeredEffects).toEqual([]);
    expect(after.cardInstances).toEqual(before.cardInstances);
  });
});
