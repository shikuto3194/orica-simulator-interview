import { describe, expect, it } from "vitest";
import type { PendingCoreDistribution } from "@orica/rules-core";
import {
  coreDistributionRouteLabel,
  coreDistributionAvailableTotal,
} from "../src/utils/core-distribution-labels";

const pending: PendingCoreDistribution = {
  pendingId: "labels",
  actingPlayerId: "alice",
  sourceInstanceId: "source",
  sourceDefinitionId: "source",
  candidates: [{ instanceId: "target", definitionId: "target" }],
  totalNormalCores: 2,
  hasSoulCore: false,
  fromKind: "void",
  fromPlayerId: "alice",
  toPlayerId: "bob",
  effectTiming: { kind: "continuous" },
};

describe("配分HUDの移動経路と個数", () => {
  it.each([
    ["void", "ボイド"],
    ["trash", "自分のトラッシュ"],
    ["reserve", "自分のリザーブ"],
    ["life", "自分のライフ"],
    ["outside_game", "ゲーム外"],
  ] as const)("%sの経路は実データから生成", (fromKind, label) => {
    expect(
      coreDistributionRouteLabel({ ...pending, fromKind }, "alice", {
        cardInstances: [],
      })
    ).toBe(`${label}→相手のフィールド`);
  });
  it("移動元プレイヤーと観戦側を区別し、複数ソースの同種をまとめる", () => {
    expect(
      coreDistributionRouteLabel(
        {
          ...pending,
          fromKind: "any_movable",
          allowedSources: [
            { kind: "reserve" },
            { kind: "trash" },
            { kind: "life" },
            { kind: "field", instanceId: "a" },
            { kind: "field", instanceId: "b" },
          ],
        },
        "bob",
        { cardInstances: [] }
      )
    ).toBe(
      "相手のリザーブ・相手のトラッシュ・相手のライフ・相手のフィールド→自分のフィールド"
    );
  });
  it("ソウルだけの生成も個数に含め、通常コアとの合計上限を守る", () => {
    expect(
      coreDistributionAvailableTotal({
        ...pending,
        fromKind: "outside_game",
        totalNormalCores: 0,
        hasSoulCore: true,
      })
    ).toBe(1);
    expect(
      coreDistributionAvailableTotal({
        ...pending,
        hasSoulCore: true,
        totalSoulCores: 2,
      })
    ).toBe(4);
    expect(
      coreDistributionAvailableTotal({
        ...pending,
        hasSoulCore: true,
        totalSoulCores: 2,
        maxTotal: 3,
      })
    ).toBe(3);
  });
});
