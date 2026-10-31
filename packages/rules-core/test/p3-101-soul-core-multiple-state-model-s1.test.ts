import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/index";
import {
  backfillOptionalStateFields,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  createPlayerState,
  initializeGame,
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

function buildDeck(): CardDefinition[] {
  const spirit = createDemoSpiritDefinition();
  return Array.from({ length: 40 }, (_, i) => ({
    ...spirit,
    cardNo: `${spirit.cardNo}-${i}`,
  }));
}

describe("P3-101 S1: ソウルコア複数個対応 状態モデル", () => {
  it("createPlayerState はロケーション別ソウルコアカウントを0で初期化する", () => {
    const player = createPlayerState("alice");

    expect(player.reserveSoulCoreCount).toBe(0);
    expect(player.trashSoulCoreCount).toBe(0);
    expect(player.lifeSoulCoreCount).toBe(0);
    expect(player.soulCoreLocation).toBeNull();
  });

  it("createCardInstance は soulCoreCount を0で初期化する", () => {
    const definition = createDemoSpiritDefinition();
    const card = createCardInstance(definition, {
      ownerPlayerId: "alice",
      zone: "field",
    });

    expect(card.soulCoreCount).toBe(0);
  });

  it("initializeGame は旧 soulCoreLocation と新カウントモデルの両方をリザーブに置く", () => {
    const state = initializeGame({ decks: [buildDeck(), buildDeck()] });

    for (const player of state.players) {
      expect(player.soulCoreLocation).toEqual({ kind: "reserve" });
      expect(player.reserveSoulCoreCount).toBe(1);
      expect(player.trashSoulCoreCount).toBe(0);
      expect(player.lifeSoulCoreCount).toBe(0);
    }
  });

  it("空の baseline state は invariant を通す(非回帰)", () => {
    const state = createEmptyGameState();

    expect(collectGameStateInvariantIssues(state)).toEqual([]);
  });

  it.each([
    ["reserveSoulCoreCount", "invalid_player_reserve_soul_core_count"],
    ["trashSoulCoreCount", "invalid_player_trash_soul_core_count"],
    ["lifeSoulCoreCount", "invalid_player_life_soul_core_count"],
  ] as const)(
    "player.%s が負値だと invariant issue %s を検出する",
    (field, code) => {
      const state = createEmptyGameState({
        playerOverrides: [{ [field]: -1 }],
      });

      const issues = collectGameStateInvariantIssues(state);

      expect(issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })])
      );
    }
  );

  it("card.soulCoreCount が負値だと invariant issue を検出する", () => {
    const definition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-soul-1",
          ownerPlayerId: "player-1",
          zone: "field",
          soulCoreCount: -1,
        }),
      ],
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_card_soul_core_count" }),
      ])
    );
  });

  describe("backfillOptionalStateFields (S1 移行アダプタ)", () => {
    it("旧形式 (新フィールド欠落) の soulCoreLocation:reserve を reserveSoulCoreCount へ導出する", () => {
      const legacyPlayer: Record<string, unknown> = {
        ...createPlayerState("alice"),
        soulCoreLocation: { kind: "reserve" },
      };
      delete legacyPlayer.reserveSoulCoreCount;
      delete legacyPlayer.trashSoulCoreCount;
      delete legacyPlayer.lifeSoulCoreCount;

      const restored = backfillOptionalStateFields({
        players: [legacyPlayer as never],
        cardInstances: [],
      });

      expect(restored.players[0]!.reserveSoulCoreCount).toBe(1);
      expect(restored.players[0]!.trashSoulCoreCount).toBe(0);
      expect(restored.players[0]!.lifeSoulCoreCount).toBe(0);
    });

    it("旧形式の soulCoreLocation:card を該当カードの soulCoreCount へ導出する", () => {
      const definition = createDemoSpiritDefinition();
      const legacyCard: Record<string, unknown> = {
        ...createCardInstance(definition, {
          instanceId: "spirit-soul-2",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      };
      delete legacyCard.soulCoreCount;
      const legacyPlayer: Record<string, unknown> = {
        ...createPlayerState("alice"),
        soulCoreLocation: { kind: "card", instanceId: "spirit-soul-2" },
      };
      delete legacyPlayer.reserveSoulCoreCount;
      delete legacyPlayer.trashSoulCoreCount;
      delete legacyPlayer.lifeSoulCoreCount;

      const restored = backfillOptionalStateFields({
        players: [legacyPlayer as never],
        cardInstances: [legacyCard as never],
      });

      expect(restored.players[0]!.reserveSoulCoreCount).toBe(0);
      expect(restored.cardInstances[0]!.soulCoreCount).toBe(1);
    });

    it("新フィールドが既に存在する場合はそのまま保持する (冪等)", () => {
      const player = {
        ...createPlayerState("alice"),
        soulCoreLocation: { kind: "trash" as const },
        reserveSoulCoreCount: 5,
        trashSoulCoreCount: 9,
        lifeSoulCoreCount: 2,
      };

      const restored = backfillOptionalStateFields({
        players: [player],
        cardInstances: [],
      });

      expect(restored.players[0]!.reserveSoulCoreCount).toBe(5);
      expect(restored.players[0]!.trashSoulCoreCount).toBe(9);
      expect(restored.players[0]!.lifeSoulCoreCount).toBe(2);
    });
  });
});
