import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { getLegalActions } from "@orica/rules-core";
import { buildC23ExclusiveRevealScenario } from "../src/scenario-c23-exclusive-reveal";
import { deckRevealPickSelection } from "../src/deck-reveal-pick-ui";

function pick(short = false) {
  const state = buildC23ExclusiveRevealScenario(
    ALL_CARDS,
    new URLSearchParams(short ? "short=1" : "")
  );
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: (id) => ALL_CARDS.find((c) => c.cardNo === id),
    getRegisteredFieldCardEffectActions: () => [],
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  if (!action || action.kind !== "resolve_pending_deck_reveal_pick")
    throw new Error("C23 pick missing");
  return action;
}

describe("DeckRevealModal exclusive branch selection", () => {
  it("分岐未選択では選べず、X03だけなら合算max3によらず1枚で確定できる", () => {
    const action = pick();
    expect(action.maxPickCount).toBe(3);
    expect(deckRevealPickSelection(action, null, []).canConfirm).toBe(false);
    expect(deckRevealPickSelection(action, null, []).candidateIds).toEqual([]);
    expect(deckRevealPickSelection(action, 0, ["reveal-0"])).toMatchObject({
      candidateIds: ["reveal-0"],
      requiredCount: 1,
      maxCount: 1,
      canConfirm: true,
    });
  });
  it("有償分岐は3枚ちょうど、混在・過不足・重複・不明IDは確定不能", () => {
    const action = pick();
    expect(action.exclusiveGroupBranches?.[1]?.costGate).toBe(1);
    expect(
      deckRevealPickSelection(action, 1, ["reveal-1", "reveal-2", "reveal-3"])
        .canConfirm
    ).toBe(true);
    for (const ids of [
      [],
      ["reveal-1"],
      ["reveal-1", "reveal-2"],
      ["reveal-0", "reveal-1", "reveal-2"],
      ["reveal-1", "reveal-2", "reveal-3", "reveal-4"],
      ["reveal-1", "reveal-1", "reveal-2"],
      ["reveal-1", "reveal-2", "unknown"],
    ]) {
      expect(deckRevealPickSelection(action, 1, ids).canConfirm).toBe(false);
    }
    expect(deckRevealPickSelection(action, 0, ["reveal-1"]).canConfirm).toBe(
      false
    );
  });
  it("候補不足時はエンジンが返した2枚ちょうどを要求する", () => {
    const action = pick(true);
    expect(
      deckRevealPickSelection(action, 1, ["reveal-1", "reveal-2"])
    ).toMatchObject({ requiredCount: 2, maxCount: 2, canConfirm: true });
    expect(deckRevealPickSelection(action, 1, ["reveal-1"]).canConfirm).toBe(
      false
    );
  });
  it("排他ではない任意選択の0枚と上限を維持する", () => {
    const { exclusiveGroupBranches: _branches, ...action } = pick();
    const optional = { ...action, canSkip: true, maxPickCount: 2 };
    expect(deckRevealPickSelection(optional, null, []).canConfirm).toBe(true);
    expect(
      deckRevealPickSelection(optional, null, ["reveal-0", "reveal-1"])
        .canConfirm
    ).toBe(true);
    expect(
      deckRevealPickSelection(optional, null, [
        "reveal-0",
        "reveal-1",
        "reveal-2",
      ]).canConfirm
    ).toBe(false);
  });
});
