import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/index";
import {
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  withSoulCoreLocation,
} from "../src/index";

/**
 * P3-101 S3-prep: `withSoulCoreLocation` は post-construction で
 * `player.soulCoreLocation` を書き換える既存テストの「cardInstances/players 後付け
 * spread」パターンが `CardInstance.soulCoreCount` 等のカウントフィールドを未同期のまま
 * 残す問題（S3 の isSoulCoreOn/getTotalCoresOnCardById SSOT 切替を阻んでいた原因）を
 * 解消する構築補助。ここでは同期が正しく行われ、既存の
 * `collectGameStateInvariantIssues`（soul_core_count_location_mismatch）を
 * 一切トリガーしないことを検証する。
 */
function createDemoSpiritDefinition(): CardDefinition {
  return {
    cardNo: "DEMO-SPIRIT-S3PREP",
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

describe("P3-101 S3-prep: withSoulCoreLocation", () => {
  it("null → card への設定でカードの soulCoreCount が同期され invariant 違反が出ない", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      instanceId: "spirit-1",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [card] });

    const next = withSoulCoreLocation(state, "player-1", {
      kind: "card",
      instanceId: "spirit-1",
    });

    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-1")!.soulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("card A → card B の付け替えで A が減り B が増える", () => {
    const definition = createDemoSpiritDefinition();
    const cardA = createCardInstance(definition, {
      instanceId: "spirit-a",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const cardB = createCardInstance(definition, {
      instanceId: "spirit-b",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [cardA, cardB],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "spirit-a" } },
        {},
      ],
    });

    const next = withSoulCoreLocation(state, "player-1", {
      kind: "card",
      instanceId: "spirit-b",
    });

    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-a")!.soulCoreCount
    ).toBe(0);
    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-b")!.soulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("card → reserve への付け替えでカードの soulCoreCount が減り reserveSoulCoreCount が立つ", () => {
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

    const next = withSoulCoreLocation(state, "player-1", { kind: "reserve" });

    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-1")!.soulCoreCount
    ).toBe(0);
    expect(
      next.players.find((p) => p.id === "player-1")!.reserveSoulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("同じ場所への再設定は冪等 (二重加算しない)", () => {
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

    const next = withSoulCoreLocation(state, "player-1", {
      kind: "card",
      instanceId: "spirit-1",
    });

    expect(
      next.cardInstances.find((c) => c.instanceId === "spirit-1")!.soulCoreCount
    ).toBe(1);
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });
});
