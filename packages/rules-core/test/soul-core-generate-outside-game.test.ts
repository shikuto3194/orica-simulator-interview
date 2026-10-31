import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/index";
import {
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  generateSoulCoreOutsideGame,
  moveSoulCore,
  withSoulCoreLocation,
} from "../src/index";

function createDemoSpiritDefinition(): CardDefinition {
  return {
    cardNo: "DEMO-SPIRIT-102",
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

describe("generateSoulCoreOutsideGame: ゲーム外からのソウルコア新規生成 (BSLH01-C05/R03)", () => {
  it("soulCoreLocation が null のとき、生成したソウルがそのまま primary ポインタになる", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: null }, {}],
    });

    const next = generateSoulCoreOutsideGame(state, "player-1", {
      kind: "reserve",
      playerId: "player-1",
    });

    expect(next.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(next.players[0]!.reserveSoulCoreCount).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("primary が既に別ロケーションにあるとき、生成した追加ソウルは primary ポインタを書き換えずカウントのみ増える", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-1",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "spirit-1" } },
        {},
      ],
    });

    const next = generateSoulCoreOutsideGame(state, "player-1", {
      kind: "reserve",
      playerId: "player-1",
    });

    expect(next.players[0]!.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "spirit-1",
    });
    expect(next.players[0]!.reserveSoulCoreCount).toBe(1);
    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-1")!.soulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("既に primary が reserve にあるとき、追加生成で reserveSoulCoreCount が 2 になる", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    const next = generateSoulCoreOutsideGame(state, "player-1", {
      kind: "reserve",
      playerId: "player-1",
    });

    expect(next.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(next.players[0]!.reserveSoulCoreCount).toBe(2);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("追加ソウル生成後、moveSoulCore で追加ソウル側を動かしても primary ポインタは書き換わらない (card 上の primary が誤って離脱扱いにならない)", () => {
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

    const withExtra = generateSoulCoreOutsideGame(state, "player-1", {
      kind: "reserve",
      playerId: "player-1",
    });

    const moved = moveSoulCore(
      withExtra,
      "player-1",
      { kind: "reserve", playerId: "player-1" },
      { kind: "trash", playerId: "player-1" }
    );

    expect(moved.players[0]!.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "spirit-2",
    });
    expect(moved.players[0]!.reserveSoulCoreCount).toBe(0);
    expect(moved.players[0]!.trashSoulCoreCount).toBe(1);
    expect(
      moved.cardInstances.find((c) => c.instanceId === "spirit-2")!
        .soulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(moved)).toEqual([]);
  });

  it("追加ソウル生成後、withSoulCoreLocation (primary ソウル移動の本番経路) が追加ソウルのカウントを消さない (adversarial verifier round1 repro)", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-3",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "spirit-3" } },
        {},
      ],
    });

    // 追加ソウルを reserve に生成 (primary は card 上のまま)。
    const withExtra = generateSoulCoreOutsideGame(state, "player-1", {
      kind: "reserve",
      playerId: "player-1",
    });
    expect(withExtra.players[0]!.reserveSoulCoreCount).toBe(1);

    // withSoulCoreLocation は primary ソウル移動 (structured-core-move.ts 等、本番14箇所超)
    // の本体。card → reserve へ primary を移動しても、既存の追加ソウル分は消えず加算される。
    const after = withSoulCoreLocation(withExtra, "player-1", {
      kind: "reserve",
    });

    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(after.players[0]!.reserveSoulCoreCount).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "spirit-3")!
        .soulCoreCount
    ).toBe(0);
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });

  it("生成先が自分以外のプレイヤーの reserve を指すと throw する", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });

    expect(() =>
      generateSoulCoreOutsideGame(state, "player-1", {
        kind: "reserve",
        playerId: "player-2",
      })
    ).toThrow("Soul core generation target belongs to a different player");
  });
});
