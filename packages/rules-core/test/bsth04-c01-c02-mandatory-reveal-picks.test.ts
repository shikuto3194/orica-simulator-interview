import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type GameState,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

function reveal(cardNo: string, deck: string[]): GameState {
  const source = definitions.get(cardNo)!;
  const card = (no: string, id: string, zone: "field" | "deck") =>
    createCardInstance(definitions.get(no)!, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card(cardNo, "source", "field"),
        ...deck.map((no, index) => card(no, `top-${index}`, "deck")),
      ],
      playerOverrides: [{ deckCount: deck.length }, { deckCount: 0 }],
    }),
    activePlayerId: "alice",
    step: "main",
  };
  // 発揮を選んで公開した後を再現。公開自体は引き続き任意。
  expect(source.effects![1]!.executionMode).toBe("optional");
  return executeEffect({
    chainId: "test:bsth04-c01-c02-mandatory-reveal-picks:41",
    state,
    effect: source.effects![1]!,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    effectIndex: 1,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  });
}

function pickAction(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
  }).find((candidate) => candidate.kind === "resolve_pending_deck_reveal_pick");
  if (!action || action.kind !== "resolve_pending_deck_reveal_pick") {
    throw new Error("missing deck reveal pick");
  }
  return action;
}

function pick(state: GameState, ids: string[]) {
  return applyLegalAction({
    state,
    action: pickAction(state),
    selectedDeckRevealCardIds: ids,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).state;
}

function zones(state: GameState) {
  return state.cardInstances
    .filter((card) => card.instanceId.startsWith("top-"))
    .map((card) => card.zone);
}

describe.each(["BSTH04-C01", "BSTH04-C02"])(
  "%s: 任意オープン後の回収は強制",
  (cardNo) => {
    it("報告盤面: 太陽の畑と幽々子2枚から太陽の畑と幽々子1枚を必ず回収する", () => {
      // 2026-09-19 snapshot の公開情報 #49/#50 と同じデッキ上3枚。
      const opened = reveal(cardNo, [
        "BSTH04-転醒R02(A)",
        "BSTH04-X01",
        "BSTH04-X01",
      ]);
      expect(pickAction(opened)).toMatchObject({
        canSkip: false,
        maxPickCount: 1,
        candidateCardInstanceIds: ["top-1", "top-2"],
      });
      expect(() => pick(opened, [])).toThrow(/requires 1 selection/);
      const afterGuided = pick(opened, ["top-1"]);
      expect(pickAction(afterGuided)).toMatchObject({
        canSkip: false,
        candidateCardInstanceIds: ["top-0"],
      });
      expect(() => pick(afterGuided, [])).toThrow(/requires 1 selection/);
      const finished = pick(afterGuided, ["top-0"]);
      expect(finished.pendingDeckReveal).toBeNull();
      expect(zones(finished)).toEqual(["hand", "hand", "trash"]);
    });

    it("導界者がなくても幻想かつ起幻の黄/紫カード1枚は回収必須", () => {
      const opened = reveal(cardNo, ["BSTH01-C01", "BSTH04-C01", "BSTH04-C02"]);
      expect(pickAction(opened).canSkip).toBe(true);
      const afterEmptyGuided = pick(opened, []);
      expect(pickAction(afterEmptyGuided)).toMatchObject({
        canSkip: false,
        candidateCardInstanceIds: ["top-1", "top-2"],
      });
      expect(() => pick(afterEmptyGuided, [])).toThrow(/requires 1 selection/);
      const finished = pick(afterEmptyGuided, ["top-2"]);
      expect(finished.pendingDeckReveal).toBeNull();
      expect(zones(finished)).toEqual(["trash", "trash", "hand"]);
    });

    it("導界者だけが対象なら1枚を回収し、2枠目は0枚で進む", () => {
      const opened = reveal(cardNo, ["BSTH04-X01", "BSTH01-C01", "BSTH01-C01"]);
      expect(() => pick(opened, [])).toThrow(/requires 1 selection/);
      const afterGuided = pick(opened, ["top-0"]);
      expect(pickAction(afterGuided)).toMatchObject({
        canSkip: true,
        candidateCardInstanceIds: [],
      });
      const finished = pick(afterGuided, []);
      expect(finished.pendingDeckReveal).toBeNull();
      expect(zones(finished)).toEqual(["hand", "trash", "trash"]);
    });

    it("どちらの対象もない場合は回収0枚で終えられる", () => {
      const opened = reveal(cardNo, ["BSTH01-C01", "BSTH01-C01", "BSTH01-C01"]);
      expect(pickAction(opened).candidateCardInstanceIds).toEqual([]);
      const afterGuided = pick(opened, []);
      expect(pickAction(afterGuided).candidateCardInstanceIds).toEqual([]);
      const finished = pick(afterGuided, []);
      expect(finished.pendingDeckReveal).toBeNull();
      expect(zones(finished)).toEqual(["trash", "trash", "trash"]);
    });
  }
);
