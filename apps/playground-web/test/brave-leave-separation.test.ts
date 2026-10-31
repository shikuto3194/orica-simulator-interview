import { beforeEach, describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { SCENARIOS } from "../src/scenarios";
import {
  __initializeGameApiLookupsForTest,
  replayBraveSeparationEvent,
} from "../server/game-api";

describe("ルームのブレイヴ分離と離脱時の残留", () => {
  beforeEach(async () => {
    await __initializeGameApiLookupsForTest(ALL_CARDS);
  });

  it("残す選択を受け付け、リザーブのコアを残るブレイヴへ移す", () => {
    const state = SCENARIOS["brave-leave-choice"]!.build(ALL_CARDS);
    const reserveBefore = state.players[0]!.reserveNormalCoreCount;
    const next = replayBraveSeparationEvent(state, "alice", {
      actionId: "brave-leave-keep-sc-leave-host",
      separateCoreDistribution: { reserve: 1 },
    });
    expect(next.pendingBraveLeaveChoice).toBeNull();
    expect(
      next.cardInstances.find((card) => card.instanceId === "sc-leave-brave")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      normalCoreCount: 2,
    });
    expect(next.players[0]!.reserveNormalCoreCount).toBe(reserveBefore - 1);
    expect(
      state.cardInstances.find((card) => card.instanceId === "sc-leave-brave")!
        .attachedToInstanceId
    ).toBe("sc-leave-host");
  });

  it("同行選択はコア配置のリクエストとして受け付けない", () => {
    const state = SCENARIOS["brave-leave-choice"]!.build(ALL_CARDS);
    expect(() =>
      replayBraveSeparationEvent(state, "alice", {
        actionId: "brave-leave-send-sc-leave-host",
        separateCoreDistribution: { reserve: 1 },
      })
    ).toThrow();
  });
});
