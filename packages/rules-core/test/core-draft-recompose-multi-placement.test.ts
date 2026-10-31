/**
 * P3-49 placement_multi: `recomposeMultiPlacement` のユニットテスト。
 *
 * GUI facade が複数 destination の placement draft から `multiPlacementAllocations`
 * を組み立てる際の集約ルール (per-destination / source 折り畳み) を検証する。
 */
import { describe, expect, it } from "vitest";
import { recomposeMultiPlacement } from "../src";
import type { DraftCoreMove } from "../src";

const ALICE = "player-1";

describe("P3-49: recomposeMultiPlacement", () => {
  it("単一 destination 1 件は { dest, [reserve_normal] } を 1 entry 返す", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "a" },
        amount: 1,
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "a",
        placements: [{ kind: "reserve_normal", amount: 1 }],
      },
    ]);
  });

  it("複数 destination は出現順に entry を返す", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "a" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "b" },
        amount: 2,
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations.length).toBe(2);
    expect(result.multiPlacementAllocations[0]?.destinationInstanceId).toBe(
      "a"
    );
    expect(result.multiPlacementAllocations[1]?.destinationInstanceId).toBe(
      "b"
    );
    expect(result.multiPlacementAllocations[1]?.placements).toEqual([
      { kind: "reserve_normal", amount: 2 },
    ]);
  });

  it("同 destination × 同 source の normal+soul を 1 entry に折り畳む (順序: normal 先 / soul 後)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "a" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "a" },
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "a",
        placements: [
          { kind: "reserve_normal", amount: 1 },
          { kind: "reserve_soul" },
        ],
      },
    ]);
  });

  it("カードソース placement (card_normal / card_soul) を出力", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "src1" },
        to: { kind: "card", instanceId: "a" },
        amount: 2,
        purpose: "placement",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "card", instanceId: "src1" },
        to: { kind: "card", instanceId: "a" },
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "a",
        placements: [
          { kind: "card_normal", instanceId: "src1", amount: 2 },
          { kind: "card_soul", instanceId: "src1" },
        ],
      },
    ]);
  });

  it("void source placement は void_normal を出力する (BSSL01-X01)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "void", playerId: ALICE },
        to: { kind: "card", instanceId: "token-a" },
        amount: 1,
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "token-a",
        placements: [{ kind: "void_normal", amount: 1 }],
      },
    ]);
  });

  it("trash source placement は trash_normal を出力する (BSSL01-C06)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "token-a" },
        amount: 1,
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "token-a",
        placements: [{ kind: "trash_normal", amount: 1 }],
      },
    ]);
  });

  it("trash soul placement は trash_soul を出力する (BSSL01-C06 generic core)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "token-a" },
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "token-a",
        placements: [{ kind: "trash_soul" }],
      },
    ]);
  });

  it("placement 以外の purpose (card_cost) は無視する", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 2,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "a" },
        amount: 1,
        purpose: "placement",
      },
    ];
    const result = recomposeMultiPlacement(drafts);
    expect(result.multiPlacementAllocations).toEqual([
      {
        destinationInstanceId: "a",
        placements: [{ kind: "reserve_normal", amount: 1 }],
      },
    ]);
  });

  it("placement の to が card 以外なら throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "placement",
      },
    ];
    expect(() => recomposeMultiPlacement(drafts)).toThrow(
      /placement draft must target a card/
    );
  });

  it("空入力は空 entry 配列を返す", () => {
    expect(recomposeMultiPlacement([])).toEqual({
      multiPlacementAllocations: [],
    });
  });
});
