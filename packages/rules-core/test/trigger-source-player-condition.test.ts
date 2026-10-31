/**
 * trigger_source_player 条件 primitive のユニット検証。
 *
 * 「自分の系統:「鍵」/「星霊」を持つ効果で〜」(BSFT01-C03/C04) のように、トリガー原因の
 * 効果ソースカードのコントローラーで自/相手を限定する用途。trigger_tribes が系統で
 * 絞るのと直交し、ガード対象は「効果のコントローラー」(actingPlayerId) と
 * sourceCard.controllerPlayerId の一致 (player:"self") / 不一致 (player:"opponent") で判定。
 *
 * TriggerContext.sourcePlayerId が未注入の場合は match 失敗 (フォールバックなし)。
 * これは「自カードを誤発火させない」trigger_tribes と同じ設計 (sourceCard 経由で
 * 自カードへフォールバックすると "自分の" 限定の意味が崩れるため)。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const dummy: CardDefinition = {
  cardNo: "TSP-DUMMY",
  name: "trigger_source_player テスト用",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const cardNoMap = new Map<string, CardDefinition>([[dummy.cardNo, dummy]]);
const getDef = (id: string) => cardNoMap.get(id);

function baseState(): GameState {
  const inst = createCardInstance(dummy, {
    instanceId: "sp",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    cardInstances: [inst],
  };
}

describe("trigger_source_player (ConditionClause)", () => {
  it("player:'self' は sourcePlayerId === actingPlayerId のとき成立", () => {
    expect(
      evaluateCondition(
        baseState(),
        [{ kind: "trigger_source_player", player: "self" }],
        "sp",
        "alice",
        getDef,
        { sourcePlayerId: "alice" }
      )
    ).toBe(true);
  });

  it("player:'self' は sourcePlayerId !== actingPlayerId のとき不成立 (相手起因はガード)", () => {
    expect(
      evaluateCondition(
        baseState(),
        [{ kind: "trigger_source_player", player: "self" }],
        "sp",
        "alice",
        getDef,
        { sourcePlayerId: "bob" }
      )
    ).toBe(false);
  });

  it("player:'opponent' は sourcePlayerId !== actingPlayerId のとき成立", () => {
    expect(
      evaluateCondition(
        baseState(),
        [{ kind: "trigger_source_player", player: "opponent" }],
        "sp",
        "alice",
        getDef,
        { sourcePlayerId: "bob" }
      )
    ).toBe(true);
  });

  it("player:'opponent' は sourcePlayerId === actingPlayerId のとき不成立", () => {
    expect(
      evaluateCondition(
        baseState(),
        [{ kind: "trigger_source_player", player: "opponent" }],
        "sp",
        "alice",
        getDef,
        { sourcePlayerId: "alice" }
      )
    ).toBe(false);
  });

  it("sourcePlayerId 不在の triggerContext では player:'self' は不成立 (フォールバックなし)", () => {
    expect(
      evaluateCondition(
        baseState(),
        [{ kind: "trigger_source_player", player: "self" }],
        "sp",
        "alice",
        getDef,
        { sourceTribes: ["鍵"] }
      )
    ).toBe(false);
  });

  it("triggerContext 未注入では player:'self' は不成立", () => {
    expect(
      evaluateCondition(
        baseState(),
        [{ kind: "trigger_source_player", player: "self" }],
        "sp",
        "alice",
        getDef
      )
    ).toBe(false);
  });
});
