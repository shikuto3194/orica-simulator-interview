import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/index";
import {
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getTotalCoresOnCardById,
  isSoulCoreOn,
  moveSoulCore,
} from "../src/index";

function createDemoSpiritDefinition(): CardDefinition {
  return {
    cardNo: "DEMO-SPIRIT-101",
    name: "Demo Spirit",
    printedCategory: "spirit",
    colors: ["red"] as const,
    cost: 3,
    reductionSymbols: ["red", "red"] as const,
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"] as const,
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C" as const,
  };
}

describe("P3-101 S2: moveSoulCore のロケーション別カウント一般化", () => {
  it("createEmptyGameState の playerOverrides は soulCoreLocation のみの指定でも対応する reserveSoulCoreCount 等を自動導出する", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    expect(state.players[0]!.reserveSoulCoreCount).toBe(1);
    expect(state.players[0]!.trashSoulCoreCount).toBe(0);
    expect(state.players[0]!.lifeSoulCoreCount).toBe(0);
    expect(collectGameStateInvariantIssues(state)).toEqual([]);
  });

  it("createEmptyGameState は soulCoreLocation:card 指定時に該当カードの soulCoreCount も同期する", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-soul-1",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "spirit-soul-1" } },
        {},
      ],
    });

    expect(
      state.cardInstances.find((c) => c.instanceId === "spirit-soul-1")!
        .soulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(state)).toEqual([]);
  });

  it("reserve → card への移動で旧 soulCoreLocation と新カウントフィールドが同時に更新される", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-1",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    const next = moveSoulCore(
      state,
      "player-1",
      { kind: "reserve", playerId: "player-1" },
      { kind: "card", instanceId: "spirit-1" }
    );

    expect(next.players[0]!.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "spirit-1",
    });
    expect(next.players[0]!.reserveSoulCoreCount).toBe(0);
    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-1")!.soulCoreCount
    ).toBe(1);
    expect(isSoulCoreOn(next, "spirit-1")).toBe(true);
    expect(getTotalCoresOnCardById(next, "spirit-1")).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("card → trash への移動でカードの soulCoreCount が 0 に戻り trashSoulCoreCount が 1 になる", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-2",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "spirit-2" } },
        {},
      ],
    });

    const next = moveSoulCore(
      state,
      "player-1",
      { kind: "card", instanceId: "spirit-2" },
      { kind: "trash", playerId: "player-1" }
    );

    expect(next.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
    expect(next.players[0]!.trashSoulCoreCount).toBe(1);
    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-2")!.soulCoreCount
    ).toBe(0);
    expect(isSoulCoreOn(next, "spirit-2")).toBe(false);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("moveSoulCore は amount 省略時デフォルト1で既存呼び出し元と同じ挙動を維持する (後方互換)", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    const next = moveSoulCore(
      state,
      "player-1",
      { kind: "reserve", playerId: "player-1" },
      { kind: "life", playerId: "player-1" }
    );

    expect(next.players[0]!.soulCoreLocation).toEqual({ kind: "life" });
    expect(next.players[0]!.lifeSoulCoreCount).toBe(1);
    expect(next.players[0]!.reserveSoulCoreCount).toBe(0);
  });

  it("所有者以外のプレイヤーは moveSoulCore で他人のソウルコアを動かせない", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    expect(() =>
      moveSoulCore(
        state,
        "player-2",
        { kind: "reserve", playerId: "player-1" },
        { kind: "trash", playerId: "player-2" }
      )
    ).toThrow("Soul core is not at the expected source");
  });

  it("invariant: player.soulCoreLocation=card だが該当カードの soulCoreCount が同期されていない場合を検知する", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-mismatch",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
    });
    const desynced = {
      ...state,
      players: state.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              soulCoreLocation: {
                kind: "card" as const,
                instanceId: "spirit-mismatch",
              },
            }
          : player
      ),
    };

    const issues = collectGameStateInvariantIssues(desynced);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "soul_core_count_location_mismatch" }),
      ])
    );
  });

  it("invariant: どのプレイヤーの soulCoreLocation からも参照されないカードの soulCoreCount>0 は追加ソウルとして許容する", () => {
    const definition = createDemoSpiritDefinition();
    const extraSoulCard = createCardInstance(definition, {
      instanceId: "spirit-extra-soul",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      soulCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [extraSoulCard] });

    expect(collectGameStateInvariantIssues(state)).toEqual([]);

    const next = moveSoulCore(
      state,
      "player-1",
      { kind: "card", instanceId: "spirit-extra-soul" },
      { kind: "reserve", playerId: "player-1" }
    );

    expect(next.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(next.players[0]!.reserveSoulCoreCount).toBe(1);
    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-extra-soul")!
        .soulCoreCount
    ).toBe(0);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });
});
