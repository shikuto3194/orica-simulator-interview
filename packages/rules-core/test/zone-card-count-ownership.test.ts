import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  initializeGame,
  applyContractPresentationChoices,
  mulliganHand,
} from "../src/factories";
import {
  queuePendingLeave,
  flushPendingLeaves,
} from "../src/state-based-actions";
import { sanitizeStateForViewer } from "../src/state-sanitize";
import { moveCardZone, updateCard } from "../src/core/core-system";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import {
  drawCardsToHand,
  replaceCardInstances,
} from "../src/zone/card-instance-state";
import type { CardDefinition, GameState, Zone } from "../src/model";

const def: CardDefinition = {
  cardNo: "TEST-COUNTS",
  name: "枚数同期",
  printedCategory: "spirit",
  colors: ["red"],
  symbolColors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
function physical(zones: Zone[] = ["deck"]): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: zones.map((zone, i) =>
      createCardInstance(def, {
        instanceId: `c${i}`,
        ownerPlayerId: "alice",
        zone,
      })
    ),
  });
  delete state.zoneCountMode;
  return replaceCardInstances(state, state.cardInstances);
}
function counts(state: GameState, id = "alice") {
  const player = state.players.find((p) => p.id === id)!;
  return [player.deckCount, player.handCount];
}
describe("カード配列と枚数の共通更新責任", () => {
  it("moveCardZoneだけで最後のデッキカードと0枚への戻しを同期する", () => {
    const before = physical();
    const hand = moveCardZone(before, "c0", "hand");
    expect(counts(hand)).toEqual([0, 1]);
    expect(counts(before)).toEqual([1, 0]);
    expect(counts(moveCardZone(hand, "c0", "deck"))).toEqual([1, 0]);
  });
  it("updateCard経由の所有者変更でも両プレイヤーを同期する", () => {
    const state = updateCard(physical(["hand"]), "c0", (card) => ({
      ...card,
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    }));
    expect(counts(state)).toEqual([0, 0]);
    expect(counts(state, "bob")).toEqual([0, 1]);
  });
  it("公開・手札・トラッシュを配列で一括更新しても同期する", () => {
    const initial = physical(["deck", "revealed", "hand"]);
    const next = replaceCardInstances(
      initial,
      initial.cardInstances.map((card, i) => ({
        ...card,
        zone: (["revealed", "hand", "trash"] as Zone[])[i]!,
      }))
    );
    expect(counts(next)).toEqual([0, 1]);
    expect(replaceCardInstances(next, next.cardInstances)).toBe(next);
  });
  it("実体が0枚でも壊れたカウンタを検出する", () => {
    const state = physical([]);
    state.players[0] = { ...state.players[0]!, deckCount: 1, handCount: 1 };
    const issues = collectGameStateInvariantIssues(state);
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["deck_count_mismatch", "hand_count_mismatch"])
    );
  });
  it("実対戦初期化は抽象モードにならず、配布後の枚数が一致する", () => {
    const state = initializeGame({
      decks: [Array(6).fill(def), Array(6).fill(def)],
      skipPreGame: true,
      allowUnavailableDeckCards: true,
    });
    expect(state.zoneCountMode).toBeUndefined();
    expect(counts(state)).toEqual([2, 4]);
    expect(
      collectGameStateInvariantIssues(state).filter((i) =>
        i.code.endsWith("count_mismatch")
      )
    ).toEqual([]);
  });
  it("契約選択の初期配布も共通配列更新が確定する", () => {
    const state = physical(Array(6).fill("deck"));
    const dealt = applyContractPresentationChoices(state, {});
    expect(counts(dealt)).toEqual([2, 4]);
  });
  it("抽象fixtureのドローは実体と省略分を二重計上しない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 3,
      playerOverrides: [{ handCount: 0 }],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "c0",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    });
    const draw = drawCardsToHand(state, "alice", 2);
    expect(draw.amount).toBe(2);
    expect(draw.drawnIds.size).toBe(1);
    expect(counts(draw.state)).toEqual([1, 2]);
  });
  it("抽象fixtureの契約配布でも共通移動と個別補正を二重計上しない", () => {
    const state = {
      ...physical(Array(6).fill("deck")),
      zoneCountMode: "abstract" as const,
    };
    expect(counts(applyContractPresentationChoices(state, {}))).toEqual([2, 4]);
  });
  it("マリガンでもカード移動と別の枚数補正を必要としない", () => {
    const state = {
      ...physical(["hand", "hand", "hand", "hand", "hand", "deck"]),
      zoneCountMode: "abstract" as const,
    };
    expect(counts(mulliganHand(state, "alice", () => def))).toEqual([2, 4]);
  });
  it("離脱待ちは加算せず、離脱確定で0枚のデッキに1枚戻る", () => {
    const initial = updateCard(physical(["field"]), "c0", (card) => ({
      ...card,
      normalCoreCount: 1,
    }));
    const pending = queuePendingLeave({
      state: initial,
      instanceId: "c0",
      kind: "bounce",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId: "count-leave",
      leaveDestination: { zone: "deck", position: "bottom" },
    });
    expect(counts(pending)).toEqual([0, 0]);
    expect(counts(flushPendingLeaves(pending, () => def))).toEqual([1, 0]);
  });
  it("JSON保存・秘匿表示でも実対戦の枚数契約を保持する", () => {
    const restored: GameState = JSON.parse(JSON.stringify(physical()));
    expect(restored.zoneCountMode).toBeUndefined();
    const drawn = drawCardsToHand(restored, "alice", 1).state;
    expect(counts(sanitizeStateForViewer(drawn, "bob"))).toEqual([0, 1]);
    expect(
      collectGameStateInvariantIssues(drawn).filter((i) =>
        i.code.endsWith("count_mismatch")
      )
    ).toEqual([]);
  });
});
