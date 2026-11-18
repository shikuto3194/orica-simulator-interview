/**
 * `computeIndependentCoreLocationIds` の単体テスト（P3-90）。
 *
 * 手動コア移動（core-move モード）で創界神 / 導界者 / 創界石ネクサスを source / destination
 * にできないよう、GUI が `.ac-selectable` 付与とタップから除外する instanceId 集合を
 * 正しく算出することを検証する。判定述語は rules-core の `hasIndependentCoreManagement`
 * （grandwalkerData / grandstoneData 有無）に委譲している。
 *
 * 仕様正源: issues/P3-90_manual-core-move-independent-core-cards.md
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";
import {
  computeIndependentCoreLocationIds,
  computeManualCoreMoveBlockedLocationIds,
} from "../src/coreMoveGuard";

/** 最小限のフィールドカード instance（helper が読むのは zone / definitionId / instanceId のみ）。 */
function fieldCard(
  instanceId: string,
  definitionId: string,
  zone: CardInstance["zone"] = "field"
): CardInstance {
  return {
    instanceId,
    definitionId,
    zone,
    zoneRoleName: "spirit",
    underCards: [],
  } as unknown as CardInstance;
}

/** definitionId → 定義の stub。grandwalker / grandstone / 通常を出し分ける。 */
const getDefinition = (definitionId: string): CardDefinition | undefined => {
  switch (definitionId) {
    case "GRANDWALKER":
      return { grandwalkerData: {} } as unknown as CardDefinition;
    case "GRANDSTONE":
      return { grandstoneData: {} } as unknown as CardDefinition;
    case "PLAIN":
      return {} as unknown as CardDefinition;
    case "TOKEN":
      return {
        tokenIndependentCoreManagement: {
          redirectCoresToVoid: true,
          placementRestrictedToEnterField: true,
        },
      } as unknown as CardDefinition;
    default:
      return undefined;
  }
};

function stateWith(cards: CardInstance[]): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    startingVoidNormalCoreCount: 0,
  });
  return { ...base, cardInstances: cards };
}

describe("computeIndependentCoreLocationIds", () => {
  it("創界神 / 創界石ネクサスの instanceId を集合に含める", () => {
    const state = stateWith([
      fieldCard("gw-1", "GRANDWALKER"),
      fieldCard("gs-1", "GRANDSTONE"),
      fieldCard("sp-1", "PLAIN"),
    ]);
    const blocked = computeIndependentCoreLocationIds(state, getDefinition);
    expect(blocked.has("gw-1")).toBe(true);
    expect(blocked.has("gs-1")).toBe(true);
  });

  it("通常スピリット / ネクサスは除外する", () => {
    const state = stateWith([
      fieldCard("sp-1", "PLAIN"),
      fieldCard("gw-1", "GRANDWALKER"),
    ]);
    const blocked = computeIndependentCoreLocationIds(state, getDefinition);
    expect(blocked.has("sp-1")).toBe(false);
    expect(blocked.size).toBe(1);
  });

  it("フィールド外（手札 / トラッシュ等）のカードは対象にしない", () => {
    const state = stateWith([
      fieldCard("gw-hand", "GRANDWALKER", "hand"),
      fieldCard("gw-trash", "GRANDWALKER", "trash"),
      fieldCard("gw-field", "GRANDWALKER", "field"),
    ]);
    const blocked = computeIndependentCoreLocationIds(state, getDefinition);
    expect(blocked.has("gw-field")).toBe(true);
    expect(blocked.has("gw-hand")).toBe(false);
    expect(blocked.has("gw-trash")).toBe(false);
  });

  it("該当カードが無ければ空集合", () => {
    const state = stateWith([fieldCard("sp-1", "PLAIN")]);
    expect(computeIndependentCoreLocationIds(state, getDefinition).size).toBe(
      0
    );
  });

  it("定義が引けないカード（undefined）は安全に無視する", () => {
    const state = stateWith([fieldCard("ghost", "UNKNOWN_DEF")]);
    expect(computeIndependentCoreLocationIds(state, getDefinition).size).toBe(
      0
    );
  });
});

describe("computeManualCoreMoveBlockedLocationIds", () => {
  it("魂状態・表裏のカード状態・下カードを移動先から除き、通常のスピリットを残す", () => {
    const state = stateWith([
      fieldCard("soul", "PLAIN"),
      { ...fieldCard("card", "PLAIN"), zoneRoleName: "spirit-card" },
      { ...fieldCard("face-down", "PLAIN"), faceDown: true },
      fieldCard("under", "PLAIN"),
      {
        ...fieldCard("host", "PLAIN"),
        underCards: [{ cardInstanceId: "under", role: "advent_source" }],
      },
    ]);
    state.players[0]!.soulStateInstanceIds = ["soul"];
    const blocked = computeManualCoreMoveBlockedLocationIds(
      state,
      getDefinition
    );
    expect([...blocked.destinationBlockedIds].sort()).toEqual([
      "card",
      "face-down",
      "soul",
      "under",
    ]);
    expect(blocked.sourceBlockedIds).toEqual(blocked.destinationBlockedIds);
  });

  it("token-managed cards are blocked only as destinations", () => {
    const state = stateWith([
      fieldCard("token-1", "TOKEN"),
      fieldCard("gw-1", "GRANDWALKER"),
      fieldCard("sp-1", "PLAIN"),
    ]);

    const blocked = computeManualCoreMoveBlockedLocationIds(
      state,
      getDefinition
    );

    expect(blocked.sourceBlockedIds.has("token-1")).toBe(false);
    expect(blocked.destinationBlockedIds.has("token-1")).toBe(true);
    expect(blocked.sourceBlockedIds.has("gw-1")).toBe(true);
    expect(blocked.destinationBlockedIds.has("gw-1")).toBe(true);
    expect(blocked.sourceBlockedIds.has("sp-1")).toBe(false);
    expect(blocked.destinationBlockedIds.has("sp-1")).toBe(false);
  });
});
