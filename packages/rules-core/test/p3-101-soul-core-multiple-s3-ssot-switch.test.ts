import { describe, expect, it } from "vitest";
import {
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getPlayerReserveCoreCount,
  getTotalCoresOnCardById,
  isSoulCoreOn,
} from "../src/index";
import { executeCoreMove } from "../src/effect/structured-effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const SPIRIT_DEF = "BSTH001-C01";

/**
 * P3-101 S3本体 (SSOT切替): isSoulCoreOn/getTotalCoresOnCardById/
 * getPlayerReserveCoreCount 等の SSOT を player.soulCoreLocation から
 * CardInstance.soulCoreCount / player.*SoulCoreCount へ切替。
 *
 * S3-prep はテスト構築の後付け spread desync のみを是正していたが、実際には
 * structured-core-move.ts 等の本番 write site 9 箇所超が soulCoreLocation のみを
 * 書き換え新カウントフィールドを未同期のまま残していた (診断切替で発覚)。
 * withSoulCoreLocation 経由へ統一した上での SSOT 切替を検証する。
 */
describe("P3-101 S3: isSoulCoreOn/getTotalCoresOnCardById SSOT切替", () => {
  it("card 上の soulCoreCount を SSOT として isSoulCoreOn/getTotalCoresOnCardById が読む", () => {
    const sourceCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      cardInstances: [sourceCard],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-spirit" },
        },
      ],
    });

    expect(isSoulCoreOn(state, "alice-spirit")).toBe(true);
    expect(getTotalCoresOnCardById(state, "alice-spirit")).toBe(2);
  });

  it("executeCoreMove (card_instance→reserve) 後、新カウントフィールドが同期され invariant 違反なし", () => {
    const sourceCard = createCardInstance(getDef(SPIRIT_DEF)!, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "alice-spirit",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      cardInstances: [sourceCard],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "alice-spirit" },
        },
      ],
    });

    const after = executeCoreMove(
      state,
      ALICE,
      { kind: "card_instance", instanceId: "alice-spirit" },
      { kind: "reserve", player: "self" },
      Number.POSITIVE_INFINITY,
      "alice-source",
      undefined,
      undefined,
      getDef
    );

    // 旧 SSOT (soulCoreLocation) は従来どおり移動している。
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });

    // 新 SSOT (soulCoreCount / reserveSoulCoreCount) も dual-write で同期済み。
    expect(isSoulCoreOn(after, "alice-spirit")).toBe(false);
    expect(getTotalCoresOnCardById(after, "alice-spirit")).toBe(0);
    // normal core 1 個 + soul core 1 個が両方 reserve へ移動。
    expect(getPlayerReserveCoreCount(aliceAfter)).toBe(2);
    expect(aliceAfter.reserveNormalCoreCount).toBe(1);
    expect(aliceAfter.reserveSoulCoreCount).toBe(1);

    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });
});
