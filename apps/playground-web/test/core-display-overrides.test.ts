/**
 * `computeSoulCoreDisplayOverrides` の単体テスト。
 *
 * 背景: 効果 (フランドール【フォーオブアカインド】等の any_movable_self コア配分) で
 * トラッシュ / ライフのソウルコアを掴んだとき、ソース表示からソウルが消えなかった
 * バグ (held buffer ループが reserve / card しか見ていなかった)。
 * 通常コアの coreDisplayOverrides は 4 ソース対応済だったため、ソウルだけ非対称だった。
 *
 * 仕様: manual/ai-reference/25_gui/11_core-selection-hud.md
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  type GameState,
  type PlayerScopedSoulCoreLocation,
} from "@orica/rules-core";
import type { HeldCoreEntry } from "../src/coreSelectionFacade";
import {
  coreContainerDisplayKey,
  computeCoreDisplayOverrides,
  computeSoulCoreDisplayOverrides,
  resolveSoulCoreDisplayCount,
} from "../src/coreDisplayOverrides";

function makeState(
  aliceSoul: PlayerScopedSoulCoreLocation = { kind: "reserve" },
  aliceTrashCores = 0,
  aliceSoulCounts: {
    reserve?: number;
    trash?: number;
    life?: number;
  } = {}
): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        soulCoreLocation: aliceSoul,
        trashNormalCoreCount: aliceTrashCores,
        reserveSoulCoreCount: aliceSoulCounts.reserve,
        trashSoulCoreCount: aliceSoulCounts.trash,
        lifeSoulCoreCount: aliceSoulCounts.life,
      },
      { soulCoreLocation: { kind: "reserve" } },
    ],
    startingVoidNormalCoreCount: 0,
  });
}

const soulHeld = (
  from: HeldCoreEntry["from"],
  playerId = "alice"
): HeldCoreEntry => ({ kind: "soul", from, playerId });

describe("computeSoulCoreDisplayOverrides — held grab phase", () => {
  it("非アクティブ時は undefined", () => {
    const state = makeState({ kind: "trash" }, 2);
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: false,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "trash", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toBeUndefined();
  });

  it("掴み無し・draft 無しなら undefined", () => {
    const state = makeState({ kind: "trash" }, 2);
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toBeUndefined();
  });

  // ★ 報告バグ: トラッシュのソウルを掴むとトラッシュ表示を実数で減算
  it("トラッシュのソウルを掴むと { trash: 0 }", () => {
    const state = makeState({ kind: "trash" }, 2);
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "trash", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ trash: 0 });
  });

  it("ライフのソウルを掴むと { life: 0 }", () => {
    const state = makeState({ kind: "life" });
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "life", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ life: 0 });
  });

  it("リザーブのソウルを掴むと { reserve: 0 } (既存挙動の回帰ガード)", () => {
    const state = makeState({ kind: "reserve" });
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "reserve", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ reserve: 0 });
  });

  it("フィールドカードのソウルを掴むと { [instanceId]: 0 }", () => {
    const state = makeState({ kind: "card", instanceId: "card-1" });
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "card", instanceId: "card-1" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ "card-1": 0 });
  });

  it("複数ソウル環境: リザーブ2個から1個掴むと { reserve: 1 }", () => {
    const state = makeState({ kind: "reserve" }, 0, { reserve: 2 });
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "reserve", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ reserve: 1 });
  });

  it("掴んでいるのが通常コアならソウル override は出さない", () => {
    const state = makeState({ kind: "trash" }, 2);
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [
          { kind: "normal", from: { kind: "trash", playerId: "alice" } },
        ],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toBeUndefined();
  });

  it("他プレイヤー所有の trash ソース (from.playerId != viewer) は無視", () => {
    const state = makeState({ kind: "trash" }, 2);
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [soulHeld({ kind: "trash", playerId: "bob" }, "bob")],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toBeUndefined();
  });
});

describe("computeSoulCoreDisplayOverrides — place phase (previewState 差分)", () => {
  it("ソウルが trash → card へ移ると { trash: false, [card]: true }", () => {
    const state = makeState({ kind: "trash" }, 2);
    // previewState: alice のソウルがカードへ移動
    const previewState: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulCoreLocation: { kind: "card", instanceId: "dest-1" } }
          : p
      ),
    };
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState,
        state,
        heldCores: [],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ trash: false, "dest-1": true });
  });

  it("ソウルが life → card へ移ると { life: false, [card]: true }", () => {
    const state = makeState({ kind: "life" });
    const previewState: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulCoreLocation: { kind: "card", instanceId: "dest-2" } }
          : p
      ),
    };
    expect(
      computeSoulCoreDisplayOverrides({
        isActive: true,
        previewState,
        state,
        heldCores: [],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ life: false, "dest-2": true });
  });
});

describe("resolveSoulCoreDisplayCount — P3-101 S4 実数表示 (単一/複数ソウル)", () => {
  it("override 無し・実カウント0 → 0 (旧: boolean false 相当)", () => {
    expect(resolveSoulCoreDisplayCount(0, undefined, false)).toBe(0);
  });

  it("override 無し・実カウント1 (primary あり) → 1 (旧: boolean true 相当)", () => {
    expect(resolveSoulCoreDisplayCount(1, undefined, true)).toBe(1);
  });

  it("override=true・primary 不在 → base+1 (このロケーションへ新規到着)", () => {
    expect(resolveSoulCoreDisplayCount(0, true, false)).toBe(1);
  });

  it("override=false・primary 在り → base-1 (このロケーションから離脱)", () => {
    expect(resolveSoulCoreDisplayCount(1, false, true)).toBe(0);
  });

  it("override=false でも 0 未満にはならない (フロアガード)", () => {
    expect(resolveSoulCoreDisplayCount(0, false, false)).toBe(0);
  });

  it("複数ソウル環境: 実カウント2 (例 BSLH01-X05 generateSoulCoreOutsideGame でリザーブ2個) は override 無しでそのまま2表示", () => {
    expect(resolveSoulCoreDisplayCount(2, undefined, true)).toBe(2);
  });

  it("複数ソウル環境: 2個保有中に3個目が別ロケーションからこのロケーションへ到着 → 3", () => {
    expect(resolveSoulCoreDisplayCount(2, true, false)).toBe(3);
  });

  it("複数ソウル環境: 2個のうち primary が離脱 → 1 (残り1個は base に含まれたまま表示継続)", () => {
    expect(resolveSoulCoreDisplayCount(2, false, true)).toBe(1);
  });
});

describe("coreContainerDisplayKey — 源種別→キーの単一正源", () => {
  it("自分の reserve/trash/life は同名キー", () => {
    expect(
      coreContainerDisplayKey({ kind: "reserve", playerId: "alice" }, "alice")
    ).toBe("reserve");
    expect(
      coreContainerDisplayKey({ kind: "trash", playerId: "alice" }, "alice")
    ).toBe("trash");
    expect(
      coreContainerDisplayKey({ kind: "life", playerId: "alice" }, "alice")
    ).toBe("life");
  });

  it("相手の reserve/trash/life は null (共有キーを汚さない)", () => {
    expect(
      coreContainerDisplayKey({ kind: "reserve", playerId: "bob" }, "alice")
    ).toBeNull();
    expect(
      coreContainerDisplayKey({ kind: "trash", playerId: "bob" }, "alice")
    ).toBeNull();
    expect(
      coreContainerDisplayKey({ kind: "life", playerId: "bob" }, "alice")
    ).toBeNull();
  });

  it("card は所有者非依存で instanceId", () => {
    expect(
      coreContainerDisplayKey({ kind: "card", instanceId: "c-9" }, "alice")
    ).toBe("c-9");
  });

  it("void / removed_from_game は null", () => {
    expect(
      coreContainerDisplayKey({ kind: "void", playerId: "alice" }, "alice")
    ).toBeNull();
    expect(
      coreContainerDisplayKey({ kind: "removed_from_game" }, "alice")
    ).toBeNull();
  });
});

describe("computeCoreDisplayOverrides — 通常コア (held grab phase)", () => {
  const normalHeld = (from: HeldCoreEntry["from"]): HeldCoreEntry => ({
    kind: "normal",
    from,
  });

  it("非アクティブ時は undefined", () => {
    const state = makeState({ kind: "reserve" }, 3);
    expect(
      computeCoreDisplayOverrides({
        isActive: false,
        previewState: state,
        state,
        heldCores: [normalHeld({ kind: "trash", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toBeUndefined();
  });

  it("トラッシュの通常コアを掴むと { trash: base-1 }", () => {
    const state = makeState({ kind: "reserve" }, 3);
    expect(
      computeCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [normalHeld({ kind: "trash", playerId: "alice" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ trash: 2 });
  });

  it("同一トラッシュから 2 個掴むと base-2", () => {
    const state = makeState({ kind: "reserve" }, 3);
    expect(
      computeCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [
          normalHeld({ kind: "trash", playerId: "alice" }),
          normalHeld({ kind: "trash", playerId: "alice" }),
        ],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toEqual({ trash: 1 });
  });

  it("相手ゾーン由来の held は無視 (キー null)", () => {
    const state = makeState({ kind: "reserve" }, 3);
    expect(
      computeCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [normalHeld({ kind: "trash", playerId: "bob" })],
        viewingPlayer: "alice",
        pendingCoreDistribution: null,
      })
    ).toBeUndefined();
  });
});

describe("computeCoreDisplayOverrides — single-source full distribution", () => {
  it("life source の全配置 pending は life 表示を 0 にする", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { lifeNormalCoreCount: 2, soulCoreLocation: { kind: "reserve" } },
        { soulCoreLocation: { kind: "reserve" } },
      ],
      startingVoidNormalCoreCount: 0,
    });
    const pendingCoreDistribution: NonNullable<
      GameState["pendingCoreDistribution"]
    > = {
      pendingId: "pending-life",
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "source-def",
      candidates: [{ instanceId: "dest-1", definitionId: "dest-def" }],
      totalNormalCores: 2,
      hasSoulCore: false,
      fromKind: "life",
      minTotal: 2,
    };

    expect(
      computeCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [],
        viewingPlayer: "alice",
        pendingCoreDistribution,
      })
    ).toEqual({ life: 0 });
  });

  it("void source の全配置 pending は表示対象外なので override しない", () => {
    const state = makeState({ kind: "reserve" });
    const pendingCoreDistribution: NonNullable<
      GameState["pendingCoreDistribution"]
    > = {
      pendingId: "pending-void",
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "source-def",
      candidates: [{ instanceId: "dest-1", definitionId: "dest-def" }],
      totalNormalCores: 2,
      hasSoulCore: false,
      fromKind: "void",
      minTotal: 2,
    };

    expect(
      computeCoreDisplayOverrides({
        isActive: true,
        previewState: state,
        state,
        heldCores: [],
        viewingPlayer: "alice",
        pendingCoreDistribution,
      })
    ).toBeUndefined();
  });
});
