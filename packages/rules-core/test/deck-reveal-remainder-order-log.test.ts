/**
 * finalizeDeckReveal が「残ったカードは好きな順番でデッキの下に戻す」型の効果
 * (例: cardData.js 多数) が持つ、プレイヤーが選んだ戻し順を state.log に記録することの検証。
 * deckRevealRemainderOrder は UI 表示と同じく「デッキ下から順」。
 *
 * revealTo:"both"（公開オープン）のときのみ記録し、revealTo:"self"（非公開オープン）では
 * 従来通り記録しない（deck_reveal:picked_cards / picked_cards_private の公開/非公開分岐と同じ境界）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function buildOrderingState(
  revealTo: "both" | "self",
  remainder: "bottom" | "top_or_bottom" | "top_bottom_split" = "bottom"
): GameState {
  const src = createCardInstance(card("BSFT01-C03"), {
    instanceId: "src-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
  });
  const remainderA = createCardInstance(card("BSTH01-C01"), {
    instanceId: "r-a",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "revealed",
  });
  const remainderB = createCardInstance(card("BSFT01-C03"), {
    instanceId: "r-b",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "revealed",
  });
  const existingTop = createCardInstance(card("BSFT01-C03"), {
    instanceId: "existing-top",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "deck",
  });
  const existingBottom = createCardInstance(card("BSTH01-C01"), {
    instanceId: "existing-bottom",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "deck",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [src, existingTop, existingBottom, remainderA, remainderB],
    playerOverrides: [{ deckCount: 2 }, {}],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    pendingDeckReveal: {
      pendingId: "dr-order-1",
      actingPlayerId: "alice",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "BSFT01-C03",
      revealedCardInstanceIds: ["r-a", "r-b"],
      originalRevealedCardInstanceIds: ["r-a", "r-b"],
      revealTo,
      picks: [],
      remainder,
      phase: "ordering_remainder",
      currentPickIndex: 0,
      pickedCardInstanceIds: [],
    },
  };
}

function aliceDeckIds(state: GameState): string[] {
  return state.cardInstances
    .filter((c) => c.ownerPlayerId === "alice" && c.zone === "deck")
    .map((c) => c.instanceId);
}

describe("finalizeDeckReveal remainder order logging", () => {
  it("bottom 戻しは選択順をデッキ下→上として実デッキへ反映し、state.log に記録する", () => {
    const state = buildOrderingState("both");
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(action).toBeDefined();
    if (action?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected action kind");
    }
    expect(action.remainingCardInstanceIds.slice().sort()).toEqual([
      "r-a",
      "r-b",
    ]);

    const result = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      deckRevealRemainderOrder: ["r-b", "r-a"],
    });

    expect(result.state.pendingDeckReveal).toBeNull();
    expect(result.state.log).toContain(
      "deck_reveal:remainder_order:alice:bottom:星霊界,毛玉"
    );
    expect(aliceDeckIds(result.state)).toEqual([
      "existing-top",
      "existing-bottom",
      "r-a",
      "r-b",
    ]);
  });

  it("top_or_bottom の top 戻しも選択順をデッキ下→上として実デッキへ反映する", () => {
    const state = buildOrderingState("both", "top_or_bottom");
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(action).toBeDefined();
    if (action?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected action kind");
    }

    const result = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      deckRevealRemainderOrder: ["r-b", "r-a"],
      deckRevealPlacement: "top",
    });

    expect(result.state.log).toContain(
      "deck_reveal:remainder_order:alice:top:星霊界,毛玉"
    );
    expect(aliceDeckIds(result.state)).toEqual([
      "r-a",
      "r-b",
      "existing-top",
      "existing-bottom",
    ]);
  });

  it("top_bottom_split は下側/上側それぞれで選択順をデッキ下→上として実デッキへ反映する", () => {
    const state = buildOrderingState("both", "top_bottom_split");
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(action).toBeDefined();
    if (action?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected action kind");
    }

    const result = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      deckRevealRemainderOrder: ["r-b", "r-a"],
      deckRevealRemainderPlacements: { "r-b": "bottom", "r-a": "top" },
    });

    expect(result.state.log).toContain(
      "deck_reveal:remainder_order:alice:top_bottom_split:星霊界,毛玉"
    );
    expect(aliceDeckIds(result.state)).toEqual([
      "r-a",
      "existing-top",
      "existing-bottom",
      "r-b",
    ]);
  });

  it("revealTo:self（非公開オープン）では並び順をログに残さない", () => {
    const state = buildOrderingState("self");
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(action).toBeDefined();
    if (action?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected action kind");
    }

    const result = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      deckRevealRemainderOrder: ["r-b", "r-a"],
    });

    expect(result.state.pendingDeckReveal).toBeNull();
    expect(
      result.state.log.some((entry) =>
        entry.startsWith("deck_reveal:remainder_order:")
      )
    ).toBe(false);
  });
});
