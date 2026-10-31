/**
 * 「手札がN枚以下になるように内容を見せずにデッキの下に戻す」プリミティブ。
 *
 * discard targetHandSize + destination:"deck_bottom" の配線テスト。
 * 通常の discard（destination 省略=trash）と同じ選択ロジックを使い、最終的な
 * 行き先だけがデッキの下（zone:deck + deckCount++）へ変わることを assert する。
 *
 * production: BSRK01-C03『双龍閃』メイン（3ドロー→手札5枚以下になるようデッキの下に戻す）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { applyLegalAction, buildTriggeredEffectLookup } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];
const mainEffect = (def: CardDefinition) => {
  const effect = def.effects?.find(
    (e) => e.timing.kind === "activated" && e.timing.mode === "main"
  );
  if (!effect) throw new Error(`main effect not found: ${def.cardNo}`);
  return effect;
};

const ALICE = "player-1";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:discard-to-deck-bottom:43",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

// 手札カードの素材（任意のカード定義でよい）。
const FILLER = "BSRK01-C03";

describe("discard destination:deck_bottom（手札N枚以下になるようデッキの下に戻す）", () => {
  it.each([1, 2])(
    "%i枚戻し: 選択式と全数自動の両方で既存デッキより下へ入る",
    (count) => {
      const instance = (id: string, zone: "hand" | "deck") =>
        createCardInstance(card(FILLER), {
          instanceId: id,
          ownerPlayerId: ALICE,
          zone,
        });
      const state = createEmptyGameState({
        cardInstances: [
          instance("hand-a", "hand"),
          instance("hand-b", "hand"),
          instance("deck-top", "deck"),
          instance("deck-bottom", "deck"),
        ],
        playerOverrides: [{ handCount: 2, deckCount: 2 }, {}],
      });
      let after = runEffect(
        state,
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "discard",
                player: "self",
                count,
                destination: "deck_bottom",
              },
            },
          ],
        },
        "hand-a"
      );
      if (count === 1) {
        expect(after.pendingZoneSelection).not.toBeNull();
        after = applyLegalAction({
          state: after,
          action: { kind: "resolve_pending_zone_selection" },
          selectedZoneCardIds: ["hand-a"],
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: noTriggerLookup,
        }).state;
      }
      expect(
        after.cardInstances
          .filter((c) => c.zone === "deck")
          .map((c) => c.instanceId)
      ).toEqual([
        "deck-top",
        "deck-bottom",
        "hand-a",
        ...(count === 2 ? ["hand-b"] : []),
      ]);
      expect(alice(after).deckCount).toBe(2 + count);
      expect(alice(after).handCount).toBe(2 - count);
    }
  );
  it("DSL: BSRK01-C03 メインは draw3 + discard targetHandSize:5 destination:deck_bottom", () => {
    const c = card("BSRK01-C03");
    const main = mainEffect(c);
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    expect(main.steps[0]!.action).toEqual({ kind: "draw", count: 3 });
    expect(main.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: -1,
      targetHandSize: 5,
      destination: "deck_bottom",
    });
  });

  it("[board] 手札超過分の選択待ちが立ち、選んだカードがデッキの下へ移る（trash へは行かない）", () => {
    const src = createCardInstance(card("BSRK01-C03"), {
      instanceId: "souryusen",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    // 手札7枚、デッキ3枚。draw3 で手札10枚 → targetHandSize:5 で5枚をデッキの下へ。
    const deck = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(card(FILLER), {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const hand = Array.from({ length: 7 }, (_, i) =>
      createCardInstance(card(FILLER), {
        instanceId: `hand-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck, ...hand],
      playerOverrides: [{ deckCount: 3, handCount: 7 }, {}],
    });

    const drawnState = runEffect(
      before,
      mainEffect(card("BSRK01-C03")),
      "souryusen"
    );
    // ドロー後 手札10、デッキ0。
    expect(alice(drawnState).handCount).toBe(10);
    expect(alice(drawnState).deckCount).toBe(0);
    // 10 → 5 = 5枚をデッキの下へ戻す選択待ち。行き先は deck_bottom。
    const pending = drawnState.pendingZoneSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actionKind).toBe("discard_hand");
    expect(pending!.maxCount).toBe(5);
    expect(pending!.destination).toBe("deck_bottom");

    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
    };
    // ドロー後の手札 instanceId はオリジナル hand-* + 引いた deck-*。任意の5枚を返す。
    const chosen = drawnState.cardInstances
      .filter((x) => x.ownerPlayerId === ALICE && x.zone === "hand")
      .slice(0, 5)
      .map((x) => x.instanceId);
    const resolved = applyLegalAction({
      state: drawnState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: chosen,
      ...lookups,
    }).state;

    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    // 選んだ5枚はデッキへ（trash には1枚も行かない）。
    const chosenSet = new Set(chosen);
    for (const id of chosen) {
      const cInst = resolved.cardInstances.find((x) => x.instanceId === id)!;
      expect(cInst.zone).toBe("deck");
    }
    const toTrash = resolved.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "trash"
    );
    expect(toTrash).toHaveLength(0);
    // 手札5、デッキ5。
    expect(alice(resolved).handCount).toBe(5);
    expect(alice(resolved).deckCount).toBe(5);
    const handLeft = resolved.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "hand"
    );
    expect(handLeft).toHaveLength(5);
    expect(handLeft.every((x) => !chosenSet.has(x.instanceId))).toBe(true);
  });

  it("[board] 既に手札5枚以下なら no-op（戻さない）", () => {
    const src = createCardInstance(card("BSRK01-C03"), {
      instanceId: "souryusen-noop",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const hand = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(card(FILLER), {
        instanceId: `hand-noop-${i}`,
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...hand],
      playerOverrides: [{ deckCount: 0, handCount: 3 }, {}],
    });
    // 手札5枚以下 → discard ステップは max(0, 3-5)=0 で no-op。draw も deck0 で 0枚。
    const after = runEffect(
      before,
      mainEffect(card("BSRK01-C03")),
      "souryusen-noop"
    );
    expect(after.pendingZoneSelection ?? null).toBeNull();
    expect(alice(after).handCount).toBe(3);
    const handLeft = after.cardInstances.filter(
      (x) => x.ownerPlayerId === ALICE && x.zone === "hand"
    );
    expect(handLeft).toHaveLength(3);
  });
});
